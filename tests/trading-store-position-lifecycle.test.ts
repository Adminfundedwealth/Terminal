import { beforeEach, describe, expect, it } from 'vitest';
import { useTradingStore } from '@/store/tradingStore';
import type { Position } from '@/types';

const position = (overrides: Partial<Position> = {}): Position => ({
  id: 'abc',
  symbol: 'RELIANCE',
  token: '2885',
  segment: 'NSE',
  productType: 'MIS',
  side: 'LONG',
  qty: 1,
  avgPrice: 1315.4,
  ltp: 1315.4,
  pnl: 0,
  mtm: 0,
  buyQty: 1,
  sellQty: 0,
  buyAvg: 1315.4,
  sellAvg: 0,
  ...overrides,
});

describe('trading position lifecycle', () => {
  beforeEach(() => {
    useTradingStore.getState().setPositions([]);
  });

  it('inserts, updates, and closes one realtime position without duplicates', () => {
    const store = useTradingStore.getState();

    store.addPosition(position());
    expect(useTradingStore.getState().positions).toHaveLength(1);
    expect(useTradingStore.getState().positions[0].id).toBe('abc');

    store.addPosition(position({ qty: 2 }));
    expect(useTradingStore.getState().positions).toHaveLength(1);

    store.updatePosition('abc', { qty: 2, ltp: 1316, pnl: 1.2 });
    expect(useTradingStore.getState().positions[0]).toMatchObject({ qty: 2, ltp: 1316, pnl: 1.2 });

    store.updatePosition('abc', { qty: 0 });
    expect(useTradingStore.getState().positions.filter((item) => item.qty !== 0)).toHaveLength(0);
  });
});
