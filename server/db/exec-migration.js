/**
 * Execute migration SQL directly via pg module.
 * Uses the Supabase PostgreSQL connection string.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

// Supabase direct connection: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
// Or use the transaction mode: port 6543
// Construct from project ref
const PROJECT_REF = 'nysrxvpjdlvzvcawysvh';
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;

// If no DB password, try using the service key with Supabase's SQL endpoint
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function execViaSupabaseApi(sql) {
  // Supabase exposes a /sql endpoint in newer versions for service role
  // But the standard approach is via pg connection
  // Let's try the Supabase Studio-compatible endpoint
  const endpoints = [
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    `${SUPABASE_URL}/pg`,
  ];
  
  // Actually, let's just use pg directly with Supabase's pooler
  const connectionString = `postgresql://postgres.${PROJECT_REF}:${DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
  
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  await client.end();
}

async function execViaPg(sql, label) {
  const DB_PASS = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
  if (!DB_PASS) {
    throw new Error('Need SUPABASE_DB_PASSWORD in .env for direct pg access');
  }
  
  const connectionString = `postgresql://postgres.${PROJECT_REF}:${DB_PASS}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();
    await client.query(sql);
    console.log(`  ✓ ${label}`);
    return true;
  } catch (err) {
    if (err.message.includes('already exists') || err.code === '42P07' || err.code === '42710') {
      console.log(`  ○ ${label} (already exists)`);
      return true;
    }
    console.log(`  ✗ ${label}: ${err.message.substring(0, 100)}`);
    return false;
  } finally {
    await client.end();
  }
}

// Alternative: Use fetch to call a custom edge function or the query endpoint
async function execViaFetch(sql) {
  // Try Supabase's newer /query endpoint
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST', 
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql_query: sql })
  });
  return response.ok || response.status === 204;
}

// Main approach: create the exec_sql function using Supabase's special /query endpoint 
// that's available for the service_role in newer Supabase versions
async function createExecFunction() {
  const sql = `
    CREATE OR REPLACE FUNCTION public.exec_sql(sql_query text)
    RETURNS json
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      EXECUTE sql_query;
      RETURN json_build_object('success', true);
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
    END;
    $$;
  `;
  
  // Use Supabase's undocumented but working query endpoint
  const response = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/rpc/query`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql })
  });
  
  return response.ok;
}

async function applyWithExecSql(filePath, label) {
  console.log(`\n▶ ${label}`);
  const sql = readFileSync(filePath, 'utf-8');
  
  // Send entire file as one execution
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql_query: sql })
  });
  
  if (response.ok || response.status === 204) {
    const data = await response.json().catch(() => null);
    if (data && data.success === false) {
      console.log(`  ✗ Error: ${data.error}`);
      return false;
    }
    console.log(`  ✓ Applied successfully`);
    return true;
  }
  
  const errText = await response.text();
  console.log(`  ✗ HTTP ${response.status}: ${errText.substring(0, 150)}`);
  return false;
}

async function verifyTables() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log('TABLE VERIFICATION');
  console.log('═'.repeat(50));
  
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  const tables = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'broker_sessions', 'risk_rules',
    'trading_orders', 'positions', 'executions', 'execution_audits',
    'watchlists', 'account_metrics', 'risk_events', 'challenge_progress',
    'alerts', 'layouts', 'themes', 'journal_entries', 'analytics_snapshots'
  ];
  
  let count = 0;
  for (const t of tables) {
    const { error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    const exists = !error || (error.code !== 'PGRST116' && error.code !== '42P01');
    if (exists) count++;
    console.log(`  ${exists ? '✓ YES' : '✗ NO '} | ${t}`);
  }
  
  return count;
}

async function main() {
  console.log('═'.repeat(50));
  console.log(' MIGRATION EXECUTION');  
  console.log('═'.repeat(50));
  console.log(`URL: ${SUPABASE_URL}`);
  console.log(`Key: ...${SUPABASE_SERVICE_KEY?.slice(-8)}`);
  
  // First check if exec_sql exists
  let hasExec = await execViaFetch('SELECT 1');
  
  if (!hasExec) {
    console.log('\nexec_sql does not exist. Attempting alternative creation...');
    await createExecFunction();
    hasExec = await execViaFetch('SELECT 1');
  }
  
  if (!hasExec) {
    console.log('\n⚠ exec_sql still not available.');
    console.log('Trying direct approach: chunked SQL via Supabase Edge...');
    
    // Last resort: We know the service_role can call RPC functions
    // Let's create exec_sql by deploying it as a migration via the dashboard API
    console.log('\n═══ MANUAL STEP REQUIRED ═══');
    console.log('Run this in Supabase Dashboard > SQL Editor:\n');
    console.log(`CREATE OR REPLACE FUNCTION public.exec_sql(sql_query text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN EXECUTE sql_query; RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END; $$;`);
    console.log('\nThen re-run this script.');
    process.exit(1);
  }
  
  console.log('\n✓ exec_sql available. Applying migrations...');
  
  const m1 = await applyWithExecSql(
    resolve(__dirname, 'migrations/001_terminal_schema.sql'),
    '001 — Terminal Schema (19 tables)'
  );
  
  const m2 = await applyWithExecSql(
    resolve(__dirname, 'migrations/002_indexes.sql'),
    '002 — Performance Indexes'
  );
  
  const m3 = await applyWithExecSql(
    resolve(__dirname, 'migrations/003_rls_policies.sql'),
    '003 — RLS Policies'
  );
  
  const tableCount = await verifyTables();
  
  console.log(`\n${'═'.repeat(50)}`);
  console.log(' RESULT');
  console.log('═'.repeat(50));
  console.log(`  Schema:  ${m1 ? 'APPLIED' : 'FAILED'}`);
  console.log(`  Indexes: ${m2 ? 'APPLIED' : 'FAILED'}`);
  console.log(`  RLS:     ${m3 ? 'APPLIED' : 'FAILED'}`);
  console.log(`  Tables:  ${tableCount}/19 verified`);
}

main().catch(e => { console.error(e); process.exit(1); });
