/**
 * RISK ENGINE — Unit Tests
 * 
 * Tests the actual server/services/riskEngine.js implementation.
 * Validates pre-trade and post-trade checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase and repositories
vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../repositories/risk-rules.repository.js', () => ({
  RiskRulesRepository: vi.fn().mockImplementation(() => ({
    getRulesMap: vi.fn().mockResolvedValue({}),
  })),
}));
vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: vi.fn().mockImplementation(() => ({
    countOpenPositions: vi.fn().mockResolvedValue(0),
    getTotalUnrealizedPnl: vi.fn().mockResolvedValue(0),
  })),
}));
vi.mock('../repositories/trade.repository.js', () => ({
  TradeRepository: vi.fn().mockImplementation(() => ({
    countTodayTrades: vi.fn().mockResolvedValue(0),
    getTodayRealizedPnl: vi.fn().mockResolvedValue([]),
    findTodayTrades: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../repositories/account.repository.js', () => ({
  AccountRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue({ id: 'acc-1', status: 'active', balance: 1000000, peak_balance: 1000000, trader_id: 'trader-1' }),
    lockAccount: vi.fn().mockResolvedValue(null),
    breachAccount: vi.fn().mockResolvedValue(null),
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
    getUpcomingHolidays: vi.fn().mockReturnValue([]),
  },
}));

import { RiskEngine } from '../services/riskEngine.js';
import { RiskRulesRepository } from '../repositories/risk-rules.repository.js';
import { PositionRepository } from '../repositories/position.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { TradeRepository } from '../repositories/trade.repository.js';
import { eventBus } from '../events/index.js';

describe('RiskEngine.validateOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects order when account status is not active', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.findById.mockResolvedValue({ id: 'acc-1', status: 'locked', balance: 1000000 });
    
    const result = await RiskEngine.validateOrder('acc-1', { segment: 'NSE', productType: 'MIS', qty: 1 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('locked');
  });

  it('allows order when no rules are configured', async () => {
    const result = await RiskEngine.validateOrder('acc-1', { segment: 'NSE', productType: 'MIS', qty: 1 });
    expect(result.allowed).toBe(true);
  });

  it('rejects order when segment is not allowed', async () => {
    const result = await RiskEngine.checkAllowedSegments(
      { allowed_segments: { segments: ['NSE', 'NFO'] } },
      { segment: 'MCX' }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('MCX');
  });

  it('allows order when segment is in allowed list', async () => {
    const result = await RiskEngine.checkAllowedSegments(
      { allowed_segments: { segments: ['NSE', 'NFO', 'MCX'] } },
      { segment: 'MCX' }
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects order when max positions reached', async () => {
    const posRepo = new PositionRepository();
    posRepo.countOpenPositions.mockResolvedValue(10);

    const result = await RiskEngine.checkMaxPositions(
      { max_positions: { count: 10 } },
      'acc-1'
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Max positions');
  });

  it('rejects order when lot size exceeds max', async () => {
    const result = await RiskEngine.checkMaxLotSize(
      { max_lot_size: { nse: 5, default: 10 } },
      { segment: 'nse', qty: 60, lotSize: 10 }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('max lot size');
  });

  it('rejects overnight order after cutoff', async () => {
    // Mock time past cutoff
    const now = new Date();
    now.setHours(15, 20, 0, 0);
    vi.setSystemTime(now);

    const result = await RiskEngine.checkNoOvernight(
      { no_overnight: { cutoffTime: '15:15', allowedProducts: ['MIS'] } },
      { productType: 'CNC' }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Overnight');

    vi.useRealTimers();
  });

  it('allows MIS order regardless of no_overnight rule', async () => {
    const result = await RiskEngine.checkNoOvernight(
      { no_overnight: { cutoffTime: '15:15', allowedProducts: ['MIS'] } },
      { productType: 'MIS' }
    );
    expect(result.allowed).toBe(true);
  });
});

describe('RiskEngine.postTradeCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks account when daily loss limit is breached', async () => {
    const riskRulesRepo = new RiskRulesRepository();
    riskRulesRepo.getRulesMap.mockResolvedValue({
      daily_loss_limit: { amount: 50000 },
    });
    const tradeRepo = new TradeRepository();
    tradeRepo.getTodayRealizedPnl.mockResolvedValue([
      { token: 'T1', side: 'BUY', qty: 100, price: 100 },
      { token: 'T1', side: 'SELL', qty: 100, price: 45 }, // loss of 5500
    ]);

    const accountRepo = new AccountRepository();
    accountRepo.findById.mockResolvedValue({
      id: 'acc-1', status: 'active', balance: 950000, peak_balance: 1000000, trader_id: 'trader-1',
    });

    const posRepo = new PositionRepository();
    posRepo.getTotalUnrealizedPnl.mockResolvedValue(-55000); // Total daily P&L = -55000

    const result = await RiskEngine.postTradeCheck('acc-1');
    expect(result.status).toBe('locked');
    expect(accountRepo.lockAccount).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith('account.locked', expect.any(Object), expect.any(Object));
  });

  it('returns ok when within limits', async () => {
    const riskRulesRepo = new RiskRulesRepository();
    riskRulesRepo.getRulesMap.mockResolvedValue({
      daily_loss_limit: { amount: 50000 },
    });

    const result = await RiskEngine.postTradeCheck('acc-1');
    expect(result.status).toBe('ok');
  });
});

describe('RiskEngine.checkNewsBlackout', () => {
  it('rejects during news blackout window', async () => {
    const now = new Date();
    now.setHours(14, 15, 0, 0);
    vi.setSystemTime(now);

    const result = await RiskEngine.checkNewsBlackout({
      news_blackout: { windows: [{ start: '14:00', end: '14:30', label: 'RBI Policy' }] },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('RBI Policy');

    vi.useRealTimers();
  });

  it('allows outside news blackout window', async () => {
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    vi.setSystemTime(now);

    const result = await RiskEngine.checkNewsBlackout({
      news_blackout: { windows: [{ start: '14:00', end: '14:30', label: 'RBI Policy' }] },
    });
    expect(result.allowed).toBe(true);

    vi.useRealTimers();
  });
});
