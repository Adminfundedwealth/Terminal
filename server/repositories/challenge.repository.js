/**
 * CHALLENGE REPOSITORY
 * 
 * Database operations for challenge_accounts table.
 */

import { BaseRepository } from './base.repository.js';

export class ChallengeRepository extends BaseRepository {
  constructor() {
    super('challenge_accounts');
  }

  async findByTraderId(traderId) {
    return this.findMany({ trader_id: traderId }, { orderBy: 'started_at', ascending: false });
  }

  // Legacy alias
  async findByUserId(userId) { return this.findByTraderId(userId); }

  async findActiveByTraderId(traderId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trader_id', traderId)
      .eq('status', 'active')
      .order('started_at', { ascending: false });

    if (error) throw new Error(`[challenge_accounts] findActiveByTraderId failed: ${error.message}`);
    return data || [];
  }

  async findByAccountId(accountId) {
    const { data, error } = await this.db
      .from('trading_accounts')
      .select('challenge_id')
      .eq('id', accountId)
      .single();

    if (error) throw new Error(`[challenge_accounts] findByAccountId failed: ${error.message}`);
    if (!data) return null;
    return this.findById(data.challenge_id);
  }

  async markPassed(challengeId) {
    return this.update(challengeId, {
      status: 'passed',
      passed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  async markFailed(challengeId, reason) {
    return this.update(challengeId, {
      status: 'failed',
      failed_at: new Date().toISOString(),
      fail_reason: reason,
      updated_at: new Date().toISOString(),
    });
  }

  async markExpired(challengeId) {
    return this.update(challengeId, {
      status: 'expired',
      failed_at: new Date().toISOString(),
      fail_reason: 'Time limit exceeded',
      updated_at: new Date().toISOString(),
    });
  }

  async updateBalance(challengeId, currentBalance, peakBalance) {
    const updates = { updated_at: new Date().toISOString() };
    if (currentBalance !== undefined) updates.current_balance = currentBalance;
    if (peakBalance !== undefined) updates.peak_balance = peakBalance;
    return this.update(challengeId, updates);
  }

  async getProgress(challengeId, currentBalance) {
    const challenge = await this.findById(challengeId);
    if (!challenge) return null;

    const pnl = currentBalance - challenge.initial_balance;
    const pnlPercent = (pnl / challenge.initial_balance) * 100;
    const targetPnl = challenge.initial_balance * (challenge.profit_target_pct / 100);
    const progressToTarget = Math.min((pnl / targetPnl) * 100, 100);

    const dailyLossLimit = challenge.initial_balance * (challenge.daily_loss_limit_pct / 100);
    const maxDrawdownLimit = challenge.initial_balance * (challenge.max_drawdown_pct / 100);
    const currentDrawdown = challenge.peak_balance - currentBalance;

    return {
      challengeId: challenge.id,
      type: challenge.type,
      plan: challenge.plan,
      status: challenge.status,
      initialBalance: challenge.initial_balance,
      currentBalance,
      peakBalance: challenge.peak_balance,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      profitTargetPct: challenge.profit_target_pct,
      profitTargetAmount: targetPnl,
      progressToTarget: Math.round(progressToTarget * 100) / 100,
      dailyLossLimit,
      maxDrawdownLimit,
      currentDrawdown: Math.round(currentDrawdown * 100) / 100,
      minTradingDays: challenge.min_trading_days,
      startedAt: challenge.started_at,
      expiresAt: challenge.expires_at,
    };
  }
}
