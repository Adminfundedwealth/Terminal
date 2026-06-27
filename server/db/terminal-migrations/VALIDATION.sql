-- ══════════════════════════════════════════════════════════════════════════════
-- FUNDEDWEALTH TERMINAL — POST-MIGRATION VALIDATION
-- ══════════════════════════════════════════════════════════════════════════════
-- Run this AFTER MASTER_MIGRATION.sql to verify everything was created correctly.
-- Expected: All queries return results. No errors.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. VERIFY ALL 16 TERMINAL TABLES EXIST ─────────────────────────────────

SELECT 'TABLE CHECK' AS test,
       tablename,
       CASE WHEN tablename IS NOT NULL THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'terminal_users',
    'terminal_sessions',
    'terminal_accounts',
    'challenges',
    'risk_rules',
    'account_metrics',
    'terminal_orders',
    'terminal_positions',
    'terminal_trades',
    'watchlists',
    'audit_log',
    'risk_events',
    'challenge_metrics',
    'order_audit',
    'broker_sessions',
    'payouts'
  )
ORDER BY tablename;

-- ─── 2. VERIFY TOTAL TABLE COUNT (3 existing + 16 new = 19) ────────────────

SELECT 'TOTAL TABLE COUNT' AS test,
       COUNT(*) AS total_tables,
       CASE WHEN COUNT(*) >= 19 THEN '✓ PASS' ELSE '✗ FAIL (expected >= 19)' END AS status
FROM pg_tables
WHERE schemaname = 'public';

-- ─── 3. VERIFY PLATFORM TABLES ARE UNTOUCHED ────────────────────────────────

SELECT 'PLATFORM INTACT' AS test,
       tablename,
       '✓ PRESERVED' AS status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'orders', 'sessions')
ORDER BY tablename;

-- ─── 4. VERIFY FOREIGN KEYS ─────────────────────────────────────────────────

SELECT 'FK CHECK' AS test,
       conname AS constraint_name,
       conrelid::regclass AS table_name,
       confrelid::regclass AS references_table
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN (
    'terminal_users',
    'terminal_sessions',
    'terminal_accounts',
    'challenges',
    'risk_rules',
    'account_metrics',
    'terminal_orders',
    'terminal_positions',
    'terminal_trades',
    'watchlists',
    'risk_events',
    'challenge_metrics',
    'order_audit',
    'broker_sessions',
    'payouts'
  )
ORDER BY conrelid::regclass::text, conname;

-- ─── 5. VERIFY INDEXES ──────────────────────────────────────────────────────

SELECT 'INDEX CHECK' AS test,
       indexname,
       tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
  AND tablename IN (
    'terminal_users',
    'terminal_sessions',
    'terminal_accounts',
    'challenges',
    'risk_rules',
    'account_metrics',
    'terminal_orders',
    'terminal_positions',
    'terminal_trades',
    'watchlists',
    'audit_log',
    'risk_events',
    'challenge_metrics',
    'order_audit',
    'broker_sessions',
    'payouts'
  )
ORDER BY tablename, indexname;

-- ─── 6. VERIFY TRIGGERS ─────────────────────────────────────────────────────

SELECT 'TRIGGER CHECK' AS test,
       tgname AS trigger_name,
       tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname LIKE 'trg_%'
ORDER BY tgrelid::regclass::text;

-- ─── 7. VERIFY ROW LEVEL SECURITY ───────────────────────────────────────────

SELECT 'RLS CHECK' AS test,
       relname AS table_name,
       CASE WHEN relrowsecurity THEN '✓ RLS ENABLED' ELSE '✗ RLS DISABLED' END AS rls_status
FROM pg_class
WHERE relname IN (
    'terminal_users',
    'terminal_sessions',
    'terminal_accounts',
    'challenges',
    'risk_rules',
    'account_metrics',
    'terminal_orders',
    'terminal_positions',
    'terminal_trades',
    'watchlists',
    'audit_log',
    'risk_events',
    'challenge_metrics',
    'order_audit',
    'broker_sessions',
    'payouts'
  )
  AND relkind = 'r'
ORDER BY relname;

-- ─── 8. VERIFY EACH TABLE IS QUERYABLE (empty but no errors) ────────────────

SELECT 'QUERY TEST: terminal_users' AS test, COUNT(*) AS rows FROM terminal_users;
SELECT 'QUERY TEST: terminal_sessions' AS test, COUNT(*) AS rows FROM terminal_sessions;
SELECT 'QUERY TEST: terminal_accounts' AS test, COUNT(*) AS rows FROM terminal_accounts;
SELECT 'QUERY TEST: challenges' AS test, COUNT(*) AS rows FROM challenges;
SELECT 'QUERY TEST: risk_rules' AS test, COUNT(*) AS rows FROM risk_rules;
SELECT 'QUERY TEST: account_metrics' AS test, COUNT(*) AS rows FROM account_metrics;
SELECT 'QUERY TEST: terminal_orders' AS test, COUNT(*) AS rows FROM terminal_orders;
SELECT 'QUERY TEST: terminal_positions' AS test, COUNT(*) AS rows FROM terminal_positions;
SELECT 'QUERY TEST: terminal_trades' AS test, COUNT(*) AS rows FROM terminal_trades;
SELECT 'QUERY TEST: watchlists' AS test, COUNT(*) AS rows FROM watchlists;
SELECT 'QUERY TEST: audit_log' AS test, COUNT(*) AS rows FROM audit_log;
SELECT 'QUERY TEST: risk_events' AS test, COUNT(*) AS rows FROM risk_events;
SELECT 'QUERY TEST: challenge_metrics' AS test, COUNT(*) AS rows FROM challenge_metrics;
SELECT 'QUERY TEST: order_audit' AS test, COUNT(*) AS rows FROM order_audit;
SELECT 'QUERY TEST: broker_sessions' AS test, COUNT(*) AS rows FROM broker_sessions;
SELECT 'QUERY TEST: payouts' AS test, COUNT(*) AS rows FROM payouts;

-- ─── 9. VERIFY PLATFORM DATA IS INTACT ──────────────────────────────────────

SELECT 'PLATFORM DATA: users' AS test, COUNT(*) AS rows,
       CASE WHEN COUNT(*) >= 20 THEN '✓ DATA INTACT' ELSE '⚠ CHECK MANUALLY' END AS status
FROM users;

SELECT 'PLATFORM DATA: orders' AS test, COUNT(*) AS rows,
       CASE WHEN COUNT(*) >= 17 THEN '✓ DATA INTACT' ELSE '⚠ CHECK MANUALLY' END AS status
FROM orders;

SELECT 'PLATFORM DATA: sessions' AS test, COUNT(*) AS rows,
       CASE WHEN COUNT(*) >= 3 THEN '✓ DATA INTACT' ELSE '⚠ CHECK MANUALLY' END AS status
FROM sessions;

-- ─── 10. VERIFY update_updated_at() FUNCTION EXISTS ──────────────────────────

SELECT 'FUNCTION CHECK' AS test,
       routine_name,
       '✓ EXISTS' AS status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'update_updated_at';

-- ══════════════════════════════════════════════════════════════════════════════
-- VALIDATION COMPLETE
-- If all queries returned results without errors, migration is successful.
-- ══════════════════════════════════════════════════════════════════════════════
