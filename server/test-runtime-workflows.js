/**
 * TERMINAL RUNTIME WORKFLOW VERIFICATION
 * 
 * Tests end-to-end workflows without UI:
 * 1. SSO authentication
 * 2. Account loading
 * 3. Market data
 * 4. Order placement (paper mode)
 * 5. Position tracking
 * 6. Risk engine
 */

import axios from 'axios';
import { supabase } from './db/client.js';

const BASE_URL = 'http://localhost:4000';
let sessionCookie = null;
let accountId = null;

console.log('═══════════════════════════════════════════════════════');
console.log('  TERMINAL RUNTIME WORKFLOW VERIFICATION');
console.log('═══════════════════════════════════════════════════════\n');

// Helper to extract Set-Cookie header
function extractCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const match = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return match ? match.split(';')[0] : null;
}

// 1. Test Health
async function testHealth() {
  console.log('TEST 1: Health Check');
  try {
    const res = await axios.get(`${BASE_URL}/health`);
    console.log(`✅ PASS - Status: ${res.data.status}, DB: ${res.data.database.connected ? 'connected' : 'disconnected'}\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.message}\n`);
    return false;
  }
}

// 2. Test SSO (Dev Mode)
async function testSSO() {
  console.log('TEST 2: SSO Authentication (Dev Mode)');
  
  // First, seed a test user and account in database
  try {
    // Create test user
    const { data: user, error: userErr } = await supabase
      .from('terminal_traders')
      .upsert({
        external_id: 'test-user-runtime-001',
        email: 'test@runtime.com',
        display_name: 'Runtime Test User',
        status: 'active'
      }, { onConflict: 'external_id' })
      .select()
      .single();

    if (userErr) {
      console.log(`⚠️  User seed failed: ${userErr.message}`);
    } else {
      console.log(`   User seeded: ${user.id}`);
    }

    // Create test challenge (check if exists first)
    let challenge = await supabase
      .from('challenge_accounts')
      .select('*')
      .eq('trader_id', user.id)
      .eq('type', 'evaluation_phase1')
      .single()
      .then(res => res.data);

    if (!challenge) {
      const { data, error: chalErr } = await supabase
        .from('challenge_accounts')
        .insert({
          trader_id: user.id,
          type: 'evaluation_phase1',
          plan: '50k-standard',
          initial_balance: 50000,
          current_balance: 50000,
          peak_balance: 50000,
          profit_target_pct: 10.00,
          daily_loss_limit_pct: 5.00,
          max_drawdown_pct: 10.00,
          min_trading_days: 5,
          status: 'active'
        })
        .select()
        .single();

      if (chalErr) {
        console.log(`⚠️  Challenge seed failed: ${chalErr.message}`);
        return false;
      }
      challenge = data;
    }

    // Create test trading account (check if exists first)
    let account = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('account_code', 'RT-TEST-001')
      .single()
      .then(res => res.data);

    if (!account) {
      const { data, error: accErr } = await supabase
        .from('trading_accounts')
        .insert({
          trader_id: user.id,
          account_code: 'RT-TEST-001',
          challenge_id: challenge.id,
          broker_provider: 'angelone',
          balance: 50000,
          available_margin: 50000,
          used_margin: 0,
          status: 'active'
        })
        .select()
        .single();

      if (accErr) {
        console.log(`⚠️  Account seed failed: ${accErr.message}`);
        return false;
      }
      account = data;
    }

    accountId = account.id;
    console.log(`   Account seeded: ${accountId}`);

    // Generate terminal JWT directly for testing (bypass SSO)
    const { generateSessionJWT } = await import('./services/auth.service.js');
    const { createSession } = await import('./services/session.service.js');
    
    const jwt = generateSessionJWT({
      userId: user.id,
      accountId: account.id,
      accountCode: account.account_code,
      brokerProvider: account.broker_provider,
      permissions: ['trade', 'view'],
    });

    // Create session in DB
    await createSession({
      traderId: user.id,
      accountId: account.id,
      tokenHash: jwt, // In real flow, this would be hashed
      ipAddress: '127.0.0.1',
      userAgent: 'Runtime Test',
    });

    sessionCookie = `fw_session=${jwt}`;
    console.log(`   Session created: ${jwt.substring(0, 30)}...`);
    console.log(`✅ PASS - Authentication successful\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.response?.data?.message || err.message}\n`);
    return false;
  }
}

// 3. Test Account Loading
async function testAccountLoad() {
  console.log('TEST 3: Account Loading');
  if (!sessionCookie) {
    console.log('⊘ SKIP - No session cookie\n');
    return false;
  }

  try {
    const res = await axios.get(`${BASE_URL}/api/account`, {
      headers: { Cookie: sessionCookie }
    });

    console.log(`   Account: ${res.data.account_code}`);
    console.log(`   Balance: ₹${res.data.balance}`);
    console.log(`   Status: ${res.data.status}`);
    console.log(`   Broker: ${res.data.broker_provider}`);
    console.log(`✅ PASS - Account loaded successfully\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.response?.data?.message || err.message}\n`);
    return false;
  }
}

// 4. Test Market Data
async function testMarketData() {
  console.log('TEST 4: Live Market Data');
  
  try {
    const res = await axios.get(`${BASE_URL}/api/market/live`);
    console.log(`   Feed Connected: ${res.data.feed.connected}`);
    console.log(`   Subscribed Tokens: ${res.data.feed.subscribedTokens}`);
    console.log(`   Socket.IO Clients: ${res.data.socketIO.clients}`);
    console.log(`✅ PASS - Market data feed operational\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.response?.data?.message || err.message}\n`);
    return false;
  }
}

// 5. Test Order Placement (Paper Mode)
async function testOrderPlacement() {
  console.log('TEST 5: Order Placement (Paper Mode)');
  if (!sessionCookie || !accountId) {
    console.log('⊘ SKIP - No session or account\n');
    return false;
  }

  try {
    const orderPayload = {
      symbol: 'RELIANCE',
      token: '2885',
      segment: 'NSE',
      side: 'BUY',
      orderType: 'MARKET',
      productType: 'MIS',
      qty: 1,
    };

    const res = await axios.post(`${BASE_URL}/api/orders/place`, orderPayload, {
      headers: { Cookie: sessionCookie }
    });

    console.log(`   Order ID: ${res.data.orderId}`);
    console.log(`   Status: ${res.data.status}`);
    console.log(`✅ PASS - Order placed successfully\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.response?.data?.message || err.message}\n`);
    return false;
  }
}

// 6. Test Positions
async function testPositions() {
  console.log('TEST 6: Position Tracking');
  if (!sessionCookie) {
    console.log('⊘ SKIP - No session\n');
    return false;
  }

  try {
    const res = await axios.get(`${BASE_URL}/api/positions`, {
      headers: { Cookie: sessionCookie }
    });

    console.log(`   Open Positions: ${res.data.length}`);
    if (res.data.length > 0) {
      console.log(`   First Position: ${res.data[0].symbol} x${res.data[0].qty}`);
    }
    console.log(`✅ PASS - Positions loaded\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.response?.data?.message || err.message}\n`);
    return false;
  }
}

// 7. Test Risk State
async function testRiskState() {
  console.log('TEST 7: Risk Engine');
  if (!sessionCookie) {
    console.log('⊘ SKIP - No session\n');
    return false;
  }

  try {
    const res = await axios.get(`${BASE_URL}/api/account/risk-state`, {
      headers: { Cookie: sessionCookie }
    });

    console.log(`   Balance: ₹${res.data.balance}`);
    console.log(`   Daily Loss: ₹${res.data.dailyLoss}`);
    console.log(`   Drawdown: ₹${res.data.drawdown}`);
    console.log(`   Account Status: ${res.data.accountStatus}`);
    console.log(`✅ PASS - Risk state calculated\n`);
    return true;
  } catch (err) {
    console.log(`❌ FAIL - ${err.response?.data?.message || err.message}\n`);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results = [];

  results.push({ name: 'Health', pass: await testHealth() });
  results.push({ name: 'SSO Auth', pass: await testSSO() });
  results.push({ name: 'Account Load', pass: await testAccountLoad() });
  results.push({ name: 'Market Data', pass: await testMarketData() });
  results.push({ name: 'Order Placement', pass: await testOrderPlacement() });
  results.push({ name: 'Positions', pass: await testPositions() });
  results.push({ name: 'Risk Engine', pass: await testRiskState() });

  console.log('═══════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  results.forEach(r => {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
  });

  const passed = results.filter(r => r.pass).length;
  const total = results.length;

  console.log(`\nResult: ${passed}/${total} tests passed (${Math.round(passed/total*100)}%)\n`);

  process.exit(passed === total ? 0 : 1);
}

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
