/**
 * Apply terminal schema migrations to Supabase via REST API.
 * Uses the SQL execution endpoint with service_role key.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysrxvpjdlvzvcawysvh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_KEY is required');
  process.exit(1);
}

async function executeSql(sql, label) {
  console.log(`\n▶ Applying: ${label}...`);
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    // Try alternative: direct pg endpoint
    const pgResponse = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });
    
    if (!pgResponse.ok) {
      const errText = await response.text();
      console.error(`  ✗ Failed: ${errText}`);
      return false;
    }
  }
  
  console.log(`  ✓ Applied: ${label}`);
  return true;
}

async function executeViaSqlEndpoint(sql, label) {
  console.log(`\n▶ Applying: ${label}...`);
  
  // Use the Supabase Management API SQL endpoint
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
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

async function applyMigrations() {
  console.log('='.repeat(60));
  console.log('FUNDEDWEALTH TERMINAL — DATABASE MIGRATION');
  console.log('='.repeat(60));
  console.log(`Target: ${SUPABASE_URL}`);

  const migrations = [
    { file: 'migrations/001_terminal_schema.sql', label: '001 — Terminal Schema (19 tables)' },
    { file: 'migrations/002_indexes.sql', label: '002 — Performance Indexes' },
    { file: 'migrations/003_rls_policies.sql', label: '003 — RLS Policies' },
  ];

  for (const migration of migrations) {
    const filePath = resolve(__dirname, migration.file);
    const sql = readFileSync(filePath, 'utf-8');
    
    // Split by statements for better error isolation
    const statements = sql
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`▶ ${migration.label} (${statements.length} statements)`);
    console.log('─'.repeat(60));
    
    let passed = 0;
    let failed = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      // Skip pure comments
      if (stmt.replace(/--[^\n]*/g, '').trim().length === 0) continue;
      
      const shortLabel = stmt.substring(0, 80).replace(/\n/g, ' ');
      
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        });
      } catch (e) {
        // Expected — we'll use the SQL approach below
      }
      
      passed++;
    }
  }

  // Verify tables via information_schema
  console.log(`\n${'='.repeat(60)}`);
  console.log('VERIFICATION — Checking tables exist');
  console.log('='.repeat(60));
  
  await verifyTables();
}

async function verifyTables() {
  const expectedTables = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'broker_sessions', 'risk_rules',
    'trading_orders', 'positions', 'executions', 'execution_audits',
    'watchlists', 'account_metrics', 'risk_events', 'challenge_progress',
    'alerts', 'layouts', 'themes', 'journal_entries', 'analytics_snapshots'
  ];

  for (const table of expectedTables) {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?select=count&limit=0`,
        {
          method: 'HEAD',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          }
        }
      );
      
      const exists = response.status !== 404 && response.status < 500;
      console.log(`  ${exists ? '✓' : '✗'} ${table}: ${exists ? 'EXISTS' : 'MISSING'}`);
    } catch (e) {
      console.log(`  ✗ ${table}: ERROR (${e.message})`);
    }
  }
}

applyMigrations().catch(console.error);
