/**
 * COPY TRADING SERVICE (Master-Slave Replication)
 * 
 * Replicates orders from a master account to configured slave accounts.
 * 
 * Copy modes:
 *   - mirror: same direction, same price, same qty ratio
 *   - proportional: qty scaled by copy_ratio
 *   - fixed_lot: fixed qty per slave regardless of master qty
 * 
 * Handles:
 *   - Order replication on master order fill
 *   - Modification/cancellation propagation
 *   - Slave rejection handling (skip + notify)
 *   - Zero-lot rounding (skip + log warning)
 */

import { supabase } from '../db/client.js';
import { eventBus } from '../events/index.js';

export class CopyTradingService {
  /**
   * Get copy trading config for a master account.
   */
  static async getConfig(masterAccountId) {
    if (!supabase) return [];
    
    const { data, error } = await supabase
      .from('copy_trading_config')
      .select('*')
      .eq('master_account_id', masterAccountId)
      .eq('is_active', true);

    if (error) {
      // Table may not exist yet
      if (error.message.includes('schema cache')) return [];
      throw new Error(`[CopyTrading] getConfig failed: ${error.message}`);
    }
    return data || [];
  }

  /**
   * Create or update a copy trading relationship.
   */
  static async setConfig({ masterAccountId, slaveAccountId, copyMode, copyRatio, fixedLotSize }) {
    if (!supabase) throw new Error('Database not configured');

    const { data, error } = await supabase
      .from('copy_trading_config')
      .upsert({
        master_account_id: masterAccountId,
        slave_account_id: slaveAccountId,
        copy_mode: copyMode || 'mirror',
        copy_ratio: copyRatio || 1.0,
        fixed_lot_size: fixedLotSize || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'master_account_id,slave_account_id' })
      .select()
      .single();

    if (error) throw new Error(`[CopyTrading] setConfig failed: ${error.message}`);
    return data;
  }

  /**
   * Remove a copy trading relationship.
   */
  static async removeConfig(masterAccountId, slaveAccountId) {
    if (!supabase) return;

    await supabase
      .from('copy_trading_config')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('master_account_id', masterAccountId)
      .eq('slave_account_id', slaveAccountId);
  }

  /**
   * Replicate a master order to all active slave accounts.
   * Called when a master order is filled.
   * 
   * @param {string} masterAccountId
   * @param {object} orderParams - { symbol, token, segment, side, orderType, productType, qty, price }
   * @param {number} lotSize - instrument lot size for rounding
   * @returns {object} { replicated: number, skipped: number, failed: [] }
   */
  static async replicateOrder(masterAccountId, orderParams, lotSize = 1) {
    const configs = await this.getConfig(masterAccountId);
    if (configs.length === 0) return { replicated: 0, skipped: 0, failed: [] };

    const results = { replicated: 0, skipped: 0, failed: [] };

    for (const config of configs) {
      try {
        // Calculate slave quantity based on copy mode
        let slaveQty;

        switch (config.copy_mode) {
          case 'mirror':
            slaveQty = Math.floor((orderParams.qty * config.copy_ratio) / lotSize) * lotSize;
            break;
          case 'proportional':
            slaveQty = Math.floor((orderParams.qty * config.copy_ratio) / lotSize) * lotSize;
            break;
          case 'fixed_lot':
            slaveQty = (config.fixed_lot_size || lotSize);
            break;
          default:
            slaveQty = orderParams.qty;
        }

        // Zero-lot check
        if (slaveQty <= 0) {
          console.warn(`[CopyTrading] Zero-lot for slave ${config.slave_account_id} (ratio too small for lot size ${lotSize})`);
          results.skipped++;
          continue;
        }

        // Insert order for slave account
        const { data, error } = await supabase
          .from('trading_orders')
          .insert({
            trading_account_id: config.slave_account_id,
            symbol: orderParams.symbol,
            token: orderParams.token,
            segment: orderParams.segment,
            side: orderParams.side,
            order_type: orderParams.orderType || 'MARKET',
            product_type: orderParams.productType || 'MIS',
            qty: slaveQty,
            price: orderParams.price || null,
            status: 'PENDING',
            parent_order_id: orderParams.orderId || null,
            order_group_type: 'copy_trade',
          })
          .select()
          .single();

        if (error) {
          results.failed.push({ slaveAccountId: config.slave_account_id, error: error.message });
          continue;
        }

        results.replicated++;

        // Publish event for the slave order
        eventBus.publish('order.created', {
          orderId: data.id,
          symbol: orderParams.symbol,
          side: orderParams.side,
          qty: slaveQty,
          status: 'PENDING',
          copySource: masterAccountId,
        }, { accountId: config.slave_account_id });

      } catch (err) {
        results.failed.push({ slaveAccountId: config.slave_account_id, error: err.message });
      }
    }

    // Publish replication summary
    if (results.replicated > 0 || results.failed.length > 0) {
      eventBus.publish('copy_trading.replicated', {
        masterAccountId,
        symbol: orderParams.symbol,
        side: orderParams.side,
        masterQty: orderParams.qty,
        ...results,
      });
    }

    return results;
  }

  /**
   * Propagate order modification to slave accounts.
   */
  static async propagateModification(masterAccountId, orderId, modifications) {
    if (!supabase) return;

    // Find slave orders that were copies of this master order
    const { data: slaveOrders } = await supabase
      .from('trading_orders')
      .select('id, trading_account_id')
      .eq('parent_order_id', orderId)
      .eq('order_group_type', 'copy_trade')
      .in('status', ['PENDING', 'OPEN']);

    if (!slaveOrders || slaveOrders.length === 0) return;

    for (const slaveOrder of slaveOrders) {
      await supabase
        .from('trading_orders')
        .update(modifications)
        .eq('id', slaveOrder.id);
    }
  }

  /**
   * Propagate order cancellation to slave accounts.
   */
  static async propagateCancellation(masterAccountId, orderId) {
    if (!supabase) return;

    const { data: slaveOrders } = await supabase
      .from('trading_orders')
      .select('id')
      .eq('parent_order_id', orderId)
      .eq('order_group_type', 'copy_trade')
      .in('status', ['PENDING', 'OPEN']);

    if (!slaveOrders || slaveOrders.length === 0) return;

    for (const slaveOrder of slaveOrders) {
      await supabase
        .from('trading_orders')
        .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
        .eq('id', slaveOrder.id);
    }
  }

  /**
   * Get portfolio exposure across all accounts (master + slaves).
   */
  static async getPortfolioExposure(masterAccountId) {
    const configs = await this.getConfig(masterAccountId);
    const allAccountIds = [masterAccountId, ...configs.map(c => c.slave_account_id)];

    const { data: positions } = await supabase
      .from('positions')
      .select('trading_account_id, symbol, token, segment, side, qty, avg_price')
      .in('trading_account_id', allAccountIds)
      .eq('is_open', true);

    if (!positions) return { bySymbol: {}, bySector: {}, bySegment: {}, totalAccounts: allAccountIds.length };

    // Group by symbol
    const bySymbol = {};
    const bySegment = {};

    for (const pos of positions) {
      const key = pos.symbol;
      if (!bySymbol[key]) bySymbol[key] = { symbol: pos.symbol, netQty: 0, notional: 0, accounts: 0 };
      bySymbol[key].netQty += pos.side === 'LONG' ? pos.qty : -pos.qty;
      bySymbol[key].notional += pos.qty * pos.avg_price;
      bySymbol[key].accounts++;

      const seg = pos.segment || 'NSE';
      if (!bySegment[seg]) bySegment[seg] = { segment: seg, netQty: 0, notional: 0 };
      bySegment[seg].netQty += pos.side === 'LONG' ? pos.qty : -pos.qty;
      bySegment[seg].notional += pos.qty * pos.avg_price;
    }

    return {
      bySymbol: Object.values(bySymbol),
      bySegment: Object.values(bySegment),
      totalAccounts: allAccountIds.length,
      totalPositions: positions.length,
    };
  }
}
