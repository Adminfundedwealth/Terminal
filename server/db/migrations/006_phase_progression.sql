-- ============================================================
-- MIGRATION 006: Phase Progression & Payout Support
-- 
-- Adds:
--   1. phase column to t_challenges (phase_1, phase_2, funded)
--   2. previous_challenge_id for linking progression
--   3. t_payouts table for payout lifecycle
-- ============================================================

-- 1. Add phase column to challenges
ALTER TABLE t_challenges ADD COLUMN IF NOT EXISTS phase TEXT 
  CHECK (phase IN ('phase_1', 'phase_2', 'funded'));

-- 2. Add previous_challenge_id for phase progression tracking
ALTER TABLE t_challenges ADD COLUMN IF NOT EXISTS previous_challenge_id UUID 
  REFERENCES t_challenges(id);

-- 3. Create payouts table
CREATE TABLE IF NOT EXISTS t_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    user_id UUID NOT NULL REFERENCES t_users(id),
    challenge_id UUID NOT NULL REFERENCES t_challenges(id),
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
CREATE INDEX IF NOT EXISTS idx_t_payouts_account ON t_payouts(account_id);
CREATE INDEX IF NOT EXISTS idx_t_payouts_user ON t_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_t_payouts_status ON t_payouts(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_t_challenges_prev ON t_challenges(previous_challenge_id);

-- RLS
ALTER TABLE t_payouts ENABLE ROW LEVEL SECURITY;
