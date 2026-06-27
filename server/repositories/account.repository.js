/**
 * ACCOUNT REPOSITORY
 * 
 * Database operations for trading_accounts table.
 * All queries scoped by traderId or accountId.
 */

import { BaseRepository } from './base.repository.js';

export class AccountRepository extends BaseRepository {
  constructor() {
    super('trading_accounts');
  }

  async findByTraderId(traderId) {
    return this.findMany({ trader_id: traderId }, { orderBy: 'created_at', ascending: false });
  }

  // Legacy alias
  async findByUserId(userId) {
    return this.findByTraderId(userId);
  }

  async findByAccountCode(accountCode) {
    return this.findOne({ account_code: accountCode });
  }

  async findActiveByTraderId(traderId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trader_id', traderId)
      .eq('status', 'active');

    if (error) throw new Error(`[trading_accounts] findActiveByTraderId failed: ${error.message}`);
    return data || [];
  }

  // Legacy alias
  async findActiveByUserId(userId) {
    return this.findActiveByTraderId(userId);
  }

  async updateBalance(accountId, newBalance) {
    return this.update(accountId, { balance: newBalance });
  }

  async updatePeakBalance(accountId, newPeak) {
    return this.update(accountId, { peak_balance: newPeak });
  }

  async updateMargin(accountId, { availableMargin, usedMargin }) {
    const updates = {};
    if (availableMargin !== undefined) updates.available_margin = availableMargin;
    if (usedMargin !== undefined) updates.used_margin = usedMargin;
    return this.update(accountId, updates);
  }

  async lockAccount(accountId, reason) {
    return this.update(accountId, {
      status: 'locked',
      locked_reason: reason,
      locked_at: new Date().toISOString(),
    });
  }

  async unlockAccount(accountId) {
    return this.update(accountId, {
      status: 'active',
      locked_reason: null,
      unlocked_at: new Date().toISOString(),
    });
  }

  async breachAccount(accountId, reason) {
    return this.update(accountId, {
      status: 'breached',
      locked_reason: reason,
      locked_at: new Date().toISOString(),
    });
  }

  async completeAccount(accountId) {
    return this.update(accountId, { status: 'completed' });
  }

  async getWithChallenge(accountId) {
    const { data: account, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('id', accountId)
      .single();

    if (error) throw new Error(`[trading_accounts] getWithChallenge failed: ${error.message}`);
    if (!account) return null;

    let challenge = null;
    if (account.challenge_id) {
      const { data } = await this.db
        .from('challenge_accounts')
        .select('*')
        .eq('id', account.challenge_id)
        .single();
      challenge = data || null;
    }

    return { ...account, challenge };
  }
}
