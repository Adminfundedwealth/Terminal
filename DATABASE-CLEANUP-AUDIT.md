# PRODUCTION DATABASE CLEANUP AUDIT

**Date:** 2026-06-20  
**Scope:** Remove trading/terminal layer from Supabase. Keep: users, auth, kyc, payments, affiliate, community, notifications.  
**Status:** AUDIT ONLY — No code changes, no SQL execution.

---

## 1. TABLE NAMING REALITY

The codebase uses **different table names** than the migrations define. The code queries these actual table names:

| Repository File | Actual Table Name Queried | Migration Equivalent |
|---|---|---|
| `account.repository.js` | `trading_accounts` | `t_accounts` |
| `challenge.repository.js` | `challenge_accounts` | `t_challenges` |
| `risk-rules.repository.js` | `challenge_rules` | `t_risk_rules` |
| `order.repository.js` | `trading_orders` | `t_orders` |
| `position.repository.js` | `positions` | `t_positions` |
| `trade.repository.js` | `executions` | `t_trades` |
| `metrics.repository.js` | `account_metrics` | `t_account_metrics` |
| `risk-event.repository.js` | `risk_events` | `t_risk_events` |
| `challenge-metrics.repository.js` | `challenge_metrics` | `t_challenge_metrics` |
| `order-audit.repository.js` | `order_audit` | `t_order_audit` |
| `audit.repository.js` | `audit_log` | `audit_log` |
| `broker-session.repository.js` | `broker_sessions` | `t_broker_sessions` / `broker_sessions` |
| `watchlist.repository.js` | `watchlists` | `t_watchlists` |
| `user.repository.js` | `users` | `t_users` |
| `session.service.js` | `sessions` | `t_sessions` |

> **CRITICAL:** You may have BOTH naming conventions in the database (bare names AND t_ prefixed). Verify which actually exist before running DROP statements.

---

## 2. FOREIGN KEY DEPENDENCY MAP

```
users (ROOT)
├── trading_accounts (user_id → users.id CASCADE)
│   ├── challenge_rules (account_id → trading_accounts.id CASCADE)
│   ├── trading_orders (account_id → trading_accounts.id)
│   │   └── order_audit (order_id → trading_orders.id CASCADE)
│   ├── positions (account_id → trading_accounts.id)
│   ├── executions (account_id → trading_accounts.id, order_id → trading_orders.id)
│   ├── account_metrics (account_id → trading_accounts.id)
│   ├── risk_events (account_id → trading_accounts.id CASCADE)
│   ├── broker_sessions (account_id → trading_accounts.id CASCADE)
│   ├── challenge_metrics (account_id → trading_accounts.id CASCADE)
│   └── sessions (account_id → trading_accounts.id)  ← ALSO refs users.id
│
├── challenge_accounts (user_id → users.id CASCADE)
│   ├── trading_accounts (challenge_id → challenge_accounts.id)
│   ├── challenge_metrics (challenge_id → challenge_accounts.id CASCADE)
│   ├── challenge_accounts (previous_challenge_id → challenge_accounts.id SELF-REF)
│   └── t_payouts (challenge_id → challenge_accounts.id)
│
├── watchlists (user_id → users.id CASCADE)
├── sessions (user_id → users.id CASCADE)
└── t_payouts (user_id → users.id)
```

---

## 3. TABLE CLASSIFICATION

### ✅ SAFE TO DELETE (leaf tables — no other table references them)

| Table | Reason |
|---|---|
| `order_audit` / `t_order_audit` | Leaf. FK to trading_orders + trading_accounts. No dependents. |
| `challenge_metrics` / `t_challenge_metrics` | Leaf. FK to challenge_accounts + trading_accounts. No dependents. |
| `risk_events` / `t_risk_events` | Leaf. FK to trading_accounts. No dependents. |
| `broker_sessions` / `t_broker_sessions` | Leaf. FK to trading_accounts. No dependents. |
| `account_metrics` / `t_account_metrics` | Leaf. FK to trading_accounts. No dependents. |
| `executions` / `t_trades` | Leaf. FK to trading_accounts + trading_orders. No dependents. |
| `positions` / `t_positions` | Leaf. FK to trading_accounts. No dependents. |
| `challenge_rules` / `t_risk_rules` | Leaf. FK to trading_accounts. No dependents. |
| `t_payouts` | Leaf. FK to trading_accounts + users + challenge_accounts. No dependents. |
| `audit_log` | Leaf. Has account_id + user_id columns but NO FK constraints. No dependents. |

### ⚠️ DELETE WITH DEPENDENCIES (parent tables — must drop children first)

| Table | Referenced By |
|---|---|
| `trading_orders` / `t_orders` | `order_audit`, `executions` |
| `trading_accounts` / `t_accounts` | `challenge_rules`, `trading_orders`, `positions`, `executions`, `account_metrics`, `risk_events`, `broker_sessions`, `challenge_metrics`, `order_audit`, `sessions`, `t_payouts` |
| `challenge_accounts` / `t_challenges` | `trading_accounts`, `challenge_metrics`, `t_payouts`, self-ref (`previous_challenge_id`) |

### ⚠️ DO NOT DELETE (shared tables)

| Table | Reason |
|---|---|
| `users` / `t_users` | **Root table for ALL data.** Referenced by trading tables, watchlists, sessions, and presumed auth/kyc/payments/affiliate/community. KEEP. |
| `sessions` | **Required for login/auth.** Used by `session.service.js` for SSO authentication, session creation, session revocation, and session verification. Deleting this breaks ALL login functionality. KEEP. |
| `watchlists` / `t_watchlists` | **User-level, not trading-level.** Only FK is to users. Not part of the trading/challenge engine. However, it IS part of the terminal — classify per your business decision. |

---

## 4. EXACT SQL DROP ORDER

Drop in this order to respect FK constraints (leaf → parent):

```sql
-- ══════════════════════════════════════════════════════════════
-- PHASE 1: Drop leaf tables (no dependents)
-- ══════════════════════════════════════════════════════════════

-- Audit & logging tables
DROP TABLE IF EXISTS order_audit CASCADE;
DROP TABLE IF EXISTS t_order_audit CASCADE;
DROP TABLE IF EXISTS challenge_metrics CASCADE;
DROP TABLE IF EXISTS t_challenge_metrics CASCADE;
DROP TABLE IF EXISTS risk_events CASCADE;
DROP TABLE IF EXISTS t_risk_events CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;

-- Broker sessions
DROP TABLE IF EXISTS broker_sessions CASCADE;
DROP TABLE IF EXISTS t_broker_sessions CASCADE;

-- Metrics
DROP TABLE IF EXISTS account_metrics CASCADE;
DROP TABLE IF EXISTS t_account_metrics CASCADE;

-- Execution/trade logs
DROP TABLE IF EXISTS executions CASCADE;
DROP TABLE IF EXISTS t_trades CASCADE;

-- Positions
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS t_positions CASCADE;

-- Risk rules
DROP TABLE IF EXISTS challenge_rules CASCADE;
DROP TABLE IF EXISTS t_risk_rules CASCADE;

-- Payouts
DROP TABLE IF EXISTS t_payouts CASCADE;

-- ══════════════════════════════════════════════════════════════
-- PHASE 2: Drop parent tables (after children are gone)
-- ══════════════════════════════════════════════════════════════

-- Orders (was referenced by order_audit, executions)
DROP TABLE IF EXISTS trading_orders CASCADE;
DROP TABLE IF EXISTS t_orders CASCADE;

-- Trading accounts (was referenced by almost everything)
DROP TABLE IF EXISTS trading_accounts CASCADE;
DROP TABLE IF EXISTS t_accounts CASCADE;

-- Challenges (was referenced by trading_accounts, challenge_metrics, t_payouts)
DROP TABLE IF EXISTS challenge_accounts CASCADE;
DROP TABLE IF EXISTS t_challenges CASCADE;

-- ══════════════════════════════════════════════════════════════
-- PHASE 3: Optional — terminal-specific user/session tables
-- ONLY if your main platform has its OWN users/sessions tables
-- ══════════════════════════════════════════════════════════════

-- DROP TABLE IF EXISTS t_sessions CASCADE;  -- CAREFUL: check if auth uses this
-- DROP TABLE IF EXISTS t_users CASCADE;     -- CAREFUL: only if dashboard has separate users table
-- DROP TABLE IF EXISTS t_watchlists CASCADE; -- User preference data, not trading

-- ══════════════════════════════════════════════════════════════
-- PHASE 4: Clean up indexes, triggers, functions
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
```

---

## 5. IMPACT ASSESSMENT ON "KEEP" SYSTEMS

| System | Affected by Trading Table Deletion? | Explanation |
|---|---|---|
| **Login / Auth** | ❌ NO — IF `sessions` table is preserved | Auth uses `users` + `sessions`. Neither is a trading table. SSO login, session creation, session verification all work from these two tables only. |
| **Users** | ❌ NO | `users` table has no FK pointing INTO trading tables. Trading tables point TO users, not the reverse. |
| **Payments** | ❌ NO | No FK or code reference between `payments` and any trading table. The `t_payouts` table is terminal-internal (separate from platform payments). |
| **KYC** | ❌ NO | No FK or code reference between `kyc` and any trading table. |
| **Affiliate** | ❌ NO | No FK or code reference between `affiliate` and any trading table. |
| **Community** | ❌ NO | No FK or code reference between `community` and any trading table. |
| **Notifications** | ❌ NO | No FK or code reference between `notifications` and any trading table. |

### Summary: Deleting the trading tables will NOT affect login, users, payments, kyc, affiliate, community, or notifications.

---

## 6. CODE THAT WILL BREAK (for awareness)

These server-side files will throw errors after table deletion. This is expected and will need code cleanup in a separate pass:

| File | Tables Used | Impact |
|---|---|---|
| `server/services/accountService.js` | `trading_accounts`, `positions`, `trading_orders`, `executions` | All trading operations fail |
| `server/services/challengeService.js` | `challenge_accounts`, `trading_accounts`, `challenge_rules`, `account_metrics` | Challenge lifecycle fails |
| `server/services/payoutService.js` | `trading_accounts`, `challenge_accounts`, `challenge_rules`, `account_metrics`, `risk_events` | Payout operations fail |
| `server/services/riskEngine.js` | `challenge_rules`, `positions`, `executions`, `trading_accounts`, `account_metrics`, `challenge_accounts` | Risk checks fail |
| `server/services/orderExecutionService.js` | `trading_orders`, `positions`, `executions`, `trading_accounts` | Order execution fails |
| `server/repositories/account.repository.js` | `trading_accounts`, `challenge_accounts` | All account queries fail |
| `server/repositories/challenge.repository.js` | `challenge_accounts`, `trading_accounts` | Challenge queries fail |
| `server/repositories/order.repository.js` | `trading_orders` | Order queries fail |
| `server/repositories/position.repository.js` | `positions` | Position queries fail |
| `server/repositories/trade.repository.js` | `executions` | Trade queries fail |
| `server/repositories/risk-rules.repository.js` | `challenge_rules` | Risk rule queries fail |
| `server/repositories/risk-event.repository.js` | `risk_events` | Risk event queries fail |
| `server/repositories/metrics.repository.js` | `account_metrics` | Metrics queries fail |
| `server/repositories/challenge-metrics.repository.js` | `challenge_metrics` | Challenge metrics fail |
| `server/repositories/order-audit.repository.js` | `order_audit` | Order audit fail |
| `server/repositories/audit.repository.js` | `audit_log` | Audit logging fails |
| `server/repositories/broker-session.repository.js` | `broker_sessions` | Broker sessions fail |
| `server/routes/api.js` | All trading endpoints | `/account`, `/positions`, `/orders`, `/trades`, `/account/challenge`, `/account/payout/*`, `/account/rules` all return errors |

### Files that will CONTINUE working fine:
- `server/routes/auth.routes.js` — uses `sessions` + `users` only
- `server/services/sso.service.js` — uses `users` + `sessions` only  
- `server/services/session.service.js` — uses `sessions` only
- `server/services/auth.service.js` — JWT validation, no DB tables
- `server/repositories/user.repository.js` — uses `users` only
- `server/repositories/watchlist.repository.js` — uses `watchlists` only
- All market data services (no DB dependency)
- All instrument/candle/depth services (API-based, no trading DB)

---

## 7. RECOMMENDATIONS

1. **Verify actual table names in Supabase** before running DROP. You likely have the `t_`-prefixed versions from the migration, not the bare names used in code. Possibly both exist.

2. **Back up before dropping** — `pg_dump` the schema + data for the tables being dropped.

3. **The `sessions` table is NOT a trading table** — it's authentication infrastructure. Do NOT delete it.

4. **The `watchlists` table** is user-level preference data. Business decision whether to keep or remove (it has no trading dependency).

5. **The `audit_log` table** has no FK constraints — it's a loose log table. Safe to delete, but it contains auth events (login, logout) too. Consider keeping if you want login audit history.

6. **After DB cleanup**, a code cleanup pass should remove or stub out the broken repositories and services listed in Section 6.

---

*End of audit. No code was modified. No SQL was executed.*
