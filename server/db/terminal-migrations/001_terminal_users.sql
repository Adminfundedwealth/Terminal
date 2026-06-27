-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 001: terminal_users
-- Phase 1 — No dependencies except platform `users`
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS terminal_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_users_platform ON terminal_users(platform_user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_users_fw ON terminal_users(fw_user_id);
