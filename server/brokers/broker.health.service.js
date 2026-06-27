/**
 * BROKER HEALTH SERVICE
 * 
 * Continuous health monitoring for broker adapters.
 * Tracks:
 *   - API latency (rolling window)
 *   - WebSocket connection state & disconnects
 *   - Auth token expiry countdown
 *   - Heartbeat freshness
 *   - Error rates (5xx, timeouts, rate limits)
 * 
 * Emits health events consumed by BrokerFailoverService.
 * 
 * NO UI. NO FRONTEND. Architecture only.
 */

import { EventEmitter } from 'events';

/**
 * Health thresholds (configurable per broker).
 */
const DEFAULT_THRESHOLDS = {
  maxLatencyMs: 2000,          // Above this = degraded
  criticalLatencyMs: 5000,     // Above this = unhealthy
  maxConsecutiveErrors: 3,     // Consecutive failures before unhealthy
  heartbeatTimeoutMs: 60000,   // No heartbeat in 60s = stale
  authExpiryWarningMs: 300000, // Warn 5 min before token expires
  errorRateWindow: 60000,      // Error rate rolling window (1 min)
  maxErrorRate: 0.5,           // 50% error rate = unhealthy
  wsReconnectThreshold: 3,     // WS disconnects in window = degraded
  wsReconnectWindow: 300000,   // 5 min window for WS disconnect counting
};

/**
 * Broker health states.
 */
export const HealthState = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  DISCONNECTED: 'disconnected',
  AUTH_EXPIRED: 'auth_expired',
};

export class BrokerHealthService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.checkInterval = options.checkInterval || 10000; // 10s
    this._timer = null;
    this._isRunning = false;

    // Per-broker health state
    // Key: provider name (e.g., 'angelone', 'dhan')
    this._brokerHealth = new Map();
  }

  /**
   * Register a broker for health tracking.
   */
  registerBroker(provider, adapter) {
    this._brokerHealth.set(provider, {
      provider,
      adapter,
      state: HealthState.DISCONNECTED,
      latency: {
        samples: [],        // Recent latency measurements
        avg: 0,
        p95: 0,
        last: 0,
      },
      websocket: {
        connected: false,
        lastConnected: null,
        disconnectCount: 0,
        disconnectTimestamps: [],
        lastPing: null,
        lastPong: null,
      },
      auth: {
        expiresAt: null,
        lastRefresh: null,
        refreshFailures: 0,
      },
      errors: {
        consecutive: 0,
        total: 0,
        timestamps: [],     // Rolling window for error rate
        lastError: null,
        lastErrorTime: null,
      },
      heartbeat: {
        lastBeat: null,
        missedBeats: 0,
      },
      lastCheck: null,
      stateChangedAt: Date.now(),
    });

    console.log(`[BrokerHealth] Registered: ${provider}`);
  }

  /**
   * Start periodic health evaluation.
   */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._timer = setInterval(() => this._evaluate(), this.checkInterval);
    console.log(`[BrokerHealth] Started (interval: ${this.checkInterval / 1000}s)`);
  }

  /**
   * Stop health monitoring.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._isRunning = false;
    console.log('[BrokerHealth] Stopped');
  }

  // ─── Latency Tracking ─────────────────────────────────────────

  /**
   * Record an API call latency measurement.
   * Call this after every broker API request completes.
   */
  recordLatency(provider, latencyMs) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;

    health.latency.samples.push({ ms: latencyMs, at: Date.now() });
    health.latency.last = latencyMs;

    // Keep last 50 samples
    if (health.latency.samples.length > 50) {
      health.latency.samples.shift();
    }

    // Recalculate avg and p95
    const sorted = [...health.latency.samples].sort((a, b) => a.ms - b.ms);
    health.latency.avg = Math.round(sorted.reduce((s, x) => s + x.ms, 0) / sorted.length);
    health.latency.p95 = sorted[Math.floor(sorted.length * 0.95)]?.ms || latencyMs;
  }

  // ─── WebSocket Tracking ────────────────────────────────────────

  /**
   * Record WebSocket connection established.
   */
  recordWsConnected(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;

    health.websocket.connected = true;
    health.websocket.lastConnected = Date.now();
    this._recordHeartbeat(provider);
  }

  /**
   * Record WebSocket disconnection.
   */
  recordWsDisconnected(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;

    health.websocket.connected = false;
    health.websocket.disconnectCount++;
    health.websocket.disconnectTimestamps.push(Date.now());

    // Keep only timestamps within window
    const cutoff = Date.now() - this.thresholds.wsReconnectWindow;
    health.websocket.disconnectTimestamps = health.websocket.disconnectTimestamps.filter(t => t > cutoff);

    this.emit('ws:disconnected', { provider, count: health.websocket.disconnectCount });
  }

  /**
   * Record WebSocket ping/pong for freshness.
   */
  recordWsPing(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;
    health.websocket.lastPing = Date.now();
  }

  recordWsPong(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;
    health.websocket.lastPong = Date.now();
    this._recordHeartbeat(provider);
  }

  // ─── Auth Tracking ─────────────────────────────────────────────

  /**
   * Record auth token expiry time.
   */
  recordAuthExpiry(provider, expiresAt) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;
    health.auth.expiresAt = expiresAt;
    health.auth.lastRefresh = Date.now();
    health.auth.refreshFailures = 0;
  }

  /**
   * Record auth refresh failure.
   */
  recordAuthRefreshFailure(provider, error) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;
    health.auth.refreshFailures++;

    if (health.auth.refreshFailures >= 3) {
      this.emit('auth:expired', { provider, failures: health.auth.refreshFailures, error });
    }
  }

  // ─── Error Tracking ────────────────────────────────────────────

  /**
   * Record a successful API call (resets consecutive errors).
   */
  recordSuccess(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;
    health.errors.consecutive = 0;
    this._recordHeartbeat(provider);
  }

  /**
   * Record an API call error.
   */
  recordError(provider, error) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;

    health.errors.consecutive++;
    health.errors.total++;
    health.errors.lastError = error?.message || String(error);
    health.errors.lastErrorTime = Date.now();
    health.errors.timestamps.push(Date.now());

    // Trim to rolling window
    const cutoff = Date.now() - this.thresholds.errorRateWindow;
    health.errors.timestamps = health.errors.timestamps.filter(t => t > cutoff);

    // Emit if threshold crossed
    if (health.errors.consecutive >= this.thresholds.maxConsecutiveErrors) {
      this.emit('errors:threshold', {
        provider,
        consecutive: health.errors.consecutive,
        lastError: health.errors.lastError,
      });
    }
  }

  // ─── Heartbeat ─────────────────────────────────────────────────

  _recordHeartbeat(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return;
    health.heartbeat.lastBeat = Date.now();
    health.heartbeat.missedBeats = 0;
  }

  // ─── Health Evaluation ─────────────────────────────────────────

  /**
   * Evaluate all registered brokers and determine health states.
   * Emits 'state:changed' when a broker transitions.
   */
  _evaluate() {
    for (const [provider, health] of this._brokerHealth) {
      const prevState = health.state;
      const newState = this._computeState(health);

      health.state = newState;
      health.lastCheck = Date.now();

      if (newState !== prevState) {
        health.stateChangedAt = Date.now();
        console.log(`[BrokerHealth] ${provider}: ${prevState} → ${newState}`);
        this.emit('state:changed', { provider, prevState, newState, health: this._snapshot(health) });
      }
    }
  }

  /**
   * Compute health state from metrics.
   */
  _computeState(health) {
    // Auth expired?
    if (health.auth.expiresAt && health.auth.expiresAt < Date.now()) {
      return HealthState.AUTH_EXPIRED;
    }
    if (health.auth.refreshFailures >= 3) {
      return HealthState.AUTH_EXPIRED;
    }

    // WebSocket disconnected and no heartbeat?
    if (!health.websocket.connected && !health.heartbeat.lastBeat) {
      return HealthState.DISCONNECTED;
    }

    // Heartbeat stale?
    if (health.heartbeat.lastBeat) {
      const staleness = Date.now() - health.heartbeat.lastBeat;
      if (staleness > this.thresholds.heartbeatTimeoutMs) {
        return HealthState.UNHEALTHY;
      }
    }

    // Consecutive errors threshold?
    if (health.errors.consecutive >= this.thresholds.maxConsecutiveErrors) {
      return HealthState.UNHEALTHY;
    }

    // Error rate too high?
    const cutoff = Date.now() - this.thresholds.errorRateWindow;
    const recentErrors = health.errors.timestamps.filter(t => t > cutoff).length;
    const recentTotal = health.latency.samples.filter(s => s.at > cutoff).length + recentErrors;
    if (recentTotal > 0 && (recentErrors / recentTotal) > this.thresholds.maxErrorRate) {
      return HealthState.UNHEALTHY;
    }

    // WebSocket instability?
    const wsCutoff = Date.now() - this.thresholds.wsReconnectWindow;
    const recentDisconnects = health.websocket.disconnectTimestamps.filter(t => t > wsCutoff).length;
    if (recentDisconnects >= this.thresholds.wsReconnectThreshold) {
      return HealthState.DEGRADED;
    }

    // High latency?
    if (health.latency.p95 > this.thresholds.criticalLatencyMs) {
      return HealthState.UNHEALTHY;
    }
    if (health.latency.p95 > this.thresholds.maxLatencyMs) {
      return HealthState.DEGRADED;
    }

    // Auth expiring soon?
    if (health.auth.expiresAt) {
      const timeToExpiry = health.auth.expiresAt - Date.now();
      if (timeToExpiry < this.thresholds.authExpiryWarningMs && timeToExpiry > 0) {
        return HealthState.DEGRADED;
      }
    }

    return HealthState.HEALTHY;
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Get health snapshot for a single broker.
   */
  getHealth(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return null;
    return this._snapshot(health);
  }

  /**
   * Get health for all registered brokers.
   */
  getAllHealth() {
    const result = {};
    for (const [provider, health] of this._brokerHealth) {
      result[provider] = this._snapshot(health);
    }
    return result;
  }

  /**
   * Check if a broker is operational (healthy or degraded).
   */
  isOperational(provider) {
    const health = this._brokerHealth.get(provider);
    if (!health) return false;
    return health.state === HealthState.HEALTHY || health.state === HealthState.DEGRADED;
  }

  /**
   * Create a clean snapshot (no circular refs, no adapter obj).
   */
  _snapshot(health) {
    return {
      provider: health.provider,
      state: health.state,
      latency: {
        avg: health.latency.avg,
        p95: health.latency.p95,
        last: health.latency.last,
        sampleCount: health.latency.samples.length,
      },
      websocket: {
        connected: health.websocket.connected,
        lastConnected: health.websocket.lastConnected,
        disconnectCount: health.websocket.disconnectCount,
        recentDisconnects: health.websocket.disconnectTimestamps.filter(
          t => t > Date.now() - this.thresholds.wsReconnectWindow
        ).length,
      },
      auth: {
        expiresAt: health.auth.expiresAt,
        timeToExpiryMs: health.auth.expiresAt ? health.auth.expiresAt - Date.now() : null,
        refreshFailures: health.auth.refreshFailures,
      },
      errors: {
        consecutive: health.errors.consecutive,
        total: health.errors.total,
        lastError: health.errors.lastError,
        lastErrorTime: health.errors.lastErrorTime,
      },
      heartbeat: {
        lastBeat: health.heartbeat.lastBeat,
        staleness: health.heartbeat.lastBeat ? Date.now() - health.heartbeat.lastBeat : null,
      },
      lastCheck: health.lastCheck,
      stateChangedAt: health.stateChangedAt,
    };
  }
}
