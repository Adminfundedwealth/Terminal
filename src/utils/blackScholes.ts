export interface BlackScholesGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  theoreticalPrice: number;
}

const INVALID = Number.NaN;

function validInputs(spot: number, strike: number, years: number, rate: number, volatility: number): boolean {
  return [spot, strike, years, rate, volatility].every(Number.isFinite)
    && spot > 0 && strike > 0 && years > 0 && volatility > 0;
}

function normalCDF(value: number): number {
  const coefficients = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * scaled);
  const polynomial = (((((coefficients[4] * t + coefficients[3]) * t + coefficients[2]) * t + coefficients[1]) * t + coefficients[0]) * t);
  return 0.5 * (1 + sign * (1 - polynomial * Math.exp(-scaled * scaled)));
}

function normalPDF(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

export function blackScholesPrice(spot: number, strike: number, years: number, rate: number, volatility: number, isCall: boolean): number {
  if (!validInputs(spot, strike, years, rate, volatility)) return INVALID;
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  return Math.max(0, isCall
    ? spot * normalCDF(d1) - strike * Math.exp(-rate * years) * normalCDF(d2)
    : strike * Math.exp(-rate * years) * normalCDF(-d2) - spot * normalCDF(-d1));
}

export function impliedVolatility(spot: number, strike: number, years: number, rate: number, marketPrice: number, isCall: boolean): number {
  if (![spot, strike, years, rate, marketPrice].every(Number.isFinite) || marketPrice <= 0 || !validInputs(spot, strike, years, rate, 1)) return INVALID;
  const discountedStrike = strike * Math.exp(-rate * years);
  const intrinsic = isCall ? Math.max(spot - discountedStrike, 0) : Math.max(discountedStrike - spot, 0);
  const upperBound = isCall ? spot : discountedStrike;
  if (marketPrice < intrinsic || marketPrice >= upperBound) return INVALID;

  let volatility = 0.3;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const price = blackScholesPrice(spot, strike, years, rate, volatility, isCall);
    const rootTime = Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / (volatility * rootTime);
    const vega = spot * normalPDF(d1) * rootTime;
    const difference = price - marketPrice;
    if (Math.abs(difference) < 0.000001) return volatility;
    if (!Number.isFinite(vega) || vega < 0.0000001) break;
    volatility = Math.max(0.0001, Math.min(5, volatility - difference / vega));
  }
  return INVALID;
}

export function computeBlackScholesGreeks(spot: number, strike: number, years: number, rate: number, volatility: number, isCall: boolean): BlackScholesGreeks {
  if (!validInputs(spot, strike, years, rate, volatility)) return { delta: INVALID, gamma: INVALID, theta: INVALID, vega: INVALID, rho: INVALID, iv: INVALID, theoreticalPrice: INVALID };
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  const discount = Math.exp(-rate * years);
  const callDelta = normalCDF(d1);
  const delta = isCall ? callDelta : callDelta - 1;
  const theta = isCall
    ? (-(spot * normalPDF(d1) * volatility) / (2 * rootTime) - rate * strike * discount * normalCDF(d2)) / 365
    : (-(spot * normalPDF(d1) * volatility) / (2 * rootTime) + rate * strike * discount * normalCDF(-d2)) / 365;
  const rho = isCall ? strike * years * discount * normalCDF(d2) / 100 : -strike * years * discount * normalCDF(-d2) / 100;
  return {
    delta,
    gamma: normalPDF(d1) / (spot * volatility * rootTime),
    theta,
    vega: spot * normalPDF(d1) * rootTime / 100,
    rho,
    iv: volatility * 100,
    theoreticalPrice: blackScholesPrice(spot, strike, years, rate, volatility, isCall),
  };
}