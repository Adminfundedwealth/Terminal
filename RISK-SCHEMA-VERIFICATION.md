# RISK SCHEMA VERIFICATION — Agent D

**Date:** 2026-06-19  
**Method:** Supabase REST API query to each table  
**Supabase Project:** `nysrxvpjdlvzvcawysvh`

---

## TABLE EXISTENCE CHECK

### t_-prefixed Terminal Tables (Required by Repositories)

| Table | Status | Evidence |
|-------|--------|----------|
| `t_users` | ❌ NOT FOUND | `Could not find the table 'public.t_users' in the schema cache` |
| `t_accounts` | ❌ NOT FOUND | `Could not find the table 'public.t_accounts' in the schema cache` |
| `t_challenges` | ❌ NOT FOUND | `Could not find the table 'public.t_challenges' in the schema cache` |
| `t_risk_rules` | ❌ NOT FOUND | `Could not find the table 'public.t_risk_rules' in the schema cache` |
| `t_orders` | ❌ NOT FOUND | `Could not find the table 'public.t_orders' in the schema cache` |
| `t_positions` | ❌ NOT FOUND | `Could not find the table 'public.t_positions' in the schema cache` |
| `t_trades` | ❌ NOT FOUND | `Could not find the table 'public.t_trades' in the schema cache` |
| `t_account_metrics` | ❌ NOT FOUND | `Could not find the table 'public.t_account_metrics' in the schema cache` |
| `t_sessions` | ❌ NOT FOUND | `Could not find the table 'public.t_sessions' in the schema cache` |
| `t_payouts` | ❌ NOT FOUND | `Could not find the table 'public.t_payouts' in the schema cache` |
| `t_risk_events` | ❌ NOT FOUND | `Could not find the table 'public.t_risk_events' in the schema cache` |
| `t_challenge_metrics` | ❌ NOT FOUND | `Could not find the table 'public.t_challenge_metrics' in the schema cache` |
| `audit_log` | ❌ NOT FOUND | `Could not find the table 'public.audit_log' in the schema cache` |

### Dashboard Tables (Exist but WRONG schema for terminal)

| Table | Status | Notes |
|-------|--------|-------|
| `users` | ✅ EXISTS | Dashboard schema (clerk_id, kyc_status) — NOT terminal schema |
| `orders` | ✅ EXISTS | Dashboard schema — NOT terminal schema |
| `positions` | ✅ EXISTS | Dashboard schema — NOT terminal schema |
| `sessions` | ✅ EXISTS | Dashboard schema — NOT terminal schema |
| `risk_events` | ✅ EXISTS | Dashboard schema — NOT terminal schema |
| `payouts` | ✅ EXISTS | Dashboard schema — NOT terminal schema |

---

## CONCLUSION

**Zero terminal tables exist.** The Supabase instance contains only Dashboard application tables. The terminal's `t_`-prefixed migration (004_terminal_tables.sql) has NEVER been executed against this database.
