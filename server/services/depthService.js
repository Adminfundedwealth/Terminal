/**
 * DEPTH SERVICE
 * 
 * Provides 5-level market depth (DOM) for instruments.
 * Sources:
 *   1. Angel One REST API (FULL mode quote) — on-demand polling
 *   2. SmartStream SnapQuote mode (mode 3) — real-time when subscribed
 * 
 * For stocks/futures: real bid/ask from exchange order book.
 * For indices: depth is always empty (no order book for indices).
 */

import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';

config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
const IPV4_AGENT = new https.Agent({ family: 4 });

export class DepthService {
  constructor(marketDataEngine) {
    this.marketDataEngine = marketDataEngine;
    this.jwtToken = null;
    this._refreshCallback = null;
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
   * Get 5-level market depth for a token via REST API.
   * Returns: { bids: [{price, qty, orders}], asks: [...], totalBuyQty, totalSellQty }
   */
  async getDepth(token, exchange = 'NSE') {
    // Check cache first
    const cached = this.marketDataEngine.getDepth(token);
    if (cached && cached.bids.length > 0) return cached;

    if (!this.jwtToken) {
      if (this._refreshCallback) {
        try { this.jwtToken = await this._refreshCallback(); } catch (e) { /* ignore */ }
      }
      if (!this.jwtToken) return { bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 };
    }

    const makeRequest = async () => {
      const exchangeKey = exchange === 'NFO' ? 'NFO' : exchange === 'MCX' ? 'MCX' : 'NSE';
      const resp = await axios.post(
        `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/quote/`,
        { mode: 'FULL', exchangeTokens: { [exchangeKey]: [token] } },
        {
          httpsAgent: IPV4_AGENT,
          timeout: 8000,
          headers: this._headers(),
        }
      );
      return resp;
    };

    try {
      let resp;
      try {
        resp = await makeRequest();
      } catch (err) {
        if ((err.response?.status === 403 || err.response?.status === 401) && this._refreshCallback) {
          console.log(`[DepthService] Got ${err.response.status} — refreshing token and retrying`);
          try {
            this.jwtToken = await this._refreshCallback();
            resp = await makeRequest();
          } catch (retryErr) {
            console.error(`[DepthService] Retry failed for ${token}:`, retryErr.response?.data?.message || retryErr.message);
            return { bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 };
          }
        } else {
          throw err;
        }
      }

      const fetched = resp.data?.data?.fetched?.[0];
      if (!fetched || !fetched.depth) {
        return { bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 };
      }

      const depth = {
        token,
        bids: (fetched.depth.buy || []).filter(l => l.price > 0).map(l => ({
          price: l.price,
          qty: l.quantity,
          orders: l.orders || 0,
        })),
        asks: (fetched.depth.sell || []).filter(l => l.price > 0).map(l => ({
          price: l.price,
          qty: l.quantity,
          orders: l.orders || 0,
        })),
        totalBuyQty: fetched.totBuyQuan || 0,
        totalSellQty: fetched.totSellQuan || 0,
      };

      // Push to market data engine cache
      this.marketDataEngine.pushDepth(token, depth);
      return depth;
    } catch (err) {
      console.error(`[DepthService] Fetch failed for ${token}:`, err.response?.data?.message || err.message);
      return { bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 };
    }
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
