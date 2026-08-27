/**
 * P4.1 BROKER-SIDE SL/TP PROTECTION TESTS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Verifies ProtectiveOrderService (server/services/protectiveOrderService.js).
 *
 * Required scenarios (per P4.1 spec):
 *   1. SUCCESS            — broker accepts → OPEN + position protected + event
 *   2. REJECTION          — broker returns REJECTED → FAILED, position NOT protected
 *   3. TIMEOUT            — broker throws timeout → PENDING_RECONCILIATION (uncertain), NOT protected
 *   4. DUPLICATE          — second submit cancels prior leg first (one live leg per position)
 *   5. RESTART/RECOVERY   — reconcileProtection flags a position with no live broker order
 *   6. MALFORMED RESPONSE — accepted-but-no-brokerOrderId → fail-closed, NOT protected
 *   7. BROKER MISMATCH    — position desires protection but broker list has none → UNRESOLVED
 *
 * Pure dependency-injection tests — no vi.mock, no live broker, no real DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProtectiveOrderService,
  PROTECTION_LEG,
  PROTECTION_STATUS,
  buildProtectionCorrelationId,
  buildProtectionOrderParams,
  classifyBrokerResponse,
} from '../services/protectiveOrderService.js';

// ─── Test doubles ─────────────────────────────────────────────────────────────

function makeOrderRepo() {
  const calls = { createOrder: [], updateStatus: [] };
  let seq = 0;
  return {
    calls,
    createOrder: vi.fn(async (_accountId, params) => {
      const id = `ord-${++seq}`;
      calls.createOrder.push({ id, params });
      return { id, ...params };
    }),
    updateStatus: vi.fn(async (orderId, status, updates = {}) => {
      calls.updateStatus.push({ orderId, status, updates });
      return { id: orderId, status, ...updates };
    }),
  };
}

/**
 * Mock supabase with a controllable "existing protective orders" table for the
 * dedup path, and a capture of position updates.
 */
function makeSupabase({ existingLegs = [], positionUpdates } = {}) {
  const posUpdates = positionUpdates || [];
  return {
    posUpdates,
    from(table) {
      if (table === 'trading_orders') {
        // Query builder for _cancelExistingLeg
        const qb = {
          _f: {},
          select() { return qb; },
          eq(k, v) { qb._f[k] = v; return qb; },
          in() { return Promise.resolve({ data: existingLegs, error: null }); },
        };
        return qb;
      }
      if (table === 'positions') {
        return {
          update(patch) {
            return {
              eq(_k, id) { posUpdates.push({ id, patch }); return Promise.resolve({ error: null }); },
            };
          },
          // for reconcile
          select() {
            return {
              eq() { return { gt() { return Promise.resolve({ data: makeSupabase._openPositions || [], error: null }); } }; },
            };
          },
        };
      }
      return { select() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; } };
    },
  };
}

function makeEventBus() {
  const events = [];
  return { events, publish: vi.fn((channel, payload) => { events.push({ channel, payload }); }) };
}

function makeAdapter(overrides = {}) {
  return {
    auth: { isTokenValid: true },
    placeOrder: vi.fn(async () => ({ brokerOrderId: 'DHAN-1', status: 'PENDING' })),
    cancelOrder: vi.fn(async () => ({ status: 'CANCELLED' })),
    getOrders: vi.fn(async () => []),
    ...overrides,
  };
}

const LONG_POS = {
  id: 'pos-1', trading_account_id: 'acc-1', symbol: 'NIFTY FUT', token: '68407',
  segment: 'NFO', side: 'LONG', qty: 65, product_type: 'MIS', is_open: true,
};

// ══════════════════════════════════════════════════════════════════════════════
// Pure helper tests
// ══════════════════════════════════════════════════════════════════════════════

describe('P4.1 helpers', () => {
  it('buildProtectionCorrelationId is deterministic per (position, leg, price)', () => {
    const a = buildProtectionCorrelationId('pos-1', 'SL', 24000);
    const b = buildProtectionCorrelationId('pos-1', 'SL', 24000);
    const c = buildProtectionCorrelationId('pos-1', 'SL', 24001);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('FWP_SL_')).toBe(true);
  });

  it('buildProtectionOrderParams: SL on LONG → SELL SL-M with triggerPrice', () => {
    const p = buildProtectionOrderParams(LONG_POS, PROTECTION_LEG.SL, 23900);
    expect(p.side).toBe('SELL');
    expect(p.orderType).toBe('SL-M');
    expect(p.triggerPrice).toBe(23900);
    expect(p.price).toBe(0);
    expect(p.qty).toBe(65);
    expect(p.isCloseOrder).toBe(true);
  });

  it('buildProtectionOrderParams: TP on SHORT → BUY LIMIT with price', () => {
    const shortPos = { ...LONG_POS, side: 'SHORT' };
    const p = buildProtectionOrderParams(shortPos, PROTECTION_LEG.TP, 23000);
    expect(p.side).toBe('BUY');
    expect(p.orderType).toBe('LIMIT');
    expect(p.price).toBe(23000);
    expect(p.triggerPrice).toBe(0);
  });

  it('classifyBrokerResponse flags empty/rejected/missing-id correctly', () => {
    expect(classifyBrokerResponse(null).malformed).toBe(true);
    expect(classifyBrokerResponse({ status: 'REJECTED', message: 'x' }).ok).toBe(false);
    expect(classifyBrokerResponse({ status: 'REJECTED' }).malformed).toBe(false);
    expect(classifyBrokerResponse({ status: 'PENDING' }).malformed).toBe(true); // no brokerOrderId
    expect(classifyBrokerResponse({ status: 'PENDING', brokerOrderId: 'X' }).ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// submitProtection scenarios
// ══════════════════════════════════════════════════════════════════════════════

describe('P4.1 submitProtection', () => {
  let orderRepo, eventBus;
  beforeEach(() => {
    orderRepo = makeOrderRepo();
    eventBus = makeEventBus();
    makeSupabase._openPositions = [];
  });

  it('SCENARIO 1 — SUCCESS: broker accepts → PROTECTED, position stop_loss set, protection.active emitted', async () => {
    const adapter = makeAdapter({ placeOrder: vi.fn(async () => ({ brokerOrderId: 'DHAN-77', status: 'PENDING' })) });
    const supabase = makeSupabase();
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const res = await svc.submitProtection({
      accountId: 'acc-1', position: LONG_POS, leg: PROTECTION_LEG.SL, price: 23900, brokerProvider: 'dhan',
    });

    expect(res.status).toBe('PROTECTED');
    expect(res.brokerOrderId).toBe('DHAN-77');
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
    // Order marked OPEN with broker_order_id
    const openUpd = orderRepo.calls.updateStatus.find(u => u.status === 'OPEN');
    expect(openUpd.updates.broker_order_id).toBe('DHAN-77');
    // Position stop_loss set to protection price
    const posUpd = supabase.posUpdates.find(u => u.patch.stop_loss === 23900);
    expect(posUpd).toBeTruthy();
    // Event emitted
    expect(eventBus.events.some(e => e.channel === 'protection.active')).toBe(true);
    // stable correlationId passed to broker
    expect(adapter.placeOrder.mock.calls[0][0].correlationId).toBe(buildProtectionCorrelationId('pos-1', 'SL', 23900));
  });

  it('SCENARIO 2 — REJECTION: broker REJECTED → FAILED, position NOT protected, protection.failed emitted', async () => {
    const adapter = makeAdapter({ placeOrder: vi.fn(async () => ({ status: 'REJECTED', message: 'insufficient margin' })) });
    const supabase = makeSupabase();
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const res = await svc.submitProtection({
      accountId: 'acc-1', position: LONG_POS, leg: PROTECTION_LEG.SL, price: 23900, brokerProvider: 'dhan',
    });

    expect(res.status).toBe('FAILED');
    // Order marked FAILED (explicit rejection, not uncertain)
    expect(orderRepo.calls.updateStatus.some(u => u.status === 'FAILED')).toBe(true);
    // Position must NOT have stop_loss set
    expect(supabase.posUpdates.some(u => u.patch.stop_loss !== undefined)).toBe(false);
    // Position marked failed-closed
    expect(supabase.posUpdates.some(u => String(u.patch.reject_reason || '').includes(PROTECTION_STATUS.FAILED))).toBe(true);
    expect(eventBus.events.some(e => e.channel === 'protection.failed')).toBe(true);
  });

  it('SCENARIO 3 — TIMEOUT: broker throws timeout → PENDING_RECONCILIATION (uncertain), NOT protected', async () => {
    const adapter = makeAdapter({ placeOrder: vi.fn(async () => { const e = new Error('timeout of 10000ms exceeded'); e.code = 'ECONNABORTED'; throw e; }) });
    const supabase = makeSupabase();
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const res = await svc.submitProtection({
      accountId: 'acc-1', position: LONG_POS, leg: PROTECTION_LEG.TP, price: 24500, brokerProvider: 'dhan',
    });

    expect(res.status).toBe('FAILED');
    // Uncertain → PENDING_RECONCILIATION, not FAILED (do not assume rejected)
    expect(orderRepo.calls.updateStatus.some(u => u.status === 'PENDING_RECONCILIATION')).toBe(true);
    // Not protected
    expect(supabase.posUpdates.some(u => u.patch.take_profit !== undefined)).toBe(false);
    const failEvt = eventBus.events.find(e => e.channel === 'protection.failed');
    expect(failEvt).toBeTruthy();
    expect(failEvt.payload.uncertain).toBe(true);
  });

  it('SCENARIO 4 — DUPLICATE: prior live SL leg is cancelled at broker + DB before new one', async () => {
    const adapter = makeAdapter({
      placeOrder: vi.fn(async () => ({ brokerOrderId: 'DHAN-NEW', status: 'PENDING' })),
      cancelOrder: vi.fn(async () => ({ status: 'CANCELLED' })),
    });
    // Existing live SL leg for this position
    const supabase = makeSupabase({ existingLegs: [{ id: 'ord-old', broker_order_id: 'DHAN-OLD', order_type: 'SL-M', status: 'OPEN' }] });
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const res = await svc.submitProtection({
      accountId: 'acc-1', position: LONG_POS, leg: PROTECTION_LEG.SL, price: 23800, brokerProvider: 'dhan',
    });

    expect(res.status).toBe('PROTECTED');
    // Old broker order cancelled
    expect(adapter.cancelOrder).toHaveBeenCalledWith('DHAN-OLD');
    // Old DB order marked CANCELLED
    expect(orderRepo.calls.updateStatus.some(u => u.orderId === 'ord-old' && u.status === 'CANCELLED')).toBe(true);
    // New order placed exactly once
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('SCENARIO 6 — MALFORMED RESPONSE: accepted but no brokerOrderId → fail-closed, NOT protected', async () => {
    const adapter = makeAdapter({ placeOrder: vi.fn(async () => ({ status: 'PENDING' /* missing brokerOrderId */ })) });
    const supabase = makeSupabase();
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const res = await svc.submitProtection({
      accountId: 'acc-1', position: LONG_POS, leg: PROTECTION_LEG.SL, price: 23900, brokerProvider: 'dhan',
    });

    expect(res.status).toBe('FAILED');
    // Malformed = uncertain → PENDING_RECONCILIATION
    expect(orderRepo.calls.updateStatus.some(u => u.status === 'PENDING_RECONCILIATION')).toBe(true);
    expect(supabase.posUpdates.some(u => u.patch.stop_loss !== undefined)).toBe(false);
    expect(eventBus.events.some(e => e.channel === 'protection.failed')).toBe(true);
  });

  it('adapter unavailable / token invalid → fail-closed, no broker call', async () => {
    const adapter = makeAdapter({ auth: { isTokenValid: false } });
    const supabase = makeSupabase();
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const res = await svc.submitProtection({
      accountId: 'acc-1', position: LONG_POS, leg: PROTECTION_LEG.SL, price: 23900, brokerProvider: 'dhan',
    });
    expect(res.status).toBe('FAILED');
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// reconcileProtection (restart recovery / broker mismatch)
// ══════════════════════════════════════════════════════════════════════════════

describe('P4.1 reconcileProtection', () => {
  let orderRepo, eventBus;
  beforeEach(() => { orderRepo = makeOrderRepo(); eventBus = makeEventBus(); });

  it('SCENARIO 5 + 7 — position desires protection but no live broker order → UNRESOLVED + event', async () => {
    makeSupabase._openPositions = [
      { id: 'pos-1', trading_account_id: 'acc-1', symbol: 'NIFTY FUT', token: '68407', side: 'LONG', qty: 65, stop_loss: 23900, take_profit: 0, is_open: true },
    ];
    const supabase = makeSupabase();
    // Broker reports NO orders for this token → mismatch
    const adapter = makeAdapter({ getOrders: vi.fn(async () => []) });
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const r = await svc.reconcileProtection('dhan');
    expect(r.checked).toBe(1);
    expect(r.unresolved).toBe(1);
    expect(eventBus.events.some(e => e.channel === 'protection.unresolved')).toBe(true);
    // Position flagged failed-closed
    expect(supabase.posUpdates.some(u => String(u.patch.reject_reason || '').includes(PROTECTION_STATUS.FAILED))).toBe(true);
  });

  it('protection present at broker → NOT flagged', async () => {
    makeSupabase._openPositions = [
      { id: 'pos-1', trading_account_id: 'acc-1', symbol: 'NIFTY FUT', token: '68407', side: 'LONG', qty: 65, stop_loss: 23900, take_profit: 0, is_open: true },
    ];
    const supabase = makeSupabase();
    const adapter = makeAdapter({ getOrders: vi.fn(async () => [{ securityId: '68407', status: 'PENDING' }]) });
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const r = await svc.reconcileProtection('dhan');
    expect(r.checked).toBe(1);
    expect(r.unresolved).toBe(0);
    expect(eventBus.events.some(e => e.channel === 'protection.unresolved')).toBe(false);
  });

  it('broker getOrders throws → NO false flags (transient API error safety)', async () => {
    makeSupabase._openPositions = [
      { id: 'pos-1', trading_account_id: 'acc-1', symbol: 'NIFTY FUT', token: '68407', side: 'LONG', qty: 65, stop_loss: 23900, take_profit: 0, is_open: true },
    ];
    const supabase = makeSupabase();
    const adapter = makeAdapter({ getOrders: vi.fn(async () => { throw new Error('503 Service Unavailable'); }) });
    const svc = new ProtectiveOrderService({ orderRepo, supabase, eventBus, getAdapter: async () => adapter });

    const r = await svc.reconcileProtection('dhan');
    expect(r.unresolved).toBe(0);
    expect(eventBus.events.some(e => e.channel === 'protection.unresolved')).toBe(false);
  });
});
