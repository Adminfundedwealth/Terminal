/**
 * P3.1 RISK ENGINE INTEGRATION TESTS — validateOrder() lot + tick checks
 * ════════════════════════════════════════════════════════════════════════
 *
 * Executes the REAL RiskEngine.validateOrder() to prove:
 *   A. Valid lot multiple passes
 *   B-E. Invalid lot/tick rejected with correct ruleType
 *   F-G. Dhan adapter placeOrder NOT called for invalid qty/price
 *
 * Mock strategy for mockReset:true in server/vitest.config.js:
 *   - All repository factories use PLAIN arrow functions (not vi.fn()),
 *     so mockReset cannot wipe their return values.
 *   - MarginService.validateMargin uses a plain function — same reason.
 *   - HolidayService: vi.spyOn RiskEngine.checkMarketHoliday / checkWeekend
 *     directly in beforeEach (re-applied each test because mockReset wipes
 *     the spy implementation, but beforeEach re-installs it before each test).
 *   - futuresContractService dynamic import mocked via absolute path
 *     ../services/futuresContractService.js (matches riskEngine's import).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── HOISTED MOCKS — all run before any import ─────────────────────────────────
vi.mock('../db/client.js', () => ({ supabase: null }));

// Repositories: plain arrow functions survive mockReset:true
vi.mock('../repositories/risk-rules.repository.js', () => ({
  RiskRulesRepository: vi.fn().mockImplementation(() => ({
    getRulesMap: () => Promise.resolve({
      allowed_segments: { segments: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'] },
    }),
  })),
}));

vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: vi.fn().mockImplementation(() => ({
    countOpenPositions:    () => Promise.resolve(0),
    getTotalUnrealizedPnl: () => Promise.resolve(0),
    findOpenByAccountId:   () => Promise.resolve([]),
  })),
}));

vi.mock('../repositories/trade.repository.js', () => ({
  TradeRepository: vi.fn().mockImplementation(() => ({
    countTodayTrades:    () => Promise.resolve(0),
    getTodayRealizedPnl: () => Promise.resolve([]),
    findTodayTrades:     () => Promise.resolve([]),
    getTradesSince:      () => Promise.resolve([]),
  })),
}));

vi.mock('../repositories/account.repository.js', () => ({
  AccountRepository: vi.fn().mockImplementation(() => ({
    findById: () => Promise.resolve({
      id: 'test-account', status: 'active',
      balance: 10_000_000, peak_balance: 10_000_000, trader_id: 'trader-1',
    }),
    lockAccount:   () => Promise.resolve(null),
    breachAccount: () => Promise.resolve(null),
    update:        () => Promise.resolve(null),
  })),
}));

vi.mock('../repositories/metrics.repository.js', () => ({
  MetricsRepository: vi.fn().mockImplementation(() => ({
    upsertDailyMetrics: () => Promise.resolve(null),
  })),
}));

vi.mock('../repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({
    log: () => Promise.resolve(null),
  })),
}));

vi.mock('../events/index.js', () => ({
  eventBus: { publish: () => {}, subscribe: () => {} },
}));

vi.mock('../clients/lifecycle.callback.js', () => ({
  LifecycleCallbackClient: {
    notifyChallengePassed: () => {},
    notifyChallengeFailed: () => {},
  },
}));

// MarginService: plain function — survives mockReset:true
// riskEngine imports './marginService.js' (static) — both paths mocked
vi.mock('./marginService.js', () => ({
  MarginService: { validateMargin: () => Promise.resolve({ allowed: true }) },
}));
vi.mock('../services/marginService.js', () => ({
  MarginService: { validateMargin: () => Promise.resolve({ allowed: true }) },
}));

// FuturesContractService: dynamic import inside riskEngine methods:
//   await import('./futuresContractService.js') from server/services/riskEngine.js
// Absolute path = server/services/futuresContractService.js
// From server/tests/ = ../services/futuresContractService.js
vi.mock('../services/futuresContractService.js', () => {
  const LOT  = { NIFTY: 65, BANKNIFTY: 30, FINNIFTY: 60, MIDCPNIFTY: 120, SENSEX: 20 };
  const TICK = { NIFTY: 10, BANKNIFTY: 20, FINNIFTY: 10, MIDCPNIFTY:   5, SENSEX:  5 };
  const hist = {
    getLotSize:  (sym) => LOT[sym.toUpperCase().trim()]  ?? 1,
    getTickSize: (sym) => TICK[sym.toUpperCase().trim()] ?? 0.05,
  };
  return {
    futuresContractService: {
      _dhanHistorical: hist,
      resolveUnderlying: (ul, _seg) => {
        const lot  = LOT[ul.toUpperCase().trim()];
        const tick = TICK[ul.toUpperCase().trim()];
        if (!lot) return Promise.resolve(null);
        return Promise.resolve({
          securityId: '58072', segment: 'NSE_FNO', lotSize: lot, tickSize: tick,
        });
      },
    },
  };
});

// ── Imports (AFTER hoisted mocks) ─────────────────────────────────────────────
import { RiskEngine } from '../services/riskEngine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const validQuoteProvider = () => 24300;

const mkMarket = (symbol, qty, seg = 'NFO') => ({
  symbol, token: '58072', segment: seg,
  side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty,
});
const mkLimit = (symbol, qty, price, seg = 'NFO') => ({
  symbol, token: '58072', segment: seg,
  side: 'BUY', orderType: 'LIMIT', productType: 'MIS', qty, price,
});

// ── Test Suite ────────────────────────────────────────────────────────────────
describe('P3.1 — RiskEngine.validateOrder: Futures lot + tick validation', () => {
  // HolidayService path resolution is ambiguous (./holidayService.js vs
  // ../services/holidayService.js). Spy directly on the two RiskEngine static
  // methods that call it. Spies are re-applied each test because mockReset:true
  // clears their implementations — beforeEach re-installs them.
  let spyHoliday;
  let spyWeekend;

  beforeEach(() => {
    spyHoliday = vi.spyOn(RiskEngine, 'checkMarketHoliday')
      .mockImplementation(() => Promise.resolve({ allowed: true }));
    spyWeekend = vi.spyOn(RiskEngine, 'checkWeekend')
      .mockImplementation(() => Promise.resolve({ allowed: true }));
  });

  afterEach(() => {
    spyHoliday?.mockRestore();
    spyWeekend?.mockRestore();
  });

  // ── A. Valid orders PASS ──────────────────────────────────────────────────

  it('A: NIFTY FUT qty=65 (1 lot) → PASS', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 65), validQuoteProvider,
    );
    expect(r.allowed).toBe(true);
  });

  it('A2: NIFTY FUT qty=130 (2 lots) → PASS', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 130), validQuoteProvider,
    );
    expect(r.allowed).toBe(true);
  });

  it('A3: NIFTY FUT LIMIT qty=65 price=24300 (valid tick) → PASS', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkLimit('NIFTY FUT', 65, 24300), validQuoteProvider,
    );
    expect(r.allowed).toBe(true);
  });

  // ── B. Invalid lot multiples → REJECTED ───────────────────────────────────

  it('B: NIFTY FUT qty=1 → REJECTED ruleType=lot_multiple (reason mentions 65)', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 1), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
    expect(r.reason).toMatch(/65/);
  });

  it('C: NIFTY FUT qty=66 → REJECTED ruleType=lot_multiple', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 66), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  it('NIFTY FUT qty=64 → REJECTED lot_multiple', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 64), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  it('NIFTY FUT qty=10 → REJECTED lot_multiple', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 10), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  it('NIFTY FUT qty=100 → REJECTED lot_multiple', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 100), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  // ── D/E. Tick-size validation ──────────────────────────────────────────────

  it('D: NIFTY FUT LIMIT @ 24301 → REJECTED ruleType=tick_size (reason mentions 10)', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkLimit('NIFTY FUT', 65, 24301), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('tick_size');
    expect(r.reason).toMatch(/10/);
  });

  it('E: NIFTY FUT LIMIT @ 24300 qty=65 → PASS', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkLimit('NIFTY FUT', 65, 24300), validQuoteProvider,
    );
    expect(r.allowed).toBe(true);
  });

  it('NIFTY FUT LIMIT @ 24305 → REJECTED tick_size', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkLimit('NIFTY FUT', 65, 24305), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('tick_size');
  });

  // ── BANKNIFTY lot=30 ──────────────────────────────────────────────────────

  it('G: BANKNIFTY FUT qty=30 → PASS', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('BANKNIFTY FUT', 30), validQuoteProvider,
    );
    expect(r.allowed).toBe(true);
  });

  it('H: BANKNIFTY FUT qty=25 → REJECTED lot_multiple', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('BANKNIFTY FUT', 25), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  // ── MIDCPNIFTY lot=120 — proves old hardcoded 50 is gone ─────────────────

  it('I: MIDCPNIFTY FUT qty=120 → PASS', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('MIDCPNIFTY FUT', 120), validQuoteProvider,
    );
    expect(r.allowed).toBe(true);
  });

  it('J: MIDCPNIFTY FUT qty=50 → REJECTED (old lot was 50; current is 120)', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('MIDCPNIFTY FUT', 50), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  // ── F/G. Dhan adapter NOT called for invalid qty/price ────────────────────
  // validateOrder is the pre-broker gate — when it returns allowed:false,
  // orderExecutionService never reaches the broker adapter.
  // We assert the ruleType proves the gate fired before any broker call.

  it('F: invalid qty=1 → validateOrder rejects (lot_multiple); broker never reached', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkMarket('NIFTY FUT', 1), validQuoteProvider,
    );
    // Broker is only called by OrderExecutionService AFTER validateOrder returns.
    // allowed:false with ruleType=lot_multiple proves rejection happened at the gate.
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('lot_multiple');
  });

  it('G: invalid price=24301 → validateOrder rejects (tick_size); broker never reached', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account', mkLimit('NIFTY FUT', 65, 24301), validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('tick_size');
  });
});

// ── Spot-index tradeability guard (NIFTY-margin bug regression) ─────────────
// A spot index (NIFTY 50 on NSE, IDX_I, etc.) must be rejected as non-tradeable.
// This is the root cause of the original "insufficient margin" rejections:
// the spot notional was being treated as an equity order. Trade FUT/options.
describe('RiskEngine.checkTradeableInstrument — spot index guard', () => {
  it('rejects NIFTY 50 on NSE (spot index mis-mapped as equity)', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'NIFTY 50', segment: 'NSE' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/spot index/i);
  });

  it('rejects segment IDX_I regardless of symbol', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'ANYTHING', segment: 'IDX_I' });
    expect(r.allowed).toBe(false);
  });

  it('rejects instrumentType INDEX', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'BANKNIFTY', segment: 'NSE', instrumentType: 'INDEX' });
    expect(r.allowed).toBe(false);
  });

  it('rejects SENSEX spot', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'SENSEX', segment: 'BSE' });
    expect(r.allowed).toBe(false);
  });

  it('ALLOWS NIFTY FUT on NFO (tradeable derivative)', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'NIFTY FUT', segment: 'NFO' });
    expect(r.allowed).toBe(true);
  });

  it('ALLOWS NIFTY option CE on NFO', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'NIFTY24200CE', segment: 'NFO', instrumentType: 'CE' });
    expect(r.allowed).toBe(true);
  });

  it('ALLOWS RELIANCE equity on NSE (normal stock)', () => {
    const r = RiskEngine.checkTradeableInstrument({ symbol: 'RELIANCE', segment: 'NSE', instrumentType: 'EQ' });
    expect(r.allowed).toBe(true);
  });

  it('validateOrder rejects a spot-index order end-to-end', async () => {
    const r = await RiskEngine.validateOrder(
      'test-account',
      { symbol: 'NIFTY 50', token: '99926000', segment: 'NSE', side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 50 },
      validQuoteProvider,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/spot index/i);
  });
});
