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
 *   - ExpiryList: needs UnderlyingScrip (int), UnderlyingSeg ('IDX_I')
 *   - ExpiryList returns: { data: ["2026-08-18", "2026-08-25", ...], status: "success" }
 *   - Headers MUST include: access-token, client-id, dhan-client-id, dhanClientId
 *   - OptionChain endpoint returns 400 "Invalid Expiry Date" on YYYY-MM-DD format
 *     but ExpiryList returns YYYY-MM-DD — possible API bug or market hours restriction
 * 
 * Security ID mapping:
 *   NIFTY=13, BANKNIFTY=25, FINNIFTY=27, MIDCPNIFTY=442, SENSEX=51
 */

import axios from 'axios';
import https from 'https';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Dhan underlying security IDs for indices
const UNDERLYING_IDS = {
  'NIFTY': 13,
  'NIFTY 50': 13,
  'BANKNIFTY': 25,
  'NIFTY BANK': 25,
  'FINNIFTY': 27,
  'NIFTY FIN SERVICE': 27,
  'MIDCPNIFTY': 442,
  'NIFTY MIDCAP SELECT': 442,
  'SENSEX': 51,
};

export class DhanOptionChainService {
  constructor(authService) {
    this.auth = authService;
    this._cache = new Map();
    this._cacheTTL = 15000; // 15s
    this._loading = new Map();
  }

  /**
   * Get available expiry dates for a symbol.
   * This endpoint WORKS reliably.
   */
  async getExpiries(symbol) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        throw new Error('[DhanOC] No valid token');
      }
    }

    const sym = symbol.toUpperCase();
    const secId = UNDERLYING_IDS[sym];
    if (!secId) {
      console.warn(`[DhanOC] Unknown symbol: ${sym}`);
      return [];
    }

    const resp = await axios.post(
      `${DHAN_API_BASE}/optionchain/expirylist`,
      { UnderlyingScrip: secId, UnderlyingSeg: 'IDX_I' },
      { httpsAgent: IPV4_AGENT, timeout: 8000, headers: this.auth.getHeaders() }
    );

    const data = resp.data?.data;
    if (Array.isArray(data) && data.length > 0) {
      console.log(`[DhanOC] Expiries for ${sym}: ${data.length} dates`);
      return data; // Already ISO YYYY-MM-DD strings
    }
    return [];
  }

  /**
   * Get option chain for symbol + expiry.
   * Tries multiple expiry date formats since Dhan's API is inconsistent.
   */
  async getOptionChain(symbol, expiry) {
    if (!this.auth.isTokenValid) {
      const refreshed = await this.auth.refreshToken();
      if (!refreshed && !this.auth.isTokenValid) {
        throw new Error('[DhanOC] No valid token');
      }
    }

    const sym = symbol.toUpperCase();
    const secId = UNDERLYING_IDS[sym];
    if (!secId) {
      console.warn(`[DhanOC] Unknown symbol for chain: ${sym}`);
      return [];
    }

    const cacheKey = `${sym}:${expiry}`;
    const cached = this._cache.get(cacheKey);
    if (cached && (Date.now() - cached.loadedAt) < this._cacheTTL) {
      return cached.data;
    }

    if (this._loading.has(cacheKey)) return this._loading.get(cacheKey);

    const promise = this._fetchChain(secId, sym, expiry)
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

  async _fetchChain(secId, symbol, expiry) {
    // Dhan requires exact key "Expiry" (capital E, not Expirydate)
    const normalizedExpiry = this._normalizeExpiry(expiry);

    const payload = {
      UnderlyingScrip: secId,
      UnderlyingSeg: 'IDX_I',
      Expiry: normalizedExpiry,
    };

    console.log(`[DhanOC] Fetching chain: ${symbol} Expiry=${normalizedExpiry}`);

    try {
      const resp = await axios.post(`${DHAN_API_BASE}/optionchain`, payload, {
        httpsAgent: IPV4_AGENT,
        timeout: 12000,
        headers: this.auth.getHeaders(),
      });

      const data = resp.data?.data || resp.data;
      if (Array.isArray(data) && data.length > 0) {
        console.log(`[DhanOC] Got ${data.length} strikes for ${symbol}/${normalizedExpiry}`);
        return this._parseChain(data);
      }
      return [];
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data;
      console.error(`[DhanOC] Chain failed: HTTP ${status}`, JSON.stringify(msg).slice(0, 150));
      throw err;
    }
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
