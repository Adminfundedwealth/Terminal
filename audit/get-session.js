/**
 * Gets a real SSO session for testing.
 * Uses /auth/sso/generate with SSO_API_KEY from env or argument.
 * Usage: node get-session.js <SSO_API_KEY> <ACCOUNT_ID> <FW_USER_ID>
 */
const https = require('https');

const API_KEY = process.argv[2] || process.env.SSO_API_KEY || process.env.PROVISIONING_API_KEY;
const ACCOUNT_ID = process.argv[3] || process.env.TEST_ACCOUNT_ID;
const FW_USER_ID = process.argv[4] || process.env.TEST_FW_USER_ID || 'test-user-1';

if (!API_KEY) {
  console.error('Usage: node get-session.js <SSO_API_KEY> <ACCOUNT_ID> [FW_USER_ID]');
  console.error('Or set SSO_API_KEY and TEST_ACCOUNT_ID env vars');
  process.exit(1);
}

if (!ACCOUNT_ID) {
  console.error('ACCOUNT_ID required as 2nd argument or TEST_ACCOUNT_ID env var');
  process.exit(1);
}

const body = JSON.stringify({
  fwUserId: FW_USER_ID,
  accountId: ACCOUNT_ID,
  email: 'test@fundedwealth.com',
  name: 'Test Trader'
});

const options = {
  hostname: 'terminal.fundedwealth.com',
  path: '/auth/sso/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-sso-api-key': API_KEY
  }
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.launchUrl) {
        console.log('LAUNCH_URL=' + json.launchUrl);
        console.log('TOKEN=' + json.token);
      } else {
        console.error('Failed:', JSON.stringify(json));
        process.exit(1);
      }
    } catch(e) {
      console.error('Parse error:', data.substring(0, 200));
      process.exit(1);
    }
  });
});
req.on('error', e => { console.error(e.message); process.exit(1); });
req.write(body);
req.end();
