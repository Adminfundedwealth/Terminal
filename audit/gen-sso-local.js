/**
 * Generates a valid SSO token locally using the SSO_SHARED_SECRET,
 * then launches the terminal with it.
 * 
 * Requires: SSO_SHARED_SECRET env var matching what's in Railway.
 * 
 * Get it from Railway dashboard: Settings > Variables > SSO_SHARED_SECRET
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const SECRET = process.argv[2] || process.env.SSO_SHARED_SECRET;
const ACCOUNT_ID = process.argv[3] || '6d8938d2-a836-42f4-88e0-d44897c62b48';
const FW_USER_ID = process.argv[4] || '222fe8e0-be22-497f-9f45-debc856be0d2';

if (!SECRET) {
  console.error('Usage: node gen-sso-local.js <SSO_SHARED_SECRET> [account_id] [fw_user_id]');
  console.error('Or: SSO_SHARED_SECRET=xxx node gen-sso-local.js');
  process.exit(1);
}

const token = jwt.sign({
  sub: FW_USER_ID,
  accountId: ACCOUNT_ID,
  challengeId: null,
  email: 'amanks7880@gmail.com',
  name: 'Aman singh',
  nonce: crypto.randomUUID(),
}, SECRET, { expiresIn: '60s' });

const launchUrl = `https://terminal.fundedwealth.com/auth/sso?token=${encodeURIComponent(token)}`;
console.log('TOKEN=' + token);
console.log('LAUNCH_URL=' + launchUrl);
