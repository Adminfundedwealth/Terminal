/**
 * Apply terminal schema to Supabase.
 * Reads the master SQL and executes via Supabase's rpc or pg client.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pg from 'pg';
import { config } from 'dotenv';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;

// Extract host from Supabase URL for direct pg connection
// Supabase URL format: https://xxxx.supabase.co
// PG connection: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
// Or use the direct connection string if available

const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

async function applySchema() {
  const sqlPath = resolve(dirname(fileURLToPath(import.meta.url)), 'terminal-migrations/MASTER_TERMINAL_SCHEMA.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  console.log('═══════════════════════════════════════════════');
  console.log(' TERMINAL SCHEMA — Applying to Supabase');
  console.log('═══════════════════════════════════════════════');
  console.log(`  SQL file: ${sqlPath}`);
  console.log(`  Supabase URL: ${SUPABASE_URL}`);
  console.log('');

  if (DATABASE_URL) {
    // Direct PostgreSQL connection (preferred)
    console.log('[Schema] Using direct PostgreSQL connection...');
    const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    
    try {
      await client.connect();
      console.log('[Schema] ✓ Connected to PostgreSQL');
      
      // Execute the full SQL
      await client.query(sql);
      console.log('[Schema] ✓ Terminal schema applied successfully!');
      
      // Verify tables created
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN (
          'terminal_traders', 'terminal_sessions', 'challenge_accounts', 
          'trading_accounts', 'risk_rules', 'provisioning_logs',
          'trading_orders', 'positions', 'executions', 'execution_audits',
          'watchlists', 'account_metrics', 'journal_entries', 'layouts',
          'themes', 'broker_sessions', 'risk_events', 'challenge_progress',
          'alerts', 'kill_switch_logs', 'copy_trading_config'
        )
        ORDER BY table_name;
      `);
      
      console.log('');
      console.log(`[Schema] Verified ${result.rows.length}/21 terminal tables exist:`);
      for (const row of result.rows) {
        console.log(`  ✓ ${row.table_name}`);
      }
      
      if (result.rows.length < 21) {
        console.warn(`[Schema] ⚠ Only ${result.rows.length}/21 tables found. Some may already exist with different names.`);
      }
      
      await client.end();
    } catch (err) {
      console.error('[Schema] ✗ PostgreSQL error:', err.message);
      await client.end().catch(() => {});
      process.exit(1);
    }
  } else {
    // Fallback: use Supabase REST API with rpc
    console.log('[Schema] No DATABASE_URL found. Attempting via Supabase REST...');
    console.log('[Schema] For best results, add DATABASE_URL to server/.env');
    console.log('[Schema] Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres');
    console.log('');
    console.log('[Schema] Attempting to execute SQL in batches via Supabase...');
    
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    
    // Split by statement and execute individually
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    let success = 0;
    let failed = 0;
    
    for (const stmt of statements) {
      try {
        const { error } = await supabase.rpc('exec_sql', { sql_text: stmt + ';' });
        if (error) {
          // Try without rpc — direct from
          console.warn(`  ⚠ Statement skipped (rpc not available): ${stmt.substring(0, 60)}...`);
          failed++;
        } else {
          success++;
        }
      } catch (e) {
        failed++;
      }
    }
    
    if (failed > 0) {
      console.log('');
      console.log('[Schema] ⚠ REST API execution had issues.');
      console.log('[Schema] Please run the SQL directly in Supabase Dashboard → SQL Editor:');
      console.log(`  File: ${sqlPath}`);
    } else {
      console.log(`[Schema] ✓ Executed ${success} statements successfully`);
    }
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════');
}

applySchema().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
