# CURRENT IMPLEMENTATION STATUS

**Date:** 2026-06-17  
**Based on:** Actual code in repository (not plans or roadmaps)

---

## MODULE STATUS OVERVIEW

| Module | Status | Notes |
|--------|--------|-------|
| Authentication | **COMPLETE** | JWT sign/verify/hash, cookie extraction, middleware |
| SSO | **COMPLETE** | Token validation, nonce replay protection, session creation |
| Session Management | **COMPLETE** | Create, revoke, revoke-all, validity check |
| Supabase Client | **COMPLETE** | Client init, connection test, env var fallback |
| Database Schema | **COMPLETE** | 10 tables, indexes, RLS enabled, 3 migrations |
| Repositories | **COMPLETE** | 10 repositories, full CRUD, all tables covered |
| Account Service | **COMPLETE** | DB-backed account/orders/positions/trades, broker adapter slot |
| Challenge Service | **COMPLETE** | Progress calculation, auto-transitions, daily checks |
| Risk Engine | **COMPLETE** | 6 pre-trade checks, 3 post-trade checks, all DB-persisted |
| Order Engine | **COMPLETE** | Persist → risk check → broker route → position update → post-check |
| Position Engine | **COMPLETE** | Upsert, close, P&L calculation, direction handling |
| WebSocket Layer | **COMPLETE** | Pub/sub + auth on connection + reconnect |
| Frontend Auth | **COMPLETE** | useAuth hook, redirect on 401, loading state |
| Daily Cron | **COMPLETE** | Auto-unlock, expiry check, EOD metrics, scheduler |
| Market Data Layer | **PARTIAL** | Distribution architecture done, returns empty without broker |
| Instrument Service | **PARTIAL** | Static list works, no daily download from broker |
| Broker Adapter Layer | **PLACEHOLDER** | Interface defined, factory exists, no implementations |
| Angel One Adapter | **NOT STARTED** | — |
| Dhan Adapter | **NOT STARTED** | — |
| TradingView Integration | **NOT STARTED** | — |

---

## DETAILED MODULE BREAKDOWN

### Authentication
**STATUS: COMPLETE**

| Component | File | Implemented |
|-----------|------|-------------|
| JWT generation (sign with secret) | `server/services/auth.service.js` | ✅ Yes |
| JWT verification (decode + expiry check) | `server/services/auth.service.js` | ✅ Yes |
| Token hashing (SHA-256 for DB storage) | `server/services/auth.service.js` | ✅ Yes |
| Nonce generation | `server/services/auth.service.js` | ✅ Yes |
| `requireAuth` middleware | `server/middleware/auth.js` | ✅ Yes |
| `requirePermission` middleware | `server/middleware/auth.js` | ✅ Yes |
| `optionalAuth` middleware | `server/middleware/auth.js` | ✅ Yes |
| `validateWSAuth` (WebSocket) | `server/middleware/auth.js` | ✅ Yes |
| Cookie extraction | `server/middleware/auth.js` | ✅ Yes |
| Bearer header extraction | `server/middleware/auth.js` | ✅ Yes |
| 401 on missing token | `server/middleware/auth.js` | ✅ Yes |
| 401 on expired token | `server/middleware/auth.js` | ✅ Yes |
| 403 on missing permission | `server/middleware/auth.js` | ✅ Yes |

**Limitation:** WebSocket handler (`websocket.js`) does not currently call `validateWSAuth` on connection. Subscriptions are open.

---

### SSO
**STATUS: COMPLETE**

| Component | File | Implemented |
|-----------|------|-------------|
| `GET /auth/sso?token=<sso_token>` endpoint | `server/routes/auth.routes.js` | ✅ Yes |
| SSO token signature verification (shared secret) | `server/services/sso.service.js` | ✅ Yes |
| Token expiry check (120s max age) | `server/services/sso.service.js` | ✅ Yes |
| Nonce replay protection | `server/services/sso.service.js` | ✅ Yes |
| User lookup in Supabase by `fw_user_id` | `server/services/sso.service.js` | ✅ Yes |
| Account lookup in Supabase by `accountId` | `server/services/sso.service.js` | ✅ Yes |
| Account status check (active only) | `server/services/sso.service.js` | ✅ Yes |
| Terminal JWT generation with claims | `server/services/sso.service.js` | ✅ Yes |
| Session persistence to `sessions` table | `server/services/sso.service.js` | ✅ Yes |
| httpOnly secure cookie set | `server/routes/auth.routes.js` | ✅ Yes |
| Redirect to terminal on success | `server/routes/auth.routes.js` | ✅ Yes |
| Redirect to dashboard on failure | `server/routes/auth.routes.js` | ✅ Yes |
| Dev-only test token generation | `server/routes/auth.routes.js` | ✅ Yes |
| Dev mode fallback (no Supabase) | `server/services/sso.service.js` | ✅ Yes |

---

### Session Management
**STATUS: COMPLETE**

| Component | File | Implemented |
|-----------|------|-------------|
| `createSession()` — insert into sessions table | `server/services/session.service.js` | ✅ Yes |
| `revokeSession()` — set revoked_at timestamp | `server/services/session.service.js` | ✅ Yes |
| `revokeAllUserSessions()` — force logout everywhere | `server/services/session.service.js` | ✅ Yes |
| `isSessionValid()` — check not revoked, not expired | `server/services/session.service.js` | ✅ Yes |
| `POST /auth/logout` endpoint | `server/routes/auth.routes.js` | ✅ Yes |
| `GET /auth/verify` endpoint | `server/routes/auth.routes.js` | ✅ Yes |

---

### Supabase Client
**STATUS: COMPLETE**

| Component | File | Implemented |
|-----------|------|-------------|
| Client initialization (service role key) | `server/db/client.js` | ✅ Yes |
| Graceful fallback if env vars not set | `server/db/client.js` | ✅ Yes |
| `testConnection()` health check | `server/db/client.js` | ✅ Yes |
| Auth disabled (backend uses service key) | `server/db/client.js` | ✅ Yes |

**Limitation:** Will not function until `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set in `.env`. Currently returns `null` client.

---

### Database Schema
**STATUS: COMPLETE**

| Table | Schema File | Migration | RLS Policy |
|-------|-------------|-----------|------------|
| `users` | ✅ | ✅ triggers | ✅ `users_select_own` |
| `challenges` | ✅ | ✅ `min_trading_days` added | ✅ `challenges_select_own` |
| `accounts` | ✅ | ✅ `peak_balance`, `payout_eligible` added | ✅ `accounts_select_own` |
| `risk_rules` | ✅ | — | ✅ `risk_rules_select_own` |
| `orders` | ✅ | ✅ `exchange` column | ✅ `orders_select_own`, `orders_insert_own` |
| `positions` | ✅ | ✅ partial unique index, `exchange` | ✅ `positions_select_own` |
| `trades` | ✅ | ✅ `exchange` column | ✅ `trades_select_own` |
| `watchlists` | ✅ | ✅ triggers | ✅ `watchlists_all_own` |
| `account_metrics` | ✅ | — | ✅ `metrics_select_own` |
| `sessions` | ✅ | — | ✅ `sessions_select_own` |

**Limitation:** Schema exists as SQL files. Not yet executed on a live Supabase instance.

---

### Repositories
**STATUS: COMPLETE**

| Repository | File | Methods |
|------------|------|---------|
| `BaseRepository` | `server/repositories/base.repository.js` | findById, findOne, findMany, insert, insertMany, update, updateWhere, delete, deleteWhere, count |
| `UserRepository` | `server/repositories/user.repository.js` | findByFwUserId, findByEmail, findActive, createOrUpdate, suspend, activate |
| `AccountRepository` | `server/repositories/account.repository.js` | findByUserId, findActiveByUserId, updateBalance, updatePeakBalance, lockAccount, breachAccount, completeAccount, getWithChallenge |
| `ChallengeRepository` | `server/repositories/challenge.repository.js` | findByUserId, findActiveByUserId, findByAccountId, markPassed, markFailed, markExpired, getProgress |
| `OrderRepository` | `server/repositories/order.repository.js` | findByAccountId, findOpenOrders, findTodayOrders, createOrder, updateStatus, markFilled, markRejected, markCancelled, countTodayTrades |
| `PositionRepository` | `server/repositories/position.repository.js` | findOpenByAccountId, findAllByAccountId, findOpenPosition, upsertPosition, closePosition, countOpenPositions, getTotalUnrealizedPnl |
| `TradeRepository` | `server/repositories/trade.repository.js` | findByAccountId, findTodayTrades, findByPeriod, recordTrade, getTodayRealizedPnl, countTodayTrades |
| `WatchlistRepository` | `server/repositories/watchlist.repository.js` | findByUserId, createWatchlist, updateItems, updateName, updateColor, reorder, addItem, removeItem, deleteWatchlist |
| `RiskRulesRepository` | `server/repositories/risk-rules.repository.js` | findByAccountId, findRule, getRulesMap, upsertRule, deactivateRule |
| `MetricsRepository` | `server/repositories/metrics.repository.js` | findByAccountId, findByDate, upsertDailyMetrics, getMaxDrawdown, getTradingDaysCount, getRecentMetrics |

**Limitation:** Depends on live Supabase. Will throw "Supabase not configured" if env vars are missing.

---

### Account Service
**STATUS: COMPLETE**

| Method | Wired To | Returns |
|--------|----------|---------|
| `getAccount(accountId)` | Supabase `accounts` + `challenges` join | Account with challenge details |
| `getUserAccounts(userId)` | Supabase `accounts` | Array of accounts |
| `getRules(accountId)` | Supabase `risk_rules` | Rules map |
| `getPositions(accountId)` | Supabase `positions` + live LTP from MarketDataEngine | Enriched positions |
| `getOrders(accountId)` | Supabase `orders` (today) | Order list |
| `getTrades(accountId, period)` | Supabase `trades` by period | Trade list |
| `placeOrder(accountId, params)` | Risk check → DB persist → broker adapter (if set) → position upsert → post-check | Order result |
| `modifyOrder(accountId, orderId, params)` | Supabase `orders` update + broker adapter (if set) | Modified status |
| `cancelOrder(accountId, orderId)` | Supabase `orders` mark cancelled + broker adapter (if set) | Cancelled status |
| `exitPosition(accountId, positionId)` | Calls `placeOrder()` with opposite side | Order result |
| `reversePosition(accountId, positionId)` | Calls `placeOrder()` with 2x opposite | Order result |
| `updateAccountBalance(accountId)` | Supabase `accounts` balance + peak | Updated |

**Limitation:** When no broker adapter is set:
- Market orders fill at current LTP from MarketDataEngine (which is empty without broker)
- If LTP = 0, market orders will get executionPrice = 0 and won't fill
- Limit orders are persisted as OPEN but never execute (no matching engine)

---

### Challenge Service
**STATUS: COMPLETE**

| Method | Logic | DB Tables Used |
|--------|-------|----------------|
| `getProgress(accountId)` | Calculate P&L, drawdown, trading days, target progress | accounts, challenges, risk_rules, account_metrics |
| `checkTransitions(accountId)` | Auto pass/fail/expire based on rules | challenges, accounts, risk_rules, account_metrics |
| `unlockIfEligible(accountId)` | Unlock daily-loss-locked accounts | accounts |
| `dailyCheck(accountId)` | Unlock + check transitions | accounts, challenges |

**Limitation:** Daily cron scheduler uses `setInterval` (checks every 60s). For production at scale, use Supabase Edge Functions or external scheduler.

---

### Risk Engine
**STATUS: COMPLETE**

| Check | Type | Implementation |
|-------|------|----------------|
| `checkAllowedSegments` | Pre-trade | Compares order segment against `allowed_segments` rule |
| `checkTradingHours` | Pre-trade | Compares current time against `trading_hours` rule |
| `checkMaxPositions` | Pre-trade | Counts open positions vs `max_positions` rule |
| `checkMaxLotSize` | Pre-trade | Calculates lots vs `max_lot_size` per segment |
| `checkMaxDailyTrades` | Pre-trade | Counts today's trades vs `max_daily_trades` rule |
| `checkDailyLossLimit` | Pre-trade | Calculates realized + unrealized P&L vs `daily_loss_limit` |
| Daily loss breach → lock | Post-trade | Locks account via `accountRepo.lockAccount()` |
| Max drawdown breach | Post-trade | Breaches account via `accountRepo.breachAccount()` |
| Profit target detection | Post-trade | Returns `target_reached` status |
| Peak balance tracking | Post-trade | Updates `accounts.peak_balance` |
| `calculateTodayRealizedPnl` | Helper | FIFO P&L from today's trades |
| `recordDailyMetrics` | Helper | Upserts into `account_metrics` |

**Limitation:**
- `no_overnight` rule (auto-square-off at 3:15 PM) — defined in schema but not enforced (no scheduler)
- `checkDailyLossLimit` reads all today's trades on every order — performance concern at high volumes

---

### Order Engine
**STATUS: COMPLETE**

Full order lifecycle implemented in `AccountService.placeOrder()`:

```
1. RiskEngine.validateOrder() ← all pre-trade checks
2. orderRepo.createOrder() ← persisted as PENDING
3. brokerAdapter.placeOrder() ← if adapter is set
4. orderRepo.markFilled() ← status transition
5. positionRepo.upsertPosition() ← position created/updated
6. tradeRepo.recordTrade() ← execution log
7. RiskEngine.postTradeCheck() ← breach/lock/target detection
8. accountService.updateAccountBalance() ← balance recalculated
```

**Limitation:** Without broker adapter, LIMIT/SL orders are persisted as OPEN but never fill (no matching engine, no price monitoring).

---

### Position Engine
**STATUS: COMPLETE**

Implemented in `PositionRepository.upsertPosition()`:

| Scenario | Behavior |
|----------|----------|
| New position | INSERT with qty and avg_price |
| Add to position (same direction) | Recalculate weighted avg_price, increase qty |
| Reduce position (opposite direction) | Calculate realized P&L, reduce qty |
| Close position (exact qty) | Set qty=0, closed_at, realized_pnl |
| Reverse position (excess qty) | Close existing + open new at trade price |

---

### WebSocket Layer
**STATUS: COMPLETE**

| Component | Implemented |
|-----------|-------------|
| WebSocket server on `/ws` path | ✅ Yes |
| Subscribe/unsubscribe messages | ✅ Yes |
| Subscribe_depth/unsubscribe_depth | ✅ Yes |
| Ping/pong keepalive | ✅ Yes |
| Market status broadcast (30s interval) | ✅ Yes |
| Connection cleanup on disconnect | ✅ Yes |
| Quote forwarding from MarketDataEngine | ✅ Yes |
| Depth forwarding from MarketDataEngine | ✅ Yes |
| Auth check on connection (validateWSAuth) | ✅ Yes — rejects with 4001 if no valid JWT |
| Reconnect with backoff (client) | ✅ Yes (`src/services/websocket.ts`) |

---

### Market Data Layer
**STATUS: PARTIAL**

| Component | Implemented |
|-----------|-------------|
| Pub/sub architecture (subscribe/unsubscribe) | ✅ Yes |
| Quote caching | ✅ Yes |
| Depth caching | ✅ Yes |
| Broker adapter integration point | ✅ Yes (`connectBrokerAdapter()`) |
| `getQuote(token)` | ✅ Yes — returns cached or null |
| `getDepth(token)` | ✅ Yes — returns cached or empty |
| `getOptionChain(symbol, expiry)` | ✅ Yes — delegates to broker or returns [] |
| `getHistoricalData(token, tf)` | ✅ Yes — delegates to broker or returns [] |
| `pushQuote()` / `pushDepth()` | ✅ Yes — for external data injection |
| `getStatus()` | ✅ Yes |
| Live data flowing | ❌ No — no broker adapter connected |
| Simulated data | ❌ Removed — returns empty |

**Current behavior:** All market data endpoints return empty arrays/null. Frontend fallback renders placeholder UI.

---

### Instrument Service
**STATUS: PARTIAL**

| Component | Implemented |
|-----------|-------------|
| Static instrument list (~55 instruments) | ✅ Yes |
| Search by query + segment | ✅ Yes |
| Get by segment | ✅ Yes |
| Get by token | ✅ Yes |
| Get expiries (computed) | ✅ Yes |
| Daily instrument file download | ❌ No |
| Real exchange tokens | ❌ No — futures/MCX/CDS use synthetic tokens like `NF_FUT`, `GOLD_F` |

**Limitation:** Tokens like `NF_FUT`, `GOLD_F` are not real exchange instrument tokens. Real tokens must come from a broker's daily instrument file.

---

### Broker Adapter Layer
**STATUS: PLACEHOLDER**

| Component | File | Status |
|-----------|------|--------|
| `BaseBrokerAdapter` abstract class | `server/brokers/broker.interface.ts` | ✅ Interface defined (22 abstract methods) |
| `BrokerFactory` | `server/brokers/broker.factory.ts` | ✅ Factory pattern exists |
| Factory create method | `server/brokers/broker.factory.ts` | ⚠️ All cases throw "not yet implemented" |
| `accountService.setBrokerAdapter()` | `server/services/accountService.js` | ✅ Slot exists |
| `marketDataEngine.connectBrokerAdapter()` | `server/services/marketDataEngine.js` | ✅ Slot exists |

**What's ready for broker integration:**
- Abstract class defines all required methods
- AccountService will route orders to adapter when set
- MarketDataEngine will distribute data when adapter provides it
- WebSocket infrastructure will forward data to clients

**What's needed per broker:**
- Implement `BaseBrokerAdapter` subclass
- Handle authentication (TOTP, OAuth, etc.)
- Map exchange tokens to internal tokens
- Binary WebSocket protocol parsing (for Angel One)
- Daily instrument file download and parsing

---

### Angel One Adapter
**STATUS: NOT STARTED**

No implementation file exists. Only mentioned in comments.

---

### Dhan Adapter
**STATUS: NOT STARTED**

No implementation file exists. Only mentioned in comments.

---

### TradingView Integration
**STATUS: NOT STARTED**

Not referenced in active code. Current chart uses `lightweight-charts` library directly.

---

## API ENDPOINT STATUS

### Returns Real Data from Supabase (when connected)

| Endpoint | Auth | Source |
|----------|------|--------|
| `GET /api/account` | ✅ Required | `accounts` + `challenges` table |
| `GET /api/account/challenge` | ✅ Required | `challenges` + `risk_rules` + `account_metrics` |
| `GET /api/account/rules` | ✅ Required | `risk_rules` table |
| `GET /api/positions` | ✅ Required | `positions` table (open, enriched with LTP) |
| `GET /api/orders` | ✅ Required | `orders` table (today) |
| `GET /api/trades` | ✅ Required | `trades` table (by period) |
| `POST /api/orders/place` | ✅ Required | Risk check → `orders` + `positions` + `trades` |
| `PUT /api/orders/:id/modify` | ✅ Required | `orders` table update |
| `DELETE /api/orders/:id/cancel` | ✅ Required | `orders` status → CANCELLED |
| `POST /api/positions/:id/exit` | ✅ Required | Triggers `placeOrder()` |
| `POST /api/positions/:id/reverse` | ✅ Required | Triggers `placeOrder()` |
| `GET /api/watchlists` | ✅ Required | `watchlists` table |
| `POST /api/watchlists` | ✅ Required | `watchlists` table insert |
| `PUT /api/watchlists/:id` | ✅ Required | `watchlists` table update |
| `DELETE /api/watchlists/:id` | ✅ Required | `watchlists` table delete |
| `POST /api/watchlists/:id/add` | ✅ Required | `watchlists.items` array append |
| `POST /api/watchlists/:id/remove` | ✅ Required | `watchlists.items` array filter |
| `GET /auth/sso` | — | Validates SSO → creates session in DB |
| `POST /auth/logout` | — | Revokes session in DB |
| `GET /auth/verify` | — | Checks JWT validity |
| `GET /health` | — | Tests Supabase connection |

### Returns Static Data (no Supabase needed)

| Endpoint | Auth | Source |
|----------|------|--------|
| `GET /api/instruments/search` | ❌ Public | Static array in `instrumentService.js` |
| `GET /api/instruments` | ❌ Public | Static array in `instrumentService.js` |
| `GET /api/market/expiries` | ❌ Public | Computed in `instrumentService.js` |

### Returns Empty Until Broker Connects

| Endpoint | Auth | Current Response |
|----------|------|-----------------|
| `GET /api/market/history` | ❌ Public | `[]` (empty array) |
| `GET /api/market/depth` | ❌ Public | `{ bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 }` |
| `GET /api/market/option-chain` | ❌ Public | `[]` (empty array) |

---

## WHAT WORKS RIGHT NOW (if Supabase env vars are set)

1. ✅ Server starts, connects to Supabase
2. ✅ SSO flow: Dashboard token → terminal JWT → cookie
3. ✅ Auth: all protected routes reject without valid JWT
4. ✅ WebSocket rejects unauthenticated connections (4001)
5. ✅ Account data loaded from database
6. ✅ Orders persist to database with risk checks
7. ✅ Positions created/updated on fill
8. ✅ Trades recorded as immutable log
9. ✅ Watchlists CRUD via API
10. ✅ Risk engine blocks invalid orders
11. ✅ Account locks on daily loss breach
12. ✅ Account breaches on max drawdown
13. ✅ Challenge auto-passes on profit target
14. ✅ Daily cron unlocks accounts, checks expiry, records EOD metrics
15. ✅ Frontend redirects to dashboard if no session (useAuth hook)
16. ✅ WebSocket distributes data (empty until broker)

## WHAT DOES NOT WORK YET

1. ❌ No live market data (all quotes are null, charts are empty)
2. ❌ LIMIT orders never fill (no price monitoring / matching)
3. ❌ Instrument tokens are synthetic (not real exchange tokens)
4. ❌ No Supabase project actually provisioned (env vars not set)

---

*End of Current Implementation Status*
