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
import { FlashRiskEngine } from './flashRiskEngine.js';
import { FlashRiskProfileService } from './flashRiskProfileService.js';
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
    this._dataProviderSwitch = null;
    this._candleService = null;
    this._paperOrderMonitor = null;
    // Track pending paper SL/LIMIT orders: orderId → { accountId, orderParams, triggerPrice, limitPrice }
    this._pendingPaperOrders = new Map();
    // Concurrency guard for exitPosition: positionId → Promise
    this._exitInFlight = new Map();
    this._startPaperOrderMonitor();
  }

  /**
   * Inject DataProviderSwitch and CandleService for LTP fallback.
   * Called from server/index.js after services are initialized.
   */
  setFallbackServices(dataProviderSwitch, candleService) {
    this._dataProviderSwitch = dataProviderSwitch;
    this._candleService = candleService;
  }

  /**
   * Monitor open SL-M and LIMIT paper orders every second.
   * Fills them when LTP crosses the trigger/limit price.
   * Uses multiple price sources to ensure triggers fire.
   */
  _startPaperOrderMonitor() {
    this._paperOrderMonitor = setInterval(async () => {
      if (this._pendingPaperOrders.size === 0) return;
      const { ExecutionMode } = await import('./executionMode.js').catch(() => ({ ExecutionMode: { isPaper: false } }));
      if (!ExecutionMode.isPaper) return;

      for (const [orderId, entry] of this._pendingPaperOrders) {
        try {
          // Multi-source LTP resolution: cache → candle → depth midpoint
          let ltp = this.marketDataEngine.getQuote(entry.token)?.ltp;
          if (!ltp || ltp <= 0) {
            // Try last candle close
            const candle = this._candleService?.getCurrentCandle(entry.token, '1');
            ltp = candle?.close;
          }
          if (!ltp || ltp <= 0) {
            // Try depth midpoint
            const depth = this.marketDataEngine.depthCache?.get(entry.token);
            if (depth?.bids?.[0]?.price && depth?.asks?.[0]?.price) {
              ltp = (depth.bids[0].price + depth.asks[0].price) / 2;
            }
          }
          if (!ltp || ltp <= 0) continue;

          let shouldFill = false;
          const triggerPrice = Number(entry.triggerPrice) || 0;
          const limitPrice = Number(entry.price) || 0;

          if (entry.orderType === 'SL-M' || entry.orderType === 'SL') {
            // SL SELL fires when LTP ≤ triggerPrice; SL BUY fires when LTP ≥ triggerPrice
            if (entry.side === 'SELL' && triggerPrice > 0 && ltp <= triggerPrice) shouldFill = true;
            if (entry.side === 'BUY'  && triggerPrice > 0 && ltp >= triggerPrice) shouldFill = true;
          } else if (entry.orderType === 'LIMIT') {
            // LIMIT SELL fills when LTP ≥ limitPrice; LIMIT BUY fills when LTP ≤ limitPrice
            if (entry.side === 'SELL' && limitPrice > 0 && ltp >= limitPrice) shouldFill = true;
            if (entry.side === 'BUY'  && limitPrice > 0 && ltp <= limitPrice) shouldFill = true;
          }

          if (shouldFill) {
            this._pendingPaperOrders.delete(orderId);
            console.log(`[PaperMonitor] TRIGGERED: ${entry.orderType} ${entry.side} ${entry.symbol} @ LTP ${ltp} (trigger=${triggerPrice} limit=${limitPrice})`);
            // Resolve account for post-trade risk checks
            let acct = null;
            try { acct = await this._getAccount(entry.accountId); } catch (_) {}
            await this._handleMarketFill(
              entry.accountId, orderId,
              { ...entry.orderParams, orderType: 'MARKET' },
              'PAPER-TRIGGER-' + orderId,
              'paper',
              0,
              acct
            );
          }
        } catch (err) {
          console.error(`[PaperMonitor] Error checking order ${orderId}:`, err.message);
        }
      }
    }, 1000);
  }

  /**
   * Register an open paper SL/LIMIT order for price monitoring.
   */
  _registerPaperOrder(orderId, accountId, orderParams) {
    this._pendingPaperOrders.set(orderId, {
      accountId,
      token: orderParams.token,
      symbol: orderParams.symbol,
      side: orderParams.side,
      orderType: orderParams.orderType,
      triggerPrice: orderParams.triggerPrice || 0,
      price: orderParams.price || 0,
      orderParams,
    });

    // Ensure the token is actively monitored for price updates
    // Subscribe if not already in the quote cache
    if (!this.marketDataEngine.getQuote(orderParams.token)?.ltp) {
      // Push a placeholder so the LTP poller picks it up
      this.marketDataEngine.subscribe(orderParams.token, () => {});
    }

    console.log(`[PaperMonitor] Registered ${orderParams.orderType} ${orderParams.side} ${orderParams.symbol} (trigger=${orderParams.triggerPrice || ''} limit=${orderParams.price || ''})`);
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

    // ── Safety: ensure account is defined and usable ──────────────────────
    if (!account || typeof account !== 'object') {
      try { account = await this._getAccount(accountId); } catch (_) {}
    }
    if (!account) {
      account = { id: accountId, broker_provider: 'angelone', balance: 0, status: 'active' };
    }

    try {
      // ── Step 1: Risk Validation ──────────────────────────────
      // quoteProvider returns null for invalid/missing LTP — never 0.
      // The risk engine and position repository both handle null safely
      // by excluding that position from unrealized P&L (break-even fallback).
      const quoteProvider = (token) => {
        const q = this.marketDataEngine.getQuote(token);
        const ltp = q?.ltp;
        if (!ltp || !Number.isFinite(ltp) || ltp <= 0) return null;
        return ltp;
      };

      let riskResult = { allowed: true };
      try {
        // ── Flash accounts use the dedicated Flash Risk Engine ────────────
        // All other challenge types continue using the existing Risk Engine.
        if (FlashRiskProfileService.isFlashAccount(account)) {
          riskResult = await FlashRiskEngine.validateOrder(accountId, orderParams, quoteProvider, account);
        } else {
          riskResult = await RiskEngine.validateOrder(accountId, orderParams, quoteProvider);
        }
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
        return await this._handleMarketFill(accountId, orderId, orderParams, brokerOrderId, brokerProvider, latencyMs, account);
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

        // In paper mode, register with price monitor so it auto-fills when triggered
        const { ExecutionMode: EM2 } = await import('./executionMode.js');
        if (EM2.isPaper) {
          this._registerPaperOrder(orderId, accountId, orderParams);
        }

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
   * Handle market order fill — INSTANT execution (<50ms).
   * Uses synchronous cache LTP only. No blocking network calls in the hot path.
   * DB writes happen in parallel AFTER the position event is emitted.
   */
  async _handleMarketFill(accountId, orderId, orderParams, brokerOrderId, brokerProvider, latencyMs, account = null) {
    // Safe resolution: ensure account is available for post-trade risk checks
    if (!account && accountId) {
      try { account = await this._getAccount(accountId); } catch (_) {}
    }

    // ── Fill price: SYNCHRONOUS cache-only lookup (zero network latency) ──
    // Priority: live LTP cache > explicit order price
    const quote = this.marketDataEngine.getQuote(orderParams.token);
    const rawLtp = quote?.ltp;
    let fillPrice = (rawLtp && Number.isFinite(rawLtp) && rawLtp > 0) ? rawLtp : null;

    // Fallback: use order price (from option chain LTP at order-creation time)
    if (!fillPrice && orderParams.price > 0) {
      fillPrice = orderParams.price;
    }

    // Last resort: synchronous depth midpoint (no network)
    if (!fillPrice) {
      const depth = this.marketDataEngine.depthCache?.get(orderParams.token);
      if (depth?.bids?.[0]?.price && depth?.asks?.[0]?.price) {
        fillPrice = (depth.bids[0].price + depth.asks[0].price) / 2;
      }
    }

    if (!fillPrice || fillPrice <= 0) {
      // ALL synchronous fallbacks exhausted — reject
      const reason = 'Market data unavailable — LTP is zero or missing. Order not executed. Please retry.';
      console.error(`[OrderExecution] REJECTED fill for order ${orderId} (${orderParams.symbol}): ${reason}`);
      try { await orderRepo.markRejected(orderId, reason); } catch (_) {}

      eventBus.publish('order.updated', {
        orderId, status: 'REJECTED', rejectReason: reason,
        symbol: orderParams.symbol, token: orderParams.token,
        segment: orderParams.segment, side: orderParams.side,
        brokerOrderId, brokerProvider,
      }, { accountId });

      return { orderId, status: 'REJECTED', message: reason };
    }

    const filledQty = orderParams.qty;

    // ── OPTIMISTIC: Emit position + order events IMMEDIATELY ──
    // This reaches the UI in <5ms via EventBridge → Socket.IO.
    // DB persistence happens in parallel afterwards.
    eventBus.publish('order.updated', {
      orderId, status: 'FILLED',
      symbol: orderParams.symbol, token: orderParams.token,
      segment: orderParams.segment, side: orderParams.side,
      filledQty, avgPrice: fillPrice,
      brokerOrderId, brokerProvider, latencyMs,
      qty: orderParams.qty,
    }, { accountId });

    // Emit position update optimistically (before DB write)
    eventBus.publish('position.updated', {
      symbol: orderParams.symbol,
      token: orderParams.token,
      segment: orderParams.segment,
      exchange: orderParams.exchange || orderParams.segment,
      productType: orderParams.productType,
      side: orderParams.side,
      qty: filledQty,
      avgPrice: fillPrice,
      ltp: fillPrice,
      pnl: 0,
    }, { accountId });

    // Emit trade event optimistically
    eventBus.publish('trade.executed', {
      orderId, symbol: orderParams.symbol, token: orderParams.token,
      segment: orderParams.segment, side: orderParams.side,
      qty: filledQty, price: fillPrice,
      executedAt: new Date().toISOString(),
    }, { accountId });

    // ── NON-BLOCKING: Persist to DB in parallel (fire-and-forget) ──
    // These writes happen AFTER the UI has already updated.
    const persistPromises = [];

    // Mark order as FILLED
    persistPromises.push(
      orderRepo.markFilled(orderId, filledQty, fillPrice, brokerOrderId)
        .catch(err => { if (!err.message?.includes('schema cache')) console.error(`[OrderExecution] DB order fill write failed:`, err.message); })
    );

    // Upsert position
    persistPromises.push(
      positionRepo.upsertPosition(accountId, {
        symbol: orderParams.symbol, token: orderParams.token,
        segment: orderParams.segment, exchange: orderParams.exchange || orderParams.segment,
        productType: orderParams.productType, side: orderParams.side,
        qty: filledQty, price: fillPrice,
      }).catch(err => { if (!err.message?.includes('schema cache')) console.error(`[OrderExecution] DB position write failed:`, err.message); })
    );

    // Record trade
    persistPromises.push(
      tradeRepo.recordTrade(accountId, orderId, {
        symbol: orderParams.symbol, token: orderParams.token,
        segment: orderParams.segment, exchange: orderParams.exchange || orderParams.segment,
        side: orderParams.side, qty: filledQty, price: fillPrice,
      }).catch(err => { if (!err.message?.includes('schema cache')) console.error(`[OrderExecution] DB trade write failed:`, err.message); })
    );

    // Run all DB writes in parallel — don't block the response
    Promise.all(persistPromises).then(() => {
      // Post-trade risk check (non-blocking, after persistence)
      if (account) {
        this._postTradeRiskCheck(accountId, orderParams, account).catch(() => {});
      }
    }).catch(() => {});

    // Flash 24h timer (non-blocking)
    if (account && FlashRiskProfileService.isFlashAccount(account)) {
      const challengeId = account.challenge_id || account.challenge?.id;
      if (challengeId && !orderParams.isCloseOrder) {
        positionRepo.findOpenPosition(accountId, orderParams.token, orderParams.productType)
          .then(posAfter => {
            if (posAfter && posAfter.qty > 0) {
              FlashRiskProfileService.recordFirstPosition(challengeId).catch(() => {});
            }
          }).catch(() => {});
      }
    }

    return { orderId, status: 'FILLED', brokerOrderId, avgPrice: fillPrice, filledQty };
  }

  /**
   * Post-trade risk check — runs after DB persistence completes.
   * Non-blocking, fire-and-forget.
   */
  async _postTradeRiskCheck(accountId, orderParams, account) {
    // Safety: ensure account is available
    if (!account) {
      try { account = await this._getAccount(accountId); } catch (_) {}
    }
    if (!account) return; // Can't do risk check without account data

    const quoteProvider = (token) => {
      const q = this.marketDataEngine.getQuote(token);
      const ltp = q?.ltp;
      if (!ltp || !Number.isFinite(ltp) || ltp <= 0) return null;
      return ltp;
    };

    let riskResult;
    if (FlashRiskProfileService.isFlashAccount(account)) {
      riskResult = await FlashRiskEngine.postTradeCheck(accountId, quoteProvider, account);
    } else {
      riskResult = await RiskEngine.postTradeCheck(accountId, quoteProvider);
    }

    if (riskResult.status === 'locked' || riskResult.status === 'breached' || riskResult.status === 'expired') {
      console.warn(`[OrderExecution] Post-trade risk: ${riskResult.status} — ${riskResult.reason}`);
    }
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
        const ltp = q?.ltp;
        if (!ltp || !Number.isFinite(ltp) || ltp <= 0) return null;
        return ltp;
      };
      // Flash accounts use FlashRiskEngine; all others use RiskEngine
      const acct = await this._getAccount(accountId);
      if (FlashRiskProfileService.isFlashAccount(acct)) {
        await FlashRiskEngine.postTradeCheck(accountId, quoteProvider, acct);
      } else {
        await RiskEngine.postTradeCheck(accountId, quoteProvider);
      }
    } catch (e) { /* non-blocking */ }
  }

  /**
   * Exit a position — place market order in opposite direction.
   *
   * CONCURRENCY GUARD: Uses _exitInFlight map to prevent two simultaneous
   * calls for the same positionId from both passing the "already closed"
   * check and sending duplicate broker exit orders.
   *
   * If a call for positionId is already in progress, the second caller
   * awaits the same promise and receives the same result — no second
   * broker order is created.
   *
   * @param {string} accountId
   * @param {string} positionId
   * @param {number} [qty] - Partial close qty. If omitted, closes full position.
   * @returns {{ orderId: string, status: string }}
   */
  async exitPosition(accountId, positionId, qty = null) {
    // ── Concurrency guard ────────────────────────────────────────────────────
    // If an exit for this exact positionId is already in flight, return the
    // same promise — do NOT create a second broker order.
    if (this._exitInFlight.has(positionId)) {
      console.warn(`[OrderExecution] exitPosition: duplicate call for ${positionId} — returning in-flight promise`);
      return this._exitInFlight.get(positionId);
    }

    const exitPromise = this._doExitPosition(accountId, positionId, qty);
    this._exitInFlight.set(positionId, exitPromise);
    try {
      return await exitPromise;
    } finally {
      // Always clean up the guard, whether success or failure
      this._exitInFlight.delete(positionId);
    }
  }

  /**
   * Internal exit implementation — only called once per positionId at a time.
   * @private
   */
  async _doExitPosition(accountId, positionId, qty = null) {
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
      isCloseOrder: true, // bypass all risk rule checks — closing always allowed
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

    // In paper mode, SL-M stays OPEN and is registered with the price monitor
    const { ExecutionMode } = await import('./executionMode.js');
    if (ExecutionMode.isPaper) {
      try { await orderRepo.updateStatus(order.id, 'OPEN', { trigger_price: triggerPrice }); } catch {}
      eventBus.publish('order.updated', { orderId: order.id, status: 'OPEN', ...orderParams }, { accountId });
      // Register with monitor so it auto-fills when LTP crosses trigger
      this._registerPaperOrder(order.id, accountId, orderParams);
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
      // Register with monitor so it auto-fills when LTP reaches target
      this._registerPaperOrder(order.id, accountId, orderParams);
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
        leverage_max: 50,
        status: 'active',
      };
    }
    if (!supabase) return { id: accountId, broker_provider: 'angelone', balance: 1000000, leverage_max: 10, status: 'active' };
    const { data, error } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    if (error || !data) {
      // Fallback: don't return 0 balance which blocks ALL orders
      return { id: accountId, broker_provider: 'angelone', balance: 1000000, leverage_max: 10, status: 'active' };
    }
    // Ensure leverage_max has a sane default
    if (!data.leverage_max || data.leverage_max <= 0) {
      data.leverage_max = 10; // Standard prop-firm intraday leverage
    }
    return data;
  }
}
