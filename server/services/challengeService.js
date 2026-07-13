/**
 * CHALLENGE SERVICE
 * 
 * Manages challenge lifecycle (evaluation → funded).
 * Auto-transitions based on rules:
 *   active → passed (profit target hit + min days)
 *   active → failed (max drawdown breached)
 *   active → breached (risk violation)
 *   active → expired (time limit exceeded)
 *   locked → active (next trading day / admin)
 * 
 * All state persisted in Supabase.
 */

import { ChallengeRepository } from '../repositories/challenge.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { RiskRulesRepository } from '../repositories/risk-rules.repository.js';
import { MetricsRepository } from '../repositories/metrics.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { eventBus } from '../events/index.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';
import {
  profileToRuleRows,
  get1StepFundedRuleProfile,
  get2StepPhase2RuleProfile,
  get2StepFundedRuleProfile,
} from '../config/challengeRuleProfiles.js';

const challengeRepo = new ChallengeRepository();
const accountRepo = new AccountRepository();
const riskRulesRepo = new RiskRulesRepository();
const metricsRepo = new MetricsRepository();
const auditRepo = new AuditRepository();

export class ChallengeService {
  /**
   * Get challenge progress for an account.
   */
  static async getProgress(accountId) {
    try {
      const account = await accountRepo.getWithChallenge(accountId);
      if (!account || !account.challenge) return null;

    const challenge = account.challenge;
    const rules = await riskRulesRepo.getRulesMap(accountId);
    const tradingDays = await metricsRepo.getTradingDaysCount(accountId);

    const pnl = account.balance - challenge.initial_balance;
    const pnlPercent = (pnl / challenge.initial_balance) * 100;

    // Calculate drawdown from peak
    const peakBalance = account.peak_balance || account.balance;
    const drawdown = peakBalance - account.balance;
    const drawdownPercent = peakBalance > 0 ? (drawdown / peakBalance) * 100 : 0;

    // Progress toward targets
    const profitTarget = rules.profit_target;
    const maxDrawdown = rules.max_drawdown;
    const minDays = rules.min_trading_days || challenge.min_trading_days;

    const targetAmount = profitTarget
      ? (profitTarget.amount || (profitTarget.percent / 100) * challenge.initial_balance)
      : null;
    const maxDrawdownAmount = maxDrawdown
      ? (maxDrawdown.amount || (maxDrawdown.percent / 100) * peakBalance)
      : null;

    return {
      challengeId: challenge.id,
      type: challenge.type,
      plan: challenge.plan,
      status: challenge.status,
      initialBalance: Number(challenge.initial_balance),
      currentBalance: Number(account.balance),
      peakBalance: Number(peakBalance),
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      drawdown: Math.round(drawdown * 100) / 100,
      drawdownPercent: Math.round(drawdownPercent * 100) / 100,
      tradingDays,
      targets: {
        profitTarget: targetAmount ? Math.round(targetAmount) : null,
        profitProgress: targetAmount ? Math.round((pnl / targetAmount) * 100) : null,
        maxDrawdown: maxDrawdownAmount ? Math.round(maxDrawdownAmount) : null,
        drawdownUsed: maxDrawdownAmount ? Math.round((drawdown / maxDrawdownAmount) * 100) : null,
        minTradingDays: minDays?.count || null,
        tradingDaysProgress: minDays?.count ? Math.round((tradingDays / minDays.count) * 100) : null,
      },
      startedAt: challenge.started_at,
      expiresAt: challenge.expires_at,
      accountStatus: account.status,
    };
    } catch (err) {
      console.error('[ChallengeService] getProgress failed:', err.message);
      return null;
    }
  }

  /**
   * Check if challenge should auto-transition.
   * Call after each trade or at EOD.
   */
  static async checkTransitions(accountId) {
    const account = await accountRepo.getWithChallenge(accountId);
    if (!account || !account.challenge) return { transitioned: false };

    const challenge = account.challenge;
    if (challenge.status !== 'active') return { transitioned: false };

    const rules = await riskRulesRepo.getRulesMap(accountId);

    // Check expiry
    if (challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
      await challengeRepo.markExpired(challenge.id);
      await accountRepo.update(accountId, { status: 'expired' });
      await auditRepo.log({
        accountId,
        userId: account.trader_id,
        eventType: 'challenge_expired',
        eventData: { challengeId: challenge.id, expiresAt: challenge.expires_at },
      });
      return { transitioned: true, newStatus: 'expired', reason: 'Challenge time limit exceeded' };
    }

    // Check if passed (profit target + min days)
    const profitTarget = rules.profit_target;
    const minDays = rules.min_trading_days || challenge.min_trading_days;

    if (profitTarget) {
      const targetAmount = profitTarget.amount || (profitTarget.percent / 100) * challenge.initial_balance;
      const pnl = account.balance - challenge.initial_balance;

      if (pnl >= targetAmount) {
        // Check minimum trading days requirement
        if (minDays?.count) {
          const tradingDays = await metricsRepo.getTradingDaysCount(accountId);
          if (tradingDays < minDays.count) {
            // Target hit but need more trading days
            return { transitioned: false, note: `Target reached but need ${minDays.count - tradingDays} more trading days` };
          }
        }

        await challengeRepo.markPassed(challenge.id);
        await accountRepo.completeAccount(accountId);
        await auditRepo.log({
          accountId,
          userId: account.trader_id,
          eventType: 'challenge_passed',
          eventData: { challengeId: challenge.id, pnl, targetAmount },
        });

        // Auto-promote to next phase
        const promotion = await this.promoteToNextPhase(accountId);
        const promotionInfo = promotion
          ? { promoted: true, newPhase: promotion.phase, newAccountId: promotion.account.id }
          : { promoted: false };

        // Notify Main Site + Admin: challenge passed
        LifecycleCallbackClient.challengePassed({
          accountId, traderId: account.trader_id,
          challengeId: challenge.id,
          pnl, targetAmount, tradingDays: await metricsRepo.getTradingDaysCount(accountId),
        }).catch(() => {});

        // If promoted, notify about promotion
        if (promotion) {
          LifecycleCallbackClient.accountPromoted({
            accountId, traderId: account.trader_id,
            fromPhase: challenge.phase || 'phase_1',
            toPhase: promotion.phase,
            newChallengeId: promotion.challenge.id,
            newAccountId: promotion.account.id,
          }).catch(() => {});

          // If promoted to funded, send funded notification
          if (promotion.phase === 'funded') {
            LifecycleCallbackClient.fundedCreated({
              accountId: promotion.account.id, traderId: account.trader_id,
              challengeId: promotion.challenge.id, plan: challenge.plan,
              balance: this.getPlanConfig(challenge.plan).balance,
            }).catch(() => {});
          }
        }

        return { transitioned: true, newStatus: 'passed', reason: `Profit target reached (₹${pnl.toFixed(0)})`, ...promotionInfo };
      }
    }

    // Check max drawdown breach
    if (rules.max_drawdown) {
      const peakBalance = account.peak_balance || account.balance;
      const drawdown = peakBalance - account.balance;
      const maxDrawdownAmount = rules.max_drawdown.amount || (rules.max_drawdown.percent / 100) * peakBalance;

      if (drawdown >= maxDrawdownAmount) {
        await challengeRepo.markFailed(challenge.id, `Max drawdown breached: ₹${drawdown.toFixed(0)}`);
        await accountRepo.breachAccount(accountId, `Max drawdown breached: ₹${drawdown.toFixed(0)}`);
        await auditRepo.log({
          accountId,
          userId: account.trader_id,
          eventType: 'challenge_failed',
          eventData: { challengeId: challenge.id, reason: 'max_drawdown', drawdown, limit: maxDrawdownAmount },
        });
        return { transitioned: true, newStatus: 'failed', reason: `Max drawdown breached (₹${drawdown.toFixed(0)})` };
      }
    }

    return { transitioned: false };
  }

  /**
   * Unlock account for next trading day.
   * Called by daily cron if account was locked (not breached).
   */
  static async unlockIfEligible(accountId) {
    const account = await accountRepo.findById(accountId);
    if (!account || account.status !== 'locked') return false;

    // Only unlock if locked for daily loss (not for other reasons)
    if (account.locked_reason && account.locked_reason.includes('Daily loss')) {
      await accountRepo.update(accountId, { status: 'active', locked_reason: null });
      await auditRepo.log({
        accountId,
        userId: account.trader_id,
        eventType: 'account_unlocked',
        eventData: { previousReason: account.locked_reason },
      });

      // Emit account.unlocked event for real-time frontend notification
      eventBus.publish('account.unlocked', {
        accountId,
        previousReason: account.locked_reason,
      }, { accountId });

      return true;
    }

    return false;
  }

  /**
   * Daily check — run at start of each trading day.
   * Unlocks daily-loss-locked accounts, checks expiry.
   */
  static async dailyCheck(accountId) {
    const results = [];

    // Unlock daily-loss locks
    const unlocked = await this.unlockIfEligible(accountId);
    if (unlocked) {
      results.push({ action: 'unlocked', accountId });
    }

    // Check challenge transitions (expiry, etc.)
    const transition = await this.checkTransitions(accountId);
    if (transition.transitioned) {
      results.push({ action: 'transitioned', accountId, ...transition });
    }

    return results;
  }

  // ============================================================
  // PHASE PROGRESSION: Phase 1 → Phase 2 → Funded
  // ============================================================

  /**
   * Challenge plan configuration keyed by current plan identifiers.
   *
   * FIX: Old keys (10K/25K/50K/1L) replaced with current plan-key system
   * (flash/instant/1step/2step). Balance is read from challenge.initial_balance
   * at promotion time — not hardcoded here.
   *
   * evalMaxDD / fundedMaxDD: max drawdown % for each phase.
   *   2-Step evaluation: 8%  |  2-Step funded: 6%  (home.tsx confirmed)
   *   1-Step evaluation: 6%  |  1-Step funded: 6%  (same limit both phases)
   */
  static getPlanConfig(plan) {
    const configs = {
      // Current plan keys
      '2step': { phase1Target: 8, phase2Target: 5, evalMaxDD: 8, fundedMaxDD: 6, dailyLoss: 3, minDays: 5, fundedMinDays: 3, durationDays: 365 },
      '1step': { phase1Target: 10, phase2Target: null, evalMaxDD: 6, fundedMaxDD: 6, dailyLoss: 3, minDays: 5, fundedMinDays: 3, durationDays: 365 },
      // Legacy keys — backward compatibility
      '10K': { phase1Target: 8, phase2Target: 5, evalMaxDD: 8, fundedMaxDD: 6, dailyLoss: 3, minDays: 5, fundedMinDays: 3, durationDays: 365 },
      '25K': { phase1Target: 8, phase2Target: 5, evalMaxDD: 8, fundedMaxDD: 6, dailyLoss: 3, minDays: 5, fundedMinDays: 3, durationDays: 365 },
      '50K': { phase1Target: 8, phase2Target: 5, evalMaxDD: 8, fundedMaxDD: 6, dailyLoss: 3, minDays: 5, fundedMinDays: 3, durationDays: 365 },
      '1L':  { phase1Target: 8, phase2Target: 5, evalMaxDD: 8, fundedMaxDD: 6, dailyLoss: 3, minDays: 5, fundedMinDays: 3, durationDays: 365 },
    };
    const key = String(plan || '').toLowerCase().replace(/[-\s]/g, '');
    return configs[key] || configs['2step'];
  }

  /**
   * Promote a passed challenge to the next phase.
   * 
   * Phase 1 (evaluation) passed → Create Phase 2 challenge + account
   * Phase 2 (evaluation) passed → Create Funded challenge + account
   * 
   * Returns the new challenge/account or null if no promotion applicable.
   */
  static async promoteToNextPhase(accountId) {
    const account = await accountRepo.getWithChallenge(accountId);
    if (!account || !account.challenge) return null;

    const challenge = account.challenge;

    // Only promote passed challenges
    if (challenge.status !== 'passed') return null;

    const planConfig = this.getPlanConfig(challenge.plan);
    const planKey = String(challenge.plan || '').toLowerCase().replace(/[-\s]/g, '');
    const is1Step = planKey === '1step';

    // ── FIX: match actual stored type values from lib/products ──────────────
    // DB stores: "2step_evaluation_phase1", "1step_evaluation", "evaluation_phase1",
    //            "evaluation", "funded"
    // Old code checked `challenge.type === 'evaluation'` which never matched.
    const typeStr = String(challenge.type || '').toLowerCase();
    const phaseStr = String(challenge.phase || '').toLowerCase();

    const isPhase1 =
      typeStr.includes('phase1') ||
      typeStr === 'evaluation' ||
      typeStr === 'evaluation_phase1' ||
      phaseStr === 'phase_1' ||
      (!phaseStr && typeStr.includes('evaluation'));

    const isPhase2 =
      typeStr.includes('phase2') ||
      phaseStr === 'phase_2';

    const isFundedAlready =
      typeStr === 'funded' ||
      phaseStr === 'funded';

    if (isFundedAlready) return null; // Already funded

    let nextPhaseType = null;
    let nextPhaseLabel = null;
    let nextTargetPercent = null;
    let nextMaxDD = null;

    if (isPhase1) {
      if (is1Step) {
        // ── 1-Step: Phase 1 passes → go straight to funded (no Phase 2) ──
        nextPhaseType = 'funded';
        nextPhaseLabel = 'funded';
        nextTargetPercent = null;
        nextMaxDD = planConfig.fundedMaxDD;
      } else {
        // ── 2-Step: Phase 1 passes → go to Phase 2 ──
        nextPhaseType = 'evaluation_phase2';
        nextPhaseLabel = 'phase_2';
        nextTargetPercent = planConfig.phase2Target;
        nextMaxDD = planConfig.evalMaxDD;
      }
    } else if (isPhase2) {
      // ── 2-Step: Phase 2 passes → go to Funded ──
      nextPhaseType = 'funded';
      nextPhaseLabel = 'funded';
      nextTargetPercent = null;
      nextMaxDD = planConfig.fundedMaxDD;
    } else {
      console.warn(`[ChallengeService] promoteToNextPhase: unrecognised phase for account ${accountId}`, { type: challenge.type, phase: challenge.phase, plan: challenge.plan });
      return null;
    }

    // Use actual balance from the challenge row (not hardcoded)
    const balance = Number(challenge.initial_balance) || 0;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + planConfig.durationDays);

    const newChallenge = await challengeRepo.insert({
      trader_id: account.trader_id,
      type: nextPhaseType,
      plan: challenge.plan,
      phase: nextPhaseLabel,
      initial_balance: balance,
      current_balance: balance,
      peak_balance: balance,
      profit_target_pct: nextTargetPercent || 0,
      daily_loss_limit_pct: planConfig.dailyLoss,
      max_drawdown_pct: nextMaxDD,
      min_trading_days: nextPhaseLabel === 'funded' ? planConfig.fundedMinDays : planConfig.minDays,
      status: 'active',
      started_at: new Date().toISOString(),
      expires_at: nextPhaseType === 'funded' ? null : expiresAt.toISOString(),
      previous_challenge_id: challenge.id,
    });

    const accountCode = `FW-${nextPhaseLabel === 'funded' ? 'F' : 'P2'}-${Date.now().toString(36).toUpperCase()}`;

    const newAccount = await accountRepo.insert({
      trader_id: account.trader_id,
      account_code: accountCode,
      challenge_id: newChallenge.id,
      broker_provider: account.broker_provider,
      broker_client_id: account.broker_client_id || accountCode,
      balance,
      peak_balance: balance,
      payout_eligible: nextPhaseType === 'funded',
      status: 'active',
    });

    // Seed risk rules using the corrected plan config
    const seedConfig = {
      dailyLoss: planConfig.dailyLoss,
      maxDD: nextMaxDD,
      minDays: nextPhaseLabel === 'funded' ? planConfig.fundedMinDays : planConfig.minDays,
      balance,
    };
    await this.seedRulesForAccount(newAccount.id, challenge.plan, nextPhaseLabel, seedConfig, nextTargetPercent);

    await auditRepo.log({
      accountId: newAccount.id,
      userId: account.trader_id,
      eventType: 'challenge_promoted',
      eventData: {
        fromChallengeId: challenge.id,
        toChallengeId: newChallenge.id,
        fromPhase: challenge.phase || challenge.type,
        toPhase: nextPhaseLabel,
        plan: challenge.plan,
        is1Step,
      },
    });

    eventBus.publish('challenge.updated', {
      challengeId: newChallenge.id,
      status: 'promoted',
      previousChallengeId: challenge.id,
      phase: nextPhaseLabel,
    }, { accountId: newAccount.id });

    return { challenge: newChallenge, account: newAccount, phase: nextPhaseLabel };
  }

  /**
   * Seed risk rules for a promoted phase account.
   * Uses canonical profiles from challengeRuleProfiles.js when available.
   * Falls back to config-based seeding for unknown/legacy plan types.
   */
  static async seedRulesForAccount(accountId, plan, phase, config, targetPercent) {
    const balance = config.balance || 0;
    const planKey = String(plan || '').toLowerCase().replace(/[-\s]/g, '');

    // ── Use canonical profiles for known plan+phase combos ──────────────────
    let canonicalProfile = null;
    if (planKey === '1step' && phase === 'funded') {
      canonicalProfile = get1StepFundedRuleProfile(balance);
    } else if (planKey === '2step' && phase === 'phase_2') {
      canonicalProfile = get2StepPhase2RuleProfile(balance);
    } else if (planKey === '2step' && phase === 'funded') {
      canonicalProfile = get2StepFundedRuleProfile(balance);
    }

    if (canonicalProfile) {
      const rows = profileToRuleRows(accountId, canonicalProfile);
      for (const rule of rows) {
        await riskRulesRepo.insert(rule);
      }
      console.log(`[ChallengeService] ✓ Seeded ${rows.length} canonical rules for ${planKey}/${phase}`);
      return;
    }

    // ── Fallback: config-based seeding for legacy/unknown types ─────────────
    const maxDD = config.maxDD;
    const dailyLoss = config.dailyLoss;
    const minDays = config.minDays;

    const rules = [
      { trading_account_id: accountId, rule_type: 'daily_loss_limit',  value: { percent: dailyLoss, amount: (dailyLoss / 100) * balance }, is_active: true },
      { trading_account_id: accountId, rule_type: 'max_drawdown',       value: { percent: maxDD, amount: (maxDD / 100) * balance, type: 'static' }, is_active: true },
      { trading_account_id: accountId, rule_type: 'max_positions',      value: { count: 20 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'max_position_size',  value: { percent: 70, amount: balance * 0.70 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'daily_profit_cap',   value: { percent: 4, amount: balance * 0.04 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'max_risk_per_trade', value: { percent: 1.5, amount: balance * 0.015 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'allowed_segments',   value: { segments: ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'] }, is_active: true },
      { trading_account_id: accountId, rule_type: 'trading_hours',      value: { start: '09:15', end: '15:15' }, is_active: true },
      { trading_account_id: accountId, rule_type: 'no_overnight',       value: { cutoffTime: '15:15', allowedProducts: ['MIS'], blockWeekends: true }, is_active: true },
      { trading_account_id: accountId, rule_type: 'min_trading_days',   value: { count: minDays }, is_active: true },
      { trading_account_id: accountId, rule_type: 'news_blackout',      value: { windows: [], blockAll: false }, is_active: true },
      { trading_account_id: accountId, rule_type: 'profit_split',       value: { percent: 80 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'inactivity_close',   value: { days: 60 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'scaling',            value: { triggerPct: 10, rewardPct: 25, capPct: 100, cycleDays: 90 }, is_active: true },
    ];

    if (phase === 'funded') {
      rules.push({ trading_account_id: accountId, rule_type: 'consistency_rule', value: { maxDayProfitPercent: 40 }, is_active: true });
      rules.push({ trading_account_id: accountId, rule_type: 'payout_threshold', value: { percent: 5, amount: balance * 0.05 }, is_active: true });
    }

    if (targetPercent) {
      rules.push({ trading_account_id: accountId, rule_type: 'profit_target', value: { percent: targetPercent, amount: (targetPercent / 100) * balance }, is_active: true });
    }

    for (const rule of rules) {
      await riskRulesRepo.insert(rule);
    }
  }
}
