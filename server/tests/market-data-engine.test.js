import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketDataEngine } from '../services/marketDataEngine.js';

describe('MarketDataEngine legacy contract polling', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves legacy MCX and CDS tokens before requesting Dhan quotes', async () => {
    vi.useFakeTimers();
    const getActiveContract = vi.fn((symbol, segment) => ({
      GOLD: segment === 'MCX_COMM' ? '9001' : null,
      USDINR: segment === 'NSE_CURRENCY' ? '9002' : null,
    }[symbol]));
    const getQuotes = vi.fn(async instruments => instruments.map(instrument => ({
      token: instrument.token,
      ltp: instrument.token === '9001' ? 72500 : 83.25,
    })));
    const engine = new MarketDataEngine();
    engine._dhanAdapter = {
      auth: { isTokenValid: true },
      historical: { getActiveContract },
      getQuotes,
    };
    engine.subscribe('429604', () => {});
    engine.subscribe('11091', () => {});
    engine._startDhanLtpPoller();

    await vi.advanceTimersByTimeAsync(3000);

    expect(getActiveContract).toHaveBeenCalledWith('GOLD', 'MCX_COMM');
    expect(getActiveContract).toHaveBeenCalledWith('USDINR', 'NSE_CURRENCY');
    expect(getQuotes).toHaveBeenNthCalledWith(1, [{ token: '9001', segment: 'MCX_COMM' }]);
    expect(getQuotes).toHaveBeenNthCalledWith(2, [{ token: '9002', segment: 'NSE_CURRENCY' }]);
    expect(engine.getQuote('429604')).toMatchObject({ ltp: 72500, securityId: '9001', segment: 'MCX_COMM' });
    expect(engine.getQuote('11091')).toMatchObject({ ltp: 83.25, securityId: '9002', segment: 'NSE_CURRENCY' });
    clearInterval(engine._dhanPollerInterval);
  });
});
