/**
 * Schema Verification Script
 * Verifies all 19 tables exist and checks column compatibility
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

const TABLES = [
  'terminal_traders', 'terminal_sessions', 'challenge_accounts',
  'trading_accounts', 'broker_sessions', 'risk_rules',
  'trading_orders', 'positions', 'executions',
  'execution_audits', 'watchlists', 'account_metrics',
  'risk_events', 'challenge_progress', 'alerts',
  'layouts', 'themes', 'journal_entries', 'analytics_snapshots'
];

async function verify() {
  console.log('═══════════════════════════════════════');
  console.log(' PHASE 1 — DATABASE VERIFICATION');
  console.log('═══════════════════════════════════════');
  console.log('');

  const results = [];
  for (const table of TABLES) {
    const { data, error } = await sb.from(table).select('id').limit(1);
    const exists = !error;
    results.push({ table, exists, error: error?.message });
    console.log(`  ${table.padEnd(22)} | ${exists ? 'YES ✓' : 'NO ✗ — ' + error.message}`);
  }

  console.log('');
  const allExist = results.every(r => r.exists);
  console.log(`  Schema Applied: ${allExist ? 'YES' : 'PARTIAL'}`);
  console.log(`  Tables: ${results.filter(r => r.exists).length}/${TABLES.length}`);
  console.log('');

  // Verify key columns exist (schema compatibility check)
  console.log('  Column Compatibility Checks:');

  // Check trading_accounts has trader_id (schema) vs user_id (old)
  const { data: taCols } = await sb.from('trading_accounts').select('*').limit(0);
  const { data: taCols2, error: taErr } = await sb.from('trading_accounts').select('trader_id').limit(1);
  console.log(`    trading_accounts.trader_id: ${taErr ? 'MISSING (uses user_id)' : 'EXISTS'}`);

  const { data: wCols, error: wErr } = await sb.from('watchlists').select('trader_id').limit(1);
  console.log(`    watchlists.trader_id:       ${wErr ? 'MISSING (uses user_id)' : 'EXISTS'}`);

  const { data: oCols, error: oErr } = await sb.from('trading_orders').select('trading_account_id').limit(1);
  console.log(`    orders.trading_account_id:  ${oErr ? 'MISSING' : 'EXISTS'}`);

  const { data: pCols, error: pErr } = await sb.from('positions').select('trading_account_id').limit(1);
  console.log(`    positions.trading_account_id: ${pErr ? 'MISSING' : 'EXISTS'}`);

  const { data: eCols, error: eErr } = await sb.from('executions').select('trading_account_id').limit(1);
  console.log(`    executions.trading_account_id: ${eErr ? 'MISSING' : 'EXISTS'}`);

  const { data: mCols, error: mErr } = await sb.from('account_metrics').select('trading_account_id').limit(1);
  console.log(`    metrics.trading_account_id:  ${mErr ? 'MISSING' : 'EXISTS'}`);

  const { data: rCols, error: rErr } = await sb.from('risk_events').select('trading_account_id').limit(1);
  console.log(`    risk_events.trading_account_id: ${rErr ? 'MISSING' : 'EXISTS'}`);

  const { data: cpCols, error: cpErr } = await sb.from('challenge_progress').select('trading_account_id').limit(1);
  console.log(`    progress.trading_account_id: ${cpErr ? 'MISSING' : 'EXISTS'}`);

  const { data: eaCols, error: eaErr } = await sb.from('execution_audits').select('trading_account_id').limit(1);
  console.log(`    audits.trading_account_id:   ${eaErr ? 'MISSING' : 'EXISTS'}`);

  const { data: bsCols, error: bsErr } = await sb.from('broker_sessions').select('trading_account_id').limit(1);
  console.log(`    broker_sessions.trading_account_id: ${bsErr ? 'MISSING' : 'EXISTS'}`);

  console.log('');
  console.log('═══════════════════════════════════════');
}

verify().catch(e => console.error('FATAL:', e.message));
