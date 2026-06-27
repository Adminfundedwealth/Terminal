-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 012: broker_sessions
-- Phase 4 — Depends on terminal_accounts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    client_id TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_sessions_account_provider ON broker_sessions(account_id, broker_provider);
