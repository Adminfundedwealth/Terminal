-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 013: payouts
-- Phase 4 — Depends on terminal_accounts, terminal_users, challenges
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    user_id UUID NOT NULL REFERENCES terminal_users(id),
    challenge_id UUID NOT NULL REFERENCES challenges(id),
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payouts_account ON payouts(account_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status) WHERE status IN ('pending', 'processing');
