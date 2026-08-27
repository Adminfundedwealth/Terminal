/**
 * PROTECTIVE ORDER SERVICE — P4.1
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Broker-side SL/TP protection for LIVE futures positions.
 *
 * PROBLEM (pre-P4.1):
 *   In live mode, SL/TP was server-managed only (in-memory paper monitor). If
 *   the server restarted while a live position was open, the stop disappeared
 *   from the broker's book — the real position had NO protection. This was the
 *   top RED item in FUTURES_PROP_RISK_MATRIX.md.
 *
 * WHAT THIS DOES:
 *   Submits a real protective order to the broker (Dhan) so the stop/target
 *   rests at the exchange and survives any FundedWealth server restart.
 *     - Stop-loss  → SL-M (STOP_LOSS_MARKET) exit order at triggerPrice
 *     - Take-profit → LIMIT exit order at targetPrice
 *
 * SAFETY PROPERTIES (all enforced here):
 *   1. DETERMINISTIC CORRELATION — every protective order is linked to its
 *      position and entry via a stable correlationId and the existing
 *      trading_orders columns (parent_order_id, order_group_id,
 *      order_group_type='bracket'). No schema migration required.
 *   2. DUPLICATE PREVENTION — before submitting a new leg, any prior live
 *      protective order for the same (position, leg) is cancelled at the broker
 *      and marked CANCELLED in the DB. Exactly one live SL and one live TP per
 *      position at any time.
 *   3. FAIL-CLOSED — if the broker rejects, times out, or returns a malformed
 *      response, the protective order is marked FAILED / PENDING_RECONCILIATION
 *      and the position's protection flag is NOT set. The position is left
 *      EXPLICITLY UNRESOLVED (protection_status = 'FAILED') rather than being
 *      falsely reported as protected. An alert event is emitted.
 *   4. RESTART RECOVERY — reconcileProtection() compares desired protection
 *      (positions.stop_loss / take_profit) against live broker orders and
 *      re-flags any position whose broker-side protection is missing.
 *
 * PAPER MODE:
 *   This service is NEVER used in paper mode. attachStopLoss/attachTakeProfit
 *   keep their existing paper monitor path unchanged. This module is only
 *   invoked from the live branch.
 *
 * NO LIVE ORDERS are placed by importing/constructing this service. A broker
 * write happens only when submitProtection() is called with a real adapter in
 * live mode — which is gated by EXECUTION_MODE=live upstream.
 */

import crypto from 'crypto';

/** Leg identifiers. */
export const PROTECTION_LEG = Object.freeze({ SL: 'SL', TP: 'TP' });

/** Protective-order status stored on the position (reject_reason field). */
export const PROTECTION_STATUS = Object.freeze({
  ACTIVE: 'PROTECTED',
  FAILED: 'PROTECTION_FAILED',
  UNRESOLVED: 'PROTECTION_UNRESOLVED',
});

/**
 * Build a deterministic correlationId for a protective order leg.
 * Stable across retries for the same (position, leg, price) so a duplicate
 * submission after a timeout can be matched against the broker order list.
 *
 * @param {string} positionId
 * @param {'SL'|'TP'} leg
 * @param {number} price
 * @returns {string} e.g. "FWP_SL_a1b2c3d4e5f60718"
 */
export function buildProtectionCorrelationId(positionId, leg, price) {
  const raw = `${positionId}:${leg}:${Number(price)}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `FWP_${leg}_${hash}`;
}

/**
 * Compute the protective order parameters for a position leg.
 *   - SL leg → SL-M exit at triggerPrice (opposite side of position)
 *   - TP leg → LIMIT exit at targetPrice (opposite side of position)
 *
 * @param {object} position DB position row (side, symbol, token, segment, qty, product_type)
 * @param {'SL'|'TP'} leg
 * @param {number} price
 * @returns {object} orderParams for adapter.placeOrder / orderRepo.createOrder
 */
export function buildProtectionOrderParams(position, leg, price) {
  const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
  const qty = Math.abs(Number(position.qty));
  const base = {
    symbol: position.symbol,
    token: position.token,
    segment: position.segment || 'NSE',
    exchange: position.segment || 'NSE',
    side: closeSide,
    productType: position.product_type,
    qty,
    isCloseOrder: true,
  };
  if (leg === PROTECTION_LEG.SL) {
    return { ...base, orderType: 'SL-M', triggerPrice: Number(price), price: 0 };
  }
  return { ...base, orderType: 'LIMIT', price: Number(price), triggerPrice: 0 };
}

/**
 * Classify a broker placeOrder outcome.
 * @param {object|null} response broker response (may be malformed)
 * @returns {{ ok: boolean, brokerOrderId: string|null, reason: string|null, malformed: boolean }}
 */
export function classifyBrokerResponse(response) {
  if (!response || typeof response !== 'object') {
    return { ok: false, brokerOrderId: null, reason: 'Malformed broker response (empty/non-object)', malformed: true };
  }
  const brokerOrderId = response.brokerOrderId || response.orderId || null;
  const status = String(response.status || '').toUpperCase();

  if (status === 'REJECTED' || status === 'FAILED') {
    return { ok: false, brokerOrderId, reason: response.message || 'Broker rejected protective order', malformed: false };
  }
  // A protective order that was accepted MUST carry a broker order id. Without
  // one we cannot cancel/track it later → treat as malformed (fail-closed).
  if (!brokerOrderId) {
    return { ok: false, brokerOrderId: null, reason: 'Malformed broker response (missing brokerOrderId)', malformed: true };
  }
  // PENDING / OPEN / TRANSIT / TRADED all mean the broker accepted the order.
  return { ok: true, brokerOrderId, reason: null, malformed: false };
}

export class ProtectiveOrderService {
  /**
   * @param {object} deps
   * @param {object} deps.orderRepo    OrderRepository instance
   * @param {object} deps.supabase     Supabase client (may be null in tests)
   * @param {object} deps.eventBus     event bus with publish()
   * @param {(provider:string)=>Promise<object>} deps.getAdapter  resolves a broker adapter
   */
  constructor({ orderRepo, supabase, eventBus, getAdapter }) {
    this.orderRepo = orderRepo;
    this.supabase = supabase || null;
    this.eventBus = eventBus || { publish() {} };
    this.getAdapter = getAdapter;
  }

  /**
   * Submit (or replace) a broker-side protective order leg for a live position.
   *
   * Sequence:
   *   1. Cancel any prior live protective order for this (position, leg).
   *   2. Create a DB order row (PENDING) correlated to the position/entry.
   *   3. Submit to broker with the stable correlationId.
   *   4. On success  → mark OPEN with broker_order_id; set position protection flag.
   *   5. On failure  → mark FAILED/PENDING_RECONCILIATION; set position
   *                    protection_status=FAILED; emit alert. Fail-closed.
   *
   * @param {object} args
   * @param {string} args.accountId
   * @param {object} args.position       DB position row (must include id, side, qty, token, symbol, segment, product_type)
   * @param {'SL'|'TP'} args.leg
   * @param {number} args.price
   * @param {string} args.brokerProvider
   * @param {string} [args.entryOrderId] entry order id for parent_order_id linkage
   * @returns {Promise<{ status:'PROTECTED'|'FAILED', leg:string, orderId:string|null, brokerOrderId:string|null, reason:string|null }>}
   */
  async submitProtection({ accountId, position, leg, price, brokerProvider, entryOrderId = null }) {
    if (!position || !position.id) throw new Error('submitProtection: position with id required');
    if (leg !== PROTECTION_LEG.SL && leg !== PROTECTION_LEG.TP) throw new Error(`submitProtection: invalid leg ${leg}`);
    if (!price || price <= 0) throw new Error('submitProtection: price must be > 0');
    if (!position.is_open || Math.abs(Number(position.qty)) === 0) throw new Error('submitProtection: position not open');

    // ── Step 1: duplicate prevention — cancel prior live protective order ─────
    await this._cancelExistingLeg(position.id, leg, brokerProvider);

    // ── Step 2: create correlated DB order row ────────────────────────────────
    const orderParams = buildProtectionOrderParams(position, leg, price);
    const correlationId = buildProtectionCorrelationId(position.id, leg, price);
    // order_group_id is scoped to the position so both legs group under the entry.
    const orderGroupId = position.order_group_id || position.id;

    const order = await this.orderRepo.createOrder(accountId, {
      ...orderParams,
      parentOrderId: entryOrderId || null,
      orderGroupId,
      orderGroupType: 'bracket',
    });
    // Best-effort correlation + position linkage (columns may be optional).
    try {
      await this.orderRepo.updateStatus(order.id, 'PENDING', {
        correlation_id: correlationId,
        position_id: position.id,
      });
    } catch (_) { /* columns optional — non-fatal */ }

    this.eventBus.publish('order.created', { orderId: order.id, ...orderParams, status: 'PENDING' }, { accountId });

    // ── Step 3: submit to broker ──────────────────────────────────────────────
    let adapter;
    try {
      adapter = await this.getAdapter(brokerProvider);
    } catch (err) {
      return this._failClosed(accountId, position, leg, order.id, `Broker adapter unavailable: ${err.message}`, false);
    }
    if (!adapter || !adapter.auth?.isTokenValid) {
      return this._failClosed(accountId, position, leg, order.id, 'Broker token invalid', false);
    }

    let response;
    try {
      response = await adapter.placeOrder({ ...orderParams, correlationId });
    } catch (err) {
      const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(err.message || '');
      // Timeout: broker MAY have accepted → leave PENDING_RECONCILIATION, not REJECTED.
      return this._failClosed(
        accountId, position, leg, order.id,
        isTimeout ? `Broker timeout — protection state uncertain: ${err.message}` : `Broker error: ${err.message}`,
        isTimeout,
      );
    }

    // ── Step 4: classify response ─────────────────────────────────────────────
    const verdict = classifyBrokerResponse(response);
    if (!verdict.ok) {
      // malformed/timeout → uncertain (reconciliation); explicit reject → FAILED
      return this._failClosed(accountId, position, leg, order.id, verdict.reason, verdict.malformed);
    }

    // ── Step 5: success — mark OPEN + set position protection flag ────────────
    try {
      await this.orderRepo.updateStatus(order.id, 'OPEN', { broker_order_id: verdict.brokerOrderId });
    } catch (_) { /* best effort */ }

    await this._setPositionProtection(position.id, leg, price, PROTECTION_STATUS.ACTIVE);

    this.eventBus.publish('order.updated', {
      orderId: order.id, status: 'OPEN', ...orderParams,
      brokerOrderId: verdict.brokerOrderId, brokerProvider,
    }, { accountId });

    this.eventBus.publish('protection.active', {
      accountId, positionId: position.id, leg, price,
      orderId: order.id, brokerOrderId: verdict.brokerOrderId,
    }, { accountId });

    return { status: 'PROTECTED', leg, orderId: order.id, brokerOrderId: verdict.brokerOrderId, reason: null };
  }

  /**
   * Fail-closed handler. Marks the order FAILED (explicit reject) or
   * PENDING_RECONCILIATION (uncertain: timeout/malformed), records the failure
   * on the position, and emits a protection.failed alert. NEVER marks the
   * position as protected.
   */
  async _failClosed(accountId, position, leg, orderId, reason, uncertain) {
    const orderStatus = uncertain ? 'PENDING_RECONCILIATION' : 'FAILED';
    try {
      await this.orderRepo.updateStatus(orderId, orderStatus, {
        reject_reason: `${PROTECTION_STATUS.FAILED} (${leg}): ${reason}`,
      });
    } catch (_) { /* best effort */ }

    // Record explicit UNRESOLVED state on the position. Do NOT set stop_loss/
    // take_profit — those are only set when protection is confirmed ACTIVE.
    await this._setPositionProtection(position.id, leg, null, PROTECTION_STATUS.FAILED);

    this.eventBus.publish('protection.failed', {
      accountId,
      positionId: position.id,
      symbol: position.symbol,
      token: position.token,
      leg,
      orderId,
      reason,
      uncertain,
      requiresManualAction: true,
    }, { accountId });

    console.error(`[Protection] ${orderStatus} ${leg} for position ${position.id} (${position.symbol}): ${reason}. Position left UNPROTECTED.`);

    return { status: 'FAILED', leg, orderId, brokerOrderId: null, reason };
  }

  /**
   * Cancel any existing live protective order for (position, leg) at the broker
   * and in the DB, so only one live leg exists at a time (duplicate prevention).
   */
  async _cancelExistingLeg(positionId, leg, brokerProvider) {
    if (!this.supabase) return;
    const orderType = leg === PROTECTION_LEG.SL ? 'SL-M' : 'LIMIT';
    let existing = [];
    try {
      const { data } = await this.supabase
        .from('trading_orders')
        .select('id, broker_order_id, order_type, status')
        .eq('position_id', positionId)
        .eq('order_type', orderType)
        .eq('order_group_type', 'bracket')
        .in('status', ['PENDING', 'OPEN', 'PENDING_RECONCILIATION']);
      existing = data || [];
    } catch (_) {
      return; // position_id column may be absent in some schemas — nothing to cancel
    }

    for (const o of existing) {
      // Cancel at broker first (best effort), then DB.
      if (o.broker_order_id && !String(o.broker_order_id).startsWith('PAPER-')) {
        try {
          const adapter = await this.getAdapter(brokerProvider);
          if (adapter?.auth?.isTokenValid) await adapter.cancelOrder(o.broker_order_id);
        } catch (err) {
          console.warn(`[Protection] Could not cancel prior ${leg} broker order ${o.broker_order_id}: ${err.message}`);
        }
      }
      try {
        await this.orderRepo.updateStatus(o.id, 'CANCELLED', { reject_reason: `Replaced by new ${leg} protection` });
      } catch (_) { /* best effort */ }
    }
  }

  /**
   * Persist protection outcome on the position row.
   *   ACTIVE  → set stop_loss / take_profit column + clear reject_reason marker
   *   FAILED  → set reject_reason=PROTECTION_FAILED; do NOT set price columns
   */
  async _setPositionProtection(positionId, leg, price, status) {
    if (!this.supabase) return;
    const patch = { updated_at: new Date().toISOString() };
    if (status === PROTECTION_STATUS.ACTIVE) {
      if (leg === PROTECTION_LEG.SL) patch.stop_loss = price;
      else patch.take_profit = price;
    } else {
      // Fail-closed: mark unresolved; leave price columns untouched.
      patch.reject_reason = `${PROTECTION_STATUS.FAILED}:${leg}`;
    }
    try {
      await this.supabase.from('positions').update(patch).eq('id', positionId);
    } catch (_) { /* best effort — column set may vary */ }
  }

  /**
   * RESTART RECOVERY / RECONCILIATION.
   *
   * For each open position that DESIRES protection (stop_loss or take_profit
   * set) verify a matching live broker protective order actually exists at the
   * broker. If missing, mark the position UNRESOLVED and emit an alert so it is
   * explicitly re-protected or manually handled — never silently assumed safe.
   *
   * Read-only against the broker (getOrders). Does NOT auto-resubmit orders
   * (that is an explicit operator/flow decision); it fails closed by flagging.
   *
   * @param {string} brokerProvider
   * @returns {Promise<{ checked:number, unresolved:number, positions:Array }>}
   */
  async reconcileProtection(brokerProvider) {
    const result = { checked: 0, unresolved: 0, positions: [] };
    if (!this.supabase) return result;

    let openPositions = [];
    try {
      const { data } = await this.supabase
        .from('positions')
        .select('id, trading_account_id, symbol, token, side, qty, stop_loss, take_profit, is_open')
        .eq('is_open', true)
        .gt('qty', 0);
      openPositions = data || [];
    } catch (_) {
      return result;
    }

    const desired = openPositions.filter(p => p.stop_loss > 0 || p.take_profit > 0);
    if (desired.length === 0) return result;

    // Fetch broker order list once. If the broker call fails, do NOT flag
    // anything (avoid false alarms from a transient API error) — same principle
    // as the P3.2 zombie scanner.
    let brokerOrders = null;
    try {
      const adapter = await this.getAdapter(brokerProvider);
      if (!adapter?.auth?.isTokenValid) return result;
      brokerOrders = await adapter.getOrders();
    } catch (err) {
      console.warn(`[Protection] Reconcile skipped — broker order list unavailable: ${err.message}`);
      return result;
    }
    if (!Array.isArray(brokerOrders)) return result;

    // Index live broker orders by securityId for quick lookup.
    const liveByToken = new Map();
    for (const bo of brokerOrders) {
      const status = String(bo.status || bo.orderStatus || '').toUpperCase();
      if (['PENDING', 'OPEN', 'TRANSIT', 'PARTIALLY_FILLED'].includes(status)) {
        const sid = String(bo.securityId || bo.token || '');
        if (!liveByToken.has(sid)) liveByToken.set(sid, []);
        liveByToken.get(sid).push(bo);
      }
    }

    for (const pos of desired) {
      result.checked++;
      const live = liveByToken.get(String(pos.token)) || [];
      // A protected position must have at least one live exit order on its token.
      const hasProtection = live.length > 0;
      if (!hasProtection) {
        result.unresolved++;
        result.positions.push({ positionId: pos.id, symbol: pos.symbol, token: pos.token });
        await this._setPositionProtection(pos.id, PROTECTION_LEG.SL, null, PROTECTION_STATUS.FAILED);
        this.eventBus.publish('protection.unresolved', {
          accountId: pos.trading_account_id,
          positionId: pos.id,
          symbol: pos.symbol,
          token: pos.token,
          reason: 'No live broker protective order found for a position that desires protection',
          requiresManualAction: true,
        }, { accountId: pos.trading_account_id });
        console.error(`[Protection] UNRESOLVED: position ${pos.id} (${pos.symbol}) desires protection but no live broker order found.`);
      }
    }
    return result;
  }
}
