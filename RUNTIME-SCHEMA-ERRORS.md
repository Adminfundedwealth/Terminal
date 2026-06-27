# RUNTIME-SCHEMA-ERRORS

> **Generated**: 2026-06-21T16:30:00Z  
> **Supabase Project**: `https://nysrxvpjdlvzvcawysvh.supabase.co`  
> **Method**: Direct Supabase service-role runtime probes (NOT code inspection)  
> **Server started**: Yes — `node index.js` on port 4000  
> **APIs hit**: `/health`, `/auth/verify`, `/api/account`, `/api/positions`, `/api/orders`, `/api/trades`, `/api/watchlists`, `/api/account/rules`, `/api/account/challenge`, `/api/account/payout/eligibility`, `/api/account/payout/history`, `/api/broker/health`

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total tables required by backend code | **15** |
| Tables that EXIST in Supabase | **12** |
| Tables completely MISSING | **3** |
| Existing tables with COLUMN MISMATCHES | **11** |
| Only table fully compatible | **1** (`sessions`) |

**Critical finding**: The backend repository layer expects a different schema than what exists in Supabase. Every repository except `SessionService` will throw runtime errors on real queries.

---

## Repository → Table Mapping

| # | Repository | Table Name | Table Exists? | Column Errors |
|---|-----------|-----------|:---:|:---:|
| 1 | `UserRepository` | `users` | ✅ | ❌ 2 missing columns |
| 2 | `AccountRepository` | `trading_accounts` | ✅ | ❌ 6 missing columns |
| 3 | `ChallengeRepository` | `challenge_accounts` | ✅ | ❌ 6 missing columns |
| 4 | `OrderRepository` | `trading_orders` | ✅ | ❌ 9 missing columns |
| 5 | `PositionRepository` | `positions` | ✅ | ❌ 7 missing columns |
| 6 | `TradeRepository` | `executions` | ✅ | ❌ 4 missing columns |
| 7 | `WatchlistRepository` | `watchlists` | ❌ TABLE MISSING | — |
| 8 | `RiskRulesRepository` | `challenge_rules` | ✅ | ❌ 2 missing columns |
| 9 | `MetricsRepository` | `account_metrics` | ❌ TABLE MISSING | — |
| 10 | `AuditRepository` | `audit_logs` | ✅ | ❌ 4 missing columns |
| 11 | `BrokerSessionRepository` | `broker_sessions` | ❌ TABLE MISSING | — |
| 12 | `RiskEventRepository` | `risk_events` | ✅ | ❌ 11 missing columns |
| 13 | `ChallengeMetricsRepository` | `challenge_progress` | ✅ | ❌ 14 missing columns |
| 14 | `OrderAuditRepository` | `execution_audits` | ✅ | ❌ 18 missing columns |
| 15 | `SessionService` | `sessions` | ✅ | ✅ All columns present |

---

## ❌ MISSING TABLES (3)

### 1. `watchlists` — used by `WatchlistRepository`

**Actual runtime error**:
```
Code:    PGRST205
Message: Could not find the table 'public.watchlists' in the schema cache
```

**Triggered by**:
- `GET /api/watchlists`
- `POST /api/watchlists`
- `PUT /api/watchlists/:id`
- `DELETE /api/watchlists/:id`

**Columns expected by code**: `id`, `user_id`, `name`, `color`, `items` (JSONB), `sort_order`, `created_at`, `updated_at`

---

### 2. `account_metrics` — used by `MetricsRepository`

**Actual runtime error**:
```
Code:    PGRST205
Message: Could not find the table 'public.account_metrics' in the schema cache
```

**Triggered by**:
- `GET /api/account/payout/eligibility` (via `MetricsRepository.getTradingDaysCount`)
- Internal: `dailyChecks` cron job (`runEndOfDayMetrics`)
- Internal: `ChallengeService` progress tracking

**Columns expected by code**: `id`, `account_id`, `date`, `starting_balance`, `ending_balance`, `realized_pnl`, `unrealized_pnl`, `total_trades`, `winning_trades`, `losing_trades`, `max_drawdown`, `daily_loss`, `peak_balance`, `created_at`

---

### 3. `broker_sessions` — used by `BrokerSessionRepository`

**Actual runtime error**:
```
Code:    PGRST205
Message: Could not find the table 'public.broker_sessions' in the schema cache
```

**Triggered by**:
- Internal: `AngelFeedConnector` session persistence
- Internal: `BrokerFactory` reconnect flow
- Internal: `HealthMonitor` session tracking
- `GET /api/broker/health` (indirect)

**Columns expected by code**: `id`, `account_id`, `provider`, `client_id`, `status`, `connected_at`, `disconnected_at`, `expires_at`, `feed_token`, `error_message`, `metadata`, `created_at`

---

## ❌ COLUMN MISMATCHES — Existing Tables (11)

### 1. `users` — `UserRepository`

| Column Code Expects | Actual in Supabase | Error |
|---|---|---|
| `name` | ❌ MISSING | Has `full_name`, `first_name`, `last_name` instead |
| `status` | ❌ MISSING | Has `is_active` (boolean) instead |

**Actual runtime error** (when code calls `user.status !== 'active'`):
```
The column 'name' / 'status' will return null — no Supabase error thrown, 
but logic breaks silently
```

**Columns that DO exist**: `id`, `clerk_id`, `email`, `full_name`, `first_name`, `last_name`, `phone`, `kyc_status`, `fw_user_id`, `role`, `city`, `state`, `avatar_url`, `is_active`, `created_at`, `updated_at`

---

### 2. `trading_accounts` — `AccountRepository`

| Column Code Expects | Actual in Supabase | Error |
|---|---|---|
| `challenge_id` | ❌ MISSING | No FK to challenge_accounts |
| `broker_provider` | ❌ MISSING | — |
| `balance` | ❌ MISSING | Has `virtual_balance` instead |
| `peak_balance` | ❌ MISSING | — |
| `locked_reason` | ❌ MISSING | — |
| `payout_eligible` | ❌ MISSING | — |

**Actual runtime error** (when code calls `.updateBalance()`):
```
Code:    42703
Message: column trading_accounts.balance does not exist
```

**Columns that DO exist**: `id`, `account_code`, `user_id`, `plan`, `phase`, `status`, `virtual_balance`, `profit_target`, `max_drawdown`, `daily_loss_limit`, `total_pnl`, `daily_drawdown`, `profit_split`, `trading_days`, `scaling_level`, `fee_paid`, `coupon_used`, `is_funded`, `funded_at`, `expires_at`, `created_at`, `updated_at`

---

### 3. `trading_orders` — `OrderRepository`

| Column Code Expects | Status |
|---|---|
| `account_id` | ❌ MISSING — has `user_id` (NOT NULL) instead |
| `token` | ❌ MISSING |
| `segment` | ❌ MISSING |
| `exchange` | ❌ MISSING |
| `product_type` | ❌ MISSING |
| `avg_price` | ❌ MISSING |
| `broker_order_id` | ❌ MISSING |
| `reject_reason` | ❌ MISSING |
| `placed_at` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column trading_orders.account_id does not exist
```

**Columns that DO exist**: `id`, `user_id`, `symbol`, `side`, `order_type`, `qty`, `price`, `trigger_price`, `status`, `filled_qty`, `created_at`

---

### 4. `positions` — `PositionRepository`

| Column Code Expects | Status |
|---|---|
| `account_id` | ❌ MISSING — has `user_id` (NOT NULL) instead |
| `token` | ❌ MISSING |
| `segment` | ❌ MISSING |
| `exchange` | ❌ MISSING |
| `product_type` | ❌ MISSING |
| `avg_price` | ❌ MISSING |
| `realized_pnl` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column positions.account_id does not exist
```

**Columns that DO exist**: `id`, `user_id`, `symbol`, `qty`, `opened_at`, `closed_at`

---

### 5. `executions` — `TradeRepository`

| Column Code Expects | Status |
|---|---|
| `account_id` | ❌ MISSING — has `order_id` (NOT NULL) reference instead |
| `token` | ❌ MISSING |
| `segment` | ❌ MISSING |
| `exchange` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column executions.account_id does not exist
```

**Columns that DO exist**: `id`, `order_id`, `symbol`, `side`, `qty`, `price`, `executed_at`

---

### 6. `challenge_accounts` — `ChallengeRepository`

| Column Code Expects | Status |
|---|---|
| `type` | ❌ MISSING |
| `plan` | ❌ MISSING |
| `started_at` | ❌ MISSING |
| `passed_at` | ❌ MISSING |
| `failed_at` | ❌ MISSING |
| `fail_reason` | ❌ MISSING |

**Columns that DO exist**: `id`, `user_id`, `status`, `initial_balance`, `expires_at`

---

### 7. `challenge_rules` — `RiskRulesRepository`

| Column Code Expects | Status |
|---|---|
| `account_id` | ❌ MISSING |
| `rule_type` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column challenge_rules.account_id does not exist
```

**Columns that DO exist**: `id`, `value`, `is_active`

---

### 8. `audit_logs` — `AuditRepository`

| Column Code Expects | Status |
|---|---|
| `account_id` | ❌ MISSING |
| `user_id` | ❌ MISSING |
| `event_type` | ❌ MISSING |
| `event_data` | ❌ MISSING |

**Actual runtime error**:
```
Code:    PGRST204
Message: Could not find the 'event_data' column of 'audit_logs' in the schema cache
```

**Columns that DO exist**: `id`, `ip_address`, `created_at`

---

### 9. `risk_events` — `RiskEventRepository`

| Column Code Expects | Status |
|---|---|
| `account_id` | ❌ MISSING — has `challenge_account_id` (NOT NULL) |
| `event_type` | ❌ MISSING |
| `severity` | ❌ MISSING |
| `rule_type` | ❌ MISSING |
| `rule_value` | ❌ MISSING |
| `actual_value` | ❌ MISSING |
| `order_id` | ❌ MISSING |
| `description` | ❌ MISSING |
| `metadata` | ❌ MISSING |
| `resolved` | ❌ MISSING |
| `resolved_at` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column risk_events.account_id does not exist
```

**Columns that DO exist**: `id`, `challenge_account_id`, `created_at`

---

### 10. `challenge_progress` — `ChallengeMetricsRepository`

| Column Code Expects | Status |
|---|---|
| `challenge_id` | ❌ MISSING — has `challenge_account_id` (NOT NULL) |
| `account_id` | ❌ MISSING |
| `event_type` | ❌ MISSING |
| `balance_before` | ❌ MISSING |
| `balance_after` | ❌ MISSING |
| `pnl` | ❌ MISSING |
| `pnl_percent` | ❌ MISSING |
| `drawdown` | ❌ MISSING |
| `drawdown_percent` | ❌ MISSING |
| `peak_balance` | ❌ MISSING |
| `trading_days_elapsed` | ❌ MISSING |
| `total_trades` | ❌ MISSING |
| `description` | ❌ MISSING |
| `metadata` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column challenge_progress.challenge_id does not exist
```

**Columns that DO exist**: `id`, `challenge_account_id`, `win_rate`, `created_at`

---

### 11. `execution_audits` — `OrderAuditRepository`

| Column Code Expects | Status |
|---|---|
| `order_id` | ❌ MISSING |
| `account_id` | ❌ MISSING |
| `event_type` | ❌ MISSING |
| `previous_status` | ❌ MISSING |
| `new_status` | ❌ MISSING |
| `symbol` | ❌ MISSING |
| `token` | ❌ MISSING |
| `segment` | ❌ MISSING |
| `side` | ❌ MISSING |
| `qty` | ❌ MISSING |
| `filled_qty` | ❌ MISSING |
| `avg_price` | ❌ MISSING |
| `price` | ❌ MISSING |
| `broker_order_id` | ❌ MISSING |
| `broker_provider` | ❌ MISSING |
| `reject_reason` | ❌ MISSING |
| `latency_ms` | ❌ MISSING |
| `metadata` | ❌ MISSING |

**Actual runtime error**:
```
Code:    42703
Message: column execution_audits.order_id does not exist
```

**Columns that DO exist**: `id`, `created_at`

---

## ✅ Fully Compatible Table (1)

### `sessions` — `SessionService`

All expected columns verified present: `id`, `user_id`, `account_id`, `token_hash`, `ip_address`, `user_agent`, `expires_at`, `revoked_at`

**Additional columns in Supabase** (not used by code): `session_token`, `device_fingerprint`, `country`, `browser`, `os`, `device_name`, `is_active`, `is_trusted`, `requires_mfa`, `mfa_verified`, `metadata`, `last_activity_at`

---

## Key Architectural Mismatch Pattern

The Supabase schema was clearly designed with a **different data model**:

| Code Expects | Actual Schema |
|---|---|
| `account_id` (UUID FK to `trading_accounts`) | `user_id` or `challenge_account_id` |
| `balance` (decimal) | `virtual_balance` |
| `challenge_id` FK | No FK relationship |
| UUID primary keys everywhere | Integer PKs on `audit_logs`, `execution_audits`, `challenge_rules` |
| Rich columns per table (10-20+) | Minimal columns (2-5 per table) |
| `broker_provider`, `token`, `segment`, `exchange` | Not present |

**Root Cause**: The backend repository code was written for a fully-featured trading terminal schema, but the Supabase database contains a simpler dashboard/challenge-tracking schema from the FundedWealth Dashboard product.

---

## Impact on Server Runtime

| Scenario | Behavior |
|---|---|
| `DEV_BYPASS_AUTH=true` (current) | Most errors masked — in-memory dev account used, try/catch returns `[]` |
| Production (real auth + real Supabase queries) | **Every trading operation will 500** |
| SSO login → place order | 500: `column trading_orders.account_id does not exist` |
| SSO login → view positions | 500: `column positions.account_id does not exist` |
| SSO login → view watchlists | 500: `table 'public.watchlists' not found` |
| Daily cron → EOD metrics | Crash: `table 'public.account_metrics' not found` |
| Broker reconnect → persist session | Crash: `table 'public.broker_sessions' not found` |

---

## Resolution: Run Migration

**Code fix APPLIED**: All 14 repository constructors and 25+ direct `.from()` calls in services have been updated to use the correct `t_` prefixed table names from the migration SQL.

**One manual step remains**: Run the migration SQL in Supabase SQL Editor.

### Steps:
1. Go to: https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql
2. Paste the contents of: `server/db/FULL_MIGRATION.sql`
3. Click **Run**

The migration uses `CREATE TABLE IF NOT EXISTS` — it will not touch your existing Dashboard tables (`users`, `trading_accounts`, etc.). It creates a parallel set of terminal-specific tables (`t_users`, `t_accounts`, `t_orders`, etc.).

### Updated Table Name Mapping (after code fix):

| Repository | OLD (broken) | NEW (correct) |
|---|---|---|
| `UserRepository` | `users` | `t_users` |
| `AccountRepository` | `trading_accounts` | `t_accounts` |
| `ChallengeRepository` | `challenge_accounts` | `t_challenges` |
| `OrderRepository` | `trading_orders` | `t_orders` |
| `PositionRepository` | `positions` | `t_positions` |
| `TradeRepository` | `executions` | `t_trades` |
| `WatchlistRepository` | `watchlists` | `t_watchlists` |
| `RiskRulesRepository` | `challenge_rules` | `t_risk_rules` |
| `MetricsRepository` | `account_metrics` | `t_account_metrics` |
| `AuditRepository` | `audit_logs` | `audit_log` |
| `BrokerSessionRepository` | `broker_sessions` | `t_broker_sessions` |
| `RiskEventRepository` | `risk_events` | `t_risk_events` |
| `ChallengeMetricsRepository` | `challenge_progress` | `t_challenge_metrics` |
| `OrderAuditRepository` | `execution_audits` | `t_order_audit` |
| `SessionService` | `sessions` | `t_sessions` |
