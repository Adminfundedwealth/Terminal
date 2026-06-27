/**
 * EVENT DISPATCHER — Persistence Subscriber
 * 
 * Subscribes to the EventBus and persists every significant event to
 * the audit/metrics tables. This is the bridge between the in-memory
 * pub/sub system and the durable database layer.
 * 
 * Persisted events:
 *   OrderCreated    → t_order_audit
 *   OrderUpdated    → t_order_audit (submitted/accepted/filled/cancelled/rejected/modified)
 *   PositionOpened  → t_order_audit
 *   PositionClosed  → t_order_audit
 *   ChallengeUpdated → t_challenge_metrics
 *   RiskViolation   → t_risk_events
 *   BrokerSession   → t_broker_sessions
 * 
 * Architecture:
 *   EventBus.publish('order.created', ...) 
 *     → EventDispatcher._onOrderCreated() 
 *       → OrderAuditRepository.logOrderCreated()
 * 
 * All persistence is fire-and-forget — failures are logged but never
 * block the calling service or the event bus.
 */

import { eventBus } from '../events/index.js';
import { OrderAuditRepository } from '../repositories/order-audit.repository.js';
import { RiskEventRepository } from '../repositories/risk-event.repository.js';
import { ChallengeMetricsRepository } from '../repositories/challenge-metrics.repository.js';
import { BrokerSessionRepository } from '../repositories/broker-session.repository.js';

class EventDispatcher {
  constructor() {
    this.orderAuditRepo = new OrderAuditRepository();
    this.riskEventRepo = new RiskEventRepository();
    this.challengeMetricsRepo = new ChallengeMetricsRepository();
    this.brokerSessionRepo = new BrokerSessionRepository();
    this._subscriptions = [];
    this._initialized = false;
    this._stats = {
      persisted: 0,
      failed: 0,
      byEvent: {},
    };
  }

  /**
   * Initialize — subscribe to all relevant EventBus channels.
   * Safe to call multiple times (idempotent).
   */
  initialize() {
    if (this._initialized) return;
    this._initialized = true;

    // Order lifecycle
    this._sub('order.created', this._onOrderCreated.bind(this));
    this._sub('order.updated', this._onOrderUpdated.bind(this));

    // Position lifecycle
    this._sub('position.updated', this._onPositionUpdated.bind(this));

    // Challenge lifecycle
    this._sub('challenge.updated', this._onChallengeUpdated.bind(this));

    // Risk events
    this._sub('risk.alert', this._onRiskAlert.bind(this));

    // Broker session (these are dispatched directly, not via eventBus)
    // Broker events will be emitted via the direct API below.

    console.log('[EventDispatcher] Initialized — listening on EventBus for persistence');
  }

  // ─── EventBus Handlers ─────────────────────────────────────

  async _onOrderCreated(event) {
    const { payload, meta } = event;
    const accountId = meta.accountId || payload.accountId;
    try {
      await this.orderAuditRepo.log({
        accountId,
        orderId: payload.orderId,
        auditType: 'pre_trade',
        checksRun: ['order_created'],
        allPassed: true,
      });
      this._track('OrderCreated');
    } catch (err) {
      this._fail('OrderCreated', err);
    }
  }

  async _onOrderUpdated(event) {
    const { payload, meta } = event;
    const accountId = meta.accountId || payload.accountId;
    try {
      const status = (payload.status || '').toUpperCase();
      const auditType = status === 'FILLED' ? 'post_trade' : status === 'REJECTED' ? 'pre_trade' : 'pre_trade';
      const allPassed = status !== 'REJECTED';

      await this.orderAuditRepo.log({
        accountId,
        orderId: payload.orderId,
        auditType,
        checksRun: [`order_${status.toLowerCase()}`],
        allPassed,
        rejectionReason: payload.rejectReason || payload.reason || null,
      });
      this._track('Order' + status.charAt(0) + status.slice(1).toLowerCase());
    } catch (err) {
      this._fail('OrderUpdated', err);
    }
  }

  async _onPositionUpdated(event) {
    const { payload, meta } = event;
    const accountId = meta.accountId || payload.accountId;
    try {
      const action = payload.action || payload.event || 'updated';
      await this.orderAuditRepo.log({
        accountId,
        orderId: payload.orderId || null,
        executionId: payload.executionId || null,
        auditType: action === 'closed' ? 'position_exit' : 'post_trade',
        checksRun: [`position_${action}`],
        allPassed: true,
      });
      this._track('Position' + action.charAt(0).toUpperCase() + action.slice(1));
    } catch (err) {
      this._fail('PositionUpdated', err);
    }
  }

  async _onChallengeUpdated(event) {
    const { payload, meta } = event;
    const accountId = meta.accountId || payload.accountId;
    try {
      const action = payload.action || payload.event || 'updated';

      // All challenge events are persisted as daily progress snapshots
      // using the only available write method: upsertDailyProgress
      if (payload.challengeId && (action === 'snapshot' || action === 'day_complete' || action === 'updated')) {
        await this.challengeMetricsRepo.upsertDailyProgress(
          payload.challengeId,
          accountId,
          payload.data || payload
        );
      }

      this._track('Challenge_' + action);
    } catch (err) {
      this._fail('ChallengeUpdated', err);
    }
  }

  async _onRiskAlert(event) {
    const { payload, meta } = event;
    const accountId = meta.accountId || payload.accountId;
    try {
      const severity = payload.severity || payload.type || 'warning';

      if (severity === 'critical' || severity === 'fatal' || severity === 'breach') {
        await this.riskEventRepo.logBreach(
          accountId,
          payload.ruleType,
          payload.limitValue || payload.ruleValue,
          payload.currentValue || payload.actualValue,
          payload.metadata || { message: payload.message || payload.description }
        );
        this._track('RiskBreach');
      } else {
        await this.riskEventRepo.logWarning(
          accountId,
          payload.ruleType,
          payload.limitValue || payload.ruleValue,
          payload.currentValue || payload.actualValue,
          payload.metadata || { message: payload.message || payload.description }
        );
        this._track('RiskWarning');
      }
    } catch (err) {
      this._fail('RiskAlert', err);
    }
  }

  // ─── Direct API (for broker session events not on EventBus) ──

  /**
   * Record broker connection established.
   */
  async brokerConnected(accountId, provider, clientId, expiresAt, feedToken = null) {
    try {
      const session = await this.brokerSessionRepo.createSession(accountId, {
        provider, accessToken: 'connected', refreshToken: null, feedToken, expiresAt,
      });
      this._track('BrokerConnected');
      return session;
    } catch (err) {
      this._fail('BrokerConnected', err);
      return null;
    }
  }

  /**
   * Record broker disconnection.
   */
  async brokerDisconnected(accountId, provider, reason = null) {
    try {
      await this.brokerSessionRepo.deactivateSession(accountId, provider);
      this._track('BrokerDisconnected');
    } catch (err) {
      this._fail('BrokerDisconnected', err);
    }
  }

  /**
   * Record broker session expiry.
   */
  async brokerSessionExpired(accountId, provider) {
    try {
      await this.brokerSessionRepo.deactivateSession(accountId, provider);
      this._track('BrokerSessionExpired');
    } catch (err) {
      this._fail('BrokerSessionExpired', err);
    }
  }

  /**
   * Record broker connection failure.
   */
  async brokerConnectionFailed(accountId, provider, clientId, errorMessage, metadata = {}) {
    try {
      // Log as risk event since no specific failure method exists
      await this.riskEventRepo.log(accountId, 'account_locked', 'warning', 'broker_connection', null, null, { provider, clientId, errorMessage, ...metadata });
      this._track('BrokerConnectionFailed');
    } catch (err) {
      this._fail('BrokerConnectionFailed', err);
    }
  }

  /**
   * Record broker failover event.
   */
  async brokerFailover(accountId, fromProvider, toProvider, reason) {
    try {
      await this.riskEventRepo.log(accountId, 'manual_override', 'info', 'broker_failover', null, null, { fromProvider, toProvider, reason });
      this._track('BrokerFailover');
    } catch (err) {
      this._fail('BrokerFailover', err);
    }
  }

  /**
   * Record account locked due to risk breach.
   */
  async accountLocked(accountId, reason, ruleType = null, metadata = {}) {
    try {
      await this.riskEventRepo.logAccountLocked(accountId, reason, ruleType, metadata);
      this._track('AccountLocked');
    } catch (err) {
      this._fail('AccountLocked', err);
    }
  }

  // ─── Internal Helpers ──────────────────────────────────────

  _sub(channel, handler) {
    const unsub = eventBus.subscribe(channel, handler);
    this._subscriptions.push(unsub);
  }

  _track(eventName) {
    this._stats.persisted++;
    if (!this._stats.byEvent[eventName]) this._stats.byEvent[eventName] = 0;
    this._stats.byEvent[eventName]++;
  }

  _fail(eventName, err) {
    this._stats.failed++;
    console.error(`[EventDispatcher] Failed to persist ${eventName}:`, err.message);
  }

  /**
   * Get dispatcher statistics.
   */
  getStats() {
    return {
      initialized: this._initialized,
      totalPersisted: this._stats.persisted,
      totalFailed: this._stats.failed,
      byEvent: { ...this._stats.byEvent },
    };
  }

  /**
   * Shutdown — unsubscribe from all channels.
   */
  destroy() {
    this._subscriptions.forEach(unsub => unsub());
    this._subscriptions = [];
    this._initialized = false;
    console.log('[EventDispatcher] Destroyed');
  }
}

// Singleton instance
export const eventDispatcher = new EventDispatcher();
