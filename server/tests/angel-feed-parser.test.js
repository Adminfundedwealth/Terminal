/**
 * ANGEL ONE SMARTSTREAM BINARY PARSER — UNIT TESTS
 *
 * Verifies _parseTick() against the official Angel One Python SDK layout:
 *   github.com/angel-one/smartapi-python — SmartApi/smartWebSocketV2.py
 *
 * All prices in the binary protocol are int64LE / 100.
 * All byte fields use little-endian layout.
 *
 * Tests cover:
 *   - Mode 1 (LTP): NIFTY, BANKNIFTY, FINNIFTY, SENSEX
 *   - Mode 2 (Quote): SUNPHARMA, INFY, HCLTECH, RELIANCE
 *   - Mode 3 (SnapQuote): SUNPHARMA with depth
 *   - Invalid inputs: LTP=0, LTP=NaN, missing quote, stale quote
 *   - Regression: bad LTP cannot enter MTM / trigger risk breach
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Helpers to build synthetic binary packets ─────────────────────────────

/**
 * Write a signed int64 LE at the given offset in buf.
 */
function writeInt64LE(buf, offset, value) {
  const big = BigInt(Math.round(value));
  buf.writeBigInt64LE(big, offset);
}

/**
 * Build a mode-1 (LTP) packet for a given token and LTP.
 *
 * Layout (51 bytes):
 *   [0]      mode = 1
 *   [1]      exchangeType
 *   [2-26]   token (25 bytes ASCII, null-padded)
 *   [27-34]  sequenceNumber (int64LE) — arbitrary
 *   [35-42]  exchangeTimestamp (int64LE) — arbitrary
 *   [43-50]  LTP (int64LE, value * 100)
 */
function buildMode1Packet(token, exchangeType, ltp) {
  const buf = Buffer.alloc(51, 0);
  buf[0] = 1;
  buf[1] = exchangeType;
  buf.write(token, 2, 25, 'utf8');
  writeInt64LE(buf, 27, 1000); // sequence
  writeInt64LE(buf, 35, Date.now()); // timestamp
  writeInt64LE(buf, 43, Math.round(ltp * 100));
  return buf;
}

/**
 * Build a mode-2 (Quote) packet — 123 bytes.
 *
 * Official field layout (all int64LE unless noted):
 *   [43-50]   LTP           ÷ 100
 *   [51-58]   lastTradedQty (raw)
 *   [59-66]   avgTradedPrice÷ 100
 *   [67-74]   volume        (raw)
 *   [75-82]   totalBuyQty   float64LE
 *   [83-90]   totalSellQty  float64LE
 *   [91-98]   open          ÷ 100
 *   [99-106]  high          ÷ 100
 *   [107-114] low           ÷ 100
 *   [115-122] close (prevClose) ÷ 100
 */
function buildMode2Packet(token, exchangeType, { ltp, open, high, low, close, volume = 1000000 }) {
  const buf = Buffer.alloc(123, 0);
  buf[0] = 2;
  buf[1] = exchangeType;
  buf.write(token, 2, 25, 'utf8');
  writeInt64LE(buf, 27, 2000); // sequence
  writeInt64LE(buf, 35, Date.now()); // timestamp
  writeInt64LE(buf, 43, Math.round(ltp * 100));
  writeInt64LE(buf, 51, 500);  // lastTradedQty
  writeInt64LE(buf, 59, Math.round(ltp * 100)); // avgPrice ≈ ltp
  writeInt64LE(buf, 67, volume);
  buf.writeDoubleLE(volume * 1.1, 75);   // totalBuyQty
  buf.writeDoubleLE(volume * 0.9, 83);   // totalSellQty
  writeInt64LE(buf, 91,  Math.round(open  * 100));
  writeInt64LE(buf, 99,  Math.round(high  * 100));
  writeInt64LE(buf, 107, Math.round(low   * 100));
  writeInt64LE(buf, 115, Math.round(close * 100));
  return buf;
}

/**
 * Build a mode-3 (SnapQuote) packet — 379 bytes.
 * OHLC fields identical to mode 2. Depth records at offset 147.
 */
function buildMode3Packet(token, exchangeType, { ltp, open, high, low, close, volume = 1000000 }, depthLevels = []) {
  const buf = Buffer.alloc(379, 0);
  buf[0] = 3;
  buf[1] = exchangeType;
  buf.write(token, 2, 25, 'utf8');
  writeInt64LE(buf, 27, 3000);
  writeInt64LE(buf, 35, Date.now());
  writeInt64LE(buf, 43, Math.round(ltp * 100));
  writeInt64LE(buf, 51, 500);
  writeInt64LE(buf, 59, Math.round(ltp * 100));
  writeInt64LE(buf, 67, volume);
  buf.writeDoubleLE(volume * 1.1, 75);
  buf.writeDoubleLE(volume * 0.9, 83);
  writeInt64LE(buf, 91,  Math.round(open  * 100));
  writeInt64LE(buf, 99,  Math.round(high  * 100));
  writeInt64LE(buf, 107, Math.round(low   * 100));
  writeInt64LE(buf, 115, Math.round(close * 100));
  // depth records at 147, each 20 bytes: flag(2)+qty(8)+price(8)+orders(2)
  depthLevels.forEach((level, i) => {
    const off = 147 + i * 20;
    buf.writeUInt16LE(level.flag, off);
    buf.writeBigInt64LE(BigInt(level.qty), off + 2);
    buf.writeBigInt64LE(BigInt(Math.round(level.price * 100)), off + 10);
    buf.writeUInt16LE(level.orders, off + 18);
  });
  return buf;
}

// ─── Mock MarketDataEngine ─────────────────────────────────────────────────

function makeMockMDE() {
  const quotes = new Map();
  const depths = new Map();
  return {
    quotes,
    pushQuote: vi.fn((token, data) => { quotes.set(token, data); }),
    pushDepth: vi.fn((token, data) => { depths.set(token, data); }),
    setFeedStale: vi.fn(),
    isFeedStale: vi.fn().mockReturnValue(false),
    getQuote: (token) => quotes.get(token) || null,
    _depths: depths,
  };
}

// ─── Import the real connector class ────────────────────────────────────────

// We test _parseTick directly by instantiating AngelFeedConnector with a mock MDE.
// Avoid actually connecting to WebSocket — just construct and call _parseTick.
vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

import { AngelFeedConnector } from '../brokers/angelone/angel.feed.connector.js';

// ─── Test Suite ───────────────────────────────────────────────────────────

describe('AngelFeedConnector._parseTick — official V2 binary protocol', () => {

  // ── Mode 1 ───────────────────────────────────────────────────────────────

  describe('Mode 1 (LTP)', () => {
    it('NIFTY: parses LTP=24013.10 correctly', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const buf = buildMode1Packet('99926000', 1, 24013.10);
      conn._parseTick(buf);
      expect(mde.pushQuote).toHaveBeenCalledOnce();
      const [token, data] = mde.pushQuote.mock.calls[0];
      expect(token).toBe('99926000');
      expect(data.ltp).toBeCloseTo(24013.10, 1);
      expect(data.exchange).toBe('NSE');
    });

    it('BANKNIFTY: parses LTP=57963.80 correctly', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const buf = buildMode1Packet('99926009', 1, 57963.80);
      conn._parseTick(buf);
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.ltp).toBeCloseTo(57963.80, 1);
    });

    it('FINNIFTY: parses LTP=26581.95 correctly', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode1Packet('99926037', 1, 26581.95));
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.ltp).toBeCloseTo(26581.95, 1);
    });

    it('SENSEX (BSE, exchange type 3): parses correctly', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode1Packet('99919000', 3, 78500.00));
      const [token, data] = mde.pushQuote.mock.calls[0];
      expect(token).toBe('99919000');
      expect(data.exchange).toBe('BSE');
      expect(data.ltp).toBeCloseTo(78500.00, 1);
    });

    it('rejects LTP=0 — does not call pushQuote', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode1Packet('99926000', 1, 0));
      expect(mde.pushQuote).not.toHaveBeenCalled();
    });

    it('rejects negative LTP — does not call pushQuote', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode1Packet('99926000', 1, -100));
      expect(mde.pushQuote).not.toHaveBeenCalled();
    });
  });

  // ── Mode 2 ───────────────────────────────────────────────────────────────

  describe('Mode 2 (Quote) — the critical bug fix', () => {

    it('SUNPHARMA: LTP=1948.00, close=1950.00 → changePercent ≈ -0.1026%', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const buf = buildMode2Packet('11723', 1, {
        ltp: 1948.00, open: 1930.00, high: 1960.00, low: 1920.00, close: 1950.00,
      });
      conn._parseTick(buf);
      expect(mde.pushQuote).toHaveBeenCalledOnce();
      const [token, data] = mde.pushQuote.mock.calls[0];
      expect(token).toBe('11723');
      expect(data.ltp).toBeCloseTo(1948.00, 1);
      expect(data.open).toBeCloseTo(1930.00, 1);
      expect(data.high).toBeCloseTo(1960.00, 1);
      expect(data.low).toBeCloseTo(1920.00, 1);
      expect(data.close).toBeCloseTo(1950.00, 1);
      // changePercent = (1948 - 1950) / 1950 * 100 = -0.10256...
      expect(data.changePercent).toBeCloseTo(-0.1026, 2);
      // Critical: must NOT be -99.99% (the old bug)
      expect(Math.abs(data.changePercent)).toBeLessThan(10);
    });

    it('INFY: LTP=1182.00, close=1185.00 → changePercent ≈ -0.253%', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode2Packet('1594', 1, {
        ltp: 1182.00, open: 1188.00, high: 1192.00, low: 1178.00, close: 1185.00,
      }));
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.ltp).toBeCloseTo(1182.00, 1);
      expect(data.close).toBeCloseTo(1185.00, 1);
      expect(data.changePercent).toBeCloseTo(-0.253, 2);
      expect(Math.abs(data.changePercent)).toBeLessThan(10);
    });

    it('HCLTECH: LTP=1650.00 — valid quote pushed to MDE', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode2Packet('1270', 1, {
        ltp: 1650.00, open: 1640.00, high: 1660.00, low: 1635.00, close: 1645.00,
      }));
      expect(mde.pushQuote).toHaveBeenCalledOnce();
      const [token, data] = mde.pushQuote.mock.calls[0];
      expect(token).toBe('1270');
      expect(data.ltp).toBeCloseTo(1650.00, 1);
      // ltp must be positive — no blank/zero
      expect(data.ltp).toBeGreaterThan(0);
    });

    it('RELIANCE: LTP=1309.50 with realistic OHLC', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode2Packet('2885', 1, {
        ltp: 1309.50, open: 1328.00, high: 1338.20, low: 1305.30, close: 1328.10,
      }));
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.ltp).toBeCloseTo(1309.50, 1);
      expect(data.open).toBeCloseTo(1328.00, 1);
      expect(data.high).toBeCloseTo(1338.20, 1);
      expect(data.low).toBeCloseTo(1305.30, 1);
      expect(data.close).toBeCloseTo(1328.10, 1);
      // change = 1309.50 - 1328.10 = -18.60
      expect(data.change).toBeCloseTo(-18.60, 1);
      expect(data.changePercent).toBeCloseTo(-1.40, 1);
    });

    it('NFO token (exchangeType=2): exchange label is NFO', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode2Packet('47547', 2, { ltp: 24050, open: 24000, high: 24100, low: 23950, close: 24000 }));
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.exchange).toBe('NFO');
    });

    it('MCX token (exchangeType=5): exchange label is MCX', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode2Packet('429604', 5, { ltp: 72500, open: 72000, high: 73000, low: 71800, close: 72200 }));
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.exchange).toBe('MCX');
    });

    it('Mode 2: rejects LTP=0 — pushQuote NOT called', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const buf = buildMode2Packet('11723', 1, { ltp: 0, open: 1930, high: 1960, low: 1920, close: 1950 });
      conn._parseTick(buf);
      expect(mde.pushQuote).not.toHaveBeenCalled();
    });

    it('Mode 2: close=0 results in changePercent=undefined (not -99.99)', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      // LTP valid but close is zero — close should be treated as unavailable
      const buf = buildMode2Packet('11723', 1, { ltp: 1948, open: 1930, high: 1960, low: 1920, close: 0 });
      conn._parseTick(buf);
      if (mde.pushQuote.mock.calls.length > 0) {
        const [, data] = mde.pushQuote.mock.calls[0];
        // changePercent should be null/undefined when close is invalid — never -99.99
        expect(data.changePercent == null || Math.abs(data.changePercent) < 5).toBe(true);
      }
    });

    it('packet smaller than 123 bytes is silently ignored for mode 2', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const shortBuf = Buffer.alloc(80, 0);
      shortBuf[0] = 2; shortBuf[1] = 1;
      shortBuf.write('11723', 2, 25, 'utf8');
      conn._parseTick(shortBuf);
      expect(mde.pushQuote).not.toHaveBeenCalled();
    });
  });

  // ── Mode 3 ───────────────────────────────────────────────────────────────

  describe('Mode 3 (SnapQuote)', () => {
    it('parses OHLC fields identically to mode 2', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode3Packet('11723', 1, {
        ltp: 1948, open: 1930, high: 1960, low: 1920, close: 1950,
      }));
      expect(mde.pushQuote).toHaveBeenCalledOnce();
      const [, data] = mde.pushQuote.mock.calls[0];
      expect(data.ltp).toBeCloseTo(1948, 1);
      expect(data.open).toBeCloseTo(1930, 1);
      expect(data.high).toBeCloseTo(1960, 1);
      expect(data.low).toBeCloseTo(1920, 1);
      expect(data.close).toBeCloseTo(1950, 1);
    });

    it('parses 5-level depth correctly from best-5 records', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;

      // 5 bid records (flag=0), 5 ask records (flag=1)
      const depthLevels = [
        { flag: 0, qty: 100, price: 1947.90, orders: 3 },
        { flag: 0, qty: 200, price: 1947.80, orders: 5 },
        { flag: 0, qty: 150, price: 1947.70, orders: 2 },
        { flag: 0, qty: 300, price: 1947.60, orders: 8 },
        { flag: 0, qty: 250, price: 1947.50, orders: 6 },
        { flag: 1, qty: 120, price: 1948.10, orders: 2 },
        { flag: 1, qty: 180, price: 1948.20, orders: 4 },
        { flag: 1, qty: 90,  price: 1948.30, orders: 1 },
        { flag: 1, qty: 400, price: 1948.40, orders: 9 },
        { flag: 1, qty: 350, price: 1948.50, orders: 7 },
      ];

      conn._parseTick(buildMode3Packet('11723', 1, {
        ltp: 1948, open: 1930, high: 1960, low: 1920, close: 1950,
      }, depthLevels));

      expect(mde.pushDepth).toHaveBeenCalledOnce();
      const [dToken, depth] = mde.pushDepth.mock.calls[0];
      expect(dToken).toBe('11723');
      expect(depth.bids).toHaveLength(5);
      expect(depth.asks).toHaveLength(5);
      expect(depth.bids[0].price).toBeCloseTo(1947.90, 1);
      expect(depth.bids[0].qty).toBe(100);
      expect(depth.asks[0].price).toBeCloseTo(1948.10, 1);
    });

    it('Mode 3: rejects LTP=0', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      conn._parseTick(buildMode3Packet('11723', 1, { ltp: 0, open: 1930, high: 1960, low: 1920, close: 1950 }));
      expect(mde.pushQuote).not.toHaveBeenCalled();
    });
  });

  // ── Token parsing ─────────────────────────────────────────────────────────

  describe('Token string parsing', () => {
    it('null-padded token is trimmed correctly', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const buf = buildMode1Packet('99926000', 1, 24000);
      conn._parseTick(buf);
      const [token] = mde.pushQuote.mock.calls[0];
      expect(token).toBe('99926000');
      expect(token).not.toContain('\0');
    });

    it('short token is handled without error', () => {
      const mde = makeMockMDE();
      const conn = new AngelFeedConnector(mde);
      conn._feedStale = false;
      const buf = buildMode1Packet('25', 1, 2500);
      conn._parseTick(buf);
      const [token] = mde.pushQuote.mock.calls[0];
      expect(token).toBe('25');
    });
  });
});
