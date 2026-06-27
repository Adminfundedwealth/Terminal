# FundedWealth Terminal — Architecture Design Document

## 1. CURRENT STATE ANALYSIS

### System Map with Status

| Component | Status | File References | Evidence |
|---|---|---|---|
| Authentication (JWT middleware) | **WORKING** | `server/middleware/auth.js`, `server/services/auth.service.js` | JWT sign/verify logic is correct. Cookie + header extraction works. |
| SSO Flow | **BROKEN** | `server/services/sso.service.js` | User lookup uses `fw_user_id` — column does not exist. Live table uses `clerk_id`. |
| Trading Accounts | **BROKEN** | `server/services/accountService.js`, `server/repositories/account.repository.js` | Queries `trading_accounts` table — does not exist in production DB. |
| Challenge Accounts | **BROKEN** | `server/services/challengeService.js`, `server/repositories/challenge.repository.js` | Queries `challenge_accounts` table — does not exist. |
| Orders | **BROKEN** | `server/services/accountService.js` (placeOrder) | Writes to `trading_orders` — does not exist. Fallback to in-memory Map. |
| Positions | **BROKEN** | `server/repositories/position.repository.js` | Reads by `user_id`, counts by `account_id`. Column conflict. Table exists but empty. |
| Trades | **BROKEN** | `server/repositories/trade.repository.js` | Queries `executions` — does not exist. |
| Risk Rules | **BROKEN** | `server/services/riskEngine.js`, `server/repositories/risk-rules.repository.js` | Risk rules repo queries `trading_accounts` for columns that don't exist. |
| Broker — Angel One Feed | **PARTIAL** | `server/brokers/angelone/angel.feed.connector.js` | Code complete. Needs credentials in `.env`. |
| Broker — Angel One Orders | **PARTIAL** | `server/brokers/angelone/angelone.adapter.js` | Code complete. Needs credentials + active session. |
| Broker — Dhan | **UNUSED** | `server/brokers/dhan/dhan.adapter.js` | Placeholder file. Not implemented. |
| Market Data Engine | **WORKING** | `server/services/marketDataEngine.js` | In-memory pub/sub works. Needs feed adapter connected. |
| Candle Service | **PARTIAL** | `server/services/candleService.js` | Code complete. Returns empty without broker JWT. |
| Depth Service | **PARTIAL** | `server/services/depthService.js` | Code complete. Returns empty without broker JWT. |
| Option Chain Service | **PARTIAL** | `server/services/optionChainService.js` | Code complete. Returns empty without broker JWT. |
| Instrument Service | **WORKING** | `server/services/instrumentService.js` | Static in-memory list. Works without DB. |
| WebSocket (client) | **WORKING** | `src/services/websocket.ts` | Auto-reconnect, subscribe/unsubscribe. |
| Socket.IO Realtime | **WORKING** | `server/realtime/socketio.server.js` | Event bridge routes events to clients. |
| Event Bus | **WORKING** | `server/events/eventBus.js`, `server/events/eventBridge.js` | Internal pub/sub with 7 channels. |
| Frontend UI | **WORKING** | `src/App.tsx`, all `src/components/*` | Full terminal UI renders. Auth gate works. |
| Session Service | **BROKEN** | `server/services/session.service.js` | Writes to `sessions` table with `token_hash` — live `sessions` table has incompatible schema. |
| Daily Cron | **BROKEN** | `server/cron/dailyChecks.js` | Queries `trading_accounts` — does not exist. |
| Payout Service | **UNUSED** | `server/services/payoutService.js` | Endpoint exists. Tables do not exist. |

---

## 2. TARGET RESPONSIBILITIES

### Terminal Owns (In Scope)

```
Login via SSO (verify token, create session)
Trading Accounts (CRUD, balance updates, status transitions)
Charts (historical candles, live tick aggregation)
Orders (place, modify, cancel, fill tracking)
Positions (open, close, partial close, reverse, close-all)
Trades (immutable execution log)
Market Data (live quotes via SmartStream, depth, option chain)
Risk Engine (pre-trade validation, post-trade checks, account lock/breach)
Challenge Evaluation (phase transitions, target tracking, daily checks)
Watchlists (user-specific, persisted)
Account Metrics (daily P&L snapshots)
Audit Log (all events)
```

### Dashboard Owns (Out of Scope for Terminal)

```
User Registration (Clerk Auth)
KYC Verification
Challenge Purchase (plan selection, payment)
Payment Processing (UPI, bank transfer)
Payout Approval (admin panel)
Payout Disbursement (bank transfer to trader)
Certificates (PDF generation)
Referral/Affiliate System
Gamification (XP, levels, achievements)
```

### Shared Read-Only by Terminal

```
users table — read clerk_id, email, full_name, is_active, kyc_status
orders table — read user_id, plan_type, status (for admin provisioning)
```

---

## 3. ACCOUNT MODEL DESIGN

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  DASHBOARD-OWNED (read-only by terminal)                         │
│                                                                   │
│  ┌──────────┐         ┌──────────┐                               │
│  │  users   │ 1───M   │  orders  │ (payment orders)              │
│  │  (20)    │         │  (17)    │                               │
│  │          │         │          │                               │
│  │ id (PK)  │         │ user_id  │                               │
│  │ clerk_id │         │ plan_type│                               │
│  │ email    │         │ status   │                               │
│  │ is_active│         │ amount   │                               │
│  └──────────┘         └──────────┘                               │
└─────────────────────────────────────────────────────────────────┘
        │
        │ users.id (FK)
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  TERMINAL-OWNED                                                   │
│                                                                   │
│  ┌───────────────────┐                                           │
│  │ terminal_challenges│                                           │
│  │                   │                                           │
│  │ id (PK)          │                                           │
│  │ user_id (FK→users)│                                           │
│  │ type             │  evaluation | funded                       │
│  │ phase            │  phase_1 | phase_2 | funded                │
│  │ plan             │  10K | 25K | 50K | 1L                     │
│  │ initial_balance  │                                           │
│  │ status           │  active|passed|failed|expired              │
│  │ min_trading_days │                                           │
│  │ started_at       │                                           │
│  │ expires_at       │                                           │
│  │ previous_challenge_id (FK→self)                               │
│  └────────┬──────────┘                                           │
│           │ 1                                                     │
│           │                                                       │
│           ▼ 1                                                     │
│  ┌───────────────────┐         ┌─────────────────────┐          │
│  │ terminal_accounts │ 1───M   │ terminal_risk_rules │          │
│  │                   │         │                     │          │
│  │ id (PK)          │         │ id (PK)             │          │
│  │ user_id (FK→users)│         │ account_id (FK)     │          │
│  │ account_code     │         │ rule_type           │          │
│  │ challenge_id (FK)│         │ value (JSONB)       │          │
│  │ broker_provider  │         │ is_active           │          │
│  │ balance          │         └─────────────────────┘          │
│  │ peak_balance     │                                           │
│  │ status           │  active|locked|breached|completed|expired  │
│  │ locked_reason    │                                           │
│  └────────┬──────────┘                                           │
│           │                                                       │
│     ┌─────┼──────────────────┐                                   │
│     │     │                  │                                   │
│     ▼     ▼                  ▼                                   │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────────┐       │
│  │ terminal_  │  │ terminal_      │  │ terminal_        │       │
│  │ orders     │  │ positions      │  │ trades           │       │
│  │            │  │                │  │                  │       │
│  │ account_id │  │ account_id     │  │ account_id       │       │
│  │ symbol     │  │ symbol, token  │  │ order_id (FK)    │       │
│  │ side       │  │ qty, avg_price │  │ symbol, side     │       │
│  │ status     │  │ realized_pnl   │  │ qty, price       │       │
│  │ filled_qty │  │ opened_at      │  │ executed_at      │       │
│  └────────────┘  │ closed_at      │  └──────────────────┘       │
│                  └────────────────┘                               │
│                                                                   │
│  ┌───────────────────┐  ┌────────────────────┐                  │
│  │ terminal_sessions │  │ terminal_watchlists│                  │
│  │                   │  │                    │                  │
│  │ user_id           │  │ user_id            │                  │
│  │ account_id        │  │ name, color        │                  │
│  │ token_hash        │  │ items (JSONB)      │                  │
│  │ expires_at        │  └────────────────────┘                  │
│  └───────────────────┘                                           │
│                                                                   │
│  ┌────────────────────────┐  ┌────────────────────────┐         │
│  │ terminal_account_metrics│  │ terminal_audit_log    │         │
│  │                        │  │                        │         │
│  │ account_id, date       │  │ account_id, event_type │         │
│  │ realized_pnl           │  │ event_data (JSONB)     │         │
│  │ peak_balance           │  │ created_at             │         │
│  └────────────────────────┘  └────────────────────────┘         │
│                                                                   │
│  ┌────────────────────────┐  ┌────────────────────────┐         │
│  │ terminal_risk_events   │  │ terminal_order_audit   │         │
│  │                        │  │                        │         │
│  │ account_id, event_type │  │ order_id, event_type   │         │
│  │ severity, rule_type    │  │ previous/new status    │         │
│  │ resolved               │  │ latency_ms             │         │
│  └────────────────────────┘  └────────────────────────┘         │
│                                                                   │
│  ┌────────────────────────┐                                      │
│  │ terminal_payouts       │                                      │
│  │                        │                                      │
│  │ account_id, user_id    │                                      │
│  │ net_profit, payout_amt │                                      │
│  │ status (pending→done)  │                                      │
│  └────────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. SSO ARCHITECTURE

### Current Flow (from code)

```
Dashboard (fundedwealth.com)
  │
  │ User clicks "Open Terminal"
  │ Dashboard signs JWT: { sub: clerk_id, accountId, challengeId, nonce, exp: 60s }
  │ Secret: SSO_SHARED_SECRET
  │
  ▼
GET terminal.fundedwealth.com/auth/sso?token=<jwt>
  │
  │ File: server/routes/auth.routes.js
  │ Calls: validateSSOToken() in server/services/sso.service.js
  │
  ├─ Step 1: jwt.verify(token, SSO_SHARED_SECRET) → decode claims
  ├─ Step 2: Check nonce for replay (in-memory Set — problem in production)
  ├─ Step 3: Extract sub (= fw_user_id), accountId, challengeId
  ├─ Step 4: Lookup user → .from('users').eq('fw_user_id', sub) ← BROKEN
  ├─ Step 5: Lookup account → .from('trading_accounts').eq('id', accountId) ← BROKEN
  ├─ Step 6: Generate terminal JWT (24h, claims: userId, accountId, etc.)
  ├─ Step 7: Persist session → .from('sessions') ← WRONG TABLE
  │
  ▼
Set cookie: fw_session = terminal_jwt
Redirect to /
```

### What Is Correct

- The SSO design pattern (short-lived signed JWT from Dashboard → long-lived session on Terminal) is correct.
- The terminal JWT claim structure (`sub`, `accountId`, `challengeId`, `accountCode`, `permissions`) is correct.
- The httpOnly secure cookie approach is correct.
- The nonce replay protection concept is correct.
- The `requireAuth` middleware pattern is correct.

### What Is Broken

| Issue | Location | Root Cause |
|---|---|---|
| User lookup column | `sso.service.js` line 81 | Queries `.eq('fw_user_id', ...)` but table has `clerk_id` |
| Account lookup table | `sso.service.js` line 108 | Queries `trading_accounts` — table does not exist |
| Session persistence | `session.service.js` line 27 | Writes to `sessions` table with `token_hash` — live table has `session_token` column, different schema |
| Nonce storage | `sso.service.js` line 52 | In-memory Set — lost on server restart, breaks multi-instance |

### Target SSO Flow (Corrected)

```
Dashboard (fundedwealth.com)
  │
  │ User clicks "Open Terminal"
  │ Dashboard signs JWT: { sub: <users.id UUID>, accountId, challengeId, nonce, exp: 60s }
  │ Secret: SSO_SHARED_SECRET (same on both systems)
  │
  ▼
GET terminal.fundedwealth.com/auth/sso?token=<jwt>
  │
  ├─ Step 1: jwt.verify(token, SSO_SHARED_SECRET, { maxAge: 120s })
  ├─ Step 2: Check nonce replay via Redis SETNX (not in-memory)
  ├─ Step 3: Extract sub (= users.id UUID), accountId, challengeId
  ├─ Step 4: Lookup user → .from('users').eq('id', sub).select('id, is_active')
  ├─ Step 5: Lookup account → .from('terminal_accounts').eq('id', accountId).eq('user_id', sub)
  ├─ Step 6: Verify account.status = 'active'
  ├─ Step 7: Generate terminal JWT (24h)
  ├─ Step 8: Persist session → .from('terminal_sessions').insert(...)
  │
  ▼
Set cookie: fw_session = terminal_jwt (httpOnly, secure, sameSite=lax)
Redirect to /
```

**Key change:** The SSO token `sub` should be the `users.id` UUID — not `clerk_id`. This allows direct FK lookup without column aliasing. The Dashboard already knows the user's UUID from its own `users` table.

---

## 5. DATABASE ALIGNMENT

### Current Code vs Actual Database

| Code Queries | Actual Table | Status | Resolution |
|---|---|---|---|
| `from('users').eq('fw_user_id', ...)` | `users` exists with `clerk_id` | ❌ Wrong column | Change to `.eq('id', sub)` — use UUID |
| `from('trading_accounts')` | Does not exist | ❌ Missing | Create `terminal_accounts` |
| `from('challenge_accounts')` | Does not exist | ❌ Missing | Create `terminal_challenges` |
| `from('trading_orders')` | Does not exist | ❌ Missing | Create `terminal_orders` |
| `from('positions')` | Exists (empty, unknown schema) | ⚠️ Conflict | Create `terminal_positions`, ignore old `positions` |
| `from('executions')` | Does not exist | ❌ Missing | Create `terminal_trades` |
| `from('sessions')` (terminal writes) | Exists (Dashboard session table) | ❌ Wrong table | Create `terminal_sessions` |
| `from('watchlists')` | Does not exist | ❌ Missing | Create `terminal_watchlists` |
| `from('audit_log')` | Does not exist | ❌ Missing | Create `terminal_audit_log` |
| `from('account_metrics')` | Does not exist | ❌ Missing | Create `terminal_account_metrics` |
| `from('risk_events')` | Does not exist | ❌ Missing | Create `terminal_risk_events` |
| `from('broker_sessions')` | Does not exist | ❌ Missing | Create `terminal_broker_sessions` |

### Recommended Final Table Names

All terminal tables use `terminal_` prefix. No `t_` prefix (too cryptic). No bare names (collide with Dashboard).

```
terminal_accounts          ← was: trading_accounts / t_accounts
terminal_challenges        ← was: challenge_accounts / t_challenges
terminal_orders            ← was: trading_orders / t_orders
terminal_positions         ← was: positions / t_positions
terminal_trades            ← was: executions / t_trades
terminal_risk_rules        ← was: trading_accounts columns / t_risk_rules
terminal_sessions          ← was: sessions / t_sessions
terminal_watchlists        ← was: watchlists / t_watchlists
terminal_account_metrics   ← was: account_metrics / t_account_metrics
terminal_audit_log         ← was: audit_log
terminal_risk_events       ← was: risk_events / t_risk_events
terminal_order_audit       ← was: execution_audits / t_order_audit
terminal_broker_sessions   ← was: broker_sessions / t_broker_sessions
terminal_challenge_metrics ← was: challenge_progress / t_challenge_metrics
terminal_payouts           ← was: t_payouts
```

### Repository → Table Mapping (Final)

| Repository File | `super()` Value (Target) |
|---|---|
| `account.repository.js` | `'terminal_accounts'` |
| `challenge.repository.js` | `'terminal_challenges'` |
| `order.repository.js` | `'terminal_orders'` |
| `position.repository.js` | `'terminal_positions'` |
| `trade.repository.js` | `'terminal_trades'` |
| `risk-rules.repository.js` | `'terminal_risk_rules'` |
| `watchlist.repository.js` | `'terminal_watchlists'` |
| `metrics.repository.js` | `'terminal_account_metrics'` |
| `audit.repository.js` | `'terminal_audit_log'` |
| `risk-event.repository.js` | `'terminal_risk_events'` |
| `order-audit.repository.js` | `'terminal_order_audit'` |
| `broker-session.repository.js` | `'terminal_broker_sessions'` |
| `challenge-metrics.repository.js` | `'terminal_challenge_metrics'` |
| `user.repository.js` | `'users'` (read-only, Dashboard-owned) |

---

## 6. ORDER FLOW DESIGN

### Ideal Flow

```
Frontend: OrderPanel.tsx → api.placeOrder()
  │
  ▼
POST /api/orders/place (server/routes/api.js)
  │ requireAuth → requirePermission('trade')
  │
  ▼
AccountService.placeOrder() (server/services/accountService.js)
  │
  ├─ INSERT into terminal_orders (status: PENDING)
  ├─ Publish 'order.created' to event bus
  ├─ Call _executeOrderAsync() — fire-and-forget
  │
  ▼ (async)
OrderExecutionService.executeOrder() (server/services/orderExecutionService.js)
  │
  ├─ Step 1: RiskEngine.validateOrder()
  │     ├─ HolidayService.checkMarketClosed()
  │     ├─ checkAllowedSegments()
  │     ├─ checkTradingHours()
  │     ├─ checkNoOvernight()
  │     ├─ checkMaxPositions()
  │     ├─ checkMaxLotSize()
  │     ├─ checkMaxDailyTrades()
  │     ├─ checkDailyLossLimit()
  │     └─ checkMarginAvailability()
  │     → If REJECTED: update terminal_orders.status, publish event, STOP
  │
  ├─ Step 2: BrokerFactory.create('angelone') → AngelOneAdapter.placeOrder()
  │     → POST apiconnect.angelone.in/order/v1/placeOrder
  │     → If broker rejects: mark REJECTED, publish, STOP
  │
  ├─ Step 3: For MARKET orders (assume instant fill):
  │     ├─ OrderRepository.markFilled() → terminal_orders
  │     ├─ PositionRepository.upsertPosition() → terminal_positions
  │     ├─ TradeRepository.recordTrade() → terminal_trades
  │     ├─ RiskEngine.postTradeCheck()
  │     │     ├─ Check daily loss → lock account if breached
  │     │     ├─ Check max drawdown → breach account if breached
  │     │     └─ Check profit target → mark challenge passed if hit
  │     ├─ Publish 'order.updated' (FILLED)
  │     ├─ Publish 'position.updated'
  │     └─ OrderAuditRepository → terminal_order_audit
  │
  └─ Step 3b: For LIMIT/SL orders:
        ├─ Mark OPEN in terminal_orders
        └─ Await broker fill callback (handleBrokerFill)
```

### Current Implementation vs Ideal

| Step | Current Code | Issue | Fix Required |
|---|---|---|---|
| Insert order | `supabase.from('trading_orders').insert(...)` | Table missing. Falls back to in-memory Map. | Change to `terminal_orders`. Create table. |
| Risk check | `RiskRulesRepository.getRulesMap()` | Queries `trading_accounts` for risk columns. Table missing. | Change to `terminal_risk_rules` dedicated table. |
| Broker call | `BrokerFactory.create('angelone')` | Works if adapter pre-registered from AngelFeedConnector. | Needs credentials configured. |
| Position update | `PositionRepository.upsertPosition()` | Queries `positions` by `user_id`. Should be `account_id`. | Change table + column. |
| Trade record | `TradeRepository.recordTrade()` | Queries `executions`. Table missing. | Change to `terminal_trades`. |
| Post-trade risk | `RiskEngine.postTradeCheck()` | Queries `trading_accounts` via accountRepo. Missing. | Fix table reference. |
| Order audit | `OrderAuditRepository` | Queries `execution_audits`. Missing. | Change to `terminal_order_audit`. |

---

## 7. CHALLENGE SYSTEM DESIGN

### Lifecycle

```
Payment Confirmed (Dashboard orders.status = 'paid')
  │
  ▼ (provisioning trigger — admin endpoint or webhook)
POST /admin/provision { userId, planType, orderId }
  │
  ├─ Create terminal_challenges (phase_1, active, initial_balance per plan)
  ├─ Create terminal_accounts (active, balance = initial_balance)
  ├─ Seed terminal_risk_rules (7-8 rules per plan)
  ├─ Log to terminal_audit_log
  │
  ▼
Phase 1: Evaluation (Active Trading)
  │
  │ Each trade → RiskEngine.postTradeCheck() → ChallengeService.checkTransitions()
  │
  ├─ profit_target reached + min_trading_days → status: PASSED
  │     │
  │     ▼
  │   ChallengeService.promoteToNextPhase()
  │     ├─ New terminal_challenges (phase_2, active)
  │     ├─ New terminal_accounts (fresh balance)
  │     ├─ Seed Phase 2 risk rules (lower profit target)
  │     └─ Old account → status: completed
  │
  ├─ max_drawdown breached → status: FAILED, account: BREACHED
  ├─ daily_loss_limit hit → account: LOCKED (unlocks next trading day)
  ├─ expires_at passed → status: EXPIRED
  │
  ▼
Phase 2: Evaluation (Same as Phase 1, lower target)
  │
  ├─ Passes → Promote to Funded
  │
  ▼
Funded Account
  │
  │ No profit target. Trade freely within drawdown rules.
  │ payout_eligible = true
  │
  ├─ Trader requests payout → POST /api/account/payout/request
  │     → Inserts terminal_payouts (status: pending)
  │     → Dashboard reads terminal_payouts and handles disbursement
  │
  ├─ max_drawdown breached → BREACHED (trading stops permanently)
  └─ daily_loss_limit → LOCKED (resumes next day)
```

### Required Tables

| Table | Purpose |
|---|---|
| `terminal_challenges` | Phase lifecycle, status, initial balance, expiry |
| `terminal_accounts` | Trading balance, peak, status, broker link |
| `terminal_risk_rules` | Per-account JSONB rules |
| `terminal_account_metrics` | Daily P&L snapshots |
| `terminal_challenge_metrics` | Milestone events |
| `terminal_payouts` | Payout requests from funded accounts |

### Required Services

| Service | File | Responsibility |
|---|---|---|
| ChallengeService | `server/services/challengeService.js` | Progress, transitions, promotion, daily checks |
| RiskEngine | `server/services/riskEngine.js` | Pre/post trade validation, lock/breach |
| AccountService | `server/services/accountService.js` | Account CRUD, margin, P&L tracking |
| PayoutService | `server/services/payoutService.js` | Eligibility check, payout request |
| DailyChecks cron | `server/cron/dailyChecks.js` | Unlock accounts, check expiry, record metrics |

### Required APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/account/challenge` | GET | Current challenge progress |
| `/api/account/rules` | GET | Active risk rules for display |
| `/api/account/payout/eligibility` | GET | Can trader request payout? |
| `/api/account/payout/request` | POST | Submit payout request |
| `/api/account/challenge/promote` | POST | Manual promotion (admin/test) |
| `/admin/provision` | POST | Create trading account for paid user |

---

## 8. BROKER ARCHITECTURE

### Angel One — Status: PARTIAL (Code Complete, Needs Credentials)

| Component | File | Status | Notes |
|---|---|---|---|
| TOTP Login | `angel.feed.connector.js :: login()` | Production Ready | Uses `@otplib/preset-default` |
| SmartStream WebSocket | `angel.feed.connector.js :: connect()` | Production Ready | Binary parser for modes 1/2/3 |
| Token Refresh | `angel.feed.connector.js :: refreshJWT()` | Production Ready | Proactive 55-min refresh cycle |
| Reconnection | `angel.feed.connector.js :: _attemptReconnect()` | Production Ready | Exponential backoff, max 50 attempts |
| Order Execution | `angelone.adapter.js :: placeOrder()` | Production Ready | Full SmartAPI payload |
| Order Modify | `angelone.adapter.js :: modifyOrder()` | Production Ready | — |
| Order Cancel | `angelone.adapter.js :: cancelOrder()` | Production Ready | — |
| Historical Candles | `candleService.js :: getHistoricalCandles()` | Production Ready | Auto-retry on 403 |
| Market Depth (REST) | `depthService.js :: getDepth()` | Production Ready | FULL mode quote |
| Option Chain | `optionChainService.js :: getOptionChain()` | Production Ready | searchScrip + batch quote |
| Instance Sharing | `broker.factory.js :: registerInstance()` | Production Ready | Feed session → order adapter |
| Health Monitor | `brokers/health.monitor.js` | Production Ready | 30s check interval |

**Blocker:** All features require env vars: `ANGEL_API_KEY`, `ANGEL_CLIENT_ID`, `ANGEL_PASSWORD`, `ANGEL_TOTP_SECRET`

### Dhan — Status: UNUSED

| Component | File | Status |
|---|---|---|
| Adapter Structure | `server/brokers/dhan/dhan.adapter.js` | Placeholder only |
| Type Definitions | `server/brokers/dhan/dhan.types.js` | Defined |
| Factory Support | `broker.factory.js` | Throws "not yet implemented" |

**Verdict:** Do not use Dhan in v1. Angel One is the sole broker. Dhan can be added as secondary/failover later.

### Market Data Pipeline

```
Angel One SmartStream (wss://smartapisocket.angelone.in/smart-stream)
  │
  │ Binary WebSocket frames (mode 1: LTP, mode 2: Quote, mode 3: SnapQuote)
  │
  ▼
AngelFeedConnector._parseTick() → MarketDataEngine.pushQuote()
  │
  ├─ Event Bus: 'market.tick' → EventBridge → Socket.IO → Frontend marketStore
  ├─ CandleService.processLiveTick() → candle aggregation (1/5/15 min)
  └─ AccountService position tracking → P&L per tick → 'position.updated'
```

### Order Routing

```
OrderExecutionService
  │
  ▼
BrokerFactory.create('angelone')
  │
  ├─ Returns pre-registered instance (shared from AngelFeedConnector session)
  │
  ▼
AngelOneAdapter.placeOrder()
  │
  ▼
POST https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder
  │
  ▼
Response: { orderid, orderstatus }
```

---

## 9. ACCOUNT PROVISIONING FLOW (The Missing Piece)

### Current State

```
User pays on Dashboard → orders.status = 'paid' (17 rows)
  │
  ▼
NOTHING HAPPENS
  │
  ▼
Admin manually creates account (not verified, not documented)
```

### Target State

```
User pays on Dashboard → orders.status = 'paid'
  │
  ├─ Option A: Dashboard calls POST terminal.fundedwealth.com/admin/provision
  │            with { userId: users.id, planType: orders.plan_type, orderId: orders.id }
  │            Header: Authorization: Bearer <ADMIN_SECRET>
  │
  └─ Option B: Supabase trigger on orders table fires edge function
               that calls the same provision endpoint
  │
  ▼
Terminal /admin/provision handler:
  │
  ├─ Validate ADMIN_SECRET
  ├─ Look up user in `users` table (verify exists, is_active)
  ├─ Map planType ('1step' → '10K', '2step_25k' → '25K', etc.)
  ├─ Call ChallengeService.getPlanConfig(plan) for balance, rules
  ├─ INSERT terminal_challenges
  ├─ INSERT terminal_accounts
  ├─ Seed terminal_risk_rules
  ├─ INSERT terminal_audit_log (event: account_provisioned)
  ├─ Return { success: true, accountId, challengeId, accountCode }
  │
  ▼
Dashboard stores accountId for SSO token generation
```

**Recommended approach:** Option A (webhook from Dashboard). Simpler, no edge function dependency, testable, same auth pattern as existing admin endpoints.

---

## 10. FINAL ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTERNET / BROWSER                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│  fundedwealth.  │  │  terminal.       │  │  admin.             │
│  com            │  │  fundedwealth.   │  │  fundedwealth.com   │
│  (Dashboard)    │  │  com             │  │  (Admin Panel)      │
│                 │  │  (Terminal)       │  │                     │
│  • Registration │  │  • Charts        │  │  • Provision accts  │
│  • KYC          │  │  • Orders        │  │  • View positions   │
│  • Payments     │  │  • Positions     │  │  • Lock/unlock      │
│  • Plan select  │  │  • Risk monitor  │  │  • Approve payouts  │
│  • Certificates │  │  • Option chain  │  │                     │
│                 │  │  • Market depth  │  │                     │
└────────┬────────┘  └────────┬─────────┘  └────────┬────────────┘
         │                    │                      │
         │  SSO Token         │  REST + WS           │  Admin API
         │  (signed JWT)      │  /api/* /ws          │  /admin/*
         │                    │                      │
         └────────────────────┼──────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    TERMINAL SERVER (Node.js)                         │
│                    Port 4000 / Express + Socket.IO                   │
│                                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐               │
│  │ Auth     │  │ API Routes   │  │ WebSocket /ws   │               │
│  │ /auth/*  │  │ /api/*       │  │ Socket.IO       │               │
│  └────┬─────┘  └──────┬───────┘  └───────┬────────┘               │
│       │                │                  │                         │
│       ▼                ▼                  │                         │
│  ┌──────────────────────────────────┐     │                         │
│  │         SERVICE LAYER            │     │                         │
│  │                                  │     │                         │
│  │  AccountService                  │     │                         │
│  │  OrderExecutionService           │     │                         │
│  │  ChallengeService                │     │                         │
│  │  RiskEngine                      │     │                         │
│  │  MarginService                   │     │                         │
│  │  HolidayService                  │     │                         │
│  └──────────────┬───────────────────┘     │                         │
│                 │                         │                         │
│       ┌─────────┼─────────┐              │                         │
│       ▼         ▼         ▼              ▼                         │
│  ┌─────────┐ ┌───────┐ ┌──────────────────────────┐               │
│  │ Repos   │ │ Event │ │  MarketDataEngine         │               │
│  │ (DB)    │ │ Bus   │ │  + CandleService          │               │
│  └────┬────┘ └───┬───┘ │  + DepthService           │               │
│       │           │     │  + OptionChainService     │               │
│       │           │     └────────────┬─────────────┘               │
│       │           │                  │                              │
│       │           ▼                  │                              │
│       │     ┌──────────────┐         │                              │
│       │     │ Event Bridge │─────────┼──→ Socket.IO → Frontend     │
│       │     └──────────────┘         │                              │
│       │                              │                              │
│       ▼                              ▼                              │
│  ┌──────────────┐           ┌─────────────────────┐               │
│  │  Supabase    │           │  Angel One APIs     │               │
│  │  (Postgres)  │           │                     │               │
│  │              │           │  • SmartStream WS   │               │
│  │  terminal_*  │           │  • REST (orders)    │               │
│  │  users (RO)  │           │  • Historical API   │               │
│  └──────────────┘           └─────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 11. SAFE IMPLEMENTATION ORDER

Each phase is independently testable. Later phases depend on earlier ones.

### Phase 1: Database Foundation (No code logic changes)

| Step | Action | Risk | Verify |
|---|---|---|---|
| 1.1 | Write final migration SQL with `terminal_*` naming | None — SQL only | Review SQL manually |
| 1.2 | Run migration against production Supabase | Low — creates new tables, touches nothing existing | Check all tables exist via `supabase-reality-check.js` |
| 1.3 | Verify no collision with existing `users`, `orders`, `sessions`, `positions` tables | None — different names | Confirm old tables untouched |

### Phase 2: Repository Alignment (String replacements only)

| Step | Action | Risk | Verify |
|---|---|---|---|
| 2.1 | Update all `super('...')` calls in repositories to `terminal_*` names | Low — 14 files, ~25 string changes | Run `node server/test-tables.js` to confirm queries succeed |
| 2.2 | Update all direct `.from('...')` calls in services to `terminal_*` names | Low | Same verification script |
| 2.3 | Fix `position.repository.js` to use `account_id` consistently (not `user_id`) | Medium — logic change | Unit test position CRUD |

### Phase 3: SSO Fix

| Step | Action | Risk | Verify |
|---|---|---|---|
| 3.1 | Change `sso.service.js` user lookup to `.eq('id', sub)` instead of `.eq('fw_user_id', sub)` | Low | Login with dev SSO token |
| 3.2 | Change `sso.service.js` account lookup to `terminal_accounts` | Low | — |
| 3.3 | Change `session.service.js` to use `terminal_sessions` | Low | — |
| 3.4 | Configure `SSO_SHARED_SECRET` and `JWT_SECRET` in production env | Medium — coordination with Dashboard | Verify via `/auth/dev/generate-sso` |
| 3.5 | Update Dashboard to send `users.id` as `sub` in SSO token | External dependency | End-to-end SSO test |

### Phase 4: Account Provisioning

| Step | Action | Risk | Verify |
|---|---|---|---|
| 4.1 | Create `POST /admin/provision` endpoint | Low — new route | Call with test data |
| 4.2 | Implement provisioning logic (challenge + account + rules creation) | Medium | Verify all 3 records + rules created |
| 4.3 | Backfill 17 existing paid orders via `/admin/provision` | Medium — one-time, irreversible | Manual review per order first |
| 4.4 | Wire Dashboard to call `/admin/provision` on payment confirmation | External dependency | End-to-end payment → account test |

### Phase 5: Broker Credentials

| Step | Action | Risk | Verify |
|---|---|---|---|
| 5.1 | Set `ANGEL_API_KEY`, `ANGEL_CLIENT_ID`, `ANGEL_PASSWORD`, `ANGEL_TOTP_SECRET` in production | Medium — real money capability | Check `/health` shows feed connected |
| 5.2 | Verify SmartStream connects and live quotes flow | Low | Check `/api/market/live` shows symbols |
| 5.3 | Verify historical candles return data | Low | Check chart loads in frontend |
| 5.4 | Verify option chain returns strikes | Low | Select NIFTY, check options tab |

### Phase 6: End-to-End Trading Test

| Step | Action | Risk | Verify |
|---|---|---|---|
| 6.1 | Create one test trading account (via admin endpoint) | Low | Account appears in terminal after SSO |
| 6.2 | Place one MARKET order for a small qty | HIGH — real broker order | Verify: order in `terminal_orders`, position in `terminal_positions`, trade in `terminal_trades` |
| 6.3 | Exit position | Medium | Position closes, P&L recorded |
| 6.4 | Verify risk rules enforce (try order outside hours) | Low | Should be rejected |
| 6.5 | Simulate daily loss limit breach | Medium | Account should lock |

### Phase 7: Production Hardening

| Step | Action | Risk | Verify |
|---|---|---|---|
| 7.1 | Replace in-memory nonce Set with Redis SETNX | Low | — |
| 7.2 | Enable RLS policies on all `terminal_*` tables | Low | — |
| 7.3 | Set up monitoring alerts for: feed disconnect, order failures, account breaches | Low | — |
| 7.4 | Load test with multiple concurrent users | Medium | — |
| 7.5 | Remove `DEV_BYPASS_AUTH` and `/auth/dev/generate-sso` from production build | Low | — |

---

## 12. FILES REQUIRING CHANGES (Reference Only)

### Repository Layer (table name updates)

```
server/repositories/account.repository.js      → super('terminal_accounts')
server/repositories/challenge.repository.js    → super('terminal_challenges')
server/repositories/order.repository.js        → super('terminal_orders')
server/repositories/position.repository.js     → super('terminal_positions')
server/repositories/trade.repository.js        → super('terminal_trades')
server/repositories/risk-rules.repository.js   → super('terminal_risk_rules')
server/repositories/watchlist.repository.js    → super('terminal_watchlists')
server/repositories/metrics.repository.js      → super('terminal_account_metrics')
server/repositories/audit.repository.js        → super('terminal_audit_log')
server/repositories/risk-event.repository.js   → super('terminal_risk_events')
server/repositories/order-audit.repository.js  → super('terminal_order_audit')
server/repositories/broker-session.repository.js → super('terminal_broker_sessions')
server/repositories/challenge-metrics.repository.js → super('terminal_challenge_metrics')
```

### Service Layer (direct .from() calls)

```
server/services/sso.service.js          → .from('users') stays, .from('trading_accounts') → terminal_accounts
server/services/session.service.js      → .from('sessions') → terminal_sessions (×4)
server/services/accountService.js       → 5 table references need updating
server/services/orderExecutionService.js → 3 table references
server/services/riskEngine.js           → .from('challenge_accounts') → terminal_challenges
server/services/payoutService.js        → fix audit_logs → terminal_audit_log
server/cron/dailyChecks.js              → .from('trading_accounts') → terminal_accounts (×2)
```

### Position Repository (logic fix)

```
server/repositories/position.repository.js
  - findOpenByAccountId(): change .eq('user_id', ...) → .eq('account_id', ...)
  - findOpenPosition(): same fix
  - findAllByAccountId(): same fix
  - upsertPosition(): insert user_id → insert account_id
  - countOpenPositions(): already uses account_id (correct)
```

### New Files Needed

```
server/routes/admin.routes.js    → POST /admin/provision endpoint
server/db/final-migration.sql    → All terminal_* tables DDL
```

---

*End of Architecture Design Document*
*Date: June 22, 2026*
*Status: PLAN ONLY — No code written, no files modified, no migrations run.*
