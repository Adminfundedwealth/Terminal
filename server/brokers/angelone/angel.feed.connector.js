/**
 * ANGEL FEED CONNECTOR
 * 
 * Connects to Angel One SmartStream WebSocket V2.
 * Parses binary tick data and publishes into MarketDataEngine.
 * 
 * Binary format (LTP mode, 51 bytes):
 *   Byte 0: subscription mode (1=LTP, 2=Quote, 3=SnapQuote)
 *   Byte 1: exchange type (1=NSE_CM, 2=NSE_FO, 3=BSE_CM, 5=MCX_FO, 7=NCX_FO, 13=CDE_FO)
 *   Bytes 2-26: token (25 bytes, null-padded ASCII)
 *   Bytes 27-34: sequence number (int64LE)
 *   Bytes 35-42: exchange timestamp (int64LE)
 *   Bytes 43-46: LTP (int32LE / 100)
 * 
 * Quote mode (123 bytes) adds OHLC + volume + bid/ask.
 */

import WebSocket from 'ws';
import axios from 'axios';
import https from 'https';
import { authenticator } from '@otplib/preset-default';
import { config } from 'dotenv';

config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
const ANGEL_WS_URL = 'wss://smartapisocket.angelone.in/smart-stream';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Exchange type mapping
const EXCHANGE_TYPE_MAP = {
  'NSE': 1,   // nse_cm
  'NFO': 2,   // nse_fo
  'BSE': 3,   // bse_cm
  'BFO': 4,   // bse_fo
  'MCX': 5,   // mcx_fo
  'CDS': 13,  // cde_fo
};

const EXCHANGE_TYPE_REVERSE = {
  1: 'NSE', 2: 'NFO', 3: 'BSE', 4: 'BFO', 5: 'MCX', 7: 'NCX', 13: 'CDS',
};

export class AngelFeedConnector {
  constructor(marketDataEngine) {
    this.marketDataEngine = marketDataEngine;
    this.ws = null;
    this.session = null;
    this.isConnected = false;
    this.subscribedTokens = new Map(); // token -> { exchangeType, mode }
    this.reconnectAttempts = 0;
    this.maxReconnects = 50;
    this.reconnectDelay = 3000;
    this.maxReconnectDelay = 30000;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._tokenRefreshTimer = null;
    this._tokenRefreshCallbacks = [];
    this._tokenLoginTime = null;
    this.tickCount = 0;
    this.startTime = null;
    // Staleness watchdog
    this._lastTickTime = 0;
    this._stalenessTimer = null;
    this._feedStale = false;
    this._stalenessThresholdMs = 60000; // 60 seconds with no ticks = stale
    this._eventBus = null;
  }

  /**
   * Set event bus reference for risk alerts.
   */
  setEventBus(eventBus) {
    this._eventBus = eventBus;
  }

  /**
   * Start the feed staleness watchdog.
   * Checks every 15 seconds if ticks have stopped arriving during market hours.
   * Emits risk.alert if feed is stale.
   */
  _startStalenessWatchdog() {
    if (this._stalenessTimer) clearInterval(this._stalenessTimer);

    this._stalenessTimer = setInterval(() => {
      if (!this.isConnected) return;
      if (!this._isMarketHours()) return;

      const now = Date.now();
      const timeSinceLastTick = now - this._lastTickTime;

      if (this._lastTickTime > 0 && timeSinceLastTick > this._stalenessThresholdMs) {
        if (!this._feedStale) {
          this._feedStale = true;
          console.warn(`[AngelFeed] ⚠ Feed STALE — no ticks for ${Math.round(timeSinceLastTick / 1000)}s`);
          this._emitFeedAlert('feed_stale', `Market data feed stale: no ticks for ${Math.round(timeSinceLastTick / 1000)}s`);
          this.marketDataEngine.setFeedStale(true);
        }
      }
    }, 15000);
  }

  /**
   * Stop the staleness watchdog.
   */
  _stopStalenessWatchdog() {
    if (this._stalenessTimer) {
      clearInterval(this._stalenessTimer);
      this._stalenessTimer = null;
    }
  }

  /**
   * Emit a feed health alert via the event bus.
   */
  _emitFeedAlert(type, message) {
    if (!this._eventBus) return;
    this._eventBus.publish('risk.alert', {
      type: 'critical',
      severity: 'critical',
      ruleType: 'feed_health',
      message,
      metadata: {
        feedType: type,
        subscribedTokens: this.subscribedTokens.size,
        lastTickAge: Date.now() - this._lastTickTime,
        reconnectAttempts: this.reconnectAttempts,
      },
      limitValue: this._stalenessThresholdMs,
      currentValue: Date.now() - this._lastTickTime,
    }, { accountId: 'system' });
  }

  /**
   * Check if current time is within market hours (IST 9:15 - 15:30, Mon-Fri).
   */
  _isMarketHours() {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return false;
    const hours = now.getHours();
    const mins = now.getMinutes();
    const time = hours * 60 + mins;
    return time >= 555 && time <= 930; // 9:15 - 15:30
  }

  /**
   * Register a callback to be invoked immediately when the JWT is refreshed.
   * Replaces the old 60-second setInterval propagation pattern.
   * @param {function} callback - Receives (session) with fresh jwtToken
   */
  onTokenRefresh(callback) {
    if (typeof callback === 'function') {
      this._tokenRefreshCallbacks.push(callback);
    }
  }

  /**
   * Refresh the JWT token using Angel One's generateTokens endpoint.
   * Falls back to full re-login if refresh fails.
   * @returns {object} Updated session
   */
  async refreshJWT() {
    if (!this.session?.refreshToken) {
      console.log('[AngelFeed] No refresh token — performing full re-login');
      return this.login();
    }

    try {
      const resp = await axios.post(
        `${ANGEL_API_BASE}/rest/auth/angelbroking/jwt/v1/generateTokens`,
        { refreshToken: this.session.refreshToken },
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
            'X-PrivateKey': this.session.apiKey,
            'Authorization': `Bearer ${this.session.jwtToken}`,
          },
        }
      );

      if (resp.data?.data?.jwtToken) {
        this.session.jwtToken = resp.data.data.jwtToken;
        this.session.refreshToken = resp.data.data.refreshToken || this.session.refreshToken;
        this.session.feedToken = resp.data.data.feedToken || this.session.feedToken;
        this._tokenLoginTime = Date.now();
        console.log('[AngelFeed] ✓ JWT refreshed successfully');
        this._notifyTokenRefresh();
        this._scheduleProactiveRefresh();
        return this.session;
      }

      // Response didn't contain a token — fall back to re-login
      console.warn('[AngelFeed] Refresh response empty — performing full re-login');
      return this.login();
    } catch (err) {
      console.warn(`[AngelFeed] JWT refresh failed (${err.response?.status || err.message}) — performing full re-login`);
      return this.login();
    }
  }

  /**
   * Ensure a valid JWT is available. Refreshes proactively if within 5min of expiry.
   * Services call this before making REST API requests.
   * @returns {string} Valid JWT token
   */
  async ensureValidToken() {
    if (!this.session?.jwtToken) {
      await this.login();
      return this.session.jwtToken;
    }

    // Check if token is near expiry (refresh if older than 55 minutes)
    const tokenAge = Date.now() - (this._tokenLoginTime || 0);
    const REFRESH_THRESHOLD = 55 * 60 * 1000; // 55 minutes

    if (tokenAge > REFRESH_THRESHOLD) {
      await this.refreshJWT();
    }

    return this.session.jwtToken;
  }

  /**
   * Notify all registered callbacks that the token has been refreshed.
   * @private
   */
  _notifyTokenRefresh() {
    for (const cb of this._tokenRefreshCallbacks) {
      try {
        cb(this.session);
      } catch (err) {
        console.error('[AngelFeed] Token refresh callback error:', err.message);
      }
    }
  }

  /**
   * Schedule a proactive JWT refresh before expiry.
   * Angel One JWT typically expires after 1 hour.
   * @private
   */
  _scheduleProactiveRefresh() {
    if (this._tokenRefreshTimer) {
      clearTimeout(this._tokenRefreshTimer);
    }

    // Refresh 5 minutes before the 1-hour mark
    const REFRESH_INTERVAL = 55 * 60 * 1000; // 55 minutes

    this._tokenRefreshTimer = setTimeout(async () => {
      console.log('[AngelFeed] Proactive token refresh triggered');
      try {
        await this.refreshJWT();
      } catch (err) {
        console.error('[AngelFeed] Proactive refresh failed:', err.message);
      }
    }, REFRESH_INTERVAL);
  }

  /**
   * Login to Angel One and obtain feed token.
   */
  async login() {
    const apiKey = process.env.ANGEL_API_KEY;
    const clientId = process.env.ANGEL_CLIENT_ID;
    const password = process.env.ANGEL_PASSWORD;
    const totpSecret = process.env.ANGEL_TOTP_SECRET;

    if (!apiKey || !clientId || !password || !totpSecret) {
      throw new Error('[AngelFeed] Missing credentials in .env');
    }

    const totp = authenticator.generate(totpSecret);

    const resp = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      { clientcode: clientId, password, totp },
      {
        httpsAgent: IPV4_AGENT,
        timeout: 12000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': '00:00:00:00:00:00',
          'X-PrivateKey': apiKey,
        },
      }
    );

    if (!resp.data?.data?.jwtToken) {
      throw new Error(`[AngelFeed] Login failed: ${resp.data?.message || 'No token'}`);
    }

    this.session = {
      jwtToken: resp.data.data.jwtToken,
      feedToken: resp.data.data.feedToken,
      refreshToken: resp.data.data.refreshToken,
      clientId,
      apiKey,
    };

    this._tokenLoginTime = Date.now();
    console.log(`[AngelFeed] ✓ Logged in as ${clientId}`);

    // Notify listeners and schedule proactive refresh
    this._notifyTokenRefresh();
    this._scheduleProactiveRefresh();

    return this.session;
  }

  /**
   * Connect WebSocket to SmartStream.
   */
  async connect() {
    if (!this.session) {
      await this.login();
    }

    return new Promise((resolve, reject) => {
      console.log('[AngelFeed] Connecting to SmartStream...');

      this.ws = new WebSocket(ANGEL_WS_URL, {
        headers: {
          'Authorization': `Bearer ${this.session.jwtToken}`,
          'x-api-key': this.session.apiKey,
          'x-client-code': this.session.clientId,
          'x-feed-token': this.session.feedToken,
        },
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startTime = Date.now();
        console.log('[AngelFeed] ✓ WebSocket connected');

        // Start heartbeat
        this._startHeartbeat();

        // Start staleness watchdog
        this._startStalenessWatchdog();

        // Emit feed recovered alert if previously stale
        if (this._feedStale) {
          this._feedStale = false;
          console.log('[AngelFeed] ✓ Feed recovered');
          if (this.marketDataEngine.setFeedStale) this.marketDataEngine.setFeedStale(false);
          this._emitFeedAlert('feed_recovered', 'Market data feed recovered');
        }

        // Resubscribe if reconnecting
        if (this.subscribedTokens.size > 0) {
          this._resubscribeAll();
        }

        resolve();
      });

      this.ws.on('message', (data) => {
        if (Buffer.isBuffer(data)) {
          this._parseTick(data);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.isConnected = false;
        this._stopHeartbeat();
        this._stopStalenessWatchdog();
        console.warn(`[AngelFeed] WebSocket closed: code=${code} reason=${reason?.toString() || ''}`);
        this._emitFeedAlert('feed_disconnected', `Market data feed disconnected (code=${code})`);
        this._attemptReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[AngelFeed] WebSocket error:', err.message);
        if (!this.isConnected) reject(err);
      });
    });
  }

  /**
   * Subscribe to tokens for real-time ticks.
   * @param {Array} tokens - Array of { token, exchange, mode }
   *   exchange: 'NSE', 'NFO', 'MCX', 'CDS', 'BSE'
   *   mode: 1 (LTP), 2 (Quote), 3 (SnapQuote)
   */
  subscribe(tokens, mode = 1) {
    // Group by exchange type
    const grouped = {};
    for (const t of tokens) {
      const exchType = EXCHANGE_TYPE_MAP[t.exchange || 'NSE'] || 1;
      if (!grouped[exchType]) grouped[exchType] = [];
      grouped[exchType].push(t.token);
      this.subscribedTokens.set(t.token, { exchangeType: exchType, mode, exchange: t.exchange });
    }

    // Build subscription payload
    const tokenList = Object.entries(grouped).map(([exchType, tokenArr]) => ({
      exchangeType: parseInt(exchType),
      tokens: tokenArr,
    }));

    const payload = JSON.stringify({
      correlationID: `fw_sub_${Date.now()}`,
      action: 1, // subscribe
      params: { mode, tokenList },
    });

    if (this.ws && this.isConnected) {
      this.ws.send(payload);
      console.log(`[AngelFeed] Subscribed ${tokens.length} tokens (mode ${mode})`);
    }
  }

  /**
   * Unsubscribe tokens.
   */
  unsubscribe(tokens) {
    const grouped = {};
    for (const t of tokens) {
      const info = this.subscribedTokens.get(t.token);
      const exchType = info?.exchangeType || EXCHANGE_TYPE_MAP[t.exchange || 'NSE'] || 1;
      if (!grouped[exchType]) grouped[exchType] = [];
      grouped[exchType].push(t.token);
      this.subscribedTokens.delete(t.token);
    }

    const tokenList = Object.entries(grouped).map(([exchType, tokenArr]) => ({
      exchangeType: parseInt(exchType),
      tokens: tokenArr,
    }));

    const payload = JSON.stringify({
      correlationID: `fw_unsub_${Date.now()}`,
      action: 0, // unsubscribe
      params: { mode: 1, tokenList },
    });

    if (this.ws && this.isConnected) {
      this.ws.send(payload);
    }
  }

  /**
   * Parse binary tick from SmartStream and push to MarketDataEngine.
   */
  _parseTick(buffer) {
    if (buffer.length < 51) return; // Minimum LTP packet

    const mode = buffer[0];
    const exchangeType = buffer[1];
    const token = buffer.slice(2, 27).toString('utf8').replace(/\0/g, '').trim();
    const exchange = EXCHANGE_TYPE_REVERSE[exchangeType] || 'NSE';

    // LTP is at offset 43 (int64LE / 100)
    const ltp = Number(buffer.readBigInt64LE(43)) / 100;

    this.tickCount++;
    this._lastTickTime = Date.now();

    // Clear stale state on first tick after staleness
    if (this._feedStale) {
      this._feedStale = false;
      console.log('[AngelFeed] ✓ Feed recovered — ticks resuming');
      if (this.marketDataEngine.setFeedStale) this.marketDataEngine.setFeedStale(false);
      this._emitFeedAlert('feed_recovered', 'Market data feed recovered — ticks resuming');
    }

    if (mode === 1) {
      // LTP mode (51 bytes)
      this.marketDataEngine.pushQuote(token, {
        token,
        ltp,
        exchange,
        timestamp: Date.now(),
      });
    } else if (mode === 2 && buffer.length >= 123) {
      // Quote mode (123 bytes) — includes OHLC, volume
      // All price fields are int64LE (8 bytes each), divided by 100
      const lastTradedQty = Number(buffer.readBigInt64LE(51));
      const avgPrice = Number(buffer.readBigInt64LE(59)) / 100;
      const volume = Number(buffer.readBigInt64LE(67));
      const totalBuyQty = buffer.readDoubleLE(75);
      const totalSellQty = buffer.readDoubleLE(83);
      const open = Number(buffer.readBigInt64LE(91)) / 100;
      const high = Number(buffer.readBigInt64LE(99)) / 100;
      const low = Number(buffer.readBigInt64LE(107)) / 100;
      const lastClose = Number(buffer.readBigInt64LE(115)) / 100;

      this.marketDataEngine.pushQuote(token, {
        token,
        ltp,
        open,
        high,
        low,
        close: lastClose,
        volume,
        change: lastClose ? ltp - lastClose : 0,
        changePercent: lastClose ? ((ltp - lastClose) / lastClose) * 100 : 0,
        exchange,
        timestamp: Date.now(),
      });
    } else if (mode === 3 && buffer.length >= 379) {
      // SnapQuote mode (379 bytes) — includes full depth
      const lastClose = buffer.readInt32LE(47) / 100;
      const open = buffer.readInt32LE(51) / 100;
      const high = buffer.readInt32LE(55) / 100;
      const low = buffer.readInt32LE(59) / 100;
      const volume = buffer.readInt32LE(63);

      this.marketDataEngine.pushQuote(token, {
        token, ltp, open, high, low, close: lastClose, volume,
        change: ltp - lastClose,
        changePercent: lastClose ? ((ltp - lastClose) / lastClose) * 100 : 0,
        exchange, timestamp: Date.now(),
      });

      // Parse 5-level depth (starts at offset 87 in SnapQuote)
      // Each level: 4 bytes qty + 4 bytes price + 2 bytes orders = 10 bytes
      // 5 bid levels + 5 ask levels = 100 bytes
      const depthOffset = 87;
      const bids = [];
      const asks = [];

      for (let i = 0; i < 5; i++) {
        const bidOff = depthOffset + (i * 10);
        const askOff = depthOffset + 50 + (i * 10);
        if (bidOff + 10 <= buffer.length) {
          bids.push({
            qty: buffer.readInt32LE(bidOff),
            price: buffer.readInt32LE(bidOff + 4) / 100,
            orders: buffer.readInt16LE(bidOff + 8),
          });
        }
        if (askOff + 10 <= buffer.length) {
          asks.push({
            qty: buffer.readInt32LE(askOff),
            price: buffer.readInt32LE(askOff + 4) / 100,
            orders: buffer.readInt16LE(askOff + 8),
          });
        }
      }

      if (bids.length > 0 || asks.length > 0) {
        this.marketDataEngine.pushDepth(token, {
          token, bids, asks,
          totalBuyQty: bids.reduce((s, b) => s + b.qty, 0),
          totalSellQty: asks.reduce((s, a) => s + a.qty, 0),
        });
      }
    }
  }

  /**
   * Resubscribe all tokens after reconnect.
   */
  _resubscribeAll() {
    const byMode = {};
    for (const [token, info] of this.subscribedTokens) {
      const key = info.mode || 1;
      if (!byMode[key]) byMode[key] = [];
      byMode[key].push({ token, exchange: info.exchange || 'NSE' });
    }
    for (const [mode, tokens] of Object.entries(byMode)) {
      this.subscribe(tokens, parseInt(mode));
    }
  }

  /**
   * Attempt reconnection with exponential backoff.
   */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) {
      console.error('[AngelFeed] Max reconnect attempts reached — restarting from scratch in 60s');
      this.reconnectAttempts = 0;
      this._reconnectTimer = setTimeout(() => this._attemptReconnect(), 60000);
      return;
    }

    this.reconnectAttempts++;
    // Capped exponential backoff with jitter
    const baseDelay = this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts - 1, 5));
    const delay = Math.min(baseDelay, this.maxReconnectDelay || 30000) + Math.random() * 1000;
    console.log(`[AngelFeed] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);

    this._reconnectTimer = setTimeout(async () => {
      try {
        // Re-login first (token may have expired)
        await this.login();
        await this.connect();
      } catch (err) {
        console.error('[AngelFeed] Reconnect failed:', err.message);
        this._attemptReconnect();
      }
    }, delay);
  }

  /**
   * Heartbeat to keep connection alive.
   */
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        try { this.ws.ping(); } catch { /* ignore */ }
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Get status for health endpoint.
   */
  getStatus() {
    return {
      connected: this.isConnected,
      subscribedTokens: this.subscribedTokens.size,
      tickCount: this.tickCount,
      uptimeMs: this.startTime ? Date.now() - this.startTime : 0,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Upgrade subscription mode for specific tokens (e.g. mode 2 → mode 3 for depth).
   * Unsubscribes at old mode and resubscribes at new mode.
   * @param {Array} tokens - Array of { token, exchange }
   * @param {number} newMode - Target mode (1, 2, or 3)
   */
  upgradeSubscription(tokens, newMode) {
    // Unsubscribe first
    this.unsubscribe(tokens);
    // Resubscribe at new mode
    this.subscribe(tokens, newMode);
  }

  /**
   * Disconnect and cleanup.
   */
  disconnect() {
    this._stopHeartbeat();
    this._stopStalenessWatchdog();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._tokenRefreshTimer) clearTimeout(this._tokenRefreshTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this._tokenRefreshCallbacks = [];
    console.log('[AngelFeed] Disconnected');
  }
}
