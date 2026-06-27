/**
 * REDIS PUB/SUB INTEGRATION
 * 
 * Provides horizontal scaling support for market data distribution.
 * When multiple server instances run behind a load balancer,
 * Redis Pub/Sub ensures all instances receive market data ticks.
 * 
 * Channels:
 *   fw:quote:{token}     — LTP updates
 *   fw:depth:{token}     — Market depth updates
 *   fw:order:{accountId} — Order status updates
 *   fw:risk:{accountId}  — Risk alerts
 *   fw:market_status     — Market open/close status
 * 
 * STATUS: Integration points defined. Redis connection optional.
 * If REDIS_URL is not set, operates in single-instance mode (no-op).
 */

let Redis;
try {
  Redis = (await import('ioredis')).default;
} catch {
  Redis = null;
}

export class RedisPubSub {
  constructor(options = {}) {
    this.redisUrl = options.url || process.env.REDIS_URL || null;
    this.publisher = null;
    this.subscriber = null;
    this.isConnected = false;
    this._handlers = new Map(); // channel pattern -> callback[]
  }

  /**
   * Initialize Redis connections (publisher + subscriber).
   * No-op if REDIS_URL not configured.
   */
  async initialize() {
    if (!this.redisUrl) {
      console.log('[Redis] REDIS_URL not set — operating in single-instance mode');
      return false;
    }

    if (!Redis) {
      console.warn('[Redis] ioredis not available — operating in single-instance mode');
      return false;
    }

    try {
      const opts = {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      };

      this.publisher = new Redis(this.redisUrl, opts);
      this.subscriber = new Redis(this.redisUrl, opts);

      await this.publisher.connect();
      await this.subscriber.connect();

      this.isConnected = true;
      console.log('[Redis] ✓ Pub/Sub connected');

      // Handle disconnection
      this.publisher.on('error', (err) => {
        console.error('[Redis] Publisher error:', err.message);
      });
      this.subscriber.on('error', (err) => {
        console.error('[Redis] Subscriber error:', err.message);
      });

      return true;
    } catch (err) {
      console.warn(`[Redis] Connection failed: ${err.message} — falling back to single-instance`);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Publish a message to a channel.
   * No-op if Redis not connected.
   */
  async publish(channel, data) {
    if (!this.isConnected || !this.publisher) return;

    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      await this.publisher.publish(channel, payload);
    } catch (err) {
      console.error(`[Redis] Publish error on ${channel}:`, err.message);
    }
  }

  /**
   * Subscribe to a channel pattern.
   * Callback receives (channel, parsedData).
   */
  async subscribe(pattern, callback) {
    if (!this._handlers.has(pattern)) {
      this._handlers.set(pattern, []);
    }
    this._handlers.get(pattern).push(callback);

    if (!this.isConnected || !this.subscriber) return;

    try {
      await this.subscriber.psubscribe(pattern);
      this.subscriber.on('pmessage', (pat, channel, message) => {
        if (pat === pattern) {
          try {
            const data = JSON.parse(message);
            const handlers = this._handlers.get(pattern) || [];
            handlers.forEach((h) => h(channel, data));
          } catch {
            // Ignore parse errors
          }
        }
      });
    } catch (err) {
      console.error(`[Redis] Subscribe error for ${pattern}:`, err.message);
    }
  }

  /**
   * Publish a quote update.
   */
  publishQuote(token, quoteData) {
    return this.publish(`fw:quote:${token}`, quoteData);
  }

  /**
   * Publish a depth update.
   */
  publishDepth(token, depthData) {
    return this.publish(`fw:depth:${token}`, depthData);
  }

  /**
   * Publish an order update.
   */
  publishOrderUpdate(accountId, orderData) {
    return this.publish(`fw:order:${accountId}`, orderData);
  }

  /**
   * Publish a risk alert.
   */
  publishRiskAlert(accountId, alertData) {
    return this.publish(`fw:risk:${accountId}`, alertData);
  }

  /**
   * Publish market status change.
   */
  publishMarketStatus(status) {
    return this.publish('fw:market_status', { status, timestamp: Date.now() });
  }

  /**
   * Cache a value with TTL (for quote snapshots, etc.)
   */
  async setCache(key, value, ttlSeconds = 60) {
    if (!this.isConnected || !this.publisher) return;
    try {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      await this.publisher.set(key, payload, 'EX', ttlSeconds);
    } catch (err) {
      console.error(`[Redis] Cache set error:`, err.message);
    }
  }

  /**
   * Get a cached value.
   */
  async getCache(key) {
    if (!this.isConnected || !this.publisher) return null;
    try {
      const val = await this.publisher.get(key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get connection status.
   */
  getStatus() {
    return {
      connected: this.isConnected,
      url: this.redisUrl ? '(configured)' : '(not configured)',
      handlers: this._handlers.size,
    };
  }

  /**
   * Graceful shutdown.
   */
  async shutdown() {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => {});
    }
    if (this.publisher) {
      await this.publisher.quit().catch(() => {});
    }
    this.isConnected = false;
    console.log('[Redis] Pub/Sub disconnected');
  }
}
