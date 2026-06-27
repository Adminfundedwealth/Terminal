/**
 * FULL DATABASE MIGRATION — Creates all required tables
 * 
 * Runs migrations 004 + 005 + 006 via Supabase RPC (raw SQL).
 * Uses the service role key which bypasses RLS.
 * 
 * Usage: node server/db/migrate-all.js
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function runSQL(sql, label) {
  console.log(`\n▶ Running: ${label}...`);
  const { error } = await supabase.rpc('exec_sql', { sql_text: sql });
  if (error) {
    // Try alternate approach - split by statement
    console.log(`  RPC not available, splitting statements...`);
    return false;
  }
  console.log(`  ✓ ${label} complete`);
  return true;
}

async function createTableDirect(tableDef) {
  // Use supabase raw query via postgrest - this won't work for DDL
  // We need to use the SQL editor approach
  const { error } = await supabase.from('_temp_check').select('*').limit(0);
  return !error;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' FUNDEDWEALTH TERMINAL — Database Migration');
  console.log('═══════════════════════════════════════════');
  console.log(`URL: ${SUPABASE_URL}`);
  console.log('');

  // Read migration files
  const migration004 = readFileSync(join(__dirname, 'migrations', '004_terminal_tables.sql'), 'utf8');
  const migration005 = readFileSync(join(__dirname, 'migrations', '005_persistence_tables.sql'), 'utf8');
  const migration006 = readFileSync(join(__dirname, 'migrations', '006_phase_progression.sql'), 'utf8');

  // Supabase JS client cannot run DDL statements directly.
  // We need to output the SQL for manual execution in the Supabase SQL Editor,
  // OR use the Management API.

  // Try using the Management API with the service key
  const sqlStatements = [migration004, migration005, migration006].join('\n\n');

  // Attempt via Supabase HTTP SQL endpoint
  const sqlUrl = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    
    if (resp.status === 404) {
      // No RPC available - use pg directly
      console.log('RPC not available. Using direct pg connection...');
    }
  } catch (e) {
    // Expected
  }

  // Use pg library for direct SQL execution
  const { default: pg } = await import('pg');
  
  // Extract connection details from Supabase URL
  // Format: https://xxx.supabase.co -> postgres connection
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
  const pgHost = `db.${projectRef}.supabase.co`;
  
  const pool = new pg.Pool({
    host: pgHost,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: SUPABASE_SERVICE_KEY,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL directly\n');

    // Run migration 004
    console.log('▶ Migration 004: Terminal Tables...');
    await client.query(migration004);
    console.log('  ✓ Core tables created');

    // Run migration 005
    console.log('▶ Migration 005: Persistence Tables...');
    await client.query(migration005);
    console.log('  ✓ Audit/event tables created');

    // Run migration 006
    console.log('▶ Migration 006: Phase Progression...');
    await client.query(migration006);
    console.log('  ✓ Phase progression tables created');

    // Create audit_log and broker_sessions (from 004_foundation_hardening)
    console.log('▶ Creating audit_log and broker_sessions...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID,
        user_id UUID,
        event_type TEXT NOT NULL,
        event_data JSONB DEFAULT '{}',
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type);

      CREATE TABLE IF NOT EXISTS broker_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID,
        provider TEXT NOT NULL,
        client_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected',
        connected_at TIMESTAMPTZ DEFAULT NOW(),
        disconnected_at TIMESTAMPTZ,
        error_message TEXT,
        metadata JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_broker_sessions_acct ON broker_sessions(account_id);
    `);
    console.log('  ✓ Foundation tables created');

    client.release();
    
    console.log('\n═══════════════════════════════════════════');
    console.log(' ALL MIGRATIONS COMPLETE');
    console.log('═══════════════════════════════════════════');

  } catch (err) {
    console.error(`\n❌ Migration failed: ${err.message}`);
    console.error('\nIf direct pg connection fails, run these SQL files manually');
    console.error('in Supabase Dashboard → SQL Editor:');
    console.error('  1. server/db/migrations/004_terminal_tables.sql');
    console.error('  2. server/db/migrations/005_persistence_tables.sql');
    console.error('  3. server/db/migrations/006_phase_progression.sql');
    console.error('\nThen run: node server/db/setup.js');
    
    // Write combined SQL for manual execution
    const combinedPath = join(__dirname, 'FULL_MIGRATION.sql');
    const combinedSQL = `-- FULL MIGRATION — Run in Supabase SQL Editor
-- Generated: ${new Date().toISOString()}

-- ═══ Migration 004: Terminal Tables ═══
${migration004}

-- ═══ Migration 005: Persistence Tables ═══
${migration005}

-- ═══ Migration 006: Phase Progression ═══
${migration006}

-- ═══ Foundation Tables ═══
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  user_id UUID,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type);

CREATE TABLE IF NOT EXISTS broker_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  provider TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_broker_sessions_acct ON broker_sessions(account_id);
`;
    
    const fs = await import('fs');
    fs.writeFileSync(combinedPath, combinedSQL);
    console.log(`\n📄 Combined SQL written to: server/db/FULL_MIGRATION.sql`);
    process.exit(1);
  } finally {
    await pool.end();
  }

  // Verify tables
  console.log('\nVerifying tables...');
  const tables = [
    't_users','t_challenges','t_accounts','t_risk_rules','t_orders','t_positions',
    't_trades','t_watchlists','t_account_metrics','t_sessions',
    'audit_log','broker_sessions','t_broker_sessions','t_risk_events',
    't_challenge_metrics','t_order_audit','t_payouts'
  ];

  let allGood = true;
  for (const t of tables) {
    const { error } = await supabase.from(t).select('id').limit(0);
    const ok = !error;
    console.log(`  ${ok ? '✓' : '✗'} ${t}`);
    if (!ok) allGood = false;
  }

  if (allGood) {
    console.log('\n✓ All 17 tables verified. Running seed...\n');
    // Run setup.js seed
    const { execSync } = await import('child_process');
    execSync('node db/setup.js', { cwd: join(__dirname, '..'), stdio: 'inherit' });
  }

  process.exit(0);
}

main();
