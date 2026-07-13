/**
 * Waits for Railway to deploy the test endpoint, then runs full test.
 */
const https = require('https');
const { execSync } = require('child_process');

const TEST_SECRET = process.env.TEST_SSO_SECRET || 'fw-test-2024';
const ACCOUNT_ID = '6d8938d2-a836-42f4-88e0-d44897c62b48';
const FW_USER_ID = '222fe8e0-be22-497f-9f45-debc856be0d2';

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'terminal.fundedwealth.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function checkEndpoint() {
  const r = await post('/auth/test/session',
    { fwUserId: FW_USER_ID, accountId: ACCOUNT_ID, email: 'amanks7880@gmail.com', name: 'Aman singh' },
    { 'x-test-secret': TEST_SECRET }
  );
  return r;
}

async function waitForDeploy(maxWait = 300000) {
  const start = Date.now();
  console.log('Waiting for Railway deployment...');
  while (Date.now() - start < maxWait) {
    const r = await checkEndpoint().catch(() => ({ status: 0 }));
    if (r.status === 200 && r.body.launchUrl) {
      console.log('✅ Test endpoint is live!');
      return r.body.launchUrl;
    }
    if (r.status === 404) {
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 10000));
    } else if (r.status === 403) {
      console.log('\n⚠️  Endpoint exists but TEST_SSO_SECRET not set or wrong.');
      console.log('   Set ENABLE_TEST_SSO=true and TEST_SSO_SECRET=' + TEST_SECRET + ' in Railway');
      return null;
    } else if (r.status === 0) {
      process.stdout.write('·');
      await new Promise(r => setTimeout(r, 5000));
    } else {
      console.log('\nUnexpected response:', r.status, JSON.stringify(r.body).substring(0,100));
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  return null;
}

waitForDeploy().then(launchUrl => {
  if (launchUrl) {
    console.log('\nLAUNCH_URL=' + launchUrl);
    console.log('\nRunning full test...');
    try {
      execSync(`node audit/prod-full-test.js "" ""`, {
        env: { ...process.env, TEST_LAUNCH_URL: launchUrl },
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch(e) {}
  } else {
    console.log('\nCannot test without valid session.');
    console.log('Set Railway env vars:');
    console.log('  ENABLE_TEST_SSO=true');
    console.log('  TEST_SSO_SECRET=fw-test-2024');
    console.log('Then re-run: node audit/wait-and-test.js');
  }
});
