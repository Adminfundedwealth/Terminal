const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const SCREENSHOT_DIR = path.join(__dirname, 'ui-certification');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  // ─── 1920x1080 Full Terminal ──────────────────────────────────────────
  console.log('📸 Taking 1920x1080 screenshots...');
  const ctx1080 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page1080 = await ctx1080.newPage();
  await page1080.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page1080.waitForTimeout(3000);

  await page1080.screenshot({ path: path.join(SCREENSHOT_DIR, '01-full-terminal-1920x1080.png'), fullPage: false });
  results.push({ name: 'Full Terminal 1920x1080', file: '01-full-terminal-1920x1080.png', status: 'captured' });

  // Sidebar
  const sidebar = await page1080.$('[class*="w-\\[48px\\]"]');
  if (sidebar) {
    await sidebar.screenshot({ path: path.join(SCREENSHOT_DIR, '02-sidebar.png') });
    results.push({ name: 'Sidebar', file: '02-sidebar.png', status: 'captured' });
  } else {
    results.push({ name: 'Sidebar', file: null, status: 'NOT FOUND' });
  }

  // TopBar / Brand
  const topbar = await page1080.$('header');
  if (topbar) {
    await topbar.screenshot({ path: path.join(SCREENSHOT_DIR, '03-topbar-brand.png') });
    results.push({ name: 'TopBar + Branding', file: '03-topbar-brand.png', status: 'captured' });
  }

  // Watchlist panel (left area after sidebar)
  const watchlist = await page1080.$('[class*="border-r"][class*="flex-col"]');
  if (watchlist) {
    await watchlist.screenshot({ path: path.join(SCREENSHOT_DIR, '04-watchlist.png') });
    results.push({ name: 'Watchlist', file: '04-watchlist.png', status: 'captured' });
  }

  // Chart area
  const chartPanel = await page1080.$('[class*="flex-1"][class*="flex-col"]');
  if (chartPanel) {
    await chartPanel.screenshot({ path: path.join(SCREENSHOT_DIR, '05-chart-area.png') });
    results.push({ name: 'Chart Area', file: '05-chart-area.png', status: 'captured' });
  }

  // Order Panel (right side)
  const orderPanel = await page1080.$('[class*="border-l"][class*="flex-col"][class*="flex-shrink-0"]');
  if (orderPanel) {
    await orderPanel.screenshot({ path: path.join(SCREENSHOT_DIR, '06-order-panel.png') });
    results.push({ name: 'Order Panel', file: '06-order-panel.png', status: 'captured' });
  }

  // Bottom panel
  const bottomPanel = await page1080.$('[class*="border-t"][class*="overflow-hidden"][class*="flex-shrink-0"]');
  if (bottomPanel) {
    await bottomPanel.screenshot({ path: path.join(SCREENSHOT_DIR, '07-bottom-panel.png') });
    results.push({ name: 'Bottom Panel', file: '07-bottom-panel.png', status: 'captured' });
  }

  await ctx1080.close();

  // ─── 1366x768 ────────────────────────────────────────────────────────
  console.log('📸 Taking 1366x768 screenshots...');
  const ctx1366 = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page1366 = await ctx1366.newPage();
  await page1366.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page1366.waitForTimeout(3000);

  await page1366.screenshot({ path: path.join(SCREENSHOT_DIR, '08-full-terminal-1366x768.png'), fullPage: false });
  results.push({ name: 'Full Terminal 1366x768', file: '08-full-terminal-1366x768.png', status: 'captured' });
  await ctx1366.close();

  // ─── Mobile 390x844 ──────────────────────────────────────────────────
  console.log('📸 Taking mobile 390x844 screenshot...');
  const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageMobile = await ctxMobile.newPage();
  await pageMobile.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await pageMobile.waitForTimeout(3000);

  await pageMobile.screenshot({ path: path.join(SCREENSHOT_DIR, '09-mobile-390x844.png'), fullPage: false });
  results.push({ name: 'Mobile 390x844', file: '09-mobile-390x844.png', status: 'captured' });
  await ctxMobile.close();

  // ─── Verification checks ─────────────────────────────────────────────
  console.log('\n📋 Running visual verification checks...');
  const ctxVerify = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const pageV = await ctxVerify.newPage();
  await pageV.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await pageV.waitForTimeout(3000);

  const checks = {};

  // Check: No white backgrounds
  const bgColor = await pageV.evaluate(() => {
    const root = document.getElementById('root');
    return root ? window.getComputedStyle(root).backgroundColor : 'unknown';
  });
  checks.noWhiteBackground = !bgColor.includes('255, 255, 255');

  // Check: Brand text present
  const brandText = await pageV.evaluate(() => {
    const els = document.querySelectorAll('[data-brand] span');
    const texts = Array.from(els).map(el => el.textContent);
    return texts;
  });
  checks.brandFundedwealth = brandText.some(t => t && t.includes('FUNDEDWEALTH'));
  checks.brandTerminal = brandText.some(t => t && t.includes('TERMINAL'));

  // Check: Sidebar exists
  checks.sidebarPresent = await pageV.$('button[title="Index"]') !== null || await pageV.$('button[title="Stocks"]') !== null;

  // Check: Quick action buttons in order panel
  const quickBtns = await pageV.evaluate(() => {
    const btns = document.querySelectorAll('button[title*="Backend integration pending"]');
    const labels = Array.from(btns).map(b => b.textContent?.trim());
    return labels;
  });
  checks.beButton = quickBtns.some(l => l === 'BE');
  checks.tpButton = quickBtns.some(l => l === 'TP');
  checks.slButton = quickBtns.some(l => l === 'SL');
  checks.tslButton = quickBtns.some(l => l === 'TSL');
  checks.revButton = quickBtns.some(l => l === 'REV');
  checks.exitButton = quickBtns.some(l => l === 'EXIT');
  checks.halfButton = quickBtns.some(l => l === 'HALF');
  checks.allButton = quickBtns.some(l => l === 'ALL');

  // Check: Indicators button active (not disabled/not cursor-not-allowed)
  const indicatorsBtn = await pageV.$('button[title*="Indicators"]');
  let indicatorsActive = false;
  if (indicatorsBtn) {
    const cls = await indicatorsBtn.getAttribute('class');
    indicatorsActive = !cls.includes('cursor-not-allowed') && !cls.includes('opacity-60');
  }
  checks.indicatorsActive = indicatorsActive;

  // Check: Drawing tools button active
  const drawBtn = await pageV.$('button[title*="Drawing"]');
  let drawActive = false;
  if (drawBtn) {
    const cls = await drawBtn.getAttribute('class');
    drawActive = !cls.includes('cursor-not-allowed') && !cls.includes('opacity-60');
  }
  checks.drawingToolsActive = drawActive;

  // Check: Layout controls present
  checks.layoutSingle = await pageV.$('button[title="Single Chart"]') !== null;
  checks.layoutSplit = await pageV.$('button[title*="Split View"]') !== null;
  checks.layoutGrid = await pageV.$('button[title*="Grid View"]') !== null;

  // Check: No overflow (body scroll)
  const hasOverflow = await pageV.evaluate(() => {
    return document.documentElement.scrollHeight > document.documentElement.clientHeight;
  });
  checks.noVerticalOverflow = !hasOverflow;

  // Check: Status bar version
  const statusText = await pageV.evaluate(() => {
    return document.body.innerText;
  });
  checks.versionInStatusBar = statusText.includes('FW Terminal v1.0');

  await ctxVerify.close();
  await browser.close();

  // ─── Output results ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('  UI CERTIFICATION RESULTS');
  console.log('═══════════════════════════════════════════\n');

  console.log('📸 Screenshots captured:');
  results.forEach(r => {
    console.log(`  ${r.status === 'captured' ? '✓' : '✗'} ${r.name} — ${r.file || 'MISSING'}`);
  });

  console.log('\n🔍 Visual Verification:');
  Object.entries(checks).forEach(([key, val]) => {
    console.log(`  ${val ? '✓ PASS' : '✗ FAIL'} ${key}`);
  });

  const allPass = Object.values(checks).every(v => v === true);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  OVERALL: ${allPass ? '✓ ALL CHECKS PASS' : '✗ SOME CHECKS FAILED'}`);
  console.log(`═══════════════════════════════════════════\n`);

  // Write results JSON
  const fs = require('fs');
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'certification-results.json'),
    JSON.stringify({ screenshots: results, checks, allPass, timestamp: new Date().toISOString() }, null, 2)
  );
  console.log('Results saved to audit/ui-certification/certification-results.json');
}

run().catch(e => {
  console.error('Certification failed:', e.message);
  process.exit(1);
});
