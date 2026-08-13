-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 020: instant_risk_profile
-- Centralized Instant Funding risk configuration table.
-- Admin-editable. Single authoritative source for all Instant accounts.
-- Does NOT affect Flash, 1-Step, or 2-Step challenge types.
-- ══════════════════════════════════════════════════════════════════

-- ── instant_risk_profile ──────────────────────────────────────────
-- One active row at all times (id = 'default').
-- Risk Engine reads this table for every Instant account's risk checks.
-- Admin UI writes to this table — no code change required.
CREATE TABLE IF NOT EXISTS instant_risk_profile (
    id                      TEXT PRIMARY KEY DEFAULT 'default',

    -- Loss rules
    daily_loss_pct          NUMERIC(5,2)  NOT NULL DEFAULT 3.0,
    max_drawdown_pct        NUMERIC(5,2)  NOT NULL DEFAULT 5.0,

    -- Position / leverage
    max_open_positions      INTEGER       NOT NULL DEFAULT 20,
    leverage_max            INTEGER       NOT NULL DEFAULT 50,
    max_position_size_pct   NUMERIC(5,2)  NOT NULL DEFAULT 70.0,

    -- Markets
    allowed_segments        JSONB         NOT NULL DEFAULT '["NSE","NFO","BFO","MCX","CDS"]',

    -- Session rules
    trading_hours_start     TEXT          NOT NULL DEFAULT '09:15',
    trading_hours_end       TEXT          NOT NULL DEFAULT '15:15',
    overnight_allowed       BOOLEAN       NOT NULL DEFAULT FALSE,
    overnight_cutoff        TEXT          NOT NULL DEFAULT '15:15',
    weekend_allowed         BOOLEAN       NOT NULL DEFAULT FALSE,
    holiday_restriction     BOOLEAN       NOT NULL DEFAULT TRUE,

    -- Targets / payouts
    profit_target_pct       NUMERIC(5,2)  NOT NULL DEFAULT 0.0,
    profit_split_initial_pct NUMERIC(5,2) NOT NULL DEFAULT 70.0,
    profit_split_scaled_pct  NUMERIC(5,2) NOT NULL DEFAULT 80.0,
    profit_split_scale_days  INTEGER      NOT NULL DEFAULT 30,
    payout_threshold_pct    NUMERIC(5,2)  NOT NULL DEFAULT 5.0,
    min_trading_days        INTEGER       NOT NULL DEFAULT 7,
    consistency_rule_pct    NUMERIC(5,2)  NOT NULL DEFAULT 15.0,

    -- Kill-switch
    daily_profit_cap_pct    NUMERIC(5,2)  NOT NULL DEFAULT 4.0,

    -- Risk per trade idea
    risk_per_idea_pct       NUMERIC(5,2)  NOT NULL DEFAULT 1.0,
    risk_per_idea_window_min INTEGER       NOT NULL DEFAULT 10,

    -- Inactivity
    inactivity_close_days   INTEGER       NOT NULL DEFAULT 60,

    -- Meta
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_by              TEXT
);

-- Seed the default Instant profile (INSERT only if not already present)
INSERT INTO instant_risk_profile (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ── instant_risk_profile_audit ────────────────────────────────────
-- Immutable append-only audit log.
-- Every Admin change creates one row here. Never delete from this table.
CREATE TABLE IF NOT EXISTS instant_risk_profile_audit (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name   TEXT        NOT NULL,
    old_value   JSONB,
    new_value   JSONB       NOT NULL,
    changed_by  TEXT        NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instant_audit_rule ON instant_risk_profile_audit(rule_name);
CREATE INDEX IF NOT EXISTS idx_instant_audit_time ON instant_risk_profile_audit(changed_at DESC);
