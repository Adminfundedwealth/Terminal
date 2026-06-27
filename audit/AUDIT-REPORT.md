# FundedWealth Terminal — Production Audit Report

**Date:** 2026-06-17  
**Auditor:** Automated (Playwright + API testing)  
**Runtime verified:** http://localhost:3000 (frontend) + http://localhost:4000 (backend)

---

## 1. GAP ANALYSIS TABLE

| Module | Status | Real / Mock | Missing Work |
|--------|--------|-------------|--------------|
| **Authentication** | Not implemented | ❌ MOCK | No auth layer. Returns hardcoded "DEMO001" account. No FundedWealth session integration. |
| **Market Data (Quotes)** | Running | ❌ MOCK (Simulated) | Random tick generator every 500ms. No Angel One SmartAPI WebSocket. No Dhan Market Feed. |
| **Market Data (Historical OHLC)** | Running | ❌ MOCK (Generated) | Random walk algorithm. Not fetched from broker candle API. |
| **Market Depth (L5 DOM)** | Running | ❌ MOCK (Generated) | Random bid/ask generator. Not from exchange feed. |
| **Option Chain** | Running | ❌ MOCK (Generated) | Synthetic prices/Greeks via math formulas. Not from NSE/broker API. |
| **Instrument Master** | Running | ❌ HARDCODED | 50 instruments hardcoded in JS array. Not loading broker's daily instrument file (7000+ F&O instruments). |
| **Order Placement** | Running | ❌ MOCK | Returns fake order ID (`ORD + timestamp`). No actual broker API call. |
| **Order Modify/Cancel** | Running | ❌ MOCK | Returns success string immediately without broker call. |
| **Positions** | Running | ❌ MOCK | Returns 2 hardcoded demo positions from memory. |
| **Orders** | Running | ❌ MOCK | Returns 2 hardcoded demo orders. No database persistence. |
| **Trade Book** | Running | ❌ MOCK | Returns empty array. No trade history storage. |
| **Account/Margin** | Running | ❌ MOCK | Returns hardcoded balance ₹10L. Not from broker API. |
| **Charting Library** | Running | ⚠️ PARTIAL | Uses **Lightweight Charts** (open-source). NOT TradingView Charting Library (requires commercial license). |
| **Indicators** | UI exists | ❌ NOT IMPLEMENTED | Indicator buttons toggle labels but no actual indicator calculation or overlay on chart. |
| **Drawing Tools** | UI exists | ❌ NOT IMPLEMENTED | Drawing tool menu renders but tools do nothing. |
| **Watchlist Persistence** | Running | ⚠️ LOCAL ONLY | Saved in browser `localStorage`. Not server-synced. |
| **WebSocket** | Running | ✅ REAL (infrastructure) | WebSocket pub/sub architecture works. But feeds simulated data, not live exchange. |
| **Theme System** | Running | ✅ REAL | 3 themes work. CSS variables swap correctly. |
| **Hotkeys** | Running | ✅ REAL | Ctrl+K, F1-F4 work correctly. |
| **Search** | Running | ⚠️ PARTIAL | Searches hardcoded 50-instrument list. Falls back to demo when API fails. |
| **Multi-Chart Layout** | UI exists | ❌ NOT IMPLEMENTED | Layout buttons exist but only single chart renders. |
| **Bracket/Cover Orders** | UI exists | ❌ NOT IMPLEMENTED | BO/CO mentioned in spec but no UI or backend logic. |
| **Database (Supabase)** | Not integrated | ❌ MISSING | No database connection. All state is in-memory. |
| **Redis Cache** | Not integrated | ❌ MISSING | Redis dependency installed but not used. |

---

## 2. DETAILED FINDINGS

### 2.1 Broker API Connection Status

| Broker | Auth | Market Data | Orders | Positions |
|--------|------|-------------|--------|-----------|
| Angel One SmartAPI | ❌ Stub only | ❌ Not connected | ❌ Stub (`throw Error`) | ❌ Stub |
| Dhan API | ❌ Stub only | ❌ Not connected | ❌ Stub (`throw Error`) | ❌ Stub |

**Evidence:** `brokerService.js` lines 56-58: `throw new Error('Angel One integration pending API keys')`  
**Evidence:** `brokerService.js` line 67: `throw new Error('Dhan integration pending access token')`

### 2.2 Charting Library

- **Currently using:** `lightweight-charts` v4.1.3 (TradingView open-source library)
- **NOT using:** TradingView Charting Library (commercial, requires license from TradingView)
- **Impact:** No built-in indicators, no drawing tools, no advanced features (compare, replay, etc.)

### 2.3 API Endpoint Runtime Evidence

```
/api/account          → 200 | {"clientId":"DEMO001","balance":1000000,...}  (HARDCODED)
/api/positions        → 200 | 2 items (HARDCODED demo positions)
/api/orders           → 200 | 2 items (HARDCODED demo orders)
/api/trades           → 200 | [] (EMPTY - no implementation)
/api/instruments      → 200 | 11 results for "nifty" (from 50-item hardcoded list)
/api/market/history   → 200 | 501 candles (RANDOM WALK generated)
/api/market/depth     → 200 | 5 bid/ask levels (RANDOM GENERATED)
/api/option-chain     → 200 | 31 strikes (SYNTHETIC math formulas)
/api/expiries         → 200 | 8 dates (COMPUTED from current date)
```

### 2.4 Order Placement Test

```
POST /api/orders/place
Body: {"symbol":"RELIANCE","token":"2885","side":"BUY","orderType":"MARKET","productType":"MIS","qty":10}
Response: {"orderId":"ORD1781639755574857","status":"FILLED","message":"Order placed successfully (demo mode)"}
```

**Verdict:** Order never reaches any exchange. Fake ID generated locally.

### 2.5 WebSocket Runtime Evidence

```
Connected: true
Messages: market_status, quote (repeating every 500ms)
Sample: {"type":"quote","token":"2885","data":{"ltp":2950,"volume":7625483,...}}
```

**Verdict:** WebSocket infrastructure works. Data is simulated random walk, not from Angel One SmartConnect WebSocket.

---

## 3. WHAT'S ACTUALLY WORKING (REAL)

1. ✅ React + TypeScript + Tailwind frontend compiles and serves
2. ✅ WebSocket pub/sub architecture (client ↔ server)
3. ✅ Theme switching (3 themes)
4. ✅ Hotkey system (F1-F4, Ctrl+K)
5. ✅ Watchlist CRUD (localStorage persistence)
6. ✅ Chart renders candlesticks (via Lightweight Charts)
7. ✅ Search modal with keyboard navigation
8. ✅ Express REST API framework with proper routes
9. ✅ Docker/Nginx deployment config
10. ✅ Responsive terminal layout (TopBar, Left, Center, Right, Bottom panels)

---

## 4. P0 — REQUIRED FOR DHAN-LEVEL PRODUCTION

### CRITICAL (Cannot go live without these)

| # | Item | Effort | Description |
|---|------|--------|-------------|
| P0-1 | **Angel One SmartAPI Full Auth** | 2-3 days | Implement TOTP-based login, session management, token refresh. Use `smartapi-javascript` SDK. |
| P0-2 | **Angel One SmartConnect WebSocket** | 2-3 days | Connect to `wss://smartapisocket.angelone.in/smart-stream` for real-time tick data. Binary protocol parsing. |
| P0-3 | **Live Order Execution** | 2 days | Wire `placeOrder`, `modifyOrder`, `cancelOrder` to Angel One REST API. Handle rejection codes. |
| P0-4 | **Live Positions/Orders/Trades** | 1-2 days | Fetch from `/rest/secure/angelbroking/order/v1/getPosition`, order book, trade book APIs. |
| P0-5 | **Instrument Master Daily Sync** | 1-2 days | Download Angel One's instrument CSV/JSON (~7000+ instruments) on daily login. Index by token for O(1) lookup. |
| P0-6 | **Live Historical OHLC** | 1 day | Use Angel One's `/rest/secure/angelbroking/historical/v1/getCandleData` for real candles. |
| P0-7 | **Live Market Depth** | 1 day | Subscribe to depth feed on SmartConnect WebSocket (mode 3 = Full SnapQuote with 5-level depth). |
| P0-8 | **Live Option Chain** | 2 days | Fetch option instruments for selected expiry, subscribe to real-time OI/LTP/Volume. Greeks require Black-Scholes calculation from IV. |
| P0-9 | **FundedWealth Auth Integration** | 2 days | Accept session token from FundedWealth dashboard, validate JWT, establish broker session without re-login. |
| P0-10 | **Database Persistence** | 2 days | Supabase/PostgreSQL for: user preferences, watchlists, order history, trade logs, session tokens. |

### HIGH (Required for professional trading experience)

| # | Item | Effort | Description |
|---|------|--------|-------------|
| P1-1 | **TradingView Charting Library** | 3-5 days | Replace Lightweight Charts with commercial TradingView library. Requires license ($). Provides 100+ indicators, drawings, compare mode natively. |
| P1-2 | **Indicator Engine** | 3-5 days | If not using TV library: Implement EMA, SMA, VWAP, RSI, MACD, ATR, ADX, Bollinger, Supertrend, Stochastic as chart overlays. |
| P1-3 | **Drawing Tools Engine** | 2-3 days | Implement trendline, horizontal line, rectangle, fib retracement, pitchfork rendering + persistence. |
| P1-4 | **Multi-Chart Layout** | 2 days | Render 2/4/8 independent chart instances with separate symbols/timeframes. |
| P1-5 | **Dhan Backup Feed** | 2-3 days | Implement Dhan WebSocket (`wss://api-feed.dhan.co`) as automatic failover when Angel One is down. |
| P1-6 | **Redis Market Data Cache** | 1 day | Cache latest quotes in Redis for fast API responses and WebSocket recovery. |
| P1-7 | **Bracket & Cover Orders** | 1-2 days | BO/CO order types with target/stoploss in a single order. |
| P1-8 | **Error Handling & Reconnection** | 1-2 days | Handle broker disconnects, rate limits, order rejections gracefully with user notifications. |
| P1-9 | **Watchlist Server Sync** | 1 day | Persist watchlists to database, sync across devices. |
| P1-10 | **Order Confirmation Dialog** | 0.5 day | Confirm before executing, show estimated charges/margin required. |

### TOTAL ESTIMATED EFFORT TO PRODUCTION: 25-35 developer days

---

## 5. SUMMARY VERDICT

**Current state:** The terminal is a **fully functional UI shell** with correct architecture and component layout. It looks like a trading terminal and has the right WebSocket/REST infrastructure. However, **zero live broker connectivity exists**. Every piece of data displayed is either hardcoded or randomly generated.

**What exists:** Professional-quality frontend + working backend skeleton + Docker deployment  
**What's missing:** All broker integrations, all real data, persistence layer, authentication

To reach Dhan/Angel One production level, the P0 items (1-10) must all be completed. There is no shortcut.
