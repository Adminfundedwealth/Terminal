# FundedWealth Terminal — Production Readiness Audit

**Date:** 2026-06-17  
**Method:** Runtime API calls + Source code inspection + Playwright screenshots  
**Server:** http://localhost:3000 (frontend) → http://localhost:4000 (backend)

---

## MODULE STATUS TABLE

| # | Module | Status | Evidence | Missing Work |
|---|--------|--------|----------|--------------|
| 1 | **Authentication** | ❌ MOCK | No auth middleware in `server/index.js`. No JWT/session validation. `/api/*` endpoints have zero auth checks. Any request gets data. | Need: FundedWealth JWT validation, session handoff from dashboard, route guards |
| 2 | **Account Mapping** | ❌ MOCK | `brokerService.js:135` returns hardcoded `{"clientId":"DEMO001","name":"Demo Trader","balance":1000000}`. No mapping between FW user and broker account. | Need: User → broker credential mapping table in database |
| 3 | **Market Data (Live Quotes)** | ❌ MOCK | `marketDataEngine.js:40` `startSimulation()` generates random ticks via `Math.random()` every 500ms. Server log confirms: `[MarketData] Live feed unavailable, starting simulation` | Need: Angel One SmartConnect WebSocket (binary protocol) or Dhan Market Feed |
| 4 | **Historical Candles** | ❌ MOCK | `marketDataEngine.js:211` `getHistoricalData()` generates random walk. Verified: candles show price drifting from 2950 to 3128 — random values, not real RELIANCE data. | Need: Angel One `/rest/secure/angelbroking/historical/v1/getCandleData` API |
| 5 | **Option Chain** | ❌ MOCK | `routes/api.js:212` `generateOptionChain()` uses math formulas: `callIntrinsic + timeValue + Math.random() * 20`. Verified: strikes 23750-25250 with synthetic Greeks. | Need: Real option instrument tokens + live OI/LTP from exchange + Black-Scholes IV |
| 6 | **Market Depth** | ❌ MOCK | `marketDataEngine.js:126` `generateSimulatedDepth()` creates random bids/asks: `qty: Math.floor(Math.random() * 5000) + 200`. Verified: `/api/market/depth` returns random values. | Need: SmartConnect mode 3 (SnapQuote) for real 5-level depth |
| 7 | **Order Execution** | ❌ MOCK | `brokerService.js:105` `simulateOrder()` returns fake orderId: `'ORD' + Date.now()`. Verified: POST `/api/orders/place` returns `{"orderId":"ORD1781655527492472","status":"FILLED","message":"Order placed successfully (demo mode)"}`. Never hits exchange. | Need: Angel One POST `/rest/secure/angelbroking/order/v1/placeOrder` |
| 8 | **Positions** | ❌ MOCK | `brokerService.js:167` `getDemoPositions()` returns 2 hardcoded positions (RELIANCE +10, NIFTY FUT -2). Same data every time. Not persisted. | Need: Angel One GET `/rest/secure/angelbroking/order/v1/getPosition` |
| 9 | **Orders** | ❌ MOCK | `brokerService.js:204` `getDemoOrders()` returns 2 hardcoded orders (SBIN LIMIT, RELIANCE MARKET). Static. | Need: Angel One GET `/rest/secure/angelbroking/order/v1/getOrderBook` |
| 10 | **Trade Book** | ❌ MOCK | `brokerService.js:161` `getTrades()` returns `[]`. Verified: `/api/trades` → `[]`. | Need: Angel One GET `/rest/secure/angelbroking/order/v1/getTradeBook` |
| 11 | **Instrument Master** | ❌ HARDCODED | `instrumentService.js` contains 54 manually typed instruments. Verified: NSE=24, NFO=13, MCX=9, CDS=6, BSE=1, BFO=1. Total = **54 instruments**. Real NSE F&O alone has 7000+. | Need: Daily download of Angel One instrument master CSV (180K+ rows) |
| 12 | **Angel One Integration** | ❌ STUB | `brokerService.js:57` throws `'Angel One integration pending API keys'`. Auth, orders, positions, market data — all stubs with `throw new Error`. | Need: Full SmartAPI implementation (auth, orders, positions, historical, WebSocket) |
| 13 | **Dhan Integration** | ❌ STUB | `brokerService.js:68` throws `'Dhan integration pending access token'`. Same status as Angel One. | Need: Full Dhan API implementation |
| 14 | **Upstox Integration** | ❌ ABSENT | Zero references to Upstox anywhere in codebase. `grep 'upstox' → No matches found` | Need: Entire implementation from scratch if required |
| 15 | **Shoonya Integration** | ❌ ABSENT | Zero references to Shoonya/Finvasia anywhere in codebase. `grep 'shoonya' → No matches found` | Need: Entire implementation from scratch if required |
| 16 | **Database** | ❌ ABSENT | `grep 'redis\|supabase\|postgres\|database' → No matches found` in server code. All state lives in JavaScript variables that reset on server restart. | Need: PostgreSQL/Supabase for user data, watchlists, trade history |
| 17 | **Redis Cache** | ❌ ABSENT | `ioredis` is in `package.json` but never imported or used in any server file. | Need: Redis for quote cache, session store, rate limiting |

---

## RUNTIME EVIDENCE

### Account API
```
GET /api/account
→ {"clientId":"DEMO001","name":"Demo Trader","balance":1000000,"availableMargin":850000,"usedMargin":150000,"totalPnl":12500}
Source: brokerService.js line 135 — hardcoded object
```

### Order Placement
```
POST /api/orders/place {"symbol":"RELIANCE","side":"BUY","orderType":"MARKET","qty":10}
→ {"orderId":"ORD1781655527492472","status":"FILLED","message":"Order placed successfully (demo mode)"}
Source: brokerService.js line 105 — simulateOrder() — random ID generation
```

### Positions
```
GET /api/positions
→ 2 items: RELIANCE +10 @ 2935, NIFTY FUT -2 @ 24550
Source: brokerService.js line 167 — getDemoPositions() — same 2 positions every time
```

### Historical Data
```
GET /api/market/history?token=2885&tf=5
→ 501 candles, random walk starting from quote LTP
Source: marketDataEngine.js line 211 — Math.random() based generation
```

### WebSocket
```
Connected: true
Messages: market_status (CLOSED), then quote updates every 500ms
Data: random tick changes via (Math.random() - 0.48) * ltp * 0.001
Source: marketDataEngine.js line 88 — setInterval simulation
```

### Instrument Count
```
NSE: 24 | NFO: 13 | MCX: 9 | CDS: 6 | BSE: 1 | BFO: 1
TOTAL: 54 instruments (hardcoded in instrumentService.js)
Real requirement: 7000+ F&O instruments from NSE alone
```

---

## BROKER INTEGRATION STATUS

| Broker | Auth | Market Data | Orders | Positions | Status |
|--------|------|-------------|--------|-----------|--------|
| Angel One SmartAPI | `throw Error` on line 57 | Not connected | `throw Error` on line 96 | Returns demo | **STUB** |
| Dhan | `throw Error` on line 68 | Not connected | `throw Error` on line 102 | Returns demo | **STUB** |
| Upstox | — | — | — | — | **NOT IN CODEBASE** |
| Shoonya | — | — | — | — | **NOT IN CODEBASE** |

---

## P0 ROADMAP — PRODUCTION READINESS

Only items required for real trading. No UI work.

| # | Item | What Exists | What's Needed |
|---|------|-------------|---------------|
| **P0-1** | Angel One SmartAPI Auth | Commented URL on line 55 of brokerService.js | Implement TOTP generation, POST loginByPassword, store jwtToken + refreshToken, auto-refresh before expiry |
| **P0-2** | Angel One SmartConnect WebSocket | Nothing | Connect to `wss://smartapisocket.angelone.in/smart-stream`, handle binary frames (LTP mode/Quote mode/SnapQuote mode), parse tick data, feed into marketDataEngine |
| **P0-3** | Angel One Historical Candles API | Random walk generator | Replace `getHistoricalData()` with POST to `/rest/secure/angelbroking/historical/v1/getCandleData` with proper token/interval/fromdate/todate params |
| **P0-4** | Angel One Order Execution | `simulateOrder()` | Implement POST `/rest/secure/angelbroking/order/v1/placeOrder` with variety=NORMAL/STOPLOSS, transactiontype, ordertype, producttype, qty, price, triggerprice |
| **P0-5** | Angel One Order Book + Trade Book | Returns hardcoded array | Implement GET orderBook, tradeBook APIs, parse response into frontend format |
| **P0-6** | Angel One Position Book | Returns 2 hardcoded positions | Implement GET position API, calculate real-time MTM using live LTP |
| **P0-7** | Angel One Funds/Margin | Returns hardcoded ₹10L | Implement GET `/rest/secure/angelbroking/user/v1/getRMS` for real margin data |
| **P0-8** | Instrument Master Daily Sync | 54 hardcoded instruments | Download Angel One instrument master (JSON/CSV, ~180K rows), parse, index by token. Run daily at 8:30 AM IST. Store in Redis or DB. |
| **P0-9** | Real Option Chain | Math formula generation | For a given underlying+expiry: filter option instruments from master, subscribe to LTP/OI via WebSocket, compute IV using Black-Scholes from market price |
| **P0-10** | Real Market Depth | `generateSimulatedDepth()` | Use SmartConnect SnapQuote mode (mode 3) which includes 5 best bid/ask levels with qty+orders |
| **P0-11** | FundedWealth Auth Integration | No auth middleware exists | Accept JWT from FW dashboard (cookie or Authorization header), validate signature, map FW userId → broker credentials, reject if invalid |
| **P0-12** | Database Layer | Zero database code | Setup Supabase/PostgreSQL. Tables: users, broker_credentials (encrypted), watchlists, order_history, sessions |
| **P0-13** | Redis Integration | Package installed, not used | Use for: quote cache (reduce WebSocket reconnect data loss), session store, rate limiting broker API calls |

---

## VERDICT

**The terminal is a fully functional UI prototype with working WebSocket infrastructure, but has ZERO real broker connectivity.** Every single data point displayed — quotes, candles, depth, option chain, positions, orders — is either hardcoded or randomly generated.

No user can place a real trade. No real market data flows. No authentication exists.

The gap between current state and production is 100% backend work — the frontend is ready.
