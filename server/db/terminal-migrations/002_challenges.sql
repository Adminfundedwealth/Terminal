-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 002: challenges
-- Phase 2 — Depends on terminal_users
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('evaluation', 'funded')),
    plan TEXT NOT NULL,
    phase TEXT CHECK (phase IN ('phase_1', 'phase_2', 'funded')),
    initial_balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'expired')),
    min_trading_days INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT,
    previous_challenge_id UUID REFERENCES challenges(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challenges_user ON challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_challenges_prev ON challenges(previous_challenge_id);
