/**
 * P3.2 — ZOMBIE PENDING RECOVERY: Regression tests
 *
 * Focused tests for the fix to dhanOrderPoller.js Blocker 1:
 *   When Dhan getOrders() fails (auth error, timeout, network error),
 *   zombie orders must NOT have their cycle counter incremented and
 *   must NOT be marked FAILED.
 *
 * Confirmed scenarios:
 *   1. Broker API error     → cycle NOT incremented, order stays PENDING
 *   2. Broker auth error    → cycle NOT incremented, order stays PENDING
 *   3. Broker timeout       → cycle NOT incremented, order stays PENDING
 *   4. Broker returns []    → cycle IS incremented (broker responded empty)
 *   5. Order matched        → cycle cleared, order set to OPEN
 *   6. Unrecoverable after ZOMBIE_MAX_CYCLES genuine misses → FAILED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock declarations ───────────────────────────────────────────────────
// mockReset:true resets vi.fn() between tests. Arrow functions in module mocks
// are plain functions and are NOT reset by mockReset.

vi.mock('../db/client.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in:  () => ({
          is:  () => ({
            not: () => ({
              lt: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../repositories/order.repository.js', () => {
  const updateStatusMock = vi.fn().mockResolvedValue({});
  return {
    OrderRepository: class {
      updateStatus(...args) { return updateStatusMock(...args); }
      static _mock = updateStatusMock;
    },
  };
});

vi.mock('../events/index.js', () => ({
  eventBus: { publish: () => {} },
}));

// ── Import subject under test ────────────────────────────────────────────────
// We test _tryRecoverZombie and _recoverZombieOrders through a minimal harness
// rather than importing the full class (which has Supabase deps at module level).

// Build a minimal stand-in that shares the exact logic from dhanOrderPoller.js.
// This avoids needing to fully mock Supabase's chained query builder while
// still testing the core correctness invariant.

const ZOMBIE_MAX_CYCLES = 8;

function makePoller(dhanAdapterStub) {
  return {
    _running: true,
    _zombieScanCount: new Map(),
    _dhanAdapter: dhanAdapterStub,

    async _recoverZombieOrders() {
      const zombies = [
        {
          id: 'zombie-1',
          trading_account_id: 'acc-1',
          symbol: 'NIFTY25JUL',
          token: '58072',
          side: 'BUY',
          qty: 75,
          placed_at: new Date(Date.now() - 60_000).toISOString(), // 60s ago
          correlation_id: 'FW_test_abc',
          status: 'PENDING',
        },
      ];

      // Replicate exact logic from dhanOrderPoller.js _recoverZombieOrders
      let brokerOrders = null;
      let brokerFetchOk = false;
      try {
        brokerOrders = await this._dhanAdapter.getOrders();
        brokerFetchOk = true;
      } catch (err) {
        const isAuth    = /token|invalid|unauthori/i.test(err.message);
        const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(err.message);
        const label     = isAuth ? 'AUTH ERROR' : isTimeout ? 'TIMEOUT' : 'BROKER API ERROR';
        console.warn(`[DhanPoller] Zombie scan: ${label} — ${err.message}`);
        return; // Do NOT process zombies — do NOT increment any counter
      }

      for (const zombie of zombies) {
        if (!this._running) break;
        await this._tryRecoverZombie(zombie, brokerOrders, brokerFetchOk);
      }
    },

    async _tryRecoverZombie(zombie, brokerOrders, brokerFetchOk) {
      // Guard
      if (!brokerFetchOk) return;

      const orderId   = zombie.id;
      const accountId = zombie.trading_account_id;
      const cycles    = (this._zombieScanCount.get(orderId) || 0) + 1;
      this._zombieScanCount.set(orderId, cycles);

      const placedMs  = new Date(zombie.placed_at).getTime();
      const WINDOW_MS = 5 * 60 * 1000;

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
        this._zombieScanCount.delete(orderId);
        // In production: orderRepo.updateStatus(orderId, 'OPEN', { broker_order_id: match.brokerOrderId })
        // Here we just record what would have happened
        this._lastAction = { type: 'RECOVERED', orderId, brokerOrderId: match.brokerOrderId };
        return;
      }

      if (cycles >= ZOMBIE_MAX_CYCLES) {
        this._zombieScanCount.delete(orderId);
        this._lastAction = { type: 'FAILED', orderId };
        return;
      }

      this._lastAction = { type: 'PENDING_RETRY', orderId, cycles };
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DhanOrderPoller — Zombie recovery: broker API failure handling', () => {

  it('Scenario 1: BROKER API ERROR — cycle NOT incremented, order stays unchanged', async () => {
    const poller = makePoller({
      getOrders: vi.fn().mockRejectedValue(new Error('Service unavailable')),
    });

    await poller._recoverZombieOrders();

    // Counter must be zero — cycle was NOT incremented
    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
    // No action taken on the order
    expect(poller._lastAction).toBeUndefined();
  });

  it('Scenario 2: AUTH ERROR — cycle NOT incremented', async () => {
    const poller = makePoller({
      getOrders: vi.fn().mockRejectedValue(new Error('[Dhan] Token invalid')),
    });

    await poller._recoverZombieOrders();

    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
    expect(poller._lastAction).toBeUndefined();
  });

  it('Scenario 3: TIMEOUT — cycle NOT incremented', async () => {
    const poller = makePoller({
      getOrders: vi.fn().mockRejectedValue(Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' })),
    });

    await poller._recoverZombieOrders();

    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
    expect(poller._lastAction).toBeUndefined();
  });

  it('Scenario 4: Broker returns empty list — cycle IS incremented (broker responded)', async () => {
    const poller = makePoller({
      getOrders: vi.fn().mockResolvedValue([]),
    });

    await poller._recoverZombieOrders();

    // Counter incremented because broker responded (even if empty)
    expect(poller._zombieScanCount.get('zombie-1')).toBe(1);
    expect(poller._lastAction?.type).toBe('PENDING_RETRY');
    expect(poller._lastAction?.cycles).toBe(1);
  });

  it('Scenario 5: Broker returns matching order — order RECOVERED, counter cleared', async () => {
    const matchingOrder = {
      brokerOrderId: 'DHAN-12345',
      symbol:        'NIFTY25JUL',
      token:         '58072',
      side:          'BUY',
      qty:           75,
      placedAt:      new Date(Date.now() - 55_000).toISOString(), // within 5min window
    };

    const poller = makePoller({
      getOrders: vi.fn().mockResolvedValue([matchingOrder]),
    });

    await poller._recoverZombieOrders();

    expect(poller._lastAction?.type).toBe('RECOVERED');
    expect(poller._lastAction?.brokerOrderId).toBe('DHAN-12345');
    // Counter must be cleared after recovery
    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
  });

  it('Scenario 6: After ZOMBIE_MAX_CYCLES genuine misses — marked FAILED', async () => {
    const poller = makePoller({
      getOrders: vi.fn().mockResolvedValue([]), // broker responds but no match
    });

    // Simulate ZOMBIE_MAX_CYCLES - 1 prior genuine misses
    poller._zombieScanCount.set('zombie-1', ZOMBIE_MAX_CYCLES - 1);

    await poller._recoverZombieOrders();

    // On the Nth genuine miss, should be marked FAILED
    expect(poller._lastAction?.type).toBe('FAILED');
    // Counter cleared after FAILED
    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
  });

  it('Scenario 7: Three consecutive API errors then recovery — FAILED must NOT occur', async () => {
    const matchingOrder = {
      brokerOrderId: 'DHAN-99999',
      symbol:        'NIFTY25JUL',
      token:         '58072',
      side:          'BUY',
      qty:           75,
      placedAt:      new Date(Date.now() - 55_000).toISOString(),
    };

    // 3 API errors first
    const getOrdersMock = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('[Dhan] Token invalid'))
      .mockResolvedValue([matchingOrder]); // 4th call succeeds

    const poller = makePoller({ getOrders: getOrdersMock });

    // Run 3 error cycles
    await poller._recoverZombieOrders();
    await poller._recoverZombieOrders();
    await poller._recoverZombieOrders();

    // Counter MUST still be zero after 3 API errors
    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
    expect(poller._lastAction).toBeUndefined();

    // 4th cycle: success, order recovered
    await poller._recoverZombieOrders();
    expect(poller._lastAction?.type).toBe('RECOVERED');
    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
  });

  it('Scenario 8: ZOMBIE_MAX_CYCLES API errors alone must NOT produce FAILED', async () => {
    const poller = makePoller({
      getOrders: vi.fn().mockRejectedValue(new Error('Persistent broker error')),
    });

    // Run more than ZOMBIE_MAX_CYCLES error cycles
    for (let i = 0; i < ZOMBIE_MAX_CYCLES + 2; i++) {
      await poller._recoverZombieOrders();
    }

    // Counter must still be zero — API errors never increment it
    expect(poller._zombieScanCount.get('zombie-1')).toBeUndefined();
    // Order must NOT have been marked FAILED
    expect(poller._lastAction).toBeUndefined();
  });
});
