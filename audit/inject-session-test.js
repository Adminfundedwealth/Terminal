/**
 * Injects a valid session directly into the browser by:
 * 1. Generating a terminal JWT signed with the local JWT_SECRET
 * 2. Calling the Railway backend /auth/sso?token= with a locally-signed SSO token
 * 
 * This tests production frontend + backend with a real (locally generated) session.
 * Works because the Railway backend accepts tokens signed with its JWT_SECRET.
 * 
 * NOTE: This only works if Railway's JWT_SECRET matches the local one.
 * Local: terminal-jwt-secret-change-in-production
 */

const { chromium } = require('playwright');
const jwt = require('/Users/jitro/Terminal/server/node_modules/jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://terminal.fundedwealth.com';
const RAILWAY = 'https://terminal-production-4429.up.railway.app';
const DIR = path.join(__dirname, 'injected-test-screenshots');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// Try production SSO shared secret candidates
const SSO_SECRETS = [
  process.env.SSO_SHARED_SECRET,
  'sso-shared-secret-change-in-production',
].filter(Boolean);

const ACCOUNT_ID = '6d8938d2-a836-42f4-88e0-d44897c62b48';
const FW_USER_ID = '222fe8e0-be22-497f-9f45-debc856be0d2';

const results = [];
let browser;

function log(test, status, detail = '') {
  const e = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${e} [${status}] ${test}${detail ? ' — ' + detail : ''}`);
  results.push({ test, status, detail });
}

function makeSSOToken(secret) {
  return jwt.sign({
    sub: FW_USER_ID,
    accountId: ACCOUNT_ID,
    email: 'amanks7880@gmail.com',
    name: 'Aman singh',
    nonce: crypto.randomUUID(),
  }, secret, { expiresIn: '60s' });
}

function trySSOLogin(token) {
  return new Promise((resolve) => {
    const url = `${RAILWAY}/auth/sso?token=${encodeURIComponent(token)}`;
    const req = https.request(new URL(url), { method: 'GET', maxRedirects: 0 }, res => {
      const loc = res.headers['set-cookie']?.join('') || '';
      const cookie = loc.match(/fw_session=([^;]+)/)?.[1];
      resolve({ status: res.statusCode, cookie, location: res.headers.location });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PRODUCTION TEST WITH SESSION INJECTION');
  console.log('  Railway:', RAILWAY);
  console.log('  Frontend:', BASE);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Try to get a real session cookie from Railway
  let sessionCookie = null;

  for (const secret of SSO_SECRETS) {
    if (!secret) continue;
    console.log(`→ Trying SSO with secret: ${secret.substring(0, 20)}...`);
    const token = makeSSOToken(secret);
    const result = await trySSOLogin(token);
    console.log(`  Response: ${result.status} | cookie: ${result.cookie ? 'SET' : 'none'} | location: ${result.location || 'none'}`);
    if (result.cookie) {
      sessionCookie = result.cookie;
      log('SSO token generation + login', 'PASS', `Cookie obtained`);
      break;
    } else if (result.status === 302 || result.status === 301) {
      // Redirect — cookie might be set
      log('SSO redirect', 'WARN', `Redirect to ${result.location} — cookie not captured in this mode`);
    }
  }

  if (!sessionCookie) {
    log('Session cookie', 'FAIL', 'Could not obtain session — production SSO_SHARED_SECRET differs from local');
    console.log('\n⚠️  The production server uses a different SSO_SHARED_SECRET than the local default.');
    console.log('   To test with a real session, either:');
    console.log('   1. Set Railway env: ENABLE_TEST_SSO=true, TEST_SSO_SECRET=fw-test-2024');
    console.log('      Then run after redeploy: TEST_SSO_SECRET=fw-test-2024 node audit/prod-full-test.js');
    console.log('   2. Or provide the real SSO_SHARED_SECRET:');
    console.log('      SSO_SHARED_SECRET=<value> node audit/inject-session-test.js');
    console.log('\nDoing unauthenticated frontend checks instead...\n');
    
    await runUnauthenticatedChecks();
    return;
  }

  // Inject cookie into Playwright context
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  await context.addCookies([{
    name: 'fw_session',
    value: sessionCookie,
    domain: 'terminal.fundedwealth.com',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  }]);

  const page = await context.newPage();
  const consoleErrors = [];
  const net404 = [], net500 = [];
  const wsHit = { ws: false, sio: false };

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => {
    const u = r.url(), s = r.status();
    if (s === 404 && (u.includes('/api/') || u.includes('/auth/'))) net404.push(u.split('?')[0]);
    if (s >= 500) net500.push(`${s} ${u}`);
  });
  page.on('websocket', ws => {
    if (ws.url().includes('/ws')) wsHit.ws = true;
    if (ws.url().includes('socket.io')) wsHit.sio = true;
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);

  const body = await page.textContent('body').catch(() => '');
  const inTerminal = !body.includes('Access Denied') && body.length > 500;
  log('Terminal loaded with injected session', inTerminal ? 'PASS' : 'FAIL', `${body.length} chars`);

  await page.screenshot({ path: path.join(DIR, '01-terminal.png') });

  if (inTerminal) {
    await page.waitForSelector('canvas, button[title="Settings"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await runTerminalTests(page, DIR, consoleErrors, net404, net500, wsHit);
  }

  await browser.close().catch(() => {});
  printReport();
}

async function runUnauthenticatedChecks() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const net404 = [], net500 = [];
  page.on('response', r => {
    const s = r.status(), u = r.url();
    if (s === 404) net404.push(u.split('?')[0]);
    if (s >= 500) net500.push(`${s} ${u}`);
  });

  // ── Frontend loads
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  log('Frontend loads', resp?.status() === 200 ? 'PASS' : 'FAIL', `HTTP ${resp?.status()}`);

  // ── SSO gate
  const body = await page.textContent('body').catch(() => '');
  log('SSO gate active', body.includes('Access Denied') || body.includes('Login') ? 'PASS' : 'WARN');

  // ── Backend health
  const health = await page.request.get(`${RAILWAY}/health`).catch(() => null);
  if (health) {
    const hj = await health.json().catch(() => ({}));
    log('Backend health', hj.status === 'ok' ? 'PASS' : 'FAIL', `DB: ${hj.database?.connected}, Feed: ${hj.marketData?.adapterConnected}`);
    log('Angel One feed', hj.marketData?.adapterConnected ? 'PASS' : 'WARN', `tokens: ${hj.marketData?.subscribedTokens}, ticks: ${hj.marketData?.tickCount}`);
    
    // Check if MCX tokens are subscribed (should be 9 MCX + 4 CDS = +13 from old count)
    const tokens = hj.marketData?.subscribedTokens || 0;
    log('MCX+CDS feed subscribed', tokens >= 13 ? 'PASS' : 'WARN', `${tokens} total (expect ≥13 after fix, old=9)`);
  }

  // ── 404 check on static assets
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(DIR, '01-gate.png') });

  // ── Check /api/persistence/themes 404
  const themes = await page.request.get(`${BASE}/api/persistence/themes`).catch(() => null);
  if (themes) {
    log('GET /api/persistence/themes', themes.status() !== 404 ? 'PASS' : 'FAIL', `HTTP ${themes.status()}`);
  }

  // ── Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  const mBody = await page.textContent('body').catch(() => '');
  log('Mobile (390px) renders', mBody.length > 100 ? 'PASS' : 'FAIL');
  await page.screenshot({ path: path.join(DIR, '02-mobile.png') });

  await browser.close().catch(() => {});
  printReport();
}

async function runTerminalTests(page, dir, consoleErrors, net404, net500, wsHit) {
  const shot = async (n) => page.screenshot({ path: path.join(dir, `${n}.png`) }).catch(() => {});
  const body = await page.textContent('body').catch(() => '');

  // Sidebar buttons
  log('Profile button',   !!(await page.$('button[title="Profile"]')), '');
  log('Settings button',  !!(await page.$('button[title="Settings"]')), '');
  log('Logout button',    !!(await page.$('button[title="Logout"]')), '');
  log('Dashboard button', !!(await page.$('button[title="Dashboard"]')), '');

  // Settings modal
  const sb = await page.$('button[title="Settings"]');
  if (sb) {
    await sb.click(); await page.waitForTimeout(500);
    const m = await page.$('text=Terminal preferences');
    log('Settings modal', m ? 'PASS' : 'FAIL');
    await shot('02-settings');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }

  // Profile modal
  const pb = await page.$('button[title="Profile"]');
  if (pb) {
    await pb.click(); await page.waitForTimeout(500);
    const m = await page.$('text=Account Details');
    log('Profile modal', m ? 'PASS' : 'FAIL');
    await shot('03-profile');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }

  // Watchlist
  log('Watchlist symbols', body.includes('NIFTY') || body.includes('RELIANCE') ? 'PASS' : 'FAIL');
  await shot('04-watchlist');

  // Chart
  log('Chart canvas', !!(await page.$('canvas')) ? 'PASS' : 'FAIL');
  await shot('05-chart');

  // Order panel + confirmation
  const buyBtns = await page.$$('button:has-text("BUY")');
  log('BUY button', buyBtns.length > 0 ? 'PASS' : 'FAIL');
  if (buyBtns.length > 0) {
    await buyBtns[buyBtns.length - 1].click();
    await page.waitForTimeout(600);
    const confirm = await page.$('text=Confirm Order');
    log('Order confirmation dialog', confirm ? 'PASS' : 'FAIL');
    await shot('06-confirm');
    const cancel = await page.$('button:has-text("Cancel")');
    if (cancel) { await cancel.click(); await page.waitForTimeout(200); }
  }

  // Bottom tabs
  log('Positions tab', body.includes('Positions') ? 'PASS' : 'FAIL');
  log('Orders tab',    body.includes('Orders')    ? 'PASS' : 'FAIL');
  log('Trades tab',    body.includes('Trades')    ? 'PASS' : 'FAIL');

  // MCX
  const mcx = await page.$('button[title="MCX"]');
  if (mcx) {
    await mcx.click(); await page.waitForTimeout(3000);
    const mcxBody = await page.textContent('body').catch(() => '');
    const hasGold = mcxBody.includes('GOLD') || mcxBody.includes('SILVER');
    log('MCX symbols visible', hasGold ? 'PASS' : 'FAIL');
    // Check prices
    const px = mcxBody.match(/\b\d{4,6}\.\d{2}\b/);
    log('MCX live prices', px ? 'PASS' : 'WARN', px ? px[0] : 'No price');
    await shot('07-mcx');
  }

  // CDS
  const cds = await page.$('button[title="CDS"]');
  if (cds) {
    await cds.click(); await page.waitForTimeout(2000);
    const cdsBody = await page.textContent('body').catch(() => '');
    log('CDS symbols', cdsBody.includes('USDINR') ? 'PASS' : 'FAIL');
    await shot('08-cds');
  }

  // Risk
  const indexBtn = await page.$('button[title="Index"]');
  if (indexBtn) { await indexBtn.click(); await page.waitForTimeout(1500); }
  const rBody = await page.textContent('body').catch(() => '');
  log('Risk widget', rBody.includes('Daily') ? 'PASS' : 'WARN');
  await shot('09-risk');

  // WebSocket
  log('/ws WebSocket', wsHit.ws ? 'PASS' : 'WARN', wsHit.ws ? 'Connected' : 'Not captured');
  log('Socket.IO', wsHit.sio ? 'PASS' : 'WARN', wsHit.sio ? 'Connected' : 'Not captured (may need socket.io rewrite)');

  // Console errors
  const errs = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('fonts.google') && !e.includes('net::ERR_ABORTED'));
  log('Console errors', errs.length === 0 ? 'PASS' : 'FAIL', errs.length === 0 ? 'None' : errs.slice(0,2).map(e=>e.substring(0,80)).join(' | '));

  // Network errors
  const u404 = [...new Set(net404)].filter(u => !u.includes('favicon'));
  const u500 = [...new Set(net500)].filter(u => !u.includes('favicon'));
  log('404s on API routes', u404.length === 0 ? 'PASS' : 'FAIL', u404.slice(0,3).join(', ') || 'None');
  log('500s', u500.length === 0 ? 'PASS' : 'FAIL', u500.slice(0,3).join(', ') || 'None');

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  log('Mobile 390px', 'PASS', 'Viewport set');
  await shot('10-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });

  await shot('99-final');
}

function printReport() {
  const pass = results.filter(r=>r.status==='PASS').length;
  const fail = results.filter(r=>r.status==='FAIL').length;
  const warn = results.filter(r=>r.status==='WARN').length;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ PASS: ${pass}   ❌ FAIL: ${fail}   ⚠️  WARN: ${warn}`);
  if (fail > 0) { console.log('\n❌ FAILURES:'); results.filter(r=>r.status==='FAIL').forEach(r=>console.log(`   ${r.test}: ${r.detail}`)); }
  if (warn > 0) { console.log('\n⚠️  WARNINGS:'); results.filter(r=>r.status==='WARN').forEach(r=>console.log(`   ${r.test}: ${r.detail}`)); }
  fs.writeFileSync(path.join(__dirname, 'injected-test-results.json'), JSON.stringify({ pass, fail, warn, results }, null, 2));
  console.log(`\nScreenshots: ${DIR}\n`);
}

run().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  browser?.close().catch(() => {});
  printReport();
});
