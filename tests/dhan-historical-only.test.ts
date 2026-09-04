import { describe, expect, it, vi } from 'vitest';
import { DataProviderSwitch } from '../server/services/dataProviderSwitch.js';
import { DhanHistoricalService, isValidDhanCandle, validateDhanCandleSeries } from '../server/brokers/dhan/dhan.historical.js';

describe('Dhan historical provider isolation', () => {
  it.each([
    ['RELIANCE', 1300], ['HCLTECH', 1300], ['NIFTY 50', 24000], ['HDFCBANK', 700],
    ['TCS', 2300], ['INFY', 1100], ['BANKNIFTY', 52000], ['ICICIBANK', 1400],
  ])('normalizes every candle for %s without extreme field mapping', (symbol, price) => {
    const service = new DhanHistoricalService({ isTokenValid: true }, null);
    const candles = service._parse({ data: {
      timestamp: [1788000000, 1788000300],
      open: [price, price + 1],
      high: [price + 10, price + 11],
      low: [price - 10, price - 9],
      close: [price + 5, price + 6],
      volume: [100, 101],
    }});

    expect(candles).toHaveLength(2);
    for (const candle of candles) {
      expect(Number.isFinite(candle.open)).toBe(true);
      expect(Number.isFinite(candle.high)).toBe(true);
      expect(Number.isFinite(candle.low)).toBe(true);
      expect(Number.isFinite(candle.close)).toBe(true);
      expect(candle.open).toBeGreaterThan(0);
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.high).toBeLessThan(price * 2);
    }
  });

  it('rejects malformed and cross-instrument OHLC values', () => {
    const service = new DhanHistoricalService({ isTokenValid: true }, null);
    const parsed = service._parse({ data: {
      timestamp: [1788000000, 1788000300, 1788000600],
      open: [1300, 1300, 1300],
      high: [1310, 24000, 1312],
      low: [1290, 1290, 1292],
      close: [1305, 1301, 1310],
      volume: [100, 100, 100],
    }});

    expect(parsed).toHaveLength(2);
    expect(parsed.every(candle => isValidDhanCandle(candle))).toBe(true);
    expect(parsed.some(candle => candle.high >= 24000)).toBe(false);
  });

  it('rejects a complete cross-instrument price jump while retaining valid bars', () => {
    const series = [
      { time: 1, open: 1290, high: 1310, low: 1280, close: 1300, volume: 1 },
      { time: 2, open: 24000, high: 24100, low: 23900, close: 24050, volume: 1 },
      { time: 3, open: 1300, high: 1320, low: 1290, close: 1310, volume: 1 },
    ];
    expect(validateDhanCandleSeries(series)).toHaveLength(2);
  });

  it('does not call Angel when Dhan returns an empty range', async () => {
    const angel = { getHistoricalCandles: vi.fn() };
    const dhan = { getHistoricalData: vi.fn().mockResolvedValue([]) };
    const provider = new DataProviderSwitch(angel, null, dhan);
    provider._dhanReady = true;

    const result = await provider.getHistoricalCandles('1333', '5', 'NSE_EQ', 0, 0);

    expect(result).toEqual({ data: [], provider: 'DHAN' });
    expect(dhan.getHistoricalData).toHaveBeenCalledOnce();
    expect(angel.getHistoricalCandles).not.toHaveBeenCalled();
  });

  it('surfaces Dhan failures without Angel fallback', async () => {
    const angel = { getHistoricalCandles: vi.fn() };
    const dhan = { getHistoricalData: vi.fn().mockRejectedValue(new Error('DH-901')) };
    const provider = new DataProviderSwitch(angel, null, dhan);
    provider._dhanReady = true;

    await expect(provider.getHistoricalCandles('1333', '5', 'NSE_EQ', 0, 0))
      .rejects.toMatchObject({ code: 'DHAN_HISTORICAL_FAILED', provider: 'DHAN' });
    expect(angel.getHistoricalCandles).not.toHaveBeenCalled();
  });
});