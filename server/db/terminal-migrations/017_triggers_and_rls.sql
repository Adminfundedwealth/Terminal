-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 017: Triggers + Row Level Security
-- Phase 6 — No table dependencies (runs after all tables created)
-- ══════════════════════════════════════════════════════════════════

-- ─── TRIGGER FUNCTION ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── TRIGGERS ────────────────────────────────────────────────────

CREATE TRIGGER trg_terminal_users_updated_at
    BEFORE UPDATE ON terminal_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_terminal_accounts_updated_at
    BEFORE UPDATE ON terminal_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_terminal_orders_updated_at
    BEFORE UPDATE ON terminal_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_watchlists_updated_at
    BEFORE UPDATE ON watchlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────
-- Service role (used by backend) bypasses RLS automatically.
-- No client-side RLS policies needed — all access is via service key.

ALTER TABLE terminal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
