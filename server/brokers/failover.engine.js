/**
 * FAILOVER ENGINE
 * 
 * Manages broker failover when primary adapter fails.
 * Strategy:
 *   1. Primary broker (e.g. AngelOne) handles all operations
 *   2. On failure → attempt retry with primary
 *   3. On repeated failure → switch to secondary (e.g. Dhan)
 *   4. On secondary recovery → revert to primary
 * 
 * Configuration:
 *   Primary: angelone (full implementation)
 *   Secondary: dhan (pending implementation)
 * 
 * NOTE: Failover is only possible when secondary adapter is implemented.
 * Currently operates in single-adapter mode.
 */

import { BrokerFactory } from './broker.factory.js';

export class FailoverEngine {
  constructor(options = {}) {
    this.primaryProvider = options.primary || 'angelone';
    this.secondaryProvider = options.secondary || 'dhan';
    this.maxPrimaryRetries = options.maxRetries || 2;
    this.failoverActive = false;
    this._primaryFailCount = 0;
    this._lastFailoverTime = null;
    this._cooldownMs = options.cooldown || 60000; // 1 min cooldown before reverting
  }

  /**
   * Execute an operation with failover support.
   * Tries primary first, falls back to secondary on repeated failure.
   * 
   * @param {Function} operation - async fn(adapter) => result
   * @param {string} operationName - for logging
   */
  async execute(operation, operationName = 'operation') {
    // Try primary
    if (!this.failoverActive) {
      try {
        const adapter = await this._getAdapter(this.primaryProvider);
        const result = await operation(adapter);
        this._primaryFailCount = 0; // Reset on success
        return result;
      } catch (err) {
        this._primaryFailCount++;
        console.warn(`[Failover] ${this.primaryProvider} failed (${this._primaryFailCount}/${this.maxPrimaryRetries}): ${err.message}`);

        if (this._primaryFailCount < this.maxPrimaryRetries) {
          // Retry once more with primary
          try {
            const adapter = await this._getAdapter(this.primaryProvider);
            const result = await operation(adapter);
            this._primaryFailCount = 0;
            return result;
          } catch (retryErr) {
            this._primaryFailCount++;
            console.error(`[Failover] ${this.primaryProvider} retry failed: ${retryErr.message}`);
          }
        }

        // Switch to secondary
        return this._failover(operation, operationName);
      }
    } else {
      // Already in failover mode — use secondary
      return this._executeSecondary(operation, operationName);
    }
  }

  /**
   * Activate failover to secondary broker.
   */
  async _failover(operation, operationName) {
    console.warn(`[Failover] Switching to ${this.secondaryProvider} for: ${operationName}`);
    this.failoverActive = true;
    this._lastFailoverTime = Date.now();

    return this._executeSecondary(operation, operationName);
  }

  /**
   * Execute on secondary adapter.
   */
  async _executeSecondary(operation, operationName) {
    try {
      const adapter = await this._getAdapter(this.secondaryProvider);
      const result = await operation(adapter);
      return result;
    } catch (err) {
      // Both primary and secondary failed
      throw new Error(`[Failover] Both ${this.primaryProvider} and ${this.secondaryProvider} failed for ${operationName}: ${err.message}`);
    }
  }

  /**
   * Attempt to revert to primary (call periodically).
   */
  async attemptRevert() {
    if (!this.failoverActive) return false;

    // Respect cooldown
    if (Date.now() - this._lastFailoverTime < this._cooldownMs) {
      return false;
    }

    try {
      const adapter = await this._getAdapter(this.primaryProvider);
      if (adapter && adapter.isConnected) {
        this.failoverActive = false;
        this._primaryFailCount = 0;
        console.log(`[Failover] Reverted to primary: ${this.primaryProvider}`);
        return true;
      }
    } catch {
      // Primary still down
    }
    return false;
  }

  /**
   * Get adapter from factory.
   */
  async _getAdapter(provider) {
    try {
      return await BrokerFactory.create(provider);
    } catch (err) {
      throw new Error(`[Failover] Cannot get ${provider} adapter: ${err.message}`);
    }
  }

  /**
   * Get current failover status.
   */
  getStatus() {
    return {
      primaryProvider: this.primaryProvider,
      secondaryProvider: this.secondaryProvider,
      failoverActive: this.failoverActive,
      primaryFailCount: this._primaryFailCount,
      lastFailoverTime: this._lastFailoverTime,
      cooldownMs: this._cooldownMs,
    };
  }
}
