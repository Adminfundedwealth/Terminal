const https = require('https');
function get(host, path) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: host, path, method: 'GET', timeout: 8000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function main() {
  const h1 = await get('terminal-production-4429.up.railway.app', '/health');
  console.log('Railway backend uptime:', h1?.uptime, 'seconds =', Math.round((h1?.uptime||0)/86400), 'days');
  console.log('Subscribed tokens:', h1?.marketData?.subscribedTokens);
  console.log('Cached quotes:', h1?.marketData?.cachedQuotes);
  console.log('Feed connected:', h1?.marketData?.adapterConnected);
  console.log('SSO secret set:', h1?.sso?.sharedSecretConfigured);
  
  const h2 = await get('terminal.fundedwealth.com', '/health');
  console.log('\nVercel proxy /health uptime:', h2?.uptime, 'seconds');
  console.log('(Same server if uptimes match)');
  
  // Check if our new commit is deployed by checking for /auth/test/session
  const testEp = await new Promise((resolve) => {
    const req = https.request({ hostname: 'terminal-production-4429.up.railway.app', path: '/auth/test/session', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 2, 'x-test-secret': 'fw-test-2024' },
      timeout: 5000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.substring(0,100) }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    req.write('{}'); req.end();
  });
  console.log('\n/auth/test/session:', testEp.status, testEp.body.substring(0,80));
  if (testEp.status === 404) console.log('→ New code NOT deployed yet (endpoint missing)');
  if (testEp.status === 403) console.log('→ New code IS deployed (endpoint exists, but ENABLE_TEST_SSO not set)');
  if (testEp.status === 200) console.log('→ Test endpoint active!');
}

main().catch(e => console.error(e.message));
