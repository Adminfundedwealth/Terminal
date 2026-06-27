# FundedWealth Terminal — Production Gap Report

**Date:** 2026-06-17  
**Method:** Source code grep + Runtime API verification + Playwright  
**Terminal:** http://localhost:3000 — VERIFIED LIVE  

---

## RUNTIME VERIFICATION (Playwright)

```
[1] Loading terminal...           OK
[2] Watchlist tabs:               INDEX(5), STOCKS(9), FUTURES(5), MCX(5), CDS(4)
[3] Watchlist cycling:            OK
[4] Chart rendered:               OK
[5] Option Chain:                 OK
[6] Market Depth:                 OK
[7] Order Panel:                  BUY=true SELL=true
[8] Bottom panel tabs:            OK
[9] API endpoints:                All HTTP 200
[10] WebSocket:                   connected=true messages=2
[11] Index HTML:                  hasRoot=true
```

**Result: Architecture files DO NOT break runtime. Terminal works.**

---

## PRODUCTION BLOCKERS — Code Search Results

Every occurrence of mock/demo/simulated/random data in source:

### File: `server/services/brokerService.js`

| Line | Code | Blocker |
|------|------|---------|
| 82 | `// Demo mode - simulate order` | Order execution is fake |
| 83 | `return this.simulateOrder(params)` | No real broker call |
| 106 | `'ORD' + Date.now() + Math.floor(Math.random() * 1000)` | Fake order ID |
| 110 | `message: 'Order placed successfully (demo mode)'` | Demo response |
| 116 | `return { status: 'modified', message: 'Order modified (demo)' }` | Fake modify |
| 124 | `return { status: 'cancelled', message: 'Order cancelled (demo)' }` | Fake cancel |
| 132 | `return this.getDemoPositions()` | Hardcoded positions |
| 140 | `return this.getDemoOrders()` | Hardcoded orders |
| 155 | `clientId: 'DEMO001'` | Hardcoded account |
| 156 | `name: 'Demo Trader'` | Fake user |
| 158 | `balance: 1000000` | Fake balance |
| 167 | `getDemoPositions()` | 2 static positions |
| 204 | `getDemoOrders()` | 2 static orders |

### File: `server/services/marketDataEngine.js`

| Line | Code | Blocker |
|------|------|---------|
| 4 | `Falls back to simulated data` | Design comment confirms mock |
| 13 | `this.simulationInterval = null` | Simulation timer |
| 23 | `starting simulation` | Server log |
| 40 | `startSimulation()` | Random tick generator |
| 75 | `Math.floor(Math.random() * 10000000)` | Random volume |
| 80-81 | `Math.random() * 5000000` | Random OI |
| 93 | `(Math.random() - 0.48) * existing.ltp * 0.001` | Random price tick |
| 107 | `Math.floor(Math.random() * 1000)` | Random volume increment |
| 120 | `generateSimulatedDepth(quote.ltp)` | Fake depth |
| 134-140 | `Math.random() * 5000 + 200` | Random bid/ask qty |
| 224-235 | `(Math.random() - 0.48) * volatility` | Random candle generation |

### File: `server/routes/api.js`

| Line | Code | Blocker |
|------|------|---------|
| 185 | `marketDataEngine.generateSimulatedDepth(quote.ltp)` | Fake depth response |
| 196 | `generateOptionChain(symbol, marketDataEngine)` | Synthetic OC |
| 236-253 | `Math.random() * 20`, `Math.random() * 800000` | All OC values random |

### File: `src/components/ChartPanel.tsx`

| Line | Code | Blocker |
|------|------|---------|
| 105 | `// Generate demo data if API fails` | Fallback random chart |
| 106 | `const demoData = generateDemoData(500)` | Random walk candles |
| 405 | `function generateDemoData(count)` | Full random OHLC generator |
| 407 | `19500 + Math.random() * 1000` | Random starting price |

### File: `src/components/OptionChainModal.tsx`

| Line | Code | Blocker |
|------|------|---------|
| 11 | `function generateDemoOptionChain(atmPrice)` | Fake OC generator |
| 23-40 | 18 lines of `Math.random()` | All values synthetic |
| 66 | `setChain(generateDemoOptionChain(atm))` | Falls back to fake |

### File: `src/components/MarketDepthPanel.tsx`

| Line | Code | Blocker |
|------|------|---------|
| 7 | `function generateDemoDepth(ltp)` | Fake depth fallback |
| 13-19 | `Math.random() * 8000 + 500` | Random bid/ask |
| 34 | `depth = liveDepth \|\| generateDemoDepth(...)` | Uses fake if no live |

### File: `src/components/SearchModal.tsx`

| Line | Code | Blocker |
|------|------|---------|
| 17 | `const DEMO_INSTRUMENTS: Instrument[] = [` | 20 hardcoded instruments |
| 54 | `setResults(DEMO_INSTRUMENTS.slice(0, 10))` | Shows fake on load |
| 72 | `const filtered = DEMO_INSTRUMENTS.filter(...)` | Fallback to fake search |

### File: `src/App.tsx`

| Line | Code | Blocker |
|------|------|---------|
| 33 | `clientId: 'FW-DEMO'` | Fake account fallback |
| 35 | `name: 'Trader'` | Placeholder |
| 36 | `balance: 1000000` | Fake balance |

**TOTAL: 60+ lines of production-blocking mock code across 7 files.**

---

## MODULE GAP ANALYSIS

### 1. Authentication Flow

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Auth middleware | NOT FOUND | `server/index.js` | No `app.use(auth)` |
| JWT validation | NOT FOUND | — | — |
| Route protection | NOT FOUND | `server/routes/api.js` | All routes open |
| Login endpoint | NOT FOUND | — | — |
| Session table | DEFINED (schema only) | `server/db/schema.sql` | Line 118-128 |

**Missing:** `server/middleware/auth.ts`, `server/routes/auth.routes.ts`, JWT library

**Complexity:** Medium (2-3 days)

---

### 2. SSO Flow

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| SSO token endpoint | NOT FOUND | — | — |
| FW Dashboard callback | NOT FOUND | — | — |
| Token exchange | NOT FOUND | — | — |
| Frontend auth hook | NOT FOUND | `src/hooks/useAuth.ts` referenced in ARCHITECTURE.md but file does not exist |
| Redirect logic | NOT FOUND | — | — |

**Missing:** Entire SSO implementation

**Complexity:** Medium (2-3 days)

---

### 3. Account Mapping

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Account lookup | Hardcoded `DEMO001` | `server/services/brokerService.js` | 155 |
| User-Challenge-Account relationship | Schema defined only | `server/db/schema.sql` | 18-51 |
| Account selector UI | NOT FOUND | — | — |
| Broker credential storage | NOT FOUND | — | — |

**Missing:** Account service, account routes, frontend selector

**Complexity:** Medium (2 days)

---

### 4. Order Engine (Trading Engine)

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Order placement | Returns fake ID | `server/services/brokerService.js` | 105-112 |
| Order validation | Field check only | `server/routes/api.js` | 116-119 |
| Broker routing | NOT FOUND | — | — |
| Risk check before order | NOT FOUND | — | — |
| Order persistence | NOT FOUND (in-memory) | — | — |
| Interface defined | YES | `server/engines/trading.engine.ts` | Full file |

**Missing:** Implementation of `ITradingEngine` interface

**Complexity:** High (4-5 days)

---

### 5. Position Engine

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Position source | 2 hardcoded objects | `server/services/brokerService.js` | 167-201 |
| MTM calculation | Partial (applies LTP to demo) | `server/routes/api.js` | 57-65 |
| Position persistence | NOT FOUND | — | — |
| Interface defined | YES | `server/engines/position.engine.ts` | Full file |

**Missing:** Implementation of `IPositionEngine` interface

**Complexity:** Medium (3 days)

---

### 6. Risk Engine

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Pre-trade checks | NOT FOUND | — | — |
| Post-trade evaluation | NOT FOUND | — | — |
| Daily loss tracking | NOT FOUND | — | — |
| Drawdown calculation | NOT FOUND | — | — |
| Account locking | NOT FOUND | — | — |
| Interface defined | YES | `server/engines/risk.engine.ts` | Full file |

**Missing:** Entire implementation

**Complexity:** High (4-5 days)

---

### 7. Challenge Engine

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Challenge rules | NOT FOUND | — | — |
| Pass/Fail detection | NOT FOUND | — | — |
| Status updates | NOT FOUND | — | — |
| Dashboard sync | NOT FOUND | — | — |
| Interface defined | YES | `server/engines/challenge.engine.ts` | Full file |

**Missing:** Entire implementation

**Complexity:** High (3-4 days)

---

### 8. Reporting Engine

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Trade logging | Returns `[]` | `server/services/brokerService.js` | 148-150 |
| Daily metrics | NOT FOUND | — | — |
| Equity curve | NOT FOUND | — | — |
| Interface defined | YES | `server/engines/reporting.engine.ts` | Full file |

**Missing:** Entire implementation

**Complexity:** Medium (2-3 days)

---

### 9. Market Data Engine

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Quote source | `Math.random()` simulation | `server/services/marketDataEngine.js` | 40-124 |
| Historical OHLC | Random walk generator | `server/services/marketDataEngine.js` | 211-243 |
| Market depth | Random bid/ask | `server/services/marketDataEngine.js` | 126-147 |
| Option chain | Math formula generation | `server/routes/api.js` | 212-257 |
| Instrument master | 54 hardcoded entries | `server/services/instrumentService.js` | Full file |
| Interface defined | YES | `server/engines/marketdata.engine.ts` | Full file |

**Missing:** Real broker feed integration

**Complexity:** High (5-6 days)

---

### 10. Broker Adapter Layer

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Interface | DEFINED | `server/brokers/broker.interface.ts` | Full file |
| Factory | DEFINED (throws on all) | `server/brokers/broker.factory.ts` | 37-49 |
| Angel One impl | NOT FOUND | — | — |
| Dhan impl | NOT FOUND | — | — |
| Upstox impl | NOT FOUND | — | — |
| Shoonya impl | NOT FOUND | — | — |

**Missing:** All 4 broker adapter implementations

**Complexity:** Angel(5-6d), Dhan(3-4d), Upstox(3-4d), Shoonya(3-4d)

---

### 11. Database Layer

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| Schema | DEFINED | `server/db/schema.sql` | Full file (10 tables) |
| Supabase client | NOT FOUND | — | — |
| Data access functions | NOT FOUND | — | — |
| Connection string | NOT FOUND | — | — |
| Migrations | NOT FOUND | — | — |

**Missing:** `server/db/client.ts`, query functions, env config

**Complexity:** Low-Medium (1-2 days)

---

### 12. WebSocket Layer

| Aspect | Current State | File | Line |
|--------|--------------|------|------|
| WS server | WORKING | `server/routes/websocket.js` | Full file |
| Subscribe/Unsubscribe | WORKING | `server/routes/websocket.js` | 34-72 |
| Quote delivery | WORKING (simulated) | `server/routes/websocket.js` | 38-43 |
| Auth on connect | NOT FOUND | `server/routes/websocket.js` | No JWT check |
| Order updates push | NOT FOUND | — | — |
| Position updates push | NOT FOUND | — | — |
| Risk alerts push | NOT FOUND | — | — |

**Missing:** Auth validation, order/position/risk message types

**Complexity:** Low (1-2 days)

---

## SUPABASE SCHEMA VERIFICATION

### Tables Defined in `server/db/schema.sql`:

| # | Table | Columns | FK | Indexes | RLS | CHECK constraints |
|---|-------|---------|----|---------|----|-------------------|
| 1 | users | 6 | — | — | ✅ | status IN (active, suspended) |
| 2 | challenges | 10 | users(id) | — | ✅ | type IN (evaluation, funded), status IN (...) |
| 3 | accounts | 11 | users(id), challenges(id) | idx_accounts_user, idx_accounts_challenge | ✅ | broker_provider IN (...), status IN (...) |
| 4 | risk_rules | 5 | accounts(id) | — | ✅ | UNIQUE(account_id, rule_type) |
| 5 | orders | 16 | accounts(id) | idx_orders_account_time, idx_orders_status (partial) | ✅ | side, order_type, product_type, status CHECKs |
| 6 | positions | 10 | accounts(id) | idx_positions_open (partial) | ✅ | UNIQUE(account_id, token, product_type) |
| 7 | trades | 10 | accounts(id), orders(id) | idx_trades_account_time | ✅ | side CHECK |
| 8 | watchlists | 7 | users(id) | idx_watchlists_user | ✅ | — |
| 9 | account_metrics | 13 | accounts(id) | idx_metrics_account_date | ✅ | UNIQUE(account_id, date) |
| 10 | sessions | 8 | users(id), accounts(id) | idx_sessions_token (partial) | ✅ | — |

### Missing Items:

| Issue | Severity | Fix |
|-------|----------|-----|
| No RLS POLICY definitions (only ENABLE) | HIGH | Need `CREATE POLICY ... USING (...)` for each table |
| No `instruments` cache table | LOW | Optional — can use Redis. But needed if daily master cached in DB |
| No `audit_log` table | LOW | Optional for compliance |
| No `updated_at` trigger | MEDIUM | Need trigger to auto-set `updated_at` on UPDATE |
| `positions` UNIQUE constraint may conflict on re-open | MEDIUM | Need `WHERE closed_at IS NULL` in unique constraint |

### Foreign Key Chain Verified:

```
users.id ← challenges.user_id ← accounts.challenge_id
                                  accounts.user_id → users.id
                                  accounts.id ← orders.account_id
                                  accounts.id ← positions.account_id
                                  accounts.id ← trades.account_id
                                  accounts.id ← risk_rules.account_id
                                  accounts.id ← account_metrics.account_id
users.id ← watchlists.user_id
users.id ← sessions.user_id
orders.id ← trades.order_id
```

**Chain is consistent. No orphan references.**

---

## ACCOUNT MODEL — DETAILED EXAMPLES

### Example 1: Aman — 100K Challenge (Active)

```
User: Aman (fw_user_id: "usr_aman_001")
│
└── Challenge: 100K Evaluation
     ├── id: "ch_001"
     ├── type: evaluation
     ├── plan: "100K"
     ├── initial_balance: ₹1,00,00,000
     ├── status: active
     ├── started_at: 2026-06-01
     ├── expires_at: 2026-07-01
     │
     └── Account: FW-10001
          ├── broker_provider: angelone
          ├── broker_client_id: "A12345"
          ├── balance: ₹1,02,50,000 (current)
          ├── status: active
          │
          └── Risk Rules:
               ├── daily_loss_limit:    { "amount": 500000, "percent": 5 }
               ├── max_drawdown:        { "amount": 1000000, "percent": 10 }
               ├── profit_target:       { "amount": 1000000, "percent": 10 }
               ├── max_positions:       { "count": 15 }
               ├── max_lot_size:        { "nifty": 6, "banknifty": 3, "stocks": 4 }
               ├── allowed_segments:    { "segments": ["NSE", "NFO", "MCX"] }
               ├── trading_hours:       { "start": "09:15", "end": "15:30" }
               └── no_overnight:        { "enabled": true }

     Progress:
     ├── Days traded: 12 / 30
     ├── Profit achieved: ₹2,50,000 / ₹10,00,000 target
     ├── Daily loss today: -₹15,000 / -₹5,00,000 limit
     ├── Max drawdown used: ₹1,80,000 / ₹10,00,000
     └── Payout eligible: NO (must pass first)
```

### Example 2: Trader2 — 50K Challenge (Near Target)

```
User: Trader2 (fw_user_id: "usr_trader2_002")
│
└── Challenge: 50K Evaluation
     ├── id: "ch_002"
     ├── type: evaluation
     ├── plan: "50K"
     ├── initial_balance: ₹50,00,000
     ├── status: active
     │
     └── Account: FW-10002
          ├── broker_provider: dhan
          ├── broker_client_id: "DH98765"
          ├── balance: ₹54,80,000
          ├── status: active
          │
          └── Risk Rules:
               ├── daily_loss_limit:    { "amount": 250000, "percent": 5 }
               ├── max_drawdown:        { "amount": 500000, "percent": 10 }
               ├── profit_target:       { "amount": 500000, "percent": 10 }
               ├── allowed_segments:    { "segments": ["NSE", "NFO"] }
               └── no_overnight:        { "enabled": true }

     Progress:
     ├── Profit achieved: ₹4,80,000 / ₹5,00,000 target (96%!)
     ├── Payout eligible: NO (must hit target)
     └── Status: ALMOST PASSED
```

### Example 3: Trader3 — Instant Funding (Funded)

```
User: Trader3 (fw_user_id: "usr_trader3_003")
│
└── Challenge: Instant Funding
     ├── id: "ch_003"
     ├── type: funded
     ├── plan: "Instant-25K"
     ├── initial_balance: ₹25,00,000
     ├── status: active
     │
     └── Account: FW-10003
          ├── broker_provider: angelone
          ├── broker_client_id: "A67890"
          ├── balance: ₹27,30,000
          ├── status: active
          │
          └── Risk Rules:
               ├── daily_loss_limit:    { "amount": 125000, "percent": 5 }
               ├── max_drawdown:        { "amount": 200000, "percent": 8 }
               ├── profit_target:       null  ← funded accounts have no target
               ├── max_positions:       { "count": 20 }
               ├── allowed_segments:    { "segments": ["NSE", "NFO", "MCX", "CDS"] }
               ├── trading_hours:       { "start": "09:00", "end": "23:30" }
               └── no_overnight:        { "enabled": false }

     Progress:
     ├── Total profit: ₹2,30,000
     ├── Payout eligible: YES (funded, profit > 0)
     ├── Payout split: 80% trader / 20% FW
     └── Next payout date: 2026-07-01
```

---

## BROKER ADAPTER — METHOD SUFFICIENCY REVIEW

Interface file: `server/brokers/broker.interface.ts`  
Types file: `server/types/index.ts`

### Methods vs Broker API Capabilities:

| Method | Angel One API | Dhan API | Upstox API | Shoonya API | Sufficient? |
|--------|--------------|----------|------------|-------------|-------------|
| `connect()` | POST loginByPassword + TOTP | Access token (pre-generated) | OAuth2 authorize flow | POST login | ✅ |
| `disconnect()` | POST logout | N/A (token-based) | Revoke token | POST logout | ✅ |
| `refreshSession()` | Generate new JWT | Token valid 24h (re-gen daily) | Refresh OAuth token | Re-login | ✅ |
| `getQuotes()` | POST getMarketData (LTP) | GET /marketfeed/ltp | GET market-quote | Get quotes | ✅ |
| `getOHLC()` | POST getCandleData | GET /charts/historical | GET historical-candle | Get time price series | ✅ |
| `getDepth()` | SmartConnect mode 3 | DhanHQ full packet | WS full mode | WebSocket L2 | ✅ |
| `getOptionChain()` | ❌ No single API | ❌ No single API | GET /option/chain | ❌ No single API | ⚠️ PARTIAL |
| `getOptionInstruments()` | Filter instrument CSV | Filter instrument CSV | Filter instruments | Filter instruments | ✅ (added) |
| `placeOrder()` | POST placeOrder | POST /orders | POST place-order | Place order | ✅ |
| `modifyOrder()` | POST modifyOrder | PUT /orders/{id} | PUT modify-order | Modify order | ✅ |
| `cancelOrder()` | POST cancelOrder | DELETE /orders/{id} | DELETE cancel-order | Cancel order | ✅ |
| `getPositions()` | GET getPosition | GET /positions | GET get-positions | Net positions | ✅ |
| `getOrders()` | GET getOrderBook | GET /orders | GET get-orders | Order book | ✅ |
| `getTrades()` | GET getTradeBook | GET /trades | GET get-trades | Trade book | ✅ |
| `getFunds()` | GET getRMS | GET /fund-limit | GET get-fund-and-margin | Get limits | ✅ |
| `getInstruments()` | Download CSV daily | Download CSV daily | GET instruments JSON | Download master | ✅ |
| `getMarginRequired()` | POST getMargin | POST /margincalculator | POST margin | ❌ Not available | ⚠️ PARTIAL |
| `getHoldings()` | GET getHolding | GET /holdings | GET get-holdings | Get holdings | ✅ |
| `onOrderUpdate()` | SmartConnect order feed | DhanHQ order update | WS order update | WS callback | ✅ |
| `subscribeQuotes()` | SmartConnect binary WS | DhanHQ WebSocket | Upstox WebSocket | ShoonyaAPI WS | ✅ |
| `subscribeDepth()` | SmartConnect mode 3 | DhanHQ full mode | Full depth WS | L2 WS | ✅ |

### Identified Gaps (must fix before implementation):

| # | Gap | Impact | Fix |
|---|-----|--------|-----|
| 1 | `getOptionChain()` — Angel One, Dhan, Shoonya have NO direct OC API | Cannot show real option chain | Build OC by: getting option instruments → subscribing LTP/OI → computing IV |
| 2 | `getMarginRequired()` — Shoonya has no margin calculator API | Cannot show pre-order margin for Shoonya | Use estimated margin calculation locally |
| 3 | No `getGTT()` / `placeGTT()` — Good-Till-Triggered orders | GTT not supported | Add if needed in future |
| 4 | No `getMarketStatus()` method | Cannot check if market is open from broker | Add method or check locally via time |
| 5 | No `convertPosition()` — MIS to CNC/NRML conversion | Cannot convert intraday to delivery | Add method to interface |

---

## PRIORITY CLASSIFICATION

### P0 — Required Before Launch (cannot go live without these)

| # | Item | Depends On | Estimated Days |
|---|------|-----------|----------------|
| 1 | Supabase connection + schema deployment | Nothing | 1-2 |
| 2 | SSO Authentication (JWT from FW Dashboard) | Supabase | 2-3 |
| 3 | Account mapping (user → challenge → account) | Supabase + SSO | 2 |
| 4 | Angel One adapter (auth + orders + positions) | Supabase | 5-6 |
| 5 | Angel One market data (SmartConnect WebSocket) | Angel One auth | 3-4 |
| 6 | Risk engine implementation | Supabase + Positions | 4-5 |
| 7 | Challenge engine (pass/fail/lock) | Risk engine | 3-4 |
| 8 | Real instrument master (daily sync) | Angel One | 2 |
| 9 | Replace all `Math.random()` with real data | Market data engine | 1-2 |
| 10 | Replace all `getDemoPositions/Orders` with DB | Supabase | 1 |
| 11 | WebSocket auth (validate JWT on connect) | SSO | 1 |

**Total P0: ~25-35 days**

### P1 — Required Before Funded Accounts

| # | Item | Depends On | Estimated Days |
|---|------|-----------|----------------|
| 1 | Dhan adapter (backup feed + trading) | Supabase | 3-4 |
| 2 | Reporting engine (daily snapshots, equity curve) | Supabase | 2-3 |
| 3 | Payout eligibility logic | Challenge engine | 1-2 |
| 4 | Real option chain (instruments + live OI) | Market data | 3 |
| 5 | TradingView Charting Library integration | License + Market data | 4-5 |
| 6 | Account locking with auto-square-off | Risk engine | 2 |
| 7 | Dashboard sync (challenge status webhooks) | SSO | 2 |

**Total P1: ~18-21 days**

### P2 — Nice to Have (post-launch improvements)

| # | Item | Estimated Days |
|---|------|----------------|
| 1 | Upstox adapter | 3-4 |
| 2 | Shoonya adapter | 3-4 |
| 3 | GTT (Good-Till-Triggered) orders | 2 |
| 4 | Basket orders | 2 |
| 5 | Position conversion (MIS→NRML) | 1 |
| 6 | Multi-account simultaneous trading | 3 |
| 7 | Trade analytics / advanced reporting | 3-4 |
| 8 | Mobile responsive layout | 3-4 |

---

## IMPLEMENTATION CHECKLIST

### Phase 2: Supabase

- [ ] Create Supabase project
- [ ] Execute `server/db/schema.sql`
- [ ] Add RLS policies (`CREATE POLICY`)
- [ ] Add `updated_at` trigger
- [ ] Create `server/db/client.ts` with Supabase JS
- [ ] Add env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- [ ] Seed test data (1 user, 1 challenge, 1 account, risk rules)
- [ ] Test: query user → get account → get rules

### Phase 3: SSO

- [ ] Create `POST /api/auth/sso` endpoint
- [ ] Validate SSO token with FW Dashboard API
- [ ] Generate terminal JWT (sign with secret)
- [ ] Create `server/middleware/auth.ts`
- [ ] Apply middleware to all `/api/*` routes
- [ ] Create `src/hooks/useAuth.ts`
- [ ] Frontend: check session on mount, redirect if invalid
- [ ] Store session in `sessions` table
- [ ] Test: no-token request gets 401

### Phase 4: Account Mapping

- [ ] `GET /api/accounts` — list user's trading accounts
- [ ] `GET /api/accounts/:id` — account details + rules
- [ ] Account selector in frontend (if multiple)
- [ ] Load risk rules for active account
- [ ] Load challenge progress
- [ ] Replace hardcoded `DEMO001` with DB query
- [ ] Test: correct rules loaded per account

### Phase 5: Risk Engine

- [ ] Implement `IRiskEngine` interface
- [ ] Load risk_rules from Supabase on account select
- [ ] Pre-trade: check all 9 rules before order
- [ ] Post-trade: evaluate limits after every fill
- [ ] Daily loss tracking (reset at 00:00 IST)
- [ ] Max drawdown tracking (from peak balance)
- [ ] Account lock on breach
- [ ] WebSocket risk_alert push at 80% threshold
- [ ] Test: order rejected when limit exceeded

### Phase 6: Challenge Engine

- [ ] Implement `IChallengeEngine` interface
- [ ] Auto-detect challenge pass (profit target hit)
- [ ] Auto-detect challenge fail (drawdown breach)
- [ ] Lock account on failure
- [ ] Close all positions on failure
- [ ] Webhook to FW Dashboard on pass/fail
- [ ] Challenge expiry check (daily cron)
- [ ] Test: challenge status updates correctly

### Phase 7: Angel One

- [ ] Create `server/brokers/angelone/angelone.adapter.ts`
- [ ] TOTP generation (speakeasy)
- [ ] Login → get jwtToken + refreshToken
- [ ] Session refresh before expiry
- [ ] Instrument master CSV download + parse
- [ ] SmartConnect WebSocket connection
- [ ] Binary frame parsing (LTP/Quote/SnapQuote)
- [ ] `placeOrder` / `modifyOrder` / `cancelOrder`
- [ ] `getPositions` / `getOrders` / `getTrades`
- [ ] `getFunds` / `getMarginRequired`
- [ ] `getOHLC` (historical candles)
- [ ] Test: real quote + real order + real position

### Phase 8: Dhan

- [ ] Create `server/brokers/dhan/dhan.adapter.ts`
- [ ] Access token auth
- [ ] DhanHQ WebSocket feed
- [ ] All trading methods
- [ ] Automatic failover from Angel One
- [ ] Test: Dhan feed active when Angel disconnected

### Phase 9: TradingView

- [ ] Obtain TradingView Charting Library license
- [ ] Install library
- [ ] Create IExternalDatafeed adapter
- [ ] Create IBrokerConnectionAdapter
- [ ] Replace Lightweight Charts
- [ ] Enable: built-in indicators, drawings, multi-chart, chart trading
- [ ] Test: real candles + order lines visible

---

## CONCLUSION

The terminal has a complete UI and working WebSocket infrastructure, but **zero real backend connectivity**. Every data point is generated via `Math.random()` or hardcoded arrays.

Architecture (interfaces, types, schema) is complete and approved.

**Next step:** Phase 2 (Supabase) → then proceed sequentially.
