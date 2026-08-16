-- Migration 022: twostep_risk_profile
-- Centralized 2-Step risk config (3 phases). Admin-editable.
-- Does NOT affect Flash, Instant, or 1-Step.

CREATE TABLE IF NOT EXISTS twostep_risk_profile (
    id TEXT PRIMARY KEY DEFAULT 'default',
    p1_daily_loss_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
    p1_max_drawdown_pct NUMERIC(5,2) NOT NULL DEFAULT 8.0,
    p1_profit_target_pct NUMERIC(5,2) NOT NULL DEFAULT 8.0,
    p1_min_trading_days INTEGER NOT NULL DEFAULT 5,
    p1_max_open_positions INTEGER NOT NULL DEFAULT 20,
    p1_max_position_size_pct NUMERIC(5,2) NOT NULL DEFAULT 70.0,
    p1_max_risk_per_trade_pct NUMERIC(5,2) NOT NULL DEFAULT 1.5,
    p1_daily_profit_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 4.0,
    p1_leverage_max INTEGER NOT NULL DEFAULT 30,
    p2_daily_loss_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
    p2_max_drawdown_pct NUMERIC(5,2) NOT NULL DEFAULT 8.0,
    p2_profit_target_pct NUMERIC(5,2) NOT NULL DEFAULT 5.0,
    p2_min_trading_days INTEGER NOT NULL DEFAULT 5,
    p2_max_open_positions INTEGER NOT NULL DEFAULT 20,
    p2_max_position_size_pct NUMERIC(5,2) NOT NULL DEFAULT 70.0,
    p2_max_risk_per_trade_pct NUMERIC(5,2) NOT NULL DEFAULT 1.5,
    p2_daily_profit_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 4.0,
    p2_leverage_max INTEGER NOT NULL DEFAULT 30,
    f_daily_loss_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
    f_max_drawdown_pct NUMERIC(5,2) NOT NULL DEFAULT 6.0,
    f_profit_target_pct NUMERIC(5,2) NOT NULL DEFAULT 0.0,
    f_min_trading_days INTEGER NOT NULL DEFAULT 3,
    f_max_open_positions INTEGER NOT NULL DEFAULT 20,
    f_max_position_size_pct NUMERIC(5,2) NOT NULL DEFAULT 70.0,
    f_max_risk_per_trade_pct NUMERIC(5,2) NOT NULL DEFAULT 1.5,
    f_daily_profit_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 4.0,
    f_leverage_max INTEGER NOT NULL DEFAULT 30,
    f_consistency_rule_pct NUMERIC(5,2) NOT NULL DEFAULT 40.0,
    f_profit_split_initial_pct NUMERIC(5,2) NOT NULL DEFAULT 80.0,
    f_profit_split_scaled_pct NUMERIC(5,2) NOT NULL DEFAULT 90.0,
    f_payout_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 5.0,
    allowed_segments JSONB NOT NULL DEFAULT '["NSE","NFO","BFO","MCX","CDS"]',
    trading_hours_start TEXT NOT NULL DEFAULT '09:15',
    trading_hours_end TEXT NOT NULL DEFAULT '15:30',
    overnight_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    overnight_cutoff TEXT NOT NULL DEFAULT '15:15',
    weekend_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    holiday_restriction BOOLEAN NOT NULL DEFAULT TRUE,
    inactivity_close_days INTEGER NOT NULL DEFAULT 60,
    time_limit_days INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);
INSERT INTO twostep_risk_profile (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS twostep_risk_profile_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL,
    phase TEXT,
    old_value JSONB,
    new_value JSONB NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_twostep_audit_rule ON twostep_risk_profile_audit(rule_name);
CREATE INDEX IF NOT EXISTS idx_twostep_audit_time ON twostep_risk_profile_audit(changed_at DESC);
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS first_payout_approved_at TIMESTAMPTZ DEFAULT NULL;