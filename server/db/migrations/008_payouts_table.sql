-- ============================================================
-- MIGRATION 008: Payouts table (aligned with current schema)
-- Uses trading_accounts + terminal_traders + challenge_accounts FKs
-- ============================================================

CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES trading_accounts(id),
    user_id UUID NOT NULL REFERENCES terminal_traders(id),
    challenge_id UUID NOT NULL REFERENCES challenge_accounts(id),
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
CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status) WHERE status IN ('pending', 'processing');

-- Prevent duplicate pending payouts per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_one_pending_per_account
  ON payouts(account_id)
  WHERE status IN ('pending', 'processing');
