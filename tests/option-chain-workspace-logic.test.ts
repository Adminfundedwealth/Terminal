import { describe, expect, it } from 'vitest';
import { COLUMN_PRESETS, centerChainAroundAtm, classifyOptionContract } from '@/components/OptionChainModal';
import { isCompleteOptionChain } from '@/utils/optionChainValidation';

describe('Option Chain workspace logic', () => {
  it('classifies CE and PE contracts correctly around spot', () => {
    expect(classifyOptionContract(24000, 24000, 'CE')).toBe('ATM');
    expect(classifyOptionContract(23950, 24000, 'CE')).toBe('ITM');
    expect(classifyOptionContract(24050, 24000, 'CE')).toBe('OTM');
    expect(classifyOptionContract(24050, 24000, 'PE')).toBe('ITM');
    expect(classifyOptionContract(23950, 24000, 'PE')).toBe('OTM');
    expect(classifyOptionContract(24000, 0, 'CE')).toBe('UNAVAILABLE');
  });

  it('keeps the default Basic preset focused and supports advanced presets', () => {
    expect(COLUMN_PRESETS.Basic).toEqual(expect.arrayContaining(['callOi', 'callIv', 'callLtp', 'callBid', 'callAsk', 'putBid', 'putAsk', 'putLtp', 'putIv', 'putOi']));
    expect(COLUMN_PRESETS.Basic).not.toContain('callGamma');
    expect(COLUMN_PRESETS.Full.length).toBeGreaterThan(COLUMN_PRESETS.Basic.length);
  });

  it('centers a configured strike window on the nearest ATM strike', () => {
    const chain = [1, 2, 3, 4, 5, 6, 7].map((strike) => ({ strike }));
    expect(centerChainAroundAtm(chain, 4.2, 1).map((entry) => entry.strike)).toEqual([3, 4, 5]);
    expect(centerChainAroundAtm(chain, 4.2, 'all')).toHaveLength(7);
    expect(centerChainAroundAtm(chain, 0, 5)).toHaveLength(7);
  });

  it('rejects an unavailable chain snapshot instead of displaying fake rows', () => {
    expect(isCompleteOptionChain([])).toBe(false);
    expect(isCompleteOptionChain([{ strike: 24000, callLtp: 0, putLtp: 0 } as any])).toBe(false);
  });
});
