-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 014: terminal_trades
-- Phase 5 — Depends on terminal_accounts + terminal_orders
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS terminal_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    order_id UUID REFERENCES terminal_orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_terminal_trades_account_time ON terminal_trades(account_id, executed_at DESC);
