-- ============================================================
-- FUNDEDWEALTH TERMINAL — INDEXES
-- Migration 002: Performance indexes
-- ============================================================

-- Terminal Traders
CREATE INDEX idx_traders_external ON terminal_traders(external_id);
CREATE INDEX idx_traders_email ON terminal_traders(email);
CREATE INDEX idx_traders_status ON terminal_traders(status) WHERE status = 'active';

-- Terminal Sessions
CREATE INDEX idx_sessions_trader ON terminal_sessions(trader_id) WHERE is_active = TRUE;
CREATE INDEX idx_sessions_token ON terminal_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_expiry ON terminal_sessions(expires_at) WHERE is_active = TRUE;
CREATE INDEX idx_sessions_activity ON terminal_sessions(last_activity_at DESC);

-- Challenge Accounts
CREATE INDEX idx_challenges_trader ON challenge_accounts(trader_id);
CREATE INDEX idx_challenges_status ON challenge_accounts(status) WHERE status = 'active';
CREATE INDEX idx_challenges_type ON challenge_accounts(trader_id, type);
CREATE INDEX idx_challenges_expiry ON challenge_accounts(expires_at) WHERE status = 'active';

-- Trading Accounts
CREATE INDEX idx_trading_accounts_trader ON trading_accounts(trader_id);
CREATE INDEX idx_trading_accounts_challenge ON trading_accounts(challenge_id);
CREATE INDEX idx_trading_accounts_status ON trading_accounts(status) WHERE status = 'active';
CREATE INDEX idx_trading_accounts_code ON trading_accounts(account_code);

-- Broker Sessions
CREATE INDEX idx_broker_sessions_account ON broker_sessions(trading_account_id) WHERE is_active = TRUE;
CREATE INDEX idx_broker_sessions_expiry ON broker_sessions(session_expiry) WHERE is_active = TRUE;

-- Risk Rules
CREATE INDEX idx_risk_rules_account ON risk_rules(trading_account_id) WHERE is_active = TRUE;

-- Trading Orders
CREATE INDEX idx_orders_account_time ON trading_orders(trading_account_id, placed_at DESC);
CREATE INDEX idx_orders_status ON trading_orders(trading_account_id, status) WHERE status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED');
CREATE INDEX idx_orders_symbol ON trading_orders(symbol, trading_account_id);
CREATE INDEX idx_orders_group ON trading_orders(order_group_id) WHERE order_group_id IS NOT NULL;
CREATE INDEX idx_orders_parent ON trading_orders(parent_order_id) WHERE parent_order_id IS NOT NULL;
CREATE INDEX idx_orders_broker ON trading_orders(broker_order_id) WHERE broker_order_id IS NOT NULL;
CREATE INDEX idx_orders_placed_date ON trading_orders(trading_account_id, (placed_at::date));

-- Positions
CREATE INDEX idx_positions_open ON positions(trading_account_id) WHERE is_open = TRUE;
CREATE INDEX idx_positions_symbol ON positions(symbol, trading_account_id) WHERE is_open = TRUE;
CREATE INDEX idx_positions_closed ON positions(trading_account_id, closed_at DESC) WHERE is_open = FALSE;

-- Executions
CREATE INDEX idx_executions_account_time ON executions(trading_account_id, executed_at DESC);
CREATE INDEX idx_executions_order ON executions(order_id);
CREATE INDEX idx_executions_position ON executions(position_id);
CREATE INDEX idx_executions_symbol ON executions(symbol, trading_account_id);
CREATE INDEX idx_executions_date ON executions(trading_account_id, (executed_at::date));

-- Execution Audits
CREATE INDEX idx_audits_account ON execution_audits(trading_account_id, created_at DESC);
CREATE INDEX idx_audits_order ON execution_audits(order_id);
CREATE INDEX idx_audits_type ON execution_audits(audit_type, trading_account_id);
CREATE INDEX idx_audits_failed ON execution_audits(trading_account_id) WHERE all_passed = FALSE;

-- Watchlists
CREATE INDEX idx_watchlists_trader ON watchlists(trader_id);
CREATE INDEX idx_watchlists_sort ON watchlists(trader_id, sort_order);

-- Account Metrics
CREATE INDEX idx_metrics_account_date ON account_metrics(trading_account_id, date DESC);
CREATE INDEX idx_metrics_challenge ON account_metrics(challenge_id, date DESC);

-- Risk Events
CREATE INDEX idx_risk_events_account ON risk_events(trading_account_id, created_at DESC);
CREATE INDEX idx_risk_events_challenge ON risk_events(challenge_id, created_at DESC);
CREATE INDEX idx_risk_events_type ON risk_events(event_type, trading_account_id);
CREATE INDEX idx_risk_events_severity ON risk_events(severity) WHERE severity = 'critical';
CREATE INDEX idx_risk_events_unacked ON risk_events(trading_account_id) WHERE acknowledged = FALSE;

-- Challenge Progress
CREATE INDEX idx_progress_challenge ON challenge_progress(challenge_id, date DESC);
CREATE INDEX idx_progress_account ON challenge_progress(trading_account_id, date DESC);
CREATE INDEX idx_progress_breach ON challenge_progress(challenge_id) WHERE breach_occurred = TRUE;

-- Alerts
CREATE INDEX idx_alerts_trader ON alerts(trader_id) WHERE is_active = TRUE;
CREATE INDEX idx_alerts_token ON alerts(token) WHERE is_active = TRUE AND is_triggered = FALSE;
CREATE INDEX idx_alerts_triggered ON alerts(trader_id, triggered_at DESC) WHERE is_triggered = TRUE;

-- Layouts
CREATE INDEX idx_layouts_trader ON layouts(trader_id);
CREATE INDEX idx_layouts_active ON layouts(trader_id) WHERE is_active = TRUE;

-- Themes
CREATE INDEX idx_themes_trader ON themes(trader_id);
CREATE INDEX idx_themes_active ON themes(trader_id) WHERE is_active = TRUE;

-- Journal Entries
CREATE INDEX idx_journal_trader ON journal_entries(trader_id, entry_date DESC);
CREATE INDEX idx_journal_account ON journal_entries(trading_account_id, entry_date DESC);
CREATE INDEX idx_journal_symbol ON journal_entries(symbol, trader_id);
CREATE INDEX idx_journal_emotion ON journal_entries(emotion, trader_id);
CREATE INDEX idx_journal_rating ON journal_entries(rating, trader_id);
CREATE INDEX idx_journal_tags ON journal_entries USING GIN(tags);

-- Analytics Snapshots
CREATE INDEX idx_analytics_account ON analytics_snapshots(trading_account_id, period_type, period_start DESC);
CREATE INDEX idx_analytics_challenge ON analytics_snapshots(challenge_id, period_type);
CREATE INDEX idx_analytics_latest ON analytics_snapshots(trading_account_id, computed_at DESC);
