/**
 * METRICS REPOSITORY
 * 
 * Database operations for account_metrics table.
 * All queries scoped by trading_account_id.
 */

import { BaseRepository } from './base.repository.js';

export class MetricsRepository extends BaseRepository {
  constructor() {
    super('account_metrics');
  }

  async findByAccountId(accountId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .order('date', { ascending: false });

    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw new Error(`[account_metrics] findByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findByDate(accountId, date) {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    return this.findOne({ trading_account_id: accountId, date: dateStr });
  }

  async upsertDailyMetrics(accountId, metrics) {
    const dateStr = metrics.date || new Date().toISOString().split('T')[0];
    const existing = await this.findByDate(accountId, dateStr);

    const record = {
      trading_account_id: accountId,
      challenge_id: metrics.challengeId || null,
      date: dateStr,
      starting_balance: metrics.startingBalance,
      ending_balance: metrics.endingBalance,
      realized_pnl: metrics.realizedPnl || 0,
      unrealized_pnl: metrics.unrealizedPnl || 0,
      total_trades: metrics.totalTrades || 0,
      winning_trades: metrics.winningTrades || 0,
      losing_trades: metrics.losingTrades || 0,
      gross_profit: metrics.grossProfit || 0,
      gross_loss: metrics.grossLoss || 0,
      max_drawdown: metrics.maxDrawdown || 0,
      daily_loss: metrics.dailyLoss || 0,
      peak_balance: metrics.peakBalance || metrics.endingBalance,
      avg_win: metrics.avgWin || null,
      avg_loss: metrics.avgLoss || null,
      largest_win: metrics.largestWin || null,
      largest_loss: metrics.largestLoss || null,
      profit_factor: metrics.profitFactor || null,
    };

    if (existing) return this.update(existing.id, record);
    return this.insert(record);
  }

  async getMaxDrawdown(accountId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('max_drawdown, peak_balance')
      .eq('trading_account_id', accountId)
      .order('max_drawdown', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw new Error(`[account_metrics] getMaxDrawdown failed: ${error.message}`);
    return data || { max_drawdown: 0, peak_balance: 0 };
  }

  async getTradingDaysCount(accountId) {
    const { count, error } = await this.db
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .gt('total_trades', 0);

    if (error) throw new Error(`[account_metrics] getTradingDaysCount failed: ${error.message}`);
    return count || 0;
  }

  async getRecentMetrics(accountId, days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);

    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .gte('date', from.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) throw new Error(`[account_metrics] getRecentMetrics failed: ${error.message}`);
    return data || [];
  }

  async getEquityCurve(accountId, days = 90) {
    const from = new Date();
    from.setDate(from.getDate() - days);

    const { data, error } = await this.db
      .from(this.tableName)
      .select('date, ending_balance, realized_pnl, total_trades, winning_trades')
      .eq('trading_account_id', accountId)
      .gte('date', from.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) throw new Error(`[account_metrics] getEquityCurve failed: ${error.message}`);
    return data || [];
  }
}
