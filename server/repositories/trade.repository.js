/**
 * TRADE (EXECUTION) REPOSITORY
 * 
 * Database operations for executions table.
 * Executions are immutable fill records.
 */

import { BaseRepository } from './base.repository.js';
import { eventBus } from '../events/index.js';

export class TradeRepository extends BaseRepository {
  constructor() {
    super('executions');
  }

  async findByAccountId(accountId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .order('executed_at', { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`[executions] findByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findTodayTrades(accountId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .gte('executed_at', today.toISOString())
      .order('executed_at', { ascending: false });

    if (error) throw new Error(`[executions] findTodayTrades failed: ${error.message}`);
    return data || [];
  }

  async findByPeriod(accountId, period) {
    const now = new Date();
    let from;

    switch (period) {
      case 'today':
        from = new Date(now); from.setHours(0, 0, 0, 0); break;
      case 'week':
        from = new Date(now); from.setDate(from.getDate() - 7); break;
      case 'month':
        from = new Date(now); from.setMonth(from.getMonth() - 1); break;
      default:
        from = new Date(now); from.setHours(0, 0, 0, 0);
    }

    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .gte('executed_at', from.toISOString())
      .order('executed_at', { ascending: false });

    if (error) throw new Error(`[executions] findByPeriod failed: ${error.message}`);
    return data || [];
  }

  async recordTrade(accountId, orderId, params) {
    const result = await this.insert({
      trading_account_id: accountId,
      order_id: orderId,
      position_id: params.positionId || null,
      broker_trade_id: params.brokerTradeId || null,
      symbol: params.symbol,
      token: params.token,
      segment: params.segment,
      side: params.side,
      qty: params.qty,
      price: params.price,
      exchange_timestamp: params.exchangeTimestamp || null,
    });

    if (result) {
      eventBus.publish('trade.executed', {
        tradeId: result.id,
        orderId,
        symbol: params.symbol,
        token: params.token,
        side: params.side,
        qty: params.qty,
        price: params.price,
        segment: params.segment,
      }, { accountId });
    }

    return result;
  }

  async getTodayRealizedPnl(accountId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await this.db
      .from(this.tableName)
      .select('side, qty, price, symbol')
      .eq('trading_account_id', accountId)
      .gte('executed_at', today.toISOString())
      .order('executed_at', { ascending: true });

    if (error) throw new Error(`[executions] getTodayRealizedPnl failed: ${error.message}`);
    return data || [];
  }

  async countTodayTrades(accountId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error } = await this.db
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .gte('executed_at', today.toISOString());

    if (error) throw new Error(`[executions] countTodayTrades failed: ${error.message}`);
    return count || 0;
  }
}
