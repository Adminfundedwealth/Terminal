-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 015: order_audit
-- Phase 5 — Depends on terminal_orders + terminal_accounts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS order_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES terminal_orders(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'order_created', 'order_submitted', 'order_accepted', 'order_open',
        'order_partially_filled', 'order_filled', 'order_modified',
        'order_cancelled', 'order_rejected', 'order_expired',
        'position_opened', 'position_updated', 'position_closed', 'position_reversed'
    )),
    previous_status TEXT,
    new_status TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    side TEXT CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER,
    price NUMERIC(12,2),
    filled_qty INTEGER,
    avg_price NUMERIC(12,2),
    broker_order_id TEXT,
    broker_provider TEXT,
    reject_reason TEXT,
    latency_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_order_audit_order ON order_audit(order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_order_audit_account ON order_audit(account_id, created_at DESC);
