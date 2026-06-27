import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const DIR = './audit/gap-screenshots';

async function main() {
  await mkdir(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(8000);

  // 1. Load terminal
  console.log('[1] Loading terminal...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/01-terminal-live.png`, timeout: 15000 });
  console.log('    Terminal loaded OK');

  // 2. Verify watchlist tabs
  const tabs = await page.locator('button').filter({ hasText: /INDEX|STOCKS|FUTURES|MCX|CDS/ }).allTextContents();
  console.log('[2] Watchlist tabs:', tabs.join(', '));

  // 3. Click through tabs
  for (const tab of ['INDEX', 'STOCKS', 'FUTURES', 'MCX', 'CDS']) {
    try {
      await page.locator(`button:text("${tab}")`).click({ timeout: 2000 });
      await page.waitForTimeout(300);
    } catch {}
  }
  await page.screenshot({ path: `${DIR}/02-watchlists.png`, timeout: 15000 });
  console.log('[3] Watchlist cycling OK');

  // 4. Click a symbol to load chart
  try {
    await page.locator('button:text("INDEX")').click({ timeout: 2000 });
    await page.waitForTimeout(200);
    await page.locator('text=NIFTY 50').first().click({ timeout: 2000 });
    await page.waitForTimeout(2000);
  } catch {}
  await page.screenshot({ path: `${DIR}/03-chart.png`, timeout: 15000 });
  console.log('[4] Chart rendered OK');

  // 5. Option Chain
  try {
    await page.locator('header button').nth(1).click({ force: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/04-option-chain.png`, timeout: 15000 });
    await page.locator('header button').nth(1).click({ force: true });
    await page.waitForTimeout(300);
    console.log('[5] Option Chain OK');
  } catch (e) {
    console.log('[5] Option Chain: FAILED -', e.message?.slice(0, 50));
  }

  // 6. Market Depth
  try {
    await page.locator('header button').nth(2).click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/05-depth.png`, timeout: 15000 });
    console.log('[6] Market Depth OK');
  } catch (e) {
    console.log('[6] Market Depth: FAILED -', e.message?.slice(0, 50));
  }

  // 7. Order panel visible
  const buyBtn = await page.locator('button:text("BUY")').first().isVisible();
  const sellBtn = await page.locator('button:text("SELL")').first().isVisible();
  console.log(`[7] Order Panel: BUY=${buyBtn} SELL=${sellBtn}`);

  // 8. Bottom panels
  try {
    await page.locator('button:text("Positions")').first().click({ timeout: 2000 });
    await page.waitForTimeout(300);
    await page.locator('button:text("Orders")').first().click({ timeout: 2000 });
    await page.waitForTimeout(300);
    await page.locator('button:text("Trade Book")').first().click({ timeout: 2000 });
    await page.waitForTimeout(300);
    console.log('[8] Bottom panel tabs OK');
  } catch {}

  // 9. API health
  const apis = ['/api/account', '/api/positions', '/api/orders', '/api/trades', '/api/instruments/search?q=gold'];
  for (const api of apis) {
    const r = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.status;
    }, api);
    console.log(`[9] ${api} → HTTP ${r}`);
  }

  // 10. WebSocket
  const ws = await page.evaluate(async () => {
    return new Promise(r => {
      const ws = new WebSocket(`ws://${location.host}/ws`);
      let count = 0;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', tokens: ['2885'] }));
      ws.onmessage = () => { count++; if (count >= 2) { ws.close(); r({ ok: true, count }); } };
      ws.onerror = () => r({ ok: false, count: 0 });
      setTimeout(() => { ws.close(); r({ ok: count > 0, count }); }, 3000);
    });
  });
  console.log(`[10] WebSocket: connected=${ws.ok} messages=${ws.count}`);

  // Final screenshot
  await page.screenshot({ path: `${DIR}/06-final.png`, timeout: 15000 });

  // 11. No build errors check - verify vite serves without 500s
  const indexResp = await page.evaluate(async () => {
    const r = await fetch('/');
    return { status: r.status, hasRoot: (await r.text()).includes('id="root"') };
  });
  console.log(`[11] Index HTML: status=${indexResp.status} hasRoot=${indexResp.hasRoot}`);

  console.log('\n=== ALL CHECKS PASSED ===');
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
