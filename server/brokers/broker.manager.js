/**
 * BROKER MANAGER
 * 
 * Top-level orchestrator for the broker failover architecture.
 * Coordinates: BrokerFactory + BrokerHealthService + BrokerFailoverService.
 * 
 * Responsibilities:
 *   - Initialize and wire up health + failover services
 *   - Route all broker operations through the active adapter
 *   - Instrument API calls with latency/error tracking
 *   - Expose unified health endpoint data
 *   - Manage broker lifecycle (connect, disconnect, refresh)
 * 
 * Usage:
 *   const manager = new BrokerManager();
 *   await manager.initialize();
 *   const result = await manager.execute('placeOrder', orderParams);
 * 
 * NO UI. NO FRONTEND. Architecture only.
 */

import { BrokerFactory } from './broker.factory.js';
import { BrokerHealthService, HealthState } from './broker.health.service.js';
import { BrokerFailoverService, FailoverMode } from './broker.failover.service.js';

export class BrokerManager {
  constructor(options = {}) {
    this.primaryProvider = options.primary || 'angelone';
    this.secondaryProvider = options.secondary || 'dhan';

    // Core services
    this.healthService = new BrokerHealthService({
      checkInterval: options.healthCheckInterval || 10000,
      thresholds: options.thresholds || {},
    });

    this.failoverService = new BrokerFailoverService({
      primary: this.primaryProvider,
      secondary: this.secondaryProvider,
      cooldown: options.failoverCooldown || 120000,
      monitoringWait: options.monitoringWait || 15000,
      recoveryConfirm: options.recoveryConfirm || 30000,
      maxFailovers: options.maxFailoversPerHour || 3,
    });

    // Wire failover to health
    this.failoverService.attachHealthService(this.healthService);

    // Track last heartbeat for health endpoint
    this._lastHeartbeat = null;
    this._initialized = false;

    // Listen for failover events for logging
    this.failoverService.on('failover:activated', (e) => {
      console.warn(`[BrokerManager] ⚠️  Active broker switched: ${e.from} → ${e.to}`);
      this._lastHeartbeat = Date.now();
    });
    this.failoverService.on('failover:recovered', (e) => {
      console.log(`[BrokerManager] ✓ Active broker recovered: ${e.from} → ${e.to} (downtime: ${Math.round(e.downtime / 1000)}s)`);
      this._lastHeartbeat = Date.now();
    });
  }

  // ─── Initialization ────────────────────────────────────────────

  /**
   * Initialize broker manager.
   * Registers brokers, attempts connections, starts health monitoring.
   */
  async initialize() {
    console.log('[BrokerManager] Initializing...');

    // Register both brokers for health tracking
    this.healthService.registerBroker(this.primaryProvider, null);
    this.healthService.registerBroker(this.secondaryProvider, null);

    // Attempt primary connection
    try {
      const adapter = await BrokerFactory.create(this.primaryProvider);
      if (adapter?.session?.expiresAt) {
        this.healthService.recordAuthExpiry(this.primaryProvider, adapter.session.expiresAt);
      }
      this.healthService.recordSuccess(this.primaryProvider);
      this.healthService.recordWsConnected(this.primaryProvider);
      console.log(`[BrokerManager] ✓ Primary (${this.primaryProvider}) connected`);
    } catch (err) {
      console.warn(`[BrokerManager] ✗ Primary (${this.primaryProvider}) failed: ${err.message}`);
      this.healthService.recordError(this.primaryProvider, err);
    }

    // Attempt secondary connection (non-blocking)
    try {
      const adapter = await BrokerFactory.create(this.secondaryProvider);
      if (adapter?.session?.expiresAt) {
        this.healthService.recordAuthExpiry(this.secondaryProvider, adapter.session.expiresAt);
      }
      this.healthService.recordSuccess(this.secondaryProvider);
      console.log(`[BrokerManager] ✓ Secondary (${this.secondaryProvider}) connected`);
    } catch (err) {
      console.warn(`[BrokerManager] ○ Secondary (${this.secondaryProvider}) not available: ${err.message}`);
      // Not critical — secondary is backup only
    }

    // Start health monitoring
    this.healthService.start();
    this._lastHeartbeat = Date.now();
    this._initialized = true;

    console.log('[BrokerManager] ✓ Initialized');
    return true;
  }

  // ─── Shutdown ──────────────────────────────────────────────────

  /**
   * Shutdown broker manager. Stops health monitoring.
   */
  destroy() {
    this.healthService.stop();
    this._initialized = false;
    console.log('[BrokerManager] Destroyed');
  }
}
