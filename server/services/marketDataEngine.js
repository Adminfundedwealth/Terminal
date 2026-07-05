import { eventBus } from '../events/index.js';

export class MarketDataEngine {
  constructor() {
    this.subscribers = new Map();
    this.depthSubscribers = new Map();
    this.quotes = new Map();
    this.depthCache = new Map();
    this.adapter = null;
    this.isLive = false;
    this.adapterName = null;
    this._tickCount = 0;
    this._feedStale = false;
  }

  async initialize() {}

  connectAdapter(name) {
    this.adapterName = name;
    this.adapter = { name };
    this.isLive = true;
  }

  subscribe(token, cb) {
    if (!this.subscribers.has(token)) this.subscribers.set(token, new Set());
    this.subscribers.get(token).add(cb);
    const c = this.quotes.get(token);
    if (c) cb({ type: 'quote', token, data: c });
  }

  unsubscribe(token, cb) {
    const s = this.subscribers.get(token);
    if (s) { s.delete(cb); if (s.size === 0) { this.subscribers.delete(token); } }
  }

  subscribeDepth(token, cb) {
    if (!this.depthSubscribers.has(token)) this.depthSubscribers.set(token, new Set());
    this.depthSubscribers.get(token).add(cb);
    const c = this.depthCache.get(token);
    if (c) cb({ type: 'depth', token, data: c });
  }

  unsubscribeDepth(token, cb) {
    const s = this.depthSubscribers.get(token);
    if (s) { s.delete(cb); if (s.size === 0) this.depthSubscribers.delete(token); }
  }

  getQuote(token) { return this.quotes.get(token) || null; }

  getAllQuotes() { return this.quotes; }

  getDepth(token) { return this.depthCache.get(token) || { bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 }; }

  async getHistoricalData(token, tf, from, to) { return []; }

  async getOptionChain(symbol, expiry) { return []; }

  pushQuote(token, data) {
    const existing = this.quotes.get(token);
    const merged = existing ? { ...existing, ...data } : data;
    this.quotes.set(token, merged);
    if (!this.isLive) { this.isLive = true; }
    this._tickCount++;
    this._lastTickTime = Date.now();

    // Publish to event bus — primary producer for market.tick channel
    // Only publish if LTP is present (skip metadata-only updates)
    if (merged.ltp !== undefined && merged.ltp !== null) {
      eventBus.publish('market.tick', {
        token,
        ltp: merged.ltp,
        open: merged.open,
        high: merged.high,
        low: merged.low,
        close: merged.close,
        volume: merged.volume,
        change: merged.change,
        changePercent: merged.changePercent,
        bid: merged.bid,
        ask: merged.ask,
        oi: merged.oi,
        timestamp: merged.timestamp || Date.now(),
      });
    }

    const s = this.subscribers.get(token);
    if (s) s.forEach(cb => cb({ type: 'quote', token, data: merged }));
  }

  pushDepth(token, data) {
    this.depthCache.set(token, data);
    const s = this.depthSubscribers.get(token);
    if (s) s.forEach(cb => cb({ type: 'depth', token, data }));
  }

  setFeedStale(stale) {
    this._feedStale = !!stale;
    if (stale) {
      this.isLive = false;
      eventBus.publish('market.feedStatus', { status: 'stale', timestamp: Date.now() });
    } else {
      this.isLive = true;
      eventBus.publish('market.feedStatus', { status: 'live', timestamp: Date.now() });
    }
  }

  isFeedStale() {
    return !!this._feedStale;
  }

  getStatus() {
    return {
      isLive: this.isLive,
      adapterConnected: this.isLive,
      adapterName: this.adapterName,
      subscribedTokens: this.subscribers.size,
      cachedQuotes: this.quotes.size,
      tickCount: this._tickCount,
      feedStale: !!this._feedStale,
    };
  }

  destroy() {
    this.subscribers.clear();
    this.depthSubscribers.clear();
    this.quotes.clear();
    this.depthCache.clear();
    this.isLive = false;
  }
}
