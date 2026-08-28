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
import { OrderRepository, buildOrderCorrelationId } from '../repositories/order.repository.js';
import { eventBus } from '../events/index.js';
import { supabase } from '../db/client.js';
import { PositionReconciliationService } from './positionReconciliationService.js';

const positionRepo = new PositionRepository();
const tradeRepo = new TradeRepository();
const orderRepo = new OrderRepository();
const recoveryStates = new Map();

export class OrderExecutionService {
  constructor(marketDataEngine, { positionReconciliationService = new PositionReconciliationService() } = {}) {
    this.marketDataEngine = marketDataEngine;
    this.positionReconciliationService = positionReconciliationService;
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

  static isBrokerUncertainty(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    return ['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)
      || message.includes('timeout')
      || message.includes('timed out')
      || message.includes('network error')
      || message.includes('socket hang up');
  }

  async _markPendingReconciliation(accountId, orderId, correlationId, brokerProvider, reason) {
    try {
      await orderRepo.updateStatus(orderId, 'PENDING_RECONCILIATION', {
        correlation_id: correlationId,
        reject_reason: reason,
      });
    } catch (persistenceError) {
      console.error(`[OrderExecution] Cannot persist PENDING_RECONCILIATION for ${orderId}:`, persistenceError.message);
    }

    eventBus.publish('order.updated', {
      orderId,
      status: 'PENDING_RECONCILIATION',
      correlationId,
      brokerProvider,
      reason,
    }, { accountId });

    return { orderId, status: 'PENDING_RECONCILIATION', correlationId, message: reason };
  }

  /**
   * Monitor open SL-M and LIMIT paper orders every second.
   * Fills them when LTP crosses the trigger/limit price.
   * Uses multiple price sources to ensure triggers fire.
   *
   * ── SL/TP safety rules ───────────────────────────────────────────────────
   * 1. Before triggering any SL/TP order, re-read the position from DB.
   *    If the position is already closed (qty=0 or is_open=false), cancel
   *    the order silently — never create a new position from a stale trigger.
   * 2. Route SL/TP fills through exitPosition() rather than _handleMarketFill
   *    directly.  exitPosition() owns the _exitInFlight concurrency guard and
   *    the qty=0 / closed_at secondary check, which prevents duplicate exits
   *    and ghost-position creation.
   * 3. When a SL/TP fires for a positionId, remove ALL sibling orders for
   *    the same positionId from _pendingPaperOrders so the other leg never
   *    fires on an already-closed position.
   */
  _startPaperOrderMonitor() {
    this._paperOrderMonitor = setInterval(async () => {
      if (this._pendingPaperOrders.size === 0) return;
      const { ExecutionMode } = await import('./executionMode.js').catch(() => ({ ExecutionMode: { isPaper: false } }));
      if (!ExecutionMode.isPaper) return;

      for (const [orderId, entry] of this._pendingPaperOrders) {
        try {
          // ── Multi-source LTP resolution ────────────────────────────────────
          // Orders may have Angel tokens (99926000), Dhan tokens (13), or symbols.
          // Check all possible token representations against the quote cache.
          let ltp = this._resolveLtpForOrder(entry);

          if (!ltp || ltp <= 0) continue;

          let shouldFill = false;
          const triggerPrice = Number(entry.triggerPrice) || 0;
          const limitPrice = Number(entry.price) || 0;

          // ── SL/TP orders: direction-aware trigger check ────────────────────
          // These are exit orders (SL-M or LIMIT placed by attachStopLoss /
          // attachTakeProfit). They are tracked with a positionId so we can
          // verify the position is still open before executing.
          if (entry.orderType === 'SL-M' || entry.orderType === 'SL') {
            // SL-BUY  (exit for SHORT) fires when LTP ≥ triggerPrice (price rose to SL)
            // SL-SELL (exit for LONG)  fires when LTP ≤ triggerPrice (price fell to SL)
            if (entry.side === 'SELL' && triggerPrice > 0 && ltp <= triggerPrice) shouldFill = true;
            if (entry.side === 'BUY'  && triggerPrice > 0 && ltp >= triggerPrice) shouldFill = true;
          } else if (entry.orderType === 'LIMIT') {
            // LIMIT SELL fills when LTP ≥ limitPrice; LIMIT BUY fills when LTP ≤ limitPrice
            if (entry.side === 'SELL' && limitPrice > 0 && ltp >= limitPrice) shouldFill = true;
            if (entry.side === 'BUY'  && limitPrice > 0 && ltp <= limitPrice) shouldFill = true;
          }

          if (!shouldFill) continue;

          // ── Position guard ─────────────────────────────────────────────────
          // Re-read the position from DB before executing the exit.
          // If another trigger (SL or TP) already closed this position, skip.
          const positionId = entry.positionId;
          if (positionId) {
            const livePos = await this._findPosition(positionId);
            if (!livePos || !livePos.is_open || livePos.qty === 0) {
              // Position is already closed — stale trigger, discard order
              this._pendingPaperOrders.delete(orderId);
              console.log(`[PaperMonitor] SKIPPED stale trigger: order=${orderId} position=${positionId} already closed`);
              try { await orderRepo.updateStatus(orderId, 'CANCELLED', { reject_reason: 'Position already closed' }); } catch (_) {}
              continue;
            }
          }

          // ── Remove this order AND all sibling orders for same position ─────
          // Prevents the opposite leg (e.g. TP after SL fires) from triggering
          // on a now-closed position and creating a ghost reversal.
          this._pendingPaperOrders.delete(orderId);
          if (positionId) {
            for (const [siblingId, sibling] of this._pendingPaperOrders) {
              if (sibling.positionId === positionId) {
                this._pendingPaperOrders.delete(siblingId);
                console.log(`[PaperMonitor] Cancelled sibling order ${siblingId} for position ${positionId}`);
                try { await orderRepo.updateStatus(siblingId, 'CANCELLED', { reject_reason: 'Sibling SL/TP triggered' }); } catch (_) {}
              }
            }
          }

          console.log(`[PaperMonitor] TRIGGERED: ${entry.orderType} ${entry.side} ${entry.symbol} @ LTP ${ltp} (trigger=${triggerPrice} limit=${limitPrice}) positionId=${positionId || 'n/a'}`);

          // ── Route through exitPosition() for SL/TP exits ──────────────────
          // exitPosition() owns: _exitInFlight concurrency guard, position
          // qty=0 / closed_at check, correct exit-side derivation from position.side,
          // and position qty from the live DB row (not the order's original qty).
          // This is the ONLY correct way to close a paper position.
          if (positionId) {
            try {
              await this.exitPosition(entry.accountId, positionId);
              // Mark the triggering order as FILLED
              try { await orderRepo.markFilled(orderId, entry.orderParams.qty, ltp, 'PAPER-TRIGGER-' + orderId); } catch (_) {}
            } catch (exitErr) {
              console.warn(`[PaperMonitor] exitPosition failed for ${positionId}: ${exitErr.message}`);
              // Mark order cancelled if position was already closed
              try { await orderRepo.updateStatus(orderId, 'CANCELLED', { reject_reason: exitErr.message }); } catch (_) {}
            }
          } else {
            // Non-SL/TP paper order (standalone LIMIT/SL placed via OrderPanel) —
            // use _handleMarketFill as before since there's no positionId to guard.
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
   * Resolve LTP for a pending order by checking all possible token representations.
   * Handles Angel ↔ Dhan token mismatches and symbol-based fallbacks.
   */
  _resolveLtpForOrder(entry) {
    const token = entry.token;
    
    // 1. Direct token lookup
    let ltp = this.marketDataEngine.getQuote(token)?.ltp;
    if (ltp && ltp > 0) return ltp;

    // 2. Angel ↔ Dhan token alias mapping (indices)
    const ANGEL_TO_DHAN = { '99926000': '13', '99926009': '25', '99926037': '27', '99926074': '442', '99919000': '51' };
    const DHAN_TO_ANGEL = { '13': '99926000', '25': '99926009', '27': '99926037', '442': '99926074', '51': '99919000' };
    const altToken = ANGEL_TO_DHAN[token] || DHAN_TO_ANGEL[token];
    if (altToken) {
      ltp = this.marketDataEngine.getQuote(altToken)?.ltp;
      if (ltp && ltp > 0) return ltp;
    }

    // 3. Symbol-based lookup: scan all quotes for matching symbol name
    if (entry.symbol) {
      const sym = entry.symbol.toUpperCase().trim();
      for (const [qToken, quote] of this.marketDataEngine.quotes) {
        if (quote.symbol && quote.symbol.toUpperCase().trim() === sym && quote.ltp > 0) {
          return quote.ltp;
        }
      }
    }

    // 4. Candle service fallback
    if (this._candleService) {
      const candle = this._candleService.getCurrentCandle(token, '1');
      if (candle?.close > 0) return candle.close;
      // Also try alt token
      if (altToken) {
        const altCandle = this._candleService.getCurrentCandle(altToken, '1');
        if (altCandle?.close > 0) return altCandle.close;
      }
    }

    // 5. Depth midpoint
    const depth = this.marketDataEngine.depthCache?.get(token) || (altToken ? this.marketDataEngine.depthCache?.get(altToken) : null);
    if (depth?.bids?.[0]?.price && depth?.asks?.[0]?.price) {
      return (depth.bids[0].price + depth.asks[0].price) / 2;
    }

    return null;
  }

  /**
   * Register an open paper SL/LIMIT order for price monitoring.
   *
   * @param {string} orderId
   * @param {string} accountId
   * @param {object} orderParams
   * @param {string} [positionId] - DB position ID this order closes (required for SL/TP orders).
   *   When present, the monitor verifies the position is still open before executing and
   *   cancels all sibling orders for the same position when this one fires.
   */
  _registerPaperOrder(orderId, accountId, orderParams, positionId = null) {
    this._pendingPaperOrders.set(orderId, {
      accountId,
      positionId,          // null for standalone orders, set for SL/TP exit orders
      token: orderParams.token,
      symbol: orderParams.symbol,
      side: orderParams.side,
      orderType: orderParams.orderType,
      triggerPrice: orderParams.triggerPrice || 0,
      price: orderParams.price || 0,
      orderParams,
    });

    // ── Ensure the token has a live LTP in the quote cache ─────────────────
    // For option tokens the live feed may not yet carry a quote (they are
    // only subscribed on demand from the option chain modal).  Seed the cache
    // from the order price so:
    //   1. LIMIT option orders in paper mode can fire immediately if the
    //      seed price satisfies the trigger condition.
    //   2. The fill price used by _handleMarketFill is non-zero.
    // The seeded value is intentionally marked as a fallback so any real tick
    // that arrives later overwrites it.
    const existingLtp = this.marketDataEngine.getQuote(orderParams.token)?.ltp;
    if ((!existingLtp || existingLtp <= 0) && orderParams.price > 0) {
      // Inject the order price as a synthetic LTP so the monitor can evaluate
      // LIMIT trigger conditions even before the live feed delivers a tick.
      // pushQuote validates that ltp > 0 — safe to call here.
      this.marketDataEngine.pushQuote(orderParams.token, {
        ltp: orderParams.price,
        symbol: orderParams.symbol,
        exchange: orderParams.segment || orderParams.exchange || 'NFO',
        timestamp: Date.now(),
      });
      console.log(`[PaperMonitor] Seeded LTP ${orderParams.price} for ${orderParams.symbol} (token ${orderParams.token}) from order price`);
    } else if (!existingLtp || existingLtp <= 0) {
      // No price at all — subscribe so the live poller picks it up
      this.marketDataEngine.subscribe(orderParams.token, () => {});
    }

    console.log(`[PaperMonitor] Registered ${orderParams.orderType} ${orderParams.side} ${orderParams.symbol} positionId=${positionId || 'none'} (trigger=${orderParams.triggerPrice || ''} limit=${orderParams.price || ''})`);
  }

  /**
   * Recover pending OPEN SL/LIMIT orders from database on startup.
   * Ensures orders survive server restarts.
   *
   * SAFETY: Only recover orders whose linked position is still open.
   * Orders for already-closed positions are stale and must NOT be re-armed —
   * doing so would trigger phantom exits on positions that no longer exist,
   * creating ghost reversal positions.
   */
  async recoverPendingOrders() {
    try {
      if (!supabase) return;
      const { data: openOrders, error } = await supabase
        .from('trading_orders')
        .select('*')
        .in('status', ['OPEN', 'PENDING'])
        .in('order_type', ['LIMIT', 'SL', 'SL-M']);
      if (error || !openOrders || openOrders.length === 0) return;

      // Pre-fetch all open positions for fast position-state lookup
      let openPositionIds = new Set();
      try {
        const { data: positions } = await supabase
          .from('positions')
          .select('id')
          .eq('is_open', true)
          .gt('qty', 0);
        if (positions) positions.forEach(p => openPositionIds.add(p.id));
      } catch (_) { /* non-critical — proceed without position filter */ }
      
      let recovered = 0;
      let skipped = 0;
      for (const order of openOrders) {
        if (this._pendingPaperOrders.has(order.id)) continue;

        // Skip orders whose position is already closed
        const posId = order.position_id || null;
        if (posId && openPositionIds.size > 0 && !openPositionIds.has(posId)) {
          console.log(`[PaperMonitor] Skipping stale order ${order.id} — position ${posId} is closed`);
          try { await orderRepo.updateStatus(order.id, 'CANCELLED', { reject_reason: 'Position closed before server restart' }); } catch (_) {}
          skipped++;
          continue;
        }

        this._pendingPaperOrders.set(order.id, {
          accountId: order.trading_account_id,
          positionId: posId,
          token: order.token,
          symbol: order.symbol,
          side: order.side,
          orderType: order.order_type,
          triggerPrice: order.trigger_price || 0,
          price: order.price || 0,
          orderParams: {
            symbol: order.symbol,
            token: order.token,
            segment: order.segment || 'NSE',
            exchange: order.segment || 'NSE',
            side: order.side,
            orderType: order.order_type,
            productType: order.product_type || 'MIS',
            qty: order.qty,
            price: order.price || 0,
            triggerPrice: order.trigger_price || 0,
          },
        });
        recovered++;
      }
      if (recovered > 0 || skipped > 0) {
        console.log(`[PaperMonitor] Recovered ${recovered} pending SL/LIMIT orders (skipped ${skipped} stale)`);
      }
    } catch (e) {
      console.warn(`[PaperMonitor] Recovery failed: ${e.message}`);
    }
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
      account = { id: accountId, broker_provider: 'dhan', balance: 0, status: 'active' };
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
      const brokerProvider = account.broker_provider || account.brokerProvider || 'dhan';
      let brokerResponse;

      // Check execution mode — paper mode simulates fill without real broker call.
      // Account-level paper: if this account's broker_provider is 'paper', always
      // simulate regardless of the global EXECUTION_MODE env var. This prevents
      // BrokerFactory from receiving 'paper' as a provider key, which hits the
      // default case and throws "[BrokerFactory] Unknown broker provider: paper".
      const { ExecutionMode } = await import('./executionMode.js');
      const isAccountPaper = brokerProvider === 'paper';

      if (ExecutionMode.isPaper || isAccountPaper) {
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
        let durableOrder;
        try {
          durableOrder = await orderRepo.findById(orderId);
        } catch (persistenceError) {
          return await this._markPendingReconciliation(
            accountId,
            orderId,
            orderParams.correlationId || buildOrderCorrelationId(accountId, orderId),
            brokerProvider,
            `Durable order lookup unavailable: ${persistenceError.message}`
          );
        }

        if (durableOrder?.status === 'PENDING_RECONCILIATION') {
          return {
            orderId,
            status: 'PENDING_RECONCILIATION',
            correlationId: durableOrder.correlation_id || orderParams.correlationId,
            message: 'Order is unresolved and cannot be resubmitted',
          };
        }

        const correlationId = durableOrder?.correlation_id;
        if (!correlationId) {
          return await this._markPendingReconciliation(
            accountId,
            orderId,
            orderParams.correlationId || buildOrderCorrelationId(accountId, orderId),
            brokerProvider,
            'Durable correlation state unavailable; broker submission blocked'
          );
        }
        orderParams.correlationId = correlationId;

        const idempotencyKey = durableOrder?.idempotency_key;
        if (!idempotencyKey) {
          return await this._markPendingReconciliation(
            accountId,
            orderId,
            correlationId,
            brokerProvider,
            'Durable idempotency state unavailable; broker submission blocked'
          );
        }
        orderParams.idempotencyKey = idempotencyKey;

        if (!durableOrder?.correlation_id) {
          try {
            await orderRepo.persistCorrelationState(orderId, accountId, correlationId);
          } catch (persistenceError) {
            return await this._markPendingReconciliation(
              accountId,
              orderId,
              correlationId,
              brokerProvider,
              `Correlation persistence unavailable: ${persistenceError.message}`
            );
          }
        }

        recoveryStates.set(orderId, {
          accountId,
          orderParams: { ...orderParams },
          brokerProvider,
          correlationId,
        });

        // A cached reconciliation result must never authorize live trading.
        // Refresh both broker and database positions immediately before adapter creation.
        try {
          const reconciliation = await this.positionReconciliationService.reconcile(accountId, account);
          if (!reconciliation || reconciliation.status !== 'MATCH' || reconciliation.safe !== true) {
            const status = reconciliation?.status || 'UNAVAILABLE';
            throw new Error(`fresh position reconciliation returned ${status}`);
          }
        } catch (reconciliationError) {
          const reason = `Position reconciliation safety check failed: ${reconciliationError.message}`;
          try {
            await orderRepo.markRejected(orderId, reason);
          } catch (e) { /* best effort */ }
          eventBus.publish('order.updated', {
            orderId,
            status: 'REJECTED',
            rejectReason: reason,
            reconciliationBlocked: true,
            correlationId,
          }, { accountId });
          return { orderId, status: 'REJECTED', safety: 'POSITION_RECONCILIATION_BLOCKED', message: reason };
        }

        let adapter;
        try {
          adapter = await BrokerFactory.create(brokerProvider);

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
            correlationId,
            idempotencyKey: orderParams.idempotencyKey,
          });
        } catch (brokerErr) {
          if (OrderExecutionService.isBrokerUncertainty(brokerErr)) {
            return await this._markPendingReconciliation(
              accountId,
              orderId,
              correlationId,
              brokerProvider,
              `Broker response uncertain: ${brokerErr.message}`
            );
          }

          // Adapter creation or an explicit broker rejection is not retried.
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

      if (['TIMEOUT', 'UNKNOWN', 'API_ERROR'].includes(brokerStatus) || !brokerStatus) {
        return await this._markPendingReconciliation(
          accountId,
          orderId,
          brokerResponse.correlationId || orderParams.correlationId,
          brokerProvider,
          brokerResponse.message || 'Broker response uncertain'
        );
      }

      // ── Step 3: Handle Broker Response ────────────────────────
      if (brokerStatus === 'REJECTED' || brokerStatus === 'FAILED' || brokerStatus === 'API_ERROR') {
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
      const confirmedFill = ['FILLED', 'TRADED', 'COMPLETE', 'COMPLETED'].includes(brokerStatus);
      if (orderParams.orderType === 'MARKET' && confirmedFill) {
        return await this._handleMarketFill(accountId, orderId, orderParams, brokerOrderId, brokerProvider, latencyMs, account);
      } else {
        // Unfilled accepted orders, including MARKET orders without a confirmed
        // fill, remain broker-linked and are resolved by status recovery.
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

  async recoverTimedOutOrder(orderId, account = {}) {
    let state = recoveryStates.get(orderId);
    if (!state) {
      let order;
      try {
        order = await orderRepo.findById(orderId);
      } catch (error) {
        return { orderId, status: 'PENDING_RECONCILIATION', recoverable: false, reason: error.message };
      }

      if (!order?.correlation_id || !order.trading_account_id) {
        return { orderId, status: 'PENDING_RECONCILIATION', recoverable: false, reason: 'Persisted correlation state unavailable' };
      }

      let correlatedOrder;
      try {
        correlatedOrder = await orderRepo.findByCorrelationId(order.trading_account_id, order.correlation_id);
      } catch (error) {
        return { orderId, status: 'PENDING_RECONCILIATION', recoverable: false, reason: `correlation lookup ambiguous or unavailable: ${error.message}` };
      }
      if (!correlatedOrder || correlatedOrder.id !== orderId) {
        return { orderId, status: 'PENDING_RECONCILIATION', recoverable: false, reason: 'Persisted correlation state unavailable' };
      }

      state = {
        accountId: order.trading_account_id,
        orderParams: {
          symbol: order.symbol,
          token: order.token,
          segment: order.segment,
          side: order.side,
          qty: order.qty,
          orderType: order.order_type,
          productType: order.product_type,
          price: order.price,
          triggerPrice: order.trigger_price,
        },
        brokerProvider: account.broker_provider || account.brokerProvider || 'dhan',
        correlationId: order.correlation_id,
      };
      recoveryStates.set(orderId, state);
    }

    if (state.recoveryPromise) return state.recoveryPromise;

    state.recoveryPromise = (async () => {
      let adapter;
      try {
        adapter = await BrokerFactory.create(state.brokerProvider);
      } catch (error) {
        return { orderId, status: 'PENDING_RECONCILIATION', correlationId: state.correlationId, recoverable: false, recoveryError: error.message };
      }

      let brokerOrders;
      try {
        brokerOrders = await adapter.getOrders({ correlationId: state.correlationId });
      } catch (error) {
        return { orderId, status: 'PENDING_RECONCILIATION', correlationId: state.correlationId, recoverable: false, recoveryError: error.message };
      }

      const matchingBrokerOrders = (brokerOrders || []).filter((candidate) => {
        const candidateCorrelation = candidate.correlationId || candidate.correlationID || candidate.correlation_id;
        return candidateCorrelation === state.correlationId;
      });

      if (matchingBrokerOrders.length !== 1) {
        return {
          orderId,
          status: 'PENDING_RECONCILIATION',
          correlationId: state.correlationId,
          recoverable: false,
          reason: matchingBrokerOrders.length > 1 ? 'ambiguous broker correlation' : 'broker order not found',
        };
      }

      const brokerOrder = matchingBrokerOrders[0];
      const brokerOrderId = brokerOrder.brokerOrderId || brokerOrder.orderId || brokerOrder.id;
      const brokerStatus = String(brokerOrder.status || '').toUpperCase();

      if (['REJECTED', 'FAILED'].includes(brokerStatus)) {
        await orderRepo.markRejected(orderId, brokerOrder.message || 'Explicit broker rejection');
        return { orderId, brokerOrderId, correlationId: state.correlationId, status: 'REJECTED' };
      }

      const filledQty = Number(brokerOrder.filledQty ?? brokerOrder.filledQuantity ?? 0);
      if (brokerStatus === 'FILLED' || brokerStatus === 'TRADED' || filledQty > 0) {
        await this.handleBrokerFill(state.accountId, orderId, {
          filledQty: filledQty || state.orderParams.qty,
          avgPrice: brokerOrder.avgPrice ?? brokerOrder.averagePrice ?? state.orderParams.price,
          brokerOrderId,
        });
        return { orderId, brokerOrderId, correlationId: state.correlationId, status: 'FILLED' };
      }

      await orderRepo.updateStatus(orderId, 'OPEN', { broker_order_id: brokerOrderId });
      return { orderId, brokerOrderId, correlationId: state.correlationId, status: brokerStatus || 'OPEN' };
    })();

    try {
      return await state.recoveryPromise;
    } finally {
      state.recoveryPromise = null;
    }
  }

  /**
   * Handle market order fill — INSTANT execution (<50ms).
   * Uses synchronous cache LTP only. No blocking network calls in the hot path.
    * Confirmed-fill persistence completes before final lifecycle events are emitted.
   */
  async _handleMarketFill(accountId, orderId, orderParams, brokerOrderId, brokerProvider, latencyMs, account = null) {
    // Safe resolution: ensure account is available for post-trade risk checks
    if (!account && accountId) {
      try { account = await this._getAccount(accountId); } catch (_) {}
    }

    // ── Fill price: SYNCHRONOUS cache-only lookup (zero network latency) ──
    // Priority: live LTP cache > Angel/Dhan alias > explicit order price > depth midpoint
    const quote = this.marketDataEngine.getQuote(orderParams.token);
    const rawLtp = quote?.ltp;
    let fillPrice = (rawLtp && Number.isFinite(rawLtp) && rawLtp > 0) ? rawLtp : null;

    // Try Angel ↔ Dhan token alias (indices)
    if (!fillPrice) {
      const ANGEL_TO_DHAN = { '99926000': '13', '99926009': '25', '99926037': '27', '99926074': '442', '99919000': '51' };
      const DHAN_TO_ANGEL = { '13': '99926000', '25': '99926009', '27': '99926037', '442': '99926074', '51': '99919000' };
      const altToken = ANGEL_TO_DHAN[orderParams.token] || DHAN_TO_ANGEL[orderParams.token];
      if (altToken) {
        const altQuote = this.marketDataEngine.getQuote(altToken);
        if (altQuote?.ltp > 0) fillPrice = altQuote.ltp;
      }
    }

    // Fallback: use order price (from option chain LTP at order-creation time)
    // This is the primary fill source for OPTION trades where the option token
    // is not in the live subscription list.
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

    // ── Close-order fallback: use position's last known LTP or avg price ──
    // For exit orders the position row always carries a recent ltp / avg_price.
    // Using it as the fill price is far safer than rejecting the order outright
    // — the trader gets a fill at a slightly stale price rather than being
    // unable to close their position at all.
    if (!fillPrice && orderParams.isCloseOrder) {
      const posLtp = Number(orderParams.positionLtp);
      const posAvg = Number(orderParams.positionAvgPrice);
      if (posLtp > 0) {
        fillPrice = posLtp;
        console.warn(`[OrderExecution] Close-order LTP fallback: using position.ltp ${fillPrice} for ${orderParams.symbol} (${orderId})`);
      } else if (posAvg > 0) {
        fillPrice = posAvg;
        console.warn(`[OrderExecution] Close-order LTP fallback: using position.avgPrice ${fillPrice} for ${orderParams.symbol} (${orderId})`);
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

    // Persist the confirmed fill before publishing final lifecycle events.
    try {
      await orderRepo.markFilled(orderId, filledQty, fillPrice, brokerOrderId);
      await positionRepo.upsertPosition(accountId, {
        symbol: orderParams.symbol, token: orderParams.token,
        segment: orderParams.segment, exchange: orderParams.exchange || orderParams.segment,
        productType: orderParams.productType, side: orderParams.side,
        qty: filledQty, price: fillPrice,
      });
      await tradeRepo.recordTrade(accountId, orderId, {
        symbol: orderParams.symbol, token: orderParams.token,
        segment: orderParams.segment, exchange: orderParams.exchange || orderParams.segment,
        side: orderParams.side, qty: filledQty, price: fillPrice,
      });
    } catch (persistenceError) {
      return await this._markPendingReconciliation(
        accountId,
        orderId,
        orderParams.correlationId,
        brokerProvider,
        `Confirmed broker fill persistence failed: ${persistenceError.message}`
      );
    }

    eventBus.publish('order.updated', {
      orderId, status: 'FILLED',
      symbol: orderParams.symbol, token: orderParams.token,
      segment: orderParams.segment, side: orderParams.side,
      filledQty, avgPrice: fillPrice,
      brokerOrderId, brokerProvider, latencyMs,
      qty: orderParams.qty,
    }, { accountId });

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

    eventBus.publish('trade.executed', {
      orderId, symbol: orderParams.symbol, token: orderParams.token,
      segment: orderParams.segment, side: orderParams.side,
      qty: filledQty, price: fillPrice,
      executedAt: new Date().toISOString(),
    }, { accountId });

    if (account) {
      this._postTradeRiskCheck(accountId, orderParams, account).catch(() => {});
    }

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
    const { filledQty, brokerOrderId } = fillData;
    // avgPrice may be 0 or undefined when Dhan returns a TRADED status without
    // a tradedPrice (e.g. during pre-open or for certain order types).
    // Fall back to the live LTP cache so the position is never created at price 0.
    let avgPrice = fillData.avgPrice && fillData.avgPrice > 0 ? fillData.avgPrice : null;

    // Get the original order
    let order;
    try {
      order = await this._findOrder(orderId);
    } catch (e) {
      order = null;
    }

    if (!order) {
      console.error(`[OrderExecution] handleBrokerFill: order ${orderId} not found`);
      return;
    }

    // If Dhan did not return a fill price, resolve from the live LTP cache
    if (!avgPrice) {
      avgPrice = this.marketDataEngine.getQuote(order.token)?.ltp || null;
    }
    // Last resort: use order's limit price (for LIMIT orders)
    if (!avgPrice && order.price > 0) {
      avgPrice = parseFloat(order.price);
    }
    // If still no price, log a warning and default to 0 (position will be created
    // but P&L will be computed from live LTP once it arrives)
    if (!avgPrice) {
      console.warn(`[OrderExecution] handleBrokerFill: no avgPrice available for order ${orderId} (${order.symbol}) — defaulting to 0`);
      avgPrice = 0;
    }

    // Determine if partial or full fill
    const totalFilled = (order.filled_qty || 0) + filledQty;
    const isFullyFilled = totalFilled >= order.qty;
    const newStatus = isFullyFilled ? 'FILLED' : 'PARTIAL';

    // Update order status — use 'PARTIALLY_FILLED' for partial fills so the
    // DB status matches Dhan's terminology and the poller can continue polling.
    const newDbStatus = isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED';
    await orderRepo.updateStatus(orderId, newDbStatus, {
      filled_qty: totalFilled,
      avg_fill_price: avgPrice,   // correct column name in trading_orders
      broker_order_id: brokerOrderId,
    });

    eventBus.publish('order.updated', {
      orderId,
      status: isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED',
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
      // Carry the position's last known LTP and avg price as fill-price fallbacks.
      // _handleMarketFill will use these if the live quote cache is cold/empty,
      // ensuring a close order never fails with "LTP unavailable".
      positionLtp: position.ltp || null,
      positionAvgPrice: position.avg_price || position.avgPrice || null,
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
   *
   * IDEMPOTENCY: If a previous SL order is already registered in the paper
   * monitor for this position, it is cancelled before registering the new one.
   * This prevents two SL orders co-existing for the same position (e.g. when
   * the user moves the SL — a common action that previously left the old SL
   * alive in _pendingPaperOrders and could fire after the new SL was set).
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
      // Cancel any previous SL order for this position so only one SL is active
      this._cancelPendingOrdersForPosition(positionId, 'SL-M');
      try { await orderRepo.updateStatus(order.id, 'OPEN', { trigger_price: triggerPrice }); } catch {}
      eventBus.publish('order.updated', { orderId: order.id, status: 'OPEN', ...orderParams }, { accountId });
      // Register with monitor — positionId guards against ghost fills
      this._registerPaperOrder(order.id, accountId, orderParams, positionId);
      return { orderId: order.id, status: 'OPEN', type: 'SL-M', triggerPrice };
    }

    const result = await this.executeOrder(accountId, order.id, orderParams, account);
    return result;
  }

  /**
   * Attach a take-profit order to an open position.
   * Places a LIMIT order at the specified target price.
   *
   * IDEMPOTENCY: Cancels any previous TP order for this position first.
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
      // Cancel any previous TP order for this position so only one TP is active
      this._cancelPendingOrdersForPosition(positionId, 'LIMIT');
      try { await orderRepo.updateStatus(order.id, 'OPEN', { price: targetPrice }); } catch {}
      eventBus.publish('order.updated', { orderId: order.id, status: 'OPEN', ...orderParams }, { accountId });
      // Register with monitor — positionId guards against ghost fills
      this._registerPaperOrder(order.id, accountId, orderParams, positionId);
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

  /**
   * Remove all pending paper orders for a given positionId that match an
   * optional order type filter.  Used by attachStopLoss / attachTakeProfit
   * to ensure only one SL and one TP is live per position at any time.
   *
   * @param {string} positionId
   * @param {string} [orderType] - if provided, only cancel orders of this type
   */
  _cancelPendingOrdersForPosition(positionId, orderType = null) {
    if (!positionId) return;
    for (const [oid, entry] of this._pendingPaperOrders) {
      if (entry.positionId === positionId) {
        if (orderType && entry.orderType !== orderType) continue;
        this._pendingPaperOrders.delete(oid);
        console.log(`[PaperMonitor] Replaced old ${entry.orderType} order ${oid} for position ${positionId}`);
        orderRepo.updateStatus(oid, 'CANCELLED', { reject_reason: 'Replaced by new SL/TP order' }).catch(() => {});
      }
    }
  }

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
        broker_provider: 'dhan',
        balance: 10000000,
        leverage_max: 50,
        status: 'active',
      };
    }
    if (!supabase) return { id: accountId, broker_provider: 'dhan', balance: 1000000, leverage_max: 10, status: 'active' };
    const { data, error } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    if (error || !data) {
      // Fallback: don't return 0 balance which blocks ALL orders
      return { id: accountId, broker_provider: 'dhan', balance: 1000000, leverage_max: 10, status: 'active' };
    }
    // Ensure leverage_max has a sane default
    if (!data.leverage_max || data.leverage_max <= 0) {
      data.leverage_max = 10; // Standard prop-firm intraday leverage
    }
    return data;
  }
}
