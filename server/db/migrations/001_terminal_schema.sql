-- ============================================================
-- FUNDEDWEALTH TERMINAL — STANDALONE DATABASE SCHEMA
-- Migration 001: Complete terminal-owned schema
-- PostgreSQL (Supabase) — NO shared dependencies
-- ============================================================
-- This schema is fully terminal-owned.
-- No references to external website/admin databases.
-- Authentication is terminal-native via SSO token exchange.
-- ============================================================

-- ============================================================
-- MIGRATION ORDER:
-- 1. terminal_traders (identity, replaces shared 'users')
-- 2. terminal_sessions (auth, replaces shared 'sessions')
-- 3. challenge_accounts (prop firm lifecycle)
-- 4. trading_accounts (broker connection)
-- 5. broker_sessions (broker auth state)
-- 6. risk_rules (per-account rules)
-- 7. trading_orders (order lifecycle)
-- 8. positions (open/closed positions)
-- 9. executions (immutable fill log)
-- 10. execution_audits (pre/post trade risk audit)
-- 11. watchlists (user watchlists)
-- 12. account_metrics (daily snapshots)
-- 13. risk_events (risk engine log)
-- 14. challenge_progress (daily challenge tracking)
-- 15. alerts (price alerts)
-- 16. layouts (workspace/panel config)
-- 17. themes (user theme preferences)
-- 18. journal_entries (trade journal)
-- 19. analytics_snapshots (periodic analytics cache)
-- ============================================================


-- ============================================================
-- 1. TERMINAL TRADERS
-- Terminal-owned identity. Populated on first SSO login.
-- No dependency on external users table.
-- ============================================================
CREATE TABLE terminal_traders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,          -- FW Dashboard user ID (opaque reference)
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    plan TEXT,                                  -- current plan: '10k', '25k', '50k', '1l'
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    preferences JSONB DEFAULT '{}',            -- timezone, notifications, etc.
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 2. TERMINAL SESSIONS
-- Terminal-owned session management. No shared session table.
-- ============================================================
CREATE TABLE terminal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    refresh_token_hash TEXT,
    device_fingerprint TEXT,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT
);


-- ============================================================
-- 3. CHALLENGE ACCOUNTS
-- Prop firm evaluation/funded lifecycle.
-- ============================================================
CREATE TABLE challenge_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('evaluation_phase1', 'evaluation_phase2', 'funded')),
    plan TEXT NOT NULL,                         -- '10k', '25k', '50k', '1l'
    initial_balance NUMERIC(15,2) NOT NULL,
    current_balance NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2) NOT NULL,
    profit_target_pct NUMERIC(5,2) NOT NULL,   -- e.g. 10.00 = 10%
    daily_loss_limit_pct NUMERIC(5,2) NOT NULL, -- e.g. 5.00 = 5%
    max_drawdown_pct NUMERIC(5,2) NOT NULL,     -- e.g. 10.00 = 10%
    min_trading_days INTEGER NOT NULL DEFAULT 5,
    max_calendar_days INTEGER,                  -- NULL = no expiry
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'expired', 'suspended')),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT,
    promoted_from UUID REFERENCES challenge_accounts(id), -- links phase1→phase2→funded
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 4. TRADING ACCOUNTS
-- One per challenge. Links to broker.
-- ============================================================
CREATE TABLE trading_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES challenge_accounts(id) ON DELETE CASCADE,
    account_code TEXT UNIQUE NOT NULL,
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya', 'paper')),
    broker_client_id TEXT,
    broker_credentials_encrypted TEXT,
    balance NUMERIC(15,2) NOT NULL,
    available_margin NUMERIC(15,2) DEFAULT 0,
    used_margin NUMERIC(15,2) DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    locked_at TIMESTAMPTZ,
    unlocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 5. BROKER SESSIONS
-- Broker auth state (tokens, refresh, expiry).
-- ============================================================
CREATE TABLE broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    broker_provider TEXT NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    feed_token TEXT,
    session_expiry TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_heartbeat_at TIMESTAMPTZ,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trading_account_id, broker_provider)
);


-- ============================================================
-- 6. RISK RULES
-- Per-account configurable risk parameters.
-- ============================================================
CREATE TABLE risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    -- Types: daily_loss, max_drawdown, profit_target, max_positions,
    --        max_lot_size, allowed_segments, trading_hours, no_overnight,
    --        news_blackout, max_daily_trades, max_order_value
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trading_account_id, rule_type)
);


-- ============================================================
-- 7. TRADING ORDERS
-- Full order lifecycle.
-- ============================================================
CREATE TABLE trading_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    broker_order_id TEXT,
    parent_order_id UUID REFERENCES trading_orders(id), -- for bracket/OCO legs
    order_group_id UUID,                                -- groups bracket/OCO/basket orders
    order_group_type TEXT CHECK (order_group_type IN ('bracket', 'oco', 'basket', NULL)),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL CHECK (segment IN ('NSE', 'BSE', 'NFO', 'MCX', 'CDS', 'BFO')),
    instrument_type TEXT CHECK (instrument_type IN ('EQ', 'FUT', 'CE', 'PE')),
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'SL', 'SL-M')),
    product_type TEXT NOT NULL CHECK (product_type IN ('MIS', 'CNC', 'NRML', 'BO', 'CO')),
    validity TEXT DEFAULT 'DAY' CHECK (validity IN ('DAY', 'IOC', 'GTC', 'GTD')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2),
    trigger_price NUMERIC(12,2),
    target_price NUMERIC(12,2),              -- bracket order target
    stoploss_price NUMERIC(12,2),            -- bracket order SL
    trailing_sl NUMERIC(12,2),               -- trailing stop
    filled_qty INTEGER DEFAULT 0,
    pending_qty INTEGER,
    avg_fill_price NUMERIC(12,2),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'AMO_PENDING')),
    reject_reason TEXT,
    is_amo BOOLEAN DEFAULT FALSE,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 8. POSITIONS
-- Open and closed positions.
-- ============================================================
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    instrument_type TEXT,
    product_type TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    current_price NUMERIC(12,2),
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    unrealized_pnl NUMERIC(12,2) DEFAULT 0,
    buy_qty INTEGER DEFAULT 0,
    sell_qty INTEGER DEFAULT 0,
    buy_avg NUMERIC(12,2) DEFAULT 0,
    sell_avg NUMERIC(12,2) DEFAULT 0,
    margin_used NUMERIC(12,2) DEFAULT 0,
    is_open BOOLEAN DEFAULT TRUE,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_open_position UNIQUE(trading_account_id, token, product_type) WHERE (is_open = TRUE)
);


-- ============================================================
-- 9. EXECUTIONS (immutable trade fills)
-- ============================================================
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    order_id UUID REFERENCES trading_orders(id),
    position_id UUID REFERENCES positions(id),
    broker_trade_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    exchange_timestamp TIMESTAMPTZ,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 10. EXECUTION AUDITS (risk check log per trade)
-- ============================================================
CREATE TABLE execution_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    order_id UUID REFERENCES trading_orders(id),
    execution_id UUID REFERENCES executions(id),
    audit_type TEXT NOT NULL CHECK (audit_type IN ('pre_trade', 'post_trade', 'position_exit', 'risk_breach')),
    checks_run JSONB NOT NULL,                -- array of {rule, passed, value, limit}
    all_passed BOOLEAN NOT NULL,
    rejection_reason TEXT,
    balance_before NUMERIC(15,2),
    balance_after NUMERIC(15,2),
    margin_before NUMERIC(15,2),
    margin_after NUMERIC(15,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 11. WATCHLISTS
-- ============================================================
CREATE TABLE watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    icon TEXT DEFAULT 'list',
    items JSONB DEFAULT '[]',                  -- [{token, symbol, segment}]
    sort_order INTEGER DEFAULT 0,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 12. ACCOUNT METRICS (daily snapshots)
-- ============================================================
CREATE TABLE account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    challenge_id UUID REFERENCES challenge_accounts(id),
    date DATE NOT NULL,
    starting_balance NUMERIC(15,2) NOT NULL,
    ending_balance NUMERIC(15,2) NOT NULL,
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
    UNIQUE(trading_account_id, date)
);


-- ============================================================
-- 13. RISK EVENTS (risk engine audit log)
-- ============================================================
CREATE TABLE risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    challenge_id UUID REFERENCES challenge_accounts(id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'daily_loss_warning', 'daily_loss_breach',
        'drawdown_warning', 'drawdown_breach',
        'profit_target_reached',
        'position_limit_hit', 'lot_limit_hit',
        'segment_blocked', 'hours_blocked',
        'overnight_blocked', 'news_blackout',
        'trade_limit_hit', 'margin_insufficient',
        'account_locked', 'account_breached',
        'account_unlocked', 'manual_override'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    rule_type TEXT,
    threshold_value NUMERIC(12,2),
    actual_value NUMERIC(12,2),
    metadata JSONB DEFAULT '{}',
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 14. CHALLENGE PROGRESS (daily challenge state)
-- ============================================================
CREATE TABLE challenge_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenge_accounts(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    date DATE NOT NULL,
    trading_day_number INTEGER NOT NULL,
    day_pnl NUMERIC(12,2) DEFAULT 0,
    cumulative_pnl NUMERIC(12,2) DEFAULT 0,
    balance_eod NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2) NOT NULL,
    drawdown_pct NUMERIC(5,2) DEFAULT 0,
    daily_loss_pct NUMERIC(5,2) DEFAULT 0,
    trades_today INTEGER DEFAULT 0,
    is_profitable_day BOOLEAN DEFAULT FALSE,
    is_trading_day BOOLEAN DEFAULT TRUE,       -- false if no trades placed
    breach_occurred BOOLEAN DEFAULT FALSE,
    breach_type TEXT,
    profit_target_met BOOLEAN DEFAULT FALSE,
    min_days_met BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(challenge_id, date)
);


-- ============================================================
-- 15. ALERTS (price alerts)
-- ============================================================
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    condition TEXT NOT NULL CHECK (condition IN ('above', 'below', 'cross_above', 'cross_below')),
    target_price NUMERIC(12,2) NOT NULL,
    current_price_at_creation NUMERIC(12,2),
    notification_type TEXT DEFAULT 'toast' CHECK (notification_type IN ('toast', 'sound', 'popup', 'all')),
    is_triggered BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    triggered_at TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 16. LAYOUTS (workspace & panel configuration)
-- ============================================================
CREATE TABLE layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    layout_type TEXT NOT NULL CHECK (layout_type IN ('standard', 'dom', 'options', 'commodity', 'currency', 'compact', 'custom')),
    is_active BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    panel_config JSONB NOT NULL,               -- {panels: [{id, type, position, size}]}
    chart_config JSONB DEFAULT '{}',           -- {layout: 'single|2|4|8', symbols: [], timeframes: []}
    sidebar_collapsed BOOLEAN DEFAULT FALSE,
    bottom_panel_height INTEGER DEFAULT 200,
    watchlist_width INTEGER DEFAULT 280,
    order_panel_width INTEGER DEFAULT 300,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 17. THEMES (user theme preferences)
-- ============================================================
CREATE TABLE themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    is_system BOOLEAN DEFAULT FALSE,           -- true for built-in themes
    colors JSONB NOT NULL,                     -- full color token map
    font_family TEXT DEFAULT 'Inter',
    font_size TEXT DEFAULT 'normal' CHECK (font_size IN ('compact', 'normal', 'comfortable')),
    chart_colors JSONB DEFAULT '{}',           -- candle up/down, grid, crosshair
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trader_id, name)
);


-- ============================================================
-- 18. JOURNAL ENTRIES
-- ============================================================
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES terminal_traders(id) ON DELETE CASCADE,
    trading_account_id UUID REFERENCES trading_accounts(id),
    execution_id UUID REFERENCES executions(id),
    position_id UUID REFERENCES positions(id),
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    symbol TEXT,
    side TEXT CHECK (side IN ('BUY', 'SELL', NULL)),
    entry_price NUMERIC(12,2),
    exit_price NUMERIC(12,2),
    qty INTEGER,
    pnl NUMERIC(12,2),
    setup_type TEXT,                           -- 'breakout', 'reversal', 'scalp', 'momentum', etc.
    emotion TEXT CHECK (emotion IN ('confident', 'neutral', 'fearful', 'greedy', 'disciplined', 'impulsive', 'frustrated')),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    trade_phase TEXT CHECK (trade_phase IN ('before', 'during', 'after')),
    notes TEXT,
    lessons TEXT,
    mistakes TEXT,
    tags TEXT[] DEFAULT '{}',
    screenshot_urls TEXT[] DEFAULT '{}',
    is_auto_generated BOOLEAN DEFAULT FALSE,   -- system-generated from executions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 19. ANALYTICS SNAPSHOTS (periodic computed analytics)
-- ============================================================
CREATE TABLE analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    challenge_id UUID REFERENCES challenge_accounts(id),
    period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly', 'all_time')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    breakeven_trades INTEGER DEFAULT 0,
    win_rate NUMERIC(5,2),
    profit_factor NUMERIC(8,4),
    expectancy NUMERIC(12,2),
    avg_rr_ratio NUMERIC(8,4),
    avg_win NUMERIC(12,2),
    avg_loss NUMERIC(12,2),
    largest_win NUMERIC(12,2),
    largest_loss NUMERIC(12,2),
    max_consecutive_wins INTEGER DEFAULT 0,
    max_consecutive_losses INTEGER DEFAULT 0,
    total_pnl NUMERIC(12,2) DEFAULT 0,
    max_drawdown NUMERIC(12,2) DEFAULT 0,
    sharpe_ratio NUMERIC(8,4),
    avg_holding_time_minutes INTEGER,
    most_traded_symbol TEXT,
    most_profitable_symbol TEXT,
    best_hour INTEGER,                         -- 0-23 IST
    best_day_of_week INTEGER,                  -- 0=Mon, 6=Sun
    equity_curve JSONB DEFAULT '[]',           -- [{date, balance}]
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trading_account_id, period_type, period_start)
);
