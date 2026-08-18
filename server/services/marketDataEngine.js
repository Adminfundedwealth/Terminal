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
   * Universal LTP resolver — NEVER returns 0 for a valid instrument.
   * 
   * Fallback chain:
   *   1. Live WebSocket cache (Angel One feed)
   *   2. Dhan quote API (if dataProviderSwitch available)
   *   3. Last 1m candle close price
   *   4. Depth bid/ask midpoint
   * 
   * Call setLtpFallbacks() to inject dependencies.
   */
  async getLivePrice(token, segment) {
    // 1. WebSocket cache
    const q = this.quotes.get(token);
    if (q?.ltp && Number.isFinite(q.ltp) && q.ltp > 0) {
      return q.ltp;
    }

    // 2. Dhan quote API
    if (this._dhanAdapter) {
      try {
        const dhanSeg = segment === 'NFO' ? 'NSE_FNO' : segment === 'MCX' ? 'MCX_COMM' : segment === 'CDS' ? 'NSE_CURRENCY' : 'NSE_EQ';
        const result = await this._dhanAdapter.getQuote(token, dhanSeg);
        const ltp = result?.ltp || result?.last_price;
        if (ltp && Number.isFinite(ltp) && ltp > 0) {
          // Also push into cache so subsequent calls are instant
          this.pushQuote(token, { ltp, timestamp: Date.now(), symbol: q?.symbol, exchange: q?.exchange });
          return ltp;
        }
      } catch (_) {}
    }

    // 3. Last candle close
    if (this._candleService) {
      const candle = this._candleService.getCurrentCandle(token, '1');
      if (candle?.close && candle.close > 0) return candle.close;
    }

    // 4. Depth midpoint
    const depth = this.depthCache.get(token);
    if (depth?.bids?.[0]?.price && depth?.asks?.[0]?.price) {
      const mid = (depth.bids[0].price + depth.asks[0].price) / 2;
      if (mid > 0) return mid;
    }

    return null; // All fallbacks exhausted
  }

  /**
   * Inject fallback services for getLivePrice.
   * Called from server/index.js after initialization.
   */
  setLtpFallbacks(dhanAdapter, candleService) {
    this._dhanAdapter = dhanAdapter;
    this._candleService = candleService;

    // Start Dhan LTP poller — Dhan is the SOLE source of truth for live prices
    this._startDhanLtpPoller();
  }

  /**
   * Dhan LTP Poller — fetches CORRECT prices from Dhan every 3 seconds
   * for ALL actively subscribed tokens. Overrides ANY Angel tick.
   * Dhan is the SINGLE source of truth.
   */
  _startDhanLtpPoller() {
    if (!this._dhanAdapter) return;
    if (this._dhanPollerInterval) return;

    this._dhanPollerInterval = setInterval(async () => {
      if (!this._dhanAdapter?.auth?.isTokenValid) return;

      const activeTokens = [...this.subscribers.keys()];
      if (activeTokens.length === 0) return;

      try {
        const nseTokens = activeTokens.filter(t => /^\d+$/.test(t)).slice(0, 100);
        if (nseTokens.length === 0) return;

        const quotes = await this._dhanAdapter.getQuotes(nseTokens);
        if (!quotes || quotes.length === 0) return;

        for (const q of quotes) {
          if (q.ltp && q.ltp > 0 && q.token) {
            const existing = this.quotes.get(q.token);
            this.pushQuote(q.token, {
              ...existing,
              ltp: q.ltp,
              volume: q.volume || existing?.volume,
              oi: q.oi || existing?.oi,
              timestamp: Date.now(),
            });
          }
        }
      } catch (_) {}
    }, 3000); // Every 3 seconds — fast enough for live trading
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
