-- ============================================================
-- MIGRATION 002: Row Level Security Policies
-- 
-- NOTE: Terminal backend uses SUPABASE_SERVICE_KEY which bypasses RLS.
-- These policies protect direct client/anon access only.
-- ============================================================

-- Users: only own data
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (id = auth.uid());

-- Accounts: belong to user
CREATE POLICY "accounts_select_own" ON accounts FOR SELECT
  USING (user_id = auth.uid());

-- Challenges: belong to user
CREATE POLICY "challenges_select_own" ON challenges FOR SELECT
  USING (user_id = auth.uid());

-- Orders: belong to user's accounts
CREATE POLICY "orders_select_own" ON orders FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

CREATE POLICY "orders_insert_own" ON orders FOR INSERT
  WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- Positions: belong to user's accounts
CREATE POLICY "positions_select_own" ON positions FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- Trades: belong to user's accounts
CREATE POLICY "trades_select_own" ON trades FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- Watchlists: belong to user (full CRUD)
CREATE POLICY "watchlists_all_own" ON watchlists FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Risk Rules: visible to account owner
CREATE POLICY "risk_rules_select_own" ON risk_rules FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- Account Metrics: visible to account owner
CREATE POLICY "metrics_select_own" ON account_metrics FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- Sessions: own sessions only
CREATE POLICY "sessions_select_own" ON sessions FOR SELECT
  USING (user_id = auth.uid());
