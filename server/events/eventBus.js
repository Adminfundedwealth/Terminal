/**
 * EVENT BUS — Central Pub/Sub for FundedWealth Terminal
 * 
 * Channels:
 *   market.tick         — LTP/quote updates from broker feed
 *   order.created       — New order placed
 *   order.updated       — Order status changed (filled, rejected, cancelled)
 *   position.updated    — Position MTM/qty changed
 *   trade.executed      — Trade fill confirmed
 *   challenge.updated   — Challenge status transition
 *   risk.alert          — Risk threshold warning or breach
 * 
 * Design:
 *   - Synchronous in-process pub/sub (EventEmitter pattern)
 *   - Optional Redis forwarding for horizontal scaling
 *   - Wildcard subscriptions supported (e.g. "order.*")
 *   - Typed payloads per channel
 *   - Metrics collection (emit count, listener count)
 *   - No UI dependency — pure server-side bus
 */

import { EventEmitter } from 'events';
import { CHANNELS, validatePayload } from './channels.js';

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
    this._metrics = {
      totalEmitted: 0,
      byChannel: {},
      startedAt: Date.now(),
    };
    this._redisPubSub = null;
    this._wildcardListeners = new Map();
  }

  /**
   * Connect optional Redis pub/sub for multi-instance broadcasting.
   * @param {import('../realtime/redis.pubsub.js').RedisPubSub} redisPubSub
   */
  connectRedis(redisPubSub) {
    this._redisPubSub = redisPubSub;
    console.log('[EventBus] Redis bridge connected');
  }

  /**
   * Publish an event to a channel.
   * @param {string} channel - One of CHANNELS keys (e.g. "market.tick")
   * @param {object} payload - Channel-specific data
   * @param {object} [meta] - Optional metadata (accountId, source, etc.)
   */
  publish(channel, payload, meta = {}) {
    const event = {
      channel,
      payload,
      meta: {
        timestamp: Date.now(),
        ...meta,
      },
    };

    // Validate channel exists
    if (!CHANNELS[channel]) {
      console.warn(`[EventBus] Unknown channel: ${channel}`);
      return;
    }

    // Validate payload shape (dev mode)
    if (process.env.NODE_ENV !== 'production') {
      const validation = validatePayload(channel, payload);
      if (!validation.valid) {
        console.warn(`[EventBus] Invalid payload on ${channel}: ${validation.reason}`);
      }
    }

    // Track metrics
    this._metrics.totalEmitted++;
    if (!this._metrics.byChannel[channel]) {
      this._metrics.byChannel[channel] = 0;
    }
    this._metrics.byChannel[channel]++;

    // Emit to local listeners
    this.emit(channel, event);

    // Emit to wildcard listeners (e.g. "order.*" matches "order.created")
    const prefix = channel.split('.')[0] + '.*';
    this.emit(prefix, event);

    // Emit global wildcard
    this.emit('*', event);

    // Forward to Redis for multi-instance sync
    if (this._redisPubSub && this._redisPubSub.isConnected) {
      this._redisPubSub.publish(`fw:event:${channel}`, event);
    }
  }

  /**
   * Subscribe to a channel.
   * @param {string} channel - Channel name or wildcard (e.g. "order.*")
   * @param {function} handler - Receives { channel, payload, meta }
   * @returns {function} Unsubscribe function
   */
  subscribe(channel, handler) {
    this.on(channel, handler);
    return () => this.off(channel, handler);
  }

  /**
   * Subscribe once (auto-removes after first event).
   */
  subscribeOnce(channel, handler) {
    this.once(channel, handler);
  }

  /**
   * Get bus metrics for health monitoring.
   */
  getMetrics() {
    return {
      totalEmitted: this._metrics.totalEmitted,
      byChannel: { ...this._metrics.byChannel },
      listenerCounts: this._getListenerCounts(),
      uptimeMs: Date.now() - this._metrics.startedAt,
      redisConnected: this._redisPubSub?.isConnected || false,
    };
  }

  _getListenerCounts() {
    const counts = {};
    for (const channel of Object.keys(CHANNELS)) {
      const count = this.listenerCount(channel);
      if (count > 0) counts[channel] = count;
    }
    // Also check wildcards
    const wildcards = ['*', 'order.*', 'market.*', 'position.*', 'trade.*', 'challenge.*', 'risk.*', 'account.*'];
    for (const wc of wildcards) {
      const count = this.listenerCount(wc);
      if (count > 0) counts[wc] = count;
    }
    return counts;
  }

  /**
   * Reset metrics (for testing).
   */
  resetMetrics() {
    this._metrics = {
      totalEmitted: 0,
      byChannel: {},
      startedAt: Date.now(),
    };
  }

  /**
   * Remove all listeners and clean up.
   */
  destroy() {
    this.removeAllListeners();
    this._redisPubSub = null;
    this._metrics = { totalEmitted: 0, byChannel: {}, startedAt: Date.now() };
    console.log('[EventBus] Destroyed');
  }
}

// Singleton instance
export const eventBus = new EventBus();
