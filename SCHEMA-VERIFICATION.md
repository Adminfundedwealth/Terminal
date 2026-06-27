# SCHEMA VERIFICATION — Phase C2

## Date: 2026-06-19

---

## Verification Method

Script: `server/check-tables.js`
Connection: Supabase REST API with service_role key
URL: `https://nysrxvpjdlvzvcawysvh.supabase.co`

---

## Results

| Table | Exists in Supabase | Required For |
|-------|:-:|---|
| t_users | ❌ NO | Account FK dependency |
| t_challenges | ❌ NO | Account FK dependency |
| t_accounts | ❌ NO | Every execution operation |
| t_risk_rules | ❌ NO | Pre-trade risk validation |
| t_orders | ❌ NO | Order persistence |
| t_positions | ❌ NO | Position tracking |
| t_trades | ❌ NO | Trade recording |
| t_watchlists | ❌ NO | Watchlist display |
| t_account_metrics | ❌ NO | Daily metrics/PnL |
| t_sessions | ❌ NO | Auth session storage |
| audit_log | ❌ NO | General audit trail |
| broker_sessions | ❌ NO | Broker connection tracking |
| t_broker_sessions | ❌ NO | EventDispatcher persistence |
| t_risk_events | ❌ NO | Risk check audit |
| t_challenge_metrics | ❌ NO | Challenge progression |
| t_order_audit | ❌ NO | Order lifecycle audit |
| t_payouts | ❌ NO | Payout management |

---

## Root Cause

The Supabase project `nysrxvpjdlvzvcawysvh` has NEVER had its schema migrations run.
Migration SQL files exist in `server/db/migrations/` but were never executed against the database.

---

## Fix Required

Execute in Supabase SQL Editor (in order):
1. `server/db/migrations/004_terminal_tables.sql`
2. `server/db/migrations/005_persistence_tables.sql`
3. `server/db/migrations/006_phase_progression.sql`
4. Foundation tables (audit_log, broker_sessions)

Combined file available at: `server/db/FULL_MIGRATION.sql`

After tables exist, run: `node server/db/setup.js` to seed test data.

---

## Access Issue

Cannot execute DDL remotely because:
- Supabase REST API (PostgREST) does not support CREATE TABLE
- Service key (`sb_secret_...`) is not a valid PostgreSQL password
- No `/pg/query` endpoint available on this project
- Pooler connection rejected with this key

**Manual intervention required: Run SQL in Supabase Dashboard.**
