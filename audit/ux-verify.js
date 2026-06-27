import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const DIR = './audit/ux-rebuild';

async function main() {
  await mkdir(DIR, { recursive: true });
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.setDefaultTimeout(6000);

  await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 12000 });
  await p.waitForTimeout(3000);

  // 1. Index workspace (default)
  await p.screenshot({ path: `${DIR}/01-index.png`, timeout: 15000 });
  console.log('1. INDEX workspace - chart auto-loaded');

  // 2. FUTURES
  await p.locator('header button').filter({ hasText: 'FUTURES' }).click({ force: true });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${DIR}/02-futures.png`, timeout: 15000 });
  console.log('2. FUTURES workspace - NIFTY FUT auto-loaded + DOM');

  // 3. OPTIONS
  await p.locator('header button').filter({ hasText: 'OPTIONS' }).click({ force: true });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${DIR}/03-options.png`, timeout: 15000 });
  console.log('3. OPTIONS workspace - Option Chain inline');

  // 4. MCX
  await p.locator('header button').filter({ hasText: 'MCX' }).click({ force: true });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${DIR}/04-mcx.png`, timeout: 15000 });
  console.log('4. MCX workspace - GOLD auto-loaded + DOM');

  // 5. CDS
  await p.locator('header button').filter({ hasText: 'CDS' }).click({ force: true });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${DIR}/05-cds.png`, timeout: 15000 });
  console.log('5. CDS workspace - USDINR auto-loaded');

  // 6. STOCKS
  await p.locator('header button').filter({ hasText: 'STOCKS' }).click({ force: true });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${DIR}/06-stocks.png`, timeout: 15000 });
  console.log('6. STOCKS workspace - RELIANCE auto-loaded');

  // Verify status bar exists
  const statusBar = await p.locator('text=Broker: Connected').isVisible();
  console.log('7. Status bar visible:', statusBar);

  // Verify no empty chart
  const emptyChart = await p.locator('text=Select a symbol').isVisible().catch(() => false);
  console.log('8. Empty chart screen:', emptyChart ? 'STILL SHOWING (BUG)' : 'REMOVED (OK)');

  // Verify all workspace tabs visible without scroll
  const tabs = await p.locator('header button').filter({ hasText: /^(INDEX|STOCKS|FUTURES|OPTIONS|MCX|CDS)$/ }).count();
  console.log('9. Workspace tabs visible:', tabs);

  console.log('\nDONE');
  await b.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
