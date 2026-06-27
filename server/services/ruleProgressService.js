/**
 * RULE PROGRESS SERVICE
 * 
 * After every trade, calculates and persists the live progress
 * of each active rule for an account.
 * 
 * Stores per rule:
 *   - currentValue: What the account's current metric is
 *   - allowedValue: The rule's threshold
 *   - remaining: How much room is left
 *   - status: PASS | WARNING | FAILED
 * 
 * This data powers:
 *   - Terminal UI: Risk dashboard/overlay
 *   - Main Site: Challenge progress on dashboard
 *   - Admin: Live rule monitoring, risk center
 * 
 * Written to: risk_events table (for history) + account_metrics (for snapshots)
 * Read from: GET /api/account/risk-state (already exists, enhanced here)
 */

import { eventBus } from '../events/index.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';

const WARNING_THRESHOLD = 0.75; // 75% consumed = WARNING

export class RuleProgressService {
  /**
   * Calculate live progress for all active rules on an account.
   * Called after every trade fill (from postTradeCheck) and on demand.
   * 
   * @param {object} params
   * @param {string} params.accountId
   * @param {object} params.rules - Rules map from risk_rules table
   * @param {object} params.account - Account record
   * @param {number} params.todayPnl - Today's total P&L (realized + unrealized)
   * @param {number} params.unrealizedPnl - Current unrealized P&L
   * @param {number} params.peakBalance - Peak balance
   * @param {number} params.tradingDays - Count of trading days
   * @returns {Array} Rule progress entries
   */
  static calculateProgress({ accountId, rules, account, todayPnl, unrealizedPnl, peakBalance, tradingDays }) {
    const balance = parseFloat(account.balance) || 0;
    const initialBalance = parseFloat(account.initial_balance || account.challenge?.initial_balance || balance);
    const currentEquity = balance + unrealizedPnl;
    const pnlFromStart = currentEquity - initialBalance;
    const progress = [];

    // Daily Loss
    if (rules.daily_loss_limit) {
      const limit = rules.daily_loss_limit.amount || (rules.daily_loss_limit.percent / 100) * initialBalance;
      const dailyLoss = todayPnl < 0 ? Math.abs(todayPnl) : 0;
      const used = limit > 0 ? dailyLoss / limit : 0;
      progress.push({
        ruleType: 'daily_loss_limit',
        currentValue: dailyLoss,
        allowedValue: limit,
        remaining: Math.max(0, limit - dailyLoss),
        percentUsed: Math.round(used * 100 * 100) / 100,
        status: used >= 1 ? 'FAILED' : used >= WARNING_THRESHOLD ? 'WARNING' : 'PASS',
      });
    }

    // Max Drawdown
    if (rules.max_drawdown) {
      const limit = rules.max_drawdown.amount || (rules.max_drawdown.percent / 100) * initialBalance;
      const drawdown = Math.max(0, peakBalance - currentEquity);
      const used = limit > 0 ? drawdown / limit : 0;
      progress.push({
        ruleType: 'max_drawdown',
        currentValue: drawdown,
        allowedValue: limit,
        remaining: Math.max(0, limit - drawdown),
        percentUsed: Math.round(used * 100 * 100) / 100,
        status: used >= 1 ? 'FAILED' : used >= WARNING_THRESHOLD ? 'WARNING' : 'PASS',
      });
    }

    // Profit Target
    if (rules.profit_target) {
      const target = rules.profit_target.amount || (rules.profit_target.percent / 100) * initialBalance;
      const achieved = Math.max(0, pnlFromStart);
      const used = target > 0 ? achieved / target : 0;
      progress.push({
        ruleType: 'profit_target',
        currentValue: achieved,
        allowedValue: target,
        remaining: Math.max(0, target - achieved),
        percentUsed: Math.round(used * 100 * 100) / 100,
        status: used >= 1 ? 'ACHIEVED' : used >= WARNING_THRESHOLD ? 'NEAR_TARGET' : 'PASS',
      });
    }

    // Min Trading Days
    if (rules.min_trading_days) {
      const required = rules.min_trading_days.count || 5;
      const used = required > 0 ? tradingDays / required : 0;
      progress.push({
        ruleType: 'min_trading_days',
        currentValue: tradingDays,
        allowedValue: required,
        remaining: Math.max(0, required - tradingDays),
        percentUsed: Math.round(used * 100 * 100) / 100,
        status: used >= 1 ? 'ACHIEVED' : 'IN_PROGRESS',
      });
    }

    // Consistency Rule
    if (rules.consistency_rule) {
      const maxPercent = rules.consistency_rule.maxDayProfitPercent || 40;
      // Best day profit as percent of total profit
      // For real-time we track today's contribution
      const todayProfit = todayPnl > 0 ? todayPnl : 0;
      const totalProfit = pnlFromStart > 0 ? pnlFromStart : 1; // avoid division by zero
      const todayContribution = (todayProfit / totalProfit) * 100;
      progress.push({
        ruleType: 'consistency_rule',
        currentValue: Math.round(todayContribution * 100) / 100,
        allowedValue: maxPercent,
        remaining: Math.max(0, maxPercent - todayContribution),
        percentUsed: Math.round((todayContribution / maxPercent) * 100 * 100) / 100,
        status: todayContribution > maxPercent ? 'WARNING' : 'PASS',
      });
    }

    // Max Positions
    if (rules.max_positions) {
      // Not calculated here (needs position count from repo)
      // This is checked in real-time during pre-trade
    }

    return progress;
  }

  /**
   * Publish rule progress to event bus for real-time display.
   * Also triggers lifecycle callbacks for WARNING and FAILED states.
   */
  static async publishProgress(accountId, traderId, progress) {
    // Publish full progress for frontend display
    eventBus.publish('risk.progress', {
      accountId,
      rules: progress,
      timestamp: Date.now(),
    }, { accountId });

    // Check for warnings and failures
    for (const rule of progress) {
      if (rule.status === 'FAILED') {
        // Send breach callback to Main Site + Admin
        LifecycleCallbackClient.riskBreached({
          accountId, traderId,
          ruleType: rule.ruleType,
          currentValue: rule.currentValue,
          limitValue: rule.allowedValue,
        }).catch(() => {});
      } else if (rule.status === 'WARNING') {
        // Send warning callback (throttled — max once per rule per 5 minutes)
        LifecycleCallbackClient.riskWarning({
          accountId, traderId,
          ruleType: rule.ruleType,
          currentValue: rule.currentValue,
          limitValue: rule.allowedValue,
          percentUsed: rule.percentUsed,
        }).catch(() => {});
      }
    }
  }
}
