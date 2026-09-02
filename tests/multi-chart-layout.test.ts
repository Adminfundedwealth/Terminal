import { describe, expect, it } from 'vitest';
import { getChartGridDimensions } from '@/components/MultiChartPanel';

describe('multi-chart layout grid', () => {
  it.each([
    ['single', 1, 1, 1],
    ['2h', 2, 1, 2],
    ['2v', 1, 2, 2],
    ['4', 2, 2, 4],
    ['8-chart', 4, 2, 8],
  ] as const)('%s creates the expected stable grid', (layout, cols, rows, count) => {
    expect(getChartGridDimensions(layout)).toEqual({ cols, rows, count });
  });
});