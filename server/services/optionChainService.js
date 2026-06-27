/**
 * OPTION CHAIN SERVICE
 * 
 * Builds a live option chain for an underlying (NIFTY, BANKNIFTY, etc.)
 * by searching for option instruments and batch-quoting them.
 * 
 * Flow:
 *   1. searchScrip() → find option tokens for underlying+expiry
 *   2. Batch quote (FULL mode) → get LTP, OI, volume, depth for each strike
 *   3. Group by strike → return CE/PE pairs
 * 
 * NO generated strikes. NO mock OI. NO Math.random.
 * Returns empty if broker API fails.
 */

import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';

config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
const IPV4_AGENT = new https.Agent({ family: 4 });

export class OptionChainService {
  constructor() {
    this.jwtToken = null;
    this._refreshCallback = null;
    this._instrumentCache = new Map(); // `${symbol}:${expiry}` → instruments[]
  }

  setAuthToken(token) {
    this.jwtToken = token;
  }

  /**
   * Set a callback that returns a fresh JWT when the current one is expired.
   * @param {function} fn - async function returning fresh JWT string
   */
  setRefreshCallback(fn) {
    this._refreshCallback = fn;
  }

  /**
   * Get live option chain for underlying.
   * @param {string} symbol - e.g. "NIFTY", "BANKNIFTY"
   * @param {string} expiry - e.g. "25JUN30" (Angel format: DDMMMYY of expiry)
   * @returns {Array} [{strike, callLtp, callOi, callVolume, callBidQty, callAskQty, putLtp, putOi, putVolume, putBidQty, putAskQty}]
   */
  async getOptionChain(symbol, expiry) {
    if (!this.jwtToken) {
      if (this._refreshCallback) {
        try { this.jwtToken = await this._refreshCallback(); } catch (e) { /* ignore */ }
      }
      if (!this.jwtToken) {
        console.log(`[OptionChain] No JWT token available`);
        return [];
      }
    }

    // Convert expiry to Angel One format (DDMMMYY)
    const formattedExpiry = this._formatExpiry(expiry);
    console.log(`[OptionChain] Expiry received: "${expiry}" → formatted: "${formattedExpiry}"`);

    try {
      // Step 1: Find option instruments
      const instruments = await this._findOptionInstruments(symbol, formattedExpiry);
      console.log(`[OptionChain] Instruments found: ${instruments ? instruments.length : 0}`);
      if (!instruments || instruments.length === 0) return [];

      // Step 2: Get quotes for all option tokens (batch max ~50 per call)
      const tokens = instruments.map(i => i.symboltoken);
      const quotes = await this._batchQuote(tokens);
      console.log(`[OptionChain] Quotes fetched: ${quotes.size}`);

      // Step 3: Build option chain grouped by strike
      const chain = this._buildChain(instruments, quotes);
      console.log(`[OptionChain] Final chain: ${chain.length} strikes`);
      return chain;
    } catch (err) {
      console.error(`[OptionChain] Failed for ${symbol}/${formattedExpiry}:`, err.message);
      return [];
    }
  }

  /**
   * Convert expiry to Angel One's search format: {DD}{MMM}{YY}
   * Angel One searchScrip expects: NIFTY25JUN26 (for expiry 25-Jun-2026)
   * Trading symbols are: NIFTY25JUN2624000CE
   * 
   * Accepts ISO date (2026-06-25) or already-formatted (25JUN26).
   * @param {string} expiry
   * @returns {string} Formatted expiry e.g. "25JUN26"
   */
  _formatExpiry(expiry) {
    // If already in Angel format DD+MMM+YY (e.g. "25JUN26"), pass through
    if (/^\d{2}[A-Z]{3}\d{2}$/.test(expiry)) return expiry;

    // Parse ISO date: "2026-06-25" or "2026-06-25T00:00:00"
    const date = new Date(expiry);
    if (isNaN(date.getTime())) {
      console.warn(`[OptionChain] Invalid expiry format: ${expiry}`);
      return expiry; // Pass through and let API fail naturally
    }

    const dd = String(date.getDate()).padStart(2, '0');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const mmm = months[date.getMonth()];
    const yy = String(date.getFullYear()).slice(-2);
    return `${dd}${mmm}${yy}`;
  }

  /**
   * Search for option instruments matching underlying+expiry.
   */
  async _findOptionInstruments(symbol, expiry) {
    const cacheKey = `${symbol}:${expiry}`;
    if (this._instrumentCache.has(cacheKey)) {
      return this._instrumentCache.get(cacheKey);
    }

    // Angel One searchScrip format: "NIFTY25JUN26" finds all NIFTY options for 25-Jun-2026 expiry
    const searchTerm = `${symbol}${expiry}`;
    console.log(`[OptionChain] searchScrip request: exchange=NFO, searchscrip="${searchTerm}"`);

    const makeRequest = async () => {
      return axios.post(
        `${ANGEL_API_BASE}/rest/secure/angelbroking/order/v1/searchScrip`,
        { exchange: 'NFO', searchscrip: searchTerm },
        { httpsAgent: IPV4_AGENT, timeout: 10000, headers: this._headers() }
      );
    };

    let resp;
    try {
      resp = await makeRequest();
    } catch (err) {
      if ((err.response?.status === 403 || err.response?.status === 401) && this._refreshCallback) {
        console.log(`[OptionChain] Got ${err.response.status} — refreshing token and retrying`);
        try {
          this.jwtToken = await this._refreshCallback();
          resp = await makeRequest();
        } catch (retryErr) {
          console.error(`[OptionChain] Retry failed for ${searchTerm}:`, retryErr.response?.data?.message || retryErr.message);
          return [];
        }
      } else {
        throw err;
      }
    }

    // Angel One searchScrip can return data as an array OR as an object with arrays inside
    let instrumentsRaw = [];
    if (Array.isArray(resp.data?.data)) {
      instrumentsRaw = resp.data.data;
    } else if (resp.data?.data && typeof resp.data.data === 'object') {
      // Try common patterns: resp.data.data might be { NFO: [...] } or have a nested array
      for (const key of Object.keys(resp.data.data)) {
        if (Array.isArray(resp.data.data[key])) {
          instrumentsRaw = instrumentsRaw.concat(resp.data.data[key]);
        }
      }
    }
    
    if (instrumentsRaw.length === 0) {
      console.log(`[OptionChain] searchScrip response: no instruments found (status=${resp.data?.status}, message=${resp.data?.message})`);
      return [];
    }
    console.log(`[OptionChain] searchScrip response count: ${instrumentsRaw.length}`);

    const instruments = instrumentsRaw.map(inst => {
      // Parse trading symbol: NIFTY25JUN2624000CE
      // Format: {SYMBOL}{DD}{MMM}{YY}{STRIKE}{CE|PE}
      // We know the searchTerm prefix (e.g. "NIFTY25JUN26"), so strip it to get strike+type
      const sym = inst.tradingsymbol;

      // Strip the search prefix to isolate strike+optionType
      let suffix = sym;
      if (sym.startsWith(searchTerm)) {
        suffix = sym.slice(searchTerm.length); // e.g. "24000CE"
      }

      const match = suffix.match(/^(\d+)(CE|PE)$/);
      if (!match) return null;

      return {
        symboltoken: inst.symboltoken,
        tradingsymbol: sym,
        strike: parseInt(match[1]),
        optionType: match[2],
      };
    }).filter(Boolean);

    // Cache for 5 minutes (instruments don't change during the day)
    this._instrumentCache.set(cacheKey, instruments);
    setTimeout(() => this._instrumentCache.delete(cacheKey), 5 * 60 * 1000);

    return instruments;
  }

  /**
   * Batch quote option tokens.
   */
  async _batchQuote(tokens) {
    const quotes = new Map();
    const batchSize = 50;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const makeRequest = async () => {
        return axios.post(
          `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/quote/`,
          { mode: 'FULL', exchangeTokens: { NFO: batch } },
          { httpsAgent: IPV4_AGENT, timeout: 10000, headers: this._headers() }
        );
      };

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
          quotes.set(q.symbolToken, {
            ltp: q.ltp || 0,
            open: q.open || 0,
            high: q.high || 0,
            low: q.low || 0,
            close: q.close || 0,
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

  /**
   * Build option chain from instruments + quotes.
   */
  _buildChain(instruments, quotes) {
    // Group by strike
    const strikeMap = new Map();

    for (const inst of instruments) {
      if (!strikeMap.has(inst.strike)) {
        strikeMap.set(inst.strike, { strike: inst.strike });
      }
      const entry = strikeMap.get(inst.strike);
      const q = quotes.get(inst.symboltoken) || {};

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
      } else if (inst.optionType === 'PE') {
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

    // Sort by strike ascending
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }

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
