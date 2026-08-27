/**
 * strategyPayoff.ts — FundedWealth Trading Terminal (P6.3)
 *
 * Pure, dependency-free option-strategy payoff & risk analytics.
 *
 * Everything here is derived ONLY from the legs the trader actually selected —
 * nothing is fabricated. When a value cannot be computed (e.g. no legs, or an
 * unbounded max profit/loss), we return an explicit sentinel (null / Infinity)
 * rather than a made-up number, so the UI can render "Unlimited" / "—".
 *
 * Payoff model: standard European option payoff at expiry.
 *   Long Call  P&L(S)  = (max(S - K, 0) - premium) * qty
 *   Long Put   P&L(S)  = (max(K - S, 0) - premium) * qty
 *   Short Call P&L(S)  = (premium - max(S - K, 0)) * qty
 *   Short Put  P&L(S)  = (premium - max(K - S, 0)) * qty
 * where premium is the per-unit option price and qty is total contracts
 * (i.e. lots × lotSize). Net premium = Σ (BUY: -premium*qty, SELL: +premium*qty).
 */

export type LegType = 'CE' | 'PE';
export type LegSide = 'BUY' | 'SELL';

export interface StrategyLeg {
  /** 'CE' or 'PE' */
  optionType: LegType;
  side: LegSide;
  strike: number;
  /** Per-unit option premium (LTP). */
  premium: number;
  /** Total quantity = lots × lotSize. */
  qty: number;
}

export interface PayoffPoint {
  /** Underlying price at expiry. */
  price: number;
  /** Combined strategy P&L at that price. */
  pnl: number;
}

export interface PayoffResult {
  /**
   * Net premium (cash flow at entry). Negative = net debit (you pay),
   * positive = net credit (you receive). In the same money units as pnl.
   */
  netPremium: number;
  /** Max profit across the evaluated range; Infinity if unbounded upward. */
  maxProfit: number;
  /** Max loss (as a negative number) across the range; -Infinity if unbounded. */
  maxLoss: number;
  /** Breakeven underlying prices (where combined P&L crosses zero). */
  breakevens: number[];
  /** Payoff curve samples across a sensible price range. */
  curve: PayoffPoint[];
  /** True when at least one leg is valid and computable. */
  valid: boolean;
}

/** P&L of a single leg at an underlying expiry price S (per the model above). */
export function legPayoffAt(leg: StrategyLeg, S: number): number {
  const intrinsic = leg.optionType === 'CE'
    ? Math.max(S - leg.strike, 0)
    : Math.max(leg.strike - S, 0);
  const perUnit = leg.side === 'BUY'
    ? intrinsic - leg.premium
    : leg.premium - intrinsic;
  return perUnit * leg.qty;
}

/** Combined P&L of all legs at underlying expiry price S. */
export function combinedPayoffAt(legs: StrategyLeg[], S: number): number {
  let total = 0;
  for (const leg of legs) total += legPayoffAt(leg, S);
  return total;
}

/**
 * Net premium cash-flow at entry.
 * BUY pays premium (negative cash), SELL receives premium (positive cash).
 */
export function netPremium(legs: StrategyLeg[]): number {
  let net = 0;
  for (const leg of legs) {
    net += (leg.side === 'BUY' ? -leg.premium : leg.premium) * leg.qty;
  }
  return Math.round(net * 100) / 100;
}

/**
 * Determine whether the strategy has unbounded profit above the highest strike
 * and/or unbounded loss, based on net long/short call & put exposure.
 * Slopes far above the top strike / far below the bottom strike are linear.
 */
function tailSlopes(legs: StrategyLeg[]): { upSlope: number; downSlope: number } {
  // As S → +∞: calls contribute (BUY:+qty, SELL:-qty) per unit; puts contribute 0.
  // As S → 0  : puts contribute (BUY:-qty [value falls as S rises → below strike
  //             the long put gains], SELL:+... ) — compute directly from model.
  let upSlope = 0;   // dPnL/dS as S → +∞
  let downSlope = 0; // dPnL/dS as S → -∞ (toward 0)
  for (const leg of legs) {
    if (leg.optionType === 'CE') {
      const s = (leg.side === 'BUY' ? 1 : -1) * leg.qty;
      upSlope += s;             // far above strike, call value grows 1:1
      // far below strike: call worthless, slope 0
    } else {
      const s = (leg.side === 'BUY' ? -1 : 1) * leg.qty;
      // far below strike (S→0): long put gains as S falls → dPnL/dS = -qty for BUY
      downSlope += s;
      // far above strike: put worthless, slope 0
    }
  }
  return { upSlope, downSlope };
}

/**
 * Compute full payoff analytics for a strategy.
 *
 * @param legs strategy legs (premium is per-unit; qty is total contracts)
 * @param spot current underlying spot (centers the sample range); optional
 * @param opts sampling options
 */
export function computePayoff(
  legs: StrategyLeg[],
  spot?: number,
  opts: { steps?: number; rangePct?: number } = {},
): PayoffResult {
  const valid = legs.length > 0 && legs.every(
    (l) => Number.isFinite(l.strike) && l.strike > 0 && Number.isFinite(l.premium) && l.premium >= 0 && l.qty > 0,
  );
  if (!valid) {
    return { netPremium: 0, maxProfit: 0, maxLoss: 0, breakevens: [], curve: [], valid: false };
  }

  const strikes = legs.map((l) => l.strike);
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const center = spot && spot > 0 ? spot : (minK + maxK) / 2;

  // Range: cover well beyond the strikes so breakevens/tails are captured.
  const rangePct = opts.rangePct ?? 0.5; // ±50% of center
  const spanFromCenter = Math.max(center * rangePct, (maxK - minK) * 1.5, center * 0.1);
  const lo = Math.max(0, center - spanFromCenter);
  const hi = center + spanFromCenter;
  const steps = Math.max(20, opts.steps ?? 120);
  const dx = (hi - lo) / steps;

  const curve: PayoffPoint[] = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  let prev: PayoffPoint | null = null;
  const breakevens: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const price = lo + i * dx;
    const pnl = Math.round(combinedPayoffAt(legs, price) * 100) / 100;
    const point = { price: Math.round(price * 100) / 100, pnl };
    curve.push(point);
    if (pnl > maxProfit) maxProfit = pnl;
    if (pnl < maxLoss) maxLoss = pnl;

    // Breakeven: sign change between consecutive samples → linear interpolate.
    if (prev) {
      if ((prev.pnl < 0 && pnl >= 0) || (prev.pnl > 0 && pnl <= 0)) {
        const t = prev.pnl / (prev.pnl - pnl); // fraction to zero crossing
        const be = prev.price + t * (point.price - prev.price);
        breakevens.push(Math.round(be * 100) / 100);
      }
    }
    prev = point;
  }

  // Unbounded tails: if a tail slope is nonzero, the extreme is unbounded and
  // the sampled max/min understates it — report Infinity honestly.
  const { upSlope, downSlope } = tailSlopes(legs);
  if (upSlope > 0) maxProfit = Infinity;
  if (downSlope < 0) maxProfit = Infinity; // profit grows as S falls (net long puts)
  if (upSlope < 0) maxLoss = -Infinity;    // loss grows as S rises (net short calls)
  if (downSlope > 0) maxLoss = -Infinity;  // loss grows as S falls (net short puts)

  return {
    netPremium: netPremium(legs),
    maxProfit,
    maxLoss,
    breakevens: dedupeSorted(breakevens),
    curve,
    valid: true,
  };
}

/** Remove near-duplicate breakevens and sort ascending. */
function dedupeSorted(vals: number[]): number[] {
  const sorted = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 0.01) out.push(v);
  }
  return out;
}

// ─── Strategy presets ───────────────────────────────────────────────────────
// Each preset returns leg *specs* (optionType/side + which strike role) so the
// UI can bind them to actual selected strikes/premiums. No hardcoded strikes.

export type PresetId = 'straddle' | 'strangle' | 'bull_call' | 'bear_put' | 'custom';

export interface PresetLegSpec {
  optionType: LegType;
  side: LegSide;
  /** 'lower' | 'atm' | 'upper' — which selected strike this leg binds to. */
  strikeRole: 'lower' | 'atm' | 'upper';
}

export interface StrategyPreset {
  id: PresetId;
  label: string;
  /** How many distinct strikes the trader must choose. */
  strikeCount: number;
  legs: PresetLegSpec[];
  description: string;
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'straddle', label: 'Long Straddle', strikeCount: 1,
    description: 'Buy CE + Buy PE at the same (ATM) strike. Profits from a large move either way.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeRole: 'atm' },
      { optionType: 'PE', side: 'BUY', strikeRole: 'atm' },
    ],
  },
  {
    id: 'strangle', label: 'Long Strangle', strikeCount: 2,
    description: 'Buy OTM CE (upper) + Buy OTM PE (lower). Cheaper than a straddle; needs a bigger move.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeRole: 'upper' },
      { optionType: 'PE', side: 'BUY', strikeRole: 'lower' },
    ],
  },
  {
    id: 'bull_call', label: 'Bull Call Spread', strikeCount: 2,
    description: 'Buy lower-strike CE + Sell upper-strike CE. Defined-risk bullish.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeRole: 'lower' },
      { optionType: 'CE', side: 'SELL', strikeRole: 'upper' },
    ],
  },
  {
    id: 'bear_put', label: 'Bear Put Spread', strikeCount: 2,
    description: 'Buy upper-strike PE + Sell lower-strike PE. Defined-risk bearish.',
    legs: [
      { optionType: 'PE', side: 'BUY', strikeRole: 'upper' },
      { optionType: 'PE', side: 'SELL', strikeRole: 'lower' },
    ],
  },
  {
    id: 'custom', label: 'Custom', strikeCount: 0,
    description: 'Build any combination of CE/PE BUY/SELL legs manually.',
    legs: [],
  },
];
