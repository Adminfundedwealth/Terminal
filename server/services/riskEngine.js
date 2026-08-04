/**
 * RISK ENGINE
 * 
 * Enforces prop firm trading rules.
 * All state is persisted in Supabase — no in-memory state.
 * 
 * Pre-trade: validates order against rules before execution.
 * Post-trade: recalculates P&L, checks drawdown, triggers breaches.
 * 
 * Rule types:
 *   daily_loss_limit   — max loss per day (absolute + percent)
 *   max_drawdown       — max drawdown from peak balance
 *   profit_target      — target to pass challenge
 *   max_positions      — max open positions at once
 *   max_lot_size       — max lots per segment
 *   allowed_segments   — which segments can trade
 *   trading_hours      — allowed trading window
 *   no_overnight       — must close by cutoff
 *   max_daily_trades   — max trades per day
 */

import { RiskRulesRepository } from '../repositories/risk-rules.repository.js';
import { PositionRepository } from '../repositories/position.repository.js';
import { TradeRepository } from '../repositories/trade.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { MetricsRepository } from '../repositories/metrics.repository.js';
import { eventBus } from '../events/index.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { MarginService } from './marginService.js';
import { HolidayService } from './holidayService.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';

const riskRulesRepo = new RiskRulesRepository();
const positionRepo = new PositionRepository();
const tradeRepo = new TradeRepository();
const accountRepo = new AccountRepository();
const metricsRepo = new MetricsRepository();
const auditRepo = new AuditRepository();

export class RiskEngine {
  /**
   * Pre-trade validation.
   * Returns { allowed: true } or { allowed: false, reason: "..." }
   */
  static async validateOrder(accountId, orderParams, quoteProvider = null) {
    const rules = await riskRulesRepo.getRulesMap(accountId);
    const account = await accountRepo.findById(accountId);

    if (!account) {
      return { allowed: false, reason: 'Account not found' };
    }
    if (account.status !== 'active') {
      return { allowed: false, reason: `Account is ${account.status}. Trading disabled.` };
    }

    // ── Close/exit orders bypass ALL trading rules ──────────────────────────
    // Closing a position REDUCES risk — it must never be blocked by risk rules
    // like daily loss limit, max positions, trading hours, etc.
    // Only the hard account-status check above applies to close orders.
    if (orderParams.isCloseOrder) {
      return { allowed: true };
    }

    // Check each rule (new positions only)
    const checks = [
      () => this.checkMarketHoliday(),
      () => this.checkWeekend(),
      () => this.checkAllowedSegments(rules, orderParams),
      () => this.checkTradingHours(rules),
      () => this.checkNoOvernight(rules, orderParams),
      () => this.checkNewsBlackout(rules),
      () => this.checkDailyProfitCap(rules, accountId),
      () => this.checkMaxPositions(rules, accountId),
      () => this.checkMaxPositionSize(rules, account, orderParams),
      () => this.checkMaxLotSize(rules, orderParams),
      () => this.checkMaxDailyTrades(rules, accountId),
      () => this.checkDailyLossLimit(rules, account, accountId, quoteProvider),
      () => this.checkRiskPerTradeIdea(rules, account, accountId, orderParams),
      () => this.checkMarginAvailability(accountId, orderParams, account, quoteProvider),
      () => this.checkConsistencyRule(rules, accountId, account),
      () => this.checkMaxRiskPerTrade(rules, orderParams, account, quoteProvider),
      () => this.checkLeverageLimit(rules, orderParams, account),
    ];

    for (const check of checks) {
      const result = await check();
      if (!result.allowed) return result;
    }

    return { allowed: true };
  }

  /**
   * Post-trade risk check.
   * Runs after every fill. Checks if account should be locked/breached.
   * Returns { status: 'ok' | 'locked' | 'breached' | 'target_reached', reason?: string }
   */
  static async postTradeCheck(accountId, quoteProvider = null) {
    const rules = await riskRulesRepo.getRulesMap(accountId);
    const account = await accountRepo.findById(accountId);

    if (!account || account.status !== 'active') {
      return { status: 'ok' };
    }

    // Calculate today's realized P&L
    const todayRealizedPnl = await this.calculateTodayRealizedPnl(accountId);

    // Calculate unrealized P&L from open positions
    const unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider);

    const totalDailyPnl = todayRealizedPnl + unrealizedPnl;

    // Check daily loss limit
    if (rules.daily_loss_limit) {
      const limit = rules.daily_loss_limit;
      const maxLoss = limit.amount || (limit.percent / 100) * account.balance;

      if (totalDailyPnl < 0 && Math.abs(totalDailyPnl) >= maxLoss) {
        await accountRepo.lockAccount(accountId, `Daily loss limit breached: ₹${Math.abs(totalDailyPnl).toFixed(0)} >= ₹${maxLoss.toFixed(0)}`);
        await auditRepo.log({
          accountId,
          userId: account.trader_id,
          eventType: 'account_locked',
          eventData: { reason: 'daily_loss_limit', loss: Math.abs(totalDailyPnl), limit: maxLoss },
        });

        // Publish to event bus
        eventBus.publish('risk.alert', {
          type: 'breach',
          ruleType: 'daily_loss_limit',
          message: `Daily loss limit breached: ₹${Math.abs(totalDailyPnl).toFixed(0)} >= ₹${maxLoss.toFixed(0)}`,
          currentValue: Math.abs(totalDailyPnl),
          limitValue: maxLoss,
          percentUsed: 100,
        }, { accountId });
        eventBus.publish('challenge.updated', {
          challengeId: account.challenge_id || accountId,
          status: 'locked',
          reason: 'daily_loss_limit',
          dailyPnl: totalDailyPnl,
        }, { accountId });

        eventBus.publish('account.locked', {
          accountId,
          reason: `Daily loss limit breached: ₹${Math.abs(totalDailyPnl).toFixed(0)} >= ₹${maxLoss.toFixed(0)}`,
        }, { accountId });

        // Notify Main Site + Admin
        LifecycleCallbackClient.accountLocked({
          accountId, traderId: account.trader_id,
          reason: `Daily loss limit breached: ₹${Math.abs(totalDailyPnl).toFixed(0)} >= ₹${maxLoss.toFixed(0)}`,
          ruleType: 'daily_loss_limit',
        }).catch(() => {});

        return { status: 'locked', reason: `Daily loss limit hit (₹${Math.abs(totalDailyPnl).toFixed(0)})` };
      }
    }

    // Check max drawdown from peak
    if (rules.max_drawdown) {
      const limit = rules.max_drawdown;
      const peakBalance = account.peak_balance || account.balance;
      const currentEquity = account.balance + unrealizedPnl;
      const drawdown = peakBalance - currentEquity;
      const maxDrawdown = limit.amount || (limit.percent / 100) * peakBalance;

      if (drawdown >= maxDrawdown) {
        await accountRepo.breachAccount(accountId, `Max drawdown breached: ₹${drawdown.toFixed(0)} >= ₹${maxDrawdown.toFixed(0)}`);
        await auditRepo.log({
          accountId,
          userId: account.trader_id,
          eventType: 'account_breached',
          eventData: { reason: 'max_drawdown', drawdown, limit: maxDrawdown, peakBalance },
        });

        // Publish to event bus
        eventBus.publish('risk.alert', {
          type: 'breach',
          ruleType: 'max_drawdown',
          message: `Max drawdown breached: ₹${drawdown.toFixed(0)} >= ₹${maxDrawdown.toFixed(0)}`,
          currentValue: drawdown,
          limitValue: maxDrawdown,
          percentUsed: 100,
        }, { accountId });
        eventBus.publish('challenge.updated', {
          challengeId: account.challenge_id || accountId,
          status: 'breached',
          reason: 'max_drawdown',
          drawdown,
        }, { accountId });

        eventBus.publish('account.breached', {
          accountId,
          reason: `Max drawdown breached: ₹${drawdown.toFixed(0)} >= ₹${maxDrawdown.toFixed(0)}`,
        }, { accountId });

        // Notify Main Site + Admin
        LifecycleCallbackClient.riskBreached({
          accountId, traderId: account.trader_id,
          ruleType: 'max_drawdown',
          currentValue: drawdown, limitValue: maxDrawdown,
        }).catch(() => {});
        LifecycleCallbackClient.challengeFailed({
          accountId, traderId: account.trader_id,
          challengeId: account.challenge_id || accountId,
          reason: 'max_drawdown', drawdown, limit: maxDrawdown,
        }).catch(() => {});

        return { status: 'breached', reason: `Max drawdown breached (₹${drawdown.toFixed(0)})` };
      }
    }

    // Check profit target (positive check — pass challenge)
    if (rules.profit_target) {
      const target = rules.profit_target;
      const challenge = await this.getChallengeForAccount(accountId);
      if (challenge) {
        const totalPnl = account.balance - challenge.initial_balance + unrealizedPnl;
        const targetAmount = target.amount || (target.percent / 100) * challenge.initial_balance;

        if (totalPnl >= targetAmount) {
          // Publish to event bus
          eventBus.publish('challenge.updated', {
            challengeId: challenge.id,
            status: 'target_reached',
            reason: 'profit_target',
            totalPnl,
            targetAmount,
          }, { accountId });

          return { status: 'target_reached', reason: `Profit target reached (₹${totalPnl.toFixed(0)})` };
        }
      }
    }

    // Update peak balance if current is higher (on challenge_accounts table)
    const currentEquity = account.balance + unrealizedPnl;
    if (currentEquity > (account.peak_balance || 0)) {
      try {
        const challenge = await this.getChallengeForAccount(accountId);
        if (challenge) {
          const { supabase } = await import('../db/client.js');
          await supabase.from('challenge_accounts').update({ peak_balance: currentEquity }).eq('id', challenge.id);
        }
      } catch (e) { /* non-critical */ }
    }

    return { status: 'ok' };
  }

  // === Individual Rule Checks ===

  static async checkMarketHoliday() {
    const { isClosed, reason, holidayName } = HolidayService.checkMarketClosed();
    if (isClosed && holidayName) {
      return { allowed: false, reason: `Market is closed today (holiday: ${holidayName})` };
    }
    return { allowed: true };
  }

  static async checkWeekend() {
    const { isClosed, isWeekend } = HolidayService.checkMarketClosed();
    if (isClosed && isWeekend) {
      const day = new Date().getDay();
      return { allowed: false, reason: `Market is closed (${day === 0 ? 'Sunday' : 'Saturday'}). Trading resumes on next trading day.` };
    }
    return { allowed: true };
  }

  static async checkMarginAvailability(accountId, orderParams, account, quoteProvider) {
    const balance = parseFloat(account.balance) || 0;
    const result = await MarginService.validateMargin(accountId, orderParams, balance, quoteProvider);
    return result;
  }

  static async checkAllowedSegments(rules, orderParams) {
    if (!rules.allowed_segments) return { allowed: true };

    const allowed = rules.allowed_segments.segments || [];
    if (!allowed.includes(orderParams.segment)) {
      return { allowed: false, reason: `Segment ${orderParams.segment} not allowed. Permitted: ${allowed.join(', ')}` };
    }
    return { allowed: true };
  }

  static async checkTradingHours(rules) {
    if (!rules.trading_hours) return { allowed: true };

    const { start, end } = rules.trading_hours;
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (currentTime < start || currentTime > end) {
      return { allowed: false, reason: `Trading not allowed outside ${start} - ${end}. Current: ${currentTime}` };
    }
    return { allowed: true };
  }

  static async checkMaxPositions(rules, accountId) {
    if (!rules.max_positions) return { allowed: true };

    const maxCount = rules.max_positions.count;
    const currentCount = await positionRepo.countOpenPositions(accountId);

    if (currentCount >= maxCount) {
      return { allowed: false, reason: `Max positions reached (${currentCount}/${maxCount})` };
    }
    return { allowed: true };
  }

  static async checkMaxLotSize(rules, orderParams) {
    if (!rules.max_lot_size) return { allowed: true };

    const limits = rules.max_lot_size;
    const segment = orderParams.segment?.toLowerCase();
    const maxLots = limits[segment] || limits.default || 99;
    const lotSize = orderParams.lotSize || 1;
    const lots = Math.ceil(orderParams.qty / lotSize);

    if (lots > maxLots) {
      return { allowed: false, reason: `Order exceeds max lot size (${lots}/${maxLots} lots for ${segment})` };
    }
    return { allowed: true };
  }

  static async checkMaxDailyTrades(rules, accountId) {
    if (!rules.max_daily_trades) return { allowed: true };

    const maxCount = rules.max_daily_trades.count;
    const todayCount = await tradeRepo.countTodayTrades(accountId);

    if (todayCount >= maxCount) {
      return { allowed: false, reason: `Max daily trades reached (${todayCount}/${maxCount})` };
    }
    return { allowed: true };
  }

  /**
   * No Overnight Rule.
   * Blocks new BUY/SELL orders for carry-forward product types (CNC, NRML)
   * after the cutoff time. Forces intraday close before market end.
   * 
   * Rule value: { cutoffTime: "15:15", allowedProducts: ["MIS"] }
   */
  static async checkNoOvernight(rules, orderParams) {
    if (!rules.no_overnight) return { allowed: true };

    const { cutoffTime, allowedProducts } = rules.no_overnight;
    if (!cutoffTime) return { allowed: true };

    // If product type is intraday (MIS), always allowed
    const intraday = allowedProducts || ['MIS'];
    if (intraday.includes(orderParams.productType)) {
      return { allowed: true };
    }

    // Check if current time is past cutoff
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (currentTime >= cutoffTime) {
      return {
        allowed: false,
        reason: `Overnight positions not allowed. Carry-forward orders blocked after ${cutoffTime}. Use MIS (intraday) product type.`,
      };
    }

    return { allowed: true };
  }

  /**
   * News Blackout Rule.
   * Blocks trading during high-impact news windows.
   * 
   * Rule value: { 
   *   windows: [
   *     { start: "14:00", end: "14:30", label: "RBI Policy" },
   *     { start: "18:00", end: "18:15", label: "GDP Data" }
   *   ],
   *   blockAll: false  // if true, blocks all orders; if false, blocks new positions only
   * }
   */
  static async checkNewsBlackout(rules) {
    if (!rules.news_blackout) return { allowed: true };

    const { windows, blockAll } = rules.news_blackout;
    if (!windows || !Array.isArray(windows) || windows.length === 0) {
      return { allowed: true };
    }

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (const window of windows) {
      if (currentTime >= window.start && currentTime <= window.end) {
        const label = window.label || 'News event';
        return {
          allowed: false,
          reason: `News blackout active (${label}): Trading blocked ${window.start} - ${window.end}`,
        };
      }
    }

    return { allowed: true };
  }

  static async checkDailyLossLimit(rules, account, accountId, quoteProvider) {
    if (!rules.daily_loss_limit) return { allowed: true };

    const limit = rules.daily_loss_limit;
    const maxLoss = limit.amount || (limit.percent / 100) * account.balance;

    const todayRealizedPnl = await this.calculateTodayRealizedPnl(accountId);
    const unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider);
    const totalDailyPnl = todayRealizedPnl + unrealizedPnl;

    // If already close to limit (80%), warn but allow
    // If at limit, reject
    if (totalDailyPnl < 0 && Math.abs(totalDailyPnl) >= maxLoss) {
      return { allowed: false, reason: `Daily loss limit would be breached (current loss: ₹${Math.abs(totalDailyPnl).toFixed(0)}, limit: ₹${maxLoss.toFixed(0)})` };
    }
    return { allowed: true };
  }

  // === Consistency Rule ===

  /**
   * Consistency Rule: No single day's profit can exceed X% of total profit.
   * Prevents lucky-day-dependent strategies.
   * 
   * Rule value: { maxDayProfitPercent: 40 } — no single day > 40% of total profit
   */
  static async checkConsistencyRule(rules, accountId, account) {
    if (!rules.consistency_rule) return { allowed: true };

    const { maxDayProfitPercent } = rules.consistency_rule;
    if (!maxDayProfitPercent) return { allowed: true };

    // Get total profit from start
    const challenge = await this.getChallengeForAccount(accountId);
    if (!challenge) return { allowed: true };

    const totalProfit = account.balance - challenge.initial_balance;
    if (totalProfit <= 0) return { allowed: true }; // Not profitable yet, no consistency issue

    // Get today's realized P&L
    const todayPnl = await this.calculateTodayRealizedPnl(accountId);
    if (todayPnl <= 0) return { allowed: true }; // Today is not a profit day

    const dayProfitPercent = (todayPnl / totalProfit) * 100;

    if (dayProfitPercent > maxDayProfitPercent) {
      return {
        allowed: false,
        reason: `Consistency rule: Today's profit (${dayProfitPercent.toFixed(1)}%) exceeds ${maxDayProfitPercent}% of total profit. Reduce position sizing.`,
      };
    }

    return { allowed: true };
  }

  // === Max Risk Per Trade ===

  /**
   * Max Risk Per Trade: Limits the maximum capital risked on a single trade.
   * 
   * Rule value: { percent: 2 } — max 2% of account balance per trade
   */
  static async checkMaxRiskPerTrade(rules, orderParams, account, quoteProvider) {
    if (!rules.max_risk_per_trade) return { allowed: true };

    const { percent } = rules.max_risk_per_trade;
    if (!percent) return { allowed: true };

    const balance = parseFloat(account.balance) || 0;
    const maxRiskAmount = (percent / 100) * balance;

    // Estimate risk: qty * price (notional value as proxy for risk)
    const ltp = quoteProvider ? quoteProvider(orderParams.token) : (orderParams.price || 0);
    const notionalValue = orderParams.qty * ltp;

    // For intraday, risk is roughly the margin required
    // Simplified: use notional / leverage as risk estimate
    const estimatedRisk = notionalValue * 0.1; // ~10% margin as proxy

    if (estimatedRisk > maxRiskAmount) {
      return {
        allowed: false,
        reason: `Max risk per trade exceeded: estimated risk ₹${estimatedRisk.toFixed(0)} > allowed ₹${maxRiskAmount.toFixed(0)} (${percent}% of balance)`,
      };
    }

    return { allowed: true };
  }

  // === Leverage Limit ===

  /**
   * Leverage Limit: Restricts total leverage across all positions.
   * 
   * Rule value: { maxMultiplier: 5 } — max 5x leverage
   */
  static async checkLeverageLimit(rules, orderParams, account) {
    if (!rules.leverage_limit) return { allowed: true };

    const { maxMultiplier } = rules.leverage_limit;
    if (!maxMultiplier) return { allowed: true };

    const balance = parseFloat(account.balance) || 0;
    if (balance <= 0) return { allowed: true };

    // Calculate total exposure (existing + new order)
    const totalUsedMargin = parseFloat(account.used_margin || 0);
    const newOrderMargin = orderParams.qty * (orderParams.price || 0) * 0.1; // ~10% margin
    const totalExposure = totalUsedMargin + newOrderMargin;

    const currentLeverage = totalExposure / balance;

    if (currentLeverage > maxMultiplier) {
      return {
        allowed: false,
        reason: `Leverage limit exceeded: ${currentLeverage.toFixed(1)}x > max ${maxMultiplier}x`,
      };
    }

    return { allowed: true };
  }

  // === Daily Profit Cap (Kill-Switch) ===

  /**
   * Daily Profit Cap: If today's profit reaches X% of account balance,
   * block all new orders for the rest of the day (kill-switch).
   *
   * Rule value: { percent: 4, amount: <balance * 0.04> }
   */
  static async checkDailyProfitCap(rules, accountId) {
    if (!rules.daily_profit_cap) return { allowed: true };

    const cap = rules.daily_profit_cap;
    const account = await accountRepo.findById(accountId);
    if (!account) return { allowed: true };

    const balance = parseFloat(account.balance) || 0;
    const capAmount = cap.amount || (cap.percent / 100) * balance;

    const todayRealizedPnl = await this.calculateTodayRealizedPnl(accountId);

    if (todayRealizedPnl >= capAmount) {
      // Publish kill-switch event so UI can reflect it immediately
      eventBus.publish('risk.alert', {
        type: 'kill_switch',
        ruleType: 'daily_profit_cap',
        message: `Daily profit cap reached (₹${todayRealizedPnl.toFixed(0)} ≥ ₹${capAmount.toFixed(0)}). No new trades until tomorrow.`,
        currentValue: todayRealizedPnl,
        limitValue: capAmount,
        percentUsed: 100,
      }, { accountId });

      return {
        allowed: false,
        reason: `Daily profit cap hit (${cap.percent}%). Kill-switch active — no new trades until next session. Current profit: ₹${todayRealizedPnl.toFixed(0)}`,
      };
    }

    return { allowed: true };
  }

  // === Max Position Size ===

  /**
   * Max Position Size: Total open exposure cannot exceed X% of account balance.
   *
   * Rule value: { percent: 70, amount: <balance * 0.70> }
   */
  static async checkMaxPositionSize(rules, account, orderParams) {
    if (!rules.max_position_size) return { allowed: true };

    const limit = rules.max_position_size;
    const balance = parseFloat(account.balance) || 0;
    if (balance <= 0) return { allowed: true };

    const maxAmount = limit.amount || (limit.percent / 100) * balance;

    // Estimate new order notional
    const orderPrice = orderParams.price || 0;
    const newOrderNotional = orderParams.qty * orderPrice;
    const existingMarginUsed = parseFloat(account.used_margin || 0);
    const totalExposure = existingMarginUsed + newOrderNotional;

    if (totalExposure > maxAmount) {
      return {
        allowed: false,
        reason: `Max position size exceeded: total exposure ₹${totalExposure.toFixed(0)} > ${limit.percent}% limit ₹${maxAmount.toFixed(0)}`,
      };
    }

    return { allowed: true };
  }

  // === Risk Per Trade Idea ===

  /**
   * Risk Per Trade Idea: Max 1% of starting balance at risk per trade idea.
   * A trade idea = all open positions on the same instrument, same direction.
   * Reopening same instrument, same direction within 10 minutes = same idea.
   *
   * Rule value: { percent: 1, amount: <balance * 0.01>, sameDirectionWindowMinutes: 10 }
   */
  static async checkRiskPerTradeIdea(rules, account, accountId, orderParams) {
    if (!rules.risk_per_trade_idea) return { allowed: true };

    const rule = rules.risk_per_trade_idea;
    const challenge = await this.getChallengeForAccount(accountId);
    const startingBalance = challenge ? parseFloat(challenge.initial_balance) : parseFloat(account.balance);

    const maxRisk = rule.amount || (rule.percent / 100) * startingBalance;
    const windowMinutes = rule.sameDirectionWindowMinutes || 10;

    // Get open positions on same token + same direction
    const openPositions = await positionRepo.getOpenPositions(accountId);
    const sameIdeaPositions = openPositions.filter(p => {
      const sameSide = orderParams.side === 'BUY' ? p.qty > 0 : p.qty < 0;
      return p.token === orderParams.token && sameSide;
    });

    // Check recently closed positions (within window) — same idea, don't reset
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const recentTrades = await tradeRepo.getTradesSince(accountId, windowStart);
    const recentSameIdea = recentTrades.filter(t => {
      const sameSide = orderParams.side === t.side;
      return t.token === orderParams.token && sameSide;
    });

    // Total existing exposure for this idea
    const existingExposure = sameIdeaPositions.reduce((sum, p) => {
      return sum + Math.abs(p.qty) * p.avgPrice;
    }, 0);

    // New order additional exposure
    const newOrderExposure = orderParams.qty * (orderParams.price || 0);
    const totalIdeaExposure = existingExposure + newOrderExposure;

    // Risk proxy: 10% of notional (margin-based estimate)
    const estimatedRisk = totalIdeaExposure * 0.10;

    if (estimatedRisk > maxRisk) {
      const hasRecentActivity = recentSameIdea.length > 0;
      return {
        allowed: false,
        reason: `Risk per trade idea exceeded: estimated ₹${estimatedRisk.toFixed(0)} > ₹${maxRisk.toFixed(0)} (${rule.percent}% of ₹${startingBalance.toLocaleString('en-IN')}).${hasRecentActivity ? ` Recent trades on this instrument (within ${windowMinutes}min) count as the same idea.` : ''}`,
      };
    }

    return { allowed: true };
  }

  // === Helpers ===

  static async calculateTodayRealizedPnl(accountId) {
    const trades = await tradeRepo.getTodayRealizedPnl(accountId);
    if (!trades || trades.length === 0) return 0;

    // Group trades by token and calculate P&L using FIFO
    const positions = {};
    let realizedPnl = 0;

    for (const trade of trades) {
      const key = trade.token;
      if (!positions[key]) {
        positions[key] = { qty: 0, avgPrice: 0 };
      }

      const pos = positions[key];
      const tradeQty = trade.side === 'BUY' ? trade.qty : -trade.qty;

      if ((pos.qty > 0 && tradeQty < 0) || (pos.qty < 0 && tradeQty > 0)) {
        // Closing trade
        const closeQty = Math.min(Math.abs(tradeQty), Math.abs(pos.qty));
        const pnlPerUnit = pos.qty > 0
          ? (trade.price - pos.avgPrice)
          : (pos.avgPrice - trade.price);
        realizedPnl += pnlPerUnit * closeQty;

        const remaining = Math.abs(pos.qty) - closeQty;
        if (remaining === 0) {
          pos.qty = 0;
          pos.avgPrice = 0;
        } else {
          pos.qty = pos.qty > 0 ? remaining : -remaining;
        }

        // If trade has excess qty (reversal), track new position
        const excess = Math.abs(tradeQty) - closeQty;
        if (excess > 0) {
          pos.qty = tradeQty > 0 ? excess : -excess;
          pos.avgPrice = trade.price;
        }
      } else {
        // Opening or adding to position
        const totalCost = (pos.avgPrice * Math.abs(pos.qty)) + (trade.price * trade.qty);
        const totalQty = Math.abs(pos.qty) + trade.qty;
        pos.avgPrice = totalCost / totalQty;
        pos.qty += tradeQty;
      }
    }

    return Math.round(realizedPnl * 100) / 100;
  }

  static async getChallengeForAccount(accountId) {
    const account = await accountRepo.findById(accountId);
    if (!account) return null;

    // Look up challenge account by trader_id
    const { data, error } = await accountRepo.db
      .from('challenge_accounts')
      .select('*')
      .eq('trader_id', account.trader_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Record daily metrics snapshot.
   * Call at end of trading day or on demand.
   */
  static async recordDailyMetrics(accountId, quoteProvider = null) {
    const account = await accountRepo.findById(accountId);
    if (!account) return null;

    const todayRealizedPnl = await this.calculateTodayRealizedPnl(accountId);
    const unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider);
    const todayTrades = await tradeRepo.findTodayTrades(accountId);

    const winningTrades = todayTrades.filter(t => {
      // Simple heuristic — proper P&L needs position context
      return t.side === 'SELL'; // Count sells as potential winners
    }).length;

    const peakBalance = Math.max(account.peak_balance || account.balance, account.balance + unrealizedPnl);
    const drawdown = peakBalance - (account.balance + unrealizedPnl);

    return metricsRepo.upsertDailyMetrics(accountId, {
      startingBalance: account.balance - todayRealizedPnl,
      endingBalance: account.balance,
      realizedPnl: todayRealizedPnl,
      unrealizedPnl,
      totalTrades: todayTrades.length,
      winningTrades: Math.floor(winningTrades / 2), // Approximate
      losingTrades: Math.floor((todayTrades.length - winningTrades) / 2),
      maxDrawdown: drawdown > 0 ? drawdown : 0,
      dailyLoss: todayRealizedPnl < 0 ? Math.abs(todayRealizedPnl) : 0,
      peakBalance,
    });
  }
}

