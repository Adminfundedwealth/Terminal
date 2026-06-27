/**
 * TRADINGVIEW DATAFEED LAYER
 * 
 * Implements the server-side component that powers the TradingView
 * charting library's IExternalDatafeed interface.
 * 
 * Methods exposed via REST endpoints:
 *   resolveSymbol(symbolName)     → SymbolInfo object
 *   searchSymbols(query, type)    → matching symbols
 *   getBars(symbol, resolution, from, to) → OHLCV candles
 * 
 * Real-time updates are pushed via Socket.IO:
 *   subscribeBars(symbol, resolution) → start streaming updates
 *   unsubscribeBars(listenerGuid)     → stop streaming
 * 
 * This module bridges the instrument service + market data engine
 * to TradingView's expected data format.
 */

export class TradingViewDatafeed {
  constructor(instrumentService, marketDataEngine) {
    this.instrumentService = instrumentService;
    this.marketDataEngine = marketDataEngine;
    this._barSubscriptions = new Map(); // guid -> { token, resolution, callback }
  }

  /**
   * resolveSymbol — Convert symbol name to TradingView SymbolInfo.
   * Called by the chart when a symbol is loaded.
   * 
   * @param {string} symbolName - e.g. "RELIANCE", "NIFTY FUT", "GOLD"
   * @returns {object} TradingView SymbolInfo
   */
  resolveSymbol(symbolName) {
    const instruments = this.instrumentService.search(symbolName);
    const instrument = instruments.find(
      (i) => i.symbol.toUpperCase() === symbolName.toUpperCase()
    ) || instruments[0];

    if (!instrument) {
      return null;
    }

    return {
      name: instrument.symbol,
      full_name: `${instrument.exchange}:${instrument.symbol}`,
      description: instrument.name,
      type: this._getSymbolType(instrument),
      session: this._getSession(instrument.segment),
      exchange: instrument.exchange,
      listed_exchange: instrument.exchange,
      timezone: 'Asia/Kolkata',
      format: 'price',
      pricescale: this._getPricescale(instrument),
      minmov: 1,
      has_intraday: true,
      has_daily: true,
      has_weekly_and_monthly: true,
      supported_resolutions: ['1', '3', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
      volume_precision: 0,
      data_status: 'streaming',
      sector: instrument.segment,
      industry: instrument.instrumentType,
      // Custom fields for our use
      token: instrument.token,
      segment: instrument.segment,
      lotSize: instrument.lotSize,
      tickSize: instrument.tickSize,
      expiry: instrument.expiry || null,
    };
  }

  /**
   * searchSymbols — Search instruments by query.
   * Called by the chart's symbol search dialog.
   * 
   * @param {string} query - Search text
   * @param {string} type - Filter by type (stock, futures, etc.)
   * @param {string} exchange - Filter by exchange
   * @returns {Array} Matching symbols
   */
  searchSymbols(query, type, exchange) {
    if (!query || query.length < 1) return [];

    let results = this.instrumentService.search(query);

    // Filter by type if provided
    if (type) {
      const typeMap = {
        'stock': 'EQ',
        'futures': 'FUT',
        'option': ['CE', 'PE'],
        'index': 'EQ', // Indices are EQ type in our system
      };
      const instrumentType = typeMap[type.toLowerCase()];
      if (instrumentType) {
        if (Array.isArray(instrumentType)) {
          results = results.filter((r) => instrumentType.includes(r.instrumentType));
        } else {
          results = results.filter((r) => r.instrumentType === instrumentType);
        }
      }
    }

    // Filter by exchange
    if (exchange) {
      results = results.filter((r) => r.exchange === exchange || r.segment === exchange);
    }

    return results.map((inst) => ({
      symbol: inst.symbol,
      full_name: `${inst.exchange}:${inst.symbol}`,
      description: inst.name,
      exchange: inst.exchange,
      type: this._getSymbolType(inst),
      ticker: inst.token,
    }));
  }

  /**
   * getBars — Get historical OHLCV candles.
   * Called by the chart on load and scroll.
   * 
   * @param {string} token - Instrument token
   * @param {string} resolution - Timeframe (1, 5, 15, 60, D, etc.)
   * @param {number} from - Start timestamp (seconds)
   * @param {number} to - End timestamp (seconds)
   * @returns {object} { bars: [{time, open, high, low, close, volume}], noData: boolean }
   */
  async getBars(token, resolution, from, to) {
    try {
      const bars = await this.marketDataEngine.getHistoricalData(token, resolution, from, to);

      if (!bars || bars.length === 0) {
        return { bars: [], noData: true };
      }

      // Ensure bars are sorted by time ascending
      const sortedBars = bars.sort((a, b) => a.time - b.time);

      // Filter by requested range
      const filteredBars = sortedBars.filter((bar) => {
        return bar.time >= from && bar.time <= to;
      });

      return {
        bars: filteredBars.map((bar) => ({
          time: bar.time * 1000, // TradingView expects milliseconds
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume || 0,
        })),
        noData: filteredBars.length === 0,
      };
    } catch (err) {
      console.error(`[TV Datafeed] getBars error for ${token}:`, err.message);
      return { bars: [], noData: true };
    }
  }

  /**
   * subscribeBars — Subscribe to real-time bar updates for a symbol.
   * Returns a unique subscription GUID for later unsubscription.
   * 
   * @param {string} token - Instrument token
   * @param {string} resolution - Timeframe
   * @param {Function} callback - Called with new/updated bar data
   * @returns {string} subscriptionGuid
   */
  subscribeBars(token, resolution, callback) {
    const guid = `${token}_${resolution}_${Date.now()}`;

    // Track the subscription
    this._barSubscriptions.set(guid, {
      token,
      resolution,
      callback,
      lastBar: null,
    });

    // Subscribe to market data engine quotes for this token
    const quoteHandler = (quoteEvent) => {
      const sub = this._barSubscriptions.get(guid);
      if (!sub) return;

      const quote = quoteEvent.data || quoteEvent;
      if (!quote || !quote.ltp) return;

      // Build/update the current bar
      const barTime = this._getBarTime(Date.now(), resolution);
      const bar = {
        time: barTime,
        open: sub.lastBar?.time === barTime ? sub.lastBar.open : quote.ltp,
        high: sub.lastBar?.time === barTime ? Math.max(sub.lastBar.high, quote.ltp) : quote.ltp,
        low: sub.lastBar?.time === barTime ? Math.min(sub.lastBar.low, quote.ltp) : quote.ltp,
        close: quote.ltp,
        volume: quote.volume || 0,
      };

      sub.lastBar = bar;
      callback(bar);
    };

    // Store the handler so we can unsubscribe later
    this._barSubscriptions.get(guid).quoteHandler = quoteHandler;
    this.marketDataEngine.subscribe(token, quoteHandler);

    return guid;
  }

  /**
   * unsubscribeBars — Stop streaming bar updates.
   * 
   * @param {string} guid - Subscription GUID from subscribeBars
   */
  unsubscribeBars(guid) {
    const sub = this._barSubscriptions.get(guid);
    if (!sub) return;

    // Unsubscribe from market data engine
    if (sub.quoteHandler) {
      this.marketDataEngine.unsubscribe(sub.token, sub.quoteHandler);
    }

    this._barSubscriptions.delete(guid);
  }

  // ─── Helper Methods ────────────────────────────────────────────

  /**
   * Get bar start time for a given timestamp and resolution.
   */
  _getBarTime(timestampMs, resolution) {
    const date = new Date(timestampMs);
    const resMinutes = this._resolutionToMinutes(resolution);

    if (resolution === 'D' || resolution === '1D') {
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    if (resolution === 'W' || resolution === '1W') {
      const day = date.getDay();
      date.setDate(date.getDate() - day);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    // Intraday
    const minutes = date.getHours() * 60 + date.getMinutes();
    const barMinute = Math.floor(minutes / resMinutes) * resMinutes;
    date.setHours(Math.floor(barMinute / 60), barMinute % 60, 0, 0);
    return date.getTime();
  }

  /**
   * Convert resolution string to minutes.
   */
  _resolutionToMinutes(resolution) {
    const map = { '1': 1, '3': 3, '5': 5, '15': 15, '30': 30, '60': 60, '240': 240, 'D': 1440, 'W': 10080 };
    return map[resolution] || parseInt(resolution) || 5;
  }

  /**
   * Map instrument to TradingView symbol type.
   */
  _getSymbolType(instrument) {
    switch (instrument.instrumentType) {
      case 'EQ': return instrument.token.startsWith('999') ? 'index' : 'stock';
      case 'FUT': return 'futures';
      case 'CE':
      case 'PE': return 'option';
      default: return 'stock';
    }
  }

  /**
   * Get trading session string for TradingView.
   */
  _getSession(segment) {
    switch (segment) {
      case 'MCX': return '0900-2330'; // MCX extended hours
      case 'CDS': return '0900-1700';
      default: return '0915-1530'; // NSE/BSE
    }
  }

  /**
   * Get price scale for TradingView (determines decimal places).
   */
  _getPricescale(instrument) {
    if (instrument.tickSize === 0.0025) return 10000; // Currency
    if (instrument.tickSize === 0.05) return 100;
    if (instrument.tickSize === 0.1) return 10;
    if (instrument.tickSize === 1) return 1;
    return 100;
  }

  /**
   * Get active subscription count.
   */
  getSubscriptionCount() {
    return this._barSubscriptions.size;
  }

  /**
   * Destroy all subscriptions.
   */
  destroy() {
    for (const [guid] of this._barSubscriptions) {
      this.unsubscribeBars(guid);
    }
    this._barSubscriptions.clear();
  }
}
