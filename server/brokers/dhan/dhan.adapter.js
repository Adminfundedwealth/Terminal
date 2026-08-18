/**
 * DHAN ADAPTER — FULL IMPLEMENTATION
 * 
 * Implements broker interface for Dhan (https://dhanhq.co).
 * Docs: https://dhanhq.co/docs/v2/
 * 
 * Authentication: Access Token (pre-generated via Dhan app) + optional auto-renewal
 * Market Data: REST (historical, quotes, option chain) + WebSocket feed
 * 
 * Credentials from .env:
 *   DHAN_CLIENT_ID       — Required
 *   DHAN_ACCESS_TOKEN    — Required
 *   DHAN_API_KEY         — Optional (enables auto-renewal)
 *   DHAN_API_SECRET      — Optional (enables auto-renewal)
 * 
 * Dhan API Base: https://api.dhan.co/v2
 * Dhan WS Feed: wss://api-feed.dhan.co
 */

import axios from 'axios';
import https from 'https';
import { DhanAuthService } from './dhan.auth.js';
import { DhanHistoricalService } from './dhan.historical.js';
import { DhanOptionChainService } from './dhan.optionchain.js';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

export class DhanAdapter {
  constructor() {
    this.name = 'dhan';
    this._isConnected = false;
    this.session = null;

    // Sub-services
    this.auth = new DhanAuthService();
    this.historical = new DhanHistoricalService(this.auth);
    this.optionChain = new DhanOptionChainService(this.auth);
  }

  get isConnected() {
    return this._isConnected && this.auth.isTokenValid;
  }

  // ─── Authentication ─────────────────────────────────────────

  async connect(credentials = {}) {
    // Initialize auth (validates token, schedules renewal)
    const valid = await this.auth.initialize();

    if (!valid) {
      throw new Error('[Dhan] Failed to initialize — token invalid or credentials missing');
    }

    this.session = {
      provider: 'dhan',
      clientId: this.auth.clientId,
      token: this.auth.accessToken,
      expiresAt: this.auth._tokenExpiresAt,
    };
    this._isConnected = true;

    // Listen for token refresh to update session
    this.auth.on('token:refreshed', ({ token, expiresAt }) => {
      this.session.token = token;
      this.session.expiresAt = expiresAt;
    });

    this.auth.on('token:expired', () => {
      console.warn('[Dhan] Token expired — adapter may need reconnection');
    });

    console.log(`[Dhan] Connected as ${this.auth.clientId} (auto-renew: ${this.auth.canAutoRenew})`);
    return this.session;
  }

  async disconnect() {
    this._isConnected = false;
    this.session = null;
    this.auth.destroy();
    console.log('[Dhan] Disconnected');
  }

  async refreshSession() {
    const token = await this.auth.refreshToken();
    if (!token) {
      throw new Error('[Dhan] Token refresh failed — regenerate from Dhan app or check API key/secret');
    }
    this.session.token = token;
    this.session.expiresAt = this.auth._tokenExpiresAt;
    return this.session;
  }

  // ─── Health Check ───────────────────────────────────────────

  async healthCheck() {
    try {
      const resp = await axios.get(`${DHAN_API_BASE}/profile`, {
        httpsAgent: IPV4_AGENT,
        timeout: 5000,
        headers: this.auth.getHeaders(),
      });
      return {
        healthy: resp.status === 200,
        provider: 'dhan',
        latency: 0, // Could measure if needed
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        healthy: false,
        provider: 'dhan',
        error: err.message,
        timestamp: Date.now(),
      };
    }
  }

  // ─── Market Data ────────────────────────────────────────────

  /**
   * Get historical OHLCV candles.
   * Wraps DhanHistoricalService for the IBrokerAdapter interface.
   */
  async getHistoricalData(securityId, exchangeSegment, timeframe, fromTimestamp, toTimestamp) {
    return this.historical.getCandles(securityId, exchangeSegment, timeframe, fromTimestamp, toTimestamp);
  }

  /**
   * Get real-time quotes for multiple tokens.
   */
  async getQuotes(tokens) {
    if (!this.auth.isTokenValid) {
      throw new Error('[Dhan] Token invalid for quotes');
    }

    // Dhan quote endpoint: POST /v2/marketfeed/ltp
    const results = [];
    const batchSize = 50;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      try {
        const resp = await axios.post(
          `${DHAN_API_BASE}/marketfeed/ltp`,
          {
            NSE_EQ: batch.filter(t => !t.includes(':')).map(t => parseInt(t)),
            NSE_FNO: [],
          },
          {
            httpsAgent: IPV4_AGENT,
            timeout: 6000,
            headers: this.auth.getHeaders(),
          }
        );

        const data = resp.data?.data || resp.data;
        if (data && typeof data === 'object') {
          for (const [token, quote] of Object.entries(data)) {
            results.push({
              token: String(token),
              ltp: parseFloat(quote.last_price || quote.ltp || 0),
              volume: parseInt(quote.volume || 0),
              oi: parseInt(quote.oi || 0),
            });
          }
        }
      } catch (err) {
        console.error(`[Dhan] Quote batch error:`, err.response?.data?.message || err.message);
      }

      // Small delay between batches
      if (i + batchSize < tokens.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return results;
  }

  /**
   * Get full quote (with depth) for a single token.
   */
  async getQuote(securityId, exchangeSegment = 'NSE_EQ') {
    if (!this.auth.isTokenValid) {
      throw new Error('[Dhan] Token invalid for quote');
    }

    try {
      const resp = await axios.post(
        `${DHAN_API_BASE}/marketfeed/quote`,
        {
          [exchangeSegment]: [parseInt(securityId)],
        },
        {
          httpsAgent: IPV4_AGENT,
          timeout: 6000,
          headers: this.auth.getHeaders(),
        }
      );

      const data = resp.data?.data || resp.data;
      return data || null;
    } catch (err) {
      console.error(`[Dhan] Quote error for ${securityId}:`, err.response?.data?.message || err.message);
      throw err;
    }
  }

  /**
   * Get OHLC data (convenience wrapper matching IBrokerAdapter).
   */
  async getOHLC(token, exchange, timeframe, fromDate, toDate) {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(toDate).getTime() / 1000);
    return this.historical.getCandles(token, exchange, timeframe, fromTs, toTs);
  }

  /**
   * Get market depth for a token.
   */
  async getDepth(securityId, exchangeSegment = 'NSE_EQ') {
    if (!this.auth.isTokenValid) {
      throw new Error('[Dhan] Token invalid for depth');
    }

    try {
      const resp = await axios.post(
        `${DHAN_API_BASE}/marketfeed/quote`,
        {
          [exchangeSegment]: [parseInt(securityId)],
        },
        {
          httpsAgent: IPV4_AGENT,
          timeout: 6000,
          headers: this.auth.getHeaders(),
        }
      );

      const data = resp.data?.data || resp.data;
      // Transform Dhan depth into our MarketDepth format
      if (data) {
        return this._transformDepth(securityId, data);
      }
      return null;
    } catch (err) {
      console.error(`[Dhan] Depth error for ${securityId}:`, err.response?.data?.message || err.message);
      throw err;
    }
  }

  /**
   * Get option chain — delegates to DhanOptionChainService.
   */
  async getOptionChain(symbol, expiry) {
    return this.optionChain.getOptionChain(symbol, expiry);
  }

  /**
   * Get option chain expiries — delegates to DhanOptionChainService.
   */
  async getExpiries(symbol) {
    return this.optionChain.getExpiries(symbol);
  }

  // ─── Trading ────────────────────────────────────────────────

  async placeOrder(order) {
    if (!this.auth.isTokenValid) {
      throw new Error('[Dhan] Token invalid for order placement');
    }

    const payload = {
      dhanClientId: this.auth.clientId,
      transactionType: order.side || order.transactionType,
      exchangeSegment: this._mapExchange(order.exchange || order.segment),
      productType: this._mapProduct(order.productType),
      orderType: this._mapOrderType(order.orderType),
      validity: 'DAY',
      securityId: String(order.token || order.securityId),
      quantity: order.qty || order.quantity,
      price: order.price || 0,
      triggerPrice: order.triggerPrice || 0,
    };

    try {
      const resp = await axios.post(`${DHAN_API_BASE}/orders`, payload, {
        httpsAgent: IPV4_AGENT,
        timeout: 10000,
        headers: this.auth.getHeaders(),
      });

      return {
        orderId: resp.data?.data?.orderId || resp.data?.orderId || '',
        brokerOrderId: resp.data?.data?.orderId || '',
        status: 'PENDING',
        message: resp.data?.message || 'Order placed',
      };
    } catch (err) {
      throw new Error(`[Dhan] Order failed: ${err.response?.data?.message || err.message}`);
    }
  }

  async modifyOrder(orderId, params) {
    if (!this.auth.isTokenValid) {
      throw new Error('[Dhan] Token invalid for order modification');
    }

    const payload = {
      dhanClientId: this.auth.clientId,
      orderId: String(orderId),
      orderType: params.orderType ? this._mapOrderType(params.orderType) : undefined,
      quantity: params.qty || params.quantity,
      price: params.price,
      triggerPrice: params.triggerPrice,
      validity: 'DAY',
    };

    // Remove undefined fields
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    try {
      const resp = await axios.put(`${DHAN_API_BASE}/orders/${orderId}`, payload, {
        httpsAgent: IPV4_AGENT,
        timeout: 10000,
        headers: this.auth.getHeaders(),
      });

      return {
        orderId: String(orderId),
        brokerOrderId: String(orderId),
        status: 'PENDING',
        message: resp.data?.message || 'Order modified',
      };
    } catch (err) {
      throw new Error(`[Dhan] Modify failed: ${err.response?.data?.message || err.message}`);
    }
  }

  async cancelOrder(orderId) {
    if (!this.auth.isTokenValid) {
      throw new Error('[Dhan] Token invalid for order cancellation');
    }

    try {
      const resp = await axios.delete(`${DHAN_API_BASE}/orders/${orderId}`, {
        httpsAgent: IPV4_AGENT,
        timeout: 10000,
        headers: this.auth.getHeaders(),
      });

      return {
        orderId: String(orderId),
        status: 'cancelled',
        message: resp.data?.message || 'Order cancelled',
      };
    } catch (err) {
      throw new Error(`[Dhan] Cancel failed: ${err.response?.data?.message || err.message}`);
    }
  }

  // ─── Portfolio ──────────────────────────────────────────────

  async getPositions() {
    if (!this.auth.isTokenValid) throw new Error('[Dhan] Token invalid');

    const resp = await axios.get(`${DHAN_API_BASE}/positions`, {
      httpsAgent: IPV4_AGENT,
      timeout: 8000,
      headers: this.auth.getHeaders(),
    });

    return (resp.data?.data || []).map(p => ({
      symbol: p.tradingSymbol || p.securityId,
      token: String(p.securityId),
      segment: p.exchangeSegment,
      productType: p.productType,
      qty: p.netQty || 0,
      avgPrice: p.averagePrice || p.costPrice || 0,
      ltp: p.ltp || 0,
      pnl: p.realizedProfit || 0,
      mtm: p.unrealizedProfit || 0,
      buyQty: p.buyQty || 0,
      sellQty: p.sellQty || 0,
      buyAvg: p.buyAvg || 0,
      sellAvg: p.sellAvg || 0,
    }));
  }

  async getOrders() {
    if (!this.auth.isTokenValid) throw new Error('[Dhan] Token invalid');

    const resp = await axios.get(`${DHAN_API_BASE}/orders`, {
      httpsAgent: IPV4_AGENT,
      timeout: 8000,
      headers: this.auth.getHeaders(),
    });

    return (resp.data?.data || []).map(o => ({
      id: String(o.orderId),
      brokerOrderId: String(o.orderId),
      symbol: o.tradingSymbol || o.securityId,
      token: String(o.securityId),
      side: o.transactionType,
      orderType: o.orderType,
      productType: o.productType,
      qty: o.quantity || 0,
      price: o.price || 0,
      triggerPrice: o.triggerPrice || 0,
      filledQty: o.filledQty || o.tradedQty || 0,
      avgPrice: o.tradedPrice || 0,
      status: this._mapStatus(o.orderStatus),
      placedAt: o.createTime || o.orderTimestamp || '',
      updatedAt: o.updateTime || '',
    }));
  }

  async getTrades() {
    if (!this.auth.isTokenValid) throw new Error('[Dhan] Token invalid');

    const resp = await axios.get(`${DHAN_API_BASE}/trades`, {
      httpsAgent: IPV4_AGENT,
      timeout: 8000,
      headers: this.auth.getHeaders(),
    });

    return (resp.data?.data || []).map(t => ({
      id: String(t.tradeId || t.orderId),
      orderId: String(t.orderId),
      symbol: t.tradingSymbol || t.securityId,
      token: String(t.securityId),
      side: t.transactionType,
      qty: t.tradedQty || t.quantity || 0,
      price: t.tradedPrice || 0,
      executedAt: t.tradeTimestamp || t.exchangeTime || '',
    }));
  }

  async getFunds() {
    if (!this.auth.isTokenValid) throw new Error('[Dhan] Token invalid');

    const resp = await axios.get(`${DHAN_API_BASE}/fundlimit`, {
      httpsAgent: IPV4_AGENT,
      timeout: 8000,
      headers: this.auth.getHeaders(),
    });

    const data = resp.data?.data || resp.data || {};
    return {
      balance: parseFloat(data.availabelBalance || data.availableBalance || data.sodLimit || 0),
      availableMargin: parseFloat(data.availabelBalance || data.availableBalance || 0),
      usedMargin: parseFloat(data.utilizedAmount || data.blockedMargin || 0),
      realizedPnl: parseFloat(data.realizedMTM || 0),
      unrealizedPnl: parseFloat(data.unrealizedMTM || 0),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  _mapExchange(exchange) {
    const map = {
      'NSE': 'NSE_EQ', 'BSE': 'BSE_EQ', 'NFO': 'NSE_FNO',
      'BFO': 'BSE_FNO', 'MCX': 'MCX_COMM', 'CDS': 'CUR',
    };
    return map[exchange] || exchange || 'NSE_EQ';
  }

  _mapProduct(product) {
    const map = { 'MIS': 'INTRADAY', 'CNC': 'CNC', 'NRML': 'MARGIN', 'BO': 'BO', 'CO': 'CO' };
    return map[product] || product || 'INTRADAY';
  }

  _mapOrderType(type) {
    const map = { 'MARKET': 'MARKET', 'LIMIT': 'LIMIT', 'SL': 'STOP_LOSS', 'SL-M': 'STOP_LOSS_MARKET' };
    return map[type] || type || 'MARKET';
  }

  _mapStatus(status) {
    const map = {
      'TRANSIT': 'PENDING', 'PENDING': 'OPEN', 'TRADED': 'FILLED',
      'CANCELLED': 'CANCELLED', 'REJECTED': 'REJECTED', 'EXPIRED': 'CANCELLED',
    };
    return map[status] || status || 'PENDING';
  }

  _transformDepth(token, data) {
    // Dhan depth data transformation
    const depth = data[token] || data;
    return {
      token: String(token),
      bids: (depth.buy || []).slice(0, 5).map(b => ({
        price: parseFloat(b.price || 0),
        qty: parseInt(b.quantity || b.qty || 0),
        orders: parseInt(b.orders || 0),
      })),
      asks: (depth.sell || []).slice(0, 5).map(a => ({
        price: parseFloat(a.price || 0),
        qty: parseInt(a.quantity || a.qty || 0),
        orders: parseInt(a.orders || 0),
      })),
      totalBuyQty: parseInt(depth.totalBuyQty || 0),
      totalSellQty: parseInt(depth.totalSellQty || 0),
    };
  }
}
