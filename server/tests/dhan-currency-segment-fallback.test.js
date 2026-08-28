import { describe, expect, it, vi } from 'vitest';

const axiosRequest = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post: axiosRequest } }));

import { DhanAdapter } from '../brokers/dhan/dhan.adapter.js';

describe('Dhan currency LTP segment fallback', () => {
  it('retries an empty NSE_CURRENCY response with CUR', async () => {
    const adapter = new DhanAdapter();
    adapter.auth = { clientId: 'client-1', isTokenValid: true, getHeaders: () => ({}) };
    axiosRequest
      .mockResolvedValueOnce({ data: { NSE_CURRENCY: {} } })
      .mockResolvedValueOnce({ data: { CUR: { '1196': { last_price: 83.25 } } } });

    const quotes = await adapter.getQuotes([{ token: '1196', segment: 'NSE_CURRENCY' }]);

    expect(quotes).toEqual([{ token: '1196', ltp: 83.25, volume: 0, oi: 0 }]);
    expect(axiosRequest).toHaveBeenNthCalledWith(1, expect.any(String), { NSE_CURRENCY: [1196] }, expect.any(Object));
    expect(axiosRequest).toHaveBeenNthCalledWith(2, expect.any(String), { CUR: [1196] }, expect.any(Object));
  });
});