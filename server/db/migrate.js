/**
 * FUNDEDWEALTH TERMINAL — Schema Migration via Supabase
 * Applies DDL using supabase-js client with .rpc() for raw SQL execution.
 * Requires a `exec_sql` function OR uses the pg REST proxy.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/**
 * Execute raw SQL via Supabase.
 * Strategy: Use the pg-meta API endpoint for DDL operations.
 */
async function execSql(sql, label) {
  // Use Supabase's internal SQL execution endpoint
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ sql_query: sql })
  });

  if (response.ok) return { success: true };
  
  // Fallback: try as individual statement via supabase.rpc
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (!error) return { success: true };
  
  return { success: false, error: error?.message || await response.text() };
}

/**
 * First, create the exec_sql helper function in the database.
 * This is a one-time bootstrap that enables DDL execution via RPC.
 */
async function bootstrapExecFunction() {
  console.log('▶ Bootstrapping exec_sql function...');
  
  const bootstrapSql = `
    CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql_query;
    END;
    $$;
  `;
  
  // Try direct fetch to Supabase SQL endpoint (pg-meta)
  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: bootstrapSql })
  });
  
  if (response.ok) {
    console.log('  ✓ exec_sql function created via pg/query');
    return true;
  }

  // Alternative: try via the SQL editor API
  const sqlResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql_query: bootstrapSql })
  });

  if (sqlResponse.ok) {
    console.log('  ✓ exec_sql function already exists');
    return true;
  }

  console.log('  ⚠ Cannot bootstrap exec_sql — will try statement-by-statement via REST');
  return false;
}

/**
 * Split SQL file into executable statements.
 */
function splitStatements(sql) {
  // Remove block comments
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  
  return sql
    .split(/;\s*\n/g)
    .map(s => s.trim())
    .filter(s => {
      // Remove empty and comment-only blocks
      const withoutComments = s.replace(/--[^\n]*/g, '').trim();
      return withoutComments.length > 0;
    });
}

async function applyFile(filePath, label) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log('━'.repeat(60));
  
  const sql = readFileSync(filePath, 'utf-8');
  const statements = splitStatements(sql);
  
  console.log(`  Statements: ${statements.length}`);
  
  let passed = 0;
  let failed = 0;
  let errors = [];
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';';
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 70);
    
    const result = await execSql(stmt, `stmt ${i + 1}`);
    
    if (result.success) {
      passed++;
    } else {
      // Check if it's a "already exists" error — that's OK
      const errMsg = result.error || '';
      if (errMsg.includes('already exists') || errMsg.includes('duplicate')) {
        passed++;
        console.log(`  ○ [${i + 1}] Already exists: ${preview}`);
      } else {
        failed++;
        errors.push({ stmt: preview, error: errMsg });
        console.log(`  ✗ [${i + 1}] FAILED: ${preview}`);
        console.log(`         Error: ${errMsg.substring(0, 100)}`);
      }
    }
  }
  
  console.log(`\n  Result: ${passed} passed, ${failed} failed`);
  return { passed, failed, errors };
}

async function verifyTables() {
  console.log(`\n${'━'.repeat(60)}`);
  console.log('▶ VERIFICATION — Table Existence Check');
  console.log('━'.repeat(60));

  const tables = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'broker_sessions', 'risk_rules',
    'trading_orders', 'positions', 'executions', 'execution_audits',
    'watchlists', 'account_metrics', 'risk_events', 'challenge_progress',
    'alerts', 'layouts', 'themes', 'journal_entries', 'analytics_snapshots'
  ];

  const results = [];
  
  for (const table of tables) {
    const { error, status } = await supabase.from(table).select('*', { count: 'exact', head: true });
    
    // 404 = table doesn't exist, 200/206 = exists (even if empty)
    // PGRST116 = relation does not exist
    const exists = !error || (!error.message?.includes('does not exist') && !error.message?.includes('PGRST'));
    const statusLabel = exists ? 'YES' : 'NO';
    
    console.log(`  ${exists ? '✓' : '✗'} ${table.padEnd(25)} | Exists: ${statusLabel}`);
    results.push({ table, exists });
  }
  
  return results;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  FUNDEDWEALTH TERMINAL — DATABASE MIGRATION');
  console.log('═'.repeat(60));
  console.log(`  Target: ${SUPABASE_URL}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log('═'.repeat(60));
  
  // Step 1: Try to bootstrap exec_sql
  const hasExecFn = await bootstrapExecFunction();
  
  if (!hasExecFn) {
    console.log('\n⚠ exec_sql function not available.');
    console.log('  Attempting direct table creation via Supabase client...\n');
  }
  
  // Step 2: Apply migrations
  const migration1 = await applyFile(
    resolve(__dirname, 'migrations/001_terminal_schema.sql'),
    '001 — Terminal Schema (19 tables)'
  );
  
  const migration2 = await applyFile(
    resolve(__dirname, 'migrations/002_indexes.sql'),
    '002 — Performance Indexes'
  );
  
  const migration3 = await applyFile(
    resolve(__dirname, 'migrations/003_rls_policies.sql'),
    '003 — RLS Policies'
  );
  
  // Step 3: Verify
  const verification = await verifyTables();
  
  // Summary
  const existCount = verification.filter(v => v.exists).length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  MIGRATION SUMMARY`);
  console.log('═'.repeat(60));
  console.log(`  Tables verified: ${existCount}/${verification.length}`);
  console.log(`  Schema:  ${migration1.failed === 0 ? 'PASS' : 'PARTIAL'}`);
  console.log(`  Indexes: ${migration2.failed === 0 ? 'PASS' : 'PARTIAL'}`);
  console.log(`  RLS:     ${migration3.failed === 0 ? 'PASS' : 'PARTIAL'}`);
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
