/**
 * OPTIONS WEB WORKER
 * 
 * Offloads heavy options computations from the main thread:
 * - Black-Scholes Greeks calculation for entire option chain
 * - Payoff curve generation (100+ price points)
 * - Max pain calculation
 * - Strategy analysis (multi-leg)
 * 
 * Message Protocol:
 *   IN:  { type: 'greeks', strikes: StrikeInput[], spot: number, riskFreeRate: number, daysToExpiry: number }
 *   OUT: { type: 'greeks-result', results: GreeksResult[] }
 *
 *   IN:  { type: 'payoff', legs: OptionLeg[], spot: number }
 *   OUT: { type: 'payoff-result', curve: PayoffPoint[], breakevens: number[], maxProfit: number|null, maxLoss: number|null }
 *
 *   IN:  { type: 'maxpain', chain: ChainEntry[] }
 *   OUT: { type: 'maxpain-result', strike: number }
 *
 *   OUT: { type: 'error', message: string }
 */

import { computeBlackScholesGreeks, impliedVolatility } from '../utils/blackScholes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StrikeInput {
  strike: number;
  type: 'CE' | 'PE';
  ltp: number;
  iv?: number; // If IV is pre-computed
}

interface GreeksResult {
  strike: number;
  type: 'CE' | 'PE';
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  theoreticalPrice: number;
}

interface OptionLeg {
  strike: number;
  type: 'CE' | 'PE';
  side: 'BUY' | 'SELL';
  qty: number;
  premium: number;
}

interface PayoffPoint {
  spot: number;
  pnl: number;
}

interface ChainEntry {
  strike: number;
  callOi: number;
  putOi: number;
}

// ─── Worker Message Handler ───────────────────────────────────────────────────

self.onmessage = (event: MessageEvent) => {
  const { type } = event.data;

  try {
    switch (type) {
      case 'greeks':
        handleGreeks(event.data);
        break;
      case 'payoff':
        handlePayoff(event.data);
        break;
      case 'maxpain':
        handleMaxPain(event.data);
        break;
      default:
        self.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || 'Options worker error' });
  }
};

// ─── Greeks Computation ───────────────────────────────────────────────────────

function handleGreeks(data: { strikes: StrikeInput[]; spot: number; riskFreeRate: number; daysToExpiry: number }) {
  const { strikes, spot, riskFreeRate, daysToExpiry } = data;
  const T = daysToExpiry / 365;
  const r = riskFreeRate;

  const results: GreeksResult[] = strikes.map(s => {
    const isCall = s.type === 'CE';
    let sigma = s.iv && Number.isFinite(s.iv) && s.iv > 0 ? s.iv / 100 : Number.NaN;

    // If we have LTP, try to estimate IV via Newton-Raphson
    if (s.ltp > 0 && !s.iv) {
      sigma = impliedVolatility(spot, s.strike, T, r, s.ltp, isCall);
    }

    const greeks = computeBlackScholesGreeks(spot, s.strike, T, r, sigma, isCall);
    return {
      strike: s.strike,
      type: s.type,
      ...greeks,
      iv: sigma * 100,
    };
  });

  self.postMessage({ type: 'greeks-result', results });
}

// ─── Payoff Curve ─────────────────────────────────────────────────────────────

function handlePayoff(data: { legs: OptionLeg[]; spot: number }) {
  const { legs, spot } = data;

  // Generate curve: 20% below to 20% above spot, minimum 100 points
  const lowBound = spot * 0.8;
  const highBound = spot * 1.2;
  const numPoints = Math.max(100, 200);
  const step = (highBound - lowBound) / (numPoints - 1);

  const curve: PayoffPoint[] = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;

  for (let i = 0; i < numPoints; i++) {
    const spotAtExpiry = lowBound + i * step;
    let pnl = 0;

    for (const leg of legs) {
      const intrinsicValue = leg.type === 'CE'
        ? Math.max(0, spotAtExpiry - leg.strike)
        : Math.max(0, leg.strike - spotAtExpiry);

      const legPnl = leg.side === 'BUY'
        ? (intrinsicValue - leg.premium) * leg.qty
        : (leg.premium - intrinsicValue) * leg.qty;

      pnl += legPnl;
    }

    curve.push({ spot: Math.round(spotAtExpiry * 100) / 100, pnl: Math.round(pnl * 100) / 100 });
    maxProfit = Math.max(maxProfit, pnl);
    maxLoss = Math.min(maxLoss, pnl);
  }

  // Find breakevens (sign changes)
  const breakevens: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    if ((curve[i - 1].pnl >= 0 && curve[i].pnl < 0) || (curve[i - 1].pnl < 0 && curve[i].pnl >= 0)) {
      // Linear interpolation for precision
      const x0 = curve[i - 1].spot;
      const x1 = curve[i].spot;
      const y0 = curve[i - 1].pnl;
      const y1 = curve[i].pnl;
      const breakeven = x0 - y0 * (x1 - x0) / (y1 - y0);
      breakevens.push(Math.round(breakeven * 100) / 100);
    }
  }

  // Check if profit/loss is unbounded (at edges)
  const edgePnlHigh = curve[curve.length - 1].pnl;
  const edgePnlLow = curve[0].pnl;
  const isUnlimitedProfit = maxProfit > 0 && (edgePnlHigh > maxProfit * 0.99 || edgePnlLow > maxProfit * 0.99);
  const isUnlimitedLoss = maxLoss < 0 && (edgePnlHigh < maxLoss * 0.99 || edgePnlLow < maxLoss * 0.99);

  self.postMessage({
    type: 'payoff-result',
    curve,
    breakevens,
    maxProfit: isUnlimitedProfit ? null : Math.round(maxProfit * 100) / 100,
    maxLoss: isUnlimitedLoss ? null : Math.round(maxLoss * 100) / 100,
  });
}

// ─── Max Pain ─────────────────────────────────────────────────────────────────

function handleMaxPain(data: { chain: ChainEntry[] }) {
  const { chain } = data;
  let minPain = Infinity;
  let maxPainStrike = 0;

  for (const entry of chain) {
    let pain = 0;
    for (const row of chain) {
      // Call pain
      if (entry.strike > row.strike) {
        pain += (entry.strike - row.strike) * (row.callOi || 0);
      }
      // Put pain
      if (row.strike > entry.strike) {
        pain += (row.strike - entry.strike) * (row.putOi || 0);
      }
    }
    if (pain < minPain) {
      minPain = pain;
      maxPainStrike = entry.strike;
    }
  }

  self.postMessage({ type: 'maxpain-result', strike: maxPainStrike });
}

// ─── Black-Scholes Helpers ────────────────────────────────────────────────────

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function blackScholes(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean) {
  if (T <= 0 || sigma <= 0 || S <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, theoreticalPrice: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  let delta: number, theta: number, rho: number, price: number;

  if (isCall) {
    delta = normalCDF(d1);
    price = S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
    theta = (-(S * normalPDF(d1) * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365;
    rho = K * T * Math.exp(-r * T) * normalCDF(d2) / 100;
  } else {
    delta = normalCDF(d1) - 1;
    price = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
    theta = (-(S * normalPDF(d1) * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365;
    rho = -K * T * Math.exp(-r * T) * normalCDF(-d2) / 100;
  }

  const gamma = normalPDF(d1) / (S * sigma * sqrtT);
  const vega = S * normalPDF(d1) * sqrtT / 100;

  return { delta, gamma, theta, vega, rho, theoreticalPrice: Math.max(0, price) };
}

function impliedVolatility(S: number, K: number, T: number, r: number, marketPrice: number, isCall: boolean): number {
  // Newton-Raphson method for IV estimation
  let sigma = 0.3; // Initial guess 30%
  const MAX_ITER = 50;
  const TOLERANCE = 0.0001;

  for (let i = 0; i < MAX_ITER; i++) {
    const bs = blackScholes(S, K, T, r, sigma, isCall);
    const diff = bs.theoreticalPrice - marketPrice;

    if (Math.abs(diff) < TOLERANCE) break;

    // Vega for Newton step
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const vega = S * normalPDF(d1) * sqrtT;

    if (vega < 0.0001) break; // Avoid division by near-zero

    sigma -= diff / vega;
    sigma = Math.max(0.01, Math.min(5.0, sigma)); // Clamp to reasonable range
  }

  return sigma;
}

export {};
