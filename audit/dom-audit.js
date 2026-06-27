/**
 * DOM Panel Runtime Audit
 * Navigates to MCX workspace, enables DOM panel, and captures state.
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('[1] Loading terminal at http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // ─── Navigate to MCX workspace ─────────────────────────────────────────────
  console.log('[2] Clicking MCX workspace tab...');
  const mcxTab = page.locator('button', { hasText: 'MCX' }).first();
  if (await mcxTab.isVisible()) {
    await mcxTab.click();
    await page.waitForTimeout(1000);
    console.log('    ✓ MCX tab clicked');
  } else {
    console.log('    ✗ MCX tab NOT visible');
  }

  // ─── Check if DOM panel is already visible ─────────────────────────────────
  console.log('[3] Checking if Market Depth panel is visible...');
  let domPanel = page.locator('text=Market Depth').first();
  let domVisible = await domPanel.isVisible().catch(() => false);
  console.log('    DOM panel visible after MCX switch:', domVisible);

  // If not visible, try toggling via the TopBar DOM button
  if (!domVisible) {
    console.log('[3b] Trying to enable DOM via TopBar button...');
    const domBtn = page.locator('button', { hasText: 'DOM' }).first();
    if (await domBtn.isVisible().catch(() => false)) {
      await domBtn.click();
      await page.waitForTimeout(500);
      domVisible = await domPanel.isVisible().catch(() => false);
      console.log('    DOM after toggle:', domVisible);
    }
  }

  // ─── Screenshot ────────────────────────────────────────────────────────────
  console.log('[4] Taking screenshot...');
  await page.screenshot({ path: 'audit/dom-audit/01-mcx-dom-panel.png', fullPage: false });
  console.log('    ✓ Screenshot saved: audit/dom-audit/01-mcx-dom-panel.png');

  // ─── Extract DOM HTML ──────────────────────────────────────────────────────
  console.log('[5] Extracting rendered DOM HTML structure...');
  const domHtml = await page.evaluate(() => {
    // Find the element that contains "Market Depth" heading
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.textContent && el.textContent.includes('Market Depth') && el.closest) {
        const panel = el.closest('[class*="flex-col"]');
        if (panel && panel.innerHTML.includes('Market Depth')) {
          // Return outer HTML truncated to see structure
          return panel.outerHTML.substring(0, 3000);
        }
      }
    }
    return 'MARKET DEPTH PANEL NOT FOUND IN DOM';
  });
  console.log('\n── Rendered HTML (first 3000 chars) ──');
  console.log(domHtml);

  // ─── Extract Zustand store values ──────────────────────────────────────────
  console.log('\n[6] Extracting Zustand store state...');
  const storeState = await page.evaluate(() => {
    // Access zustand stores via window.__ZUSTAND_DEVTOOLS__ or internal state
    // Since we can't directly access React internals easily, we'll read from the DOM
    // and also try to get the store via module scope
    
    // Try to get appStore state
    const results = {};
    
    // Check what workspace is active by looking at highlighted tab
    const tabs = document.querySelectorAll('header button');
    tabs.forEach(tab => {
      if (tab.textContent && tab.classList.toString().includes('text-white') && 
          ['INDEX', 'STOCKS', 'FUTURES', 'OPTIONS', 'MCX', 'CDS'].includes(tab.textContent.trim())) {
        results.activeWorkspace = tab.textContent.trim();
      }
    });

    // Check market status from status bar
    const statusBar = document.querySelector('[class*="h-\\[22px\\]"]');
    if (statusBar) {
      results.statusBarText = statusBar.textContent;
    }

    // Check if "Waiting for depth data" text exists
    results.showingEmptyState = !!document.body.innerHTML.includes('Waiting for depth data');
    results.showingActivatesWhen = !!document.body.innerHTML.includes('Activates when broker feed');

    // Check if any depth numbers are shown
    const depthNumbers = document.querySelectorAll('[class*="text-green"][class*="font-mono"]');
    results.greenMonoElements = depthNumbers.length;

    return results;
  });
  console.log(JSON.stringify(storeState, null, 2));

  // ─── Extract React fiber / component props ─────────────────────────────────
  console.log('\n[7] Extracting MarketDepthPanel React props from fiber...');
  const reactState = await page.evaluate(() => {
    // Find the Market Depth panel DOM node
    const findReactFiber = (element) => {
      const key = Object.keys(element).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      return key ? element[key] : null;
    };

    // Look for the panel container
    const panelHeadings = Array.from(document.querySelectorAll('span'));
    const mdHeading = panelHeadings.find(el => el.textContent === 'Market Depth');
    if (!mdHeading) return { error: 'Market Depth heading not found' };

    const panelRoot = mdHeading.closest('[class*="bg-fw-surface"]');
    if (!panelRoot) return { error: 'Panel root container not found' };

    const fiber = findReactFiber(panelRoot);
    if (!fiber) return { error: 'React fiber not found on panel element' };

    // Walk up fiber tree to find MarketDepthPanel
    let current = fiber;
    let attempts = 0;
    let componentInfo = null;
    while (current && attempts < 30) {
      if (current.type && typeof current.type === 'function') {
        const name = current.type.name || current.type.displayName || '';
        if (name === 'MarketDepthPanel') {
          componentInfo = {
            componentName: name,
            hasHooks: !!current.memoizedState,
          };
          
          // Try to read hook values from memoizedState chain
          let hook = current.memoizedState;
          let hookIndex = 0;
          const hooks = [];
          while (hook && hookIndex < 10) {
            if (hook.memoizedState !== undefined) {
              hooks.push({
                index: hookIndex,
                type: typeof hook.memoizedState,
                value: typeof hook.memoizedState === 'object' 
                  ? JSON.stringify(hook.memoizedState)?.substring(0, 200)
                  : String(hook.memoizedState)?.substring(0, 100)
              });
            }
            hook = hook.next;
            hookIndex++;
          }
          componentInfo.hooks = hooks;
          break;
        }
      }
      current = current.return;
      attempts++;
    }

    return componentInfo || { error: 'MarketDepthPanel fiber not found in tree', attempts };
  });
  console.log(JSON.stringify(reactState, null, 2));

  // ─── Check depth data via network/store ────────────────────────────────────
  console.log('\n[8] Checking market store depth data via React internals...');
  const depthPayload = await page.evaluate(() => {
    // Try to find any element rendered by useMarketStore depth selector
    const findReactFiber = (element) => {
      const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
      return key ? element[key] : null;
    };

    // Walk from root to find store state
    const root = document.getElementById('root');
    if (!root) return { error: 'root not found' };
    
    const fiber = findReactFiber(root);
    if (!fiber) return { error: 'fiber not found on root' };

    // We'll try another approach: execute the store getter
    // Zustand stores are in module scope — look for the market depth store state
    // by finding a subscribed component
    
    // Check if depth data is in any data attribute or rendered text
    const body = document.body.innerHTML;
    
    return {
      containsBidQty: body.includes('Bid Qty'),
      containsAskQty: body.includes('Ask Qty'),
      containsWaitingText: body.includes('Waiting for depth data'),
      containsActivatesWhen: body.includes('Activates when broker feed'),
      containsSpread: body.includes('Spread'),
      // Check if actual numbers are rendered (not just dashes)
      hasDashesOnly: !body.match(/class="[^"]*text-green[^"]*font-mono[^"]*"[^>]*>\d/),
    };
  });
  console.log(JSON.stringify(depthPayload, null, 2));

  // ─── Check WebSocket messages for depth ────────────────────────────────────
  console.log('\n[9] Monitoring WebSocket for depth messages (3 seconds)...');
  const wsMessages = [];
  page.on('websocket', ws => {
    ws.on('framereceived', frame => {
      try {
        const data = JSON.parse(frame.payload);
        if (data.type === 'depth' || data.type === 'quote') {
          wsMessages.push({ type: data.type, token: data.token, hasData: !!data.data });
        }
      } catch {}
    });
  });
  
  // Reload to capture WS connection
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  
  // Re-click MCX
  const mcxTab2 = page.locator('button', { hasText: 'MCX' }).first();
  if (await mcxTab2.isVisible()) await mcxTab2.click();
  await page.waitForTimeout(2000);

  console.log('    WS messages captured:', wsMessages.length);
  console.log('    Messages:', JSON.stringify(wsMessages.slice(0, 10), null, 2));

  // ─── Final state check ─────────────────────────────────────────────────────
  console.log('\n[10] Final DOM panel state...');
  const finalState = await page.evaluate(() => {
    const body = document.body.innerHTML;
    return {
      marketDepthVisible: body.includes('Market Depth'),
      emptyStateShowing: body.includes('Waiting for depth data'),
      hasNumericBidData: !!body.match(/text-green[^>]*font-mono[^>]*font-medium[^>]*>\s*[\d,]+/),
      hasNumericAskData: !!body.match(/text-red[^>]*font-mono[^>]*font-medium[^>]*>\s*[\d,]+/),
      bidLevelsRendered: (body.match(/Bid Qty/g) || []).length,
      totalBuyVisible: body.includes('Total Buy'),
      totalSellVisible: body.includes('Total Sell'),
      imbalanceBarVisible: body.includes('Buy pressure') || body.includes('Sell pressure') || body.includes('Balanced'),
    };
  });
  console.log(JSON.stringify(finalState, null, 2));

  // ─── Take final screenshot ─────────────────────────────────────────────────
  await page.screenshot({ path: 'audit/dom-audit/02-final-state.png', fullPage: false });
  console.log('\n    ✓ Final screenshot: audit/dom-audit/02-final-state.png');

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  DOM PANEL RUNTIME AUDIT — SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Panel rendered:        ${finalState.marketDepthVisible ? 'YES' : 'NO'}`);
  console.log(`  Empty state showing:   ${finalState.emptyStateShowing ? 'YES' : 'NO'}`);
  console.log(`  Bid data (numeric):    ${finalState.hasNumericBidData ? 'YES' : 'NO'}`);
  console.log(`  Ask data (numeric):    ${finalState.hasNumericAskData ? 'YES' : 'NO'}`);
  console.log(`  WS depth messages:     ${wsMessages.filter(m => m.type === 'depth').length}`);
  console.log(`  Imbalance bar:         ${finalState.imbalanceBarVisible ? 'YES' : 'NO'}`);
  console.log('═══════════════════════════════════════════════════');

  await browser.close();
})();
