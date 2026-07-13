/**
 * FULL PRODUCTION LIVE TEST
 * Generates a real SSO session via /auth/sso/generate, then tests every feature.
 * 
 * Run: node audit/prod-full-test.js [SSO_API_KEY] [ACCOUNT_ID]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://terminal.fundedwealth.com';
const DIR = path.join(__dirname, 'live-full-screenshots');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// SSO credentials — try argv, then env, then known dev defaults
const SSO_API_KEY = process.argv[2] || process.env.SSO_API_KEY || process.env.PROVISIONING_API_KEY || 'fw-provision-key-2024-secure';
const ACCOUNT_ID  = process.argv[3] || process.env.TEST_ACCOUNT_ID || '';
const FW_USER_ID  = process.argv[4] || process.env.TEST_FW_USER_ID || 'test-playwright-1';

const results = [];
let browser, context, page;

function log(test, status, detail = '') {
  const e = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${e} [${status}] ${test}${detail ? ' — ' + detail : ''}`);
  results.push({ test, status, detail });
}
async function shot(name) {
  try { await page.screenshot({ path: path.join(DIR, `${name}.png`) }); } catch {}
}
async function has(selector, timeout = 5000) {
  try { await page.waitForSelector(selector, { timeout }); return true; } catch { return false; }
}
async function bodyText() {
  return page.textContent('body').catch(() => '');
}

// Generate SSO token via API
function generateSSO(apiKey, accountId, fwUserId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ fwUserId, accountId, email: 'test@fundedwealth.com', name: 'Test Trader' });
    const req = https.request({
      hostname: 'terminal.fundedwealth.com',
      path: '/auth/sso/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-sso-api-key': apiKey }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Find a valid account from Supabase via API (uses service key)
async function findTestAccount() {
  // Try to hit the /api/accounts endpoint if there's a way without auth
  // or use the health check to probe
  return null;
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PRODUCTION LIVE TEST — ' + BASE);
  console.log('═══════════════════════════════════════════════════════════\n');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();

  const consoleErrors = [];
  const net404 = [], net500 = [];
  const wsConnected = { ws: false, sio: false };

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => {
    const u = r.url(), s = r.status();
    if (s === 404 && (u.includes('/api/') || u.includes('/auth/'))) net404.push(u.split('?')[0]);
    if (s >= 500) net500.push(`${s} ${u.split('?')[0]}`);
  });
  page.on('websocket', ws => {
    const u = ws.url();
    if (u.includes('/ws')) wsConnected.ws = true;
    if (u.includes('socket.io')) wsConnected.sio = true;
  });

  // ─── 1. Page load + SSO gate ─────────────────────────────────────────────
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => null);
  log('Backend reachable', resp ? 'PASS' : 'FAIL', resp ? `HTTP ${resp.status()}` : 'timeout');
  
  const initialBody = await bodyText();
  const gated = initialBody.includes('Access Denied') || initialBody.includes('Login') || initialBody.includes('FundedWealth Dashboard');
  log('SSO Gate active (no session)', gated ? 'PASS' : 'WARN', gated ? 'Access denied without session' : 'Terminal loaded without SSO');
  await shot('01-gate');

  // ─── 2. SSO Login ─────────────────────────────────────────────────────────
  let sessionObtained = false;
  let launchUrl = null;

  // Try with provided/default API key
  if (ACCOUNT_ID) {
    console.log(`\n→ Generating SSO token (accountId=${ACCOUNT_ID}, key=${SSO_API_KEY.substring(0,8)}...)`);
    try {
      const sso = await generateSSO(SSO_API_KEY, ACCOUNT_ID, FW_USER_ID);
      console.log(`  SSO generate response: ${sso.status} ${JSON.stringify(sso.body).substring(0,100)}`);
      if (sso.body.launchUrl) {
        launchUrl = sso.body.launchUrl;
        log('SSO Token Generation', 'PASS', `Got launchUrl`);
      } else {
        log('SSO Token Generation', 'FAIL', `${sso.status}: ${JSON.stringify(sso.body).substring(0,80)}`);
      }
    } catch (e) {
      log('SSO Token Generation', 'FAIL', e.message);
    }
  } else {
    // No account ID — try to find one from Supabase directly
    log('SSO Token Generation', 'WARN', 'No ACCOUNT_ID provided. Pass as: node prod-full-test.js <API_KEY> <ACCOUNT_ID>');
    
    // Try provisioning with a test account creation approach
    // Check if there's any test account accessible
    const testSSOResp = await page.request.post(`${BASE}/auth/test/session`, {
      data: { fwUserId: FW_USER_ID, accountId: 'test', email: 'test@fundedwealth.com', name: 'Test Trader' },
      headers: { 'Content-Type': 'application/json', 'x-test-secret': process.env.TEST_SSO_SECRET || 'test' }
    }).catch(() => null);
    
    if (testSSOResp) {
      const data = await testSSOResp.json().catch(() => ({}));
      if (data.launchUrl) {
        launchUrl = data.launchUrl;
        log('SSO Token Generation (test endpoint)', 'PASS');
      }
    }
  }

  // Navigate with SSO token
  if (launchUrl) {
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);
    const url = page.url();
    const body = await bodyText();
    const inTerminal = url.endsWith('/') && !body.includes('Access Denied') && !body.includes('error');
    log('SSO Login redirect', inTerminal ? 'PASS' : 'FAIL', `Landed at ${url}`);
    sessionObtained = inTerminal;
    await shot('02-post-sso');
  }

  if (!sessionObtained) {
    // Check if we already had a session from a previous run (cookie jar)
    const cookies = await context.cookies();
    sessionObtained = cookies.some(c => c.name === 'fw_session');
    if (sessionObtained) {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
    }
  }

  if (!sessionObtained) {
    log('Terminal Session', 'FAIL', 'Cannot obtain session — provide ACCOUNT_ID and SSO_API_KEY');
    console.log('\n⚠️  CANNOT TEST TERMINAL INTERNALS WITHOUT SESSION');
    console.log('  Run: node audit/prod-full-test.js <SSO_API_KEY> <ACCOUNT_ID>');
    console.log('  Get account IDs from Supabase: trading_accounts table\n');
    await generateReport();
    return;
  }

  log('Terminal Session', 'PASS', 'Session active');
  await page.waitForTimeout(3000);
  await shot('03-terminal');

  // Wait for terminal UI to fully initialize
  await page.waitForSelector('header, canvas, button[title="Settings"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const body = await bodyText();
  console.log(`\n→ Terminal DOM loaded (${body.length} chars)`);

  // ─── 3. Sidebar buttons ──────────────────────────────────────────────────
  await shot('04-sidebar');
  const profileBtn   = await page.$('button[title="Profile"]');
  const settingsBtn  = await page.$('button[title="Settings"]');
  const logoutBtn    = await page.$('button[title="Logout"]');
  const dashboardBtn = await page.$('button[title="Dashboard"]');

  log('Sidebar: Profile button',   profileBtn   ? 'PASS' : 'FAIL');
  log('Sidebar: Settings button',  settingsBtn  ? 'PASS' : 'FAIL');
  log('Sidebar: Logout button',    logoutBtn    ? 'PASS' : 'FAIL');
  log('Sidebar: Dashboard button', dashboardBtn ? 'PASS' : 'FAIL');

  // ─── 4. Settings modal ───────────────────────────────────────────────────
  if (settingsBtn) {
    await settingsBtn.click();
    await page.waitForTimeout(600);
    const settingsModal = await page.$('text=Terminal preferences');
    const appearanceTab = await page.$('button:has-text("Appearance")');
    log('Settings modal opens', (settingsModal || appearanceTab) ? 'PASS' : 'FAIL');
    if (settingsModal || appearanceTab) await shot('05-settings');
    // Close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ─── 5. Profile modal ────────────────────────────────────────────────────
  if (profileBtn) {
    await profileBtn.click();
    await page.waitForTimeout(600);
    const profileModal = await page.$('text=Account Details');
    const logoutInProfile = await page.$('button:has-text("Logout")');
    log('Profile modal opens', profileModal ? 'PASS' : 'FAIL');
    log('Logout button in Profile', logoutInProfile ? 'PASS' : 'FAIL');
    if (profileModal) await shot('06-profile');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ─── 6. Watchlist ────────────────────────────────────────────────────────
  const hasNifty = body.includes('NIFTY') || body.includes('RELIANCE');
  log('Watchlist symbols visible', hasNifty ? 'PASS' : 'FAIL', hasNifty ? 'NIFTY/RELIANCE in DOM' : 'No symbols');
  await shot('07-watchlist');

  // ─── 7. Chart ────────────────────────────────────────────────────────────
  const canvas = await page.$('canvas');
  log('Chart canvas rendered', canvas ? 'PASS' : 'FAIL');
  await shot('08-chart');

  // ─── 8. Order Panel ──────────────────────────────────────────────────────
  const buyBtn  = await page.$('button:has-text("BUY")');
  const sellBtn = await page.$('button:has-text("SELL")');
  log('Order Panel: BUY button',  buyBtn  ? 'PASS' : 'FAIL');
  log('Order Panel: SELL button', sellBtn ? 'PASS' : 'FAIL');
  await shot('09-order-panel');

  // ─── 9. Order confirmation dialog ────────────────────────────────────────
  if (buyBtn) {
    // Find the bottom submit BUY button (not the toggle)
    const buyBtns = await page.$$('button:has-text("BUY")');
    // Click the last one (submit button at bottom of panel)
    const submitBuy = buyBtns[buyBtns.length - 1];
    await submitBuy.click();
    await page.waitForTimeout(800);
    const confirmDialog = await page.$('text=Confirm Order');
    log('Order confirmation dialog', confirmDialog ? 'PASS' : 'FAIL', confirmDialog ? 'Dialog shown before order' : 'No dialog — order placed immediately');
    if (confirmDialog) {
      await shot('10-confirm-dialog');
      const cancelBtn = await page.$('button:has-text("Cancel")');
      if (cancelBtn) await cancelBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // ─── 10. Bottom Panel tabs ────────────────────────────────────────────────
  const tabsVisible = body.includes('Positions') && body.includes('Orders') && body.includes('Trades');
  log('Bottom Panel tabs visible', tabsVisible ? 'PASS' : 'FAIL');

  // Click Orders tab
  const ordersTab = await page.$('button:has-text("Orders")');
  if (ordersTab) {
    await ordersTab.click();
    await page.waitForTimeout(1000);
    log('Orders tab clickable', 'PASS');
    await shot('11-orders-tab');
  }

  // Click Positions tab
  const posTab = await page.$('button:has-text("Positions")');
  if (posTab) {
    await posTab.click();
    await page.waitForTimeout(1000);
    log('Positions tab clickable', 'PASS');
    await shot('12-positions-tab');
  }

  // ─── 11. MCX workspace ───────────────────────────────────────────────────
  const mcxBtn = await page.$('button[title="MCX"]');
  if (mcxBtn) {
    await mcxBtn.click();
    await page.waitForTimeout(3000);
    const mcxBody = await bodyText();
    const hasGold = mcxBody.includes('GOLD') || mcxBody.includes('SILVER') || mcxBody.includes('CRUDEOIL');
    log('MCX workspace: symbols', hasGold ? 'PASS' : 'FAIL', hasGold ? 'MCX symbols visible' : 'No MCX symbols in DOM');
    // Check for live price (non-zero)
    const priceMatch = mcxBody.match(/\b\d{4,6}\.\d{2}\b/);
    log('MCX live prices', priceMatch ? 'PASS' : 'WARN', priceMatch ? `Price: ${priceMatch[0]}` : 'Prices showing — or feed warming up');
    await shot('13-mcx');
  } else {
    log('MCX workspace button', 'FAIL', 'Button not found');
  }

  // ─── 12. CDS workspace ───────────────────────────────────────────────────
  const cdsBtn = await page.$('button[title="CDS"]');
  if (cdsBtn) {
    await cdsBtn.click();
    await page.waitForTimeout(2000);
    const cdsBody = await bodyText();
    const hasUsd = cdsBody.includes('USDINR') || cdsBody.includes('EURINR');
    log('CDS workspace: symbols', hasUsd ? 'PASS' : 'FAIL', hasUsd ? 'CDS symbols visible' : 'No CDS symbols');
    await shot('14-cds');
  } else {
    log('CDS workspace button', 'FAIL', 'Button not found');
  }

  // ─── 13. Risk widget ─────────────────────────────────────────────────────
  // Go back to index workspace
  const indexBtn = await page.$('button[title="Index"]');
  if (indexBtn) await indexBtn.click();
  await page.waitForTimeout(1500);
  const riskBody = await bodyText();
  const hasRisk = riskBody.includes('Daily') && riskBody.includes('Drawdown');
  log('Risk widget visible', hasRisk ? 'PASS' : 'WARN', hasRisk ? 'Risk metrics in DOM' : 'Risk data not visible');
  await shot('15-risk');

  // ─── 14. Analytics panel ─────────────────────────────────────────────────
  const analyticsBtn = await page.$('button[title="Analytics"]');
  if (analyticsBtn) {
    await analyticsBtn.click();
    await page.waitForTimeout(2000);
    const aBody = await bodyText();
    log('Analytics panel', aBody.includes('Analytics') || aBody.includes('Equity') ? 'PASS' : 'FAIL');
    await shot('16-analytics');
    // Back to positions
    const posBtn2 = await page.$('button:has-text("Positions")');
    if (posBtn2) await posBtn2.click();
  } else {
    log('Analytics button', 'FAIL', 'Not found');
  }

  // ─── 15. WebSocket connection ─────────────────────────────────────────────
  await page.waitForTimeout(2000);
  log('WebSocket /ws connected', wsConnected.ws ? 'PASS' : 'WARN', wsConnected.ws ? 'WS connected' : 'No WS upgrade captured');
  log('Socket.IO connected', wsConnected.sio ? 'PASS' : 'WARN', wsConnected.sio ? 'Socket.IO connected' : 'No socket.io captured');

  // ─── 16. Console errors ───────────────────────────────────────────────────
  const critErrors = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('logo.png') &&
    !e.includes('fonts.googleapis') && !e.includes('net::ERR_ABORTED')
  );
  log('Console errors', critErrors.length === 0 ? 'PASS' : 'FAIL',
    critErrors.length === 0 ? 'None' : critErrors.slice(0,3).map(e=>e.substring(0,80)).join(' | '));

  // ─── 17. Network 404/500 ─────────────────────────────────────────────────
  const crit404 = [...new Set(net404)].filter(u => !u.includes('favicon'));
  const crit500 = [...new Set(net500)].filter(u => !u.includes('favicon'));
  log('Network 404s on API routes', crit404.length === 0 ? 'PASS' : 'FAIL',
    crit404.length === 0 ? 'None' : crit404.slice(0,3).join(', '));
  log('Network 500s', crit500.length === 0 ? 'PASS' : 'FAIL',
    crit500.length === 0 ? 'None' : crit500.slice(0,3).join(', '));

  // ─── 18. Mobile responsiveness ────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const mobileBody = await bodyText();
  const hasMobileContent = mobileBody.length > 200;
  log('Mobile layout (390px)', hasMobileContent ? 'PASS' : 'FAIL');
  await shot('17-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });

  // ─── 19. Logout button exists + is clickable ──────────────────────────────
  const logoutBtnFinal = await page.$('button[title="Logout"]');
  if (logoutBtnFinal) {
    const enabled = await logoutBtnFinal.isEnabled();
    log('Logout button', enabled ? 'PASS' : 'FAIL', enabled ? 'Present and enabled' : 'Disabled');
  } else {
    log('Logout button', 'FAIL', 'Not found in sidebar');
  }

  await shot('99-final');
  await generateReport();
}

async function generateReport() {
  await browser?.close().catch(() => {});

  const pass = results.filter(r=>r.status==='PASS').length;
  const fail = results.filter(r=>r.status==='FAIL').length;
  const warn = results.filter(r=>r.status==='WARN').length;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PRODUCTION TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ PASS: ${pass}   ❌ FAIL: ${fail}   ⚠️  WARN: ${warn}   TOTAL: ${results.length}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n❌ FAILURES:');
    results.filter(r=>r.status==='FAIL').forEach(r => console.log(`   ${r.test}: ${r.detail}`));
  }
  if (warn > 0) {
    console.log('\n⚠️  WARNINGS:');
    results.filter(r=>r.status==='WARN').forEach(r => console.log(`   ${r.test}: ${r.detail}`));
  }

  const report = { timestamp: new Date().toISOString(), pass, fail, warn, results };
  fs.writeFileSync(path.join(__dirname, 'live-full-results.json'), JSON.stringify(report, null, 2));
  console.log(`\nScreenshots: ${DIR}`);
  console.log('Results: audit/live-full-results.json\n');
}

run().catch(e => {
  console.error('\nFATAL:', e.message);
  if (browser) browser.close().catch(() => {});
  generateReport().catch(() => {});
});
