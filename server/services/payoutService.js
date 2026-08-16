/**
 * PAYOUT SERVICE
 * 
 * Handles payout eligibility, requests, approval, and rejection for funded accounts.
 * 
 * Ownership: Terminal
 * Table: payouts
 * 
 * Flow:
 *   1. Trader requests payout → checkEligibility → create pending payout row
 *   2. Admin reviews → approve or reject
 *   3. On approval: update status, notify Main Site + Admin, email trader
 *   4. On rejection: update status + reason, email trader
 * 
 * Eligibility Rules:
 *   - Account must be 'funded' type
 *   - Account status must be 'active'
 *   - Net profit must be positive
 *   - Minimum trading days met
 *   - No active risk violations / breaches
 *   - No duplicate pending/processing payout requests
 */

import { supabase } from '../db/client.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';
import { EmailService } from './emailService.js';
import { eventBus } from '../events/index.js';
import { FlashRiskProfileService } from './flashRiskProfileService.js';
import { InstantRiskProfileService } from './instantRiskProfileService.js';
import { TwoStepRiskProfileService } from './twoStepRiskProfileService.js';

// Profit split configuration per plan — used for non-Flash accounts only.
// Flash accounts read profit_split_pct from FlashRiskProfileService.
const SPLIT_CONFIGS = {
  '10K': { traderSplit: 0.80, firmSplit: 0.20 },
  '25K': { traderSplit: 0.80, firmSplit: 0.20 },
  '50K': { traderSplit: 0.80, firmSplit: 0.20 },
  '1L': { traderSplit: 0.80, firmSplit: 0.20 },
};

const MIN_PAYOUT_TRADING_DAYS = 5;

export class PayoutService {

  /**
   * Check if an account is eligible for payout.
   * Does NOT create a payout request — purely informational.
   */
  static async checkEligibility(accountId) {
    if (!supabase) {
      return { eligible: false, reason: 'Database not configured' };
    }

    // Get trading account with challenge
    const { data: account, error: accErr } = await supabase
      .from('trading_accounts')
      .select('id, trader_id, challenge_id, balance, status, broker_provider')
      .eq('id', accountId)
      .single();

    if (accErr || !account) {
      return { eligible: false, reason: 'Account not found', checks: {} };
    }

    // Get challenge account
    const { data: challenge, error: chErr } = await supabase
      .from('challenge_accounts')
      .select('id, type, plan, initial_balance, current_balance, peak_balance, status, min_trading_days')
      .eq('id', account.challenge_id)
      .single();

    if (chErr || !challenge) {
      return { eligible: false, reason: 'Challenge account not found', checks: {} };
    }

    const checks = {
      isFunded: false,
      accountActive: false,
      netProfitPositive: false,
      minTradingDaysMet: false,
      noActiveViolations: false,
      noPendingPayout: false,
    };

    // Check 1: Must be eligible account type.
    // Instant and Flash are funded-from-day-1 — they use plan='instant'/'flash' and are
    // created as 'evaluation_phase1' in the type column. Accept them by plan, not type.
    const normalizedPlan = (challenge.plan || '').toLowerCase().replace(/[-_\s]/g, '');
    const isInstantPlan  = normalizedPlan === 'instant';
    const isFlashPlan    = normalizedPlan === 'flash';
    checks.isFunded = isInstantPlan || isFlashPlan || challenge.type === 'funded';
    if (!checks.isFunded) {
      return { eligible: false, reason: 'Only funded accounts can request payouts', checks };
    }

    // Check 2: Account must be active
    checks.accountActive = account.status === 'active';
    if (!checks.accountActive) {
      return { eligible: false, reason: `Account is ${account.status} — must be active`, checks };
    }

    // Check 3: Net profit must be positive
    const netProfit = parseFloat(account.balance) - parseFloat(challenge.initial_balance);
    checks.netProfitPositive = netProfit > 0;
    if (!checks.netProfitPositive) {
      return { eligible: false, reason: 'No net profit to withdraw', checks, financials: { netProfit } };
    }

    // Check 4: Minimum trading days
    const { count: tradingDays } = await supabase
      .from('account_metrics')
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .gt('total_trades', 0);

    const minDays = challenge.min_trading_days || MIN_PAYOUT_TRADING_DAYS;
    checks.minTradingDaysMet = (tradingDays || 0) >= minDays;
    if (!checks.minTradingDaysMet) {
      return {
        eligible: false,
        reason: `Need ${minDays} trading days, have ${tradingDays || 0}`,
        checks,
        financials: { netProfit, tradingDays: tradingDays || 0, required: minDays },
      };
    }

    // Check 5: No active risk violations
    const { count: activeViolations } = await supabase
      .from('risk_events')
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .in('severity', ['critical'])
      .eq('acknowledged', false);

    checks.noActiveViolations = (activeViolations || 0) === 0;
    if (!checks.noActiveViolations) {
      return { eligible: false, reason: 'Active risk violations must be resolved first', checks };
    }

    // Check 6: No duplicate pending/processing payout
    const { data: existingPayout } = await supabase
      .from('payouts')
      .select('id, status')
      .eq('account_id', accountId)
      .in('status', ['pending', 'processing'])
      .limit(1)
      .single();

    checks.noPendingPayout = !existingPayout;
    if (!checks.noPendingPayout) {
      return { eligible: false, reason: `Already have a ${existingPayout.status} payout request`, checks };
    }

    // Calculate payout amounts
    // Flash accounts: read profit_split and payout_threshold from Flash Risk Profile
    // Instant accounts: read from Instant Risk Profile (progressive split + threshold)
    const normalized = (challenge.plan || '').toLowerCase().replace(/[-_\s]/g, '');
    const isFlash   = normalized === 'flash';
    const isInstant = normalized === 'instant';

    let flashProfile   = null;
    let instantProfile = null;
    let minPayoutPct   = 0;

    if (isFlash) {
      try {
        flashProfile = await FlashRiskProfileService.getProfile();
        minPayoutPct = flashProfile.payout_threshold_pct || 3;
      } catch { /* non-critical */ }
    }

    if (isInstant) {
      try {
        instantProfile = await InstantRiskProfileService.getProfile();
        minPayoutPct   = instantProfile.payout_threshold_pct || 5;
      } catch { /* non-critical */ }
    }

    // Payout threshold: net profit must be >= threshold % of initial balance
    if (isTwoStep) {
      try { const tp = await TwoStepRiskProfileService.getProfile(); minPayoutPct = tp.f_payout_threshold_pct || 5; } catch {}
    }

    if ((isFlash || isInstant || isTwoStep) && minPayoutPct > 0) {
      const minPayoutAmount = (minPayoutPct / 100) * parseFloat(challenge.initial_balance);
      if (netProfit < minPayoutAmount) {
        const planLabel = isFlash ? 'Flash' : 'Instant';
        return {
          eligible: false,
          reason: `${planLabel} payout requires minimum ${minPayoutPct}% profit (₹${Math.round(minPayoutAmount).toLocaleString('en-IN')}). Current: ₹${Math.round(netProfit).toLocaleString('en-IN')}`,
          checks,
          financials: { netProfit, minPayoutAmount, plan: challenge.plan },
        };
      }
    }

    const splitConfig = this.getSplitConfig(challenge.plan, flashProfile, instantProfile, challenge.started_at);
    const payoutAmount = Math.round(netProfit * splitConfig.traderSplit * 100) / 100;
    const firmAmount = Math.round(netProfit * splitConfig.firmSplit * 100) / 100;

    return {
      eligible: true,
      reason: null,
      checks,
      financials: {
        netProfit: Math.round(netProfit * 100) / 100,
        payoutAmount,
        firmAmount,
        traderSplit: splitConfig.traderSplit,
        tradingDays: tradingDays || 0,
        plan: challenge.plan,
      },
    };
  }

  /**
   * Request a payout. Creates a pending payout row.
   * Validates eligibility first.
   */
  static async requestPayout(accountId, traderId) {
    // Re-check eligibility (prevents race conditions)
    const eligibility = await this.checkEligibility(accountId);

    if (!eligibility.eligible) {
      return { success: false, error: eligibility.reason, checks: eligibility.checks };
    }

    const { financials } = eligibility;

    // Get challenge ID
    const { data: account } = await supabase
      .from('trading_accounts')
      .select('challenge_id')
      .eq('id', accountId)
      .single();

    // Insert payout request
    const { data: payout, error } = await supabase
      .from('payouts')
      .insert({
        account_id: accountId,
        user_id: traderId,
        challenge_id: account.challenge_id,
        net_profit: financials.netProfit,
        payout_amount: financials.payoutAmount,
        firm_amount: financials.firmAmount,
        trader_split: financials.traderSplit,
        plan: financials.plan,
        trading_days: financials.tradingDays,
        status: 'pending',
        requested_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: `Failed to create payout request: ${error.message}` };
    }

    // Notify Admin of new payout request
    LifecycleCallbackClient.notifyAdmin('payout.requested', {
      accountId,
      traderId,
      data: {
        payoutId: payout.id,
        amount: financials.payoutAmount,
        netProfit: financials.netProfit,
        plan: financials.plan,
        tradingDays: financials.tradingDays,
        requestedAt: payout.requested_at,
      },
    }).catch(() => {});

    // Publish event
    eventBus.publish('challenge.updated', {
      challengeId: account.challenge_id,
      status: 'payout_requested',
      payoutId: payout.id,
      amount: financials.payoutAmount,
    }, { accountId });

    return {
      success: true,
      payout: {
        id: payout.id,
        status: payout.status,
        amount: financials.payoutAmount,
        netProfit: financials.netProfit,
        traderSplit: financials.traderSplit,
        requestedAt: payout.requested_at,
      },
    };
  }

  /**
   * Get payout history for an account.
   */
  static async getPayoutHistory(accountId) {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('payouts')
      .select('*')
      .eq('account_id', accountId)
      .order('requested_at', { ascending: false });

    if (error) return [];
    return data || [];
  }

  /**
   * Admin: Approve a payout request.
   * Updates status, notifies Main Site + Admin, emails trader.
   */
  static async approvePayout(payoutId, approvedBy) {
    if (!supabase) {
      return { success: false, error: 'Database not configured' };
    }

    // Get payout
    const { data: payout, error: fetchErr } = await supabase
      .from('payouts')
      .select('*')
      .eq('id', payoutId)
      .eq('status', 'pending')
      .single();

    if (fetchErr || !payout) {
      return { success: false, error: 'Payout not found or not in pending status' };
    }

    // Update status to approved
    const { error: updateErr } = await supabase
      .from('payouts')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', payoutId);

    if (updateErr) {
      return { success: false, error: `Failed to approve: ${updateErr.message}` };
    }

    
    // 2-Step: record first approved payout for 80% to 90% split upgrade
    // Only for 2-Step. Only sets first_payout_approved_at when NULL (idempotent).
    if (TwoStepRiskProfileService.isTwoStepAccount({ challenge: { plan: payout.plan } })) {
      TwoStepRiskProfileService.recordFirstPayout(payout.account_id).catch((e) => {
        console.error('[PayoutService] recordFirstPayout failed:', e.message);
      });
    }
// Get trader info for email
    const { data: trader } = await supabase
      .from('terminal_traders')
      .select('email, display_name')
      .eq('id', payout.user_id)
      .single();

    // Notify Main Site
    LifecycleCallbackClient.notifyWebsite('payout.approved', {
      accountId: payout.account_id,
      traderId: payout.user_id,
      data: {
        payoutId: payout.id,
        amount: payout.payout_amount,
        plan: payout.plan,
        approvedBy,
        approvedAt: new Date().toISOString(),
      },
    }).catch(() => {});

    // Notify Admin
    LifecycleCallbackClient.notifyAdmin('payout.approved', {
      accountId: payout.account_id,
      traderId: payout.user_id,
      data: {
        payoutId: payout.id,
        amount: payout.payout_amount,
        approvedBy,
        approvedAt: new Date().toISOString(),
      },
    }).catch(() => {});

    // Email trader
    if (trader?.email) {
      EmailService._send({
        to: trader.email,
        subject: `Payout Approved — ₹${Math.round(payout.payout_amount).toLocaleString('en-IN')}`,
        text: `Hi ${trader.display_name},\n\nYour payout request of ₹${Math.round(payout.payout_amount).toLocaleString('en-IN')} has been approved.\n\nPlan: ${payout.plan}\nNet Profit: ₹${Math.round(payout.net_profit).toLocaleString('en-IN')}\nYour Split: ${(payout.trader_split * 100).toFixed(0)}%\n\nThe amount will be processed within 3-5 business days.\n\nFundedWealth Team`,
        html: null,
      }).catch(() => {});
    }

    return { success: true, payoutId, status: 'approved' };
  }

  /**
   * Admin: Reject a payout request.
   */
  static async rejectPayout(payoutId, reason, rejectedBy) {
    if (!supabase) {
      return { success: false, error: 'Database not configured' };
    }

    // Get payout
    const { data: payout, error: fetchErr } = await supabase
      .from('payouts')
      .select('*')
      .eq('id', payoutId)
      .in('status', ['pending', 'processing'])
      .single();

    if (fetchErr || !payout) {
      return { success: false, error: 'Payout not found or already completed/rejected' };
    }

    // Update status to rejected
    const { error: updateErr } = await supabase
      .from('payouts')
      .update({
        status: 'rejected',
        rejected_reason: reason,
        completed_at: new Date().toISOString(),
      })
      .eq('id', payoutId);

    if (updateErr) {
      return { success: false, error: `Failed to reject: ${updateErr.message}` };
    }

    // Get trader info for email
    const { data: trader } = await supabase
      .from('terminal_traders')
      .select('email, display_name')
      .eq('id', payout.user_id)
      .single();

    // Notify Admin
    LifecycleCallbackClient.notifyAdmin('payout.rejected', {
      accountId: payout.account_id,
      traderId: payout.user_id,
      data: {
        payoutId: payout.id,
        amount: payout.payout_amount,
        reason,
        rejectedBy,
        rejectedAt: new Date().toISOString(),
      },
    }).catch(() => {});

    // Email trader
    if (trader?.email) {
      EmailService._send({
        to: trader.email,
        subject: `Payout Request Update — Action Required`,
        text: `Hi ${trader.display_name},\n\nYour payout request of ₹${Math.round(payout.payout_amount).toLocaleString('en-IN')} could not be processed.\n\nReason: ${reason}\n\nPlease resolve the issue and submit a new request from your dashboard.\n\nFundedWealth Team`,
        html: null,
      }).catch(() => {});
    }

    return { success: true, payoutId, status: 'rejected', reason };
  }

  /**
   * Admin: Mark payout as completed (money transferred).
   */
  static async completePayout(payoutId) {
    if (!supabase) {
      return { success: false, error: 'Database not configured' };
    }

    const { error } = await supabase
      .from('payouts')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', payoutId)
      .eq('status', 'approved');

    if (error) {
      return { success: false, error: `Failed to complete: ${error.message}` };
    }

    // Get payout for notifications
    const { data: payout } = await supabase
      .from('payouts')
      .select('*')
      .eq('id', payoutId)
      .single();

    if (payout) {
      // Notify Main Site
      LifecycleCallbackClient.notifyWebsite('payout.completed', {
        accountId: payout.account_id,
        traderId: payout.user_id,
        data: {
          payoutId: payout.id,
          amount: payout.payout_amount,
          plan: payout.plan,
          completedAt: new Date().toISOString(),
        },
      }).catch(() => {});
    }

    return { success: true, payoutId, status: 'completed' };
  }

  /**
   * Get split configuration for a plan.
   * Flash accounts read from FlashRiskProfileService (centralised Flash profile).
   * Instant accounts read from InstantRiskProfileService (centralised Instant profile).
   * All other plans use the hardcoded SPLIT_CONFIGS table.
   *
   * @param {string} plan  - challenge_accounts.plan
   * @param {object} [flashProfile] - pre-loaded Flash profile (avoids extra async fetch)
   * @param {object} [instantProfile] - pre-loaded Instant profile (avoids extra async fetch)
   * @param {string} [startedAt] - challenge_accounts.started_at (for Instant progression)
   * @returns {{ traderSplit: number, firmSplit: number }}
   */
  static getSplitConfig(plan, flashProfile = null, instantProfile = null, startedAt = null) {
    const normalized = (plan || '').toLowerCase().replace(/[-_\s]/g, '');

    if (normalized === 'flash') {
      const splitPct = flashProfile?.profit_split_pct ?? 90;
      const traderSplit = splitPct / 100;
      return { traderSplit, firmSplit: Math.round((1 - traderSplit) * 100) / 100 };
    }

    if (normalized === 'instant') {
      // Instant has a progressive split: initial (70%) → scaled (80%) after N days
      const splitPct = instantProfile
        ? InstantRiskProfileService.getEffectiveSplitPct(instantProfile, startedAt)
        : (SPLIT_CONFIGS['10K']?.traderSplit * 100 ?? 80);
      const traderSplit = splitPct / 100;
      return { traderSplit, firmSplit: Math.round((1 - traderSplit) * 100) / 100 };
    }

    return SPLIT_CONFIGS[plan] || SPLIT_CONFIGS['10K'];
  }

  /**
   * Admin: Get all pending payouts (for admin dashboard).
   */
  static async getPendingPayouts() {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('payouts')
      .select('*, terminal_traders!inner(email, display_name)')
      .in('status', ['pending', 'processing'])
      .order('requested_at', { ascending: true });

    if (error) {
      // Fallback without join if FK doesn't match
      const { data: fallback } = await supabase
        .from('payouts')
        .select('*')
        .in('status', ['pending', 'processing'])
        .order('requested_at', { ascending: true });
      return fallback || [];
    }
    return data || [];
  }
}
