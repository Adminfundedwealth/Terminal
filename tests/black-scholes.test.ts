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

  it.each([
    ['call', true],
    ['put', false],
  ] as const)('computes finite %s Greeks', (_name, isCall) => {
    const greeks = computeBlackScholesGreeks(100, 100, 0.25, 0.05, 0.3, isCall);
    expect(Object.values(greeks).every(Number.isFinite)).toBe(true);
    expect(greeks.gamma).toBeGreaterThan(0);
    expect(greeks.vega).toBeGreaterThan(0);
    expect(greeks.delta).toBeGreaterThanOrEqual(isCall ? 0 : -1);
    expect(greeks.delta).toBeLessThanOrEqual(isCall ? 1 : 0);
  });

  it.each([
    ['ITM call', 110, true],
    ['OTM call', 90, true],
    ['ITM put', 90, false],
    ['OTM put', 110, false],
  ] as const)('keeps %s delta in the correct range', (_name, spot, isCall) => {
    const delta = computeBlackScholesGreeks(spot, 100, 0.25, 0.05, 0.3, isCall).delta;
    expect(delta).toBeGreaterThanOrEqual(isCall ? 0 : -1);
    expect(delta).toBeLessThanOrEqual(isCall ? 1 : 0);
  });

  it('returns unavailable values for invalid IV inputs instead of a default', () => {
    expect(impliedVolatility(100, 100, 0, 0.05, 10, true)).toBeNaN();
    expect(impliedVolatility(100, 100, 0.25, 0.05, 0, true)).toBeNaN();
    expect(computeBlackScholesGreeks(100, 100, 0.25, 0.05, 0, true).iv).toBeNaN();
  });

  it('rejects expired contracts and invalid underlying prices', () => {
    expect(blackScholesPrice(100, 100, 0, 0.05, 0.2, true)).toBeNaN();
    expect(blackScholesPrice(0, 100, 0.25, 0.05, 0.2, true)).toBeNaN();
    expect(computeBlackScholesGreeks(0, 100, 0.25, 0.05, 0.2, false).delta).toBeNaN();
  });

  it('rejects impossible market prices and remains stable near expiry', () => {
    expect(impliedVolatility(100, 100, 1 / 365, 0.05, 100, true)).toBeNaN();
    const greeks = computeBlackScholesGreeks(100, 100, 1 / 365, 0.05, 0.2, true);
    expect(Object.values(greeks).every(Number.isFinite)).toBe(true);
    expect(greeks.gamma).toBeGreaterThan(0);
  });
});