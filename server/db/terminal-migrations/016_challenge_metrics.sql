-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 016: challenge_metrics
-- Phase 5 — Depends on challenges + terminal_accounts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS challenge_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'challenge_started', 'challenge_updated', 'challenge_passed',
        'challenge_failed', 'challenge_expired', 'daily_target_hit',
        'profit_target_reached', 'drawdown_warning', 'drawdown_breach',
        'balance_snapshot', 'trading_day_complete', 'milestone_reached'
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challenge_metrics_challenge ON challenge_metrics(challenge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_metrics_account ON challenge_metrics(account_id, created_at DESC);
