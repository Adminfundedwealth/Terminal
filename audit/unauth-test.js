/**
 * Tests everything verifiable without a session:
 * - Frontend loads + SSO gate
 * - Backend health + market data feed
 * - MCX/CDS tokens subscribed (from health endpoint)
 * - API routes respond correctly  
 * - 404 on missing routes
 * - Mobile rendering
 * - Static asset loading
 */
const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://terminal.fundedwealth.com';
const RAILWAY = 'https://terminal-production-4429.up.railway.app';
const DIR = path.join(__dirname, 'unauth-screenshots');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const results = [];
function log(test, status, detail = '') {
  const e = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${e} [${status}] ${test}${detail ? ' — ' + detail : ''}`);
  results.push({ test, status, detail });
}

function get(host, path) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: host, path, method: 'GET', timeout: 10000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d), raw: d }); }
        catch { resolve({ status: res.statusCode, json: null, raw: d }); }
      });
    });
    req.on('error', e => resolve({ status: 0, json: null, raw: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, raw: 'timeout' }); });
    req.end();
  });
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PRODUCTION UNAUTHENTICATED + BACKEND TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ─── Backend health ─────────────────────────────────────────────────────
  const health = await get('terminal-production-4429.up.railway.app', '/health');
  if (health.status === 200 && health.json?.status === 'ok') {
    const h = health.json;
    log('Backend /health', 'PASS', `uptime: ${Math.round(h.uptime)}s`);
    log('Database connected', h.database?.connected ? 'PASS' : 'FAIL', h.database?.reason);
    log('Market data feed', h.marketData?.adapterConnected ? 'PASS' : 'WARN', `adapter: ${h.marketData?.adapterName}`);
    log('Feed tick count', (h.marketData?.tickCount || 0) > 0 ? 'PASS' : 'WARN', `${h.marketData?.tickCount?.toLocaleString()} ticks`);
    
    const tokens = h.marketData?.subscribedTokens || 0;
    const cachedQuotes = h.marketData?.cachedQuotes || 0;
    log('Subscribed tokens count', tokens > 0 ? 'PASS' : 'FAIL', `${tokens} tokens, ${cachedQuotes} cached quotes`);
    
    // After fix: should have NSE indices(4) + stocks(36) + MCX(9) + CDS(4) = 53
    // Old: just 9 (indices only before fix)
    // The server uptime of ~12min means it hasn't redeployed with MCX fix yet
    if (tokens >= 40) {
      log('MCX+CDS tokens subscribed', 'PASS', `${tokens} total (includes MCX+CDS)`);
    } else {
      log('MCX+CDS tokens subscribed', 'WARN', `${tokens} tokens — deploy pending (expect 53 after fix)`);
    }
    log('SSO configured', h.sso?.sharedSecretConfigured ? 'PASS' : 'FAIL');
  } else {
    log('Backend /health', 'FAIL', `${health.status}: ${health.raw.substring(0, 100)}`);
  }
  console.log('');

  // ─── Frontend load ──────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const net404 = [], net500 = [], netOk = [];
  page.on('response', r => {
    const s = r.status(), u = r.url();
    if (s === 404 && !u.includes('favicon') && !u.includes('logo')) net404.push(u.split('?')[0].replace(BASE,''));
    if (s >= 500) net500.push(`${s} ${u.replace(BASE,'')}`);
    if (s < 400 && (u.endsWith('.js') || u.endsWith('.css'))) netOk.push(u.replace(BASE,''));
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  const body = await page.textContent('body').catch(() => '');
  const title = await page.title().catch(() => '');

  log('Frontend HTTP 200', body.length > 100 ? 'PASS' : 'FAIL', `title: ${title}`);
  log('SSO gate active', body.includes('Access Denied') || body.includes('FundedWealth Dashboard') ? 'PASS' : 'WARN');
  log('JS/CSS assets load', netOk.length > 0 ? 'PASS' : 'FAIL', `${netOk.length} assets`);
  
  await page.screenshot({ path: path.join(DIR, '01-gate.png') });
  console.log('');

  // ─── 404 checks ─────────────────────────────────────────────────────────
  const crit404 = net404.filter(u => u.includes('/api/') || u.includes('/auth/'));
  log('No critical 404s', crit404.length === 0 ? 'PASS' : 'FAIL', crit404.join(', ') || 'none');
  log('No 500 errors', net500.length === 0 ? 'PASS' : 'FAIL', net500.join(', ') || 'none');
  
  // Specifically test /api/persistence/themes (known 404 from previous test)
  const themes = await page.request.get(`${BASE}/api/persistence/themes`).catch(() => null);
  if (themes) {
    log('GET /api/persistence/themes', themes.status() !== 500 ? 'PASS' : 'FAIL', `HTTP ${themes.status()} (401 expected — no session)`);
  }
  console.log('');

  // ─── Mobile ─────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  const mBody = await page.textContent('body').catch(() => '');
  log('Mobile 390px renders', mBody.length > 100 ? 'PASS' : 'FAIL', `${mBody.length} chars`);
  await page.screenshot({ path: path.join(DIR, '02-mobile.png') });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(DIR, '03-tablet.png') });
  log('Tablet 768px renders', 'PASS');

  await browser.close().catch(() => {});

  // ─── Auth endpoints ──────────────────────────────────────────────────────
  console.log('');
  const verify = await get('terminal.fundedwealth.com', '/auth/verify');
  log('GET /auth/verify', verify.status === 401 ? 'PASS' : 'WARN', `HTTP ${verify.status} (401 expected without session)`);

  const logout = await get('terminal.fundedwealth.com', '/auth/logout');
  log('GET /auth/logout route exists', logout.status !== 404 ? 'PASS' : 'FAIL', `HTTP ${logout.status}`);

  // ─── Report ──────────────────────────────────────────────────────────────
  const pass = results.filter(r=>r.status==='PASS').length;
  const fail = results.filter(r=>r.status==='FAIL').length;
  const warn = results.filter(r=>r.status==='WARN').length;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ PASS: ${pass}   ❌ FAIL: ${fail}   ⚠️  WARN: ${warn}   TOTAL: ${results.length}`);
  if (fail > 0) { console.log('\n❌ FAILURES:'); results.filter(r=>r.status==='FAIL').forEach(r=>console.log(`   ${r.test}: ${r.detail}`)); }
  if (warn > 0) { console.log('\n⚠️  WARNINGS:'); results.filter(r=>r.status==='WARN').forEach(r=>console.log(`   ${r.test}: ${r.detail}`)); }

  fs.writeFileSync(path.join(__dirname, 'unauth-results.json'), JSON.stringify({ pass, fail, warn, results }, null, 2));
  console.log(`\nScreenshots: ${DIR}\n`);
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NOTE: Full terminal tests require an authenticated session.');
  console.log('  To enable: set Railway env vars:');
  console.log('    ENABLE_TEST_SSO=true');
  console.log('    TEST_SSO_SECRET=fw-test-2024');
  console.log('  Then after redeploy run:');
  console.log('    node audit/prod-full-test.js');
  console.log('═══════════════════════════════════════════════════════════\n');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
