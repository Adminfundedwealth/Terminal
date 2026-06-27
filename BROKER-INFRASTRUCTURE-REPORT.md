# BROKER INFRASTRUCTURE REPORT

**Date:** 2026-06-18  
**Scope:** Backend broker architecture audit — Angel One (Primary) + Dhan (Secondary)  
**Status:** Architecture designed, partial implementation exists, integration incomplete

---

## 1. CURRENT STATE

### 1.1 What Exists

| Component | File | Language | Status |
|-----------|------|----------|--------|
| Broker Interface (Abstract) | `server/brokers/broker.interface.ts` | TypeScript | ✅ Complete |
| Broker Factory | `server/brokers/broker.factory.ts` | TypeScript | ⚠️ Scaffold only (all cases throw) |
| Type Definitions | `server/types/index.ts` | TypeScript | ✅ Complete (IBrokerAdapter, all DTOs) |
| Angel One Adapter | `server/brokers/angelone/angelone.adapter.js` | JavaScript | ✅ Fully implemented (REST) |
| Dhan Adapter | `server/brokers/dhan/` | — | ❌ Empty directory |
| MarketDataEngine (runtime) | `server/services/marketDataEngine.js` | JavaScript | ✅ Working (pub/sub, adapter hookup) |
| MarketDataEngine (spec) | `server/engines/marketdata.engine.ts` | TypeScript | ✅ Interface defined |
| Trading Engine (spec) | `server/engines/trading.engine.ts` | TypeScript | ✅ Interface defined |
| Risk Engine (spec) | `server/engines/risk.engine.ts` | TypeScript | ✅ Interface defined |
| Position Engine (spec) | `server/engines/position.engine.ts` | TypeScript | ✅ Interface defined |
| BrokerService (mock) | `server/services/brokerService.js` | JavaScript | ⚠️ Hardcoded stub data |
| API Routes | `server/routes/api.js` | JavaScript | ✅ Working (uses accountService) |

### 1.2 Architecture Diagram (Current)

```
Frontend (React/Vite)
    │
    ▼ HTTP/WS
┌───────────────────────────────────────────────────┐
│  Express Server (server/index.js)                 │
│  ├── routes/api.js                                │
│  ├── middleware/auth.js (JWT, brokerProvider)      │
│  ├── services/accountService.js                   │
│  ├── services/brokerService.js ← MOCK (stub data) │
│  ├── services/marketDataEngine.js ← LIVE engine   │
│  └── brokers/                                     │
│       ├── broker.interface.ts   ← CONTRACT        │
│       ├── broker.factory.ts     ← NOT WIRED       │
│       ├── angelone/             ← IMPLEMENTED     │
│       └── dhan/                 ← EMPTY           │
└───────────────────────────────────────────────────┘
```

### 1.3 Key Observations

1. **Language Mismatch:** Factory/Interface are TypeScript, but Angel One adapter is plain JavaScript. The server runs as `node index.js` with no TypeScript compilation step. The `.ts` engine files are design specs only.

2. **Factory Not Wired:** `BrokerFactory.create()` throws for all providers. The actual `AngelOneAdapter` class exists but is not imported or instantiated.

3. **Mock Layer Active:** `brokerService.js` returns hardcoded positions/orders/trades. The frontend currently consumes this mock data through `accountService`.

4. **MarketDataEngine Ready:** The runtime JS version (`services/marketDataEngine.js`) has a clean `connectAdapter(adapter)` method — any adapter conforming to `subscribeQuotes/unsubscribeQuotes` will plug in.

5. **No Failover Logic:** Zero infrastructure for automatic broker switching, health checks, or redundancy.

6. **No WebSocket Feed Adapter:** Angel One adapter only implements REST polling. No SmartAPI WebSocket feed integration for real-time ticks.

---

## 2. MISSING COMPONENTS

### 2.1 Critical (Required for Go-Live)

| # | Component | Description | Priority |
|---|-----------|-------------|----------|
| 1 | **Dhan Adapter** | Full implementation of IBrokerAdapter for DhanHQ API | P0 |
| 2 | **Factory Wiring** | Connect AngelOneAdapter + DhanAdapter to BrokerFactory | P0 |
| 3 | **Failover Manager** | Automatic Angel→Dhan / Dhan→Angel switching | P0 |
| 4 | **WebSocket Feed (Angel)** | SmartAPI WebSocket for real-time ticks (currently REST-only) | P0 |
| 5 | **WebSocket Feed (Dhan)** | DhanHQ WebSocket feed integration | P0 |
| 6 | **Health Monitor** | Periodic heartbeat checks on each broker connection | P0 |
| 7 | **Session Manager** | Centralized session lifecycle (connect/refresh/expire) | P0 |

### 2.2 Important (Required for Production Stability)

| # | Component | Description | Priority |
|---|-----------|-------------|----------|
| 8 | **Circuit Breaker** | Rate limiting + error threshold → trip broker offline | P1 |
| 9 | **Request Queue** | Order queue with retry semantics during failover | P1 |
| 10 | **Credential Vault** | Secure multi-account credential storage (encrypted at rest) | P1 |
| 11 | **Instrument Sync** | Daily download/sync of broker instrument master files | P1 |
| 12 | **Token Mapper** | Map internal tokens ↔ Angel tokens ↔ Dhan tokens | P1 |
| 13 | **Reconnection Logic** | Auto-reconnect WebSocket feeds on disconnect | P1 |
| 14 | **Audit Logger** | Log every broker API call/response for compliance | P1 |

### 2.3 Nice-to-Have (Post-Launch)

| # | Component | Description | Priority |
|---|-----------|-------------|----------|
| 15 | **Load Balancer** | Distribute requests across brokers when both healthy | P2 |
| 16 | **Latency Monitor** | Track per-broker response times for routing decisions | P2 |
| 17 | **Multi-Account Router** | Route different user accounts to different brokers | P2 |

---

## 3. INTEGRATION COMPLEXITY

### 3.1 Angel One SmartAPI

| Aspect | Detail | Complexity |
|--------|--------|------------|
| Auth | API Key + Client ID + Password + TOTP (OTP changes every 30s) | Medium |
| REST API | Well-documented, standard endpoints | Low |
| WebSocket | Binary protocol, custom framing, requires feedToken | High |
| Rate Limits | 10 req/sec (market data), 1 req/sec (orders) | Medium |
| Instrument Master | ~80K instruments, JSON download daily | Low |
| Option Chain | No direct API — must build from instrument list + individual quotes | High |
| Token Format | Numeric string (`"2885"` for RELIANCE) | Low |

**SDK/Libraries Available:** `smartapi-javascript` (official, but outdated). Better to use raw `axios` as already done.

### 3.2 Dhan HQ API

| Aspect | Detail | Complexity |
|--------|--------|------------|
| Auth | Access Token (generated from web portal, valid ~24h) + Client ID | Low |
| REST API | Clean RESTful design, good documentation | Low |
| WebSocket | JSON-based, simpler than Angel's binary protocol | Medium |
| Rate Limits | 25 req/sec (generous) | Low |
| Instrument Master | CSV download, ~60K instruments | Low |
| Option Chain | Direct API endpoint available (`/optionchain`) | Low |
| Token Format | Numeric integer (`1333` for HDFC Bank) | Low |

**SDK/Libraries Available:** `dhan-js` (community). Raw HTTP preferred for control.

### 3.3 Complexity Comparison

```
                Angel One    Dhan
Authentication:   ████░░       ██░░░░    (Angel needs TOTP generation)
Market Data WS:   █████░       ███░░░    (Angel binary, Dhan JSON)
REST API:         ███░░░       ██░░░░    (Both straightforward)
Option Chain:     █████░       ██░░░░    (Angel has no direct API)
Rate Limits:      ████░░       ██░░░░    (Angel more restrictive)
Documentation:    ███░░░       ████░░    (Dhan cleaner docs)
─────────────────────────────────────────
Overall:          HIGH         MEDIUM
```

---

## 4. REQUIRED METHODS (IBrokerAdapter Contract)

Every broker adapter must implement these methods as defined in `broker.interface.ts`:

### Authentication
```
connect(credentials: BrokerCredentials) → BrokerSession
disconnect() → void
refreshSession() → BrokerSession
```

### Market Data
```
getQuotes(tokens: string[]) → Quote[]
getOHLC(params: OHLCRequest) → OHLC[]
getDepth(token: string) → MarketDepth
getOptionChain(params: OptionChainRequest) → OptionChainEntry[]
```

### Trading
```
placeOrder(order: OrderRequest) → OrderResponse
modifyOrder(orderId, params: ModifyOrderRequest) → OrderResponse
cancelOrder(orderId: string) → CancelResponse
```

### Portfolio
```
getPositions() → Position[]
getOrders() → Order[]
getTrades() → Trade[]
getFunds() → FundsData
```

### Instruments
```
getInstruments() → Instrument[]
getOptionInstruments(underlying, expiry) → Instrument[]
```

### Other
```
getMarginRequired(order: OrderRequest) → { required, available }
getHoldings() → any[]
onOrderUpdate(callback) → void
subscribeQuotes(tokens, callback) → void
subscribeDepth(tokens, callback) → void
unsubscribe(tokens) → void
```

**Angel One Adapter Coverage:**
- ✅ connect, disconnect, refreshSession
- ✅ getQuotes, getOHLC, getDepth
- ⚠️ getOptionChain (returns empty array — needs instrument-based build)
- ✅ placeOrder, modifyOrder, cancelOrder
- ✅ getPositions, getOrders, getTrades, getFunds
- ✅ getHoldings
- ❌ subscribeQuotes (WebSocket not implemented)
- ❌ subscribeDepth (WebSocket not implemented)
- ❌ unsubscribe
- ❌ onOrderUpdate
- ❌ getInstruments
- ❌ getOptionInstruments
- ❌ getMarginRequired

---

## 5. FAILOVER DESIGN

### 5.1 Architecture: Angel (Primary) ↔ Dhan (Secondary)

```
┌─────────────────────────────────────────────────────────────────┐
│                    FAILOVER MANAGER                              │
│                                                                 │
│  ┌──────────────┐        ┌──────────────┐                      │
│  │  Angel One   │◄──────►│    Dhan      │                      │
│  │  (PRIMARY)   │        │ (SECONDARY)  │                      │
│  └──────────────┘        └──────────────┘                      │
│         │                        │                              │
│         ▼                        ▼                              │
│  ┌──────────────┐        ┌──────────────┐                      │
│  │Health Monitor│        │Health Monitor│                       │
│  │ • Heartbeat  │        │ • Heartbeat  │                      │
│  │ • Error Rate │        │ • Error Rate │                      │
│  │ • Latency    │        │ • Latency    │                      │
│  └──────────────┘        └──────────────┘                      │
│                                                                 │
│  State Machine:                                                 │
│  ┌─────────┐  failure  ┌──────────┐  recovery  ┌─────────┐   │
│  │ ANGEL   │──────────►│   DHAN   │───────────►│ ANGEL   │   │
│  │ ACTIVE  │           │  ACTIVE  │            │ ACTIVE  │   │
│  └─────────┘           └──────────┘            └─────────┘   │
│       │                      │                                  │
│       │  both fail           │  both fail                       │
│       ▼                      ▼                                  │
│  ┌──────────────────────────────────┐                           │
│  │         DEGRADED MODE            │                           │
│  │  • Reject new orders             │                           │
│  │  • Cache last known prices       │                           │
│  │  • Alert admin                   │                           │
│  └──────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Failover Rules

| Condition | Action |
|-----------|--------|
| Angel 3 consecutive failures (any API) | Switch to Dhan |
| Angel latency > 5s for 3 requests | Switch to Dhan |
| Angel WebSocket disconnects + no reconnect in 10s | Switch to Dhan (market data) |
| Dhan 3 consecutive failures | Switch back to Angel |
| Both brokers failing | Enter DEGRADED mode, alert admin |
| Primary recovers after failover | Cool-down 60s, then switch back |

### 5.3 Failover Scope

| Operation Type | Failover Strategy |
|----------------|-------------------|
| Market Data (quotes/depth) | Immediate switch, re-subscribe on secondary |
| Historical Data (OHLC) | Retry on secondary, merge if partial |
| Order Placement | **DO NOT auto-failover** — queue + alert (different broker = different positions) |
| Order Modify/Cancel | Must use same broker that holds the order |
| Portfolio (positions/orders) | Fetch from active broker only |
| Instruments | Either broker works (same exchange instruments) |

### 5.4 Token Mapping Requirement

Angel One and Dhan use **different token systems** for the same instruments:
- RELIANCE: Angel = `"2885"`, Dhan = `1333`
- NIFTY 50: Angel = `"99926000"`, Dhan = `13`

A **Token Mapper** service is required that maintains bidirectional mapping:
```
InternalToken ↔ AngelToken ↔ DhanToken
```
This must be synced daily from both broker instrument master files.

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: Wire Existing (1-2 days)
- [ ] Convert AngelOneAdapter to TypeScript OR create JS-compatible factory
- [ ] Wire AngelOneAdapter into BrokerFactory
- [ ] Replace `brokerService.js` mock with factory-produced adapter
- [ ] Verify end-to-end: API route → Factory → Adapter → Angel One API

### Phase 2: Dhan Adapter (2-3 days)
- [ ] Implement `DhanAdapter` class (all IBrokerAdapter methods)
- [ ] DhanHQ REST: auth, quotes, depth, OHLC, orders, positions
- [ ] DhanHQ option chain (direct API)
- [ ] Wire into BrokerFactory

### Phase 3: WebSocket Feeds (2-3 days)
- [ ] Angel One SmartAPI WebSocket (binary protocol parsing)
- [ ] Dhan WebSocket (JSON-based feed)
- [ ] Hook both into MarketDataEngine.connectAdapter()
- [ ] Auto-reconnect with exponential backoff

### Phase 4: Failover Manager (2-3 days)
- [ ] HealthMonitor class (heartbeat, error tracking, latency)
- [ ] FailoverManager state machine (ANGEL_ACTIVE → DHAN_ACTIVE → DEGRADED)
- [ ] Circuit breaker pattern per broker
- [ ] Token Mapper service with daily sync
- [ ] Cool-down and recovery logic

### Phase 5: Production Hardening (2-3 days)
- [ ] Request queue with retry semantics
- [ ] Audit logger (all broker API calls)
- [ ] Credential encryption at rest
- [ ] Instrument master daily sync job
- [ ] Admin alerts (Slack/webhook) on failover events

---

## 7. ENVIRONMENT VARIABLES NEEDED

```env
# Angel One (Primary)
ANGEL_API_KEY=
ANGEL_CLIENT_ID=
ANGEL_PASSWORD=
ANGEL_TOTP_SECRET=

# Dhan (Secondary)
DHAN_ACCESS_TOKEN=
DHAN_CLIENT_ID=

# Failover Config
BROKER_PRIMARY=angelone
BROKER_SECONDARY=dhan
FAILOVER_THRESHOLD=3
FAILOVER_COOLDOWN_MS=60000
HEALTH_CHECK_INTERVAL_MS=30000
```

---

## 8. DEPENDENCIES NEEDED

```json
{
  "@otplib/preset-default": "^12.0.1",   // Already in AngelOne adapter (TOTP)
  "ws": "^8.17.1",                        // Already installed (for feeds)
  "protobufjs": "^7.x",                  // Angel WebSocket binary parsing
  "csv-parse": "^5.x"                    // Dhan instrument master CSV
}
```

---

## 9. SUMMARY

| Metric | Value |
|--------|-------|
| Architecture Readiness | **70%** — interfaces + types + one adapter done |
| Implementation Readiness | **30%** — factory not wired, no failover, no WS feeds |
| Angel One Coverage | **60%** — REST complete, WebSocket missing |
| Dhan Coverage | **0%** — empty directory |
| Failover Readiness | **0%** — no health checks, no state machine |
| Estimated Total Effort | **10-14 days** (all phases) |
| Blocking Items | Broker credentials (not requested yet) |

**Bottom Line:** The type system and interfaces are well-designed. The Angel One REST adapter is functional. The critical gaps are: (1) wiring the factory, (2) building the Dhan adapter, (3) WebSocket real-time feeds for both, and (4) the failover state machine. No credentials are needed for architecture work — only for live testing.
