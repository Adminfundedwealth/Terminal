/**
 * BROKER HEALTH MONITOR
 * 
 * Periodically checks broker adapter connectivity.
 * Reports status to BrokerFactory health map.
 * Triggers reconnection attempts on failure.
 * 
 * Usage:
 *   const monitor = new HealthMonitor();
 *   monitor.start();  // Begins periodic checks
 *   monitor.stop();   // Stops checks
 */

import { BrokerFactory } from './broker.factory.js';

export class HealthMonitor {
  constructor(options = {}) {
    this.interval = options.interval || 30000; // 30s default
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
    this._timer = null;
    this._isRunning = false;
    this._retryCount = new Map();
  }

  /**
   * Start the health monitor loop.
   */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    console.log(`[HealthMonitor] Started (interval: ${this.interval / 1000}s)`);
    this._timer = setInterval(() => this.check(), this.interval);
  }

  /**
   * Stop the health monitor.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._isRunning = false;
    console.log('[HealthMonitor] Stopped');
  }

  /**
   * Run a single health check cycle.
   */
  async check() {
    const connections = BrokerFactory.listConnections();

    for (const conn of connections) {
      const adapter = BrokerFactory.get(conn.provider, conn.key.split(':')[1]);
      if (!adapter) continue;

      try {
        // Check if session is still valid
        if (!adapter.isConnected) {
          console.warn(`[HealthMonitor] ${conn.key} — session expired, attempting reconnect`);
          await this._attemptReconnect(conn.key, adapter);
        } else {
          // Reset retry count on healthy connection
          this._retryCount.delete(conn.key);
          BrokerFactory.healthStatus.set(conn.key, {
            ...BrokerFactory.healthStatus.get(conn.key),
            connected: true,
            lastCheck: Date.now(),
            lastError: null,
          });
        }
      } catch (err) {
        console.error(`[HealthMonitor] ${conn.key} — check failed:`, err.message);
        BrokerFactory.healthStatus.set(conn.key, {
          ...BrokerFactory.healthStatus.get(conn.key),
          connected: false,
          lastCheck: Date.now(),
          lastError: err.message,
        });
      }
    }
  }

  /**
   * Attempt to reconnect a failed adapter.
   */
  async _attemptReconnect(key, adapter) {
    const retries = this._retryCount.get(key) || 0;

    if (retries >= this.maxRetries) {
      console.error(`[HealthMonitor] ${key} — max retries (${this.maxRetries}) exceeded. Giving up.`);
      BrokerFactory.healthStatus.set(key, {
        ...BrokerFactory.healthStatus.get(key),
        connected: false,
        lastCheck: Date.now(),
        lastError: `Max retries exceeded after ${retries} attempts`,
      });
      return;
    }

    this._retryCount.set(key, retries + 1);

    try {
      console.log(`[HealthMonitor] ${key} — reconnect attempt ${retries + 1}/${this.maxRetries}`);
      await adapter.refreshSession();
      this._retryCount.delete(key);
      BrokerFactory.healthStatus.set(key, {
        ...BrokerFactory.healthStatus.get(key),
        connected: true,
        lastCheck: Date.now(),
        lastError: null,
      });
      console.log(`[HealthMonitor] ${key} — reconnected successfully`);
    } catch (err) {
      console.warn(`[HealthMonitor] ${key} — reconnect failed: ${err.message}`);
      BrokerFactory.healthStatus.set(key, {
        ...BrokerFactory.healthStatus.get(key),
        connected: false,
        lastCheck: Date.now(),
        lastError: err.message,
      });
    }
  }

  /**
   * Get current monitor status.
   */
  getStatus() {
    return {
      isRunning: this._isRunning,
      interval: this.interval,
      maxRetries: this.maxRetries,
      activeConnections: BrokerFactory.listConnections().length,
      healthReport: BrokerFactory.getHealthReport(),
    };
  }
}
