/**
 * ANGEL ONE ADAPTER
 * 
 * Implements broker interface using Angel One SmartAPI REST endpoints.
 * Docs: https://smartapi.angelone.in/docs
 * 
 * Authentication: API Key + Client ID + Password + TOTP
 * Market Data: REST polling + WebSocket feed
 */

import axios from 'axios';
import { authenticator } from '@otplib/preset-default';
import { config } from 'dotenv';

config();

const BASE_URL = 'https://apiconnect.angelone.in';
const MARKET_URL = 'https://apiconnect.angelone.in';

export class AngelOneAdapter {
  constructor() {
    this.name = 'angelone';
    this.session = null;
    this.apiKey = process.env.ANGEL_API_KEY;
    this.clientId = process.env.ANGEL_CLIENT_ID;
    this.password = process.env.ANGEL_PASSWORD;
    this.totpSecret = process.env.ANGEL_TOTP_SECRET;
    this._isConnected = false;
    this.feedToken = null;
  }

  get isConnected() {
    return this._isConnected && this.session && this.session.expiresAt > Date.now();
  }

  /**
   * Connect to Angel One using TOTP-based login
   */
  async connect() {
    const totp = authenticator.generate(this.totpSecret);

    const response = await axios.post(`${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      clientcode: this.clientId,
      password: this.password,
      totp: totp,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': this.apiKey,
      },
    });

    if (!response.data || !response.data.data) {
      throw new Error(`Angel One login failed: ${response.data?.message || 'Unknown error'}`);
    }

    const data = response.data.data;
    this.session = {
      provider: 'angelone',
      clientId: this.clientId,
      token: data.jwtToken,
      refreshToken: data.refreshToken,
      feedToken: data.feedToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
    };
    this.feedToken = data.feedToken;
    this._isConnected = true;

    console.log(`[AngelOne] Connected as ${this.clientId}`);
    return this.session;
  }

  async disconnect() {
    if (!this.session) return;
    try {
      await this._request('POST', '/rest/secure/angelbroking/user/v1/logout', { clientcode: this.clientId });
    } catch (e) { /* ignore */ }
    this.session = null;
    this._isConnected = false;
  }

  async refreshSession() {
    if (!this.session?.refreshToken) throw new Error('No refresh token');
    const resp = await axios.post(`${BASE_URL}/rest/auth/angelbroking/jwt/v1/generateTokens`, {
      refreshToken: this.session.refreshToken,
    }, { headers: this._headers() });

    if (resp.data?.data) {
      this.session.token = resp.data.data.jwtToken;
      this.session.refreshToken = resp.data.data.refreshToken;
      this.session.feedToken = resp.data.data.feedToken;
      this.session.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      this.feedToken = resp.data.data.feedToken;
    }
    return this.session;
  }

  // ─── Market Data ───────────────────────────────────────────

  async getLTP(exchange, tradingsymbol, symboltoken) {
    const resp = await this._request('POST', '/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'LTP',
      exchangeTokens: { [exchange]: [symboltoken] },
    });
    return resp?.data?.fetched?.[0] || null;
  }

  async getQuotes(tokens) {
    // Group tokens by exchange (default NSE)
    const exchangeTokens = { NSE: [], NFO: [], MCX: [], CDS: [] };
    tokens.forEach(t => {
      if (t.includes('_F') && !t.includes('INR')) exchangeTokens.MCX.push(t);
      else if (t.includes('FUT')) exchangeTokens.NFO.push(t);
      else if (t.includes('INR')) exchangeTokens.CDS.push(t);
      else exchangeTokens.NSE.push(t);
    });

    // Remove empty exchanges
    Object.keys(exchangeTokens).forEach(k => { if (!exchangeTokens[k].length) delete exchangeTokens[k]; });

    const resp = await this._request('POST', '/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'FULL',
      exchangeTokens,
    });

    return (resp?.data?.fetched || []).map(q => ({
      token: q.symbolToken || q.symboltoken,
      symbol: q.tradingSymbol || q.tradingsymbol,
      ltp: q.ltp,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.tradeVolume || q.volume,
      change: q.ltp - q.close,
      changePercent: q.close ? ((q.ltp - q.close) / q.close) * 100 : 0,
      bid: q.bestBidPrice || q.ltp - 0.05,
      ask: q.bestAskPrice || q.ltp + 0.05,
      oi: q.opnInterest || 0,
      timestamp: Date.now(),
    }));
  }

  async getDepth(token) {
    const resp = await this._request('POST', '/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'FULL',
      exchangeTokens: { NSE: [token] },
    });

    const q = resp?.data?.fetched?.[0];
    if (!q || !q.depth) {
      return { token, bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 };
    }

    return {
      token,
      bids: (q.depth.buy || []).map(l => ({ price: l.price, qty: l.quantity, orders: l.orders || 0 })),
      asks: (q.depth.sell || []).map(l => ({ price: l.price, qty: l.quantity, orders: l.orders || 0 })),
      totalBuyQty: q.totBuyQuan || 0,
      totalSellQty: q.totSellQuan || 0,
    };
  }

  async getOHLC(token, exchange, timeframe, fromDate, toDate) {
    const tfMap = { '1': 'ONE_MINUTE', '3': 'THREE_MINUTE', '5': 'FIVE_MINUTE', '15': 'FIFTEEN_MINUTE', '30': 'THIRTY_MINUTE', '60': 'ONE_HOUR', 'D': 'ONE_DAY' };
    const interval = tfMap[timeframe] || 'FIVE_MINUTE';

    const resp = await this._request('POST', '/rest/secure/angelbroking/historical/v1/getCandleData', {
      exchange,
      symboltoken: token,
      interval,
      fromdate: fromDate,
      todate: toDate,
    });

    return (resp?.data?.data || []).map(c => ({
      time: Math.floor(new Date(c[0]).getTime() / 1000),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  }

  async getOptionChain(symbol, expiry) {
    // Angel One doesn't have a direct option chain API
    // We need to fetch option instruments and then get quotes for each strike
    // This will be handled by fetching individual quotes for CE/PE tokens
    return [];
  }

  // ─── Trading ───────────────────────────────────────────────

  async placeOrder(order) {
    const payload = {
      variety: 'NORMAL',
      tradingsymbol: order.symbol,
      symboltoken: order.token,
      transactiontype: order.side,
      exchange: order.exchange || order.segment || 'NSE',
      ordertype: order.orderType,
      producttype: this._mapProduct(order.productType),
      duration: 'DAY',
      price: order.price || '0',
      triggerprice: order.triggerPrice || '0',
      quantity: String(order.qty),
    };

    const resp = await this._request('POST', '/rest/secure/angelbroking/order/v1/placeOrder', payload);
    return {
      orderId: resp?.data?.orderid || resp?.data?.uniqueorderid || 'UNKNOWN',
      brokerOrderId: resp?.data?.orderid || '',
      status: resp?.data?.orderstatus || 'PENDING',
      message: resp?.message,
    };
  }

  async modifyOrder(orderId, params) {
    const payload = {
      variety: 'NORMAL',
      orderid: orderId,
      ordertype: params.orderType,
      producttype: params.productType ? this._mapProduct(params.productType) : undefined,
      price: params.price ? String(params.price) : undefined,
      triggerprice: params.triggerPrice ? String(params.triggerPrice) : undefined,
      quantity: params.qty ? String(params.qty) : undefined,
      duration: 'DAY',
    };

    const resp = await this._request('POST', '/rest/secure/angelbroking/order/v1/modifyOrder', payload);
    return { orderId, brokerOrderId: resp?.data?.orderid || orderId, status: 'MODIFIED' };
  }

  async cancelOrder(orderId) {
    const resp = await this._request('POST', '/rest/secure/angelbroking/order/v1/cancelOrder', {
      variety: 'NORMAL',
      orderid: orderId,
    });
    return { orderId, status: resp?.status ? 'cancelled' : 'failed' };
  }

  // ─── Portfolio ─────────────────────────────────────────────

  async getPositions() {
    const resp = await this._request('GET', '/rest/secure/angelbroking/order/v1/getPosition');
    return (resp?.data || []).map(p => ({
      id: p.symboltoken + '_' + p.producttype,
      symbol: p.tradingsymbol,
      token: p.symboltoken,
      segment: p.exchange,
      productType: p.producttype,
      qty: parseInt(p.netqty) || 0,
      avgPrice: parseFloat(p.averageprice) || 0,
      ltp: parseFloat(p.ltp) || 0,
      pnl: parseFloat(p.pnl) || 0,
      mtm: parseFloat(p.unrealised) || 0,
      buyQty: parseInt(p.buyqty) || 0,
      sellQty: parseInt(p.sellqty) || 0,
      buyAvg: parseFloat(p.buyavgprice) || 0,
      sellAvg: parseFloat(p.sellavgprice) || 0,
    }));
  }

  async getOrders() {
    const resp = await this._request('GET', '/rest/secure/angelbroking/order/v1/getOrderBook');
    return (resp?.data || []).map(o => ({
      id: o.orderid,
      symbol: o.tradingsymbol,
      token: o.symboltoken,
      segment: o.exchange,
      side: o.transactiontype,
      orderType: o.ordertype,
      productType: o.producttype,
      qty: parseInt(o.quantity) || 0,
      price: parseFloat(o.price) || 0,
      triggerPrice: parseFloat(o.triggerprice) || 0,
      filledQty: parseInt(o.filledshares) || 0,
      avgPrice: parseFloat(o.averageprice) || 0,
      status: this._mapStatus(o.orderstatus || o.status),
      timestamp: o.orderTimestamp || o.updatetime || new Date().toISOString(),
      message: o.text,
    }));
  }

  async getTrades() {
    const resp = await this._request('GET', '/rest/secure/angelbroking/order/v1/getTradeBook');
    return (resp?.data || []).map(t => ({
      id: t.tradeid || t.orderid,
      orderId: t.orderid,
      symbol: t.tradingsymbol,
      token: t.symboltoken,
      segment: t.exchange,
      side: t.transactiontype,
      qty: parseInt(t.fillsize || t.quantity) || 0,
      price: parseFloat(t.fillprice || t.averageprice) || 0,
      timestamp: t.filltime || t.updatetime || new Date().toISOString(),
    }));
  }

  async getFunds() {
    const resp = await this._request('GET', '/rest/secure/angelbroking/user/v1/getRMS');
    const d = resp?.data || {};
    return {
      balance: parseFloat(d.availablecash) || 0,
      availableMargin: parseFloat(d.net) || 0,
      usedMargin: parseFloat(d.utiliseddebits) || 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
    };
  }

  async getHoldings() {
    const resp = await this._request('GET', '/rest/secure/angelbroking/portfolio/v1/getHolding');
    return resp?.data || [];
  }

  // ─── Helpers ───────────────────────────────────────────────

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': this.apiKey,
      ...(this.session?.token ? { 'Authorization': `Bearer ${this.session.token}` } : {}),
    };
  }

  async _request(method, path, body) {
    if (!this.isConnected && !path.includes('login')) {
      await this.connect();
    }

    try {
      const opts = {
        method,
        url: `${BASE_URL}${path}`,
        headers: this._headers(),
        ...(body && method !== 'GET' ? { data: body } : {}),
      };

      const resp = await axios(opts);
      return resp.data;
    } catch (err) {
      if (err.response?.status === 401) {
        // Token expired — try refresh
        try {
          await this.refreshSession();
          const opts = {
            method,
            url: `${BASE_URL}${path}`,
            headers: this._headers(),
            ...(body && method !== 'GET' ? { data: body } : {}),
          };
          const resp = await axios(opts);
          return resp.data;
        } catch (refreshErr) {
          // Full reconnect
          await this.connect();
          throw err;
        }
      }
      throw err;
    }
  }

  _mapProduct(pt) {
    const map = { 'MIS': 'INTRADAY', 'CNC': 'DELIVERY', 'NRML': 'CARRYFORWARD', 'BO': 'BO', 'CO': 'CO' };
    return map[pt] || 'INTRADAY';
  }

  _mapStatus(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('complete') || s.includes('filled')) return 'FILLED';
    if (s.includes('open') || s.includes('pending') || s.includes('trigger pending')) return 'OPEN';
    if (s.includes('cancel')) return 'CANCELLED';
    if (s.includes('reject')) return 'REJECTED';
    return 'OPEN';
  }
}
