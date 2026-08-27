/**
 * DHAN OPTION CHAIN PARSER TESTS (P5.3)
 *
 * Verifies that _parseOCMap reads the CORRECT Dhan v2 depth fields
 * (top_bid_price / top_ask_price / top_bid_quantity / top_ask_quantity /
 * previous_close_price) — the earlier code read non-existent `bid`/`ask` keys,
 * so bid/ask were always 0.
 *
 * Pure parse — the service is constructed with a minimal auth stub and we call
 * the parser directly (no network).
 */

import { describe, it, expect } from 'vitest';
import { DhanOptionChainService } from '../brokers/dhan/dhan.optionchain.js';

function makeService() {
  // Minimal auth stub — parser methods don't touch it.
  const auth = { isTokenValid: true, getHeaders: () => ({}), refreshToken: async () => true };
  return new DhanOptionChainService(auth);
}

describe('DhanOptionChainService._parseOCMap — P5.3 bid/ask/qty/prevclose', () => {
  it('reads top_bid_price/top_ask_price + quantities + previous_close_price', () => {
    const svc = makeService();
    const data = {
      oc: {
        '24000.000000': {
          ce: {
            security_id: '111', last_price: 120, oi: 5000, previous_oi: 4000,
            volume: 200, implied_volatility: 15.5, previous_close_price: 100,
            top_bid_price: 119.5, top_ask_price: 120.5,
            top_bid_quantity: 750, top_ask_quantity: 900,
            greeks: { delta: 0.55, gamma: 0.001, theta: -2.1, vega: 3.2 },
          },
          pe: {
            security_id: '112', last_price: 80, oi: 6000, previous_oi: 6500,
            volume: 150, implied_volatility: 14.2, previous_close_price: 90,
            top_bid_price: 79.5, top_ask_price: 81.0,
            top_bid_quantity: 300, top_ask_quantity: 450,
            greeks: { delta: -0.45, gamma: 0.001, theta: -1.8, vega: 3.0 },
          },
        },
      },
    };

    const chain = svc._parseOCMap(data);
    expect(chain).toHaveLength(1);
    const row = chain[0];

    expect(row.strike).toBe(24000);
    // Call bid/ask/qty/prevclose
    expect(row.callBidPrice).toBe(119.5);
    expect(row.callAskPrice).toBe(120.5);
    expect(row.callBidQty).toBe(750);
    expect(row.callAskQty).toBe(900);
    expect(row.callPrevClose).toBe(100);
    // Put bid/ask/qty/prevclose
    expect(row.putBidPrice).toBe(79.5);
    expect(row.putAskPrice).toBe(81.0);
    expect(row.putBidQty).toBe(300);
    expect(row.putAskQty).toBe(450);
    expect(row.putPrevClose).toBe(90);
    // Existing fields still intact
    expect(row.callLtp).toBe(120);
    expect(row.callOiChange).toBe(1000);  // 5000 - 4000
    expect(row.putOiChange).toBe(-500);   // 6000 - 6500
    expect(row.callDelta).toBe(0.55);
  });

  it('missing depth fields default to 0 (never NaN)', () => {
    const svc = makeService();
    const data = {
      oc: {
        '100.000000': {
          ce: { security_id: '1', last_price: 5 },
          pe: { security_id: '2', last_price: 6 },
        },
      },
    };
    const [row] = svc._parseOCMap(data);
    expect(row.callBidPrice).toBe(0);
    expect(row.callAskPrice).toBe(0);
    expect(row.callBidQty).toBe(0);
    expect(row.callAskQty).toBe(0);
    expect(row.callPrevClose).toBe(0);
    expect(Number.isNaN(row.callBidPrice)).toBe(false);
    expect(Number.isNaN(row.callBidQty)).toBe(false);
  });
});
