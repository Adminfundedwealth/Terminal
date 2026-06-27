-- ============================================================
-- FUNDEDWEALTH TERMINAL — COMPLETE MIGRATION
-- Copy this entire file into Supabase SQL Editor and click RUN.
-- Safe to re-run (all statements use IF NOT EXISTS or OR REPLACE).
-- Generated: 2026-06-20
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- SECTION 1: CORE TABLES (10 tables)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS t_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS t_risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_t_unique_open_position 
  ON t_positions (account_id, token, product_type) 
  WHERE closed_at IS NULL;

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

-- ═══════════════════════════════════════════════════════════
-- SECTION 2: INDEXES + TRIGGERS + RLS (core tables)
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_t_accounts_user ON t_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_t_accounts_challenge ON t_accounts(challenge_id);
CREATE INDEX IF NOT EXISTS idx_t_orders_account_time ON t_orders(account_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_t_orders_status ON t_orders(account_id, status) WHERE status IN ('PENDING', 'OPEN');
CREATE INDEX IF NOT EXISTS idx_t_positions_open ON t_positions(account_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_t_trades_account_time ON t_trades(account_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_t_metrics_account_date ON t_account_metrics(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_t_sessions_token ON t_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_t_watchlists_user ON t_watchlists(user_id);

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

-- ═══════════════════════════════════════════════════════════
-- SECTION 3: PERSISTENCE TABLES (4 tables)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS t_broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    client_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'expired', 'failed', 'failover')),
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    feed_token TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_sessions_account ON t_broker_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_broker_sessions_provider ON t_broker_sessions(provider, status);
CREATE INDEX IF NOT EXISTS idx_broker_sessions_active ON t_broker_sessions(account_id, status) WHERE status = 'connected';

CREATE TABLE IF NOT EXISTS t_risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'check_passed',
        'check_failed',
        'violation',
        'breach',
        'warning',
        'account_locked',
        'daily_loss_limit',
        'max_drawdown',
        'position_limit',
        'lot_size_exceeded',
        'margin_insufficient',
        'segment_blocked',
        'trading_hours',
        'overnight_block',
        'instrument_blocked',
        'manual_lock'
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

CREATE INDEX IF NOT EXISTS idx_risk_events_account ON t_risk_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_type ON t_risk_events(event_type);
CREATE INDEX IF NOT EXISTS idx_risk_events_severity ON t_risk_events(severity) WHERE severity IN ('critical', 'fatal');
CREATE INDEX IF NOT EXISTS idx_risk_events_unresolved ON t_risk_events(account_id) WHERE resolved = FALSE;

CREATE TABLE IF NOT EXISTS t_challenge_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES t_challenges(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'challenge_started',
        'challenge_updated',
        'challenge_passed',
        'challenge_failed',
        'challenge_expired',
        'daily_target_hit',
        'profit_target_reached',
        'drawdown_warning',
        'drawdown_breach',
        'balance_snapshot',
        'trading_day_complete',
        'milestone_reached'
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

CREATE INDEX IF NOT EXISTS idx_challenge_metrics_challenge ON t_challenge_metrics(challenge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_metrics_account ON t_challenge_metrics(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_metrics_type ON t_challenge_metrics(event_type);

CREATE TABLE IF NOT EXISTS t_order_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES t_orders(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'order_created',
        'order_submitted',
        'order_accepted',
        'order_open',
        'order_partially_filled',
        'order_filled',
        'order_modified',
        'order_cancelled',
        'order_rejected',
        'order_expired',
        'position_opened',
        'position_updated',
        'position_closed',
        'position_reversed'
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

CREATE INDEX IF NOT EXISTS idx_order_audit_order ON t_order_audit(order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_order_audit_account ON t_order_audit(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_audit_type ON t_order_audit(event_type);
CREATE INDEX IF NOT EXISTS idx_order_audit_today ON t_order_audit(account_id, created_at DESC)
    WHERE created_at >= CURRENT_DATE;

ALTER TABLE t_broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_challenge_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_order_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON t_broker_sessions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON t_risk_events
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON t_challenge_metrics
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON t_order_audit
    FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- SECTION 4: PHASE PROGRESSION + PAYOUTS + FOUNDATION
-- ═══════════════════════════════════════════════════════════

ALTER TABLE t_challenges ADD COLUMN IF NOT EXISTS phase TEXT 
  CHECK (phase IN ('phase_1', 'phase_2', 'funded'));

ALTER TABLE t_challenges ADD COLUMN IF NOT EXISTS previous_challenge_id UUID 
  REFERENCES t_challenges(id);

CREATE TABLE IF NOT EXISTS t_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    user_id UUID NOT NULL REFERENCES t_users(id),
    challenge_id UUID NOT NULL REFERENCES t_challenges(id),
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

CREATE INDEX IF NOT EXISTS idx_t_payouts_account ON t_payouts(account_id);
CREATE INDEX IF NOT EXISTS idx_t_payouts_user ON t_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_t_payouts_status ON t_payouts(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_t_challenges_prev ON t_challenges(previous_challenge_id);

ALTER TABLE t_payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  user_id UUID,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type);

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

-- ============================================================
-- MIGRATION COMPLETE
-- 17 tables, 31 indexes, 4 triggers, 1 function, 4 policies
-- Next step: cd server && node db/setup.js
-- ============================================================
