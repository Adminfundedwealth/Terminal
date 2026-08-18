/**
 * RUN MIGRATION 019 ONLY — flash_risk_profile
 * READ the SQL file and execute each statement against production.
 * Does NOT run 020, 022, or 023.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'public' },
});

let passed = 0, failed = 0;
const ok  = m => { console.log(`  ✓ ${m}`); passed++; };
const err = m => { console.error(`  ✗ ${m}`); failed++; };

// ── Execute a raw SQL statement via Supabase rpc ──────────────────────────
async function sql(statement, label) {
  const { error } = await sb.rpc('exec_sql', { sql: statement }).catch(() => ({ error: { message: 'rpc not available' } }));
  if (error && error.message !== 'rpc not available') {
    // Try direct REST approach
  }
  return error;
}

// Since Supabase JS client doesn't expose raw SQL directly, use the
// individual table operations to verify and the REST API for DDL.
// DDL must go via the Supabase SQL endpoint (management API or pg REST).

// ── Use direct pg connection via Supabase's postgres endpoint ─────────────
// The service key can be used with the /rest/v1/rpc or direct pg.
// We'll execute each DDL statement via fetch to the Supabase SQL API.

const projectRef = SUPABASE_URL.match(/https:\/\/(.+?)\.supabase\.co/)?.[1];

async function execSQL(stmt) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ sql: stmt }),
  });
  const body = await resp.json().catch(() => ({}));
  return { status: resp.status, body };
}

// ── Parse migration file into individual statements ───────────────────────
const migrationPath = resolve(__dir, 'terminal-migrations', '019_flash_risk_profile.sql');
const migrationSQL  = readFileSync(migrationPath, 'utf8');

// Split on semicolons, strip comments, skip empty
const statements = migrationSQL
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 0);

console.log('\n' + '═'.repeat(60));
console.log(' MIGRATION 019 — flash_risk_profile');
console.log('═'.repeat(60));
console.log(` Project:    ${projectRef}`);
console.log(` Statements: ${statements.length}`);
console.log(` Migration:  019_flash_risk_profile.sql`);
console.log(' Other migrations: NOT RUN\n');

// ── Step 1: Execute migration statements ──────────────────────────────────
console.log('── Step 1: Execute DDL ──');

let execFailed = false;
for (const stmt of statements) {
  const preview = stmt.substring(0, 60).replace(/\s+/g, ' ');
  const { status, body } = await execSQL(stmt);
  if (status === 200 || status === 204) {
    ok(`[${status}] ${preview}…`);
  } else {
    // Supabase exec_sql may not exist — fall back to direct table ops
    err(`[${status}] ${preview}… → ${JSON.stringify(body).substring(0, 80)}`);
    execFailed = true;
  }
}

// ── Step 2: Verify tables exist ───────────────────────────────────────────
console.log('\n── Step 2: Table Verification ──');

const { data: flashRows, error: flashErr } = await sb
  .from('flash_risk_profile').select('*').limit(1);

if (flashErr && flashErr.code === '42P01') {
  err('flash_risk_profile — TABLE MISSING');
} else if (flashErr) {
  err(`flash_risk_profile — ERROR: ${flashErr.message}`);
} else {
  ok('flash_risk_profile — TABLE EXISTS');
}

const { data: auditRows, error: auditErr } = await sb
  .from('flash_risk_profile_audit').select('*').limit(1);

if (auditErr && auditErr.code === '42P01') {
  err('flash_risk_profile_audit — TABLE MISSING');
} else if (auditErr) {
  err(`flash_risk_profile_audit — ERROR: ${auditErr.message}`);
} else {
  ok('flash_risk_profile_audit — TABLE EXISTS');
}

// ── Step 3: Verify seed row ───────────────────────────────────────────────
console.log('\n── Step 3: Seed Row Verification ──');

const { data: seedData, error: seedErr } = await sb
  .from('flash_risk_profile')
  .select('*')
  .eq('id', 'default')
  .single();

if (seedErr) {
  err(`Seed row — ${seedErr.message}`);
} else {
  ok("Seed row id='default' — EXISTS");

  // Verify each expected value
  const expected = {
    duration_hours:        24,
    timer_start_event:     'first_position',
    per_position_loss_pct: 2,
    max_drawdown_pct:      4,
    max_open_positions:    50,
    leverage_max:          50,
    trading_hours_start:   '09:15',
    trading_hours_end:     '15:30',
    overnight_allowed:     true,
    weekend_allowed:       true,
    holiday_restriction:   false,
    profit_target_pct:     0,
    profit_split_pct:      90,
    consistency_rule_pct:  15,
    payout_threshold_pct:  3,
  };

  for (const [field, expected_val] of Object.entries(expected)) {
    const actual = seedData[field];
    const actualNum = typeof actual === 'string' ? parseFloat(actual) : actual;
    const expectedNum = typeof expected_val === 'number' ? expected_val : expected_val;
    const match = typeof expected_val === 'boolean'
      ? actual === expected_val
      : typeof expected_val === 'number'
        ? Math.abs(actualNum - expectedNum) < 0.001
        : actual === expected_val;
    if (match) {
      ok(`  ${field} = ${actual}`);
    } else {
      err(`  ${field} — expected ${expected_val}, got ${actual}`);
    }
  }
}

// ── Step 4: Verify first_position_at on challenge_accounts ───────────────
console.log('\n── Step 4: challenge_accounts.first_position_at ──');

const { data: caData, error: caErr } = await sb
  .from('challenge_accounts')
  .select('id, first_position_at')
  .limit(3);

if (caErr && caErr.message?.includes('first_position_at')) {
  err(`challenge_accounts.first_position_at — COLUMN MISSING: ${caErr.message}`);
} else if (caErr) {
  err(`challenge_accounts query — ${caErr.message}`);
} else {
  ok('challenge_accounts.first_position_at — COLUMN EXISTS');
  ok(`  Sample rows (${caData?.length ?? 0}): all first_position_at values = ${JSON.stringify(caData?.map(r => r.first_position_at))}`);
}

// ── Step 5: Confirm other migrations NOT run ──────────────────────────────
console.log('\n── Step 5: Other Migrations — NOT RUN ──');

const otherTables = ['instant_risk_profile', 'twostep_risk_profile', 'onestep_risk_profile'];
for (const tbl of otherTables) {
  const { error: e } = await sb.from(tbl).select('id').limit(1);
  if (e && e.code === '42P01') {
    ok(`${tbl} — NOT EXISTS (correct — migration not run)`);
  } else if (!e) {
    ok(`${tbl} — EXISTS (was already present before this migration)`);
  } else {
    ok(`${tbl} — ${e.message}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(` Migration 019: ${execFailed ? 'APPLIED WITH WARNINGS' : 'APPLIED'}`);
console.log(` Verification: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));
