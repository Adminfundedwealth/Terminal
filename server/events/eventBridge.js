/**
 * EVENT BRIDGE — Connects EventBus to WebSocket/Socket.IO Clients
 * 
 * Responsibilities:
 *   1. Subscribes to ALL event bus channels
 *   2. Routes "global" events to all connected clients (market.tick → room quote:{token})
 *   3. Routes "account" events to specific account rooms (order.* → account:{id})
 *   4. Applies throttling per channel definition
 *   5. Formats payload into the WS message shape frontend expects
 * 
 * This replaces direct REST polling for order/position/challenge updates.
 * Frontend consumes events via WebSocket only.
 */

import { eventBus } from './eventBus.js';
import { CHANNELS } from './channels.js';

export class EventBridge {
  /**
   * @param {object} options
   * @param {import('../realtime/socketio.server.js').RealtimeServer} options.realtimeServer
   * @param {import('ws').WebSocketServer} [options.wss] - Legacy WS server (optional)
   */
  constructor(options = {}) {
    this.realtimeServer = options.realtimeServer || null;
    this.wss = options.wss || null;
    this._unsubscribers = [];
    this._throttleState = new Map(); // key → lastEmitTimestamp
    this._stats = {
      forwarded: 0,
      throttled: 0,
      byChannel: {},
    };
  }

  /**
   * Start bridging events to clients.
   * Call after Socket.IO and WS servers are initialized.
   */
  start() {
    console.log('[EventBridge] Starting event-to-client bridge...');

    // Subscribe to each defined channel
    for (const [channel, def] of Object.entries(CHANNELS)) {
      const unsub = eventBus.subscribe(channel, (event) => {
        this._handleEvent(channel, def, event);
      });
      this._unsubscribers.push(unsub);
    }

    console.log(`[EventBridge] ✓ Listening on ${Object.keys(CHANNELS).length} channels`);
  }

  /**
   * Handle an event from the bus and route to clients.
   */
  _handleEvent(channel, def, event) {
    const { payload, meta } = event;

    // Apply throttling
    if (def.throttleMs > 0) {
      const throttleKey = this._getThrottleKey(channel, payload, meta);
      const lastEmit = this._throttleState.get(throttleKey) || 0;
      const now = Date.now();

      if (now - lastEmit < def.throttleMs) {
        this._stats.throttled++;
        return;
      }
      this._throttleState.set(throttleKey, now);
    }

    // Track stats
    this._stats.forwarded++;
    if (!this._stats.byChannel[channel]) this._stats.byChannel[channel] = 0;
    this._stats.byChannel[channel]++;

    // Route based on scope
    if (def.scope === 'global') {
      this._broadcastGlobal(channel, def, payload, meta);
    } else if (def.scope === 'account') {
      this._broadcastToAccount(channel, def, payload, meta);
    }
  }

  /**
   * Broadcast global event (e.g. market.tick → quote:{token} room).
   */
  _broadcastGlobal(channel, def, payload, meta) {
    if (channel === 'market.tick') {
      const token = payload.token;
      const wsMessage = { type: 'quote', token, data: payload };

      // Socket.IO: emit to room quote:{token}
      if (this.realtimeServer?.io) {
        this.realtimeServer.io.to(`quote:${token}`).emit(def.wsEvent, { token, data: payload });
      }

      // Legacy WS: send to clients subscribed to this token
      if (this.wss) {
        this._sendToLegacyWS(wsMessage);
      }
    }
  }

  /**
   * Broadcast account-scoped event to the specific account room.
   */
  _broadcastToAccount(channel, def, payload, meta) {
    const accountId = meta.accountId || payload.accountId;
    if (!accountId) {
      console.warn(`[EventBridge] Account-scoped event ${channel} missing accountId`);
      return;
    }

    const wsMessage = { type: def.wsEvent, data: payload };

    // Socket.IO: emit to account room
    if (this.realtimeServer?.io) {
      this.realtimeServer.io.to(`account:${accountId}`).emit(def.wsEvent, { data: payload });
    }

    // Legacy WS: broadcast to all (no account filtering on legacy WS)
    if (this.wss) {
      this._sendToLegacyWS(wsMessage);
    }
  }

  /**
   * Send message to all connected legacy WebSocket clients.
   */
  _sendToLegacyWS(message) {
    if (!this.wss) return;
    const msg = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(msg);
      }
    });
  }

  /**
   * Generate throttle key based on channel + discriminator.
   */
  _getThrottleKey(channel, payload, meta) {
    switch (channel) {
      case 'market.tick':
        return `${channel}:${payload.token}`;
      case 'position.updated':
        return `${channel}:${meta.accountId}:${payload.token}`;
      case 'challenge.updated':
        return `${channel}:${payload.challengeId}`;
      case 'risk.alert':
        return `${channel}:${meta.accountId}:${payload.ruleType}`;
      default:
        return `${channel}:${meta.accountId || 'global'}`;
    }
  }

  /**
   * Set the realtime server (if initialized after bridge creation).
   */
  setRealtimeServer(realtimeServer) {
    this.realtimeServer = realtimeServer;
  }

  /**
   * Set the legacy WebSocket server.
   */
  setWss(wss) {
    this.wss = wss;
  }

  /**
   * Get bridge statistics.
   */
  getStats() {
    return {
      forwarded: this._stats.forwarded,
      throttled: this._stats.throttled,
      byChannel: { ...this._stats.byChannel },
      throttleCacheSize: this._throttleState.size,
    };
  }

  /**
   * Clean up throttle cache periodically (call from interval).
   */
  cleanThrottleCache() {
    const now = Date.now();
    const maxAge = 60000; // 1 minute
    for (const [key, ts] of this._throttleState) {
      if (now - ts > maxAge) {
        this._throttleState.delete(key);
      }
    }
  }

  /**
   * Stop the bridge and unsubscribe from all channels.
   */
  stop() {
    this._unsubscribers.forEach((unsub) => unsub());
    this._unsubscribers = [];
    this._throttleState.clear();
    console.log('[EventBridge] Stopped');
  }
}
