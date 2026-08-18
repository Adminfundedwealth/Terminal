/**
 * DHAN OPTION CHAIN SERVICE
 * 
 * Retrieves option chain data from Dhan API v2 with full Greeks.
 * 
 * Endpoint: POST https://api.dhan.co/v2/optionchain
 * 
 * Dhan provides:
 *   - Strike prices with CE/PE data
 *   - LTP, Volume, OI, OI Change
 *   - Greeks: Delta, Theta, Gamma, Vega, IV
 *   - Bid/Ask prices
 * 
 * This gives us a significant advantage over Angel One which provides
 * no Greeks data — we had to compute them manually (and didn't).
 * 
 * Security ID Mapping (Dhan uses numeric IDs for underlyings):
 *   NIFTY     = 13
 *   BANKNIFTY = 25
 *   FINNIFTY  = 27
 *   MIDCPNIFTY = 442
 *   SENSEX    = 51
 */

import axios from 'axios';
import https from 'https';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Dhan underlying security IDs
const UNDERLYING_SECURITY_IDS = {
  'NIFTY': '13',
  'NIFTY 50': '13',
  'BANKNIFTY': '25',
  'NIFTY BANK': '25',
  'FINNIFTY': '27',
  'NIFTY FIN SERVICE': '27',
  'MIDCPNIFTY': '442',
  'NIFTY MIDCAP SELECT': '442',
  'SENSEX': '51',
};

// Expiry type mapping
const EXPIRY_TYPES = {
  'weekly': 'WEEKLY',
  'monthly': 'MONTHLY',
  'quarterly': 'QUARTERLY',
};

export class DhanOptionChainService {
  constructor(authService) {
    this.auth = authService;
    // Cache: key → { data, loadedAt }
    this._cache = new Map();
    this._cacheTTL = 15000; // 15 seconds for option chain (tighter than Angel's 30s)
    this._loading = new Map(); // Prevent duplicate concurrent requests
  }

  /**
   * Get option chain for a symbol + expiry.
   * Returns array of OptionChainEntry with full Greeks.
   * 
   * @param {string} symbol — Underlying symbol (NIFTY, BANKNIFTY, etc.)
   * @param {string} expiry — Expiry date (YYYY-MM-DD or DD-MM-YYYY)
   * @returns {Array<OptionChainEntry>}
   */
  async getOptionChain(symbol, expiry) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        throw new Error('[DhanOptionChain] No valid token available');
      }
    }

    const sym = symbol.toUpperCase();
    const cacheKey = `${sym}:${expiry}`;

    // Serve from cache if fresh
    const cached = this._cache.get(cacheKey);
    if (cached && (Date.now() - cached.loadedAt) < this._cacheTTL) {
      return cached.data;
    }

    // Deduplicate concurrent requests
    if (this._loading.has(cacheKey)) {
      return this._loading.get(cacheKey);
    }

    const promise = this._fetchChain(sym, expiry)
      .then(chain => {
        this._loading.delete(cacheKey);
        if (chain.length > 0) {
          this._cache.set(cacheKey, { data: chain, loadedAt: Date.now() });
        }
        return chain;
      })
      .catch(err => {
        this._loading.delete(cacheKey);
        throw err;
      });

    this._loading.set(cacheKey, promise);
    return promise;
  }

  /**
   * Get available expiry dates for a symbol.
   * Uses Dhan's dedicated expirylist endpoint.
   */
  async getExpiries(symbol) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        throw new Error('[DhanOptionChain] No valid token available');
      }
    }

    const sym = symbol.toUpperCase();
    const securityId = UNDERLYING_SECURITY_IDS[sym];
    if (!securityId) {
      console.warn(`[DhanOptionChain] Unknown underlying: ${sym}`);
      return [];
    }

    try {
      const resp = await axios.post(
        `${DHAN_API_BASE}/optionchain/expirylist`,
        {
          UnderlyingScrip: parseInt(securityId),
          UnderlyingSeg: 'IDX_I',
        },
        {
          httpsAgent: IPV4_AGENT,
          timeout: 8000,
          headers: this.auth.getHeaders(),
        }
      );

      const data = resp.data?.data || [];
      if (Array.isArray(data) && data.length > 0) {
        // Dhan returns ISO date strings directly: ["2026-08-18", "2026-08-25", ...]
        return data.sort();
      }

      return [];
    } catch (err) {
      console.error('[DhanOptionChain] Expiry fetch failed:', err.response?.data?.message || err.response?.data || err.message);
      throw err;
    }
  }

  /**
   * Fetch option chain from Dhan API.
   */
  async _fetchChain(symbol, expiry) {
    const securityId = UNDERLYING_SECURITY_IDS[symbol];
    if (!securityId) {
      console.warn(`[DhanOptionChain] No security ID mapping for: ${symbol}`);
      return [];
    }

    const normalizedExpiry = this._toDhanExpiry(expiry);

    const payload = {
      UnderlyingScrip: parseInt(securityId),
      UnderlyingSeg: 'IDX_I',
      Expirydate: normalizedExpiry,
    };

    console.log(`[DhanOptionChain] Fetching: ${symbol} expiry=${normalizedExpiry}`);

    try {
      let resp;
      try {
        resp = await axios.post(`${DHAN_API_BASE}/optionchain`, payload, {
          httpsAgent: IPV4_AGENT,
          timeout: 10000,
          headers: this.auth.getHeaders(),
        });
      } catch (err) {
        if ((err.response?.status === 401 || err.response?.status === 403)) {
          const refreshed = await this.auth.refreshToken();
          if (refreshed) {
            resp = await axios.post(`${DHAN_API_BASE}/optionchain`, payload, {
              httpsAgent: IPV4_AGENT,
              timeout: 10000,
              headers: this.auth.getHeaders(),
            });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      return this._parseChainResponse(resp.data);
    } catch (err) {
      console.error(`[DhanOptionChain] Chain fetch failed for ${symbol}/${expiry}:`, err.response?.data?.message || err.message);
      throw err;
    }
  }

  /**
   * Parse Dhan option chain response into our OptionChainEntry format.
   * 
   * Dhan response structure (per strike):
   *   {
   *     strikePrice: 24000,
   *     ce_ltp / pe_ltp,
   *     ce_oi / pe_oi,
   *     ce_volume / pe_volume,
   *     ce_iv / pe_iv,
   *     ce_delta / pe_delta,
   *     ce_theta / pe_theta,
   *     ce_gamma / pe_gamma,
   *     ce_vega / pe_vega,
   *     ...
   *   }
   */
  _parseChainResponse(rawData) {
    const data = rawData?.data || rawData;
    if (!data || !Array.isArray(data)) return [];

    const chain = [];

    for (const item of data) {
      const strike = parseFloat(item.strikePrice || item.strike_price || item.StrikePrice || 0);
      if (!strike) continue;

      const entry = {
        strike,

        // Call side
        callToken: String(item.ce_security_id || item.CE_SecurityId || item.ce_token || ''),
        callSymbol: item.ce_tradingsymbol || item.CE_Symbol || '',
        callLtp: parseFloat(item.ce_ltp || item.CE_LTP || 0),
        callVolume: parseInt(item.ce_volume || item.CE_Volume || 0),
        callOi: parseInt(item.ce_oi || item.CE_OI || item.ce_open_interest || 0),
        callOiChange: parseInt(item.ce_oi_change || item.CE_OIChange || 0),
        callBidPrice: parseFloat(item.ce_bid || item.CE_BidPrice || 0),
        callAskPrice: parseFloat(item.ce_ask || item.CE_AskPrice || 0),

        // Call Greeks
        callIv: parseFloat(item.ce_iv || item.CE_IV || 0),
        callDelta: parseFloat(item.ce_delta || item.CE_Delta || 0),
        callGamma: parseFloat(item.ce_gamma || item.CE_Gamma || 0),
        callTheta: parseFloat(item.ce_theta || item.CE_Theta || 0),
        callVega: parseFloat(item.ce_vega || item.CE_Vega || 0),

        // Put side
        putToken: String(item.pe_security_id || item.PE_SecurityId || item.pe_token || ''),
        putSymbol: item.pe_tradingsymbol || item.PE_Symbol || '',
        putLtp: parseFloat(item.pe_ltp || item.PE_LTP || 0),
        putVolume: parseInt(item.pe_volume || item.PE_Volume || 0),
        putOi: parseInt(item.pe_oi || item.PE_OI || item.pe_open_interest || 0),
        putOiChange: parseInt(item.pe_oi_change || item.PE_OIChange || 0),
        putBidPrice: parseFloat(item.pe_bid || item.PE_BidPrice || 0),
        putAskPrice: parseFloat(item.pe_ask || item.PE_AskPrice || 0),

        // Put Greeks
        putIv: parseFloat(item.pe_iv || item.PE_IV || 0),
        putDelta: parseFloat(item.pe_delta || item.PE_Delta || 0),
        putGamma: parseFloat(item.pe_gamma || item.PE_Gamma || 0),
        putTheta: parseFloat(item.pe_theta || item.PE_Theta || 0),
        putVega: parseFloat(item.pe_vega || item.PE_Vega || 0),
      };

      chain.push(entry);
    }

    // Sort by strike ascending
    chain.sort((a, b) => a.strike - b.strike);

    console.log(`[DhanOptionChain] Parsed ${chain.length} strikes`);
    return chain;
  }

  /**
   * Convert expiry to Dhan format (YYYY-MM-DD).
   * Handles: YYYY-MM-DD, DD-MM-YYYY, DDMMMYY, ISO strings
   */
  _toDhanExpiry(expiry) {
    if (!expiry) return '';

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return expiry;

    // DD-MM-YYYY
    const ddmmyyyy = expiry.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;

    // DDMMMYY (Angel format) e.g. 28AUG26
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const angelFmt = expiry.match(/^(\d{2})([A-Z]{3})(\d{2})$/i);
    if (angelFmt) {
      const dd = angelFmt[1];
      const mon = angelFmt[2].toUpperCase();
      const yy = parseInt(angelFmt[3]);
      const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
      const mm = String(MONTHS.indexOf(mon) + 1).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    // ISO string with time
    const isoDate = new Date(expiry);
    if (!isNaN(isoDate.getTime())) {
      return isoDate.toISOString().slice(0, 10);
    }

    return expiry;
  }

  /**
   * Normalize expiry date to YYYY-MM-DD.
   */
  _normalizeExpiry(expiry) {
    return this._toDhanExpiry(expiry);
  }
}
