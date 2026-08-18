/**
 * FLASH RISK ENGINE
 *
 * Handles ALL risk validation for Flash Funding accounts.
 * Replaces the generic Risk Engine for Flash accounts only.
 *
 * Other challenge types (Instant, 1-Step, 2-Step) continue using
 * the existing riskEngine.js — this file does NOT touch them.
 *
 * Rules enforced:
 *   1.  24-hour expiry from first position (persisted in DB)
 *   2.  2% per-position loss limit
 *   3.  4% max drawdown from peak balance
 *   4.  50 max open positions
 *   5.  1:50 leverage limit
 *   6.  Allowed segments (NSE, NFO, BFO, MCX, CDS)
 *   7.  Trading hours 09:15–15:30
 *   8.  Overnight ALLOWED
 *   9.  Weekend ALLOWED
 *  10.  Market holidays NOT restricted (24h account)
 *  11.  No profit target
 *  12.  Consistency rule: 15% (best trade ≤ 15% of total profit)
 *  13.  Margin check (existing MarginService)
 *
 * All values come from FlashRiskProfileService → flash_risk_profile table.
 * Admin can change values without a code deployment.
 */

import { FlashRiskProfileService } from './flashRiskProfileService.js';
import { PositionRepository }      from '../repositories/position.repository.js';
import { TradeRepository }         from '../repositories/trade.repository.js';
import { AccountRepository }       from '../repositories/account.repository.js';
import { AuditRepository }         from '../repositories/audit.repository.js';
import { MarginService }           from './marginService.js';
import { eventBus }                from '../events/index.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';

const positionRepo = new PositionRepository();
const tradeRepo    = new TradeRepository();
const accountRepo  = new AccountRepository();
const auditRepo    = new AuditRepository();

export class FlashRiskEngine {
  // ─────────────────────────────────────────────────────────────────────────
  // PRE-TRADE VALIDATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Validate an order for a Flash Funding account.
   * Returns { allowed: true } or { allowed: false, reason: string }
   *
   * @param {string}   accountId
   * @param {object}   orderParams
   * @param {function} quoteProvider   (token) => ltp | null
   * @param {object}   account         trading_accounts row (with challenge joined)
   */
  static async validateOrder(accountId, orderParams, quoteProvider, account) {
    // ── Account status ───────────────────────────────────────────────────
    if (!account || account.status !== 'active') {
      return { allowed: false, reason: `Account is ${account?.status || 'unknown'}. Trading disabled.` };
    }

    // ── Close orders always bypass trading rules ──────────────────────────
    if (orderParams.isCloseOrder) {
      return { allowed: true };
    }

    const profile = await FlashRiskProfileService.getProfile();

    // ── 1. 24-hour expiry check ───────────────────────────────────────────
    // Expiry is only enforced AFTER the timer has started.
    const challengeId = account.challenge_id || account.challenge?.id;
    if (challengeId) {
      const { expired, expiresAt } = await FlashRiskProfileService.checkExpiry(challengeId, profile);
      if (expired) {
        return {
          allowed: false,
          reason: `Flash account expired. 24-hour trading window ended at ${expiresAt}.`,
          ruleType: 'flash_expiry',
        };
      }
    }

    // ── 2. Allowed segments ───────────────────────────────────────────────
    const allowedSegs = Array.isArray(profile.allowed_segments)
      ? profile.allowed_segments
      : ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'];

    if (!allowedSegs.includes(orderParams.segment)) {
      return {
        allowed: false,
        reason: `Segment ${orderParams.segment} not allowed for Flash accounts. Permitted: ${allowedSegs.join(', ')}`,
        ruleType: 'allowed_segments',
      };
    }

    // ── 3. Trading hours (IST — UTC+5:30) ────────────────────────────────
    // Always evaluate against IST regardless of server timezone.
    // Railway/Docker default is UTC — using new Date() directly would give
    // the wrong time. We convert explicitly: IST = UTC + 5h30m.
    const nowUtcMs  = Date.now();
    const istMs     = nowUtcMs + (5 * 60 + 30) * 60 * 1000; // +5:30 in ms
    const istDate   = new Date(istMs);
    const istHH     = String(istDate.getUTCHours()).padStart(2, '0');
    const istMM     = String(istDate.getUTCMinutes()).padStart(2, '0');
    const currentTime = `${istHH}:${istMM}`;
    const start       = profile.trading_hours_start || '09:15';
    const end         = profile.trading_hours_end   || '15:30';

    if (currentTime < start || currentTime > end) {
      return {
        allowed: false,
        reason: `Flash trading not allowed outside ${start}–${end} IST. Current IST: ${currentTime}`,
        ruleType: 'trading_hours',
      };
    }

    // ── 4. Overnight — ALLOWED for Flash ─────────────────────────────────
    // profile.overnight_allowed = true → no overnight check needed

    // ── 5. Weekend — ALLOWED for Flash ───────────────────────────────────
    // profile.weekend_allowed = true → no weekend check needed

    // ── 6. Market holidays — NOT restricted for Flash ────────────────────
    // profile.holiday_restriction = false → skip holiday check

    // ── 7. Max open positions ─────────────────────────────────────────────
    const maxPos      = profile.max_open_positions || 50;
    const currentPos  = await positionRepo.countOpenPositions(accountId);
    if (currentPos >= maxPos) {
      return {
        allowed: false,
        reason: `Max open positions reached (${currentPos}/${maxPos})`,
        ruleType: 'max_open_positions',
      };
    }

    // ── 8. Leverage limit (1:50) ──────────────────────────────────────────
    // Policy: total notional exposure (existing open positions + new order)
    // must not exceed 50× the account balance.
    //
    // We compute existing exposure directly from open positions rather than
    // trusting account.used_margin, which is not reliably maintained for
    // paper-mode accounts and can remain at 0 even when positions are open.
    //
    // Existing exposure = Σ (|qty| × ltp) per open position.
    // If ltp is unavailable for a position, fall back to avg_price.
    // This is conservative: it always charges some exposure for open lots.
    const leverageMax = profile.leverage_max || 50;
    const balance     = parseFloat(account.balance) || 0;

    if (balance > 0) {
      const orderLtp = quoteProvider ? quoteProvider(orderParams.token) : (orderParams.price || 0);
      if (orderLtp && orderLtp > 0) {
        // Sum existing open-position notional
        let existingExposure = 0;
        const openForLeverage = await positionRepo.findOpenByAccountId(accountId);
        for (const pos of openForLeverage) {
          if (!pos.qty || pos.qty === 0) continue;
          const posLtp = (quoteProvider ? quoteProvider(pos.token) : null) || pos.avg_price || 0;
          existingExposure += Math.abs(pos.qty) * posLtp;
        }

        const newOrderNotional = orderParams.qty * orderLtp;
        const totalExposure    = existingExposure + newOrderNotional;
        const impliedLeverage  = totalExposure / balance;

        if (impliedLeverage > leverageMax) {
          return {
            allowed: false,
            reason: `Leverage limit exceeded: ${impliedLeverage.toFixed(1)}x > max ${leverageMax}x (existing exposure ₹${Math.round(existingExposure).toLocaleString('en-IN')} + new order ₹${Math.round(newOrderNotional).toLocaleString('en-IN')} on balance ₹${Math.round(balance).toLocaleString('en-IN')})`,
            ruleType: 'leverage_limit',
          };
        }
      }
    }

    // ── 9. Per-position loss pre-check ────────────────────────────────────
    // Check whether any EXISTING open position is already at or beyond 2%.
    // (The actual per-position check enforced per-tick lives in postTradeCheck.)
    // Here we reject new opening orders when an existing position is already
    // at the per-position loss limit — prevents compounding a losing position.
    const perPosPct = profile.per_position_loss_pct || 2.0;
    if (balance > 0 && quoteProvider) {
      const openPositions = await positionRepo.findOpenByAccountId(accountId);
      for (const pos of openPositions) {
        if (pos.qty === 0) continue;
        const ltp = quoteProvider(pos.token);
        if (!ltp || !Number.isFinite(ltp) || ltp <= 0) continue;
        const pnl = pos.side === 'LONG'
          ? (ltp - pos.avg_price) * pos.qty
          : (pos.avg_price - ltp) * pos.qty;
        const lossAmt = -pnl; // positive means loss
        if (lossAmt >= (perPosPct / 100) * balance) {
          return {
            allowed: false,
            reason: `Position ${pos.symbol} has reached the per-position loss limit (${perPosPct}% of balance). Close this position before opening new ones.`,
            ruleType: 'per_position_loss',
          };
        }
      }
    }

    // ── 10. Margin availability ───────────────────────────────────────────
    const marginResult = await MarginService.validateMargin(accountId, orderParams, balance, quoteProvider, account);
    if (!marginResult.allowed) return { ...marginResult, ruleType: 'margin' };

    // ── 11. Consistency rule (pre-trade) ──────────────────────────────────
    const consistencyPct = profile.consistency_rule_pct || 15.0;
    const consistencyResult = await this._checkConsistency(accountId, account, consistencyPct);
    if (!consistencyResult.allowed) return consistencyResult;

    return { allowed: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST-TRADE CHECK
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Post-trade risk check for Flash accounts.
   * Called after every fill.
   *
   * @param {string}   accountId
   * @param {function} quoteProvider
   * @param {object}   account        trading_accounts row (with challenge joined)
   */
  static async postTradeCheck(accountId, quoteProvider, account) {
    if (!account || account.status !== 'active') {
      return { status: 'ok' };
    }

    const profile     = await FlashRiskProfileService.getProfile();
    const balance     = parseFloat(account.balance) || 0;
    const peakBalance = parseFloat(account.peak_balance) || balance;

    // ── Feed staleness guard ──────────────────────────────────────────────
    let feedIsStale = false;
    try {
      const { marketDataEngine: mde } = await import('./marketDataEngine.js').catch(() => ({}));
      if (mde && typeof mde.isFeedStale === 'function') {
        feedIsStale = mde.isFeedStale();
      }
    } catch { /* non-critical */ }

    // ── Start 24h timer on first position ────────────────────────────────
    const challengeId = account.challenge_id || account.challenge?.id;
    if (challengeId) {
      await FlashRiskProfileService.recordFirstPosition(challengeId);
    }

    // ── 24-hour expiry (post-trade) ───────────────────────────────────────
    if (challengeId) {
      const { expired, expiresAt } = await FlashRiskProfileService.checkExpiry(challengeId, profile);
      if (expired) {
        await this._expireAccount(accountId, account, expiresAt);
        return { status: 'expired', reason: `Flash 24-hour window expired at ${expiresAt}` };
      }
    }

    // ── Per-position loss check ───────────────────────────────────────────
    // Each open position must not lose more than per_position_loss_pct % of balance.
    if (!feedIsStale && quoteProvider && balance > 0) {
      const perPosPct    = profile.per_position_loss_pct || 2.0;
      const perPosLimit  = (perPosPct / 100) * balance;
      const openPositions = await positionRepo.findOpenByAccountId(accountId);

      for (const pos of openPositions) {
        if (pos.qty === 0) continue;
        const ltp = quoteProvider(pos.token);
        if (!ltp || !Number.isFinite(ltp) || ltp <= 0) continue;

        const pnl     = pos.side === 'LONG'
          ? (ltp - pos.avg_price) * pos.qty
          : (pos.avg_price - ltp) * pos.qty;
        const lossAmt = -pnl; // positive = loss

        if (lossAmt >= perPosLimit) {
          // Lock the account — recoverable (not a permanent breach)
          const reason = `Per-position loss limit breached on ${pos.symbol}: ₹${lossAmt.toFixed(0)} >= ₹${perPosLimit.toFixed(0)} (${perPosPct}% of balance)`;
          await accountRepo.lockAccount(accountId, reason);
          await auditRepo.log({
            accountId,
            userId: account.trader_id,
            eventType: 'account_locked',
            eventData: { reason: 'per_position_loss', symbol: pos.symbol, lossAmt, limit: perPosLimit },
          });
          eventBus.publish('risk.alert', {
            type: 'breach', ruleType: 'per_position_loss',
            message: reason, currentValue: lossAmt, limitValue: perPosLimit, percentUsed: 100,
          }, { accountId });
          eventBus.publish('account.locked', { accountId, reason }, { accountId });
          LifecycleCallbackClient.accountLocked({
            accountId, traderId: account.trader_id, reason, ruleType: 'per_position_loss',
          }).catch(() => {});
          return { status: 'locked', reason };
        }
      }
    }

    // ── Max drawdown check ────────────────────────────────────────────────
    const unrealizedPnl = feedIsStale || !quoteProvider
      ? 0
      : await positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider);

    const currentEquity    = balance + unrealizedPnl;
    const drawdown         = peakBalance - currentEquity;
    const maxDDPct         = profile.max_drawdown_pct || 4.0;
    const maxDDAmount      = (maxDDPct / 100) * peakBalance;

    if (drawdown >= maxDDAmount) {
      const reason = `Max drawdown breached: ₹${drawdown.toFixed(0)} >= ₹${maxDDAmount.toFixed(0)} (${maxDDPct}% of peak)`;
      await accountRepo.breachAccount(accountId, reason);
      await auditRepo.log({
        accountId,
        userId: account.trader_id,
        eventType: 'account_breached',
        eventData: { reason: 'max_drawdown', drawdown, limit: maxDDAmount, peakBalance },
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
        challengeId: account.challenge_id || accountId,
        reason: 'max_drawdown', drawdown, limit: maxDDAmount,
      }).catch(() => {});
      return { status: 'breached', reason };
    }

    // ── Update peak balance ───────────────────────────────────────────────
    if (!feedIsStale && currentEquity > peakBalance) {
      try {
        if (supabase && challengeId) {
          const { supabase: db } = await import('../db/client.js');
          await db.from('challenge_accounts')
            .update({ peak_balance: currentEquity })
            .eq('id', challengeId);
        }
      } catch { /* non-critical */ }
    }

    return feedIsStale
      ? { status: 'feed_stale', reason: 'Feed stale — unrealized P&L excluded from Flash risk checks' }
      : { status: 'ok' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCHEDULED / CRON — 24h EXPIRY SWEEP
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Run every minute (via scheduleDailyChecks setInterval) to sweep for
   * Flash accounts whose 24-hour window has elapsed.
   *
   * Only processes accounts where:
   *   challenge_accounts.plan = 'flash'
   *   challenge_accounts.first_position_at IS NOT NULL
   *   challenge_accounts.status = 'active'
   *   trading_accounts.status = 'active'
   */
  static async sweepExpiredFlashAccounts() {
    const { supabase: db } = await import('../db/client.js');
    if (!db) return;

    const profile = await FlashRiskProfileService.getProfile();
    const durationMs = profile.duration_hours * 60 * 60 * 1000;
    const cutoff     = new Date(Date.now() - durationMs).toISOString();

    // Find Flash challenges that started trading and whose window has closed
    const { data: expired, error } = await db
      .from('challenge_accounts')
      .select('id, trader_id, plan, first_position_at')
      .eq('plan', 'flash')
      .eq('status', 'active')
      .not('first_position_at', 'is', null)
      .lt('first_position_at', cutoff);

    if (error || !expired || expired.length === 0) return;

    for (const ch of expired) {
      try {
        // Find the linked trading account
        const { data: tas } = await db
          .from('trading_accounts')
          .select('id, status')
          .eq('challenge_id', ch.id)
          .eq('status', 'active');

        for (const ta of (tas || [])) {
          const expiresAt = new Date(
            new Date(ch.first_position_at).getTime() + durationMs
          ).toISOString();
          await this._expireAccount(ta.id, { trader_id: ch.trader_id, challenge_id: ch.id }, expiresAt);
          console.log(`[FlashRiskEngine] Swept expired Flash account ${ta.id}`);
        }
      } catch (err) {
        console.error(`[FlashRiskEngine] Sweep error for challenge ${ch.id}:`, err.message);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  static async _expireAccount(accountId, account, expiresAt) {
    const reason = `Flash account 24-hour window expired at ${expiresAt}`;
    await accountRepo.update(accountId, {
      status: 'expired',
      locked_reason: reason,
      locked_at: new Date().toISOString(),
    });
    if (account?.challenge_id) {
      const { supabase: db } = await import('../db/client.js');
      if (db) {
        await db.from('challenge_accounts')
          .update({
            status: 'expired',
            failed_at: new Date().toISOString(),
            fail_reason: reason,
          })
          .eq('id', account.challenge_id);
      }
    }
    await auditRepo.log({
      accountId,
      userId: account?.trader_id,
      eventType: 'challenge_expired',
      eventData: { reason: 'flash_24h_expiry', expiresAt },
    });
    eventBus.publish('risk.alert', {
      type: 'breach', ruleType: 'flash_expiry',
      message: reason, currentValue: Date.now(), limitValue: new Date(expiresAt).getTime(),
    }, { accountId });
    eventBus.publish('account.locked', { accountId, reason }, { accountId });
  }

  /**
   * Consistency rule: no single trade/day should represent more than
   * consistency_rule_pct % of total profit.
   */
  static async _checkConsistency(accountId, account, consistencyPct) {
    if (!consistencyPct || consistencyPct <= 0) return { allowed: true };

    const challengeId = account.challenge_id || account.challenge?.id;
    if (!challengeId) return { allowed: true };

    // Get total realized P&L since first trade
    const { supabase: db } = await import('../db/client.js');
    if (!db) return { allowed: true };

    const { data: ch } = await db
      .from('challenge_accounts')
      .select('initial_balance')
      .eq('id', challengeId)
      .single();
    if (!ch) return { allowed: true };

    const balance     = parseFloat(account.balance) || 0;
    const totalProfit = balance - parseFloat(ch.initial_balance);
    if (totalProfit <= 0) return { allowed: true }; // Not profitable — no constraint

    // Get today's realized P&L
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: trades } = await db
      .from('executions')
      .select('side, qty, price, symbol')
      .eq('trading_account_id', accountId)
      .gte('executed_at', today.toISOString())
      .order('executed_at', { ascending: true });

    if (!trades || trades.length === 0) return { allowed: true };

    // FIFO daily realized P&L
    const { RiskEngine } = await import('./riskEngine.js');
    const todayPnl = await RiskEngine.calculateTodayRealizedPnl(accountId);
    if (todayPnl <= 0) return { allowed: true };

    const contribution = (todayPnl / totalProfit) * 100;
    if (contribution > consistencyPct) {
      return {
        allowed: false,
        reason: `Flash consistency rule: today's profit (${contribution.toFixed(1)}%) exceeds ${consistencyPct}% of total profit. Reduce position size.`,
        ruleType: 'consistency_rule',
      };
    }
    return { allowed: true };
  }
}
