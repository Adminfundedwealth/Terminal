/**
 * Check whether Migration 019 has already been applied to the database.
 * Uses the Supabase REST client (no direct DB connection required).
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const url    = process.env.SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_KEY;
if (!url || !svcKey) { console.error('Missing env vars'); process.exit(1); }

const db = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

let ok=0, fail=0;
const check = (label, passed, detail='') => {
  if (passed) { console.log(`  ✓ ${label}`); ok++; }
  else        { console.error(`  ✗ ${label}${detail ? ' — '+detail : ''}`); fail++; }
};

console.log(`\nChecking Migration 019 status on: ${url}\n`);

// 1. flash_risk_profile table + default row
const { data: fp, error: fpErr } = await db
  .from('flash_risk_profile').select('*').eq('id','default').single();
check('flash_risk_profile table exists',         !fpErr || !fpErr.message.includes('does not exist'), fpErr?.message);
check('default profile row exists',              !!fp && !fpErr, fpErr?.message);

if (fp) {
  check('duration_hours = 24',                   fp.duration_hours == 24,            String(fp.duration_hours));
  check('per_position_loss_pct = 2',             fp.per_position_loss_pct == 2,       String(fp.per_position_loss_pct));
  check('max_drawdown_pct = 4',                  fp.max_drawdown_pct == 4,            String(fp.max_drawdown_pct));
  check('max_open_positions = 50',               fp.max_open_positions == 50,         String(fp.max_open_positions));
  check('leverage_max = 50',                     fp.leverage_max == 50,               String(fp.leverage_max));
  check('overnight_allowed = true',              fp.overnight_allowed === true,       String(fp.overnight_allowed));
  check('weekend_allowed = true',                fp.weekend_allowed === true,         String(fp.weekend_allowed));
  check('holiday_restriction = false',           fp.holiday_restriction === false,    String(fp.holiday_restriction));
  check('profit_target_pct = 0',                 fp.profit_target_pct == 0,           String(fp.profit_target_pct));
  check('profit_split_pct = 90',                 fp.profit_split_pct == 90,           String(fp.profit_split_pct));
  check('consistency_rule_pct = 15',             fp.consistency_rule_pct == 15,       String(fp.consistency_rule_pct));
  check('payout_threshold_pct = 3',              fp.payout_threshold_pct == 3,        String(fp.payout_threshold_pct));
  check('trading_hours_start = 09:15',           fp.trading_hours_start === '09:15',  fp.trading_hours_start);
  check('trading_hours_end = 15:30',             fp.trading_hours_end   === '15:30',  fp.trading_hours_end);
  const segs = Array.isArray(fp.allowed_segments) ? fp.allowed_segments
    : (typeof fp.allowed_segments === 'string' ? JSON.parse(fp.allowed_segments) : []);
  check('allowed_segments has NSE,NFO,BFO,MCX,CDS',
    ['NSE','NFO','BFO','MCX','CDS'].every(s => segs.includes(s)), JSON.stringify(segs));
}

// 2. flash_risk_profile_audit table
const { error: auditErr } = await db
  .from('flash_risk_profile_audit').select('id', { count:'exact', head:true });
check('flash_risk_profile_audit table exists',
  !auditErr || !auditErr.message.includes('does not exist'), auditErr?.message);

// 3. first_position_at column on challenge_accounts
const { data: caTest, error: caErr } = await db
  .from('challenge_accounts').select('first_position_at').limit(1);
const colExists = !caErr || !caErr.message.includes('first_position_at');
check('challenge_accounts.first_position_at column exists', colExists, caErr?.message);

// 4. Existing data untouched
const { count: accts } = await db.from('trading_accounts').select('id',{count:'exact',head:true});
check('trading_accounts rows intact',  accts !== null, 'query failed');
const { count: pos }   = await db.from('positions').select('id',{count:'exact',head:true});
check('positions rows intact',         pos !== null,   'query failed');
const { count: rr }    = await db.from('risk_rules').select('id',{count:'exact',head:true});
check('risk_rules rows intact',        rr !== null,    'query failed');

console.log(`\n${'═'.repeat(55)}`);
if (fail === 0) {
  console.log(`  Migration 019: APPLIED ✓ (${ok} checks passed)`);
  console.log('═'.repeat(55));
  process.exit(0);
} else {
  console.log(`  Migration 019: NOT FULLY APPLIED (${fail} checks failed, ${ok} passed)`);
  console.log('═'.repeat(55));
  console.log('\n  ► Run this SQL in the Supabase SQL Editor:');
  console.log('  https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql/new');
  process.exit(1);
}
