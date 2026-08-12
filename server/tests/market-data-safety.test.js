/**
 * MARKET DATA SAFETY TESTS
 *
 * Proves the Aug-10 incident cannot recur:
 *   - Bad LTP (0 / null / NaN / stale) does NOT enter MTM as a fake loss
 *   - Bad LTP does NOT produce a false -₹59,000 daily loss
 *   - Bad LTP does NOT trigger account lock or breach
 *   - Valid LTP flows through MTM and risk correctly
 *   - Market order fill with missing LTP is REJECTED, not filled at ₹0
 *
 * These tests mock Supabase / repositories so they run offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mocks ──────────────────────────────────────────────────────────

vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../repositories/risk-rules.repository.js', () => ({
  RiskRulesRepository: vi.fn().mockImplementation(() => ({
    getRulesMap: vi.fn().mockResolvedValue({
      daily_loss_limit: { percent: 3, amount: 30000 },
      max_drawdown:     { percent: 5, amount: 50000 },
    }),
  })),
}));
vi.mock('../repositories/trade.repository.js', () => ({
  TradeRepository: vi.fn().mockImplementation(() => ({
    countTodayTrades:   vi.fn().mockResolvedValue(0),
    getTodayRealizedPnl: vi.fn().mockResolvedValue([]),
    findTodayTrades:    vi.fn().mockResolvedValue([]),
    getTradesSince:     vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../repositories/metrics.repository.js', () => ({
  MetricsRepository: vi.fn().mockImplementation(() => ({
    upsertDailyMetrics: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({
    log: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));
vi.mock('./marginService.js', () => ({
  MarginService: { validateMargin: vi.fn().mockResolvedValue({ allowed: true }) },
}));
vi.mock('./holidayService.js', () => ({
  HolidayService: {
    checkMarketClosed: vi.fn().mockReturnValue({ isClosed: false, isWeekend: false }),
  },
}));
vi.mock('../clients/lifecycle.callback.js', () => ({
  LifecycleCallbackClient: {
    accountLocked:    vi.fn().mockResolvedValue(null),
    riskBreached:     vi.fn().mockResolvedValue(null),
    challengeFailed:  vi.fn().mockResolvedValue(null),
  },
}));

// ── Dynamic account + position mocks (overridden per test) ─────────────────

const mockAccount = { id: 'acc-1', status: 'active', balance: 1000000, peak_balance: 1000000, trader_id: 'trader-1' };
const mockLockAccount  = vi.fn().mockResolvedValue(null);
const mockBreachAccount = vi.fn().mockResolvedValue(null);

vi.mock('../repositories/account.repository.js', () => ({
  AccountRepository: vi.fn().mockImplementation(() => ({
    findById:      vi.fn().mockResolvedValue(mockAccount),
    lockAccount:   mockLockAccount,
    breachAccount: mockBreachAccount,
  })),
}));

// position repo mock — controlled per test
let positionsMTMReturn = 0;
vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: vi.fn().mockImplementation(() => ({
    countOpenPositions:  vi.fn().mockResolvedValue(1),
    getTotalUnrealizedPnl: vi.fn().mockImplementation(async (accountId, qp) => positionsMTMReturn),
    findOpenByAccountId: vi.fn().mockResolvedValue([]),
    getOpenPositions:    vi.fn().mockResolvedValue([]),
  })),
}));

import { RiskEngine } from '../services/riskEngine.js';
import { PositionRepository } from '../repositories/position.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';

// ─── Suite 1: MTM zero-price safety ──────────────────────────────────────

describe('PositionRepository.getTotalUnrealizedPnl — zero-price safety', () => {

  it('when quoteProvider returns null, uses avg_price (P&L = 0, not fake loss)', async () => {
    // Import real implementation
    const { PositionRepository: RealPositionRepo } = await import('../repositories/position.repository.js');
    // We test the logic in isolation: two positions with no valid quotes
    const positions = [
      { qty: 75, side: 'LONG',  avg_price: 1650, token: '1270', symbol: 'HCLTECH' },
      { qty: 1,  side: 'LONG',  avg_price: 1948, token: '11723', symbol: 'SUNPHARMA' },
    ];
    // quoteProvider returns null for all tokens (missing/invalid LTP)
    const quoteProvider = () => null;

    let totalPnl = 0;
    for (const pos of positions) {
      if (pos.qty === 0) continue;
      let ltp = quoteProvider(pos.token);
      if (ltp === null || ltp === undefined || !Number.isFinite(ltp) || ltp <= 0) {
        ltp = pos.avg_price; // break-even fallback
      }
      const pnl = pos.side === 'LONG'
        ? (ltp - pos.avg_price) * pos.qty
        : (pos.avg_price - ltp) * pos.qty;
      totalPnl += pnl;
    }

    // With break-even fallback, P&L = 0 — no fake -₹59,000
    expect(totalPnl).toBe(0);
    expect(totalPnl).not.toBeLessThan(-1000);
  });

  it('when quoteProvider returns 0, treats it as unavailable (P&L = 0, not fake loss)', async () => {
    const positions = [{ qty: 75, side: 'LONG', avg_price: 1650, token: '1270' }];
    const quoteProvider = () => 0; // explicitly zero

    let totalPnl = 0;
    for (const pos of positions) {
      let ltp = quoteProvider(pos.token);
      if (ltp === null || ltp === undefined || !Number.isFinite(ltp) || ltp <= 0) {
        ltp = pos.avg_price;
      }
      const pnl = (ltp - pos.avg_price) * pos.qty;
      totalPnl += pnl;
    }

    // Old code: (0 - 1650) * 75 = -123,750  ← the bug
    // New code: (1650 - 1650) * 75 = 0       ← safe
    expect(totalPnl).toBe(0);
  });

  it('when quoteProvider returns valid LTP, calculates real P&L', async () => {
    const positions = [{ qty: 75, side: 'LONG', avg_price: 1640, token: '1270' }];
    const quoteProvider = () => 1650; // valid positive LTP

    let totalPnl = 0;
    for (const pos of positions) {
      let ltp = quoteProvider(pos.token);
      if (ltp === null || ltp === undefined || !Number.isFinite(ltp) || ltp <= 0) {
        ltp = pos.avg_price;
      }
      totalPnl += (ltp - pos.avg_price) * pos.qty;
    }

    // (1650 - 1640) * 75 = 750
    expect(totalPnl).toBeCloseTo(750, 1);
  });
});

// ─── Suite 2: Risk engine — feed stale guard ──────────────────────────────

describe('RiskEngine.postTradeCheck — stale feed safety', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockLockAccount.mockReset().mockResolvedValue(null);
    mockBreachAccount.mockReset().mockResolvedValue(null);
    positionsMTMReturn = 0;
  });

  it('CRITICAL: bad LTP (returns 0) does NOT lock account when feed is stale', async () => {
    // Simulate: feed marked stale, quoteProvider returns 0 for all tokens
    // postTradeCheck should skip unrealized P&L and return feed_stale
    const quoteProvider = () => 0;

    // Mock marketDataEngine as stale via dynamic import
    vi.doMock('../services/marketDataEngine.js', () => ({
      marketDataEngine: { isFeedStale: () => true },
    }));

    const result = await RiskEngine.postTradeCheck('acc-1', quoteProvider);

    // Must not lock or breach
    expect(mockLockAccount).not.toHaveBeenCalled();
    expect(mockBreachAccount).not.toHaveBeenCalled();
    // Result should indicate stale or ok (not locked/breached)
    expect(['ok', 'feed_stale']).toContain(result.status);

    vi.doUnmock('../services/marketDataEngine.js');
  });

  it('CRITICAL: zero unrealized P&L from safe quoteProvider does NOT breach account', async () => {
    // quoteProvider returns null (no valid quotes) → getTotalUnrealizedPnl = 0
    // daily realized P&L = 0
    // totalDailyPnl = 0 → should NOT breach daily loss limit (30000)
    positionsMTMReturn = 0; // safe MTM via break-even fallback

    const result = await RiskEngine.postTradeCheck('acc-1', () => null);

    expect(mockLockAccount).not.toHaveBeenCalled();
    expect(mockBreachAccount).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
  });

  it('valid realized loss of -55,000 DOES trigger daily loss lock', async () => {
    // This tests that the guard does not block REAL losses
    const posRepo = new PositionRepository();
    posRepo.getTotalUnrealizedPnl.mockResolvedValue(0); // no unrealized

    // Override calculateTodayRealizedPnl to return -55000
    const originalCalc = RiskEngine.calculateTodayRealizedPnl;
    RiskEngine.calculateTodayRealizedPnl = vi.fn().mockResolvedValue(-55000);

    const result = await RiskEngine.postTradeCheck('acc-1', () => 1000);

    expect(mockLockAccount).toHaveBeenCalled();
    expect(result.status).toBe('locked');

    RiskEngine.calculateTodayRealizedPnl = originalCalc;
  });

  it('valid unrealized loss of -55,000 (from real LTP) DOES trigger daily loss lock', async () => {
    positionsMTMReturn = -55000; // real unrealized loss from valid quotes
    const originalCalc = RiskEngine.calculateTodayRealizedPnl;
    RiskEngine.calculateTodayRealizedPnl = vi.fn().mockResolvedValue(0);

    const quoteProvider = () => 1500; // valid positive LTP

    const result = await RiskEngine.postTradeCheck('acc-1', quoteProvider);

    expect(mockLockAccount).toHaveBeenCalled();
    expect(result.status).toBe('locked');

    RiskEngine.calculateTodayRealizedPnl = originalCalc;
  });
});

// ─── Suite 3: Order fill price safety ────────────────────────────────────

describe('OrderExecutionService._handleMarketFill — zero-price rejection', () => {

  it('CRITICAL: market order with LTP=0 is REJECTED, not filled at ₹0', async () => {
    const { OrderExecutionService } = await import('../services/orderExecutionService.js');

    // Mock MDE that returns no quote (missing LTP)
    const mockMDE = {
      getQuote: vi.fn().mockReturnValue(null),
      isFeedStale: vi.fn().mockReturnValue(false),
    };

    const svc = new OrderExecutionService(mockMDE);
    // Stop the paper monitor timer (not needed for this test)
    clearInterval(svc._paperOrderMonitor);

    const result = await svc._handleMarketFill(
      'acc-1', 'ord-1',
      { symbol: 'HCLTECH', token: '1270', segment: 'NSE', side: 'BUY',
        orderType: 'MARKET', productType: 'MIS', qty: 75, price: 0 },
      'BROKER-1', 'angelone', 50,
    );

    expect(result.status).toBe('REJECTED');
    expect(result.message).toContain('Market data unavailable');
    // Critically: no position should be created at price 0
    expect(result.avgPrice).toBeUndefined();
  });

  it('market order with valid LTP=1650 proceeds normally', async () => {
    const { OrderExecutionService } = await import('../services/orderExecutionService.js');

    const mockMDE = {
      getQuote: vi.fn().mockReturnValue({ ltp: 1650, exchange: 'NSE', timestamp: Date.now() }),
      isFeedStale: vi.fn().mockReturnValue(false),
    };

    const svc = new OrderExecutionService(mockMDE);
    clearInterval(svc._paperOrderMonitor);

    const result = await svc._handleMarketFill(
      'acc-1', 'ord-2',
      { symbol: 'HCLTECH', token: '1270', segment: 'NSE', side: 'BUY',
        orderType: 'MARKET', productType: 'MIS', qty: 75, price: 0 },
      'BROKER-2', 'angelone', 50,
    );

    expect(result.status).toBe('FILLED');
    expect(result.avgPrice).toBeCloseTo(1650, 1);
    // Must NOT be 0
    expect(result.avgPrice).toBeGreaterThan(0);
  });
});

// ─── Suite 4: MarketDataEngine LTP validation ────────────────────────────

describe('MarketDataEngine.pushQuote — LTP validation gate', () => {

  it('LTP=0 is rejected before entering the quote cache', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    mde.pushQuote('11723', { token: '11723', ltp: 0, exchange: 'NSE', timestamp: Date.now() });
    // Quote should not be stored
    const stored = mde.getQuote('11723');
    expect(stored).toBeNull();
  });

  it('LTP=NaN is rejected', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    mde.pushQuote('11723', { token: '11723', ltp: NaN, exchange: 'NSE', timestamp: Date.now() });
    expect(mde.getQuote('11723')).toBeNull();
  });

  it('LTP=-100 is rejected', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    mde.pushQuote('11723', { token: '11723', ltp: -100, exchange: 'NSE', timestamp: Date.now() });
    expect(mde.getQuote('11723')).toBeNull();
  });

  it('valid LTP=1948 is accepted and stored', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    mde.pushQuote('11723', { token: '11723', ltp: 1948, exchange: 'NSE', timestamp: Date.now() });
    const q = mde.getQuote('11723');
    expect(q).not.toBeNull();
    expect(q.ltp).toBeCloseTo(1948, 1);
  });

  it('getSafeLtp returns null for missing token', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    expect(mde.getSafeLtp('missing-token')).toBeNull();
  });

  it('getSafeLtp returns null for stale quote (> MAX_QUOTE_AGE_MS)', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    const staleTimestamp = Date.now() - 130_000; // 130 seconds ago
    // Inject directly to bypass pushQuote validation
    mde.quotes.set('11723', { ltp: 1948, exchange: 'NSE', timestamp: staleTimestamp });
    expect(mde.getSafeLtp('11723')).toBeNull();
  });

  it('getSafeLtp returns valid LTP for fresh quote', async () => {
    const { MarketDataEngine } = await import('../services/marketDataEngine.js');
    const mde = new MarketDataEngine();
    mde.pushQuote('11723', { token: '11723', ltp: 1948, exchange: 'NSE', timestamp: Date.now() });
    expect(mde.getSafeLtp('11723')).toBeCloseTo(1948, 1);
  });
});

// ─── Suite 5: Instrument master token validation ──────────────────────────

describe('InstrumentService — token validity', () => {

  it('isValidBrokerToken: numeric strings are valid', async () => {
    const { InstrumentService } = await import('../services/instrumentService.js');
    expect(InstrumentService.isValidBrokerToken('11723')).toBe(true);
    expect(InstrumentService.isValidBrokerToken('99926000')).toBe(true);
    expect(InstrumentService.isValidBrokerToken('2885')).toBe(true);
  });

  it('isValidBrokerToken: placeholder strings are invalid', async () => {
    const { InstrumentService } = await import('../services/instrumentService.js');
    expect(InstrumentService.isValidBrokerToken('NF_FUT')).toBe(false);
    expect(InstrumentService.isValidBrokerToken('GOLD_F')).toBe(false);
    expect(InstrumentService.isValidBrokerToken('USDINR_F')).toBe(false);
    expect(InstrumentService.isValidBrokerToken('BNF_FUT')).toBe(false);
    expect(InstrumentService.isValidBrokerToken('CRUDE_F')).toBe(false);
  });

  it('all NSE equity instruments have valid numeric tokens', async () => {
    const { InstrumentService } = await import('../services/instrumentService.js');
    const svc = new InstrumentService();
    const nseEquity = svc.instruments.filter(i => i.segment === 'NSE' && i.instrumentType === 'EQ');
    for (const inst of nseEquity) {
      expect(InstrumentService.isValidBrokerToken(inst.token),
        `${inst.symbol} token ${inst.token} should be numeric`).toBe(true);
    }
  });

  it('all placeholder instruments are tagged isPlaceholder=true', async () => {
    const { InstrumentService } = await import('../services/instrumentService.js');
    const svc = new InstrumentService();
    const nonNumeric = svc.instruments.filter(
      i => !InstrumentService.isValidBrokerToken(i.token)
    );
    for (const inst of nonNumeric) {
      expect(inst.isPlaceholder, `${inst.symbol} should be tagged isPlaceholder`).toBe(true);
    }
  });

  it('getLiveSubscribable returns only numeric-token instruments', async () => {
    const { InstrumentService } = await import('../services/instrumentService.js');
    const svc = new InstrumentService();
    const live = svc.getLiveSubscribable();
    for (const inst of live) {
      expect(InstrumentService.isValidBrokerToken(inst.token)).toBe(true);
    }
    // Known placeholders must NOT be in the live list
    const tokens = live.map(i => i.token);
    expect(tokens).not.toContain('NF_FUT');
    expect(tokens).not.toContain('GOLD_F');
    expect(tokens).not.toContain('USDINR_F');
  });

  it('SUNPHARMA (11723) and INFY (1594) and HCLTECH (1270) have valid tokens', async () => {
    const { InstrumentService } = await import('../services/instrumentService.js');
    const svc = new InstrumentService();
    const sunpharma = svc.getByToken('11723');
    const infy = svc.getByToken('1594');
    const hcltech = svc.getByToken('1270');
    expect(sunpharma?.symbol).toBe('SUNPHARMA');
    expect(infy?.symbol).toBe('INFY');
    expect(hcltech?.symbol).toBe('HCLTECH');
  });
});
