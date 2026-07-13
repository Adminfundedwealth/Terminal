const https = require('https');

const KEY = process.argv[2] || 'fw-provision-key-2024-secure';
const ACCOUNT_ID = '6d8938d2-a836-42f4-88e0-d44897c62b48';
const FW_USER_ID = '222fe8e0-be22-497f-9f45-debc856be0d2';

const body = JSON.stringify({ fwUserId: FW_USER_ID, accountId: ACCOUNT_ID, email: 'amanks7880@gmail.com', name: 'Aman singh' });
const req = https.request({
  hostname: 'terminal.fundedwealth.com',
  path: '/auth/sso/generate',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-sso-api-key': KEY }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try { const j = JSON.parse(d); console.log(JSON.stringify(j, null, 2)); }
    catch { console.log(d.substring(0,300)); }
  });
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
