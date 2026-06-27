-- ============================================================
-- MIGRATION 004: Foundation Hardening
-- From SUPABASE-FOUNDATION-REPORT.md
-- Priority 1 — Critical (apply before production)
-- ============================================================

-- ============================================================
-- 1. AUDIT LOG TABLE (immutable state change record)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    user_id UUID REFERENCES users(id),
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE audit_log IS 'Immutable log of all state changes (locks, breaches, transitions). Never UPDATE or DELETE.';

CREATE INDEX idx_audit_account_time ON audit_log(account_id, created_at DESC);
CREATE INDEX idx_audit_event_type ON audit_log(event_type, created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Audit log: users can see their own entries
CREATE POLICY "audit_log_select_own" ON audit_log FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE via client — service role only

-- ============================================================
-- 2. BROKER SESSIONS TABLE (persistent broker API tokens)
-- ============================================================
CREATE TABLE IF NOT EXISTS broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    broker_provider TEXT NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    client_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, broker_provider)
);

COMMENT ON TABLE broker_sessions IS 'Encrypted broker API tokens. Survives server restarts. One active session per account+broker.';

ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;

-- No client access — service role only
CREATE POLICY "broker_sessions_deny_all" ON broker_sessions FOR SELECT
  USING (FALSE);

-- Auto-update updated_at
CREATE TRIGGER update_broker_sessions_updated_at BEFORE UPDATE ON broker_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. MISSING PERFORMANCE INDEXES
-- ============================================================

-- ChallengeService.findActiveByUserId pattern
CREATE INDEX IF NOT EXISTS idx_challenges_user_status 
  ON challenges(user_id, status);

-- Broker callback lookups
CREATE INDEX IF NOT EXISTS idx_orders_broker_id 
  ON orders(broker_order_id) WHERE broker_order_id IS NOT NULL;

-- revokeAllUserSessions pattern
CREATE INDEX IF NOT EXISTS idx_sessions_user_active 
  ON sessions(user_id) WHERE revoked_at IS NULL;

-- Every pre-trade validation fetches active rules
CREATE INDEX IF NOT EXISTS idx_risk_rules_account_active 
  ON risk_rules(account_id) WHERE is_active = TRUE;

-- ============================================================
-- 4. TIGHTEN FK CONSTRAINTS (prevent orphaned records)
-- ============================================================

-- Orders: RESTRICT delete if trades exist
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_account_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

-- Trades: RESTRICT — trade history must never be lost
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_account_id_fkey;
ALTER TABLE trades ADD CONSTRAINT trades_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

-- Positions: RESTRICT — position history must never be lost
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_account_id_fkey;
ALTER TABLE positions ADD CONSTRAINT positions_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

-- Metrics: RESTRICT — reporting data must never be lost
ALTER TABLE account_metrics DROP CONSTRAINT IF EXISTS account_metrics_account_id_fkey;
ALTER TABLE account_metrics ADD CONSTRAINT account_metrics_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

-- ============================================================
-- 5. MARGIN COLUMNS ON ACCOUNTS
-- ============================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS available_margin NUMERIC(15,2);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS used_margin NUMERIC(15,2) DEFAULT 0;

-- ============================================================
-- 6. LOT SIZE ON ORDERS AND POSITIONS
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lot_size INTEGER DEFAULT 1;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS lot_size INTEGER DEFAULT 1;

-- ============================================================
-- 7. SESSION HEARTBEAT
-- ============================================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
