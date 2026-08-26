// Diagnostic test — identify what blocks validateOrder for qty=65
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../repositories/risk-rules.repository.js', () => ({
  RiskRulesRepository: vi.fn().mockImplementation(() => ({
    getRulesMap: vi.fn().mockResolvedValue({
      allowed_segments: { segments: ['NSE','BSE','NFO','BFO','MCX','CDS'] },
    }),
  })),
}));
vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: vi.fn().mockImplementation(() => ({
    countOpenPositions: vi.fn().mockResolvedValue(0),
    getTotalUnrealizedPnl: vi.fn().mockResolvedValue(0),
    findOpenByAccountId: vi.fn().mockResolvedValue([]),
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
    findById: vi.fn().mockResolvedValue({ id:'test', status:'active', balance:10000000, peak_balance:10000000, trader_id:'t1' }),
    lockAccount: vi.fn().mockResolvedValue(null),
    breachAccount: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../repositories/metrics.repository.js', () => ({
  MetricsRepository: vi.fn().mockImplementation(() => ({ upsertDailyMetrics: vi.fn().mockResolvedValue(null) })),
}));
vi.mock('../repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({ log: vi.fn().mockResolvedValue(null) })),
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

describe('DIAGNOSTIC', () => {
  it('NIFTY FUT qty=65 — log full result WITH setSystemTime', async () => {
    // Spy on checkMarketHoliday and checkWeekend directly
    const spyH = vi.spyOn(RiskEngine, 'checkMarketHoliday').mockResolvedValue({ allowed: true });
    const spyW = vi.spyOn(RiskEngine, 'checkWeekend').mockResolvedValue({ allowed: true });
    const r = await RiskEngine.validateOrder('test', {
      symbol:'NIFTY FUT', token:'58072', segment:'NFO',
      side:'BUY', orderType:'MARKET', productType:'MIS', qty:65,
    }, () => 24300);
    console.log('WITH SPIES RESULT:', JSON.stringify(r, null, 2));
    spyH.mockRestore();
    spyW.mockRestore();
    expect(typeof r).toBe('object');
  });

  it('also test individual check: checkFuturesLotMultiple qty=65', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple({
      symbol:'NIFTY FUT', token:'58072', segment:'NFO',
      side:'BUY', orderType:'MARKET', productType:'MIS', qty:65,
    });
    console.log('LOT CHECK RESULT:', JSON.stringify(r));
    expect(typeof r).toBe('object');
  });
});
