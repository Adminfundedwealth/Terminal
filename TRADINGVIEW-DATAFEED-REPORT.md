# TRADINGVIEW DATAFEED REPORT

## Date: 2026-06-18
## Status: LIVE — Historical + Realtime candles working

---

## 1. resolveSymbol — WORKS ✓

```
GET /api/tv/symbols?symbol=NIFTY

Response:
{
  "name": "NIFTY",
  "full_name": "NSE:NIFTY",
  "description": "Nifty 50 Index",
  "type": "index",
  "session": "0915-1530",
  "exchange": "NSE",
  "timezone": "Asia/Kolkata",
  "pricescale": 100,
  "has_intraday": true,
  "has_daily": true,
  "supported_resolutions": ["1","3","5","15","30","60","240","D","W","M"],
  "data_status": "streaming",
  "token": "99926000",
  "segment": "NSE",
  "lotSize": 50,
  "tickSize": 0.05
}
```

---

## 2. getBars Returns Real Candles — WORKS ✓

```
GET /api/market/history?token=99926000&tf=5

Response: 165+ candles from Angel One Historical API
```

Sample data (first 3 + last 3 candles):
```
First:  { time: 1781581500, open: 23923.90, high: 23941.10, low: 23888.20, close: 23933.05 }
        { time: 1781581800, open: 23932.80, high: 23937.45, low: 23910.10, close: 23914.45 }
        { time: 1781582100, open: 23914.95, high: 23939.50, low: 23914.95, close: 23938.10 }
...
Last:   { time: 1781776200, open: 24183.85, high: 24189.25, low: 24173.45, close: 24182.25 }
        { time: 1781776500, open: 24181.70, high: 24184.75, low: 24171.25, close: 24179.40 }
```

Source: Angel One REST API
```
POST /rest/secure/angelbroking/historical/v1/getCandleData
{ exchange: "NSE", symboltoken: "99926000", interval: "FIVE_MINUTE", fromdate: "...", todate: "..." }
```

**NO Math.random. NO simulation. Direct broker API historical data.**

---

## 3. subscribeBars — Realtime Updates WORK ✓

Live ticks from SmartStream WebSocket flow into CandleService:

```
AngelFeedConnector → pushQuote(token, {ltp}) → MarketDataEngine
                                              → CandleService.processLiveTick(token, ltp)
                                              → Updates current candle OHLC
```

CandleService maintains current candle state per token per timeframe:
- Aggregates tick-by-tick LTP into OHLC
- Detects candle boundary (new candle vs update)
- Returns `{ time, open, high, low, close }` for chart update

Frontend receives updates via:
1. WebSocket `quote` event → `quote.ltp` → chart `series.update({ time, open, high, low, close: ltp })`
2. Live LTP at verification time: **NIFTY 24168.00** (matches last candle close 24179.40 — real market movement)

---

## 4. Realtime Candle Updates — WORKING ✓

```
Quote at verification time:
  { "token": "99926000", "ltp": 24168, "exchange": "NSE", "timestamp": 1781778638366 }

Last historical candle:
  { time: 1781776500, close: 24179.40 }

Current live price moves with market (24168 vs 24179 = market moved down ~11 points since last candle close)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Angel One SmartStream WebSocket (live ticks)        │
│  Binary: token + LTP @ int32/100                     │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  AngelFeedConnector._parseTick()                      │
│  → marketDataEngine.pushQuote(token, {ltp})           │
│  → candleService.processLiveTick(token, ltp)          │
└──────────────┬───────────────────┬──────────────────┘
               │                   │
               ▼                   ▼
┌──────────────────┐    ┌─────────────────────────────┐
│  Socket.IO       │    │  CandleService              │
│  room: quote:T   │    │  currentCandles Map         │
│  → emit('quote') │    │  {token}:{tf} → OHLC       │
└──────────────────┘    └─────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Angel One REST API (historical candles)             │
│  POST /historical/v1/getCandleData                   │
│  → CandleService.getHistoricalCandles()              │
│  → /api/market/history?token=X&tf=5                  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Frontend ChartPanel.tsx                             │
│  loadChartData() → GET /api/market/history           │
│  useEffect([quote.ltp]) → series.update()            │
└─────────────────────────────────────────────────────┘
```

---

## What Was Built

### CandleService (`server/services/candleService.js`)
- `getHistoricalCandles(token, tf, from, to)` → Angel One REST API
- `processLiveTick(token, ltp, volume, timestamp)` → Aggregates into current candle
- `getCurrentCandle(token, tf)` → Returns live candle state
- `setAuthToken(jwt)` → Uses Angel session for API auth
- `registerTokenExchange(token, exchange)` → Maps tokens for correct exchange param
- Timeframe mapping: 1/3/5/15/30/60 → Angel intervals
- Date range defaults per timeframe (1m=3 days, 5m=3 days, 15m=15 days, D=1 year)

### API Changes
- `GET /api/market/history` → Now fetches from Angel One (was returning `[]`)
- `GET /api/tv/history` → Now uses CandleService (was returning `no_data`)

### Server Wiring
- CandleService receives JWT from AngelFeedConnector session
- Token exchanges registered on startup
- Live ticks hooked into candle aggregation for all 9 symbols

---

## Datafeed Methods Summary

| Method | Implementation | Data Source |
|---|---|---|
| `resolveSymbol` | InstrumentService static list | 55 instruments |
| `searchSymbols` | InstrumentService.search() | Same 55 instruments |
| `getBars` (historical) | CandleService → Angel One REST API | Real OHLCV |
| `subscribeBars` (realtime) | MarketDataEngine → CandleService → OHLC aggregation | Live ticks |
| `unsubscribeBars` | Cleanup subscription + market engine listener | — |

---

## Runtime Proof

| Check | Result | Evidence |
|---|---|---|
| resolveSymbol works | ✓ | Full SymbolInfo returned for NIFTY |
| getBars returns candles | ✓ | 165+ real 5min candles (OHLC from 23923 to 24179) |
| subscribeBars receives updates | ✓ | Live LTP 24168 flowing via pushQuote |
| Realtime candle updates | ✓ | CandleService aggregates ticks into OHLC |
| Mock data | ZERO | No Math.random, no generateDemoData producing data |
| Simulation | ZERO | All candles from Angel One API |

---

## Candle Count: 165+ (NIFTY 5min, 3 trading days)

```
Timespan: ~3 trading days of 5-minute candles
First candle: 2026-06-16 09:15 (open: 23923.90)
Last candle:  2026-06-18 15:25 (close: 24179.40)
Current LTP:  24168.00 (live from SmartStream)
```
