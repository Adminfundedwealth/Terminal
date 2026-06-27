# TABLE CONSISTENCY REPORT
## FundedWealth Terminal — Verification Only (No Code Modified)

**Date:** 2026-06-18  
**Method:** Read schema.sql, grep all repositories, start server, test endpoints  
**Code Modified:** NO

---

## 1. SCHEMA TABLE NAMES (from `server/db/schema.sql`)

```
users
challenges
accounts
risk_rules
orders
positions
trades
watchlists
account_metrics
sessions
```

**Total: 10 tables, all UNPREFIXED.**

No `t_` prefixed tables exist in schema.sql.

---

## 2. REPOSITORY TABLE NAMES (from `super('...')` in each repository)

| Repository File | Table Name Used | Matches Schema? |
|-----------------|----------------|-----------------|
| `account.repository.js` | `t_accounts` | ❌ NO |
| `order.repository.js` | `t_orders` | ❌ NO |
| `position.repository.js` | `t_positions` | ❌ NO |
| `trade.repository.js` | `t_trades` | ❌ NO |
| `user.repository.js` | `t_users` | ❌ NO |
| `challenge.repository.js` | `t_challenges` | ❌ NO |
| `watchlist.repository.js` | `t_watchlists` | ❌ NO |
| `risk-rules.repository.js` | `t_risk_rules` | ❌ NO |
| `metrics.repository.js` | `t_account_metrics` | ❌ NO |
| `risk-event.repository.js` | `t_risk_events` | ❌ NO (table not in schema) |
| `order-audit.repository.js` | `t_order_audit` | ❌ NO (table not in schema) |
| `challenge-metrics.repository.js` | `t_challenge_metrics` | ❌ NO (table not in schema) |
| `audit.repository.js` | `audit_log` | ❌ NO (table not in schema yet — migration 004 pending) |
| `broker-session.repository.js` | `broker_sessions` | ❌ NO (table not in schema yet — migration 004 pending) |

---

## 3. SERVICE DIRECT QUERIES (from `supabase.from('...')` calls)

| Service File | Table Name Used | Matches Schema? |
|--------------|----------------|-----------------|
| `accountService.js` | `accounts` | ✅ YES |
| `accountService.js` | `positions` | ✅ YES |
| `accountService.js` | `orders` | ✅ YES |
| `accountService.js` | `trades` | ✅ YES |
| `session.service.js` | `sessions` | ✅ YES |
| `sso.service.js` | `users` | ✅ YES |
| `sso.service.js` | `accounts` | ✅ YES |
| `riskEngine.js` | `challenges` | ✅ YES |
| `dailyChecks.js` | `accounts` | ✅ YES |
| `db/client.js` | `users` | ✅ YES |
| `db/setup.js` | `users`, `accounts`, `challenges`, `risk_rules`, `watchlists` | ✅ YES |

---

## 4. DO `t_accounts`, `t_orders`, `t_positions`, `t_trades` EXIST?

**NO.** They do NOT exist.

Evidence:
- `schema.sql` defines only unprefixed table names
- `supabase.from('users').select('id').limit(1)` succeeds at startup (connection test in `db/client.js`)
- `accountService.js` queries `from('accounts')`, `from('positions')`, `from('orders')`, `from('trades')` — all succeed (return empty arrays for dev-account)
- `WatchlistRepository` uses `super('t_watchlists')` → **returns 500 Internal Server Error** at runtime
- `ChallengeService` uses `ChallengeRepository` (`super('t_challenges')`) → **returns 500 Internal Server Error** at runtime

The `t_` prefix was introduced in repository files by a prior edit but was **never applied to the actual Supabase schema**. The tables in Supabase remain unprefixed.

---

## 5. RUNTIME TEST RESULTS

Server started successfully on port 4000 (with `DEV_BYPASS_AUTH=true`).

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /health` | ✅ 200 | Supabase connected, feed active |
| `GET /api/account` | ✅ 200 | Dev bypass returns mock data (no DB hit) |
| `GET /api/orders` | ✅ 200 | `accountService` queries `from('orders')` with dev-account → `[]` |
| `GET /api/positions` | ✅ 200 | `accountService` queries `from('positions')` with dev-account → `[]` |
| `GET /api/trades` | ✅ 200 | `accountService` queries `from('trades')` with dev-account → `[]` |
| `GET /api/watchlists` | ❌ 500 | Uses `WatchlistRepository` → queries `t_watchlists` → table not found |
| `GET /api/account/challenge` | ❌ 500 | Uses `ChallengeRepository` → queries `t_challenges` → table not found |

---

## 6. WHY `/api/account`, `/api/orders`, `/api/positions`, `/api/trades` WORK

These endpoints go through `accountService.js` which uses **direct Supabase queries** with correct unprefixed table names (`from('accounts')`, etc.) — NOT through the repository layer.

Any code path that uses the **repository layer** will fail because all repositories reference `t_` prefixed tables that do not exist.

---

## 7. ANSWER SUMMARY

| Question | Answer |
|----------|--------|
| **Schema table names** | `users`, `challenges`, `accounts`, `risk_rules`, `orders`, `positions`, `trades`, `watchlists`, `account_metrics`, `sessions` |
| **Repository table names** | `t_users`, `t_challenges`, `t_accounts`, `t_risk_rules`, `t_orders`, `t_positions`, `t_trades`, `t_watchlists`, `t_account_metrics`, `t_risk_events`, `t_order_audit`, `t_challenge_metrics` |
| **Match?** | **NO** — All 10 core repositories use `t_` prefix; schema uses unprefixed names |
| **Runtime errors?** | **YES** — Any endpoint using the repository layer returns 500 (table not found). Endpoints using direct `supabase.from()` with correct names work fine. |

---

## 8. ROOT CAUSE

A prior edit renamed table references in the repository `super()` calls from unprefixed (`'accounts'`) to `t_` prefixed (`'t_accounts'`) — but the actual Supabase database schema (`schema.sql`) and the real Supabase instance still use the original unprefixed names.

The `accountService.js`, `session.service.js`, `sso.service.js`, `dailyChecks.js`, and `db/setup.js` were separately fixed back to unprefixed names, creating a **split**:
- Services (direct queries) → correct unprefixed names → **WORKS**
- Repositories (`super()` table names) → incorrect `t_` prefixed names → **BROKEN**

---

*No code was modified. Verification only.*
