import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function exec(sql) {
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) return { ok: false, error: error.message };
  if (data && data.success === false) return { ok: false, error: data.error };
  return { ok: true, data };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' PHASE 1 — DATABASE VERIFICATION');
  console.log('═══════════════════════════════════════════\n');
  
  // Notify PostgREST to reload schema (Supabase does this via pg_notify)
  await exec("NOTIFY pgrst, 'reload schema'");
  
  // Wait a moment for cache to refresh
  await new Promise(r => setTimeout(r, 2000));
  
  // SECTION A: Verify tables exist via exec_sql (proven to work)
  console.log('SECTION A — TABLE EXISTENCE (via exec_sql):');
  console.log('─────────────────────────────────────────');
  const tables = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'broker_sessions', 'risk_rules',
    'trading_orders', 'positions', 'executions', 'execution_audits',
    'watchlists', 'account_metrics', 'risk_events', 'challenge_progress',
    'alerts', 'layouts', 'themes', 'journal_entries', 'analytics_snapshots'
  ];
  
  let tableCount = 0;
  for (const t of tables) {
    const r = await exec(`SELECT count(*) FROM ${t}`);
    if (r.ok) tableCount++;
    console.log(`  ${r.ok ? '✓ YES' : '✗ NO '} | ${t}`);
  }
  console.log(`  TOTAL: ${tableCount}/19\n`);
  
  // SECTION B: Verify RLS
  console.log('SECTION B — RLS (via exec_sql):');
  console.log('─────────────────────────────────────────');
  // Check RLS by looking at pg_class for relrowsecurity
  for (const t of tables) {
    const r = await exec(`
      DO $$ BEGIN
        IF (SELECT relrowsecurity FROM pg_class WHERE relname = '${t}') THEN
          RAISE NOTICE 'enabled';
        ELSE
          RAISE EXCEPTION 'disabled';
        END IF;
      END $$
    `);
    console.log(`  ${r.ok ? '✓ YES' : '✗ NO '} | ${t}`);
  }
  
  // SECTION C: Verify indexes
  console.log('\nSECTION C — INDEXES (via exec_sql):');
  console.log('─────────────────────────────────────────');
  // Check specific important indexes exist
  const criticalIndexes = [
    'idx_traders_external', 'idx_sessions_token', 'idx_challenges_trader',
    'idx_trading_accounts_trader', 'idx_orders_account_time', 'idx_positions_open',
    'idx_executions_account_time', 'idx_audits_account', 'idx_watchlists_trader',
    'idx_metrics_account_date', 'idx_risk_events_account', 'idx_progress_challenge',
    'idx_alerts_trader', 'idx_layouts_trader', 'idx_themes_trader',
    'idx_journal_trader', 'idx_analytics_account'
  ];
  
  let idxCount = 0;
  for (const idx of criticalIndexes) {
    const r = await exec(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = '${idx}') THEN
          NULL;
        ELSE
          RAISE EXCEPTION 'not found';
        END IF;
      END $$
    `);
    if (r.ok) idxCount++;
    console.log(`  ${r.ok ? '✓ YES' : '✗ NO '} | ${idx}`);
  }
  console.log(`  VERIFIED: ${idxCount}/${criticalIndexes.length}\n`);
  
  // OLD TABLES
  console.log('OLD SCHEMA:');
  console.log('─────────────────────────────────────────');
  for (const t of ['users', 'sessions', 'challenges', 'accounts', 'orders', 'trades']) {
    const r = await exec(`SELECT count(*) FROM ${t}`);
    console.log(`  ${r.ok ? '⚠ EXISTS' : '✓ REMOVED'} | ${t}`);
  }
  
  console.log(`\n═══════════════════════════════════════════`);
  console.log(` SUMMARY`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`  Tables:  ${tableCount}/19`);
  console.log(`  Indexes: ${idxCount}/${criticalIndexes.length} critical verified`);
  console.log(`  Status:  ${tableCount === 19 ? 'PHASE 1 COMPLETE ✓' : 'INCOMPLETE'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
