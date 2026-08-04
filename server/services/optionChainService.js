/**
 * OPTION CHAIN SERVICE  —  v2 (Instrument Master approach)
 *
 * Permanent fix for "Too many requests" and empty chain issues.
 *
 * Strategy:
 *   1. Download Angel One's public instrument master JSON once per day
 *      (no auth required). This gives every NFO token locally.
 *   2. Filter locally by symbol + expiry → no searchScrip API call at all.
 *   3. Batch-quote the tokens in groups of 50 with 250 ms gaps between
 *      batches so Angel One's rate limit is never hit.
 *   4. Fall back to searchScrip only if the master download fails.
 *
 * The instrument master is refreshed:
 *   • On first call of the day
 *   • After 6 hours (TTL)
 *   • Manually via refreshInstrumentMaster()
 */

import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';

config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
// Angel One public instrument master — no auth needed
const INSTRUMENT_MASTER_URL =
  'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';

const IPV4_AGENT = new https.Agent({ family: 4 });

// How long to keep the instrument master in memory (6 hours)
const MASTER_TTL_MS = 6 * 60 * 60 * 1000;

export class OptionChainService {
  constructor() {
    this.jwtToken = null;
    this._refreshCallback = null;

    // Instrument master cache
    this._masterInstruments = null;   // full array after download
    this._masterLoadedAt = 0;         // epoch ms of last successful load
    this._masterLoading = null;       // Promise while loading (prevents concurrent fetches)

    // Per-symbol:expiry instrument list (built from master, cached 10 min)
    this._instrumentCache = new Map();
  }

  setAuthToken(token) {
    this.jwtToken = token;
  }

  setRefreshCallback(fn) {
    this._refreshCallback = fn;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Get live option chain for an underlying.
   * @param {string} symbol   e.g. "NIFTY", "BANKNIFTY"
   * @param {string} expiry   ISO date "2026-08-05" or Angel fmt "05AUG26"
   * @returns {Promise<Array>}
   */
  async getOptionChain(symbol, expiry) {
    // Ensure we have a fresh JWT
    if (!this.jwtToken && this._refreshCallback) {
      try { this.jwtToken = await this._refreshCallback(); } catch (_) {}
    }
    if (!this.jwtToken) {
      console.log('[OptionChain] No JWT token — cannot quote');
      return [];
    }

    const formattedExpiry = this._formatExpiry(expiry);
    console.log(`[OptionChain] Request: ${symbol} expiry=${expiry} → ${formattedExpiry}`);

    try {
      // Step 1: Get instruments from master (no API call if cached)
      const instruments = await this._getInstruments(symbol, formattedExpiry);
      console.log(`[OptionChain] Instruments found: ${instruments.length}`);
      if (instruments.length === 0) return [];

      // Step 2: Batch-quote all tokens
      const tokens = instruments.map(i => i.symboltoken);
      const quotes = await this._batchQuote(tokens);
      console.log(`[OptionChain] Quotes fetched: ${quotes.size}`);

      // Step 3: Build option chain
      const chain = this._buildChain(instruments, quotes);
      console.log(`[OptionChain] Final chain: ${chain.length} strikes`);
      return chain;
    } catch (err) {
      console.error(`[OptionChain] Failed for ${symbol}/${formattedExpiry}:`, err.message);
      return [];
    }
  }

  /** Force a fresh instrument master download (useful after market open) */
  async refreshInstrumentMaster() {
    this._masterInstruments = null;
    this._masterLoadedAt = 0;
    return this._loadMaster();
  }

  // ─── Instrument Master ───────────────────────────────────────────────────────

  /**
   * Download and cache the Angel One instrument master.
   * Returns the full array of NFO instruments.
   */
  async _loadMaster() {
    // Return cached copy if still fresh
    if (this._masterInstruments && (Date.now() - this._masterLoadedAt) < MASTER_TTL_MS) {
      return this._masterInstruments;
    }

    // Prevent concurrent downloads
    if (this._masterLoading) return this._masterLoading;

    this._masterLoading = (async () => {
      try {
        console.log('[OptionChain] Downloading instrument master...');
        const resp = await axios.get(INSTRUMENT_MASTER_URL, {
          httpsAgent: IPV4_AGENT,
          timeout: 30000,
          // The file is large (~10 MB) — stream it
          responseType: 'json',
        });

        const all = Array.isArray(resp.data) ? resp.data : [];
        // Keep only NFO options to save memory
        this._masterInstruments = all.filter(
          r => r.exch_seg === 'NFO' && (r.instrumenttype === 'OPTIDX' || r.instrumenttype === 'OPTSTK')
        );
        this._masterLoadedAt = Date.now();
        console.log(`[OptionChain] Master loaded: ${this._masterInstruments.length} NFO option instruments`);
        return this._masterInstruments;
      } catch (err) {
        console.error('[OptionChain] Master download failed:', err.message);
        // Return whatever we had before (could be stale or null)
        return this._masterInstruments || [];
      } finally {
        this._masterLoading = null;
      }
    })();

    return this._masterLoading;
  }

  /**
   * Get instruments for a specific symbol + expiry.
   * Uses instrument master first; falls back to searchScrip if master is empty.
   */
  async _getInstruments(symbol, formattedExpiry) {
    const cacheKey = `${symbol}:${formattedExpiry}`;
    if (this._instrumentCache.has(cacheKey)) {
      return this._instrumentCache.get(cacheKey);
    }

    // --- Primary: instrument master ---
    let instruments = await this._getFromMaster(symbol, formattedExpiry);

    // --- Fallback: searchScrip ---
    if (instruments.length === 0) {
      console.log(`[OptionChain] Master returned 0 for ${symbol}/${formattedExpiry} — trying searchScrip`);
      instruments = await this._findOptionInstruments(symbol, formattedExpiry);
    }

    if (instruments.length > 0) {
      // Cache for 10 minutes
      this._instrumentCache.set(cacheKey, instruments);
      setTimeout(() => this._instrumentCache.delete(cacheKey), 10 * 60 * 1000);
    }

    return instruments;
  }

  /**
   * Filter instruments from the downloaded master for a symbol + expiry.
   *
   * Angel One master fields relevant here:
   *   symbol      e.g. "NIFTY05AUG2624000CE"
   *   name        e.g. "NIFTY"
   *   expiry      e.g. "05AUG2026" or "05-AUG-2026"
   *   strike      e.g. "24000.000000" or 24000
   *   optiontype  e.g. "CE" or "PE"
   *   token       e.g. "12345678"
   *   instrumenttype e.g. "OPTIDX"
   *   exch_seg    e.g. "NFO"
   */
  async _getFromMaster(symbol, formattedExpiry) {
    // formattedExpiry is "05AUG26" (DDMMMYY).
    // Master expiry field is typically "05AUG2026" (DDMMMYYYY) — try both.
    const expiry4 = this._expandYear(formattedExpiry); // "05AUG2026"

    const master = await this._loadMaster();
    if (!master || master.length === 0) return [];

    const symUpper = symbol.toUpperCase();

    const matches = master.filter(r => {
      // Match underlying name
      const rName = (r.name || '').toUpperCase();
      if (rName !== symUpper) return false;

      // Match expiry — master stores "05AUG2026" or "05-AUG-2026"
      const rExpiry = (r.expiry || '').replace(/-/g, '').toUpperCase();
      return rExpiry === expiry4.toUpperCase() || rExpiry === formattedExpiry.toUpperCase();
    });

    if (matches.length === 0) {
      // Try matching via the trading symbol prefix as last resort
      const prefix = `${symUpper}${formattedExpiry}`;
      const bySymbol = master.filter(r => {
        const ts = (r.symbol || '').toUpperCase();
        return ts.startsWith(prefix);
      });
      if (bySymbol.length > 0) {
        console.log(`[OptionChain] Master prefix match (${prefix}): ${bySymbol.length} instruments`);
        return this._mapMasterInstruments(bySymbol, symUpper, formattedExpiry);
      }
      return [];
    }

    return this._mapMasterInstruments(matches, symUpper, formattedExpiry);
  }

  _mapMasterInstruments(rows, symbol, formattedExpiry) {
    const prefix = `${symbol}${formattedExpiry}`;
    return rows
      .map(r => {
        const ts = (r.symbol || r.tradingsymbol || '').toUpperCase();
        // Parse strike + option type from the trading symbol
        let strike = null;
        let optionType = null;

        // Try direct fields first (master usually has these)
        if (r.strike !== undefined && r.optiontype) {
          strike = parseFloat(r.strike) || parseInt(r.strike);
          optionType = r.optiontype.toUpperCase();
        } else {
          // Fallback: parse from symbol "NIFTY05AUG2624000CE"
          let suffix = ts;
          if (ts.startsWith(prefix)) suffix = ts.slice(prefix.length);
          const m = suffix.match(/^(\d+(?:\.\d+)?)(CE|PE)$/);
          if (!m) return null;
          strike = parseFloat(m[1]);
          optionType = m[2];
        }

        if (!strike || !optionType) return null;

        return {
          symboltoken: String(r.token),
          tradingsymbol: ts,
          strike: Math.round(strike), // normalise e.g. 24000.0 → 24000
          optionType,
        };
      })
      .filter(Boolean);
  }

  // ─── searchScrip Fallback ─────────────────────────────────────────────────

  async _findOptionInstruments(symbol, expiry) {
    const searchTerm = `${symbol}${expiry}`;
    console.log(`[OptionChain] searchScrip: exchange=NFO, searchscrip="${searchTerm}"`);

    const makeRequest = async () =>
      axios.post(
        `${ANGEL_API_BASE}/rest/secure/angelbroking/order/v1/searchScrip`,
        { exchange: 'NFO', searchscrip: searchTerm },
        { httpsAgent: IPV4_AGENT, timeout: 10000, headers: this._headers() }
      );

    let resp;
    try {
      resp = await makeRequest();
    } catch (err) {
      if ((err.response?.status === 403 || err.response?.status === 401) && this._refreshCallback) {
        console.log(`[OptionChain] ${err.response.status} — refreshing token`);
        try {
          this.jwtToken = await this._refreshCallback();
          resp = await makeRequest();
        } catch (retryErr) {
          console.error('[OptionChain] Retry failed:', retryErr.response?.data?.message || retryErr.message);
          return [];
        }
      } else {
        throw err;
      }
    }

    let instrumentsRaw = [];
    if (Array.isArray(resp.data?.data)) {
      instrumentsRaw = resp.data.data;
    } else if (resp.data?.data && typeof resp.data.data === 'object') {
      for (const key of Object.keys(resp.data.data)) {
        if (Array.isArray(resp.data.data[key])) {
          instrumentsRaw = instrumentsRaw.concat(resp.data.data[key]);
        }
      }
    }

    if (instrumentsRaw.length === 0) {
      console.log(`[OptionChain] searchScrip: no instruments (status=${resp.data?.status}, msg=${resp.data?.message})`);
      return [];
    }
    console.log(`[OptionChain] searchScrip: ${instrumentsRaw.length} instruments`);

    return instrumentsRaw.map(inst => {
      const ts = inst.tradingsymbol || '';
      let suffix = ts;
      if (ts.startsWith(searchTerm)) suffix = ts.slice(searchTerm.length);
      const m = suffix.match(/^(\d+)(CE|PE)$/);
      if (!m) return null;
      return {
        symboltoken: inst.symboltoken,
        tradingsymbol: ts,
        strike: parseInt(m[1]),
        optionType: m[2],
      };
    }).filter(Boolean);
  }

  // ─── Batch Quote ──────────────────────────────────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Batch-quote option tokens via Angel One quote API.
   * 50 tokens per request, 250 ms gap between batches.
   */
  async _batchQuote(tokens) {
    const quotes = new Map();
    const batchSize = 50;

    for (let i = 0; i < tokens.length; i += batchSize) {
      if (i > 0) await this._sleep(250);
      const batch = tokens.slice(i, i + batchSize);

      const makeRequest = async () =>
        axios.post(
          `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/quote/`,
          { mode: 'FULL', exchangeTokens: { NFO: batch } },
          { httpsAgent: IPV4_AGENT, timeout: 10000, headers: this._headers() }
        );

      try {
        let resp;
        try {
          resp = await makeRequest();
        } catch (err) {
          if ((err.response?.status === 403 || err.response?.status === 401) && this._refreshCallback) {
            this.jwtToken = await this._refreshCallback();
            resp = await makeRequest();
          } else {
            throw err;
          }
        }

        const fetched = resp.data?.data?.fetched || [];
        for (const q of fetched) {
          const key = String(q.symbolToken || q.symboltoken || '');
          quotes.set(key, {
            ltp: q.ltp || 0,
            volume: q.tradeVolume || 0,
            oi: q.opnInterest || 0,
            totalBuyQty: q.totBuyQuan || 0,
            totalSellQty: q.totSellQuan || 0,
            bidPrice: q.depth?.buy?.[0]?.price || 0,
            bidQty: q.depth?.buy?.[0]?.quantity || 0,
            askPrice: q.depth?.sell?.[0]?.price || 0,
            askQty: q.depth?.sell?.[0]?.quantity || 0,
          });
        }
      } catch (err) {
        console.error(`[OptionChain] Batch quote failed:`, err.response?.data?.message || err.message);
      }
    }

    return quotes;
  }

  // ─── Chain Builder ────────────────────────────────────────────────────────

  _buildChain(instruments, quotes) {
    const strikeMap = new Map();

    for (const inst of instruments) {
      if (!strikeMap.has(inst.strike)) {
        strikeMap.set(inst.strike, { strike: inst.strike });
      }
      const entry = strikeMap.get(inst.strike);
      // Quote map key may be uppercase or lowercase — try both
      const q = quotes.get(inst.symboltoken)
              || quotes.get(inst.symboltoken.toUpperCase?.())
              || {};

      if (inst.optionType === 'CE') {
        entry.callToken = inst.symboltoken;
        entry.callSymbol = inst.tradingsymbol;
        entry.callLtp = q.ltp || 0;
        entry.callVolume = q.volume || 0;
        entry.callOi = q.oi || 0;
        entry.callBidQty = q.totalBuyQty || 0;
        entry.callAskQty = q.totalSellQty || 0;
        entry.callBidPrice = q.bidPrice || 0;
        entry.callAskPrice = q.askPrice || 0;
      } else {
        entry.putToken = inst.symboltoken;
        entry.putSymbol = inst.tradingsymbol;
        entry.putLtp = q.ltp || 0;
        entry.putVolume = q.volume || 0;
        entry.putOi = q.oi || 0;
        entry.putBidQty = q.totalBuyQty || 0;
        entry.putAskQty = q.totalSellQty || 0;
        entry.putBidPrice = q.bidPrice || 0;
        entry.putAskPrice = q.askPrice || 0;
      }
    }

    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }

  // ─── Expiry Formatting ────────────────────────────────────────────────────

  /**
   * Convert any expiry format → "DDMMMYY" (Angel One searchScrip / trading symbol format)
   * e.g. "2026-08-05" → "05AUG26"
   *      "05AUG26"    → "05AUG26" (pass-through)
   *      "05AUG2026"  → "05AUG26"
   */
  _formatExpiry(expiry) {
    if (!expiry) return '';
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    // Already DDMMMYY
    if (/^\d{2}[A-Z]{3}\d{2}$/.test(expiry)) return expiry;

    // DDMMMYYYY → DDMMMYY
    const m4 = expiry.match(/^(\d{2})([A-Z]{3})(\d{4})$/i);
    if (m4) return `${m4[1]}${m4[2].toUpperCase()}${m4[3].slice(-2)}`;

    // ISO: YYYY-MM-DD
    const iso = expiry.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const dd = iso[3].padStart(2, '0');
      const mmm = MONTHS[parseInt(iso[2], 10) - 1];
      const yy = iso[1].slice(-2);
      return `${dd}${mmm}${yy}`;
    }

    // Last-resort generic parse
    const d = new Date(expiry);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      return `${dd}${MONTHS[d.getMonth()]}${String(d.getFullYear()).slice(-2)}`;
    }

    console.warn(`[OptionChain] Cannot parse expiry: ${expiry}`);
    return expiry;
  }

  /**
   * Expand DDMMMYY → DDMMMYYYY for matching master expiry field.
   * "05AUG26" → "05AUG2026"
   */
  _expandYear(ddmmmyy) {
    const m = ddmmmyy.match(/^(\d{2})([A-Z]{3})(\d{2})$/i);
    if (!m) return ddmmmyy;
    const century = parseInt(m[3], 10) >= 50 ? '19' : '20';
    return `${m[1]}${m[2].toUpperCase()}${century}${m[3]}`;
  }

  // ─── Auth Headers ─────────────────────────────────────────────────────────

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY,
      'Authorization': `Bearer ${this.jwtToken}`,
    };
  }
}
