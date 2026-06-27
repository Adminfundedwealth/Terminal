-- ============================================================
-- FUNDEDWEALTH TERMINAL — MASTER SCHEMA (Terminal-Owned Tables)
-- Target: Shared Supabase project (same as FW Website)
-- Date: 2026-06-24
-- 
-- IMPORTANT: This creates ONLY terminal-owned tables.
-- Does NOT touch website tables (users, orders, sessions, etc.)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. terminal_traders
-- Terminal-specific user identity (linked to website user via external_id)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terminal_traders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,          -- FK to website users.id or clerk_id
    email TEXT NOT NULL,
    display_name TEXT,
    phone TEXT,
    plan TEXT,                                  -- current plan if relevant
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    preferences JSONB DEFAULT '{}',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terminal_traders_external ON terminal_traders(external_id);
CREATE INDEX IF NOT EXISTS idx_terminal_traders_email ON terminal_traders(email);

-- ────────────────────────────────────────────────────────────
-- 2. terminal_sessions
-- Terminal session tracking (JWT-based)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terminal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    refresh_token_hash TEXT,
    device_fingerprint TEXT,
    ip_address TEXT,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_token ON terminal_sessions(token_hash) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_trader ON terminal_sessions(trader_id) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────
-- 3. challenge_accounts
-- Prop firm challenge lifecycle (evaluation → funded)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('evaluation', 'evaluation_phase1', 'evaluation_phase2', 'funded')),
    plan TEXT NOT NULL,
    phase TEXT,                                 -- 'phase_1', 'phase_2', 'funded'
    initial_balance NUMERIC(15,2) NOT NULL,
    current_balance NUMERIC(15,2),
    peak_balance NUMERIC(15,2),
    profit_target_pct NUMERIC(5,2),
    daily_loss_limit_pct NUMERIC(5,2),
    max_drawdown_pct NUMERIC(5,2),
    min_trading_days INTEGER,
    max_calendar_days INTEGER,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'breached', 'expired', 'locked')),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT,
    previous_challenge_id UUID REFERENCES challenge_accounts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_accounts_trader ON challenge_accounts(trader_id);
CREATE INDEX IF NOT EXISTS idx_challenge_accounts_status ON challenge_accounts(status) WHERE status = 'active';

-- ────────────────────────────────────────────────────────────
-- 4. trading_accounts
-- Actual trading accounts (one per challenge phase)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trading_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    challenge_id UUID REFERENCES challenge_accounts(id),
    account_code TEXT UNIQUE NOT NULL,
    broker_provider TEXT NOT NULL DEFAULT 'paper',
    broker_client_id TEXT,
    broker_credentials_encrypted TEXT,
    balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    peak_balance NUMERIC(15,2) DEFAULT 0,
    available_margin NUMERIC(15,2) DEFAULT 0,
    used_margin NUMERIC(15,2) DEFAULT 0,
    payout_eligible BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    locked_at TIMESTAMPTZ,
    unlocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_accounts_trader ON trading_accounts(trader_id);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_challenge ON trading_accounts(challenge_id);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_code ON trading_accounts(account_code);

-- ────────────────────────────────────────────────────────────
-- 5. risk_rules
-- Per-account risk configuration
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trading_account_id, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_risk_rules_account ON risk_rules(trading_account_id) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────
-- 6. provisioning_logs
-- Account provisioning audit trail
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provisioning_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID REFERENCES terminal_traders(id),
    trading_account_id UUID REFERENCES trading_accounts(id),
    challenge_account_id UUID REFERENCES challenge_accounts(id),
    order_id TEXT,                              -- website order reference
    plan TEXT,
    payment_method TEXT,
    payment_ref TEXT,
    source TEXT CHECK (source IN ('website', 'admin')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provisioning_logs_order ON provisioning_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_trader ON provisioning_logs(trader_id);

-- ────────────────────────────────────────────────────────────
-- 7. trading_orders
-- Order lifecycle tracking
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trading_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT,
    segment TEXT,
    instrument_type TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type TEXT NOT NULL,
    product_type TEXT DEFAULT 'MIS',
    validity TEXT DEFAULT 'DAY',
    qty INTEGER NOT NULL,
    price NUMERIC(12,2),
    trigger_price NUMERIC(12,2),
    target_price NUMERIC(12,2),
    stoploss_price NUMERIC(12,2),
    trailing_sl NUMERIC(12,2),
    filled_qty INTEGER DEFAULT 0,
    pending_qty INTEGER,
    avg_fill_price NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'PENDING',
    reject_reason TEXT,
    parent_order_id UUID REFERENCES trading_orders(id),
    order_group_id UUID,
    order_group_type TEXT,
    is_amo BOOLEAN DEFAULT FALSE,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_orders_account_time ON trading_orders(trading_account_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_orders_status ON trading_orders(trading_account_id, status) WHERE status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED');
CREATE INDEX IF NOT EXISTS idx_trading_orders_group ON trading_orders(order_group_id) WHERE order_group_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 8. positions
-- Open and closed position tracking
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT,
    instrument_type TEXT,
    product_type TEXT NOT NULL DEFAULT 'MIS',
    side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
    qty INTEGER NOT NULL DEFAULT 0,
    avg_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    buy_qty INTEGER DEFAULT 0,
    sell_qty INTEGER DEFAULT 0,
    buy_avg NUMERIC(12,2) DEFAULT 0,
    sell_avg NUMERIC(12,2) DEFAULT 0,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    is_open BOOLEAN DEFAULT TRUE,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_account_open ON positions(trading_account_id) WHERE is_open = TRUE;
CREATE INDEX IF NOT EXISTS idx_positions_token ON positions(trading_account_id, token, product_type) WHERE is_open = TRUE;

-- ────────────────────────────────────────────────────────────
-- 9. executions
-- Immutable trade fill records
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    order_id UUID REFERENCES trading_orders(id),
    position_id UUID REFERENCES positions(id),
    broker_trade_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    exchange_timestamp TIMESTAMPTZ,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executions_account_time ON executions(trading_account_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_order ON executions(order_id);

-- ────────────────────────────────────────────────────────────
-- 10. execution_audits
-- Immutable pre/post trade risk audit log
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS execution_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    order_id UUID REFERENCES trading_orders(id),
    execution_id UUID REFERENCES executions(id),
    audit_type TEXT NOT NULL DEFAULT 'pre_trade',
    checks_run JSONB DEFAULT '[]',
    all_passed BOOLEAN DEFAULT TRUE,
    rejection_reason TEXT,
    balance_before NUMERIC(15,2),
    balance_after NUMERIC(15,2),
    margin_before NUMERIC(15,2),
    margin_after NUMERIC(15,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_audits_account ON execution_audits(trading_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_audits_order ON execution_audits(order_id);

-- ────────────────────────────────────────────────────────────
-- 11. watchlists
-- User watchlist persistence
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    icon TEXT DEFAULT 'list',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlists_trader ON watchlists(trader_id);

-- ────────────────────────────────────────────────────────────
-- 12. account_metrics
-- Daily account performance snapshots
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    challenge_id UUID REFERENCES challenge_accounts(id),
    date DATE NOT NULL,
    starting_balance NUMERIC(15,2),
    ending_balance NUMERIC(15,2),
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    unrealized_pnl NUMERIC(12,2) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    gross_profit NUMERIC(12,2) DEFAULT 0,
    gross_loss NUMERIC(12,2) DEFAULT 0,
    max_drawdown NUMERIC(12,2) DEFAULT 0,
    daily_loss NUMERIC(12,2) DEFAULT 0,
    peak_balance NUMERIC(15,2),
    avg_win NUMERIC(12,2),
    avg_loss NUMERIC(12,2),
    largest_win NUMERIC(12,2),
    largest_loss NUMERIC(12,2),
    profit_factor NUMERIC(8,4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trading_account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_account_metrics_account_date ON account_metrics(trading_account_id, date DESC);

-- ────────────────────────────────────────────────────────────
-- 13. journal_entries
-- Trade journal persistence
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    trading_account_id UUID REFERENCES trading_accounts(id),
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    symbol TEXT,
    side TEXT,
    entry_price NUMERIC(12,2),
    exit_price NUMERIC(12,2),
    qty INTEGER,
    pnl NUMERIC(12,2),
    setup_type TEXT,
    emotion TEXT DEFAULT 'neutral',
    rating INTEGER DEFAULT 3,
    trade_phase TEXT DEFAULT 'after',
    notes TEXT DEFAULT '',
    lessons TEXT,
    mistakes JSONB,
    tags JSONB DEFAULT '[]',
    screenshot_urls JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_trader ON journal_entries(trader_id, entry_date DESC);

-- ────────────────────────────────────────────────────────────
-- 14. layouts
-- Workspace layout persistence
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Default',
    layout_type TEXT DEFAULT 'default',
    panel_config JSONB DEFAULT '{}',
    chart_config JSONB DEFAULT '{}',
    sidebar_collapsed BOOLEAN DEFAULT FALSE,
    bottom_panel_height INTEGER DEFAULT 200,
    watchlist_width INTEGER DEFAULT 280,
    order_panel_width INTEGER DEFAULT 300,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layouts_trader ON layouts(trader_id);

-- ────────────────────────────────────────────────────────────
-- 15. themes
-- Custom theme persistence
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Custom',
    colors JSONB DEFAULT '{}',
    font_family TEXT DEFAULT 'Inter',
    font_size TEXT DEFAULT 'normal',
    chart_colors JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_themes_trader ON themes(trader_id);

-- ────────────────────────────────────────────────────────────
-- 16. broker_sessions
-- Broker auth state tracking
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    broker_provider TEXT NOT NULL,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    feed_token TEXT,
    session_expiry TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    last_heartbeat_at TIMESTAMPTZ,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_sessions_account ON broker_sessions(trading_account_id, broker_provider) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────
-- 17. risk_events
-- Risk event log (warnings, breaches, locks)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    challenge_id UUID REFERENCES challenge_accounts(id),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    rule_type TEXT,
    threshold_value NUMERIC(15,2),
    actual_value NUMERIC(15,2),
    metadata JSONB DEFAULT '{}',
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_events_account ON risk_events(trading_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_unack ON risk_events(trading_account_id) WHERE acknowledged = FALSE;

-- ────────────────────────────────────────────────────────────
-- 18. challenge_progress
-- Daily challenge progress tracking
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenge_accounts(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    date DATE NOT NULL,
    trading_day_number INTEGER DEFAULT 1,
    day_pnl NUMERIC(12,2) DEFAULT 0,
    cumulative_pnl NUMERIC(12,2) DEFAULT 0,
    balance_eod NUMERIC(15,2),
    peak_balance NUMERIC(15,2),
    drawdown_pct NUMERIC(8,4) DEFAULT 0,
    daily_loss_pct NUMERIC(8,4) DEFAULT 0,
    trades_today INTEGER DEFAULT 0,
    is_profitable_day BOOLEAN DEFAULT FALSE,
    is_trading_day BOOLEAN DEFAULT TRUE,
    breach_occurred BOOLEAN DEFAULT FALSE,
    breach_type TEXT,
    profit_target_met BOOLEAN DEFAULT FALSE,
    min_days_met BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(challenge_id, date)
);

CREATE INDEX IF NOT EXISTS idx_challenge_progress_challenge ON challenge_progress(challenge_id, date DESC);

-- ────────────────────────────────────────────────────────────
-- 19. alerts
-- User alerts / notifications
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    trading_account_id UUID REFERENCES trading_accounts(id),
    alert_type TEXT NOT NULL DEFAULT 'price',
    symbol TEXT,
    token TEXT,
    condition JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    is_triggered BOOLEAN DEFAULT FALSE,
    triggered_at TIMESTAMPTZ,
    notification_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_trader ON alerts(trader_id) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────
-- 20. kill_switch_logs
-- Kill switch audit trail
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kill_switch_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triggered_by UUID NOT NULL REFERENCES terminal_traders(id),
    scope TEXT NOT NULL DEFAULT 'account' CHECK (scope IN ('account', 'group', 'global')),
    target_account_ids UUID[] DEFAULT '{}',
    reason TEXT,
    orders_cancelled INTEGER DEFAULT 0,
    positions_closed INTEGER DEFAULT 0,
    total_pnl_realized NUMERIC(12,2),
    accounts_locked INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    status TEXT DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'partial', 'failed')),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 21. copy_trading_config
-- Master-slave / copy trading configuration
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copy_trading_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    slave_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    copy_mode TEXT NOT NULL DEFAULT 'mirror' CHECK (copy_mode IN ('mirror', 'proportional', 'fixed_lot')),
    copy_ratio NUMERIC(8,4) DEFAULT 1.0,
    fixed_lot_size INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(master_account_id, slave_account_id)
);

CREATE INDEX IF NOT EXISTS idx_copy_trading_master ON copy_trading_config(master_account_id) WHERE is_active = TRUE;

-- ────────────────────────────────────────────────────────────
-- ENABLE ROW LEVEL SECURITY (service role bypasses)
-- ────────────────────────────────────────────────────────────
ALTER TABLE terminal_traders ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_switch_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_trading_config ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- END OF TERMINAL SCHEMA
-- ============================================================
