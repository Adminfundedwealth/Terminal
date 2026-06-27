/**
 * LIVE DATA AUDIT — Playwright browser inspection
 * Captures: network requests, console logs, API responses, screenshot
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const FRONTEND = 'http://localhost:3000';
const SERVER = 'http://localhost:4000';

const results = {
  timestamp: new Date().toISOString(),
  network: { failed: [], responses: [], api: {} },
  console: [],
  ws: [],
  screenshot: null,
};

async function main() {
  console.log('=== LIVE DATA AUDIT (Playwright) ===\n');

  // 1. Server-side data probes
  console.log('[1] Server-side data probes...');
  const probes = {};

  // Chart data
  const chartRes = await fetch(`${SERVER}/api/market/history?token=99926000&tf=5`);
  const chartData = await chartRes.json();
  probes.chart = {
    endpoint: '/api/market/history?token=99926000&tf=5',
    status: chartRes.status,
    candleCount: chartData.length,
    lastCandle: chartData.length > 0 ? chartData[chartData.length - 1] : null,
    firstCandle: chartData.length > 0 ? chartData[0] : null,
  };
  console.log(`  Chart: ${chartData.length} candles, last=${JSON.stringify(probes.chart.lastCandle)}`);

  // Option chain
  const expRes = await fetch(`${SERVER}/api/market/expiries?symbol=NIFTY`);
  const expiries = await expRes.json();
  const ocRes = await fetch(`${SERVER}/api/market/option-chain?symbol=NIFTY&expiry=${expiries[0]}`);
  const ocData = await ocRes.json();
  probes.optionChain = {
    endpoint: `/api/market/option-chain?symbol=NIFTY&expiry=${expiries[0]}`,
    status: ocRes.status,
    expiry: expiries[0],
    allExpiries: expiries,
    strikeCount: ocData.length,
    ceCount: ocData.filter(e => e.callLtp > 0).length,
    peCount: ocData.filter(e => e.putLtp > 0).length,
    sample: ocData.length > 0 ? ocData[0] : null,
  };
  console.log(`  Option Chain: ${ocData.length} strikes, expiry=${expiries[0]}`);

  // Market depth (index vs stock)
  const depthIdx = await (await fetch(`${SERVER}/api/market/depth?token=99926000`)).json();
  const depthStock = await (await fetch(`${SERVER}/api/market/depth?token=2885&exchange=NSE`)).json();
  probes.depth = {
    index: { endpoint: '/api/market/depth?token=99926000', bids: depthIdx.bids.length, asks: depthIdx.asks.length, totalBuyQty: depthIdx.totalBuyQty },
    stock: { endpoint: '/api/market/depth?token=2885', bids: depthStock.bids.length, asks: depthStock.asks.length, totalBuyQty: depthStock.totalBuyQty, sample: depthStock.bids[0] },
  };
  console.log(`  Depth (NIFTY): ${depthIdx.bids.length} bids, ${depthIdx.asks.length} asks`);
  console.log(`  Depth (RELIANCE): ${depthStock.bids.length} bids, ${depthStock.asks.length} asks`);

  // Live market status
  const liveRes = await fetch(`${SERVER}/api/market/live`);
  const liveData = await liveRes.json();
  probes.feed = {
    connected: liveData.feed.connected,
    subscribedTokens: liveData.feed.subscribedTokens,
    tickCount: liveData.feed.tickCount,
    symbolCount: Object.keys(liveData.symbols).length,
    sampleQuote: Object.entries(liveData.symbols)[0],
  };
  console.log(`  Feed: connected=${liveData.feed.connected}, ticks=${liveData.feed.tickCount}, symbols=${Object.keys(liveData.symbols).length}`);

  results.network.api = probes;

  // 2. Playwright browser audit
  console.log('\n[2] Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Track all network requests
  const networkLog = [];
  page.on('request', req => {
    networkLog.push({ url: req.url(), method: req.method(), time: Date.now() });
  });
  page.on('response', resp => {
    const entry = networkLog.find(n => n.url === resp.url());
    if (entry) { entry.status = resp.status(); entry.contentType = resp.headers()['content-type']; }
  });
  page.on('requestfailed', req => {
    results.network.failed.push({ url: req.url(), method: req.method(), error: req.failure()?.errorText });
  });
  page.on('console', msg => {
    results.console.push({ type: msg.type(), text: msg.text().substring(0, 200) });
  });

  // Authenticate via SSO
  console.log('  Authenticating via SSO...');
  const ssoRes = await fetch(`${SERVER}/auth/dev/generate-sso`);
  const ssoData = await ssoRes.json();
  await page.goto(`${FRONTEND}/auth/sso?token=${encodeURIComponent(ssoData.ssoToken)}`, { waitUntil: 'networkidle', timeout: 20000 });
  console.log(`  Page URL: ${page.url()}`);

  // Wait for terminal to render
  await page.waitForTimeout(5000);

  // Screenshot
  await page.screenshot({ path: 'audit/live-data-screenshot.png', fullPage: false });
  console.log('  Screenshot saved: audit/live-data-screenshot.png');

  // 3. Check chart state
  console.log('\n[3] Checking chart rendering...');
  const chartState = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { hasCanvas: false };
    return {
      hasCanvas: true,
      width: canvas.width,
      height: canvas.height,
      hasPixelData: canvas.getContext('2d')?.getImageData(100, 100, 1, 1).data[3] > 0,
    };
  });
  console.log(`  Canvas: ${chartState.hasCanvas ? `${chartState.width}x${chartState.height}, painted=${chartState.hasPixelData}` : 'NOT FOUND'}`);

  // 4. Check market store state
  console.log('\n[4] Checking React market store...');
  const storeState = await page.evaluate(() => {
    // Access zustand store via its internal state
    try {
      const marketStore = window.__zustand_market_store || null;
      // Try reading from DOM what data is visible
      const priceEls = document.querySelectorAll('[class*="tabular-nums"]');
      const prices = Array.from(priceEls).slice(0, 5).map(el => el.textContent);
      const watchlistItems = document.querySelectorAll('[class*="watchlist"] [class*="cursor-pointer"], [draggable="true"]');
      return {
        priceElements: prices,
        watchlistRows: watchlistItems.length,
        bodyText: document.body.innerText.substring(0, 500),
      };
    } catch(e) { return { error: e.message }; }
  });
  console.log(`  Watchlist rows: ${storeState.watchlistRows}`);
  console.log(`  Price elements: ${JSON.stringify(storeState.priceElements)}`);

  // 5. Check WebSocket connections
  console.log('\n[5] WebSocket analysis...');
  const wsState = await page.evaluate(() => {
    const perf = performance.getEntriesByType('resource');
    const wsEntries = perf.filter(e => e.name.includes('/ws') || e.name.includes('socket.io'));
    return { wsResources: wsEntries.map(e => ({ name: e.name, duration: e.duration })) };
  });
  console.log(`  WS resources: ${wsState.wsResources.length}`);

  // 6. Examine network requests for /api calls
  console.log('\n[6] API network requests from browser...');
  const apiRequests = networkLog.filter(n => n.url.includes('/api/') || n.url.includes('/auth/'));
  for (const req of apiRequests.slice(0, 15)) {
    console.log(`  ${req.method} ${new URL(req.url).pathname} → ${req.status || 'pending'}`);
  }
  results.network.responses = apiRequests;

  // Failed and empty
  const failed = networkLog.filter(n => n.status >= 400);
  const empty = networkLog.filter(n => n.status === 200 && n.url.includes('/api/'));
  console.log(`\n  Failed requests (4xx/5xx): ${failed.length}`);
  for (const f of failed) console.log(`    ${f.method} ${new URL(f.url).pathname} → ${f.status}`);

  await browser.close();

  // 7. Write results
  writeFileSync('audit/live-data-audit-results.json', JSON.stringify(results, null, 2));
  console.log('\n=== AUDIT COMPLETE ===');
  console.log('Results: audit/live-data-audit-results.json');
  console.log('Screenshot: audit/live-data-screenshot.png');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e); process.exit(1); });
