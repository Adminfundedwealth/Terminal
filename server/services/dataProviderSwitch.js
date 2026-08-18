/**
 * DATA PROVIDER SWITCH — Dhan Primary, Angel One Fallback
 * 
 * Routes all market data requests to Dhan first.
 * If Dhan fails → falls back to Angel One (existing services).
 * 
 * Used by: /api/market/history, /api/market/option-chain, /tv/history
 */

import { DhanAdapter } from '../brokers/dhan/dhan.adapter.js';

export class DataProviderSwitch {
  constructor(angelCandleService, angelOptionChainService) {
    this._angelCandle = angelCandleService;
    this._angelOptionChain = angelOptionChainService;
    this._dhan = new DhanAdapter();
    this._dhanReady = false;
  }

  async initialize() {
    if (!process.env.DHAN_CLIENT_ID || !process.env.DHAN_ACCESS_TOKEN) {
      console.warn('[DataProvider] No Dhan credentials — using Angel One only');
      return;
    }

    try {
      await this._dhan.connect();
      this._dhanReady = true;
      console.log('[DataProvider] ✓ Dhan connected — primary data source active');
    } catch (err) {
      console.error('[DataProvider] Dhan connect failed:', err.message);
      console.warn('[DataProvider] Falling back to Angel One');
    }
  }

  /**
   * Get historical candles — Dhan first, Angel fallback.
   */
  async getHistoricalCandles(token, timeframe, exchange, fromTimestamp, toTimestamp) {
    // Try Dhan
    if (this._dhanReady) {
      try {
        const candles = await this._dhan.getHistoricalData(token, exchange, timeframe, fromTimestamp, toTimestamp);
        if (candles && candles.length > 0) {
          return { data: candles, provider: 'DHAN' };
        }
        // Empty but no error — could be market closed, try Angel
      } catch (err) {
        console.warn(`[DataProvider] Dhan historical failed for ${token}/${timeframe}: ${err.message}`);
      }
    }

    // Fallback to Angel One
    if (this._angelCandle) {
      try {
        const candles = await this._angelCandle.getHistoricalCandles(token, timeframe, exchange, fromTimestamp, toTimestamp);
        if (candles && candles.length > 0) {
          return { data: candles, provider: 'ANGELONE' };
        }
      } catch (err) {
        console.warn(`[DataProvider] Angel historical also failed: ${err.message}`);
      }
    }

    return { data: [], provider: 'NONE' };
  }

  /**
   * Get option chain — Angel One (Dhan option chain has format issues).
   * Will switch to Dhan once the endpoint date format is resolved.
   */
  async getOptionChain(symbol, expiry) {
    // For now, use Angel One for option chain (Dhan returns 400 on dates)
    if (this._angelOptionChain) {
      try {
        await this._angelOptionChain._ensureToken();
        if (this._angelOptionChain.jwtToken) {
          const chain = await this._angelOptionChain.getOptionChain(symbol, expiry);
          return { data: chain || [], provider: 'ANGELONE' };
        }
      } catch (err) {
        console.warn(`[DataProvider] Angel option chain failed: ${err.message}`);
      }
    }
    return { data: [], provider: 'NONE' };
  }

  /**
   * Get expiries — Angel One (working).
   */
  async getExpiries(symbol) {
    if (this._angelOptionChain) {
      try {
        await this._angelOptionChain._ensureToken();
        if (this._angelOptionChain.jwtToken) {
          const expiries = await this._angelOptionChain.getExpiries(symbol);
          return { data: expiries || [], provider: 'ANGELONE' };
        }
      } catch (err) {
        console.warn(`[DataProvider] Angel expiries failed: ${err.message}`);
      }
    }
    return { data: [], provider: 'NONE' };
  }

  getStatus() {
    return {
      primaryProvider: 'DHAN',
      activeProvider: this._dhanReady ? 'DHAN' : 'ANGELONE',
      dhanReady: this._dhanReady,
      failoverActive: !this._dhanReady,
    };
  }

  getDhanAdapter() { return this._dhan; }
}
