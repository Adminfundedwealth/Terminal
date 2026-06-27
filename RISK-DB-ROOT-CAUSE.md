# RISK DB ROOT CAUSE — Agent D

**Date:** 2026-06-19  
**Error:** `Could not find the table 'public.t_accounts' in the schema cache`

---

## ROOT CAUSE

**The migration `004_terminal_tables.sql` has NEVER been executed against the Supabase database.**

---

## EVIDENCE

1. **API confirms tables missing:**
   ```
   t_users: ERROR: Could not find the table 'public.t_users' in the schema cache
   t_accounts: ERROR: Could not find the table 'public.t_accounts' in the schema cache
   (... all 13 t_ tables missing)
   ```

2. **Supabase OpenAPI schema shows only Dashboard tables:**
   - `users` (clerk_id, kyc_status, achievement_count) — Dashboard user table
   - `orders`, `positions`, `sessions` — Dashboard tables
   - NO `t_*` prefixed tables appear

3. **PostgREST hint confirms:**
   ```json
   {"hint": "Perhaps you meant the table 'public.users'"}
   ```
   PostgREST sees `users` but NOT `t_users`.

---

## WHY IT WASN'T EXECUTED

| Factor | Status |
|--------|--------|
| Migration files exist locally | ✅ `server/db/migrations/004_terminal_tables.sql` exists |
| `FULL_MIGRATION.sql` consolidated file exists | ✅ Present in `server/db/` |
| Migration runner exists | ❌ No automated migration runner that works |
| Supabase CLI installed | ❌ NOT installed on this machine |
| psql installed | ❌ NOT installed on this machine |
| Direct postgres connection | ❌ TIMES OUT (IPv6 only, not reachable from this network) |
| Pooler connection | ❌ Project not found on any pooler region |
| Management API access | ❌ Requires personal access token (not available) |
| SQL Editor access | ❌ Requires browser (cannot automate) |

---

## WHAT'S IN THE DATABASE

The Supabase project `nysrxvpjdlvzvcawysvh` contains **87 tables** from the FundedWealth Dashboard application:
- `users` (with clerk_id, kyc_status, badges, etc.)
- `challenge_accounts`, `challenge_rules`, `challenge_state`, `challenge_progress`
- `funded_accounts`, `payouts`, `payout_eligibility`
- `risk_events`, `breach_events`, `account_locks`, `account_states`
- `trading_accounts`, `trading_orders`, `executions`
- And 70+ other dashboard/community/analytics tables

These are Dashboard tables with DIFFERENT schemas. The terminal needs its own `t_`-prefixed tables.

---

## WHY REPOSITORIES POINT TO `t_*`

The terminal was designed to coexist with the Dashboard in the same Supabase project by using the `t_` prefix:
```
Dashboard: users, orders, positions       ← Dashboard app
Terminal:  t_users, t_orders, t_positions  ← Terminal app
```

This avoids schema collision. The migration SQL was written but never executed.

---

## FIX REQUIRED

Run `server/db/FULL_MIGRATION.sql` in the Supabase SQL Editor:
1. Go to: https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql
2. Paste contents of `server/db/FULL_MIGRATION.sql`
3. Click **Run**

No code changes needed. The repositories are correct. The database is missing the tables.
