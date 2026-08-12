/**
 * Apply the two remaining Migration 019 statements via Supabase REST.
 * 1. INSERT default row into flash_risk_profile
 * 2. ALTER TABLE challenge_accounts ADD COLUMN first_position_at
 *
 * Uses the Supabase management API SQL endpoint (requires service role key).
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
const PROJECT_REF      = SUPABASE_URL?.replace('https://','').replace('.supabase.co','');

if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1);
}

console.log(`Target: ${SUPABASE_URL}`);

// ── Helper: execute SQL via Supabase Management API ──────────────────────────
async function execSQL(sql, label) {
  const endpoint = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SVC_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (resp.ok) {
    const data = await resp.json().catch(() => ({}));
    console.log(`  ✓ ${label}`);
    return { ok: true, data };
  }

  // Management API failed — try via PostgREST RPC (some projects have it)
  const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SVC_KEY,
      'Authorization': `Bearer ${SUPABASE_SVC_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (rpcResp.ok) {
    console.log(`  ✓ ${label} (via RPC)`);
    return { ok: true };
  }

  const errText = await resp.text().catch(() => '');
  console.error(`  ✗ ${label} — ${resp.status}: ${errText.slice(0,200)}`);
  return { ok: false, error: errText };
}

// ── Statement 1: Seed default row ────────────────────────────────────────────
const insertSQL = `
INSERT INTO flash_risk_profile (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
`;

const r1 = await execSQL(insertSQL.trim(), "INSERT default row into flash_risk_profile");

// ── Statement 2: Add first_position_at column ────────────────────────────────
const alterSQL = `
ALTER TABLE challenge_accounts
  ADD COLUMN IF NOT EXISTS first_position_at TIMESTAMPTZ DEFAULT NULL;
`;

const r2 = await execSQL(alterSQL.trim(), "ALTER TABLE challenge_accounts ADD COLUMN first_position_at");

if (!r1.ok || !r2.ok) {
  console.log('\nDirect API not available from this environment.');
  console.log('Please run these two statements manually in the Supabase SQL Editor:');
  console.log(`  → https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
  console.log('\n── Statement 1 ──────────────────────────────────────────────────');
  console.log(insertSQL.trim());
  console.log('\n── Statement 2 ──────────────────────────────────────────────────');
  console.log(alterSQL.trim());
  process.exit(2);
}

// ── Verify ───────────────────────────────────────────────────────────────────
const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let ok=0, fail=0;
const chk = (label, passed, detail='') => {
  if (passed) { console.log(`  ✓ ${label}`); ok++; }
  else { console.error(`  ✗ ${label}${detail?' — '+detail:''}`); fail++; }
};

console.log('\nVerifying...');

const { data: fp, error: fpErr } = await db
  .from('flash_risk_profile').select('*').eq('id','default').single();
chk('default row exists', !!fp && !fpErr, fpErr?.message);

if (fp) {
  chk('duration_hours=24',            fp.duration_hours==24,           String(fp.duration_hours));
  chk('per_position_loss_pct=2',      fp.per_position_loss_pct==2,     String(fp.per_position_loss_pct));
  chk('max_drawdown_pct=4',           fp.max_drawdown_pct==4,          String(fp.max_drawdown_pct));
  chk('max_open_positions=50',        fp.max_open_positions==50,       String(fp.max_open_positions));
  chk('leverage_max=50',              fp.leverage_max==50,             String(fp.leverage_max));
  chk('overnight_allowed=true',       fp.overnight_allowed===true,     String(fp.overnight_allowed));
  chk('weekend_allowed=true',         fp.weekend_allowed===true,       String(fp.weekend_allowed));
  chk('holiday_restriction=false',    fp.holiday_restriction===false,  String(fp.holiday_restriction));
  chk('profit_target_pct=0',          fp.profit_target_pct==0,         String(fp.profit_target_pct));
  chk('profit_split_pct=90',          fp.profit_split_pct==90,         String(fp.profit_split_pct));
  chk('consistency_rule_pct=15',      fp.consistency_rule_pct==15,     String(fp.consistency_rule_pct));
  chk('payout_threshold_pct=3',       fp.payout_threshold_pct==3,      String(fp.payout_threshold_pct));
  chk('trading_hours_start=09:15',    fp.trading_hours_start==='09:15',fp.trading_hours_start);
  chk('trading_hours_end=15:30',      fp.trading_hours_end==='15:30',  fp.trading_hours_end);
}

const { data: caTest, error: caErr } = await db
  .from('challenge_accounts').select('first_position_at').limit(1);
chk('challenge_accounts.first_position_at exists',
  !caErr || !caErr.message.includes('first_position_at'), caErr?.message);

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
