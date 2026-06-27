# CHART-FEED-AUDIT.md — Phase B2

## Audit Date: 2026-06-19
## Status: FIXED

---

## Flow Verified

```
Frontend (TradingView Chart)
    ↓ GET /api/tv/history?symbol=RELIANCE&resolution=5&from=...&to=...
API Router (api.js)
    ↓ tvDatafeed.resolveSymbol() → get token
    ↓ candleService.getHistoricalCandles(token, resolution, from, to)
CandleService
    ↓ POST /rest/secure/angelbroking/historical/v1/getCandleData
Angel One REST API
    ↓ returns [[timestamp, O, H, L, C, V], ...]
CandleService → API Router → Frontend (UDF format)
```

---

## Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | JWT expires → getCandleData returns 403 → empty array → blank chart | CRITICAL | FIXED |
| 2 | No retry mechanism on failure — silent empty return | HIGH | FIXED |
| 3 | No token refresh trigger — CandleService has no way to self-heal | HIGH | FIXED |

---

## Root Cause Analysis

The chart would load successfully on first startup (JWT is fresh) but go blank after ~1 hour when the Angel One JWT expired. The CandleService simply caught the error and returned `[]`, which TradingView rendered as "no data" — a blank canvas.

The 60-second `setInterval` propagation meant there was always a gap window after reconnect where the old expired token was still being used.

---

## Fixes Applied

### 1. Self-Healing Token (candleService.js)
```javascript
// Before: if (!this.jwtToken) return [];
// After: attempts to get token via refresh callback
if (!this.jwtToken) {
  if (this._refreshCallback) {
    this.jwtToken = await this._refreshCallback();
  }
  if (!this.jwtToken) return [];
}
```

### 2. 403 Retry Logic (candleService.js)
```javascript
// On 403/401: refresh token and retry once
if (err.response?.status === 403 || err.response?.status === 401) {
  this.jwtToken = await this._refreshCallback();
  resp = await makeRequest(); // retry with fresh token
}
```

### 3. Refresh Callback Wiring (index.js)
```javascript
candleService.setRefreshCallback(async () => {
  return await angelFeed.ensureValidToken();
});
```

---

## Real-Time Chart Updates

Live tick → candle aggregation flow (unchanged, regression-safe):

```
MarketDataEngine.subscribe(token, callback)
    ↓ on every tick
candleService.processLiveTick(token, ltp, volume, timestamp)
    ↓ updates currentCandles Map for 1m, 5m, 15m
TradingViewDatafeed.subscribeBars(token, resolution, callback)
    ↓ builds/updates bar from live quotes
    ↓ calls TradingView onRealtimeCallback
Frontend chart updates in real-time
```

---

## TradingView Endpoints Verified

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `GET /api/tv/config` | Chart configuration | ✓ Working |
| `GET /api/tv/symbols?symbol=X` | Symbol resolution | ✓ Working |
| `GET /api/tv/search?query=X` | Symbol search | ✓ Working |
| `GET /api/tv/history?symbol=X&resolution=5&from=...&to=...` | Historical bars | ✓ Fixed (403 retry) |

---

## Supported Timeframes

| Resolution | Angel One Interval | Status |
|------------|-------------------|--------|
| 1 | ONE_MINUTE | ✓ |
| 3 | THREE_MINUTE | ✓ |
| 5 | FIVE_MINUTE | ✓ |
| 15 | FIFTEEN_MINUTE | ✓ |
| 30 | THIRTY_MINUTE | ✓ |
| 60 | ONE_HOUR | ✓ |
| D | ONE_DAY | ✓ |

---

## Conclusion

Charts now self-heal on token expiry via 403 detection + automatic refresh + retry. No demo candles, no fallback generators. Historical data comes exclusively from Angel One REST API. Real-time updates from live SmartStream ticks aggregated into candles.
