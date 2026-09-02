import { describe, expect, it } from 'vitest';
import { buildBracketLegs, validateBracketPrices } from '../routes/advanced-orders.routes.js';

describe('P1.1 bracket order construction', () => {
  it('creates opposite-side stop and target legs for a BUY', () => {
    const legs = buildBracketLegs({
      symbol: 'NIFTY FUT', token: '123', segment: 'NFO', side: 'BUY', qty: 65,
      price: 24000, productType: 'BO', orderType: 'LIMIT', targetPrice: 24100,
      stoplossPrice: 23900, groupId: 'group-1', entryId: 'entry-1',
    });
    expect(legs).toMatchObject([
      { side: 'SELL', orderType: 'SL-M', triggerPrice: 23900, parentOrderId: 'entry-1' },
      { side: 'SELL', orderType: 'LIMIT', price: 24100, parentOrderId: 'entry-1' },
    ]);
    expect(legs.every((leg) => leg.orderGroupId === 'group-1' && leg.orderGroupType === 'bracket')).toBe(true);
  });

  it('creates opposite-side stop and target legs for a SELL', () => {
    const legs = buildBracketLegs({ side: 'SELL', qty: 500, targetPrice: 2300, stoplossPrice: 2500, groupId: 'g', entryId: 'e' });
    expect(legs.map((leg) => leg.side)).toEqual(['BUY', 'BUY']);
  });

  it('rejects incomplete or directionally invalid protection prices', () => {
    expect(validateBracketPrices({ side: 'BUY', price: 24000, targetPrice: 0, stoplossPrice: 23900 })).toMatch(/both/i);
    expect(validateBracketPrices({ side: 'BUY', price: 24000, targetPrice: 23900, stoplossPrice: 24100 })).toMatch(/BUY/i);
    expect(validateBracketPrices({ side: 'SELL', price: 24000, targetPrice: 24100, stoplossPrice: 23900 })).toMatch(/SELL/i);
  });
});