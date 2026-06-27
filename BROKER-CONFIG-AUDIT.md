# BROKER CONFIGURATION AUDIT

## 1. Which .env file is loaded?

**File:** `c:\Users\rmsam\Desktop\Fundedwealth terminal\.env`

All server files use:
```javascript
import { config } from 'dotenv';
config();
```

`config()` with no arguments loads `.env` from the **current working directory** (project root).

**Current contents of `.env`:**
```
VITE_FW_DASHBOARD_URL=http://localhost:3000
```

That's it. One line. No broker credentials.

---

## 2. Which Angel variables are MISSING?

| Variable | Present | Required By |
|----------|---------|-------------|
| `ANGEL_API_KEY` | ❌ MISSING | AngelFeedConnector, AngelOneAdapter, OptionChainService, DepthService, CandleService |
| `ANGEL_CLIENT_ID` | ❌ MISSING | AngelFeedConnector, AngelOneAdapter, BrokerFactory |
| `ANGEL_PASSWORD` | ❌ MISSING | AngelFeedConnector, AngelOneAdapter |
| `ANGEL_TOTP_SECRET` | ❌ MISSING | AngelFeedConnector, AngelOneAdapter |

**All 4 are missing. Zero Angel One credentials are configured.**

---

## 3. Which services require those variables?

### Direct dependency (reads `process.env.ANGEL_*` directly):

| Service | File | Variables Read |
|---------|------|---------------|
| AngelFeedConnector | `server/brokers/angelone/angel.feed.connector.js` | `ANGEL_API_KEY`, `ANGEL_CLIENT_ID`, `ANGEL_PASSWORD`, `ANGEL_TOTP_SECRET` |
| AngelOneAdapter | `server/brokers/angelone/angelone.adapter.js` | `ANGEL_API_KEY`, `ANGEL_CLIENT_ID`, `ANGEL_PASSWORD`, `ANGEL_TOTP_SECRET` |
| BrokerFactory | `server/brokers/broker.factory.js` | `ANGEL_API_KEY`, `ANGEL_CLIENT_ID` (for health report) |

### Indirect dependency (needs JWT propagated from AngelFeedConnector):

| Service | File | Variable Read | JWT Source |
|---------|------|---------------|------------|
| OptionChainService | `server/services/optionChainService.js` | `ANGEL_API_KEY` (for `X-PrivateKey` header) | `this.jwtToken` from `setAuthToken()` |
| DepthService | `server/services/depthService.js` | `ANGEL_API_KEY` (for `X-PrivateKey` header) | `this.jwtToken` from `setAuthToken()` |
| CandleService | `server/services/candleService.js` | `ANGEL_API_KEY` (for `X-PrivateKey` header) | `this.jwtToken` from `setAuthToken()` |

**Critical finding:** Even if JWT were somehow available, OptionChainService, DepthService, and CandleService all read `process.env.ANGEL_API_KEY` directly for their `X-PrivateKey` HTTP header. Without `ANGEL_API_KEY` in `.env`, those headers will be `undefined` and Angel One API will reject the request.

---

## 4. Can Watchlist LTP work without them?

**NO.**

Data path:
```
Watchlist → useMarketStore.quotes[token] → WebSocket 'quote' event → marketDataEngine.pushQuote()
                                                                              ↑
                                                                    AngelFeedConnector._parseTick()
                                                                              ↑
                                                                    SmartStream binary WebSocket
                                                                              ↑
                                                                    angelFeed.connect() ← FAILS (no credentials)
```

Without credentials, AngelFeedConnector never connects to SmartStream. No ticks arrive. `marketDataEngine.quotes` Map stays empty. Watchlist shows "—" for all LTP values.

---

## 5. Can Chart work without them?

**NO.**

Data path:
```
ChartPanel → getHistoricalData(token, tf) → GET /api/market/history
                                                      ↓
                                              candleService.getHistoricalCandles()
                                                      ↓
                                              POST /rest/secure/angelbroking/historical/v1/getCandleData
                                              Headers: { Authorization: Bearer ${this.jwtToken}, X-PrivateKey: process.env.ANGEL_API_KEY }
                                                      ↓
                                              this.jwtToken = null (never set) → return []
```

CandleService checks `if (!this.jwtToken)` and attempts refresh via callback → callback calls `angelFeed.ensureValidToken()` → calls `login()` → fails (no credentials) → returns empty.

Chart renders empty (no candles).

---

## 6. Can Market Depth work without them?

**NO.**

Two data paths, both fail:

**Path A (REST polling - from my earlier fix):**
```
useDepth() → fetch('/api/market/depth?token=X')
                    ↓
         depthService.getDepth(token)
                    ↓
         if (!this.jwtToken) → try refreshCallback → login() fails → return { bids: [], asks: [] }
```

**Path B (WebSocket stream):**
```
subscribe_depth → marketDataEngine.subscribeDepth() → depthCache.get(token)
                                                              ↓
                                                    Empty (never populated because no SmartStream feed)
```

Both paths require valid JWT + live feed connection.

---

## 7. Can Option Chain work without them?

**NO.**

Data path:
```
OptionChainModal → getOptionChain(symbol, expiry) → GET /api/market/option-chain?symbol=NIFTY&expiry=2026-06-26
                                                              ↓
                                                    optionChainService.getOptionChain(symbol, expiry)
                                                              ↓
                                                    if (!this.jwtToken) {
                                                      if (this._refreshCallback) {
                                                        this.jwtToken = await this._refreshCallback(); 
                                                        // ↑ calls angelFeed.ensureValidToken() → login() → THROWS "Missing credentials"
                                                      }
                                                      if (!this.jwtToken) return [];  ← STOPS HERE
                                                    }
```

Returns `[]`. Frontend receives empty array. Renders "Waiting for Option Chain" / "Retry" state.

---

## STARTUP CODE PATH

```
server/index.js startup()
  │
  ├── testConnection() → Supabase check (separate concern)
  ├── marketDataEngine.initialize() → empty engine, no adapter
  ├── redisPubSub.initialize() → optional
  ├── TradingViewDatafeed → ready (doesn't need credentials by itself)
  ├── server.listen(4000)
  │     ├── RealtimeServer (Socket.IO) → ready
  │     ├── EventBridge → ready
  │     └── HealthMonitor → ready
  │
  └── connectAngelFeed()  ←←← THIS IS THE CRITICAL PATH
        │
        ├── angelFeed.connect()
        │     └── angelFeed.login()
        │           ├── reads process.env.ANGEL_API_KEY     → undefined
        │           ├── reads process.env.ANGEL_CLIENT_ID   → undefined
        │           ├── reads process.env.ANGEL_PASSWORD    → undefined
        │           ├── reads process.env.ANGEL_TOTP_SECRET → undefined
        │           └── if (!apiKey || !clientId || !password || !totpSecret)
        │                 throw new Error('[AngelFeed] Missing credentials in .env')
        │
        └── catch (err)
              console.warn('[AngelFeed] ✗ Connection failed: [AngelFeed] Missing credentials in .env')
              console.warn('[AngelFeed]   Market data will be empty until feed connects')
              // RETURNS — all code below never executes:
              //   - propagateToken() never called
              //   - candleService.setAuthToken() never called
              //   - depthService.setAuthToken() never called
              //   - optionChainService.setAuthToken() never called
              //   - setRefreshCallback() never called
              //   - default token subscriptions never sent
              //   - position tracking never started
```

---

## COMPLETE DEPENDENCY MAP

```
┌─────────────────────────────────────────────────────────────────┐
│                         .env FILE                                 │
│  ANGEL_API_KEY ─────────────────────────────────── ❌ MISSING    │
│  ANGEL_CLIENT_ID ───────────────────────────────── ❌ MISSING    │
│  ANGEL_PASSWORD ────────────────────────────────── ❌ MISSING    │
│  ANGEL_TOTP_SECRET ─────────────────────────────── ❌ MISSING    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ALL 4 required by
                                 │
                                 ▼
         ┌───────────────────────────────────────────┐
         │         AngelFeedConnector.login()         │
         │    (GATEWAY — all data flows through)      │
         └───────────────────────┬───────────────────┘
                                 │
                    On SUCCESS produces:
                    • jwtToken
                    • feedToken  
                    • refreshToken
                    • SmartStream WebSocket connection
                                 │
              ┌──────────────────┼──────────────────────┐
              │                  │                       │
              ▼                  ▼                       ▼
   ┌─────────────────┐  ┌──────────────┐  ┌───────────────────┐
   │ Token Propagation│  │ SmartStream  │  │ BrokerFactory     │
   │ (JWT → services) │  │ (live ticks) │  │ (order execution) │
   └────────┬─────────┘  └──────┬───────┘  └───────────────────┘
            │                    │
   ┌────────┼────────┐          │
   │        │        │          │
   ▼        ▼        ▼          ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌────────────────┐
│Candle│ │Depth │ │Option│ │MarketDataEngine│
│Svc   │ │Svc   │ │Chain │ │  .pushQuote()  │
│      │ │      │ │Svc   │ │  .pushDepth()  │
└──┬───┘ └──┬───┘ └──┬───┘ └──────┬─────────┘
   │        │        │             │
   ▼        ▼        ▼             ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌─────────────────┐
│Chart │ │DOM   │ │Option│ │Watchlist/Chart   │
│Panel │ │Panel │ │Chain │ │(live updates)    │
│(hist)│ │      │ │Modal │ │                  │
└──────┘ └──────┘ └──────┘ └─────────────────┘
```

---

## CONCLUSION

**Every data-bearing component in the terminal (Watchlist LTP, Chart, Market Depth, Option Chain, Orders, Positions, Trades) requires Angel One credentials.**

The `.env` file has ZERO broker credentials. The terminal UI loads and renders structurally, but all panels show empty/waiting states because the single gateway (`AngelFeedConnector.login()`) fails immediately at startup.

**This is a configuration issue, not a code defect.**

### To fix:
Add to `.env`:
```
ANGEL_API_KEY=<your SmartAPI key>
ANGEL_CLIENT_ID=<your Angel One account ID>
ANGEL_PASSWORD=<your PIN>
ANGEL_TOTP_SECRET=<your TOTP base32 secret>
```

Then restart the server. All panels will populate when market is open.
