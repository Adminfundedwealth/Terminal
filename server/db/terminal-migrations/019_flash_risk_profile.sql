-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 019: flash_risk_profile
-- Centralized Flash Funding risk configuration table.
-- Admin-editable. Single authoritative source for all Flash accounts.
-- Does NOT affect Instant, 1-Step, or 2-Step challenge types.
-- ══════════════════════════════════════════════════════════════════

-- ── flash_risk_profile ────────────────────────────────────────────
-- One active row at all times (id = 'default' or a stable UUID).
-- Risk Engine reads this table for every Flash account's risk checks.
-- Admin UI writes to this table — no code change required.
CREATE TABLE IF NOT EXISTS flash_risk_profile (
    id                    TEXT PRIMARY KEY DEFAULT 'default',
    -- Duration
    duration_hours        NUMERIC(6,2)  NOT NULL DEFAULT 24,
    timer_start_event     TEXT          NOT NULL DEFAULT 'first_position'
                            CHECK (timer_start_event IN ('first_position')),

    -- Loss rules
    per_position_loss_pct NUMERIC(5,2)  NOT NULL DEFAULT 2.0,
    max_drawdown_pct      NUMERIC(5,2)  NOT NULL DEFAULT 4.0,

    -- Position / leverage
    max_open_positions    INTEGER       NOT NULL DEFAULT 50,
    leverage_max          INTEGER       NOT NULL DEFAULT 50,

    -- Markets
    allowed_segments      JSONB         NOT NULL DEFAULT '["NSE","NFO","BFO","MCX","CDS"]',

    -- Session rules
    trading_hours_start   TEXT          NOT NULL DEFAULT '09:15',
    trading_hours_end     TEXT          NOT NULL DEFAULT '15:30',
    overnight_allowed     BOOLEAN       NOT NULL DEFAULT TRUE,
    weekend_allowed       BOOLEAN       NOT NULL DEFAULT TRUE,
    holiday_restriction   BOOLEAN       NOT NULL DEFAULT FALSE,

    -- Targets / payouts
    profit_target_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0.0,
    profit_split_pct      NUMERIC(5,2)  NOT NULL DEFAULT 90.0,
    consistency_rule_pct  NUMERIC(5,2)  NOT NULL DEFAULT 15.0,
    payout_threshold_pct  NUMERIC(5,2)  NOT NULL DEFAULT 3.0,

    -- Meta
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_by            TEXT          -- admin user ID who last changed it
);

-- Seed the default Flash profile (INSERT only if not already present)
INSERT INTO flash_risk_profile (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ── flash_risk_profile_audit ──────────────────────────────────────
-- Immutable append-only audit log.
-- Every Admin change to flash_risk_profile creates one row here.
-- Never delete from this table.
CREATE TABLE IF NOT EXISTS flash_risk_profile_audit (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name   TEXT        NOT NULL,
    old_value   JSONB,
    new_value   JSONB       NOT NULL,
    changed_by  TEXT        NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flash_audit_rule  ON flash_risk_profile_audit(rule_name);
CREATE INDEX IF NOT EXISTS idx_flash_audit_time  ON flash_risk_profile_audit(changed_at DESC);

-- ── challenge_accounts: add first_position_at ────────────────────
-- Persists when the Flash 24-hour timer started (first position opened).
-- NULL = timer has not started yet.
-- Survives server restart — never stored in memory.
ALTER TABLE challenge_accounts
    ADD COLUMN IF NOT EXISTS first_position_at TIMESTAMPTZ DEFAULT NULL;
