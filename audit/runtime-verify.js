/**
 * Playwright Runtime Verification Script
 * Captures screenshots of all terminal panels
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'runtime-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log('[1] Loading terminal at http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Screenshot 1: Full terminal loaded
  console.log('[2] Capturing full terminal...');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-full-terminal.png'), fullPage: false });

  // Screenshot 2: Watchlist panel
  console.log('[3] Capturing watchlist...');
  const watchlist = await page.$('[class*="Watchlist"]') || await page.$('div:has(> div:has(> span:text("Watchlist")))');
  if (watchlist) {
    await watchlist.screenshot({ path: path.join(SCREENSHOT_DIR, '02-watchlist.png') });
  } else {
    console.log('   Watchlist selector not found, using viewport crop');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-watchlist.png'), clip: { x: 48, y: 38, width: 240, height: 800 } });
  }

  // Screenshot 3: Chart panel
  console.log('[4] Capturing chart...');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-chart.png'), clip: { x: 290, y: 38, width: 900, height: 600 } });

  // Screenshot 4: Click on 'Options' workspace to load Option Chain
  console.log('[5] Switching to Options workspace...');
  const optionsBtn = await page.$('button:has-text("OC")') || await page.$('button:has-text("Options")');
  if (optionsBtn) {
    await optionsBtn.click();
    await page.waitForTimeout(3000);
  }
  // Also try clicking the sidebar workspace button for options
  const sidebarOptions = await page.$$('button');
  for (const btn of sidebarOptions) {
    const text = await btn.textContent();
    if (text && text.trim() === 'OPT') {
      await btn.click();
      await page.waitForTimeout(3000);
      break;
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-option-chain.png'), fullPage: false });

  // Screenshot 5: Market Depth - enable DOM panel
  console.log('[6] Enabling Market Depth...');
  const domBtn = await page.$('button:has-text("DOM")');
  if (domBtn) {
    await domBtn.click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-market-depth.png'), clip: { x: 1400, y: 38, width: 520, height: 600 } });

  // Screenshot 6: Bottom Panel - Positions
  console.log('[7] Capturing bottom panel - positions...');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-positions.png'), clip: { x: 290, y: 650, width: 1100, height: 350 } });

  // Screenshot 7: Orders tab
  console.log('[8] Switching to Orders tab...');
  const ordersTab = await page.$('button:has-text("Orders")');
  if (ordersTab) {
    await ordersTab.click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-orders.png'), clip: { x: 290, y: 650, width: 1100, height: 350 } });

  // Screenshot 8: Trade Book tab
  console.log('[9] Switching to Trade Book tab...');
  const tradeTab = await page.$('button:has-text("Trade Book")');
  if (tradeTab) {
    await tradeTab.click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-tradebook.png'), clip: { x: 290, y: 650, width: 1100, height: 350 } });

  // Screenshot 9: Risk tab
  console.log('[10] Switching to Risk tab...');
  const riskTab = await page.$('button:has-text("Risk")');
  if (riskTab) {
    await riskTab.click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-risk-panel.png'), clip: { x: 290, y: 650, width: 1100, height: 350 } });

  // Screenshot 10: Switch back to Index workspace for standard layout
  console.log('[11] Switching back to standard layout...');
  for (const btn of sidebarOptions) {
    const text = await btn.textContent();
    if (text && text.trim() === 'IDX') {
      await btn.click();
      await page.waitForTimeout(2000);
      break;
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-standard-layout.png'), fullPage: false });

  // Screenshot 11: Order Panel (right side)
  console.log('[12] Capturing order panel...');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '11-order-panel.png'), clip: { x: 1640, y: 38, width: 280, height: 800 } });

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  console.log('\n═══════════════════════════════════════');
  console.log('  SCREENSHOTS CAPTURED SUCCESSFULLY');
  console.log('═══════════════════════════════════════');
  console.log(`  Location: ${SCREENSHOT_DIR}`);
  console.log(`  Files: ${fs.readdirSync(SCREENSHOT_DIR).length}`);
  console.log('');

  await browser.close();
})().catch(err => {
  console.error('PLAYWRIGHT ERROR:', err.message);
  process.exit(1);
});
