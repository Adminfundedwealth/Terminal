/**
 * DATA PROVIDER — 100% DHAN (Unified Data + Execution)
 * 
 * Dhan is the SINGLE source for:
 *   - Historical Charts (intraday + daily)
 *   - Option Chain (expiries + strikes + Greeks)
 *   - Live LTP (via poller in MarketDataEngine)
 *   - Order Execution (place, modify, cancel, positions)
 * 
 * Angel One is available ONLY as:
 *   - Fallback broker adapter (if Dhan execution fails)
 *   - Fallback data source (if Dhan returns empty)
 * 
 * If Dhan data fails, return empty — do NOT mix Angel data into charts.
 */

import { DhanAdapter } from '../brokers/dhan/dhan.adapter.js';

export class DataProviderSwitch {
  constructor(angelCandleService, angelOptionChainService) {
    this._angelCandle = angelCandleService;
    this._angelOptionChain = angelOptionChainService;
    this._dhan = new DhanAdapter();
    this._dhanReady = false;
    this._dhanSuccessCount = 0;
    this._dhanErrorCount = 0;
    this._lastDhanError = null;
    this._lastRequest = null;
  }

  async initialize() {
    if (!process.env.DHAN_CLIENT_ID || !process.env.DHAN_ACCESS_TOKEN) {
      this._lastDhanError = { time: Date.now(), msg: 'DHAN credentials not set' };
      console.error('[DataProvider] FATAL: No Dhan credentials');
      return;
    }

    try {
      await this._dhan.connect();
      this._dhanReady = true;
      console.log('[DataProvider] ✓ DHAN CONNECTED — exclusive data source');
    } catch (err) {
      this._lastDhanError = { time: Date.now(), msg: err.message, phase: 'connect' };
      console.error('[DataProvider] Dhan connect FAILED:', err.message);
    }
  }

  /**
   * Historical candles — DHAN ONLY.
   * If Dhan fails, fall back to Angel to prevent empty charts.
   */
  async getHistoricalCandles(token, timeframe, exchange, fromTimestamp, toTimestamp) {
    this._lastRequest = { type: 'historical', token, timeframe, exchange, from: fromTimestamp, to: toTimestamp, time: Date.now() };

    if (this._dhanReady) {
      try {
        const candles = await this._dhan.getHistoricalData(token, exchange, timeframe, fromTimestamp, toTimestamp);
        if (candles && candles.length > 0) {
          this._dhanSuccessCount++;
          return { data: candles, provider: 'DHAN' };
        }
        console.log(`[DataProvider] Dhan returned 0 candles for ${token}/${timeframe} — trying Angel fallback`);
      } catch (err) {
        this._dhanErrorCount++;
        this._lastDhanError = {
          time: Date.now(), endpoint: 'charts', token, exchange, timeframe,
          status: err.response?.status, response: err.response?.data || err.message,
        };
        console.error(`[DataProvider] Dhan historical error: ${err.message}`);
      }
    }

    // Fallback only when Dhan returns empty or errors
    if (this._angelCandle) {
      try {
        const candles = await this._angelCandle.getHistoricalCandles(token, timeframe, exchange, fromTimestamp, toTimestamp);
        if (candles && candles.length > 0) {
          return { data: candles, provider: 'ANGELONE_FALLBACK' };
        }
      } catch (_) {}
    }
    return { data: [], provider: 'NONE' };
  }

  /**
   * Option chain — Dhan first, Angel fallback (Dhan OC may still 401).
   */
  async getOptionChain(symbol, expiry) {
    this._lastRequest = { type: 'optionchain', symbol, expiry, time: Date.now() };

    if (this._dhanReady) {
      try {
        const chain = await this._dhan.getOptionChain(symbol, expiry);
        if (chain && chain.length > 0) {
          this._dhanSuccessCount++;
          return { data: chain, provider: 'DHAN' };
        }
      } catch (err) {
        this._dhanErrorCount++;
        this._lastDhanError = {
          time: Date.now(), endpoint: 'optionchain', symbol, expiry,
          status: err.response?.status, response: err.response?.data || err.message,
        };
      }
    }

    // Fallback to Angel for option chain
    if (this._angelOptionChain) {
      try {
        await this._angelOptionChain._ensureToken();
        if (this._angelOptionChain.jwtToken) {
          const chain = await this._angelOptionChain.getOptionChain(symbol, expiry);
          if (chain && chain.length > 0) {
            return { data: chain, provider: 'ANGELONE_FALLBACK' };
          }
        }
      } catch (_) {}
    }
    return { data: [], provider: 'NONE' };
  }

  /**
   * Expiries — Dhan first (works), Angel fallback.
   */
  async getExpiries(symbol) {
    this._lastRequest = { type: 'expiries', symbol, time: Date.now() };

    if (this._dhanReady) {
      try {
        const expiries = await this._dhan.getExpiries(symbol);
        if (expiries && expiries.length > 0) {
          this._dhanSuccessCount++;
          return { data: expiries, provider: 'DHAN' };
        }
      } catch (err) {
        this._dhanErrorCount++;
        this._lastDhanError = { time: Date.now(), endpoint: 'expirylist', symbol, msg: err.message };
      }
    }

    if (this._angelOptionChain) {
      try {
        await this._angelOptionChain._ensureToken();
        if (this._angelOptionChain.jwtToken) {
          const expiries = await this._angelOptionChain.getExpiries(symbol);
          return { data: expiries || [], provider: 'ANGELONE_FALLBACK' };
        }
      } catch (_) {}
    }
    return { data: [], provider: 'NONE' };
  }

  getStatus() {
    return {
      primaryProvider: 'DHAN',
      activeProvider: this._dhanReady ? 'DHAN' : 'ANGELONE_FALLBACK',
      dhanReady: this._dhanReady,
      dhanSuccessCount: this._dhanSuccessCount,
      dhanErrorCount: this._dhanErrorCount,
      lastDhanError: this._lastDhanError,
      lastRequest: this._lastRequest,
      dhanTokenValid: this._dhan?.auth?.isTokenValid || false,
      dhanClientId: process.env.DHAN_CLIENT_ID || 'NOT SET',
      dhanTokenSet: !!process.env.DHAN_ACCESS_TOKEN,
    };
  }

  getDhanAdapter() { return this._dhan; }
}
