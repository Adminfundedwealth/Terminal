/**
 * MARGIN SERVICE — leverage & margin-type unit tests
 * ════════════════════════════════════════════════════════════════════════
 *
 * Regression coverage for the NIFTY-margin bug:
 *   - Effective leverage from the account (resolved by the risk engine from
 *     the challenge profile) must drive the margin, not a hardcoded 10x.
 *   - Equity MIS margin = orderValue / leverage.
 *   - CNC = full order value (no leverage on delivery).
 *   - Futures margin uses lot-based margin / leverage.
 *
 * calculateOrderMargin is a pure function (no DB) so no mocks are required.
 */

import { describe, it, expect, vi } from 'vitest';

// supabase not needed for calculateOrderMargin — stub to null so import is safe.
vi.mock('../db/client.js', () => ({ supabase: null }));

import { MarginService } from '../services/marginService.js';

describe('MarginService.calculateOrderMargin — leverage resolution', () => {
  it('uses effective_leverage (30x) for equity MIS — the 1-Step profile value', () => {
    const { requiredMargin, marginType } = MarginService.calculateOrderMargin(
      { symbol: 'RELIANCE', token: '2885', segment: 'NSE', productType: 'MIS', side: 'BUY', qty: 100, price: 1300 },
      null,
      { effective_leverage: 30 },
    );
    // orderValue = 130000; margin = 130000/30 = 4333.33
    expect(requiredMargin).toBeCloseTo(130000 / 30, 1);
    expect(marginType).toBe('equity_intraday_30x');
  });

  it('falls back to 10x when no leverage is attached', () => {
    const { requiredMargin, marginType } = MarginService.calculateOrderMargin(
      { symbol: 'RELIANCE', token: '2885', segment: 'NSE', productType: 'MIS', side: 'BUY', qty: 100, price: 1300 },
      null,
      null,
    );
    expect(requiredMargin).toBeCloseTo(130000 / 10, 1);
    expect(marginType).toBe('equity_intraday_10x');
  });

  it('effective_leverage takes priority over flat leverage_max', () => {
    const { requiredMargin } = MarginService.calculateOrderMargin(
      { symbol: 'RELIANCE', token: '2885', segment: 'NSE', productType: 'MIS', side: 'BUY', qty: 100, price: 1300 },
      null,
      { effective_leverage: 30, leverage_max: 10 },
    );
    expect(requiredMargin).toBeCloseTo(130000 / 30, 1);
  });

  it('CNC (delivery) requires 100% of order value regardless of leverage', () => {
    const { requiredMargin, marginType } = MarginService.calculateOrderMargin(
      { symbol: 'RELIANCE', token: '2885', segment: 'NSE', productType: 'CNC', side: 'BUY', qty: 100, price: 1300 },
      null,
      { effective_leverage: 30 },
    );
    expect(requiredMargin).toBe(130000);
    expect(marginType).toBe('delivery_100pct');
  });

  it('NIFTY futures (NFO) 1 lot uses lot margin / leverage, not spot notional', () => {
    // NIFTY lot margin 100000 (default), MIS multiplier 0.4, leverage 30
    const { requiredMargin, marginType } = MarginService.calculateOrderMargin(
      { symbol: 'NIFTY FUT', token: '58072', segment: 'NFO', productType: 'MIS', side: 'BUY', qty: 65, price: 24200 },
      null,
      { effective_leverage: 30 },
    );
    // baseMargin = 100000 * 1 lot; MIS = *0.4; /30
    expect(requiredMargin).toBeCloseTo((100000 * 0.4) / 30, 1);
    expect(marginType).toMatch(/fo_futures_intraday_30x/);
    // Must NOT equal the spot notional (24200*65 = 1,573,000) or a % of it
    expect(requiredMargin).toBeLessThan(24200 * 65);
  });

  it('Option BUY charges premium only (qty*ltp), ignoring leverage', () => {
    const { requiredMargin, marginType } = MarginService.calculateOrderMargin(
      { symbol: 'NIFTY24200CE', token: '1', segment: 'NFO', productType: 'MIS', side: 'BUY', qty: 65, price: 120, instrumentType: 'OPTIDX' },
      null,
      { effective_leverage: 30 },
    );
    expect(requiredMargin).toBe(65 * 120);
    expect(marginType).toBe('option_buy_premium');
  });
});
