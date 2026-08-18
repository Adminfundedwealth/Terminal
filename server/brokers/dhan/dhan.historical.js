/**
 * DHAN HISTORICAL DATA SERVICE
 * 
 * Endpoints:
 *   POST /v2/charts/intraday    — Up to 5 days per request (1m, 5m, 15m, 25m, 60m)
 *   POST /v2/charts/historical  — Full multi-year daily data
 * 
 * Date ranges:
 *   Intraday: 60 trading days back (chunked in 5-day batches)
 *   Daily/Weekly: 5 years back
 * 
 * Headers required: access-token, client-id, dhan-client-id, dhanClientId
 */

import axios from 'axios';
import https from 'https';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

// ─── Index token map (Angel → Dhan) ──────────────────────────────────────────
const INDEX_MAP = {
  '99926000': { securityId: '13', segment: 'IDX_I', instrument: 'INDEX' },
  '99926009': { securityId: '25', segment: 'IDX_I', instrument: 'INDEX' },
  '99926037': { securityId: '27', segment: 'IDX_I', instrument: 'INDEX' },
  '99926074': { securityId: '442', segment: 'IDX_I', instrument: 'INDEX' },
  '99919000': { securityId: '51', segment: 'IDX_I', instrument: 'INDEX' },
};

// ─── Exchange segment mapping ─────────────────────────────────────────────────
const SEGMENT_MAP = {
  'NSE': 'NSE_EQ',
  'BSE': 'BSE_EQ',
  'NFO': 'NSE_FNO',
  'BFO': 'BSE_FNO',
  'MCX': 'MCX_COMM',
  'CDS': 'NSE_CURRENCY',
  'NSE_EQ': 'NSE_EQ',
  'BSE_EQ': 'BSE_EQ',
  'NSE_FNO': 'NSE_FNO',
  'IDX_I': 'IDX_I',
  'MCX_COMM': 'MCX_COMM',
  'NSE_CURRENCY': 'NSE_CURRENCY',
};

// ─── Timeframe config ─────────────────────────────────────────────────────────
// Intraday: max 5 calendar days per request
// Historical: unlimited range for daily
const TF_CONFIG = {
  '1':   { type: 'intraday', interval: '1',  lookbackDays: 5 },
  '3':   { type: 'intraday', interval: '5',  lookbackDays: 5 },
  '5':   { type: 'intraday', interval: '5',  lookbackDays: 5 },
  '15':  { type: 'intraday', interval: '15', lookbackDays: 10 },
  '30':  { type: 'intraday', interval: '25', lookbackDays: 15 },
  '60':  { type: 'intraday', interval: '60', lookbackDays: 30 },
  '240': { type: 'historical', interval: 'DAY', lookbackYears: 2 },
  'D':   { type: 'historical', interval: 'DAY', lookbackYears: 5 },
  'W':   { type: 'historical', interval: 'DAY', lookbackYears: 5 },
};

export class DhanHistoricalService {
  constructor(authService) {
    this.auth = authService;
    // Scrip master cache: loaded once on first request
    this._scripMaster = null;
    this._scripMasterLoading = null;
  }

  /**
   * Main entry point — fetch candles for any instrument.
   */
  async getCandles(token, exchange, timeframe, fromTimestamp, toTimestamp) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        throw new Error('[DhanHist] No valid token');
      }
    }

    const tf = TF_CONFIG[timeframe];
    if (!tf) throw new Error(`[DhanHist] Unsupported timeframe: ${timeframe}`);

    // Resolve instrument identity
    const resolved = await this._resolve(token, exchange);
    if (!resolved) throw new Error(`[DhanHist] Cannot resolve ${token}/${exchange}`);

    // Calculate proper date range
    const now = new Date();
    let fromDate, toDate;

    if (tf.type === 'intraday') {
      // Use provided timestamps or default to lookbackDays
      if (fromTimestamp && fromTimestamp > 946684800) {
        fromDate = this._fmt(new Date(fromTimestamp * 1000));
      } else {
        const from = new Date(now);
        from.setDate(from.getDate() - tf.lookbackDays);
        fromDate = this._fmt(from);
      }
      toDate = toTimestamp ? this._fmt(new Date(toTimestamp * 1000)) : this._fmt(now);
    } else {
      // Historical daily/weekly — go years back
      if (fromTimestamp && fromTimestamp > 946684800) {
        fromDate = this._fmt(new Date(fromTimestamp * 1000));
      } else {
        const from = new Date(now);
        from.setFullYear(from.getFullYear() - tf.lookbackYears);
        fromDate = this._fmt(from);
      }
      toDate = toTimestamp ? this._fmt(new Date(toTimestamp * 1000)) : this._fmt(now);
    }

    console.log(`[DhanHist] ${tf.type} ${resolved.securityId}/${resolved.segment} tf=${timeframe} ${fromDate}→${toDate}`);

    if (tf.type === 'intraday') {
      const candles = await this._fetchIntraday(resolved, tf.interval, fromDate, toDate);
      return candles;
    } else {
      const candles = await this._fetchDaily(resolved, fromDate, toDate);
      if (timeframe === 'W') return this._aggregateWeekly(candles);
      return candles;
    }
  }

  // ─── Intraday: chunk into 5-day windows ──────────────────────────────────

  async _fetchIntraday(resolved, interval, fromDate, toDate) {
    const allCandles = [];
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      const chunkEnd = new Date(cursor);
      chunkEnd.setDate(chunkEnd.getDate() + 4); // 5 days max per request
      if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

      const payload = {
        securityId: resolved.securityId,
        exchangeSegment: resolved.segment,
        instrument: resolved.instrument,
        interval,
        fromDate: this._fmt(cursor),
        toDate: this._fmt(chunkEnd),
      };

      try {
        const resp = await this._post(`${DHAN_API_BASE}/charts/intraday`, payload);
        const parsed = this._parse(resp.data);
        console.log(`[DhanHist] Chunk ${this._fmt(cursor)}→${this._fmt(chunkEnd)}: ${parsed.length} candles`);
        allCandles.push(...parsed);
      } catch (err) {
        // On auth error, try refresh once
        if (err.response?.status === 401 || err.response?.status === 400) {
          const errMsg = err.response?.data?.errorMessage || err.response?.data?.data;
          if (String(errMsg).includes('Token') || String(errMsg).includes('Authentication')) {
            const refreshed = await this.auth.refreshToken();
            if (refreshed) {
              try {
                const resp = await this._post(`${DHAN_API_BASE}/charts/intraday`, payload);
                allCandles.push(...this._parse(resp.data));
              } catch (_) {}
            } else {
              // Token refresh failed — stop trying more chunks
              console.error('[DhanHist] Token refresh failed, aborting intraday fetch');
              break;
            }
          } else {
            console.warn(`[DhanHist] Chunk error (non-auth): ${JSON.stringify(err.response?.data).slice(0, 100)}`);
          }
        } else {
          console.warn(`[DhanHist] Chunk network error: ${err.message}`);
        }
        // Continue with next chunk
      }

      cursor.setDate(cursor.getDate() + 5);
    }

    return this._dedupe(allCandles);
  }

  // ─── Historical daily: single request ────────────────────────────────────

  async _fetchDaily(resolved, fromDate, toDate) {
    const payload = {
      securityId: resolved.securityId,
      exchangeSegment: resolved.segment,
      instrument: resolved.instrument,
      interval: 'DAY',
      fromDate,
      toDate,
    };

    try {
      const resp = await this._post(`${DHAN_API_BASE}/charts/historical`, payload);
      return this._dedupe(this._parse(resp.data));
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 400) {
        const refreshed = await this.auth.refreshToken();
        if (refreshed) {
          const resp = await this._post(`${DHAN_API_BASE}/charts/historical`, payload);
          return this._dedupe(this._parse(resp.data));
        }
      }
      throw err;
    }
  }

  // ─── Instrument resolution ───────────────────────────────────────────────

  async _resolve(token, exchange) {
    // 1. Known index tokens
    if (INDEX_MAP[token]) return INDEX_MAP[token];

    // 2. Try scrip master lookup (for MCX, NFO futures, ETFs)
    const master = await this._getScripMaster();
    if (master) {
      const entry = master.get(token);
      if (entry) return entry;
    }

    // 3. Default: use token as-is with mapped segment
    const segment = SEGMENT_MAP[exchange] || 'NSE_EQ';
    let instrument;
    switch (segment) {
      case 'NSE_FNO': case 'BSE_FNO': instrument = 'FUTIDX'; break;
      case 'MCX_COMM': instrument = 'FUTCOM'; break;
      case 'NSE_CURRENCY': instrument = 'FUTCUR'; break;
      case 'IDX_I': instrument = 'INDEX'; break;
      default: instrument = 'EQUITY'; break;
    }
    return { securityId: String(token), segment, instrument };
  }

  // ─── Scrip Master Loader ─────────────────────────────────────────────────

  async _getScripMaster() {
    if (this._scripMaster) return this._scripMaster;
    if (this._scripMasterLoading) return this._scripMasterLoading;

    this._scripMasterLoading = this._loadScripMaster().then(m => {
      this._scripMaster = m;
      this._scripMasterLoading = null;
      return m;
    }).catch(err => {
      console.error('[DhanHist] Scrip master load failed:', err.message);
      this._scripMasterLoading = null;
      return null;
    });

    return this._scripMasterLoading;
  }

  async _loadScripMaster() {
    console.log('[DhanHist] Loading Dhan scrip master...');
    try {
      const resp = await axios.get('https://images.dhan.co/api-data/api-scrip-master.csv', {
        httpsAgent: IPV4_AGENT,
        timeout: 30000,
        responseType: 'text',
      });

      const lines = resp.data.split('\n');
      const header = lines[0].split(',');

      // Find column indices
      const cols = {};
      header.forEach((h, i) => {
        const key = h.trim().replace(/"/g, '');
        cols[key] = i;
      });

      // Columns we need: SEM_SMST_SECURITY_ID, SEM_INSTRUMENT_NAME, SEM_TRADING_SYMBOL,
      // SEM_EXG_SEGMENT, SEM_CUSTOM_SYMBOL, SM_SYMBOL_NAME
      const secIdCol = cols['SEM_SMST_SECURITY_ID'] ?? cols['SECURITY_ID'];
      const segCol = cols['SEM_EXG_SEGMENT'] ?? cols['EXCHANGE_SEGMENT'];
      const symbolCol = cols['SEM_TRADING_SYMBOL'] ?? cols['TRADING_SYMBOL'];
      const instCol = cols['SEM_INSTRUMENT_NAME'] ?? cols['INSTRUMENT_TYPE'];
      const customSymCol = cols['SEM_CUSTOM_SYMBOL'] ?? cols['CUSTOM_SYMBOL'];

      if (secIdCol === undefined) {
        console.warn('[DhanHist] Scrip master: cannot find security ID column');
        return null;
      }

      const map = new Map();

      // Build lookup by: Angel-style token → Dhan resolution
      // For NSE_EQ, Angel token === Dhan securityId
      // For MCX/NFO, we map by symbol name
      const symbolToEntry = new Map();

      for (let i = 1; i < lines.length; i++) {
        const fields = this._parseCSVLine(lines[i]);
        if (!fields || fields.length < 5) continue;

        const secId = fields[secIdCol]?.trim();
        const seg = fields[segCol]?.trim();
        const symbol = fields[symbolCol]?.trim();
        const inst = fields[instCol]?.trim();
        const customSym = fields[customSymCol]?.trim();

        if (!secId || !seg) continue;

        const entry = { securityId: secId, segment: seg, instrument: inst || 'EQUITY' };

        // Direct securityId mapping (works for NSE_EQ where Angel token = Dhan securityId)
        map.set(secId, entry);

        // Also index by trading symbol for cross-reference
        if (symbol) symbolToEntry.set(`${seg}:${symbol}`, entry);
        if (customSym) symbolToEntry.set(`${seg}:${customSym}`, entry);
      }

      // Add well-known hardcoded mappings for common instruments
      // These cover cases where Angel One tokens differ from Dhan security IDs
      const HARDCODED = {
        // ETFs (Angel token → Dhan securityId on NSE_EQ)
        '16599': { securityId: '10599', segment: 'NSE_EQ', instrument: 'EQUITY' },  // NIFTYBEES
        '16600': { securityId: '10604', segment: 'NSE_EQ', instrument: 'EQUITY' },  // BANKBEES
        // MCX commodities (Angel token → Dhan securityId)
        '429604': { securityId: '429604', segment: 'MCX_COMM', instrument: 'FUTCOM' },  // GOLD
        '429638': { securityId: '429638', segment: 'MCX_COMM', instrument: 'FUTCOM' },  // SILVER
        '425475': { securityId: '425475', segment: 'MCX_COMM', instrument: 'FUTCOM' },  // CRUDEOIL
        '431765': { securityId: '431765', segment: 'MCX_COMM', instrument: 'FUTCOM' },  // NATURALGAS
        '430596': { securityId: '430596', segment: 'MCX_COMM', instrument: 'FUTCOM' },  // COPPER
        // CDS currencies
        '11091': { securityId: '11091', segment: 'NSE_CURRENCY', instrument: 'FUTCUR' }, // USDINR
        '11363': { securityId: '11363', segment: 'NSE_CURRENCY', instrument: 'FUTCUR' }, // EURINR
        '11096': { securityId: '11096', segment: 'NSE_CURRENCY', instrument: 'FUTCUR' }, // GBPINR
        '11098': { securityId: '11098', segment: 'NSE_CURRENCY', instrument: 'FUTCUR' }, // JPYINR
      };

      for (const [k, v] of Object.entries(HARDCODED)) {
        map.set(k, v);
      }

      console.log(`[DhanHist] Scrip master loaded: ${map.size} entries`);
      return map;
    } catch (err) {
      console.error('[DhanHist] Scrip master fetch error:', err.message);
      return null;
    }
  }

  _parseCSVLine(line) {
    if (!line) return null;
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { fields.push(current); current = ''; }
      else { current += c; }
    }
    fields.push(current);
    return fields;
  }

  // ─── Response parser ─────────────────────────────────────────────────────

  _parse(data) {
    const raw = data?.data || data;
    const timestamps = raw?.timestamp || raw?.start_Time || [];
    const opens = raw?.open || [];
    const highs = raw?.high || [];
    const lows = raw?.low || [];
    const closes = raw?.close || [];
    const volumes = raw?.volume || [];

    if (!timestamps.length) return [];

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const time = this._normalizeTs(timestamps[i]);
      const o = parseFloat(opens[i]) || 0;
      const h = parseFloat(highs[i]) || 0;
      const l = parseFloat(lows[i]) || 0;
      const c = parseFloat(closes[i]) || 0;
      const v = parseInt(volumes[i]) || 0;

      if (time <= 0 || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
      if (h < l || h < o || h < c || l > o || l > c) continue;
      candles.push({ time, open: o, high: h, low: l, close: c, volume: v });
    }
    return candles;
  }

  _normalizeTs(ts) {
    if (typeof ts === 'number') return ts > 9999999999 ? Math.floor(ts / 1000) : ts;
    if (typeof ts === 'string') { const d = new Date(ts).getTime(); return isNaN(d) ? 0 : Math.floor(d / 1000); }
    return 0;
  }

  _dedupe(candles) {
    candles.sort((a, b) => a.time - b.time);
    const out = [];
    let prev = 0;
    for (const c of candles) { if (c.time !== prev) { out.push(c); prev = c.time; } }
    return out;
  }

  _aggregateWeekly(daily) {
    if (!daily.length) return [];
    const weeks = [];
    let cur = null;
    for (const c of daily) {
      const d = new Date(c.time * 1000);
      const day = d.getDay();
      d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
      const ws = d.toISOString().slice(0, 10);
      if (!cur || cur._ws !== ws) {
        if (cur) weeks.push(cur);
        cur = { _ws: ws, time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      } else {
        cur.high = Math.max(cur.high, c.high);
        cur.low = Math.min(cur.low, c.low);
        cur.close = c.close;
        cur.volume += c.volume;
      }
    }
    if (cur) weeks.push(cur);
    return weeks.map(({ _ws, ...c }) => c);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _fmt(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  async _post(url, payload) {
    return axios.post(url, payload, {
      httpsAgent: IPV4_AGENT,
      timeout: 12000,
      headers: this.auth.getHeaders(),
    });
  }
}
