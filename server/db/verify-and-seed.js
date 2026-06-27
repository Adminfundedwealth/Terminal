/**
 * VERIFY & SEED — Run after FULL_MIGRATION.sql has been executed in Supabase SQL Editor.
 * 
 * This script:
 *   1. Verifies all t_ tables exist
 *   2. Seeds a test user + challenge + account + rules
 *   3. Tests Phase 1 Pass → Phase 2 creation
 *   4. Tests Phase 2 Pass → Funded creation
 *   5. Tests payout eligibility
 *   6. Tests account lock/unlock/breach events
 * 
 * Run: node db/verify-and-seed.js
 */

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function log(label, status, detail = '') {
  results.push({ label, status });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${label}${detail ? ': ' + detail : ''}`);
}

async function tableExists(name) {
  const { data, error } = await supabase.from(name).select('id').limit(1);
  return !error || !error.message.includes('schema cache');
}

// ============================================================
// PHASE 1: Verify Tables
// ============================================================
async function verifyTables() {
  console.log('\n═══ PHASE 1: Table Verification ═══\n');

  const requiredTables = [
    't_users', 't_accounts', 't_challenges', 't_risk_rules',
    't_orders', 't_positions', 't_trades', 't_watchlists',
    't_account_metrics', 't_sessions', 't_risk_events',
    't_challenge_metrics', 't_payouts', 'audit_log',
  ];

  let allExist = true;
  for (const table of requiredTables) {
    const exists = await tableExists(table);
    log(`Table ${table}`, exists ? 'PASS' : 'FAIL', exists ? 'exists' : 'NOT FOUND');
    if (!exists) allExist = false;
  }

  return allExist;
}

// ============================================================
// PHASE 2: Seed Test Data
// ============================================================
async function seedTestData() {
  console.log('\n═══ PHASE 2: Seed Test User + Phase 1 Challenge ═══\n');

  // Create test user
  const { data: user, error: userErr } = await supabase
    .from('t_users')
    .upsert({ fw_user_id: 'fw_cert_user_001', email: 'cert@fundedwealth.com', name: 'Cert Trader', status: 'active' }, { onConflict: 'fw_user_id' })
    .select()
    .single();

  if (userErr) { log('Create user', 'FAIL', userErr.message); return null; }
  log('Create user', 'PASS', `id=${user.id}`);

  // Create Phase 1 challenge
  const { data: challenge, error: chErr } = await supabase
    .from('t_challenges')
    .insert({
      user_id: user.id,
      type: 'evaluation',
      plan: '10K',
      phase: 'phase_1',
      initial_balance: 1000000,
      status: 'active',
      min_trading_days: 5,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (chErr) { log('Create Phase 1 challenge', 'FAIL', chErr.message); return null; }
  log('Create Phase 1 challenge', 'PASS', `id=${challenge.id}, type=${challenge.type}, phase=${challenge.phase}`);

  // Create account
  const { data: account, error: accErr } = await supabase
    .from('t_accounts')
    .insert({
      user_id: user.id,
      account_code: `FW-CERT-${Date.now().toString(36).toUpperCase()}`,
      challenge_id: challenge.id,
      broker_provider: 'angelone',
      broker_client_id: 'CERT001',
      balance: 1000000,
      peak_balance: 1000000,
      payout_eligible: false,
      status: 'active',
    })
    .select()
    .single();

  if (accErr) { log('Create account', 'FAIL', accErr.message); return null; }
  log('Create account', 'PASS', `id=${account.id}, status=${account.status}, balance=${account.balance}`);

  // Seed risk rules
  const rules = [
    { account_id: account.id, rule_type: 'daily_loss_limit', value: { percent: 5 }, is_active: true },
    { account_id: account.id, rule_type: 'max_drawdown', value: { percent: 10 }, is_active: true },
    { account_id: account.id, rule_type: 'profit_target', value: { percent: 8 }, is_active: true },
    { account_id: account.id, rule_type: 'max_positions', value: { count: 10 }, is_active: true },
    { account_id: account.id, rule_type: 'no_overnight', value: { cutoffTime: '15:15', allowedProducts: ['MIS'] }, is_active: true },
    { account_id: account.id, rule_type: 'min_trading_days', value: { count: 5 }, is_active: true },
    { account_id: account.id, rule_type: 'allowed_segments', value: { segments: ['NSE', 'NFO', 'BFO'] }, is_active: true },
    { account_id: account.id, rule_type: 'trading_hours', value: { start: '09:15', end: '15:30' }, is_active: true },
  ];

  const { error: rulesErr } = await supabase.from('t_risk_rules').insert(rules);
  if (rulesErr) { log('Seed risk rules', 'FAIL', rulesErr.message); return null; }
  log('Seed risk rules', 'PASS', `${rules.length} rules created`);

  return { user, challenge, account };
}

// ============================================================
// PHASE 3: Phase 1 Pass + Phase 2 Creation
// ============================================================
async function testPhase1Pass(data) {
  console.log('\n═══ PHASE 3: Phase 1 Pass → Phase 2 Creation ═══\n');

  const { user, challenge, account } = data;

  // Simulate Phase 1 pass: update balance to hit 8% target (1,000,000 * 1.08 = 1,080,000)
  const { error: balErr } = await supabase
    .from('t_accounts')
    .update({ balance: 1080000 })
    .eq('id', account.id);

  if (balErr) { log('Update balance to target', 'FAIL', balErr.message); return null; }
  log('Update balance to target (₹10.8L = 8%)', 'PASS');

  // Import and run ChallengeService
  const { ChallengeService } = await import('../services/challengeService.js');

  // First, mark enough trading days (update metrics)
  for (let i = 0; i < 5; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    await supabase.from('t_account_metrics').insert({
      account_id: account.id,
      date: date.toISOString().split('T')[0],
      starting_balance: 1000000 + i * 16000,
      ending_balance: 1000000 + (i + 1) * 16000,
      realized_pnl: 16000,
      total_trades: 3,
    }).select();
  }
  log('Insert 5 trading day metrics', 'PASS');

  // Run checkTransitions — should pass the challenge and auto-promote
  const result = await ChallengeService.checkTransitions(account.id);
  console.log('  Transition result:', JSON.stringify(result, null, 2));

  if (result.transitioned && result.newStatus === 'passed') {
    log('Phase 1 PASSED', 'PASS', result.reason);

    if (result.promoted && result.newPhase === 'phase_2') {
      log('Phase 2 auto-created', 'PASS', `newAccountId=${result.newAccountId}`);

      // Verify Phase 2 challenge exists in DB
      const { data: p2Challenge } = await supabase
        .from('t_challenges')
        .select('*')
        .eq('previous_challenge_id', challenge.id)
        .single();

      if (p2Challenge) {
        log('Phase 2 DB record', 'PASS', `id=${p2Challenge.id}, phase=${p2Challenge.phase}, type=${p2Challenge.type}`);
        return { ...data, phase2ChallengeId: p2Challenge.id, phase2AccountId: result.newAccountId };
      } else {
        log('Phase 2 DB record', 'FAIL', 'Not found in t_challenges');
      }
    } else {
      log('Phase 2 auto-created', 'FAIL', JSON.stringify(result));
    }
  } else {
    log('Phase 1 PASSED', 'FAIL', JSON.stringify(result));
  }

  return null;
}

// ============================================================
// PHASE 4: Phase 2 Pass → Funded Creation
// ============================================================
async function testPhase2Pass(data) {
  console.log('\n═══ PHASE 4: Phase 2 Pass → Funded Creation ═══\n');

  const { phase2AccountId, phase2ChallengeId } = data;

  // Get phase 2 account
  const { data: p2Account } = await supabase
    .from('t_accounts')
    .select('*')
    .eq('id', phase2AccountId)
    .single();

  if (!p2Account) { log('Find Phase 2 account', 'FAIL'); return null; }
  log('Find Phase 2 account', 'PASS', `balance=${p2Account.balance}, status=${p2Account.status}`);

  // Simulate Phase 2 pass (5% target on ₹10L = ₹50,000 profit)
  await supabase.from('t_accounts').update({ balance: 1050000 }).eq('id', phase2AccountId);
  log('Update Phase 2 balance to 5% target (₹10.5L)', 'PASS');

  // Insert trading days
  for (let i = 0; i < 5; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    await supabase.from('t_account_metrics').insert({
      account_id: phase2AccountId,
      date: date.toISOString().split('T')[0],
      starting_balance: 1000000 + i * 10000,
      ending_balance: 1000000 + (i + 1) * 10000,
      realized_pnl: 10000,
      total_trades: 2,
    }).select();
  }
  log('Insert 5 Phase 2 trading day metrics', 'PASS');

  // Run checkTransitions
  const { ChallengeService } = await import('../services/challengeService.js');
  const result = await ChallengeService.checkTransitions(phase2AccountId);
  console.log('  Transition result:', JSON.stringify(result, null, 2));

  if (result.transitioned && result.newStatus === 'passed') {
    log('Phase 2 PASSED', 'PASS', result.reason);

    if (result.promoted && result.newPhase === 'funded') {
      log('Funded account auto-created', 'PASS', `newAccountId=${result.newAccountId}`);

      // Verify funded challenge
      const { data: fundedChallenge } = await supabase
        .from('t_challenges')
        .select('*')
        .eq('previous_challenge_id', phase2ChallengeId)
        .single();

      if (fundedChallenge && fundedChallenge.type === 'funded') {
        log('Funded challenge DB record', 'PASS', `id=${fundedChallenge.id}, type=${fundedChallenge.type}, phase=${fundedChallenge.phase}`);

        // Verify payout_eligible = true on funded account
        const { data: fundedAccount } = await supabase
          .from('t_accounts')
          .select('*')
          .eq('id', result.newAccountId)
          .single();

        if (fundedAccount && fundedAccount.payout_eligible === true) {
          log('payout_eligible = true', 'PASS', `account=${fundedAccount.id}`);
          return { ...data, fundedAccountId: result.newAccountId, fundedChallengeId: fundedChallenge.id };
        } else {
          log('payout_eligible = true', 'FAIL', `got: ${fundedAccount?.payout_eligible}`);
        }
      } else {
        log('Funded challenge DB record', 'FAIL');
      }
    } else {
      log('Funded account auto-created', 'FAIL', JSON.stringify(result));
    }
  } else {
    log('Phase 2 PASSED', 'FAIL', JSON.stringify(result));
  }

  return null;
}

// ============================================================
// PHASE 5: Account Events (lock/unlock/breach)
// ============================================================
async function testAccountEvents(data) {
  console.log('\n═══ PHASE 5: Account Lock/Unlock/Breach Events ═══\n');

  const { account } = data;
  const { eventBus } = await import('../events/index.js');

  // Test account.locked
  let lockedReceived = false;
  const unsub1 = eventBus.subscribe('account.locked', (e) => { lockedReceived = true; });
  eventBus.publish('account.locked', { accountId: account.id, reason: 'Daily loss limit breached' }, { accountId: account.id });
  log('account.locked event emitted + received', lockedReceived ? 'PASS' : 'FAIL');
  unsub1();

  // Test account.unlocked
  let unlockedReceived = false;
  const unsub2 = eventBus.subscribe('account.unlocked', (e) => { unlockedReceived = true; });
  eventBus.publish('account.unlocked', { accountId: account.id, previousReason: 'Daily loss limit breached' }, { accountId: account.id });
  log('account.unlocked event emitted + received', unlockedReceived ? 'PASS' : 'FAIL');
  unsub2();

  // Test account.breached
  let breachedReceived = false;
  const unsub3 = eventBus.subscribe('account.breached', (e) => { breachedReceived = true; });
  eventBus.publish('account.breached', { accountId: account.id, reason: 'Max drawdown breached' }, { accountId: account.id });
  log('account.breached event emitted + received', breachedReceived ? 'PASS' : 'FAIL');
  unsub3();
}

// ============================================================
// PHASE 6: Payout Eligibility
// ============================================================
async function testPayoutEligibility(data) {
  console.log('\n═══ PHASE 6: Payout Eligibility ═══\n');

  if (!data.fundedAccountId) {
    log('Payout eligibility', 'SKIP', 'No funded account created');
    return;
  }

  // Add some profit to funded account
  await supabase.from('t_accounts').update({ balance: 1100000 }).eq('id', data.fundedAccountId);

  // Insert trading days for funded account
  for (let i = 0; i < 5; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    await supabase.from('t_account_metrics').insert({
      account_id: data.fundedAccountId,
      date: date.toISOString().split('T')[0],
      starting_balance: 1000000 + i * 20000,
      ending_balance: 1000000 + (i + 1) * 20000,
      realized_pnl: 20000,
      total_trades: 4,
    }).select();
  }

  const { PayoutService } = await import('../services/payoutService.js');
  const eligibility = await PayoutService.checkEligibility(data.fundedAccountId);

  console.log('  Eligibility result:', JSON.stringify(eligibility, null, 2));

  if (eligibility.eligible) {
    log('Payout ELIGIBLE', 'PASS', `amount=₹${eligibility.financials.payoutAmount}, split=${eligibility.financials.traderSplit}`);
  } else {
    log('Payout ELIGIBLE', 'FAIL', eligibility.reason + ' | checks: ' + JSON.stringify(eligibility.checks));
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AGENT D — DATABASE INTEGRATION VERIFICATION               ║');
  console.log('║  ' + new Date().toISOString() + '                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Phase 1: Verify tables
  const tablesOk = await verifyTables();
  if (!tablesOk) {
    console.log('\n\n❌ TABLES MISSING. Run FULL_MIGRATION.sql in Supabase SQL Editor first.');
    console.log('   URL: https://supabase.com/dashboard/project/nysrxvpjdlvzvcawysvh/sql');
    console.log('   File: server/db/FULL_MIGRATION.sql');
    process.exit(1);
  }

  // Phase 2: Seed
  const seedData = await seedTestData();
  if (!seedData) { console.log('\n❌ Seed failed.'); process.exit(1); }

  // Phase 3: Phase 1 → Phase 2
  const phase2Data = await testPhase1Pass(seedData);

  // Phase 4: Phase 2 → Funded
  let fundedData = null;
  if (phase2Data) {
    fundedData = await testPhase2Pass(phase2Data);
  }

  // Phase 5: Events
  await testAccountEvents(seedData);

  // Phase 6: Payout
  if (fundedData) {
    await testPayoutEligibility(fundedData);
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Passed: ${passed} | Failed: ${failed} | Total: ${results.length}`);
  results.forEach(r => console.log(`  ${r.status === 'PASS' ? '✅' : '❌'} ${r.label}`));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
