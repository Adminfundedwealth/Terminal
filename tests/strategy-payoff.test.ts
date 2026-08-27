/**
 * STRATEGY PAYOFF ENGINE TESTS (P6.3)
 *
 * Pure math — validates payoff, net premium, max P/L, breakevens, and unbounded
 * tails for the core option strategies. No DOM, no network.
 */

import { describe, it, expect } from 'vitest';
import {
  legPayoffAt,
  combinedPayoffAt,
  netPremium,
  computePayoff,
  STRATEGY_PRESETS,
  type StrategyLeg,
} from '@/utils/strategyPayoff';

describe('legPayoffAt', () => {
  it('long call: worthless below strike (loss = premium)', () => {
    const leg: StrategyLeg = { optionType: 'CE', side: 'BUY', strike: 100, premium: 5, qty: 1 };
    expect(legPayoffAt(leg, 90)).toBe(-5);   // -premium
    expect(legPayoffAt(leg, 100)).toBe(-5);  // ATM, intrinsic 0
    expect(legPayoffAt(leg, 108)).toBe(3);   // 8 intrinsic - 5 premium
  });

  it('long put: gains as price falls', () => {
    const leg: StrategyLeg = { optionType: 'PE', side: 'BUY', strike: 100, premium: 5, qty: 1 };
    expect(legPayoffAt(leg, 110)).toBe(-5);  // worthless above strike
    expect(legPayoffAt(leg, 90)).toBe(5);    // 10 intrinsic - 5 premium
  });

  it('short call: keeps premium below strike, loses above', () => {
    const leg: StrategyLeg = { optionType: 'CE', side: 'SELL', strike: 100, premium: 5, qty: 1 };
    expect(legPayoffAt(leg, 90)).toBe(5);    // keep premium
    expect(legPayoffAt(leg, 110)).toBe(-5);  // premium 5 - intrinsic 10
  });

  it('respects quantity multiplier', () => {
    const leg: StrategyLeg = { optionType: 'CE', side: 'BUY', strike: 100, premium: 5, qty: 50 };
    expect(legPayoffAt(leg, 110)).toBe((10 - 5) * 50);
  });
});

describe('netPremium', () => {
  it('long straddle is a net debit (negative)', () => {
    const legs: StrategyLeg[] = [
      { optionType: 'CE', side: 'BUY', strike: 100, premium: 6, qty: 1 },
      { optionType: 'PE', side: 'BUY', strike: 100, premium: 5, qty: 1 },
    ];
    expect(netPremium(legs)).toBe(-11);
  });

  it('bull call spread is a net debit smaller than the long premium', () => {
    const legs: StrategyLeg[] = [
      { optionType: 'CE', side: 'BUY', strike: 100, premium: 8, qty: 1 },
      { optionType: 'CE', side: 'SELL', strike: 110, premium: 3, qty: 1 },
    ];
    expect(netPremium(legs)).toBe(-5); // pay 8, receive 3
  });
});

describe('computePayoff — Long Straddle', () => {
  const legs: StrategyLeg[] = [
    { optionType: 'CE', side: 'BUY', strike: 100, premium: 6, qty: 1 },
    { optionType: 'PE', side: 'BUY', strike: 100, premium: 5, qty: 1 },
  ];
  const r = computePayoff(legs, 100);

  it('is valid and has unbounded profit both tails', () => {
    expect(r.valid).toBe(true);
    expect(r.maxProfit).toBe(Infinity); // long call → up; long put → down
  });

  it('max loss is the total premium at the strike', () => {
    // At S=100 both expire worthless → loss = -(6+5) = -11
    expect(combinedPayoffAt(legs, 100)).toBe(-11);
    expect(r.maxLoss).toBeLessThanOrEqual(-11 + 0.5);
  });

  it('has two breakevens around strike ± total premium (~89 and ~111)', () => {
    expect(r.breakevens.length).toBe(2);
    const [loBE, hiBE] = r.breakevens;
    expect(loBE).toBeGreaterThan(88);
    expect(loBE).toBeLessThan(90);
    expect(hiBE).toBeGreaterThan(110);
    expect(hiBE).toBeLessThan(112);
  });
});

describe('computePayoff — Bull Call Spread (defined risk)', () => {
  const legs: StrategyLeg[] = [
    { optionType: 'CE', side: 'BUY', strike: 100, premium: 8, qty: 1 },
    { optionType: 'CE', side: 'SELL', strike: 110, premium: 3, qty: 1 },
  ];
  const r = computePayoff(legs, 105);

  it('has bounded max profit and max loss (net long+short call cancel at tails)', () => {
    expect(r.maxProfit).not.toBe(Infinity);
    expect(r.maxLoss).not.toBe(-Infinity);
  });

  it('max loss = net debit (-5), max profit = width - debit (10 - 5 = 5)', () => {
    // Below 100: both worthless → -5. Above 110: (S-100) - (S-110) - 5 = 10 - 5 = 5.
    expect(combinedPayoffAt(legs, 90)).toBe(-5);
    expect(combinedPayoffAt(legs, 120)).toBe(5);
    expect(r.maxLoss).toBeCloseTo(-5, 1);
    expect(r.maxProfit).toBeCloseTo(5, 1);
  });

  it('single breakeven near 105 (lower strike + net debit)', () => {
    expect(r.breakevens.length).toBe(1);
    expect(r.breakevens[0]).toBeGreaterThan(104);
    expect(r.breakevens[0]).toBeLessThan(106);
  });
});

describe('computePayoff — Short Straddle (unbounded loss)', () => {
  const legs: StrategyLeg[] = [
    { optionType: 'CE', side: 'SELL', strike: 100, premium: 6, qty: 1 },
    { optionType: 'PE', side: 'SELL', strike: 100, premium: 5, qty: 1 },
  ];
  const r = computePayoff(legs, 100);
  it('max profit is the net credit (+11) at the strike; loss unbounded', () => {
    expect(combinedPayoffAt(legs, 100)).toBe(11);
    expect(r.maxLoss).toBe(-Infinity);
    expect(r.maxProfit).toBeCloseTo(11, 0);
  });
});

describe('computePayoff — edge cases', () => {
  it('empty legs → invalid, no fabricated values', () => {
    const r = computePayoff([], 100);
    expect(r.valid).toBe(false);
    expect(r.maxProfit).toBe(0);
    expect(r.breakevens).toEqual([]);
    expect(r.curve).toEqual([]);
  });

  it('invalid leg (zero/neg strike or qty) → invalid', () => {
    expect(computePayoff([{ optionType: 'CE', side: 'BUY', strike: 0, premium: 5, qty: 1 }], 100).valid).toBe(false);
    expect(computePayoff([{ optionType: 'CE', side: 'BUY', strike: 100, premium: 5, qty: 0 }], 100).valid).toBe(false);
  });

  it('qty scales P&L linearly (lots × lotSize)', () => {
    const one = computePayoff([{ optionType: 'CE', side: 'BUY', strike: 100, premium: 5, qty: 1 }], 100);
    const fifty = computePayoff([{ optionType: 'CE', side: 'BUY', strike: 100, premium: 5, qty: 50 }], 100);
    expect(fifty.netPremium).toBe(one.netPremium * 50);
  });
});

describe('STRATEGY_PRESETS', () => {
  it('has the five required presets with correct leg shapes', () => {
    const ids = STRATEGY_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['straddle', 'strangle', 'bull_call', 'bear_put', 'custom']);

    const straddle = STRATEGY_PRESETS.find((p) => p.id === 'straddle')!;
    expect(straddle.legs).toHaveLength(2);
    expect(straddle.strikeCount).toBe(1);

    const bull = STRATEGY_PRESETS.find((p) => p.id === 'bull_call')!;
    expect(bull.legs.some((l) => l.optionType === 'CE' && l.side === 'BUY' && l.strikeRole === 'lower')).toBe(true);
    expect(bull.legs.some((l) => l.optionType === 'CE' && l.side === 'SELL' && l.strikeRole === 'upper')).toBe(true);

    const custom = STRATEGY_PRESETS.find((p) => p.id === 'custom')!;
    expect(custom.legs).toHaveLength(0);
  });
});
