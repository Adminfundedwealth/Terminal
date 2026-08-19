/**
 * DHAN WEBSOCKET FEED CLIENT
 * 
 * Real-time market data streaming via Dhan's WebSocket feed.
 * 
 * Connection: wss://api-feed.dhan.co/api/v2/ws
 * Auth: Query params ?version=2&token=<access_token>&clientId=<client_id>&authType=2
 * 
 * Subscription Request Codes:
 *   15 = Ticker (LTP only)
 *   17 = Quote (LTP + OHLC + volume)
 *   21 = Full Market Depth (20 levels)
 * 
 * Dhan sends BINARY packets. Format:
 *   First 2 bytes = response code (little-endian uint16)
 *   Rest = instrument data based on response code
 * 
 * Subscription payload (JSON over WS):
 *   { "RequestCode": 15, "InstrumentCount": 1, "InstrumentList": [{ "ExchangeSegment": "NSE_EQ", "SecurityId": "2885" }] }
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

const DHAN_WS_URL = 'wss://api-feed.dhan.co/api/v2/ws';

// Exchange segment codes for subscription
const SEGMENT_CODES = {
  'NSE_EQ': 'NSE_EQ',
  'NSE_FNO': 'NSE_FNO',
  'BSE_EQ': 'BSE_EQ',
  'BSE_FNO': 'BSE_FNO',
  'MCX_COMM': 'MCX_COMM',
  'IDX_I': 'IDX_I',
  'CUR': 'CUR',
  // Map from Angel-style
  'NSE': 'NSE_EQ',
  'NFO': 'NSE_FNO',
  'BSE': 'BSE_EQ',
  'MCX': 'MCX_COMM',
  'CDS': 'CUR',
};

export class DhanWebSocketFeed extends EventEmitter {
  constructor(authService) {
    super();
    this.auth = authService;
    this._ws = null;
    this._connected = false;
    this._subscriptions = new Map(); // securityId → { segment, mode }
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnects = 10;
    this._heartbeatTimer = null;

    // Default 'error' listener — prevents Node from crashing on unhandled
    // EventEmitter error events (e.g. ETIMEDOUT during connect before caller
    // adds its own listener). Callers may override by adding their own listener.
    this.on('error', (err) => {
      // Suppress — errors during connect are already handled by the connect()
      // promise reject path and the ws 'error' event. Without this default
      // listener Node.js throws the error as an uncaught exception.
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[DhanWS] Default error handler (suppressed):', err?.message || err);
      }
    });
  }

  get isConnected() { return this._connected; }

  /**
   * Connect to Dhan WebSocket feed.
   */
  async connect() {
    if (!this.auth.isTokenValid) {
      throw new Error('[DhanWS] Token not valid — cannot connect');
    }

    const url = `${DHAN_WS_URL}?version=2&token=${this.auth.accessToken}&clientId=${this.auth.clientId}&authType=2`;

    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(url, {
        headers: { 'User-Agent': 'FundedWealth-Terminal/1.0' },
      });

      this._ws.on('open', () => {
        this._connected = true;
        this._reconnectAttempts = 0;
        console.log('[DhanWS] Connected to feed');
        this.emit('connected');
        this._startHeartbeat();
        // Re-subscribe any existing subscriptions
        this._resubscribeAll();
        resolve();
      });

      this._ws.on('message', (data) => {
        this._handleMessage(data);
      });

      this._ws.on('close', (code, reason) => {
        this._connected = false;
        this._stopHeartbeat();
        console.warn(`[DhanWS] Disconnected: ${code} ${reason}`);
        this.emit('disconnected', { code, reason: reason?.toString() });
        this._scheduleReconnect();
      });

      this._ws.on('error', (err) => {
        console.error('[DhanWS] Error:', err.message);
        this.emit('error', err);
        if (!this._connected) reject(err);
      });

      // Timeout
      setTimeout(() => {
        if (!this._connected) {
          this._ws?.close();
          reject(new Error('[DhanWS] Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Subscribe to real-time quotes.
   * @param {Array<{securityId, segment}>} instruments
   * @param {number} mode — 15=Ticker, 17=Quote, 21=Depth
   */
  subscribe(instruments, mode = 17) {
    if (!instruments || !instruments.length) return;

    const instrumentList = instruments.map(inst => {
      const seg = SEGMENT_CODES[inst.segment || inst.exchange] || 'NSE_EQ';
      const secId = String(inst.securityId || inst.token);

      // Track subscription
      this._subscriptions.set(secId, { segment: seg, mode });

      return { ExchangeSegment: seg, SecurityId: secId };
    });

    const payload = {
      RequestCode: mode,
      InstrumentCount: instrumentList.length,
      InstrumentList: instrumentList,
    };

    if (this._connected && this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload));
      console.log(`[DhanWS] Subscribed ${instrumentList.length} instruments (mode ${mode})`);
    }
  }

  /**
   * Unsubscribe from instruments.
   */
  unsubscribe(instruments) {
    if (!instruments || !instruments.length) return;

    const instrumentList = instruments.map(inst => {
      const secId = String(inst.securityId || inst.token);
      const sub = this._subscriptions.get(secId);
      this._subscriptions.delete(secId);
      return { ExchangeSegment: sub?.segment || 'NSE_EQ', SecurityId: secId };
    });

    // Dhan uses RequestCode 15 with action "unsubscribe" or specific unsub code
    // For now, just remove from tracking — Dhan doesn't have explicit unsub
    console.log(`[DhanWS] Unsubscribed ${instrumentList.length} instruments`);
  }

  /**
   * Disconnect from feed.
   */
  disconnect() {
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) {
      this._ws.close(1000, 'Client disconnect');
      this._ws = null;
    }
    this._connected = false;
    this._subscriptions.clear();
  }

  // ─── Internal ─────────────────────────────────────────────

  _handleMessage(rawData) {
    try {
      // Dhan sends binary data
      if (Buffer.isBuffer(rawData) || rawData instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
        this._parseBinaryPacket(buf);
      } else if (typeof rawData === 'string') {
        // JSON messages (connection ack, errors)
        const json = JSON.parse(rawData);
        if (json.type === 'error') {
          console.error('[DhanWS] Server error:', json);
        }
        this.emit('json_message', json);
      }
    } catch (err) {
      // Silently ignore parse errors on binary data
    }
  }

  /**
   * Parse Dhan binary WebSocket packet.
   *
   * Dhan v2 WS binary packet layout (verified from Dhan docs + live capture):
   *
   * Header — common to all response types:
   *   Bytes 0-1 : Response Code     (uint16 LE)  — 15=Ticker, 17=Quote, 21=Depth
   *   Bytes 2-3 : Exchange Segment  (uint16 LE)
   *   Bytes 4-7 : Security ID       (int32  LE)
   *
   * Ticker (code 15) — 21 bytes:
   *   Bytes 8-11  : LTP             (float32 LE)
   *   Bytes 12-15 : Close (prev)    (float32 LE)
   *   Bytes 16-19 : Packet Time     (int32 LE, unix seconds)
   *
   * Quote (code 17) — 54 bytes:
   *   Bytes 8-11  : LTP             (float32 LE)
   *   Bytes 12-15 : Close           (float32 LE)
   *   Bytes 16-19 : Open            (float32 LE)
   *   Bytes 20-23 : High            (float32 LE)
   *   Bytes 24-27 : Low             (float32 LE)
   *   Bytes 28-35 : Volume          (int64  LE — use readBigInt64LE, or two int32)
   *   Bytes 36-43 : Avg Price       (float64 LE)
   *   Bytes 44-47 : OI              (int32 LE)
   *   Bytes 48-51 : Prev OI         (int32 LE)
   *   Bytes 52-53 : Packet Time     (uint16 LE, delta seconds)
   *
   * Depth (code 21) — variable length:
   *   Header (8 bytes as above) +
   *   5 × Bid levels + 5 × Ask levels:
   *   Each level: qty(4) + orders(2) + price(4) = 10 bytes
   *   Total depth data: 10 × 10 = 100 bytes → packet ≥ 108 bytes
   *
   * NOTE: exchange_segment field is uint16 (2 bytes), NOT uint8.
   * Previous code read it as uint8(1 byte) and shifted securityId to offset 3 —
   * this caused securityId to read into the wrong bytes, producing wrong token IDs.
   */
  _parseBinaryPacket(buf) {
    if (buf.length < 8) return;

    const responseCode = buf.readUInt16LE(0);
    // exchangeSeg = buf.readUInt16LE(2) — read but currently unused (segment tracked via subscription map)
    const securityId  = buf.readInt32LE(4);  // correct offset: after 2-byte code + 2-byte segment

    if (responseCode === 15) {
      this._parseTickerPacket(buf, securityId);
    } else if (responseCode === 17) {
      this._parseQuotePacket(buf, securityId);
    } else if (responseCode === 21) {
      this._parseDepthPacket(buf, securityId);
    }
  }

  _parseTickerPacket(buf, securityId) {
    if (buf.length < 16) return;
    try {
      const ltp = buf.readFloatLE(8);
      if (!ltp || ltp <= 0) return;
      this.emit('tick', {
        token: String(securityId),
        ltp,
        type: 'ticker',
      });
    } catch (_) {}
  }

  _parseQuotePacket(buf, securityId) {
    if (buf.length < 32) return;
    try {
      const ltp    = buf.readFloatLE(8);
      const close  = buf.readFloatLE(12);
      const open   = buf.readFloatLE(16);
      const high   = buf.readFloatLE(20);
      const low    = buf.readFloatLE(24);
      // Volume is int64 LE at offset 28 — read as two 32-bit halves safely
      const volLow  = buf.readUInt32LE(28);
      const volHigh = buf.length >= 36 ? buf.readUInt32LE(32) : 0;
      const volume  = volHigh * 0x100000000 + volLow; // safe for < 2^53

      if (!ltp || ltp <= 0) return;
      this.emit('tick', {
        token: String(securityId),
        ltp, open, high, low, close, volume,
        type: 'quote',
      });
    } catch (_) {}
  }

  _parseDepthPacket(buf, securityId) {
    // Depth packet: header (8) + 5 bid levels + 5 ask levels
    // Each level = qty(4 LE) + orders(2 LE) + price(4 LE) = 10 bytes
    // Total minimum: 8 + 100 = 108 bytes
    if (buf.length < 108) return;
    try {
      const levels = 5;
      const LEVEL_SIZE = 10;
      const BID_OFFSET = 8;
      const ASK_OFFSET = BID_OFFSET + levels * LEVEL_SIZE;

      const bids = [];
      const asks = [];

      for (let i = 0; i < levels; i++) {
        const bidOff = BID_OFFSET + i * LEVEL_SIZE;
        const bidQty    = buf.readInt32LE(bidOff);
        const bidOrders = buf.readUInt16LE(bidOff + 4);
        const bidPrice  = buf.readFloatLE(bidOff + 6);
        if (bidPrice > 0) bids.push({ price: bidPrice, qty: bidQty, orders: bidOrders });

        const askOff = ASK_OFFSET + i * LEVEL_SIZE;
        const askQty    = buf.readInt32LE(askOff);
        const askOrders = buf.readUInt16LE(askOff + 4);
        const askPrice  = buf.readFloatLE(askOff + 6);
        if (askPrice > 0) asks.push({ price: askPrice, qty: askQty, orders: askOrders });
      }

      const totalBuyQty  = bids.reduce((s, b) => s + b.qty, 0);
      const totalSellQty = asks.reduce((s, a) => s + a.qty, 0);

      this.emit('depth', {
        token: String(securityId),
        bids,
        asks,
        totalBuyQty,
        totalSellQty,
      });
    } catch (_) {}
  }

  _resubscribeAll() {
    if (this._subscriptions.size === 0) return;

    // Group by mode
    const byMode = new Map();
    for (const [secId, { segment, mode }] of this._subscriptions) {
      if (!byMode.has(mode)) byMode.set(mode, []);
      byMode.get(mode).push({ ExchangeSegment: segment, SecurityId: secId });
    }

    for (const [mode, list] of byMode) {
      const payload = { RequestCode: mode, InstrumentCount: list.length, InstrumentList: list };
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(payload));
      }
    }
    console.log(`[DhanWS] Re-subscribed ${this._subscriptions.size} instruments`);
  }

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.ping();
      }
    }, 30000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnects) {
      console.error('[DhanWS] Max reconnect attempts reached');
      this.emit('max_reconnects');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);
    this._reconnectAttempts++;

    console.log(`[DhanWS] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        console.error('[DhanWS] Reconnect failed:', err.message);
      }
    }, delay);
  }

  getStatus() {
    return {
      connected: this._connected,
      subscriptions: this._subscriptions.size,
      reconnectAttempts: this._reconnectAttempts,
    };
  }
}
