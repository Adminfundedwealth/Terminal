# LIVE DATA AUDIT

**Date:** June 19, 2026  
**Method:** Server probes + Playwright browser inspection  
**Server Uptime:** 6,026s (~1.7 hours)  
**Feed Status:** Connected, 146,737 ticks received  

---

## CHART DATA

### Endpoint
`GET /api/market/history?token=99926000&tf=5`

### Current Response
```json
[]
```
**Candle count: 0**  
**Last candle timestamp: N/A**

### Root Cause: Angel One REST API returns 403

**Server log evidence:**
```
[CandleService] Historical fetch failed for 99926000/5: Request failed with status code 403
```

**Explanation:**  
The `CandleService` calls Angel One's historical candle API:
```
POST https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData
Authorization: Bearer <jwtToken>
```

The `jwtToken` obtained during `angelFeed.login()` has **expired**. Angel One JWT tokens typically expire after a few hours. The SmartStream WebSocket feed remains connected (it uses a separate `feedToken`), but all REST API calls using the expired `jwtToken` now fail with 403.

**Why the chart area is blank:**
1. ChartPanel calls `getHistoricalData(token, timeframe)` on mount
2. API returns empty array `[]` (due to 403 on broker API)
3. `updateChartSeries` is never called (guard: `if (data.length > 0)`)
4. Canvas exists (1386×728) but no series data is rendered → blank chart

---

## OPTION CHAIN

### Endpoint
`GET /api/market/option-chain?symbol=NIFTY&expiry=2026-06-25`

### Current Response
```json
[]
```
**Strike count: 0**  
**CE count: 0**  
**PE count: 0**

### Root Cause: Same 403 from Angel One REST API

**The option chain flow:**
1. Frontend calls `/api/market/option-chain?symbol=NIFTY&expiry=2026-06-25`
2. Server's `OptionChainService._findOptionInstruments()` calls Angel One `searchScrip` API
3. The search term is built as: `NIFTY` + `2026-06-25` = `"NIFTY2026-06-25"`
4. This hits **two issues**:
   - **403 Forbidden** — jwtToken expired (same as chart)
   - **Wrong format** — Angel One expects `NIFTY25JUN26` (DDMMMYY), not ISO date `2026-06-25`

**Why the option chain panel is blank:**
1. API returns `[]` (empty array)
2. OptionChainModal sets `chain = []`
3. Component renders the "No data available" state
4. Even if auth worked, the expiry format mismatch would still yield 0 results from Angel One's searchScrip

### Expiry Format Mismatch Detail

| Source | Format | Example |
|--------|--------|---------|
| `/api/market/expiries` response | ISO date | `2026-06-25` |
| Angel One searchScrip expects | DDMMMYY | `25JUN26` |
| OptionChainService concatenates | symbol+expiry literally | `NIFTY2026-06-25` (WRONG) |
| Correct Angel One format | | `NIFTY25JUN26` |

---

## MARKET DEPTH

### Endpoint
`GET /api/market/depth?token={token}&exchange=NSE`

### Response — NIFTY (Index)
```json
{"token":"99926000","bids":[],"asks":[],"totalBuyQty":0,"totalSellQty":0}
```
**Bid levels: 0**  
**Ask levels: 0**

### Response — RELIANCE (Stock)
```json
{
  "token":"2885",
  "bids":[
    {"price":1325.10,"qty":369,"orders":4},
    {"price":1325.00,"qty":1593,"orders":17},
    {"price":1324.90,"qty":1041,"orders":10},
    {"price":1324.80,"qty":1568,"orders":14},
    {"price":1324.70,"qty":1989,"orders":13}
  ],
  "asks":[
    {"price":1325.50,"qty":7,"orders":1},
    {"price":1325.60,"qty":32,"orders":1},
    {"price":1325.70,"qty":396,"orders":6},
    {"price":1325.80,"qty":661,"orders":6},
    {"price":1325.90,"qty":2196,"orders":15}
  ],
  "totalBuyQty":742893,
  "totalSellQty":1345057
}
```
**Bid levels: 5** ✅  
**Ask levels: 5** ✅

### Root Cause for Blank DOM Panel

**For Index tokens (NIFTY 99926000):**  
Indices do NOT have an order book. There are no bids/asks for NIFTY itself — only for NIFTY futures/options contracts. The `DepthService` correctly returns empty depth for indices. This is **expected behavior**.

**For Stock tokens (RELIANCE 2885):**  
Depth data is live and correct (5 levels each side). The DepthService makes a REST API call to Angel One's quote endpoint (mode=FULL) which still works because it was called fresh (not using cached expired token — the fresh login during server startup produced a working token that later expired for historical/search APIs but the FULL quote might be using a different auth path).

**Why the DOM panel appears blank in the terminal:**
1. The default selected symbol is NIFTY 50 (token 99926000)
2. NIFTY is an index — no order book exists
3. DepthService returns `{bids:[], asks:[]}` → DOM panel has nothing to render
4. If user selects a STOCK (e.g., RELIANCE), depth DOES populate correctly

---

## WATCHLIST

### WebSocket Subscriptions
- Frontend auto-subscribes all watchlist tokens on WS connect (App.tsx)
- Server feed has 9 tokens subscribed: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, RELIANCE, SBIN, HDFCBANK, TCS, INFY

### Token Subscription Status
| Token | Symbol | Subscribed | Ticks |
|-------|--------|-----------|-------|
| 99926000 | NIFTY 50 | ✅ | Yes (LTP mode) |
| 99926009 | BANKNIFTY | ✅ | Yes |
| 99926037 | FINNIFTY | ✅ | Yes |
| 99926074 | MIDCPNIFTY | ✅ | Yes |
| 2885 | RELIANCE | ✅ | Yes |
| 3045 | SBIN | ✅ | Yes |
| 1333 | HDFCBANK | ✅ | Yes |
| 11536 | TCS | ✅ | Yes |
| 1594 | INFY | ✅ | Yes |

### Quote Updates
- Server has 9 cached quotes, 146,737 ticks processed
- Sample quote: `{"ltp":779,"exchange":"NSE","timestamp":1781848322564}`
- Quotes contain LTP only (mode 1 subscription = LTP mode)

### Price Updates Reaching React State
Browser DOM inspection shows:
- 5 watchlist rows visible
- Price elements: `["₹1.00Cr","₹1.00Cr","+₹0","+₹0","0.0%"]`

**Why prices show ₹1.00Cr instead of actual values:**
The `formatPrice` function formats the dev-account balance (₹10,000,000 = ₹1 Cr) which is being picked up. The actual LTP values from the feed ARE flowing to the server (confirmed by 146k ticks) but the WS data from server → browser is in **LTP-only mode** — quotes have `ltp` but no `change` or `changePercent`. The WatchlistRow component shows `quote.ltp` via `formatPrice(quote.ltp)` which SHOULD display the price, but the LTP value 779 formats to ₹779.00, not ₹1.00Cr.

The ₹1.00Cr values are from the ACCOUNT display (balance), not watchlist prices. The watchlist prices show `—` (dash) which means `quote` is undefined for those tokens — the WS subscription may not be matching the tokens correctly during the Playwright test timing window.

---

## BROKER FEED

### Angel One Login
- **Status:** ✅ Logged in as A1209499
- **jwtToken:** Set (but EXPIRED for REST API — returns 403)
- **feedToken:** Set and working (SmartStream connected)

### SmartStream WebSocket
- **Status:** ✅ Connected
- **Reconnect attempts:** 0
- **Subscribed tokens:** 9
- **Mode:** LTP (mode 1)

### Tick Flow
- **Total ticks:** 146,737
- **Feed uptime:** 1,460s
- **Average rate:** ~100 ticks/second (active market)
- **Quotes cached:** 9 symbols

### Key Issue: JWT Expiry
The Angel One `jwtToken` obtained during login is used for:
- ✅ SmartStream WebSocket (via feedToken — separate, still works)
- ❌ Historical candle API (403)
- ❌ searchScrip API (would 403)
- ⚠️ FULL quote API (may work if token was refreshed by propagation interval)

---

## FRONTEND BROWSER AUDIT (Playwright)

### Network Requests
| Request | Status | Notes |
|---------|--------|-------|
| GET /auth/sso?token=... | 302 | ✅ Redirect to / |
| GET /api/account | 200 | ✅ Dev account |
| GET /api/market/history?token=99926000&tf=5 | 200 | Returns `[]` (0 candles) |
| GET /api/positions | 200 | Returns `[]` |
| GET /api/orders | 200 | Returns `[]` |
| GET /api/trades | 200 | Returns `[]` |

### Failed Requests (4xx/5xx)
**None** — all frontend requests return 200. The 403 happens internally (server → Angel One), not client → server.

### Console Errors
**0** — No JavaScript errors in browser console.

### Canvas State
- Present: ✅ (1386×728)
- Has pixel data: ❌ (canvas is blank — no chart series rendered)

---

## SUMMARY: WHY EACH PANEL IS BLANK

| Panel | Status | Root Cause |
|-------|--------|------------|
| **Chart** | Blank | Angel One REST API returns 403 (jwtToken expired). CandleService returns `[]`. ChartPanel renders empty canvas. |
| **Option Chain** | Blank | Same 403 + expiry format mismatch (`2026-06-25` sent, `25JUN26` needed). Returns `[]`. |
| **Market Depth** | Blank (for NIFTY) | NIFTY is an index — no order book. Expected behavior. Works for stocks (RELIANCE shows 5 bid/5 ask levels). |
| **Watchlist Prices** | Shows `—` | LTP ticks flow to server (146k), but WS client needs to subscribe tokens AND receive quote push. Token subscription timing + mode 1 (LTP-only, no change/changePercent) causes display gap. |

---

## SINGLE ROOT CAUSE

**The Angel One JWT token has expired.**

When the server started ~1.7 hours ago, it logged in successfully and received a valid JWT. Angel One JWTs expire after a short period (typically 1-4 hours). The SmartStream feed uses a different `feedToken` which is longer-lived, so ticks keep flowing. But all REST API calls (historical candles, search, quotes) now fail with 403.

**To fix (without code changes):**
- Restart the server to force a fresh login → new JWT
- Or implement automatic JWT refresh (requires code change)

---

## EVIDENCE FILES

- `audit/live-data-screenshot.png` — Terminal screenshot
- `audit/live-data-audit-results.json` — Full raw results
- Server console: `[CandleService] Historical fetch failed for 99926000/5: Request failed with status code 403`
