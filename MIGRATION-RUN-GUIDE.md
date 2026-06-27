# MIGRATION-RUN-GUIDE.md

## Purpose
Execute the terminal database schema in Supabase SQL Editor in 4 sequential parts.

---

## Prerequisites

- Supabase project: `nysrxvpjdlvzvcawysvh`
- Dashboard: https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh
- Navigate to: **SQL Editor** (left sidebar)

---

## Execution Order

### STEP 1: Run Part 1 — Core Tables

**File:** `server/db/MIGRATION-PART-1.sql`

**Creates:**
- t_users
- t_challenges
- t_accounts
- t_risk_rules
- t_orders
- t_positions
- t_trades
- t_watchlists
- t_account_metrics
- t_sessions

**Action:**
1. Click **+ New Query**
2. Paste entire contents of `MIGRATION-PART-1.sql`
3. Click **RUN**
4. Expect: "Success. No rows returned"

---

### STEP 2: Run Part 2 — Indexes, Triggers, RLS

**File:** `server/db/MIGRATION-PART-2.sql`

**Creates:**
- 9 indexes on core tables
- `update_updated_at_column()` trigger function
- 4 update triggers
- RLS enabled on 10 tables

**Action:**
1. Click **+ New Query**
2. Paste entire contents of `MIGRATION-PART-2.sql`
3. Click **RUN**
4. Expect: "Success. No rows returned"

---

### STEP 3: Run Part 3 — Persistence Tables

**File:** `server/db/MIGRATION-PART-3.sql`

**Creates:**
- t_broker_sessions
- t_risk_events
- t_challenge_metrics
- t_order_audit
- 11 indexes
- RLS + policies on 4 tables

**Action:**
1. Click **+ New Query**
2. Paste entire contents of `MIGRATION-PART-3.sql`
3. Click **RUN**
4. Expect: "Success. No rows returned"

---

### STEP 4: Run Part 4 — Phase Progression, Payouts, Foundation

**File:** `server/db/MIGRATION-PART-4.sql`

**Creates:**
- ALTER t_challenges (add phase, previous_challenge_id columns)
- t_payouts
- audit_log
- broker_sessions
- 5 indexes
- RLS on t_payouts

**Action:**
1. Click **+ New Query**
2. Paste entire contents of `MIGRATION-PART-4.sql`
3. Click **RUN**
4. Expect: "Success. No rows returned"

---

## Post-Migration: Seed Data

After all 4 parts complete successfully:

```bash
cd server
node db/setup.js
```

Expected output:
```
=== FundedWealth Terminal — Database Setup ===
1. Verifying terminal tables...
   ✅ t_users
   ✅ t_challenges
   ✅ t_accounts
   ... (all 12 tables ✅)
2. No data found. Inserting seed...
   ✅ User created
   ✅ Challenge created
   ✅ Account created
   ✅ Risk rules created: 9 rules
   ✅ Watchlists created: 5 lists
3. Verifying seed data...
   ✅ User: Test Trader (test@fundedwealth.com)
   ✅ Account: FW-10001 (balance: ₹1,00,00,000)
=== Setup Complete ===
```

---

## Verification

After seed completes, restart the server:

```bash
cd server
node index.js
```

Health endpoint should show:
```json
{ "database": { "connected": true, "reason": "OK" } }
```

---

## Table Summary (17 total)

| Part | Tables Created | Count |
|------|---------------|-------|
| Part 1 | t_users, t_challenges, t_accounts, t_risk_rules, t_orders, t_positions, t_trades, t_watchlists, t_account_metrics, t_sessions | 10 |
| Part 2 | (indexes, triggers, RLS only — no new tables) | 0 |
| Part 3 | t_broker_sessions, t_risk_events, t_challenge_metrics, t_order_audit | 4 |
| Part 4 | t_payouts, audit_log, broker_sessions | 3 |
| **Total** | | **17** |

---

## Safety Notes

- All `CREATE TABLE` statements use `IF NOT EXISTS` — safe to re-run
- All `CREATE INDEX` statements use `IF NOT EXISTS` — safe to re-run
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe to re-run
- Part 3 `CREATE TABLE` (without IF NOT EXISTS) will error if tables already exist — run only once
- No data is modified or deleted — schema creation only
- Production tables (`users`, `orders`, `positions`, etc.) are NOT touched

---

*Prepared by Agent B — No code modified.*
