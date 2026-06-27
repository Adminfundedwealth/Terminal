# SUPABASE FOUNDATION REPORT
## FundedWealth Terminal — Database Schema Audit

**Agent:** A — Supabase Foundation  
**Date:** 2026-06-18  
**Scope:** Database schema only. No UI, frontend, charts, or market data touched.

---

## 1. CURRENT SCHEMA AUDIT

### 1.1 Tables Verified (10 total)

| # | Table | PK | FK | CHECK | RLS | Triggers | Status |
|---|-------|----|----|-------|-----|----------|--------|
| 1 | `users` | UUID | — | status IN (active, suspended) | ✅ | updated_at | ✅ GOOD |
| 2 | `challenges` | UUID | user_id → users | type, status | ✅ | — | ✅ GOOD |
| 3 | `accounts` | UUID | user_id → users, challenge_id → challenges | broker_provider, status | ✅ | updated_at | ✅ GOOD |
| 4 | `risk_rules` | UUID | account_id → accounts | — | ✅ | — | ✅ GOOD |
| 5 | `orders` | UUID | account_id → accounts | side, order_type, product_type, status | ✅ | updated_at | ✅ GOOD |
| 6 | `positions` | UUID | account_id → accounts | — | ✅ | — | ✅ GOOD |
| 7 | `trades` | UUID | account_id → accounts, order_id → orders | side | ✅ | — | ✅ GOOD |
| 8 | `watchlists` | UUID | user_id → users | — | ✅ | updated_at | ✅ GOOD |
| 9 | `account_metrics` | UUID | account_id → accounts | — | ✅ | — | ✅ GOOD |
| 10 | `sessions` | UUID | user_id → users, account_id → accounts | — | ✅ | — | ✅ GOOD |

### 1.2 Indexes Verified (9 total)

| Index | Table | Columns | Type |
|-------|-------|---------|------|
| `idx_accounts_user` | accounts | user_id | B-tree |
| `idx_accounts_challenge` | accounts | challenge_id | B-tree |
| `idx_orders_account_time` | orders | account_id, placed_at DESC | B-tree |
| `idx_orders_status` | orders | account_id, status | Partial (PENDING, OPEN) |
| `idx_positions_open` | positions | account_id | Partial (closed_at IS NULL) |
| `idx_trades_account_time` | trades | account_id, executed_at DESC | B-tree |
| `idx_metrics_account_date` | account_metrics | account_id, date DESC | B-tree |
| `idx_sessions_token` | sessions | token_hash | Partial (revoked_at IS NULL) |
| `idx_watchlists_user` | watchlists | user_id | B-tree |
| `idx_unique_open_position` | positions | account_id, token, product_type | Partial UNIQUE (closed_at IS NULL) |

### 1.3 RLS Policies Verified (11 total)

| Policy | Table | Operation | Scope |
|--------|-------|-----------|-------|
| `users_select_own` | users | SELECT | id = auth.uid() |
| `accounts_select_own` | accounts | SELECT | user_id = auth.uid() |
| `challenges_select_own` | challenges | SELECT | user_id = auth.uid() |
| `orders_select_own` | orders | SELECT | account_id IN user's accounts |
| `orders_insert_own` | orders | INSERT | account_id IN user's accounts |
| `positions_select_own` | positions | SELECT | account_id IN user's accounts |
| `trades_select_own` | trades | SELECT | account_id IN user's accounts |
| `watchlists_all_own` | watchlists | ALL | user_id = auth.uid() |
| `risk_rules_select_own` | risk_rules | SELECT | account_id IN user's accounts |
| `metrics_select_own` | account_metrics | SELECT | account_id IN user's accounts |
| `sessions_select_own` | sessions | SELECT | user_id = auth.uid() |

### 1.4 Foreign Key Relationships

```
users
 ├── challenges.user_id → users.id (CASCADE DELETE)
 ├── accounts.user_id → users.id (CASCADE DELETE)
 ├── watchlists.user_id → users.id (CASCADE DELETE)
 └── sessions.user_id → users.id (CASCADE DELETE)

challenges
 └── accounts.challenge_id → challenges.id (NO ACTION)

accounts
 ├── risk_rules.account_id → accounts.id (CASCADE DELETE)
 ├── orders.account_id → accounts.id (NO ACTION)
 ├── positions.account_id → accounts.id (NO ACTION)
 ├── trades.account_id → accounts.id (NO ACTION)
 ├── account_metrics.account_id → accounts.id (NO ACTION)
 └── sessions.account_id → accounts.id (NO ACTION — nullable)

orders
 └── trades.order_id → orders.id (NO ACTION — nullable)
```

### 1.5 Migrations Applied (3 total)

| # | File | Purpose |
|---|------|---------|
| 001 | `server/db/migrations/001_initial_setup.sql` | `updated_at` auto-trigger for users, accounts, orders, watchlists |
| 002 | `server/db/migrations/002_rls_policies.sql` | All RLS policies |
| 003 | `server/db/migrations/003_schema_additions.sql` | peak_balance, payout_eligible, min_trading_days, exchange columns, partial unique index |

---

## 2. GAPS IDENTIFIED

### 2.1 Missing Tables

| # | Table | Purpose | Priority |
|---|-------|---------|----------|
| 1 | `audit_log` | Immutable log of all state changes (account lock, breach, challenge transitions). Required for compliance & dispute resolution. | HIGH |
| 2 | `notifications` | User notifications (breach alerts, target reached, daily summary). Currently no persistence for push/email queue. | MEDIUM |
| 3 | `payouts` | Track payout requests for funded accounts (payout_eligible exists on accounts but no payout lifecycle table). | MEDIUM |
| 4 | `broker_sessions` | Broker API token cache (access_token, refresh_token, expires_at per broker). Currently no persistent broker auth. | HIGH |
| 5 | `instruments_cache` | Instrument master data cache (token→symbol mappings, lot sizes, tick sizes). Currently in-memory only via instrumentService.js. | LOW |

### 2.2 Missing Indexes

| # | Table | Suggested Index | Reason |
|---|-------|----------------|--------|
| 1 | `challenges` | `idx_challenges_user_status` ON challenges(user_id, status) | ChallengeService.findActiveByUserId queries this pattern |
| 2 | `orders` | `idx_orders_broker_id` ON orders(broker_order_id) WHERE broker_order_id IS NOT NULL | Broker callback lookups by broker_order_id |
| 3 | `sessions` | `idx_sessions_user` ON sessions(user_id) WHERE revoked_at IS NULL | revokeAllUserSessions query pattern |
| 4 | `trades` | `idx_trades_today` ON trades(account_id, executed_at) WHERE executed_at >= CURRENT_DATE | Hot path: daily P&L calculations run on every trade |
| 5 | `risk_rules` | `idx_risk_rules_account_active` ON risk_rules(account_id) WHERE is_active = TRUE | Every pre-trade validation fetches active rules |
| 6 | `positions` | `idx_positions_token` ON positions(account_id, token) WHERE closed_at IS NULL | findOpenPosition lookup pattern |

### 2.3 Missing Foreign Keys

| # | Table | Column | Should Reference | Issue |
|---|-------|--------|-----------------|-------|
| 1 | `orders` | `account_id` | accounts(id) ON DELETE CASCADE | Currently NO ACTION — orphan orders if account deleted |
| 2 | `positions` | `account_id` | accounts(id) ON DELETE CASCADE | Same orphan risk |
| 3 | `trades` | `account_id` | accounts(id) ON DELETE CASCADE | Same orphan risk |
| 4 | `account_metrics` | `account_id` | accounts(id) ON DELETE CASCADE | Same orphan risk |

> **Note:** Whether CASCADE or RESTRICT depends on business rules. For prop firms, RESTRICT may be preferred (never delete accounts with trade history). Recommendation: use `ON DELETE RESTRICT` for orders/trades/positions/metrics to prevent accidental data loss.

### 2.4 Missing RLS Policies

| # | Table | Operation | Gap |
|---|-------|-----------|-----|
| 1 | `accounts` | INSERT/UPDATE | No insert/update policy — only SELECT exists. Backend bypasses RLS, but defense-in-depth is missing. |
| 2 | `challenges` | INSERT/UPDATE | Same — SELECT only |
| 3 | `orders` | UPDATE/DELETE | Users can insert but cannot cancel their own orders via client |
| 4 | `positions` | INSERT/UPDATE | No write policies |
| 5 | `trades` | INSERT | No insert policy (trades should be insert-only, no update/delete ever) |
| 6 | `risk_rules` | INSERT/UPDATE | Admin-only writes — needs service_role or admin policy |
| 7 | `sessions` | INSERT/UPDATE | No policy for creating or revoking own sessions |
| 8 | `account_metrics` | INSERT/UPDATE | Backend-only writes — needs explicit deny for client |

> **Note:** Backend uses `SUPABASE_SERVICE_KEY` (bypasses RLS). These gaps only matter if the Supabase anon key is ever exposed to client-side code. Recommended as defense-in-depth.

### 2.5 Missing Columns / Schema Gaps

| # | Table | Column | Type | Reason |
|---|-------|--------|------|--------|
| 1 | `challenges` | `target_percent` | NUMERIC(5,2) | Profit target is in risk_rules but should also be denormalized on challenge for quick reporting |
| 2 | `challenges` | `max_drawdown_percent` | NUMERIC(5,2) | Same — denormalize key rule for fast dashboard queries |
| 3 | `accounts` | `available_margin` | NUMERIC(15,2) | accountService returns this in dev mode but no column exists |
| 4 | `accounts` | `used_margin` | NUMERIC(15,2) | Same — needed for real-time margin tracking |
| 5 | `orders` | `lot_size` | INTEGER | Used in risk engine checkMaxLotSize but not stored |
| 6 | `positions` | `lot_size` | INTEGER | Same — needed for lot-based calculations |
| 7 | `trades` | `pnl` | NUMERIC(12,2) | Per-trade P&L not stored — currently computed from position FIFO. Storing simplifies reporting |
| 8 | `sessions` | `last_active_at` | TIMESTAMPTZ | No heartbeat tracking for session activity |

---

## 3. RELATIONSHIP DESIGN: User → Challenge → Account → Rules → Terminal

```
┌─────────────────────────────────────────────────────────────┐
│                    FW DASHBOARD (external)                    │
│  Creates: User + Challenge + Account + Risk Rules            │
│  Triggers: SSO → Terminal                                    │
└─────────────────────┬───────────────────────────────────────┘
                      │ SSO Token (JWT, 60s TTL)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    TERMINAL DATABASE (Supabase)               │
│                                                              │
│  ┌──────────┐   1:N   ┌─────────────┐   1:1   ┌─────────┐ │
│  │  users   │─────────▶│ challenges  │─────────▶│accounts │ │
│  │          │          │             │          │         │ │
│  │ fw_user_id         │ evaluation   │          │ balance │ │
│  │ email    │          │ funded      │          │ status  │ │
│  │ status   │          │ passed/failed│         │ peak    │ │
│  └──────────┘          └─────────────┘          └────┬────┘ │
│       │                                              │      │
│       │ 1:N                                    1:N   │      │
│       ▼                                              ▼      │
│  ┌──────────┐                              ┌─────────────┐  │
│  │watchlists│                              │ risk_rules  │  │
│  │          │                              │             │  │
│  │ items[]  │                              │ daily_loss  │  │
│  │ color    │                              │ max_dd      │  │
│  └──────────┘                              │ profit_tgt  │  │
│                                            │ max_pos     │  │
│       ┌────────────────────────────────────│ max_lots    │  │
│       │          TRADING ENGINE            │ hours       │  │
│       │                                    │ no_overnight│  │
│       ▼                                    └─────────────┘  │
│  ┌──────────┐   1:N   ┌──────────┐   1:N  ┌────────────┐   │
│  │  orders  │─────────▶│  trades  │        │ positions  │   │
│  │          │          │(immutable)│        │            │   │
│  │ PENDING  │          │          │        │ open/closed│   │
│  │ FILLED   │          └──────────┘        │ realized   │   │
│  │ REJECTED │                              └────────────┘   │
│  └──────────┘                                               │
│                                                              │
│  ┌───────────────┐        ┌──────────┐                      │
│  │account_metrics│        │ sessions │                      │
│  │  (daily EOD)  │        │ (JWT ref)│                      │
│  └───────────────┘        └──────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### Lifecycle Flow

```
1. USER CREATION (Dashboard → Terminal sync via SSO)
   Dashboard creates user → SSO token → Terminal upserts user record

2. CHALLENGE ASSIGNMENT
   Dashboard assigns challenge (evaluation/funded) → creates challenge row
   Challenge defines: type, plan, initial_balance, expiry

3. ACCOUNT PROVISIONING
   One account per challenge → account_code generated
   Broker credentials encrypted and stored
   Balance set to challenge.initial_balance

4. RISK RULES BINDING
   9 rule types configured per account (from plan template):
   - daily_loss_limit, max_drawdown, profit_target
   - max_positions, max_lot_size, allowed_segments
   - trading_hours, no_overnight, max_daily_trades

5. TERMINAL TRADING
   Pre-trade: RiskEngine.validateOrder() checks all active rules
   Execution: Order → Trade → Position update → Balance update
   Post-trade: RiskEngine.postTradeCheck() → lock/breach/target_reached

6. DAILY LIFECYCLE
   09:00 IST: Unlock daily-loss-locked accounts, check expiry
   15:45 IST: Record EOD metrics, check challenge transitions

7. CHALLENGE COMPLETION
   Pass: profit_target met + min_trading_days → status='passed', account='completed'
   Fail: max_drawdown breached → status='failed', account='breached'
   Expire: time limit exceeded → status='expired', account='expired'
```

---

## 4. FILE REFERENCES

### Schema & Migrations
| File | Purpose |
|------|---------|
| `server/db/schema.sql` | Complete table definitions, indexes, RLS enable |
| `server/db/migrations/001_initial_setup.sql` | updated_at triggers |
| `server/db/migrations/002_rls_policies.sql` | All RLS policies |
| `server/db/migrations/003_schema_additions.sql` | peak_balance, exchange columns, partial index |

### Database Layer
| File | Purpose |
|------|---------|
| `server/db/client.js` | Supabase client (service role, bypasses RLS) |
| `server/db/setup.js` | Connection test + seed data script |

### Repository Layer
| File | Table |
|------|-------|
| `server/repositories/base.repository.js` | Generic CRUD for all tables |
| `server/repositories/user.repository.js` | users |
| `server/repositories/account.repository.js` | accounts |
| `server/repositories/challenge.repository.js` | challenges |
| `server/repositories/order.repository.js` | orders |
| `server/repositories/position.repository.js` | positions |
| `server/repositories/trade.repository.js` | trades |
| `server/repositories/watchlist.repository.js` | watchlists |
| `server/repositories/risk-rules.repository.js` | risk_rules |
| `server/repositories/metrics.repository.js` | account_metrics |

### Services (DB consumers)
| File | DB Interaction |
|------|---------------|
| `server/services/riskEngine.js` | Reads risk_rules, positions, trades, accounts. Writes account_metrics. Locks/breaches accounts. |
| `server/services/challengeService.js` | Reads challenges, accounts, risk_rules, metrics. Writes challenge status transitions. |
| `server/services/accountService.js` | Reads accounts, positions, orders, trades. Dev fallback data. |
| `server/services/session.service.js` | Writes/reads sessions table directly (not via repository). |
| `server/services/sso.service.js` | Reads users, accounts. Creates sessions. |
| `server/services/auth.service.js` | JWT only — no direct DB access. |
| `server/cron/dailyChecks.js` | Reads accounts (active/locked). Triggers challengeService + riskEngine. |

### Configuration
| File | Purpose |
|------|---------|
| `server/.env.example` | SUPABASE_URL, SUPABASE_SERVICE_KEY |
| `.env.example` | Frontend — no Supabase keys (correct) |
| `server/package.json` | @supabase/supabase-js ^2.108.2 |

---

## 5. RECOMMENDATIONS (MIGRATION 004)

### Priority 1 — Critical (do before production)

```sql
-- 004_foundation_hardening.sql

-- 1. Audit log table (immutable)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    user_id UUID REFERENCES users(id),
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_account_time ON audit_log(account_id, created_at DESC);
CREATE INDEX idx_audit_event_type ON audit_log(event_type, created_at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- 2. Broker sessions table
CREATE TABLE broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    broker_provider TEXT NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, broker_provider)
);
ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;

-- 3. Missing performance indexes
CREATE INDEX idx_challenges_user_status ON challenges(user_id, status);
CREATE INDEX idx_orders_broker_id ON orders(broker_order_id) WHERE broker_order_id IS NOT NULL;
CREATE INDEX idx_sessions_user_active ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_risk_rules_account_active ON risk_rules(account_id) WHERE is_active = TRUE;

-- 4. Tighten FK constraints (prevent orphans)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_account_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_account_id_fkey;
ALTER TABLE trades ADD CONSTRAINT trades_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_account_id_fkey;
ALTER TABLE positions ADD CONSTRAINT positions_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE account_metrics DROP CONSTRAINT IF EXISTS account_metrics_account_id_fkey;
ALTER TABLE account_metrics ADD CONSTRAINT account_metrics_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
```

### Priority 2 — Important (before scaling)

```sql
-- 5. Margin columns on accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS available_margin NUMERIC(15,2);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS used_margin NUMERIC(15,2) DEFAULT 0;

-- 6. Lot size on orders/positions for accurate risk calc
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lot_size INTEGER DEFAULT 1;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS lot_size INTEGER DEFAULT 1;

-- 7. Payouts table
CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    notes TEXT
);
CREATE INDEX idx_payouts_user ON payouts(user_id, status);
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- 8. Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 9. Session heartbeat
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
```

### Priority 3 — Nice to have

```sql
-- 10. Instruments cache (optional — only if you want persistent symbol master)
CREATE TABLE instruments_cache (
    token TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT,
    exchange TEXT NOT NULL,
    segment TEXT NOT NULL,
    lot_size INTEGER DEFAULT 1,
    tick_size NUMERIC(8,4),
    expiry DATE,
    strike NUMERIC(12,2),
    option_type TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_instruments_symbol ON instruments_cache(symbol);
CREATE INDEX idx_instruments_segment ON instruments_cache(exchange, segment);

-- 11. Trade P&L column (denormalized for fast reporting)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS pnl NUMERIC(12,2);
```

---

## 6. SUMMARY

| Category | Current State | Gaps |
|----------|--------------|------|
| **Tables** | 10 defined, all verified | 5 missing (audit_log, broker_sessions, payouts, notifications, instruments_cache) |
| **Indexes** | 9 defined | 6 missing (performance-critical query paths) |
| **Foreign Keys** | All present | 4 need tightened ON DELETE behavior (RESTRICT vs NO ACTION) |
| **RLS Policies** | 11 SELECT/INSERT policies | 8 missing write policies (defense-in-depth) |
| **Triggers** | 4 updated_at triggers | Need triggers on broker_sessions, audit_log |
| **Columns** | Schema complete + 3 migrations | 8 columns missing for production readiness |

### Overall Assessment

The schema foundation is **solid and well-structured**. The relationship chain `User → Challenge → Account → Rules → Terminal` is correctly implemented with proper FK cascades on the user deletion path. The repository pattern is clean and consistent.

**Critical gaps** are:
1. No audit trail for compliance (account state changes not logged)
2. No broker session persistence (token refresh will fail on server restart)
3. Missing performance indexes on hot query paths (daily P&L recalculation on every trade)

**No UI, frontend, chart, market data, or broker code was touched.**

---

*End of report.*
