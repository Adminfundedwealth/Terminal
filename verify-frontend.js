import { chromium } from 'playwright';
import fs from 'fs';

const FRONTEND = 'http://127.0.0.1:3000';
const DIR = 'c:/Users/rmsam/Desktop/Fundedwealth terminal/audit/frontend-verify';
fs.mkdirSync(DIR, { recursive: true });

async function main() {
  console.log('=== DEV AUTH BYPASS VERIFICATION ===\n');

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().substring(0, 200)); });

  // Load terminal — NO cookie, NO auth token
  console.log('1. Loading http://localhost:3000 (no auth)...');
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(5000);

  // Check if we got redirected
  const currentUrl = page.url();
  const redirected = currentUrl.includes('fundedwealth.com');
  console.log(`   Current URL: ${currentUrl}`);
  console.log(`   Redirected to dashboard: ${redirected}`);

  if (redirected) {
    console.log('\n   ✗ STILL REDIRECTING — fix did not work');
    await browser.close();
    process.exit(1);
  }

  console.log('   ✓ No redirect — terminal loaded locally');
  await page.screenshot({ path: `${DIR}/01-terminal-no-redirect.png` });

  // 2. Components
  console.log('\n2. Components...');
  const bodyText = await page.evaluate(() => document.body.innerText);
  const canvasCount = (await page.$$('canvas')).length;

  const watchlist = /INDEX|STOCKS|FUTURES|MCX|CDS/i.test(bodyText);
  const chart = canvasCount > 0;
  const orderPanel = /BUY|SELL|MARKET|LIMIT/i.test(bodyText);
  const positions = /position/i.test(bodyText);
  const orders = /order/i.test(bodyText);
  const trades = /trade/i.test(bodyText);

  console.log(`   Watchlist: ${watchlist}`);
  console.log(`   Chart (${canvasCount} canvases): ${chart}`);
  console.log(`   Order panel: ${orderPanel}`);
  console.log(`   Positions: ${positions}`);
  console.log(`   Orders: ${orders}`);
  console.log(`   Trades: ${trades}`);

  await page.screenshot({ path: `${DIR}/02-full-terminal.png` });

  // 3. Live data
  console.log('\n3. Live data...');
  const account = await page.evaluate(() => fetch('/api/account').then(r=>r.json()).catch(()=>null));
  console.log(`   Account: ${account?.accountCode} balance=${account?.balance}`);

  const hist = await page.evaluate(() => fetch('/api/market/history?token=99926000&tf=5').then(r=>r.json()).then(d=>d.length).catch(()=>0));
  console.log(`   NIFTY candles: ${hist}`);

  const nifty = await page.evaluate(() => fetch('/api/market/quote?token=99926000').then(r=>r.json()).catch(()=>null));
  console.log(`   NIFTY LTP: ${nifty?.ltp || 'N/A'}`);

  const bnf = await page.evaluate(() => fetch('/api/market/quote?token=99926009').then(r=>r.json()).catch(()=>null));
  console.log(`   BANKNIFTY LTP: ${bnf?.ltp || 'N/A'}`);

  // 4. Errors
  console.log('\n4. Errors...');
  console.log(`   Console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 3).forEach(e => console.log(`     ${e}`));

  await page.screenshot({ path: `${DIR}/03-final.png` });
  await browser.close();

  console.log('\n══════════════════════════════════════');
  console.log('Frontend: http://localhost:3000');
  console.log('Backend:  http://localhost:4000');
  console.log('══════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
