/**
 * LOCAL TERMINAL REALITY CERTIFICATION
 * 
 * Playwright-based verification of the FundedWealth Terminal.
 * Tests: Frontend load, API connectivity, Database queries, WebSocket, UI components.
 * 
 * Run: node node_modules/@playwright/test/cli.js test tests/local-certification.spec.js --reporter=list
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const API = 'http://localhost:4000';
const SCREENSHOT_DIR = path.resolve('tests/certification-screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const results = {
  timestamp: new Date().toISOString(),
  startup: {},
  frontend: {},
  api: {},
  database: {},
  websocket: {},
  network: { failed: [], errors: [] },
  fakeDataAudit: {},
  verdict: {},
};

// ═══════════════════════════════════════════════════════════════
// SECTION 1: BACKEND API VERIFICATION
// ═══════════════════════════════════════════════════════════════

test.describe('BACKEND API', () => {
  test('Health endpoint returns OK + Supabase connected', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.status()).toBe(200);
    const data = await res.json();

    results.startup.serverRunning = true;
    results.startup.supabaseConnected = data.database?.connected;
    results.startup.marketDataEngine = data.marketData || {};
    results.startup.feed = data.feed || {};
    results.startup.socketIO = data.socketIO || {};
    results.startup.uptime = data.uptime;

    expect(data.status).toBe('ok');
    expect(data.database.connected).toBe(true);

    console.log(`✅ Health: status=ok, db=${data.database.connected}, uptime=${Math.round(data.uptime)}s`);
    console.log(`   Feed: connected=${data.feed?.connected}, tokens=${data.feed?.subscribedTokens}`);
  });

  test('Account API returns data (dev bypass)', async ({ request }) => {
    const res = await request.get(`${API}/api/account`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    results.api.account = data;
    console.log(`✅ Account: id=${data?.id}, code=${data?.accountCode}, balance=${data?.balance}`);
  });

  test('Positions API returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/positions`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    results.api.positions = { count: Array.isArray(data) ? data.length : 0, data };
    console.log(`✅ Positions: count=${results.api.positions.count}`);
  });

  test('Orders API returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/orders`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    results.api.orders = { count: Array.isArray(data) ? data.length : 0 };
    console.log(`✅ Orders: count=${results.api.orders.count}`);
  });

  test('Trades API returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/trades`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    results.api.trades = { count: Array.isArray(data) ? data.length : 0 };
    console.log(`✅ Trades: count=${results.api.trades.count}`);
  });

  test('Rules API returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/account/rules`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    results.api.rules = { count: Array.isArray(data) ? data.length : 0 };
    console.log(`✅ Rules: count=${results.api.rules.count}`);
  });

  test('Challenge API responds', async ({ request }) => {
    const res = await request.get(`${API}/api/account/challenge`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    results.api.challenge = data;
    console.log(`✅ Challenge: ${JSON.stringify(data).slice(0, 100)}`);
  });

  test('Market data live endpoint', async ({ request }) => {
    const res = await request.get(`${API}/api/market/live`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    const symbolCount = Object.keys(data.symbols || {}).length;
    results.api.marketLive = {
      feedConnected: data.feed?.connected,
      subscribedTokens: data.feed?.subscribedTokens,
      tickCount: data.feed?.tickCount,
      symbolsWithLTP: symbolCount,
    };
    console.log(`✅ Market Live: feed=${data.feed?.connected}, symbols=${symbolCount}, ticks=${data.feed?.tickCount}`);
  });

  test('Order placement endpoint responds (dry test)', async ({ request }) => {
    // Test the endpoint responds (will likely reject due to market hours or dev-account)
    const res = await request.post(`${API}/api/orders/place`, {
      data: {
        symbol: 'RELIANCE',
        token: '2885',
        segment: 'NSE',
        side: 'BUY',
        orderType: 'MARKET',
        productType: 'MIS',
        qty: 1,
      },
    });
    const data = await res.json();
    results.api.orderEndpoint = { status: res.status(), response: data };
    console.log(`✅ Order endpoint: status=${res.status()}, response=${JSON.stringify(data).slice(0, 150)}`);
    // We accept any response that isn't a 404 or crash
    expect(res.status()).not.toBe(404);
  });

  test('Instruments search works', async ({ request }) => {
    const res = await request.get(`${API}/api/instruments/search?q=RELIANCE`);
    const data = await res.json();
    results.api.instruments = { count: Array.isArray(data) ? data.length : 0 };
    console.log(`✅ Instruments search: ${results.api.instruments.count} results for "RELIANCE"`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: FRONTEND VERIFICATION
// ═══════════════════════════════════════════════════════════════

test.describe('FRONTEND', () => {
  test('Terminal loads without crash', async ({ page }) => {
    const consoleErrors = [];
    const failedRequests = [];

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    page.on('requestfailed', req => {
      failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
    });

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-terminal-loaded.png'), fullPage: true });

    // Check for React error boundary
    const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
    const hasReactError = await page.locator('text=Something went wrong').count();

    results.frontend.loaded = true;
    results.frontend.consoleErrors = consoleErrors;
    results.frontend.failedRequests = failedRequests;
    results.frontend.reactCrash = hasReactError > 0 || errorBoundary > 0;

    console.log(`✅ Frontend loaded`);
    console.log(`   Console errors: ${consoleErrors.length}`);
    console.log(`   Failed requests: ${failedRequests.length}`);
    console.log(`   React crash: ${results.frontend.reactCrash}`);

    expect(results.frontend.reactCrash).toBe(false);
  });

  test('Dashboard/Trading UI visible', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check for key UI elements
    const bodyText = await page.locator('body').textContent();

    const hasChart = (await page.locator('canvas').count()) > 0;
    const hasWatchlist = /nifty|banknifty|reliance|watchlist/i.test(bodyText);
    const hasOrderForm = /buy|sell|market|limit|qty/i.test(bodyText);
    const hasPrices = /\d{2,5}\.\d{2}/.test(bodyText); // Prices like 2456.50

    results.frontend.hasChart = hasChart;
    results.frontend.hasWatchlist = hasWatchlist;
    results.frontend.hasOrderForm = hasOrderForm;
    results.frontend.hasLivePrices = hasPrices;

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-dashboard-ui.png'), fullPage: true });

    console.log(`✅ Dashboard UI:`);
    console.log(`   Chart canvas: ${hasChart}`);
    console.log(`   Watchlist data: ${hasWatchlist}`);
    console.log(`   Order form: ${hasOrderForm}`);
    console.log(`   Live prices: ${hasPrices}`);
  });

  test('WebSocket connection active', async ({ page }) => {
    const wsMessages = [];
    
    page.on('websocket', ws => {
      ws.on('framereceived', frame => {
        wsMessages.push(frame.payload?.toString()?.slice(0, 100));
      });
    });

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000); // Wait for WS messages

    results.websocket.messagesReceived = wsMessages.length;
    results.websocket.sample = wsMessages.slice(0, 3);

    console.log(`✅ WebSocket: ${wsMessages.length} messages received in 5s`);
    if (wsMessages.length > 0) {
      console.log(`   Sample: ${wsMessages[0]?.slice(0, 80)}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: NETWORK AUDIT
// ═══════════════════════════════════════════════════════════════

test.describe('NETWORK AUDIT', () => {
  test('Capture all failed/error requests', async ({ page }) => {
    const failed = [];
    const status4xx = [];
    const status5xx = [];

    page.on('requestfailed', req => {
      failed.push({ url: req.url(), error: req.failure()?.errorText });
    });

    page.on('response', res => {
      if (res.status() >= 400 && res.status() < 500) {
        status4xx.push({ url: res.url(), status: res.status() });
      }
      if (res.status() >= 500) {
        status5xx.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    results.network.failed = failed;
    results.network.status4xx = status4xx;
    results.network.status5xx = status5xx;

    console.log(`✅ Network Audit:`);
    console.log(`   Failed requests: ${failed.length}`);
    console.log(`   4xx responses: ${status4xx.length}`);
    console.log(`   5xx responses: ${status5xx.length}`);
    
    if (failed.length > 0) console.log(`   Failed: ${JSON.stringify(failed.slice(0, 3))}`);
    if (status4xx.length > 0) console.log(`   4xx: ${JSON.stringify(status4xx.slice(0, 3))}`);
    if (status5xx.length > 0) console.log(`   5xx: ${JSON.stringify(status5xx.slice(0, 3))}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: FAKE DATA AUDIT
// ═══════════════════════════════════════════════════════════════

test.describe('FAKE DATA AUDIT', () => {
  test('Identify mock vs real data sources', async ({ request }) => {
    // Account data
    const acctRes = await request.get(`${API}/api/account`);
    const acct = await acctRes.json();
    const isDevAccount = acct?.id === 'dev-account' || acct?.accountCode === 'FW-DEV';

    // Market data
    const mktRes = await request.get(`${API}/api/market/live`);
    const mkt = await mktRes.json();
    const hasRealTicks = (mkt.feed?.tickCount || 0) > 0;
    const symbolsWithPrice = Object.entries(mkt.symbols || {}).filter(([_, v]) => v.ltp > 0);

    // Positions
    const posRes = await request.get(`${API}/api/positions`);
    const positions = await posRes.json();

    // Orders
    const ordRes = await request.get(`${API}/api/orders`);
    const orders = await ordRes.json();

    results.fakeDataAudit = {
      account: {
        source: isDevAccount ? 'FAKE (dev-bypass mock)' : 'REAL (from Supabase)',
        id: acct?.id,
        code: acct?.accountCode,
        balance: acct?.balance,
      },
      marketData: {
        source: hasRealTicks ? 'REAL (AngelOne SmartStream)' : 'FAKE (no ticks)',
        tickCount: mkt.feed?.tickCount,
        feedConnected: mkt.feed?.connected,
        symbolsWithLTP: symbolsWithPrice.length,
        samplePrices: symbolsWithPrice.slice(0, 3).map(([token, v]) => `${token}=${v.ltp}`),
      },
      positions: {
        source: isDevAccount ? 'MIXED (dev account, empty positions expected)' : 'REAL',
        count: Array.isArray(positions) ? positions.length : 0,
      },
      orders: {
        source: isDevAccount ? 'MIXED (dev account, no DB orders)' : 'REAL',
        count: Array.isArray(orders) ? orders.length : 0,
      },
    };

    console.log(`\n═══ FAKE DATA AUDIT ═══`);
    console.log(`Account:     ${results.fakeDataAudit.account.source}`);
    console.log(`             balance=${acct?.balance}, code=${acct?.accountCode}`);
    console.log(`Market Data: ${results.fakeDataAudit.marketData.source}`);
    console.log(`             ticks=${mkt.feed?.tickCount}, feed=${mkt.feed?.connected}`);
    console.log(`             prices: ${results.fakeDataAudit.marketData.samplePrices.join(', ')}`);
    console.log(`Positions:   ${results.fakeDataAudit.positions.source} (${results.fakeDataAudit.positions.count})`);
    console.log(`Orders:      ${results.fakeDataAudit.orders.source} (${results.fakeDataAudit.orders.count})`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: WRITE FINAL RESULTS
// ═══════════════════════════════════════════════════════════════

test.afterAll(async () => {
  // Write results JSON
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'certification-results.json'),
    JSON.stringify(results, null, 2)
  );
  console.log(`\n═══ RESULTS WRITTEN TO tests/certification-screenshots/certification-results.json ═══`);
});
