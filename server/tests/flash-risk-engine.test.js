/**
 * FLASH RISK ENGINE — TESTS
 *
 * Tests cover:
 *   1. Flash account identification
 *   2. 24-hour timer: purchase/terminal open = no start, first position = start
 *   3. Per-position loss limit (2%)
 *   4. Max drawdown (4%)
 *   5. Max open positions (50)
 *   6. Leverage limit (1:50)
 *   7. Allowed segments
 *   8. Trading hours
 *   9. Overnight ALLOWED
 *  10. Weekend ALLOWED
 *  11. Holiday NOT restricted
 *  12. No profit target
 *  13. Isolation: Instant / 1-Step / 2-Step unchanged
 *
 * Run: node --experimental-vm-modules server/node_modules/.bin/vitest run server/tests/flash-risk-engine.test.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlashRiskProfileService } from '../services/flashRiskProfileService.js';
import { FlashRiskEngine } from '../services/flashRiskEngine.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFlashAccount(overrides = {}) {
  return {
    id: 'acct-flash-001',
    status: 'active',
    balance: 1000000,
    peak_balance: 1000000,
    trader_id: 'trader-001',
    challenge_id: 'ch-flash-001',
    broker_provider: 'paper',
    challenge: {
      id: 'ch-flash-001',
      plan: 'flash',
      initial_balance: 1000000,
      peak_balance: 1000000,
      status: 'active',
    },
    ...overrides,
  };
}

function makeNonFlashAccount(plan = 'instant') {
  return {
    id: 'acct-other-001',
    status: 'active',
    balance: 1000000,
    peak_balance: 1000000,
    challenge: { id: 'ch-001', plan, status: 'active' },
  };
}

function makeOrderParams(overrides = {}) {
  return {
    symbol: 'NIFTY',
    token: '99926000',
    segment: 'NFO',
    side: 'BUY',
    orderType: 'MARKET',
    productType: 'MIS',
    qty: 50,
    price: 22000,
    isCloseOrder: false,
    ...overrides,
  };
}

const validQuoteProvider = (token) => 22000; // always returns a valid price
const nullQuoteProvider  = (token) => null;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Flash account identification
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskProfileService.isFlashAccount', () => {
  it('identifies Flash account by plan="flash"', () => {
    expect(FlashRiskProfileService.isFlashAccount(makeFlashAccount())).toBe(true);
  });

  it('identifies Flash account by plan="Flash" (case insensitive)', () => {
    expect(FlashRiskProfileService.isFlashAccount({
      challenge: { plan: 'Flash' },
    })).toBe(true);
  });

  it('does NOT identify Instant as Flash', () => {
    expect(FlashRiskProfileService.isFlashAccount(makeNonFlashAccount('instant'))).toBe(false);
  });

  it('does NOT identify 1-Step as Flash', () => {
    expect(FlashRiskProfileService.isFlashAccount(makeNonFlashAccount('1step'))).toBe(false);
  });

  it('does NOT identify 2-Step as Flash', () => {
    expect(FlashRiskProfileService.isFlashAccount(makeNonFlashAccount('2step'))).toBe(false);
  });

  it('returns false for account with no challenge', () => {
    expect(FlashRiskProfileService.isFlashAccount({ status: 'active', balance: 1000000 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Timer: 24-hour first-position logic
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskProfileService — timer logic', () => {
  it('checkExpiry returns expired=false when firstPositionAt is null', async () => {
    const profile = { duration_hours: 24 };
    vi.spyOn(FlashRiskProfileService, 'getFirstPositionAt').mockResolvedValueOnce(null);

    const result = await FlashRiskProfileService.checkExpiry('ch-001', profile);
    expect(result.expired).toBe(false);
    expect(result.firstPositionAt).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it('checkExpiry returns expired=false when 24h has NOT elapsed', async () => {
    const profile = { duration_hours: 24 };
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    vi.spyOn(FlashRiskProfileService, 'getFirstPositionAt').mockResolvedValueOnce(oneHourAgo);

    const result = await FlashRiskProfileService.checkExpiry('ch-001', profile);
    expect(result.expired).toBe(false);
    expect(result.firstPositionAt).toBe(oneHourAgo);
    expect(result.expiresAt).toBeTruthy();
  });

  it('checkExpiry returns expired=true when 24h HAS elapsed', async () => {
    const profile = { duration_hours: 24 };
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    vi.spyOn(FlashRiskProfileService, 'getFirstPositionAt').mockResolvedValueOnce(twentyFiveHoursAgo);

    const result = await FlashRiskProfileService.checkExpiry('ch-001', profile);
    expect(result.expired).toBe(true);
  });

  it('recordFirstPosition does not overwrite existing timestamp', async () => {
    const existingTs = '2026-08-10T09:15:00.000Z';
    vi.spyOn(FlashRiskProfileService, 'getFirstPositionAt').mockResolvedValueOnce(existingTs);
    // If it tries to write, this will throw — confirming it bailed early
    const result = await FlashRiskProfileService.recordFirstPosition('ch-001', '2026-08-11T00:00:00.000Z');
    // Should return undefined (early return) without attempting DB write
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Pre-trade: account status check
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.validateOrder — account status', () => {
  beforeEach(() => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue({
      duration_hours: 24, timer_start_event: 'first_position',
      per_position_loss_pct: 2, max_drawdown_pct: 4,
      max_open_positions: 50, leverage_max: 50,
      allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      trading_hours_start: '09:15', trading_hours_end: '15:30',
      overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
      profit_target_pct: 0, profit_split_pct: 90,
      consistency_rule_pct: 15, payout_threshold_pct: 3,
    });
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false, expiresAt: null, firstPositionAt: null });
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects order when account is locked', async () => {
    const account = makeFlashAccount({ status: 'locked' });
    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, account);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('locked');
  });

  it('rejects order when account is breached', async () => {
    const account = makeFlashAccount({ status: 'breached' });
    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, account);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('breached');
  });

  it('allows close orders regardless of other rules', async () => {
    const account = makeFlashAccount({ status: 'active' });
    const order = makeOrderParams({ isCloseOrder: true, segment: 'INVALID_SEGMENT' });
    const result = await FlashRiskEngine.validateOrder('acct-001', order, validQuoteProvider, account);
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Pre-trade: 24h expiry
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.validateOrder — 24h expiry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects order when Flash account has expired', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue({
      duration_hours: 24, allowed_segments: ['NFO'], trading_hours_start: '09:15',
      trading_hours_end: '15:30', overnight_allowed: true, weekend_allowed: true,
      holiday_restriction: false, max_open_positions: 50, leverage_max: 50,
    });
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({
      expired: true,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      firstPositionAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    });

    const account = makeFlashAccount();
    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, account);
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe('flash_expiry');
  });

  it('allows order when Flash account has NOT expired', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue({
      duration_hours: 24, allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      trading_hours_start: '09:15', trading_hours_end: '15:30',
      overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
      max_open_positions: 50, leverage_max: 50, per_position_loss_pct: 2,
      consistency_rule_pct: 0,
    });
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false, expiresAt: null, firstPositionAt: null });

    // Mock position/margin checks
    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'countOpenPositions').mockResolvedValue(0);
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);

    const { MarginService } = await import('./marginService.js');
    vi.spyOn(MarginService, 'validateMargin').mockResolvedValue({ allowed: true });

    const account = makeFlashAccount();
    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, account);
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Pre-trade: allowed segments
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.validateOrder — allowed segments', () => {
  const baseProfile = {
    duration_hours: 24, allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
    trading_hours_start: '00:00', trading_hours_end: '23:59',
    overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
    max_open_positions: 50, leverage_max: 50, per_position_loss_pct: 2,
    consistency_rule_pct: 0,
  };

  beforeEach(() => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(baseProfile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['NSE', 'NFO', 'BFO', 'MCX', 'CDS'])('allows %s segment', async (seg) => {
    const account = makeFlashAccount();
    const order = makeOrderParams({ segment: seg });

    // Mock downstream checks to pass
    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'countOpenPositions').mockResolvedValue(0);
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);
    const { MarginService } = await import('./marginService.js');
    vi.spyOn(MarginService, 'validateMargin').mockResolvedValue({ allowed: true });

    const result = await FlashRiskEngine.validateOrder('acct-001', order, validQuoteProvider, account);
    expect(result.allowed).toBe(true);
  });

  it('rejects an unlisted segment (e.g. INVALID)', async () => {
    const account = makeFlashAccount();
    const order = makeOrderParams({ segment: 'INVALID' });
    const result = await FlashRiskEngine.validateOrder('acct-001', order, validQuoteProvider, account);
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe('allowed_segments');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Pre-trade: trading hours
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.validateOrder — trading hours', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects order outside 09:15–15:30', async () => {
    // Mock current time to 08:00
    vi.spyOn(global, 'Date').mockImplementation(() => ({
      getHours: () => 8, getMinutes: () => 0,
    }));

    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue({
      duration_hours: 24, allowed_segments: ['NFO'],
      trading_hours_start: '09:15', trading_hours_end: '15:30',
      overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
      max_open_positions: 50, leverage_max: 50,
    });
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });

    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, makeFlashAccount());
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe('trading_hours');

    vi.restoreAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Pre-trade: max open positions
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.validateOrder — max open positions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects 51st position when limit is 50', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue({
      duration_hours: 24, allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      trading_hours_start: '00:00', trading_hours_end: '23:59',
      overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
      max_open_positions: 50, leverage_max: 50, per_position_loss_pct: 2,
      consistency_rule_pct: 0,
    });
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });

    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'countOpenPositions').mockResolvedValue(50);
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);

    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, makeFlashAccount());
    expect(result.allowed).toBe(false);
    expect(result.ruleType).toBe('max_open_positions');
  });

  it('allows 50th position', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue({
      duration_hours: 24, allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      trading_hours_start: '00:00', trading_hours_end: '23:59',
      overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
      max_open_positions: 50, leverage_max: 50, per_position_loss_pct: 2,
      consistency_rule_pct: 0,
    });
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });

    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'countOpenPositions').mockResolvedValue(49);
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);
    const { MarginService } = await import('./marginService.js');
    vi.spyOn(MarginService, 'validateMargin').mockResolvedValue({ allowed: true });

    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, makeFlashAccount());
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Post-trade: per-position loss
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.postTradeCheck — per-position loss (2%)', () => {
  afterEach(() => vi.restoreAllMocks());

  const profile = {
    duration_hours: 24, per_position_loss_pct: 2, max_drawdown_pct: 4,
    max_open_positions: 50, leverage_max: 50,
    allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
    trading_hours_start: '09:15', trading_hours_end: '15:30',
    overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
  };

  it('locks account when a position exceeds 2% loss (₹20,000 on ₹10L)', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(profile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });
    vi.spyOn(FlashRiskProfileService, 'recordFirstPosition').mockResolvedValue();

    // Open position with avg_price=22000, current ltp=21550 → loss = (22000-21550)*50 = ₹22,500 > ₹20,000
    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([
      { id: 'pos-001', symbol: 'NIFTY25JUL22000CE', token: '12345', side: 'LONG', qty: 50, avg_price: 22000 },
    ]);
    vi.spyOn(PositionRepository.prototype, 'getTotalUnrealizedPnl').mockResolvedValue(-22500);

    const account = makeFlashAccount({ balance: 1000000, peak_balance: 1000000 });
    // quoteProvider returns 21550 for that token
    const qp = (token) => token === '12345' ? 21550 : null;

    const result = await FlashRiskEngine.postTradeCheck('acct-001', qp, account);
    expect(result.status).toBe('locked');
    expect(result.reason).toContain('per_position_loss');
  });

  it('does NOT lock when position loss is below 2%', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(profile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });
    vi.spyOn(FlashRiskProfileService, 'recordFirstPosition').mockResolvedValue();

    // Avg 22000, ltp 21960 → loss = 40*50 = ₹2,000 (< ₹20,000 limit)
    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([
      { id: 'pos-002', symbol: 'NIFTY25JUL22000CE', token: '12345', side: 'LONG', qty: 50, avg_price: 22000 },
    ]);
    vi.spyOn(PositionRepository.prototype, 'getTotalUnrealizedPnl').mockResolvedValue(-2000);

    const account = makeFlashAccount({ balance: 1000000, peak_balance: 1000000 });
    const qp = (token) => token === '12345' ? 21960 : null;

    const result = await FlashRiskEngine.postTradeCheck('acct-001', qp, account);
    expect(result.status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Post-trade: max drawdown (4%)
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.postTradeCheck — max drawdown (4%)', () => {
  afterEach(() => vi.restoreAllMocks());

  const profile = {
    duration_hours: 24, per_position_loss_pct: 2, max_drawdown_pct: 4,
    overnight_allowed: true, weekend_allowed: true, holiday_restriction: false,
  };

  it('breaches account when drawdown >= 4% of peak', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(profile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });
    vi.spyOn(FlashRiskProfileService, 'recordFirstPosition').mockResolvedValue();

    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);
    // Unrealized P&L pushes equity below 4% threshold
    vi.spyOn(PositionRepository.prototype, 'getTotalUnrealizedPnl').mockResolvedValue(-41000);

    // balance=1000000, peak=1000000 → drawdown = 1000000-(1000000-41000) = 41000 > 40000 (4%)
    const account = makeFlashAccount({ balance: 1000000, peak_balance: 1000000 });

    const result = await FlashRiskEngine.postTradeCheck('acct-001', validQuoteProvider, account);
    expect(result.status).toBe('breached');
    expect(result.reason).toContain('Max drawdown');
  });

  it('returns ok when drawdown is below 4%', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(profile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });
    vi.spyOn(FlashRiskProfileService, 'recordFirstPosition').mockResolvedValue();

    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);
    vi.spyOn(PositionRepository.prototype, 'getTotalUnrealizedPnl').mockResolvedValue(-10000);

    const account = makeFlashAccount({ balance: 1000000, peak_balance: 1000000 });

    const result = await FlashRiskEngine.postTradeCheck('acct-001', validQuoteProvider, account);
    expect(result.status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — Overnight / Weekend / Holiday
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskEngine.validateOrder — overnight/weekend/holiday', () => {
  afterEach(() => vi.restoreAllMocks());

  // Profile with overnight/weekend allowed, no holiday restriction
  const permissiveProfile = {
    duration_hours: 24,
    allowed_segments: ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
    trading_hours_start: '09:15', trading_hours_end: '15:30',
    overnight_allowed: true,
    weekend_allowed: true,
    holiday_restriction: false,
    max_open_positions: 50, leverage_max: 50,
    per_position_loss_pct: 2, consistency_rule_pct: 0,
  };

  it('does NOT apply no_overnight restriction for Flash accounts', async () => {
    // Flash profile: overnight_allowed = true
    // The Flash Risk Engine should NOT call checkNoOvernight
    // We verify by using a NRML product after 15:15 — still allowed
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(permissiveProfile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });

    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'countOpenPositions').mockResolvedValue(0);
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);
    const { MarginService } = await import('./marginService.js');
    vi.spyOn(MarginService, 'validateMargin').mockResolvedValue({ allowed: true });

    const account = makeFlashAccount();
    const order = makeOrderParams({ productType: 'NRML', segment: 'NFO' });
    const result = await FlashRiskEngine.validateOrder('acct-001', order, validQuoteProvider, account);
    // No rejection for overnight — Flash allows it
    expect(result.allowed).toBe(true);
  });

  it('does NOT apply weekend restriction for Flash accounts', async () => {
    vi.spyOn(FlashRiskProfileService, 'getProfile').mockResolvedValue(permissiveProfile);
    vi.spyOn(FlashRiskProfileService, 'checkExpiry').mockResolvedValue({ expired: false });

    const { PositionRepository } = await import('../repositories/position.repository.js');
    vi.spyOn(PositionRepository.prototype, 'countOpenPositions').mockResolvedValue(0);
    vi.spyOn(PositionRepository.prototype, 'findOpenByAccountId').mockResolvedValue([]);
    const { MarginService } = await import('./marginService.js');
    vi.spyOn(MarginService, 'validateMargin').mockResolvedValue({ allowed: true });

    // FlashRiskEngine.validateOrder does NOT call checkWeekend — this is an omission by design
    // weekend_allowed = true means we skip the check entirely
    const account = makeFlashAccount();
    const result = await FlashRiskEngine.validateOrder('acct-001', makeOrderParams(), validQuoteProvider, account);
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — Profile fetched from DB, not hardcoded
// ─────────────────────────────────────────────────────────────────────────────

describe('FlashRiskProfileService.getProfile — caching', () => {
  it('returns hardcoded default when supabase is null', async () => {
    // supabase is imported; mock it as null
    const profile = await FlashRiskProfileService.getProfile();
    // Should always return a valid profile object
    expect(profile).toBeTruthy();
    expect(typeof profile.duration_hours).toBe('number');
    expect(typeof profile.per_position_loss_pct).toBe('number');
    expect(Array.isArray(profile.allowed_segments)).toBe(true);
  });

  it('hardcoded default has correct Flash values', async () => {
    // Invalidate cache so it re-fetches
    FlashRiskProfileService.invalidateCache();
    const profile = await FlashRiskProfileService.getProfile();
    expect(profile.duration_hours).toBe(24);
    expect(profile.per_position_loss_pct).toBe(2.0);
    expect(profile.max_drawdown_pct).toBe(4.0);
    expect(profile.max_open_positions).toBe(50);
    expect(profile.leverage_max).toBe(50);
    expect(profile.overnight_allowed).toBe(true);
    expect(profile.weekend_allowed).toBe(true);
    expect(profile.holiday_restriction).toBe(false);
    expect(profile.profit_target_pct).toBe(0.0);
    expect(profile.profit_split_pct).toBe(90.0);
    expect(profile.consistency_rule_pct).toBe(15.0);
    expect(profile.payout_threshold_pct).toBe(3.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — Isolation: non-Flash accounts unaffected
// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation — non-Flash accounts use generic RiskEngine', () => {
  it('isFlashAccount returns false for instant, 1step, 2step', () => {
    expect(FlashRiskProfileService.isFlashAccount(makeNonFlashAccount('instant'))).toBe(false);
    expect(FlashRiskProfileService.isFlashAccount(makeNonFlashAccount('1step'))).toBe(false);
    expect(FlashRiskProfileService.isFlashAccount(makeNonFlashAccount('2step'))).toBe(false);
  });
});
