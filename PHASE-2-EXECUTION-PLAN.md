# PHASE 2 — EXECUTION PLAN

**Date:** 2026-06-17  
**Goal:** Make terminal architecture production-ready for real brokers.  
**Constraint:** No specific broker integration. No UI changes. No TradingView.

---

## EXECUTION PRIORITY ORDER

```
Phase 2A: Supabase Live Connection           [FOUNDATION]
Phase 2B: Dashboard → Terminal SSO            [AUTH]
Phase 2C: Account Mapping + Session Context   [IDENTITY]
Phase 2D: Risk Engine + Persistence           [SAFETY]
Phase 2E: Challenge Tracking                  [PROP FIRM LOGIC]
Phase 2F: Broker Adapter Interface Finalize   [INTEGRATION PREP]
```

---

## PHASE 2A — SUPABASE LIVE CONNECTION

**Goal:** Connect terminal to a real Supabase project. All data reads/writes go to DB.

### Tasks

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Create Supabase project, get URL + service key | External | 15 min |
| 2 | Run `schema.sql` in Supabase SQL editor | `server/db/schema.sql` | 10 min |
| 3 | Run all 3 migrations | `server/db/migrations/*.sql` | 10 min |
| 4 | Set env vars in `.env` (SUPABASE_URL, SUPABASE_SERVICE_KEY) | `server/.env` | 5 min |
| 5 | Verify `testConnection()` returns `{ connected: true }` | `server/db/client.js` | 5 min |
| 6 | Run seed data (1 user, 1 challenge, 1 account, risk rules) | SQL from PHASE-2-SUPABASE-IMPLEMENTATION.md | 10 min |
| 7 | Replace `getAccount()` → query Supabase `accounts` table | `server/services/brokerService.js` → new `server/services/accountService.js` | 1 hr |
| 8 | Replace `getDemoPositions()` → query Supabase `positions` table | `server/services/brokerService.js` → `accountService.js` | 1 hr |
| 9 | Replace `getDemoOrders()` → query Supabase `orders` table | `server/services/brokerService.js` → `accountService.js` | 1 hr |
| 10 | Replace hardcoded watchlists → query Supabase `watchlists` table | `src/store/appStore.ts` + new API endpoint | 2 hr |

**Total Effort: ~6 hours**  
**Dependency: None**  
**Outcome:** Terminal reads real data from DB. Demo positions/orders/account gone.

---

## PHASE 2B — DASHBOARD → TERMINAL SSO

**Goal:** Users can only access terminal via Dashboard SSO link. No direct access.

### Tasks

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Set `SSO_SHARED_SECRET` in env (same key on Dashboard + Terminal) | `.env` | 5 min |
| 2 | Set `JWT_SECRET` in env | `.env` | 5 min |
| 3 | Create auth middleware that validates JWT on every `/api/*` request | New: `server/middleware/auth.middleware.js` | 2 hr |
| 4 | Apply middleware to API router in `server/index.js` | `server/index.js` | 15 min |
| 5 | Create frontend auth check: call `GET /auth/verify` on mount | New: `src/hooks/useAuth.ts` | 1.5 hr |
| 6 | If verify fails → redirect to `FW_DASHBOARD_URL` | `src/App.tsx` or layout wrapper | 1 hr |
| 7 | Dashboard integration: generate SSO token with user's accountId | Dashboard codebase (external) | 2 hr |
| 8 | Test full flow: Dashboard → SSO → Terminal loads → JWT set | Integration test | 1 hr |

**Total Effort: ~8 hours**  
**Dependency: Phase 2A (Supabase must be live for user/account lookup)**  
**Outcome:** Terminal is access-controlled. Only authenticated users see it.

### Already Implemented (Ready to Use)

- `server/routes/auth.routes.js` — SSO endpoint, verify, logout ✅
- `server/services/sso.service.js` — Token validation, nonce check ✅
- `server/services/auth.service.js` — JWT sign/verify ✅
- `server/services/session.service.js` — Session create/revoke ✅

### Remaining Work

- Auth middleware that extracts `accountId` from JWT and injects into `req`
- Frontend hook that checks auth state and redirects
- Dashboard-side SSO token generation

---

## PHASE 2C — ACCOUNT MAPPING + SESSION CONTEXT

**Goal:** Every API call is scoped to the authenticated user's account. The terminal "knows" which account it's serving.

### Tasks

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Auth middleware injects `req.accountId`, `req.userId`, `req.brokerProvider` | `server/middleware/auth.middleware.js` | 30 min |
| 2 | All order/position/trade queries filter by `account_id = req.accountId` | `server/routes/api.js` | 1.5 hr |
| 3 | Create `GET /api/account` → return account + challenge + rules from DB | New: `server/routes/account.routes.js` | 2 hr |
| 4 | Frontend: store account context (balance, status, rules, broker) | New: `src/store/accountStore.ts` | 1.5 hr |
| 5 | Display account code + balance in terminal header | `src/components/Header.tsx` (minor) | 30 min |
| 6 | Account status gate: if `status !== 'active'`, show "Account Locked" | Frontend guard | 1 hr |

**Total Effort: ~7 hours**  
**Dependency: Phase 2B (JWT must contain accountId)**  
**Outcome:** Terminal is fully multi-tenant. Each user sees only their data.

---

## PHASE 2D — RISK ENGINE + PERSISTENCE

**Goal:** Pre-trade risk checks enforced. Post-trade P&L tracked. Positions/orders persisted in DB.

### Tasks

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Create Risk Engine service | New: `server/services/riskEngine.js` | 4 hr |
| 2 | Load risk rules from `risk_rules` table on session start | `riskEngine.js` | 1 hr |
| 3 | Pre-trade checks: daily loss limit, max positions, allowed segments, trading hours, max lot size | `riskEngine.js` | 3 hr |
| 4 | Post-trade checks: recalculate daily P&L, check drawdown, detect breach | `riskEngine.js` | 3 hr |
| 5 | Order persistence: INSERT into `orders` table before sending to broker | `server/routes/api.js` + `accountService.js` | 2 hr |
| 6 | Position persistence: UPSERT into `positions` table on fill | `accountService.js` | 2 hr |
| 7 | Trade persistence: INSERT into `trades` table on execution | `accountService.js` | 1 hr |
| 8 | Account balance update: UPDATE `accounts.balance` on realized P&L | `accountService.js` | 1 hr |
| 9 | Account lock on breach: UPDATE `accounts.status = 'breached'` | `riskEngine.js` | 1 hr |
| 10 | Daily metrics snapshot: INSERT into `account_metrics` at EOD | New: `server/services/metricsService.js` | 2 hr |

**Total Effort: ~20 hours**  
**Dependency: Phase 2C (must know which account to apply rules to)**  
**Outcome:** Risk is enforced. Data survives restart. Accounts auto-lock on breach.

### Risk Engine Pre-Trade Check Flow

```
Order arrives → riskEngine.validateOrder(accountId, orderParams)
  │
  ├── Check: daily_loss_limit (current realized + unrealized P&L < limit)
  ├── Check: max_positions (count open positions < limit)
  ├── Check: max_lot_size (order qty ÷ lotSize ≤ max for segment)
  ├── Check: allowed_segments (order.segment in allowed list)
  ├── Check: trading_hours (current time within window)
  ├── Check: max_daily_trades (today's trade count < limit)
  │
  └── Result: { allowed: true } or { allowed: false, reason: "..." }
```

### Risk Engine Post-Trade Check Flow

```
Trade executed → riskEngine.postTradeCheck(accountId)
  │
  ├── Calculate: today's realized P&L (sum of closed trades)
  ├── Calculate: unrealized P&L (open positions × current LTP)
  ├── Calculate: total daily loss = realized + unrealized
  ├── Calculate: drawdown from peak_balance
  │
  ├── If daily_loss_limit breached → LOCK account, close all positions
  ├── If max_drawdown breached → BREACH account, close all positions, fail challenge
  ├── If profit_target reached → COMPLETE account, pass challenge
  │
  └── Update accounts.balance, accounts.peak_balance
```

---

## PHASE 2E — CHALLENGE TRACKING

**Goal:** Challenge pass/fail logic runs automatically. Dashboard can query terminal for progress.

### Tasks

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Create Challenge Service | New: `server/services/challengeService.js` | 3 hr |
| 2 | Challenge progress calculation (P&L %, days traded, drawdown) | `challengeService.js` | 2 hr |
| 3 | Auto-pass detection (profit target hit + min days met) | `challengeService.js` | 1.5 hr |
| 4 | Auto-fail detection (max drawdown breached / time expired) | `challengeService.js` | 1.5 hr |
| 5 | Challenge status transitions (active → passed / failed / expired) | `challengeService.js` | 1 hr |
| 6 | Webhook to Dashboard on status change | New: `server/services/webhookService.js` | 2 hr |
| 7 | API: `GET /api/account/challenge` → return progress | `server/routes/account.routes.js` | 1 hr |
| 8 | Daily cron: check expiry, calculate metrics, detect min_trading_days | New: `server/cron/dailyChecks.js` | 2 hr |

**Total Effort: ~14 hours**  
**Dependency: Phase 2D (risk engine provides P&L data)**  
**Outcome:** Challenges auto-pass/fail. Dashboard stays synced via webhook.

---

## PHASE 2F — BROKER ADAPTER INTERFACE FINALIZE

**Goal:** Broker adapter interface is complete, tested with mocks, ready for any broker to plug in.

### Tasks

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Finalize `BaseBrokerAdapter` abstract class (all methods defined) | `server/brokers/broker.interface.ts` | 2 hr |
| 2 | Define exact method signatures: connect, placeOrder, modifyOrder, cancelOrder, getPositions, getOrders, subscribeQuotes, subscribeDepth, getOptionChain, getHistoricalData, getInstruments | `broker.interface.ts` | 2 hr |
| 3 | Create `MockBrokerAdapter` that returns realistic data (for testing) | New: `server/brokers/mock/mock.adapter.ts` | 3 hr |
| 4 | Update `BrokerFactory` to support 'mock' provider | `server/brokers/broker.factory.ts` | 30 min |
| 5 | Create instrument file download interface | New: `server/brokers/instruments.interface.ts` | 1 hr |
| 6 | Define WebSocket feed interface (quote format, depth format) | `broker.interface.ts` | 1 hr |
| 7 | Connect `MarketDataEngine` to use broker adapter for live feed | `server/services/marketDataEngine.js` | 2 hr |
| 8 | Wire order placement through broker adapter (with DB persistence) | `server/routes/api.js` | 2 hr |

**Total Effort: ~13.5 hours**  
**Dependency: Phase 2D (orders must persist before going to broker)**  
**Outcome:** Any broker can be plugged in by implementing `BaseBrokerAdapter`.

### Adapter Methods Required

```typescript
interface BaseBrokerAdapter {
  // Connection
  connect(credentials: BrokerCredentials): Promise<void>;
  disconnect(): Promise<void>;
  isConnected: boolean;

  // Orders
  placeOrder(params: OrderParams): Promise<OrderResult>;
  modifyOrder(orderId: string, params: ModifyParams): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<CancelResult>;

  // Data
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;
  getTrades(from: Date, to: Date): Promise<Trade[]>;
  getAccount(): Promise<AccountInfo>;

  // Market Data
  subscribeQuotes(tokens: string[], callback: QuoteCallback): void;
  unsubscribeQuotes(tokens: string[]): void;
  subscribeDepth(token: string, callback: DepthCallback): void;
  unsubscribeDepth(token: string): void;

  // Instruments
  downloadInstrumentFile(): Promise<Instrument[]>;
  getOptionChain(symbol: string, expiry: string): Promise<OptionChainEntry[]>;
  getHistoricalData(token: string, tf: string, from: Date, to: Date): Promise<OHLC[]>;
}
```

---

## DEPENDENCY GRAPH

```
Phase 2A ─────────┐
(Supabase)        │
                  ▼
Phase 2B ─────────┐
(SSO)             │
                  ▼
Phase 2C ─────────┐
(Account Map)     │
                  ▼
Phase 2D ─────────┬──── Phase 2E
(Risk Engine)     │    (Challenge Tracking)
                  │
                  ▼
              Phase 2F
         (Broker Interface)
```

**Phases 2E and 2F can run in parallel after 2D.**

---

## EFFORT SUMMARY

| Phase | Description | Hours | Calendar (1 dev) |
|-------|-------------|-------|-----------------|
| 2A | Supabase Live | 6 hr | 1 day |
| 2B | SSO Auth | 8 hr | 1.5 days |
| 2C | Account Mapping | 7 hr | 1 day |
| 2D | Risk Engine | 20 hr | 3 days |
| 2E | Challenge Tracking | 14 hr | 2 days |
| 2F | Broker Interface | 13.5 hr | 2 days |
| **Total** | | **68.5 hr** | **~10.5 working days** |

---

## WHAT IS NOT IN THIS PLAN (Intentionally Excluded)

| Item | Reason |
|------|--------|
| Angel One adapter | Not building specific broker yet — interface first |
| Dhan adapter | Same |
| TradingView charts | Not required — lightweight-charts works |
| UI redesign | UI is accepted as-is |
| Real market data feed | Comes with broker adapter (Phase 3) |
| Mobile responsive | Not in scope |
| Admin panel | Dashboard handles admin |

---

## FILES THAT WILL BE CREATED

| File | Phase | Purpose |
|------|-------|---------|
| `server/middleware/auth.middleware.js` | 2B | JWT validation on all API routes |
| `server/services/accountService.js` | 2A | DB queries for account/positions/orders |
| `server/routes/account.routes.js` | 2C | Account, challenge, rules API |
| `server/services/riskEngine.js` | 2D | Pre-trade + post-trade risk checks |
| `server/services/metricsService.js` | 2D | Daily P&L snapshots |
| `server/services/challengeService.js` | 2E | Challenge pass/fail logic |
| `server/services/webhookService.js` | 2E | Notify Dashboard on events |
| `server/cron/dailyChecks.js` | 2E | EOD processing |
| `server/brokers/mock/mock.adapter.ts` | 2F | Testing adapter |
| `server/brokers/instruments.interface.ts` | 2F | Instrument download contract |
| `src/hooks/useAuth.ts` | 2B | Frontend auth state |
| `src/store/accountStore.ts` | 2C | Account context in frontend |

---

## FILES THAT WILL BE MODIFIED

| File | Phase | Change |
|------|-------|--------|
| `server/index.js` | 2B | Add auth middleware before API routes |
| `server/routes/api.js` | 2C, 2D | Scope queries by accountId, add risk checks |
| `server/services/brokerService.js` | 2A | Remove all demo methods, delegate to accountService |
| `server/services/marketDataEngine.js` | 2F | Accept broker adapter for live feed |
| `server/brokers/broker.factory.ts` | 2F | Add 'mock' case, remove error throws |
| `server/brokers/broker.interface.ts` | 2F | Complete all method definitions |
| `src/store/appStore.ts` | 2A | Load watchlists from API instead of hardcoded |
| `src/App.tsx` | 2B | Add auth gate wrapper |
| `.env` | 2A | Add Supabase + SSO secrets |

---

## FILES THAT WILL BE DELETED

| File | Phase | Reason |
|------|-------|--------|
| None | — | No deletions — old code gets refactored, not removed |

---

## FIRST ACTIONS (Start Here)

1. Create Supabase project at supabase.com
2. Run `schema.sql` in SQL editor
3. Run 3 migration files in order
4. Copy project URL and service role key to `.env`
5. Start server, confirm `GET /health` returns `{ database: { connected: true } }`
6. Insert seed data
7. Create `accountService.js` — first real DB-backed service
8. Replace `getAccount()` to return data from DB

---

*End of Phase 2 Execution Plan*
