-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 010: audit_log
-- Phase 4 — No strict FK (account_id nullable)
-- ══════════════════════════════════════════════════════════════════

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type);
