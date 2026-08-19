/**
 * DHAN ORDER STATUS POLLER
 *
 * Polls Dhan's GET /v2/orders every 5 seconds for every FundedWealth order
 * that is in PENDING / OPEN / PARTIALLY_FILLED state.
 *
 * When Dhan reports a fill (TRADED / PART_TRADED) the existing
 * OrderExecutionService.handleBrokerFill() path is invoked — the same path
 * used by paper-mode fills. No new order lifecycle logic is introduced.
 *
 * Idempotency:
 *   The in-memory _processedFills Set tracks "orderId:totalFilled" keys so
 *   that a repeated poll seeing the same TRADED status does not re-invoke
 *   handleBrokerFill. The set is also backed by the DB filled_qty column —
 *   on restart the poller re-reads filled_qty from the DB and rehydrates the
 *   set, so a fill that was already processed before a crash is never
 *   duplicated.
 *
 * Restart recovery:
 *   On startup the poller loads all OPEN/PENDING/PARTIALLY_FILLED orders from
 *   the DB and checks their live Dhan status immediately (first tick fires
 *   after INITIAL_DELAY_MS to let other services initialize first). Orders
 *   that filled while the server was down are caught on the first poll cycle.
 *
 * Scope:
 *   - Dhan only (provider === 'dhan' or broker_order_id starts with numeric)
 *   - Non-paper orders only (broker_order_id that does NOT start with 'PAPER-')
 *   - Only accounts where the Dhan adapter is available and the token is valid
 *
 * Do NOT modify:
 *   - MarketDataEngine
 *   - Risk Engine
 *   - Position architecture
 *   - Any other broker adapter
 */

import { supabase } from '../db/client.js';
import { OrderRepository } from '../repositories/order.repository.js';
import { eventBus } from '../events/index.js';

const POLL_INTERVAL_MS = 5000;     // 5-second poll cycle
const INITIAL_DELAY_MS = 8000;     // Wait 8s after startup before first poll
const MAX_CONSECUTIVE_ERRORS = 5;  // Pause polling after this many consecutive failures

const orderRepo = new OrderRepository();

export class DhanOrderPoller {
  /**
   * @param {import('./orderExecutionService.js').OrderExecutionService} executionService
   * @param {import('../brokers/dhan/dhan.adapter.js').DhanAdapter} dhanAdapter
   */
  constructor(executionService, dhanAdapter) {
    this._executionService = executionService;
    this._dhanAdapter      = dhanAdapter;

    this._timer             = null;
    this._running           = false;
    this._consecutiveErrors = 0;

    // Idempotency: "orderId:filledQty" → true
    // Persisted across polls; rehydrated from DB on start.
    this._processedFills = new Set();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    console.log(`[DhanPoller] Started — polling every ${POLL_INTERVAL_MS / 1000}s (initial delay ${INITIAL_DELAY_MS / 1000}s)`);

    // Brief delay so other services (DB, broker factory) are fully initialised
    this._timer = setTimeout(() => this._loop(), INITIAL_DELAY_MS);
  }

  stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    console.log('[DhanPoller] Stopped');
  }

  // ─── Main polling loop ────────────────────────────────────────────────────

  async _loop() {
    if (!this._running) return;

    try {
      await this._poll();
      this._consecutiveErrors = 0;
    } catch (err) {
      this._consecutiveErrors++;
      // Never log credentials — only the sanitized error message
      console.error(`[DhanPoller] Poll error (${this._consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err.message);
      if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.warn('[DhanPoller] Too many consecutive errors — pausing 60s before retry');
        if (this._running) {
          this._timer = setTimeout(() => {
            this._consecutiveErrors = 0;
            this._loop();
          }, 60000);
          return;
        }
      }
    }

    if (this._running) {
      this._timer = setTimeout(() => this._loop(), POLL_INTERVAL_MS);
    }
  }

  // ─── Core poll: find open orders and check their Dhan status ─────────────

  async _poll() {
    if (!supabase) return;

    // Guard: Dhan adapter must be available and auth valid
    if (!this._dhanAdapter?.auth?.isTokenValid) {
      console.warn('[DhanPoller] Dhan token not valid — skipping poll cycle');
      return;
    }

    // Find all OPEN/PENDING/PARTIALLY_FILLED orders that have a real Dhan
    // broker_order_id (not a PAPER- id, not null).
    const { data: openOrders, error } = await supabase
      .from('trading_orders')
      .select('id, trading_account_id, broker_order_id, order_type, qty, filled_qty, symbol, token, segment, side, product_type, exchange, placed_at')
      .in('status', ['PENDING', 'OPEN', 'PARTIALLY_FILLED'])
      .not('broker_order_id', 'is', null)
      .not('broker_order_id', 'like', 'PAPER-%');

    if (error) {
      throw new Error(`DB query failed: ${error.message}`);
    }
    if (!openOrders || openOrders.length === 0) return;

    // Rehydrate idempotency set from DB filled_qty (handles restart recovery).
    // If the DB already shows filled_qty > 0 for an order, that fill was
    // already persisted — do not reprocess it.
    for (const order of openOrders) {
      if ((order.filled_qty || 0) > 0) {
        const idempotencyKey = `${order.id}:${order.filled_qty}`;
        this._processedFills.add(idempotencyKey);
      }
    }

    // Process each open order — one Dhan API call each.
    // Batching is possible with GET /v2/orders (returns ALL today's orders)
    // but we use per-order status calls to isolate failures.
    for (const order of openOrders) {
      if (!this._running) break;
      await this._checkOrder(order);
    }
  }

  // ─── Check a single order against Dhan ───────────────────────────────────

  async _checkOrder(order) {
    const dhanOrderId = order.broker_order_id;

    let dhanOrder;
    try {
      dhanOrder = await this._dhanAdapter.getOrderStatus(dhanOrderId);
    } catch (err) {
      // Individual order check failure — log and continue, do not abort the loop
      console.warn(`[DhanPoller] Status check failed for order ${order.id} (Dhan: ${dhanOrderId}):`, err.message);
      return;
    }

    if (!dhanOrder) {
      console.warn(`[DhanPoller] No status returned for Dhan order ${dhanOrderId}`);
      return;
    }

    // Raw Dhan status (NOT run through _mapStatus — we need PART_TRADED directly)
    const rawStatus  = (dhanOrder.raw?.orderStatus || dhanOrder.status || '').toUpperCase();
    const tradedQty  = parseInt(dhanOrder.filledQty ?? dhanOrder.raw?.filledQty ?? 0);
    const avgPrice   = parseFloat(dhanOrder.avgPrice  ?? dhanOrder.raw?.tradedPrice ?? 0);

    if (!rawStatus) return;

    // ── Dispatch based on raw Dhan status ─────────────────────────────────
    switch (rawStatus) {

      case 'TRADED': {
        // Full fill — compute DELTA only (Dhan tradedQty is cumulative).
        // If the order was previously PART_TRADED (filled_qty=25) and Dhan now
        // reports TRADED with tradedQty=50, only the remaining 25 must be sent
        // to handleBrokerFill(). Sending the full 50 would double-count the
        // first 25 and create an inflated position.
        const fillQty = tradedQty > 0
          ? Math.max(0, tradedQty - (order.filled_qty || 0))
          : Math.max(0, order.qty  - (order.filled_qty || 0));
        await this._handleFill(order, fillQty, avgPrice, dhanOrderId, /* isFullFill */ true);
        break;
      }

      case 'PART_TRADED': {
        // Partial fill — process the NEW increment only
        const totalFilledAtDhan = tradedQty;
        const alreadyRecorded   = order.filled_qty || 0;
        const newQty            = totalFilledAtDhan - alreadyRecorded;

        if (newQty > 0) {
          await this._handleFill(order, newQty, avgPrice, dhanOrderId, /* isFullFill */ false);
        }
        break;
      }

      case 'CANCELLED':
      case 'REJECTED':
      case 'EXPIRED': {
        await this._handleTerminal(order, rawStatus, dhanOrder.raw?.rejectionReason || dhanOrder.message || rawStatus);
        break;
      }

      // PENDING / TRANSIT / OPEN — still live, nothing to do
      default:
        break;
    }
  }

  // ─── Process a fill (TRADED or PART_TRADED increment) ────────────────────

  async _handleFill(order, fillQty, avgPrice, dhanOrderId, isFullFill) {
    if (!fillQty || fillQty <= 0) return;

    // Calculate what the total filled qty will be AFTER this increment
    const alreadyFilled  = order.filled_qty || 0;
    const totalAfterFill = alreadyFilled + fillQty;

    // Idempotency key: orderId + total filled qty after this increment.
    // If the same quantity has already been recorded (either from a prior
    // poll cycle or from the optimistic paper-mode path), skip it.
    const idempotencyKey = `${order.id}:${totalAfterFill}`;
    if (this._processedFills.has(idempotencyKey)) {
      // Already processed this fill increment — ignore
      return;
    }
    this._processedFills.add(idempotencyKey);

    console.log(
      `[DhanPoller] ${isFullFill ? 'FULL' : 'PARTIAL'} fill detected: ` +
      `order=${order.id} dhan=${dhanOrderId} ` +
      `symbol=${order.symbol} side=${order.side} ` +
      `fillQty=${fillQty} avgPrice=${avgPrice} ` +
      `totalFilled=${totalAfterFill}/${order.qty}`
    );

    try {
      // Delegate entirely to the existing fill-processing path.
      // handleBrokerFill() handles: order status update, position upsert,
      // trade record, post-trade risk check, and event bus publication.
      await this._executionService.handleBrokerFill(
        order.trading_account_id,
        order.id,
        {
          filledQty:   fillQty,
          avgPrice:    avgPrice > 0 ? avgPrice : undefined,
          brokerOrderId: dhanOrderId,
          isPartial:   !isFullFill,
        }
      );
    } catch (err) {
      // Unexpected error in fill processing — remove from idempotency set
      // so the next poll cycle can retry
      this._processedFills.delete(idempotencyKey);
      console.error(`[DhanPoller] handleBrokerFill failed for order ${order.id}:`, err.message);
    }
  }

  // ─── Terminal status: REJECTED / CANCELLED / EXPIRED ─────────────────────

  async _handleTerminal(order, rawStatus, reason) {
    const idempotencyKey = `${order.id}:terminal:${rawStatus}`;
    if (this._processedFills.has(idempotencyKey)) return;
    this._processedFills.add(idempotencyKey);

    console.log(
      `[DhanPoller] Terminal status for order ${order.id} ` +
      `(${order.symbol}): ${rawStatus} — ${reason}`
    );

    // Map to FundedWealth status
    const fwStatus = rawStatus === 'REJECTED' ? 'REJECTED'
                   : rawStatus === 'EXPIRED'  ? 'CANCELLED'
                   : 'CANCELLED';

    try {
      await orderRepo.updateStatus(order.id, fwStatus, {
        reject_reason: reason || rawStatus,
      });
    } catch (e) {
      console.error(`[DhanPoller] Failed to mark order ${order.id} as ${fwStatus}:`, e.message);
    }

    // Publish event so the frontend order book updates
    eventBus.publish('order.updated', {
      orderId:      order.id,
      status:       fwStatus,
      rejectReason: reason || rawStatus,
      symbol:       order.symbol,
      token:        order.token,
      segment:      order.segment,
      side:         order.side,
    }, { accountId: order.trading_account_id });
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  getStatus() {
    return {
      running:          this._running,
      processedFills:   this._processedFills.size,
      consecutiveErrors: this._consecutiveErrors,
    };
  }
}
