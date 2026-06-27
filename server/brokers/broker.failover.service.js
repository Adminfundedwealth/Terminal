/**
 * BROKER FAILOVER SERVICE
 * 
 * Automated broker switching based on health signals.
 * 
 * Strategy:
 *   PRIMARY (Angel One) ─── degraded/unhealthy ──→ SECONDARY (Dhan)
 *   SECONDARY (Dhan) ─── primary recovered ──→ PRIMARY (Angel One)
 * 
 * Triggers for Angel → Dhan:
 *   1. Auth expired + refresh failed (3x)
 *   2. WebSocket disconnected + reconnect failed (3x in 5 min)
 *   3. API latency > 5s (p95, sustained)
 *   4. Consecutive API errors ≥ 3
 * 
 * Triggers for Dhan → Angel (recovery):
 *   1. Angel health returns to HEALTHY
 *   2. Cooldown period elapsed (prevent flapping)
 *   3. Angel auth successfully refreshed
 * 
 * Emits events for logging/alerting. NO UI changes.
 */

import { EventEmitter } from 'events';
import { HealthState } from './broker.health.service.js';

/**
 * Failover modes.
 */
export const FailoverMode = {
  NORMAL: 'normal',               // Primary active, all good
  MONITORING: 'monitoring',       // Primary degraded, watching closely
  FAILOVER_ACTIVE: 'failover',   // Secondary active, primary down
  RECOVERING: 'recovering',       // Primary recovering, preparing switch-back
};

export class BrokerFailoverService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.primaryProvider = options.primary || 'angelone';
    this.secondaryProvider = options.secondary || 'dhan';

    // Failover configuration
    this.cooldownMs = options.cooldown || 120000;              // 2 min before recovery
    this.monitoringThresholdMs = options.monitoringWait || 15000; // 15s in degraded before failover
    this.recoveryConfirmMs = options.recoveryConfirm || 30000;   // 30s healthy before recovery
    this.maxFailoversPerHour = options.maxFailovers || 3;        // Prevent flapping

    // State
    this._mode = FailoverMode.NORMAL;
    this._activeBroker = this.primaryProvider;
    this._failoverTimestamp = null;
    this._recoveryStartedAt = null;
    this._monitoringStartedAt = null;
    this._failoverHistory = [];  // Timestamps of failovers for rate limiting
    this._healthService = null;  // Injected
  }

  /**
   * Wire up to BrokerHealthService events.
   */
  attachHealthService(healthService) {
    this._healthService = healthService;

    // Listen for state changes
    healthService.on('state:changed', (event) => this._onHealthStateChanged(event));
    healthService.on('auth:expired', (event) => this._onAuthExpired(event));
    healthService.on('errors:threshold', (event) => this._onErrorThreshold(event));
    healthService.on('ws:disconnected', (event) => this._onWsDisconnected(event));

    console.log('[BrokerFailover] Attached to health service');
  }

  // ─── Event Handlers ────────────────────────────────────────────

  _onHealthStateChanged({ provider, prevState, newState }) {
    if (provider === this.primaryProvider) {
      this._handlePrimaryStateChange(prevState, newState);
    } else if (provider === this.secondaryProvider) {
      this._handleSecondaryStateChange(prevState, newState);
    }
  }

  _handlePrimaryStateChange(prevState, newState) {
    switch (newState) {
      case HealthState.DEGRADED:
        if (this._mode === FailoverMode.NORMAL) {
          this._enterMonitoring();
        }
        break;

      case HealthState.UNHEALTHY:
      case HealthState.AUTH_EXPIRED:
      case HealthState.DISCONNECTED:
        if (this._mode !== FailoverMode.FAILOVER_ACTIVE) {
          this._triggerFailover(`Primary ${this.primaryProvider} state: ${newState}`);
        }
        break;

      case HealthState.HEALTHY:
        if (this._mode === FailoverMode.FAILOVER_ACTIVE) {
          this._enterRecovery();
        } else if (this._mode === FailoverMode.MONITORING) {
          this._exitMonitoring();
        } else if (this._mode === FailoverMode.RECOVERING) {
          this._checkRecoveryComplete();
        }
        break;
    }
  }

  _handleSecondaryStateChange(prevState, newState) {
    // If secondary goes unhealthy during failover, force back to primary
    if (this._mode === FailoverMode.FAILOVER_ACTIVE) {
      if (newState === HealthState.UNHEALTHY || newState === HealthState.DISCONNECTED) {
        console.warn(`[BrokerFailover] Secondary ${this.secondaryProvider} also unhealthy! Attempting primary recovery.`);
        this._forceRecovery();
      }
    }
  }

  _onAuthExpired({ provider }) {
    if (provider === this.primaryProvider && this._mode !== FailoverMode.FAILOVER_ACTIVE) {
      this._triggerFailover(`${provider} auth expired, refresh failed`);
    }
  }

  _onErrorThreshold({ provider, consecutive }) {
    if (provider === this.primaryProvider && this._mode !== FailoverMode.FAILOVER_ACTIVE) {
      this._triggerFailover(`${provider} consecutive errors: ${consecutive}`);
    }
  }

  _onWsDisconnected({ provider, count }) {
    // WebSocket disconnect alone doesn't trigger failover unless health already degraded
    if (provider === this.primaryProvider && this._mode === FailoverMode.MONITORING) {
      this._triggerFailover(`${provider} WebSocket disconnected (${count} total), already degraded`);
    }
  }

  // ─── State Transitions ─────────────────────────────────────────

  _enterMonitoring() {
    this._mode = FailoverMode.MONITORING;
    this._monitoringStartedAt = Date.now();
    console.log(`[BrokerFailover] MONITORING — ${this.primaryProvider} degraded, watching...`);
    this.emit('mode:changed', { mode: this._mode, reason: 'Primary degraded' });

    // Auto-failover if still degraded after threshold
    setTimeout(() => {
      if (this._mode === FailoverMode.MONITORING) {
        const primaryHealth = this._healthService?.getHealth(this.primaryProvider);
        if (primaryHealth && primaryHealth.state !== HealthState.HEALTHY) {
          this._triggerFailover(`Primary still ${primaryHealth.state} after ${this.monitoringThresholdMs / 1000}s`);
        }
      }
    }, this.monitoringThresholdMs);
  }

  _exitMonitoring() {
    this._mode = FailoverMode.NORMAL;
    this._monitoringStartedAt = null;
    console.log(`[BrokerFailover] NORMAL — ${this.primaryProvider} recovered from degraded`);
    this.emit('mode:changed', { mode: this._mode, reason: 'Primary recovered' });
  }

  _triggerFailover(reason) {
    // Rate limit check
    const hourAgo = Date.now() - 3600000;
    const recentFailovers = this._failoverHistory.filter(t => t > hourAgo).length;
    if (recentFailovers >= this.maxFailoversPerHour) {
      console.error(`[BrokerFailover] BLOCKED — Max failovers/hour (${this.maxFailoversPerHour}) reached. Manual intervention required.`);
      this.emit('failover:blocked', { reason: 'Rate limited', recentCount: recentFailovers });
      return;
    }

    // Check secondary is available
    if (this._healthService && !this._healthService.isOperational(this.secondaryProvider)) {
      console.error(`[BrokerFailover] Cannot failover — ${this.secondaryProvider} not operational`);
      this.emit('failover:blocked', { reason: `Secondary ${this.secondaryProvider} not operational` });
      return;
    }

    this._mode = FailoverMode.FAILOVER_ACTIVE;
    this._activeBroker = this.secondaryProvider;
    this._failoverTimestamp = Date.now();
    this._failoverHistory.push(Date.now());
    this._monitoringStartedAt = null;

    console.warn(`[BrokerFailover] ⚠️  FAILOVER: ${this.primaryProvider} → ${this.secondaryProvider} | Reason: ${reason}`);
    this.emit('failover:activated', {
      from: this.primaryProvider,
      to: this.secondaryProvider,
      reason,
      timestamp: this._failoverTimestamp,
    });
  }

  _enterRecovery() {
    // Cooldown check
    if (this._failoverTimestamp && (Date.now() - this._failoverTimestamp) < this.cooldownMs) {
      return; // Too soon
    }

    this._mode = FailoverMode.RECOVERING;
    this._recoveryStartedAt = Date.now();
    console.log(`[BrokerFailover] RECOVERING — ${this.primaryProvider} looks healthy, confirming...`);
    this.emit('mode:changed', { mode: this._mode, reason: 'Primary appears recovered' });

    // Confirm recovery after sustained health
    setTimeout(() => {
      if (this._mode === FailoverMode.RECOVERING) {
        this._checkRecoveryComplete();
      }
    }, this.recoveryConfirmMs);
  }

  _checkRecoveryComplete() {
    if (this._mode !== FailoverMode.RECOVERING) return;

    const primaryHealth = this._healthService?.getHealth(this.primaryProvider);
    if (primaryHealth && primaryHealth.state === HealthState.HEALTHY) {
      // Confirmed healthy — switch back
      this._mode = FailoverMode.NORMAL;
      this._activeBroker = this.primaryProvider;
      this._recoveryStartedAt = null;

      console.log(`[BrokerFailover] ✓ RECOVERED: ${this.secondaryProvider} → ${this.primaryProvider}`);
      this.emit('failover:recovered', {
        from: this.secondaryProvider,
        to: this.primaryProvider,
        downtime: this._failoverTimestamp ? Date.now() - this._failoverTimestamp : 0,
      });
    } else {
      // Still not healthy — stay in failover
      this._mode = FailoverMode.FAILOVER_ACTIVE;
      this._recoveryStartedAt = null;
      console.log(`[BrokerFailover] Recovery failed — ${this.primaryProvider} still ${primaryHealth?.state}`);
    }
  }

  _forceRecovery() {
    // Both brokers unhealthy — prefer primary
    this._mode = FailoverMode.NORMAL;
    this._activeBroker = this.primaryProvider;
    this._recoveryStartedAt = null;
    console.warn(`[BrokerFailover] FORCE RECOVERY — both brokers unhealthy, defaulting to ${this.primaryProvider}`);
    this.emit('failover:force_recovery', { reason: 'Both brokers unhealthy' });
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Get the currently active broker provider name.
   */
  getActiveBroker() {
    return this._activeBroker;
  }

  /**
   * Get the backup (inactive) broker provider name.
   */
  getBackupBroker() {
    return this._activeBroker === this.primaryProvider
      ? this.secondaryProvider
      : this.primaryProvider;
  }

  /**
   * Get current failover mode.
   */
  getMode() {
    return this._mode;
  }

  /**
   * Get full status for health endpoint.
   */
  getStatus() {
    return {
      activeBroker: this._activeBroker,
      backupBroker: this.getBackupBroker(),
      failoverMode: this._mode,
      failoverTimestamp: this._failoverTimestamp,
      recoveryStartedAt: this._recoveryStartedAt,
      failoversLastHour: this._failoverHistory.filter(t => t > Date.now() - 3600000).length,
      maxFailoversPerHour: this.maxFailoversPerHour,
    };
  }

  /**
   * Manual override — force switch to a specific broker.
   * For admin/emergency use.
   */
  forceSwitch(provider, reason = 'Manual override') {
    const prev = this._activeBroker;
    this._activeBroker = provider;
    this._mode = provider === this.primaryProvider ? FailoverMode.NORMAL : FailoverMode.FAILOVER_ACTIVE;
    this._failoverTimestamp = provider !== this.primaryProvider ? Date.now() : null;

    console.warn(`[BrokerFailover] MANUAL SWITCH: ${prev} → ${provider} | Reason: ${reason}`);
    this.emit('failover:manual', { from: prev, to: provider, reason });
  }
}
