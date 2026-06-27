-- ══════════════════════════════════════════════════════════════════════════════
-- FUNDEDWEALTH TERMINAL — ROLLBACK MIGRATION
-- ══════════════════════════════════════════════════════════════════════════════
-- Use this to completely remove all 16 terminal tables.
-- Drop order respects FK dependencies (reverse of creation order).
-- 
-- SAFE: Platform tables (users, orders, sessions) are NEVER touched.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── DROP TRIGGERS FIRST ─────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_terminal_users_updated_at ON terminal_users;
DROP TRIGGER IF EXISTS trg_terminal_accounts_updated_at ON terminal_accounts;
DROP TRIGGER IF EXISTS trg_terminal_orders_updated_at ON terminal_orders;
DROP TRIGGER IF EXISTS trg_watchlists_updated_at ON watchlists;

-- ─── PHASE 5 TABLES (most dependent) ────────────────────────────────────────

DROP TABLE IF EXISTS order_audit CASCADE;
DROP TABLE IF EXISTS challenge_metrics CASCADE;
DROP TABLE IF EXISTS terminal_trades CASCADE;

-- ─── PHASE 4 TABLES ─────────────────────────────────────────────────────────

DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS broker_sessions CASCADE;
DROP TABLE IF EXISTS risk_events CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS terminal_positions CASCADE;
DROP TABLE IF EXISTS terminal_orders CASCADE;
DROP TABLE IF EXISTS account_metrics CASCADE;
DROP TABLE IF EXISTS risk_rules CASCADE;

-- ─── PHASE 3 TABLE ──────────────────────────────────────────────────────────

DROP TABLE IF EXISTS terminal_accounts CASCADE;

-- ─── PHASE 2 TABLES ─────────────────────────────────────────────────────────

DROP TABLE IF EXISTS watchlists CASCADE;
DROP TABLE IF EXISTS terminal_sessions CASCADE;
DROP TABLE IF EXISTS challenges CASCADE;

-- ─── PHASE 1 TABLE ──────────────────────────────────────────────────────────

DROP TABLE IF EXISTS terminal_users CASCADE;

-- ─── DROP TRIGGER FUNCTION ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK COMPLETE
-- 
-- Verify with:
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- 
-- Expected: Only platform tables remain (users, orders, sessions)
-- ══════════════════════════════════════════════════════════════════════════════
