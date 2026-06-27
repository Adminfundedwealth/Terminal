/**
 * ORDER REPOSITORY
 * 
 * Database operations for trading_orders table.
 * All queries scoped by trading_account_id.
 */

import { BaseRepository } from './base.repository.js';

export class OrderRepository extends BaseRepository {
  constructor() {
    super('trading_orders');
  }

  async findByAccountId(accountId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .order('placed_at', { ascending: false });

    if (options.status) {
      query = query.eq('status', options.status);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`[trading_orders] findByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findOpenOrders(accountId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .in('status', ['PENDING', 'OPEN', 'PARTIALLY_FILLED'])
      .order('placed_at', { ascending: false });

    if (error) throw new Error(`[trading_orders] findOpenOrders failed: ${error.message}`);
    return data || [];
  }

  async findTodayOrders(accountId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .gte('placed_at', today.toISOString())
      .order('placed_at', { ascending: false });

    if (error) throw new Error(`[trading_orders] findTodayOrders failed: ${error.message}`);
    return data || [];
  }

  async findByGroupId(groupId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('order_group_id', groupId)
      .order('placed_at', { ascending: true });

    if (error) throw new Error(`[trading_orders] findByGroupId failed: ${error.message}`);
    return data || [];
  }

  async createOrder(accountId, params) {
    return this.insert({
      trading_account_id: accountId,
      symbol: params.symbol,
      token: params.token,
      segment: params.segment,
      instrument_type: params.instrumentType || null,
      side: params.side,
      order_type: params.orderType,
      product_type: params.productType,
      validity: params.validity || 'DAY',
      qty: params.qty,
      price: params.price || null,
      trigger_price: params.triggerPrice || null,
      target_price: params.targetPrice || null,
      stoploss_price: params.stoplossPrice || null,
      trailing_sl: params.trailingSl || null,
      parent_order_id: params.parentOrderId || null,
      order_group_id: params.orderGroupId || null,
      order_group_type: params.orderGroupType || null,
      is_amo: params.isAmo || false,
      status: params.isAmo ? 'AMO_PENDING' : 'PENDING',
      pending_qty: params.qty,
    });
  }

  async updateStatus(orderId, status, updates = {}) {
    const record = { status, updated_at: new Date().toISOString(), ...updates };
    if (status === 'FILLED') record.filled_at = new Date().toISOString();
    if (status === 'CANCELLED') record.cancelled_at = new Date().toISOString();
    return this.update(orderId, record);
  }

  async markFilled(orderId, filledQty, avgPrice, brokerOrderId = null) {
    const updates = {
      status: 'FILLED',
      filled_qty: filledQty,
      avg_fill_price: avgPrice,
      pending_qty: 0,
      filled_at: new Date().toISOString(),
    };
    if (brokerOrderId) updates.broker_order_id = brokerOrderId;
    return this.update(orderId, updates);
  }

  async markPartiallyFilled(orderId, filledQty, pendingQty, avgPrice) {
    return this.update(orderId, {
      status: 'PARTIALLY_FILLED',
      filled_qty: filledQty,
      pending_qty: pendingQty,
      avg_fill_price: avgPrice,
    });
  }

  async markRejected(orderId, reason) {
    return this.update(orderId, {
      status: 'REJECTED',
      reject_reason: reason,
    });
  }

  async markCancelled(orderId) {
    return this.update(orderId, {
      status: 'CANCELLED',
      cancelled_at: new Date().toISOString(),
    });
  }

  async countTodayTrades(accountId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error } = await this.db
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .eq('status', 'FILLED')
      .gte('placed_at', today.toISOString());

    if (error) throw new Error(`[trading_orders] countTodayTrades failed: ${error.message}`);
    return count || 0;
  }

  async cancelGroupOrders(groupId, excludeOrderId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
      .eq('order_group_id', groupId)
      .neq('id', excludeOrderId)
      .in('status', ['PENDING', 'OPEN'])
      .select();

    if (error) throw new Error(`[trading_orders] cancelGroupOrders failed: ${error.message}`);
    return data || [];
  }
}
