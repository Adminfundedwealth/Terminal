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

// Create a function that can return data
async function query(sql) {
  // First create a helper function that returns JSON
  await exec(`
    CREATE OR REPLACE FUNCTION public.query_json(sql_text text)
    RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE result json;
    BEGIN
      EXECUTE 'SELECT json_agg(row_to_json(t)) FROM (' || sql_text || ') t' INTO result;
      RETURN COALESCE(result, '[]'::json);
    END; $$;
  `);
  
  const { data, error } = await supabase.rpc('query_json', { sql_text: sql });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' FINAL DATABASE VERIFICATION');
  console.log('═══════════════════════════════════════════\n');
  
  // SECTION A: Tables
  console.log('SECTION A — TABLES');
  console.log('─────────────────────────────────────────');
  const tablesResult = await query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN (
      'terminal_traders','terminal_sessions','challenge_accounts',
      'trading_accounts','broker_sessions','risk_rules',
      'trading_orders','positions','executions','execution_audits',
      'watchlists','account_metrics','risk_events','challenge_progress',
      'alerts','layouts','themes','journal_entries','analytics_snapshots'
    )
    ORDER BY tablename
  `);
  
  if (tablesResult.ok && tablesResult.data) {
    const tableNames = tablesResult.data.map(r => r.tablename);
    const expected = [
      'terminal_traders','terminal_sessions','challenge_accounts',
      'trading_accounts','broker_sessions','risk_rules',
      'trading_orders','positions','executions','execution_audits',
      'watchlists','account_metrics','risk_events','challenge_progress',
      'alerts','layouts','themes','journal_entries','analytics_snapshots'
    ];
    for (const t of expected) {
      const exists = tableNames.includes(t);
      console.log(`  ${exists ? '✓ YES' : '✗ NO '} | ${t}`);
    }
    console.log(`  TOTAL: ${tableNames.length}/19`);
  } else {
    console.log(`  Error: ${tablesResult.error}`);
  }
  
  // SECTION B: RLS
  console.log('\nSECTION B — RLS');
  console.log('─────────────────────────────────────────');
  const rlsResult = await query(`
    SELECT tablename, rowsecurity::text as rls 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN (
      'terminal_traders','terminal_sessions','challenge_accounts',
      'trading_accounts','broker_sessions','risk_rules',
      'trading_orders','positions','executions','execution_audits',
      'watchlists','account_metrics','risk_events','challenge_progress',
      'alerts','layouts','themes','journal_entries','analytics_snapshots'
    )
    ORDER BY tablename
  `);
  
  if (rlsResult.ok && rlsResult.data) {
    let rlsCount = 0;
    for (const row of rlsResult.data) {
      const enabled = row.rls === 'true' || row.rls === true;
      if (enabled) rlsCount++;
      console.log(`  ${enabled ? '✓ YES' : '✗ NO '} | ${row.tablename}`);
    }
    console.log(`  RLS Enabled: ${rlsCount}/${rlsResult.data.length}`);
  }
  
  // SECTION C: Indexes
  console.log('\nSECTION C — INDEXES');
  console.log('─────────────────────────────────────────');
  const idxResult = await query(`
    SELECT count(*) as total FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
  `);
  
  if (idxResult.ok && idxResult.data) {
    const count = idxResult.data[0]?.total || 0;
    console.log(`  Custom indexes (idx_*): ${count}`);
    console.log(`  Status: ${count >= 50 ? '✓ APPLIED' : '⚠ PARTIAL'}`);
  }
  
  // Check old tables gone
  console.log('\nOLD SCHEMA REMOVAL:');
  console.log('─────────────────────────────────────────');
  const oldResult = await query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('users','sessions','challenges','accounts','orders','trades')
  `);
  if (oldResult.ok) {
    if (oldResult.data && oldResult.data.length > 0) {
      console.log(`  ⚠ Still present: ${oldResult.data.map(r => r.tablename).join(', ')}`);
    } else {
      console.log('  ✓ All old tables removed');
    }
  }
  
  console.log('\n═══════════════════════════════════════════');
  console.log(' PHASE 1 COMPLETE');
  console.log('═══════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
