/**
 * Run Migration 019 — flash_risk_profile tables + first_position_at column.
 * Executes each statement individually using Supabase REST API.
 * All statements are IF NOT EXISTS / ON CONFLICT — fully idempotent.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config();
const __dir = dirname(fileURLToPath(import.meta.url));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
console.log(`[Migration 019] Target: ${url}`);

// Read the migration SQL
const sql = readFileSync(
  join(__dir, 'terminal-migrations', '019_flash_risk_profile.sql'), 'utf8'
);

// Split into individual statements (semicolon-delimited, strip comments + empty)
const statements = sql
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 0);

console.log(`[Migration 019] ${statements.length} statements to execute`);

let ok = 0; let failed = 0;
for (const stmt of statements) {
  const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
  try {
    const { error } = await db.rpc('exec_sql', { sql: stmt + ';' });
    if (error) {
      // Try via direct postgres if exec_sql not available
      throw new Error(error.message);
    }
    console.log(`  ✓ ${preview}`);
    ok++;
  } catch (err) {
    // exec_sql RPC not available — report and exit so user can run manually
    console.error(`  ✗ ${preview}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

if (failed > 0) {
  console.log('\n[Migration 019] exec_sql RPC not available on this project.');
  console.log('[Migration 019] Please run the SQL manually in Supabase SQL Editor:');
  console.log('  → Go to: https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql');
  console.log('  → Open file: server/db/terminal-migrations/019_flash_risk_profile.sql');
  console.log('  → Paste and Run');
  process.exit(2); // exit code 2 = needs manual run
}

console.log(`\n[Migration 019] ✓ Complete: ${ok} statements succeeded`);
process.exit(0);
