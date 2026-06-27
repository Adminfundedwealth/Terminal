-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 006: risk_rules
-- Phase 4 — Depends on terminal_accounts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_risk_rules_account ON risk_rules(account_id) WHERE is_active = TRUE;
