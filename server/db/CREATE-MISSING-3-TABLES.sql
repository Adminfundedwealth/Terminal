-- ══════════════════════════════════════════════════════════════
-- CREATE 3 MISSING TABLES
-- Run in Supabase SQL Editor (one-time, safe, no conflicts)
-- These tables don't exist anywhere — no risk of collision.
-- ══════════════════════════════════════════════════════════════

-- 1. WATCHLISTS (user stock watchlists)
CREATE TABLE IF NOT EXISTS watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id);

-- 2. ACCOUNT METRICS (daily P&L snapshots)
CREATE TABLE IF NOT EXISTS account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_account_metrics_account_date ON account_metrics(account_id, date DESC);

-- 3. BROKER SESSIONS (broker connection tracking)
CREATE TABLE IF NOT EXISTS broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    client_id TEXT,
    status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'expired', 'failed')),
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    feed_token TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_sessions_account ON broker_sessions(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_sessions_active ON broker_sessions(account_id, provider) WHERE status = 'connected';

-- RLS (service role bypasses automatically)
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;

-- Done. All 3 tables now match what the code expects.
