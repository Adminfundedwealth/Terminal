/**
 * CHALLENGE PROGRESS REPOSITORY
 * 
 * Database operations for challenge_progress table.
 * Daily challenge state tracking.
 */

import { BaseRepository } from './base.repository.js';

export class ChallengeMetricsRepository extends BaseRepository {
  constructor() {
    super('challenge_progress');
  }

  async upsertDailyProgress(challengeId, accountId, data) {
    const dateStr = data.date || new Date().toISOString().split('T')[0];
    const existing = await this.findOne({ challenge_id: challengeId, date: dateStr });

    const record = {
      challenge_id: challengeId,
      trading_account_id: accountId,
      date: dateStr,
      trading_day_number: data.tradingDayNumber || 1,
      day_pnl: data.dayPnl || 0,
      cumulative_pnl: data.cumulativePnl || 0,
      balance_eod: data.balanceEod,
      peak_balance: data.peakBalance,
      drawdown_pct: data.drawdownPct || 0,
      daily_loss_pct: data.dailyLossPct || 0,
      trades_today: data.tradesToday || 0,
      is_profitable_day: data.isProfitableDay || false,
      is_trading_day: data.isTradingDay !== false,
      breach_occurred: data.breachOccurred || false,
      breach_type: data.breachType || null,
      profit_target_met: data.profitTargetMet || false,
      min_days_met: data.minDaysMet || false,
    };

    if (existing) return this.update(existing.id, record);
    return this.insert(record);
  }

  async findByChallengeId(challengeId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('challenge_id', challengeId)
      .order('date', { ascending: options.ascending ?? false });

    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw new Error(`[challenge_progress] findByChallengeId failed: ${error.message}`);
    return data || [];
  }

  async getDailySnapshots(challengeId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('date, balance_eod, day_pnl, cumulative_pnl, drawdown_pct, trading_day_number, trades_today')
      .eq('challenge_id', challengeId)
      .eq('is_trading_day', true)
      .order('date', { ascending: true });

    if (error) throw new Error(`[challenge_progress] getDailySnapshots failed: ${error.message}`);
    return data || [];
  }

  async getTradingDaysCount(challengeId) {
    const { count, error } = await this.db
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('challenge_id', challengeId)
      .eq('is_trading_day', true)
      .gt('trades_today', 0);

    if (error) throw new Error(`[challenge_progress] getTradingDaysCount failed: ${error.message}`);
    return count || 0;
  }

  async getLatest(challengeId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('challenge_id', challengeId)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw new Error(`[challenge_progress] getLatest failed: ${error.message}`);
    return data || null;
  }
}
