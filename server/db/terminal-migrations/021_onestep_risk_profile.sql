-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 021: onestep_risk_profile
-- Centralized 1-Step Funding risk configuration table.
-- Admin-editable. Single authoritative source for all 1-Step accounts.
-- Does NOT affect Flash, Instant, or 2-Step challenge types.
-- Safe: additive only. No DROP, DELETE, TRUNCATE.
-- ══════════════════════════════════════════════════════════════════

-- ── onestep_risk_profile ──────────────────────────────────────────
-- One active row at all times (id = 'default').
-- Risk Engine reads this table for every 1-Step account's risk checks.
-- Admin UI writes to this table — no code change required.
-- Applies to BOTH evaluation and funded phases.
-- Phase-specific values (e.g. profit_target, min_trading_days_funded)
-- are stored as separate columns.
CREATE TABLE IF NOT EXISTS onestep_risk_profile (
    id                          TEXT PRIMARY KEY DEFAULT 'default',

    -- ── EVALUATION + FUNDED shared rules ──────────────────────────
    daily_loss_pct              NUMERIC(5,2)  NOT NULL DEFAULT 3.0,
    max_drawdown_pct            NUMERIC(5,2)  NOT NULL DEFAULT 6.0,
    max_open_positions          INTEGER       NOT NULL DEFAULT 20,
    leverage_max                INTEGER       NOT NULL DEFAULT 30,
    max_position_size_pct       NUMERIC(5,2)  NOT NULL DEFAULT 70.0,
    daily_profit_cap_pct        NUMERIC(5,2)  NOT NULL DEFAULT 4.0,
    -- Cooldown after daily profit cap is hit (hours)
    daily_profit_cap_cooldown_hours NUMERIC(5,2) NOT NULL DEFAULT 8.0,
    max_risk_per_trade_pct      NUMERIC(5,2)  NOT NULL DEFAULT 1.5,
    consistency_rule_pct        NUMERIC(5,2)  NOT NULL DEFAULT 40.0,

    -- ── Markets ────────────────────────────────────────────────────
    allowed_segments            JSONB         NOT NULL DEFAULT '["NSE","NFO","BFO","CDS","MCX"]',
    trading_hours_start         TEXT          NOT NULL DEFAULT '09:15',
    trading_hours_end           TEXT          NOT NULL DEFAULT '15:30',
    overnight_allowed           BOOLEAN       NOT NULL DEFAULT TRUE,
    weekend_allowed             BOOLEAN       NOT NULL DEFAULT FALSE,
    holiday_restriction         BOOLEAN       NOT NULL DEFAULT TRUE,

    -- ── EVALUATION-only rules ─────────────────────────────────────
    profit_target_pct           NUMERIC(5,2)  NOT NULL DEFAULT 10.0,
    min_trading_days_eval       INTEGER       NOT NULL DEFAULT 5,
    time_limit_days             INTEGER       NOT NULL DEFAULT 0,  -- 0 = unlimited

    -- ── FUNDED-only rules ─────────────────────────────────────────
    min_trading_days_funded     INTEGER       NOT NULL DEFAULT 3,
    payout_threshold_pct        NUMERIC(5,2)  NOT NULL DEFAULT 3.0,
    -- Initial profit split (before payout threshold is first satisfied)
    profit_split_initial_pct    NUMERIC(5,2)  NOT NULL DEFAULT 80.0,
    -- Scaled profit split (after payout threshold condition is satisfied)
    profit_split_scaled_pct     NUMERIC(5,2)  NOT NULL DEFAULT 90.0,

    -- ── Meta ───────────────────────────────────────────────────────
    updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_by                  TEXT          -- admin user ID who last changed it
);

-- Seed the default 1-Step profile (INSERT only if not already present)
INSERT INTO onestep_risk_profile (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- ── onestep_risk_profile_audit ────────────────────────────────────
-- Immutable append-only audit log.
-- Every Admin change creates one row here. Never delete from this table.
CREATE TABLE IF NOT EXISTS onestep_risk_profile_audit (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name   TEXT        NOT NULL,
    old_value   JSONB,
    new_value   JSONB       NOT NULL,
    changed_by  TEXT        NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onestep_audit_rule ON onestep_risk_profile_audit(rule_name);
CREATE INDEX IF NOT EXISTS idx_onestep_audit_time ON onestep_risk_profile_audit(changed_at DESC);

-- ── trading_accounts: add daily_profit_cap_until ─────────────────
-- Persists the cooldown expiry timestamp for the daily profit cap.
-- NULL = no active cooldown.
-- Survives server restart — never stored in memory only.
ALTER TABLE trading_accounts
    ADD COLUMN IF NOT EXISTS daily_profit_cap_until TIMESTAMPTZ DEFAULT NULL;
