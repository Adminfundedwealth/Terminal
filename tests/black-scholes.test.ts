import { describe, expect, it } from 'vitest';
import { blackScholesPrice, computeBlackScholesGreeks, impliedVolatility } from '@/utils/blackScholes';

describe('P1.4 local Black-Scholes Greeks', () => {
  it('computes finite call Greeks and theoretical price', () => {
    const greeks = computeBlackScholesGreeks(100, 100, 30 / 365, 0.05, 0.2, true);
    expect(greeks.theoreticalPrice).toBeGreaterThan(0);
    expect(Number.isFinite(greeks.delta)).toBe(true);
    expect(greeks.gamma).toBeGreaterThan(0);
    expect(greeks.vega).toBeGreaterThan(0);
  });

  it('computes put delta with the correct sign', () => {
    expect(computeBlackScholesGreeks(100, 100, 30 / 365, 0.05, 0.2, false).delta).toBeLessThan(0);
  });

  it('recovers volatility from a Black-Scholes market price', () => {
    const marketPrice = blackScholesPrice(100, 100, 30 / 365, 0.05, 0.25, true);
    expect(impliedVolatility(100, 100, 30 / 365, 0.05, marketPrice, true)).toBeCloseTo(0.25, 2);
  });
});