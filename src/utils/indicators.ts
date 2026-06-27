/**
 * TECHNICAL INDICATORS
 * 
 * Pure calculation functions for chart indicators.
 * Input: OHLCV array. Output: indicator values array.
 */

import type { OHLC } from '@/types';

// ─── SMA (Simple Moving Average) ────────────────────────────

export function calculateSMA(data: OHLC[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

// ─── EMA (Exponential Moving Average) ────────────────────────

export function calculateEMA(data: OHLC[], period: number): { time: number; value: number }[] {
  if (data.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: { time: number; value: number }[] = [];

  // First EMA = SMA of first 'period' values
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

// ─── RSI (Relative Strength Index) ──────────────────────────

export function calculateRSI(data: OHLC[], period: number = 14): { time: number; value: number }[] {
  if (data.length < period + 1) return [];
  const result: { time: number; value: number }[] = [];

  let avgGain = 0;
  let avgLoss = 0;

  // First average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: data[period].time, value: 100 - 100 / (1 + rs) });

  // Subsequent values using smoothed average
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

// ─── MACD ────────────────────────────────────────────────────

export interface MACDResult {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export function calculateMACD(data: OHLC[], fast = 12, slow = 26, signal = 9): MACDResult[] {
  const emaFast = calculateEMA(data, fast);
  const emaSlow = calculateEMA(data, slow);

  if (emaFast.length === 0 || emaSlow.length === 0) return [];

  // Align by time
  const slowMap = new Map(emaSlow.map(e => [e.time, e.value]));
  const macdLine: { time: number; value: number }[] = [];

  for (const ef of emaFast) {
    const sv = slowMap.get(ef.time);
    if (sv !== undefined) {
      macdLine.push({ time: ef.time, value: ef.value - sv });
    }
  }

  if (macdLine.length < signal) return [];

  // Signal line (EMA of MACD)
  const multiplier = 2 / (signal + 1);
  let signalEma = 0;
  for (let i = 0; i < signal; i++) signalEma += macdLine[i].value;
  signalEma /= signal;

  const result: MACDResult[] = [];
  result.push({
    time: macdLine[signal - 1].time,
    macd: macdLine[signal - 1].value,
    signal: signalEma,
    histogram: macdLine[signal - 1].value - signalEma,
  });

  for (let i = signal; i < macdLine.length; i++) {
    signalEma = (macdLine[i].value - signalEma) * multiplier + signalEma;
    result.push({
      time: macdLine[i].time,
      macd: macdLine[i].value,
      signal: signalEma,
      histogram: macdLine[i].value - signalEma,
    });
  }
  return result;
}

// ─── Bollinger Bands ─────────────────────────────────────────

export interface BollingerResult {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export function calculateBollinger(data: OHLC[], period: number = 20, stdDev: number = 2): BollingerResult[] {
  const result: BollingerResult[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const sma = sum / period;

    let variance = 0;
    for (let j = 0; j < period; j++) variance += Math.pow(data[i - j].close - sma, 2);
    const std = Math.sqrt(variance / period);

    result.push({
      time: data[i].time,
      upper: sma + stdDev * std,
      middle: sma,
      lower: sma - stdDev * std,
    });
  }
  return result;
}

// ─── VWAP (Volume Weighted Average Price) ────────────────────

export function calculateVWAP(data: OHLC[]): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  let cumulativeTPV = 0; // cumulative (typical price * volume)
  let cumulativeVolume = 0;

  for (const bar of data) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativeTPV += typicalPrice * (bar.volume || 1);
    cumulativeVolume += bar.volume || 1;

    result.push({
      time: bar.time,
      value: cumulativeTPV / cumulativeVolume,
    });
  }
  return result;
}

// ─── Volume ──────────────────────────────────────────────────

export function extractVolume(data: OHLC[]): { time: number; value: number; color: string }[] {
  return data.map((bar, i) => ({
    time: bar.time,
    value: bar.volume || 0,
    color: bar.close >= bar.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
  }));
}
