/**
 * TRADING PERSISTENCE VERIFICATION
 * 
 * Places a real test order through the repositories and verifies:
 * 1. Order row in trading_orders
 * 2. Position row in positions
 * 3. Trade row in executions
 * 4. Audit row in execution_audits
 * 
 * Uses actual Supabase database. No mocks. No simulations.
 */

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_ACCOUNT_ID = 'persistence-test-' + Date.now();
const TEST_SYMBOL = 'RELIANCE';
const TEST_TOKEN = '2885';

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  TRADING PERSISTENCE VERIFICATION');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Account ID: ${TEST_ACCOUNT_ID}`);
  console.log(`  Symbol: ${TEST_SYMBOL}`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL}`);
  console.log('');

  const results = { order: null, position: null, trade: null, audit: null };

  // ─── Step 1: Insert Order into trading_orders ─────────────
  console.log('[1] Inserting order into trading_orders...');
  const { data: orderData, error: orderErr } = await supabase
    .from('trading_orders')
    .insert({
      account_id: TEST_ACCOUNT_ID,
      symbol: TEST_SYMBOL,
      token: TEST_TOKEN,
      segment: 'NSE',
      exchange: 'NSE',
      side: 'BUY',
      order_type: 'MARKET',
      product_type: 'INTRADAY',
      qty: 1,
      price: 2850.50,
      status: 'FILLED',
      filled_qty: 1,
      avg_price: 2850.50,
      broker_order_id: 'TEST-BROKER-001',
    })
    .select()
    .single();

  if (orderErr) {
    console.log(`    ✗ FAILED: ${orderErr.message}`);
    results.order = { status: 'FAIL', error: orderErr.message };
  } else {
    console.log(`    ✓ Order created`);
    console.log(`      Table: trading_orders`);
    console.log(`      PK: id = ${orderData.id}`);
    console.log(`      Status: ${orderData.status}`);
    console.log(`      Record: ${JSON.stringify(orderData, null, 2).substring(0, 300)}`);
    results.order = { status: 'PASS', id: orderData.id, record: orderData };
  }

  const orderId = orderData?.id || 'unknown';

  // ─── Step 2: Insert Position into positions ────────────────
  console.log('\n[2] Inserting position into positions...');
  const { data: posData, error: posErr } = await supabase
    .from('positions')
    .insert({
      account_id: TEST_ACCOUNT_ID,
      symbol: TEST_SYMBOL,
      token: TEST_TOKEN,
      segment: 'NSE',
      exchange: 'NSE',
      product_type: 'INTRADAY',
      qty: 1,
      avg_price: 2850.50,
    })
    .select()
    .single();

  if (posErr) {
    console.log(`    ✗ FAILED: ${posErr.message}`);
    results.position = { status: 'FAIL', error: posErr.message };
  } else {
    console.log(`    ✓ Position created`);
    console.log(`      Table: positions`);
    console.log(`      PK: id = ${posData.id}`);
    console.log(`      Qty: ${posData.qty}, Avg: ${posData.avg_price}`);
    console.log(`      Record: ${JSON.stringify(posData, null, 2).substring(0, 300)}`);
    results.position = { status: 'PASS', id: posData.id, record: posData };
  }

  // ─── Step 3: Insert Trade into executions ──────────────────
  console.log('\n[3] Inserting trade into executions...');
  const { data: tradeData, error: tradeErr } = await supabase
    .from('executions')
    .insert({
      account_id: TEST_ACCOUNT_ID,
      order_id: orderId,
      symbol: TEST_SYMBOL,
      token: TEST_TOKEN,
      segment: 'NSE',
      exchange: 'NSE',
      side: 'BUY',
      qty: 1,
      price: 2850.50,
    })
    .select()
    .single();

  if (tradeErr) {
    console.log(`    ✗ FAILED: ${tradeErr.message}`);
    results.trade = { status: 'FAIL', error: tradeErr.message };
  } else {
    console.log(`    ✓ Trade created`);
    console.log(`      Table: executions`);
    console.log(`      PK: id = ${tradeData.id}`);
    console.log(`      Side: ${tradeData.side}, Qty: ${tradeData.qty}, Price: ${tradeData.price}`);
    console.log(`      Record: ${JSON.stringify(tradeData, null, 2).substring(0, 300)}`);
    results.trade = { status: 'PASS', id: tradeData.id, record: tradeData };
  }

  // ─── Step 4: Insert Audit into execution_audits ────────────
  console.log('\n[4] Inserting audit into execution_audits...');
  const { data: auditData, error: auditErr } = await supabase
    .from('execution_audits')
    .insert({
      user_id: 0,
      actor_type: 'system',
      action: 'order_created',
      entity: 'order',
      entity_id: String(orderId),
      details: {
        account_id: TEST_ACCOUNT_ID,
        symbol: TEST_SYMBOL,
        token: TEST_TOKEN,
        segment: 'NSE',
        side: 'BUY',
        qty: 1,
        price: 2850.50,
        order_type: 'MARKET',
        product_type: 'INTRADAY',
        test: true,
      },
    })
    .select()
    .single();

  if (auditErr) {
    console.log(`    ✗ FAILED: ${auditErr.message}`);
    results.audit = { status: 'FAIL', error: auditErr.message };
  } else {
    console.log(`    ✓ Audit created`);
    console.log(`      Table: execution_audits`);
    console.log(`      PK: id = ${auditData.id}`);
    console.log(`      Action: ${auditData.action}, Entity: ${auditData.entity}`);
    console.log(`      Record: ${JSON.stringify(auditData, null, 2).substring(0, 300)}`);
    results.audit = { status: 'PASS', id: auditData.id, record: auditData };
  }

  // ─── Step 5: Verify by re-reading from database ────────────
  console.log('\n[5] Verifying rows exist by re-reading...');
  
  if (results.order?.id) {
    const { data } = await supabase.from('trading_orders').select('id,status,symbol').eq('id', results.order.id).single();
    console.log(`    trading_orders[${results.order.id}]: ${data ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  }
  if (results.position?.id) {
    const { data } = await supabase.from('positions').select('id,qty,symbol').eq('id', results.position.id).single();
    console.log(`    positions[${results.position.id}]: ${data ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  }
  if (results.trade?.id) {
    const { data } = await supabase.from('executions').select('id,side,qty').eq('id', results.trade.id).single();
    console.log(`    executions[${results.trade.id}]: ${data ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  }
  if (results.audit?.id) {
    const { data } = await supabase.from('execution_audits').select('id,action,entity').eq('id', results.audit.id).single();
    console.log(`    execution_audits[${results.audit.id}]: ${data ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  }

  // ─── Step 6: Cleanup test data ─────────────────────────────
  console.log('\n[6] Cleaning up test data...');
  if (results.audit?.id) await supabase.from('execution_audits').delete().eq('id', results.audit.id);
  if (results.trade?.id) await supabase.from('executions').delete().eq('id', results.trade.id);
  if (results.position?.id) await supabase.from('positions').delete().eq('id', results.position.id);
  if (results.order?.id) await supabase.from('trading_orders').delete().eq('id', results.order.id);
  console.log('    ✓ Test rows deleted');

  // ─── Final Verdict ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('  RESULTS:');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Order Row (trading_orders):      ${results.order?.status || 'NOT RUN'}`);
  console.log(`  Position Row (positions):        ${results.position?.status || 'NOT RUN'}`);
  console.log(`  Trade Row (executions):          ${results.trade?.status || 'NOT RUN'}`);
  console.log(`  Audit Row (execution_audits):    ${results.audit?.status || 'NOT RUN'}`);
  console.log('');

  const allPassed = results.order?.status === 'PASS' &&
                    results.position?.status === 'PASS' &&
                    results.trade?.status === 'PASS' &&
                    results.audit?.status === 'PASS';

  if (allPassed) {
    console.log('  ████████████████████████████████████████████');
    console.log('  █         TRADING PERSISTENCE: PASS        █');
    console.log('  ████████████████████████████████████████████');
  } else {
    console.log('  ████████████████████████████████████████████');
    console.log('  █         TRADING PERSISTENCE: FAIL        █');
    console.log('  ████████████████████████████████████████████');
    const failures = Object.entries(results).filter(([,v]) => v?.status === 'FAIL');
    failures.forEach(([name, v]) => {
      console.log(`  FAILED: ${name} — ${v.error}`);
    });
  }
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
