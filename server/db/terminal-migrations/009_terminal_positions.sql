-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 009: terminal_positions
-- Phase 4 — Depends on terminal_accounts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS terminal_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    product_type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_positions_open
    ON terminal_positions(account_id, token, product_type)
    WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_terminal_positions_account ON terminal_positions(account_id) WHERE closed_at IS NULL;
