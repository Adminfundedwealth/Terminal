/**
 * SOCKET.IO SERVER — PRODUCTION HARDENED
 * 
 * Real-time communication layer between backend and frontend clients.
 * 
 * SECURITY:
 *   - No dev bypasses. JWT required always.
 *   - Per-socket message rate limiting.
 *   - Subscription count limits.
 *   - Auth verified on every connection.
 */

import { Server as SocketIOServer } from 'socket.io';
import { verifySessionJWT } from '../services/auth.service.js';
import { isSessionValid } from '../services/session.service.js';

const MAX_SUBSCRIPTIONS_PER_SOCKET = 200;
const MAX_MESSAGES_PER_SECOND = 30;

export class RealtimeServer {
  constructor(httpServer, marketDataEngine, options = {}) {
    this.marketDataEngine = marketDataEngine;
    this.clientCount = 0;
    this.subscriptionMap = new Map();

    this.io = new SocketIOServer(httpServer, {
      path: '/socket.io',
      cors: {
        origin: options.corsOrigin || [],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingInterval: 25000,
      pingTimeout: 20000,
    });

    this._setupAuth();
    this._setupHandlers();
    this._setupMarketDataBridge();
  }

  /**
   * Authentication middleware — PRODUCTION: No bypasses.
   */
  _setupAuth() {
    this.io.use(async (socket, next) => {
      // Try handshake auth token
      let token = socket.handshake.auth?.token;

      // Try cookie
      if (!token) {
        const cookieHeader = socket.handshake.headers.cookie || '';
        const match = cookieHeader.match(/(?:^|;\s*)fw_session=([^;]*)/);
        token = match ? match[1] : null;
      }

      // Try query param (fallback for WebSocket-only)
      if (!token) {
        token = socket.handshake.query?.token;
      }

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const result = verifySessionJWT(token);
      if (!result.valid) {
        return next(new Error(result.error === 'expired' ? 'Session expired' : 'Invalid token'));
      }

      // Verify session is still active in DB (fail-closed)
      const sessionActive = await isSessionValid(token);
      if (!sessionActive) {
        return next(new Error('Session revoked'));
      }

      socket.user = result.claims;
      next();
    });
  }

  /**
   * Setup connection and message handlers with rate limiting.
   */
  _setupHandlers() {
    this.io.on('connection', (socket) => {
      this.clientCount++;
      const user = socket.user;

      // Join account room for order/position updates
      if (user.accountId) {
        socket.join(`account:${user.accountId}`);
      }

      // Initialize subscription tracking
      this.subscriptionMap.set(socket.id, new Set());

      // Rate limiting per socket
      let messageCount = 0;
      const rateLimitTimer = setInterval(() => { messageCount = 0; }, 1000);

      // Send initial market status
      socket.emit('market_status', { status: this._getMarketStatus() });

      // ─── Quote Subscriptions ─────────────────────────────
      socket.on('subscribe', (data) => {
        messageCount++;
        if (messageCount > MAX_MESSAGES_PER_SECOND) return;

        const tokens = data?.tokens || [];
        const subs = this.subscriptionMap.get(socket.id);

        if (subs.size + tokens.length > MAX_SUBSCRIPTIONS_PER_SOCKET) {
          socket.emit('error', { message: `Max ${MAX_SUBSCRIPTIONS_PER_SOCKET} subscriptions.` });
          return;
        }

        tokens.forEach((token) => {
          if (!/^[A-Za-z0-9_]{1,30}$/.test(token)) return; // Validate token format
          socket.join(`quote:${token}`);
          subs.add(token);

          const cached = this.marketDataEngine.getQuote(token);
          if (cached) {
            socket.emit('quote', { token, data: cached });
          }
        });
      });

      socket.on('unsubscribe', (data) => {
        messageCount++;
        if (messageCount > MAX_MESSAGES_PER_SECOND) return;

        const tokens = data?.tokens || [];
        const subs = this.subscriptionMap.get(socket.id);

        tokens.forEach((token) => {
          socket.leave(`quote:${token}`);
          subs.delete(token);
        });
      });

      // ─── Depth Subscriptions ─────────────────────────────
      socket.on('subscribe_depth', (data) => {
        messageCount++;
        if (messageCount > MAX_MESSAGES_PER_SECOND) return;

        const tokens = data?.tokens || [];
        tokens.forEach((token) => {
          if (!/^[A-Za-z0-9_]{1,30}$/.test(token)) return;
          socket.join(`depth:${token}`);
        });
      });

      socket.on('unsubscribe_depth', (data) => {
        messageCount++;
        if (messageCount > MAX_MESSAGES_PER_SECOND) return;

        const tokens = data?.tokens || [];
        tokens.forEach((token) => {
          socket.leave(`depth:${token}`);
        });
      });

      // ─── Ping/Pong ──────────────────────────────────────
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // ─── Disconnect ─────────────────────────────────────
      socket.on('disconnect', () => {
        this.clientCount--;
        this.subscriptionMap.delete(socket.id);
        clearInterval(rateLimitTimer);
      });
    });
  }

  /**
   * Bridge market data engine events to Socket.IO rooms.
   */
  _setupMarketDataBridge() {
    const originalPushQuote = this.marketDataEngine.pushQuote.bind(this.marketDataEngine);
    const originalPushDepth = this.marketDataEngine.pushDepth.bind(this.marketDataEngine);

    this.marketDataEngine.pushQuote = (token, data) => {
      originalPushQuote(token, data);
      this.io.to(`quote:${token}`).emit('quote', { token, data });
    };

    this.marketDataEngine.pushDepth = (token, data) => {
      originalPushDepth(token, data);
      this.io.to(`depth:${token}`).emit('depth', { token, data });
    };
  }

  broadcastOrderUpdate(accountId, orderData) {
    this.io.to(`account:${accountId}`).emit('order_update', { data: orderData });
  }

  broadcastPositionUpdate(accountId, positionData) {
    this.io.to(`account:${accountId}`).emit('position_update', { data: positionData });
  }

  broadcastRiskAlert(accountId, alertData) {
    this.io.to(`account:${accountId}`).emit('risk_alert', { data: alertData });
  }

  broadcastMarketStatus(status) {
    this.io.emit('market_status', { status });
  }

  _getMarketStatus() {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const hours = ist.getUTCHours();
    const minutes = ist.getUTCMinutes();
    const time = hours * 60 + minutes;
    const day = ist.getUTCDay();

    if (day === 0 || day === 6) return 'CLOSED';
    if (time >= 555 && time < 570) return 'PRE_OPEN';
    if (time >= 570 && time < 930) return 'OPEN';
    if (time >= 930 && time < 960) return 'POST_CLOSE';
    return 'CLOSED';
  }

  getStatus() {
    return {
      clients: this.clientCount,
      rooms: this.io.sockets.adapter.rooms.size,
      subscriptions: Array.from(this.subscriptionMap.values())
        .reduce((sum, s) => sum + s.size, 0),
    };
  }

  close() {
    this.io.close();
  }
}
