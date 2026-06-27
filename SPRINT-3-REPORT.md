# SPRINT 3 — Realtime Layer Report

## Status: COMPLETE

## What Was Done

### 1. Socket.IO Server (`server/realtime/socketio.server.js`)
- Full Socket.IO implementation alongside legacy WebSocket (ws)
- JWT authentication via middleware (cookie, handshake auth, query param)
- Room-based subscriptions:
  - `quote:{token}` — Real-time LTP updates
  - `depth:{token}` — Market depth updates
  - `account:{accountId}` — Order/position/risk updates
- Client event handlers: subscribe, unsubscribe, subscribe_depth, unsubscribe_depth, ping
- Server broadcasts: quote, depth, order_update, position_update, risk_alert, market_status
- Market data engine bridge: pushQuote/pushDepth auto-broadcast to subscribed rooms
- Connection tracking with client count

### 2. Redis Pub/Sub Integration (`server/realtime/redis.pubsub.js`)
- Horizontal scaling support (multiple server instances)
- Channel schema: `fw:quote:{token}`, `fw:depth:{token}`, `fw:order:{accountId}`, `fw:risk:{accountId}`
- Graceful no-op when REDIS_URL not configured (single-instance mode)
- Cache helpers: `setCache(key, value, ttl)`, `getCache(key)`
- Pattern-based subscription with pmessage handler
- Clean shutdown with `quit()` on both publisher and subscriber

### 3. TradingView Datafeed Layer (`server/realtime/tradingview.datafeed.js`)

#### resolveSymbol(symbolName)
- Converts symbol name to TradingView SymbolInfo object
- Maps segment to session times (NSE: 0915-1530, MCX: 0900-2330, CDS: 0900-1700)
- Calculates pricescale from tickSize
- Returns token, segment, lotSize for internal use

#### searchSymbols(query, type, exchange)
- Full-text search against instrument service
- Filters by type (stock/futures/option/index) and exchange
- Returns TradingView-compatible symbol descriptor array

#### getBars(token, resolution, from, to)
- Fetches historical OHLCV from market data engine
- Sorts by time ascending, filters by range
- Converts to millisecond timestamps (TradingView requirement)
- Returns `{ bars, noData }` format

#### subscribeBars(token, resolution, callback)
- Real-time bar construction from tick-by-tick quotes
- Maintains last bar state (OHLC aggregation per resolution)
- Returns subscription GUID for cleanup
- Bridges market data engine subscribe → bar callback

#### unsubscribeBars(guid)
- Cleans up subscription and unsubscribes from market data engine

### 4. REST Endpoints for TradingView UDF Protocol

| Endpoint | Purpose | Status |
|---|---|---|
| GET `/api/tv/config` | Supported resolutions, exchanges | ✓ Working |
| GET `/api/tv/symbols?symbol=X` | Resolve symbol info | ✓ Working |
| GET `/api/tv/search?query=X` | Search symbols | ✓ Working |
| GET `/api/tv/history?symbol=X&resolution=5&from=&to=` | Historical OHLCV | ✓ Working |

## Runtime Evidence

```
Startup log:
[Startup] ✓ Socket.IO server initialized
[Startup] ✓ Socket.IO on http://localhost:4000/socket.io

GET /api/tv/config → 200 { supported_resolutions: [...], exchanges: [...] }
GET /api/tv/symbols?symbol=NIFTY → 200 { name: "NIFTY", type: "index", timezone: "Asia/Kolkata", ... }
GET /api/tv/search?query=bank → 200 [10 results with symbol, description, type, ticker]
```

## Architecture

```
Broker WebSocket Feed
        │
        ▼
┌─────────────────────┐
│  MarketDataEngine   │  ← pushQuote(token, data)
│  (in-memory cache)  │  ← pushDepth(token, data)
└────────┬────────────┘
         │
    ┌────┴─────────────────────────┐
    │                              │
    ▼                              ▼
┌──────────────┐         ┌──────────────────┐
│  Socket.IO   │         │  Redis Pub/Sub   │
│  (rooms)     │         │  (fw:quote:*)    │
│              │         │                  │
│ quote:{tok}  │         │  ↕ other nodes   │
│ depth:{tok}  │         │                  │
│ account:{id} │         └──────────────────┘
└──────────────┘
        │
        ▼
    Frontend
```

## NOT CLAIMED

- ❌ No live market data flowing (no broker adapter connected)
- ❌ Redis NOT connected (REDIS_URL not set — single-instance is fine for dev)
- ❌ TradingView getBars returns empty (no historical data source without broker)

## Files Created

- `server/realtime/socketio.server.js`
- `server/realtime/redis.pubsub.js`
- `server/realtime/tradingview.datafeed.js`
- `server/realtime/index.js`
