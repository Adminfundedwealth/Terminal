-- ============================================================
-- FUNDEDWEALTH TERMINAL — ROW LEVEL SECURITY POLICIES
-- Migration 003: RLS for all tables
-- ============================================================
-- Policy model: Service role bypasses RLS.
-- Authenticated users can only access their own data.
-- Terminal uses service_role key server-side; RLS protects
-- against any direct Supabase client access.
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE terminal_traders ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- TERMINAL TRADERS — user can read own row
-- ============================================================
CREATE POLICY traders_own_read ON terminal_traders
    FOR SELECT USING (id = auth.uid());

CREATE POLICY traders_own_update ON terminal_traders
    FOR UPDATE USING (id = auth.uid());


-- ============================================================
-- TERMINAL SESSIONS — user can read/delete own sessions
-- ============================================================
CREATE POLICY sessions_own_read ON terminal_sessions
    FOR SELECT USING (trader_id = auth.uid());

CREATE POLICY sessions_own_delete ON terminal_sessions
    FOR DELETE USING (trader_id = auth.uid());


-- ============================================================
-- CHALLENGE ACCOUNTS — user can read own challenges
-- ============================================================
CREATE POLICY challenges_own_read ON challenge_accounts
    FOR SELECT USING (trader_id = auth.uid());


-- ============================================================
-- TRADING ACCOUNTS — user can read own accounts
-- ============================================================
CREATE POLICY trading_accounts_own_read ON trading_accounts
    FOR SELECT USING (trader_id = auth.uid());


-- ============================================================
-- BROKER SESSIONS — user can read own (via trading account)
-- ============================================================
CREATE POLICY broker_sessions_own_read ON broker_sessions
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- RISK RULES — user can read own
-- ============================================================
CREATE POLICY risk_rules_own_read ON risk_rules
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- TRADING ORDERS — user can read/insert own
-- ============================================================
CREATE POLICY orders_own_read ON trading_orders
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );

CREATE POLICY orders_own_insert ON trading_orders
    FOR INSERT WITH CHECK (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- POSITIONS — user can read own
-- ============================================================
CREATE POLICY positions_own_read ON positions
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- EXECUTIONS — user can read own
-- ============================================================
CREATE POLICY executions_own_read ON executions
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- EXECUTION AUDITS — user can read own
-- ============================================================
CREATE POLICY audits_own_read ON execution_audits
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- WATCHLISTS — user full CRUD on own
-- ============================================================
CREATE POLICY watchlists_own_all ON watchlists
    FOR ALL USING (trader_id = auth.uid());


-- ============================================================
-- ACCOUNT METRICS — user can read own
-- ============================================================
CREATE POLICY metrics_own_read ON account_metrics
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- RISK EVENTS — user can read own
-- ============================================================
CREATE POLICY risk_events_own_read ON risk_events
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- CHALLENGE PROGRESS — user can read own
-- ============================================================
CREATE POLICY progress_own_read ON challenge_progress
    FOR SELECT USING (
        challenge_id IN (
            SELECT id FROM challenge_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- ALERTS — user full CRUD on own
-- ============================================================
CREATE POLICY alerts_own_all ON alerts
    FOR ALL USING (trader_id = auth.uid());


-- ============================================================
-- LAYOUTS — user full CRUD on own
-- ============================================================
CREATE POLICY layouts_own_all ON layouts
    FOR ALL USING (trader_id = auth.uid());


-- ============================================================
-- THEMES — user full CRUD on own
-- ============================================================
CREATE POLICY themes_own_all ON themes
    FOR ALL USING (trader_id = auth.uid());


-- ============================================================
-- JOURNAL ENTRIES — user full CRUD on own
-- ============================================================
CREATE POLICY journal_own_all ON journal_entries
    FOR ALL USING (trader_id = auth.uid());


-- ============================================================
-- ANALYTICS SNAPSHOTS — user can read own
-- ============================================================
CREATE POLICY analytics_own_read ON analytics_snapshots
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );


-- ============================================================
-- SERVICE ROLE BYPASS (server-side operations)
-- ============================================================
-- Supabase service_role key automatically bypasses RLS.
-- All server operations (risk engine, cron, order execution)
-- use service_role and are not restricted by these policies.
