import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createApiRouter } from '../routes/api.js';

function createApp(dhan) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(
    {}, {}, { getQuote: vi.fn(() => null), getLivePrice: vi.fn(() => null), getStatus: () => ({}) , quotes: new Map() },
    {}, {}, {}, { getDhanAdapter: () => dhan },
  ));
  return app;
}

async function getQuote(app, path) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port, path }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
      });
      request.on('error', reject);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('market quote derivative aliases', () => {
  it.each([
    ['429604', 'GOLD', 'MCX_COMM', '9001', 72500],
    ['11091', 'USDINR', 'NSE_CURRENCY', '9002', 83.25],
  ])('returns the active %s contract LTP from Dhan LTP fallback', async (token, symbol, segment, securityId, ltp) => {
    const dhan = {
      isConnected: true,
      historical: { getActiveContract: vi.fn().mockReturnValue(securityId) },
      getQuote: vi.fn().mockResolvedValue({}),
      getQuotes: vi.fn().mockResolvedValue([{ token: securityId, ltp }]),
    };

    const response = await getQuote(createApp(dhan), `/api/market/quote?token=${token}&exchange=${segment === 'MCX_COMM' ? 'MCX' : 'CDS'}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ token, securityId, ltp, symbol, exchange: segment });
    expect(dhan.historical.getActiveContract).toHaveBeenCalledWith(symbol, segment);
    expect(dhan.getQuotes).toHaveBeenCalledWith([{ token: securityId, segment }]);
  });
});
