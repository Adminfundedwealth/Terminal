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
   * Challenge plan configuration.
   * Defines rules for each phase of the challenge.
   */
  static getPlanConfig(plan) {
    const configs = {
      '10K': { balance: 1000000, phase1Target: 8, phase2Target: 5, maxDD: 10, dailyLoss: 5, minDays: 5, durationDays: 30 },
      '25K': { balance: 2500000, phase1Target: 8, phase2Target: 5, maxDD: 10, dailyLoss: 5, minDays: 5, durationDays: 45 },
      '50K': { balance: 5000000, phase1Target: 8, phase2Target: 5, maxDD: 10, dailyLoss: 5, minDays: 5, durationDays: 45 },
      '1L':  { balance: 10000000, phase1Target: 8, phase2Target: 5, maxDD: 10, dailyLoss: 5, minDays: 5, durationDays: 60 },
    };
    return configs[plan] || configs['10K'];
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

    // Determine current phase and next phase
    let nextPhaseType = null;
    let nextPhaseLabel = null;
    let nextTargetPercent = null;

    if (challenge.type === 'evaluation' && !challenge.phase) {
      // Phase 1 complete → Phase 2
      nextPhaseType = 'evaluation';
      nextPhaseLabel = 'phase_2';
      nextTargetPercent = planConfig.phase2Target;
    } else if (challenge.type === 'evaluation' && challenge.phase === 'phase_2') {
      // Phase 2 complete → Funded
      nextPhaseType = 'funded';
      nextPhaseLabel = 'funded';
      nextTargetPercent = null; // Funded accounts have no target (just trade)
    } else if (challenge.type === 'evaluation' && challenge.phase === 'phase_1') {
      // Explicit phase_1 → Phase 2
      nextPhaseType = 'evaluation';
      nextPhaseLabel = 'phase_2';
      nextTargetPercent = planConfig.phase2Target;
    } else {
      // Already funded or unknown state
      return null;
    }

    // Create new challenge
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + planConfig.durationDays);

    const newChallenge = await challengeRepo.insert({
      trader_id: account.trader_id,
      type: nextPhaseType,
      plan: challenge.plan,
      phase: nextPhaseLabel,
      initial_balance: planConfig.balance,
      status: 'active',
      min_trading_days: planConfig.minDays,
      started_at: new Date().toISOString(),
      expires_at: nextPhaseType === 'funded' ? null : expiresAt.toISOString(),
      previous_challenge_id: challenge.id,
    });

    // Generate account code
    const accountCode = `FW-${nextPhaseLabel === 'funded' ? 'F' : 'P2'}-${Date.now().toString(36).toUpperCase()}`;

    // Create new trading account
    const newAccount = await accountRepo.insert({
      trader_id: account.trader_id,
      account_code: accountCode,
      challenge_id: newChallenge.id,
      broker_provider: account.broker_provider,
      broker_client_id: account.broker_client_id,
      balance: planConfig.balance,
      peak_balance: planConfig.balance,
      payout_eligible: nextPhaseType === 'funded',
      status: 'active',
    });

    // Seed risk rules for new account
    await this.seedRulesForAccount(newAccount.id, challenge.plan, nextPhaseLabel, planConfig, nextTargetPercent);

    // Audit
    await auditRepo.log({
      accountId: newAccount.id,
      userId: account.trader_id,
      eventType: 'challenge_promoted',
      eventData: {
        fromChallengeId: challenge.id,
        toChallengeId: newChallenge.id,
        fromPhase: challenge.phase || 'phase_1',
        toPhase: nextPhaseLabel,
        plan: challenge.plan,
      },
    });

    // Emit event
    eventBus.publish('challenge.updated', {
      challengeId: newChallenge.id,
      status: 'promoted',
      previousChallengeId: challenge.id,
      phase: nextPhaseLabel,
    }, { accountId: newAccount.id });

    return {
      challenge: newChallenge,
      account: newAccount,
      phase: nextPhaseLabel,
    };
  }

  /**
   * Seed risk rules for a new phase account.
   */
  static async seedRulesForAccount(accountId, plan, phase, config, targetPercent) {
    const rules = [
      { trading_account_id: accountId, rule_type: 'daily_loss_limit', value: { percent: config.dailyLoss }, is_active: true },
      { trading_account_id: accountId, rule_type: 'max_drawdown', value: { percent: config.maxDD }, is_active: true },
      { trading_account_id: accountId, rule_type: 'max_positions', value: { count: 10 }, is_active: true },
      { trading_account_id: accountId, rule_type: 'allowed_segments', value: { segments: ['NSE', 'NFO', 'BFO'] }, is_active: true },
      { trading_account_id: accountId, rule_type: 'trading_hours', value: { start: '09:15', end: '15:30' }, is_active: true },
      { trading_account_id: accountId, rule_type: 'no_overnight', value: { cutoffTime: '15:15', allowedProducts: ['MIS'] }, is_active: true },
      { trading_account_id: accountId, rule_type: 'min_trading_days', value: { count: config.minDays }, is_active: true },
    ];

    // Profit target only for evaluation phases, not funded
    if (targetPercent) {
      rules.push({ trading_account_id: accountId, rule_type: 'profit_target', value: { percent: targetPercent }, is_active: true });
    }

    for (const rule of rules) {
      await riskRulesRepo.insert(rule);
    }
  }
}
