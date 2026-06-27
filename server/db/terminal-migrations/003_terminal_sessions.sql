-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 003: terminal_sessions
-- Phase 2 — Depends on terminal_users
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS terminal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES terminal_users(id) ON DELETE CASCADE,
    account_id UUID,
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_token ON terminal_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user ON terminal_sessions(user_id);
