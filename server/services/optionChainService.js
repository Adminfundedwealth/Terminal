/**
 * OPTION CHAIN SERVICE  —  v3 (Smart expiry discovery + server-side cache)
 *
 * How it works:
 *   1. getExpiries(symbol) — scans forward dates via searchScrip to find real
 *      expiry dates. Results cached 6 hours.  Returns ISO date strings.
 *
 *   2. getOptionChain(symbol, expiry) — calls searchScrip for the exact
 *      symbol+expiry term, batch-quotes all tokens (50/batch, 200ms gap),
 *      builds and returns the chain.  Results cached 30 seconds so switching
 *      between pairs is instant on repeat visits.
 *
 * No instrument master download. No external file fetch.
 * Works for all 5 index pairs regardless of whether they have weekly or monthly expiries.
 */

import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';
config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
const IPV4_AGENT = new https.Agent({ family: 4 });

// How many forward days to scan when discovering expiries
const EXPIRY_SCAN_DAYS = 90;
// Expiry list TTL: 2 hours (was 6h — refresh more often to catch new expiries)
const EXPIRY_TTL_MS = 2 * 60 * 60 * 1000;
// Chain data TTL: 30 seconds (fresh enough for trading, instant for pair-switching)
const CHAIN_TTL_MS = 30 * 1000;
// Stale expiry TTL: serve stale cache for up to 24h if fresh discovery fails
const EXPIRY_STALE_TTL_MS = 24 * 60 * 60 * 1000;

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export class OptionChainService {
  constructor() {
    this.jwtToken = null;
    this._refreshCallback = null;

    // expiry cache: symbol → { expiries: string[], loadedAt: number }
    this._expiryCache = new Map();
    // chain cache: `symbol:expiry` → { chain: [], loadedAt: number }
    this._chainCache = new Map();
    // in-flight promises to prevent duplicate concurrent requests
    this._expiryLoading = new Map();
    this._chainLoading = new Map();
  }

  setAuthToken(token) { this.jwtToken = token; }
  setRefreshCallback(fn) { this._refreshCallback = fn; }

  // ── Public: expiry list ───────────────────────────────────────────────────

  /**
   * Returns actual available expiry dates for a symbol as ISO strings.
   * Scans forward via searchScrip to find real dates — no hardcoded day-of-week.
   * Serves stale cache on failure so the chain can still load.
   */
  async getExpiries(symbol) {
    const sym = symbol.toUpperCase();

    // Serve from fresh cache
    const cached = this._expiryCache.get(sym);
    if (cached && (Date.now() - cached.loadedAt) < EXPIRY_TTL_MS) {
      return cached.expiries;
    }

    // Deduplicate concurrent requests
    if (this._expiryLoading.has(sym)) return this._expiryLoading.get(sym);

    const promise = this._discoverExpiries(sym).then(expiries => {
      this._expiryLoading.delete(sym);
      if (expiries.length > 0) {
        this._expiryCache.set(sym, { expiries, loadedAt: Date.now() });
        return expiries;
      }
      // Discovery returned nothing — serve stale cache if available (up to 24h)
      const stale = this._expiryCache.get(sym);
      if (stale && (Date.now() - stale.loadedAt) < EXPIRY_STALE_TTL_MS) {
        console.warn(`[OptionChain] Serving stale expiry cache for ${sym}`);
        return stale.expiries;
      }
      return [];
    }).catch(err => {
      this._expiryLoading.delete(sym);
      console.error(`[OptionChain] Expiry discovery failed for ${sym}:`, err.message);
      // Serve stale cache on error
      const stale = this._expiryCache.get(sym);
      if (stale && (Date.now() - stale.loadedAt) < EXPIRY_STALE_TTL_MS) {
        return stale.expiries;
      }
      return [];
    });

    this._expiryLoading.set(sym, promise);
    return promise;
  }

  // ── Public: option chain ─────────────────────────────────────────────────

  /**
   * Returns the option chain for a symbol+expiry.
   * Cached 30s — instant on repeat calls.
   * If the first expiry returns empty, automatically tries next cached expiries.
   */
  async getOptionChain(symbol, expiry) {
    await this._ensureToken();
    if (!this.jwtToken) {
      console.log('[OptionChain] No JWT token available');
      return [];
    }

    const sym = symbol.toUpperCase();
    const angelExpiry = this._toAngelExpiry(expiry);
    const cacheKey = `${sym}:${angelExpiry}`;

    // Serve from 30-second cache
    const cached = this._chainCache.get(cacheKey);
    if (cached && (Date.now() - cached.loadedAt) < CHAIN_TTL_MS) {
      console.log(`[OptionChain] Cache hit: ${cacheKey} (${cached.chain.length} strikes)`);
      return cached.chain;
    }

    // Deduplicate concurrent requests
    if (this._chainLoading.has(cacheKey)) return this._chainLoading.get(cacheKey);

    const promise = (async () => {
      let chain = await this._fetchChain(sym, angelExpiry);

      // If requested expiry returned nothing, try other cached expiries for this symbol
      if (chain.length === 0) {
        console.log(`[OptionChain] ${cacheKey} returned empty — trying other expiries`);
        const cachedExpiries = this._expiryCache.get(sym);
        if (cachedExpiries?.expiries) {
          for (const altExpiry of cachedExpiries.expiries) {
            const altAngel = this._toAngelExpiry(altExpiry);
            if (altAngel === angelExpiry) continue;
            const altKey = `${sym}:${altAngel}`;
            const altCached = this._chainCache.get(altKey);
            if (altCached?.chain?.length > 0) {
              console.log(`[OptionChain] Serving cached chain for ${altKey} as fallback`);
              chain = altCached.chain;
              break;
            }
            // Try fetching the alt expiry
            try {
              const altChain = await this._fetchChain(sym, altAngel);
              if (altChain.length > 0) {
                this._chainCache.set(altKey, { chain: altChain, loadedAt: Date.now() });
                console.log(`[OptionChain] Fallback fetch worked: ${altKey} (${altChain.length} strikes)`);
                chain = altChain;
                break;
              }
            } catch (_) {}
          }
        }
      }

      if (chain.length > 0) {
        this._chainCache.set(cacheKey, { chain, loadedAt: Date.now() });
      }
      this._chainLoading.delete(cacheKey);
      return chain;
    })().catch(err => {
      this._chainLoading.delete(cacheKey);
      console.error(`[OptionChain] Chain fetch failed ${cacheKey}:`, err.message);
      return [];
    });

    this._chainLoading.set(cacheKey, promise);
    return promise;
  }

  // ── Expiry discovery ─────────────────────────────────────────────────────

  async _discoverExpiries(sym) {
    await this._ensureToken();
    if (!this.jwtToken) return [];

    console.log(`[OptionChain] Discovering expiries for ${sym}...`);
    const now = new Date();

    // Build all candidate dates up front
    const candidates = [];
    for (let i = 0; i <= EXPIRY_SCAN_DAYS; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const iso = date.toISOString().split('T')[0];
      candidates.push({ iso, angelFmt: this._isoToAngel(iso) });
    }

    // Fan out in parallel batches of 10 — much faster than serial
    const BATCH = 10;
    const found = []; // { iso, index }

    for (let start = 0; start < candidates.length && found.length < 5; start += BATCH) {
      const batch = candidates.slice(start, start + BATCH);
      const results = await Promise.allSettled(
        batch.map(({ iso, angelFmt }, bi) =>
          this._searchScrip(`${sym}${angelFmt}`)
            .then(r => ({ iso, idx: start + bi, count: r?.length || 0 }))
            .catch(() => ({ iso, idx: start + bi, count: 0 }))
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.count > 0) {
          found.push(r.value);
        }
      }
      // Small inter-batch pause to stay within rate limits
      if (start + BATCH < candidates.length && found.length < 5) {
        await this._sleep(120);
      }
    }

    // Sort by calendar order and return ISO strings
    found.sort((a, b) => a.idx - b.idx);
    const expiries = found.slice(0, 5).map(f => f.iso);
    console.log(`[OptionChain] Expiries for ${sym}: ${expiries.join(', ')}`);
    return expiries;
  }

  // ── Chain fetch ───────────────────────────────────────────────────────────

  async _fetchChain(sym, angelExpiry) {
    const term = `${sym}${angelExpiry}`;
    console.log(`[OptionChain] Fetching chain: ${term}`);

    const instruments = await this._searchScrip(term);
    if (!instruments || instruments.length === 0) {
      console.log(`[OptionChain] No instruments for ${term}`);
      return [];
    }
    console.log(`[OptionChain] ${instruments.length} instruments for ${term}`);

    // Parse strike + type from trading symbol
    const parsed = instruments.map(inst => {
      const ts = inst.tradingsymbol || '';
      let suffix = ts;
      if (ts.startsWith(term)) suffix = ts.slice(term.length);
      const m = suffix.match(/^(\d+(?:\.\d+)?)(CE|PE)$/);
      if (!m) return null;
      return {
        symboltoken: inst.symboltoken,
        tradingsymbol: ts,
        strike: Math.round(parseFloat(m[1])),
        optionType: m[2],
      };
    }).filter(Boolean);

    // Batch-quote all tokens
    const tokens = parsed.map(p => p.symboltoken);
    const quotes = await this._batchQuote(tokens);
    console.log(`[OptionChain] Quotes: ${quotes.size}`);

    return this._buildChain(parsed, quotes);
  }

  // ── searchScrip wrapper ───────────────────────────────────────────────────

  async _searchScrip(term) {
    const makeReq = () => axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/order/v1/searchScrip`,
      { exchange: 'NFO', searchscrip: term },
      { httpsAgent: IPV4_AGENT, timeout: 8000, headers: this._headers() }
    );

    let resp;
    try {
      resp = await makeReq();
    } catch (err) {
      if ((err.response?.status === 401 || err.response?.status === 403) && this._refreshCallback) {
        console.log('[OptionChain] Token expired — refreshing and retrying');
        this.jwtToken = await this._refreshCallback();
        resp = await makeReq();
      } else {
        throw err;
      }
    }

    // Explicit auth failure in response body (Angel returns 200 with errorcode for auth errors)
    const msg = resp.data?.message || '';
    const code = resp.data?.errorcode || '';
    if (code === 'AG8001' || code === 'AB8000' || msg.toLowerCase().includes('invalid token') || msg.toLowerCase().includes('session expired')) {
      if (this._refreshCallback) {
        console.log('[OptionChain] Auth error in response body — refreshing token');
        this.jwtToken = await this._refreshCallback();
        resp = await makeReq();
      }
    }

    if (Array.isArray(resp.data?.data)) return resp.data.data;
    if (resp.data?.data && typeof resp.data.data === 'object') {
      const all = [];
      for (const v of Object.values(resp.data.data)) {
        if (Array.isArray(v)) all.push(...v);
      }
      return all;
    }
    return [];
  }

  // ── Batch quote ───────────────────────────────────────────────────────────

  async _batchQuote(tokens) {
    const quotes = new Map();
    if (!tokens.length) return quotes;

    const batchSize = 50;
    for (let i = 0; i < tokens.length; i += batchSize) {
      if (i > 0) await this._sleep(150);
      const batch = tokens.slice(i, i + batchSize);

      const makeReq = () => axios.post(
        `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/quote/`,
        { mode: 'FULL', exchangeTokens: { NFO: batch } },
        { httpsAgent: IPV4_AGENT, timeout: 6000, headers: this._headers() }
      );

      try {
        let resp;
        try {
          resp = await makeReq();
        } catch (err) {
          if ((err.response?.status === 401 || err.response?.status === 403) && this._refreshCallback) {
            this.jwtToken = await this._refreshCallback();
            resp = await makeReq();
          } else throw err;
        }

        // Handle auth error in body
        const code = resp.data?.errorcode || '';
        if (code === 'AG8001' || code === 'AB8000') {
          if (this._refreshCallback) {
            this.jwtToken = await this._refreshCallback();
            resp = await makeReq();
          }
        }

        for (const q of (resp.data?.data?.fetched || [])) {
          const key = String(q.symbolToken || q.symboltoken || '');
          if (key) {
            quotes.set(key, {
              ltp: q.ltp || 0,
              volume: q.tradeVolume || 0,
              oi: q.opnInterest || 0,
              totalBuyQty: q.totBuyQuan || 0,
              totalSellQty: q.totSellQuan || 0,
              bidPrice: q.depth?.buy?.[0]?.price || 0,
              askPrice: q.depth?.sell?.[0]?.price || 0,
            });
          }
        }
      } catch (err) {
        console.error(`[OptionChain] Batch quote error:`, err.response?.data?.message || err.message);
        // Continue with other batches — partial data is better than nothing
      }
    }
    return quotes;
  }

  // ── Chain builder ─────────────────────────────────────────────────────────

  _buildChain(instruments, quotes) {
    const strikeMap = new Map();
    for (const inst of instruments) {
      if (!strikeMap.has(inst.strike)) strikeMap.set(inst.strike, { strike: inst.strike });
      const entry = strikeMap.get(inst.strike);
      const q = quotes.get(inst.symboltoken)
              || quotes.get((inst.symboltoken || '').toUpperCase())
              || {};
      if (inst.optionType === 'CE') {
        entry.callToken    = inst.symboltoken;
        entry.callSymbol   = inst.tradingsymbol;
        entry.callLtp      = q.ltp || 0;
        entry.callVolume   = q.volume || 0;
        entry.callOi       = q.oi || 0;
        entry.callBidPrice = q.bidPrice || 0;
        entry.callAskPrice = q.askPrice || 0;
      } else {
        entry.putToken    = inst.symboltoken;
        entry.putSymbol   = inst.tradingsymbol;
        entry.putLtp      = q.ltp || 0;
        entry.putVolume   = q.volume || 0;
        entry.putOi       = q.oi || 0;
        entry.putBidPrice = q.bidPrice || 0;
        entry.putAskPrice = q.askPrice || 0;
      }
    }
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }

  // ── Expiry format helpers ─────────────────────────────────────────────────

  /** Convert any expiry format → Angel "DDMMMYY" e.g. "2026-08-11" → "11AUG26" */
  _toAngelExpiry(expiry) {
    if (!expiry) return '';
    // Already DDMMMYY
    if (/^\d{2}[A-Z]{3}\d{2}$/i.test(expiry)) return expiry.toUpperCase();
    // DDMMMYYYY
    const m4 = expiry.match(/^(\d{2})([A-Z]{3})(\d{4})$/i);
    if (m4) return `${m4[1]}${m4[2].toUpperCase()}${m4[3].slice(-2)}`;
    // ISO YYYY-MM-DD
    return this._isoToAngel(expiry);
  }

  _isoToAngel(iso) {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    const dd  = m[3].padStart(2, '0');
    const mmm = MONTHS[parseInt(m[2], 10) - 1];
    const yy  = m[1].slice(-2);
    return `${dd}${mmm}${yy}`;
  }

  /** Convert Angel "DDMMMYY" back to ISO "YYYY-MM-DD" */
  _angelToIso(angelFmt) {
    const m = angelFmt.match(/^(\d{2})([A-Z]{3})(\d{2})$/i);
    if (!m) return angelFmt;
    const dd   = m[1];
    const mon  = m[2].toUpperCase();
    const yy   = parseInt(m[3], 10);
    const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
    const mm   = String(MONTHS.indexOf(mon) + 1).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // ── Auth helpers ──────────────────────────────────────────────────────────

  /**
   * Ensure JWT token is available — waits up to 15 seconds if refresh is in progress.
   */
  async _ensureToken() {
    if (this.jwtToken) return; // already have it

    // Try refresh callback first
    if (this._refreshCallback) {
      try {
        this.jwtToken = await this._refreshCallback();
        if (this.jwtToken) return;
      } catch (_) {}
    }

    // Poll for token up to 15s (token may arrive via angelFeed.connect() in background)
    for (let i = 0; i < 15; i++) {
      await this._sleep(1000);
      if (this.jwtToken) return;
      if (this._refreshCallback) {
        try { this.jwtToken = await this._refreshCallback(); } catch (_) {}
        if (this.jwtToken) return;
      }
    }
    console.warn('[OptionChain] _ensureToken: no JWT after 15s wait');
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
