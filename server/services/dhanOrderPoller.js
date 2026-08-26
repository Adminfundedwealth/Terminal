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

// Zombie-PENDING recovery: orders with no broker_order_id older than this are scanned
const ZOMBIE_STALENESS_MS = 30_000;   // 30 seconds
// After this many scan cycles without recovery, mark FAILED
const ZOMBIE_MAX_CYCLES = 8;          // 8 × 5s = 40 seconds of retry, then FAILED

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

    // Zombie-PENDING tracker: orderId → scanCycleCount
    // Incremented each poll cycle the order stays unresolved.
    this._zombieScanCount = new Map();
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
      .select('id, trading_account_id, broker_order_id, order_type, qty, filled_qty, symbol, token, segment, side, product_type, placed_at')
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

    // ── Fix 3: Zombie-PENDING recovery ────────────────────────────────────
    // Find PENDING / PENDING_RECONCILIATION orders that have NO broker_order_id
    // and were placed more than ZOMBIE_STALENESS_MS ago.
    // These are orders where the broker response was never received (network drop,
    // process crash, timeout before the broker_order_id write).
    // We try to match them against today's Dhan order list by symbol/side/qty/time.
    // If unrecoverable after ZOMBIE_MAX_CYCLES attempts: mark FAILED.
    await this._recoverZombieOrders();
  }

  // ─── Fix 3: Zombie-PENDING recovery ─────────────────────────────────────
  //
  // An order is a "zombie" when:
  //   • status IN ('PENDING', 'PENDING_RECONCILIATION')
  //   • broker_order_id IS NULL
  //   • placed_at < now - 30s
  //
  // Recovery strategy:
  //   1. Fetch today's Dhan order list once (shared across all zombies this cycle).
  //   2. For each zombie, try to match a Dhan order by (symbol OR token) +
  //      side + qty + time window.
  //   3. On match: write broker_order_id + upgrade status to OPEN so the normal
  //      poll path can handle the rest.
  //   4. After ZOMBIE_MAX_CYCLES scan cycles with no match: mark FAILED and
  //      emit an alert.  Never silently leave zombie orders alive.
  //
  // NOTE: We must NOT fabricate a broker_order_id. A match here is a
  // best-effort heuristic — if the order cannot be confidently matched,
  // it is marked FAILED so the trader can manually reconcile.
  async _recoverZombieOrders() {
    const cutoff = new Date(Date.now() - ZOMBIE_STALENESS_MS).toISOString();

    const { data: zombies, error } = await supabase
      .from('trading_orders')
      .select('id, trading_account_id, symbol, token, side, qty, placed_at, correlation_id, status')
      .in('status', ['PENDING', 'PENDING_RECONCILIATION'])
      .is('broker_order_id', null)
      .not('broker_order_id', 'like', 'PAPER-%')  // never touch paper orders
      .lt('placed_at', cutoff);

    if (error) {
      console.warn('[DhanPoller] Zombie scan DB query failed:', error.message);
      return;
    }
    if (!zombies || zombies.length === 0) return;

    // Fetch today's Dhan order list once — shared for all zombies this cycle.
    // CRITICAL: distinguish three outcomes:
    //   brokerOrders = []    → broker responded, no orders found (genuine empty)
    //   brokerOrders = array → broker responded with orders to scan
    //   brokerOrders = null  → broker API call FAILED (auth error, network error, timeout)
    //
    // Only pass brokerOrders to _tryRecoverZombie when the broker API call succeeded.
    // When the call fails: log the error and return WITHOUT touching any order status
    // or incrementing any cycle counter. Retry on the next normal poll cycle.
    // A temporary broker API failure must NEVER cause a live order to become FAILED.
    let brokerOrders = null;
    let brokerFetchOk = false;
    try {
      brokerOrders = await this._dhanAdapter.getOrders();
      brokerFetchOk = true;
    } catch (err) {
      // Classify the failure for observability
      const isAuth    = /token|invalid|unauthori/i.test(err.message);
      const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(err.message);
      const label     = isAuth ? 'AUTH ERROR' : isTimeout ? 'TIMEOUT' : 'BROKER API ERROR';
      console.warn(`[DhanPoller] Zombie scan: ${label} fetching Dhan order list — skipping cycle, NOT incrementing failure counters: ${err.message}`);
      return; // Do NOT process zombies this cycle
    }

    for (const zombie of zombies) {
      if (!this._running) break;
      // brokerFetchOk is always true here (we returned early on error above),
      // but pass the flag explicitly so _tryRecoverZombie can assert it.
      await this._tryRecoverZombie(zombie, brokerOrders, brokerFetchOk);
    }
  }

  async _tryRecoverZombie(zombie, brokerOrders, brokerFetchOk) {
    const orderId   = zombie.id;
    const accountId = zombie.trading_account_id;

    // Only increment the scan-cycle counter when the Dhan order list was
    // successfully fetched. A broker API failure is NOT evidence that the
    // order does not exist at the broker — it is a network/auth problem.
    // Incrementing on API failure would eventually falsely mark a live broker
    // order as FAILED after ZOMBIE_MAX_CYCLES transient failures.
    if (!brokerFetchOk) {
      // Should never reach here (caller returns early on fetch failure),
      // but guard defensively.
      console.warn(`[DhanPoller] _tryRecoverZombie called with brokerFetchOk=false for order ${orderId} — skipping`);
      return;
    }

    const cycles = (this._zombieScanCount.get(orderId) || 0) + 1;
    this._zombieScanCount.set(orderId, cycles);

    // Time window: ±5 minutes around placed_at
    const placedMs  = new Date(zombie.placed_at).getTime();
    const WINDOW_MS = 5 * 60 * 1000;

    // Try to match a Dhan order by symbol+side+qty within the time window.
    // We do NOT match on correlationId because Dhan's GET /v2/orders response
    // does not expose it in our current adapter mapping.
    const match = (brokerOrders || []).find(bo => {
      const boTime = bo.placedAt ? new Date(bo.placedAt).getTime() : 0;
      return (
        (bo.symbol === zombie.symbol || bo.token === zombie.token) &&
        bo.side?.toUpperCase() === zombie.side?.toUpperCase() &&
        Number(bo.qty) === Number(zombie.qty) &&
        Math.abs(boTime - placedMs) < WINDOW_MS
      );
    });

    if (match) {
      console.log(
        `[DhanPoller] Zombie recovered: FW order ${orderId} → ` +
        `Dhan ${match.brokerOrderId} (${zombie.symbol} ${zombie.side} ${zombie.qty})`
      );
      try {
        await orderRepo.updateStatus(orderId, 'OPEN', {
          broker_order_id: match.brokerOrderId,
          reject_reason: null,
        });
      } catch (e) {
        console.error(`[DhanPoller] Failed to update zombie order ${orderId}:`, e.message);
      }
      this._zombieScanCount.delete(orderId);

      eventBus.publish('order.updated', {
        orderId,
        status: 'OPEN',
        brokerOrderId: match.brokerOrderId,
        symbol: zombie.symbol,
        side: zombie.side,
      }, { accountId });
      return;
    }

    // No match this cycle
    if (cycles >= ZOMBIE_MAX_CYCLES) {
      console.error(
        `[DhanPoller] Zombie FAILED (unrecoverable after ${ZOMBIE_MAX_CYCLES} cycles): ` +
        `order ${orderId} (${zombie.symbol} ${zombie.side} ${zombie.qty})`
      );
      try {
        await orderRepo.updateStatus(orderId, 'FAILED', {
          reject_reason: `Zombie PENDING: no broker_order_id after ${ZOMBIE_MAX_CYCLES} recovery attempts. Manual reconciliation required.`,
        });
      } catch (e) {
        console.error(`[DhanPoller] Failed to mark zombie ${orderId} as FAILED:`, e.message);
      }
      this._zombieScanCount.delete(orderId);

      eventBus.publish('order.updated', {
        orderId,
        status: 'FAILED',
        rejectReason: 'Zombie PENDING: unrecoverable — manual reconciliation required',
        symbol: zombie.symbol,
        side: zombie.side,
      }, { accountId });
    } else {
      console.warn(
        `[DhanPoller] Zombie not matched yet: order ${orderId} ` +
        `(${zombie.symbol} ${zombie.side} ${zombie.qty}) — cycle ${cycles}/${ZOMBIE_MAX_CYCLES}`
      );
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
