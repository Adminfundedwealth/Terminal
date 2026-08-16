-- Migration 023: onestep_risk_profile
-- Centralized 1-Step risk config (Evaluation + Funded). Admin-editable.
-- Does NOT affect Flash, Instant, or 2-Step.

CREATE TABLE IF NOT EXISTS onestep_risk_profile (
    id TEXT PRIMARY KEY DEFAULT 'default',
    e_daily_loss_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
    e_max_drawdown_pct NUMERIC(5,2) NOT NULL DEFAULT 6.0,
    e_profit_target_pct NUMERIC(5,2) NOT NULL DEFAULT 10.0,
    e_min_trading_days INTEGER NOT NULL DEFAULT 5,
    e_max_open_positions INTEGER NOT NULL DEFAULT 20,
    e_max_position_size_pct NUMERIC(5,2) NOT NULL DEFAULT 70.0,
    e_max_risk_per_trade_pct NUMERIC(5,2) NOT NULL DEFAULT 1.5,
    e_daily_profit_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 4.0,
    e_leverage_max INTEGER NOT NULL DEFAULT 30,
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
    f_payout_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0,
    allowed_segments JSONB NOT NULL DEFAULT '["NSE","NFO","BFO","MCX","CDS"]',
    trading_hours_start TEXT NOT NULL DEFAULT '09:15',
    trading_hours_end TEXT NOT NULL DEFAULT '15:30',
    overnight_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    weekend_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    holiday_restriction BOOLEAN NOT NULL DEFAULT TRUE,
    inactivity_close_days INTEGER NOT NULL DEFAULT 60,
    time_limit_days INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);
INSERT INTO onestep_risk_profile (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS onestep_risk_profile_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL,
    phase TEXT,
    old_value JSONB,
    new_value JSONB NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_onestep_audit_rule ON onestep_risk_profile_audit(rule_name);
CREATE INDEX IF NOT EXISTS idx_onestep_audit_time ON onestep_risk_profile_audit(changed_at DESC);