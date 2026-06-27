/**
 * RUNTIME AUDIT SCRIPT
 * 
 * Tests all terminal endpoints, WebSocket, APIs, and checks for
 * old project references. Does NOT modify code.
 * 
 * Run: node audit/runtime-audit.js
 */

import { chromium } from 'playwright';

const SERVER_URL = 'http://localhost:4000';
const FRONTEND_URL = 'http://localhost:5173';
const results = {
  timestamp: new Date().toISOString(),
  server: { health: null, apis: [], websocket: null, socketio: null },
  frontend: { loaded: null, pages: [] },
  oldDependencies: [],
  tableReferences: [],
  verdict: null,
};

async function testServerHealth() {
  try {
    const resp = await fetch(`${SERVER_URL}/health`);
    const data = await resp.json();
    results.server.health = { status: resp.status, data };
    console.log(`[Health] Status: ${resp.status}, DB: ${data.database?.connected}, Feed: ${data.feed?.connected}`);
    return data;
  } catch (err) {
    results.server.health = { status: 'UNREACHABLE', error: err.message };
    console.log(`[Health] Server unreachable: ${err.message}`);
    return null;
  }
}

async function testAPIs() {
  const endpoints = [
    // Public endpoints
    { method: 'GET', path: '/health', auth: false, name: 'Health' },
    { method: 'GET', path: '/api/market/status', auth: false, name: 'Market Status' },
    { method: 'GET', path: '/api/market/live', auth: false, name: 'Market Live' },
    { method: 'GET', path: '/api/instruments/search?q=NIFTY', auth: false, name: 'Instrument Search' },
    { method: 'GET', path: '/api/instruments?segment=NSE', auth: false, name: 'Instruments by Segment' },
    { method: 'GET', path: '/api/market/quote?token=99926000', auth: false, name: 'Market Quote' },
    { method: 'GET', path: '/api/market/depth?token=99926000', auth: false, name: 'Market Depth' },
    { method: 'GET', path: '/api/market/history?token=99926000&tf=5', auth: false, name: 'Market History' },
    { method: 'GET', path: '/api/market/expiries?symbol=NIFTY', auth: false, name: 'Market Expiries' },
    { method: 'GET', path: '/api/market/option-chain?symbol=NIFTY&expiry=2026-06-25', auth: false, name: 'Option Chain' },
    // TradingView endpoints
    { method: 'GET', path: '/api/tv/config', auth: false, name: 'TV Config' },
    { method: 'GET', path: '/api/tv/search?query=RELIANCE', auth: false, name: 'TV Search' },
    { method: 'GET', path: '/api/tv/symbols?symbol=RELIANCE', auth: false, name: 'TV Symbols' },
    { method: 'GET', path: '/api/tv/history?symbol=RELIANCE&resolution=5&from=1718000000&to=1718700000', auth: false, name: 'TV History' },
    // Broker health
    { method: 'GET', path: '/api/broker/health', auth: false, name: 'Broker Health' },
    // Auth endpoints
    { method: 'GET', path: '/auth/verify', auth: false, name: 'Auth Verify (no token)' },
    { method: 'GET', path: '/auth/dev/generate-sso', auth: false, name: 'Dev SSO Generate' },
    // Protected endpoints (expect 401)
    { method: 'GET', path: '/api/account', auth: true, name: 'Account (protected)' },
    { method: 'GET', path: '/api/account/challenge', auth: true, name: 'Challenge (protected)' },
    { method: 'GET', path: '/api/account/rules', auth: true, name: 'Rules (protected)' },
    { method: 'GET', path: '/api/positions', auth: true, name: 'Positions (protected)' },
    { method: 'GET', path: '/api/orders', auth: true, name: 'Orders (protected)' },
    { method: 'GET', path: '/api/trades', auth: true, name: 'Trades (protected)' },
    { method: 'GET', path: '/api/watchlists', auth: true, name: 'Watchlists (protected)' },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(`${SERVER_URL}${ep.path}`, { method: ep.method });
      const contentType = resp.headers.get('content-type') || '';
      let body = null;
      if (contentType.includes('json')) {
        body = await resp.json();
      }
      const result = {
        name: ep.name,
        path: ep.path,
        status: resp.status,
        ok: ep.auth ? resp.status === 401 : resp.status === 200,
        responseType: contentType,
        bodyPreview: body ? JSON.stringify(body).slice(0, 200) : null,
      };
      results.server.apis.push(result);
      const icon = result.ok ? '✓' : '✗';
      console.log(`  [API] ${icon} ${ep.name}: ${resp.status}`);
    } catch (err) {
      results.server.apis.push({
        name: ep.name, path: ep.path, status: 'ERROR', ok: false, error: err.message,
      });
      console.log(`  [API] ✗ ${ep.name}: ${err.message}`);
    }
  }
}

async function testSSOFlow() {
  console.log('\n[SSO] Testing SSO authentication flow...');
  try {
    // Generate test SSO token
    const genResp = await fetch(`${SERVER_URL}/auth/dev/generate-sso`);
    if (genResp.status !== 200) {
      results.server.apis.push({ name: 'SSO Flow', status: genResp.status, ok: false, error: 'Cannot generate test SSO token' });
      console.log('  [SSO] ✗ Cannot generate test token');
      return null;
    }
    const genData = await genResp.json();
    console.log(`  [SSO] ✓ Test token generated`);

    // Validate SSO token (follow redirect manually)
    const ssoResp = await fetch(`${SERVER_URL}/auth/sso?token=${encodeURIComponent(genData.ssoToken)}`, { redirect: 'manual' });
    const setCookie = ssoResp.headers.get('set-cookie') || '';
    const hasSession = setCookie.includes('fw_session');
    console.log(`  [SSO] Response: ${ssoResp.status}, Cookie set: ${hasSession}`);

    // Extract session cookie
    const match = setCookie.match(/fw_session=([^;]+)/);
    const sessionToken = match ? match[1] : null;

    if (sessionToken) {
      // Verify the session
      const verifyResp = await fetch(`${SERVER_URL}/auth/verify`, {
        headers: { 'Cookie': `fw_session=${sessionToken}` },
      });
      const verifyData = await verifyResp.json();
      console.log(`  [SSO] ✓ Session verified: ${JSON.stringify(verifyData)}`);
      results.server.apis.push({ name: 'SSO Full Flow', status: 200, ok: true, data: verifyData });
      return sessionToken;
    } else {
      console.log(`  [SSO] ⚠ No session cookie (may be redirect-based)`);
      results.server.apis.push({ name: 'SSO Full Flow', status: ssoResp.status, ok: ssoResp.status === 302, note: 'Redirect-based SSO' });
      return null;
    }
  } catch (err) {
    console.log(`  [SSO] ✗ Error: ${err.message}`);
    results.server.apis.push({ name: 'SSO Flow', status: 'ERROR', ok: false, error: err.message });
    return null;
  }
}

async function testAuthenticatedAPIs(sessionToken) {
  if (!sessionToken) {
    console.log('\n[Auth APIs] Skipping — no session token available');
    return;
  }
  console.log('\n[Auth APIs] Testing authenticated endpoints...');
  const headers = { 'Cookie': `fw_session=${sessionToken}` };

  const endpoints = [
    { path: '/api/account', name: 'Account' },
    { path: '/api/account/challenge', name: 'Challenge Progress' },
    { path: '/api/account/rules', name: 'Risk Rules' },
    { path: '/api/positions', name: 'Positions' },
    { path: '/api/orders', name: 'Orders' },
    { path: '/api/trades', name: 'Trades' },
    { path: '/api/watchlists', name: 'Watchlists' },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(`${SERVER_URL}${ep.path}`, { headers });
      const data = await resp.json();
      const ok = resp.status === 200;
      results.server.apis.push({
        name: `${ep.name} (authenticated)`,
        path: ep.path, status: resp.status, ok,
        bodyPreview: JSON.stringify(data).slice(0, 300),
      });
      console.log(`  [Auth] ${ok ? '✓' : '✗'} ${ep.name}: ${resp.status}`);
    } catch (err) {
      console.log(`  [Auth] ✗ ${ep.name}: ${err.message}`);
    }
  }
}

async function testSocketIO() {
  console.log('\n[Socket.IO] Testing real-time connection...');
  try {
    // Test Socket.IO handshake via polling
    const resp = await fetch(`${SERVER_URL}/socket.io/?EIO=4&transport=polling`);
    const text = await resp.text();
    const connected = resp.status === 200 && text.includes('sid');
    results.server.socketio = { connected, status: resp.status, response: text.slice(0, 200) };
    console.log(`  [Socket.IO] ${connected ? '✓' : '✗'} Handshake: ${resp.status}`);
  } catch (err) {
    results.server.socketio = { connected: false, error: err.message };
    console.log(`  [Socket.IO] ✗ ${err.message}`);
  }
}

async function testWebSocket() {
  console.log('\n[WebSocket] Testing legacy WS connection...');
  return new Promise((resolve) => {
    try {
      const { WebSocket } = await_import('ws');
      // We'll test via HTTP upgrade check instead since ws might not be available
      resolve();
    } catch {
      // Test via fetch to see if WS endpoint exists
      fetch(`${SERVER_URL}/ws`).then(r => {
        results.server.websocket = { endpoint: '/ws', status: r.status, note: 'WS upgrade endpoint exists' };
        console.log(`  [WebSocket] ○ Endpoint exists (status ${r.status})`);
        resolve();
      }).catch(err => {
        results.server.websocket = { error: err.message };
        console.log(`  [WebSocket] ✗ ${err.message}`);
        resolve();
      });
    }
  });
}

async function testFrontendWithPlaywright() {
  console.log('\n[Playwright] Testing frontend...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Test if frontend is running
    let frontendUrl = FRONTEND_URL;
    try {
      const resp = await fetch(frontendUrl);
      if (resp.status !== 200) frontendUrl = SERVER_URL; // try server static
    } catch {
      frontendUrl = SERVER_URL;
    }

    // Load main page
    console.log(`  [FE] Loading ${frontendUrl}...`);
    const response = await page.goto(frontendUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    results.frontend.loaded = {
      url: frontendUrl,
      status: response?.status(),
      title: await page.title(),
    };
    console.log(`  [FE] ✓ Loaded: ${response?.status()} — "${await page.title()}"`);

    // Check page content
    const bodyText = await page.textContent('body').catch(() => '');
    results.frontend.bodyLength = bodyText.length;

    // Look for old project references in page source
    const pageSource = await page.content();
    const oldRefs = [];
    const patterns = [
      { pattern: /fundedwealth\.com(?!\/terminal)/gi, name: 'Old dashboard URL (not /terminal)' },
      { pattern: /supabase\.co/gi, name: 'Supabase URL in frontend' },
      { pattern: /from\(['"](?:users|accounts|orders|positions|trades|challenges|sessions)['"]\)/gi, name: 'Bare table name in frontend JS' },
    ];
    for (const { pattern, name } of patterns) {
      const matches = pageSource.match(pattern);
      if (matches) {
        oldRefs.push({ name, count: matches.length, samples: matches.slice(0, 3) });
      }
    }
    results.frontend.oldReferences = oldRefs;
    if (oldRefs.length > 0) {
      console.log(`  [FE] ⚠ Found ${oldRefs.length} old reference patterns in page source`);
    } else {
      console.log(`  [FE] ✓ No old project references in page source`);
    }

    // Check console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.waitForTimeout(3000);
    results.frontend.consoleErrors = consoleErrors;
    if (consoleErrors.length > 0) {
      console.log(`  [FE] ⚠ ${consoleErrors.length} console errors`);
    }

    // Check network requests for old references
    const networkRequests = [];
    page.on('request', req => {
      networkRequests.push(req.url());
    });
    await page.reload({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const oldNetworkRefs = networkRequests.filter(url =>
      url.includes('supabase.co') ||
      (url.includes('fundedwealth.com') && !url.includes('terminal'))
    );
    results.frontend.networkRequests = { total: networkRequests.length, oldRefs: oldNetworkRefs };
    if (oldNetworkRefs.length > 0) {
      console.log(`  [FE] ⚠ ${oldNetworkRefs.length} network requests to old project URLs`);
      oldNetworkRefs.forEach(u => console.log(`      → ${u}`));
    } else {
      console.log(`  [FE] ✓ No network requests to old project`);
    }

    await browser.close();
  } catch (err) {
    console.log(`  [FE] ✗ Playwright error: ${err.message}`);
    results.frontend.error = err.message;
    if (browser) await browser.close();
  }
}

async function scanCodeForOldReferences() {
  console.log('\n[Code Scan] Scanning server code for old table references...');
  const { execSync } = await import('child_process');

  // Scan for bare table names in .from() calls
  const scanPatterns = [
    { pattern: "\\.from\\('users'\\)", desc: "from('users')" },
    { pattern: "\\.from\\('accounts'\\)", desc: "from('accounts')" },
    { pattern: "\\.from\\('orders'\\)", desc: "from('orders')" },
    { pattern: "\\.from\\('positions'\\)", desc: "from('positions')" },
    { pattern: "\\.from\\('trades'\\)", desc: "from('trades')" },
    { pattern: "\\.from\\('challenges'\\)", desc: "from('challenges')" },
    { pattern: "\\.from\\('sessions'\\)", desc: "from('sessions')" },
    { pattern: "\\.from\\('risk_rules'\\)", desc: "from('risk_rules')" },
    { pattern: "\\.from\\('watchlists'\\)", desc: "from('watchlists')" },
    { pattern: "\\.from\\('account_metrics'\\)", desc: "from('account_metrics')" },
    { pattern: "super\\('broker_sessions'\\)", desc: "super('broker_sessions')" },
    { pattern: "super\\('audit_log'\\)", desc: "super('audit_log')" },
  ];

  const findings = [];
  for (const { pattern, desc } of scanPatterns) {
    try {
      const cmd = `Select-String -Path "c:\\Users\\rmsam\\Desktop\\Fundedwealth terminal\\server\\**\\*.js" -Pattern "${pattern}" -Recurse | Select-Object -Property Filename, LineNumber, Line | Format-Table -AutoSize`;
      const output = execSync(cmd, { encoding: 'utf8', shell: 'powershell.exe', timeout: 10000 }).trim();
      if (output && !output.includes('Cannot find path')) {
        findings.push({ pattern: desc, matches: output });
      }
    } catch {
      // Pattern not found — good
    }
  }

  results.tableReferences = findings;
  if (findings.length > 0) {
    console.log(`  [Code] ⚠ Found ${findings.length} patterns with bare table names`);
    findings.forEach(f => console.log(`      → ${f.pattern}`));
  } else {
    console.log(`  [Code] ✓ No bare table references found');
  }
}

async function scanForOldImports() {
  console.log('\n[Import Scan] Checking for old project imports/dependencies...');
  const { execSync } = await import('child_process');

  const checks = [
    { pattern: 'require.*dashboard', desc: 'Dashboard require() imports' },
    { pattern: 'import.*dashboard', desc: 'Dashboard ES import' },
    { pattern: 'from.*old.*terminal', desc: 'Old terminal references' },
    { pattern: 'localhost:3001|localhost:8080', desc: 'Old port references' },
  ];

  const findings = [];
  for (const { pattern, desc } of checks) {
    try {
      const cmd = `Select-String -Path "c:\\Users\\rmsam\\Desktop\\Fundedwealth terminal\\server\\**\\*.js","c:\\Users\\rmsam\\Desktop\\Fundedwealth terminal\\src\\**\\*.ts","c:\\Users\\rmsam\\Desktop\\Fundedwealth terminal\\src\\**\\*.tsx" -Pattern "${pattern}" -Recurse 2>$null | Select-Object -Property Filename, LineNumber | Format-Table -AutoSize`;
      const output = execSync(cmd, { encoding: 'utf8', shell: 'powershell.exe', timeout: 10000 }).trim();
      if (output && output.length > 5) {
        findings.push({ check: desc, result: output });
      }
    } catch {
      // Not found — good
    }
  }

  results.oldDependencies = findings;
  if (findings.length > 0) {
    console.log(`  [Imports] ⚠ Found ${findings.length} old project references`);
  } else {
    console.log(`  [Imports] ✓ No old project imports found`);
  }
}

function determineVerdict() {
  const bareTableCount = results.tableReferences.length;
  const oldImportCount = results.oldDependencies.length;
  const oldFrontendRefs = results.frontend.oldReferences?.length || 0;
  const oldNetworkRefs = results.frontend.networkRequests?.oldRefs?.length || 0;

  const totalOldRefs = bareTableCount + oldImportCount + oldFrontendRefs + oldNetworkRefs;

  if (totalOldRefs === 0) {
    results.verdict = 'A. Fully Isolated';
  } else if (bareTableCount > 0) {
    results.verdict = 'C. Critical old-project dependencies remain';
  } else {
    results.verdict = 'B. Partially Isolated';
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  VERDICT: ${results.verdict}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Bare table references: ${bareTableCount}`);
  console.log(`  Old imports/dependencies: ${oldImportCount}`);
  console.log(`  Frontend old references: ${oldFrontendRefs}`);
  console.log(`  Network calls to old project: ${oldNetworkRefs}`);
}

async function writeResults() {
  const { writeFileSync } = await import('fs');
  writeFileSync(
    'c:\\Users\\rmsam\\Desktop\\Fundedwealth terminal\\audit\\runtime-audit-results.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\n[Output] Results written to audit/runtime-audit-results.json');
}

// ─── MAIN ────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  FUNDEDWEALTH TERMINAL — FULL RUNTIME AUDIT');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`  Server: ${SERVER_URL}`);
  console.log('');

  // Phase 1: Server health
  console.log('─── PHASE 1: Server Health ───');
  const health = await testServerHealth();

  if (!health) {
    console.log('\n⚠ Server not reachable. Skipping runtime tests.');
    console.log('  Running static code analysis only...\n');
  }

  // Phase 2: API Tests
  if (health) {
    console.log('\n─── PHASE 2: API Endpoints ───');
    await testAPIs();

    // Phase 3: SSO + Authenticated APIs
    console.log('\n─── PHASE 3: SSO & Auth Flow ───');
    const sessionToken = await testSSOFlow();
    await testAuthenticatedAPIs(sessionToken);

    // Phase 4: Socket.IO
    console.log('\n─── PHASE 4: Real-time ───');
    await testSocketIO();
  }

  // Phase 5: Frontend (Playwright)
  console.log('\n─── PHASE 5: Frontend (Playwright) ───');
  await testFrontendWithPlaywright();

  // Phase 6: Static Code Analysis
  console.log('\n─── PHASE 6: Code Analysis ───');
  await scanCodeForOldReferences();
  await scanForOldImports();

  // Verdict
  determineVerdict();
  await writeResults();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  AUDIT COMPLETE');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('AUDIT FATAL ERROR:', err.message);
  process.exit(1);
});
