const { chromium } = require('playwright');
const path = require('path');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
];

const URL = 'http://localhost:3001';
const OUTPUT_DIR = path.join(__dirname, 'layout');

async function checkLayout(page, viewport) {
  const issues = [];

  // Check for horizontal scrollbar
  const hasHScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasHScroll) issues.push('Horizontal scrollbar present');

  // Check header overflow
  const headerOverflow = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return false;
    return header.scrollWidth > header.clientWidth;
  });
  if (headerOverflow) issues.push('Header overflow detected');

  // Check if balance/margin values are clipped (check if elements are visible and not cut)
  const metricClipping = await page.evaluate(() => {
    const results = [];
    // Find all metric blocks in header - they contain font-mono font-bold
    const metricEls = document.querySelectorAll('header .font-mono.font-bold');
    metricEls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const parent = el.closest('div');
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        // Check if text is clipped (element extends beyond parent)
        if (rect.right > parentRect.right + 2) {
          results.push(`Metric clipped: "${el.textContent}" at x=${Math.round(rect.right)} > parent=${Math.round(parentRect.right)}`);
        }
      }
      // Check if element is off-screen
      if (rect.right > window.innerWidth) {
        results.push(`Metric off-screen: "${el.textContent}"`);
      }
    });
    return results;
  });
  if (metricClipping.length > 0) issues.push(...metricClipping);

  // Check panel overlap
  const panelOverlap = await page.evaluate(() => {
    const issues = [];
    const panels = [];
    
    // Get all main panel containers
    const watchlist = document.querySelector('[class*="border-r"][class*="flex-col"][class*="flex-shrink-0"]');
    const orderPanel = document.querySelector('[class*="border-l"][class*="flex-col"][class*="flex-shrink-0"]');
    
    if (watchlist) panels.push({ name: 'watchlist', rect: watchlist.getBoundingClientRect() });
    if (orderPanel) panels.push({ name: 'orderPanel', rect: orderPanel.getBoundingClientRect() });

    // Check if panels overlap each other
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i].rect;
        const b = panels[j].rect;
        if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) {
          issues.push(`Panel overlap: ${panels[i].name} overlaps ${panels[j].name}`);
        }
      }
    }

    // Check if any panel extends beyond viewport
    panels.forEach(({ name, rect }) => {
      if (rect.right > window.innerWidth + 2) {
        issues.push(`${name} extends beyond viewport right edge`);
      }
      if (rect.bottom > window.innerHeight + 2) {
        issues.push(`${name} extends beyond viewport bottom`);
      }
    });

    return issues;
  });
  if (panelOverlap.length > 0) issues.push(...panelOverlap);

  // Check watchlist overflow
  const watchlistOverflow = await page.evaluate(() => {
    // Find watchlist scrollable area
    const wlItems = document.querySelector('[class*="overflow-y-auto"][class*="min-h-0"]');
    if (wlItems && wlItems.scrollHeight > wlItems.clientHeight + 5) {
      // This is fine - it should scroll
      return null;
    }
    // Check if watchlist container is clipped
    const wl = document.querySelector('[class*="bg-fw-surface"][class*="overflow-hidden"]');
    if (wl) {
      const rect = wl.getBoundingClientRect();
      if (rect.bottom > window.innerHeight) {
        return 'Watchlist extends below viewport';
      }
    }
    return null;
  });
  if (watchlistOverflow) issues.push(watchlistOverflow);

  // Check bottom panel overflow
  const bottomPanelOverflow = await page.evaluate(() => {
    const bp = document.querySelector('[class*="border-t"][class*="overflow-hidden"][class*="flex-shrink-0"]');
    if (bp) {
      const rect = bp.getBoundingClientRect();
      if (rect.bottom > window.innerHeight + 2) {
        return `Bottom panel overflows viewport by ${Math.round(rect.bottom - window.innerHeight)}px`;
      }
    }
    return null;
  });
  if (bottomPanelOverflow) issues.push(bottomPanelOverflow);

  // Check order panel overflow
  const orderPanelOverflow = await page.evaluate(() => {
    const panels = document.querySelectorAll('[class*="border-l"][class*="flex-col"]');
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      if (rect.right > window.innerWidth + 2) {
        return `Order panel extends ${Math.round(rect.right - window.innerWidth)}px beyond viewport`;
      }
    }
    return null;
  });
  if (orderPanelOverflow) issues.push(orderPanelOverflow);

  return issues;
}

(async () => {
  console.log('=== LAYOUT VERIFICATION ===\n');
  console.log(`URL: ${URL}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Testing ${vp.name} ---`);
    
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await context.newPage();

    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      // Wait for app to render
      await page.waitForTimeout(3000);

      // Take screenshot
      const screenshotPath = path.join(OUTPUT_DIR, `${vp.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`Screenshot: ${screenshotPath}`);

      // Run layout checks
      const issues = await checkLayout(page, vp);
      
      const status = issues.length === 0 ? 'PASS' : 'FAIL';
      console.log(`Result: ${status}`);
      if (issues.length > 0) {
        issues.forEach((issue) => console.log(`  ⚠ ${issue}`));
      }

      results.push({ viewport: vp.name, status, issues, screenshot: screenshotPath });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ viewport: vp.name, status: 'ERROR', issues: [err.message], screenshot: null });
    }

    await context.close();
  }

  await browser.close();

  // Summary
  console.log('\n\n=== FINAL RESULTS ===\n');
  console.log('| Viewport    | Status | Issues |');
  console.log('|-------------|--------|--------|');
  results.forEach((r) => {
    console.log(`| ${r.viewport.padEnd(11)} | ${r.status.padEnd(6)} | ${r.issues.length > 0 ? r.issues.join('; ') : 'None'} |`);
  });

  const allPass = results.every((r) => r.status === 'PASS');
  console.log(`\n\nOVERALL: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!allPass) {
    console.log('\nFailed viewports:');
    results.filter((r) => r.status !== 'PASS').forEach((r) => {
      console.log(`  ${r.viewport}: ${r.issues.join(', ')}`);
    });
  }
})();
