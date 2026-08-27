/**
 * OPTION CHAIN NORMALIZER TESTS (P5.3)
 *
 * Covers the trader-facing market-data derivations added in P5.3:
 *   - price change / change %
 *   - bid/ask spread (safe: never negative, never fabricated)
 *   - full entry enrichment (call + put), edge cases, universality
 *
 * Pure functions — no DB, no network. Runs offline in the node env.
 */

import { describe, it, expect } from 'vitest';
import {
  computeChange,
  computeSpread,
  enrichOptionChainEntry,
} from '../services/optionChainNormalizer.js';

// ─── DATA NORMALIZATION: change / change% ───────────────────────────────────
describe('computeChange', () => {
  it('1/7. positive change + change% from ltp and prev close', () => {
    const r = computeChange(110, 100);
    expect(r.change).toBe(10);
    expect(r.changePercent).toBe(10);
    expect(r.hasChange).toBe(true);
  });

  it('8. negative change is signed correctly', () => {
    const r = computeChange(90, 100);
    expect(r.change).toBe(-10);
    expect(r.changePercent).toBe(-10);
    expect(r.hasChange).toBe(true);
  });

  it('rounds to 2 decimals', () => {
    const r = computeChange(101.239, 100);
    expect(r.change).toBe(1.24);
    expect(r.changePercent).toBe(1.24);
  });

  it('unavailable when prevClose <= 0', () => {
    const r = computeChange(110, 0);
    expect(r.hasChange).toBe(false);
    expect(r.change).toBe(0);
    expect(r.changePercent).toBe(0);
  });

  it('unavailable when ltp <= 0 (illiquid / market closed with no LTP)', () => {
    const r = computeChange(0, 100);
    expect(r.hasChange).toBe(false);
  });
});

// ─── DATA NORMALIZATION: spread ─────────────────────────────────────────────
describe('computeSpread', () => {
  it('6. spread = ask - bid when both positive', () => {
    const r = computeSpread(100, 102);
    expect(r.spread).toBe(2);
    expect(r.hasSpread).toBe(true);
  });

  it('11. zero bid → unavailable', () => {
    const r = computeSpread(0, 102);
    expect(r.hasSpread).toBe(false);
    expect(r.spread).toBe(0);
  });

  it('12. zero ask → unavailable', () => {
    const r = computeSpread(100, 0);
    expect(r.hasSpread).toBe(false);
  });

  it('15. crossed book (ask < bid) → unavailable, never negative', () => {
    const r = computeSpread(105, 100);
    expect(r.hasSpread).toBe(false);
    expect(r.spread).toBe(0);
  });

  it('equal bid/ask → spread 0 but available', () => {
    const r = computeSpread(100, 100);
    expect(r.spread).toBe(0);
    expect(r.hasSpread).toBe(true);
  });

  it('rounds spread to 2 decimals', () => {
    const r = computeSpread(100.111, 102.339);
    expect(r.spread).toBe(2.23);
  });
});

// ─── ENTRY ENRICHMENT (call + put) ──────────────────────────────────────────
describe('enrichOptionChainEntry', () => {
  it('2/3/4/5. maps bid/ask/qty and derives change + spread for CALL and PUT', () => {
    const e = enrichOptionChainEntry({
      strike: 24000,
      callLtp: 120, callPrevClose: 100,
      callBidPrice: 119, callAskPrice: 121, callBidQty: 500, callAskQty: 750,
      putLtp: 80, putPrevClose: 100,
      putBidPrice: 79, putAskPrice: 82, putBidQty: 300, putAskQty: 450,
    });
    // Call
    expect(e.callBidPrice).toBe(119);
    expect(e.callAskPrice).toBe(121);
    expect(e.callBidQty).toBe(500);
    expect(e.callAskQty).toBe(750);
    expect(e.callChange).toBe(20);
    expect(e.callChangePct).toBe(20);
    expect(e.callHasChange).toBe(true);
    expect(e.callSpread).toBe(2);
    expect(e.callHasSpread).toBe(true);
    // Put
    expect(e.putChange).toBe(-20);
    expect(e.putChangePct).toBe(-20);
    expect(e.putSpread).toBe(3);
    expect(e.putHasSpread).toBe(true);
  });

  it('9/10. missing bid or missing ask → hasSpread false', () => {
    const e = enrichOptionChainEntry({
      strike: 100,
      callLtp: 10, callPrevClose: 9, callBidPrice: 0, callAskPrice: 11,
      putLtp: 10, putPrevClose: 9, putBidPrice: 9, putAskPrice: 0,
    });
    expect(e.callHasSpread).toBe(false);
    expect(e.putHasSpread).toBe(false);
  });

  it('13. illiquid contract (all zeros) → everything unavailable, no NaN', () => {
    const e = enrichOptionChainEntry({
      strike: 100,
      callLtp: 0, callPrevClose: 0, callBidPrice: 0, callAskPrice: 0,
      putLtp: 0, putPrevClose: 0, putBidPrice: 0, putAskPrice: 0,
    });
    expect(e.callHasChange).toBe(false);
    expect(e.callHasSpread).toBe(false);
    expect(e.putHasChange).toBe(false);
    expect(e.putHasSpread).toBe(false);
    expect(Number.isNaN(e.callChange)).toBe(false);
    expect(Number.isNaN(e.callChangePct)).toBe(false);
    expect(e.callChange).toBe(0);
    expect(e.callSpread).toBe(0);
  });

  it('14. market closed (ltp present, no prevClose) → change unavailable but spread still works', () => {
    const e = enrichOptionChainEntry({
      strike: 100,
      callLtp: 50, callPrevClose: 0, callBidPrice: 49, callAskPrice: 51,
      putLtp: 50, putPrevClose: 0, putBidPrice: 49, putAskPrice: 51,
    });
    expect(e.callHasChange).toBe(false);
    expect(e.callHasSpread).toBe(true);
    expect(e.callSpread).toBe(2);
  });

  it('coerces undefined fields to 0 without throwing', () => {
    const e = enrichOptionChainEntry({ strike: 100, callLtp: 10, putLtp: 10 });
    expect(e.callBidPrice).toBe(0);
    expect(e.callAskQty).toBe(0);
    expect(e.callHasChange).toBe(false);
    expect(e.callHasSpread).toBe(false);
  });

  it('returns the same object reference (mutates in place)', () => {
    const input = { strike: 100, callLtp: 10, putLtp: 10 };
    const out = enrichOptionChainEntry(input);
    expect(out).toBe(input);
  });
});

// ─── UNIVERSALITY: same normalization for every underlying / segment ─────────
describe('universality — normalization is underlying-agnostic', () => {
  // The normalizer operates purely on numeric fields, so it behaves identically
  // for NIFTY (NFO), BANKNIFTY (NFO), SENSEX (BFO), and stock options.
  // These cases assert the SAME derivation regardless of the values' scale.
  const cases = [
    { name: '18. NIFTY-scale', ltp: 120.5, prev: 118.0, bid: 120, ask: 121 },
    { name: '19. BANKNIFTY-scale', ltp: 350.75, prev: 360.0, bid: 350, ask: 352 },
    { name: '20. SENSEX-scale (BFO)', ltp: 640.0, prev: 600.0, bid: 639, ask: 642 },
    { name: '21. stock option RELIANCE-scale', ltp: 22.45, prev: 20.0, bid: 22, ask: 23 },
    { name: '22. deep OTM low-premium', ltp: 0.65, prev: 0.5, bid: 0.6, ask: 0.7 },
  ];
  for (const c of cases) {
    it(`${c.name}: derives change + spread consistently`, () => {
      const e = enrichOptionChainEntry({
        strike: 1000,
        callLtp: c.ltp, callPrevClose: c.prev, callBidPrice: c.bid, callAskPrice: c.ask,
        putLtp: c.ltp, putPrevClose: c.prev, putBidPrice: c.bid, putAskPrice: c.ask,
      });
      const expectedChange = Math.round((c.ltp - c.prev) * 100) / 100;
      const expectedSpread = Math.round((c.ask - c.bid) * 100) / 100;
      expect(e.callChange).toBe(expectedChange);
      expect(e.callHasChange).toBe(true);
      expect(e.callSpread).toBe(expectedSpread);
      expect(e.callHasSpread).toBe(true);
    });
  }
});
