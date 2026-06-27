# MARKET-DEPTH-FIX-REPORT.md — Phase B3

## Audit Date: 2026-06-19
## Status: FIXED

---

## Flow Verified

```
Two sources of depth data:

SOURCE 1 — REST API (on-demand polling):
Frontend → GET /api/market/depth?token=2885&exchange=NSE
    ↓
DepthService.getDepth(token, exchange)
    ↓ POST /rest/secure/angelbroking/market/v1/quote/ (mode: FULL)
Angel One REST API
    ↓ returns depth.buy[], depth.sell[]
DepthService → MarketDataEngine.pushDepth() → Socket.IO room `depth:{token}`

SOURCE 2 — SmartStream mode 3 (real-time, on-demand):
AngelFeedConnector (mode 3 subscription)
    ↓ 379-byte SnapQuote binary packet
    ↓ _parseTick() extracts 5-level depth at offset 87
MarketDataEngine.pushDepth(token, { bids, asks })
    ↓
Socket.IO → Frontend (live depth updates)
```

---

## Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | All tokens subscribed mode 1 — SmartStream never sends depth packets | CRITICAL | FIXED |
| 2 | DepthService REST call fails silently on JWT expiry (403) | HIGH | FIXED |
| 3 | No on-demand mode upgrade for depth (must restart to get mode 3) | MEDIUM | FIXED |

---

## Root Cause

SmartStream binary packets are mode-dependent:
- **Mode 1 (51 bytes):** LTP only — no depth data
- **Mode 2 (123 bytes):** Quote — OHLC/volume but no depth
- **Mode 3 (379 bytes):** SnapQuote — includes full 5-level bid/ask depth

The server was subscribing ALL tokens at mode 1, so `_parseTick()` never reached the depth parsing branch (requires `mode === 3 && buffer.length >= 379`).

---

## Fixes Applied

### 1. Mode 2 Default for Stocks (index.js)
Stock tokens now subscribe at mode 2 (Quote). This provides OHLC/volume but not depth via feed. Depth is served via REST polling through DepthService.

### 2. On-Demand Mode 3 Upgrade (angel.feed.connector.js)
```javascript
// New method for upgrading specific tokens to SnapQuote mode
upgradeSubscription(tokens, newMode) {
  this.unsubscribe(tokens);
  this.subscribe(tokens, newMode);
}
```
When a user opens the market depth panel for a specific token, the frontend can request mode 3 subscription for real-time depth streaming.

### 3. 403 Retry in DepthService (depthService.js)
```javascript
// On 403: refresh token via callback and retry
if (err.response?.status === 403 && this._refreshCallback) {
  this.jwtToken = await this._refreshCallback();
  resp = await makeRequest(); // retry
}
```

---

## Depth Data Format (5-Level)

```json
{
  "token": "2885",
  "bids": [
    { "price": 2944.50, "qty": 150, "orders": 3 },
    { "price": 2944.00, "qty": 200, "orders": 5 },
    { "price": 2943.50, "qty": 80, "orders": 2 },
    { "price": 2943.00, "qty": 320, "orders": 8 },
    { "price": 2942.50, "qty": 100, "orders": 4 }
  ],
  "asks": [
    { "price": 2945.00, "qty": 120, "orders": 4 },
    { "price": 2945.50, "qty": 250, "orders": 6 },
    { "price": 2946.00, "qty": 90, "orders": 3 },
    { "price": 2946.50, "qty": 180, "orders": 5 },
    { "price": 2947.00, "qty": 400, "orders": 10 }
  ],
  "totalBuyQty": 850,
  "totalSellQty": 1040
}
```

---

## Index Token Behavior (Correct — No Change)

Index tokens (NIFTY, BANKNIFTY, etc.) have NO order book on the exchange. Depth queries for index tokens correctly return:
```json
{ "bids": [], "asks": [], "totalBuyQty": 0, "totalSellQty": 0 }
```
This is expected behavior and not a bug.

---

## WebSocket Depth Subscription

Clients subscribe to depth via Socket.IO:
```javascript
socket.emit('subscribe_depth', { tokens: ['2885'] });
// Receives: socket.on('depth', { token, data: { bids, asks, ... } })
```

The `RealtimeServer._setupMarketDataBridge()` intercepts `MarketDataEngine.pushDepth()` and emits to the `depth:{token}` room.

---

## Conclusion

Market depth now works through two channels:
1. REST polling via DepthService (with 403 retry) — immediate on panel open
2. SmartStream mode 3 (on-demand upgrade) — real-time streaming for active tokens

No mock depth data. All data from Angel One exchange order book.
