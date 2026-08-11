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

        // Resubscribe if reconnecting — delay to ensure WS is fully open
        if (this.subscribedTokens.size > 0) {
          setTimeout(() => {
            if (this.isConnected && this.ws && this.ws.readyState === this.ws.OPEN) {
              this._resubscribeAll();
            }
          }, 200);
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

    if (this.ws && this.isConnected && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(payload);
      console.log(`[AngelFeed] Subscribed ${tokens.length} tokens (mode ${mode})`);
    } else {
      console.warn(`[AngelFeed] Subscribe queued (WS not open) — will re-subscribe on next connect`);
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

    if (this.ws && this.isConnected && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(payload);
    }
  }

  /**
   * Parse binary tick from Angel One SmartStream V2 and push to MarketDataEngine.
   *
   * Byte layout verified against the official Angel One Python SDK:
   *   github.com/angel-one/smartapi-python — SmartApi/smartWebSocketV2.py
   *
   * Common header (all modes):
   *   [0]      subscription_mode  uint8
   *   [1]      exchange_type      uint8
   *   [2-26]   token              25-byte null-padded ASCII string
   *   [27-34]  sequence_number    int64LE
   *   [35-42]  exchange_timestamp int64LE
   *   [43-50]  last_traded_price  int64LE  ÷ 100  ← LTP
   *
   * Mode 1 (LTP) — 51 bytes: header only.
   *
   * Mode 2 (Quote) — 123 bytes: header + OHLC fields:
   *   [51-58]   last_traded_quantity   int64LE
   *   [59-66]   average_traded_price   int64LE  ÷ 100
   *   [67-74]   volume_trade_for_day   int64LE
   *   [75-82]   total_buy_quantity     float64LE (IEEE 754 double)
   *   [83-90]   total_sell_quantity    float64LE (IEEE 754 double)
   *   [91-98]   open_price             int64LE  ÷ 100
   *   [99-106]  high_price             int64LE  ÷ 100
   *   [107-114] low_price              int64LE  ÷ 100
   *   [115-122] closed_price           int64LE  ÷ 100  ← previous close
   *
   * Mode 3 (SnapQuote) — 379 bytes: Mode 2 fields + depth:
   *   [123-130] last_traded_timestamp            int64LE
   *   [131-138] open_interest                    int64LE
   *   [139-146] open_interest_change_percentage  int64LE
   *   [147-346] best_5_buy_and_sell_data         200 bytes (10 × 20-byte records)
   *             Each record: flag(2) + qty(8,int64) + price(8,int64) + orders(2)
   *   [347-354] upper_circuit_limit  int64LE ÷ 100
   *   [355-362] lower_circuit_limit  int64LE ÷ 100
   *   [363-370] 52_week_high         int64LE ÷ 100
   *   [371-378] 52_week_low          int64LE ÷ 100
   *
   * Mode 4 (Depth 20) — depth fields use int32/int16 (not int64).
   *   Not altered — no confirmed bugs in Mode 4 depth parsing.
   *
   * CRITICAL: All price fields are int64LE / 100 (not int32LE).
   * Using readInt32LE on int64 fields reads only the lower 4 bytes, which
   * produces accidental correctness for prices < ~₹21M but returns garbage
   * for OHLC fields that land at wrong offsets — directly causing the
   * SUNPHARMA/INFY/HCLTECH incident (wrong close → -99.99% changePercent,
   * HCLTECH blank, false -₹59,000 daily loss).
   */
  _parseTick(buffer) {
    // Minimum packet for LTP mode: 51 bytes
    if (buffer.length < 51) return;

    const mode = buffer[0];
    const exchangeType = buffer[1];
    const token = buffer.slice(2, 27).toString('utf8').replace(/\0/g, '').trim();
    const exchange = EXCHANGE_TYPE_REVERSE[exchangeType] || 'NSE';
    const now = Date.now();

    this.tickCount++;
    this._lastTickTime = now;

    // Clear stale state on first tick after staleness
    if (this._feedStale) {
      this._feedStale = false;
      console.log('[AngelFeed] ✓ Feed recovered — ticks resuming');
      if (this.marketDataEngine.setFeedStale) this.marketDataEngine.setFeedStale(false);
      this._emitFeedAlert('feed_recovered', 'Market data feed recovered — ticks resuming');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    // Safe int64 read: returns null when buffer is too short for an 8-byte read.
    const readI64 = (offset) => {
      if (offset + 8 > buffer.length) return null;
      return Number(buffer.readBigInt64LE(offset));
    };

    // Safe float64 read: returns null when buffer is too short.
    const readF64 = (offset) => {
      if (offset + 8 > buffer.length) return null;
      return buffer.readDoubleLE(offset);
    };

    // Validate a price: must be a finite positive number.
    // Returns the scaled value (÷100) or null if invalid.
    const price = (raw) => {
      if (raw === null || raw === undefined) return null;
      const v = raw / 100;
      if (!Number.isFinite(v) || v <= 0) return null;
      return v;
    };

    // ── Mode 1 — LTP only (51 bytes) ─────────────────────────────────────────
    if (mode === 1) {
      const rawLtp = readI64(43);
      const ltp = price(rawLtp);

      if (ltp === null) {
        console.warn(`[MarketData] INVALID_LTP token=${token} exchange=${exchange} mode=1 reason="ltp=${rawLtp} is not a positive finite number"`);
        return;
      }

      this.marketDataEngine.pushQuote(token, {
        token,
        ltp,
        exchange,
        timestamp: now,
      });
      return;
    }

    // ── Mode 2 — Quote (123 bytes) ────────────────────────────────────────────
    if (mode === 2 && buffer.length >= 123) {
      const rawLtp   = readI64(43);
      const rawOpen  = readI64(91);
      const rawHigh  = readI64(99);
      const rawLow   = readI64(107);
      const rawClose = readI64(115);       // previous close (closed_price)
      const volume   = readI64(67) ?? 0;  // volume_trade_for_day

      const ltp   = price(rawLtp);
      const open  = price(rawOpen);
      const high  = price(rawHigh);
      const low   = price(rawLow);
      const close = price(rawClose);      // previous close used for changePercent

      if (ltp === null) {
        console.warn(`[MarketData] INVALID_LTP token=${token} exchange=${exchange} mode=2 reason="ltp=${rawLtp} is not a positive finite number"`);
        return;
      }

      // changePercent is ONLY calculated when we have a valid previous close.
      // A garbage close byte range (old Int32 offset 79) is what caused -99.99%.
      // With the correct offset (115) this now reads the real previous close.
      const change        = (close !== null) ? ltp - close : null;
      const changePercent = (close !== null) ? ((ltp - close) / close) * 100 : null;

      this.marketDataEngine.pushQuote(token, {
        token,
        ltp,
        open:          open  ?? undefined,
        high:          high  ?? undefined,
        low:           low   ?? undefined,
        close:         close ?? undefined,
        volume:        Math.max(0, volume),
        change:        change        ?? undefined,
        changePercent: changePercent ?? undefined,
        exchange,
        timestamp: now,
      });
      return;
    }

    // ── Mode 3 — SnapQuote (379 bytes) ────────────────────────────────────────
    if (mode === 3 && buffer.length >= 379) {
      // OHLC fields identical to Mode 2
      const rawLtp   = readI64(43);
      const rawOpen  = readI64(91);
      const rawHigh  = readI64(99);
      const rawLow   = readI64(107);
      const rawClose = readI64(115);
      const volume   = readI64(67) ?? 0;

      const ltp   = price(rawLtp);
      const open  = price(rawOpen);
      const high  = price(rawHigh);
      const low   = price(rawLow);
      const close = price(rawClose);

      if (ltp === null) {
        console.warn(`[MarketData] INVALID_LTP token=${token} exchange=${exchange} mode=3 reason="ltp=${rawLtp} is not a positive finite number"`);
        return;
      }

      const change        = (close !== null) ? ltp - close : null;
      const changePercent = (close !== null) ? ((ltp - close) / close) * 100 : null;

      this.marketDataEngine.pushQuote(token, {
        token,
        ltp,
        open:          open  ?? undefined,
        high:          high  ?? undefined,
        low:           low   ?? undefined,
        close:         close ?? undefined,
        volume:        Math.max(0, volume),
        change:        change        ?? undefined,
        changePercent: changePercent ?? undefined,
        oi:            readI64(131) ?? undefined,
        exchange,
        timestamp: now,
      });

      // Parse best-5 depth from bytes 147–346.
      // Each depth record is 20 bytes: flag(2) + qty(8,int64) + price(8,int64) + orders(2).
      // flag === 0 → buy side; flag !== 0 → sell side.
      const bids = [];
      const asks = [];
      const DEPTH_START = 147;
      const RECORD_SIZE = 20;
      const RECORDS = 10; // 5 buy + 5 sell interleaved by flag

      for (let i = 0; i < RECORDS; i++) {
        const off = DEPTH_START + i * RECORD_SIZE;
        if (off + RECORD_SIZE > buffer.length) break;

        const flag   = buffer.readUInt16LE(off);
        const qty    = Number(buffer.readBigInt64LE(off + 2));
        const rawP   = Number(buffer.readBigInt64LE(off + 10));
        const orders = buffer.readUInt16LE(off + 18);
        const p      = rawP > 0 ? rawP / 100 : null;

        if (p === null || qty < 0) continue;

        const level = { price: p, qty, orders };
        if (flag === 0) {
          if (bids.length < 5) bids.push(level);
        } else {
          if (asks.length < 5) asks.push(level);
        }
      }

      if (bids.length > 0 || asks.length > 0) {
        this.marketDataEngine.pushDepth(token, {
          token, bids, asks,
          totalBuyQty:  bids.reduce((s, b) => s + b.qty, 0),
          totalSellQty: asks.reduce((s, a) => s + a.qty, 0),
        });
      }
      return;
    }

    // ── Mode 4 (Depth 20) and unrecognised modes ──────────────────────────────
    // Mode 4 depth fields use int32/int16 (not int64) per the official SDK.
    // No bugs have been confirmed in Mode 4 — not altered.
    // Unrecognised modes are silently ignored.
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
