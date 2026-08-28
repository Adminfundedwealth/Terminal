import { describe, expect, it } from 'vitest';
import { isCompleteOptionChain } from '@/utils/optionChainValidation';

const validEntry = {
  strike: 24100,
  callToken: '101',
  callLtp: 100,
  putToken: '102',
  putLtp: 120,
} as any;

describe('isCompleteOptionChain', () => {
  it('accepts a chain with usable CE and PE quotes', () => {
    expect(isCompleteOptionChain([validEntry])).toBe(true);
  });

  it('rejects the empty or zero-value snapshot seen after refresh', () => {
    expect(isCompleteOptionChain([{
      strike: 24100,
      callToken: '101',
      callLtp: 0,
      putToken: '102',
      putLtp: 0,
    } as any])).toBe(false);
  });

  it('rejects invalid strikes', () => {
    expect(isCompleteOptionChain([{ ...validEntry, strike: 0 }])).toBe(false);
  });
});