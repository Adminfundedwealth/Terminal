# REALTIME ARCHITECTURE REPORT
## FundedWealth Terminal — Agent C Output

> **Scope:** Audit WebSocket/Socket.IO/Market APIs, design TradingView Datafeed, design realtime channels.
> **Constraints:** No UI changes. No Supabase/broker adapter/frontend edits. No credentials requested.

---

## 1. CURRENT STATE AUDIT

### 1.1 WebSocket Infrastructure

| Layer | Technology | Status | File |
|-------|-----------|--------|------|
| Server WS | `ws` (v8.17.1) | ✅ Running (simulated) | `server/index.js` |
| Server WS (prod) | `ws` + auth | ⚠️ Exists but NOT wired | `server/routes/websocket.js` |
| Client WS | Native `WebSocket` API | ✅ Running | `src/services/websocket.ts` |
| Socket.IO | — | ❌ Not used anywhere | — |

**Protocol (JSON over WS, path `/ws`):**

```
Client → Server:
  { type: "subscribe", tokens: ["2885", "99926000"] }
  { type: "unsubscribe", tokens: ["2885"] }
  { type: "subscribe_depth", tokens: ["2885"] }
  { type: "unsubscribe_depth", tokens: ["2885"] }
  { type: "ping" }

Server → Client:
  { type: "quote", token: "2885", data: { ltp, open, high, low, ... } }
  { type: "depth", token: "2885", data: { bids, asks, ... } }
  { type: "market_status", status: "OPEN" }
  { type: "pong", timestamp: 1718... }
```

**Observations:**
- Reconnect logic with exponential backoff (client-side, max 10 attempts)
- Token resubscription on reconnect ✅
- No server-side heartbeat / dead-connection detection ❌
- No authentication on the running WS server (index.js) ❌
- The production handler (`routes/websocket.js`) has JWT auth but isn't imported

### 1.2 Socket.IO Assessment

**Socket.IO is NOT present.** Zero references in code, zero dependencies. The project uses raw
`ws` library exclusively. This is the correct choice for a trading terminal (lower latency,
smaller bundle, binary frame support for future broker feed parsing).

**Recommendation:** Do NOT add Socket.IO. Stick with native WebSocket.

### 1.3 Market Data APIs (Broker Feeds)

| Broker | REST Adapter | WebSocket Feed | Status |
|--------|-------------|----------------|--------|
| Angel One | ✅ Implemented | ❌ Not implemented | `server/brokers/angelone/angelone.adapter.js` |
| Dhan | ❌ Stub only | ❌ Not implemented | Interface defined, no code |
| Upstox | ❌ Stub only | ❌ Not implemented | Interface defined, no code |
| Shoonya | ❌ Stub only | ❌ Not implemented | Interface defined, no code |

**Angel One adapter has:**
- ✅ TOTP-based authentication (`connect()`)
- ✅ REST quote fetching (`getQuotes`, `getLTP`)
- ✅ REST depth fetching (`getDepth`)
- ✅ Historical OHLC via REST (`getOHLC`)
- ✅ Order placement/modification/cancellation
- ✅ Positions, Orders, Trades, Funds, Holdings
- ❌ No SmartConnect WebSocket feed (the `feedToken` is obtained but never used)
- ❌ No `subscribeQuotes()` / `subscribeDepth()` via WS

**Current data flow is 100% simulated:**
```
server/index.js → setInterval(500ms) → random ticks → WS broadcast
```

### 1.4 MarketDataEngine

| File | Type | Status |
|------|------|--------|
| `server/engines/marketdata.engine.ts` | TypeScript interface | 📋 Interface only |
| `server/services/marketDataEngine.js` | JavaScript class | ⚠️ Pub/sub shell, no real feed |

The JS implementation has the correct pub/sub pattern:
- `subscribe(token, cb)` / `unsubscribe(token, cb)`
- `subscribeDepth(token, cb)` / `unsubscribeDepth(token, cb)`
- `pushQuote(token, data)` / `pushDepth(token, data)`
- `connectAdapter(adapter)` — ready to accept a broker adapter
- `getHistoricalData()` / `getOptionChain()` — delegates to adapter

**But no adapter is ever connected in production.** The `server/index.js` runs its own inline simulation.

### 1.5 Redis

- `ioredis` v5.4.1 is in `server/package.json` dependencies
- **Zero usage in actual running code**
- Referenced in architecture docs and a comment in `sso.service.js`
- Required for: quote caching, OHLC aggregation persistence, horizontal scaling via pub/sub

### 1.6 TradingView / Charting

| Aspect | Status | Detail |
|--------|--------|--------|
| Library | `lightweight-charts` v4.1.3 | Not the full TradingView Charting Library |
| Datafeed adapter | ❌ None | No `IExternalDatafeed` implementation |
| Historical data | REST fetch (`/api/market/history`) | Simulated random candles |
| Real-time updates | Direct `series.update()` from Zustand quote | No bar-building |
| Bar aggregation | ❌ Missing | Server returns pre-built candles, no live OHLC building |
| Chart types | Candlestick, Hollow, Heikin-Ashi, Area, Line | ✅ Working |
| Timeframes | 1, 3, 5, 15, 30, 60, 240, D, W | ✅ Selection works |

---

## 2. MISSING COMPONENTS

### Critical (Blocks Live Trading)

| # | Component | Why Needed |
|---|-----------|-----------|
| 1 | **Broker WebSocket Feed Connector** | Without this, no live LTP/depth. Only simulated data flows. |
| 2 | **OHLC Candle Builder** | Ticks must be aggregated into timeframe candles server-side |
| 3 | **Redis Cache Layer** | Quotes/depth must persist across reconnections + enable scaling |
| 4 | **TradingView Datafeed Adapter** | Required for proper chart integration with `subscribeBars` |
| 5 | **Order/Position WS Channel** | Users don't see live order fills or position P&L updates |
| 6 | **Challenge Status Channel** | Risk alerts must stream in realtime when limits approach |
| 7 | **Server Heartbeat** | Dead connections accumulate without server-initiated pings |

### Important (Production Readiness)

| # | Component | Why Needed |
|---|-----------|-----------|
| 8 | Auth on WS (wire `routes/websocket.js`) | Current index.js WS has no auth |
| 9 | Binary frame parsing | Angel One SmartConnect sends binary, needs decoder |
| 10 | Feed failover (primary → backup) | If Angel disconnects, switch to Dhan feed |
| 11 | Instrument token mapping | Broker tokens differ per provider, need unified mapping |
| 12 | Rate limiting on WS | Prevent client subscribing to 500+ tokens |

---

## 3. REQUIRED REST ENDPOINTS (for Datafeed)

These endpoints are needed by the TradingView Datafeed adapter:

| Endpoint | Method | Purpose | Exists? |
|----------|--------|---------|---------|
| `/api/instruments/search?q=` | GET | `searchSymbols()` | ✅ Yes |
| `/api/instruments/:token` | GET | `resolveSymbol()` — full instrument info | ❌ Missing |
| `/api/market/history?token=&tf=&from=&to=` | GET | `getBars()` | ✅ Yes (needs `from`/`to` filtering) |
| `/api/market/config` | GET | Supported resolutions, exchanges | ❌ Missing |
| `/api/market/time` | GET | Server time for chart sync | ❌ Missing |

---

## 4. REQUIRED SOCKET CHANNELS

### 4.1 Channel: `ltp` (Quote Ticks)

```
Subscribe:   { type: "subscribe", tokens: ["2885", "99926000"] }
Unsubscribe: { type: "unsubscribe", tokens: ["2885"] }
Push:        { type: "quote", token: "2885", data: {
               ltp, open, high, low, close, volume, change, changePercent,
               bid, ask, oi, oiChange, timestamp
             }}
```
**Status:** ✅ Protocol exists, but data is simulated.
**Needed:** Connect to Angel One SmartConnect binary WS feed, decode ticks, push through this channel.

### 4.2 Channel: `depth` (Level 2 Market Depth)

```
Subscribe:   { type: "subscribe_depth", tokens: ["2885"] }
Unsubscribe: { type: "unsubscribe_depth", tokens: ["2885"] }
Push:        { type: "depth", token: "2885", data: {
               bids: [{ price, qty, orders }],  // 5 levels
               asks: [{ price, qty, orders }],
               totalBuyQty, totalSellQty
             }}
```
**Status:** ✅ Protocol exists, depth subscription supported.
**Needed:** Live depth from broker WS feed (Angel SmartConnect sends depth in same binary frame).

### 4.3 Channel: `positions` (Position Updates)

```
Subscribe:   { type: "subscribe_positions" }
Push:        { type: "position_update", data: {
               id, symbol, token, segment, productType,
               qty, avgPrice, ltp, pnl, mtm, buyQty, sellQty
             }}
```
**Status:** ❌ Protocol defined in `server/types/index.ts` but NOT implemented.
**Needed:** Push on every tick for subscribed position tokens + push on fill events.

### 4.4 Channel: `orders` (Order Status Updates)

```
Subscribe:   { type: "subscribe_orders" }
Push:        { type: "order_update", data: {
               id, symbol, side, orderType, qty, price,
               filledQty, avgPrice, status, rejectReason, timestamp
             }}
```
**Status:** ❌ Protocol defined in types but NOT implemented.
**Needed:** Push immediately on broker order callback (fill, reject, cancel confirm).

### 4.5 Channel: `trades` (Trade Execution Feed)

```
Subscribe:   { type: "subscribe_trades" }
Push:        { type: "trade_update", data: {
               id, orderId, symbol, side, qty, price, executedAt
             }}
```
**Status:** ❌ Not defined anywhere.
**Needed:** Real-time trade fill notifications separate from order status.

### 4.6 Channel: `challenge-status` (Risk Alerts)

```
Subscribe:   { type: "subscribe_risk" }
Push:        { type: "risk_alert", data: {
               type: "warning" | "breach",
               ruleType: "daily_loss_limit" | "max_drawdown" | ...,
               message, currentValue, limitValue, percentUsed
             }}
Push:        { type: "challenge_update", data: {
               status: "active" | "breached" | "passed",
               dailyPnl, totalPnl, drawdown, remainingToTarget
             }}
```
**Status:** ❌ Type defined (`RiskAlert`) but no streaming implementation.
**Needed:** Push whenever position P&L changes and approaches/breaches limits.

---

## 5. TRADINGVIEW DATAFEED DESIGN

The terminal currently uses Lightweight Charts with manual data loading. For proper integration
(whether keeping Lightweight Charts or upgrading to TradingView Charting Library), a Datafeed
adapter layer is needed.

### 5.1 `resolveSymbol(symbolName)`

```typescript
interface SymbolInfo {
  name: string;              // "RELIANCE"
  full_name: string;         // "NSE:RELIANCE"
  ticker: string;            // "2885" (token)
  exchange: string;          // "NSE"
  listed_exchange: string;   // "NSE"
  type: string;              // "stock" | "futures" | "index"
  session: string;           // "0915-1530"
  timezone: string;          // "Asia/Kolkata"
  has_intraday: boolean;     // true
  has_daily: boolean;        // true
  supported_resolutions: string[]; // ["1","3","5","15","30","60","240","D","W"]
  pricescale: number;        // 100 (for 2 decimals)
  minmov: number;            // 1
  volume_precision: number;  // 0
  data_status: string;       // "streaming"
}
```

**Data source:** `/api/instruments/:token` → returns instrument metadata
**Mapping:** Internal token → exchange:symbol format for chart display

### 5.2 `searchSymbols(userInput, exchange, symbolType)`

```typescript
// Client types: "FW-10001:RELIANCE" → search "REL"
// Returns array of matching instruments

interface SearchResult {
  symbol: string;       // "RELIANCE"
  full_name: string;    // "NSE:RELIANCE"
  description: string;  // "Reliance Industries Ltd"
  exchange: string;     // "NSE"
  ticker: string;       // "2885"
  type: string;         // "stock"
}
```

**Data source:** `/api/instruments/search?q=&exchange=&type=`
**Exists:** ✅ Endpoint works, needs `exchange` and `type` filter params added.

### 5.3 `getBars(symbolInfo, resolution, periodParams)`

```typescript
interface Bar {
  time: number;    // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// periodParams: { from, to, countBack, firstDataRequest }
```

**Data source:** `/api/market/history?token=&tf=&from=&to=`
**Exists:** ✅ Endpoint works. Needs:
- Proper `from`/`to` Unix timestamp filtering (currently generates fixed 500 bars)
- When broker is live: proxy to `AngelOneAdapter.getOHLC()`
- Return `noData: true` when outside available range

### 5.4 `subscribeBars(symbolInfo, resolution, onRealtimeCallback)`

```typescript
// Called after getBars to receive real-time bar updates
// onRealtimeCallback(bar) is called whenever a new tick arrives

// Implementation:
// 1. Subscribe to WS quote channel for this token
// 2. On each tick, build/update the current candle for the active resolution
// 3. Call onRealtimeCallback with the updated bar
// 4. When candle period closes, start new bar

interface BarUpdate {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**Requires:** OHLC candle builder (server-side or client-side)

**Design choice:** Server-side candle building is preferred:
- Consistent candles across all clients
- Survives page refresh (in-progress candle preserved in Redis)
- Required for accurate volume aggregation

### 5.5 `unsubscribeBars(subscriberUID)`

```typescript
// Cleanup: remove WS subscription for the symbol/resolution pair
// Called when chart switches symbol or timeframe
```

---

## 6. REALTIME DATA FLOW (TARGET ARCHITECTURE)

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROKER WEBSOCKET FEEDS (Binary)                                      │
│                                                                        │
│  Angel One SmartConnect          Dhan Market Feed (Backup)            │
│  wss://smartapisocket.angel...   wss://api-feed.dhan.co               │
│  (Binary: 379 bytes/tick)        (Binary: variable)                   │
└────────────┬──────────────────────────────┬───────────────────────────┘
             │                              │
             ▼                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FEED CONNECTOR LAYER (NEW)                                           │
│                                                                        │
│  ┌───────────────────┐    ┌───────────────────┐                       │
│  │ AngelOne WS Feed  │    │ Dhan WS Feed      │                       │
│  │ - Binary decoder  │    │ - Binary decoder   │                       │
│  │ - Token mapping   │    │ - Token mapping    │                       │
│  │ - Reconnect logic │    │ - Reconnect logic  │                       │
│  └────────┬──────────┘    └────────┬──────────┘                       │
│           │ Normalized Quote/Depth  │                                  │
│           └───────────┬─────────────┘                                  │
│                       ▼                                                │
└───────────────────────┼────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  MARKET DATA ENGINE (Enhanced)                                        │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │
│  │ Quote Cache  │  │ OHLC Builder │  │ Depth Aggregator         │    │
│  │ (Redis)      │  │ (per TF)     │  │ (5-level normalized)     │    │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘    │
│         │                 │                       │                    │
│         ▼                 ▼                       ▼                    │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  REDIS PUB/SUB                                               │      │
│  │  Channels: quote:{token} | depth:{token} | ohlc:{token}:{tf}│      │
│  └──────────────────────────┬──────────────────────────────────┘      │
│                             │                                          │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  WEBSOCKET SERVER (Enhanced)                                          │
│                                                                        │
│  Channels served to client:                                           │
│  ├── quote (ltp ticks)                                                │
│  ├── depth (L2 book)                                                  │
│  ├── ohlc (candle updates per subscribed resolution)                  │
│  ├── order_update (fill/reject/cancel events)                         │
│  ├── position_update (MTM recalc on tick)                             │
│  ├── risk_alert (threshold warnings)                                  │
│  └── challenge_update (status changes)                                │
│                                                                        │
│  Features:                                                            │
│  ├── JWT auth on connection                                           │
│  ├── Per-client subscription tracking                                 │
│  ├── Server heartbeat (30s ping)                                      │
│  ├── Max subscription limit (50 tokens/client)                        │
│  └── Graceful disconnect cleanup                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Browser)                                                   │
│                                                                        │
│  WebSocket Client (existing) → Zustand Store → React Components       │
│  + TradingView Datafeed Adapter (subscribeBars uses ohlc channel)     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. OHLC CANDLE BUILDER DESIGN

The candle builder is the most critical missing piece for `subscribeBars`.

```
Input: Stream of LTP ticks { token, ltp, volume, timestamp }

Per token, per timeframe:
┌─────────────────────────────────────────────────────────┐
│  CandleBuilder                                           │
│                                                           │
│  State (in Redis):                                       │
│    key: ohlc:{token}:{tf}:current                        │
│    value: { time, open, high, low, close, volume }       │
│                                                           │
│  On tick:                                                │
│    1. Determine candle boundary for timestamp+tf         │
│    2. If same period → update high/low/close/volume      │
│    3. If new period → emit completed candle, start new   │
│    4. Publish updated candle to Redis channel            │
│                                                           │
│  Supported timeframes: 1,3,5,15,30,60,240,D,W           │
│  Only build candles for actively subscribed TF/token     │
└─────────────────────────────────────────────────────────┘
```

---

## 8. BROKER WEBSOCKET FEED REQUIREMENTS

### 8.1 Angel One SmartConnect

| Item | Detail |
|------|--------|
| URL | `wss://smartapisocket.angelone.in/smart-stream` |
| Auth | `feedToken` from login response (already obtained in adapter) |
| Protocol | Binary frames (not JSON) |
| Tick size | ~379 bytes per LTP packet |
| Modes | LTP (1), Quote (2), Snap Quote (3) |
| Subscription | Binary message: mode + exchange + list of tokens |
| Max tokens | 50 per connection |
| Heartbeat | Server sends ping every 30s, client must respond |

**Required implementation:**
- Binary frame parser (Buffer → Quote object)
- Multi-connection manager (for >50 token subscriptions)
- Mode switching (LTP for watchlist, SnapQuote for active chart)
- Reconnection with re-auth on feed token expiry

### 8.2 Dhan Market Feed

| Item | Detail |
|------|--------|
| URL | `wss://api-feed.dhan.co` |
| Auth | Access token header |
| Protocol | Binary (protobuf-like) |
| Subscription | JSON subscribe message with instrument list |
| Max tokens | 100 per connection |

**Required implementation:**
- Binary decoder for Dhan's custom format
- Separate token mapping (Dhan uses different instrument IDs)
- Can serve as failover feed if Angel One disconnects

---

## 9. IMPLEMENTATION PRIORITY (Recommended Order)

| Priority | Task | Depends On | Estimated Effort |
|----------|------|-----------|-----------------|
| P0 | Wire `routes/websocket.js` (auth) into `index.js` | — | 1 hour |
| P0 | Redis connection + quote cache service | — | 2 hours |
| P1 | Angel One SmartConnect binary feed connector | Angel creds | 1 day |
| P1 | OHLC Candle Builder service | Redis | 4 hours |
| P1 | TradingView Datafeed adapter (client-side) | Candle builder | 4 hours |
| P2 | Order/Position WS channels | Trading engine | 4 hours |
| P2 | Challenge status / risk alert streaming | Risk engine | 4 hours |
| P2 | `/api/instruments/:token` endpoint | — | 1 hour |
| P2 | `/api/market/config` + `/api/market/time` | — | 30 min |
| P3 | Dhan feed connector (backup) | Dhan creds | 1 day |
| P3 | Feed failover logic | Both feeds | 4 hours |
| P3 | Server heartbeat + dead connection cleanup | — | 2 hours |

---

## 10. SUMMARY

### What works today:
- WebSocket transport layer (client ↔ server) — protocol is solid
- Pub/sub pattern in MarketDataEngine — ready to receive real feeds
- Client-side Zustand integration — quote/depth updates flow to UI
- Angel One REST adapter — can fetch quotes, history, depth on demand

### What's missing for live trading:
1. **No live data feed** — SmartConnect binary WS connector doesn't exist
2. **No candle building** — charts can't show real-time bar updates properly
3. **No Redis** — quotes don't persist, can't scale, no pub/sub backbone
4. **No order/position streaming** — users poll REST instead of getting push updates
5. **No risk streaming** — challenge breach alerts don't reach the frontend in realtime
6. **No auth on WS** — production handler exists but isn't wired in

### Architecture is sound, implementation is incomplete.
The interfaces (`types/index.ts`, `broker.interface.ts`, `marketdata.engine.ts`) correctly define
the target system. The gap is purely in wiring live broker feeds to the existing pub/sub skeleton.

---

*Generated by Agent C — Realtime Architecture Audit*
*Date: 2026-06-18*
