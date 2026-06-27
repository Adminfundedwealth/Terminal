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
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenges (prop firm evaluation/funded accounts)
CREATE TABLE IF NOT EXISTS t_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('evaluation', 'funded')),
    plan TEXT NOT NULL,
    initial_balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'expired')),
    min_trading_days INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT
);

-- Trading Accounts (one per challenge)
CREATE TABLE IF NOT EXISTS t_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    account_code TEXT UNIQUE NOT NULL,
    challenge_id UUID NOT NULL REFERENCES t_challenges(id),
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    broker_client_id TEXT,
    broker_credentials_encrypted TEXT,
    balance NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2),
    payout_eligible BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Risk Rules (per account)
CREATE TABLE IF NOT EXISTS t_risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

-- Trading Orders
CREATE TABLE IF NOT EXISTS t_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
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

-- Positions
CREATE TABLE IF NOT EXISTS t_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
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

-- Partial unique index for open positions
CREATE UNIQUE INDEX IF NOT EXISTS idx_t_unique_open_position 
  ON t_positions (account_id, token, product_type) 
  WHERE closed_at IS NULL;

-- Trades (execution log — immutable)
CREATE TABLE IF NOT EXISTS t_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    order_id UUID REFERENCES t_orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlists (per user)
CREATE TABLE IF NOT EXISTS t_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Account Metrics (daily snapshot)
CREATE TABLE IF NOT EXISTS t_account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
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

-- Sessions (terminal sessions)
CREATE TABLE IF NOT EXISTS t_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES t_accounts(id),
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_t_accounts_user ON t_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_t_accounts_challenge ON t_accounts(challenge_id);
CREATE INDEX IF NOT EXISTS idx_t_orders_account_time ON t_orders(account_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_t_orders_status ON t_orders(account_id, status) WHERE status IN ('PENDING', 'OPEN');
CREATE INDEX IF NOT EXISTS idx_t_positions_open ON t_positions(account_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_t_trades_account_time ON t_trades(account_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_t_metrics_account_date ON t_account_metrics(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_t_sessions_token ON t_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_t_watchlists_user ON t_watchlists(user_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_t_users_updated_at ON t_users;
CREATE TRIGGER update_t_users_updated_at BEFORE UPDATE ON t_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_t_accounts_updated_at ON t_accounts;
CREATE TRIGGER update_t_accounts_updated_at BEFORE UPDATE ON t_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_t_orders_updated_at ON t_orders;
CREATE TRIGGER update_t_orders_updated_at BEFORE UPDATE ON t_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_t_watchlists_updated_at ON t_watchlists;
CREATE TRIGGER update_t_watchlists_updated_at BEFORE UPDATE ON t_watchlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE t_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_sessions ENABLE ROW LEVEL SECURITY;
