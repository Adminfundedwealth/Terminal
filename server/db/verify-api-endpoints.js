/**
 * API Endpoint Verification — tests all critical backend routes
 * Requires server running with DEV_BYPASS_AUTH=true
 */
import axios from 'axios';

const BASE = 'http://localhost:4000';
const results = [];

function log(endpoint, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : '✗';
  console.log(`  ${icon} ${endpoint}${detail ? ` — ${detail}` : ''}`);
  results.push({ endpoint, status, detail });
}

async function get(path) {
  const r = await axios.get(`${BASE}${path}`, { validateStatus: () => true });
  return r;
}

async function post(path, body = {}) {
  const r = await axios.post(`${BASE}${path}`, body, { validateStatus: () => true });
  return r;
}

async function del(path) {
  const r = await axios.delete(`${BASE}${path}`, { validateStatus: () => true });
  return r;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' TERMINAL API — Endpoint Verification');
  console.log(' (DEV_BYPASS_AUTH mode)');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Health
  const h = await get('/health');
  log('GET /health', h.status === 200 ? 'PASS' : 'FAIL', `db=${h.data.database?.connected}`);

  // Auth
  const v = await get('/auth/verify');
  log('GET /auth/verify', v.status === 401 ? 'PASS' : 'FAIL', `status=${v.status}`);

  // Account
  const acc = await get('/api/account');
  log('GET /api/account', acc.status === 200 ? 'PASS' : 'FAIL', `id=${acc.data?.id || 'dev-account'}`);

  // Positions
  const pos = await get('/api/positions');
  log('GET /api/positions', pos.status === 200 && Array.isArray(pos.data) ? 'PASS' : 'FAIL');

  // Orders
  const ord = await get('/api/orders');
  log('GET /api/orders', ord.status === 200 && Array.isArray(ord.data) ? 'PASS' : 'FAIL');

  // Trades
  const trades = await get('/api/trades');
  log('GET /api/trades', trades.status === 200 && Array.isArray(trades.data) ? 'PASS' : 'FAIL');

  // Watchlists
  const wl = await get('/api/watchlists');
  log('GET /api/watchlists', wl.status === 200 && Array.isArray(wl.data) ? 'PASS' : 'FAIL');

  // Instruments search
  const ins = await get('/api/instruments/search?q=NIFTY');
  log('GET /api/instruments/search', ins.status === 200 && Array.isArray(ins.data) ? 'PASS' : 'FAIL', `results=${ins.data?.length}`);

  // Market status
  const ms = await get('/api/market/status');
  log('GET /api/market/status', ms.status === 200 ? 'PASS' : 'FAIL');

  // Scanner
  const scan = await get('/api/market/scanner?type=top_gainers');
  log('GET /api/market/scanner', scan.status === 200 ? 'PASS' : 'FAIL');

  // Heatmap
  const hm = await get('/api/market/heatmap');
  log('GET /api/market/heatmap', hm.status === 200 ? 'PASS' : 'FAIL');

  // OI Analytics
  const oi = await get('/api/market/oi-analytics?symbol=NIFTY');
  log('GET /api/market/oi-analytics', oi.status === 200 ? 'PASS' : 'FAIL');

  // TradingView config
  const tv = await get('/api/tv/config');
  log('GET /api/tv/config', tv.status === 200 && tv.data?.supported_resolutions ? 'PASS' : 'FAIL');

  // TradingView search
  const tvs = await get('/api/tv/search?query=RELIANCE');
  log('GET /api/tv/search', tvs.status === 200 && Array.isArray(tvs.data) ? 'PASS' : 'FAIL');

  // Layouts
  const lay = await get('/api/layouts');
  log('GET /api/layouts', lay.status === 200 ? 'PASS' : 'FAIL');

  // Themes
  const th = await get('/api/themes');
  log('GET /api/themes', th.status === 200 ? 'PASS' : 'FAIL');

  // Journal
  const jl = await get('/api/journal');
  log('GET /api/journal', jl.status === 200 ? 'PASS' : 'FAIL');

  // Account metrics
  const met = await get('/api/account/metrics');
  log('GET /api/account/metrics', met.status === 200 ? 'PASS' : 'FAIL');

  // Equity curve
  const ec = await get('/api/account/equity-curve');
  log('GET /api/account/equity-curve', ec.status === 200 ? 'PASS' : 'FAIL');

  // Challenge
  const ch = await get('/api/account/challenge');
  log('GET /api/account/challenge', ch.status === 200 ? 'PASS' : 'FAIL');

  // Rules
  const ru = await get('/api/account/rules');
  log('GET /api/account/rules', ru.status === 200 ? 'PASS' : 'FAIL');

  // Margin
  const mg = await get('/api/account/margin');
  log('GET /api/account/margin', mg.status === 200 ? 'PASS' : 'FAIL');

  // AI endpoints
  const aiStatus = await get('/api/ai/status');
  log('GET /api/ai/status', aiStatus.status === 200 && aiStatus.data?.available ? 'PASS' : 'FAIL');

  const aiCoach = await get('/api/ai/coaching');
  log('GET /api/ai/coaching', aiCoach.status === 200 ? 'PASS' : 'FAIL');

  const aiDaily = await get('/api/ai/daily-summary');
  log('GET /api/ai/daily-summary', aiDaily.status === 200 ? 'PASS' : 'FAIL');

  const aiBehavior = await get('/api/ai/behavioral-analysis');
  log('GET /api/ai/behavioral-analysis', aiBehavior.status === 200 ? 'PASS' : 'FAIL');

  // Kill switch status
  const ks = await get('/api/kill-switch/status');
  log('GET /api/kill-switch/status', ks.status === 200 && ks.data?.ready !== undefined ? 'PASS' : 'FAIL');

  // Copy trading config
  const ct = await get('/api/copy-trading/config');
  log('GET /api/copy-trading/config', ct.status === 200 ? 'PASS' : 'FAIL');

  // Copy trading exposure
  const cte = await get('/api/copy-trading/exposure');
  log('GET /api/copy-trading/exposure', cte.status === 200 ? 'PASS' : 'FAIL');

  // Alerts
  const al = await get('/api/alerts');
  log('GET /api/alerts', al.status === 200 ? 'PASS' : 'FAIL');

  // Broker health
  const bh = await get('/api/broker/health');
  log('GET /api/broker/health', bh.status === 200 ? 'PASS' : 'FAIL');

  // Market holiday
  const mh = await get('/api/market/holiday');
  log('GET /api/market/holiday', mh.status === 200 ? 'PASS' : 'FAIL');

  // Place order test
  const orderResult = await post('/api/orders/place', {
    symbol: 'RELIANCE', token: '2885', segment: 'NSE',
    side: 'BUY', orderType: 'MARKET', qty: 1, productType: 'MIS',
  });
  log('POST /api/orders/place', orderResult.status === 200 ? 'PASS' : 'FAIL', `status=${orderResult.data?.status || orderResult.data?.message}`);

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(` RESULTS: ${passed} PASS / ${failed} FAIL / ${results.length} TOTAL`);
  console.log('═══════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\n Failed endpoints:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`   ✗ ${r.endpoint} — ${r.detail}`));
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
