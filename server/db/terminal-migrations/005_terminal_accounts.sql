-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 005: terminal_accounts
-- Phase 3 — Depends on terminal_users + challenges
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS terminal_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    account_code TEXT UNIQUE NOT NULL,
    challenge_id UUID NOT NULL REFERENCES challenges(id),
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    broker_client_id TEXT,
    balance NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2),
    payout_eligible BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_terminal_accounts_user ON terminal_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_accounts_challenge ON terminal_accounts(challenge_id);
CREATE INDEX IF NOT EXISTS idx_terminal_accounts_status ON terminal_accounts(status) WHERE status IN ('active', 'locked');
