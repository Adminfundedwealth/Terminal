import { describe, expect, it, vi } from 'vitest';
import { DataProviderSwitch } from '../server/services/dataProviderSwitch.js';

describe('Dhan historical provider isolation', () => {
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