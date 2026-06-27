-- ============================================================
-- PART 2: Indexes, Triggers, RLS for Core Tables
-- Run AFTER Part 1
-- ============================================================

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_t_accounts_user ON t_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_t_accounts_challenge ON t_accounts(challenge_id);
CREATE INDEX IF NOT EXISTS idx_t_orders_account_time ON t_orders(account_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_t_orders_status ON t_orders(account_id, status) WHERE status IN ('PENDING', 'OPEN');
CREATE INDEX IF NOT EXISTS idx_t_positions_open ON t_positions(account_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_t_trades_account_time ON t_trades(account_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_t_metrics_account_date ON t_account_metrics(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_t_sessions_token ON t_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_t_watchlists_user ON t_watchlists(user_id);

-- TRIGGERS
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_t_users_updated_at ON t_users;
CREATE TRIGGER update_t_users_updated_at BEFORE UPDATE ON t_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_t_accounts_updated_at ON t_accounts;
CREATE TRIGGER update_t_accounts_updated_at BEFORE UPDATE ON t_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_t_orders_updated_at ON t_orders;
CREATE TRIGGER update_t_orders_updated_at BEFORE UPDATE ON t_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_t_watchlists_updated_at ON t_watchlists;
CREATE TRIGGER update_t_watchlists_updated_at BEFORE UPDATE ON t_watchlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ROW LEVEL SECURITY
ALTER TABLE t_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_sessions ENABLE ROW LEVEL SECURITY;
