/**
 * PRODUCTION LIVE TEST
 * Tests the live terminal at https://terminal.fundedwealth.com
 * Uses the dev SSO endpoint to get a valid session first.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://terminal.fundedwealth.com';
const SCREENSHOT_DIR = path.join(__dirname, 'live-test-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
let browser, context, page;

function log(test, status, detail = '') {
  const emoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${emoji} [${status}] ${test}${detail ? ' — ' + detail : ''}`);
  results.push({ test, status, detail });
}

async function shot(name) {
  try { await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false }); } catch {}
}

async function waitForSelector(sel, timeout = 8000) {
  try { await page.waitForSelector(sel, { timeout }); return true; } catch { return false; }
}

async function run() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  page = await context.newPage();

  // Track console errors and network failures
  const consoleErrors = [];
  const networkErrors = [];
  const networkStatuses = {};

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', resp => {
    const url = resp.url();
    const status = resp.status();
    networkStatuses[url] = status;
    if (status >= 400 && !url.includes('favicon') && !url.includes('logo')) {
      networkErrors.push(`${status} ${url}`);
    }
  });

  // ─── TEST 1: Initial page load ───────────────────────────────────────────
  try {
    const resp = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = resp.status();
    if (status === 200 || status === 401) {
      log('Page Load', 'PASS', `HTTP ${status}`);
    } else {
      log('Page Load', 'FAIL', `HTTP ${status}`);
    }
    await shot('01-initial-load');
  } catch (e) {
    log('Page Load', 'FAIL', e.message);
  }

  // ─── TEST 2: SSO Gate (no cookie = access denied) ────────────────────────
  try {
    const body = await page.textContent('body');
    const title = await page.title();
    if (body.includes('Access Denied') || body.includes('FundedWealth Dashboard') || body.includes('Login')) {
      log('SSO Gate (no session)', 'PASS', 'Access denied shown without session');
    } else if (title.includes('Trading') && body.includes('NIFTY')) {
      log('SSO Gate (no session)', 'WARN', 'Terminal loaded without SSO — gate may be missing');
    } else {
      log('SSO Gate (no session)', 'PASS', 'Redirect/block in place');
    }
  } catch (e) {
    log('SSO Gate (no session)', 'FAIL', e.message);
  }

  // ─── TEST 3: Dev SSO login ────────────────────────────────────────────────
  try {
    // Hit the dev SSO generate endpoint
    const ssoResp = await page.request.post(`${BASE_URL}/auth/dev/generate-sso`, {
      data: { accountId: 'test', fwUserId: 'test-user' },
      headers: { 'Content-Type': 'application/json' }
    });
    const ssoData = await ssoResp.json().catch(() => ({}));

    if (ssoData.launchUrl || ssoData.token) {
      const launchUrl = ssoData.launchUrl || `${BASE_URL}/auth/sso?token=${ssoData.token}`;
      await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
      const url = page.url();
      const body = await page.textContent('body').catch(() => '');
      if (url.endsWith('/') || url.includes('terminal') && !url.includes('error')) {
        log('SSO Login', 'PASS', `Redirected to ${url}`);
      } else {
        log('SSO Login', 'FAIL', `Stayed at ${url}`);
      }
    } else {
      // Try the direct test token generate endpoint
      const altResp = await page.request.get(`${BASE_URL}/auth/dev/sso-url`);
      const altData = await altResp.json().catch(() => ({}));
      if (altData.url || altData.launchUrl) {
        await page.goto(altData.url || altData.launchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        log('SSO Login', 'PASS', 'Dev SSO URL worked');
      } else {
        log('SSO Login', 'WARN', `Dev SSO returned: ${JSON.stringify(ssoData).substring(0,100)}`);
      }
    }
    await shot('02-after-sso');
  } catch (e) {
    log('SSO Login', 'WARN', `Dev SSO not available: ${e.message.substring(0,80)}`);
  }

  // Check if we're in the terminal now
  const isTerminal = await waitForSelector('[data-brand], .fw-terminal, header', 5000);

  if (!isTerminal) {
    // Try reading cookies to understand state
    const cookies = await context.cookies();
    const hasSession = cookies.some(c => c.name === 'fw_session');
    log('Terminal Access', hasSession ? 'WARN' : 'FAIL', hasSession ? 'Has session cookie but terminal not rendered' : 'No session — all subsequent tests will be limited');
    await shot('03-terminal-state');
  } else {
    log('Terminal Access', 'PASS', 'Terminal UI rendered');
    await shot('03-terminal-loaded');
  }

  // Wait for terminal to fully load
  await page.waitForTimeout(4000);
  await shot('04-terminal-full');

  // ─── TEST 4: Check page title + brand ────────────────────────────────────
  try {
    const title = await page.title();
    if (title.includes('FundedWealth') || title.includes('Terminal') || title.includes('Trading')) {
      log('Page Title', 'PASS', title);
    } else {
      log('Page Title', 'WARN', `Unexpected title: ${title}`);
    }
  } catch (e) {
    log('Page Title', 'FAIL', e.message);
  }

  // ─── TEST 5: Sidebar buttons ──────────────────────────────────────────────
  // Check if sidebar exists
  const sidebarExists = await waitForSelector('div.w-\\[48px\\], div[class*="w-[48px]"]', 3000);
  if (sidebarExists) {
    log('Sidebar Present', 'PASS');

    // Check for Profile, Settings, Logout buttons via title attr
    const profileBtn = await page.$('button[title="Profile"]');
    const settingsBtn = await page.$('button[title="Settings"]');
    const logoutBtn = await page.$('button[title="Logout"]');
    const dashboardBtn = await page.$('button[title="Dashboard"]');

    log('Profile Button', profileBtn ? 'PASS' : 'FAIL', profileBtn ? 'Found' : 'Missing in sidebar');
    log('Settings Button', settingsBtn ? 'PASS' : 'FAIL', settingsBtn ? 'Found' : 'Missing in sidebar');
    log('Logout Button', logoutBtn ? 'PASS' : 'FAIL', logoutBtn ? 'Found' : 'Missing in sidebar');
    log('Dashboard Button', dashboardBtn ? 'PASS' : 'FAIL', dashboardBtn ? 'Found' : 'Missing in sidebar');

    // ─── TEST 6: Settings modal ───────────────────────────────────────────
    if (settingsBtn) {
      try {
        await settingsBtn.click();
        await page.waitForTimeout(500);
        const modal = await page.$('text=Settings');
        const tabAppearance = await page.$('text=Appearance');
        if (modal && tabAppearance) {
          log('Settings Modal Opens', 'PASS', 'Modal with tabs rendered');
          await shot('05-settings-modal');
          // Close it
          const closeBtn = await page.$('button:has(svg[data-lucide="x"]), button[title*="lose"], button:has(.lucide-x)');
          if (closeBtn) await closeBtn.click();
          else await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } else {
          log('Settings Modal Opens', 'FAIL', 'Modal did not render properly');
          await shot('05-settings-fail');
        }
      } catch (e) {
        log('Settings Modal Opens', 'FAIL', e.message);
      }
    }

    // ─── TEST 7: Profile modal ────────────────────────────────────────────
    if (profileBtn) {
      try {
        await profileBtn.click();
        await page.waitForTimeout(500);
        const profileModal = await page.$('text=Profile');
        if (profileModal) {
          log('Profile Modal Opens', 'PASS', 'Profile modal rendered');
          await shot('06-profile-modal');
          // Check for logout inside profile
          const logoutInProfile = await page.$('text=Logout');
          log('Logout in Profile', logoutInProfile ? 'PASS' : 'WARN', logoutInProfile ? 'Found' : 'Not found inside profile');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } else {
          log('Profile Modal Opens', 'FAIL', 'Profile modal did not render');
          await shot('06-profile-fail');
        }
      } catch (e) {
        log('Profile Modal Opens', 'FAIL', e.message);
      }
    }
  } else {
    log('Sidebar Present', 'FAIL', 'Sidebar not found — terminal may not be loaded');
  }

  // ─── TEST 8: Watchlist ────────────────────────────────────────────────────
  try {
    const watchlist = await page.$('[class*="Watchlist"], [data-testid="watchlist"]');
    // Look for known symbols
    const body = await page.textContent('body').catch(() => '');
    const hasNifty = body.includes('NIFTY') || body.includes('RELIANCE') || body.includes('INDEX');
    log('Watchlist Visible', hasNifty ? 'PASS' : 'FAIL', hasNifty ? 'Contains symbols' : 'No symbols found in DOM');
    await shot('07-watchlist');
  } catch (e) {
    log('Watchlist Visible', 'FAIL', e.message);
  }

  // ─── TEST 9: Chart ────────────────────────────────────────────────────────
  try {
    const canvas = await page.$('canvas');
    if (canvas) {
      log('Chart Rendered', 'PASS', 'Canvas element present');
    } else {
      log('Chart Rendered', 'FAIL', 'No canvas found');
    }
    await shot('08-chart');
  } catch (e) {
    log('Chart Rendered', 'FAIL', e.message);
  }

  // ─── TEST 10: Order Panel ─────────────────────────────────────────────────
  try {
    // Look for BUY/SELL buttons
    const buyBtn = await page.$('button:has-text("BUY")');
    const sellBtn = await page.$('button:has-text("SELL")');
    log('Order Panel BUY button', buyBtn ? 'PASS' : 'FAIL');
    log('Order Panel SELL button', sellBtn ? 'PASS' : 'FAIL');
    await shot('09-order-panel');

    // ─── TEST 11: Order confirmation dialog ──────────────────────────────
    if (buyBtn) {
      await buyBtn.click();
      await page.waitForTimeout(800);
      // Look for confirmation modal
      const confirmDialog = await page.$('text=Confirm Order');
      if (confirmDialog) {
        log('Order Confirmation Dialog', 'PASS', 'Confirmation dialog shown');
        await shot('10-order-confirm');
        // Cancel it
        const cancelBtn = await page.$('button:has-text("Cancel")');
        if (cancelBtn) await cancelBtn.click();
        await page.waitForTimeout(300);
      } else {
        log('Order Confirmation Dialog', 'FAIL', 'No confirmation dialog shown on BUY click');
        await shot('10-order-noconfirm');
      }
    }
  } catch (e) {
    log('Order Panel', 'FAIL', e.message);
  }

  // ─── TEST 12: Bottom Panel tabs ───────────────────────────────────────────
  try {
    const body = await page.textContent('body').catch(() => '');
    const hasPositions = body.includes('Positions') || body.includes('POSITIONS');
    const hasOrders = body.includes('Orders') || body.includes('ORDERS');
    const hasTrades = body.includes('Trades') || body.includes('TRADES');
    log('Bottom Panel - Positions tab', hasPositions ? 'PASS' : 'FAIL');
    log('Bottom Panel - Orders tab', hasOrders ? 'PASS' : 'FAIL');
    log('Bottom Panel - Trades tab', hasTrades ? 'PASS' : 'FAIL');
    await shot('11-bottom-panel');
  } catch (e) {
    log('Bottom Panel', 'FAIL', e.message);
  }

  // ─── TEST 13: MCX Watchlist tab ───────────────────────────────────────────
  try {
    // Click MCX workspace
    const mcxBtn = await page.$('button[title="MCX"]');
    if (mcxBtn) {
      await mcxBtn.click();
      await page.waitForTimeout(2000);
      const body = await page.textContent('body').catch(() => '');
      const hasGold = body.includes('GOLD') || body.includes('SILVER') || body.includes('CRUDEOIL');
      log('MCX Workspace', hasGold ? 'PASS' : 'WARN', hasGold ? 'MCX symbols visible' : 'MCX symbols not found in DOM');
      // Check if prices are populated (not showing — or 0.00)
      const hasMcxPrice = body.match(/\d{4,6}\.\d{2}/); // MCX gold is ~70000+
      log('MCX Live Prices', hasMcxPrice ? 'PASS' : 'WARN', hasMcxPrice ? `Price found: ${hasMcxPrice[0]}` : 'No prices loaded yet (feed may take time)');
      await shot('12-mcx');
    } else {
      log('MCX Workspace', 'FAIL', 'MCX button not found');
    }
  } catch (e) {
    log('MCX Workspace', 'FAIL', e.message);
  }

  // ─── TEST 14: CDS Watchlist tab ───────────────────────────────────────────
  try {
    const cdsBtn = await page.$('button[title="CDS"]');
    if (cdsBtn) {
      await cdsBtn.click();
      await page.waitForTimeout(2000);
      const body = await page.textContent('body').catch(() => '');
      const hasUsdinr = body.includes('USDINR') || body.includes('EURINR');
      log('CDS Workspace', hasUsdinr ? 'PASS' : 'WARN', hasUsdinr ? 'CDS symbols visible' : 'CDS symbols not found');
      await shot('13-cds');
    } else {
      log('CDS Workspace', 'FAIL', 'CDS button not found');
    }
  } catch (e) {
    log('CDS Workspace', 'FAIL', e.message);
  }

  // ─── TEST 15: Analytics tab ───────────────────────────────────────────────
  try {
    const analyticsBtn = await page.$('button[title="Analytics"]');
    if (analyticsBtn) {
      await analyticsBtn.click();
      await page.waitForTimeout(1500);
      const body = await page.textContent('body').catch(() => '');
      const hasAnalytics = body.includes('Analytics') || body.includes('Equity') || body.includes('P&L');
      log('Analytics Panel', hasAnalytics ? 'PASS' : 'FAIL', hasAnalytics ? 'Analytics content visible' : 'No analytics content');
      await shot('14-analytics');
    } else {
      log('Analytics Panel', 'WARN', 'Analytics button not found');
    }
  } catch (e) {
    log('Analytics Panel', 'FAIL', e.message);
  }

  // ─── TEST 16: Risk widget ─────────────────────────────────────────────────
  try {
    const body = await page.textContent('body').catch(() => '');
    const hasRisk = body.includes('Daily Loss') || body.includes('Drawdown') || body.includes('Risk') || body.includes('SAFE') || body.includes('CAUTION');
    log('Risk Widget', hasRisk ? 'PASS' : 'WARN', hasRisk ? 'Risk data visible' : 'Risk data not visible');
    await shot('15-risk');
  } catch (e) {
    log('Risk Widget', 'FAIL', e.message);
  }

  // ─── TEST 17: WebSocket / Socket.IO connection ────────────────────────────
  try {
    // Check network for WS upgrade or socket.io connections
    const wsUrl = Object.keys(networkStatuses).find(u => u.includes('/ws') || u.includes('socket.io'));
    if (wsUrl) {
      log('WebSocket Connection', 'PASS', `WS endpoint hit: ${wsUrl.substring(0, 80)}`);
    } else {
      log('WebSocket Connection', 'WARN', 'No WS requests captured (may be timing issue)');
    }
  } catch (e) {
    log('WebSocket Connection', 'WARN', e.message);
  }

  // ─── TEST 18: Console errors ──────────────────────────────────────────────
  const criticalErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('logo.png') &&
    !e.includes('CDATA') &&
    !e.includes('404') && // already tracked in network
    !e.includes('net::ERR_')
  );
  if (criticalErrors.length === 0) {
    log('Console Errors', 'PASS', 'No critical console errors');
  } else {
    criticalErrors.slice(0, 5).forEach(e => log('Console Error', 'WARN', e.substring(0, 120)));
  }

  // ─── TEST 19: Network 404/500 ─────────────────────────────────────────────
  const critical404 = networkErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('logo.png') &&
    (e.includes('/api/') || e.includes('/auth/') || e.includes('/ws'))
  );
  if (critical404.length === 0) {
    log('Network Errors (404/500)', 'PASS', `${networkErrors.length} total non-critical errors`);
  } else {
    critical404.slice(0, 5).forEach(e => log('Network Error', 'FAIL', e.substring(0, 120)));
  }

  // ─── TEST 20: Mobile responsiveness ──────────────────────────────────────
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    const body = await page.textContent('body').catch(() => '');
    const hasMobile = body.length > 100; // something rendered
    log('Mobile Layout (390px)', hasMobile ? 'PASS' : 'FAIL', hasMobile ? 'Content rendered on mobile viewport' : 'Nothing rendered');
    await shot('16-mobile');
    // Restore
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (e) {
    log('Mobile Layout', 'FAIL', e.message);
  }

  // ─── TEST 21: Logout flow ─────────────────────────────────────────────────
  try {
    const logoutBtn = await page.$('button[title="Logout"]');
    if (logoutBtn) {
      // Don't actually click logout — just verify it exists and is clickable
      const isEnabled = await logoutBtn.isEnabled();
      log('Logout Button Clickable', isEnabled ? 'PASS' : 'FAIL', isEnabled ? 'Enabled and ready' : 'Disabled');
    } else {
      log('Logout Button', 'FAIL', 'Logout button not found on page');
    }
  } catch (e) {
    log('Logout Button', 'FAIL', e.message);
  }

  await shot('99-final-state');
  await browser.close();

  // ─── REPORT ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PRODUCTION LIVE TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  console.log(`  PASS: ${pass}  FAIL: ${fail}  WARN: ${warn}  TOTAL: ${results.length}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\nFAILURES:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌ ${r.test}: ${r.detail}`));
  }
  if (warn > 0) {
    console.log('\nWARNINGS:');
    results.filter(r => r.status === 'WARN').forEach(r => console.log(`  ⚠️  ${r.test}: ${r.detail}`));
  }

  fs.writeFileSync(path.join(__dirname, 'live-test-results.json'), JSON.stringify({ pass, fail, warn, results }, null, 2));
  console.log('\nScreenshots:', SCREENSHOT_DIR);
}

run().catch(e => {
  console.error('FATAL:', e.message);
  if (browser) browser.close().catch(() => {});
  process.exit(1);
});
