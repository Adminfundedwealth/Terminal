-- ============================================================
-- MIGRATION 005: PERSISTENCE TABLES
-- 
-- New tables for event-driven architecture:
--   t_broker_sessions  — Broker connection lifecycle tracking
--   t_risk_events      — All risk violations and alerts
--   t_challenge_metrics — Granular challenge progress events
--   t_order_audit       — Immutable order lifecycle audit log
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. BROKER SESSIONS
-- Tracks every broker connection/disconnection/failover event.
-- ────────────────────────────────────────────────────────────

CREATE TABLE t_broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    client_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'expired', 'failed', 'failover')),
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    feed_token TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_broker_sessions_account ON t_broker_sessions(account_id);
CREATE INDEX idx_broker_sessions_provider ON t_broker_sessions(provider, status);
CREATE INDEX idx_broker_sessions_active ON t_broker_sessions(account_id, status) WHERE status = 'connected';

-- ────────────────────────────────────────────────────────────
-- 2. RISK EVENTS
-- Every risk check, violation, and alert is persisted here.
-- Immutable audit trail for compliance.
-- ────────────────────────────────────────────────────────────

CREATE TABLE t_risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'check_passed',
        'check_failed',
        'violation',
        'breach',
        'warning',
        'account_locked',
        'daily_loss_limit',
        'max_drawdown',
        'position_limit',
        'lot_size_exceeded',
        'margin_insufficient',
        'segment_blocked',
        'trading_hours',
        'overnight_block',
        'instrument_blocked',
        'manual_lock'
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

CREATE INDEX idx_risk_events_account ON t_risk_events(account_id, created_at DESC);
CREATE INDEX idx_risk_events_type ON t_risk_events(event_type);
CREATE INDEX idx_risk_events_severity ON t_risk_events(severity) WHERE severity IN ('critical', 'fatal');
CREATE INDEX idx_risk_events_unresolved ON t_risk_events(account_id) WHERE resolved = FALSE;

-- ────────────────────────────────────────────────────────────
-- 3. CHALLENGE METRICS
-- Granular event log for challenge progression.
-- Tracks every state change in the challenge lifecycle.
-- ────────────────────────────────────────────────────────────

CREATE TABLE t_challenge_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES t_challenges(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'challenge_started',
        'challenge_updated',
        'challenge_passed',
        'challenge_failed',
        'challenge_expired',
        'daily_target_hit',
        'profit_target_reached',
        'drawdown_warning',
        'drawdown_breach',
        'balance_snapshot',
        'trading_day_complete',
        'milestone_reached'
    )),
    balance_before NUMERIC(15,2),
    balance_after NUMERIC(15,2),
    pnl NUMERIC(12,2),
    pnl_percent NUMERIC(8,4),
    drawdown NUMERIC(12,2),
    drawdown_percent NUMERIC(8,4),
    peak_balance NUMERIC(15,2),
    trading_days_elapsed INTEGER,
    total_trades INTEGER,
    win_rate NUMERIC(5,2),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_challenge_metrics_challenge ON t_challenge_metrics(challenge_id, created_at DESC);
CREATE INDEX idx_challenge_metrics_account ON t_challenge_metrics(account_id, created_at DESC);
CREATE INDEX idx_challenge_metrics_type ON t_challenge_metrics(event_type);

-- ────────────────────────────────────────────────────────────
-- 4. ORDER AUDIT
-- Immutable log of every order state transition.
-- One order can have many audit entries (PENDING→OPEN→FILLED).
-- ────────────────────────────────────────────────────────────

CREATE TABLE t_order_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES t_orders(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'order_created',
        'order_submitted',
        'order_accepted',
        'order_open',
        'order_partially_filled',
        'order_filled',
        'order_modified',
        'order_cancelled',
        'order_rejected',
        'order_expired',
        'position_opened',
        'position_updated',
        'position_closed',
        'position_reversed'
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

CREATE INDEX idx_order_audit_order ON t_order_audit(order_id, created_at ASC);
CREATE INDEX idx_order_audit_account ON t_order_audit(account_id, created_at DESC);
CREATE INDEX idx_order_audit_type ON t_order_audit(event_type);
CREATE INDEX idx_order_audit_today ON t_order_audit(account_id, created_at DESC)
    WHERE created_at >= CURRENT_DATE;

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE t_broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_challenge_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_order_audit ENABLE ROW LEVEL SECURITY;

-- Service role (backend) bypasses RLS automatically.
-- These policies are for any direct client access if ever needed:

CREATE POLICY "Service role full access" ON t_broker_sessions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON t_risk_events
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON t_challenge_metrics
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON t_order_audit
    FOR ALL USING (true) WITH CHECK (true);
