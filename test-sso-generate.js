/**
 * SSO GENERATION ENDPOINT TEST
 * 
 * Tests the /auth/sso/generate endpoint to identify production failure.
 * Run: node test-sso-generate.js
 */

import 'dotenv/config';

const TERMINAL_URL = process.env.TERMINAL_URL || 'http://localhost:4000';
const SSO_API_KEY = process.env.SSO_API_KEY || process.env.PROVISIONING_API_KEY;

console.log('═══════════════════════════════════════════════════════════');
console.log('SSO GENERATION ENDPOINT TEST');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('Configuration:');
console.log(`  TERMINAL_URL: ${TERMINAL_URL}`);
console.log(`  SSO_API_KEY:  ${SSO_API_KEY ? '✓ SET' : '✗ NOT SET'}`);
console.log('');

// Test Case 1: Missing API Key
console.log('TEST 1: Missing API Key');
try {
  const res = await fetch(`${TERMINAL_URL}/auth/sso/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fwUserId: 'test-user-123',
      accountId: '00000000-0000-0000-0000-000000000000',
    }),
  });
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, data);
  if (res.status !== 403) console.log('  ✗ UNEXPECTED: Should return 403 Forbidden');
  else console.log('  ✓ EXPECTED: 403 Forbidden');
} catch (err) {
  console.log(`  ✗ ERROR: ${err.message}`);
}
console.log('');

// Test Case 2: Invalid API Key
console.log('TEST 2: Invalid API Key');
try {
  const res = await fetch(`${TERMINAL_URL}/auth/sso/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sso-api-key': 'invalid-key-12345',
    },
    body: JSON.stringify({
      fwUserId: 'test-user-123',
      accountId: '00000000-0000-0000-0000-000000000000',
    }),
  });
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, data);
  if (res.status !== 403) console.log('  ✗ UNEXPECTED: Should return 403 Forbidden');
  else console.log('  ✓ EXPECTED: 403 Forbidden');
} catch (err) {
  console.log(`  ✗ ERROR: ${err.message}`);
}
console.log('');

// Test Case 3: Valid API Key but Missing fwUserId
console.log('TEST 3: Valid API Key, Missing fwUserId');
try {
  const res = await fetch(`${TERMINAL_URL}/auth/sso/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sso-api-key': SSO_API_KEY,
    },
    body: JSON.stringify({
      accountId: '00000000-0000-0000-0000-000000000000',
    }),
  });
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, data);
  if (res.status !== 400) console.log('  ✗ UNEXPECTED: Should return 400 Bad Request');
  else console.log('  ✓ EXPECTED: 400 Bad Request');
} catch (err) {
  console.log(`  ✗ ERROR: ${err.message}`);
}
console.log('');

// Test Case 4: Valid API Key but Missing accountId
console.log('TEST 4: Valid API Key, Missing accountId');
try {
  const res = await fetch(`${TERMINAL_URL}/auth/sso/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sso-api-key': SSO_API_KEY,
    },
    body: JSON.stringify({
      fwUserId: 'test-user-123',
    }),
  });
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, data);
  if (res.status !== 400) console.log('  ✗ UNEXPECTED: Should return 400 Bad Request');
  else console.log('  ✓ EXPECTED: 400 Bad Request');
} catch (err) {
  console.log(`  ✗ ERROR: ${err.message}`);
}
console.log('');

// Test Case 5: Valid Request (should succeed)
console.log('TEST 5: Valid Request (should generate SSO token)');
try {
  const res = await fetch(`${TERMINAL_URL}/auth/sso/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sso-api-key': SSO_API_KEY,
    },
    body: JSON.stringify({
      fwUserId: 'test-user-123',
      accountId: '00000000-0000-0000-0000-000000000000',
      email: 'test@example.com',
      name: 'Test User',
    }),
  });
  const data = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Response:`, data);
  if (res.status !== 200) console.log(`  ✗ UNEXPECTED: Should return 200 OK, got ${res.status}`);
  else {
    console.log('  ✓ EXPECTED: 200 OK');
    console.log(`  ✓ Token generated: ${data.token ? 'YES' : 'NO'}`);
    console.log(`  ✓ Launch URL: ${data.launchUrl || 'MISSING'}`);
  }
} catch (err) {
  console.log(`  ✗ ERROR: ${err.message}`);
}
console.log('');

console.log('═══════════════════════════════════════════════════════════');
console.log('DIAGNOSIS');
console.log('═══════════════════════════════════════════════════════════\n');

if (!SSO_API_KEY) {
  console.log('✗ BLOCKER: SSO_API_KEY environment variable is NOT SET');
  console.log('  Fix: Set SSO_API_KEY in .env or production environment');
  console.log('  Generate: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
} else {
  console.log('✓ SSO_API_KEY is configured');
  console.log('');
  console.log('Next Steps:');
  console.log('1. Verify Main Website has the same SSO_API_KEY');
  console.log('2. Check Main Website logs for the exact error from Terminal');
  console.log('3. Verify Main Website is sending correct fwUserId and accountId');
  console.log('4. Check if trading_accounts table has the accountId being passed');
}
