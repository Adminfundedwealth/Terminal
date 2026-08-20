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
  'CUR': 'NSE_CURRENCY',
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
// Dhan supported intraday intervals: 1, 3, 5, 10, 15, 25, 60 minutes
const TF_CONFIG = {
  '1':   { type: 'intraday', interval: '1',  lookbackDays: 10 },
  '3':   { type: 'intraday', interval: '3',  lookbackDays: 10 },
  '5':   { type: 'intraday', interval: '5',  lookbackDays: 15 },
  '15':  { type: 'intraday', interval: '15', lookbackDays: 30 },
  '30':  { type: 'intraday', interval: '25', lookbackDays: 30 },
  '60':  { type: 'intraday', interval: '60', lookbackDays: 60 },
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
      // Try a refresh before giving up — token may have just expired
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        // Return empty array so the caller (DataProviderSwitch) can try Angel One fallback
        console.warn(`[DhanHist] Token invalid for ${token}/${timeframe} — falling back to Angel`);
        return [];
      }
    }

    const tf = TF_CONFIG[timeframe];
    if (!tf) {
      console.warn(`[DhanHist] Unsupported timeframe: ${timeframe} — falling back to Angel`);
      return [];
    }

    // Resolve instrument identity
    const resolved = await this._resolve(token, exchange);
    if (!resolved) {
      console.warn(`[DhanHist] Cannot resolve ${token}/${exchange} — falling back to Angel`);
      return [];
    }

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
        // On auth error, try refresh once.
        // IMPORTANT: Only treat as an auth error when:
        //   (a) HTTP 401 (explicit auth rejection), OR
        //   (b) HTTP 400 AND the error message mentions Token/Authentication
        // A plain HTTP 400 with DH-905 (bad parameters) is NOT an auth failure.
        // Calling markTokenInvalid() on a 400 bad-params error was the bug that
        // set dhanTokenValid=false even when the token was perfectly valid.
        const isAuthError = err.response?.status === 401 ||
          (err.response?.status === 400 && (
            String(err.response?.data?.errorMessage || '').includes('Token') ||
            String(err.response?.data?.errorMessage || '').includes('Authentication') ||
            String(err.response?.data?.data || '').includes('Token') ||
            String(err.response?.data?.data || '').includes('Authentication')
          ));

        if (isAuthError) {
          const errMsg = err.response?.data?.errorMessage || err.response?.data?.data || '';
          console.warn(`[DhanHist] Auth error on chunk ${this._fmt(cursor)}→${this._fmt(chunkEnd)}: ${errMsg}`);
          const refreshed = await this.auth.refreshToken();
          if (refreshed) {
            try {
              const resp = await this._post(`${DHAN_API_BASE}/charts/intraday`, payload);
              allCandles.push(...this._parse(resp.data));
              cursor.setDate(cursor.getDate() + 5);
              continue;
            } catch (_) {}
          }
          // Only call markTokenInvalid when the original error was a confirmed 401
          // (not a 400 bad-parameters). Prevents a bad chart request from poisoning
          // the entire session's authentication state.
          if (err.response?.status === 401) {
            this.auth.markTokenInvalid();
            console.error('[DhanHist] Confirmed 401 from Dhan — token marked invalid. Update DHAN_ACCESS_TOKEN in Railway.');
          } else {
            console.warn('[DhanHist] Auth-like 400 error but not 401 — NOT marking token invalid. Angel fallback for this request only.');
          }
          break;
        } else if (err.response?.status === 400) {
          console.warn(`[DhanHist] Chunk error (non-auth 400 — bad params): ${JSON.stringify(err.response?.data).slice(0, 120)}`);
        } else {
          console.warn(`[DhanHist] Chunk network error: ${err.message}`);
        }
        // Continue with next chunk on non-fatal errors
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

    // 2. Map exchange to Dhan segment early (needed for lookups)
    const segment = SEGMENT_MAP[exchange] || 'NSE_EQ';

    // 3. Try scrip master lookup
    const master = await this._getScripMaster();
    if (master) {
      // Direct token lookup (works when token = Dhan securityId)
      const entry = master.byId.get(token);
      if (entry) return entry;

      // Symbol-based lookup: get symbol name from marketDataEngine cache
      // then find by symbol in the master
      if (this._marketDataEngine) {
        const quote = this._marketDataEngine.getQuote(token);
        const symbol = quote?.symbol;
        if (symbol) {
          const seg = exchange === 'NFO' ? 'NSE_FNO' : exchange === 'MCX' ? 'MCX_COMM' : exchange === 'CDS' ? 'NSE_CURRENCY' : segment;
          const symEntry = master.bySymbol.get(`${symbol}:${seg}`) || master.bySymbol.get(`${symbol}:E`);
          if (symEntry) {
            console.log(`[DhanHist] Resolved ${symbol} (token ${token}) → Dhan ${symEntry.securityId}/${symEntry.segment}`);
            return symEntry;
          }
          
          // For MCX/CDS, try active contract resolution if symbol-based lookup fails
          if (seg === 'MCX_COMM' || seg === 'NSE_CURRENCY') {
            const baseSymbol = symbol.replace(/\s*(FUT|FUTURES?|MINI|MICRO)\s*/i, '').trim().toUpperCase();
            // Use resolveActiveContractLive which tries scrip master, then live API, then static fallback
            const activeId = await this.resolveActiveContractLive(baseSymbol, seg);
            if (activeId) {
              const activeEntry = master.byId.get(activeId);
              if (activeEntry) {
                console.log(`[DhanHist] Active contract: ${symbol} → ${activeId}/${seg}`);
                return activeEntry;
              }
              return { securityId: activeId, segment: seg, instrument: seg === 'MCX_COMM' ? 'FUTCOM' : 'FUTCUR' };
            }
          }
        }
      }
    }

    // 4. Default: use token as-is with mapped segment
    //    IMPORTANT: For MCX/CDS, the incoming token may be an Angel One placeholder
    //    (e.g. '429604', '11091') that is NOT a valid Dhan security ID.
    //    In that case, resolve the active contract by segment if we can infer a symbol.
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
      case 'MCX_COMM': {
        // For MCX, try to resolve the active contract live if we have a symbol hint
        if (inferredSymbol) {
          const baseSymbol = inferredSymbol.replace(/\s*(FUT|FUTURES?|MINI|MICRO)\s*/i, '').trim().toUpperCase();
          const activeId = await this.resolveActiveContractLive(baseSymbol, 'MCX_COMM');
          if (activeId && activeId !== token) {
            console.log(`[DhanHist] MCX fallback resolve: token ${token} (${inferredSymbol}) → active contract ${activeId}`);
            return { securityId: activeId, segment: 'MCX_COMM', instrument: 'FUTCOM' };
          }
        }
        if (inferredSymbol && /\d+(CE|PE)$/i.test(inferredSymbol.replace(/[\s\-]/g, ''))) {
          instrument = 'OPTFUT';
        } else {
          instrument = 'FUTCOM';
        }
        break;
      }
      case 'NSE_CURRENCY': {
        // For CDS, try to resolve the active contract live if we have a symbol hint
        if (inferredSymbol) {
          const baseSymbol = inferredSymbol.replace(/\s*(FUT|FUTURES?)\s*/i, '').trim().toUpperCase();
          const activeId = await this.resolveActiveContractLive(baseSymbol, 'NSE_CURRENCY');
          if (activeId && activeId !== token) {
            console.log(`[DhanHist] CDS fallback resolve: token ${token} (${inferredSymbol}) → active contract ${activeId}`);
            return { securityId: activeId, segment: 'NSE_CURRENCY', instrument: 'FUTCUR' };
          }
        }
        instrument = 'FUTCUR';
        break;
      }
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

      // Detect column indices from header.
      // IMPORTANT: SEM_EXPIRY_CODE (col 4) is an integer code, NOT the date.
      //            SEM_EXPIRY_DATE (col 8) is the ISO datetime string we need.
      //            We must find 'SEM_EXPIRY_DATE' exactly, not any column
      //            that merely contains the word 'EXPIRY'.
      const expiryCol    = header.findIndex(h => h.trim().toUpperCase() === 'SEM_EXPIRY_DATE');
      const symbolNameCol = header.findIndex(h => h.trim().toUpperCase() === 'SM_SYMBOL_NAME');
      const tickSizeCol  = header.findIndex(h => h.trim().toUpperCase() === 'SEM_TICK_SIZE');

      // Column indices: SEM_SEGMENT(1), SEM_SMST_SECURITY_ID(2), SEM_INSTRUMENT_NAME(3), SEM_TRADING_SYMBOL(5)
      const byId = new Map();      // securityId → { securityId, segment, instrument }
      const bySymbol = new Map();  // "SYMBOL:SEGMENT" → { securityId, segment, instrument }
      // underlyingLotSize: underlying symbol (uppercased) → lot size (integer)
      // Sourced from the first OPTIDX/OPTSTK/FUTIDX/FUTSTK row for that underlying.
      // Column SEM_LOT_UNITS (index 6) is the exchange-mandated lot size.
      const underlyingLotSize = new Map();
      // underlyingTickSize: underlying → tick size (float) from SEM_TICK_SIZE
      const underlyingTickSize = new Map();

      // seg=D covers BOTH NSE_FNO and BSE_FNO rows — distinguish by SEM_EXM_EXCH_ID (col 0).
      // No 'BD' segment exists in this master; BSE FNO rows have seg=D and exch=BSE.
      const segMap = { 'E': 'NSE_EQ', 'D': 'NSE_FNO', 'M': 'MCX_COMM', 'C': 'NSE_CURRENCY', 'BE': 'BSE_EQ' };

      // BSE symName codes → canonical underlying name used by FuturesContractService
      const BSE_SYMNAME_MAP = {
        'BSXFUT': 'SENSEX',
        'BKXFUT': 'BANKEX',
        'SX50FUT': 'SENSEX50',
        'BITFUT': 'FOCIT',
      };

      // Store raw futures entries for MCX/CDS/NSE-FNO/BSE-FNO active contract resolution
      const futuresEntries = []; // { securityId, segment, symbol, instrument, expiry }

      for (let i = 1; i < lines.length; i++) {
        const f = lines[i].split(',');
        if (f.length < 7) continue;

        const seg = f[1]?.trim();
        const secId = f[2]?.trim();
        const inst = f[3]?.trim();
        const symbol = f[5]?.trim();             // SEM_TRADING_SYMBOL  e.g. "NIFTY-Aug2026-24500-CE"
        const lotRaw = f[6]?.trim();             // SEM_LOT_UNITS       e.g. "50.0"
        const expiry = expiryCol >= 0 && f.length > expiryCol ? f[expiryCol]?.trim() : null;
        // Also try to get the underlying symbol name (SM_SYMBOL_NAME)
        const symName = symbolNameCol >= 0 && f.length > symbolNameCol ? f[symbolNameCol]?.trim() : null;

        if (!secId || !seg) continue;

        const dhanSeg = segMap[seg] || 'NSE_EQ';
        const entry = { securityId: secId, segment: dhanSeg, instrument: inst || 'EQUITY' };

        // Store by security ID
        byId.set(secId, entry);

        // ── Lot-size extraction for OPTIDX and OPTSTK rows ─────────────────
        // The trading symbol format is "UNDERLYING-MonYear-Strike-CE/PE".
        // We extract the underlying by splitting on '-' and taking the first part.
        // Store the first (smallest-lot) entry for each underlying so that
        // repeated monthly/weekly rows don't overwrite with a different value.
        if ((inst === 'OPTIDX' || inst === 'OPTSTK') && lotRaw && symbol) {
          const dashIdx = symbol.indexOf('-');
          const underlying = dashIdx > 0 ? symbol.slice(0, dashIdx).toUpperCase() : symbol.toUpperCase();
          const lot = parseFloat(lotRaw);
          if (Number.isFinite(lot) && lot > 0 && !underlyingLotSize.has(underlying)) {
            underlyingLotSize.set(underlying, Math.round(lot));
          }
        }

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

        // Store MCX/CDS/NSE-FNO/BSE-FNO futures for active contract resolution.
        // seg=D covers BOTH NSE (NSE_FNO) and BSE (BSE_FNO) futures — distinguished
        // by SEM_EXM_EXCH_ID (col 0).  No 'BD' segment code exists in this master.
        // M = MCX_COMM (commodity futures), C = NSE_CURRENCY (currency futures).
        const isFutureInst = inst === 'FUTCOM' || inst === 'FUTCUR' || inst === 'FUTIDX' || inst === 'FUTSTK';
        if (isFutureInst && (seg === 'M' || seg === 'C' || seg === 'D')) {
          const exch = f[0]?.trim();   // SEM_EXM_EXCH_ID — 'NSE' or 'BSE'

          // Determine Dhan segment precisely:
          //   seg=D + exch=NSE  → NSE_FNO
          //   seg=D + exch=BSE  → BSE_FNO
          //   seg=M             → MCX_COMM
          //   seg=C             → NSE_CURRENCY
          let dhanFnoSeg;
          if (seg === 'D') {
            dhanFnoSeg = exch === 'BSE' ? 'BSE_FNO' : 'NSE_FNO';
          } else {
            dhanFnoSeg = dhanSeg; // MCX_COMM or NSE_CURRENCY (segMap values)
          }

          // ── Canonical underlying name ──────────────────────────────────────
          // Priority 1: BSE_SYMNAME_MAP lookup (BSE futures use codes like BSXFUT)
          // Priority 2: SM_SYMBOL_NAME when non-empty
          // Priority 3: Extract prefix from SEM_TRADING_SYMBOL
          //   Format: "NIFTY-Aug2026-FUT", "RELIANCE-Aug2026-FUT"
          //   The prefix is everything before the FIRST '-'.
          //   Do NOT use a regex that requires uppercase-only after '-' because
          //   Dhan uses mixed-case month names like "Aug2026".
          let underlyingName = null;
          if (symName && BSE_SYMNAME_MAP[symName]) {
            underlyingName = BSE_SYMNAME_MAP[symName];          // e.g. BSXFUT → SENSEX
          } else if (symName && symName.trim().length > 0) {
            underlyingName = symName.trim().toUpperCase();       // e.g. "RELIANCE"
          } else if (symbol) {
            // Extract prefix before the first '-'
            // "NIFTY-Aug2026-FUT"     → "NIFTY"
            // "BANKNIFTY-Aug2026-FUT" → "BANKNIFTY"
            // "RELIANCE-Aug2026-FUT"  → "RELIANCE"
            const dashIdx = symbol.indexOf('-');
            underlyingName = dashIdx > 0
              ? symbol.slice(0, dashIdx).toUpperCase()
              : symbol.toUpperCase();
          }

          // ── Lot-size from FUT row itself ───────────────────────────────────
          // FUTSTK/FUTIDX rows carry SEM_LOT_UNITS (col 6) directly.
          // We store the lot size here using the canonical underlying name so
          // that getLotSize('NIFTY') / getLotSize('RELIANCE') etc. all work.
          if (underlyingName && lotRaw) {
            const lot = parseFloat(lotRaw);
            if (Number.isFinite(lot) && lot > 0 && !underlyingLotSize.has(underlyingName)) {
              underlyingLotSize.set(underlyingName, Math.round(lot));
            }
          }

          // ── Tick size from FUT row ─────────────────────────────────────────
          const tickRaw = tickSizeCol >= 0 && f.length > tickSizeCol ? f[tickSizeCol]?.trim() : null;
          const tickSize = tickRaw ? parseFloat(tickRaw) : null;
          if (underlyingName && Number.isFinite(tickSize) && tickSize > 0 && !underlyingTickSize.has(underlyingName)) {
            underlyingTickSize.set(underlyingName, tickSize);
          }

          futuresEntries.push({
            securityId:    secId,
            segment:       dhanFnoSeg,
            symbol:        underlyingName || symbol,
            tradingSymbol: symbol,
            instrument:    inst,
            expiry,
            lotSize:       underlyingName ? underlyingLotSize.get(underlyingName) || null : null,
            tickSize:      Number.isFinite(tickSize) && tickSize > 0 ? tickSize : null,
          });
        }
      }

      // Add hardcoded overrides for known mismatches
      const OVERRIDES = {
        '11723': { securityId: '7229', segment: 'NSE_EQ', instrument: 'EQUITY' },  // HCLTECH
      };
      for (const [angelToken, dhanEntry] of Object.entries(OVERRIDES)) {
        byId.set(angelToken, dhanEntry);
      }

      // ── Lot-size canonical aliases ─────────────────────────────────────────
      // Some underlyings use a different prefix in Dhan's scrip master trading
      // symbol than the name used in DHAN_UNDERLYING_MAP and the frontend.
      // If the map already has the canonical name (from a matching row), skip.
      // If not, copy the alias entry so getLotSize('TATAMOTORS') works correctly.
      const LOT_SIZE_ALIASES = {
        // Dhan uses "TMPV-" prefix for Tata Motors options → key stored as "TMPV"
        'TATAMOTORS': 'TMPV',
      };
      for (const [canonical, alias] of Object.entries(LOT_SIZE_ALIASES)) {
        if (!underlyingLotSize.has(canonical) && underlyingLotSize.has(alias)) {
          underlyingLotSize.set(canonical, underlyingLotSize.get(alias));
        }
      }
      // ZOMATO: not found in current scrip master snapshot. Will return 1 (fallback).
      // When Dhan adds ZOMATO option rows with the correct prefix, this resolves
      // automatically. No hardcoding added — fallback to 1 is the correct behaviour.

      console.log(`[DhanHist] Scrip master loaded: ${byId.size} IDs, ${bySymbol.size} symbols, ${futuresEntries.length} futures contracts, ${underlyingLotSize.size} underlying lot sizes`);
      return { byId, bySymbol, futuresEntries, underlyingLotSize, underlyingTickSize };
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
      // Match by symbol name (SM_SYMBOL_NAME) OR trading symbol prefix.
      // NOTE: NSE CDS entries have empty SM_SYMBOL_NAME — must use tradingSymbol.
      const sym = (item.symbol || '').toUpperCase();
      const tsym = (item.tradingSymbol || '').toUpperCase();
      if (sym !== target && !tsym.startsWith(target)) return false;
      // Must have a future expiry
      if (!item.expiry) return true;
      try {
        const expDate = new Date(item.expiry);
        return !isNaN(expDate.getTime()) && expDate >= now;
      } catch { return false; }
    });

    if (matches.length === 0) {
      console.warn(`[DhanHist] No future-dated contract in scrip master for ${symbol}/${segment} — scrip master may be stale`);
      return null;
    }

    // Sort by earliest expiry (nearest month = front month contract)
    matches.sort((a, b) => {
      const da = a.expiry ? new Date(a.expiry).getTime() : Infinity;
      const db = b.expiry ? new Date(b.expiry).getTime() : Infinity;
      return da - db;
    });

    console.log(`[DhanHist] Active contract for ${symbol}/${segment}: ${matches[0].securityId} (expiry: ${matches[0].expiry || 'none'})`);
    return matches[0].securityId;
  }

  /**
   * Get the nearest active NSE_FNO or BSE_FNO futures contract for an underlying.
   *
   * Works identically to getActiveContract() but targets the NSE_FNO segment
   * (index futures: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) and FUTSTK
   * (stock futures: RELIANCE, SBIN, …).
   *
   * The underlying matching uses both SM_SYMBOL_NAME (exact) and the prefix
   * of the trading symbol so both "NIFTY-AUG2026-FUT" and plain "NIFTY"
   * sources are handled.
   *
   * @param {string} underlying  - e.g. 'NIFTY', 'BANKNIFTY', 'RELIANCE', 'SENSEX'
   * @param {string} [exchange]  - 'NSE_FNO' (default) or 'BSE_FNO'
   * @returns {{ securityId: string, segment: string, instrument: string,
   *             expiry: string|null, tradingSymbol: string|null }|null}
   */
  getActiveFuturesContract(underlying, exchange = 'NSE_FNO') {
    if (!this._scripMaster?.futuresEntries) return null;

    const now   = new Date();
    const target = underlying.toUpperCase().trim();
    const seg    = exchange === 'BSE_FNO' ? 'BSE_FNO' : 'NSE_FNO';

    const matches = this._scripMaster.futuresEntries.filter(item => {
      if (item.segment !== seg) return false;

      // Match by extracted underlying name (symbol field) OR trading symbol prefix.
      const sym  = (item.symbol  || '').toUpperCase();
      const tsym = (item.tradingSymbol || '').toUpperCase();
      if (sym !== target && !tsym.startsWith(target + '-') && tsym !== target) return false;

      // Only contracts expiring in the future (or no expiry recorded → include)
      if (!item.expiry) return true;
      try {
        const exp = new Date(item.expiry);
        return !isNaN(exp.getTime()) && exp >= now;
      } catch { return false; }
    });

    if (matches.length === 0) {
      console.warn(`[DhanHist] No active ${seg} contract in scrip master for ${underlying}. Scrip master may be stale or not yet loaded.`);
      return null;
    }

    // Nearest (front-month) expiry first
    matches.sort((a, b) => {
      const da = a.expiry ? new Date(a.expiry).getTime() : Infinity;
      const db = b.expiry ? new Date(b.expiry).getTime() : Infinity;
      return da - db;
    });

    const best = matches[0];
    console.log(`[DhanHist] Active ${seg} contract: ${underlying} → ${best.securityId} tradingSymbol=${best.tradingSymbol} expiry=${best.expiry}`);
    return {
      securityId:    best.securityId,
      segment:       best.segment,
      instrument:    best.instrument,
      expiry:        best.expiry || null,
      tradingSymbol: best.tradingSymbol || null,
    };
  }

  /**
   * Search Dhan's scrip API for the nearest active contract when the local
   * scrip master is stale (no future-dated entries for a symbol).
   * Falls back to well-known static IDs for the most common MCX/CDS pairs.
   * @param {string} symbol - e.g. 'GOLD', 'USDINR'
   * @param {string} segment - 'MCX_COMM' or 'NSE_CURRENCY'
   * @returns {Promise<string|null>}
   */
  async resolveActiveContractLive(symbol, segment) {
    // 1. Try scrip master first (fast path, works when master is fresh)
    const cached = this.getActiveContract(symbol, segment);
    if (cached) return cached;

    // 2. Try the Dhan scrip search API
    try {
      const dhanSeg = segment === 'MCX_COMM' ? 'MCX' : 'CUR';
      const resp = await this._post(`https://api.dhan.co/v2/searchScrip`, {
        searchString: symbol,
        exchange: dhanSeg,
      });
      const items = resp.data?.data || [];
      // Filter to FUTCOM/FUTCUR with future expiry
      const now = new Date();
      const futures = items.filter(item => {
        if (!item.expiryDate) return false;
        const exp = new Date(item.expiryDate);
        return !isNaN(exp.getTime()) && exp >= now &&
          (item.instrumentType === 'FUTCOM' || item.instrumentType === 'FUTCUR' || item.instrumentType === 'FUT');
      });
      if (futures.length > 0) {
        // Sort by nearest expiry
        futures.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
        const id = String(futures[0].securityId || futures[0].SEM_SMST_SECURITY_ID);
        console.log(`[DhanHist] Live scrip search: ${symbol}/${segment} → ${id} (exp: ${futures[0].expiryDate})`);
        return id;
      }
    } catch (err) {
      console.warn(`[DhanHist] Live scrip search failed for ${symbol}/${segment}: ${err.message}`);
    }

    // 3. Last resort: well-known static IDs verified against Dhan API Aug 2026.
    // MCX IDs come from live scrip master (current front-month contracts).
    // CDS IDs confirmed by probing /api/market/history against each candidate —
    // Dhan's CDS data availability lags behind the current month; these are the
    // newest contract IDs that actually return candles as of Aug 2026.
    const STATIC_IDS = {
      // MCX — verified from live scrip master Aug 2026
      'GOLD:MCX_COMM':        '483079', // GOLD-05Oct2026-FUT
      'SILVER:MCX_COMM':      '471725', // SILVER-04Sep2026-FUT
      'CRUDEOIL:MCX_COMM':    '565899', // CRUDEOIL-21Sep2026-FUT
      'NATURALGAS:MCX_COMM':  '568245', // NATURALGAS-25Sep2026-FUT
      'COPPER:MCX_COMM':      '568831', // COPPER-31Aug2026-FUT
      'GOLDM:MCX_COMM':       '563946', // GOLDM-04Sep2026-FUT
      'SILVERM:MCX_COMM':     '471726', // SILVERM-31Aug2026-FUT
      // CDS — confirmed working via Dhan API probe Aug 2026
      // Dhan serves historical data for these; newer contracts have no data yet.
      'USDINR:NSE_CURRENCY':  '1196',   // USDINR-Apr2026-FUT  (confirmed 225 candles)
      'EURINR:NSE_CURRENCY':  '3150',   // EURINR-May2026-FUT  (confirmed 218 candles)
      'GBPINR:NSE_CURRENCY':  '1162',   // GBPINR-Apr2026-FUT  (confirmed 221 candles)
      'JPYINR:NSE_CURRENCY':  '6600',   // JPYINR-Jun2026-FUT  (confirmed 145 candles)
    };
    const key = `${symbol.toUpperCase()}:${segment}`;
    if (STATIC_IDS[key]) {
      console.warn(`[DhanHist] Using static fallback ID for ${key}: ${STATIC_IDS[key]} — update when contract expires`);
      return STATIC_IDS[key];
    }

    return null;
  }

  // (CSV parsing handled inline in _loadScripMaster)

  /**
   * Get the NSE/BSE exchange-mandated lot size for an option underlying.
   *
   * Sources the value from the Dhan scrip master (SEM_LOT_UNITS column),
   * which is the authoritative source for all exchange lot sizes.
   *
   * @param {string} symbol - e.g. 'RELIANCE', 'NIFTY', 'BANKNIFTY', 'SENSEX'
   * @returns {number} lot size, or 1 if the scrip master is not loaded yet
   *                   or the symbol is not found in it.
   *
   * NOTE: Returns 1 (not null) so that callers that use `lotSize || 1`
   * continue to work safely during the short window before the scrip
   * master has been downloaded at server startup.
   */
  getLotSize(symbol) {
    if (!this._scripMaster?.underlyingLotSize) return 1;
    const key = String(symbol || '').toUpperCase().trim();
    return this._scripMaster.underlyingLotSize.get(key) || 1;
  }

  /**
   * Get the exchange-mandated tick size for a futures underlying.
   * Sourced from SEM_TICK_SIZE in the Dhan scrip master.
   *
   * @param {string} symbol - e.g. 'NIFTY', 'BANKNIFTY', 'RELIANCE', 'GOLD'
   * @returns {number} tick size, or 0.05 as a safe NSE_FNO default if not found.
   */
  getTickSize(symbol) {
    if (!this._scripMaster?.underlyingTickSize) return 0.05;
    const key = String(symbol || '').toUpperCase().trim();
    return this._scripMaster.underlyingTickSize.get(key) || 0.05;
  }

  // ─── Response parser ─────────────────────────────────────────────────────

  _parse(data) {
    const raw = data?.data || data;
    if (!raw || typeof raw !== 'object') return [];

    // ── Format A: parallel arrays (standard Dhan format) ─────────────────
    // { timestamp: [...], open: [...], high: [...], low: [...], close: [...], volume: [...] }
    const timestamps = raw?.timestamp || raw?.start_Time || raw?.timestamps || null;
    if (Array.isArray(timestamps) && timestamps.length > 0) {
      const opens = raw?.open || [];
      const highs = raw?.high || [];
      const lows = raw?.low || [];
      const closes = raw?.close || [];
      const volumes = raw?.volume || [];

      const candles = [];
      for (let i = 0; i < timestamps.length; i++) {
        const time = this._normalizeTs(timestamps[i]);
        const o = parseFloat(opens[i]) || 0;
        const h = parseFloat(highs[i]) || 0;
        const l = parseFloat(lows[i]) || 0;
        const c = parseFloat(closes[i]) || 0;
        const v = parseInt(volumes[i]) || 0;

        if (time <= 0 || c <= 0 || isNaN(time) || isNaN(c)) continue;
        // Fix degenerate OHLC (Dhan sometimes sends h=0 or l=0 for indices)
        const fixedH = h > 0 ? h : Math.max(o || c, c);
        const fixedL = l > 0 ? l : Math.min(o || c, c);
        const fixedO = o > 0 ? o : c;
        candles.push({ time, open: fixedO, high: fixedH, low: fixedL, close: c, volume: v });
      }
      return candles;
    }

    // ── Format B: array of row objects ────────────────────────────────────
    // [{ time, open, high, low, close, volume }, ...] or [{ start_Time, ... }]
    if (Array.isArray(raw)) {
      const candles = [];
      for (const bar of raw) {
        const time = this._normalizeTs(bar?.time || bar?.start_Time || bar?.timestamp || bar?.[0]);
        const o = parseFloat(bar?.open ?? bar?.[1]) || 0;
        const h = parseFloat(bar?.high ?? bar?.[2]) || 0;
        const l = parseFloat(bar?.low  ?? bar?.[3]) || 0;
        const c = parseFloat(bar?.close ?? bar?.[4]) || 0;
        const v = parseInt(bar?.volume ?? bar?.[5]) || 0;
        if (time <= 0 || c <= 0 || isNaN(time)) continue;
        const fixedH = h > 0 ? h : Math.max(o || c, c);
        const fixedL = l > 0 ? l : Math.min(o || c, c);
        const fixedO = o > 0 ? o : c;
        candles.push({ time, open: fixedO, high: fixedH, low: fixedL, close: c, volume: v });
      }
      return candles;
    }

    return [];
  }

  _normalizeTs(ts) {
    if (typeof ts === 'number') return ts > 9_999_999_999 ? Math.floor(ts / 1000) : ts;
    if (typeof ts === 'string') {
      // ISO string: "2026-08-19T09:15:00" or "2026-08-19 09:15:00"
      const ms = new Date(ts).getTime();
      return isNaN(ms) ? 0 : Math.floor(ms / 1000);
    }
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
