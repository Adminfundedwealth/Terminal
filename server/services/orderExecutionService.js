/**
 * ORDER EXECUTION SERVICE
 * 
 * The missing orchestration layer that connects:
 *   AccountService → RiskEngine → BrokerAdapter → PositionRepo → TradeRepo
 * 
 * Lifecycle:
 *   1. Receive order (already inserted as PENDING in t_orders)
 *   2. Run risk validation (RiskEngine.validateOrder)
 *   3. Route to broker (BrokerFactory → AngelOneAdapter.placeOrder)
 *   4. Handle broker response
 *   5. Update order status (FILLED / REJECTED)
 *   6. Update position (PositionRepository.upsertPosition)
 *   7. Record trade (TradeRepository.recordTrade)
 *   8. Run post-trade risk check
 *   9. Publish events (order.updated, position.updated, trade.executed)
 * 
 * Also implements:
 *   - exitPosition (market order opposite side)
 *   - reversePosition (exit + re-enter opposite)
 *   - partialClose (exit partial qty)
 *   - closeAll (exit all open positions)
 */

import { RiskEngine } from './riskEngine.js';
import { BrokerFactory } from '../brokers/broker.factory.js';
import { PositionRepository } from '../repositories/position.repository.js';
import { TradeRepository } from '../repositories/trade.repository.js';
import { OrderRepository } from '../repositories/order.repository.js';
import { eventBus } from '../events/index.js';
import { supabase } from '../db/client.js';

const positionRepo = new PositionRepository();
const tradeRepo = new TradeRepository();
const orderRepo = new OrderRepository();

export class OrderExecutionService {
  constructor(marketDataEngine) {
    this.marketDataEngine = marketDataEngine;
  }

  /**
   * Execute an order that has already been inserted into t_orders with PENDING status.
   * Full pipeline: risk check → broker → fill handling → position/trade update.
   * 
   * @param {string} accountId
   * @param {string} orderId - The ID of the order in t_orders
   * @param {object} orderParams - { symbol, token, segment, exchange, side, orderType, productType, qty, price, triggerPrice }
   * @param {object} account - Account record from t_accounts
   * @returns {{ orderId: string, status: string, brokerOrderId?: string, message?: string }}
   */
  async executeOrder(accountId, orderId, orderParams, account) {
    const startTime = Date.now();

    try {
      // ── Step 1: Risk Validation ──────────────────────────────
      const quoteProvider = (token) => {
        const q = this.marketDataEngine.getQuote(token);
        return q?.ltp || 0;
      };

      let riskResult = { allowed: true };
      try {
        riskResult = await RiskEngine.validateOrder(accountId, orderParams, quoteProvider);
      } catch (riskErr) {
        // PRODUCTION: Risk engine failure = REJECT order. Never allow trading when risk checks fail.
        console.error(`[OrderExecution] Risk engine error — REJECTING order: ${riskErr.message}`);
        riskResult = { allowed: false, reason: `Risk engine error: ${riskErr.message}` };
      }

      if (!riskResult.allowed) {
        // Reject order
        try {
          await orderRepo.markRejected(orderId, riskResult.reason);
        } catch (e) { /* best effort — table may not exist */ }

        eventBus.publish('order.updated', {
          orderId,
          status: 'REJECTED',
          rejectReason: riskResult.reason,
          symbol: orderParams.symbol,
          token: orderParams.token,
          segment: orderParams.segment,
          side: orderParams.side,
        }, { accountId });

        // Publish risk alert for persistence
        eventBus.publish('risk.alert', {
          type: 'warning',
          severity: 'warning',
          ruleType: riskResult.ruleType || 'unknown',
          limitValue: 0,
          currentValue: 0,
          message: riskResult.reason,
          metadata: { orderId, symbol: orderParams.symbol, side: orderParams.side },
        }, { accountId });

        return { orderId, status: 'REJECTED', message: riskResult.reason };
      }

      // ── Step 2: Route to Broker ──────────────────────────────
      const brokerProvider = account.broker_provider || account.brokerProvider || 'angelone';
      let brokerResponse;

      // Check execution mode — paper mode simulates fill without real broker call
      const { ExecutionMode } = await import('./executionMode.js');

      if (ExecutionMode.isPaper) {
        // PAPER MODE: simulate successful broker response
        const ltp = this.marketDataEngine.getQuote(orderParams.token)?.ltp || orderParams.price || 0;
        brokerResponse = {
          brokerOrderId: 'PAPER-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          orderId: 'PAPER-' + Date.now(),
          status: orderParams.orderType === 'MARKET' ? 'FILLED' : 'OPEN',
          message: 'Paper mode — simulated fill',
          avgPrice: ltp,
        };
        console.log(`[OrderExecution] PAPER MODE: Simulated ${orderParams.orderType} ${orderParams.side} ${orderParams.qty}x${orderParams.symbol} @ ${ltp} [validity=${orderParams.validity||'DAY'}${orderParams.isAmo?' AMO':''}]`);
      } else {
        try {
          const adapter = await BrokerFactory.create(brokerProvider);

          brokerResponse = await adapter.placeOrder({
            symbol: orderParams.symbol,
            token: orderParams.token,
            exchange: orderParams.exchange || orderParams.segment,
            segment: orderParams.segment,
            side: orderParams.side,
            orderType: orderParams.orderType,
            productType: orderParams.productType,
            qty: orderParams.qty,
            price: orderParams.price || 0,
            triggerPrice: orderParams.triggerPrice || 0,
          });
        } catch (brokerErr) {
          // Broker connection failed or order rejected at broker level
          const reason = `Broker error: ${brokerErr.message}`;
          try {
            await orderRepo.markRejected(orderId, reason);
          } catch (e) { /* best effort — table may not exist */ }

          eventBus.publish('order.updated', {
            orderId,
            status: 'REJECTED',
            rejectReason: reason,
            symbol: orderParams.symbol,
            token: orderParams.token,
            segment: orderParams.segment,
            side: orderParams.side,
            brokerProvider,
          }, { accountId });

          return { orderId, status: 'REJECTED', message: reason };
        }
      }

      const latencyMs = Date.now() - startTime;
      const brokerOrderId = brokerResponse.brokerOrderId || brokerResponse.orderId;
      const brokerStatus = (brokerResponse.status || '').toUpperCase();

      // ── Step 3: Handle Broker Response ────────────────────────
      if (brokerStatus === 'REJECTED' || brokerStatus === 'FAILED') {
        const reason = brokerResponse.message || 'Order rejected by broker';
        try {
          await orderRepo.markRejected(orderId, reason);
        } catch (e) { /* best effort */ }

        eventBus.publish('order.updated', {
          orderId,
          status: 'REJECTED',
          rejectReason: reason,
          symbol: orderParams.symbol,
          token: orderParams.token,
          segment: orderParams.segment,
          side: orderParams.side,
          brokerOrderId,
          brokerProvider,
          latencyMs,
        }, { accountId });

        return { orderId, status: 'REJECTED', brokerOrderId, message: reason };
      }

      // For MARKET orders, assume immediate fill at LTP (broker returns quickly)
      // For LIMIT/SL orders, set to OPEN (awaiting fill)
      if (orderParams.orderType === 'MARKET') {
        return await this._handleMarketFill(accountId, orderId, orderParams, brokerOrderId, brokerProvider, latencyMs);
      } else {
        // LIMIT, SL, SL-M → mark as OPEN
        try {
          await orderRepo.updateStatus(orderId, 'OPEN', { broker_order_id: brokerOrderId });
        } catch (e) { /* best effort */ }

        eventBus.publish('order.updated', {
          orderId,
          status: 'OPEN',
          symbol: orderParams.symbol,
          token: orderParams.token,
          segment: orderParams.segment,
          side: orderParams.side,
          brokerOrderId,
          brokerProvider,
          latencyMs,
        }, { accountId });

        return { orderId, status: 'OPEN', brokerOrderId };
      }
    } catch (err) {
      // Unexpected error — reject order
      console.error(`[OrderExecution] Unexpected error for order ${orderId}:`, err.message);
      try {
        await orderRepo.markRejected(orderId, `Execution error: ${err.message}`);
      } catch (e) { /* best effort */ }

      eventBus.publish('order.updated', {
        orderId,
        status: 'REJECTED',
        rejectReason: err.message,
        symbol: orderParams.symbol,
        token: orderParams.token,
        segment: orderParams.segment,
      }, { accountId });

      return { orderId, status: 'REJECTED', message: err.message };
    }
  }

  /**
   * Handle market order fill — assume immediate execution.
   */
  async _handleMarketFill(accountId, orderId, orderParams, brokerOrderId, brokerProvider, latencyMs) {
    // Determine fill price (use LTP or broker avg price)
    const quote = this.marketDataEngine.getQuote(orderParams.token);
    const fillPrice = quote?.ltp || orderParams.price || 0;
    const filledQty = orderParams.qty;

    // ── Step 4: Mark Order as FILLED ─────────────────────────
    try {
      await orderRepo.markFilled(orderId, filledQty, fillPrice, brokerOrderId);
    } catch (dbErr) {
      // If tables don't exist, continue — the order was tracked in-memory
      if (!dbErr.message?.includes('schema cache')) {
        console.error(`[OrderExecution] Failed to mark order filled:`, dbErr.message);
      }
    }

    eventBus.publish('order.updated', {
      orderId,
      status: 'FILLED',
      symbol: orderParams.symbol,
      token: orderParams.token,
      segment: orderParams.segment,
      side: orderParams.side,
      filledQty,
      avgPrice: fillPrice,
      brokerOrderId,
      brokerProvider,
      latencyMs,
      qty: orderParams.qty,
    }, { accountId });

    // ── Step 5: Update Position ──────────────────────────────
    try {
      await positionRepo.upsertPosition(accountId, {
        symbol: orderParams.symbol,
        token: orderParams.token,
        segment: orderParams.segment,
        exchange: orderParams.exchange || orderParams.segment,
        productType: orderParams.productType,
        side: orderParams.side,
        qty: filledQty,
        price: fillPrice,
      });
    } catch (posErr) {
      // Non-blocking — position tracking may fail if tables don't exist
      if (!posErr.message?.includes('schema cache')) {
        console.error(`[OrderExecution] Position update failed for order ${orderId}:`, posErr.message);
      }
    }

    // ── Step 6: Record Trade ─────────────────────────────────
    try {
      await tradeRepo.recordTrade(accountId, orderId, {
        symbol: orderParams.symbol,
        token: orderParams.token,
        segment: orderParams.segment,
        exchange: orderParams.exchange || orderParams.segment,
        side: orderParams.side,
        qty: filledQty,
        price: fillPrice,
      });
    } catch (tradeErr) {
      // Non-blocking — trade recording may fail if tables don't exist
      if (!tradeErr.message?.includes('schema cache')) {
        console.error(`[OrderExecution] Trade record failed for order ${orderId}:`, tradeErr.message);
      }
    }

    // ── Step 7: Post-Trade Risk Check ────────────────────────
    try {
      const quoteProvider = (token) => {
        const q = this.marketDataEngine.getQuote(token);
        return q?.ltp || 0;
      };
      const riskResult = await RiskEngine.postTradeCheck(accountId, quoteProvider);
      if (riskResult.status === 'locked' || riskResult.status === 'breached') {
        console.warn(`[OrderExecution] Post-trade risk: ${riskResult.status} — ${riskResult.reason}`);
      }
    } catch (riskErr) {
      // Non-blocking — if tables don't exist, skip post-trade check
      if (!riskErr.message?.includes('schema cache')) {
        console.error(`[OrderExecution] Post-trade risk check failed:`, riskErr.message);
      }
    }

    return { orderId, status: 'FILLED', brokerOrderId, avgPrice: fillPrice, filledQty };
  }

  /**
   * Handle a fill notification from broker (for LIMIT/SL orders).
   * Called when broker reports a fill via order update callback or polling.
   */
  async handleBrokerFill(accountId, orderId, fillData) {
    const { filledQty, avgPrice, brokerOrderId } = fillData;

    // Get the original order
    let order;
    try {
      order = await orderRepo.findById ? await this._findOrder(orderId) : null;
    } catch (e) {
      order = null;
    }

    if (!order) {
      console.error(`[OrderExecution] handleBrokerFill: order ${orderId} not found`);
      return;
    }

    // Determine if partial or full fill
    const totalFilled = (order.filled_qty || 0) + filledQty;
    const isFullyFilled = totalFilled >= order.qty;
    const newStatus = isFullyFilled ? 'FILLED' : 'PARTIAL';

    // Update order status
    await orderRepo.updateStatus(orderId, isFullyFilled ? 'FILLED' : 'OPEN', {
      filled_qty: totalFilled,
      avg_price: avgPrice,
      broker_order_id: brokerOrderId,
    });

    eventBus.publish('order.updated', {
      orderId,
      status: isFullyFilled ? 'FILLED' : 'PARTIAL',
      symbol: order.symbol,
      token: order.token,
      segment: order.segment,
      side: order.side,
      filledQty: totalFilled,
      avgPrice,
      brokerOrderId,
      qty: order.qty,
    }, { accountId });

    // Update position
    try {
      await positionRepo.upsertPosition(accountId, {
        symbol: order.symbol,
        token: order.token,
        segment: order.segment,
        exchange: order.exchange || order.segment,
        productType: order.product_type,
        side: order.side,
        qty: filledQty,
        price: avgPrice,
      });
    } catch (e) {
      console.error(`[OrderExecution] Position update on fill failed:`, e.message);
    }

    // Record trade
    try {
      await tradeRepo.recordTrade(accountId, orderId, {
        symbol: order.symbol,
        token: order.token,
        segment: order.segment,
        exchange: order.exchange || order.segment,
        side: order.side,
        qty: filledQty,
        price: avgPrice,
      });
    } catch (e) {
      console.error(`[OrderExecution] Trade record on fill failed:`, e.message);
    }

    // Post-trade risk
    try {
      const quoteProvider = (token) => {
        const q = this.marketDataEngine.getQuote(token);
        return q?.ltp || 0;
      };
      await RiskEngine.postTradeCheck(accountId, quoteProvider);
    } catch (e) { /* non-blocking */ }
  }

  /**
   * Exit a position — place market order in opposite direction.
   * @param {string} accountId
   * @param {string} positionId
   * @param {number} [qty] - Partial close qty. If omitted, closes full position.
   * @returns {{ orderId: string, status: string }}
   */
  async exitPosition(accountId, positionId, qty = null) {
    // Find the position
    const position = await this._findPosition(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }
    if (position.qty === 0 || position.closed_at) {
      throw new Error('Position already closed');
    }

    // Determine close qty and side
    const closeQty = qty ? Math.min(qty, Math.abs(position.qty)) : Math.abs(position.qty);
    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';

    // Create exit order
    const account = await this._getAccount(accountId);
    const orderParams = {
      symbol: position.symbol,
      token: position.token,
      segment: position.segment || position.exchange,
      exchange: position.exchange || position.segment,
      side: closeSide,
      orderType: 'MARKET',
      productType: position.product_type,
      qty: closeQty,
    };

    // Insert order into database
    const order = await orderRepo.createOrder(accountId, orderParams);
    const orderId = order.id;

    eventBus.publish('order.created', {
      orderId,
      symbol: orderParams.symbol,
      token: orderParams.token,
      segment: orderParams.segment,
      side: orderParams.side,
      orderType: 'MARKET',
      productType: orderParams.productType,
      qty: closeQty,
      status: 'PENDING',
    }, { accountId });

    // Execute the order
    const result = await this.executeOrder(accountId, orderId, orderParams, account);
    return result;
  }

  /**
   * Reverse a position — close current + open opposite side same qty.
   */
  async reversePosition(accountId, positionId) {
    const position = await this._findPosition(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }
    if (position.qty === 0 || position.closed_at) {
      throw new Error('Position already closed — cannot reverse');
    }

    const originalQty = Math.abs(position.qty);
    const reverseSide = position.qty > 0 ? 'SELL' : 'BUY';

    // Place order for 2x qty (close current + open opposite)
    const account = await this._getAccount(accountId);
    const orderParams = {
      symbol: position.symbol,
      token: position.token,
      segment: position.segment || position.exchange,
      exchange: position.exchange || position.segment,
      side: reverseSide,
      orderType: 'MARKET',
      productType: position.product_type,
      qty: originalQty * 2,
    };

    const order = await orderRepo.createOrder(accountId, orderParams);
    const orderId = order.id;

    eventBus.publish('order.created', {
      orderId,
      symbol: orderParams.symbol,
      token: orderParams.token,
      segment: orderParams.segment,
      side: orderParams.side,
      orderType: 'MARKET',
      productType: orderParams.productType,
      qty: orderParams.qty,
      status: 'PENDING',
    }, { accountId });

    const result = await this.executeOrder(accountId, orderId, orderParams, account);
    return result;
  }

  /**
   * Close all open positions for an account.
   */
  async closeAllPositions(accountId, reason = 'user_requested') {
    const positions = await positionRepo.findOpenByAccountId(accountId);
    const results = [];

    for (const pos of positions) {
      if (pos.qty === 0) continue;
      try {
        const result = await this.exitPosition(accountId, pos.id);
        results.push(result);
      } catch (err) {
        console.error(`[OrderExecution] closeAll failed for ${pos.symbol}:`, err.message);
        results.push({ orderId: null, status: 'FAILED', message: err.message, symbol: pos.symbol });
      }
    }

    return results;
  }

  /**
   * Attach a stop-loss order to an open position.
   * Places a SL-M (stop-loss market) order at the specified trigger price.
   */
  async attachStopLoss(accountId, positionId, triggerPrice) {
    const position = await this._findPosition(positionId);
    if (!position) throw new Error(`Position ${positionId} not found`);
    if (!position.is_open || position.qty === 0) throw new Error('Position is not open');
    if (!triggerPrice || triggerPrice <= 0) throw new Error('Invalid trigger price');

    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
    const account = await this._getAccount(accountId);

    const orderParams = {
      symbol: position.symbol,
      token: position.token,
      segment: position.segment || 'NSE',
      exchange: position.segment || 'NSE',
      side: closeSide,
      orderType: 'SL-M',
      productType: position.product_type,
      qty: position.qty,
      triggerPrice,
    };

    const order = await orderRepo.createOrder(accountId, orderParams);
    eventBus.publish('order.created', { orderId: order.id, ...orderParams, status: 'PENDING' }, { accountId });

    // In paper mode, SL-M stays OPEN (not immediately filled)
    const { ExecutionMode } = await import('./executionMode.js');
    if (ExecutionMode.isPaper) {
      try { await orderRepo.updateStatus(order.id, 'OPEN', { trigger_price: triggerPrice }); } catch {}
      eventBus.publish('order.updated', { orderId: order.id, status: 'OPEN', ...orderParams }, { accountId });
      return { orderId: order.id, status: 'OPEN', type: 'SL-M', triggerPrice };
    }

    const result = await this.executeOrder(accountId, order.id, orderParams, account);
    return result;
  }

  /**
   * Attach a take-profit order to an open position.
   * Places a LIMIT order at the specified target price.
   */
  async attachTakeProfit(accountId, positionId, targetPrice) {
    const position = await this._findPosition(positionId);
    if (!position) throw new Error(`Position ${positionId} not found`);
    if (!position.is_open || position.qty === 0) throw new Error('Position is not open');
    if (!targetPrice || targetPrice <= 0) throw new Error('Invalid target price');

    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
    const account = await this._getAccount(accountId);

    const orderParams = {
      symbol: position.symbol,
      token: position.token,
      segment: position.segment || 'NSE',
      exchange: position.segment || 'NSE',
      side: closeSide,
      orderType: 'LIMIT',
      productType: position.product_type,
      qty: position.qty,
      price: targetPrice,
    };

    const order = await orderRepo.createOrder(accountId, orderParams);
    eventBus.publish('order.created', { orderId: order.id, ...orderParams, status: 'PENDING' }, { accountId });

    const { ExecutionMode } = await import('./executionMode.js');
    if (ExecutionMode.isPaper) {
      try { await orderRepo.updateStatus(order.id, 'OPEN', { price: targetPrice }); } catch {}
      eventBus.publish('order.updated', { orderId: order.id, status: 'OPEN', ...orderParams }, { accountId });
      return { orderId: order.id, status: 'OPEN', type: 'LIMIT', price: targetPrice };
    }

    const result = await this.executeOrder(accountId, order.id, orderParams, account);
    return result;
  }

  /**
   * Move stop-loss to break-even (entry price).
   * Creates a SL-M order at the position's avg_price.
   */
  async breakEven(accountId, positionId) {
    const position = await this._findPosition(positionId);
    if (!position) throw new Error(`Position ${positionId} not found`);
    if (!position.is_open || position.qty === 0) throw new Error('Position is not open');

    const triggerPrice = parseFloat(position.avg_price);
    if (!triggerPrice || triggerPrice <= 0) throw new Error('Cannot determine entry price');

    return this.attachStopLoss(accountId, positionId, triggerPrice);
  }

  // ─── Internal Helpers ──────────────────────────────────────

  async _findPosition(positionId) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('id', positionId)
      .single();
    if (error) return null;
    return data;
  }

  async _findOrder(orderId) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('trading_orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (error) return null;
    return data;
  }

  async _getAccount(accountId) {
    if (accountId === 'dev-account') {
      return {
        id: 'dev-account',
        broker_provider: 'angelone',
        balance: 10000000,
        status: 'active',
      };
    }
    if (!supabase) return { id: accountId, broker_provider: 'angelone', balance: 0, status: 'active' };
    const { data, error } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    if (error) return { id: accountId, broker_provider: 'angelone', balance: 0, status: 'active' };
    return data;
  }
}
