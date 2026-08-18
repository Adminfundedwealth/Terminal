/**
 * READ-ONLY: Check whether risk profile tables exist in production DB.
 * Reads env from ../.env (or Railway env vars).
 * DOES NOT modify any data.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dir, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('SUPABASE_URL:', SUPABASE_URL || 'NOT SET');
  console.log('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'SET' : 'NOT SET');
  console.log('\nCannot check DB — credentials not available in local .env');
  console.log('These vars are set as Railway production environment variables.');
  console.log('\nTo check manually, run this SQL in Supabase SQL Editor:');
  console.log('https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql');
  console.log(`
SELECT table_name, 
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE table_name = t.table_name AND table_schema = 'public') AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'flash_risk_profile', 'flash_risk_profile_audit',
    'instant_risk_profile', 'instant_risk_profile_audit',
    'onestep_risk_profile', 'onestep_risk_profile_audit',
    'twostep_risk_profile', 'twostep_risk_profile_audit'
  )
ORDER BY table_name;
  `);
  process.exit(0);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const TABLES = [
  'flash_risk_profile',        'flash_risk_profile_audit',
  'instant_risk_profile',      'instant_risk_profile_audit',
  'onestep_risk_profile',      'onestep_risk_profile_audit',
  'twostep_risk_profile',      'twostep_risk_profile_audit',
];

const PROFILE_TABLES = [
  'flash_risk_profile',
  'instant_risk_profile',
  'onestep_risk_profile',
  'twostep_risk_profile',
];

const EXTRA_COLUMNS = {
  challenge_accounts:  ['first_position_at'],
  trading_accounts:    ['daily_profit_cap_until', 'first_payout_approved_at'],
};

console.log('\n' + '═'.repeat(60));
console.log(' RISK PROFILE TABLES — PRODUCTION DB CHECK');
console.log('═'.repeat(60));
console.log(` Project: nysrxvpjdlvzvcawysvh`);
console.log(` URL:     ${SUPABASE_URL}`);
console.log('');

// ── 1. Table existence ─────────────────────────────────────────
console.log('── 1. Table Existence ──');
for (const tbl of TABLES) {
  const { data, error } = await sb.from(tbl).select('*').limit(0);
  if (error && error.code === '42P01') {
    console.log(`  ✗ ${tbl} — MISSING`);
  } else if (error) {
    console.log(`  ? ${tbl} — ERROR: ${error.message}`);
  } else {
    console.log(`  ✓ ${tbl} — EXISTS`);
  }
}

// ── 2. Profile row existence ───────────────────────────────────
console.log('\n── 2. Default Profile Row ──');
for (const tbl of PROFILE_TABLES) {
  const { data, error } = await sb.from(tbl).select('*').eq('id', 'default').limit(1);
  if (error && error.code === '42P01') {
    console.log(`  ✗ ${tbl} — table missing, no row`);
  } else if (error) {
    console.log(`  ? ${tbl} — ${error.message}`);
  } else if (!data || data.length === 0) {
    console.log(`  ✗ ${tbl} — table exists but NO default row`);
  } else {
    const row = data[0];
    console.log(`  ✓ ${tbl} — default row present (updated_at: ${row.updated_at || 'never'})`);
  }
}

// ── 3. Extra columns ──────────────────────────────────────────
console.log('\n── 3. Required Extra Columns ──');
for (const [tbl, cols] of Object.entries(EXTRA_COLUMNS)) {
  const { data, error } = await sb.from(tbl).select(cols.join(',')).limit(0);
  if (error && error.code === '42703') {
    // column does not exist
    console.log(`  ✗ ${tbl}.${cols.join('/')} — column MISSING`);
  } else if (error && error.code === '42P01') {
    console.log(`  ✗ ${tbl} — table missing`);
  } else if (error) {
    console.log(`  ? ${tbl}.(${cols.join(',')}) — ${error.message}`);
  } else {
    console.log(`  ✓ ${tbl} — columns present: ${cols.join(', ')}`);
  }
}

console.log('\n' + '═'.repeat(60));
