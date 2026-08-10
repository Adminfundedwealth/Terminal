/**
 * TECHNICAL INDICATORS
 *
 * Pure calculation functions for chart indicators.
 * Input: OHLCV array. Output: indicator values array.
 */

import type { OHLC } from '@/types';

// ─── SMA ─────────────────────────────────────────────────────

export function calculateSMA(data: OHLC[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

// ─── EMA ─────────────────────────────────────────────────────

export function calculateEMA(data: OHLC[], period: number): { time: number; value: number }[] {
  if (data.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i].close;
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });
  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

// Internal EMA on arbitrary value array (for DEMA/TEMA/HMA/TRIX/etc.)
function emaOnValues(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let e = sum / period;
  result.push(e);
  for (let i = period; i < values.length; i++) {
    e = (values[i] - e) * k + e;
    result.push(e);
  }
  return result;
}

// ─── Double EMA ──────────────────────────────────────────────

export function calculateDEMA(data: OHLC[], period: number): { time: number; value: number }[] {
  const closes = data.map(d => d.close);
  const ema1 = emaOnValues(closes, period);
  const ema2 = emaOnValues(ema1, period);
  const offset = closes.length - ema1.length; // index in original data where ema1 starts
  const offset2 = ema1.length - ema2.length;
  return ema2.map((e2, i) => {
    const e1 = ema1[i + offset2];
    const dataIdx = i + offset + offset2;
    return { time: data[dataIdx].time, value: 2 * e1 - e2 };
  });
}

// ─── Triple EMA ──────────────────────────────────────────────

export function calculateTEMA(data: OHLC[], period: number): { time: number; value: number }[] {
  const closes = data.map(d => d.close);
  const ema1 = emaOnValues(closes, period);
  const ema2 = emaOnValues(ema1, period);
  const ema3 = emaOnValues(ema2, period);
  const off1 = closes.length - ema1.length;
  const off2 = ema1.length - ema2.length;
  const off3 = ema2.length - ema3.length;
  return ema3.map((e3, i) => {
    const e2 = ema2[i + off3];
    const e1 = ema1[i + off2 + off3];
    const dataIdx = i + off1 + off2 + off3;
    return { time: data[dataIdx].time, value: 3 * e1 - 3 * e2 + e3 };
  });
}

// ─── RSI ─────────────────────────────────────────────────────

export function calculateRSI(data: OHLC[], period: number = 14): { time: number; value: number }[] {
  if (data.length < period + 1) return [];
  const result: { time: number; value: number }[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period; avgLoss /= period;
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: data[period].time, value: 100 - 100 / (1 + rs0) });
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ time: data[i].time, value: rsi });
  }
  return result;
}

// ─── MACD ─────────────────────────────────────────────────────

export interface MACDResult {
  time: number; macd: number; signal: number; histogram: number;
}

export function calculateMACD(data: OHLC[], fast = 12, slow = 26, signal = 9): MACDResult[] {
  const emaFast = calculateEMA(data, fast);
  const emaSlow = calculateEMA(data, slow);
  if (!emaFast.length || !emaSlow.length) return [];
  const slowMap = new Map(emaSlow.map(e => [e.time, e.value]));
  const macdLine: { time: number; value: number }[] = [];
  for (const ef of emaFast) {
    const sv = slowMap.get(ef.time);
    if (sv !== undefined) macdLine.push({ time: ef.time, value: ef.value - sv });
  }
  if (macdLine.length < signal) return [];
  const k = 2 / (signal + 1);
  let signalEma = 0;
  for (let i = 0; i < signal; i++) signalEma += macdLine[i].value;
  signalEma /= signal;
  const result: MACDResult[] = [];
  result.push({ time: macdLine[signal - 1].time, macd: macdLine[signal - 1].value, signal: signalEma, histogram: macdLine[signal - 1].value - signalEma });
  for (let i = signal; i < macdLine.length; i++) {
    signalEma = (macdLine[i].value - signalEma) * k + signalEma;
    result.push({ time: macdLine[i].time, macd: macdLine[i].value, signal: signalEma, histogram: macdLine[i].value - signalEma });
  }
  return result;
}

// ─── Bollinger Bands ─────────────────────────────────────────

export interface BollingerResult {
  time: number; upper: number; middle: number; lower: number;
}

export function calculateBollinger(data: OHLC[], period = 20, stdDev = 2): BollingerResult[] {
  const result: BollingerResult[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const sma = sum / period;
    let variance = 0;
    for (let j = 0; j < period; j++) variance += Math.pow(data[i - j].close - sma, 2);
    const std = Math.sqrt(variance / period);
    result.push({ time: data[i].time, upper: sma + stdDev * std, middle: sma, lower: sma - stdDev * std });
  }
  return result;
}

// ─── VWAP ────────────────────────────────────────────────────

export function calculateVWAP(data: OHLC[]): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  // Check whether this instrument has real volume data.
  // For pure index instruments, Angel One returns volume=0 for all bars.
  // Using volume=1 as an equal-weight fallback would silently produce a
  // plain typical-price moving average, which is NOT a true VWAP.
  // Return empty so the indicator is hidden on volume-unavailable instruments.
  const hasVolume = data.some(bar => (bar.volume || 0) > 0);
  if (!hasVolume) return [];

  let cumTPV = 0, cumVol = 0;
  for (const bar of data) {
    if ((bar.volume || 0) === 0) continue; // skip zero-volume bars
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumTPV += tp * bar.volume;
    cumVol += bar.volume;
    result.push({ time: bar.time, value: cumTPV / cumVol });
  }
  return result;
}

// ─── Volume ──────────────────────────────────────────────────

export function extractVolume(data: OHLC[]): { time: number; value: number; color: string }[] {
  // If ALL bars have zero volume (e.g. pure index instruments — NIFTY, BANKNIFTY,
  // FINNIFTY, MIDCPNIFTY, SENSEX), Angel One returns c[5]=0 for every candle.
  // In that case return an empty array so ChartPanel can hide the volume pane
  // and show "Volume unavailable" instead of fake flat bars.
  const hasVolume = data.some(bar => (bar.volume || 0) > 0);
  if (!hasVolume) return [];

  return data.map(bar => ({
    time: bar.time,
    value: bar.volume || 0,
    color: bar.close >= bar.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
  }));
}

// ─── ATR (Average True Range) ────────────────────────────────

export function calculateATR(data: OHLC[], period = 14): { time: number; value: number }[] {
  if (data.length < 2) return [];
  const tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const hl = data[i].high - data[i].low;
    const hpc = Math.abs(data[i].high - data[i - 1].close);
    const lpc = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
  }
  // Wilder smoothing (same as RSI)
  const result: { time: number; value: number }[] = [];
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push({ time: data[period].time, value: atr });
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result.push({ time: data[i + 1].time, value: atr });
  }
  return result;
}

// ─── Stochastic ──────────────────────────────────────────────

export interface StochasticResult {
  time: number; k: number; d: number;
}

export function calculateStochastic(data: OHLC[], kPeriod = 14, dPeriod = 3): StochasticResult[] {
  const kLine: { time: number; value: number }[] = [];
  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map(d => d.high));
    const low = Math.min(...slice.map(d => d.low));
    const k = high === low ? 50 : ((data[i].close - low) / (high - low)) * 100;
    kLine.push({ time: data[i].time, value: k });
  }
  const kValues = kLine.map(k => k.value);
  const dValues = emaOnValues(kValues, dPeriod); // SMA-3 approximated by EMA-3 (standard)
  // Actually Stochastic %D is SMA of %K
  const dSMA: number[] = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const sum = kValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
    dSMA.push(sum / dPeriod);
  }
  const offset = kValues.length - dSMA.length;
  return dSMA.map((d, i) => ({
    time: kLine[i + offset].time,
    k: kLine[i + offset].value,
    d,
  }));
}

// ─── Stochastic RSI ──────────────────────────────────────────

export interface StochRSIResult {
  time: number; k: number; d: number;
}

export function calculateStochRSI(data: OHLC[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): StochRSIResult[] {
  const rsi = calculateRSI(data, rsiPeriod);
  if (rsi.length < stochPeriod) return [];
  const kRaw: { time: number; value: number }[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    const slice = rsi.slice(i - stochPeriod + 1, i + 1).map(r => r.value);
    const high = Math.max(...slice);
    const low = Math.min(...slice);
    const k = high === low ? 50 : ((rsi[i].value - low) / (high - low)) * 100;
    kRaw.push({ time: rsi[i].time, value: k });
  }
  const kSmoothed = emaOnValues(kRaw.map(k => k.value), kSmooth);
  const dSmoothed = emaOnValues(kSmoothed, dSmooth);
  const off1 = kRaw.length - kSmoothed.length;
  const off2 = kSmoothed.length - dSmoothed.length;
  return dSmoothed.map((d, i) => ({
    time: kRaw[i + off1 + off2].time,
    k: kSmoothed[i + off2],
    d,
  }));
}

// ─── SuperTrend ───────────────────────────────────────────────

export interface SuperTrendResult {
  time: number;
  value: number;
  direction: 1 | -1; // 1 = bullish (green), -1 = bearish (red)
}

export function calculateSuperTrend(data: OHLC[], period = 10, multiplier = 3): SuperTrendResult[] {
  const atr = calculateATR(data, period);
  if (!atr.length) return [];
  // Align atr to data
  const atrOffset = data.length - atr.length;
  const result: SuperTrendResult[] = [];
  let upperBand = 0, lowerBand = 0;
  let prevUpper = 0, prevLower = 0;
  let direction: 1 | -1 = 1;

  for (let i = 0; i < atr.length; i++) {
    const dataIdx = i + atrOffset;
    const hl2 = (data[dataIdx].high + data[dataIdx].low) / 2;
    const atrVal = atr[i].value;
    const basicUpper = hl2 + multiplier * atrVal;
    const basicLower = hl2 - multiplier * atrVal;

    upperBand = (i === 0 || basicUpper < prevUpper || data[dataIdx - 1]?.close > prevUpper)
      ? basicUpper : prevUpper;
    lowerBand = (i === 0 || basicLower > prevLower || data[dataIdx - 1]?.close < prevLower)
      ? basicLower : prevLower;

    if (i === 0) {
      direction = data[dataIdx].close > upperBand ? 1 : -1;
    } else {
      if (direction === -1 && data[dataIdx].close > prevUpper) direction = 1;
      else if (direction === 1 && data[dataIdx].close < prevLower) direction = -1;
    }

    result.push({
      time: data[dataIdx].time,
      value: direction === 1 ? lowerBand : upperBand,
      direction,
    });
    prevUpper = upperBand;
    prevLower = lowerBand;
  }
  return result;
}

// ─── Parabolic SAR ───────────────────────────────────────────

export interface ParabolicSARResult {
  time: number; value: number; direction: 1 | -1;
}

export function calculateParabolicSAR(data: OHLC[], start = 0.02, increment = 0.02, max = 0.2): ParabolicSARResult[] {
  if (data.length < 2) return [];
  const result: ParabolicSARResult[] = [];
  let bull = data[1].close > data[0].close;
  let af = start;
  let ep = bull ? data[0].high : data[0].low;
  let sar = bull ? data[0].low : data[0].high;

  for (let i = 1; i < data.length; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (bull) {
      sar = Math.min(sar, data[i - 1].low, i >= 2 ? data[i - 2].low : data[i - 1].low);
      if (data[i].low < sar) {
        bull = false; sar = ep; ep = data[i].low; af = start;
      } else {
        if (data[i].high > ep) { ep = data[i].high; af = Math.min(af + increment, max); }
      }
    } else {
      sar = Math.max(sar, data[i - 1].high, i >= 2 ? data[i - 2].high : data[i - 1].high);
      if (data[i].high > sar) {
        bull = true; sar = ep; ep = data[i].high; af = start;
      } else {
        if (data[i].low < ep) { ep = data[i].low; af = Math.min(af + increment, max); }
      }
    }
    result.push({ time: data[i].time, value: sar, direction: bull ? 1 : -1 });
  }
  return result;
}

// ─── ADX (Average Directional Index) ────────────────────────

export interface ADXResult {
  time: number; adx: number; diPlus: number; diMinus: number;
}

export function calculateADX(data: OHLC[], period = 14): ADXResult[] {
  if (data.length < period + 1) return [];
  const tr: number[] = [], dmPlus: number[] = [], dmMinus: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const hl = data[i].high - data[i].low;
    const hpc = Math.abs(data[i].high - data[i - 1].close);
    const lpc = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
    const upMove = data[i].high - data[i - 1].high;
    const downMove = data[i - 1].low - data[i].low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing
  let trSmooth = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let dpSmooth = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let dmSmooth = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const result: ADXResult[] = [];
  const dxArr: number[] = [];

  for (let i = period; i <= tr.length; i++) {
    if (i > period) {
      trSmooth = trSmooth - trSmooth / period + tr[i - 1];
      dpSmooth = dpSmooth - dpSmooth / period + dmPlus[i - 1];
      dmSmooth = dmSmooth - dmSmooth / period + dmMinus[i - 1];
    }
    const diP = trSmooth === 0 ? 0 : (dpSmooth / trSmooth) * 100;
    const diM = trSmooth === 0 ? 0 : (dmSmooth / trSmooth) * 100;
    const dx = diP + diM === 0 ? 0 : Math.abs(diP - diM) / (diP + diM) * 100;
    dxArr.push(dx);
    if (dxArr.length >= period) {
      let adx: number;
      if (dxArr.length === period) {
        adx = dxArr.reduce((a, b) => a + b, 0) / period;
      } else {
        adx = (result[result.length - 1].adx * (period - 1) + dx) / period;
      }
      result.push({ time: data[i].time, adx, diPlus: diP, diMinus: diM });
    }
  }
  return result;
}

// ─── CCI (Commodity Channel Index) ──────────────────────────

export function calculateCCI(data: OHLC[], period = 20): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let tpSum = 0;
    const tps: number[] = [];
    for (let j = 0; j < period; j++) {
      const tp = (data[i - j].high + data[i - j].low + data[i - j].close) / 3;
      tps.push(tp); tpSum += tp;
    }
    const tpMean = tpSum / period;
    const md = tps.reduce((s, t) => s + Math.abs(t - tpMean), 0) / period;
    const cci = md === 0 ? 0 : (((data[i].high + data[i].low + data[i].close) / 3) - tpMean) / (0.015 * md);
    result.push({ time: data[i].time, value: cci });
  }
  return result;
}

// ─── Williams %R ─────────────────────────────────────────────

export function calculateWilliamsR(data: OHLC[], period = 14): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map(d => d.high));
    const low = Math.min(...slice.map(d => d.low));
    const wr = high === low ? -50 : ((high - data[i].close) / (high - low)) * -100;
    result.push({ time: data[i].time, value: wr });
  }
  return result;
}

// ─── Standard Deviation ──────────────────────────────────────

export function calculateStdDev(data: OHLC[], period = 20): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(d => d.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
    result.push({ time: data[i].time, value: Math.sqrt(variance) });
  }
  return result;
}

// ─── Ichimoku Cloud ───────────────────────────────────────────

export interface IchimokuResult {
  time: number;
  tenkan: number | null;
  kijun: number | null;
  senkouA: number | null;
  senkouB: number | null;
  chikou: number | null;
}

export function calculateIchimoku(
  data: OHLC[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
  displacement = 26
): IchimokuResult[] {
  const midPoint = (d: OHLC[], start: number, period: number): number => {
    const slice = d.slice(start - period + 1, start + 1);
    return (Math.max(...slice.map(x => x.high)) + Math.min(...slice.map(x => x.low))) / 2;
  };

  const result: IchimokuResult[] = [];

  for (let i = Math.max(tenkanPeriod, kijunPeriod, senkouBPeriod) - 1; i < data.length; i++) {
    const tenkan = i >= tenkanPeriod - 1 ? midPoint(data, i, tenkanPeriod) : null;
    const kijun = i >= kijunPeriod - 1 ? midPoint(data, i, kijunPeriod) : null;
    const senkouA = tenkan !== null && kijun !== null ? (tenkan + kijun) / 2 : null;
    const senkouB = i >= senkouBPeriod - 1 ? midPoint(data, i, senkouBPeriod) : null;
    const chikouIdx = i + displacement;
    const chikou = chikouIdx < data.length ? data[i].close : null;

    result.push({ time: data[i].time, tenkan, kijun, senkouA, senkouB, chikou });
  }
  return result;
}

// ─── Pivot Points (Standard) ─────────────────────────────────

export interface PivotResult {
  time: number;
  pivot: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
}

export function calculatePivots(data: OHLC[]): PivotResult[] {
  // Use previous day/bar for standard pivot calculation
  const result: PivotResult[] = [];
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const p = (prev.high + prev.low + prev.close) / 3;
    result.push({
      time: data[i].time,
      pivot: p,
      r1: 2 * p - prev.low,
      r2: p + (prev.high - prev.low),
      r3: prev.high + 2 * (p - prev.low),
      s1: 2 * p - prev.high,
      s2: p - (prev.high - prev.low),
      s3: prev.low - 2 * (prev.high - p),
    });
  }
  return result;
}

// ─── Awesome Oscillator ──────────────────────────────────────

export function calculateAO(data: OHLC[]): { time: number; value: number; color: string }[] {
  const midpoints = data.map(d => (d.high + d.low) / 2);
  const sma5 = new Array(data.length).fill(null) as (number | null)[];
  const sma34 = new Array(data.length).fill(null) as (number | null)[];
  for (let i = 4; i < data.length; i++) {
    sma5[i] = midpoints.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5;
  }
  for (let i = 33; i < data.length; i++) {
    sma34[i] = midpoints.slice(i - 33, i + 1).reduce((a, b) => a + b, 0) / 34;
  }
  const result: { time: number; value: number; color: string }[] = [];
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    if (sma5[i] === null || sma34[i] === null) continue;
    const ao = sma5[i]! - sma34[i]!;
    result.push({ time: data[i].time, value: ao, color: ao >= prev ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)' });
    prev = ao;
  }
  return result;
}

// ─── Momentum ────────────────────────────────────────────────

export function calculateMomentum(data: OHLC[], period = 10): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period; i < data.length; i++) {
    result.push({ time: data[i].time, value: data[i].close - data[i - period].close });
  }
  return result;
}

// ─── Rate of Change (ROC) ────────────────────────────────────

export function calculateROC(data: OHLC[], period = 9): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period; i < data.length; i++) {
    const base = data[i - period].close;
    result.push({ time: data[i].time, value: base === 0 ? 0 : ((data[i].close - base) / base) * 100 });
  }
  return result;
}

// ─── Keltner Channels ────────────────────────────────────────

export interface KeltnerResult {
  time: number; upper: number; middle: number; lower: number;
}

export function calculateKeltner(data: OHLC[], emaPeriod = 20, atrPeriod = 10, multiplier = 2): KeltnerResult[] {
  const ema = calculateEMA(data, emaPeriod);
  const atr = calculateATR(data, atrPeriod);
  if (!ema.length || !atr.length) return [];
  const emaMap = new Map(ema.map(e => [e.time, e.value]));
  const result: KeltnerResult[] = [];
  for (const a of atr) {
    const m = emaMap.get(a.time);
    if (m === undefined) continue;
    result.push({ time: a.time, upper: m + multiplier * a.value, middle: m, lower: m - multiplier * a.value });
  }
  return result;
}

// ─── Donchian Channels ───────────────────────────────────────

export interface DonchianResult {
  time: number; upper: number; middle: number; lower: number;
}

export function calculateDonchian(data: OHLC[], period = 20): DonchianResult[] {
  const result: DonchianResult[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const upper = Math.max(...slice.map(d => d.high));
    const lower = Math.min(...slice.map(d => d.low));
    result.push({ time: data[i].time, upper, middle: (upper + lower) / 2, lower });
  }
  return result;
}

// ─── Envelopes ───────────────────────────────────────────────

export interface EnvelopeResult {
  time: number; upper: number; middle: number; lower: number;
}

export function calculateEnvelopes(data: OHLC[], period = 20, pct = 2.5): EnvelopeResult[] {
  const sma = calculateSMA(data, period);
  const factor = pct / 100;
  return sma.map(s => ({
    time: s.time,
    upper: s.value * (1 + factor),
    middle: s.value,
    lower: s.value * (1 - factor),
  }));
}

// ─── Hull Moving Average ─────────────────────────────────────

export function calculateHMA(data: OHLC[], period = 9): { time: number; value: number }[] {
  const closes = data.map(d => d.close);
  const half = Math.floor(period / 2);
  const sqrtPeriod = Math.round(Math.sqrt(period));
  const wma1 = wmaOnValues(closes, half);
  const wma2 = wmaOnValues(closes, period);
  const off1 = closes.length - wma1.length;
  const off2 = closes.length - wma2.length;
  // 2*WMA(n/2) - WMA(n), align by time
  const diff: number[] = [];
  const diffStart = Math.max(off1, off2);
  for (let i = diffStart; i < closes.length; i++) {
    const w1 = wma1[i - off1];
    const w2 = wma2[i - off2];
    diff.push(2 * w1 - w2);
  }
  const hmaValues = wmaOnValues(diff, sqrtPeriod);
  const hmaStart = diffStart + (diff.length - hmaValues.length);
  return hmaValues.map((v, i) => ({ time: data[hmaStart + i].time, value: v }));
}

function wmaOnValues(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const result: number[] = [];
  const weightSum = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let wsum = 0;
    for (let j = 0; j < period; j++) wsum += values[i - j] * (period - j);
    result.push(wsum / weightSum);
  }
  return result;
}

// ─── TRIX ────────────────────────────────────────────────────

export function calculateTRIX(data: OHLC[], period = 14): { time: number; value: number }[] {
  const closes = data.map(d => d.close);
  const ema1 = emaOnValues(closes, period);
  const ema2 = emaOnValues(ema1, period);
  const ema3 = emaOnValues(ema2, period);
  const result: { time: number; value: number }[] = [];
  const off = closes.length - ema3.length;
  for (let i = 1; i < ema3.length; i++) {
    const trix = ema3[i - 1] === 0 ? 0 : ((ema3[i] - ema3[i - 1]) / ema3[i - 1]) * 100;
    result.push({ time: data[i + off].time, value: trix });
  }
  return result;
}

// ─── Ultimate Oscillator ─────────────────────────────────────

export function calculateUltimateOscillator(data: OHLC[], p1 = 7, p2 = 14, p3 = 28): { time: number; value: number }[] {
  if (data.length < p3 + 1) return [];
  const bp: number[] = [], tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const pc = data[i - 1].close;
    const low = Math.min(data[i].low, pc);
    const high = Math.max(data[i].high, pc);
    bp.push(data[i].close - low);
    tr.push(high - low);
  }
  const result: { time: number; value: number }[] = [];
  for (let i = p3 - 1; i < bp.length; i++) {
    const sum = (p: number) => {
      let bpS = 0, trS = 0;
      for (let j = 0; j < p; j++) { bpS += bp[i - j]; trS += tr[i - j]; }
      return trS === 0 ? 0 : bpS / trS;
    };
    const uo = (4 * sum(p1) + 2 * sum(p2) + sum(p3)) / 7 * 100;
    result.push({ time: data[i + 1].time, value: uo });
  }
  return result;
}

// ─── Price Oscillator (DPO-style) ────────────────────────────

export function calculatePriceOscillator(data: OHLC[], shortPeriod = 9, longPeriod = 26): { time: number; value: number }[] {
  const shortEMA = calculateEMA(data, shortPeriod);
  const longEMA = calculateEMA(data, longPeriod);
  const longMap = new Map(longEMA.map(e => [e.time, e.value]));
  return shortEMA
    .filter(e => longMap.has(e.time))
    .map(e => ({ time: e.time, value: e.value - longMap.get(e.time)! }));
}

// ─── Historical Volatility ────────────────────────────────────

export function calculateHistoricalVolatility(data: OHLC[], period = 20): { time: number; value: number }[] {
  if (data.length < period + 1) return [];
  const logReturns: number[] = [];
  for (let i = 1; i < data.length; i++) {
    logReturns.push(Math.log(data[i].close / data[i - 1].close));
  }
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < logReturns.length; i++) {
    const slice = logReturns.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (period - 1);
    result.push({ time: data[i + 1].time, value: Math.sqrt(variance * 252) * 100 });
  }
  return result;
}

// ─── Vortex Indicator ─────────────────────────────────────────

export interface VortexResult {
  time: number; vip: number; vim: number;
}

export function calculateVortex(data: OHLC[], period = 14): VortexResult[] {
  if (data.length < period + 1) return [];
  const result: VortexResult[] = [];
  for (let i = period; i < data.length; i++) {
    let sumTR = 0, sumVIP = 0, sumVIM = 0;
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      const pc = data[idx - 1].close;
      const tr = Math.max(data[idx].high, pc) - Math.min(data[idx].low, pc);
      sumTR += tr;
      sumVIP += Math.abs(data[idx].high - data[idx - 1].low);
      sumVIM += Math.abs(data[idx].low - data[idx - 1].high);
    }
    result.push({ time: data[i].time, vip: sumTR === 0 ? 1 : sumVIP / sumTR, vim: sumTR === 0 ? 1 : sumVIM / sumTR });
  }
  return result;
}

// ─── Mass Index ───────────────────────────────────────────────

export function calculateMassIndex(data: OHLC[], emaPeriod = 9, sumPeriod = 25): { time: number; value: number }[] {
  const hl = data.map(d => d.high - d.low);
  const ema1 = emaOnValues(hl, emaPeriod);
  const ema2 = emaOnValues(ema1, emaPeriod);
  const off1 = hl.length - ema1.length;
  const off2 = ema1.length - ema2.length;
  const ratio: number[] = [];
  for (let i = 0; i < ema2.length; i++) {
    ratio.push(ema2[i] === 0 ? 1 : ema1[i + off2] / ema2[i]);
  }
  const result: { time: number; value: number }[] = [];
  for (let i = sumPeriod - 1; i < ratio.length; i++) {
    const sum = ratio.slice(i - sumPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push({ time: data[i + off1 + off2].time, value: sum });
  }
  return result;
}

// ─── Aroon ───────────────────────────────────────────────────

export interface AroonResult {
  time: number; up: number; down: number; oscillator: number;
}

export function calculateAroon(data: OHLC[], period = 14): AroonResult[] {
  const result: AroonResult[] = [];
  for (let i = period; i < data.length; i++) {
    const slice = data.slice(i - period, i + 1);
    let highIdx = 0, lowIdx = 0;
    for (let j = 1; j <= period; j++) {
      if (slice[j].high > slice[highIdx].high) highIdx = j;
      if (slice[j].low < slice[lowIdx].low) lowIdx = j;
    }
    const up = ((period - (period - highIdx)) / period) * 100;
    const down = ((period - (period - lowIdx)) / period) * 100;
    result.push({ time: data[i].time, up, down, oscillator: up - down });
  }
  return result;
}

// ─── Chande Momentum Oscillator (CMO) ────────────────────────

export function calculateCMO(data: OHLC[], period = 9): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period; i < data.length; i++) {
    let gainSum = 0, lossSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].close - data[j - 1].close;
      if (diff > 0) gainSum += diff; else lossSum += Math.abs(diff);
    }
    const denom = gainSum + lossSum;
    result.push({ time: data[i].time, value: denom === 0 ? 0 : ((gainSum - lossSum) / denom) * 100 });
  }
  return result;
}

// ─── Choppiness Index ────────────────────────────────────────

export function calculateChoppiness(data: OHLC[], period = 14): { time: number; value: number }[] {
  if (data.length < period + 1) return [];
  const result: { time: number; value: number }[] = [];
  const trs: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const pc = data[i - 1].close;
    trs.push(Math.max(data[i].high, pc) - Math.min(data[i].low, pc));
  }
  for (let i = period - 1; i < trs.length; i++) {
    const sliceD = data.slice(i - period + 1, i + 2);
    const high = Math.max(...sliceD.map(d => d.high));
    const low = Math.min(...sliceD.map(d => d.low));
    const range = high - low;
    const atrSum = trs.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const ci = range === 0 ? 50 : (Math.log10(atrSum / range) / Math.log10(period)) * 100;
    result.push({ time: data[i + 1].time, value: ci });
  }
  return result;
}

// ─── Detrended Price Oscillator (DPO) ────────────────────────

export function calculateDPO(data: OHLC[], period = 20): { time: number; value: number }[] {
  const sma = calculateSMA(data, period);
  const offset = Math.floor(period / 2) + 1;
  const result: { time: number; value: number }[] = [];
  const smaStart = data.length - sma.length; // index in data where sma starts
  for (let i = 0; i < sma.length; i++) {
    const dataIdx = i + smaStart;
    const priceIdx = dataIdx - offset;
    if (priceIdx >= 0) {
      result.push({ time: data[priceIdx].time, value: data[priceIdx].close - sma[i].value });
    }
  }
  return result;
}

// ─── Fisher Transform ─────────────────────────────────────────

export interface FisherResult {
  time: number; fisher: number; signal: number;
}

export function calculateFisher(data: OHLC[], period = 9): FisherResult[] {
  const result: FisherResult[] = [];
  let prevFisher = 0;
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map(d => d.high));
    const low = Math.min(...slice.map(d => d.low));
    const range = high - low;
    let value = range === 0 ? 0 : 2 * ((data[i].close - low) / range) - 1;
    value = Math.max(-0.999, Math.min(0.999, value));
    const fisher = 0.5 * Math.log((1 + value) / (1 - value));
    result.push({ time: data[i].time, fisher, signal: prevFisher });
    prevFisher = fisher;
  }
  return result;
}

// ─── Connors RSI ─────────────────────────────────────────────

export function calculateConnorsRSI(data: OHLC[], rsiPeriod = 3, streakPeriod = 2, percentRankPeriod = 100): { time: number; value: number }[] {
  // RSI(3) on close
  const rsi3 = calculateRSI(data, rsiPeriod);
  // Streak: consecutive up/down close changes
  const streaks: number[] = [0];
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const prev = streaks[i - 1];
    if (change > 0) streaks.push(prev >= 0 ? prev + 1 : 1);
    else if (change < 0) streaks.push(prev <= 0 ? prev - 1 : -1);
    else streaks.push(0);
  }
  // RSI(2) on streaks
  const streakData = data.map((d, i) => ({ ...d, close: streaks[i] }));
  const rsiStreak = calculateRSI(streakData, streakPeriod);

  // Percent rank of 1-day return over last N bars
  const result: { time: number; value: number }[] = [];
  const rsi3Map = new Map(rsi3.map(r => [r.time, r.value]));
  const rsiStreakMap = new Map(rsiStreak.map(r => [r.time, r.value]));

  for (let i = percentRankPeriod; i < data.length; i++) {
    const pctChange = data[i - 1].close === 0 ? 0 : (data[i].close - data[i - 1].close) / data[i - 1].close * 100;
    const slice = [];
    for (let j = i - percentRankPeriod; j < i; j++) {
      if (data[j - 1]) slice.push(data[j - 1].close === 0 ? 0 : (data[j].close - data[j - 1].close) / data[j - 1].close * 100);
    }
    const rank = slice.filter(v => v < pctChange).length / slice.length * 100;
    const t = data[i].time;
    const r3 = rsi3Map.get(t);
    const rs = rsiStreakMap.get(t);
    if (r3 !== undefined && rs !== undefined) {
      result.push({ time: t, value: (r3 + rs + rank) / 3 });
    }
  }
  return result;
}

// ─── Coppock Curve ────────────────────────────────────────────

export function calculateCoppock(data: OHLC[], wmaP = 10, roc1P = 14, roc2P = 11): { time: number; value: number }[] {
  const roc1 = calculateROC(data, roc1P);
  const roc2 = calculateROC(data, roc2P);
  const roc2Map = new Map(roc2.map(r => [r.time, r.value]));
  const combined = roc1.filter(r => roc2Map.has(r.time)).map(r => ({ time: r.time, value: r.value + roc2Map.get(r.time)! }));
  const wmaResult = wmaOnValues(combined.map(c => c.value), wmaP);
  const off = combined.length - wmaResult.length;
  return wmaResult.map((v, i) => ({ time: combined[i + off].time, value: v }));
}

// ─── Linear Regression Curve ─────────────────────────────────

export function calculateLinearRegression(data: OHLC[], period = 14): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(d => d.close);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      sumX += j; sumY += slice[j]; sumXY += j * slice[j]; sumX2 += j * j;
    }
    const denom = period * sumX2 - sumX * sumX;
    const slope = denom === 0 ? 0 : (period * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / period;
    result.push({ time: data[i].time, value: intercept + slope * (period - 1) });
  }
  return result;
}

// ─── Least Squares MA ────────────────────────────────────────

export const calculateLSMA = calculateLinearRegression; // same formula

// ─── McGinley Dynamic ────────────────────────────────────────

export function calculateMcGinley(data: OHLC[], period = 14): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  let mg = data[0].close;
  for (let i = 1; i < data.length; i++) {
    const price = data[i].close;
    const denom = period * Math.pow(price / mg, 4);
    mg = denom === 0 ? price : mg + (price - mg) / denom;
    result.push({ time: data[i].time, value: mg });
  }
  return result;
}

// ─── Balance of Power ─────────────────────────────────────────

export function calculateBOP(data: OHLC[], smoothPeriod = 1): { time: number; value: number }[] {
  const raw = data.map(d => {
    const range = d.high - d.low;
    return { time: d.time, value: range === 0 ? 0 : (d.close - d.open) / range };
  });
  if (smoothPeriod <= 1) return raw;
  const smaVals = calculateSMA(data.map(d => ({ ...d, close: (d.close - d.open) / Math.max(d.high - d.low, 0.001) })), smoothPeriod);
  return smaVals;
}

// ─── Typical Price ────────────────────────────────────────────

export function calculateTypicalPrice(data: OHLC[]): { time: number; value: number }[] {
  return data.map(d => ({ time: d.time, value: (d.high + d.low + d.close) / 3 }));
}

// ─── Median Price ─────────────────────────────────────────────

export function calculateMedianPrice(data: OHLC[]): { time: number; value: number }[] {
  return data.map(d => ({ time: d.time, value: (d.high + d.low) / 2 }));
}

// ─── Average Price ────────────────────────────────────────────

export function calculateAveragePrice(data: OHLC[]): { time: number; value: number }[] {
  return data.map(d => ({ time: d.time, value: (d.open + d.high + d.low + d.close) / 4 }));
}

// ─── Relative Vigor Index (RVI) ───────────────────────────────

export interface RVIResult {
  time: number; rvi: number; signal: number;
}

export function calculateRVI(data: OHLC[], period = 10): RVIResult[] {
  if (data.length < period + 4) return [];
  const num: number[] = [], denom: number[] = [];
  for (let i = 3; i < data.length; i++) {
    const n = ((data[i].close - data[i].open) + 2 * (data[i - 1].close - data[i - 1].open) +
              2 * (data[i - 2].close - data[i - 2].open) + (data[i - 3].close - data[i - 3].open)) / 6;
    const d = ((data[i].high - data[i].low) + 2 * (data[i - 1].high - data[i - 1].low) +
              2 * (data[i - 2].high - data[i - 2].low) + (data[i - 3].high - data[i - 3].low)) / 6;
    num.push(n); denom.push(d);
  }
  const result: RVIResult[] = [];
  for (let i = period - 1; i < num.length; i++) {
    const numSum = num.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const denomSum = denom.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const rvi = denomSum === 0 ? 0 : numSum / denomSum;
    result.push({ time: data[i + 3].time, rvi, signal: 0 });
  }
  // Signal: 4-bar symmetric weighted average of RVI
  for (let i = 3; i < result.length; i++) {
    const sig = (result[i].rvi + 2 * result[i - 1].rvi + 2 * result[i - 2].rvi + result[i - 3].rvi) / 6;
    result[i].signal = sig;
  }
  return result;
}
