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
   * Ticker (code 15): 32 bytes per instrument
   *   Bytes 0-1: Response code
   *   Bytes 2-3: Exchange segment
   *   Bytes 4-7: Security ID
   *   Bytes 8-11: LTP (float)
   *   Bytes 12-15: Close (previous day close)
   * 
   * Quote (code 17): 56 bytes per instrument  
   *   Adds: Open, High, Low, Volume, Avg Price, OI
   */
  _parseBinaryPacket(buf) {
    if (buf.length < 8) return;

    const responseCode = buf.readUInt16LE(0);

    if (responseCode === 15) {
      // Ticker packet
      this._parseTickerPacket(buf);
    } else if (responseCode === 17) {
      // Quote packet
      this._parseQuotePacket(buf);
    } else if (responseCode === 21) {
      // Depth packet
      this._parseDepthPacket(buf);
    }
  }

  _parseTickerPacket(buf) {
    // Ticker: response_code(2) + exchange_segment(1) + security_id(4) + ltp(4) + close(4) = ~15+ bytes
    if (buf.length < 15) return;

    try {
      const exchangeSeg = buf.readUInt8(2);
      const securityId = buf.readInt32LE(3);
      const ltp = buf.readFloatLE(7) || buf.readInt32LE(7) / 100;

      this.emit('tick', {
        token: String(securityId),
        ltp,
        type: 'ticker',
      });
    } catch (_) {}
  }

  _parseQuotePacket(buf) {
    // Quote has more fields — LTP, Open, High, Low, Close, Volume
    if (buf.length < 30) return;

    try {
      const exchangeSeg = buf.readUInt8(2);
      const securityId = buf.readInt32LE(3);
      const ltp = buf.readFloatLE(7) || buf.readInt32LE(7) / 100;
      const open = buf.readFloatLE(11) || 0;
      const high = buf.readFloatLE(15) || 0;
      const low = buf.readFloatLE(19) || 0;
      const close = buf.readFloatLE(23) || 0;
      const volume = buf.readInt32LE(27) || 0;

      this.emit('tick', {
        token: String(securityId),
        ltp, open, high, low, close, volume,
        type: 'quote',
      });
    } catch (_) {}
  }

  _parseDepthPacket(buf) {
    // Depth packets are larger — emit raw for now
    if (buf.length < 10) return;
    try {
      const securityId = buf.readInt32LE(3);
      this.emit('depth', { token: String(securityId), raw: buf });
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
