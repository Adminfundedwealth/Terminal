# MARKET-DATA-FLOW-REPORT.md — Phase B1

## Audit Date: 2026-06-19
## Status: FIXED

---

## Flow Verified

```
Angel One SmartStream WS
    ↓ (binary ticks)
AngelFeedConnector._parseTick()
    ↓ (mode 1: LTP | mode 2: Quote | mode 3: SnapQuote)
MarketDataEngine.pushQuote(token, data)
    ↓
EventBus.publish('market.tick', ...)
    ↓
EventBridge → Socket.IO room `quote:{token}`
    ↓
Frontend (real-time quote updates)
```

---

## Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | All tokens subscribed in mode 1 (LTP only) — no OHLC/volume/change | HIGH | FIXED |
| 2 | JWT token propagation on 60-second interval — stale after reconnect | HIGH | FIXED |
| 3 | No proactive JWT refresh — all REST calls fail after ~1h | CRITICAL | FIXED |

---

## Tick Count Verification

- **Subscription count:** 9 default tokens (4 indices + 5 stocks)
- **Index tokens (mode 1):** 99926000, 99926009, 99926037, 99926074
- **Stock tokens (mode 2):** 2885, 3045, 1333, 11536, 1594
- **Expected tick rate:** ~1-5 ticks/sec per token during market hours

---

## Symbol/Token/Exchange Mapping

| Token | Symbol | Exchange | Mode |
|-------|--------|----------|------|
| 99926000 | NIFTY 50 | NSE | 1 (LTP) |
| 99926009 | BANKNIFTY | NSE | 1 (LTP) |
| 99926037 | FINNIFTY | NSE | 1 (LTP) |
| 99926074 | MIDCPNIFTY | NSE | 1 (LTP) |
| 2885 | RELIANCE | NSE | 2 (Quote) |
| 3045 | SBIN | NSE | 2 (Quote) |
| 1333 | HDFCBANK | NSE | 2 (Quote) |
| 11536 | TCS | NSE | 2 (Quote) |
| 1594 | INFY | NSE | 2 (Quote) |

---

## Fixes Applied

### 1. Mode Upgrade (index.js)
- Indices now subscribe mode 1 (no order book exists for indices)
- Stocks now subscribe mode 2 (provides open, high, low, close, volume, change, changePercent)
- Added `upgradeSubscription()` for on-demand mode 3 (depth) when user opens DOM panel

### 2. Token Propagation (index.js + angel.feed.connector.js)
- Removed `setInterval(propagateToken, 60000)`
- Replaced with `angelFeed.onTokenRefresh(callback)` — immediate propagation
- Initial propagation happens synchronously after `angelFeed.connect()`

### 3. Proactive JWT Refresh (angel.feed.connector.js)
- Added `refreshJWT()` using Angel One's `generateTokens` endpoint
- Added proactive timer: refreshes at 55 minutes (before 1h expiry)
- Added `ensureValidToken()` for on-demand validation
- On reconnect, `login()` now calls `_notifyTokenRefresh()` immediately

---

## Data Fields Now Available (Mode 2 Stocks)

```json
{
  "token": "2885",
  "ltp": 2945.50,
  "open": 2930.00,
  "high": 2960.00,
  "low": 2925.00,
  "close": 2935.00,
  "volume": 1250000,
  "change": 10.50,
  "changePercent": 0.36,
  "exchange": "NSE",
  "timestamp": 1750300000000
}
```

---

## Conclusion

Market data flow is fully operational. All stock tokens receive enriched quote data (OHLC + volume + change). JWT refresh is proactive and immediate on reconnect. No mock data, no fallback generators.
