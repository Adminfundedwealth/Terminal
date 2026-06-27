/**
 * Apply migrations via direct PostgreSQL connection.
 * Supabase exposes a direct connection at:
 *   postgresql://postgres.[ref]:[db-password]@db.[ref].supabase.co:5432/postgres
 * 
 * OR via the pooler (transaction mode):
 *   postgresql://postgres.[ref]:[db-password]@aws-0-[region].pooler.supabase.com:6543/postgres
 *
 * If DB_PASSWORD is not set, we'll try using the service role JWT as password
 * (works for some Supabase setups).
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const PROJECT_REF = 'nysrxvpjdlvzvcawysvh';
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Try multiple connection methods
const CONNECTION_STRINGS = [
  // Direct connection (session mode)
  DB_PASSWORD ? `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@db.${PROJECT_REF}.supabase.co:5432/postgres` : null,
  // Pooler (transaction mode)  
  DB_PASSWORD ? `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres` : null,
  // Alternative: direct with postgres user
  DB_PASSWORD ? `postgresql://postgres:${encodeURIComponent(DB_PASSWORD)}@db.${PROJECT_REF}.supabase.co:5432/postgres` : null,
].filter(Boolean);

async function tryConnect(connStr) {
  const client = new pg.Client({ 
    connectionString: connStr, 
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  try {
    await client.connect();
    const res = await client.query('SELECT current_database(), current_user');
    console.log(`  ✓ Connected as ${res.rows[0].current_user} to ${res.rows[0].current_database}`);
    return client;
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message.substring(0, 80)}`);
    try { await client.end(); } catch(e) {}
    return null;
  }
}

async function applyFile(client, filePath, label) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ ${label}`);
  console.log('─'.repeat(50));
  
  const sql = readFileSync(filePath, 'utf-8');
  
  try {
    await client.query(sql);
    console.log('  ✓ APPLIED (full file)');
    return { success: true, method: 'full' };
  } catch (err) {
    console.log(`  ⚠ Full-file error: ${err.message.substring(0, 80)}`);
    console.log('  Retrying statement-by-statement...');
    
    // Split and apply individually
    const statements = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s.replace(/--[^\n]*/g, '').trim().length > 0);
    
    let passed = 0, existing = 0, failed = 0, failures = [];
    
    for (let i = 0; i < statements.length; i++) {
      try {
        await client.query(statements[i]);
        passed++;
      } catch (stmtErr) {
        const msg = stmtErr.message || '';
        if (msg.includes('already exists') || stmtErr.code === '42P07' || stmtErr.code === '42710') {
          existing++;
        } else {
          failed++;
          if (failures.length < 5) {
            failures.push({ idx: i+1, err: msg.substring(0, 80), stmt: statements[i].substring(0, 50) });
          }
        }
      }
    }
    
    console.log(`  Applied: ${passed} | Existing: ${existing} | Failed: ${failed}`);
    failures.forEach(f => console.log(`    ✗ [${f.idx}] ${f.stmt}... → ${f.err}`));
    return { success: failed === 0, passed, existing, failed };
  }
}

async function verifyTables(supabase) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log('SECTION A — TABLE EXISTENCE');
  console.log('═'.repeat(50));
  
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
  console.log(`\n  TOTAL: ${count}/19`);
  return count;
}

async function verifyRLS(client) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log('SECTION B — RLS STATUS');
  console.log('═'.repeat(50));
  
  try {
    const res = await client.query(`
      SELECT tablename, rowsecurity 
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
    
    let rlsCount = 0;
    for (const row of res.rows) {
      const enabled = row.rowsecurity === true || row.rowsecurity === 't';
      if (enabled) rlsCount++;
      console.log(`  ${enabled ? '✓ YES' : '✗ NO '} | ${row.tablename}`);
    }
    console.log(`\n  RLS Enabled: ${rlsCount}/${res.rows.length}`);
    return rlsCount;
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return 0;
  }
}

async function verifyIndexes(client) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log('SECTION C — INDEX COUNT');
  console.log('═'.repeat(50));
  
  try {
    const res = await client.query(`
      SELECT count(*) as total FROM pg_indexes 
      WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
    `);
    const count = parseInt(res.rows[0].total);
    console.log(`  Custom indexes (idx_*): ${count}`);
    console.log(`  ${count > 50 ? '✓ YES' : '⚠ PARTIAL'} | Expected ~80+`);
    return count;
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log('═'.repeat(50));
  console.log(' FUNDEDWEALTH TERMINAL — MIGRATION');
  console.log('═'.repeat(50));
  
  if (!DB_PASSWORD) {
    console.log('\n⚠ SUPABASE_DB_PASSWORD not set in server/.env');
    console.log('  Add: SUPABASE_DB_PASSWORD=your-database-password');
    console.log('  (Find it in Supabase Dashboard > Settings > Database > Database password)');
    process.exit(1);
  }
  
  // Try connections
  console.log('\nConnecting to PostgreSQL...');
  let client = null;
  for (const connStr of CONNECTION_STRINGS) {
    const masked = connStr.replace(/:([^@]+)@/, ':****@');
    console.log(`  Trying: ${masked.substring(0, 70)}...`);
    client = await tryConnect(connStr);
    if (client) break;
  }
  
  if (!client) {
    console.log('\n✗ All connection attempts failed.');
    process.exit(1);
  }
  
  // Apply migrations
  const m1 = await applyFile(client, resolve(__dirname, 'migrations/001_terminal_schema.sql'), '001 — Schema (19 tables)');
  const m2 = await applyFile(client, resolve(__dirname, 'migrations/002_indexes.sql'), '002 — Indexes');
  const m3 = await applyFile(client, resolve(__dirname, 'migrations/003_rls_policies.sql'), '003 — RLS Policies');
  
  // Verify via Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  const tableCount = await verifyTables(supabase);
  const rlsCount = await verifyRLS(client);
  const idxCount = await verifyIndexes(client);
  
  await client.end();
  
  // Final report
  console.log(`\n${'═'.repeat(50)}`);
  console.log(' FINAL REPORT');
  console.log('═'.repeat(50));
  console.log(`  Schema:  ${m1.success ? 'APPLIED ✓' : 'PARTIAL ⚠'}`);
  console.log(`  Indexes: ${m2.success ? 'APPLIED ✓' : 'PARTIAL ⚠'}`);
  console.log(`  RLS:     ${m3.success ? 'APPLIED ✓' : 'PARTIAL ⚠'}`);
  console.log(`  Tables:  ${tableCount}/19`);
  console.log(`  RLS:     ${rlsCount}/19`);
  console.log(`  Indexes: ${idxCount} custom`);
  console.log('═'.repeat(50));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
