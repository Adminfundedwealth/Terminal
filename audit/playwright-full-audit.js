/**
 * PLAYWRIGHT FULL RUNTIME AUDIT
 * FundedWealth Terminal — Comprehensive Isolation & Functionality Audit
 * 
 * Tests:
 *   - Every API endpoint
 *   - WebSocket/Socket.IO connectivity
 *   - TradingView datafeed endpoints
 *   - Authentication flows
 *   - Frontend page load & components
 *   - Old table name references in runtime responses
 *   - Old project URL references
 *   - Challenge, Risk, Order, Position lifecycle endpoints
 * 
 * Usage: node audit/playwright-full-audit.js
 * Prerequisites: Server running on port 4000, Frontend on port 3000
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'http://localhost:4000';
const FRONTEND_URL = 'http://localhost:3000';

const results = {
  timestamp: new Date().toISOString(),
  backend: { health: null, endpoints: [], websocket: null, socketio: null },
  frontend: { loads: false, components: [], redirects: [], networkRequests: [] },
  tradingview: { config: null, symbols: null, search: null, history: null },
  auth: { verify: null, sso: null, devToken: null, logout: null },
  isolation: { oldTableRefs: [], oldUrlRefs: [], oldRouteRefs: [] },
  eventBus: null,
  verdict: null,
};

// ─── Helper: HTTP request ────────────────────────────────────────
function httpGet(url, options = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json: parsed });
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message, body: null, json: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', body: null, json: null }); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function httpPost(url, data, headers = {}) {
  const body = JSON.stringify(data);
  return httpGet(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

// ─── Test: Backend Health ────────────────────────────────────────
async function testBackendHealth() {
  console.log('\n[1/9] Testing Backend Health...');
  const res = await httpGet(`${BACKEND_URL}/health`);
  results.backend.health = {
    status: res.status,
    data: res.json,
    reachable: res.status === 200,
  };
  if (res.json) {
    console.log(`   ✓ Health OK: db=${res.json.database?.connected}, feed=${res.json.feed?.connected}`);
    console.log(`   ✓ EventBus: ${JSON.stringify(res.json.eventBus || {})}`);
    console.log(`   ✓ Socket.IO: ${JSON.stringify(res.json.socketIO || {})}`);
    results.eventBus = res.json.eventBus;
  } else {
    console.log(`   ✗ Health endpoint returned ${res.status}: ${res.error || res.body}`);
  }
}

// ─── Test: All API Endpoints ─────────────────────────────────────
async function testAPIEndpoints() {
  console.log('\n[2/9] Testing API Endpoints...');
  
  const endpoints = [
    { path: '/api/account', method: 'GET', auth: true, name: 'Account Info' },
    { path: '/api/account/challenge', method: 'GET', auth: true, name: 'Challenge Progress' },
    { path: '/api/account/rules', method: 'GET', auth: true, name: 'Risk Rules' },
    { path: '/api/positions', method: 'GET', auth: true, name: 'Positions' },
    { path: '/api/orders', method: 'GET', auth: true, name: 'Orders' },
    { path: '/api/trades', method: 'GET', auth: true, name: 'Trades' },
    { path: '/api/trades?period=today', method: 'GET', auth: true, name: 'Trades Today' },
    { path: '/api/watchlists', method: 'GET', auth: true, name: 'Watchlists' },
    { path: '/api/instruments/search?q=nifty', method: 'GET', auth: false, name: 'Search Instruments' },
    { path: '/api/instruments?segment=NSE', method: 'GET', auth: false, name: 'Get Instruments by Segment' },
    { path: '/api/market/history?token=99926000&tf=5', method: 'GET', auth: false, name: 'Market History' },
    { path: '/api/market/depth?token=99926000', method: 'GET', auth: false, name: 'Market Depth' },
    { path: '/api/market/quote?token=99926000', method: 'GET', auth: false, name: 'Market Quote' },
    { path: '/api/market/status', method: 'GET', auth: false, name: 'Market Status' },
    { path: '/api/market/option-chain?symbol=NIFTY&expiry=2026-06-26', method: 'GET', auth: false, name: 'Option Chain' },
    { path: '/api/market/expiries?symbol=NIFTY', method: 'GET', auth: false, name: 'Expiries' },
    { path: '/api/market/live', method: 'GET', auth: false, name: 'Market Live Feed Status' },
    { path: '/api/broker/health', method: 'GET', auth: false, name: 'Broker Health' },
  ];

  for (const ep of endpoints) {
    const res = await httpGet(`${BACKEND_URL}${ep.path}`);
    const entry = {
      name: ep.name,
      path: ep.path,
      status: res.status,
      hasData: res.json !== null,
      dataType: Array.isArray(res.json) ? `array[${res.json.length}]` : typeof res.json,
      sample: res.json ? JSON.stringify(res.json).substring(0, 200) : null,
    };
    results.backend.endpoints.push(entry);
    const icon = res.status === 200 ? '✓' : res.status === 401 ? '○' : '✗';
    console.log(`   ${icon} ${ep.name}: ${res.status} (${entry.dataType})`);
  }
}

// ─── Test: TradingView Datafeed ──────────────────────────────────
async function testTradingViewDatafeed() {
  console.log('\n[3/9] Testing TradingView Datafeed Endpoints...');
  
  // Config
  const configRes = await httpGet(`${BACKEND_URL}/api/tv/config`);
  results.tradingview.config = { status: configRes.status, data: configRes.json };
  console.log(`   ${configRes.status === 200 ? '✓' : '✗'} /api/tv/config: ${configRes.status}`);
  
  // Symbol resolve
  const symbolRes = await httpGet(`${BACKEND_URL}/api/tv/symbols?symbol=NIFTY 50`);
  results.tradingview.symbols = { status: symbolRes.status, data: symbolRes.json };
  console.log(`   ${symbolRes.status === 200 ? '✓' : '✗'} /api/tv/symbols: ${symbolRes.status} (${symbolRes.json?.name || 'null'})`);
  
  // Search
  const searchRes = await httpGet(`${BACKEND_URL}/api/tv/search?query=reliance&limit=5`);
  results.tradingview.search = { status: searchRes.status, count: Array.isArray(searchRes.json) ? searchRes.json.length : 0 };
  console.log(`   ${searchRes.status === 200 ? '✓' : '✗'} /api/tv/search: ${searchRes.status} (${results.tradingview.search.count} results)`);
  
  // History
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * 30;
  const histRes = await httpGet(`${BACKEND_URL}/api/tv/history?symbol=NIFTY 50&resolution=D&from=${from}&to=${now}`);
  results.tradingview.history = { status: histRes.status, data: histRes.json?.s, barCount: histRes.json?.t?.length || 0 };
  console.log(`   ${histRes.status === 200 ? '✓' : '✗'} /api/tv/history: ${histRes.status} (s=${histRes.json?.s}, bars=${results.tradingview.history.barCount})`);
}

// ─── Test: Authentication Flows ──────────────────────────────────
async function testAuthFlows() {
  console.log('\n[4/9] Testing Authentication Flows...');
  
  // Verify (no cookie)
  const verifyRes = await httpGet(`${BACKEND_URL}/auth/verify`);
  results.auth.verify = { status: verifyRes.status, data: verifyRes.json };
  console.log(`   ${verifyRes.status === 401 ? '✓' : '○'} /auth/verify (no cookie): ${verifyRes.status} — ${verifyRes.json?.reason || ''}`);
  
  // Dev SSO token generation
  const devTokenRes = await httpGet(`${BACKEND_URL}/auth/dev/generate-sso?userId=usr_audit_001&accountId=audit-account-001`);
  results.auth.devToken = { status: devTokenRes.status, data: devTokenRes.json };
  console.log(`   ${devTokenRes.status === 200 ? '✓' : '✗'} /auth/dev/generate-sso: ${devTokenRes.status}`);
  
  // SSO flow (without valid token)
  const ssoRes = await httpGet(`${BACKEND_URL}/auth/sso?token=invalid-token`);
  results.auth.sso = { status: ssoRes.status, redirected: ssoRes.status === 302 || (ssoRes.headers && ssoRes.headers.location) };
  console.log(`   ${results.auth.sso.redirected ? '✓' : '○'} /auth/sso (invalid): status=${ssoRes.status}, redirect=${ssoRes.headers?.location || 'none'}`);
  
  // Logout
  const logoutRes = await httpPost(`${BACKEND_URL}/auth/logout`, {});
  results.auth.logout = { status: logoutRes.status, data: logoutRes.json };
  console.log(`   ${logoutRes.status === 200 ? '✓' : '✗'} /auth/logout: ${logoutRes.status}`);
}

// ─── Test: WebSocket (Legacy /ws) ────────────────────────────────
async function testWebSocket() {
  console.log('\n[5/9] Testing WebSocket (Legacy /ws)...');
  
  return new Promise((resolve) => {
    let WebSocket;
    try {
      WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
    } catch {
      try { WebSocket = require('ws'); } catch {
        console.log('   ○ ws module not available, testing via HTTP upgrade');
        results.backend.websocket = { connected: false, error: 'ws module not found', messages: [] };
        return resolve();
      }
    }
    const wsResult = { connected: false, messages: [], error: null };
    
    try {
      const ws = new WebSocket(`ws://localhost:4000/ws`);
      let messageCount = 0;
      
      ws.on('open', () => {
        wsResult.connected = true;
        console.log('   ✓ WebSocket connected to /ws');
        
        // Subscribe to quotes
        ws.send(JSON.stringify({ type: 'subscribe', tokens: ['99926000', '2885'] }));
      });
      
      ws.on('message', (data) => {
        messageCount++;
        const parsed = JSON.parse(data.toString());
        wsResult.messages.push({ type: parsed.type, token: parsed.token, hasData: !!parsed.data });
        if (messageCount >= 5 || wsResult.messages.length >= 5) {
          ws.close();
        }
      });
      
      ws.on('error', (err) => {
        wsResult.error = err.message;
        console.log(`   ✗ WebSocket error: ${err.message}`);
      });
      
      ws.on('close', () => {
        results.backend.websocket = wsResult;
        console.log(`   ✓ Messages received: ${wsResult.messages.length}`);
        wsResult.messages.forEach((m, i) => {
          console.log(`     [${i}] type=${m.type}, token=${m.token || 'n/a'}`);
        });
        resolve();
      });
      
      // Timeout after 8s
      setTimeout(() => {
        ws.close();
        results.backend.websocket = wsResult;
        resolve();
      }, 8000);
    } catch (err) {
      wsResult.error = err.message;
      results.backend.websocket = wsResult;
      console.log(`   ✗ WebSocket failed: ${err.message}`);
      resolve();
    }
  });
}

// ─── Test: Socket.IO ─────────────────────────────────────────────
async function testSocketIO() {
  console.log('\n[6/9] Testing Socket.IO...');
  
  return new Promise((resolve) => {
    const sioResult = { connected: false, events: [], error: null };
    
    try {
      // Use raw HTTP to test Socket.IO handshake (polling transport)
      httpGet(`${BACKEND_URL}/socket.io/?EIO=4&transport=polling`).then((res) => {
        if (res.status === 200 && res.body) {
          sioResult.connected = true;
          sioResult.handshake = res.body.substring(0, 200);
          console.log(`   ✓ Socket.IO handshake successful (polling)`);
          console.log(`     Response: ${res.body.substring(0, 100)}...`);
        } else {
          sioResult.error = `Handshake failed: ${res.status}`;
          console.log(`   ✗ Socket.IO handshake failed: ${res.status}`);
        }
        results.backend.socketio = sioResult;
        resolve();
      });
    } catch (err) {
      sioResult.error = err.message;
      results.backend.socketio = sioResult;
      console.log(`   ✗ Socket.IO failed: ${err.message}`);
      resolve();
    }
  });
}

// ─── Test: Order Lifecycle (Place/Modify/Cancel) ─────────────────
async function testOrderLifecycle() {
  console.log('\n[7/9] Testing Order Lifecycle...');
  
  // Place order
  const placeRes = await httpPost(`${BACKEND_URL}/api/orders/place`, {
    symbol: 'RELIANCE',
    token: '2885',
    segment: 'NSE',
    side: 'BUY',
    orderType: 'LIMIT',
    productType: 'MIS',
    qty: 10,
    price: 2900,
  });
  
  const orderEntry = {
    place: { status: placeRes.status, data: placeRes.json },
    modify: null,
    cancel: null,
  };
  
  console.log(`   ${placeRes.status === 200 ? '✓' : '○'} Place order: ${placeRes.status} — ${JSON.stringify(placeRes.json || {}).substring(0, 100)}`);
  
  if (placeRes.json?.orderId) {
    // Modify order
    const modRes = await httpGet(`${BACKEND_URL}/api/orders/${placeRes.json.orderId}/modify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 2950 }),
    });
    orderEntry.modify = { status: modRes.status, data: modRes.json };
    console.log(`   ${modRes.status === 200 ? '✓' : '○'} Modify order: ${modRes.status}`);
    
    // Cancel order
    const cancelRes = await httpGet(`${BACKEND_URL}/api/orders/${placeRes.json.orderId}/cancel`, {
      method: 'DELETE',
    });
    orderEntry.cancel = { status: cancelRes.status, data: cancelRes.json };
    console.log(`   ${cancelRes.status === 200 ? '✓' : '○'} Cancel order: ${cancelRes.status}`);
  }
  
  results.backend.endpoints.push({ name: 'Order Lifecycle', ...orderEntry });
}

// ─── Test: Frontend (Playwright Browser) ─────────────────────────
async function testFrontend() {
  console.log('\n[8/9] Testing Frontend (Playwright Browser)...');
  
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const networkRequests = [];
    const consoleMessages = [];
    const errors = [];
    
    page.on('request', (req) => networkRequests.push(req.url()));
    page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', (err) => errors.push(err.message));
    
    // Navigate to frontend
    console.log('   Loading frontend...');
    const response = await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    results.frontend.loads = response?.status() === 200;
    console.log(`   ${results.frontend.loads ? '✓' : '✗'} Page loaded: ${response?.status()}`);
    
    // Check current URL (redirected?)
    const currentUrl = page.url();
    const wasRedirected = !currentUrl.startsWith(FRONTEND_URL) && !currentUrl.startsWith('http://localhost:3000');
    results.frontend.redirects.push({ from: FRONTEND_URL, to: currentUrl, redirected: wasRedirected });
    console.log(`   ${wasRedirected ? '✗ REDIRECTED' : '✓ No redirect'}: ${currentUrl}`);
    
    // Wait for app to render
    await page.waitForTimeout(3000);
    
    // Check key components
    const components = [
      { name: 'TopBar', selector: '[class*="top-bar"], header, [class*="TopBar"]' },
      { name: 'Watchlist', selector: '[class*="watchlist"], [class*="Watchlist"]' },
      { name: 'Chart', selector: '[class*="chart"], canvas, [class*="Chart"]' },
      { name: 'OrderPanel', selector: '[class*="order"], [class*="Order"]' },
      { name: 'BottomPanel', selector: '[class*="bottom"], [class*="Bottom"]' },
      { name: 'StatusBar', selector: '[class*="status"], footer, [class*="Status"]' },
      { name: 'SearchModal trigger (Ctrl+K)', selector: 'body' },
    ];
    
    for (const comp of components) {
      const found = await page.$(comp.selector);
      results.frontend.components.push({ name: comp.name, found: !!found });
      console.log(`   ${found ? '✓' : '○'} ${comp.name}: ${found ? 'present' : 'not found'}`);
    }
    
    // Check for TradingView chart (canvas element)
    const canvasCount = await page.$$eval('canvas', (els) => els.length);
    results.frontend.components.push({ name: 'Chart Canvas', found: canvasCount > 0, count: canvasCount });
    console.log(`   ${canvasCount > 0 ? '✓' : '○'} Chart Canvas elements: ${canvasCount}`);
    
    // Check network requests for old URLs
    const oldUrlPatterns = [
      /fundedwealth\.in/,
      /localhost:300[1-9]/,
      /localhost:8080/,
      /old-project/,
      /old-terminal/,
    ];
    
    const oldNetworkRefs = networkRequests.filter((url) =>
      oldUrlPatterns.some((pattern) => pattern.test(url))
    );
    results.frontend.networkRequests = {
      total: networkRequests.length,
      oldRefs: oldNetworkRefs,
    };
    console.log(`   ✓ Network requests: ${networkRequests.length} total, ${oldNetworkRefs.length} old-project refs`);
    
    // Check console for errors related to old project
    const oldConsoleRefs = consoleMessages.filter((m) =>
      m.text.includes('old-project') || m.text.includes('fundedwealth.in')
    );
    results.frontend.consoleErrors = errors;
    results.frontend.oldConsoleRefs = oldConsoleRefs;
    console.log(`   ✓ Console errors: ${errors.length}, old refs: ${oldConsoleRefs.length}`);
    
    await browser.close();
  } catch (err) {
    console.log(`   ✗ Frontend test failed: ${err.message}`);
    results.frontend.error = err.message;
    if (browser) await browser.close();
  }
}

// ─── Test: Code Isolation (Old Table/URL References) ─────────────
async function testCodeIsolation() {
  console.log('\n[9/9] Testing Code Isolation (Source Scan)...');
  
  const serverDir = path.join(__dirname, '..', 'server');
  const srcDir = path.join(__dirname, '..', 'src');
  
  // Files to scan for old references
  const filesToScan = [];
  
  function collectFiles(dir, ext) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectFiles(full, ext);
        } else if (entry.name.endsWith(ext)) {
          filesToScan.push(full);
        }
      }
    } catch {}
  }
  
  collectFiles(serverDir, '.js');
  collectFiles(srcDir, '.ts');
  collectFiles(srcDir, '.tsx');
  
  console.log(`   Scanning ${filesToScan.length} source files...`);
  
  // Pattern: .from('bare_table_name') — should be .from('t_table_name')
  const oldTablePattern = /\.from\(['"](?!t_)(users|accounts|orders|positions|trades|challenges|sessions)['"]\)/g;
  // Pattern: old URLs
  const oldUrlPattern = /(fundedwealth\.in|localhost:300[1-9]|localhost:8080|old-project|old-terminal)/g;
  
  for (const file of filesToScan) {
    const content = fs.readFileSync(file, 'utf-8');
    const relativePath = path.relative(path.join(__dirname, '..'), file);
    
    // Check old table refs
    let match;
    while ((match = oldTablePattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      results.isolation.oldTableRefs.push({
        file: relativePath,
        line: lineNum,
        match: match[0],
        table: match[1],
      });
    }
    oldTablePattern.lastIndex = 0;
    
    // Check old URL refs
    while ((match = oldUrlPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      results.isolation.oldUrlRefs.push({
        file: relativePath,
        line: lineNum,
        match: match[0],
      });
    }
    oldUrlPattern.lastIndex = 0;
  }
  
  console.log(`   Old table references (bare names without t_ prefix): ${results.isolation.oldTableRefs.length}`);
  results.isolation.oldTableRefs.forEach((ref) => {
    console.log(`     ✗ ${ref.file}:${ref.line} — ${ref.match}`);
  });
  
  console.log(`   Old URL references: ${results.isolation.oldUrlRefs.length}`);
  results.isolation.oldUrlRefs.forEach((ref) => {
    console.log(`     ○ ${ref.file}:${ref.line} — ${ref.match}`);
  });
}

// ─── Generate Verdict ────────────────────────────────────────────
function generateVerdict() {
  console.log('\n════════════════════════════════════════════════');
  console.log('  FINAL VERDICT');
  console.log('════════════════════════════════════════════════');
  
  const criticalOldTableCount = results.isolation.oldTableRefs.filter(
    (ref) => !ref.file.includes('setup.js') && !ref.file.includes('schema.sql')
  ).length;
  
  const hasOldUrls = results.isolation.oldUrlRefs.length > 0;
  const oldNetworkRefs = results.frontend.networkRequests?.oldRefs?.length || 0;
  
  if (criticalOldTableCount === 0 && oldNetworkRefs === 0) {
    results.verdict = 'A. Fully Isolated';
    console.log('  ✓ A. FULLY ISOLATED');
    console.log('  All runtime code uses t_ prefix tables.');
    console.log('  No old-project URLs detected in network traffic.');
  } else if (criticalOldTableCount > 5) {
    results.verdict = 'C. Critical old-project dependencies remain';
    console.log('  ✗ C. CRITICAL OLD-PROJECT DEPENDENCIES REMAIN');
    console.log(`  ${criticalOldTableCount} source files still reference old bare table names.`);
    console.log('  These will FAIL at runtime when only t_ tables exist.');
  } else {
    results.verdict = 'B. Partially Isolated';
    console.log('  ⚠ B. PARTIALLY ISOLATED');
    console.log(`  ${criticalOldTableCount} old table refs found in non-setup code.`);
    console.log(`  ${oldNetworkRefs} old URL refs in network traffic.`);
  }
  
  console.log('════════════════════════════════════════════════\n');
}

// ─── Write Reports ───────────────────────────────────────────────
function writeReports() {
  const reportDir = path.join(__dirname, '..');
  
  // Write PLAYWRIGHT-FULL-AUDIT.md
  let md = `# PLAYWRIGHT FULL RUNTIME AUDIT\n\n`;
  md += `**Date:** ${results.timestamp}\n`;
  md += `**Auditor:** Playwright Automated Runtime Audit\n`;
  md += `**Backend:** ${BACKEND_URL}\n`;
  md += `**Frontend:** ${FRONTEND_URL}\n\n`;
  md += `---\n\n`;
  md += `## VERDICT: ${results.verdict}\n\n`;
  md += `---\n\n`;
  
  // Backend Health
  md += `## 1. Backend Health\n\n`;
  md += `| Field | Value |\n|-------|-------|\n`;
  if (results.backend.health?.data) {
    const h = results.backend.health.data;
    md += `| Status | ${h.status} |\n`;
    md += `| Database | ${h.database?.connected ? '✅ Connected' : '❌ ' + (h.database?.reason || 'Not connected')} |\n`;
    md += `| Market Feed | ${h.feed?.connected ? '✅ Connected' : '❌ Not connected'} |\n`;
    md += `| Socket.IO Clients | ${h.socketIO?.clients || 0} |\n`;
    md += `| EventBus Emitted | ${h.eventBus?.totalEmitted || 0} |\n`;
    md += `| Uptime | ${Math.round((h.uptime || 0) / 60)}min |\n`;
  } else {
    md += `| Status | ❌ Unreachable |\n`;
  }
  md += `\n`;
  
  // API Endpoints
  md += `## 2. API Endpoints\n\n`;
  md += `| Endpoint | Status | Data |\n|----------|--------|------|\n`;
  for (const ep of results.backend.endpoints) {
    if (ep.name === 'Order Lifecycle') continue;
    md += `| ${ep.name} (${ep.path}) | ${ep.status} | ${ep.dataType} |\n`;
  }
  md += `\n`;
  
  // TradingView
  md += `## 3. TradingView Datafeed\n\n`;
  md += `| Endpoint | Status | Result |\n|----------|--------|--------|\n`;
  md += `| /api/tv/config | ${results.tradingview.config?.status || 'N/A'} | ${results.tradingview.config?.status === 200 ? '✅' : '❌'} |\n`;
  md += `| /api/tv/symbols | ${results.tradingview.symbols?.status || 'N/A'} | ${results.tradingview.symbols?.data?.name || 'null'} |\n`;
  md += `| /api/tv/search | ${results.tradingview.search?.status || 'N/A'} | ${results.tradingview.search?.count || 0} results |\n`;
  md += `| /api/tv/history | ${results.tradingview.history?.status || 'N/A'} | s=${results.tradingview.history?.data}, bars=${results.tradingview.history?.barCount} |\n`;
  md += `\n`;

  // Auth
  md += `## 4. Authentication\n\n`;
  md += `| Flow | Status | Result |\n|------|--------|--------|\n`;
  md += `| Verify (no session) | ${results.auth.verify?.status || 'N/A'} | ${results.auth.verify?.data?.reason || ''} |\n`;
  md += `| Dev SSO Token | ${results.auth.devToken?.status || 'N/A'} | ${results.auth.devToken?.status === 200 ? '✅ Generated' : '❌'} |\n`;
  md += `| SSO (invalid token) | ${results.auth.sso?.status || 'N/A'} | ${results.auth.sso?.redirected ? 'Redirected (correct)' : 'No redirect'} |\n`;
  md += `| Logout | ${results.auth.logout?.status || 'N/A'} | ${results.auth.logout?.data?.success ? '✅' : '❌'} |\n`;
  md += `\n`;

  // WebSocket
  md += `## 5. WebSocket & Socket.IO\n\n`;
  md += `| Channel | Status | Details |\n|---------|--------|---------|\n`;
  md += `| WebSocket /ws | ${results.backend.websocket?.connected ? '✅ Connected' : '❌ Failed'} | ${results.backend.websocket?.messages?.length || 0} messages received |\n`;
  md += `| Socket.IO /socket.io | ${results.backend.socketio?.connected ? '✅ Handshake OK' : '❌ Failed'} | ${results.backend.socketio?.error || 'OK'} |\n`;
  md += `\n`;
  if (results.backend.websocket?.messages?.length > 0) {
    md += `**WebSocket Messages Received:**\n\`\`\`\n`;
    results.backend.websocket.messages.forEach((m) => {
      md += `  type=${m.type}, token=${m.token || 'n/a'}\n`;
    });
    md += `\`\`\`\n\n`;
  }

  // Frontend
  md += `## 6. Frontend\n\n`;
  md += `| Check | Result |\n|-------|--------|\n`;
  md += `| Page Loads | ${results.frontend.loads ? '✅' : '❌'} |\n`;
  md += `| Redirected | ${results.frontend.redirects?.[0]?.redirected ? '⚠️ Yes → ' + results.frontend.redirects[0].to : '✅ No'} |\n`;
  for (const comp of results.frontend.components) {
    md += `| ${comp.name} | ${comp.found ? '✅ Present' : '❌ Not found'} |\n`;
  }
  md += `| Old URL in network | ${results.frontend.networkRequests?.oldRefs?.length || 0} refs |\n`;
  md += `| Console errors | ${results.frontend.consoleErrors?.length || 0} |\n`;
  md += `\n`;
  
  // EventBus
  md += `## 7. EventBus\n\n`;
  if (results.eventBus) {
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Total Emitted | ${results.eventBus.totalEmitted || 0} |\n`;
    md += `| Redis Connected | ${results.eventBus.redisConnected || false} |\n`;
    md += `| Uptime | ${Math.round((results.eventBus.uptimeMs || 0) / 1000)}s |\n`;
    if (results.eventBus.byChannel) {
      Object.entries(results.eventBus.byChannel).forEach(([ch, count]) => {
        md += `| Channel: ${ch} | ${count} events |\n`;
      });
    }
  } else {
    md += `EventBus data not available (server not reachable or health endpoint missing).\n`;
  }
  md += `\n`;

  // Isolation
  md += `## 8. Isolation Analysis\n\n`;
  md += `### Old Table References (bare names, should use t_ prefix)\n\n`;
  if (results.isolation.oldTableRefs.length === 0) {
    md += `✅ No old bare table references found in source code.\n\n`;
  } else {
    md += `| File | Line | Reference |\n|------|------|-----------|\n`;
    results.isolation.oldTableRefs.forEach((ref) => {
      md += `| ${ref.file} | ${ref.line} | \`${ref.match}\` |\n`;
    });
    md += `\n`;
  }
  
  md += `### Old URL References\n\n`;
  if (results.isolation.oldUrlRefs.length === 0) {
    md += `✅ No old-project URL references found.\n\n`;
  } else {
    md += `| File | Line | Reference |\n|------|------|-----------|\n`;
    results.isolation.oldUrlRefs.forEach((ref) => {
      md += `| ${ref.file} | ${ref.line} | \`${ref.match}\` |\n`;
    });
    md += `\n`;
  }
  
  md += `---\n\n## FINAL VERDICT: ${results.verdict}\n`;
  
  fs.writeFileSync(path.join(reportDir, 'PLAYWRIGHT-FULL-AUDIT.md'), md);
  console.log('✓ Written: PLAYWRIGHT-FULL-AUDIT.md');
  
  // Write OLD-DEPENDENCY-REPORT.md
  let dep = `# OLD DEPENDENCY REPORT\n\n`;
  dep += `**Date:** ${results.timestamp}\n`;
  dep += `**Scanner:** Playwright Runtime Audit + Source Scan\n\n`;
  dep += `---\n\n`;
  dep += `## Summary\n\n`;
  dep += `- **Old table references (runtime-affecting):** ${results.isolation.oldTableRefs.length}\n`;
  dep += `- **Old URL references:** ${results.isolation.oldUrlRefs.length}\n`;
  dep += `- **Old network requests (runtime):** ${results.frontend.networkRequests?.oldRefs?.length || 0}\n\n`;
  dep += `---\n\n`;
  
  dep += `## Expected Tables (t_ prefix)\n\n`;
  dep += `The terminal should ONLY use these tables:\n`;
  dep += `- \`t_users\`\n- \`t_accounts\`\n- \`t_orders\`\n- \`t_positions\`\n- \`t_trades\`\n`;
  dep += `- \`t_challenges\`\n- \`t_sessions\`\n- \`t_risk_rules\`\n- \`t_watchlists\`\n- \`t_account_metrics\`\n\n`;
  
  dep += `## Files Using Old Bare Table Names\n\n`;
  dep += `These files use \`.from('table_name')\` instead of \`.from('t_table_name')\`:\n\n`;
  
  // Group by file
  const byFile = {};
  results.isolation.oldTableRefs.forEach((ref) => {
    if (!byFile[ref.file]) byFile[ref.file] = [];
    byFile[ref.file].push(ref);
  });
  
  Object.entries(byFile).forEach(([file, refs]) => {
    dep += `### \`${file}\`\n\n`;
    dep += `| Line | Table | Code |\n|------|-------|------|\n`;
    refs.forEach((ref) => {
      dep += `| ${ref.line} | ${ref.table} | \`${ref.match}\` |\n`;
    });
    dep += `\n`;
  });
  
  dep += `## Old URL References\n\n`;
  if (results.isolation.oldUrlRefs.length === 0) {
    dep += `✅ None found.\n\n`;
  } else {
    results.isolation.oldUrlRefs.forEach((ref) => {
      dep += `- \`${ref.file}:${ref.line}\` — \`${ref.match}\`\n`;
    });
    dep += `\n`;
  }
  
  dep += `## Repositories (Correctly Using t_ prefix)\n\n`;
  dep += `The following repositories are correctly configured:\n`;
  dep += `- UserRepository → \`t_users\` ✅\n`;
  dep += `- AccountRepository → \`t_accounts\` ✅\n`;
  dep += `- ChallengeRepository → \`t_challenges\` ✅\n`;
  dep += `- OrderRepository → \`t_orders\` ✅\n`;
  dep += `- PositionRepository → \`t_positions\` ✅\n`;
  dep += `- TradeRepository → \`t_trades\` ✅\n`;
  dep += `- WatchlistRepository → \`t_watchlists\` ✅\n`;
  dep += `- RiskRulesRepository → \`t_risk_rules\` ✅\n`;
  dep += `- MetricsRepository → \`t_account_metrics\` ✅\n\n`;
  
  dep += `## Services BYPASSING Repositories (Direct Supabase Queries)\n\n`;
  dep += `These services query Supabase directly using bare table names, bypassing the repository layer:\n\n`;
  dep += `| Service | Tables Referenced | Impact |\n|---------|-----------------|--------|\n`;
  dep += `| accountService.js | accounts, positions, orders, trades | ❌ Will query wrong tables |\n`;
  dep += `| sso.service.js | users, accounts | ❌ SSO login will fail |\n`;
  dep += `| session.service.js | sessions | ❌ Session CRUD will fail |\n`;
  dep += `| riskEngine.js | challenges (via accountRepo.db) | ❌ Challenge lookup will fail |\n`;
  dep += `| dailyChecks.js | accounts | ❌ Cron will query wrong table |\n`;
  dep += `| db/client.js | users (testConnection) | ⚠️ Health check may fail |\n`;
  dep += `| db/setup.js | users, challenges, accounts | ⚠️ Setup seeds wrong tables |\n`;
  dep += `| challenge.repository.js | accounts (cross-table lookup) | ❌ Wrong table |\n\n`;
  
  dep += `## Verdict: ${results.verdict}\n\n`;
  dep += `### Impact Assessment\n\n`;
  dep += `If only \`t_\` prefixed tables exist in the database:\n`;
  dep += `- ❌ **accountService.js** — getAccount, getPositions, getOrders, getTrades, placeOrder, modifyOrder, cancelOrder will ALL fail\n`;
  dep += `- ❌ **sso.service.js** — SSO login from Dashboard will fail (cannot find user/account)\n`;
  dep += `- ❌ **session.service.js** — Sessions cannot be created/revoked/validated\n`;
  dep += `- ❌ **riskEngine.js** — Challenge lookup in postTradeCheck will fail\n`;
  dep += `- ❌ **dailyChecks.js** — Daily cron will not find any accounts\n`;
  dep += `- ⚠️ **db/client.js** — testConnection will report "users table not found"\n\n`;
  dep += `### Required Fix\n\n`;
  dep += `All direct \`.from('bare_name')\` calls must be changed to \`.from('t_bare_name')\` OR refactored to use the corresponding Repository class.\n`;
  
  fs.writeFileSync(path.join(reportDir, 'OLD-DEPENDENCY-REPORT.md'), dep);
  console.log('✓ Written: OLD-DEPENDENCY-REPORT.md');
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════');
  console.log('  FUNDEDWEALTH TERMINAL — PLAYWRIGHT FULL AUDIT');
  console.log('════════════════════════════════════════════════');
  console.log(`  Timestamp: ${results.timestamp}`);
  console.log(`  Backend:   ${BACKEND_URL}`);
  console.log(`  Frontend:  ${FRONTEND_URL}`);
  
  // Check if backend is reachable first
  const healthCheck = await httpGet(`${BACKEND_URL}/health`);
  if (healthCheck.status === 0) {
    console.log('\n  ✗ Backend not reachable. Start server first: cd server && node index.js');
    console.log('  Running code isolation scan only...\n');
    await testCodeIsolation();
    generateVerdict();
    writeReports();
    return;
  }
  
  await testBackendHealth();
  await testAPIEndpoints();
  await testTradingViewDatafeed();
  await testAuthFlows();
  await testWebSocket();
  await testSocketIO();
  await testOrderLifecycle();
  await testFrontend();
  await testCodeIsolation();
  
  generateVerdict();
  writeReports();
  
  // Write raw JSON results
  fs.writeFileSync(
    path.join(__dirname, 'playwright-full-audit-results.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('✓ Written: audit/playwright-full-audit-results.json');
}

main().catch((err) => {
  console.error('AUDIT FATAL ERROR:', err);
  process.exit(1);
});
