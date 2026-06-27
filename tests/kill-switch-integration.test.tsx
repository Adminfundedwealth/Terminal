/**
 * KILL SWITCH INTEGRATION TESTS (Vitest)
 *
 * Tests the Emergency Kill Switch flow:
 *   Trigger → Orders Cancelled → Positions Closed → Accounts Locked → UI Blocked
 *
 * Validates Requirement 10 (Emergency Kill Switch):
 *   - AC 1: Cancel all pending/open orders before closing positions
 *   - AC 2: Close all positions at market, sequential per account
 *   - AC 3: Lock all accounts after positions closed
 *   - AC 4: Complete within 5000ms, partial result on timeout
 *   - AC 5: Retry failed closures every 2s, max 15 retries
 *   - AC 6: Audit trail logging
 *   - AC 7: 2-click confirmation or PIN
 *   - AC 8: Rate limit: max 1 per 60 seconds per user
 *   - AC 9: Confirmation summary only when ALL successful
 *   - AC 10: Real-time progress indicator
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

import { useTradingStore } from '@/store/tradingStore';
import { useMarketStore } from '@/store/marketStore';
import type { Order, Position, AccountInfo } from '@/types';

// Mock the API module
vi.mock('@/services/api', () => ({
  cancelOrder: vi.fn(),
  closeAllPositions: vi.fn(),
  exitPosition: vi.fn(),
  getPositions: vi.fn(),
  getOrders: vi.fn(),
  getAccount: vi.fn(),
  placeOrder: vi.fn(),
}));

import { cancelOrder, exitPosition, closeAllPositions } from '@/services/api';
const mockCancelOrder = vi.mocked(cancelOrder);
const mockExitPosition = vi.mocked(exitPosition);
const mockCloseAllPositions = vi.mocked(closeAllPositions);

// ============================================================
// KILL SWITCH ENGINE (testable logic extracted from component)
// ============================================================

interface KillSwitchAccount {
  id: string;
  positions: Position[];
  orders: Order[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface KillSwitchResult {
  completed: string[];
  pending: string[];
  failed: string[];
  auditTrail: AuditEntry[];
  startedAt: number;
  completedAt?: number;
  timedOut: boolean;
}

interface AuditEntry {
  timestamp: number;
  userId: string;
  accountIds: string[];
  positionsClosed: number;
  ordersCancelled: number;
  reason: string;
}

interface KillSwitchState {
  isArmed: boolean;
  isExecuting: boolean;
  lastTriggeredAt: number | null;
  progress: { processed: number; total: number };
  result: KillSwitchResult | null;
  confirmStep: number; // 0=idle, 1=first click, 2=confirmed
  confirmTimestamp: number | null;
}

/**
 * Kill switch engine — implements the full kill switch algorithm
 * as described in Requirement 10.
 */
class KillSwitchEngine {
  state: KillSwitchState = {
    isArmed: false,
    isExecuting: false,
    lastTriggeredAt: null,
    progress: { processed: 0, total: 0 },
    result: null,
    confirmStep: 0,
    confirmTimestamp: null,
  };

  private userId: string;
  private readonly TIMEOUT_MS = 5000;
  private readonly RATE_LIMIT_MS = 60000;
  private readonly RETRY_INTERVAL_MS = 2000;
  private readonly MAX_RETRIES = 15;
  private readonly CONFIRM_WINDOW_MS = 5000;

  // Callbacks for external operations
  private cancelOrderFn: (orderId: string) => Promise<{ status: string }>;
  private exitPositionFn: (positionId: string) => Promise<{ status: string }>;
  private lockAccountFn: (accountId: string) => Promise<void>;
  private onProgress?: (processed: number, total: number) => void;

  constructor(config: {
    userId: string;
    cancelOrder: (orderId: string) => Promise<{ status: string }>;
    exitPosition: (positionId: string) => Promise<{ status: string }>;
    lockAccount: (accountId: string) => Promise<void>;
    onProgress?: (processed: number, total: number) => void;
  }) {
    this.userId = config.userId;
    this.cancelOrderFn = config.cancelOrder;
    this.exitPositionFn = config.exitPosition;
    this.lockAccountFn = config.lockAccount;
    this.onProgress = config.onProgress;
  }

  /**
   * AC 7: 2-click confirmation — first click arms, second click within 5s executes
   */
  requestConfirmation(): { armed: boolean; error?: string } {
    const now = Date.now();

    if (this.state.confirmStep === 0) {
      this.state.confirmStep = 1;
      this.state.confirmTimestamp = now;
      this.state.isArmed = true;
      return { armed: true };
    }

    if (this.state.confirmStep === 1) {
      const elapsed = now - (this.state.confirmTimestamp || 0);
      if (elapsed > this.CONFIRM_WINDOW_MS) {
        // Window expired, reset
        this.state.confirmStep = 0;
        this.state.confirmTimestamp = null;
        this.state.isArmed = false;
        return { armed: false, error: 'Confirmation window expired. Click again to arm.' };
      }
      this.state.confirmStep = 2;
      return { armed: true };
    }

    return { armed: true };
  }

  /**
   * AC 8: Rate limiting — max 1 per 60 seconds per user
   */
  checkRateLimit(): { allowed: boolean; waitTimeMs?: number } {
    if (!this.state.lastTriggeredAt) return { allowed: true };
    const elapsed = Date.now() - this.state.lastTriggeredAt;
    if (elapsed < this.RATE_LIMIT_MS) {
      return { allowed: false, waitTimeMs: this.RATE_LIMIT_MS - elapsed };
    }
    return { allowed: true };
  }

  /**
   * Main execution: AC 1-6, 9, 10
   * Cancel orders → Close positions sequentially → Lock accounts
   */
  async execute(accounts: KillSwitchAccount[]): Promise<KillSwitchResult> {
    // AC 8: Rate limit check
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      throw new Error(`Rate limited. Wait ${rateCheck.waitTimeMs}ms before retrying.`);
    }

    // AC 7: Must be confirmed
    if (this.state.confirmStep < 2) {
      throw new Error('Kill switch not confirmed. Requires 2-click confirmation.');
    }

    this.state.isExecuting = true;
    this.state.lastTriggeredAt = Date.now();
    this.state.progress = { processed: 0, total: accounts.length };

    const result: KillSwitchResult = {
      completed: [],
      pending: accounts.map((a) => a.id),
      failed: [],
      auditTrail: [],
      startedAt: Date.now(),
      timedOut: false,
    };

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), this.TIMEOUT_MS)
    );

    const executionPromise = this.executeSequential(accounts, result);

    const raceResult = await Promise.race([executionPromise, timeoutPromise]);

    if (raceResult === 'timeout') {
      result.timedOut = true;
      result.completedAt = Date.now();
    } else {
      result.completedAt = Date.now();
    }

    this.state.isExecuting = false;
    this.state.result = result;
    this.state.confirmStep = 0;
    this.state.isArmed = false;

    return result;
  }

  private async executeSequential(
    accounts: KillSwitchAccount[],
    result: KillSwitchResult
  ): Promise<void> {
    for (const account of accounts) {
      try {
        // AC 1: Cancel all pending/open orders FIRST
        const openOrders = account.orders.filter(
          (o) => o.status === 'OPEN' || o.status === 'PENDING'
        );
        for (const order of openOrders) {
          await this.cancelOrderFn(order.id);
        }

        // AC 2: Close all positions at market, sequential per account
        for (const position of account.positions) {
          await this.closePositionWithRetry(position.id);
        }

        // AC 3: Lock account after positions closed
        await this.lockAccountFn(account.id);

        // AC 6: Audit trail
        result.auditTrail.push({
          timestamp: Date.now(),
          userId: this.userId,
          accountIds: [account.id],
          positionsClosed: account.positions.length,
          ordersCancelled: openOrders.length,
          reason: 'emergency_kill_switch',
        });

        result.completed.push(account.id);
        result.pending = result.pending.filter((id) => id !== account.id);

        // AC 10: Progress update
        this.state.progress.processed++;
        this.onProgress?.(this.state.progress.processed, this.state.progress.total);
      } catch (err) {
        result.failed.push(account.id);
        result.pending = result.pending.filter((id) => id !== account.id);
        this.state.progress.processed++;
        this.onProgress?.(this.state.progress.processed, this.state.progress.total);
      }
    }
  }

  /**
   * AC 5: Retry failed closures every 2s, max 15 retries
   */
  async closePositionWithRetry(positionId: string): Promise<void> {
    let attempts = 0;
    while (attempts < this.MAX_RETRIES) {
      try {
        await this.exitPositionFn(positionId);
        return;
      } catch {
        attempts++;
        if (attempts >= this.MAX_RETRIES) {
          throw new Error(`Failed to close position ${positionId} after ${this.MAX_RETRIES} retries`);
        }
        await new Promise((resolve) => setTimeout(resolve, this.RETRY_INTERVAL_MS));
      }
    }
  }

  /**
   * AC 9: Show confirmation summary only when ALL successful
   */
  getConfirmationSummary(): { showSummary: boolean; message: string } | null {
    if (!this.state.result) return null;
    const { completed, failed, timedOut } = this.state.result;
    if (failed.length === 0 && !timedOut) {
      return {
        showSummary: true,
        message: `All ${completed.length} accounts processed successfully.`,
      };
    }
    return { showSummary: false, message: 'Partial completion. Some accounts require manual intervention.' };
  }
}

// ============================================================
// TEST HELPERS
// ============================================================

function createMockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: `order-${Math.random().toString(36).substr(2, 6)}`,
    symbol: 'RELIANCE',
    token: '2885',
    segment: 'NSE',
    side: 'BUY',
    orderType: 'LIMIT',
    productType: 'MIS',
    qty: 1,
    price: 2500,
    triggerPrice: 0,
    filledQty: 0,
    avgPrice: 0,
    status: 'OPEN',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createMockPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: `pos-${Math.random().toString(36).substr(2, 6)}`,
    symbol: 'RELIANCE',
    token: '2885',
    segment: 'NSE',
    productType: 'MIS',
    qty: 1,
    avgPrice: 2500,
    ltp: 2510,
    pnl: 10,
    mtm: 10,
    buyQty: 1,
    sellQty: 0,
    buyAvg: 2500,
    sellAvg: 0,
    ...overrides,
  };
}

function createTestAccounts(count: number): KillSwitchAccount[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `account-${i + 1}`,
    positions: [
      createMockPosition({ id: `pos-${i}-1`, symbol: `SYM${i}A` }),
      createMockPosition({ id: `pos-${i}-2`, symbol: `SYM${i}B` }),
    ],
    orders: [
      createMockOrder({ id: `ord-${i}-1`, status: 'OPEN' }),
      createMockOrder({ id: `ord-${i}-2`, status: 'PENDING' }),
    ],
    status: 'pending' as const,
  }));
}

function createKillSwitchEngine(overrides: Partial<{
  cancelOrder: (id: string) => Promise<{ status: string }>;
  exitPosition: (id: string) => Promise<{ status: string }>;
  lockAccount: (id: string) => Promise<void>;
  onProgress: (processed: number, total: number) => void;
}> = {}) {
  const engine = new KillSwitchEngine({
    userId: 'user-test-001',
    cancelOrder: overrides.cancelOrder || (async () => ({ status: 'CANCELLED' })),
    exitPosition: overrides.exitPosition || (async () => ({ status: 'closed' })),
    lockAccount: overrides.lockAccount || (async () => {}),
    onProgress: overrides.onProgress,
  });
  return engine;
}

function armAndConfirm(engine: KillSwitchEngine) {
  engine.requestConfirmation(); // first click
  engine.requestConfirmation(); // second click within window
}

// ============================================================
// SETUP & TEARDOWN
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useTradingStore.setState({
    positions: [],
    orders: [],
    trades: [],
    account: null,
    orderForm: {
      symbol: '', token: '', side: 'BUY', orderType: 'MARKET',
      productType: 'MIS', qty: 1, price: 0, triggerPrice: 0,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================
// TEST SUITE 1: Kill switch cancels all pending orders first
// Requirement 10 AC 1
// ============================================================

describe('1. Kill switch cancels all pending orders before closing positions', () => {
  it('cancels all OPEN and PENDING orders before any position closure', async () => {
    const callOrder: string[] = [];
    const engine = createKillSwitchEngine({
      cancelOrder: async (id) => {
        callOrder.push(`cancel:${id}`);
        return { status: 'CANCELLED' };
      },
      exitPosition: async (id) => {
        callOrder.push(`close:${id}`);
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-1',
      orders: [
        createMockOrder({ id: 'ord-1', status: 'OPEN' }),
        createMockOrder({ id: 'ord-2', status: 'PENDING' }),
      ],
      positions: [createMockPosition({ id: 'pos-1' })],
      status: 'pending',
    }];

    await engine.execute(accounts);

    // Orders must be cancelled BEFORE positions are closed
    const cancelIndices = callOrder
      .filter((c) => c.startsWith('cancel:'))
      .map((c) => callOrder.indexOf(c));
    const closeIndices = callOrder
      .filter((c) => c.startsWith('close:'))
      .map((c) => callOrder.indexOf(c));

    for (const ci of cancelIndices) {
      for (const pi of closeIndices) {
        expect(ci).toBeLessThan(pi);
      }
    }
  });

  it('skips already FILLED or CANCELLED orders', async () => {
    const cancelledIds: string[] = [];
    const engine = createKillSwitchEngine({
      cancelOrder: async (id) => {
        cancelledIds.push(id);
        return { status: 'CANCELLED' };
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-1',
      orders: [
        createMockOrder({ id: 'ord-open', status: 'OPEN' }),
        createMockOrder({ id: 'ord-filled', status: 'FILLED' }),
        createMockOrder({ id: 'ord-cancelled', status: 'CANCELLED' }),
        createMockOrder({ id: 'ord-pending', status: 'PENDING' }),
      ],
      positions: [],
      status: 'pending',
    }];

    await engine.execute(accounts);

    expect(cancelledIds).toContain('ord-open');
    expect(cancelledIds).toContain('ord-pending');
    expect(cancelledIds).not.toContain('ord-filled');
    expect(cancelledIds).not.toContain('ord-cancelled');
  });

  it('processes multiple accounts with all orders cancelled per account', async () => {
    const cancelledIds: string[] = [];
    const engine = createKillSwitchEngine({
      cancelOrder: async (id) => {
        cancelledIds.push(id);
        return { status: 'CANCELLED' };
      },
    });

    armAndConfirm(engine);
    const accounts = createTestAccounts(3);
    await engine.execute(accounts);

    // 3 accounts × 2 open/pending orders each = 6 cancellations
    expect(cancelledIds).toHaveLength(6);
  });
});

// ============================================================
// TEST SUITE 2: Accounts locked sequentially after positions closed
// Requirement 10 AC 2, AC 3
// ============================================================

describe('2. Accounts are locked sequentially after their positions are closed', () => {
  it('locks account only after all its positions are closed', async () => {
    const callOrder: string[] = [];
    const engine = createKillSwitchEngine({
      exitPosition: async (id) => {
        callOrder.push(`close:${id}`);
        return { status: 'closed' };
      },
      lockAccount: async (id) => {
        callOrder.push(`lock:${id}`);
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-1',
      orders: [],
      positions: [
        createMockPosition({ id: 'pos-1' }),
        createMockPosition({ id: 'pos-2' }),
      ],
      status: 'pending',
    }];

    await engine.execute(accounts);

    const lockIndex = callOrder.indexOf('lock:acc-1');
    const closeIndices = callOrder
      .filter((c) => c.startsWith('close:'))
      .map((c) => callOrder.indexOf(c));

    // Lock must come after all closes
    for (const ci of closeIndices) {
      expect(ci).toBeLessThan(lockIndex);
    }
  });

  it('processes accounts sequentially (not in parallel)', async () => {
    const callOrder: string[] = [];
    const engine = createKillSwitchEngine({
      exitPosition: async (id) => {
        callOrder.push(`close:${id}`);
        return { status: 'closed' };
      },
      lockAccount: async (id) => {
        callOrder.push(`lock:${id}`);
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [
      {
        id: 'acc-1',
        orders: [],
        positions: [createMockPosition({ id: 'pos-a1' })],
        status: 'pending',
      },
      {
        id: 'acc-2',
        orders: [],
        positions: [createMockPosition({ id: 'pos-b1' })],
        status: 'pending',
      },
    ];

    await engine.execute(accounts);

    // acc-1 must be fully processed (close + lock) before acc-2 starts
    const lockAcc1 = callOrder.indexOf('lock:acc-1');
    const closeAcc2 = callOrder.indexOf('close:pos-b1');
    expect(lockAcc1).toBeLessThan(closeAcc2);
  });

  it('all accounts end up in completed list on success', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(3);
    const result = await engine.execute(accounts);

    expect(result.completed).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
  });
});

// ============================================================
// TEST SUITE 3: 5000ms timeout returns partial results
// Requirement 10 AC 4
// ============================================================

describe('3. 5000ms timeout returns partial results', () => {
  it('returns partial results when execution exceeds 5000ms', async () => {
    let callCount = 0;
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        callCount++;
        // First position closes quickly, second hangs
        if (callCount > 2) {
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [
      {
        id: 'acc-fast',
        orders: [],
        positions: [createMockPosition({ id: 'pos-fast-1' })],
        status: 'pending',
      },
      {
        id: 'acc-slow',
        orders: [],
        positions: [
          createMockPosition({ id: 'pos-slow-1' }),
          createMockPosition({ id: 'pos-slow-2' }),
          createMockPosition({ id: 'pos-slow-3' }),
        ],
        status: 'pending',
      },
    ];

    const executePromise = engine.execute(accounts);

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(5100);

    const result = await executePromise;

    expect(result.timedOut).toBe(true);
    // At least the first account should have completed
    expect(result.completed.length).toBeGreaterThanOrEqual(1);
  });

  it('does not time out when all accounts complete within 5000ms', async () => {
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        // Fast execution
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);
    const accounts = createTestAccounts(2);

    const executePromise = engine.execute(accounts);
    await vi.advanceTimersByTimeAsync(500);
    const result = await executePromise;

    expect(result.timedOut).toBe(false);
    expect(result.completed).toHaveLength(2);
  });

  it('result includes completedAt timestamp', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(1);
    const result = await engine.execute(accounts);

    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
    expect(result.completedAt!).toBeGreaterThanOrEqual(result.startedAt);
  });
});

// ============================================================
// TEST SUITE 4: Failed position closures retry
// Requirement 10 AC 5
// ============================================================

describe('4. Failed position closures retry (every 2s, max 15 retries)', () => {
  it('retries failed position closure and succeeds on subsequent attempt', async () => {
    let attempts = 0;
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('Network error');
        }
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-1',
      orders: [],
      positions: [createMockPosition({ id: 'pos-retry' })],
      status: 'pending',
    }];

    const executePromise = engine.execute(accounts);
    // Advance past retries (2 failures × 2s delay + execution)
    await vi.advanceTimersByTimeAsync(5000);
    const result = await executePromise;

    expect(attempts).toBe(3);
    expect(result.completed).toContain('acc-1');
  });

  it('marks account as failed after max 15 retries', async () => {
    let attempts = 0;
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        attempts++;
        throw new Error('Persistent failure');
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-1',
      orders: [],
      positions: [createMockPosition({ id: 'pos-fail' })],
      status: 'pending',
    }];

    const executePromise = engine.execute(accounts);
    // Advance past all retries: 15 retries × 2s = 30s
    await vi.advanceTimersByTimeAsync(35000);
    const result = await executePromise;

    expect(attempts).toBe(15);
    expect(result.failed).toContain('acc-1');
    expect(result.completed).not.toContain('acc-1');
  });

  it('retry interval is 2 seconds between attempts', async () => {
    const timestamps: number[] = [];
    let attempts = 0;
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        timestamps.push(Date.now());
        attempts++;
        if (attempts <= 3) throw new Error('Fail');
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-1',
      orders: [],
      positions: [createMockPosition({ id: 'pos-timing' })],
      status: 'pending',
    }];

    const executePromise = engine.execute(accounts);
    await vi.advanceTimersByTimeAsync(10000);
    await executePromise;

    // Check intervals between retry attempts are ~2000ms
    for (let i = 1; i < timestamps.length; i++) {
      const interval = timestamps[i] - timestamps[i - 1];
      expect(interval).toBeGreaterThanOrEqual(2000);
    }
  });
});

// ============================================================
// TEST SUITE 5: Rate limiting rejects second invocation within 60s
// Requirement 10 AC 8
// ============================================================

describe('5. Rate limiting rejects second invocation within 60 seconds', () => {
  it('rejects second execution within 60 seconds', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(1);
    await engine.execute(accounts);

    // Try to execute again immediately — need to re-arm
    engine.state.confirmStep = 2;
    await expect(engine.execute(accounts)).rejects.toThrow(/Rate limited/);
  });

  it('provides remaining wait time in rejection message', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(1);
    await engine.execute(accounts);

    // Advance 30 seconds (still within 60s window)
    vi.advanceTimersByTime(30000);

    engine.state.confirmStep = 2;
    try {
      await engine.execute(accounts);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('Rate limited');
      expect(err.message).toMatch(/Wait \d+ms/);
    }
  });

  it('allows execution after 60 seconds have elapsed', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(1);
    await engine.execute(accounts);

    // Advance past rate limit window
    vi.advanceTimersByTime(61000);

    // Re-arm and confirm
    engine.state.confirmStep = 0;
    armAndConfirm(engine);

    const result = await engine.execute(accounts);
    expect(result.completed).toHaveLength(1);
  });

  it('rate limit check returns allowed:true on first invocation', () => {
    const engine = createKillSwitchEngine();
    const check = engine.checkRateLimit();
    expect(check.allowed).toBe(true);
    expect(check.waitTimeMs).toBeUndefined();
  });
});

// ============================================================
// TEST SUITE 6: 2-click confirmation prevents accidental trigger
// Requirement 10 AC 7
// ============================================================

describe('6. 2-click confirmation prevents accidental trigger', () => {
  it('first click arms the kill switch', () => {
    const engine = createKillSwitchEngine();
    const result = engine.requestConfirmation();

    expect(result.armed).toBe(true);
    expect(engine.state.isArmed).toBe(true);
    expect(engine.state.confirmStep).toBe(1);
  });

  it('second click within 5s confirms execution', () => {
    const engine = createKillSwitchEngine();
    engine.requestConfirmation(); // first click

    // Second click immediately
    const result = engine.requestConfirmation();
    expect(result.armed).toBe(true);
    expect(engine.state.confirmStep).toBe(2);
  });

  it('second click after 5s resets (window expired)', () => {
    const engine = createKillSwitchEngine();
    engine.requestConfirmation(); // first click

    // Advance past confirm window
    vi.advanceTimersByTime(5001);

    const result = engine.requestConfirmation();
    expect(result.armed).toBe(false);
    expect(result.error).toContain('expired');
    expect(engine.state.confirmStep).toBe(0);
  });

  it('execution without confirmation throws error', async () => {
    const engine = createKillSwitchEngine();
    // Don't confirm — just try to execute
    const accounts = createTestAccounts(1);

    await expect(engine.execute(accounts)).rejects.toThrow(/not confirmed/);
  });

  it('single click (armed but not confirmed) prevents execution', async () => {
    const engine = createKillSwitchEngine();
    engine.requestConfirmation(); // only first click

    const accounts = createTestAccounts(1);
    await expect(engine.execute(accounts)).rejects.toThrow(/not confirmed/);
  });

  it('confirmation resets after successful execution', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(1);
    await engine.execute(accounts);

    expect(engine.state.confirmStep).toBe(0);
    expect(engine.state.isArmed).toBe(false);
  });
});

// ============================================================
// TEST SUITE 7: Audit trail logged with all required fields
// Requirement 10 AC 6
// ============================================================

describe('7. Audit trail logged with all required fields', () => {
  it('audit entry includes timestamp, userId, accountIds, positions, orders, reason', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-audit-1',
      orders: [
        createMockOrder({ id: 'aud-ord-1', status: 'OPEN' }),
        createMockOrder({ id: 'aud-ord-2', status: 'OPEN' }),
      ],
      positions: [
        createMockPosition({ id: 'aud-pos-1' }),
        createMockPosition({ id: 'aud-pos-2' }),
        createMockPosition({ id: 'aud-pos-3' }),
      ],
      status: 'pending',
    }];

    const result = await engine.execute(accounts);

    expect(result.auditTrail).toHaveLength(1);
    const entry = result.auditTrail[0];
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.userId).toBe('user-test-001');
    expect(entry.accountIds).toContain('acc-audit-1');
    expect(entry.positionsClosed).toBe(3);
    expect(entry.ordersCancelled).toBe(2);
    expect(entry.reason).toBe('emergency_kill_switch');
  });

  it('creates one audit entry per successfully processed account', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(3);
    const result = await engine.execute(accounts);

    expect(result.auditTrail).toHaveLength(3);
    expect(result.auditTrail[0].accountIds).toContain('account-1');
    expect(result.auditTrail[1].accountIds).toContain('account-2');
    expect(result.auditTrail[2].accountIds).toContain('account-3');
  });

  it('failed accounts do not generate audit entries', async () => {
    let accountCallCount = 0;
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        accountCallCount++;
        // Fail for second account's position
        if (accountCallCount > 2) {
          throw new Error('Closure failed');
        }
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);

    const accounts = createTestAccounts(2);

    const executePromise = engine.execute(accounts);
    await vi.advanceTimersByTimeAsync(35000);
    const result = await executePromise;

    // Only completed accounts get audit entries
    const completedAuditIds = result.auditTrail.flatMap((a) => a.accountIds);
    for (const failedId of result.failed) {
      expect(completedAuditIds).not.toContain(failedId);
    }
  });
});

// ============================================================
// TEST SUITE 8: Confirmation summary only on complete success
// Requirement 10 AC 9
// ============================================================

describe('8. Confirmation summary shown only on complete success', () => {
  it('shows summary when ALL accounts processed successfully', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    const accounts = createTestAccounts(3);
    await engine.execute(accounts);

    const summary = engine.getConfirmationSummary();
    expect(summary).not.toBeNull();
    expect(summary!.showSummary).toBe(true);
    expect(summary!.message).toContain('3 accounts processed successfully');
  });

  it('does NOT show success summary when some accounts failed', async () => {
    let callCount = 0;
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        callCount++;
        if (callCount > 2) throw new Error('Failed');
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);
    const accounts = createTestAccounts(2);

    const executePromise = engine.execute(accounts);
    await vi.advanceTimersByTimeAsync(35000);
    await executePromise;

    const summary = engine.getConfirmationSummary();
    expect(summary).not.toBeNull();
    expect(summary!.showSummary).toBe(false);
    expect(summary!.message).toContain('manual intervention');
  });

  it('does NOT show success summary on timeout (partial result)', async () => {
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return { status: 'closed' };
      },
    });

    armAndConfirm(engine);
    const accounts = createTestAccounts(3);

    const executePromise = engine.execute(accounts);
    await vi.advanceTimersByTimeAsync(5100);
    await executePromise;

    const summary = engine.getConfirmationSummary();
    expect(summary).not.toBeNull();
    expect(summary!.showSummary).toBe(false);
  });

  it('returns null summary before execution', () => {
    const engine = createKillSwitchEngine();
    const summary = engine.getConfirmationSummary();
    expect(summary).toBeNull();
  });
});

// ============================================================
// TEST SUITE 9: Progress indicator updates as accounts processed
// Requirement 10 AC 10
// ============================================================

describe('9. Progress indicator updates as accounts are processed', () => {
  it('progress callback fires for each account processed', async () => {
    const progressUpdates: { processed: number; total: number }[] = [];
    const engine = createKillSwitchEngine({
      onProgress: (processed, total) => {
        progressUpdates.push({ processed, total });
      },
    });

    armAndConfirm(engine);
    const accounts = createTestAccounts(3);
    await engine.execute(accounts);

    expect(progressUpdates).toHaveLength(3);
    expect(progressUpdates[0]).toEqual({ processed: 1, total: 3 });
    expect(progressUpdates[1]).toEqual({ processed: 2, total: 3 });
    expect(progressUpdates[2]).toEqual({ processed: 3, total: 3 });
  });

  it('progress starts at 0 and reaches total on completion', async () => {
    const engine = createKillSwitchEngine();
    armAndConfirm(engine);

    expect(engine.state.progress).toEqual({ processed: 0, total: 0 });

    const accounts = createTestAccounts(4);
    await engine.execute(accounts);

    expect(engine.state.progress).toEqual({ processed: 4, total: 4 });
  });

  it('progress includes failed accounts in the count', async () => {
    let callCount = 0;
    const progressUpdates: { processed: number; total: number }[] = [];
    const engine = createKillSwitchEngine({
      exitPosition: async () => {
        callCount++;
        if (callCount === 3) throw new Error('Fail');
        return { status: 'closed' };
      },
      onProgress: (processed, total) => {
        progressUpdates.push({ processed, total });
      },
    });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [
      {
        id: 'acc-ok',
        orders: [],
        positions: [createMockPosition({ id: 'p1' }), createMockPosition({ id: 'p2' })],
        status: 'pending',
      },
      {
        id: 'acc-fail',
        orders: [],
        positions: [createMockPosition({ id: 'p3' })],
        status: 'pending',
      },
    ];

    const executePromise = engine.execute(accounts);
    await vi.advanceTimersByTimeAsync(35000);
    await executePromise;

    // Both accounts should have progress updates (success and failure)
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    const lastUpdate = progressUpdates[progressUpdates.length - 1];
    expect(lastUpdate.processed).toBe(lastUpdate.total);
  });

  it('store state reflects positions being cleared during execution', async () => {
    const engine = createKillSwitchEngine({
      exitPosition: async (id) => {
        // Simulate store update when position is closed
        act(() => {
          const currentPositions = useTradingStore.getState().positions;
          useTradingStore.setState({
            positions: currentPositions.filter((p) => p.id !== id),
          });
        });
        return { status: 'closed' };
      },
    });

    // Set initial positions in store
    const pos1 = createMockPosition({ id: 'store-pos-1' });
    const pos2 = createMockPosition({ id: 'store-pos-2' });
    useTradingStore.setState({ positions: [pos1, pos2] });

    armAndConfirm(engine);

    const accounts: KillSwitchAccount[] = [{
      id: 'acc-store',
      orders: [],
      positions: [pos1, pos2],
      status: 'pending',
    }];

    await engine.execute(accounts);

    // Store should have no positions left
    expect(useTradingStore.getState().positions).toHaveLength(0);
  });
});
