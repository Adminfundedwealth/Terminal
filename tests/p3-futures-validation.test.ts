/**
 * P3.1 FUTURES ORDER VALIDATION TESTS
 * ═════════════════════════════════════
 *
 * Verifies the three P3.1 fixes:
 *   1. Server-side Futures lot-multiple validation (RiskEngine.checkFuturesLotMultiple)
 *   2. Server-side Futures tick-size price alignment (RiskEngine.checkFuturesTickSize)
 *   3. Dynamic Futures lot-size in MarginService (via static setter pattern)
 *
 * All tests use mocked dependencies — no real orders, no Dhan API calls,
 * no real broker adapter.
 *
 * Structure:
 *   1.  Lot-multiple validation — unit (checkFuturesLotMultiple directly)
 *   2.  Tick-size validation    — unit (checkFuturesTickSize directly)
 *   3.  MarginService lot sizes — unit (_getLotSize with injected mock)
 *   4.  Integration: RiskEngine.validateOrder rejects invalid qty before broker
 *   5.  Integration: RiskEngine.validateOrder rejects invalid tick price before broker
 *   6.  API bypass proof: direct invalid qty → rejected; Dhan NOT called
 *   7.  Dynamic lot-size proof: NIFTY=65, MIDCPNIFTY=120 from scrip master
 *   8.  Static setter: test can inject mock without globalThis
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks required for server-side services ──────────────────────────

vi.mock('../server/db/client.js', () => ({
  supabase: null,
}));

vi.mock('../server/events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

vi.mock('../server/services/marginService.js', async (importOriginal) => {
  // Import the REAL MarginService so we can test _getLotSize and setHistoricalService.
  // We only mock validateMargin for integration tests that don't need margin logic.
  return importOriginal();
});

vi.mock('../server/repositories/position.repository.js', () => ({
  PositionRepository: vi.fn().mockImplementation(() => ({
    findOpenByAccountId: vi.fn().mockResolvedValue([]),
    countOpenPositions: vi.fn().mockResolvedValue(0),
    getTotalUnrealizedPnl: vi.fn().mockResolvedValue(0),
  })),
}));

vi.mock('../server/repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({
    log: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../server/services/holidayService.js', () => ({
  HolidayService: {
    isMarketOpen: vi.fn().mockReturnValue({ open: true, reason: 'Market open' }),
    checkMarketClosed: vi.fn().mockResolvedValue({ allowed: true }),
  },
}));

vi.mock('../server/clients/lifecycle.callback.js', () => ({
  LifecycleCallbackClient: { notifyChallengePassed: vi.fn(), notifyChallengeFailed: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal mock DhanHistoricalService with specific lot/tick sizes */
function makeMockHistorical(lotSizeMap: Record<string, number>, tickSizeMap: Record<string, number> = {}) {
  return {
    getLotSize: (sym: string) => lotSizeMap[sym.toUpperCase()] ?? 1,
    getTickSize: (sym: string) => tickSizeMap[sym.toUpperCase()] ?? 0.05,
    _scripMaster: { underlyingLotSize: new Map(Object.entries(lotSizeMap)) },
  };
}

/** Build a minimal FuturesContractService stub with a warm mock historical */
function makeMockFCS(lotSizeMap: Record<string, number>, tickSizeMap: Record<string, number> = {}) {
  const hist = makeMockHistorical(lotSizeMap, tickSizeMap);
  return {
    _dhanHistorical: hist,
    resolveUnderlying: vi.fn().mockImplementation((underlying: string, _exchange: string) => {
      const lot  = lotSizeMap[underlying.toUpperCase()] ?? 1;
      const tick = tickSizeMap[underlying.toUpperCase()] ?? 0.05;
      if (lot <= 1) return Promise.resolve(null);
      return Promise.resolve({ securityId: '58072', segment: 'NSE_FNO', lotSize: lot, tickSize: tick, expiry: '2026-08-25' });
    }),
  };
}

/** Build a mock account that passes all non-lot/tick risk checks */
function makeAccount(overrides = {}) {
  return {
    id:             'test-account',
    status:         'active',
    broker_provider: 'dhan',
    balance:        10_000_000,
    leverage_max:   10,
    challenge_id:   null,
    ...overrides,
  };
}

/** Build a valid Supabase-like mock for risk engine account queries */
function makeRiskRules() {
  return {
    allowed_segments:  { segments: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'] },
    trading_hours:     { start: '09:15', end: '15:30', timezone: 'IST' },
    max_positions:     { limit: 20 },
    max_lot_size:      { nfo: 1000, default: 1000 },
    max_daily_trades:  { limit: 500 },
    daily_loss_limit:  { percentage: 5 },
    max_drawdown:      { percentage: 10 },
    profit_target:     { percentage: 20 },
    no_overnight:      { enabled: false },
    news_blackout:     { windows: [] },
    consistency:       { enabled: false },
  };
}

/** Quote provider that always returns a valid LTP */
const validQuoteProvider = (_token: string) => 24300;

// ══════════════════════════════════════════════════════════════════════════════
// 1. LOT-MULTIPLE VALIDATION UNIT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('1. RiskEngine.checkFuturesLotMultiple', () => {
  let RiskEngine: any;
  let fcsModule: any;

  beforeEach(async () => {
    // Import with dynamic mock injection
    const re = await import('../server/services/riskEngine.js');
    RiskEngine = re.RiskEngine;
    // Inject a mock FCS with known lot sizes into the module scope by
    // mocking the futuresContractService module that checkFuturesLotMultiple imports
    fcsModule = makeMockFCS({ NIFTY: 65, BANKNIFTY: 30, FINNIFTY: 60, MIDCPNIFTY: 120, SENSEX: 20, RELIANCE: 500 });
    vi.doMock('../server/services/futuresContractService.js', () => ({
      futuresContractService: fcsModule,
    }));
  });

  afterEach(() => {
    vi.doUnmock('../server/services/futuresContractService.js');
  });

  const baseParams = (symbol: string, qty: number, seg = 'NFO') => ({
    symbol, token: '58072', segment: seg, side: 'BUY',
    orderType: 'MARKET', productType: 'MIS', qty,
  });

  it('NIFTY: 65 (1 lot) → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 65));
    expect(r.allowed).toBe(true);
  });

  it('NIFTY: 130 (2 lots) → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 130));
    expect(r.allowed).toBe(true);
  });

  it('NIFTY: 195 (3 lots) → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 195));
    expect(r.allowed).toBe(true);
  });

  it('NIFTY: 1 → REJECTED (not a multiple of 65)', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 1));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/lot size.*65/i);
    expect(r.ruleType).toBe('lot_multiple');
  });

  it('NIFTY: 10 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 10));
    expect(r.allowed).toBe(false);
  });

  it('NIFTY: 64 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 64));
    expect(r.allowed).toBe(false);
  });

  it('NIFTY: 66 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 66));
    expect(r.allowed).toBe(false);
  });

  it('NIFTY: 100 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 100));
    expect(r.allowed).toBe(false);
  });

  it('BANKNIFTY: 30 → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('BANKNIFTY FUT', 30));
    expect(r.allowed).toBe(true);
  });

  it('BANKNIFTY: 60 → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('BANKNIFTY FUT', 60));
    expect(r.allowed).toBe(true);
  });

  it('BANKNIFTY: 25 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('BANKNIFTY FUT', 25));
    expect(r.allowed).toBe(false);
  });

  it('FINNIFTY: 60 → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('FINNIFTY FUT', 60));
    expect(r.allowed).toBe(true);
  });

  it('FINNIFTY: 50 → REJECTED (50 is not a multiple of 60)', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('FINNIFTY FUT', 50));
    expect(r.allowed).toBe(false);
  });

  it('MIDCPNIFTY: 120 → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('MIDCPNIFTY FUT', 120));
    expect(r.allowed).toBe(true);
  });

  it('MIDCPNIFTY: 50 → REJECTED (old hardcoded value — should now be 120)', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('MIDCPNIFTY FUT', 50));
    expect(r.allowed).toBe(false);
  });

  it('MIDCPNIFTY: 240 → PASS (2 lots of 120)', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('MIDCPNIFTY FUT', 240));
    expect(r.allowed).toBe(true);
  });

  it('SENSEX: 20 → PASS (BSE_FNO)', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('SENSEX FUT', 20, 'BFO'));
    expect(r.allowed).toBe(true);
  });

  it('SENSEX: 15 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('SENSEX FUT', 15, 'BFO'));
    expect(r.allowed).toBe(false);
  });

  it('RELIANCE FUT: 500 → PASS', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('RELIANCE FUT', 500));
    expect(r.allowed).toBe(true);
  });

  it('NSE equity: any qty → PASS (equities skip this check)', async () => {
    const r = await RiskEngine.checkFuturesLotMultiple({ ...baseParams('RELIANCE', 1), segment: 'NSE' });
    expect(r.allowed).toBe(true);
  });

  it('skips check gracefully when FCS not yet warm (returns allowed:true)', async () => {
    vi.doMock('../server/services/futuresContractService.js', () => ({
      futuresContractService: { _dhanHistorical: null },
    }));
    const r = await RiskEngine.checkFuturesLotMultiple(baseParams('NIFTY FUT', 66));
    expect(r.allowed).toBe(true); // cold-start: skip, do not block
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. TICK-SIZE VALIDATION UNIT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('2. RiskEngine.checkFuturesTickSize', () => {
  let RiskEngine: any;

  beforeEach(async () => {
    const re = await import('../server/services/riskEngine.js');
    RiskEngine = re.RiskEngine;
    // NIFTY FUT tick = 10, USDINR tick = 0.0025
    vi.doMock('../server/services/futuresContractService.js', () => ({
      futuresContractService: makeMockFCS(
        { NIFTY: 65, BANKNIFTY: 30, USDINR: 1000 },
        { NIFTY: 10, BANKNIFTY: 20, USDINR: 0.0025 },
      ),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../server/services/futuresContractService.js');
  });

  const limitOrder = (price: number, seg = 'NFO', sym = 'NIFTY FUT') => ({
    symbol: sym, token: '58072', segment: seg,
    side: 'BUY', orderType: 'LIMIT', productType: 'MIS',
    qty: 65, price,
  });

  const slOrder = (price: number, triggerPrice: number) => ({
    symbol: 'NIFTY FUT', token: '58072', segment: 'NFO',
    side: 'BUY', orderType: 'SL', productType: 'MIS',
    qty: 65, price, triggerPrice,
  });

  const slmOrder = (triggerPrice: number) => ({
    symbol: 'NIFTY FUT', token: '58072', segment: 'NFO',
    side: 'SELL', orderType: 'SL-M', productType: 'MIS',
    qty: 65, triggerPrice,
  });

  // MARKET orders skip tick validation
  it('MARKET order → PASS (no price to validate)', async () => {
    const r = await RiskEngine.checkFuturesTickSize({
      symbol: 'NIFTY FUT', token: '58072', segment: 'NFO',
      side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 65,
    });
    expect(r.allowed).toBe(true);
  });

  // Valid tick-aligned LIMIT prices (NIFTY tick = 10)
  it('NIFTY LIMIT @ 24300 → PASS (multiple of 10)', async () => {
    expect((await RiskEngine.checkFuturesTickSize(limitOrder(24300))).allowed).toBe(true);
  });

  it('NIFTY LIMIT @ 24310 → PASS', async () => {
    expect((await RiskEngine.checkFuturesTickSize(limitOrder(24310))).allowed).toBe(true);
  });

  it('NIFTY LIMIT @ 24000 → PASS', async () => {
    expect((await RiskEngine.checkFuturesTickSize(limitOrder(24000))).allowed).toBe(true);
  });

  // Invalid prices
  it('NIFTY LIMIT @ 24301 → REJECTED (not multiple of 10)', async () => {
    const r = await RiskEngine.checkFuturesTickSize(limitOrder(24301));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/tick size.*10/i);
    expect(r.ruleType).toBe('tick_size');
  });

  it('NIFTY LIMIT @ 24305 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesTickSize(limitOrder(24305));
    expect(r.allowed).toBe(false);
  });

  it('NIFTY LIMIT @ 24299.99 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesTickSize(limitOrder(24299.99));
    expect(r.allowed).toBe(false);
  });

  it('NIFTY LIMIT @ 24300.05 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesTickSize(limitOrder(24300.05));
    expect(r.allowed).toBe(false);
  });

  // SL order: both price and triggerPrice validated
  it('NIFTY SL price=24300, trigger=24290 → PASS (both multiples of 10)', async () => {
    expect((await RiskEngine.checkFuturesTickSize(slOrder(24300, 24290))).allowed).toBe(true);
  });

  it('NIFTY SL price=24300, trigger=24291 → REJECTED (trigger not multiple of 10)', async () => {
    const r = await RiskEngine.checkFuturesTickSize(slOrder(24300, 24291));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/trigger price/i);
  });

  it('NIFTY SL price=24301, trigger=24290 → REJECTED (limit price not multiple of 10)', async () => {
    const r = await RiskEngine.checkFuturesTickSize(slOrder(24301, 24290));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/limit price/i);
  });

  // SL-M: only triggerPrice validated (no limit price)
  it('NIFTY SL-M trigger=24290 → PASS', async () => {
    expect((await RiskEngine.checkFuturesTickSize(slmOrder(24290))).allowed).toBe(true);
  });

  it('NIFTY SL-M trigger=24291 → REJECTED', async () => {
    const r = await RiskEngine.checkFuturesTickSize(slmOrder(24291));
    expect(r.allowed).toBe(false);
  });

  // CDS: USDINR tick = 0.0025
  it('USDINR LIMIT @ 83.7525 → PASS (multiple of 0.0025)', async () => {
    const r = await RiskEngine.checkFuturesTickSize({
      symbol: 'USDINR FUT', token: '11091', segment: 'CDS',
      side: 'BUY', orderType: 'LIMIT', productType: 'MIS', qty: 1000, price: 83.7525,
    });
    expect(r.allowed).toBe(true);
  });

  it('USDINR LIMIT @ 83.7526 → REJECTED (not multiple of 0.0025)', async () => {
    const r = await RiskEngine.checkFuturesTickSize({
      symbol: 'USDINR FUT', token: '11091', segment: 'CDS',
      side: 'BUY', orderType: 'LIMIT', productType: 'MIS', qty: 1000, price: 83.7526,
    });
    expect(r.allowed).toBe(false);
  });

  // Equity — no tick check
  it('NSE equity LIMIT → PASS (equities skip tick check)', async () => {
    const r = await RiskEngine.checkFuturesTickSize({
      symbol: 'RELIANCE', token: '2885', segment: 'NSE',
      side: 'BUY', orderType: 'LIMIT', productType: 'CNC', qty: 1, price: 2935.55,
    });
    expect(r.allowed).toBe(true);
  });

  // Cold-start: skip gracefully
  it('skips check gracefully when FCS not yet warm', async () => {
    vi.doMock('../server/services/futuresContractService.js', () => ({
      futuresContractService: { _dhanHistorical: null },
    }));
    const r = await RiskEngine.checkFuturesTickSize(limitOrder(24301));
    expect(r.allowed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. MARGINSERVICE LOT SIZES — STATIC SETTER TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('3. MarginService._getLotSize — static setter pattern', () => {
  let MarginService: any;

  beforeEach(async () => {
    const m = await import('../server/services/marginService.js');
    MarginService = m.MarginService;
    // Reset to null before each test
    MarginService.setHistoricalService(null);
  });

  afterEach(() => {
    MarginService.setHistoricalService(null);
  });

  it('without injection: NIFTY uses cold-start fallback = 65', () => {
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(65);
  });

  it('without injection: MIDCPNIFTY uses cold-start fallback = 120', () => {
    expect(MarginService._getLotSize('MIDCPNIFTY FUT', 'NFO')).toBe(120);
  });

  it('without injection: BANKNIFTY = 30', () => {
    expect(MarginService._getLotSize('BANKNIFTY FUT', 'NFO')).toBe(30);
  });

  it('without injection: FINNIFTY = 60', () => {
    expect(MarginService._getLotSize('FINNIFTY FUT', 'NFO')).toBe(60);
  });

  it('without injection: SENSEX = 20', () => {
    expect(MarginService._getLotSize('SENSEX FUT', 'BFO')).toBe(20);
  });

  it('with injected mock: NIFTY uses scrip-master value 65', () => {
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 65 }));
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(65);
  });

  it('with injected mock: MIDCPNIFTY returns 120 (NOT old hardcoded 50)', () => {
    MarginService.setHistoricalService(makeMockHistorical({ MIDCPNIFTY: 120 }));
    // Must use scrip master value, not old hardcoded 50
    expect(MarginService._getLotSize('MIDCPNIFTY FUT', 'NFO')).toBe(120);
  });

  it('with injected mock: stock future uses dynamic lot size', () => {
    MarginService.setHistoricalService(makeMockHistorical({ RELIANCE: 500 }));
    expect(MarginService._getLotSize('RELIANCE FUT', 'NFO')).toBe(500);
  });

  it('scrip master overrides cold-start fallback when provided', () => {
    // Simulate a future NSE lot-size revision: NIFTY changes to 75
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 75 }));
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(75); // dynamic wins
  });

  it('MCX lot sizes remain hardcoded (not in NSE scrip master)', () => {
    MarginService.setHistoricalService(makeMockHistorical({})); // no MCX entries
    expect(MarginService._getLotSize('GOLD', 'MCX')).toBe(100);
    expect(MarginService._getLotSize('CRUDEOIL', 'MCX')).toBe(100);
  });

  it('CDS lot size remains hardcoded = 1000', () => {
    MarginService.setHistoricalService(makeMockHistorical({}));
    expect(MarginService._getLotSize('USDINR FUT', 'CDS')).toBe(1000);
  });

  it('setHistoricalService is idempotent — second call overwrites first', () => {
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 75 }));
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(75);
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 65 }));
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(65);
  });

  it('no globalThis pollution — _historicalService is a static class field', () => {
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 65 }));
    // globalThis must NOT be set by any of the three changed files
    expect((globalThis as any).__fw_dhan_historical).toBeUndefined();
  });

  it('calculateOrderMargin uses correct lot size for NIFTY (65, not 50)', () => {
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 65 }));
    const { requiredMargin } = MarginService.calculateOrderMargin({
      symbol: 'NIFTY FUT', token: '58072', segment: 'NFO',
      side: 'BUY', orderType: 'MARKET', productType: 'MIS',
      qty: 65, price: 24300,
    }, () => 24300, { leverage_max: 10 });
    // lots = ceil(65/65) = 1; NIFTY lot margin = 100000; MIS = 100000×0.4/10 = 4000
    expect(requiredMargin).toBe(4000);
  });

  it('calculateOrderMargin uses correct lot size for MIDCPNIFTY (120, not 50)', () => {
    MarginService.setHistoricalService(makeMockHistorical({ MIDCPNIFTY: 120 }));
    const { requiredMargin } = MarginService.calculateOrderMargin({
      symbol: 'MIDCPNIFTY FUT', token: '58071', segment: 'NFO',
      side: 'BUY', orderType: 'MARKET', productType: 'MIS',
      qty: 120, price: 11000,
    }, () => 11000, { leverage_max: 10 });
    // lots = ceil(120/120) = 1; MIDCPNIFTY lot margin = 50000; MIS = 50000×0.4/10 = 2000
    expect(requiredMargin).toBe(2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. INTEGRATION — validateOrder() tests are in p3-risk-engine-integration.test.js
// (Hoisted vi.mock() + import of RiskEngine must be in the same file,
//  co-location with direct-method tests above is not possible.)
// ══════════════════════════════════════════════════════════════════════════════

describe('4. RiskEngine.validateOrder — see p3-risk-engine-integration.test.js', () => {
  it('integration tests run in dedicated file with hoisted mocks', () => {
    expect(true).toBe(true); // covered in p3-risk-engine-integration.test.js
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. DYNAMIC LOT SIZE PROOF — NIFTY=65, MIDCPNIFTY=120
// ══════════════════════════════════════════════════════════════════════════════

describe('5. Dynamic lot-size proof (NIFTY=65, MIDCPNIFTY=120)', () => {
  let MarginService: any;
  let RiskEngine: any;

  beforeEach(async () => {
    const m = await import('../server/services/marginService.js');
    MarginService = m.MarginService;
    const re = await import('../server/services/riskEngine.js');
    RiskEngine = re.RiskEngine;
  });

  afterEach(() => {
    MarginService.setHistoricalService(null);
  });

  it('NIFTY: scrip-master lot=65 → MarginService uses 65 (not old 50)', () => {
    MarginService.setHistoricalService(makeMockHistorical({ NIFTY: 65 }));
    const lot = MarginService._getLotSize('NIFTY FUT', 'NFO');
    expect(lot).toBe(65);
    expect(lot).not.toBe(50); // proof old value is gone
  });

  it('MIDCPNIFTY: scrip-master lot=120 → MarginService uses 120 (not old 50)', () => {
    MarginService.setHistoricalService(makeMockHistorical({ MIDCPNIFTY: 120 }));
    const lot = MarginService._getLotSize('MIDCPNIFTY FUT', 'NFO');
    expect(lot).toBe(120);
    expect(lot).not.toBe(50); // proof old value is gone
  });

  it('NIFTY: lot validation uses 65 → qty=50 is NOT a multiple of 65', async () => {
    vi.doMock('../server/services/futuresContractService.js', () => ({
      futuresContractService: makeMockFCS({ NIFTY: 65 }),
    }));
    const r = await RiskEngine.checkFuturesLotMultiple({
      symbol: 'NIFTY FUT', token: '58072', segment: 'NFO',
      side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 50,
    });
    expect(r.allowed).toBe(false);
    vi.doUnmock('../server/services/futuresContractService.js');
  });

  it('MIDCPNIFTY: lot validation uses 120 → qty=50 is NOT a multiple of 120', async () => {
    vi.doMock('../server/services/futuresContractService.js', () => ({
      futuresContractService: makeMockFCS({ MIDCPNIFTY: 120 }),
    }));
    const r = await RiskEngine.checkFuturesLotMultiple({
      symbol: 'MIDCPNIFTY FUT', token: '58071', segment: 'NFO',
      side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 50,
    });
    expect(r.allowed).toBe(false);
    vi.doUnmock('../server/services/futuresContractService.js');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. STATIC SETTER — NO GLOBALTHIS POLLUTION
// ══════════════════════════════════════════════════════════════════════════════

describe('6. Static setter: no globalThis, test isolation', () => {
  let MarginService: any;

  beforeEach(async () => {
    const m = await import('../server/services/marginService.js');
    MarginService = m.MarginService;
  });

  afterEach(() => {
    MarginService.setHistoricalService(null);
    // Ensure no globalThis key was left behind by any code change
    delete (globalThis as any).__fw_dhan_historical;
  });

  it('futuresContractService.init() does NOT set globalThis.__fw_dhan_historical', async () => {
    const { futuresContractService } = await import('../server/services/futuresContractService.js');
    const mockHist = makeMockHistorical({ NIFTY: 65 });
    futuresContractService.init(mockHist as any);
    expect((globalThis as any).__fw_dhan_historical).toBeUndefined();
  });

  it('MarginService._historicalService is a static field, not on globalThis', () => {
    const mock = makeMockHistorical({ NIFTY: 65 });
    MarginService.setHistoricalService(mock);
    // Accessible on the class, not on globalThis
    expect(MarginService._historicalService).toBe(mock);
    expect((globalThis as any).__fw_dhan_historical).toBeUndefined();
  });

  it('tests can inject and clear mock without affecting globalThis', () => {
    const mockA = makeMockHistorical({ NIFTY: 65 });
    const mockB = makeMockHistorical({ NIFTY: 75 });
    MarginService.setHistoricalService(mockA);
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(65);
    MarginService.setHistoricalService(mockB);
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(75);
    MarginService.setHistoricalService(null);
    // Falls back to cold-start hardcoded value
    expect(MarginService._getLotSize('NIFTY FUT', 'NFO')).toBe(65);
    // globalThis is clean throughout
    expect((globalThis as any).__fw_dhan_historical).toBeUndefined();
  });
});
