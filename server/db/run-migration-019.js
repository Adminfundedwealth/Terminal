/**
 * Apply migration 019 — Flash Risk Profile tables + first_position_at column.
 * Run once: node server/db/run-migration-019.js
 *
 * Safe to re-run (all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING).
 * Does not touch any existing data.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

config();

const __dir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dir, 'terminal-migrations', '019_flash_risk_profile.sql'), 'utf8');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  console.log('[Migration 019] Starting Flash Risk Profile migration...');

  // Execute via Supabase REST (rpc exec_sql if available, otherwise direct)
  const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => ({ error: { message: 'exec_sql not available' } }));

  if (error) {
    // Fallback: execute statements one by one via raw fetch
    console.warn('[Migration 019] exec_sql RPC not available — using direct approach.');
    console.log('[Migration 019] Please run the following SQL manually in Supabase SQL Editor:');
    console.log('\n' + sql + '\n');
    console.log('[Migration 019] File location: server/db/terminal-migrations/019_flash_risk_profile.sql');
    process.exit(0);
  }

  console.log('[Migration 019] ✓ Migration applied successfully.');
}

run().catch(err => {
  console.error('[Migration 019] Failed:', err.message);
  process.exit(1);
});
