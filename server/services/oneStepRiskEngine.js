/**
 * ONE-STEP RISK ENGINE
 *
 * Handles ALL risk validation for 1-Step Funding accounts.
 * Replaces the generic Risk Engine for 1-Step accounts only.
 *
 * Other challenge types (Flash, Instant, 2-Step) are COMPLETELY UNAFFECTED.
 *
 * Rules enforced (all values from OneStepRiskProfileService → onestep_risk_profile table):
 *
 *  PRE-TRADE:
 *   1.  Allowed segments (NSE, NFO, BFO, CDS, MCX)
 *   2.  Trading hours 09:15–15:30 IST (explicit UTC+5:30 conversion)
 *   3.  Weekend check (configurable via profile)
 *   4.  Market holidays (configurable via profile)
 *   5.  Overnight — ALLOWED by default (no forced cutoff)
 *   6.  Daily profit cap 4% + 8-hour cooldown (persisted in DB)
 *   7.  Max open positions: 20
 *   8.  Max position size: 70% of account balance
 *   9.  Daily loss limit: 3% of start-of-day balance
 *  10.  Max risk per trade: 1.5% (SL-aware when SL is provided)
 *  11.  Leverage limit: 1:30 (notional-based, not margin-proxy)
 *  12.  Consistency rule: 40% (no single day > 40% of total profit)
 *  13.  Margin availability (existing MarginService)
 *
 *  POST-TRADE:
 *   1.  Daily loss limit breach → lock account (recoverable next day)
 *   2.  Max drawdown breach (static, 6%) → breach account (permanent)
 *   3.  Profit target reached (eval only) → target_reached signal
 *   4.  Peak balance update
 *   5.  Feed staleness guard
 */

import { OneStepRiskProfileService }  from './oneStepRiskProfileService.js';
import { PositionRepository }         from '../repositories/position.repository.js';
import { TradeRepository }            from '../repositories/trade.repository.js';
import { AccountRepository }          from '../repositories/account.repository.js';
import { AuditRepository }            from '../repositories/audit.repository.js';
import { MarginService }              from './marginService.js';
import { HolidayService }             from './holidayService.js';
import { eventBus }                   from '../events/index.js';
import { LifecycleCallbackClient }    from '../clients/lifecycle.callback.js';
import { supabase }                   from '../db/client.js';

const positionRepo = new PositionRepository();
const tradeRepo    = new TradeRepository();
const accountRepo  = new AccountRepository();
const auditRepo    = new AuditRepository();

export class OneStepRiskEngine {
  // ─────────────────────────────────────────────────────────────────────────
  // PRE-TRADE VALIDATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Validate an order for a 1-Step Funding account.
   * Returns { allowed: true } or { allowed: false, reason: string, ruleType: string }
   *
   * @param {string}   accountId
   * @param {object}   orderParams  - { symbol, token, segment, side, orderType, productType,
   *                                    qty, price, triggerPrice?, isCloseOrder?, slPrice? }
   * @param {function} quoteProvider - (token) => ltp | null
   * @param {object}   account      - trading_accounts row (with challenge joined)
   */
  static async validateOrder(accountId, orderParams, quoteProvider, account) {
    // ── Account status ────────────────────────────────────────────────────
    if (!account || account.status !== 'active') {
      return {
        allowed: false,
        reason: `Account is ${account?.status || 'unknown'}. Trading disabled.`,
        ruleType: 'account_status',
      };
    }

    // ── Close/exit orders bypass ALL opening rules ─────────────────────────
    if (orderParams.isCloseOrder) {
      return { allowed: true };
    }

    const profile = await OneStepRiskProfileService.getProfile();

    // ── 1. Weekend check ──────────────────────────────────────────────────
    if (!profile.weekend_allowed) {
      const day = new Date().getDay();
      if (day === 0 || day === 6) {
        return {
          allowed: false,
          reason: `Market is closed (${day === 0 ? 'Sunday' : 'Saturday'}). 1-Step does not allow weekend trading.`,
          ruleType: 'weekend',
        };
      }
    }

    // ── 2. Market holiday check ───────────────────────────────────────────
    if (profile.holiday_restriction) {
      const { isClosed, holidayName } = HolidayService.checkMarketClosed();
      if (isClosed && holidayName) {
        return {
          allowed: false,
          reason: `Market is closed today (holiday: ${holidayName}).`,
          ruleType: 'holiday',
        };
      }
    }

    // ── 3. Allowed segments ────────────────────────────────────────────────
    const allowedSegs = Array.isArray(profile.allowed_segments)
      ? profile.allowed_segments
      : ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'];

    if (!allowedSegs.includes(orderParams.segment)) {
      return {
        allowed: false,
        reason: `Segment ${orderParams.segment} not allowed for 1-Step accounts. Permitted: ${allowedSegs.join(', ')}`,
        ruleType: 'allowed_segments',
      };
    }

    // ── 4. Trading hours (IST — explicit UTC+5:30) ─────────────────────────
    // Railway/Docker default is UTC. Explicit conversion ensures correctness
    // regardless of server timezone.
    const istMs      = Date.now() + (5 * 60 + 30) * 60 * 1000;
    const istDate    = new Date(istMs);
    const istHH      = String(istDate.getUTCHours()).padStart(2, '0');
    const istMM      = String(istDate.getUTCMinutes()).padStart(2, '0');
    const currentIST = `${istHH}:${istMM}`;
    const start      = profile.trading_hours_start || '09:15';
    const end        = profile.trading_hours_end   || '15:30';

    if (currentIST < start || currentIST > end) {
      return {
        allowed: false,
        reason: `1-Step trading not allowed outside ${start}–${end} IST. Current IST: ${currentIST}`,
        ruleType: 'trading_hours',
      };
    }

    // ── 5. Overnight — ALLOWED by default ─────────────────────────────────
    // profile.overnight_allowed = true → no forced square-off cutoff for 1-Step.
    // No overnight block is applied.

    // ── 6. Daily profit cap + 8-hour cooldown ─────────────────────────────
    const capResult = await this._checkDailyProfitCap(profile, account, accountId);
    if (!capResult.allowed) return capResult;

    // ── 7. Max open positions ─────────────────────────────────────────────
    const maxPos     = profile.max_open_positions || 20;
    const currentPos = await positionRepo.countOpenPositions(accountId);
    if (currentPos >= maxPos) {
      return {
        allowed: false,
        reason: `Max open positions reached (${currentPos}/${maxPos})`,
        ruleType: 'max_open_positions',
      };
    }

    // ── 8. Max position size: 70% of balance ─────────────────────────────
    const posResult = await this._checkMaxPositionSize(profile, account, accountId, orderParams, quoteProvider);
    if (!posResult.allowed) return posResult;

    // ── 9. Daily loss limit ───────────────────────────────────────────────
    const dailyLossResult = await this._checkDailyLossLimit(profile, account, accountId, quoteProvider);
    if (!dailyLossResult.allowed) return dailyLossResult;

    // ── 10. Max risk per trade ────────────────────────────────────────────
    const riskResult = await this._checkMaxRiskPerTrade(profile, account, orderParams, quoteProvider);
    if (!riskResult.allowed) return riskResult;

    // ── 11. Leverage limit 1:30 ───────────────────────────────────────────
    const levResult = await this._checkLeverageLimit(profile, account, accountId, orderParams, quoteProvider);
    if (!levResult.allowed) return levResult;

    // ── 12. Consistency rule ──────────────────────────────────────────────
    const consResult = await this._checkConsistencyRule(profile, account, accountId);
    if (!consResult.allowed) return consResult;

    // ── 13. Margin availability ───────────────────────────────────────────
    const balance      = parseFloat(account.balance) || 0;
    const marginResult = await MarginService.validateMargin(accountId, orderParams, balance, quoteProvider);
    if (!marginResult.allowed) return { ...marginResult, ruleType: 'margin' };

    return { allowed: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST-TRADE CHECK
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Post-trade risk check for 1-Step accounts.
   * Called after every fill.
   *
   * @param {string}   accountId
   * @param {function} quoteProvider
   * @param {object}   account - trading_accounts row (with challenge joined)
   * @returns {{ status: 'ok'|'locked'|'breached'|'target_reached'|'feed_stale', reason?: string }}
   */
  static async postTradeCheck(accountId, quoteProvider, account) {
    if (!account || account.status !== 'active') {
      return { status: 'ok' };
    }

    const profile     = await OneStepRiskProfileService.getProfile();
    const balance     = parseFloat(account.balance) || 0;
    const peakBalance = parseFloat(account.peak_balance) || balance;

    // ── Feed staleness guard ───────────────────────────────────────────────
    let feedIsStale = false;
    try {
      const { marketDataEngine: mde } = await import('./marketDataEngine.js').catch(() => ({}));
      if (mde && typeof mde.isFeedStale === 'function') {
        feedIsStale = mde.isFeedStale();
      }
    } catch { /* non-critical */ }

    // ── Realized P&L for today ─────────────────────────────────────────────
    const todayRealizedPnl = await this._calculateTodayRealizedPnl(accountId);

    // ── Unrealized P&L (only when feed is healthy) ────────────────────────
    let unrealizedPnl = 0;
    if (!feedIsStale && quoteProvider) {
      unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider);
    }

    const totalDailyPnl  = todayRealizedPnl + (feedIsStale ? 0 : unrealizedPnl);
    const currentEquity  = balance + (feedIsStale ? 0 : unrealizedPnl);

    // ── Daily loss limit check ─────────────────────────────────────────────
    const dailyLossPct = profile.daily_loss_pct || 3.0;
    // Use start-of-day balance as the basis. We approximate this as
    // account.balance minus today's realized P&L = opening balance.
    const startOfDayBalance = balance - todayRealizedPnl;
    const maxDailyLoss      = (dailyLossPct / 100) * Math.max(startOfDayBalance, balance);

    if (totalDailyPnl < 0 && Math.abs(totalDailyPnl) >= maxDailyLoss) {
      const reason = `Daily loss limit breached: ₹${Math.abs(totalDailyPnl).toFixed(0)} >= ₹${maxDailyLoss.toFixed(0)} (${dailyLossPct}% of start-of-day balance)`;
      await accountRepo.lockAccount(accountId, reason);
      await auditRepo.log({
        accountId,
        userId: account.trader_id,
        eventType: 'account_locked',
        eventData: { reason: 'daily_loss_limit', loss: Math.abs(totalDailyPnl), limit: maxDailyLoss },
      });
      eventBus.publish('risk.alert', {
        type: 'breach', ruleType: 'daily_loss_limit',
        message: reason,
        currentValue: Math.abs(totalDailyPnl), limitValue: maxDailyLoss, percentUsed: 100,
      }, { accountId });
      eventBus.publish('account.locked', { accountId, reason }, { accountId });
      LifecycleCallbackClient.accountLocked({
        accountId, traderId: account.trader_id, reason, ruleType: 'daily_loss_limit',
      }).catch(() => {});
      return { status: 'locked', reason };
    }

    // ── Max drawdown check (STATIC — uses initial balance) ─────────────────
    // Static drawdown: measured from the account's INITIAL balance (not peak).
    const maxDDPct    = profile.max_drawdown_pct || 6.0;
    // Retrieve initial balance from challenge
    const challengeId = account.challenge_id || account.challenge?.id;
    let initialBalance = balance;
    if (challengeId && supabase) {
      try {
        const { data: ch } = await supabase
          .from('challenge_accounts')
          .select('initial_balance')
          .eq('id', challengeId)
          .single();
        if (ch?.initial_balance) initialBalance = parseFloat(ch.initial_balance);
      } catch { /* non-critical */ }
    }

    const maxDDAmount = (maxDDPct / 100) * initialBalance;
    const drawdown    = initialBalance - currentEquity; // positive = loss from initial

    if (drawdown >= maxDDAmount) {
      const reason = `Max drawdown breached: ₹${drawdown.toFixed(0)} >= ₹${maxDDAmount.toFixed(0)} (${maxDDPct}% of initial balance ₹${initialBalance.toFixed(0)})`;
      await accountRepo.breachAccount(accountId, reason);
      await auditRepo.log({
        accountId,
        userId: account.trader_id,
        eventType: 'account_breached',
        eventData: { reason: 'max_drawdown', drawdown, limit: maxDDAmount, initialBalance },
      });
      eventBus.publish('risk.alert', {
        type: 'breach', ruleType: 'max_drawdown',
        message: reason, currentValue: drawdown, limitValue: maxDDAmount, percentUsed: 100,
      }, { accountId });
      eventBus.publish('account.breached', { accountId, reason }, { accountId });
      LifecycleCallbackClient.riskBreached({
        accountId, traderId: account.trader_id,
        ruleType: 'max_drawdown', currentValue: drawdown, limitValue: maxDDAmount,
      }).catch(() => {});
      LifecycleCallbackClient.challengeFailed({
        accountId, traderId: account.trader_id,
        challengeId: challengeId || accountId,
        reason: 'max_drawdown', drawdown, limit: maxDDAmount,
      }).catch(() => {});
      return { status: 'breached', reason };
    }

    // ── Profit target (evaluation phase only) ─────────────────────────────
    const isFunded = OneStepRiskProfileService.isFundedPhase(account);
    if (!isFunded && profile.profit_target_pct > 0 && challengeId) {
      const targetAmount = (profile.profit_target_pct / 100) * initialBalance;
      const totalPnl     = currentEquity - initialBalance;
      if (totalPnl >= targetAmount) {
        eventBus.publish('challenge.updated', {
          challengeId,
          status: 'target_reached',
          reason: 'profit_target',
          totalPnl,
          targetAmount,
        }, { accountId });
        return { status: 'target_reached', reason: `Profit target reached (₹${totalPnl.toFixed(0)})` };
      }
    }

    // ── Update peak balance ────────────────────────────────────────────────
    if (!feedIsStale && currentEquity > peakBalance && challengeId && supabase) {
      try {
        await supabase
          .from('challenge_accounts')
          .update({ peak_balance: currentEquity })
          .eq('id', challengeId);
      } catch { /* non-critical */ }
    }

    if (feedIsStale) {
      return { status: 'feed_stale', reason: 'Feed stale — unrealized P&L excluded from 1-Step risk checks' };
    }

    return { status: 'ok' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE RULE CHECKS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Daily profit cap check with 8-hour cooldown.
   *
   * When today's realized profit >= 4% of start-of-day balance:
   *   - Block NEW opening positions
   *   - Set cooldown expiry = now + 8 hours (persisted to trading_accounts.daily_profit_cap_until)
   *   - After 8 hours, trading resumes automatically
   *   - Account is NOT locked, NOT breached
   *
   * @private
   */
  static async _checkDailyProfitCap(profile, account, accountId) {
    const capPct     = profile.daily_profit_cap_pct || 4.0;
    const cooldownH  = profile.daily_profit_cap_cooldown_hours || 8.0;
    const balance    = parseFloat(account.balance) || 0;

    // Check if already in cooldown (persisted timestamp)
    if (account.daily_profit_cap_until) {
      const cooldownExpiry = new Date(account.daily_profit_cap_until).getTime();
      if (Date.now() < cooldownExpiry) {
        const remaining = Math.ceil((cooldownExpiry - Date.now()) / 60000);
        return {
          allowed: false,
          reason: `Daily profit cap cooldown active. New positions blocked for ${remaining} more minute(s). Close/reduce existing positions freely.`,
          ruleType: 'daily_profit_cap',
        };
      }
    }

    // Calculate today's realized P&L
    const todayPnl = await this._calculateTodayRealizedPnl(accountId);

    // Start-of-day balance proxy
    const startOfDayBalance = balance - todayPnl;
    const capAmount = (capPct / 100) * Math.max(startOfDayBalance, balance);

    if (todayPnl >= capAmount) {
      // Set cooldown expiry in DB — persists across server restarts
      const cooldownUntil = new Date(Date.now() + cooldownH * 60 * 60 * 1000).toISOString();
      if (supabase) {
        await supabase
          .from('trading_accounts')
          .update({ daily_profit_cap_until: cooldownUntil })
          .eq('id', accountId);
      }

      eventBus.publish('risk.alert', {
        type: 'kill_switch', ruleType: 'daily_profit_cap',
        message: `Daily profit cap hit (${capPct}%). New positions blocked for ${cooldownH}h. Current profit: ₹${todayPnl.toFixed(0)}`,
        currentValue: todayPnl, limitValue: capAmount, percentUsed: 100,
      }, { accountId });

      return {
        allowed: false,
        reason: `Daily profit cap hit (${capPct}%). New positions blocked for ${cooldownH} hours. Cooldown until: ${cooldownUntil}. Existing positions may still be closed.`,
        ruleType: 'daily_profit_cap',
      };
    }

    return { allowed: true };
  }

  /**
   * Max position size: total open notional + new order notional <= 70% of balance.
   * "Position size" means notional account exposure, not quantity.
   * @private
   */
  static async _checkMaxPositionSize(profile, account, accountId, orderParams, quoteProvider) {
    const maxPct   = profile.max_position_size_pct || 70.0;
    const balance  = parseFloat(account.balance) || 0;
    if (balance <= 0) return { allowed: true };

    const maxAmount = (maxPct / 100) * balance;

    // Sum existing open position notional
    let existingNotional = 0;
    const openPositions = await positionRepo.findOpenByAccountId(accountId);
    for (const pos of openPositions) {
      if (!pos.qty || pos.qty === 0) continue;
      const ltp = (quoteProvider ? quoteProvider(pos.token) : null) || pos.avg_price || 0;
      existingNotional += Math.abs(pos.qty) * ltp;
    }

    // New order notional
    const orderLtp        = (quoteProvider ? quoteProvider(orderParams.token) : null) || orderParams.price || 0;
    const newOrderNotional = orderParams.qty * orderLtp;
    const totalNotional    = existingNotional + newOrderNotional;

    if (totalNotional > maxAmount) {
      return {
        allowed: false,
        reason: `Max position size exceeded: total notional ₹${Math.round(totalNotional).toLocaleString('en-IN')} > ${maxPct}% limit ₹${Math.round(maxAmount).toLocaleString('en-IN')}`,
        ruleType: 'max_position_size',
      };
    }

    return { allowed: true };
  }

  /**
   * Daily loss limit (pre-trade check).
   * Uses start-of-day balance as basis.
   * @private
   */
  static async _checkDailyLossLimit(profile, account, accountId, quoteProvider) {
    const limitPct = profile.daily_loss_pct || 3.0;
    const balance  = parseFloat(account.balance) || 0;

    const todayRealizedPnl = await this._calculateTodayRealizedPnl(accountId);
    const unrealizedPnl    = quoteProvider
      ? await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider)
      : 0;

    const totalDailyPnl     = todayRealizedPnl + unrealizedPnl;
    const startOfDayBalance = balance - todayRealizedPnl;
    const maxLoss           = (limitPct / 100) * Math.max(startOfDayBalance, balance);

    if (totalDailyPnl < 0 && Math.abs(totalDailyPnl) >= maxLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit would be breached (current loss: ₹${Math.abs(totalDailyPnl).toFixed(0)}, limit: ₹${maxLoss.toFixed(0)}, ${limitPct}%)`,
        ruleType: 'daily_loss_limit',
      };
    }

    return { allowed: true };
  }

  /**
   * Max risk per trade — 1.5% of account balance.
   *
   * SL-aware calculation (preferred):
   *   If orderParams.slPrice (stop-loss price) is provided:
   *     risk = |entry - slPrice| × qty × multiplier
   *
   * Fallback (no SL provided):
   *   Uses MarginService.calculateOrderMargin() as the risk proxy.
   *   This is instrument-aware (different margin rules per segment).
   *   More accurate than a flat 10% notional approximation.
   *
   * @private
   */
  static async _checkMaxRiskPerTrade(profile, account, orderParams, quoteProvider) {
    const riskPct  = profile.max_risk_per_trade_pct || 1.5;
    const balance  = parseFloat(account.balance) || 0;
    if (balance <= 0) return { allowed: true };

    const maxRiskAmount = (riskPct / 100) * balance;
    const ltp           = (quoteProvider ? quoteProvider(orderParams.token) : null) || orderParams.price || 0;

    let estimatedRisk = 0;

    if (orderParams.slPrice && orderParams.slPrice > 0 && ltp > 0) {
      // SL-aware: actual entry-to-SL distance × qty
      // For NFO/MCX, the raw qty IS already in units, and the P&L per point
      // is 1 per unit for NSE/NFO indices (NIFTY = ₹50 per point per lot is
      // already reflected in qty when ordered in lots × lot_size units).
      const entryPrice   = ltp;
      const slDistance   = Math.abs(entryPrice - orderParams.slPrice);
      estimatedRisk      = slDistance * orderParams.qty;
    } else {
      // Fallback: instrument-aware margin as risk proxy
      const { requiredMargin } = MarginService.calculateOrderMargin(orderParams, quoteProvider);
      estimatedRisk = requiredMargin;
    }

    if (estimatedRisk > maxRiskAmount) {
      return {
        allowed: false,
        reason: `Max risk per trade exceeded: estimated risk ₹${estimatedRisk.toFixed(0)} > allowed ₹${maxRiskAmount.toFixed(0)} (${riskPct}% of balance ₹${balance.toLocaleString('en-IN')})${orderParams.slPrice ? ' [SL-based calculation]' : ' [margin-based calculation — set SL for precise risk control]'}`,
        ruleType: 'max_risk_per_trade',
      };
    }

    return { allowed: true };
  }

  /**
   * Leverage limit 1:30.
   * Total notional (existing open positions + new order) / account balance.
   * Uses live LTP from quoteProvider where available, falls back to avg_price.
   * Does NOT trust account.used_margin (unreliable for paper accounts).
   * @private
   */
  static async _checkLeverageLimit(profile, account, accountId, orderParams, quoteProvider) {
    const leverageMax = profile.leverage_max || 30;
    const balance     = parseFloat(account.balance) || 0;
    if (balance <= 0) return { allowed: true };

    const orderLtp = (quoteProvider ? quoteProvider(orderParams.token) : null) || orderParams.price || 0;
    if (!orderLtp || orderLtp <= 0) return { allowed: true }; // Cannot calculate — skip

    // Sum existing open position notional
    let existingNotional = 0;
    const openPositions = await positionRepo.findOpenByAccountId(accountId);
    for (const pos of openPositions) {
      if (!pos.qty || pos.qty === 0) continue;
      const posLtp = (quoteProvider ? quoteProvider(pos.token) : null) || pos.avg_price || 0;
      existingNotional += Math.abs(pos.qty) * posLtp;
    }

    const newOrderNotional = orderParams.qty * orderLtp;
    const totalNotional    = existingNotional + newOrderNotional;
    const impliedLeverage  = totalNotional / balance;

    if (impliedLeverage > leverageMax) {
      return {
        allowed: false,
        reason: `Leverage limit exceeded: ${impliedLeverage.toFixed(1)}x > max ${leverageMax}x (existing ₹${Math.round(existingNotional).toLocaleString('en-IN')} + new ₹${Math.round(newOrderNotional).toLocaleString('en-IN')} on balance ₹${Math.round(balance).toLocaleString('en-IN')})`,
        ruleType: 'leverage_limit',
      };
    }

    return { allowed: true };
  }

  /**
   * Consistency rule: no single day's profit > consistency_rule_pct% of total profit.
   * Default: 40%. (Existing 1-Step funded profile value, preserved.)
   * Applied during BOTH evaluation and funded phases.
   * @private
   */
  static async _checkConsistencyRule(profile, account, accountId) {
    const maxPct      = profile.consistency_rule_pct || 40.0;
    if (!maxPct || maxPct <= 0) return { allowed: true };

    const balance     = parseFloat(account.balance) || 0;
    const challengeId = account.challenge_id || account.challenge?.id;
    if (!challengeId || !supabase) return { allowed: true };

    const { data: ch } = await supabase
      .from('challenge_accounts')
      .select('initial_balance')
      .eq('id', challengeId)
      .single();
    if (!ch) return { allowed: true };

    const totalProfit = balance - parseFloat(ch.initial_balance);
    if (totalProfit <= 0) return { allowed: true }; // Not profitable — no constraint

    const todayPnl = await this._calculateTodayRealizedPnl(accountId);
    if (todayPnl <= 0) return { allowed: true }; // Today is not profitable

    const contribution = (todayPnl / totalProfit) * 100;
    if (contribution > maxPct) {
      return {
        allowed: false,
        reason: `Consistency rule: today's profit (${contribution.toFixed(1)}%) exceeds ${maxPct}% of total profit ₹${totalProfit.toFixed(0)}. Reduce position sizing.`,
        ruleType: 'consistency_rule',
      };
    }

    return { allowed: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate today's realized P&L using FIFO matching.
   * Delegates to the existing RiskEngine implementation to avoid duplication.
   */
  static async _calculateTodayRealizedPnl(accountId) {
    try {
      const { RiskEngine } = await import('./riskEngine.js');
      return await RiskEngine.calculateTodayRealizedPnl(accountId);
    } catch {
      return 0;
    }
  }
}
