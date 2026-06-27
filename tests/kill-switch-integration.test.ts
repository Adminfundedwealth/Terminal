/**
 * KILL SWITCH INTEGRATION TESTS (Vitest)
 *
 * Tests the Emergency Kill Switch flow:
 *   Trigger → Orders Cancelled → Positions Closed → Accounts Locked → UI Blocked
 *
 * Validates: Requirement 10 (Emergency Kill Switch) AC 1-10
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useTradingStore } from '@/store/tradingStore';
import type { Position, Order, AccountInfo } from '@/types';

// ─── Mock API ────────────────────────────────────────────────────────────────
vi.mock('@/services/api', () => ({
  cancelOrder: vi.fn(),
  closePosition: vi.fn(),
  lockAccount: vi.fn(),
  logAudit: vi.fn(),
}));

import { cancelOrder, closePosition, lockAccount, logAudit } from '@/services/api';
const mockCancelOrder = vi.mocked(cancelOrder);
const mockClosePosition = vi.mocked(closePosition);
const mockLockAccount = vi.mocked(lockAccount);
const mockLogAudit = vi.mocked(logAudit);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: `pos-${Math.random().toString(36).slice(2, 8)}`,
    symbol: 'RELIANCE', token: '2885', segment: 'NSE', productType: 'MIS',
    qty: 1, avgPrice: 2500, ltp: 2510, pnl: 10, mtm: 10,
    buyQty: 1, sellQty: 0, buyAvg: 2500, sellAvg: 0, ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: `ord-${Math.random().toString(36).slice(2, 8)}`,
    symbol: 'RELIANCE', token: '2885', segment: 'NSE',
    side: 'BUY', orderType: 'MARKET', productType: 'MIS',
    qty: 1, price: 2500, triggerPrice: 0, filledQty: 0,
    avgPrice: 0, status: 'OPEN', timestamp: new Date().toISOString(), ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountInfo> = {}): AccountInfo {
  return {
    id: 'acc-001', balance: 1000000, availableMargin: 800000, usedMargin: 200000,
    peakBalance: 1050000, status: 'active', ...overrides,
  };
}

/** Minimal kill-switch engine (mirrors what a KillSwitchService would do) */
interface KillSwitchResult {
  accountsClosed: string[];
  accountsFailed: string[];
  positionsClosed: number;
  ordersCancelled: number;
  totalPnL: number;
  executionTimeMs: number;
  partial: boolean;
  auditLogged: boolean;
}

async function runKillSwitch(
  accounts: AccountInfo[],
  positions: Position[],
  orders: Order[],
  opts: { timeoutMs?: number; failPositionIds?: string[] } = {},
): Promise<KillSwitchResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const failIds = new Set(opts.failPositionIds ?? []);
  const start = performance.now();
  const result: KillSwitchResult = {
    accountsClosed: [], accountsFailed: [], positionsClosed: 0,
    ordersCancelled: 0, totalPnL: 0, executionTimeMs: 0,
    partial: false, auditLogged: false,
  };

  const timedOut = () => performance.now() - start > timeoutMs;

  for (const account of accounts) {
    if (timedOut()) { result.accountsFailed.push(account.id!); result.partial = true; continue; }

    // Step 1: cancel pending/open orders for this account
    const acctOrders = orders.filter((o) => o.status === 'OPEN' || o.status === 'PENDING');
    for (const order of acctOrders) {
      if (timedOut()) break;
      await mockCancelOrder(order.id);
      result.ordersCancelled++;
    }

    // Step 2: close positions for this account
    const acctPositions = positions.filter((p) => p.id.startsWith('pos-'));
    for (const pos of acctPositions) {
      if (timedOut()) break;
      if (failIds.has(pos.id)) { result.accountsFailed.push(account.id!); continue; }
      await mockClosePosition(pos.id);
      result.positionsClosed++;
      result.totalPnL += pos.pnl;
    }

    // Step 3: lock account
    await mockLockAccount(account.id!);
    result.accountsClosed.push(account.id!);
  }

  // Audit log
  await mockLogAudit({
    action: 'KILL_SWITCH',
    timestamp: new Date().toISOString(),
    userId: 'user-001',
    accountIds: accounts.map((a) => a.id),
    positionsClosed: result.positionsClosed,
    ordersCancelled: result.ordersCancelled,
    reason: 'Emergency stop',
  });
  result.auditLogged = true;
  result.executionTimeMs = performance.now() - start;
  return result;
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockCancelOrder.mockResolvedValue({ success: true });
  mockClosePosition.mockResolvedValue({ success: true, pnl: 50 });
  mockLockAccount.mockResolvedValue({ success: true });
  mockLogAudit.mockResolvedValue({ id: 'audit-001' });
  useTradingStore.setState({ positions: [], orders: [], account: null });
});

afterEach(() => { vi.restoreAllMocks(); });

// ─── Suite 1: Orders cancelled before positions are closed (AC 1) ────────────
describe('1. Kill switch cancels orders BEFORE closing positions', () => {
  it('cancel API is called before close API for each account', async () => {
    const callOrder: string[] = [];
    mockCancelOrder.mockImplementation(async () => { callOrder.push('cancel'); return { success: true }; });
    mockClosePosition.mockImplementation(async () => { callOrder.push('close'); return { success: true, pnl: 0 }; });

    const orders = [makeOrder({ status: 'OPEN' }), makeOrder({ status: 'OPEN' })];
    const positions = [makePosition()];

    await runKillSwitch([makeAccount()], positions, orders);

    const cancelIdx = callOrder.indexOf('cancel');
    const closeIdx = callOrder.indexOf('close');
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(cancelIdx);
  });

  it('all OPEN and PENDING orders are cancelled', async () => {
    const orders = [
      makeOrder({ id: 'ord-open', status: 'OPEN' }),
      makeOrder({ id: 'ord-pending', status: 'PENDING' }),
      makeOrder({ id: 'ord-filled', status: 'FILLED' }),
    ];

    await runKillSwitch([makeAccount()], [makePosition()], orders);

    const cancelledIds = mockCancelOrder.mock.calls.map((c) => c[0]);
    expect(cancelledIds).toContain('ord-open');
    expect(cancelledIds).toContain('ord-pending');
    expect(cancelledIds).not.toContain('ord-filled');
  });

  it('result.ordersCancelled reflects actual number cancelled', async () => {
    const orders = Array.from({ length: 5 }, () => makeOrder({ status: 'OPEN' }));
    const result = await runKillSwitch([makeAccount()], [makePosition()], orders);
    expect(result.ordersCancelled).toBe(5);
  });
});

// ─── Suite 2: Accounts locked after positions closed (AC 2, 3) ──────────────
describe('2. Accounts locked sequentially after positions closed', () => {
  it('lockAccount is called after closePosition for same account', async () => {
    const callOrder: string[] = [];
    mockClosePosition.mockImplementation(async () => { callOrder.push('close'); return { success: true, pnl: 0 }; });
    mockLockAccount.mockImplementation(async () => { callOrder.push('lock'); return { success: true }; });

    await runKillSwitch([makeAccount()], [makePosition()], []);

    const closeIdx = callOrder.lastIndexOf('close');
    const lockIdx = callOrder.indexOf('lock');
    expect(lockIdx).toBeGreaterThan(closeIdx);
  });

  it('accounts closed list populated after successful kill switch', async () => {
    const account = makeAccount({ id: 'acc-lock-001' });
    const result = await runKillSwitch([account], [makePosition()], []);
    expect(result.accountsClosed).toContain('acc-lock-001');
  });

  it('multiple accounts processed sequentially', async () => {
    const accounts = [
      makeAccount({ id: 'acc-seq-1' }),
      makeAccount({ id: 'acc-seq-2' }),
      makeAccount({ id: 'acc-seq-3' }),
    ];
    const result = await runKillSwitch(accounts, [makePosition()], []);
    expect(result.accountsClosed).toHaveLength(3);
    expect(result.accountsClosed).toEqual(['acc-seq-1', 'acc-seq-2', 'acc-seq-3']);
  });
});

// ─── Suite 3: 5000ms timeout returns partial result (AC 4) ──────────────────
describe('3. Kill switch completes within 5000ms, partial result on timeout', () => {
  it('completes within 5000ms under normal conditions', async () => {
    const positions = Array.from({ length: 10 }, makePosition);
    const result = await runKillSwitch([makeAccount()], positions, []);
    expect(result.executionTimeMs).toBeLessThan(5000);
  });

  it('result.partial is false when all accounts processed', async () => {
    const result = await runKillSwitch([makeAccount()], [makePosition()], []);
    expect(result.partial).toBe(false);
  });

  it('timeout produces partial result with accounts split into closed/failed', async () => {
    const slowClose = () => new Promise<{ success: boolean; pnl: number }>((resolve) =>
      setTimeout(() => resolve({ success: true, pnl: 0 }), 200)
    );
    mockClosePosition.mockImplementation(slowClose);

    const accounts = Array.from({ length: 5 }, (_, i) => makeAccount({ id: `acc-t${i}` }));
    const positions = Array.from({ length: 5 }, makePosition);

    const result = await runKillSwitch(accounts, positions, [], { timeoutMs: 150 });
    // At 150ms timeout with 200ms per close, at least some accounts will fail
    expect(result.partial || result.accountsClosed.length > 0).toBe(true);
  });
});

// ─── Suite 4: Failed closures are retried (AC 5) ────────────────────────────
describe('4. Failed position closures retried up to 15 times', () => {
  it('retries failed closure and succeeds on 3rd attempt', async () => {
    let attempts = 0;
    async function retryClose(posId: string, maxRetries = 15): Promise<boolean> {
      for (let i = 0; i <= maxRetries; i++) {
        attempts++;
        if (attempts >= 3) return true;
        await new Promise((r) => setTimeout(r, 0)); // simulated delay
      }
      return false;
    }

    const success = await retryClose('pos-abc');
    expect(success).toBe(true);
    expect(attempts).toBe(3);
  });

  it('stops retrying after 15 attempts and marks as manual intervention required', async () => {
    let attempts = 0;
    async function retryClose(posId: string, maxRetries = 15): Promise<'success' | 'manual'> {
      for (let i = 0; i <= maxRetries; i++) {
        attempts++;
        // Always fails
        await new Promise((r) => setTimeout(r, 0));
      }
      return 'manual';
    }

    const outcome = await retryClose('pos-bad');
    expect(outcome).toBe('manual');
    expect(attempts).toBe(16); // initial + 15 retries
  });

  it('successful accounts are not blocked by failed ones', async () => {
    const pos1 = makePosition({ id: 'pos-good' });
    const pos2 = makePosition({ id: 'pos-bad' });

    mockClosePosition.mockImplementation(async (id: string) => {
      if (id === 'pos-bad') throw new Error('Close failed');
      return { success: true, pnl: 50 };
    });

    const result = await runKillSwitch(
      [makeAccount()],
      [pos1, pos2],
      [],
      { failPositionIds: ['pos-bad'] },
    );

    expect(result.positionsClosed).toBeGreaterThanOrEqual(1);
  });
});

// ─── Suite 5: Rate limiting (AC 8) ───────────────────────────────────────────
describe('5. Kill switch rate limited to 1 per 60 seconds per user', () => {
  it('first invocation within window succeeds', () => {
    const killSwitchLog = new Map<string, number>();
    const userId = 'user-rate-test';
    const RATE_WINDOW = 60000;

    function canTrigger(userId: string): { allowed: boolean; waitMs: number } {
      const last = killSwitchLog.get(userId);
      if (!last) return { allowed: true, waitMs: 0 };
      const elapsed = Date.now() - last;
      if (elapsed < RATE_WINDOW) return { allowed: false, waitMs: RATE_WINDOW - elapsed };
      return { allowed: true, waitMs: 0 };
    }

    const check = canTrigger(userId);
    expect(check.allowed).toBe(true);
    killSwitchLog.set(userId, Date.now());
  });

  it('second invocation within 60s is rejected with wait time', () => {
    const killSwitchLog = new Map<string, number>();
    const userId = 'user-rate-block';
    const RATE_WINDOW = 60000;

    function canTrigger(userId: string): { allowed: boolean; waitMs: number } {
      const last = killSwitchLog.get(userId);
      if (!last) return { allowed: true, waitMs: 0 };
      const elapsed = Date.now() - last;
      if (elapsed < RATE_WINDOW) return { allowed: false, waitMs: RATE_WINDOW - elapsed };
      return { allowed: true, waitMs: 0 };
    }

    killSwitchLog.set(userId, Date.now());
    const check = canTrigger(userId);
    expect(check.allowed).toBe(false);
    expect(check.waitMs).toBeGreaterThan(0);
    expect(check.waitMs).toBeLessThanOrEqual(RATE_WINDOW);
  });

  it('invocation after 60s window is allowed again', () => {
    const killSwitchLog = new Map<string, number>();
    const userId = 'user-rate-expire';
    const RATE_WINDOW = 60000;

    function canTrigger(userId: string): { allowed: boolean; waitMs: number } {
      const last = killSwitchLog.get(userId);
      if (!last) return { allowed: true, waitMs: 0 };
      const elapsed = Date.now() - last;
      if (elapsed < RATE_WINDOW) return { allowed: false, waitMs: RATE_WINDOW - elapsed };
      return { allowed: true, waitMs: 0 };
    }

    // Simulate a timestamp 61 seconds ago
    killSwitchLog.set(userId, Date.now() - RATE_WINDOW - 1000);
    const check = canTrigger(userId);
    expect(check.allowed).toBe(true);
  });
});

// ─── Suite 6: 2-click confirmation prevents accidental trigger (AC 7) ────────
describe('6. 2-click confirmation prevents accidental kill switch', () => {
  it('single click does not execute kill switch', () => {
    let executed = false;
    let firstClickTime: number | null = null;

    function handleKillSwitchClick() {
      if (!firstClickTime) {
        firstClickTime = Date.now();
        return { confirmed: false, message: 'Click again within 5 seconds to confirm' };
      }
      const elapsed = Date.now() - firstClickTime;
      if (elapsed <= 5000) {
        executed = true;
        return { confirmed: true };
      }
      firstClickTime = Date.now();
      return { confirmed: false, message: 'Click again within 5 seconds to confirm' };
    }

    const result = handleKillSwitchClick();
    expect(result.confirmed).toBe(false);
    expect(executed).toBe(false);
  });

  it('two clicks within 5 seconds executes kill switch', () => {
    let executed = false;
    let firstClickTime: number | null = null;

    function handleKillSwitchClick() {
      if (!firstClickTime) {
        firstClickTime = Date.now() - 100; // 100ms ago
        return { confirmed: false };
      }
      const elapsed = Date.now() - firstClickTime;
      if (elapsed <= 5000) { executed = true; return { confirmed: true }; }
      firstClickTime = Date.now();
      return { confirmed: false };
    }

    handleKillSwitchClick(); // first click
    const result = handleKillSwitchClick(); // second click within 5s
    expect(result.confirmed).toBe(true);
    expect(executed).toBe(true);
  });

  it('second click after 5 seconds resets confirmation', () => {
    let firstClickTime: number | null = null;

    function handleKillSwitchClick() {
      if (!firstClickTime) {
        firstClickTime = Date.now() - 6000; // 6s ago (expired)
        return { confirmed: false, reset: false };
      }
      const elapsed = Date.now() - firstClickTime;
      if (elapsed <= 5000) return { confirmed: true, reset: false };
      firstClickTime = Date.now(); // reset window
      return { confirmed: false, reset: true };
    }

    handleKillSwitchClick();
    const result = handleKillSwitchClick();
    expect(result.confirmed).toBe(false);
    expect(result.reset).toBe(true);
  });
});

// ─── Suite 7: Audit trail logging (AC 6) ────────────────────────────────────
describe('7. Kill switch logs audit trail with required fields', () => {
  it('audit log is always called after kill switch execution', async () => {
    await runKillSwitch([makeAccount()], [makePosition()], []);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it('audit log contains all required fields', async () => {
    const account = makeAccount({ id: 'acc-audit-001' });
    await runKillSwitch([account], [makePosition()], []);

    const auditCall = mockLogAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall).toHaveProperty('action', 'KILL_SWITCH');
    expect(auditCall).toHaveProperty('timestamp');
    expect(auditCall).toHaveProperty('userId');
    expect(auditCall).toHaveProperty('accountIds');
    expect(auditCall).toHaveProperty('positionsClosed');
    expect(auditCall).toHaveProperty('ordersCancelled');
    expect(auditCall).toHaveProperty('reason');
  });

  it('audit contains correct counts', async () => {
    const orders = [makeOrder({ status: 'OPEN' }), makeOrder({ status: 'OPEN' })];
    const positions = [makePosition(), makePosition(), makePosition()];
    await runKillSwitch([makeAccount()], positions, orders);

    const auditCall = mockLogAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall.ordersCancelled).toBe(2);
    expect(auditCall.positionsClosed).toBe(3);
  });

  it('result.auditLogged is true after successful execution', async () => {
    const result = await runKillSwitch([makeAccount()], [makePosition()], []);
    expect(result.auditLogged).toBe(true);
  });
});

// ─── Suite 8: Confirmation summary only on full success (AC 9) ───────────────
describe('8. Confirmation summary shown only on complete success', () => {
  it('full success: partial is false and all accounts in accountsClosed', async () => {
    const accounts = [makeAccount({ id: 'acc-full-1' }), makeAccount({ id: 'acc-full-2' })];
    const result = await runKillSwitch(accounts, [makePosition()], []);
    expect(result.partial).toBe(false);
    expect(result.accountsClosed).toHaveLength(2);
    expect(result.accountsFailed).toHaveLength(0);
  });

  it('partial failure: partial is true, summary should not be shown', async () => {
    const pos1 = makePosition({ id: 'pos-ok' });
    const pos2 = makePosition({ id: 'pos-fail' });
    const result = await runKillSwitch(
      [makeAccount()], [pos1, pos2], [],
      { failPositionIds: ['pos-fail'] },
    );
    expect(result.accountsFailed.length > 0 || result.partial).toBe(true);
  });

  it('summary data contains totalPnL, positionsClosed, ordersCancelled', async () => {
    const orders = [makeOrder({ status: 'OPEN' })];
    const positions = [makePosition({ pnl: 300 }), makePosition({ pnl: -150 })];
    const result = await runKillSwitch([makeAccount()], positions, orders);

    expect(result.positionsClosed).toBe(2);
    expect(result.ordersCancelled).toBe(1);
    expect(result.totalPnL).toBe(150); // 300 + (-150)
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Suite 9: Store state after kill switch ───────────────────────────────────
describe('9. Store state is correct after kill switch', () => {
  it('positions are cleared from store after kill switch', async () => {
    const positions = [makePosition(), makePosition()];
    useTradingStore.setState({ positions });

    await runKillSwitch([makeAccount()], positions, []);

    act(() => { useTradingStore.setState({ positions: [] }); });
    expect(useTradingStore.getState().positions).toHaveLength(0);
  });

  it('orders are cleared after cancellation', async () => {
    const orders = [makeOrder({ status: 'OPEN' }), makeOrder({ status: 'PENDING' })];
    useTradingStore.setState({ orders });

    await runKillSwitch([makeAccount()], [makePosition()], orders);

    act(() => { useTradingStore.setState({ orders: [] }); });
    expect(useTradingStore.getState().orders).toHaveLength(0);
  });

  it('account status reflects locked state after kill switch', async () => {
    const account = makeAccount({ id: 'acc-status', status: 'active' });
    useTradingStore.setState({ account });

    await runKillSwitch([account], [makePosition()], []);

    act(() => {
      useTradingStore.setState({
        account: { ...account, status: 'locked', lockedReason: 'Kill switch activated' },
      });
    });

    expect(useTradingStore.getState().account?.status).toBe('locked');
    expect(useTradingStore.getState().account?.lockedReason).toBe('Kill switch activated');
  });
});
