import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const SCREENSHOTS_DIR = './audit/screenshots';

async function main() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);

  console.log('[Audit] Opening terminal at http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // 1. Full terminal screenshot
  console.log('[Audit] 1/11 Full terminal...');
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-full-terminal.png` });

  // 2. Open search modal
  console.log('[Audit] 2/11 Search modal...');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-search-modal.png` });

  // 3. Search RELIANCE
  console.log('[Audit] 3/11 Search results...');
  await page.keyboard.type('RELIANCE', { delay: 50 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-search-results.png` });

  // Select first result via Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // 4. Chart loaded
  console.log('[Audit] 4/11 Chart with symbol...');
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-chart-loaded.png` });

  // 5. Watchlist test
  console.log('[Audit] 5/11 Watchlist...');
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-watchlist.png` });

  // 6. Option Chain - click the OC text button in top bar
  console.log('[Audit] 6/11 Option Chain...');
  try {
    // The OC button is in the header bar
    const ocBtn = page.getByRole('button', { name: 'OC' });
    await ocBtn.click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-option-chain.png` });
    // Close
    await ocBtn.click({ timeout: 3000 });
    await page.waitForTimeout(500);
  } catch (e) {
    console.log('  [WARN] OC button not found or click failed:', e.message?.slice(0, 80));
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-option-chain-error.png` });
  }

  // 7. Market Depth
  console.log('[Audit] 7/11 Market Depth...');
  try {
    const domBtn = page.getByRole('button', { name: 'DOM' });
    await domBtn.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-market-depth.png` });
  } catch (e) {
    console.log('  [WARN] DOM button issue:', e.message?.slice(0, 80));
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-market-depth-error.png` });
  }

  // 8. Order Panel (always visible on right side)
  console.log('[Audit] 8/11 Order Panel...');
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/08-order-panel.png` });

  // 9. Positions
  console.log('[Audit] 9/11 Positions...');
  try {
    await page.getByRole('button', { name: /Positions/ }).click({ timeout: 3000 });
    await page.waitForTimeout(500);
  } catch (e) { /* may already be selected */ }
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/09-positions.png` });

  // 10. Orders
  console.log('[Audit] 10/11 Orders...');
  try {
    await page.getByRole('button', { name: /^Orders/ }).click({ timeout: 3000 });
    await page.waitForTimeout(500);
  } catch (e) {}
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/10-orders.png` });

  // 11. Trade Book
  console.log('[Audit] 11/11 Trade Book...');
  try {
    await page.getByRole('button', { name: /Trade Book/ }).click({ timeout: 3000 });
    await page.waitForTimeout(500);
  } catch (e) {}
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/11-trade-book.png` });

  // ===== API ENDPOINT AUDIT =====
  console.log('\n========== API ENDPOINT AUDIT ==========');
  const endpoints = [
    { url: '/api/account', desc: 'Account Info' },
    { url: '/api/positions', desc: 'Positions' },
    { url: '/api/orders', desc: 'Orders' },
    { url: '/api/trades', desc: 'Trades' },
    { url: '/api/instruments/search?q=nifty', desc: 'Instrument Search' },
    { url: '/api/market/history?token=2885&tf=5', desc: 'Historical OHLC' },
    { url: '/api/market/depth?token=2885', desc: 'Market Depth' },
    { url: '/api/market/option-chain?symbol=NIFTY&expiry=2026-06-25', desc: 'Option Chain' },
    { url: '/api/market/expiries?symbol=NIFTY', desc: 'Expiries' },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const data = await res.json();
        return {
          status: res.status,
          type: Array.isArray(data) ? `array[${data.length}]` : `object{${Object.keys(data).length} keys}`,
          sample: JSON.stringify(data).slice(0, 150)
        };
      }, ep.url);
      console.log(`  [${ep.desc}] ${ep.url}`);
      console.log(`    HTTP ${resp.status} | ${resp.type}`);
      console.log(`    ${resp.sample}`);
    } catch (e) {
      console.log(`  [${ep.desc}] ERROR: ${e.message?.slice(0, 80)}`);
    }
  }

  // ===== WEBSOCKET AUDIT =====
  console.log('\n========== WEBSOCKET AUDIT ==========');
  const wsResult = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://${window.location.host}/ws`);
      const messages = [];
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', tokens: ['2885', '99926000'] }));
      };
      ws.onmessage = (e) => {
        messages.push(JSON.parse(e.data));
        if (messages.length >= 5) {
          ws.close();
          resolve({
            connected: true,
            count: messages.length,
            types: [...new Set(messages.map(m => m.type))],
            samples: messages.slice(0, 3).map(m => JSON.stringify(m).slice(0, 200))
          });
        }
      };
      ws.onerror = () => resolve({ connected: false });
      setTimeout(() => {
        ws.close();
        resolve({
          connected: messages.length > 0,
          count: messages.length,
          types: [...new Set(messages.map(m => m.type))],
          samples: messages.slice(0, 3).map(m => JSON.stringify(m).slice(0, 200))
        });
      }, 5000);
    });
  });
  console.log('  Connected:', wsResult.connected);
  console.log('  Messages received:', wsResult.count);
  console.log('  Message types:', wsResult.types?.join(', '));
  wsResult.samples?.forEach((s, i) => console.log(`  Sample ${i + 1}: ${s}`));

  await browser.close();
  console.log('\n[Audit] Complete.');
}

main().catch((e) => {
  console.error('[Audit] FATAL:', e.message);
  process.exit(1);
});
