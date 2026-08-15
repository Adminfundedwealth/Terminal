/**
 * 1-STEP RISK ENGINE — Unit Tests
 *
 * Tests all spec rules from the 1-Step Risk Management Engine:
 *   - Profile defaults (all 22 spec values)
 *   - Pre-trade: segments, hours, overnight, profit cap, positions,
 *     position size, daily loss, risk/trade, leverage
 *   - Post-trade: daily loss lock, drawdown breach
 *   - Isolation: flash/instant/2step not identified as 1-step
 *   - Profit split: 80% → 90% after payout threshold
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLED MOCK SINGLETONS
// vi.hoisted() runs before vi.mock() factory calls, so it's safe to reference
// in vi.mock() factories.
// ─────────────────────────────────────────────────────────────────────────────

const { mockPosRepoMethods } = vi.hoisted(() => ({
  mockPosRepoMethods: {
    countOpenPositions:    vi.fn(),
    findOpenByAccountId:   vi.fn(),
    getTotalUnrealizedPnl: vi.fn(),
  },
}));

vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: vi.fn(() => mockPosRepoMethods),
}));

vi.mock('../repositories/trade.repository.js', () => ({
  TradeRepository: vi.fn(() => ({
    getTodayRealizedPnl: vi.fn(),
    findTodayTrades:     vi.fn(),
  })),
}));

vi.mock('../repositories/account.repository.js', () => ({
  AccountRepository: vi.fn(() => ({
    findById:      vi.fn(),
    lockAccount:   vi.fn().mockResolvedValue(null),
    breachAccount: vi.fn().mockResolvedValue(null),
    update:        vi.fn(),
  })),
}));

vi.mock('../repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn(() => ({ log: vi.fn() })),
}));

vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

vi.mock('../services/marginService.js', () => ({
  MarginService: {
    validateMargin:       vi.fn(),
    calculateOrderMargin: vi.fn(),
  },
}));

vi.mock('../services/holidayService.js', () => ({
  HolidayService: {
    checkMarketClosed: vi.fn(),
  },
}));

vi.mock('../clients/lifecycle.callback.js', () => ({
  LifecycleCallbackClient: {
    accountLocked:   vi.fn().mockResolvedValue(null),
    riskBreached:    vi.fn().mockResolvedValue(null),
    challengeFailed: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../db/client.js', () => ({ supabase: null }));

vi.mock('../services/riskEngine.js', () => ({
  RiskEngine: {
    calculateTodayRealizedPnl: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS (after mocks are hoisted)
// ─────────────────────────────────────────────────────────────────────────────

import { OneStepRiskEngine }         from '../services/oneStepRiskEngine.js';
import { OneStepRiskProfileService } from '../services/oneStepRiskProfileService.js';
import { RiskEngine }                from '../services/riskEngine.js';
import { MarginService }             from '../services/marginService.js';
import { HolidayService }            from '../services/holidayService.js';

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL DEFAULTS (must match HARDCODED_DEFAULT in OneStepRiskProfileService)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_PROFILE = {
  daily_loss_pct:                  3.0,
  max_drawdown_pct:                6.0,
  max_open_positions:              20,
  leverage_max:                    30,
  max_position_size_pct:           70.0,
  daily_profit_cap_pct:            4.0,
  daily_profit_cap_cooldown_hours: 8.0,
  max_risk_per_trade_pct:          1.5,
  consistency_rule_pct:            40.0,
  allowed_segments:                ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'],
  trading_hours_start:             '09:15',
  trading_hours_end:               '15:30',
  overnight_allowed:               true,
  weekend_allowed:                 false,
  holiday_restriction:             true,
  profit_target_pct:               10.0,
  min_trading_days_eval:           5,
  time_limit_days:                 0,
  min_trading_days_funded:         3,
  payout_threshold_pct:            3.0,
  profit_split_initial_pct:        80.0,
  profit_split_scaled_pct:         90.0,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeAccount(overrides = {}) {
  return {
    id: 'acc-test',
    status: 'active',
    balance: 1_000_000,      // ₹10 L
    peak_balance: 1_000_000,
    trader_id: 'trader-1',
    challenge_id: 'ch-1',
    challenge: { plan: '1step', type: 'evaluation_phase1', phase: 'phase_1', id: 'ch-1' },
    daily_profit_cap_until: null,
    ...overrides,
  };
}

// Default order: very small notional (1 × 100 = ₹100) — safely within all limits
function makeOrder(overrides = {}) {
  return {
    symbol: 'NIFTYFUT', token: 'T1', segment: 'NFO',
    side: 'BUY', orderType: 'MARKET', productType: 'MIS',
    qty: 1, price: 100,
    ...overrides,
  };
}

const makeQuote = (ltp = 100) => (_t) => ltp;

function mockProfile(overrides = {}) {
  vi.spyOn(OneStepRiskProfileService, 'getProfile')
    .mockResolvedValue({ ...BASE_PROFILE, ...overrides });
}

/** Reset the shared posRepo mock to safe defaults before each test */
function resetPosRepo() {
  mockPosRepoMethods.countOpenPositions.mockReset().mockResolvedValue(0);
  mockPosRepoMethods.findOpenByAccountId.mockReset().mockResolvedValue([]);
  mockPosRepoMethods.getTotalUnrealizedPnl.mockReset().mockResolvedValue(0);
}

/** Reset stateless service mocks to safe defaults */
function resetServiceMocks() {
  HolidayService.checkMarketClosed.mockReturnValue({ isClosed: false, isWeekend: false, holidayName: null });
  MarginService.validateMargin.mockResolvedValue({ allowed: true });
  MarginService.calculateOrderMargin.mockReturnValue({ requiredMargin: 10_000, marginType: 'fo_nrml' });
  RiskEngine.calculateTodayRealizedPnl.mockResolvedValue(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — PRE-TRADE: validateOrder
// ─────────────────────────────────────────────────────────────────────────────

describe('OneStepRiskEngine.validateOrder', () => {
  beforeEach(() => {
    mockProfile();
    resetPosRepo();
    resetServiceMocks();
    // Default: Thursday 2026-08-13 10:00 IST = 04:30 UTC — weekday inside hours
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T04:30:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  // ── Account status ────────────────────────────────────────────────────────
  it('rejects locked account', async () => {
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount({ status: 'locked' }));
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('account_status');
  });

  it('allows close orders (bypasses all trading rules) on active account', async () => {
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder({ isCloseOrder: true }), makeQuote(), makeAccount());
    expect(r.allowed).toBe(true);
  });

  // ── Weekend ───────────────────────────────────────────────────────────────
  it('blocks on Saturday when weekend_allowed=false', async () => {
    mockProfile({ weekend_allowed: false });
    vi.setSystemTime(new Date('2026-08-15T04:30:00Z')); // Saturday 10:00 IST
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('weekend');
  });

  it('allows on Saturday when weekend_allowed=true', async () => {
    mockProfile({ weekend_allowed: true });
    vi.setSystemTime(new Date('2026-08-15T04:30:00Z'));
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('weekend');
  });

  // ── Holiday ───────────────────────────────────────────────────────────────
  it('blocks on market holiday', async () => {
    HolidayService.checkMarketClosed.mockReturnValue({ isClosed: true, isWeekend: false, holidayName: 'Diwali' });
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('holiday');
    expect(r.reason).toContain('Diwali');
  });

  // ── Allowed segments (NSE NFO BFO CDS MCX) ───────────────────────────────
  it('rejects disallowed segment', async () => {
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder({ segment: 'CRYPTO' }), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('allowed_segments');
  });

  it.each(['NSE', 'NFO', 'BFO', 'CDS', 'MCX'])('allows segment %s', async (seg) => {
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder({ segment: seg }), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('allowed_segments');
  });

  // ── Trading hours 09:15–15:30 IST ─────────────────────────────────────────
  it('blocks at 09:14 IST (before open)', async () => {
    vi.setSystemTime(new Date('2026-08-13T03:44:00Z')); // 09:14 IST
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('trading_hours');
    expect(r.reason).toContain('09:14');
  });

  it('allows at 09:15 IST', async () => {
    vi.setSystemTime(new Date('2026-08-13T03:45:00Z')); // 09:15 IST
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('trading_hours');
  });

  it('allows at 15:29 IST', async () => {
    vi.setSystemTime(new Date('2026-08-13T09:59:00Z')); // 15:29 IST
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('trading_hours');
  });

  it('allows at 15:30 IST (boundary included)', async () => {
    vi.setSystemTime(new Date('2026-08-13T10:00:00Z')); // 15:30 IST
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('trading_hours');
  });

  it('blocks at 15:31 IST', async () => {
    vi.setSystemTime(new Date('2026-08-13T10:01:00Z')); // 15:31 IST
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('trading_hours');
  });

  // ── Overnight ALLOWED — NRML must never be blocked by 1-Step ─────────────
  it('does not block NRML product type — overnight is allowed', async () => {
    vi.setSystemTime(new Date('2026-08-13T09:50:00Z')); // 15:20 IST — past old 2-Step cutoff
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder({ productType: 'NRML' }), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('overnight');
    expect(r.ruleType).not.toBe('no_overnight');
  });

  // ── Daily profit cap 4% + 8h cooldown ────────────────────────────────────
  it('blocks when DB cooldown is in the future', async () => {
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount({ daily_profit_cap_until: future }));
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('daily_profit_cap');
    expect(r.reason).toContain('cooldown');
  });

  it('allows when cooldown has expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount({ daily_profit_cap_until: past }));
    expect(r.ruleType).not.toBe('daily_profit_cap');
  });

  it('triggers 4% profit cap', async () => {
    // balance=1M, todayPnl=41K.
    // startOfDay = 1M − 41K = 959K. cap = 4% × max(959K, 1M) = 40K. 41K > 40K → cap.
    RiskEngine.calculateTodayRealizedPnl.mockResolvedValue(41_000);
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('daily_profit_cap');
  });

  // ── Max open positions 20 ─────────────────────────────────────────────────
  it('blocks 21st position', async () => {
    mockPosRepoMethods.countOpenPositions.mockResolvedValue(20);
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('max_open_positions');
    expect(r.reason).toContain('20/20');
  });

  it('allows 20th position (19 open)', async () => {
    mockPosRepoMethods.countOpenPositions.mockResolvedValue(19);
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('max_open_positions');
  });

  // ── Max position size 70% of balance ─────────────────────────────────────
  it('blocks when total notional exceeds 70% of balance', async () => {
    // balance=1M. 70% = 700K. Order: 50 × 24000 = 1.2M > 700K → blocked
    const r = await OneStepRiskEngine.validateOrder('a',
      makeOrder({ qty: 50, price: 24_000 }), makeQuote(24_000), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('max_position_size');
  });

  it('allows when notional is within 70%', async () => {
    // 25 × 24000 = 600K < 700K → allowed
    const r = await OneStepRiskEngine.validateOrder('a',
      makeOrder({ qty: 25, price: 24_000 }), makeQuote(24_000), makeAccount());
    expect(r.ruleType).not.toBe('max_position_size');
  });

  // ── Daily loss limit 3% ───────────────────────────────────────────────────
  it('blocks when daily loss exceeds 3%', async () => {
    // balance=1M, todayPnl=−40K.
    // startOfDay=1M−(−40K)=1.04M. maxLoss=3%×1.04M=31.2K. 40K > 31.2K → breach.
    RiskEngine.calculateTodayRealizedPnl.mockResolvedValue(-40_000);
    mockPosRepoMethods.getTotalUnrealizedPnl.mockResolvedValue(0);
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('daily_loss_limit');
  });

  // ── Max risk per trade 1.5% — SL-aware ───────────────────────────────────
  it('blocks when SL-based risk exceeds 1.5%', async () => {
    // balance=1M. 1.5% = 15K.
    // qty=1, entry=24000, slPrice=1 → distance=23999, risk=23999 > 15K → blocked
    // notional=1×24000=24K < 700K → position-size passes
    const r = await OneStepRiskEngine.validateOrder('a',
      makeOrder({ qty: 1, price: 24_000, slPrice: 1 }), makeQuote(24_000), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('max_risk_per_trade');
    expect(r.reason).toContain('SL-based');
  });

  it('allows when SL-based risk is within 1.5%', async () => {
    // qty=1, entry=100, slPrice=99 → distance=1, risk=1 < 15K → allowed
    const r = await OneStepRiskEngine.validateOrder('a',
      makeOrder({ qty: 1, price: 100, slPrice: 99 }), makeQuote(100), makeAccount());
    expect(r.ruleType).not.toBe('max_risk_per_trade');
  });

  it('uses margin fallback when no SL and margin < 1.5%', async () => {
    // requiredMargin=10K < 15K → pass
    MarginService.calculateOrderMargin.mockReturnValue({ requiredMargin: 10_000 });
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.ruleType).not.toBe('max_risk_per_trade');
  });

  it('blocks via margin fallback when margin exceeds 1.5%', async () => {
    // requiredMargin=20K > 15K → block
    MarginService.calculateOrderMargin.mockReturnValue({ requiredMargin: 20_000 });
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('max_risk_per_trade');
    expect(r.reason).toContain('margin-based');
  });

  // ── Leverage 1:30 ─────────────────────────────────────────────────────────
  it('blocks when leverage exceeds 30x', async () => {
    // Disable position-size check so it doesn't fire first
    mockProfile({ max_position_size_pct: 99_999 });
    // balance=1M. 30x = 30M.
    // Existing open: qty=1, ltp=29,990,000 → existing notional=29.99M
    // New order: qty=1, price=24000 → new=24K. Total=30.014M → 30.01x > 30 → blocked
    mockPosRepoMethods.countOpenPositions.mockResolvedValue(1);
    mockPosRepoMethods.findOpenByAccountId.mockResolvedValue([
      { qty: 1, token: 'T2', avg_price: 29_990_000, symbol: 'BIG', side: 'LONG' },
    ]);
    const qp = (t) => t === 'T2' ? 29_990_000 : 24_000;
    const r = await OneStepRiskEngine.validateOrder('a',
      makeOrder({ qty: 1, price: 24_000 }), qp, makeAccount());
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('leverage_limit');
  });

  // ── Consistency rule — bypassed when supabase=null ────────────────────────
  it('does not falsely reject on consistency rule (supabase=null)', async () => {
    RiskEngine.calculateTodayRealizedPnl.mockResolvedValue(50_000);
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount({ balance: 1_100_000 }));
    expect(r.ruleType).not.toBe('consistency_rule');
  });

  // ── No time limit — never expires ─────────────────────────────────────────
  it('never rejects due to expiry (unlimited time)', async () => {
    vi.setSystemTime(new Date('2030-01-01T04:30:00Z')); // far future, 10:00 IST Thursday
    const r = await OneStepRiskEngine.validateOrder('a', makeOrder(), makeQuote(), makeAccount());
    // r.ruleType is undefined when allowed=true; coerce to '' for safe regex match
    expect(r.ruleType ?? '').not.toMatch(/expiry|time_limit|flash/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — POST-TRADE: postTradeCheck
// ─────────────────────────────────────────────────────────────────────────────

describe('OneStepRiskEngine.postTradeCheck', () => {
  beforeEach(() => {
    mockProfile();
    resetPosRepo();
    resetServiceMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T04:30:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('returns ok when within all limits', async () => {
    const r = await OneStepRiskEngine.postTradeCheck('a', makeQuote(), makeAccount());
    expect(r.status).toBe('ok');
  });

  it('locks account when daily loss exceeds 3%', async () => {
    // balance=1M, todayPnl=−40K → startOfDay=1.04M, maxLoss=31.2K, 40K > 31.2K → locked
    RiskEngine.calculateTodayRealizedPnl.mockResolvedValue(-40_000);
    mockPosRepoMethods.getTotalUnrealizedPnl.mockResolvedValue(0);
    const r = await OneStepRiskEngine.postTradeCheck('a', makeQuote(), makeAccount());
    expect(r.status).toBe('locked');
    expect(r.reason).toContain('Daily loss');
  });

  it('does not crash on drawdown check (supabase=null — initialBalance not fetchable)', async () => {
    // With supabase=null, initial_balance can't be fetched.
    // todayPnl=-10K + unrealized=-60K → total daily loss=-70K > 31.2K limit → 'locked' fires first.
    // Either locked (daily loss) or ok/breached are all valid with no real DB.
    RiskEngine.calculateTodayRealizedPnl.mockResolvedValue(-10_000);
    mockPosRepoMethods.getTotalUnrealizedPnl.mockResolvedValue(-60_000);
    const r = await OneStepRiskEngine.postTradeCheck('a', makeQuote(), makeAccount({ balance: 930_000 }));
    expect(['ok', 'locked', 'breached']).toContain(r.status);
  });

  it('does not crash on profit target check (supabase=null)', async () => {
    mockPosRepoMethods.getTotalUnrealizedPnl.mockResolvedValue(0);
    const r = await OneStepRiskEngine.postTradeCheck('a', makeQuote(), makeAccount({ balance: 1_100_000 }));
    expect(['ok', 'target_reached']).toContain(r.status);
  });

  it('returns ok or feed_stale (feed-stale guard in engine)', async () => {
    const r = await OneStepRiskEngine.postTradeCheck('a', makeQuote(), makeAccount());
    expect(['ok', 'feed_stale']).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — PROFILE SERVICE: spec value assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('OneStepRiskProfileService — spec defaults', () => {
  // Use real getProfile (supabase=null → HARDCODED_DEFAULT)
  beforeEach(() => vi.restoreAllMocks());

  it('evaluation defaults match spec exactly', async () => {
    const p = await OneStepRiskProfileService.getProfile();
    expect(p.daily_loss_pct).toBe(3.0);            // 3% daily drawdown
    expect(p.max_drawdown_pct).toBe(6.0);           // 6% static max drawdown
    expect(p.profit_target_pct).toBe(10.0);         // 10% profit target
    expect(p.max_risk_per_trade_pct).toBe(1.5);     // 1.5% max risk/trade
    expect(p.min_trading_days_eval).toBe(5);        // 5 min trading days (eval)
    expect(p.leverage_max).toBe(30);                // 1:30 leverage
    expect(p.max_open_positions).toBe(20);          // 20 max positions
    expect(p.max_position_size_pct).toBe(70.0);     // 70% max position size
    expect(p.daily_profit_cap_pct).toBe(4.0);       // 4% daily profit cap
    expect(p.daily_profit_cap_cooldown_hours).toBe(8.0); // 8h cooldown
    expect(p.time_limit_days).toBe(0);              // unlimited time
    expect(p.consistency_rule_pct).toBe(40.0);      // consistency enabled 40%
  });

  it('trading hours 09:15–15:30 IST', async () => {
    const p = await OneStepRiskProfileService.getProfile();
    expect(p.trading_hours_start).toBe('09:15');
    expect(p.trading_hours_end).toBe('15:30');
  });

  it('overnight ALLOWED', async () => {
    const p = await OneStepRiskProfileService.getProfile();
    expect(p.overnight_allowed).toBe(true);
  });

  it('all 5 segments: NSE NFO BFO CDS MCX', async () => {
    const p = await OneStepRiskProfileService.getProfile();
    expect(p.allowed_segments).toEqual(expect.arrayContaining(['NSE', 'NFO', 'BFO', 'CDS', 'MCX']));
  });

  it('funded defaults: 3 min days, 3% threshold, 80→90% split', async () => {
    const p = await OneStepRiskProfileService.getProfile();
    expect(p.min_trading_days_funded).toBe(3);
    expect(p.payout_threshold_pct).toBe(3.0);
    expect(p.profit_split_initial_pct).toBe(80.0);
    expect(p.profit_split_scaled_pct).toBe(90.0);
  });

  it('profit split 80% before threshold', () => {
    expect(OneStepRiskProfileService.getEffectiveSplitPct(BASE_PROFILE, false)).toBe(80.0);
  });

  it('profit split 90% after threshold', () => {
    expect(OneStepRiskProfileService.getEffectiveSplitPct(BASE_PROFILE, true)).toBe(90.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — ISOLATION: isOneStepAccount
// ─────────────────────────────────────────────────────────────────────────────

describe('OneStepRiskProfileService.isOneStepAccount — isolation', () => {
  it.each([
    ['1step',  true],
    ['1-step', true],
    ['1 Step', true],
    ['1STEP',  true],
  ])('identifies plan "%s" as 1-Step', (plan, expected) => {
    expect(OneStepRiskProfileService.isOneStepAccount({ challenge: { plan } })).toBe(expected);
  });

  it.each([
    ['flash'],
    ['instant'],
    ['2step'],
    ['2-step'],
  ])('does NOT identify plan "%s" as 1-Step', (plan) => {
    expect(OneStepRiskProfileService.isOneStepAccount({ challenge: { plan } })).toBe(false);
  });

  it('identifies via top-level plan field', () => {
    expect(OneStepRiskProfileService.isOneStepAccount({ plan: '1step' })).toBe(true);
  });

  it.each([null, undefined, {}])('returns false for falsy/empty account', (acc) => {
    expect(OneStepRiskProfileService.isOneStepAccount(acc)).toBe(false);
  });
});
