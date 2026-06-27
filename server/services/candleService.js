/**
 * CANDLE SERVICE
 * 
 * Provides historical OHLCV candles from Angel One REST API.
 * Aggregates live ticks into the current (latest) candle.
 * 
 * Used by: /api/market/history endpoint, TradingView Datafeed getBars
 * 
 * Angel One Historical API:
 *   POST /rest/secure/angelbroking/historical/v1/getCandleData
 *   Requires: exchange, symboltoken, interval, fromdate, todate
 */

import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';

config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Timeframe mapping: our format → Angel One interval
const TF_MAP = {
  '1': 'ONE_MINUTE',
  '3': 'THREE_MINUTE',
  '5': 'FIVE_MINUTE',
  '15': 'FIFTEEN_MINUTE',
  '30': 'THIRTY_MINUTE',
  '60': 'ONE_HOUR',
  '240': 'ONE_HOUR', // 4H not directly supported, use 1H and aggregate
  'D': 'ONE_DAY',
  'W': 'ONE_DAY', // Weekly not directly supported, use daily and aggregate
};

// Exchange mapping for token
const TOKEN_EXCHANGE_MAP = {
  'NSE': 'NSE',
  'NFO': 'NFO',
  'MCX': 'MCX',
  'CDS': 'CDS',
  'BSE': 'BSE',
};

export class CandleService {
  constructor(marketDataEngine) {
    this.marketDataEngine = marketDataEngine;
    this.jwtToken = null;
    this._refreshCallback = null; // function that returns a fresh JWT
    this.tokenExchangeCache = new Map(); // token -> exchange
    // Current candle state per token per timeframe
    this.currentCandles = new Map(); // `${token}:${tf}` → { time, open, high, low, close, volume }
  }

  /**
   * Set the JWT token for API calls (obtained from AngelFeedConnector session).
   */
  setAuthToken(token) {
    this.jwtToken = token;
  }

  /**
   * Set a callback that returns a fresh JWT when the current one is expired.
   * Called by index.js with a function that invokes angelFeed.ensureValidToken().
   * @param {function} fn - async function returning fresh JWT string
   */
  setRefreshCallback(fn) {
    this._refreshCallback = fn;
  }

  /**
   * Register a token's exchange for historical data lookups.
   */
  registerTokenExchange(token, exchange) {
    this.tokenExchangeCache.set(token, exchange);
  }

  /**
   * Get historical OHLCV candles from Angel One.
   * Returns array of { time (unix seconds), open, high, low, close, volume }
   */
  async getHistoricalCandles(token, timeframe, fromTimestamp, toTimestamp) {
    if (!this.jwtToken) {
      // Try to get a token via refresh callback
      if (this._refreshCallback) {
        try {
          this.jwtToken = await this._refreshCallback();
        } catch (e) { /* ignore */ }
      }
      if (!this.jwtToken) return [];
    }

    const interval = TF_MAP[timeframe];
    if (!interval) return [];

    const exchange = this.tokenExchangeCache.get(token) || 'NSE';

    // Format dates for Angel One API (yyyy-MM-dd HH:mm)
    const fromDate = this._formatDate(fromTimestamp ? new Date(fromTimestamp * 1000) : this._getDefaultFrom(timeframe));
    const toDate = this._formatDate(toTimestamp ? new Date(toTimestamp * 1000) : new Date());

    const makeRequest = async () => {
      const resp = await axios.post(
        `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
        {
          exchange,
          symboltoken: token,
          interval,
          fromdate: fromDate,
          todate: toDate,
        },
        {
          httpsAgent: IPV4_AGENT,
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': '127.0.0.1',
            'X-ClientPublicIP': '127.0.0.1',
            'X-MACAddress': '00:00:00:00:00:00',
            'X-PrivateKey': process.env.ANGEL_API_KEY,
            'Authorization': `Bearer ${this.jwtToken}`,
          },
        }
      );
      return resp;
    };

    try {
      let resp;
      try {
        resp = await makeRequest();
      } catch (err) {
        // On 403: refresh token and retry once
        if ((err.response?.status === 403 || err.response?.status === 401) && this._refreshCallback) {
          console.log(`[CandleService] Got ${err.response.status} — refreshing token and retrying`);
          try {
            this.jwtToken = await this._refreshCallback();
            resp = await makeRequest();
          } catch (retryErr) {
            console.error(`[CandleService] Retry failed for ${token}/${timeframe}:`, retryErr.response?.data?.message || retryErr.message);
            return [];
          }
        } else {
          throw err;
        }
      }

      const candles = resp.data?.data;
      if (!candles || !Array.isArray(candles)) return [];

      // Angel One returns: [[timestamp_str, open, high, low, close, volume], ...]
      return candles.map(c => ({
        time: Math.floor(new Date(c[0]).getTime() / 1000),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5] || 0,
      }));
    } catch (err) {
      console.error(`[CandleService] Historical fetch failed for ${token}/${timeframe}:`, err.response?.data?.message || err.message);
      return [];
    }
  }

  /**
   * Process a live tick and update the current candle for all active timeframes.
   * Returns updated candle if a new one started, null otherwise.
   */
  processLiveTick(token, ltp, volume, timestamp) {
    const timeframes = ['1', '5', '15'];
    const results = [];

    for (const tf of timeframes) {
      const key = `${token}:${tf}`;
      const candleTime = this._getCandleTime(timestamp || Date.now(), tf);

      const existing = this.currentCandles.get(key);

      if (!existing || existing.time !== candleTime) {
        // New candle started
        const newCandle = {
          time: candleTime,
          open: ltp,
          high: ltp,
          low: ltp,
          close: ltp,
          volume: volume || 0,
        };
        this.currentCandles.set(key, newCandle);
        results.push({ token, timeframe: tf, candle: newCandle, isNew: true });
      } else {
        // Update existing candle
        existing.high = Math.max(existing.high, ltp);
        existing.low = Math.min(existing.low, ltp);
        existing.close = ltp;
        if (volume) existing.volume = volume;
        results.push({ token, timeframe: tf, candle: { ...existing }, isNew: false });
      }
    }

    return results;
  }

  /**
   * Get current (live) candle for a token+timeframe.
   */
  getCurrentCandle(token, timeframe) {
    return this.currentCandles.get(`${token}:${timeframe}`) || null;
  }

  // ─── Helpers ──────────────────────────────────────────────

  _getCandleTime(timestampMs, resolution) {
    const date = new Date(timestampMs);
    const resMinutes = this._resolutionToMinutes(resolution);

    if (resolution === 'D') {
      date.setHours(0, 0, 0, 0);
      return Math.floor(date.getTime() / 1000);
    }

    const totalMinutes = date.getHours() * 60 + date.getMinutes();
    const candleMinute = Math.floor(totalMinutes / resMinutes) * resMinutes;
    date.setHours(Math.floor(candleMinute / 60), candleMinute % 60, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  _resolutionToMinutes(res) {
    const map = { '1': 1, '3': 3, '5': 5, '15': 15, '30': 30, '60': 60, '240': 240, 'D': 1440 };
    return map[res] || parseInt(res) || 5;
  }

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
  }

  _getDefaultFrom(timeframe) {
    const now = new Date();
    switch (timeframe) {
      case '1': case '3': case '5': return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days
      case '15': case '30': return new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000); // 15 days
      case '60': case '240': return new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days
      case 'D': case 'W': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 year
      default: return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  }
}
