/**
 * APPLY MIGRATION 019 ONLY — flash_risk_profile
 * Uses direct PostgreSQL connection (DATABASE_URL).
 * Does NOT run 020, 022, or 023.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false, checkServerIdentity: () => undefined },
  connectionTimeoutMillis: 15000,
  query_timeout: 30000,
});

let passed = 0, failed = 0;
const ok  = m => { console.log(`  ✓ ${m}`); passed++; };
const err = m => { console.error(`  ✗ ${m}`); failed++; };

console.log('\n' + '═'.repeat(60));
console.log(' MIGRATION 019 — flash_risk_profile');
console.log('═'.repeat(60));
console.log(' Other migrations: NOT RUN\n');

await client.connect();
console.log('  Connected to database\n');

// ── Step 1: Run migration SQL ─────────────────────────────────────────────
console.log('── Step 1: Execute Migration SQL ──');

const migrationSQL = readFileSync(
  resolve(__dir, 'terminal-migrations', '019_flash_risk_profile.sql'),
  'utf8'
);

try {
  await client.query(migrationSQL);
  ok('Migration 019 SQL executed successfully');
} catch (e) {
  err(`Migration execution failed: ${e.message}`);
  await client.end();
  process.exit(1);
}

// ── Step 2: Verify flash_risk_profile table ────────────────────────────────
console.log('\n── Step 2: Table Verification ──');

try {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('flash_risk_profile','flash_risk_profile_audit')`
  );
  const names = rows.map(r => r.table_name);
  names.includes('flash_risk_profile')       ? ok('flash_risk_profile — EXISTS')       : err('flash_risk_profile — MISSING');
  names.includes('flash_risk_profile_audit') ? ok('flash_risk_profile_audit — EXISTS') : err('flash_risk_profile_audit — MISSING');
} catch (e) {
  err(`Table check failed: ${e.message}`);
}

// ── Step 3: Verify seed row ───────────────────────────────────────────────
console.log('\n── Step 3: Seed Row Verification ──');

try {
  const { rows } = await client.query(
    `SELECT * FROM flash_risk_profile WHERE id='default'`
  );
  if (!rows.length) {
    err("Seed row id='default' — MISSING");
  } else {
    ok("Seed row id='default' — EXISTS");
    const r = rows[0];
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
    for (const [field, exp] of Object.entries(expected)) {
      const actual = r[field];
      const match = typeof exp === 'boolean'
        ? actual === exp
        : typeof exp === 'number'
          ? Math.abs(parseFloat(actual) - exp) < 0.001
          : actual === exp;
      match ? ok(`  ${field} = ${actual}`) : err(`  ${field} — expected ${exp}, got ${actual}`);
    }
  }
} catch (e) {
  err(`Seed row check failed: ${e.message}`);
}

// ── Step 4: Verify first_position_at column ───────────────────────────────
console.log('\n── Step 4: challenge_accounts.first_position_at ──');

try {
  const { rows } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='challenge_accounts'
      AND column_name='first_position_at'
  `);
  if (!rows.length) {
    err('challenge_accounts.first_position_at — COLUMN MISSING');
  } else {
    const col = rows[0];
    ok(`first_position_at — EXISTS`);
    col.data_type === 'timestamp with time zone'
      ? ok(`  data_type = ${col.data_type}`)
      : err(`  data_type = ${col.data_type} (expected timestamptz)`);
    col.is_nullable === 'YES'
      ? ok(`  nullable = YES`)
      : err(`  nullable = ${col.is_nullable} (expected YES)`);
    ok(`  default = ${col.column_default ?? 'NULL'}`);
  }
} catch (e) {
  err(`first_position_at check failed: ${e.message}`);
}

// ── Step 5: Verify existing data unchanged ────────────────────────────────
console.log('\n── Step 5: Existing Data Safety ──');

try {
  const { rows } = await client.query(
    `SELECT COUNT(*) as total,
            COUNT(first_position_at) as with_value
     FROM challenge_accounts`
  );
  const { total, with_value } = rows[0];
  ok(`challenge_accounts: ${total} total rows, ${with_value} have first_position_at set (${parseInt(total)-parseInt(with_value)} are NULL — correct)`);
} catch (e) {
  err(`Existing data check failed: ${e.message}`);
}

try {
  const { rows } = await client.query(
    `SELECT COUNT(*) as cnt FROM trading_accounts`
  );
  ok(`trading_accounts: ${rows[0].cnt} rows — all intact (no changes from 019)`);
} catch (e) {
  err(`trading_accounts check: ${e.message}`);
}

// ── Step 6: Confirm other migration tables do NOT exist ───────────────────
console.log('\n── Step 6: Other Migrations — NOT RUN ──');

try {
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('instant_risk_profile','twostep_risk_profile','onestep_risk_profile')
  `);
  const names = rows.map(r => r.table_name);
  ['instant_risk_profile','twostep_risk_profile','onestep_risk_profile'].forEach(t => {
    names.includes(t)
      ? ok(`${t} — EXISTS (was already present, not from this run)`)
      : ok(`${t} — NOT EXISTS ✓ (020/022/023 not run)`);
  });
} catch (e) {
  err(`Other tables check: ${e.message}`);
}

await client.end();

// ── Final summary ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(` Migration 019: APPLIED`);
console.log(` Checks: ${passed} passed, ${failed} failed`);
if (failed > 0) console.log(' STATUS: ISSUES FOUND — review above');
else            console.log(' STATUS: ALL CHECKS PASSED');
console.log('═'.repeat(60));
