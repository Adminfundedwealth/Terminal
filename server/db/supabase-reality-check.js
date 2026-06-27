/**
 * SUPABASE REALITY AUDIT
 * Discovers actual tables, columns, and row counts in the connected Supabase instance.
 */
import { supabase } from './client.js';
import { writeFileSync } from 'fs';

const CANDIDATE_TABLES = [
  // Bare names (Dashboard tables)
  'users', 'accounts', 'challenges', 'orders', 'positions',
  'trades', 'sessions', 'watchlists', 'risk_rules', 'account_metrics',
  'audit_log', 'broker_sessions',
  // t_ prefixed (Terminal isolation)
  't_users', 't_accounts', 't_challenges', 't_orders', 't_positions',
  't_trades', 't_sessions', 't_watchlists', 't_risk_rules', 't_account_metrics',
  't_broker_sessions', 't_risk_events', 't_challenge_metrics', 't_order_audit',
  // Other possible
  'profiles', 'subscriptions', 'payments', 'plans',
];

async function main() {
  if (!supabase) { console.error('No supabase'); process.exit(1); }
  const results = { timestamp: new Date().toISOString(), tables: {} };

  for (const table of CANDIDATE_TABLES) {
    try {
      const { data, error, count } = await supabase
        .from(table).select('*', { count: 'exact', head: false }).limit(2);
      if (error) {
        results.tables[table] = { exists: false, error: error.message };
      } else {
        const cols = data && data.length > 0 ? Object.keys(data[0]) : [];
        results.tables[table] = {
          exists: true,
          columns: cols,
          rowCount: count,
          sampleRow: data && data.length > 0 ? data[0] : null,
        };
      }
    } catch (e) {
      results.tables[table] = { exists: false, error: e.message };
    }
  }

  writeFileSync('db/supabase-reality-results.json', JSON.stringify(results, null, 2));

  // Print summary
  console.log('=== SUPABASE REALITY AUDIT ===\n');
  const existing = Object.entries(results.tables).filter(([,v]) => v.exists);
  const missing = Object.entries(results.tables).filter(([,v]) => !v.exists);

  console.log(`EXISTING TABLES (${existing.length}):`);
  for (const [name, info] of existing) {
    console.log(`  ✓ ${name} — ${info.columns.length} cols, ${info.rowCount ?? '?'} rows`);
    console.log(`    Columns: ${info.columns.join(', ')}`);
  }
  console.log(`\nMISSING TABLES (${missing.length}):`);
  for (const [name] of missing) {
    console.log(`  ✗ ${name}`);
  }
  console.log('\nResults: server/db/supabase-reality-results.json');
}

main().then(() => process.exit(0));
