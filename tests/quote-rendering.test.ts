import { describe, expect, it } from 'vitest';
import { hasUsableQuote } from '@/utils/helpers';

describe('quote rendering guard', () => {
  it('accepts only finite positive LTP values', () => {
    expect(hasUsableQuote({ ltp: 24349 })).toBe(true);
    expect(hasUsableQuote({ ltp: 0 })).toBe(false);
    expect(hasUsableQuote({ ltp: Number.NaN })).toBe(false);
    expect(hasUsableQuote(undefined)).toBe(false);
  });
});