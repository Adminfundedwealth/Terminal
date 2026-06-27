import axios from 'axios';
import { config } from 'dotenv';
config();

const BASE = 'http://localhost:4000';

async function main() {
  console.log('=== Full Authenticated Workflow Test ===\n');

  // Step 1: Get SSO token and login
  const r = await axios.get(`${BASE}/auth/dev/generate-sso`, {
    params: { userId: 'prov-test-001', accountId: 'b369c0d4-f9b0-4acb-939c-41157035b25a' }
  });
  
  const ssoR = await axios.get(`${BASE}/auth/sso`, {
    params: { token: r.data.ssoToken },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  
  const jwt = ssoR.headers['set-cookie'][0].split('fw_session=')[1].split(';')[0];
  const h = { headers: { Authorization: `Bearer ${jwt}` }, validateStatus: () => true };
  
  console.log('  ✓ SSO login successful (JWT obtained)');

  // Test all endpoints
  const tests = [
    ['GET /api/account', () => axios.get(`${BASE}/api/account`, h)],
    ['GET /api/account/rules', () => axios.get(`${BASE}/api/account/rules`, h)],
    ['GET /api/positions', () => axios.get(`${BASE}/api/positions`, h)],
    ['GET /api/orders', () => axios.get(`${BASE}/api/orders`, h)],
    ['GET /api/trades', () => axios.get(`${BASE}/api/trades`, h)],
    ['GET /api/watchlists', () => axios.get(`${BASE}/api/watchlists`, h)],
    ['GET /api/journal', () => axios.get(`${BASE}/api/journal`, h)],
    ['GET /api/layouts', () => axios.get(`${BASE}/api/layouts`, h)],
    ['GET /api/themes', () => axios.get(`${BASE}/api/themes`, h)],
    ['GET /api/account/metrics', () => axios.get(`${BASE}/api/account/metrics`, h)],
    ['GET /api/account/equity-curve', () => axios.get(`${BASE}/api/account/equity-curve`, h)],
    ['GET /api/account/challenge', () => axios.get(`${BASE}/api/account/challenge`, h)],
    ['GET /api/account/margin', () => axios.get(`${BASE}/api/account/margin`, h)],
    ['GET /api/ai/status', () => axios.get(`${BASE}/api/ai/status`, h)],
    ['GET /api/ai/coaching', () => axios.get(`${BASE}/api/ai/coaching`, h)],
    ['GET /api/ai/daily-summary', () => axios.get(`${BASE}/api/ai/daily-summary`, h)],
    ['GET /api/kill-switch/status', () => axios.get(`${BASE}/api/kill-switch/status`, h)],
    ['GET /api/copy-trading/config', () => axios.get(`${BASE}/api/copy-trading/config`, h)],
    ['GET /api/alerts', () => axios.get(`${BASE}/api/alerts`, h)],
    ['GET /api/instruments/search?q=NIFTY', () => axios.get(`${BASE}/api/instruments/search?q=NIFTY`, h)],
    ['GET /api/market/status', () => axios.get(`${BASE}/api/market/status`, h)],
    ['GET /api/tv/config', () => axios.get(`${BASE}/api/tv/config`, h)],
    ['GET /api/broker/health', () => axios.get(`${BASE}/api/broker/health`, h)],
    ['POST /api/orders/place', () => axios.post(`${BASE}/api/orders/place`, {
      symbol: 'RELIANCE', token: '2885', segment: 'NSE',
      side: 'BUY', orderType: 'MARKET', qty: 1, productType: 'MIS'
    }, h)],
    ['POST /api/watchlists', () => axios.post(`${BASE}/api/watchlists`, {
      name: 'API Test WL', items: [{symbol:'TCS',token:'11536',exchange:'NSE'}]
    }, h)],
    ['POST /api/journal', () => axios.post(`${BASE}/api/journal`, {
      symbol: 'RELIANCE', side: 'BUY', pnl: 500, emotion: 'confident', notes: 'API test'
    }, h)],
    ['POST /api/layouts', () => axios.post(`${BASE}/api/layouts`, {
      name: 'API Test Layout', layout_type: 'custom', panel_config: {test:true}
    }, h)],
  ];

  let passed = 0, failed = 0;
  for (const [name, fn] of tests) {
    try {
      const res = await fn();
      if (res.status >= 200 && res.status < 300) {
        console.log(`  ✓ ${name} [${res.status}]`);
        passed++;
      } else {
        console.log(`  ✗ ${name} [${res.status}] — ${res.data?.message || res.data?.error || ''}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ ${name} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== RESULTS: ${passed} PASS / ${failed} FAIL / ${tests.length} TOTAL ===`);
}

main().catch(e => console.error('FATAL:', e.message));
