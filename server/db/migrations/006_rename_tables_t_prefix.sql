-- ============================================================
-- MIGRATION 006: Rename tables to t_ prefix for terminal isolation
-- Prevents collision with FundedWealth Dashboard tables
-- ============================================================

-- Rename core tables
ALTER TABLE IF EXISTS users RENAME TO t_users;
ALTER TABLE IF EXISTS challenges RENAME TO t_challenges;
ALTER TABLE IF EXISTS accounts RENAME TO t_accounts;
ALTER TABLE IF EXISTS risk_rules RENAME TO t_risk_rules;
ALTER TABLE IF EXISTS orders RENAME TO t_orders;
ALTER TABLE IF EXISTS positions RENAME TO t_positions;
ALTER TABLE IF EXISTS trades RENAME TO t_trades;
ALTER TABLE IF EXISTS watchlists RENAME TO t_watchlists;
ALTER TABLE IF EXISTS account_metrics RENAME TO t_account_metrics;
ALTER TABLE IF EXISTS sessions RENAME TO t_sessions;

-- Rename indexes to match new table names
ALTER INDEX IF EXISTS idx_accounts_user RENAME TO idx_t_accounts_user;
ALTER INDEX IF EXISTS idx_accounts_challenge RENAME TO idx_t_accounts_challenge;
ALTER INDEX IF EXISTS idx_orders_account_time RENAME TO idx_t_orders_account_time;
ALTER INDEX IF EXISTS idx_orders_status RENAME TO idx_t_orders_status;
ALTER INDEX IF EXISTS idx_positions_open RENAME TO idx_t_positions_open;
ALTER INDEX IF EXISTS idx_trades_account_time RENAME TO idx_t_trades_account_time;
ALTER INDEX IF EXISTS idx_metrics_account_date RENAME TO idx_t_metrics_account_date;
ALTER INDEX IF EXISTS idx_sessions_token RENAME TO idx_t_sessions_token;
ALTER INDEX IF EXISTS idx_watchlists_user RENAME TO idx_t_watchlists_user;

-- Update RLS (policies reference table names automatically)
-- No action needed — RLS policies follow the renamed table.
