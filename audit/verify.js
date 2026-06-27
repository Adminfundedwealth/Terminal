import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const DIR = './audit/screenshots-v2';

async function main() {
  await mkdir(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(6000);

  console.log('Opening http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // 1. Full terminal with branding
  console.log('1. Full terminal with FundedWealth branding');
  await page.screenshot({ path: `${DIR}/01-terminal-branding.png`, timeout: 15000 });

  // 2. Verify watchlist shows populated items (INDEX tab should have NIFTY etc)
  console.log('2. Watchlist with pre-populated symbols');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/02-watchlist-index.png` });

  // 3. Click STOCKS tab
  console.log('3. STOCKS watchlist');
  try {
    await page.locator('button:text("STOCKS")').click();
    await page.waitForTimeout(500);
  } catch (e) { console.log('  stocks tab click failed'); }
  await page.screenshot({ path: `${DIR}/03-watchlist-stocks.png` });

  // 4. Click FUTURES tab
  console.log('4. FUTURES watchlist');
  try {
    await page.locator('button:text("FUTURES")').click();
    await page.waitForTimeout(500);
  } catch (e) { console.log('  futures tab click failed'); }
  await page.screenshot({ path: `${DIR}/04-watchlist-futures.png` });

  // 5. Click MCX tab
  console.log('5. MCX (Commodities) watchlist');
  try {
    await page.locator('button:text("MCX")').click();
    await page.waitForTimeout(500);
  } catch (e) { console.log('  mcx tab click failed'); }
  await page.screenshot({ path: `${DIR}/05-watchlist-mcx.png` });

  // 6. Click CDS tab
  console.log('6. CDS (Currency) watchlist');
  try {
    await page.locator('button:text("CDS")').click();
    await page.waitForTimeout(500);
  } catch (e) { console.log('  cds tab click failed'); }
  await page.screenshot({ path: `${DIR}/06-watchlist-cds.png` });

  // 7. Click on NIFTY from INDEX tab to load chart
  console.log('7. Load chart - clicking NIFTY from INDEX');
  try {
    await page.locator('button:text("INDEX")').click();
    await page.waitForTimeout(300);
    await page.locator('text=NIFTY 50').first().click();
    await page.waitForTimeout(2000);
  } catch (e) { console.log('  nifty click failed, trying search'); }
  await page.screenshot({ path: `${DIR}/07-chart-loaded.png` });

  // 8. Open Option Chain via OC button in top bar
  console.log('8. Option Chain');
  try {
    const ocBtn = page.locator('header button').nth(1);
    await ocBtn.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/08-option-chain.png` });
    // Close it
    await ocBtn.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(500);
  } catch (e) {
    console.log('  OC button failed:', e.message?.slice(0, 60));
    await page.screenshot({ path: `${DIR}/08-option-chain-fallback.png` });
  }

  // 9. Market Depth via DOM button
  console.log('9. Market Depth');
  try {
    const domBtn = page.locator('header button').nth(2);
    await domBtn.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/09-market-depth.png` });
  } catch (e) {
    console.log('  DOM button failed:', e.message?.slice(0, 60));
    await page.screenshot({ path: `${DIR}/09-market-depth-fallback.png` });
  }

  // 10. Order Panel (always visible)
  console.log('10. Order Panel');
  await page.screenshot({ path: `${DIR}/10-order-panel.png` });

  // 11. Positions tab
  console.log('11. Positions');
  try { await page.locator('button:text("Positions")').first().click(); await page.waitForTimeout(400); } catch {}
  await page.screenshot({ path: `${DIR}/11-positions.png` });

  // 12. Orders tab
  console.log('12. Orders');
  try { await page.locator('button:text("Orders")').first().click(); await page.waitForTimeout(400); } catch {}
  await page.screenshot({ path: `${DIR}/12-orders.png` });

  // 13. Search modal
  console.log('13. Search modal');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/13-search.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log('Screenshots saved to:', DIR);
  await browser.close();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
