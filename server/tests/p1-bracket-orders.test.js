import { describe, expect, it } from 'vitest';
import { buildBracketLegs, validateBracketPrices, normalizeBracketOrderParams } from '../routes/advanced-orders.routes.js';
import { OrderExecutionService } from '../services/orderExecutionService.js';

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

  it('keeps the route-level legacy leg builder directionally correct', () => {
    const legs = buildBracketLegs({ side: 'SELL', qty: 65, targetPrice: 23900, stoplossPrice: 24100, groupId: 'g', entryId: 'e' });
    expect(legs[0]).toMatchObject({ side: 'BUY', orderType: 'SL-M', triggerPrice: 24100 });
    expect(legs[1]).toMatchObject({ side: 'BUY', orderType: 'LIMIT', price: 23900 });
  });

  it('requires both protection prices before an entry can be bracketed', () => {
    expect(validateBracketPrices({ side: 'BUY', price: 24000, targetPrice: 24100, stoplossPrice: 0 })).toContain('both');
  });

  it('normalizes a bracket order into the canonical execution payload', () => {
    const payload = normalizeBracketOrderParams({
      symbol: 'NIFTY FUT',
      token: '123',
      segment: 'NFO',
      side: 'BUY',
      qty: 65,
      orderType: 'LIMIT',
      productType: 'MIS',
      price: 24000,
      targetPrice: 24150,
      stoplossPrice: 23900,
      validity: 'DAY',
      isAmo: false,
    });

    expect(payload).toMatchObject({
      symbol: 'NIFTY FUT',
      side: 'BUY',
      orderType: 'LIMIT',
      productType: 'BO',
      qty: 65,
      price: 24000,
      targetPrice: 24150,
      stoplossPrice: 23900,
      orderGroupType: 'bracket',
    });
    expect(payload.orderGroupId).toBeTruthy();
  });

  it('keeps sell-side bracket pricing directionally valid', () => {
    const payload = normalizeBracketOrderParams({
      symbol: 'BANKNIFTY FUT',
      token: '456',
      segment: 'NFO',
      side: 'SELL',
      qty: 25,
      orderType: 'LIMIT',
      productType: 'MIS',
      price: 50000,
      targetPrice: 49500,
      stoplossPrice: 50500,
    });

    expect(validateBracketPrices({
      side: payload.side,
      price: payload.price,
      targetPrice: payload.targetPrice,
      stoplossPrice: payload.stoplossPrice,
    })).toBeNull();
    expect(payload.productType).toBe('BO');
    expect(payload.orderGroupType).toBe('bracket');
  });

  it('attaches both protections as one bracket lifecycle after a fill', async () => {
    const calls = [];
    const service = {
      attachStopLoss: async (...args) => calls.push(['SL', ...args]),
      attachTakeProfit: async (...args) => calls.push(['TP', ...args]),
    };
    const position = { id: 'position-1', is_open: true, qty: 65 };
    await OrderExecutionService.prototype._attachBracketProtection.call(service, 'account-1', position, {
      stoplossPrice: 23900,
      targetPrice: 24100,
      orderGroupId: 'group-1',
      _brokerProvider: 'angel',
    }, 'entry-1');
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([
      ['SL', 'account-1', 'position-1', 23900, expect.objectContaining({ entryOrderId: 'entry-1', orderGroupId: 'group-1' })],
      ['TP', 'account-1', 'position-1', 24100, expect.objectContaining({ entryOrderId: 'entry-1', orderGroupId: 'group-1' })],
    ]));
  });
});