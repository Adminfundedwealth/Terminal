# SUPABASE REALITY AUDIT

**Date:** June 19, 2026  
**Project:** https://nysrxvpjdlvzvcawysvh.supabase.co  
**Method:** Programmatic table discovery via Supabase client  

---

## EXISTING TABLES (4)

### 1. `users` — Dashboard Users (NOT Terminal)
- **Rows:** 20
- **Columns (30):** id, clerk_id, email, full_name, phone, kyc_status, created_at, first_name, last_name, role, city, state, avatar_url, affiliate_code, referred_by, notification_settings, is_active, experience_points, current_level, achievement_count, streak_points, public_profile, total_payout, updated_at, upi_id, bank_account_name, bank_account_number, bank_ifsc_code, bank_name, preferred_payout_method
- **Schema Owner:** FundedWealth Dashboard
- **Terminal Usage:** NONE (uses `t_users` instead)

### 2. `orders` — Dashboard Payment Orders (NOT Trading)
- **Rows:** 17
- **Columns (9):** id, user_id, plan_type, amount, status, payment_method, created_at, utr_reference, updated_at
- **Schema Owner:** FundedWealth Dashboard (subscription payments)
- **Terminal Usage:** NONE (uses `t_orders` for trading orders)

### 3. `positions` — Empty Table
- **Rows:** 0
- **Columns:** Unknown (no rows to infer)
- **Schema Owner:** Unclear
- **Terminal Usage:** NONE (uses `t_positions`)

### 4. `sessions` — Dashboard Sessions
- **Rows:** 3
- **Columns (19):** id, user_id, session_token, device_fingerprint, ip_address, user_agent, country, browser, os, device_name, is_active, is_trusted, requires_mfa, mfa_verified, metadata, created_at, last_activity_at, expires_at, revoked_at
- **Schema Owner:** FundedWealth Dashboard
- **Terminal Usage:** NONE (uses `t_sessions`)

---

## MISSING TABLES (Terminal Required)

| Table | Purpose | Status |
|-------|---------|--------|
| `t_users` | Terminal user records | ❌ Not created |
| `t_accounts` | Trading accounts | ❌ Not created |
| `t_challenges` | Prop firm challenges | ❌ Not created |
| `t_orders` | Trading orders | ❌ Not created |
| `t_positions` | Open positions | ❌ Not created |
| `t_trades` | Execution log | ❌ Not created |
| `t_sessions` | Terminal auth sessions | ❌ Not created |
| `t_watchlists` | User watchlists | ❌ Not created |
| `t_risk_rules` | Trading rules | ❌ Not created |
| `t_account_metrics` | Daily P&L snapshots | ❌ Not created |

---

## KEY FINDINGS

1. **Schema Collision Confirmed:** Dashboard uses bare table names (`users`, `orders`, `sessions`). Terminal MUST use `t_` prefix to avoid data corruption.

2. **Dashboard `orders` ≠ Trading Orders:** Dashboard `orders` table stores subscription payments (plan_type, amount, utr_reference). Completely different from trading orders (symbol, side, qty, price).

3. **Dashboard `users` ≠ Terminal Users:** Dashboard uses Clerk auth (clerk_id) with 30 columns of profile data. Terminal uses lightweight user records (fw_user_id, email, name).

4. **No DDL Access via API:** Supabase service key cannot execute DDL (CREATE TABLE) via REST API. Tables must be created via:
   - Supabase Dashboard → SQL Editor
   - Direct psql connection (requires DB password, not service key)

5. **Application Adapted:** All endpoints return 200 by:
   - Using in-memory fallback for orders when `t_orders` doesn't exist
   - Returning empty arrays for positions/trades/watchlists
   - Dev-bypass auth providing user context

---

## MIGRATION FILE

**Location:** `server/db/migrations/006_create_terminal_tables.sql`

Run in Supabase SQL Editor to create all terminal tables with seed data.

---

## RAW RESULTS

Full JSON: `server/db/supabase-reality-results.json`
