/**
 * Apply terminal schema via Supabase REST SQL endpoint.
 * Uses the /rest/v1/rpc endpoint or falls back to direct HTTP to /sql.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import axios from 'axios';
import { config } from 'dotenv';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function applySchema() {
  const sqlPath = resolve(dirname(fileURLToPath(import.meta.url)), 'terminal-migrations/MASTER_TERMINAL_SCHEMA.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  console.log('═══════════════════════════════════════════════');
  console.log(' TERMINAL SCHEMA — Applying via Supabase SQL API');
  console.log('═══════════════════════════════════════════════');

  // Extract project ref from URL: https://[ref].supabase.co
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
  console.log(`  Project ref: ${projectRef}`);

  // Try the Supabase Management API SQL endpoint
  // POST https://api.supabase.com/v1/projects/{ref}/database/query
  // This requires the service key as a bearer token

  // Alternative: Use the PostgREST approach by creating a helper function first
  // Let's try executing CREATE TABLE statements individually via PostgREST

  // Split SQL into individual statements (excluding comments and empty lines)
  const statements = [];
  let current = '';
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      continue;
    }
    current += line + '\n';
    if (trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  console.log(`  Total statements: ${statements.length}`);
  console.log('');

  // Group: CREATE TABLE statements, CREATE INDEX, ALTER TABLE
  const createTables = statements.filter(s => s.toUpperCase().startsWith('CREATE TABLE'));
  const createIndexes = statements.filter(s => s.toUpperCase().startsWith('CREATE INDEX'));
  const alterTables = statements.filter(s => s.toUpperCase().startsWith('ALTER TABLE'));

  console.log(`  CREATE TABLE: ${createTables.length}`);
  console.log(`  CREATE INDEX: ${createIndexes.length}`);
  console.log(`  ALTER TABLE:  ${alterTables.length}`);
  console.log('');

  // Execute each statement via the pg connection through supabase's SQL execution
  // Since we don't have direct pg access, we'll use the Supabase HTTP API
  // The service role key gives us access to execute SQL via the /rest/v1/ endpoint
  // But PostgREST doesn't support DDL. We need the Management API.

  // Try the Supabase Management API
  const mgmtUrl = `https://${projectRef}.supabase.co/rest/v1/`;
  
  // Actually, the cleanest way without DATABASE_URL is to use 
  // the Supabase Dashboard SQL Editor manually, OR to attempt
  // connecting via the pooler connection string.
  // 
  // Supabase projects have a pooler at:
  // postgresql://postgres.[ref]:[db-password]@aws-0-[region].pooler.supabase.com:6543/postgres
  //
  // Let's try connecting via the standard Supabase pooler format

  // Extract password from service key (JWT contains the db password in some setups)
  // Actually, the service key is NOT the db password.
  // We need the actual database password.

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  MANUAL STEP REQUIRED                        ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log('║                                              ║');
  console.log('║  The Supabase REST API cannot execute DDL    ║');
  console.log('║  (CREATE TABLE, CREATE INDEX, ALTER TABLE).  ║');
  console.log('║                                              ║');
  console.log('║  Please run the SQL in ONE of these ways:    ║');
  console.log('║                                              ║');
  console.log('║  OPTION A: Supabase Dashboard → SQL Editor   ║');
  console.log('║  1. Go to https://supabase.com/dashboard     ║');
  console.log('║  2. Select your project                      ║');
  console.log('║  3. Go to SQL Editor                         ║');
  console.log('║  4. Paste the contents of:                   ║');
  console.log('║     server/db/terminal-migrations/            ║');
  console.log('║       MASTER_TERMINAL_SCHEMA.sql             ║');
  console.log('║  5. Click "Run"                              ║');
  console.log('║                                              ║');
  console.log('║  OPTION B: Add DATABASE_URL to server/.env   ║');
  console.log('║  Format:                                     ║');
  console.log('║  DATABASE_URL=postgresql://postgres.[ref]:    ║');
  console.log('║    [password]@aws-0-[region].pooler.          ║');
  console.log('║    supabase.com:6543/postgres                 ║');
  console.log('║  Then re-run: node db/apply-terminal-schema.js║');
  console.log('║                                              ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`SQL file location: ${sqlPath}`);
  
  // As a final attempt, try using supabase-js to check if tables exist already
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log('');
  console.log('[Verify] Checking if any terminal tables already exist...');
  
  const tablesToCheck = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'risk_rules', 'trading_orders', 'positions',
    'executions', 'watchlists', 'layouts', 'themes', 'journal_entries',
    'account_metrics', 'broker_sessions', 'risk_events', 'challenge_progress',
    'provisioning_logs', 'execution_audits', 'alerts', 'kill_switch_logs',
    'copy_trading_config',
  ];

  const results = {};
  for (const table of tablesToCheck) {
    try {
      const { data, error } = await supabase.from(table).select('id').limit(1);
      if (error && error.message.includes('schema cache')) {
        results[table] = 'NOT EXISTS';
      } else {
        results[table] = 'EXISTS';
      }
    } catch {
      results[table] = 'NOT EXISTS';
    }
  }

  const existing = Object.entries(results).filter(([, v]) => v === 'EXISTS');
  const missing = Object.entries(results).filter(([, v]) => v === 'NOT EXISTS');

  console.log(`  Existing: ${existing.length}`);
  for (const [t] of existing) console.log(`    ✓ ${t}`);
  console.log(`  Missing: ${missing.length}`);
  for (const [t] of missing) console.log(`    ✗ ${t}`);
}

applySchema().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
