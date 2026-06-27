# DB-RECOVERY-REPORT.md

## Date: 2026-06-19
## Purpose: Verify migration file, setup script, and environment readiness

---

## 1. FULL_MIGRATION.sql

### File Details

| Property | Value |
|----------|-------|
| Path | `server/db/FULL_MIGRATION.sql` |
| Size | 20,838 bytes |
| Lines | 502 |

### First 20 Lines

```sql
-- FULL MIGRATION — Run in Supabase SQL Editor
-- Generated: 2026-06-19T09:36:43.453Z

-- ═══ Migration 004: Terminal Tables ═══
-- ============================================================
-- MIGRATION 004: Terminal Trading Tables
-- 
-- Creates terminal-specific tables with t_ prefix to avoid
-- collision with existing Dashboard tables (users, orders, etc.)
-- 
-- Tables: t_users, t_challenges, t_accounts, t_risk_rules,
--         t_orders, t_positions, t_trades, t_watchlists,
--         t_account_metrics, t_sessions
-- ============================================================

-- Terminal Users (mapped from Dashboard users)
CREATE TABLE IF NOT EXISTS t_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
```

### Last 20 Lines

```sql
CREATE TABLE IF NOT EXISTS broker_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  provider TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_broker_sessions_acct ON broker_sessions(account_id);
```

---

## 2. CREATE TABLE Statements

**Contains CREATE TABLE: YES**
**Total tables created: 17**

| # | Table Name | Purpose |
|---|-----------|---------|
| 1 | t_users | Terminal users (mapped from Dashboard) |
| 2 | t_challenges | Prop firm evaluation/funded accounts |
| 3 | t_accounts | Trading accounts (one per challenge) |
| 4 | t_risk_rules | Risk rules per account (JSONB value) |
| 5 | t_orders | Trading orders (full lifecycle) |
| 6 | t_positions | Open/closed positions |
| 7 | t_trades | Immutable execution records |
| 8 | t_watchlists | User watchlists (JSONB items) |
| 9 | t_account_metrics | Daily P&L snapshots |
| 10 | t_sessions | Terminal auth sessions |
| 11 | t_broker_sessions | Broker connection lifecycle |
| 12 | t_risk_events | Risk violations audit trail |
| 13 | t_challenge_metrics | Challenge progression events |
| 14 | t_order_audit | Immutable order state transitions |
| 15 | t_payouts | Payout requests & lifecycle |
| 16 | audit_log | General audit log |
| 17 | broker_sessions | Legacy broker session table |

---

## 3. setup.js

### File Details

| Property | Value |
|----------|-------|
| Path | `server/db/setup.js` |
| Usage | `node server/db/setup.js` |
| Prerequisite | FULL_MIGRATION.sql must be run first |

### Required Environment Variables

| Variable | Loaded From | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | `process.env.SUPABASE_URL` | YES (exits with error if missing) |
| `SUPABASE_SERVICE_KEY` | `process.env.SUPABASE_SERVICE_KEY` | YES (exits with error if missing) |

### How They're Loaded

```javascript
import { config } from 'dotenv';
config();  // Loads from server/.env (cwd)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
```

### What setup.js Does

1. Verifies all 12 required tables exist (queries each with `.select('id').limit(0)`)
2. If any missing → exits with error + instructions
3. Checks if seed data exists in `t_users`
4. If empty → inserts seed data:
   - 1 user (test@fundedwealth.com)
   - 1 challenge (₹1Cr evaluation, 30-day expiry)
   - 1 account (FW-10001, angelone, ₹1Cr balance)
   - 9 risk rules (daily loss, max drawdown, profit target, etc.)
   - 5 watchlists (INDEX, STOCKS, FUTURES, MCX, CDS)
5. Verifies seed data was inserted correctly

---

## 4. server/.env Verification

| Variable | Present | Has Value |
|----------|---------|-----------|
| SUPABASE_URL | **YES** | YES (non-empty) |
| SUPABASE_SERVICE_KEY | **YES** | YES (non-empty) |

---

## 5. CURRENT DATABASE STATE

**Tables exist in Supabase: NO**

All 17 tables are missing. The health endpoint reports:
```json
{ "connected": true, "reason": "OK (tables pending migration)" }
```

Supabase is reachable and authenticated. Schema is not created.

---

## 6. RECOVERY STEPS

```
Step 1:  Open https://supabase.com/dashboard
Step 2:  Select project (nysrxvpjdlvzvcawysvh)
Step 3:  Navigate to SQL Editor
Step 4:  Paste contents of server/db/FULL_MIGRATION.sql (502 lines, 20KB)
Step 5:  Click RUN
Step 6:  Run:  cd server && node db/setup.js
Step 7:  Verify:  Server restart → health shows "OK"
```

---

## 7. SUMMARY

| Check | Result |
|-------|--------|
| FULL_MIGRATION.sql exists | ✓ YES |
| Contains valid CREATE TABLE DDL | ✓ YES (17 tables) |
| Uses IF NOT EXISTS (safe to re-run) | ✓ YES |
| setup.js exists | ✓ YES |
| Required env vars configured | ✓ YES |
| Supabase reachable | ✓ YES |
| Tables created in Supabase | ✗ NO |
| Migration has been run | ✗ NO |
| Seed data exists | ✗ NO |

**Ready to migrate: YES** — file, credentials, and connection all verified. Only manual SQL execution in Supabase Dashboard remains.

---

*Agent B — Verification Only. No code modified.*
