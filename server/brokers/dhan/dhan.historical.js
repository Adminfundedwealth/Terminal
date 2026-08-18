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
  // Direct Dhan securityId entries (when token is already resolved)
  '13': { securityId: '13', segment: 'IDX_I', instrument: 'INDEX' },
  '25': { securityId: '25', segment: 'IDX_I', instrument: 'INDEX' },
  '27': { securityId: '27', segment: 'IDX_I', instrument: 'INDEX' },
  '442': { securityId: '442', segment: 'IDX_I', instrument: 'INDEX' },
  '51': { securityId: '51', segment: 'IDX_I', instrument: 'INDEX' },
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
  constructor(authService, marketDataEngine) {
    this.auth = authService;
    this._marketDataEngine = marketDataEngine || null;
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

    // 2. Try scrip master lookup
    const master = await this._getScripMaster();
    if (master) {
      // Direct token lookup (works when Angel token = Dhan securityId)
      const entry = master.byId.get(token);
      if (entry) return entry;

      // Symbol-based lookup: get symbol name from marketDataEngine cache
      // then find by symbol in the master
      if (this._marketDataEngine) {
        const quote = this._marketDataEngine.getQuote(token);
        const symbol = quote?.symbol;
        if (symbol) {
          const seg = exchange === 'NFO' ? 'NSE_FNO' : exchange === 'MCX' ? 'MCX_COMM' : exchange === 'CDS' ? 'NSE_CURRENCY' : 'NSE_EQ';
          const symEntry = master.bySymbol.get(`${symbol}:${seg}`) || master.bySymbol.get(`${symbol}:E`);
          if (symEntry) {
            console.log(`[DhanHist] Resolved ${symbol} (Angel ${token}) → Dhan ${symEntry.securityId}`);
            return symEntry;
          }
        }
      }
    }

    // 3. Default: use token as-is with mapped segment
    const segment = SEGMENT_MAP[exchange] || 'NSE_EQ';
    let instrument;

    // Try to infer instrument type from the market data engine's cached quote
    let inferredSymbol = null;
    if (this._marketDataEngine) {
      const q = this._marketDataEngine.getQuote(token);
      if (q) inferredSymbol = q.symbol || q.tradingSymbol;
    }

    switch (segment) {
      case 'NSE_FNO': case 'BSE_FNO':
        // Detect option vs future: options have CE/PE in their symbol or a strike pattern
        if (inferredSymbol && /\d+(CE|PE)$/i.test(inferredSymbol.replace(/[\s\-]/g, ''))) {
          const upper = inferredSymbol.toUpperCase();
          instrument = (upper.includes('NIFTY') || upper.includes('BANKNIFTY') || upper.includes('FINNIFTY') || upper.includes('MIDCPNIFTY') || upper.includes('SENSEX'))
            ? 'OPTIDX' : 'OPTSTK';
        } else {
          instrument = 'FUTIDX';
        }
        break;
      case 'MCX_COMM':
        if (inferredSymbol && /\d+(CE|PE)$/i.test(inferredSymbol.replace(/[\s\-]/g, ''))) {
          instrument = 'OPTFUT';
        } else {
          instrument = 'FUTCOM';
        }
        break;
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
        timeout: 45000,
        responseType: 'text',
      });

      const lines = resp.data.split('\n');
      const header = lines[0].split(',');

      // Detect column indices from header
      const expiryCol = header.findIndex(h => h.trim().toUpperCase().includes('EXPIRY'));
      const symbolNameCol = header.findIndex(h => h.trim().toUpperCase() === 'SM_SYMBOL_NAME');

      // Column indices: SEM_SEGMENT(1), SEM_SMST_SECURITY_ID(2), SEM_INSTRUMENT_NAME(3), SEM_TRADING_SYMBOL(5)
      const byId = new Map();      // securityId → { securityId, segment, instrument }
      const bySymbol = new Map();  // "SYMBOL:SEGMENT" → { securityId, segment, instrument }

      const segMap = { 'E': 'NSE_EQ', 'D': 'NSE_FNO', 'M': 'MCX_COMM', 'C': 'NSE_CURRENCY', 'BE': 'BSE_EQ' };

      // Store raw futures entries for MCX/CDS active contract resolution
      const futuresEntries = []; // { securityId, segment, symbol, instrument, expiry }

      for (let i = 1; i < lines.length; i++) {
        const f = lines[i].split(',');
        if (f.length < 6) continue;

        const seg = f[1]?.trim();
        const secId = f[2]?.trim();
        const inst = f[3]?.trim();
        const symbol = f[5]?.trim();
        const expiry = expiryCol >= 0 && f.length > expiryCol ? f[expiryCol]?.trim() : null;
        // Also try to get the underlying symbol name (SM_SYMBOL_NAME)
        const symName = symbolNameCol >= 0 && f.length > symbolNameCol ? f[symbolNameCol]?.trim() : null;

        if (!secId || !seg) continue;

        const dhanSeg = segMap[seg] || 'NSE_EQ';
        const entry = { securityId: secId, segment: dhanSeg, instrument: inst || 'EQUITY' };

        // Store by security ID
        byId.set(secId, entry);

        // Store by symbol + segment (for reverse lookup)
        if (symbol && (inst === 'EQUITY' || inst === 'INDEX')) {
          const key = `${symbol}:${dhanSeg}`;
          // Prefer NSE over BSE (shorter secId is typically NSE)
          const existing = bySymbol.get(key);
          if (!existing || secId.length < existing.securityId.length) {
            bySymbol.set(key, entry);
          }
          // Also store without segment for fallback
          bySymbol.set(`${symbol}:E`, entry);
        }

        // Store MCX/CDS futures for active contract resolution
        if ((seg === 'M' || seg === 'C') && (inst === 'FUTCOM' || inst === 'FUTCUR' || inst === 'FUTIDX')) {
          futuresEntries.push({ securityId: secId, segment: dhanSeg, symbol: symName || symbol, tradingSymbol: symbol, instrument: inst, expiry });
        }
      }

      // Add hardcoded overrides for known mismatches
      const OVERRIDES = {
        '11723': { securityId: '7229', segment: 'NSE_EQ', instrument: 'EQUITY' },  // HCLTECH
      };
      for (const [angelToken, dhanEntry] of Object.entries(OVERRIDES)) {
        byId.set(angelToken, dhanEntry);
      }

      console.log(`[DhanHist] Scrip master loaded: ${byId.size} IDs, ${bySymbol.size} symbols, ${futuresEntries.length} futures contracts`);
      return { byId, bySymbol, futuresEntries };
    } catch (err) {
      console.error('[DhanHist] Scrip master fetch error:', err.message);
      return null;
    }
  }

  /**
   * Get the nearest active expiry contract for a commodity/currency symbol.
   * Returns the Dhan security ID for the front-month contract.
   * @param {string} symbol - e.g. 'GOLD', 'CRUDEOIL', 'USDINR'
   * @param {string} segment - 'MCX_COMM' or 'NSE_CURRENCY'
   * @returns {string|null} security ID or null
   */
  getActiveContract(symbol, segment) {
    if (!this._scripMaster?.futuresEntries) return null;

    const now = new Date();
    const target = symbol.toUpperCase();
    const matches = this._scripMaster.futuresEntries.filter(item => {
      if (item.segment !== segment) return false;
      // Match by symbol name or trading symbol
      const sym = (item.symbol || '').toUpperCase();
      const tsym = (item.tradingSymbol || '').toUpperCase();
      if (sym !== target && !tsym.startsWith(target)) return false;
      // Must have future expiry (or no expiry = always valid)
      if (!item.expiry) return true;
      try {
        const expDate = new Date(item.expiry);
        return !isNaN(expDate.getTime()) && expDate >= now;
      } catch { return false; }
    });

    if (matches.length === 0) return null;

    // Sort by earliest expiry (nearest month = front month contract)
    matches.sort((a, b) => {
      const da = a.expiry ? new Date(a.expiry).getTime() : Infinity;
      const db = b.expiry ? new Date(b.expiry).getTime() : Infinity;
      return da - db;
    });

    console.log(`[DhanHist] Active contract for ${symbol}/${segment}: ${matches[0].securityId} (expiry: ${matches[0].expiry || 'none'})`);
    return matches[0].securityId;
  }

  // (CSV parsing handled inline in _loadScripMaster)

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
