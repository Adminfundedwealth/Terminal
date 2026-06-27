-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 011: risk_events
-- Phase 4 — Depends on terminal_accounts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'check_passed', 'check_failed', 'violation', 'breach', 'warning',
        'account_locked', 'daily_loss_limit', 'max_drawdown', 'position_limit',
        'lot_size_exceeded', 'margin_insufficient', 'segment_blocked',
        'trading_hours', 'overnight_block', 'instrument_blocked', 'manual_lock'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'fatal')),
    rule_type TEXT,
    rule_value JSONB,
    actual_value JSONB,
    order_id UUID,
    description TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_risk_events_account ON risk_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_unresolved ON risk_events(account_id) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_risk_events_severity ON risk_events(severity) WHERE severity IN ('critical', 'fatal');
