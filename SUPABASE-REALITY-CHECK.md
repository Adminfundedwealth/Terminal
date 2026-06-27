# SUPABASE REALITY CHECK

## Date: 2026-06-19

---

## CONNECTION DETAILS

```
SUPABASE_URL:    https://nysrxvpjdlvzvcawysvh.supabase.co
PROJECT_ID:      nysrxvpjdlvzvcawysvh
SERVICE_KEY:     [REDACTED - stored in .env as SUPABASE_DB_PASSWORD]
```

---

## ALL EXISTING TABLES IN SUPABASE

| Table | Rows | Purpose |
|-------|------|---------|
| `users` | 20 | **Dashboard users** (clerk_id, kyc, bank details, gamification) |
| `orders` | 17 | **Dashboard plan purchases** (plan_type, amount, utr_reference) |
| `positions` | 0 | **Partial/incompatible schema** (missing account_id, token, segment) |
| `sessions` | 3 | **Dashboard sessions** (device_fingerprint, mfa, browser, os) |

**Total: 4 tables exist. All belong to the FundedWealth Dashboard, NOT the trading terminal.**

---

## CRITICAL FINDING: These are NOT trading tables

### `users` table — DASHBOARD, NOT TERMINAL

```
Columns (30):
  id, clerk_id, email, full_name, phone, kyc_status, first_name, last_name,
  role, city, state, avatar_url, affiliate_code, referred_by,
  notification_settings, is_active, experience_points, current_level,
  achievement_count, streak_points, public_profile, total_payout,
  upi_id, bank_account_name, bank_account_number, bank_ifsc_code,
  bank_name, preferred_payout_method, created_at, updated_at
```

**This is the FW Dashboard user table** (gamification, KYC, bank details).
Terminal needs: `t_users` (id, fw_user_id, email, name, status) — completely different schema.

---

### `orders` table — PLAN PURCHASES, NOT TRADES

```
Columns (9):
  id, user_id, plan_type, amount, status, payment_method,
  created_at, utr_reference, updated_at
```

Sample: `{ plan_type: "1step", amount: 4199, payment_method: "upi_manual", status: "paid" }`

**This is the Dashboard plan purchase table** (user buys a challenge plan).
Terminal needs: `t_orders` (account_id, symbol, token, segment, side, order_type, product_type, qty, price, status='FILLED') — completely different purpose.

---

### `positions` table — INCOMPATIBLE SCHEMA

```
Existing columns:    id, symbol, qty, opened_at, closed_at
Missing columns:     account_id, token, segment, product_type, avg_price, realized_pnl, exchange
```

This table exists but has the **wrong schema** for the terminal. Missing critical columns that the `PositionRepository` needs.

---

### `sessions` table — DASHBOARD SESSIONS

```
Columns (19):
  id, user_id, session_token, device_fingerprint, ip_address, user_agent,
  country, browser, os, device_name, is_active, is_trusted,
  requires_mfa, mfa_verified, metadata, created_at, last_activity_at,
  expires_at, revoked_at
```

**This is the Dashboard session table** (device tracking, MFA).
Terminal needs: `t_sessions` (user_id, account_id, token_hash, ip_address, user_agent, expires_at, revoked_at) — much simpler.

---

## COMPARISON: Existing vs Required

| Unprefixed (exists) | Purpose | t_ Prefixed (needed) | Purpose | Compatible? |
|---|---|---|---|---|
| `users` (30 cols, dashboard) | KYC, gamification | `t_users` (6 cols) | Terminal user mapping | ❌ NO |
| `orders` (9 cols, purchases) | Plan purchases | `t_orders` (17 cols) | Trading orders | ❌ NO |
| `positions` (5 cols, partial) | Unknown/partial | `t_positions` (12 cols) | Trading positions | ❌ NO |
| `sessions` (19 cols, dashboard) | Device/MFA | `t_sessions` (8 cols) | Terminal JWT sessions | ❌ NO |
| — | — | `t_accounts` | Trading accounts | ❌ MISSING |
| — | — | `t_trades` | Trade executions | ❌ MISSING |
| — | — | `t_risk_rules` | Risk enforcement | ❌ MISSING |
| — | — | `t_challenges` | Prop firm challenges | ❌ MISSING |

---

## CONCLUSION

1. **The existing tables are the FundedWealth Dashboard** (main website/app)
2. **The terminal tables have NEVER been created** (all `t_` prefixed tables are missing)
3. **The naming convention is correct** — terminal uses `t_` prefix specifically to avoid colliding with Dashboard tables
4. **No data conflict** — terminal tables are independent of dashboard tables
5. **Safe to create `t_` tables** — they won't interfere with the existing 4 dashboard tables

---

## WHAT MUST BE CREATED (terminal-specific)

All tables use `t_` prefix. Zero overlap with existing Dashboard tables:

```
t_users            → Maps dashboard users to terminal users
t_challenges       → Prop firm evaluation/funded challenges  
t_accounts         → Trading accounts (linked to challenges)
t_risk_rules       → Per-account risk enforcement rules
t_orders           → Trading orders (BUY/SELL market/limit)
t_positions        → Open/closed trading positions
t_trades           → Immutable trade execution records
t_watchlists       → User stock watchlists
t_account_metrics  → Daily P&L snapshots
t_sessions         → Terminal JWT sessions
t_broker_sessions  → Broker connection lifecycle
t_risk_events      → Risk check audit trail
t_challenge_metrics → Challenge progression events
t_order_audit      → Order state transition log
t_payouts          → Payout tracking (funded accounts)
audit_log          → General audit events
broker_sessions    → Broker session tracking
```

---

## NEXT STEP

Run `server/db/FULL_MIGRATION.sql` in Supabase SQL Editor.
This creates 17 new tables — all with `t_` prefix (or foundation names) — with zero impact on existing Dashboard tables.
