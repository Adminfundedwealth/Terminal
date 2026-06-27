# DATABASE-REALITY-PROOF.md

## Date: 2026-06-20
## Method: Direct Supabase queries via service role key
## Project: nysrxvpjdlvzvcawysvh.supabase.co

---

## SQL USED (via Supabase JS client — equivalent to PostgREST)

```sql
-- Test 1: SELECT with head:true (count only)
SELECT count(*) FROM public.t_users;
-- PostgREST equivalent: GET /rest/v1/t_users?select=*&limit=0 (head: true)

-- Test 2: INSERT (definitive existence test)
INSERT INTO public.t_users (fw_user_id, email, name) VALUES ('__test__', 't@t.com', 'Test') RETURNING *;

-- Test 3: Production table query (confirms connection works)
SELECT id FROM public.users LIMIT 1;
```

---

## RESULTS: t_* TABLES

| Table | EXISTS | Row Count | Evidence |
|-------|--------|-----------|----------|
| t_users | **NO** | — | `PGRST205: Could not find the table 'public.t_users' in the schema cache` |
| t_challenges | **NO** | — | `PGRST205: Could not find the table` |
| t_accounts | **NO** | — | `PGRST205: Could not find the table` |
| t_risk_rules | **NO** | — | `PGRST205: Could not find the table` |
| t_orders | **NO** | — | `PGRST205: Could not find the table` |
| t_positions | **NO** | — | `PGRST205: Could not find the table` |
| t_trades | **NO** | — | `PGRST205: Could not find the table` |
| t_watchlists | **NO** | — | `PGRST205: Could not find the table` |
| t_account_metrics | **NO** | — | `PGRST205: Could not find the table` |
| t_sessions | **NO** | — | `PGRST205: Could not find the table` |
| t_broker_sessions | **NO** | — | `PGRST205: Could not find the table` |
| t_risk_events | **NO** | — | `PGRST205: Could not find the table` |
| t_challenge_metrics | **NO** | — | `PGRST205: Could not find the table` |
| t_order_audit | **NO** | — | `PGRST205: Could not find the table` |
| t_payouts | **NO** | — | `PGRST205: Could not find the table` |
| audit_log | **NO** | — | `PGRST205: Could not find the table` |
| broker_sessions | **NO** | — | `PGRST205: Could not find the table` |

**0 out of 17 terminal tables exist.**

---

## DEFINITIVE INSERT TEST

```javascript
supabase.from('t_users')
  .insert({ fw_user_id: '__test__', email: 't@t.com', name: 'Test' })
  .select().single()
```

**Result:**
```json
{
  "code": "PGRST205",
  "details": null,
  "hint": "Perhaps you meant the table 'public.users'",
  "message": "Could not find the table 'public.t_users' in the schema cache"
}
```

The INSERT failed. The table does not exist. Supabase suggests `public.users` (the production table) as an alternative.

---

## PRODUCTION TABLES (proof connection works)

| Table | EXISTS | Row Count | Evidence |
|-------|--------|-----------|----------|
| users | **YES** | 20 | Query returns UUID `d4c88c1a-8684-4c59-a736-171d19035919` |
| orders | **YES** | 17 | Accessible via service key |
| positions | **YES** | 0 | Table exists, empty |
| executions | **YES** | — | Accessible |
| trading_accounts | **YES** | — | Accessible |
| challenge_accounts | **YES** | — | Accessible |
| challenge_rules | **YES** | — | Accessible |
| risk_events | **YES** | — | Accessible |
| payouts | **YES** | — | Accessible |
| payout_eligibility | **YES** | — | Accessible |
| sessions | **YES** | — | Accessible |

**11 production tables exist with live data.**

---

## CONCLUSION

**FULL_MIGRATION.sql has NOT been executed.**

- Zero `t_*` tables exist in the `public` schema
- The PostgREST schema cache has no knowledge of any `t_*` table
- INSERT operations to `t_users` fail with `PGRST205`
- The Supabase project contains only the production/dashboard schema

---

## WHAT MUST HAPPEN

The file `server/db/FULL_MIGRATION.sql` (502 lines) must be executed in the Supabase SQL Editor. This cannot be done programmatically because:
- Supabase PostgREST only supports DML (SELECT, INSERT, UPDATE, DELETE)
- DDL (CREATE TABLE) requires the SQL Editor or direct PG connection
- No DATABASE_URL or DB password is available in `.env`

```
URL: https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql/new
Action: Paste FULL_MIGRATION.sql → Click RUN
```

---

*No assumptions. No certification. Database evidence only.*
*Agent B — 2026-06-20*
