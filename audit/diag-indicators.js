/**
 * Diagnostic script: tests indicator toggle + drawing tool click
 * Captures ALL console output and errors from the browser.
 */
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const consoleLogs = [];
  const pageErrors = [];

  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
    console.error('[PAGEERROR]', err.message);
  });

  console.log('\n=== STEP 1: Load app ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: 'audit/diag/01-loaded.png' });

  // Wait for chart to render — look for the chart toolbar
  console.log('\n=== STEP 2: Wait for chart toolbar ===');
  try {
    await page.waitForSelector('button:has-text("1m")', { timeout: 15000 });
    console.log('[DIAG] Chart toolbar found');
  } catch (e) {
    console.log('[DIAG] Chart toolbar NOT found — terminal may need login or symbol selection');
    await page.screenshot({ path: 'audit/diag/02-no-toolbar.png' });
  }

  // Check if there's a symbol already selected — look for the price display
  const hasSymbol = await page.$('[class*="font-black"][class*="tabular-nums"]');
  console.log('[DIAG] Has active symbol price displayed:', !!hasSymbol);

  // Try clicking a symbol from watchlist if available
  const watchlistItem = await page.$('[class*="Watchlist"] [class*="cursor-pointer"]');
  if (watchlistItem) {
    console.log('[DIAG] Clicking first watchlist item to activate a symbol...');
    await watchlistItem.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'audit/diag/02-symbol-selected.png' });
  }

  console.log('\n=== STEP 3: Open Indicators panel ===');
  const indicatorBtn = await page.$('button:has-text("Indicators")');
  if (!indicatorBtn) {
    console.log('[DIAG] ERROR: Indicators button not found in DOM');
    await page.screenshot({ path: 'audit/diag/03-no-indicator-btn.png' });
  } else {
    console.log('[DIAG] Found Indicators button, clicking...');
    await indicatorBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'audit/diag/03-indicator-panel-open.png' });

    console.log('\n=== STEP 4: Click SMA 9 checkbox ===');
    // Look for the SMA 9 row — click its checkbox button
    const sma9Row = await page.$('text=SMA 9');
    if (!sma9Row) {
      console.log('[DIAG] ERROR: "SMA 9" text not found in indicator panel');
    } else {
      console.log('[DIAG] Found SMA 9 row, clicking checkbox...');
      // The checkbox is a button inside the same row
      const sma9Parent = await sma9Row.evaluateHandle(el => el.closest('[class*="flex items-center"]'));
      const checkboxBtn = await sma9Parent.$('button');
      if (checkboxBtn) {
        await checkboxBtn.click();
      } else {
        // fallback: click the row itself
        await sma9Row.click();
      }
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'audit/diag/04-after-sma9-click.png' });

      // Check if SMA 9 checkbox is now visually checked
      const checkIcon = await page.$('text=SMA 9 ~ * svg');
      console.log('[DIAG] Check icon visible after click:', !!checkIcon);
    }

    console.log('\n=== STEP 5: Click EMA 9 ===');
    const ema9 = await page.$('text=EMA 9');
    if (ema9) {
      const ema9Parent = await ema9.evaluateHandle(el => el.closest('[class*="flex items-center"]'));
      const ema9Btn = await ema9Parent.$('button');
      if (ema9Btn) await ema9Btn.click();
      else await ema9.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'audit/diag/05-after-ema9-click.png' });
    }
  }

  console.log('\n=== STEP 6: Close indicators, open Draw Tools ===');
  // Close indicator panel
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const drawBtn = await page.$('button:has-text("Draw")');
  if (!drawBtn) {
    console.log('[DIAG] ERROR: Draw button not found');
  } else {
    console.log('[DIAG] Found Draw button, clicking...');
    await drawBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'audit/diag/06-draw-panel-open.png' });

    // Click Horizontal Line
    const hlineBtn = await page.$('text=Horizontal Line');
    if (hlineBtn) {
      console.log('[DIAG] Clicking Horizontal Line tool...');
      await hlineBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'audit/diag/07-hline-selected.png' });

      // Now click on the chart canvas
      const chartCanvas = await page.$('canvas');
      if (chartCanvas) {
        console.log('[DIAG] Clicking chart canvas to place horizontal line...');
        const box = await chartCanvas.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit/diag/08-after-hline-click.png' });
      } else {
        console.log('[DIAG] ERROR: No canvas element found in chart');
      }
    }
  }

  console.log('\n=== FINAL: Console log dump ===');
  console.log('\n--- ALL CONSOLE LOGS ---');
  consoleLogs.forEach(l => console.log(l));
  console.log('\n--- PAGE ERRORS ---');
  pageErrors.forEach(e => console.log(e));

  // Save full report
  const report = {
    consoleLogs,
    pageErrors,
    timestamp: new Date().toISOString()
  };
  fs.mkdirSync('audit/diag', { recursive: true });
  fs.writeFileSync('audit/diag/diag-report.json', JSON.stringify(report, null, 2));
  console.log('\n[DIAG] Report saved to audit/diag/diag-report.json');

  await browser.close();
})();
