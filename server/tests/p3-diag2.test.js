// Minimal diagnostic — find what _getRulesMap returns
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../repositories/risk-rules.repository.js', () => ({
  RiskRulesRepository: vi.fn().mockImplementation(() => ({
    getRulesMap: vi.fn().mockResolvedValue({ allowed_segments: { segments: ['NFO'] } }),
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
    getTradesSince: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../repositories/account.repository.js', () => ({
  AccountRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue({ id:'test', status:'active', balance:1e7, peak_balance:1e7, trader_id:'t1' }),
    lockAccount: vi.fn(), breachAccount: vi.fn(), update: vi.fn(),
  })),
}));
vi.mock('../repositories/metrics.repository.js', () => ({
  MetricsRepository: vi.fn().mockImplementation(() => ({ upsertDailyMetrics: vi.fn() })),
}));
vi.mock('../repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({ log: vi.fn() })),
}));
vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));
vi.mock('./marginService.js', () => ({
  MarginService: { validateMargin: vi.fn().mockResolvedValue({ allowed: true }) },
}));
vi.mock('./holidayService.js', () => ({
  HolidayService: {
    checkMarketClosed: vi.fn().mockReturnValue({ isClosed: false, isWeekend: false, holidayName: null }),
    getUpcomingHolidays: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('../clients/lifecycle.callback.js', () => ({
  LifecycleCallbackClient: { notifyChallengePassed: vi.fn(), notifyChallengeFailed: vi.fn() },
}));
vi.mock('../services/futuresContractService.js', () => ({
  futuresContractService: {
    _dhanHistorical: { getLotSize: () => 65, getTickSize: () => 10 },
    resolveUnderlying: () => Promise.resolve({ securityId:'58072', segment:'NSE_FNO', lotSize:65, tickSize:10 }),
  },
}));

import { RiskEngine } from '../services/riskEngine.js';

describe('diag2', () => {
  it('call _getRulesMap directly', async () => {
    const rules = await RiskEngine._getRulesMap('test-account', {
      id: 'test-account', status: 'active', balance: 1e7, peak_balance: 1e7, trader_id: 't1',
    });
    console.log('RULES:', JSON.stringify(rules));
    expect(rules).toBeDefined();
  });
});
