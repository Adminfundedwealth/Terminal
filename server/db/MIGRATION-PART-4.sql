-- ============================================================
-- PART 4: Phase Progression, Payouts, Foundation Tables
-- Run AFTER Part 3
-- ============================================================

-- Add phase column to challenges
ALTER TABLE t_challenges ADD COLUMN IF NOT EXISTS phase TEXT 
  CHECK (phase IN ('phase_1', 'phase_2', 'funded'));

-- Add previous_challenge_id for phase progression tracking
ALTER TABLE t_challenges ADD COLUMN IF NOT EXISTS previous_challenge_id UUID 
  REFERENCES t_challenges(id);

-- Payouts table
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

CREATE INDEX IF NOT EXISTS idx_t_payouts_account ON t_payouts(account_id);
CREATE INDEX IF NOT EXISTS idx_t_payouts_user ON t_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_t_payouts_status ON t_payouts(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_t_challenges_prev ON t_challenges(previous_challenge_id);

ALTER TABLE t_payouts ENABLE ROW LEVEL SECURITY;

-- Foundation Tables
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  user_id UUID,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type);

CREATE TABLE IF NOT EXISTS broker_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  provider TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_broker_sessions_acct ON broker_sessions(account_id);
