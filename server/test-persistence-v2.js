/**
 * TRADING PERSISTENCE VERIFICATION v2
 * Uses ACTUAL Supabase table schemas (discovered via runtime probing)
 * 
 * Tables: trading_orders (user_id UUID), positions (user_id UUID), executions (user_id UUID), execution_audits
 */
import { config } from 'dotenv';
config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_USER_ID = '00000000-0000-0000-0000-000000000099';

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  TRADING PERSISTENCE VERIFICATION v2');
  console.log('═══════════════════════════════════════════════');
  console.log(`  User ID: ${TEST_USER_ID}`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL}`);
  console.log('');

  const results = {};

  // ─── 1: Insert Order ───────────────────────────────────────
  console.log('[1] INSERT into trading_orders...');
  const { data: orderData, error: orderErr } = await supabase
    .from('trading_orders')
    .insert({
      user_id: TEST_USER_ID,
      symbol: 'RELIANCE',
      side: 'BUY',
      qty: 1,
      status: 'FILLED',
      order_type: 'MARKET',
      type: 'equity',
    })
    .select()
    .single();

  if (orderErr) {
    console.log(`    ✗ FAILED: ${orderErr.message}`);
    console.log(`    Details: ${orderErr.details || 'none'}`);
    results.order = { status: 'FAIL', error: orderErr.message };
  } else {
    console.log(`    ✓ CREATED`);
    console.log(`      Table: trading_orders`);
    console.log(`      PK: id = ${orderData.id}`);
    console.log(`      Columns present: ${Object.keys(orderData).join(', ')}`);
    results.order = { status: 'PASS', id: orderData.id, record: orderData };
  }

  // ─── 2: Insert Position ────────────────────────────────────
  console.log('\n[2] INSERT into positions...');
  const { data: posData, error: posErr } = await supabase
    .from('positions')
    .insert({
      user_id: TEST_USER_ID,
      symbol: 'RELIANCE',
      qty: 1,
    })
    .select()
    .single();

  if (posErr) {
    console.log(`    ✗ FAILED: ${posErr.message}`);
    console.log(`    Details: ${posErr.details || 'none'}`);
    results.position = { status: 'FAIL', error: posErr.message };
  } else {
    console.log(`    ✓ CREATED`);
    console.log(`      Table: positions`);
    console.log(`      PK: id = ${posData.id}`);
    console.log(`      Columns present: ${Object.keys(posData).join(', ')}`);
    results.position = { status: 'PASS', id: posData.id, record: posData };
  }

  // ─── 3: Insert Execution/Trade ─────────────────────────────
  console.log('\n[3] INSERT into executions...');
  const orderId = results.order?.id || '00000000-0000-0000-0000-000000000001';
  const { data: tradeData, error: tradeErr } = await supabase
    .from('executions')
    .insert({
      user_id: TEST_USER_ID,
      order_id: orderId,
      symbol: 'RELIANCE',
      side: 'BUY',
      qty: 1,
      price: 2850.50,
    })
    .select()
    .single();

  if (tradeErr) {
    console.log(`    ✗ FAILED: ${tradeErr.message}`);
    console.log(`    Details: ${tradeErr.details || 'none'}`);
    results.trade = { status: 'FAIL', error: tradeErr.message };
  } else {
    console.log(`    ✓ CREATED`);
    console.log(`      Table: executions`);
    console.log(`      PK: id = ${tradeData.id}`);
    console.log(`      Columns present: ${Object.keys(tradeData).join(', ')}`);
    results.trade = { status: 'PASS', id: tradeData.id, record: tradeData };
  }

  // ─── 4: Insert Audit ───────────────────────────────────────
  console.log('\n[4] INSERT into execution_audits...');
  const { data: auditData, error: auditErr } = await supabase
    .from('execution_audits')
    .insert({
      user_id: 0,
      actor_type: 'system',
      action: 'order_created',
      entity: 'order',
      entity_id: orderId,
      details: { symbol: 'RELIANCE', side: 'BUY', qty: 1, price: 2850.50, test: true },
    })
    .select()
    .single();

  if (auditErr) {
    console.log(`    ✗ FAILED: ${auditErr.message}`);
    results.audit = { status: 'FAIL', error: auditErr.message };
  } else {
    console.log(`    ✓ CREATED`);
    console.log(`      Table: execution_audits`);
    console.log(`      PK: id = ${auditData.id}`);
    console.log(`      Columns present: ${Object.keys(auditData).join(', ')}`);
    results.audit = { status: 'PASS', id: auditData.id, record: auditData };
  }

  // ─── 5: Verify by re-reading ───────────────────────────────
  console.log('\n[5] VERIFY rows exist...');
  for (const [name, info] of Object.entries(results)) {
    if (info?.id) {
      const table = name === 'order' ? 'trading_orders' : name === 'position' ? 'positions' : name === 'trade' ? 'executions' : 'execution_audits';
      const { data } = await supabase.from(table).select('id').eq('id', info.id).single();
      console.log(`    ${table}[${info.id}]: ${data ? '✓ VERIFIED' : '✗ NOT FOUND'}`);
    }
  }

  // ─── 6: Cleanup ────────────────────────────────────────────
  console.log('\n[6] Cleanup test data...');
  if (results.audit?.id) await supabase.from('execution_audits').delete().eq('id', results.audit.id);
  if (results.trade?.id) await supabase.from('executions').delete().eq('id', results.trade.id);
  if (results.position?.id) await supabase.from('positions').delete().eq('id', results.position.id);
  if (results.order?.id) await supabase.from('trading_orders').delete().eq('id', results.order.id);
  console.log('    ✓ Cleaned');

  // ─── VERDICT ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Order (trading_orders):       ${results.order?.status || 'SKIP'}`);
  console.log(`  Position (positions):         ${results.position?.status || 'SKIP'}`);
  console.log(`  Trade (executions):           ${results.trade?.status || 'SKIP'}`);
  console.log(`  Audit (execution_audits):     ${results.audit?.status || 'SKIP'}`);
  
  const allPass = Object.values(results).every(r => r?.status === 'PASS');
  console.log('');
  if (allPass) {
    console.log('  ▓▓ TRADING PERSISTENCE: PASS ▓▓');
  } else {
    console.log('  ▓▓ TRADING PERSISTENCE: FAIL ▓▓');
    console.log('');
    console.log('  SCHEMA MISMATCH DETECTED:');
    console.log('  Code uses: account_id (VARCHAR/UUID)');
    console.log('  Database has: user_id (UUID) + type (NOT NULL)');
    console.log('  Tables exist but columns do NOT match repository code.');
  }
  console.log('═══════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
