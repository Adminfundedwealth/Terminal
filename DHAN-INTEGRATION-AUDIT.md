# Dhan Integration Audit Report

**Date:** 2026-08-17  
**Scope:** Non-destructive audit of Dhan API setup, endpoints, WebSocket, data parsers, token handling  
**Status:** PLACEHOLDER ONLY — No functional Dhan integration exists  

---

## 1. Existing Dhan Files & Architecture Overview

### File Inventory

| # | File Path | Purpose | Status |
|---|-----------|---------|--------|
| 1 | `server/brokers/dhan/dhan.adapter.js` | Broker adapter (IBrokerAdapter impl) | ❌ Placeholder — all methods throw "not implemented" |
| 2 | `server/brokers/dhan/dhan.types.js` | Exchange segments, order types, status maps | ✅ Defined (constants only, no logic) |
| 3 | `server/brokers/broker.factory.js` | Factory routing — has `case 'dhan'` | ⚠️ Throws error "Dhan adapter not yet implemented" |
| 4 | `server/brokers/broker.factory.ts` | TypeScript version of factory | ⚠️ Same — throws error for `'dhan'` case |
| 5 | `server/brokers/index.js` | Central export barrel | ✅ Exports `DhanAdapter` from `./dhan/dhan.adapter.js` |
| 6 | `server/brokers/broker.manager.js` | Top-level orchestrator | References `'dhan'` as `secondaryProvider` |
| 7 | `server/brokers/broker.failover.service.js` | Health-based failover | Routes Angel→Dhan on degradation |
| 8 | `server/brokers/failover.engine.js` | Retry+failover executor | Falls back to `'dhan'` after primary exhaustion |
| 9 | `server/brokers/broker.health.service.js` | Health monitor | Tracks Dhan in per-broker health map |
| 10 | `server/.env.example` | Env template | Lists `DHAN_ACCESS_TOKEN` and `DHAN_CLIENT_ID` (commented) |

### Architecture Position

```
┌──────────────────────────────────────────────────────────────┐
│                   BROKER LAYER                                │
│                                                              │
│  BrokerManager                                               │
│    ├── BrokerFactory                                         │
│    │     ├── AngelOneAdapter    ← IMPLEMENTED (primary)      │
│    │     └── DhanAdapter        ← PLACEHOLDER (secondary)   │
│    ├── BrokerHealthService                                   │
│    └── BrokerFailoverService (Angel → Dhan switching logic)  │
└──────────────────────────────────────────────────────────────┘
```

**Verdict:** Dhan is architecturally designated as the secondary/failover broker. The adapter file exists with correct structure but every method throws. It is never instantiated at runtime.

---

## 2. Current Token Flow & Longevity Status

### Credential Configuration

| Variable | In `.env`? | In `.env.example`? | In Adapter Code? |
|----------|-----------|---------------------|------------------|
| `DHAN_CLIENT_ID` | ❌ Not set | ✅ Listed (commented) | ✅ Read via `process.env.DHAN_CLIENT_ID` |
| `DHAN_ACCESS_TOKEN` | ❌ Not set | ✅ Listed (commented) | ✅ Read via `process.env.DHAN_ACCESS_TOKEN` |
| `DHAN_API_KEY` | ❌ N/A | ❌ Not listed | ❌ Not referenced |
| `DHAN_API_SECRET` | ❌ N/A | ❌ Not listed | ❌ Not referenced |

### Token Lifecycle Analysis

| Aspect | Current State |
|--------|--------------|
| Token Source | Pre-generated via Dhan developer portal (hardcoded 24h validity) |
| Token Refresh | **NONE** — `refreshSession()` explicitly throws: _"Token refresh not supported. Regenerate from Dhan app."_ |
| `/v2/RenewToken` Usage | ❌ Not implemented, not referenced anywhere |
| API Key/Secret Consent Flow | ❌ Not implemented |
| Cron Job for Renewal | ❌ Does not exist |
| Session Expiry Handling | Hardcoded: `Date.now() + 24 * 60 * 60 * 1000` — purely cosmetic, never validated |

**Risk:** If Dhan were activated today, the token would silently expire after 24 hours with no automatic recovery. All subsequent API calls would fail with 401 until manual regeneration.

---

## 3. Identified Root Causes for Chart Glitches & Option Chain Loading Hangs

### 3A. Chart/Candlestick Data — NO Dhan Involvement

The `CandleService` (`server/services/candleService.js`) exclusively uses **Angel One** APIs:
- Endpoint: `POST /rest/secure/angelbroking/historical/v1/getCandleData`
- Auth: Angel One JWT (`Bearer` token + `X-PrivateKey`)
- No Dhan endpoint (`/v2/charts/historical`, `/v2/charts/intraday`) is called anywhere in the codebase

**Dhan is NOT a root cause of chart glitches.** Any vertical candlestick anomalies originate from:

| Potential Cause | Location | Explanation |
|-----------------|----------|-------------|
| Missing OHLC validity filter | `candleService.js` L130-140 | Filter rejects candles where `high < low`, `open=0`, etc. — good. But does NOT catch `open > high` or `close > high` edge cases from bad API data |
| Timestamp conversion | `candleService.js` L128 | `Math.floor(new Date(c[0]).getTime() / 1000)` — relies on Angel returning valid ISO timestamps. If Angel returns epoch ms or malformed strings, candles stack vertically at `time=NaN` |
| 4H/Weekly aggregation gap | `candleService.js` L37-38 | `'240': 'ONE_HOUR'` and `'W': 'ONE_DAY'` — fetches lower-res data but does NOT aggregate into higher timeframes. Frontend may receive 1H candles when 4H was requested |
| Volume delta on first tick | `candleService.js` L162 | First tick of day uses full cumulative volume — could produce volume spike artifact |

### 3B. Option Chain — NO Dhan Involvement

The `OptionChainService` (`server/services/optionChainService.js`) exclusively uses **Angel One** APIs:
- Search: `POST /rest/secure/angelbroking/order/v1/searchScrip`
- Quotes: `POST /rest/secure/angelbroking/market/v1/quote/`
- Auth: Angel One JWT

**Dhan's `getOptionChain()` method just throws.** It is never called.

**Potential loading hang causes (all Angel One related):**

| Potential Cause | Location | Explanation |
|-----------------|----------|-------------|
| Expiry discovery scanning | `optionChainService.js` L186-220 | Scans up to 90 candidate dates via sequential batches of 5 API calls with 100ms gaps. On cold cache, this can take 5-15 seconds. |
| Token unavailable → silent empty | `optionChainService.js` L109-112 | If JWT is missing, returns `[]` silently. Frontend sees empty data, may retry in a loop. |
| 503 retry loop | `routes/api.js` L729-731 | Route returns 503 when no JWT. Frontend retries — but if Angel auth never completes, this loops indefinitely. |
| Batch quote timeout | `optionChainService.js` L397 | 6-second timeout per batch. With 200+ instruments split into 4+ batches, sequential delay accumulates. |
| No Greeks computation | — | Greeks (Delta, Theta, Gamma, Vega, IV) are **not computed or served**. Only LTP, Volume, OI, Bid, Ask are in the chain response. Frontend expecting Greeks gets `undefined`. |

---

## 4. Real-Time WebSocket Streaming — Dhan Status

### Current Implementation: NONE

| Component | Status |
|-----------|--------|
| `dhan.websocket.js` / `dhan.websocket.ts` | ❌ File does not exist |
| WS Connection URL | Defined in adapter comments only: `wss://api-feed.dhan.co` |
| Connection Parameters | Documented: `?version=2&token=<token>&clientId=<id>&authType=2` |
| Binary Packet Parser | ❌ Not implemented |
| Subscription Request Codes (15/17/21) | ❌ Not implemented |
| Reconnection Handler | ❌ Not implemented |

**The terminal uses Angel One SmartConnect WebSocket exclusively for real-time ticks.** Dhan feed is purely aspirational.

---

## 5. Step-by-Step Fix Recommendations (For Review Before Execution)

### Priority 0 — Critical (Required for Dhan activation)

| # | Action | Details |
|---|--------|---------|
| 1 | **Implement Dhan token renewal** | Either: (a) Integrate `/v2/RenewToken` API in a cron (every 23h), or (b) Implement API Key + Secret consent-based flow for long-lived tokens |
| 2 | **Implement `dhan.adapter.js` methods** | Start with `connect()` (validate token via `GET /v2/profile`), `getQuotes()`, `getOHLC()` |
| 3 | **Create `dhan.websocket.js`** | WebSocket client for `wss://api-feed.dhan.co`, binary packet unpacker, subscription management (Request Codes 15/17/21), auto-reconnect |
| 4 | **Set `.env` credentials** | Add `DHAN_CLIENT_ID` and `DHAN_ACCESS_TOKEN` to production/staging `.env` |
| 5 | **Wire BrokerFactory** | Uncomment DhanAdapter import, remove `throw` in `case 'dhan'` |

### Priority 1 — Chart Glitch Fixes (Angel One, NOT Dhan)

| # | Action | Details |
|---|--------|---------|
| 6 | **Add 4H/Weekly aggregation** | In `candleService.js`, aggregate 1H→4H and 1D→1W candles before returning |
| 7 | **Strengthen OHLC validation** | Add checks: `open <= high`, `close <= high`, `open >= low`, `close >= low`, reject `time === NaN` |
| 8 | **Handle malformed timestamps** | Wrap `new Date(c[0])` with fallback: if result is `Invalid Date`, skip the candle |

### Priority 2 — Option Chain Loading Fixes (Angel One, NOT Dhan)

| # | Action | Details |
|---|--------|---------|
| 9 | **Add loading timeout to frontend** | If option chain returns empty after 10s, show "No data available" instead of infinite spinner |
| 10 | **Reduce expiry scan scope** | Limit to 30 days instead of 90 for faster cold-start |
| 11 | **Add Greeks computation** | Implement Black-Scholes IV + Greeks calculator server-side, attach to chain response |
| 12 | **Fix 503 retry loop** | Frontend should cap retries at 3 with exponential backoff, then show error state |

### Priority 3 — Failover Activation

| # | Action | Details |
|---|--------|---------|
| 13 | **End-to-end failover test** | After Dhan adapter is complete, test `BrokerManager.execute()` with primary killed |
| 14 | **Instrument token mapping** | Create `angel_token ↔ dhan_security_id` mapping table (they use different IDs) |
| 15 | **Health endpoint** | Surface Dhan health in `/api/health` once adapter is live |

---

## Summary

| Dimension | Finding |
|-----------|---------|
| Dhan Implementation Status | **PLACEHOLDER ONLY** — 0% functional |
| Dhan Active at Runtime | **NO** — never instantiated, never called |
| Chart Glitches Related to Dhan | **NO** — exclusively Angel One data path |
| Option Chain Hangs Related to Dhan | **NO** — exclusively Angel One data path |
| Token Refresh Mechanism | **ABSENT** — manual 24h tokens only |
| WebSocket Feed | **NOT IMPLEMENTED** — file doesn't exist |
| Files Safe to Proceed With | `dhan.adapter.js`, `dhan.types.js` (both need implementation, no existing logic to break) |

**No code was modified during this audit.**
