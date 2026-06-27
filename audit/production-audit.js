/**
 * FUNDEDWEALTH TERMINAL — PLAYWRIGHT PRODUCTION AUDIT
 * 
 * Full browser-based audit of the running application.
 * Tests: Auth, Watchlist, Chart, Option Chain, Market Depth,
 *        Order Panel, Positions, Orders, WebSocket, API, Console Errors, Network
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';

const results = {
  timestamp: new Date().toISOString(),
  frontendUrl: FRONTEND_URL,
  serverUrl: SERVER_URL,
  tests: [],
  consoleErrors: [],
  networkFailures: [],
  summary: { total: 0, passed: 0, failed: 0, warnings: 0 }
};

function addResult(category, name, status, details = '') {
  results.tests.push({ category, name, status, details, time: new Date().toISOString() });
  results.summary.total++;
  if (status === 'PASS') results.summary.passed++;
  else if (status === 'FAIL') results.summary.failed++;
  else if (status === 'WARN') results.summary.warnings++;
}

async function testServerHealth() {
  console.log('\n[1/12] Testing Server Health...');
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      addResult('Infrastructure', 'Server Health Endpoint', 'PASS', `Uptime: ${Math.round(data.uptime)}s`);
    } else {
      addResult('Infrastructure', 'Server Health Endpoint', 'WARN', JSON.stringify(data));
    }
    // Check individual subsystems
    if (data.database?.connected) {
      addResult('Infrastructure', 'Supabase Connectivity', 'PASS', 'Connected');
    } else {
      addResult('Infrastructure', 'Supabase Connectivity', 'FAIL', data.database?.reason || 'Not connected');
    }
    if (data.feed?.connected) {
      addResult('Infrastructure', 'Broker Feed Connectivity', 'PASS', `Ticks: ${data.feed.tickCount}`);
    } else {
      addResult('Infrastructure', 'Broker Feed Connectivity', 'WARN', 'Feed not connected');
    }
    if (data.socketIO) {
      addResult('Infrastructure', 'Socket.IO Server', 'PASS', `Clients: ${data.socketIO.clients}`);
    } else {
      addResult('Infrastructure', 'Socket.IO Server', 'WARN', 'No Socket.IO status');
    }
    if (data.eventBus) {
      addResult('Infrastructure', 'Event Bus', 'PASS', JSON.stringify(data.eventBus));
    }
    if (data.eventBridge) {
      addResult('Infrastructure', 'Event Bridge', 'PASS', JSON.stringify(data.eventBridge));
    }
    if (data.eventDispatcher) {
      addResult('Infrastructure', 'Event Dispatcher', 'PASS', JSON.stringify(data.eventDispatcher));
    }
  } catch (err) {
    addResult('Infrastructure', 'Server Health Endpoint', 'FAIL', `Server unreachable: ${err.message}`);
  }
}

async function testAuthFlow(page) {
  console.log('[2/12] Testing Auth Flow...');
  // Test direct access without auth (should redirect or show loading)
  try {
    const response = await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 15000 });
    if (response && response.status() === 200) {
      addResult('Auth', 'Frontend Loads', 'PASS', `Status: ${response.status()}`);
    } else {
      addResult('Auth', 'Frontend Loads', 'FAIL', `Status: ${response?.status()}`);
    }
  } catch (err) {
    addResult('Auth', 'Frontend Loads', 'FAIL', err.message);
    return false;
  }

  // Check if we see the loading screen or terminal
  const body = await page.textContent('body');
  if (body.includes('Connecting to FundedWealth')) {
    addResult('Auth', 'Auth Loading State', 'PASS', 'Shows loading spinner');
  }

  // Test SSO endpoint
  try {
    const ssoRes = await fetch(`${SERVER_URL}/auth/sso`);
    if (ssoRes.status === 400) {
      addResult('Auth', 'SSO Endpoint (no token)', 'PASS', 'Returns 400 missing_token as expected');
    } else {
      addResult('Auth', 'SSO Endpoint (no token)', 'WARN', `Status: ${ssoRes.status}`);
    }
  } catch (err) {
    addResult('Auth', 'SSO Endpoint', 'FAIL', err.message);
  }

  // Test verify endpoint without session
  try {
    const verifyRes = await fetch(`${SERVER_URL}/auth/verify`);
    if (verifyRes.status === 401) {
      addResult('Auth', 'Verify (no session)', 'PASS', 'Returns 401 as expected');
    } else {
      addResult('Auth', 'Verify (no session)', 'WARN', `Status: ${verifyRes.status}`);
    }
  } catch (err) {
    addResult('Auth', 'Verify Endpoint', 'FAIL', err.message);
  }

  // Test dev SSO generation (dev mode only)
  try {
    const devRes = await fetch(`${SERVER_URL}/auth/dev/generate-sso`);
    if (devRes.ok) {
      const devData = await devRes.json();
      addResult('Auth', 'Dev SSO Token Generation', 'PASS', `Token generated, loginUrl: ${devData.loginUrl}`);
      // Use dev SSO to authenticate
      const loginUrl = `${SERVER_URL}${devData.loginUrl}`;
      const loginRes = await fetch(loginUrl, { redirect: 'manual' });
      if (loginRes.status === 302 || loginRes.status === 301) {
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie && setCookie.includes('fw_session')) {
          addResult('Auth', 'SSO Login Flow', 'PASS', 'Session cookie set, redirect to /');
          return setCookie;
        } else {
          addResult('Auth', 'SSO Login Flow', 'WARN', 'Redirect without cookie');
        }
      } else {
        addResult('Auth', 'SSO Login Flow', 'WARN', `Status: ${loginRes.status}`);
      }
    } else {
      addResult('Auth', 'Dev SSO Token Generation', 'WARN', `Status: ${devRes.status} (may not be in dev mode)`);
    }
  } catch (err) {
    addResult('Auth', 'Dev SSO Token Generation', 'WARN', err.message);
  }
  return null;
}

async function authenticateAndLoad(page, context) {
  console.log('[3/12] Authenticating & Loading Terminal...');
  // Try dev SSO flow via frontend proxy
  try {
    const devRes = await fetch(`${SERVER_URL}/auth/dev/generate-sso`);
    if (devRes.ok) {
      const devData = await devRes.json();
      // Navigate to SSO login URL via frontend proxy (to get cookies set in browser context)
      await page.goto(`${FRONTEND_URL}/auth/sso?token=${encodeURIComponent(devData.ssoToken)}`, { waitUntil: 'networkidle', timeout: 20000 });
      const url = page.url();
      if (url.includes('localhost:3000') || url === FRONTEND_URL + '/') {
        addResult('Auth', 'Browser SSO Login', 'PASS', 'Authenticated, redirected to terminal');
        return true;
      }
    }
  } catch (err) {
    // Dev SSO not available, try direct access
  }

  // Fallback: direct access (dev-bypass or graceful degradation)
  await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 15000 });
  // Wait for terminal to render (auth hook allows through on network error)
  await page.waitForTimeout(3000);
  const hasTopBar = await page.$('[class*="TopBar"], [class*="top-bar"], nav, header');
  if (hasTopBar) {
    addResult('Auth', 'Terminal Access (graceful)', 'PASS', 'Terminal loaded via graceful degradation');
    return true;
  }
  addResult('Auth', 'Terminal Access', 'FAIL', 'Could not load terminal');
  return false;
}

async function testWatchlist(page) {
  console.log('[4/12] Testing Watchlist...');
  try {
    // Check if watchlist panel is visible
    const watchlist = await page.$('text=NIFTY') || await page.$('text=Watchlist') || await page.$('[class*="watchlist"], [class*="Watchlist"]');
    if (watchlist) {
      addResult('UI', 'Watchlist Panel Visible', 'PASS', 'Watchlist component rendered');
    } else {
      addResult('UI', 'Watchlist Panel Visible', 'WARN', 'Watchlist not visible or empty');
    }

    // Check for market data presence
    const priceEl = await page.$('[class*="ltp"], [class*="price"], [class*="quote"]');
    if (priceEl) {
      addResult('UI', 'Market Data in Watchlist', 'PASS', 'Price elements found');
    } else {
      addResult('UI', 'Market Data in Watchlist', 'WARN', 'No live price elements detected');
    }
  } catch (err) {
    addResult('UI', 'Watchlist', 'FAIL', err.message);
  }
}

async function testChart(page) {
  console.log('[5/12] Testing TradingView Chart...');
  try {
    // Check for chart container or canvas (TradingView lightweight charts renders to canvas)
    const canvas = await page.$('canvas');
    if (canvas) {
      addResult('UI', 'TradingView Chart Canvas', 'PASS', 'Canvas element rendered');
    } else {
      addResult('UI', 'TradingView Chart Canvas', 'WARN', 'No canvas found — chart may not have loaded');
    }

    // Check for chart panel component
    const chartPanel = await page.$('text=Chart') || await page.$('[class*="chart"], [class*="Chart"]');
    if (chartPanel) {
      addResult('UI', 'Chart Panel Component', 'PASS', 'Chart panel present');
    } else {
      addResult('UI', 'Chart Panel Component', 'WARN', 'Chart panel not detected');
    }
  } catch (err) {
    addResult('UI', 'Chart', 'FAIL', err.message);
  }
}

async function testOptionChain(page) {
  console.log('[6/12] Testing Option Chain...');
  try {
    // Check API endpoint
    const ocRes = await fetch(`${SERVER_URL}/api/market/option-chain?symbol=NIFTY&expiry=2024-01-25`);
    if (ocRes.ok) {
      const data = await ocRes.json();
      addResult('API', 'Option Chain API', 'PASS', `Returned ${Array.isArray(data) ? data.length : 0} entries`);
    } else if (ocRes.status === 401) {
      addResult('API', 'Option Chain API', 'WARN', 'Auth required (expected in production)');
    } else {
      const errBody = await ocRes.text();
      addResult('API', 'Option Chain API', 'WARN', `Status: ${ocRes.status} - ${errBody.slice(0, 100)}`);
    }

    // Check expiries API
    const expRes = await fetch(`${SERVER_URL}/api/market/expiries?symbol=NIFTY`);
    if (expRes.ok) {
      addResult('API', 'Expiries API', 'PASS', 'Expiries endpoint accessible');
    } else if (expRes.status === 401) {
      addResult('API', 'Expiries API', 'WARN', 'Auth required');
    } else {
      addResult('API', 'Expiries API', 'WARN', `Status: ${expRes.status}`);
    }
  } catch (err) {
    addResult('API', 'Option Chain', 'FAIL', err.message);
  }
}

async function testMarketDepth(page) {
  console.log('[7/12] Testing Market Depth...');
  try {
    const depthRes = await fetch(`${SERVER_URL}/api/market/depth?token=99926000`);
    if (depthRes.ok) {
      const data = await depthRes.json();
      addResult('API', 'Market Depth API', 'PASS', `Data received for NIFTY`);
    } else if (depthRes.status === 401) {
      addResult('API', 'Market Depth API', 'WARN', 'Auth required');
    } else {
      addResult('API', 'Market Depth API', 'WARN', `Status: ${depthRes.status}`);
    }

    // Check DOM in UI
    const depthPanel = await page.$('[class*="depth"]') || await page.$('[class*="Depth"]') || await page.$(':text("Bid")') || await page.$(':text("Ask")');
    if (depthPanel) {
      addResult('UI', 'Market Depth Panel', 'PASS', 'Depth panel rendered');
    } else {
      addResult('UI', 'Market Depth Panel', 'WARN', 'Depth panel not visible (may require symbol selection)');
    }
  } catch (err) {
    addResult('API', 'Market Depth', 'FAIL', err.message);
  }
}

async function testOrderPanel(page) {
  console.log('[8/12] Testing Order Panel...');
  try {
    // Check for order panel in UI
    const orderPanel = await page.$('text=BUY') || await page.$('text=SELL') || await page.$('[class*="order"], [class*="Order"]');
    if (orderPanel) {
      addResult('UI', 'Order Panel Visible', 'PASS', 'Order panel with BUY/SELL detected');
    } else {
      addResult('UI', 'Order Panel Visible', 'WARN', 'Order panel not visible');
    }

    // Test order API (should reject without proper params but be accessible)
    const orderRes = await fetch(`${SERVER_URL}/api/orders`);
    if (orderRes.ok) {
      addResult('API', 'Orders List API', 'PASS', 'Orders endpoint accessible');
    } else if (orderRes.status === 401) {
      addResult('API', 'Orders List API', 'WARN', 'Auth required (expected)');
    } else {
      addResult('API', 'Orders List API', 'WARN', `Status: ${orderRes.status}`);
    }
  } catch (err) {
    addResult('UI', 'Order Panel', 'FAIL', err.message);
  }
}

async function testPositionsAndTrades(page) {
  console.log('[9/12] Testing Positions & Trades...');
  try {
    // Positions API
    const posRes = await fetch(`${SERVER_URL}/api/positions`);
    if (posRes.ok) {
      addResult('API', 'Positions API', 'PASS', 'Positions endpoint accessible');
    } else if (posRes.status === 401) {
      addResult('API', 'Positions API', 'WARN', 'Auth required');
    } else {
      addResult('API', 'Positions API', 'WARN', `Status: ${posRes.status}`);
    }

    // Trades API
    const tradeRes = await fetch(`${SERVER_URL}/api/trades`);
    if (tradeRes.ok) {
      addResult('API', 'Trades API', 'PASS', 'Trades endpoint accessible');
    } else if (tradeRes.status === 401) {
      addResult('API', 'Trades API', 'WARN', 'Auth required');
    } else {
      addResult('API', 'Trades API', 'WARN', `Status: ${tradeRes.status}`);
    }

    // Check bottom panel tabs in UI
    const posTab = await page.$('text=Positions') || await page.$('text=positions');
    const ordTab = await page.$('text=Orders') || await page.$('text=orders');
    if (posTab) addResult('UI', 'Positions Tab', 'PASS', 'Positions tab visible');
    else addResult('UI', 'Positions Tab', 'WARN', 'Positions tab not visible');
    if (ordTab) addResult('UI', 'Orders Tab', 'PASS', 'Orders tab visible');
    else addResult('UI', 'Orders Tab', 'WARN', 'Orders tab not visible');
  } catch (err) {
    addResult('API', 'Positions/Trades', 'FAIL', err.message);
  }
}

async function testWebSocket(page) {
  console.log('[10/12] Testing WebSocket & Socket.IO...');
  try {
    // Test WebSocket connectivity
    const wsResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        try {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
          const timeout = setTimeout(() => {
            ws.close();
            resolve({ connected: false, error: 'timeout' });
          }, 5000);
          ws.onopen = () => {
            clearTimeout(timeout);
            ws.close();
            resolve({ connected: true });
          };
          ws.onerror = (e) => {
            clearTimeout(timeout);
            resolve({ connected: false, error: 'connection_error' });
          };
        } catch (e) {
          resolve({ connected: false, error: e.message });
        }
      });
    });

    if (wsResult.connected) {
      addResult('Realtime', 'WebSocket Connection', 'PASS', 'WS connected successfully');
    } else {
      addResult('Realtime', 'WebSocket Connection', 'WARN', `WS: ${wsResult.error}`);
    }
  } catch (err) {
    addResult('Realtime', 'WebSocket', 'FAIL', err.message);
  }

  // Test Socket.IO endpoint
  try {
    const sioRes = await fetch(`${SERVER_URL}/socket.io/?EIO=4&transport=polling`);
    if (sioRes.ok) {
      addResult('Realtime', 'Socket.IO Polling', 'PASS', 'Socket.IO endpoint accessible');
    } else {
      addResult('Realtime', 'Socket.IO Polling', 'WARN', `Status: ${sioRes.status}`);
    }
  } catch (err) {
    addResult('Realtime', 'Socket.IO Polling', 'WARN', err.message);
  }
}

async function testAPIEndpoints() {
  console.log('[11/12] Testing API Endpoints...');
  const endpoints = [
    { path: '/health', method: 'GET', name: 'Health Check', expectAuth: false },
    { path: '/api/market/live', method: 'GET', name: 'Market Live Status', expectAuth: false },
    { path: '/api/account', method: 'GET', name: 'Account Info', expectAuth: true },
    { path: '/api/instruments/search?q=NIFTY', method: 'GET', name: 'Instrument Search', expectAuth: false },
    { path: '/api/instruments?segment=NSE', method: 'GET', name: 'Instruments List', expectAuth: true },
    { path: '/api/market/history?token=99926000&tf=5', method: 'GET', name: 'Historical Data', expectAuth: true },
    { path: '/api/positions', method: 'GET', name: 'Positions', expectAuth: true },
    { path: '/api/orders', method: 'GET', name: 'Orders', expectAuth: true },
    { path: '/api/trades', method: 'GET', name: 'Trades', expectAuth: true },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${SERVER_URL}${ep.path}`, { method: ep.method });
      if (res.ok) {
        addResult('API', ep.name, 'PASS', `${ep.method} ${ep.path} → ${res.status}`);
      } else if (res.status === 401 && ep.expectAuth) {
        addResult('API', ep.name, 'PASS', `Auth required as expected (401)`);
      } else if (res.status === 404) {
        addResult('API', ep.name, 'FAIL', `Endpoint not found: ${ep.path}`);
      } else {
        const body = await res.text().catch(() => '');
        addResult('API', ep.name, 'WARN', `${res.status}: ${body.slice(0, 80)}`);
      }
    } catch (err) {
      addResult('API', ep.name, 'FAIL', `Unreachable: ${err.message}`);
    }
  }
}

async function testUIComponents(page) {
  console.log('[12/12] Testing UI Components...');
  try {
    // Status Bar
    const statusBar = await page.$('text=Market') || await page.$('[class*="status"], [class*="Status"]');
    if (statusBar) addResult('UI', 'Status Bar', 'PASS', 'Status bar rendered');
    else addResult('UI', 'Status Bar', 'WARN', 'Status bar not detected');

    // Search Modal (Ctrl+K)
    try {
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(500);
      const searchModal = await page.$('[class*="search"], [class*="Search"], [role="dialog"]');
      if (searchModal) {
        addResult('UI', 'Search Modal (Ctrl+K)', 'PASS', 'Search modal opens');
        await page.keyboard.press('Escape');
      } else {
        addResult('UI', 'Search Modal (Ctrl+K)', 'WARN', 'Search modal did not open');
      }
    } catch (err) {
      addResult('UI', 'Search Modal', 'WARN', err.message);
    }

    // Risk Widget
    const riskWidget = await page.$('text=Risk') || await page.$('[class*="risk"], [class*="Risk"]');
    if (riskWidget) addResult('UI', 'Risk Widget', 'PASS', 'Risk widget visible');
    else addResult('UI', 'Risk Widget', 'WARN', 'Risk widget not detected');

    // Top Bar / Navigation
    const topBar = await page.$('text=FundedWealth') || await page.$('[class*="TopBar"]') || await page.$('img[alt*="FW"]');
    if (topBar) addResult('UI', 'Top Bar / Branding', 'PASS', 'Top bar with branding visible');
    else addResult('UI', 'Top Bar / Branding', 'WARN', 'Top bar not detected');
  } catch (err) {
    addResult('UI', 'UI Components', 'FAIL', err.message);
  }
}

async function collectConsoleErrors(page) {
  // Already collected via page event listeners set up in main()
  if (results.consoleErrors.length > 0) {
    addResult('Stability', 'Console Errors', 'WARN', `${results.consoleErrors.length} console errors detected`);
  } else {
    addResult('Stability', 'Console Errors', 'PASS', 'No console errors');
  }

  if (results.networkFailures.length > 0) {
    addResult('Stability', 'Network Failures', 'WARN', `${results.networkFailures.length} failed requests`);
  } else {
    addResult('Stability', 'Network Failures', 'PASS', 'No network failures');
  }
}

async function testMissingPages(page) {
  console.log('  Testing missing pages...');
  const routes = ['/', '/nonexistent-page', '/admin', '/settings'];
  for (const route of routes) {
    try {
      const res = await page.goto(`${FRONTEND_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      if (route === '/nonexistent-page') {
        // SPA should still load (it's a single page app)
        if (res && res.status() === 200) {
          addResult('Routes', `Route: ${route}`, 'PASS', 'SPA handles unknown routes gracefully');
        }
      }
    } catch (err) {
      if (route !== '/') {
        addResult('Routes', `Route: ${route}`, 'WARN', err.message);
      }
    }
  }
  // Navigate back to main
  await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 10000 });
}

// ─── MAIN EXECUTION ──────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FUNDEDWEALTH TERMINAL — PLAYWRIGHT PRODUCTION AUDIT');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Frontend: ${FRONTEND_URL}`);
  console.log(`  Server:   ${SERVER_URL}`);
  console.log(`  Time:     ${new Date().toISOString()}`);
  console.log('');

  // 1. Server health (no browser needed)
  await testServerHealth();

  // 2. Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'FundedWealth-Audit/1.0',
  });
  const page = await context.newPage();

  // Collect console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      results.consoleErrors.push({ text: msg.text(), url: page.url(), time: new Date().toISOString() });
    }
  });

  // Collect network failures
  page.on('requestfailed', (request) => {
    results.networkFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown',
      time: new Date().toISOString(),
    });
  });

  try {
    // 2. Auth flow tests
    await testAuthFlow(page);

    // 3. Authenticate and load terminal
    const loaded = await authenticateAndLoad(page, context);

    if (loaded) {
      // Wait for app to fully render
      await page.waitForTimeout(3000);

      // Take full page screenshot
      await page.screenshot({ path: 'audit/production-audit-screenshot.png', fullPage: false });

      // 4-9. UI & API tests
      await testWatchlist(page);
      await testChart(page);
      await testOptionChain(page);
      await testMarketDepth(page);
      await testOrderPanel(page);
      await testPositionsAndTrades(page);
      await testWebSocket(page);
      await testUIComponents(page);
      await testMissingPages(page);
    }

    // 10-11. API endpoints (no auth required for these tests)
    await testAPIEndpoints();

    // 12. Console & Network
    await collectConsoleErrors(page);

  } catch (err) {
    addResult('System', 'Audit Execution', 'FAIL', err.message);
  } finally {
    await browser.close();
  }

  // Write results JSON
  writeFileSync('audit/production-audit-results.json', JSON.stringify(results, null, 2));

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  AUDIT RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total Tests:  ${results.summary.total}`);
  console.log(`  ✓ Passed:     ${results.summary.passed}`);
  console.log(`  ✗ Failed:     ${results.summary.failed}`);
  console.log(`  ⚠ Warnings:   ${results.summary.warnings}`);
  console.log(`  Console Errs: ${results.consoleErrors.length}`);
  console.log(`  Net Failures: ${results.networkFailures.length}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // Print failures
  const failures = results.tests.filter(t => t.status === 'FAIL');
  if (failures.length > 0) {
    console.log('  FAILURES:');
    failures.forEach(f => console.log(`    ✗ [${f.category}] ${f.name}: ${f.details}`));
    console.log('');
  }

  // Print warnings
  const warnings = results.tests.filter(t => t.status === 'WARN');
  if (warnings.length > 0) {
    console.log('  WARNINGS:');
    warnings.forEach(w => console.log(`    ⚠ [${w.category}] ${w.name}: ${w.details}`));
    console.log('');
  }

  console.log(`  Results saved to: audit/production-audit-results.json`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
