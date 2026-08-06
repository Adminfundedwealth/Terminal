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
import { MetricsRepository } from '../repositories/metrics.repository.js';
import { TradeRepository } from '../repositories/trade.repository.js';
import { PositionRepository } from '../repositories/position.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';

class EventDispatcher {
  constructor() {
    this.orderAuditRepo = new OrderAuditRepository();
    this.riskEventRepo = new RiskEventRepository();
    this.challengeMetricsRepo = new ChallengeMetricsRepository();
    this.brokerSessionRepo = new BrokerSessionRepository();
    this.metricsRepo = new MetricsRepository();
    this.tradeRepo = new TradeRepository();
    this.positionRepo = new PositionRepository();
    this.accountRepo = new AccountRepository();
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

    // Trade fill — update account_metrics snapshot in real-time
    this._sub('trade.executed', this._onTradeExecuted.bind(this));

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

  async _onTradeExecuted(event) {
    const { payload, meta } = event;
    const accountId = meta.accountId || payload.accountId;
    if (!accountId) return;

    // Fire-and-forget: update today's account_metrics snapshot so the dashboard
    // Analytics page shows live data without waiting for the end-of-day cron.
    try {
      // Use getWithChallenge so we have initial_balance for P&L and balance update
      const account = await this.accountRepo.getWithChallenge(accountId);
      if (!account) return;

      // Get today's executions for FIFO P&L computation
      const todayTrades = await this.tradeRepo.findTodayTrades(accountId);

      // FIFO P&L calculation (mirrors AnalyticsPanel.tsx logic)
      const byToken = {};
      for (const t of todayTrades) {
        const key = t.token;
        if (!byToken[key]) byToken[key] = [];
        byToken[key].push(t);
      }

      let realizedPnl = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let largestWin = 0;
      let largestLoss = 0;
      let totalWin = 0;
      let totalLoss = 0;
      let winCount = 0;
      let lossCount = 0;

      for (const [, symbolTrades] of Object.entries(byToken)) {
        symbolTrades.sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
        let netQty = 0;
        let avgCost = 0;

        for (const t of symbolTrades) {
          const qty = parseInt(t.qty) || 0;
          const price = parseFloat(t.price) || 0;

          if (t.side === 'BUY') {
            const totalCost = avgCost * netQty + price * qty;
            netQty += qty;
            avgCost = netQty > 0 ? totalCost / netQty : 0;
          } else {
            // SELL
            if (netQty > 0) {
              const closeQty = Math.min(qty, netQty);
              const tradePnl = (price - avgCost) * closeQty;
              realizedPnl += tradePnl;

              if (tradePnl > 0) {
                winningTrades++;
                grossProfit += tradePnl;
                totalWin += tradePnl;
                winCount++;
                if (tradePnl > largestWin) largestWin = tradePnl;
              } else if (tradePnl < 0) {
                losingTrades++;
                grossLoss += Math.abs(tradePnl);
                totalLoss += Math.abs(tradePnl);
                lossCount++;
                if (Math.abs(tradePnl) > largestLoss) largestLoss = Math.abs(tradePnl);
              }

              netQty -= closeQty;
              if (netQty <= 0) { netQty = 0; avgCost = 0; }
            } else {
              // Opening short
              const totalCost = avgCost * Math.abs(netQty) + price * qty;
              netQty -= qty;
              avgCost = netQty < 0 ? totalCost / Math.abs(netQty) : 0;
            }
          }
        }
      }

      // Unrealized from open positions
      const positions = await this.positionRepo.findOpenByAccountId(accountId);
      const unrealizedPnl = positions.reduce((sum, p) => sum + (parseFloat(p.unrealized_pnl || p.pnl || 0)), 0);

      const balance = parseFloat(account.balance) || 0;
      const peakBalance = Math.max(parseFloat(account.peak_balance) || balance, balance + unrealizedPnl);
      const drawdown = Math.max(0, peakBalance - (balance + unrealizedPnl));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
      const avgWin = winCount > 0 ? totalWin / winCount : null;
      const avgLoss = lossCount > 0 ? totalLoss / lossCount : null;

      await this.metricsRepo.upsertDailyMetrics(accountId, {
        startingBalance: balance - realizedPnl,
        endingBalance: balance,
        realizedPnl: Math.round(realizedPnl * 100) / 100,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        totalTrades: todayTrades.length,
        winningTrades,
        losingTrades,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossLoss: Math.round(grossLoss * 100) / 100,
        maxDrawdown: Math.round(drawdown * 100) / 100,
        dailyLoss: realizedPnl < 0 ? Math.abs(realizedPnl) : 0,
        peakBalance: Math.round(peakBalance * 100) / 100,
        avgWin: avgWin !== null ? Math.round(avgWin * 100) / 100 : null,
        avgLoss: avgLoss !== null ? Math.round(avgLoss * 100) / 100 : null,
        largestWin: largestWin > 0 ? Math.round(largestWin * 100) / 100 : null,
        largestLoss: largestLoss > 0 ? Math.round(largestLoss * 100) / 100 : null,
        profitFactor: profitFactor !== null ? Math.round(profitFactor * 10000) / 10000 : null,
      });

      // ── Sync balance to BOTH trading_accounts AND challenge_accounts ────────
      // Dashboard reads challenge_accounts.current_balance for "Current Balance"
      // and current_balance - initial_balance for "P&L"
      try {
        const initialBalance = account.challenge?.initial_balance
          ? parseFloat(account.challenge.initial_balance)
          : parseFloat(account.initial_balance || balance);
        const newBalance = Math.round((initialBalance + realizedPnl) * 100) / 100;
        if (Math.abs(newBalance - balance) > 0.01) {
          // 1. Update trading_accounts.balance
          await this.accountRepo.updateBalance(accountId, newBalance);

          // 2. Update challenge_accounts.current_balance — this is what the dashboard reads
          if (account.challenge?.id) {
            const { supabase } = await import('../db/client.js');
            await supabase
              .from('challenge_accounts')
              .update({ current_balance: newBalance, updated_at: new Date().toISOString() })
              .eq('id', account.challenge.id);
          }

          // 3. Update peak balance if equity is higher
          const currentEquity = newBalance + unrealizedPnl;
          if (currentEquity > peakBalance) {
            const newPeak = Math.round(currentEquity * 100) / 100;
            await this.accountRepo.updatePeakBalance(accountId, newPeak);
            if (account.challenge?.id) {
              const { supabase } = await import('../db/client.js');
              await supabase
                .from('challenge_accounts')
                .update({ peak_balance: newPeak })
                .eq('id', account.challenge.id);
            }
          }

          console.log(`[EventDispatcher] Balance synced: ₹${balance} → ₹${newBalance} (P&L ${realizedPnl >= 0 ? '+' : ''}₹${Math.round(realizedPnl)})`);
        }
      } catch (balErr) {
        console.error('[EventDispatcher] Balance sync failed:', balErr.message);
      }

      // ── Push live P&L to external dashboard (fundedwealth.com) ──────────────
      // The dashboard has its own DB — we push a trade.synced event so it can
      // update Daily P&L, Total Trades, and progress bars in real time.
      try {
        const { LifecycleCallbackClient } = await import('../clients/lifecycle.callback.js');
        await LifecycleCallbackClient.notifyWebsite('trade.synced', {
          accountId,
          traderId: account.trader_id,
          data: {
            dailyPnl: Math.round(realizedPnl * 100) / 100,
            totalTrades: todayTrades.length,
            winningTrades,
            losingTrades,
            grossProfit: Math.round(grossProfit * 100) / 100,
            grossLoss: Math.round(grossLoss * 100) / 100,
            currentBalance: Math.round((parseFloat(account.challenge?.initial_balance || balance) + realizedPnl) * 100) / 100,
            syncedAt: new Date().toISOString(),
          },
        });
      } catch (lcErr) {
        // Non-blocking — external dashboard push failure must never break trading
        console.warn('[EventDispatcher] Dashboard sync failed (non-critical):', lcErr.message);
      }
      // ─────────────────────────────────────────────────────────────────────────

      this._track('TradeExecuted_MetricsUpdated');
    } catch (err) {
      this._fail('TradeExecuted', err);
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
