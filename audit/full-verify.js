const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://localhost:3001';
const BASE = path.join(__dirname, 'task-verification');

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('=== FULL TASK VERIFICATION (NON-HEADLESS) ===\n');

  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(4000);

  const results = [];

  // ============ TASK 1: DOM ============
  console.log('\n=== TASK 1: DOM ===');
  try {
    // Click header DOM button specifically
    const domBtn = page.locator('header button:has-text("DOM")');
    if (await domBtn.count() > 0) await domBtn.click();
    await delay(1500);

    const pageContent = await page.content();
    const hasBid = pageContent.includes('Bid') || pageContent.includes('BID');
    const hasAsk = pageContent.includes('Ask') || pageContent.includes('ASK');
    const hasSpread = pageContent.includes('Spread') || pageContent.includes('spread');
    const hasDepth = pageContent.includes('Depth') || pageContent.includes('depth') || pageContent.includes('DOM');

    await page.screenshot({ path: path.join(BASE, 'task1-dom', '01-dom-panel.png') });

    const issues = [];
    if (!hasBid && !hasAsk) issues.push('Bid/Ask columns not found');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  DOM Panel: ' + status);
    issues.forEach(i => console.log('    ! ' + i));
    results.push({ task: 'TASK 1: DOM', status, issues, screenshot: 'task1-dom/01-dom-panel.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 1: DOM', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 2: Position Management ============
  console.log('\n=== TASK 2: Position Management ===');
  try {
    const posTab = page.locator('button:has-text("Positions")').first();
    if (await posTab.count() > 0) await posTab.click();
    await delay(800);

    await page.screenshot({ path: path.join(BASE, 'task2-position-management', '01-positions-tab.png') });

    const posTable = page.locator('table.fw-table').first();
    const emptyState = page.locator('text=No open positions');
    const hasPositions = (await posTable.count() > 0) || (await emptyState.count() > 0);

    const issues = [];
    if (!hasPositions) issues.push('Positions view not rendering');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Positions: ' + status);
    results.push({ task: 'TASK 2: Position Management', status, issues, screenshot: 'task2-position-management/01-positions-tab.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 2: Position Management', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 3: Position Actions ============
  console.log('\n=== TASK 3: Position Actions ===');
  try {
    const pageContent = await page.content();
    const hasSL = pageContent.includes('SL');
    const hasSLM = pageContent.includes('SL-M');

    await page.screenshot({ path: path.join(BASE, 'task3-position-actions', '01-actions.png') });

    const issues = [];
    if (!hasSL) issues.push('SL order type not found');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Position Actions: ' + status);
    results.push({ task: 'TASK 3: Position Actions', status, issues, screenshot: 'task3-position-actions/01-actions.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 3: Position Actions', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 4: Order Ticket ============
  console.log('\n=== TASK 4: Order Ticket ===');
  try {
    const pageContent = await page.content();
    const hasMarket = pageContent.includes('Market') || pageContent.includes('MARKET');
    const hasLimit = pageContent.includes('Limit') || pageContent.includes('LIMIT');
    const hasSL = pageContent.includes('SL');
    const hasMIS = pageContent.includes('MIS');
    const hasNRML = pageContent.includes('NRML');
    const hasCNC = pageContent.includes('CNC');
    const hasBuy = pageContent.includes('BUY') || pageContent.includes('Buy');
    const hasSell = pageContent.includes('SELL') || pageContent.includes('Sell');

    await page.screenshot({ path: path.join(BASE, 'task4-order-ticket', '01-order-panel.png') });

    const issues = [];
    if (!hasMarket) issues.push('MARKET type missing');
    if (!hasLimit) issues.push('LIMIT type missing');
    if (!hasMIS) issues.push('MIS missing');
    if (!hasNRML) issues.push('NRML missing');
    if (!hasBuy) issues.push('BUY missing');
    if (!hasSell) issues.push('SELL missing');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Order Ticket: ' + status);
    issues.forEach(i => console.log('    ! ' + i));
    results.push({ task: 'TASK 4: Order Ticket', status, issues, screenshot: 'task4-order-ticket/01-order-panel.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 4: Order Ticket', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 5: Bottom Panel ============
  console.log('\n=== TASK 5: Bottom Panel ===');
  try {
    const tabs = ['Positions', 'Orders', 'Trade Book', 'Journal', 'Alerts', 'Analytics', 'Risk'];
    const issues = [];

    for (const tab of tabs) {
      const tabBtn = page.locator('button:has-text("' + tab + '")').first();
      if (await tabBtn.count() > 0) {
        await tabBtn.click();
        await delay(400);
        await page.screenshot({ path: path.join(BASE, 'task5-bottom-panel', tab.toLowerCase().replace(' ', '-') + '.png') });
        console.log('    ' + tab + ': visible');
      } else {
        issues.push(tab + ' tab not found');
        console.log('    ' + tab + ': NOT FOUND');
      }
    }

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Bottom Panel: ' + status);
    results.push({ task: 'TASK 5: Bottom Panel', status, issues, screenshot: 'task5-bottom-panel/' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 5: Bottom Panel', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 6: Alerts ============
  console.log('\n=== TASK 6: Alerts ===');
  try {
    const alertsTab = page.locator('button:has-text("Alerts")').first();
    if (await alertsTab.count() > 0) await alertsTab.click();
    await delay(500);

    const newAlertBtn = page.locator('button:has-text("New Alert")').first();
    if (await newAlertBtn.count() > 0) await newAlertBtn.click();
    await delay(500);

    const pageContent = await page.content();
    const hasAbove = pageContent.includes('Price Above');
    const hasBelow = pageContent.includes('Price Below');
    const hasCrossAbove = pageContent.includes('Crosses Above');
    const hasCrossBelow = pageContent.includes('Crosses Below');
    const hasPopup = pageContent.includes('Popup');
    const hasSound = pageContent.includes('Sound');
    const hasToast = pageContent.includes('Toast');

    await page.screenshot({ path: path.join(BASE, 'task6-alerts', '01-alert-form.png') });

    const issues = [];
    if (!hasAbove) issues.push('Price Above missing');
    if (!hasBelow) issues.push('Price Below missing');
    if (!hasCrossAbove) issues.push('Crosses Above missing');
    if (!hasCrossBelow) issues.push('Crosses Below missing');
    if (!hasPopup) issues.push('Popup missing');
    if (!hasSound) issues.push('Sound missing');
    if (!hasToast) issues.push('Toast missing');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Alerts: ' + status);
    issues.forEach(i => console.log('    ! ' + i));
    results.push({ task: 'TASK 6: Alerts', status, issues, screenshot: 'task6-alerts/01-alert-form.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 6: Alerts', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 7: Journal ============
  console.log('\n=== TASK 7: Journal ===');
  try {
    const journalTab = page.locator('button:has-text("Journal")').first();
    if (await journalTab.count() > 0) await journalTab.click();
    await delay(500);

    const newEntryBtn = page.locator('button:has-text("New Entry")').first();
    if (await newEntryBtn.count() > 0) await newEntryBtn.click();
    await delay(500);

    const pageContent = await page.content();
    const hasBeforeTrade = pageContent.includes('Before Trade');
    const hasAfterTrade = pageContent.includes('After Trade');
    const hasScreenshot = pageContent.includes('Screenshot') || pageContent.includes('screenshot');
    const hasMistakes = pageContent.includes('Mistakes') || pageContent.includes('mistakes');
    const hasLessons = pageContent.includes('Lessons') || pageContent.includes('lessons');
    const hasTags = pageContent.includes('tag') || pageContent.includes('Tag');

    await page.screenshot({ path: path.join(BASE, 'task7-journal', '01-journal-form.png') });

    const issues = [];
    if (!hasBeforeTrade) issues.push('Before Trade missing');
    if (!hasAfterTrade) issues.push('After Trade missing');
    if (!hasScreenshot) issues.push('Screenshot URL missing');
    if (!hasMistakes) issues.push('Mistakes missing');
    if (!hasLessons) issues.push('Lessons missing');
    if (!hasTags) issues.push('Tags missing');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Journal: ' + status);
    issues.forEach(i => console.log('    ! ' + i));
    results.push({ task: 'TASK 7: Journal', status, issues, screenshot: 'task7-journal/01-journal-form.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 7: Journal', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 8: Analytics ============
  console.log('\n=== TASK 8: Analytics ===');
  try {
    // Close any open journal form
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    if (await cancelBtn.count() > 0) {
      await cancelBtn.click();
      await delay(300);
    }

    // Add journal entries for analytics data
    const journalTab = page.locator('button:has-text("Journal")').first();
    if (await journalTab.count() > 0) await journalTab.click();
    await delay(400);

    const newBtn = page.locator('button:has-text("New Entry")').first();
    if (await newBtn.count() > 0) await newBtn.click();
    await delay(400);

    // Fill and save a winning trade
    const inputs = page.locator('input[placeholder="Symbol"]');
    const symbolInput = inputs.last();
    if (await symbolInput.isVisible({ timeout: 3000 })) {
      await symbolInput.fill('NIFTY');
      // Find P&L input (number type)
      const pnlInputs = page.locator('input[type="number"][placeholder*="P"]');
      if (await pnlInputs.count() > 0) await pnlInputs.first().fill('5000');
      const textareas = page.locator('textarea');
      if (await textareas.count() > 0) await textareas.last().fill('Win trade');
      await delay(200);
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) await saveBtn.click();
      await delay(400);

      // Add a losing trade
      const newBtn2 = page.locator('button:has-text("New Entry")').first();
      if (await newBtn2.count() > 0) await newBtn2.click();
      await delay(400);
      const symbolInput2 = page.locator('input[placeholder="Symbol"]').last();
      await symbolInput2.fill('BNF');
      const pnlInputs2 = page.locator('input[type="number"][placeholder*="P"]');
      if (await pnlInputs2.count() > 0) await pnlInputs2.first().fill('-2000');
      const textareas2 = page.locator('textarea');
      if (await textareas2.count() > 0) await textareas2.last().fill('Loss trade');
      await delay(200);
      const saveBtn2 = page.locator('button:has-text("Save")').first();
      if (await saveBtn2.count() > 0) await saveBtn2.click();
      await delay(400);
    }

    // Switch to Analytics
    const analyticsTab = page.locator('button:has-text("Analytics")').first();
    if (await analyticsTab.count() > 0) await analyticsTab.click();
    await delay(1000);

    const pageContent = await page.content();
    const hasWinRate = pageContent.includes('Win Rate');
    const hasProfitFactor = pageContent.includes('Profit Factor');
    const hasAvgRR = pageContent.includes('Avg RR');
    const hasBestTrade = pageContent.includes('Best Trade');
    const hasWorstTrade = pageContent.includes('Worst Trade');
    const hasDailyPnl = pageContent.includes('Daily P');
    const hasWeeklyPnl = pageContent.includes('Weekly P');
    const hasMonthlyPnl = pageContent.includes('Monthly P');

    await page.screenshot({ path: path.join(BASE, 'task8-analytics', '01-analytics.png') });

    const issues = [];
    if (!hasWinRate) issues.push('Win Rate missing');
    if (!hasProfitFactor) issues.push('Profit Factor missing');
    if (!hasAvgRR) issues.push('Avg RR missing');
    if (!hasBestTrade) issues.push('Best Trade missing');
    if (!hasWorstTrade) issues.push('Worst Trade missing');
    if (!hasDailyPnl) issues.push('Daily PnL missing');
    if (!hasWeeklyPnl) issues.push('Weekly PnL missing');
    if (!hasMonthlyPnl) issues.push('Monthly PnL missing');

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Analytics: ' + status);
    issues.forEach(i => console.log('    ! ' + i));
    results.push({ task: 'TASK 8: Analytics', status, issues, screenshot: 'task8-analytics/01-analytics.png' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 8: Analytics', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 9: Watchlist ============
  console.log('\n=== TASK 9: Watchlist ===');
  try {
    const issues = [];

    const filterInput = page.locator('input[placeholder="Filter..."]').first();
    const hasSearch = await filterInput.count() > 0;
    if (!hasSearch) issues.push('Search/filter missing');

    const pageContent = await page.content();
    const watchlistTabs = ['INDEX', 'STOCKS', 'FUTURES', 'OPTIONS', 'MCX', 'CDS'];
    for (const tab of watchlistTabs) {
      if (!pageContent.includes(tab)) {
        issues.push('Watchlist tab ' + tab + ' missing');
      }
    }

    // Click MCX tab
    const mcxTab = page.locator('button:has-text("MCX")').first();
    if (await mcxTab.count() > 0) await mcxTab.click();
    await delay(400);
    await page.screenshot({ path: path.join(BASE, 'task9-watchlist', '01-multi-watchlists.png') });

    // Check import button
    const uploadBtn = page.locator('button[title="Import Symbols"]').first();
    const hasImport = await uploadBtn.count() > 0;
    if (!hasImport) issues.push('Import button missing');

    if (hasImport) {
      await uploadBtn.click();
      await delay(400);
      const textarea = page.locator('textarea').last();
      if (await textarea.count() > 0) {
        await textarea.fill('RELIANCE, TCS, INFY');
        await delay(200);
        await page.screenshot({ path: path.join(BASE, 'task9-watchlist', '02-import-input.png') });
        const importBtn = page.locator('button:has-text("Import")').first();
        if (await importBtn.count() > 0) await importBtn.click();
        await delay(500);
        await page.screenshot({ path: path.join(BASE, 'task9-watchlist', '03-after-import.png') });
      }
    }

    // Search test
    if (hasSearch) {
      await filterInput.fill('GOLD');
      await delay(400);
      await page.screenshot({ path: path.join(BASE, 'task9-watchlist', '04-search-filter.png') });
      await filterInput.fill('');
    }

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Watchlist: ' + status);
    issues.forEach(i => console.log('    ! ' + i));
    results.push({ task: 'TASK 9: Watchlist', status, issues, screenshot: 'task9-watchlist/' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 9: Watchlist', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ TASK 10: Layout ============
  console.log('\n=== TASK 10: Layout ===');
  try {
    const viewports = [
      { name: '1920x1080', width: 1920, height: 1080 },
      { name: '1440x900', width: 1440, height: 900 },
      { name: '1366x768', width: 1366, height: 768 },
      { name: '1024x768', width: 1024, height: 768 },
      { name: '768x1024', width: 768, height: 1024 },
    ];

    const issues = [];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await delay(400);

      const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const headerOverflow = await page.evaluate(() => {
        const h = document.querySelector('header');
        return h ? h.scrollWidth > h.clientWidth : false;
      });

      await page.screenshot({ path: path.join(BASE, 'task10-layout', vp.name + '.png') });

      if (hasHScroll || headerOverflow) {
        issues.push(vp.name + ': overflow');
      }
      console.log('    ' + vp.name + ': ' + (!hasHScroll && !headerOverflow ? 'PASS' : 'FAIL'));
    }

    await page.setViewportSize({ width: 1920, height: 1080 });

    const status = issues.length === 0 ? 'PASS' : 'FAIL';
    console.log('  Layout: ' + status);
    results.push({ task: 'TASK 10: Layout', status, issues, screenshot: 'task10-layout/' });
  } catch (e) {
    console.log('  ERROR: ' + e.message.split('\n')[0]);
    results.push({ task: 'TASK 10: Layout', status: 'ERROR', issues: [e.message.split('\n')[0]], screenshot: null });
  }

  // ============ SUMMARY ============
  console.log('\n\n========================================');
  console.log('       FINAL VERIFICATION RESULTS');
  console.log('========================================\n');
  console.log('| Task                          | Status |');
  console.log('|-------------------------------|--------|');
  results.forEach(r => {
    console.log('| ' + r.task.padEnd(29) + ' | ' + r.status.padEnd(6) + ' |');
  });

  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status !== 'PASS').length;
  console.log('\nPASSED: ' + passCount + '/10');
  console.log('FAILED: ' + failCount + '/10');
  console.log('\nOVERALL: ' + (failCount === 0 ? 'ALL PASS' : 'HAS FAILURES'));

  if (failCount > 0) {
    console.log('\nFailed:');
    results.filter(r => r.status !== 'PASS').forEach(r => {
      console.log('  ' + r.task + ': ' + r.issues.join(', '));
    });
  }

  console.log('\nScreenshots: audit/task-verification/');
  await delay(5000);
  await browser.close();
})();
