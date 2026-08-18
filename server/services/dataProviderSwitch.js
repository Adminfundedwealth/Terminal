/**
 * DATA PROVIDER SWITCH — Dhan Primary, Angel One Fallback
 * 
 * ALL chart/market data goes through Dhan first.
 * If Dhan fails → logs the EXACT error → falls back to Angel One.
 * Exposes full diagnostic info via getStatus().
 */

import { DhanAdapter } from '../brokers/dhan/dhan.adapter.js';

export class DataProviderSwitch {
  constructor(angelCandleService, angelOptionChainService) {
    this._angelCandle = angelCandleService;
    this._angelOptionChain = angelOptionChainService;
    this._dhan = new DhanAdapter();
    this._dhanReady = false;

    // Diagnostic tracking
    this._lastDhanError = null;
    this._dhanErrorCount = 0;
    this._dhanSuccessCount = 0;
    this._lastRequest = null;
  }

  async initialize() {
    if (!process.env.DHAN_CLIENT_ID || !process.env.DHAN_ACCESS_TOKEN) {
      this._lastDhanError = { time: Date.now(), msg: 'DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not set in env' };
      console.error('[DataProvider] FATAL: No Dhan credentials in environment');
      return;
    }

    try {
      await this._dhan.connect();
      this._dhanReady = true;
      console.log('[DataProvider] ✓ Dhan connected — primary data source ACTIVE');
    } catch (err) {
      this._lastDhanError = { time: Date.now(), msg: err.message, phase: 'connect' };
      console.error('[DataProvider] Dhan connect FAILED:', err.message);
      console.error('[DataProvider] Will use Angel One as fallback');
    }
  }

  /**
   * Historical candles — Dhan first, Angel fallback.
   * Logs full error details on Dhan failure.
   */
  async getHistoricalCandles(token, timeframe, exchange, fromTimestamp, toTimestamp) {
    this._lastRequest = { type: 'historical', token, timeframe, exchange, from: fromTimestamp, to: toTimestamp, time: Date.now() };

    if (this._dhanReady) {
      try {
        const candles = await this._dhan.getHistoricalData(token, exchange, timeframe, fromTimestamp, toTimestamp);
        console.log(`[DataProvider] Dhan returned ${candles?.length || 0} candles for ${token}/${timeframe}/${exchange}`);
        if (candles && candles.length > 0) {
          this._dhanSuccessCount++;
          return { data: candles, provider: 'DHAN' };
        }
        // Empty response — not necessarily an error (market closed, weekend, etc.)
      } catch (err) {
        this._dhanErrorCount++;
        const errDetail = {
          time: Date.now(),
          endpoint: 'charts/' + ((['1','3','5','15','30','60'].includes(timeframe)) ? 'intraday' : 'historical'),
          token, exchange, timeframe,
          status: err.response?.status || 'NETWORK',
          response: err.response?.data || err.message,
          msg: err.message,
        };
        this._lastDhanError = errDetail;
        console.error(`[DataProvider] DHAN HISTORICAL FAILED:`, JSON.stringify(errDetail));
      }
    }

    // Fallback: Angel One
    if (this._angelCandle) {
      try {
        const candles = await this._angelCandle.getHistoricalCandles(token, timeframe, exchange, fromTimestamp, toTimestamp);
        if (candles && candles.length > 0) {
          return { data: candles, provider: 'ANGELONE' };
        }
      } catch (err) {
        console.error(`[DataProvider] Angel historical also failed: ${err.message}`);
      }
    }

    return { data: [], provider: 'NONE' };
  }

  /**
   * Option chain — Dhan first (with correct headers), Angel fallback.
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
          time: Date.now(), endpoint: 'optionchain',
          symbol, expiry,
          status: err.response?.status || 'NETWORK',
          response: err.response?.data || err.message,
          msg: err.message,
        };
        console.error(`[DataProvider] DHAN OPTIONCHAIN FAILED:`, JSON.stringify(this._lastDhanError));
      }
    }

    // Fallback: Angel One — ALWAYS try this if Dhan fails
    if (this._angelOptionChain) {
      try {
        await this._angelOptionChain._ensureToken();
        if (this._angelOptionChain.jwtToken) {
          const chain = await this._angelOptionChain.getOptionChain(symbol, expiry);
          if (chain && chain.length > 0) {
            return { data: chain, provider: 'ANGELONE' };
          }
        }
      } catch (err) {
        console.error(`[DataProvider] Angel option chain also failed: ${err.message}`);
      }
    }
    return { data: [], provider: 'NONE' };
  }

  /**
   * Expiries — Dhan first, Angel fallback.
   */
  async getExpiries(symbol) {
    if (this._dhanReady) {
      try {
        const expiries = await this._dhan.getExpiries(symbol);
        if (expiries && expiries.length > 0) {
          this._dhanSuccessCount++;
          return { data: expiries, provider: 'DHAN' };
        }
      } catch (err) {
        this._dhanErrorCount++;
        this._lastDhanError = {
          time: Date.now(), endpoint: 'optionchain/expirylist', symbol,
          status: err.response?.status, response: err.response?.data || err.message,
        };
        console.error(`[DataProvider] DHAN EXPIRY FAILED:`, err.response?.data || err.message);
      }
    }

    // Fallback
    if (this._angelOptionChain) {
      try {
        await this._angelOptionChain._ensureToken();
        if (this._angelOptionChain.jwtToken) {
          const expiries = await this._angelOptionChain.getExpiries(symbol);
          return { data: expiries || [], provider: 'ANGELONE' };
        }
      } catch (_) {}
    }
    return { data: [], provider: 'NONE' };
  }

  /**
   * Full diagnostic status — exposed via /api/provider/status
   */
  getStatus() {
    return {
      primaryProvider: 'DHAN',
      activeProvider: this._dhanReady ? 'DHAN' : 'ANGELONE',
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
