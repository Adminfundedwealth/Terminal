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
import { InstantRiskProfileService } from './instantRiskProfileService.js';
import { TwoStepRiskProfileService } from './twoStepRiskProfileService.js';
import { OneStepRiskProfileService } from './oneStepRiskProfileService.js';

const riskRulesRepo = new RiskRulesRepository();
const positionRepo = new PositionRepository();
const tradeRepo = new TradeRepository();
const accountRepo = new AccountRepository();
const metricsRepo = new MetricsRepository();
const auditRepo = new AuditRepository();

export class RiskEngine {
  /**
   * Build the authoritative rules map for an account.
   *
   * For Instant accounts: reads live values from instant_risk_profile table
   * (via InstantRiskProfileService) and converts them to the same rules-map
   * shape that the individual check functions expect.  This completely
   * replaces the per-account risk_rules rows for enforcement purposes.
   * The risk_rules rows remain in the DB for audit/history only.
   *
   * For all other account types: returns the existing risk_rules map unchanged.
   *
   * @param {string} accountId
   * @param {object} account  - trading_accounts row (with challenge joined)
   * @returns {object} rules map
   */
  static async _getRulesMap(accountId, account) {
    // Detect Instant account by plan field
    // Detect Instant account
    if (InstantRiskProfileService.isInstantAccount(account)) {
      const ip = await InstantRiskProfileService.getProfile();
      const balance = parseFloat(account?.balance) || 0;
      return {
        daily_loss_limit: { percent: ip.daily_loss_pct, amount: (ip.daily_loss_pct/100)*balance },
        max_drawdown: { percent: ip.max_drawdown_pct, amount: (ip.max_drawdown_pct/100)*balance, type: 'static' },
        profit_target: ip.profit_target_pct > 0 ? { percent: ip.profit_target_pct, amount: (ip.profit_target_pct/100)*balance } : null,
        max_positions: { count: ip.max_open_positions },
        leverage_limit: { maxMultiplier: ip.leverage_max },
        max_position_size: { percent: ip.max_position_size_pct, amount: (ip.max_position_size_pct/100)*balance },
        allowed_segments: { segments: Array.isArray(ip.allowed_segments)?ip.allowed_segments:['NSE','NFO','BFO','MCX','CDS'] },
        trading_hours: { start: ip.trading_hours_start, end: ip.trading_hours_end },
        no_overnight: ip.overnight_allowed ? null : { cutoffTime: ip.overnight_cutoff||'15:30', allowedProducts: ['MIS'] },
        daily_profit_cap: { percent: ip.daily_profit_cap_pct, amount: (ip.daily_profit_cap_pct/100)*balance },
        consistency_rule: { maxDayProfitPercent: ip.consistency_rule_pct },
        risk_per_trade_idea: { percent: ip.risk_per_idea_pct, amount: (ip.risk_per_idea_pct/100)*balance, sameDirectionWindowMinutes: ip.risk_per_idea_window_min },
        news_blackout: { windows: [], blockAll: false },
        inactivity_close: { days: ip.inactivity_close_days },
        _instant_weekend_allowed: ip.weekend_allowed,
        _instant_holiday_restriction: ip.holiday_restriction,
        _instant_profit_cap_cooldown_hours: ip.daily_profit_cap_cooldown_hours || 8,
        _instant_profile: ip,
      };
    }

    // Detect 2-Step account
    if (TwoStepRiskProfileService.isTwoStepAccount(account)) {
      const tp = await TwoStepRiskProfileService.getProfile();
      const phase = TwoStepRiskProfileService.getPhase(account);
      const balance = parseFloat(account?.balance) || 0;
      const px = phase === 'funded' ? 'f_' : phase === 'phase_2' ? 'p2_' : 'p1_';
      const dl = tp[px+'daily_loss_pct']; const dd = tp[px+'max_drawdown_pct'];
      const pt = tp[px+'profit_target_pct']; const md = tp[px+'min_trading_days'];
      const mp = tp[px+'max_open_positions']; const ps = tp[px+'max_position_size_pct'];
      const mr = tp[px+'max_risk_per_trade_pct']; const dc = tp[px+'daily_profit_cap_pct'];
      const lv = tp[px+'leverage_max'];
      return {
        daily_loss_limit: { percent: dl, amount: (dl/100)*balance },
        max_drawdown: { percent: dd, amount: (dd/100)*balance, type: 'static' },
        profit_target: pt > 0 ? { percent: pt, amount: (pt/100)*balance } : null,
        max_positions: { count: mp },
        leverage_limit: { maxMultiplier: lv },
        max_position_size: { percent: ps, amount: (ps/100)*balance },
        max_risk_per_trade: { percent: mr, amount: (mr/100)*balance },
        daily_profit_cap: { percent: dc, amount: (dc/100)*balance },
        allowed_segments: { segments: Array.isArray(tp.allowed_segments)?tp.allowed_segments:['NSE','NFO','BFO','MCX','CDS'] },
        trading_hours: { start: tp.trading_hours_start, end: tp.trading_hours_end },
        no_overnight: tp.overnight_allowed ? null : { cutoffTime: tp.overnight_cutoff||'15:15', allowedProducts: ['MIS'] },
        consistency_rule: phase==='funded' ? { maxDayProfitPercent: tp.f_consistency_rule_pct } : null,
        news_blackout: { windows: [], blockAll: false },
        inactivity_close: { days: tp.inactivity_close_days },
        _twostep_weekend_allowed: tp.weekend_allowed,
        _twostep_holiday_restriction: tp.holiday_restriction,
        _twostep_profile: tp,
        _twostep_phase: phase,
      };
    }
    // Detect 1-Step account
    if (OneStepRiskProfileService.isOneStepAccount(account)) {
      const op = await OneStepRiskProfileService.getProfile();
      const phase = OneStepRiskProfileService.getPhase(account);
      const balance = parseFloat(account?.balance) || 0;
      const px = phase === 'funded' ? 'f_' : 'e_';
      const dl = op[px+'daily_loss_pct']; const dd = op[px+'max_drawdown_pct'];
      const pt = op[px+'profit_target_pct']; const mp = op[px+'max_open_positions'];
      const ps = op[px+'max_position_size_pct']; const mr = op[px+'max_risk_per_trade_pct'];
      const dc = op[px+'daily_profit_cap_pct']; const lv = op[px+'leverage_max'];
      return {
        daily_loss_limit: { percent: dl, amount: (dl/100)*balance },
        max_drawdown: { percent: dd, amount: (dd/100)*balance, type: 'static' },
        profit_target: pt > 0 ? { percent: pt, amount: (pt/100)*balance } : null,
        max_positions: { count: mp },
        leverage_limit: { maxMultiplier: lv },
        max_position_size: { percent: ps, amount: (ps/100)*balance },
        max_risk_per_trade: { percent: mr, amount: (mr/100)*balance },
        daily_profit_cap: { percent: dc, amount: (dc/100)*balance },
        allowed_segments: { segments: Array.isArray(op.allowed_segments)?op.allowed_segments:['NSE','NFO','BFO','MCX','CDS'] },
        trading_hours: { start: op.trading_hours_start, end: op.trading_hours_end },
        no_overnight: op.overnight_allowed ? null : { cutoffTime: '15:15', allowedProducts: ['MIS'] },
        consistency_rule: phase==='funded' ? { maxDayProfitPercent: op.f_consistency_rule_pct } : null,
        news_blackout: { windows: [], blockAll: false },
        inactivity_close: { days: op.inactivity_close_days },
        _onestep_weekend_allowed: op.weekend_allowed,
        _onestep_holiday_restriction: op.holiday_restriction,
        _onestep_profile: op,
        _onestep_phase: phase,
      };
    }

    // Non-profiled accounts: return per-account risk_rules from DB
    return riskRulesRepo.getRulesMap(accountId);
  }

  /**
   * Pre-trade validation.
   * Returns { allowed: true } or { allowed: false, reason: "..." }
   */
  static async validateOrder(accountId, orderParams, quoteProvider = null) {
    let account = null;
    try {
      account = await accountRepo.findById(accountId);
    } catch (e) {
      console.warn(`[RiskEngine] accountRepo.findById failed: ${e.message} — using fallback`);
    }

    if (!account) {
      // Fallback: allow trading with default constraints rather than blocking
      account = { id: accountId, balance: 1000000, status: 'active', leverage_max: 10, broker_provider: 'dhan' };
    }

    // ── Close/exit orders bypass ALL trading rules (including account lock) ──
    // A trader must always be able to close an existing position regardless of
    // risk-rule violations, drawdown locks, or daily-loss locks.  Blocking exits
    // increases risk — it prevents de-risking an open position.
    if (orderParams.isCloseOrder) {
      return { allowed: true };
    }

    if (account.status !== 'active') {
      return { allowed: false, reason: `Account is ${account.status}. Trading disabled.` };
    }

    // Load authoritative rules map.
    // For Instant accounts: built from instant_risk_profile table (admin-editable).
    // For all other types: loaded from per-account risk_rules DB rows.
    const rules = await this._getRulesMap(accountId, account);

    // ── Weekend / holiday checks for Instant accounts ────────────────────────
    // The instant_risk_profile controls whether weekends and holidays block trading.
    // For all other account types, the hardcoded HolidayService checks apply.
    const isInstant = InstantRiskProfileService.isInstantAccount(account);

    // ── Weekend / holiday checks for 2-Step accounts ─────────────────────────
    const isTwoStep = TwoStepRiskProfileService.isTwoStepAccount(account);
    const isOneStep = OneStepRiskProfileService.isOneStepAccount(account);
    if (isOneStep) {
      if (!rules._onestep_weekend_allowed) {
        const day = new Date().getDay();
        if (day === 0 || day === 6) return { allowed: false, reason: 'Market closed (weekend). 1-Step does not allow weekend trading.' };
      }
      if (rules._onestep_holiday_restriction) {
        const { isClosed, holidayName } = HolidayService.checkMarketClosed();
        if (isClosed && holidayName) return { allowed: false, reason: 'Market closed (holiday: ' + holidayName + ')' };
      }
    }
    if (isTwoStep) {
      if (!rules._twostep_weekend_allowed) {
        const day = new Date().getDay();
        if (day === 0 || day === 6) {
          return { allowed: false, reason: `Market is closed (${day===0?'Sunday':'Saturday'}). 2-Step does not allow weekend trading.` };
        }
      }
      if (rules._twostep_holiday_restriction) {
        const { isClosed, holidayName } = HolidayService.checkMarketClosed();
        if (isClosed && holidayName) {
          return { allowed: false, reason: `Market is closed today (holiday: ${holidayName})` };
        }
      }
    }
    if (isInstant) {
      // Weekend check (Instant-profile-controlled)
      if (!rules._instant_weekend_allowed) {
        const day = new Date().getDay();
        if (day === 0 || day === 6) {
          return { allowed: false, reason: `Market is closed (${day === 0 ? 'Sunday' : 'Saturday'}). Instant Funding does not allow weekend trading.` };
        }
      }
      // Holiday check (Instant-profile-controlled)
      if (rules._instant_holiday_restriction) {
        const { isClosed, holidayName } = HolidayService.checkMarketClosed();
        if (isClosed && holidayName) {
          return { allowed: false, reason: `Market is closed today (holiday: ${holidayName})` };
        }
      }
    }

    // Check each rule (new positions only)
    const checks = [
      // For non-Instant accounts the hardcoded holiday/weekend checks still run:
      ...(!isInstant ? [
        () => this.checkMarketHoliday(),
        () => this.checkWeekend(),
      ] : []),
      () => this.checkAllowedSegments(rules, orderParams),
      () => this.checkTradingHoursIST(rules),
      () => this.checkNoOvernight(rules, orderParams),
      () => this.checkNewsBlackout(rules),
      () => this.checkDailyProfitCap(rules, accountId),
      () => this.checkMaxPositions(rules, accountId),
      () => this.checkMaxPositionSize(rules, account, orderParams),
      () => this.checkMaxLotSize(rules, orderParams),
      () => this.checkFuturesLotMultiple(orderParams),
      () => this.checkFuturesTickSize(orderParams),
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
   * Returns { status: 'ok' | 'locked' | 'breached' | 'target_reached' | 'feed_stale', reason?: string }
   *
   * SAFETY: When the market data feed is stale, or when any open position
   * lacks a valid quote, unrealized P&L is EXCLUDED from daily-loss and
   * drawdown calculations. This prevents a missing/zero LTP from triggering
   * a false account lock or permanent breach.
   * Only realized P&L is used for risk decisions when feed data is suspect.
   */
  static async postTradeCheck(accountId, quoteProvider = null) {
    const account = await accountRepo.findById(accountId);

    if (!account || account.status !== 'active') {
      return { status: 'ok' };
    }

    // Load authoritative rules map (Instant = from instant_risk_profile, others = risk_rules)
    const rules = await this._getRulesMap(accountId, account);

    // ── Feed staleness check ────────────────────────────────────────────────
    // Import marketDataEngine lazily to avoid circular dependencies.
    // If the feed is stale, skip ALL unrealized P&L based risk checks.
    let feedIsStale = false;
    try {
      const { marketDataEngine: mde } = await import('./marketDataEngine.js').catch(() => ({}));
      if (mde && typeof mde.isFeedStale === 'function') {
        feedIsStale = mde.isFeedStale();
      }
    } catch { /* non-critical — proceed conservatively */ }

    // Calculate today's realized P&L (always safe — from trade records, not live prices)
    const todayRealizedPnl = await this.calculateTodayRealizedPnl(accountId);

    // Calculate unrealized P&L — only when feed is healthy and quotes are valid
    let unrealizedPnl = 0;
    let unrealizedDataQuality = 'ok';

    if (feedIsStale) {
      unrealizedDataQuality = 'feed_stale';
      console.warn(`[RiskEngine] postTradeCheck: feed is STALE — excluding unrealized P&L from risk checks for account ${accountId}`);
    } else if (quoteProvider) {
      // Use the safe quoteProvider that returns null for missing/invalid quotes.
      // getTotalUnrealizedPnl will fall back to avg_price (break-even) for null quotes,
      // so no fake loss is generated. This is intentional — see position.repository.js.
      unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider);
    }

    // When feed is stale, use only realized P&L for daily-loss and drawdown.
    // This is the safe state: we know real losses, we don't know unrealized.
    const totalDailyPnl = todayRealizedPnl + (feedIsStale ? 0 : unrealizedPnl);

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
      const currentEquity = account.balance + (feedIsStale ? 0 : unrealizedPnl);
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
        const totalPnl = account.balance - challenge.initial_balance + (feedIsStale ? 0 : unrealizedPnl);
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
    if (!feedIsStale) {
      const currentEquityForPeak = account.balance + unrealizedPnl;
      if (currentEquityForPeak > (account.peak_balance || 0)) {
        try {
          const challenge = await this.getChallengeForAccount(accountId);
          if (challenge) {
            const { supabase } = await import('../db/client.js');
            await supabase.from('challenge_accounts').update({ peak_balance: currentEquityForPeak }).eq('id', challenge.id);
          }
        } catch (e) { /* non-critical */ }
      }
    }

    if (feedIsStale) {
      return { status: 'feed_stale', reason: 'Market data feed is stale — unrealized P&L excluded from risk checks' };
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
    const result = await MarginService.validateMargin(accountId, orderParams, balance, quoteProvider, account);
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

  /**
   * IST-aware trading hours check.
   * Always evaluates against IST (UTC+5:30) regardless of server timezone.
   * Used by the new Instant routing — Instant accounts get IST enforcement.
   */
  static async checkTradingHoursIST(rules) {
    if (!rules.trading_hours) return { allowed: true };

    const { start, end } = rules.trading_hours;
    // Convert current time to IST explicitly
    const istMs   = Date.now() + (5 * 60 + 30) * 60 * 1000;
    const istDate = new Date(istMs);
    const currentTime = `${String(istDate.getUTCHours()).padStart(2,'0')}:${String(istDate.getUTCMinutes()).padStart(2,'0')}`;

    if (currentTime < start || currentTime > end) {
      return { allowed: false, reason: `Trading not allowed outside ${start}–${end} IST. Current IST: ${currentTime}` };
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

  /**
   * Futures lot-multiple validation — server-side enforcement.
   *
   * For derivative instruments (NFO, BFO, MCX, CDS), the order quantity MUST
   * be an exact multiple of the contract's current lot size.  This check is
   * performed server-side so it cannot be bypassed by crafting a direct API
   * request that skips the OrderPanel client-side guard.
   *
   * Lot size is resolved dynamically through the single source of truth:
   *   FuturesContractService (scrip master) → DhanHistoricalService.getLotSize()
   *
   * Resolution order:
   *   1. FuturesContractService.resolveUnderlying() (scrip-master derived, preferred)
   *   2. DhanHistoricalService.getLotSize() (scrip-master extracted lot-size map)
   *   3. Skip check — if scrip master not loaded yet on cold start, do not block
   *
   * @param {object} orderParams
   * @returns {{ allowed: boolean, reason?: string }}
   */
  static async checkFuturesLotMultiple(orderParams) {
    const DERIVATIVE_SEGMENTS = new Set(['NFO', 'BFO', 'MCX', 'CDS']);
    if (!DERIVATIVE_SEGMENTS.has(orderParams.segment)) return { allowed: true };

    const qty = orderParams.qty;
    if (!qty || qty <= 0) return { allowed: true }; // qty range already checked by Zod

    // Derive the canonical underlying name from the symbol field.
    // Examples: 'NIFTY FUT' → 'NIFTY', 'NIFTY-Aug2026-FUT' → 'NIFTY',
    //           'BANKNIFTY FUT' → 'BANKNIFTY', 'RELIANCE FUT' → 'RELIANCE'
    const rawSymbol = (orderParams.symbol || '').toUpperCase().trim();
    const underlying = rawSymbol
      .replace(/\s+FUT(URES?)?$/i, '')   // strip " FUT" / " FUTURES" suffix
      .replace(/-[A-Z0-9]+-FUT$/i, '')   // strip Dhan tradingSymbol suffix
      .trim();

    // Map segment to Dhan exchange string for FuturesContractService
    const SEGMENT_TO_EXCHANGE = {
      'NFO': 'NSE_FNO',
      'BFO': 'BSE_FNO',
      'MCX': 'MCX_COMM',
      'CDS': 'NSE_CURRENCY',
    };
    const exchange = SEGMENT_TO_EXCHANGE[orderParams.segment];
    if (!exchange) return { allowed: true };

    let lotSize = 0;

    try {
      // Lazy import — avoids circular dependency at module-load time.
      const { futuresContractService } = await import('./futuresContractService.js');

      // Primary: FuturesContractService (most accurate — uses scrip master)
      if (futuresContractService._dhanHistorical) {
        const contract = await futuresContractService.resolveUnderlying(underlying, exchange);
        if (contract?.lotSize && contract.lotSize > 1) {
          lotSize = contract.lotSize;
        }
      }

      // Secondary: DhanHistoricalService.getLotSize() directly
      if (!lotSize) {
        const hist = futuresContractService._dhanHistorical;
        if (hist && typeof hist.getLotSize === 'function') {
          const scraped = hist.getLotSize(underlying);
          if (scraped && scraped > 1) lotSize = scraped;
        }
      }
    } catch (_) {
      // Scrip master not loaded yet (cold start). Skip check rather than
      // blocking valid orders during the ~5-second startup window.
      return { allowed: true };
    }

    // If we could not resolve a lot size, skip — do not block trading
    if (!lotSize || lotSize <= 1) return { allowed: true };

    if (qty % lotSize !== 0) {
      const nearestLot = Math.round(qty / lotSize);
      const validQtyBelow = nearestLot > 0 ? nearestLot * lotSize : lotSize;
      const validQtyAbove = (nearestLot + 1) * lotSize;
      return {
        allowed: false,
        reason: `Quantity ${qty} is not a valid lot multiple for ${underlying} (lot size = ${lotSize}). ` +
                `Valid quantities: ${validQtyBelow} (${Math.floor(validQtyBelow/lotSize)} lot${Math.floor(validQtyBelow/lotSize)!==1?'s':''}) ` +
                `or ${validQtyAbove} (${Math.ceil(validQtyAbove/lotSize)} lot${Math.ceil(validQtyAbove/lotSize)!==1?'s':''}).`,
        ruleType: 'lot_multiple',
      };
    }

    return { allowed: true };
  }

  /**
   * Futures tick-size price alignment — server-side enforcement.
   *
   * For LIMIT, SL, and SL-M orders on derivative instruments, the price or
   * trigger price MUST align to the contract's tick size.
   * MARKET orders are excluded — they have no price to validate.
   *
   * Tick size is resolved dynamically through:
   *   DhanHistoricalService.getTickSize() (scrip-master SEM_TICK_SIZE column)
   *
   * A price is considered tick-aligned when:
   *   Math.round(price / tickSize) * tickSize ≈ price  (within float tolerance)
   *
   * @param {object} orderParams
   * @returns {{ allowed: boolean, reason?: string }}
   */
  static async checkFuturesTickSize(orderParams) {
    const DERIVATIVE_SEGMENTS = new Set(['NFO', 'BFO', 'MCX', 'CDS']);
    if (!DERIVATIVE_SEGMENTS.has(orderParams.segment)) return { allowed: true };

    // MARKET orders have no price to validate
    if (orderParams.orderType === 'MARKET') return { allowed: true };

    // Collect prices that need tick-size validation
    const pricesToCheck = [];
    if ((orderParams.orderType === 'LIMIT' || orderParams.orderType === 'SL') &&
        orderParams.price && orderParams.price > 0) {
      pricesToCheck.push({ field: 'price', value: orderParams.price });
    }
    if ((orderParams.orderType === 'SL' || orderParams.orderType === 'SL-M') &&
        orderParams.triggerPrice && orderParams.triggerPrice > 0) {
      pricesToCheck.push({ field: 'triggerPrice', value: orderParams.triggerPrice });
    }
    if (pricesToCheck.length === 0) return { allowed: true };

    // Derive underlying from symbol
    const rawSymbol = (orderParams.symbol || '').toUpperCase().trim();
    const underlying = rawSymbol
      .replace(/\s+FUT(URES?)?$/i, '')
      .replace(/-[A-Z0-9]+-FUT$/i, '')
      .trim();

    let tickSize = 0;

    try {
      const { futuresContractService } = await import('./futuresContractService.js');
      const hist = futuresContractService._dhanHistorical;
      if (hist && typeof hist.getTickSize === 'function') {
        const scraped = hist.getTickSize(underlying);
        if (scraped && scraped > 0) tickSize = scraped;
      }
      // Also try via resolveUnderlying for cases where getTickSize fallback is 0.05
      if (!tickSize || tickSize === 0.05) {
        if (futuresContractService._dhanHistorical) {
          const SEGMENT_TO_EXCHANGE = {
            'NFO': 'NSE_FNO', 'BFO': 'BSE_FNO',
            'MCX': 'MCX_COMM', 'CDS': 'NSE_CURRENCY',
          };
          const contract = await futuresContractService.resolveUnderlying(
            underlying, SEGMENT_TO_EXCHANGE[orderParams.segment] || 'NSE_FNO'
          );
          if (contract?.tickSize && contract.tickSize > 0) tickSize = contract.tickSize;
        }
      }
    } catch (_) {
      return { allowed: true }; // Scrip master cold — skip
    }

    if (!tickSize || tickSize <= 0) return { allowed: true };

    // Validate each price
    for (const { field, value } of pricesToCheck) {
      // Float-safe modulo check: round(price/tick) * tick === price within 1e-6
      const remainder = Math.abs(value % tickSize);
      const tolerance = tickSize * 1e-6;
      const isAligned = remainder < tolerance || Math.abs(remainder - tickSize) < tolerance;
      if (!isAligned) {
        const nearestLower = Math.floor(value / tickSize) * tickSize;
        const nearestUpper = nearestLower + tickSize;
        return {
          allowed: false,
          reason: `${field === 'price' ? 'Limit price' : 'Trigger price'} ₹${value} is not aligned to ` +
                  `${underlying} tick size ₹${tickSize}. ` +
                  `Nearest valid prices: ₹${nearestLower.toFixed(tickSize < 1 ? 4 : 2)} or ₹${nearestUpper.toFixed(tickSize < 1 ? 4 : 2)}.`,
          ruleType: 'tick_size',
        };
      }
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

    // Only add unrealized P&L when the quoteProvider returns valid data.
    // getTotalUnrealizedPnl now falls back to avg_price (break-even = P&L 0)
    // for any position whose LTP is null/zero/stale — so the worst case is
    // that unrealizedPnl = 0 (no contribution), never a fake large loss.
    const unrealizedPnl = quoteProvider
      ? await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider)
      : 0;

    const totalDailyPnl = todayRealizedPnl + unrealizedPnl;

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

    // Instant + 2-Step: compute real exposure from open positions (not used_margin)
    if (InstantRiskProfileService.isInstantAccount(account) || TwoStepRiskProfileService.isTwoStepAccount(account) || OneStepRiskProfileService.isOneStepAccount(account)) {
      const orderLtp = orderParams.price || 0;
      if (orderLtp > 0) {
        let existingExposure = 0;
        try {
          const openPositions = await positionRepo.findOpenByAccountId(account.id || 'unknown');
          for (const pos of openPositions) {
            if (!pos.qty || pos.qty === 0) continue;
            existingExposure += Math.abs(pos.qty) * (pos.avg_price || 0);
          }
        } catch {}
        const newOrderNotional = orderParams.qty * orderLtp;
        const totalExposure = existingExposure + newOrderNotional;
        const impliedLeverage = totalExposure / balance;
        if (impliedLeverage > maxMultiplier) {
          return { allowed: false, reason: `Leverage limit exceeded: ${impliedLeverage.toFixed(1)}x > max ${maxMultiplier}x` };
        }
      }
      return { allowed: true };
    }

    // Non-Instant/2-Step: original logic
    const totalUsedMargin = parseFloat(account.used_margin || 0);
    const newOrderMargin = orderParams.qty * (orderParams.price || 0) * 0.1;
    const totalExposure = totalUsedMargin + newOrderMargin;
    const currentLeverage = totalExposure / balance;
    if (currentLeverage > maxMultiplier) {
      return { allowed: false, reason: `Leverage limit exceeded: ${currentLeverage.toFixed(1)}x > max ${maxMultiplier}x` };
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

    // ── Cooldown check: if daily_profit_cap_until is set and still active, block ──
    if (account.daily_profit_cap_until) {
      const capUntil = new Date(account.daily_profit_cap_until).getTime();
      if (Date.now() < capUntil) {
        const remainingMins = Math.ceil((capUntil - Date.now()) / 60000);
        return { allowed: false, reason: `Daily profit cap cooldown active — trading resumes in ${remainingMins} minute(s).` };
      }
      // Cooldown expired — clear it
      try { await accountRepo.update(accountId, { daily_profit_cap_until: null }); } catch {}
    }

    const balance = parseFloat(account.balance) || 0;
    const capAmount = cap.amount || (cap.percent / 100) * balance;

    const todayRealizedPnl = await this.calculateTodayRealizedPnl(accountId);

    if (todayRealizedPnl >= capAmount) {
      // Determine cooldown from Instant profile flag (8 hours) or none for others
      const cooldownHours = rules._instant_profit_cap_cooldown_hours || 0;

      if (cooldownHours > 0) {
        const capUntil = new Date(Date.now() + cooldownHours * 3600 * 1000).toISOString();
        try { await accountRepo.update(accountId, { daily_profit_cap_until: capUntil }); } catch {}
        eventBus.publish('risk.alert', {
          type: 'kill_switch', ruleType: 'daily_profit_cap',
          message: `Daily profit cap reached. Trading paused for ${cooldownHours}h.`,
          currentValue: todayRealizedPnl, limitValue: capAmount, percentUsed: 100,
        }, { accountId });
        return { allowed: false, reason: `Daily profit cap hit (${cap.percent}%). Trading paused for ${cooldownHours} hours.` };
      }

      // Non-Instant: original kill-switch (no timed cooldown)
      eventBus.publish('risk.alert', {
        type: 'kill_switch', ruleType: 'daily_profit_cap',
        message: `Daily profit cap reached (₹${todayRealizedPnl.toFixed(0)} ≥ ₹${capAmount.toFixed(0)}). No new trades until tomorrow.`,
        currentValue: todayRealizedPnl, limitValue: capAmount, percentUsed: 100,
      }, { accountId });
      return { allowed: false, reason: `Daily profit cap hit (${cap.percent}%). Kill-switch active — no new trades until next session. Current profit: ₹${todayRealizedPnl.toFixed(0)}` };
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

