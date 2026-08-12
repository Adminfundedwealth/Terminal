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
    // ── LTP validation guard ────────────────────────────────────────────────
    // A quote with an invalid LTP (zero, negative, NaN, Infinity) MUST NOT
    // enter the quote cache, the event bus, or any downstream consumer
    // (MTM, risk engine, order execution). Allowing a zero LTP causes fake
    // losses of (0 − avgPrice) × qty which can lock or breach an account.
    if (data.ltp !== undefined && data.ltp !== null) {
      if (!Number.isFinite(data.ltp) || data.ltp <= 0) {
        // Parser already logs INVALID_LTP — do not double-log here.
        return;
      }
    }

    const existing = this.quotes.get(token);
    const merged = existing ? { ...existing, ...data } : data;
    this.quotes.set(token, merged);
    if (!this.isLive) { this.isLive = true; }
    this._tickCount++;
    this._lastTickTime = Date.now();

    // Publish to event bus — primary producer for market.tick channel.
    // Only publish when the merged quote has a valid positive LTP.
    if (merged.ltp !== undefined && merged.ltp !== null &&
        Number.isFinite(merged.ltp) && merged.ltp > 0) {
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

  /**
   * Returns true when a stored quote is valid for use in MTM and risk.
   * A quote is valid when:
   *   - it exists in the cache
   *   - its LTP is a finite positive number
   *   - it is not older than MAX_QUOTE_AGE_MS
   *
   * MAX_QUOTE_AGE_MS is set to 2 minutes (120 000 ms).
   * Rationale: Angel One SmartStream sends ticks every 1–3 seconds during
   * market hours. A gap of 2 minutes means either the feed is stale or the
   * instrument has genuinely stopped trading (circuit hit, halt). In both
   * cases using a 2-minute-old price for risk decisions is unsafe.
   */
  isQuoteValid(token) {
    const MAX_QUOTE_AGE_MS = 120_000; // 2 minutes
    const q = this.quotes.get(token);
    if (!q) return false;
    if (!q.ltp || !Number.isFinite(q.ltp) || q.ltp <= 0) return false;
    if (!q.timestamp) return false;
    if (Date.now() - q.timestamp > MAX_QUOTE_AGE_MS) return false;
    return true;
  }

  /**
   * Returns the LTP for a token if it is currently valid, otherwise null.
   * Callers must treat null as "data unavailable" — never substitute 0.
   */
  getSafeLtp(token) {
    if (!this.isQuoteValid(token)) return null;
    return this.quotes.get(token).ltp;
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
