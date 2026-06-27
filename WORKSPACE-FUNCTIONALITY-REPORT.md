# WORKSPACE FUNCTIONALITY REPORT

**Date:** 2026-06-17  
**Status:** FUNCTIONAL AUDIT — ALL SIMULATED  
**Verdict:** UI works end-to-end. 100% of data is fake.

---

## 1. WORKSPACE STATUS

### INDEX Workspace

| Item | Value |
|------|-------|
| Auto-loaded Symbol | NIFTY 50 |
| Token | `99926000` |
| Data Source | `server/services/marketDataEngine.js` → `startSimulation()` |
| Real or Simulated | **SIMULATED** — Math.random() ticks every 500ms |
| Connected API | None |
| Missing Functionality | Real index feed (NSE broadcast data), live OHLCV |

### STOCKS Workspace

| Item | Value |
|------|-------|
| Auto-loaded Symbol | RELIANCE |
| Token | `2885` |
| Data Source | `server/services/marketDataEngine.js` → `startSimulation()` |
| Real or Simulated | **SIMULATED** — hardcoded base price 2950, random drift |
| Connected API | None |
| Missing Functionality | Real equity feed, actual broker quote subscription |

### FUTURES Workspace

| Item | Value |
|------|-------|
| Auto-loaded Symbol | NIFTY FUT |
| Token | `NF_FUT` |
| Data Source | `server/services/marketDataEngine.js` → `startSimulation()` |
| Real or Simulated | **SIMULATED** — hardcoded base price 24520 |
| Connected API | None |
| Missing Functionality | Real NFO/BFO feed, actual token resolution from broker instrument file |

### OPTIONS Workspace

| Item | Value |
|------|-------|
| Auto-loaded Symbol | NIFTY (Option Chain view) |
| Token | `99926000` |
| Data Source | `server/routes/api.js` → `generateOptionChain()` |
| Real or Simulated | **SIMULATED** — Math.random() for ALL Greeks, OI, volume, LTP |
| Connected API | None |
| Missing Functionality | Real option chain data, live Greeks calculation, actual OI from exchange |

### MCX Workspace

| Item | Value |
|------|-------|
| Auto-loaded Symbol | GOLD |
| Token | `GOLD_F` |
| Data Source | `server/services/marketDataEngine.js` → `startSimulation()` |
| Real or Simulated | **SIMULATED** — hardcoded base price 72500 |
| Connected API | None |
| Missing Functionality | Real MCX feed, commodity-specific tick sizes, MCX session timings |

### CDS Workspace

| Item | Value |
|------|-------|
| Auto-loaded Symbol | USDINR |
| Token | `USDINR_F` |
| Data Source | `server/services/marketDataEngine.js` → `startSimulation()` |
| Real or Simulated | **SIMULATED** — hardcoded base price 83.45 |
| Connected API | None |
| Missing Functionality | Real CDS feed, actual USDINR rates, proper currency pair tick sizes |

---

## 2. CRITICAL PATH VERIFICATION

### Order Placement Path

```
Frontend OrderPanel.tsx → POST /api/orders/place → brokerService.placeOrder()
                                                         │
                                                         ▼
                                              this.isConnected === false (ALWAYS)
                                                         │
                                                         ▼
                                              simulateOrder() → fake orderId 'ORD{timestamp}{random}'
```

**Status: 100% SIMULATED**  
**File:** `server/services/brokerService.js` line 97  
**Evidence:** `simulateOrder()` generates `'ORD' + Date.now() + Math.floor(Math.random() * 1000)`

### Position Update Path

```
Frontend BottomPanel.tsx → GET /api/positions (every 5s poll)
                                    │
                                    ▼
                          brokerService.getPositions()
                                    │
                                    ▼
                          this.isConnected === false (ALWAYS)
                                    │
                                    ▼
                          getDemoPositions() → 2 hardcoded positions (RELIANCE + NIFTY FUT)
```

**Status: 100% HARDCODED DEMO DATA**  
**File:** `server/services/brokerService.js` line 167  
**Evidence:** Returns static array with fixed positions

### Tradebook Update Path

```
Frontend BottomPanel.tsx → GET /api/trades (every 5s poll)
                                    │
                                    ▼
                          brokerService.getTrades()
                                    │
                                    ▼
                          returns [] (empty array — always)
```

**Status: STUB — always empty**  
**File:** `server/services/brokerService.js` line 119

### Market Data Path

```
Frontend websocket.ts → ws://host/ws → subscribe {tokens: [...]}
                                              │
                                              ▼
Server websocket.js → marketDataEngine.subscribe(token, callback)
                                              │
                                              ▼
marketDataEngine.startSimulation() → setInterval (500ms) → Math.random() ticks
```

**Status: 100% SIMULATED**  
**File:** `server/services/marketDataEngine.js` lines 47-135  
**Evidence:** Entire market feed is `Math.random()` based — no exchange connection

### WebSocket Path

```
Client: WebSocket class → ws://host/ws
Server: ws package → WebSocketServer on /ws path
Messages: subscribe, unsubscribe, subscribe_depth, unsubscribe_depth, ping/pong
```

**Status: INFRASTRUCTURE WORKS — data flowing through it is fake**  
**File:** `server/routes/websocket.js` + `src/services/websocket.ts`  
**Note:** WebSocket architecture is production-ready. Only the data source needs replacement.

---

## 3. SIMULATED DATA — COMPLETE INVENTORY

### Files Using Math.random()

| File | Usage | Count |
|------|-------|-------|
| `server/services/marketDataEngine.js` | volume, OI, tick changes, depth qty/orders | 12+ instances |
| `server/services/brokerService.js` | order ID generation | 1 instance |
| `server/routes/api.js` | option chain LTP, volume, OI, Greeks | 16+ instances |

### Files With Hardcoded Demo Data

| File | Data | Details |
|------|------|---------|
| `server/services/marketDataEngine.js` | 20 base instruments with prices | Lines 47-66 |
| `server/services/brokerService.js` | 2 demo positions | Lines 167-203 |
| `server/services/brokerService.js` | 2 demo orders | Lines 204-238 |
| `server/services/brokerService.js` | Account info `DEMO001` | Lines 125-133 |
| `server/services/instrumentService.js` | ~55 static instruments | Entire file |
| `src/store/appStore.ts` | 6 workspace watchlists, 38 symbols | Lines 51-95 |

### Broker Connection — Both Always Fail

| File | Function | Reason |
|------|----------|--------|
| `server/services/brokerService.js` | `connectAngelOne()` | `throw new Error('Angel One integration pending API keys')` |
| `server/services/brokerService.js` | `connectDhan()` | `throw new Error('Dhan integration pending access token')` |
| `server/brokers/broker.factory.ts` | All providers | `throw new Error('X adapter not yet implemented')` |

### DEMO001 Reference

| File | Line | Context |
|------|------|---------|
| `server/services/brokerService.js` | 127 | `clientId: 'DEMO001'` in `getAccount()` |

---

## 4. WHAT ACTUALLY WORKS (Production-Ready Infrastructure)

| Component | Status | File |
|-----------|--------|------|
| WebSocket pub/sub architecture | ✅ Ready | `server/routes/websocket.js` |
| Client WS with reconnect + backoff | ✅ Ready | `src/services/websocket.ts` |
| Market store (Zustand) with quote updates | ✅ Ready | `src/store/marketStore.ts` |
| App store with workspaces/watchlists | ✅ Ready | `src/store/appStore.ts` |
| SSO token validation flow | ✅ Ready | `server/services/sso.service.js` |
| Session management (create/revoke) | ✅ Ready | `server/services/session.service.js` |
| JWT auth (sign/verify/hash) | ✅ Ready | `server/services/auth.service.js` |
| Auth routes (SSO, verify, logout) | ✅ Ready | `server/routes/auth.routes.js` |
| Supabase client with fallback | ✅ Ready | `server/db/client.js` |
| Database schema (10 tables) | ✅ Ready | `server/db/schema.sql` |
| Migrations (triggers, RLS, columns) | ✅ Ready | `server/db/migrations/` |
| API route structure | ✅ Ready | `server/routes/api.js` |
| Frontend API service layer | ✅ Ready | `src/services/api.ts` |
| Broker interface (abstract) | ✅ Ready | `server/brokers/broker.interface.ts` |
| Broker factory pattern | ✅ Ready | `server/brokers/broker.factory.ts` |
| Order panel UI + submission | ✅ Ready | `src/components/OrderPanel.tsx` |
| Bottom panel (positions/orders/trades) | ✅ Ready | `src/components/BottomPanel.tsx` |

---

## 5. PRODUCTION BLOCKERS

### Critical (Cannot Go Live Without)

1. **No real market data feed** — all prices are Math.random()
2. **No real order execution** — all orders return fake IDs
3. **No Supabase connected** — env vars not set, DB features disabled
4. **No risk engine** — no file exists, no pre-trade checks
5. **No broker adapter implemented** — all throw "not yet implemented"
6. **No instrument file download** — uses static list instead of daily broker file

### High Priority (Required for Prop Firm Operations)

7. **No challenge tracking** — no code monitors profit target / drawdown
8. **No account status management** — never locks/breaches accounts
9. **No daily P&L calculation** — no account_metrics written
10. **No position persistence** — positions disappear on restart
11. **No order persistence** — orders not written to database
12. **Auth middleware not enforced** — API routes currently unprotected

### Medium Priority (Required for Production Quality)

13. **No instrument token resolution** — futures tokens are made-up strings (`NF_FUT`)
14. **No expiry management** — static expiry dates in instrument list
15. **No auto-square-off logic** — no 3:15 PM position closure
16. **Historical chart data is random** — 500 random candles generated
17. **Market depth is random** — no real Level 2 data
18. **Option chain is random** — no real Greeks/IV/OI

---

## 6. EXACT FILES REQUIRING REPLACEMENT

| # | File | Current State | Required Change |
|---|------|---------------|-----------------|
| 1 | `server/services/marketDataEngine.js` | Full simulation | Replace with broker WebSocket feed adapter |
| 2 | `server/services/brokerService.js` | All stubs + demo data | Remove — replace with real broker adapters |
| 3 | `server/services/instrumentService.js` | Static 55-instrument array | Daily instrument file download + cache |
| 4 | `server/routes/api.js` (option chain) | `generateOptionChain()` with Math.random | Real option chain from broker API |
| 5 | `server/routes/api.js` (depth) | `generateSimulatedDepth()` | Real Level 2 from broker WS |
| 6 | `server/routes/api.js` (history) | Random 500 candles | Real historical candle API |
| 7 | `src/store/appStore.ts` (watchlists) | Hardcoded 38 symbols | Load from Supabase per user |
| 8 | `server/brokers/broker.factory.ts` | All cases throw | Implement at least one adapter |

---

*End of Workspace Functionality Report*
