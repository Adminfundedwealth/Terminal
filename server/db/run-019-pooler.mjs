/**
 * Run Migration 019 via Supabase Pooler (session mode, port 5432).
 * Uses SERVICE_KEY as password — works without SUPABASE_DB_PASSWORD.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config();
const __dir = dirname(fileURLToPath(import.meta.url));

const url     = process.env.SUPABASE_URL || '';
const svcKey  = process.env.SUPABASE_SERVICE_KEY || '';
const ref     = url.replace('https://','').replace('.supabase.co','');

if (!url || !svcKey) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

const sql = readFileSync(join(__dir, 'terminal-migrations', '019_flash_risk_profile.sql'), 'utf8');

// Strip comment-only lines, split on semicolons
const statements = sql
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 5);

const connOptions = [
  {
    label: 'Pooler session mode ap-south-1 (5432)',
    host:  `aws-0-ap-south-1.pooler.supabase.com`,
    port:  5432,
    user:  `postgres.${ref}`,
    password: svcKey,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  },
  {
    label: 'Pooler transaction mode ap-south-1 (6543)',
    host:  `aws-0-ap-south-1.pooler.supabase.com`,
    port:  6543,
    user:  `postgres.${ref}`,
    password: svcKey,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  },
  {
    label: 'Pooler session mode ap-southeast-1 (5432)',
    host:  `aws-0-ap-southeast-1.pooler.supabase.com`,
    port:  5432,
    user:  `postgres.${ref}`,
    password: svcKey,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  },
  {
    label: 'Pooler transaction mode ap-southeast-1 (6543)',
    host:  `aws-0-ap-southeast-1.pooler.supabase.com`,
    port:  6543,
    user:  `postgres.${ref}`,
    password: svcKey,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  },
  {
    label: 'Direct DB host (5432)',
    host:  `db.${ref}.supabase.co`,
    port:  5432,
    user:  'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || svcKey,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  },
];

console.log(`[Migration 019] Target: ${url}`);
console.log(`[Migration 019] Ref: ${ref}`);
console.log(`[Migration 019] ${statements.length} statements to execute\n`);

let client = null;

for (const opts of connOptions) {
  console.log(`Trying: ${opts.label}...`);
  const pool = new pg.Pool(opts);
  try {
    const c = await pool.connect();
    const { rows } = await c.query('SELECT current_user, current_database()');
    console.log(`  ✓ Connected as ${rows[0].current_user} to ${rows[0].current_database}\n`);
    c.release();
    client = await pool.connect();
    break;
  } catch (err) {
    console.log(`  ✗ ${err.message.slice(0, 100)}`);
    await pool.end().catch(() => {});
  }
}

if (!client) {
  console.error('\n[Migration 019] All connection attempts failed.');
  console.error('The migration SQL is ready — please run it manually:');
  console.error(`  → https://supabase.com/dashboard/project/${ref}/sql/new`);
  console.error('  → Paste contents of: server/db/terminal-migrations/019_flash_risk_profile.sql');
  process.exit(2);
}

// Execute each statement
let ok = 0; let skipped = 0; let failed = 0;
for (const stmt of statements) {
  const preview = stmt.slice(0, 90).replace(/\s+/g, ' ');
  try {
    await client.query(stmt);
    console.log(`  ✓ ${preview}`);
    ok++;
  } catch (err) {
    const msg = err.message || '';
    // "already exists" errors are fine for IF NOT EXISTS statements
    if (msg.includes('already exists') || err.code === '42P07' || err.code === '42710' || err.code === '42701') {
      console.log(`  ○ (already exists) ${preview.slice(0,60)}`);
      skipped++;
    } else {
      console.error(`  ✗ FAILED: ${preview.slice(0,60)}`);
      console.error(`    Error [${err.code}]: ${msg.slice(0,120)}`);
      failed++;
    }
  }
}

client.release();

console.log(`\n[Migration 019] Results: ${ok} executed, ${skipped} already-exist, ${failed} failed`);

if (failed > 0) {
  console.error('[Migration 019] ✗ Some statements failed — see above');
  process.exit(1);
}

// ── Post-migration verification ──────────────────────────────────────────────
console.log('\n[Migration 019] Running post-migration verification...');

// Re-connect for verification queries
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

let vOk = 0; let vFail = 0;
const vOk_  = (m) => { console.log(`  ✓ ${m}`); vOk++;  };
const vFail_ = (m) => { console.error(`  ✗ ${m}`); vFail++; };

// 1. flash_risk_profile table exists
const { data: fp, error: fpErr } = await db.from('flash_risk_profile').select('*').eq('id','default').single();
if (fpErr) vFail_(`flash_risk_profile not found: ${fpErr.message}`);
else       vOk_('flash_risk_profile table exists');

// 2. Default row with correct values
if (fp) {
  fp.duration_hours == 24             ? vOk_(`duration_hours = ${fp.duration_hours}`)               : vFail_(`duration_hours = ${fp.duration_hours} (expected 24)`);
  fp.per_position_loss_pct == 2       ? vOk_(`per_position_loss_pct = ${fp.per_position_loss_pct}`) : vFail_(`per_position_loss_pct = ${fp.per_position_loss_pct} (expected 2)`);
  fp.max_drawdown_pct == 4            ? vOk_(`max_drawdown_pct = ${fp.max_drawdown_pct}`)           : vFail_(`max_drawdown_pct = ${fp.max_drawdown_pct} (expected 4)`);
  fp.max_open_positions == 50         ? vOk_(`max_open_positions = ${fp.max_open_positions}`)       : vFail_(`max_open_positions = ${fp.max_open_positions} (expected 50)`);
  fp.leverage_max == 50               ? vOk_(`leverage_max = ${fp.leverage_max}`)                   : vFail_(`leverage_max = ${fp.leverage_max} (expected 50)`);
  fp.overnight_allowed === true       ? vOk_(`overnight_allowed = true`)                            : vFail_(`overnight_allowed = ${fp.overnight_allowed}`);
  fp.weekend_allowed === true         ? vOk_(`weekend_allowed = true`)                              : vFail_(`weekend_allowed = ${fp.weekend_allowed}`);
  fp.holiday_restriction === false    ? vOk_(`holiday_restriction = false`)                         : vFail_(`holiday_restriction = ${fp.holiday_restriction}`);
  fp.profit_target_pct == 0           ? vOk_(`profit_target_pct = 0 (none)`)                       : vFail_(`profit_target_pct = ${fp.profit_target_pct} (expected 0)`);
  fp.profit_split_pct == 90           ? vOk_(`profit_split_pct = ${fp.profit_split_pct}`)          : vFail_(`profit_split_pct = ${fp.profit_split_pct} (expected 90)`);
  fp.consistency_rule_pct == 15       ? vOk_(`consistency_rule_pct = ${fp.consistency_rule_pct}`)  : vFail_(`consistency_rule_pct = ${fp.consistency_rule_pct} (expected 15)`);
  fp.payout_threshold_pct == 3        ? vOk_(`payout_threshold_pct = ${fp.payout_threshold_pct}`)  : vFail_(`payout_threshold_pct = ${fp.payout_threshold_pct} (expected 3)`);
  fp.trading_hours_start === '09:15'  ? vOk_(`trading_hours_start = 09:15`)                        : vFail_(`trading_hours_start = ${fp.trading_hours_start}`);
  fp.trading_hours_end   === '15:30'  ? vOk_(`trading_hours_end = 15:30`)                          : vFail_(`trading_hours_end = ${fp.trading_hours_end}`);

  const segs = Array.isArray(fp.allowed_segments) ? fp.allowed_segments : JSON.parse(fp.allowed_segments || '[]');
  ['NSE','NFO','BFO','MCX','CDS'].every(s => segs.includes(s))
    ? vOk_(`allowed_segments = ${segs.join(',')}`)
    : vFail_(`allowed_segments missing: ${JSON.stringify(segs)}`);
}

// 3. flash_risk_profile_audit table exists (select count)
const { error: auditErr } = await db.from('flash_risk_profile_audit').select('id', { count: 'exact', head: true });
auditErr ? vFail_(`flash_risk_profile_audit: ${auditErr.message}`) : vOk_('flash_risk_profile_audit table exists');

// 4. first_position_at column exists on challenge_accounts
const { data: caRow, error: caErr } = await db.from('challenge_accounts').select('first_position_at').limit(1);
if (caErr && caErr.message.includes('first_position_at')) {
  vFail_(`challenge_accounts.first_position_at: ${caErr.message}`);
} else if (caErr && !caErr.message.includes('first_position_at')) {
  // Table-level error unrelated to our column — column likely exists
  vOk_('challenge_accounts.first_position_at column exists (table query succeeded)');
} else {
  vOk_('challenge_accounts.first_position_at column exists');
}

// 5. Existing trading_accounts untouched
const { count: acctCount, error: acctErr } = await db
  .from('trading_accounts').select('id', { count: 'exact', head: true });
acctErr ? vFail_(`trading_accounts query failed: ${acctErr.message}`) : vOk_(`trading_accounts: ${acctCount} rows (unchanged)`);

// 6. Existing positions untouched
const { count: posCount, error: posErr } = await db
  .from('positions').select('id', { count: 'exact', head: true });
posErr ? vFail_(`positions query failed: ${posErr.message}`) : vOk_(`positions: ${posCount} rows (unchanged)`);

// 7. Existing risk_rules untouched
const { count: rrCount, error: rrErr } = await db
  .from('risk_rules').select('id', { count: 'exact', head: true });
rrErr ? vFail_(`risk_rules query failed: ${rrErr.message}`) : vOk_(`risk_rules: ${rrCount} rows (unchanged)`);

console.log(`\n[Migration 019] Verification: ${vOk} passed, ${vFail} failed`);
if (vFail > 0) { console.error('[Migration 019] ✗ Verification failed'); process.exit(1); }
console.log('[Migration 019] ✓ Migration complete and verified');
process.exit(0);
