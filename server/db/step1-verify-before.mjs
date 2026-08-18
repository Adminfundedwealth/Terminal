/**
 * Step 1 — Verify production DB state BEFORE migration.
 * Read-only. No writes.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const url    = process.env.SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_KEY;
const db     = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`\nProduction DB: ${url}\n`);
console.log('═'.repeat(55));
console.log(' STEP 1 — PRE-MIGRATION STATE');
console.log('═'.repeat(55));

// ── 1. flash_risk_profile ─────────────────────────────────────────
{
  const { data, error } = await db.from('flash_risk_profile').select('*').limit(1);
  if (error && error.message.includes('does not exist')) {
    console.log('  flash_risk_profile          : DOES NOT EXIST');
  } else if (error) {
    console.log(`  flash_risk_profile          : ERROR — ${error.message}`);
  } else {
    console.log(`  flash_risk_profile          : EXISTS (${data?.length ?? 0} rows)`);
    if (data?.length > 0) console.log('    row:', JSON.stringify(data[0]).slice(0,120));
  }
}

// ── 2. flash_risk_profile_audit ───────────────────────────────────
{
  const { data, error } = await db.from('flash_risk_profile_audit').select('id', { count: 'exact', head: true });
  if (error && error.message.includes('does not exist')) {
    console.log('  flash_risk_profile_audit    : DOES NOT EXIST');
  } else if (error) {
    console.log(`  flash_risk_profile_audit    : ERROR — ${error.message}`);
  } else {
    console.log('  flash_risk_profile_audit    : EXISTS');
  }
}

// ── 3. challenge_accounts.first_position_at ───────────────────────
{
  const { data, error } = await db.from('challenge_accounts').select('first_position_at').limit(1);
  if (error && error.message.includes('first_position_at')) {
    console.log('  challenge_accounts.first_position_at : DOES NOT EXIST');
  } else if (error) {
    console.log(`  challenge_accounts.first_position_at : ERROR — ${error.message}`);
  } else {
    console.log('  challenge_accounts.first_position_at : EXISTS (nullable column)');
  }
}

// ── 4. Existing data counts (safety baseline) ─────────────────────
console.log('\n── Existing data counts (baseline) ──');
for (const tbl of ['trading_accounts','challenge_accounts','risk_rules','positions','trading_orders','executions']) {
  const { count, error } = await db.from(tbl).select('id', { count: 'exact', head: true });
  console.log(`  ${tbl.padEnd(25)}: ${error ? 'ERROR — '+error.message.slice(0,60) : count + ' rows'}`);
}

console.log('\n  Done. Use results above to confirm pre-migration state.');
process.exit(0);
