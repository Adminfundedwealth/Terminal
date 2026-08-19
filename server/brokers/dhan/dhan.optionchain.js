/**
 * DHAN OPTION CHAIN SERVICE
 *
 * Retrieves option chain data from Dhan API v2.
 *
 * Endpoints:
 *   POST /v2/optionchain/expirylist  — Get available expiry dates
 *   POST /v2/optionchain             — Get full option chain with Greeks
 *
 * Key findings from live API testing:
 *   - ExpiryList: needs UnderlyingScrip (int), UnderlyingSeg ('IDX_I' | 'NSE_EQ')
 *   - ExpiryList returns: { data: ["2026-08-18", "2026-08-25", ...], status: "success" }
 *   - Headers MUST include: access-token, client-id, dhanClientId
 *   - OptionChain endpoint returns 400 "Invalid Expiry Date" on YYYY-MM-DD format
 *     but ExpiryList returns YYYY-MM-DD — possible API bug or market hours restriction
 *
 * Security ID mapping:
 *   Indices (IDX_I):  NIFTY=13, BANKNIFTY=25, FINNIFTY=27, MIDCPNIFTY=442, SENSEX=51
 *   Stocks  (NSE_EQ): RELIANCE=2885, HDFCBANK=1333, ICICIBANK=4963, …
 */

import axios from 'axios';
import https from 'https';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

/**
 * Canonical underlying map.
 * Each entry: { scrip: <Dhan security ID>, seg: <UnderlyingSeg string> }
 *
 * Segment values:
 *   'IDX_I'  — NSE/BSE index futures & options
 *   'NSE_EQ' — NSE equity (stock) F&O
 *
 * NOTE: ADANIENT scrip is 25215 (NSE_EQ), NOT 25 (which is BANKNIFTY/IDX_I).
 */
export const DHAN_UNDERLYING_MAP = {
  // ── Indices (IDX_I) ────────────────────────────────────────────────────────
  'NIFTY':              { scrip: 13,    seg: 'IDX_I' },
  'NIFTY 50':           { scrip: 13,    seg: 'IDX_I' },
  'BANKNIFTY':          { scrip: 25,    seg: 'IDX_I' },
  'NIFTY BANK':         { scrip: 25,    seg: 'IDX_I' },
  'FINNIFTY':           { scrip: 27,    seg: 'IDX_I' },
  'NIFTY FIN SERVICE':  { scrip: 27,    seg: 'IDX_I' },
  'MIDCPNIFTY':         { scrip: 442,   seg: 'IDX_I' },
  'NIFTY MIDCAP SELECT':{ scrip: 442,   seg: 'IDX_I' },
  'SENSEX':             { scrip: 51,    seg: 'IDX_I' },

  // ── F&O Stocks (NSE_EQ) ────────────────────────────────────────────────────
  'RELIANCE':           { scrip: 2885,  seg: 'NSE_EQ' },
  'HDFCBANK':           { scrip: 1333,  seg: 'NSE_EQ' },
  'ICICIBANK':          { scrip: 4963,  seg: 'NSE_EQ' },
  'SBIN':               { scrip: 3045,  seg: 'NSE_EQ' },
  'TCS':                { scrip: 11536, seg: 'NSE_EQ' },
  'INFY':               { scrip: 1594,  seg: 'NSE_EQ' },
  'ITC':                { scrip: 1660,  seg: 'NSE_EQ' },
  'LT':                 { scrip: 11483, seg: 'NSE_EQ' },
  'AXISBANK':           { scrip: 5900,  seg: 'NSE_EQ' },
  'HCLTECH':            { scrip: 7229,  seg: 'NSE_EQ' },
  'BAJFINANCE':         { scrip: 317,   seg: 'NSE_EQ' },
  'KOTAKBANK':          { scrip: 1922,  seg: 'NSE_EQ' },
  'TATAMOTORS':         { scrip: 3456,  seg: 'NSE_EQ' },
  'TATASTEEL':          { scrip: 3499,  seg: 'NSE_EQ' },
  'MARUTI':             { scrip: 10999, seg: 'NSE_EQ' },
  'TITAN':              { scrip: 3506,  seg: 'NSE_EQ' },
  'ADANIENT':           { scrip: 25215, seg: 'NSE_EQ' }, // NOTE: 25 = BANKNIFTY (IDX_I)
  'ADANIPORTS':         { scrip: 15083, seg: 'NSE_EQ' },
  'BEL':                { scrip: 383,   seg: 'NSE_EQ' },
  'HAL':                { scrip: 2303,  seg: 'NSE_EQ' },
  'ZOMATO':             { scrip: 5097,  seg: 'NSE_EQ' },
  'DLF':                { scrip: 14732, seg: 'NSE_EQ' },
  'SUNPHARMA':          { scrip: 881,   seg: 'NSE_EQ' },
  'POWERGRID':          { scrip: 14977, seg: 'NSE_EQ' },
  'NTPC':               { scrip: 11630, seg: 'NSE_EQ' },
  'COALINDIA':          { scrip: 20374, seg: 'NSE_EQ' },
  'BHARTIARTL':         { scrip: 10604, seg: 'NSE_EQ' },
  'TIINDIA':            { scrip: 1410,  seg: 'NSE_EQ' },
  'VOLTAS':             { scrip: 3718,  seg: 'NSE_EQ' },
  'WIPRO':              { scrip: 3787,  seg: 'NSE_EQ' },
};

export class DhanOptionChainService {
  constructor(authService) {
    this.auth = authService;
    this._cache = new Map();
    this._cacheTTL = 15000; // 15s
    this._loading = new Map();
    this._marketDataEngine = null; // injected after construction for LTP enrichment
  }

  /**
   * Inject MarketDataEngine so the option chain can enrich LTPs from the
   * live quote cache when Dhan returns 0 (market closed / past expiry).
   */
  setMarketDataEngine(mde) {
    this._marketDataEngine = mde;
  }

  /**
   * Get available expiry dates for a symbol.
   * This endpoint WORKS reliably for both indices (IDX_I) and stocks (NSE_EQ).
   */
  async getExpiries(symbol) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        console.warn('[DhanOC] No valid token — returning empty expiries');
        return [];
      }
    }

    const sym = symbol.toUpperCase();
    const entry = DHAN_UNDERLYING_MAP[sym];
    if (!entry) {
      console.warn(`[DhanOC] Unknown symbol: ${sym}`);
      return [];
    }

    try {
      const resp = await axios.post(
        `${DHAN_API_BASE}/optionchain/expirylist`,
        // parseInt guard: Dhan rejects the request if UnderlyingScrip is a float or string
        { UnderlyingScrip: parseInt(entry.scrip, 10), UnderlyingSeg: entry.seg },
        { httpsAgent: IPV4_AGENT, timeout: 8000, headers: this.auth.getHeaders() }
      );

      const data = resp.data?.data;
      if (Array.isArray(data) && data.length > 0) {
        console.log(`[DhanOC] Expiries for ${sym}: ${data.length} dates`);
        return data; // Already ISO YYYY-MM-DD strings
      }
      return [];
    } catch (err) {
      console.error(`[DhanOC] getExpiries error for ${sym}:`, err.response?.data || err.message);
      return [];
    }
  }

  /**
   * Get option chain for symbol + expiry.
   * If expiry is rejected (Invalid Expiry Date), auto-fallback to next valid expiry.
   */
  async getOptionChain(symbol, expiry) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        console.warn('[DhanOC] No valid token — returning empty chain');
        return [];
      }
    }

    const sym = symbol.toUpperCase();
    const entry = DHAN_UNDERLYING_MAP[sym];
    if (!entry) {
      console.warn(`[DhanOC] Unknown symbol for chain: ${sym}`);
      return [];
    }

    const cacheKey = `${sym}:${expiry}`;
    const cached = this._cache.get(cacheKey);
    if (cached && (Date.now() - cached.loadedAt) < this._cacheTTL) {
      return cached.data;
    }

    if (this._loading.has(cacheKey)) return this._loading.get(cacheKey);

    const promise = this._fetchChainWithFallback(entry, sym, expiry)
      .then(chain => {
        this._loading.delete(cacheKey);
        if (chain.length > 0) {
          this._cache.set(cacheKey, { data: chain, loadedAt: Date.now() });
        }
        return chain;
      })
      .catch(err => {
        this._loading.delete(cacheKey);
        console.error(`[DhanOC] getOptionChain error for ${sym}/${expiry}:`, err.response?.data || err.message);
        return []; // Return empty so the route falls back to Angel One
      });

    this._loading.set(cacheKey, promise);
    return promise;
  }

  /**
   * Fetch chain with auto-fallback: if the requested expiry is rejected,
   * try the next available expiry from the expiry list.
   * After parsing, enrich any zero-LTP entries from the MarketDataEngine
   * live quote cache (handles market-closed / post-expiry scenarios).
   */
  async _fetchChainWithFallback(entry, symbol, expiry) {
    let chain = [];
    try {
      chain = await this._fetchChain(entry, symbol, expiry);
    } catch (err) {
      const errMsg = JSON.stringify(err.response?.data || '');
      const isInvalidExpiry = errMsg.includes('811') || errMsg.includes('Invalid Expiry');

      if (isInvalidExpiry) {
        console.warn(`[DhanOC] Expiry "${expiry}" rejected for ${symbol} — auto-resolving next valid expiry`);
        try {
          const expiries = await this.getExpiries(symbol);
          if (expiries && expiries.length > 0) {
            const today = new Date().toISOString().slice(0, 10);
            const validExpiry = expiries.find(e => e > today) || expiries[0];

            if (validExpiry && validExpiry !== expiry) {
              console.log(`[DhanOC] Retrying with fallback expiry: ${validExpiry}`);
              await new Promise(r => setTimeout(r, 3500));
              chain = await this._fetchChain(entry, symbol, validExpiry);
            }
          }
        } catch (fallbackErr) {
          console.error(`[DhanOC] Fallback expiry resolution failed:`, fallbackErr.message);
        }
      }
      if (chain.length === 0) throw err;
    }

    // ── Enrich LTPs from MarketDataEngine quote cache ──────────────────────
    // Dhan REST returns last_price=0 after market close and for expired contracts.
    // If the chain has valid security IDs (callToken/putToken), look them up in
    // the live quote cache so the UI shows real prices instead of all-zero.
    if (chain.length > 0 && this._marketDataEngine) {
      const zeroLtpEntries = chain.filter(e => e.callLtp === 0 || e.putLtp === 0);
      if (zeroLtpEntries.length > 0) {
        let enriched = 0;
        for (const entry of chain) {
          if (entry.callLtp === 0 && entry.callToken) {
            const q = this._marketDataEngine.getQuote(entry.callToken);
            if (q?.ltp > 0) { entry.callLtp = q.ltp; enriched++; }
          }
          if (entry.putLtp === 0 && entry.putToken) {
            const q = this._marketDataEngine.getQuote(entry.putToken);
            if (q?.ltp > 0) { entry.putLtp = q.ltp; enriched++; }
          }
        }
        if (enriched > 0) {
          console.log(`[DhanOC] Enriched ${enriched} zero-LTP entries from MarketDataEngine cache`);
        }
      }
    }

    return chain;
  }

  async _fetchChain(entry, symbol, expiry) {
    // Dhan requires exact key "Expiry" (capital E, not Expirydate)
    const normalizedExpiry = this._normalizeExpiry(expiry);

    const payload = {
      // parseInt guard: Dhan v2 API rejects UnderlyingScrip if it arrives as a float/string
      UnderlyingScrip: parseInt(entry.scrip, 10),
      UnderlyingSeg: entry.seg,
      Expiry: normalizedExpiry,
    };

    console.log(`[DhanOC] Fetching chain: ${symbol} seg=${entry.seg} Expiry=${normalizedExpiry}`);

    // Retry with backoff on 429 (Dhan rate limit: 1 unique req per 3s)
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await axios.post(`${DHAN_API_BASE}/optionchain`, payload, {
          httpsAgent: IPV4_AGENT,
          timeout: 12000,
          // Use auth.getHeaders() so it always reads the freshest token from process.env
          headers: this.auth.getHeaders(),
        });

        const data = resp.data?.data || resp.data;
        if (Array.isArray(data) && data.length > 0) {
          console.log(`[DhanOC] Got ${data.length} strikes for ${symbol}/${normalizedExpiry}`);
          return this._parseChain(data);
        }
        // Check if response has 'oc' key (alternative Dhan format)
        if (data && typeof data === 'object' && data.oc) {
          const parsed = this._parseOCMap(data);
          console.log(`[DhanOC] Got ${parsed.length} strikes (oc map) for ${symbol}/${normalizedExpiry}`);
          return parsed;
        }
        return [];
      } catch (err) {
        const status = err.response?.status;
        if (status === 429 && attempt < MAX_RETRIES) {
          // Rate limited — wait and retry
          const delay = 3500 * (attempt + 1); // 3.5s, 7s
          console.warn(`[DhanOC] Rate limited (429), retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        const msg = err.response?.data;
        console.error(`[DhanOC] Chain failed: HTTP ${status}`, JSON.stringify(msg).slice(0, 150));
        throw err;
      }
    }
    return [];
  }

  /**
   * Parse Dhan 'oc' map format: { oc: { "24000": { ce: {...}, pe: {...} }, ... } }
   *
   * Field resolution order (most-specific first, then fallbacks):
   *   token:     security_id → securityId → token
   *   symbol:    tradingSymbol → trading_symbol
   *   ltp:       last_price → ltp
   *   oi_change: computed from (oi - previous_oi) if present, else oi_change field
   *   greeks:    nested greeks object (greeks.delta) first, then flat (delta) fallback
   */
  _parseOCMap(data) {
    const oc = data.oc || {};
    const chain = [];
    for (const [strikeStr, sides] of Object.entries(oc)) {
      const strike = parseFloat(strikeStr);
      if (!strike) continue;
      const ce = sides.ce || {};
      const pe = sides.pe || {};

      // OI change: prefer computed delta over stale oi_change field
      const ceOiChange = ce.previous_oi != null
        ? parseInt(ce.oi || 0) - parseInt(ce.previous_oi || 0)
        : parseInt(ce.oi_change || 0);
      const peOiChange = pe.previous_oi != null
        ? parseInt(pe.oi || 0) - parseInt(pe.previous_oi || 0)
        : parseInt(pe.oi_change || 0);

      chain.push({
        strike,
        // ── Call side ──────────────────────────────────────────────────────
        callToken:    String(ce.security_id  || ce.securityId  || ce.token || ''),
        callSymbol:   ce.tradingSymbol || ce.trading_symbol || '',
        callLtp:      parseFloat(ce.last_price || ce.ltp || 0),
        callVolume:   parseInt(ce.volume || 0),
        callOi:       parseInt(ce.oi || ce.open_interest || 0),
        callOiChange: ceOiChange,
        callBidPrice: parseFloat(ce.bid || ce.bid_price || 0),
        callAskPrice: parseFloat(ce.ask || ce.ask_price || 0),
        callIv:       parseFloat(ce.implied_volatility || ce.iv || 0),
        // greeks nested object first, then flat fields (Dhan returns both shapes)
        callDelta:    parseFloat(ce.greeks?.delta  ?? ce.delta  ?? 0),
        callGamma:    parseFloat(ce.greeks?.gamma  ?? ce.gamma  ?? 0),
        callTheta:    parseFloat(ce.greeks?.theta  ?? ce.theta  ?? 0),
        callVega:     parseFloat(ce.greeks?.vega   ?? ce.vega   ?? 0),
        // ── Put side ───────────────────────────────────────────────────────
        putToken:    String(pe.security_id  || pe.securityId  || pe.token || ''),
        putSymbol:   pe.tradingSymbol || pe.trading_symbol || '',
        putLtp:      parseFloat(pe.last_price || pe.ltp || 0),
        putVolume:   parseInt(pe.volume || 0),
        putOi:       parseInt(pe.oi || pe.open_interest || 0),
        putOiChange: peOiChange,
        putBidPrice: parseFloat(pe.bid || pe.bid_price || 0),
        putAskPrice: parseFloat(pe.ask || pe.ask_price || 0),
        putIv:       parseFloat(pe.implied_volatility || pe.iv || 0),
        putDelta:    parseFloat(pe.greeks?.delta  ?? pe.delta  ?? 0),
        putGamma:    parseFloat(pe.greeks?.gamma  ?? pe.gamma  ?? 0),
        putTheta:    parseFloat(pe.greeks?.theta  ?? pe.theta  ?? 0),
        putVega:     parseFloat(pe.greeks?.vega   ?? pe.vega   ?? 0),
      });
    }
    chain.sort((a, b) => a.strike - b.strike);
    return chain;
  }

  /**
   * Normalize expiry to YYYY-MM-DD format.
   */
  _normalizeExpiry(expiry) {
    if (!expiry) return '';
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return expiry;
    // DDMMMYY (Angel format) e.g. 25AUG26
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const m = expiry.match(/^(\d{2})([A-Z]{3})(\d{2})$/i);
    if (m) {
      const dd = m[1];
      const mon = m[2].toUpperCase();
      const yy = parseInt(m[3]);
      const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
      const mm = String(MONTHS.indexOf(mon) + 1).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    // DD-MM-YYYY
    const dm = expiry.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dm) return `${dm[3]}-${dm[2]}-${dm[1]}`;
    // Try parsing as date
    const d = new Date(expiry);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return expiry;
  }

  /**
   * Parse Dhan option chain response into our standard format.
   */
  _parseChain(data) {
    const chain = [];
    for (const item of data) {
      const strike = parseFloat(
        item.strikePrice || item.strike_price || item.StrikePrice || 0
      );
      if (!strike) continue;

      chain.push({
        strike,
        // Call
        callToken: String(item.ce_security_id || item.CE_SecurityId || ''),
        callSymbol: item.ce_tradingsymbol || item.CE_Symbol || '',
        callLtp: parseFloat(item.ce_ltp || item.CE_LTP || 0),
        callVolume: parseInt(item.ce_volume || item.CE_Volume || 0),
        callOi: parseInt(item.ce_oi || item.CE_OI || 0),
        callOiChange: parseInt(item.ce_oi_change || item.CE_OIChange || 0),
        callBidPrice: parseFloat(item.ce_bid || item.CE_BidPrice || 0),
        callAskPrice: parseFloat(item.ce_ask || item.CE_AskPrice || 0),
        callIv: parseFloat(item.ce_iv || item.CE_IV || 0),
        callDelta: parseFloat(item.ce_delta || item.CE_Delta || 0),
        callGamma: parseFloat(item.ce_gamma || item.CE_Gamma || 0),
        callTheta: parseFloat(item.ce_theta || item.CE_Theta || 0),
        callVega: parseFloat(item.ce_vega || item.CE_Vega || 0),
        // Put
        putToken: String(item.pe_security_id || item.PE_SecurityId || ''),
        putSymbol: item.pe_tradingsymbol || item.PE_Symbol || '',
        putLtp: parseFloat(item.pe_ltp || item.PE_LTP || 0),
        putVolume: parseInt(item.pe_volume || item.PE_Volume || 0),
        putOi: parseInt(item.pe_oi || item.PE_OI || 0),
        putOiChange: parseInt(item.pe_oi_change || item.PE_OIChange || 0),
        putBidPrice: parseFloat(item.pe_bid || item.PE_BidPrice || 0),
        putAskPrice: parseFloat(item.pe_ask || item.PE_AskPrice || 0),
        putIv: parseFloat(item.pe_iv || item.PE_IV || 0),
        putDelta: parseFloat(item.pe_delta || item.PE_Delta || 0),
        putGamma: parseFloat(item.pe_gamma || item.PE_Gamma || 0),
        putTheta: parseFloat(item.pe_theta || item.PE_Theta || 0),
        putVega: parseFloat(item.pe_vega || item.PE_Vega || 0),
      });
    }
    chain.sort((a, b) => a.strike - b.strike);
    return chain;
  }
}
