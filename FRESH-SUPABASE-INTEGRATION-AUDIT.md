# FRESH SUPABASE INTEGRATION AUDIT

**Date:** 2026-06-20  
**Context:** Old production trading tables removed. Fresh integration plan.  
**Constraint:** Do NOT reuse old table names (`trading_accounts`, `challenge_accounts`, `positions`, `executions`).  
**Output:** Report only. No code changes.

---

## 1. CURRENT PRODUCTION STATE

Tables that EXIST right now in your Supabase instance:

| Table | Rows | Purpose | Keep? |
|---|---|---|---|
| `users` | 20 | Platform users (clerk_id, kyc, affiliate, bank) | ✅ YES — platform root |
| `orders` | 17 | Payment/plan orders (NOT trading) | ✅ YES — payments |
| `sessions` | 3 | Platform auth sessions (MFA, device, fingerprint) | ✅ YES — auth |

**Everything else does not exist.** The terminal needs NEW tables built fresh.

---

## 2. REQUIRED TABLES (Fresh Schema)

Based on complete audit of terminal server code (repositories, services, routes, middleware, events, cron):

### Category A: Auth & User Context (3 tables)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 1 | `terminal_users` | Terminal user mapping (links to platform `users.id`) | `platform_user_id` → `users.id` |
| 2 | `terminal_sessions` | Terminal session tokens (SSO-issued) | `user_id` → `terminal_users.id` |
| 3 | `terminal_accounts` | Trading account context (balance, status, broker) | `user_id` → `terminal_users.id`, `challenge_id` → `challenges.id` |

### Category B: Challenge & Rules (3 tables)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 4 | `challenges` | Challenge lifecycle (evaluation/funded, phase tracking) | `user_id` → `terminal_users.id` |
| 5 | `risk_rules` | Per-account trading rules (drawdown, daily loss, segments) | `account_id` → `terminal_accounts.id` |
| 6 | `account_metrics` | Daily balance snapshots, drawdown tracking | `account_id` → `terminal_accounts.id` |

### Category C: Order Execution (3 tables)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 7 | `terminal_orders` | Order placement and status tracking | `account_id` → `terminal_accounts.id` |
| 8 | `terminal_positions` | Open/closed positions with P&L | `account_id` → `terminal_accounts.id` |
| 9 | `terminal_trades` | Immutable execution/fill records | `account_id` → `terminal_accounts.id`, `order_id` → `terminal_orders.id` |

### Category D: User Features (1 table)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 10 | `watchlists` | User watchlists with items (JSONB) | `user_id` → `terminal_users.id` |

### Category E: Audit & Persistence (4 tables)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 11 | `audit_log` | Immutable event log (locks, breaches, payouts) | `account_id` → `terminal_accounts.id` (nullable) |
| 12 | `risk_events` | Risk check pass/fail/violation log | `account_id` → `terminal_accounts.id` |
| 13 | `challenge_metrics` | Challenge progression events, daily snapshots | `challenge_id` → `challenges.id`, `account_id` → `terminal_accounts.id` |
| 14 | `order_audit` | Full order/position lifecycle trail | `order_id` → `terminal_orders.id`, `account_id` → `terminal_accounts.id` |

### Category F: Broker Infrastructure (1 table)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 15 | `broker_sessions` | Encrypted broker API token persistence | `account_id` → `terminal_accounts.id` |

### Category G: Payouts (1 table)

| # | New Table Name | Purpose | FK References |
|---|---|---|---|
| 16 | `payouts` | Payout requests and lifecycle | `account_id` → `terminal_accounts.id`, `user_id` → `terminal_users.id`, `challenge_id` → `challenges.id` |

**Total: 16 new tables**

---

## 3. REQUIRED ENVIRONMENT VARIABLES

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | **YES** | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **YES** | Service role key (bypasses RLS) |
| `JWT_SECRET` | **YES** | Terminal session JWT signing (256-bit) |
| `SSO_SHARED_SECRET` | **YES** | Shared with FW Dashboard for SSO token exchange |
| `FW_DASHBOARD_URL` | YES | Redirect URL on auth failure (`https://fundedwealth.com`) |
| `PORT` | No | Default: `4000` |
| `NODE_ENV` | No | `development` / `production` |
| `JWT_EXPIRY` | No | Default: `24h` |
| `ADMIN_SECRET` | No | Admin/cron endpoint authentication |
| `DEV_BYPASS_AUTH` | Dev only | Set `true` to skip auth in development |
| `REDIS_URL` | No | Optional multi-instance pub/sub |
| `FRONTEND_URL` | No | CORS origin, default `http://localhost:3000` |
| `ANGEL_API_KEY` | No* | Angel One broker API key |
| `ANGEL_CLIENT_ID` | No* | Angel One client ID |
| `ANGEL_PASSWORD` | No* | Angel One password |
| `ANGEL_TOTP_SECRET` | No* | Angel One TOTP generator secret |

*Required for live broker connection/trading.

---

## 4. FULL DATABASE SCHEMA (Migration SQL)

```sql
-- ══════════════════════════════════════════════════════════════════
-- FUNDEDWEALTH TERMINAL — FRESH DATABASE SCHEMA
-- Date: 2026-06-20
-- Target: Supabase (PostgreSQL)
-- 
-- Prerequisites: 
--   Existing tables preserved: users, orders, sessions
--   All new tables use clean names (no collision with platform)
-- ══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A. AUTH & USER CONTEXT
-- ─────────────────────────────────────────────────────────────────

-- Terminal Users — maps platform user to terminal context
CREATE TABLE terminal_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_terminal_users_platform ON terminal_users(platform_user_id);
CREATE INDEX idx_terminal_users_fw ON terminal_users(fw_user_id);

-- Terminal Sessions — SSO-issued session tokens
CREATE TABLE terminal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    account_id UUID,
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_terminal_sessions_token ON terminal_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_terminal_sessions_user ON terminal_sessions(user_id);

-- ─────────────────────────────────────────────────────────────────
-- B. CHALLENGES
-- ─────────────────────────────────────────────────────────────────

-- Challenge lifecycle (evaluation phases → funded)
CREATE TABLE challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('evaluation', 'funded')),
    plan TEXT NOT NULL,
    phase TEXT CHECK (phase IN ('phase_1', 'phase_2', 'funded')),
    initial_balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'expired')),
    min_trading_days INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT,
    previous_challenge_id UUID REFERENCES challenges(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_challenges_user ON challenges(user_id);
CREATE INDEX idx_challenges_status ON challenges(status) WHERE status = 'active';
CREATE INDEX idx_challenges_prev ON challenges(previous_challenge_id);

-- ─────────────────────────────────────────────────────────────────
-- C. TRADING ACCOUNTS
-- ─────────────────────────────────────────────────────────────────

-- Terminal Accounts (one per challenge)
CREATE TABLE terminal_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    account_code TEXT UNIQUE NOT NULL,
    challenge_id UUID NOT NULL REFERENCES challenges(id),
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    broker_client_id TEXT,
    balance NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2),
    payout_eligible BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_accounts_user ON terminal_accounts(user_id);
CREATE INDEX idx_terminal_accounts_challenge ON terminal_accounts(challenge_id);
CREATE INDEX idx_terminal_accounts_status ON terminal_accounts(status) WHERE status IN ('active', 'locked');

-- ─────────────────────────────────────────────────────────────────
-- D. RISK RULES & METRICS
-- ─────────────────────────────────────────────────────────────────

-- Risk Rules (per account)
CREATE TABLE risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

CREATE INDEX idx_risk_rules_account ON risk_rules(account_id) WHERE is_active = TRUE;

-- Account Metrics (daily snapshots)
CREATE TABLE account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    starting_balance NUMERIC(15,2) NOT NULL,
    ending_balance NUMERIC(15,2) NOT NULL,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    unrealized_pnl NUMERIC(12,2) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    max_drawdown NUMERIC(12,2) DEFAULT 0,
    daily_loss NUMERIC(12,2) DEFAULT 0,
    peak_balance NUMERIC(15,2),
    UNIQUE(account_id, date)
);

CREATE INDEX idx_account_metrics_account_date ON account_metrics(account_id, date DESC);

-- ─────────────────────────────────────────────────────────────────
-- E. ORDER EXECUTION
-- ─────────────────────────────────────────────────────────────────

-- Trading Orders
CREATE TABLE terminal_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'SL', 'SL-M')),
    product_type TEXT NOT NULL CHECK (product_type IN ('MIS', 'CNC', 'NRML', 'BO', 'CO')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2),
    trigger_price NUMERIC(12,2),
    filled_qty INTEGER DEFAULT 0,
    avg_price NUMERIC(12,2),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'REJECTED')),
    reject_reason TEXT,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_orders_account_time ON terminal_orders(account_id, placed_at DESC);
CREATE INDEX idx_terminal_orders_status ON terminal_orders(account_id, status) WHERE status IN ('PENDING', 'OPEN');

-- Positions
CREATE TABLE terminal_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    product_type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_terminal_positions_open
    ON terminal_positions(account_id, token, product_type)
    WHERE closed_at IS NULL;
CREATE INDEX idx_terminal_positions_account ON terminal_positions(account_id) WHERE closed_at IS NULL;

-- Trades (execution fills — immutable)
CREATE TABLE terminal_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    order_id UUID REFERENCES terminal_orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_trades_account_time ON terminal_trades(account_id, executed_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- F. USER FEATURES
-- ─────────────────────────────────────────────────────────────────

-- Watchlists
CREATE TABLE watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_watchlists_user ON watchlists(user_id);

-- ─────────────────────────────────────────────────────────────────
-- G. AUDIT & PERSISTENCE
-- ─────────────────────────────────────────────────────────────────

-- Audit Log (immutable)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID,
    user_id UUID,
    event_type TEXT NOT NULL,
    event_data JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_account ON audit_log(account_id, created_at DESC);
CREATE INDEX idx_audit_log_type ON audit_log(event_type);

-- Risk Events
CREATE TABLE risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'check_passed', 'check_failed', 'violation', 'breach', 'warning',
        'account_locked', 'daily_loss_limit', 'max_drawdown', 'position_limit',
        'lot_size_exceeded', 'margin_insufficient', 'segment_blocked',
        'trading_hours', 'overnight_block', 'instrument_blocked', 'manual_lock'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'fatal')),
    rule_type TEXT,
    rule_value JSONB,
    actual_value JSONB,
    order_id UUID,
    description TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_events_account ON risk_events(account_id, created_at DESC);
CREATE INDEX idx_risk_events_unresolved ON risk_events(account_id) WHERE resolved = FALSE;
CREATE INDEX idx_risk_events_severity ON risk_events(severity) WHERE severity IN ('critical', 'fatal');

-- Challenge Metrics (progression events)
CREATE TABLE challenge_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'challenge_started', 'challenge_updated', 'challenge_passed',
        'challenge_failed', 'challenge_expired', 'daily_target_hit',
        'profit_target_reached', 'drawdown_warning', 'drawdown_breach',
        'balance_snapshot', 'trading_day_complete', 'milestone_reached'
    )),
    balance_before NUMERIC(15,2),
    balance_after NUMERIC(15,2),
    pnl NUMERIC(12,2),
    pnl_percent NUMERIC(8,4),
    drawdown NUMERIC(12,2),
    drawdown_percent NUMERIC(8,4),
    peak_balance NUMERIC(15,2),
    trading_days_elapsed INTEGER,
    total_trades INTEGER,
    win_rate NUMERIC(5,2),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_challenge_metrics_challenge ON challenge_metrics(challenge_id, created_at DESC);
CREATE INDEX idx_challenge_metrics_account ON challenge_metrics(account_id, created_at DESC);

-- Order Audit (immutable lifecycle trail)
CREATE TABLE order_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES terminal_orders(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'order_created', 'order_submitted', 'order_accepted', 'order_open',
        'order_partially_filled', 'order_filled', 'order_modified',
        'order_cancelled', 'order_rejected', 'order_expired',
        'position_opened', 'position_updated', 'position_closed', 'position_reversed'
    )),
    previous_status TEXT,
    new_status TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    side TEXT CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER,
    price NUMERIC(12,2),
    filled_qty INTEGER,
    avg_price NUMERIC(12,2),
    broker_order_id TEXT,
    broker_provider TEXT,
    reject_reason TEXT,
    latency_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_audit_order ON order_audit(order_id, created_at ASC);
CREATE INDEX idx_order_audit_account ON order_audit(account_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- H. BROKER INFRASTRUCTURE
-- ─────────────────────────────────────────────────────────────────

-- Broker Sessions (encrypted token persistence)
CREATE TABLE broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    client_id TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_broker_sessions_account_provider ON broker_sessions(account_id, broker_provider);

-- ─────────────────────────────────────────────────────────────────
-- I. PAYOUTS
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    user_id UUID NOT NULL REFERENCES terminal_users(id),
    challenge_id UUID NOT NULL REFERENCES challenges(id),
    net_profit NUMERIC(15,2) NOT NULL,
    payout_amount NUMERIC(15,2) NOT NULL,
    firm_amount NUMERIC(15,2) NOT NULL,
    trader_split NUMERIC(4,3) NOT NULL DEFAULT 0.800,
    plan TEXT NOT NULL,
    trading_days INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rejected_reason TEXT
);

CREATE INDEX idx_payouts_account ON payouts(account_id);
CREATE INDEX idx_payouts_status ON payouts(status) WHERE status IN ('pending', 'processing');

-- ─────────────────────────────────────────────────────────────────
-- J. TRIGGERS
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_terminal_users_updated_at
    BEFORE UPDATE ON terminal_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_terminal_accounts_updated_at
    BEFORE UPDATE ON terminal_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_terminal_orders_updated_at
    BEFORE UPDATE ON terminal_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_watchlists_updated_at
    BEFORE UPDATE ON watchlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- K. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE terminal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Service role (used by backend) bypasses RLS automatically.
-- No client-side RLS policies needed — all access is via service key.
```

---

## 5. CODE → TABLE MAPPING (What repositories need to change)

The existing code references OLD table names. Here's the mapping for the code update pass:

| Repository / Service | Old Table Name | New Table Name |
|---|---|---|
| `user.repository.js` | `users` | `terminal_users` |
| `account.repository.js` | `trading_accounts` | `terminal_accounts` |
| `challenge.repository.js` | `challenge_accounts` | `challenges` |
| `risk-rules.repository.js` | `challenge_rules` | `risk_rules` |
| `order.repository.js` | `trading_orders` | `terminal_orders` |
| `position.repository.js` | `positions` | `terminal_positions` |
| `trade.repository.js` | `executions` | `terminal_trades` |
| `watchlist.repository.js` | `watchlists` | `watchlists` (unchanged) |
| `metrics.repository.js` | `account_metrics` | `account_metrics` (unchanged) |
| `audit.repository.js` | `audit_log` | `audit_log` (unchanged) |
| `risk-event.repository.js` | `risk_events` | `risk_events` (unchanged) |
| `challenge-metrics.repository.js` | `challenge_metrics` | `challenge_metrics` (unchanged) |
| `order-audit.repository.js` | `order_audit` | `order_audit` (unchanged) |
| `broker-session.repository.js` | `broker_sessions` | `broker_sessions` (unchanged) |
| `session.service.js` | `sessions` | `terminal_sessions` |
| `sso.service.js` | `users` + `trading_accounts` | `terminal_users` + `terminal_accounts` |
| `accountService.js` | direct `.from(...)` calls | Update all 5 table refs |
| `dailyChecks.js` | `trading_accounts` | `terminal_accounts` |

---

## 6. MIGRATION EXECUTION ORDER

Run in this sequence (respects FK dependencies):

```
Phase 1: terminal_users         (references: users)
Phase 2: challenges             (references: terminal_users)
Phase 3: terminal_accounts      (references: terminal_users, challenges)
Phase 4: terminal_sessions      (references: terminal_users)
         risk_rules             (references: terminal_accounts)
         account_metrics        (references: terminal_accounts)
         terminal_orders        (references: terminal_accounts)
         terminal_positions     (references: terminal_accounts)
         watchlists             (references: terminal_users)
         audit_log              (no FK constraints)
         broker_sessions        (references: terminal_accounts)
Phase 5: terminal_trades        (references: terminal_accounts, terminal_orders)
         risk_events            (references: terminal_accounts)
         challenge_metrics      (references: challenges, terminal_accounts)
         order_audit            (references: terminal_orders, terminal_accounts)
         payouts                (references: terminal_accounts, terminal_users, challenges)
Phase 6: Triggers + RLS
```

---

## 7. RELATIONSHIP TO EXISTING PLATFORM TABLES

```
PLATFORM (existing, DO NOT TOUCH)          TERMINAL (new)
═══════════════════════════                 ════════════════════
users (20 rows)                            terminal_users
  └─ id ◄─────────────────────────────── platform_user_id
                                             ├── terminal_sessions
orders (17 rows) — payments                  ├── terminal_accounts
  (NO relationship to terminal)              │     ├── risk_rules
                                             │     ├── account_metrics
sessions (3 rows) — platform auth            │     ├── terminal_orders
  (NO relationship to terminal)              │     │     ├── terminal_trades
                                             │     │     └── order_audit
                                             │     ├── terminal_positions
                                             │     ├── risk_events
                                             │     ├── broker_sessions
                                             │     └── challenge_metrics
                                             ├── challenges
                                             │     ├── terminal_accounts
                                             │     ├── challenge_metrics
                                             │     └── payouts
                                             └── watchlists
```

The ONLY bridge between platform and terminal is:  
`terminal_users.platform_user_id` → `users.id`

---

## 8. NOTES & DECISIONS

1. **`terminal_sessions` vs platform `sessions`:** The platform already has a `sessions` table with its own schema (MFA, device fingerprint). The terminal creates a SEPARATE `terminal_sessions` table for its SSO-issued JWTs. These do not conflict.

2. **`terminal_users` vs platform `users`:** The platform `users` table uses `clerk_id` auth. The terminal maps to it via `platform_user_id` FK. The terminal stores its own `fw_user_id` reference for quick lookup without querying Clerk.

3. **`orders` (platform) vs `terminal_orders`:** Platform `orders` = payment records. Terminal `terminal_orders` = trading order execution. Completely separate.

4. **Immutable tables:** `audit_log`, `risk_events`, `terminal_trades`, `order_audit` — never update or delete rows. Application code should enforce this.

5. **Bug to fix:** `payoutService.js` queries `audit_logs` (plural) but the table is `audit_log` (singular). Fix during code update pass.

---

*End of audit. No code changes. No migrations executed. No deployment.*
