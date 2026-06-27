const { chromium } = require('playwright');

async function run() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    // Capture WebSocket frames
    const wsFrames = [];
    page.on('websocket', ws => {
      console.log('WS connected:', ws.url());
      ws.on('framereceived', frame => {
        try {
          const data = JSON.parse(frame.payload);
          wsFrames.push(data);
        } catch {}
      });
      ws.on('framesent', frame => {
        try {
          const data = JSON.parse(frame.payload);
          if (data.type === 'subscribe_depth' || data.type === 'subscribe') {
            console.log('WS SENT:', JSON.stringify(data));
          }
        } catch {}
      });
    });

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2500);

    // Click MCX
    await page.click('button:has-text("MCX")', { timeout: 3000 });
    await page.waitForTimeout(3000);

    // ── Get React fiber data for depth store ──
    const storeData = await page.evaluate(() => {
      const findFiber = (el) => {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
        return key ? el[key] : null;
      };

      // Walk fiber tree from root to find zustand store hooks
      const root = document.getElementById('root');
      const fiber = findFiber(root);
      if (!fiber) return { error: 'no fiber' };

      // Alternative: Look for the market depth panel and read its hooks
      const spans = Array.from(document.querySelectorAll('span'));
      const heading = spans.find(s => s.textContent.trim() === 'Market Depth');
      if (!heading) return { error: 'heading not found' };

      const panelDiv = heading.closest('div[class*="bg-fw-surface"]');
      if (!panelDiv) return { error: 'panel div not found' };

      const panelFiber = findFiber(panelDiv);
      if (!panelFiber) return { error: 'panel fiber not found' };

      // Walk up to find MarketDepthPanel function component
      let current = panelFiber;
      for (let i = 0; i < 20; i++) {
        if (!current) break;
        if (current.type && typeof current.type === 'function') {
          const name = current.type.name || '';
          if (name === 'MarketDepthPanel') {
            // Read memoizedState (hooks)
            let hook = current.memoizedState;
            let hookIdx = 0;
            const hooks = [];
            while (hook && hookIdx < 15) {
              const val = hook.memoizedState;
              let desc;
              if (val === null) desc = 'null';
              else if (val === undefined) desc = 'undefined';
              else if (typeof val === 'object' && val !== null) {
                try { desc = JSON.stringify(val).substring(0, 300); } catch { desc = '[circular]'; }
              } else {
                desc = String(val);
              }
              hooks.push({ idx: hookIdx, desc });
              hook = hook.next;
              hookIdx++;
            }
            return { component: name, hooks };
          }
        }
        current = current.return;
      }

      return { error: 'MarketDepthPanel not found in fiber tree' };
    });

    console.log('\n=== REACT COMPONENT STATE ===');
    console.log(JSON.stringify(storeData, null, 2));

    // ── Check depth value specifically ──
    const depthCheck = await page.evaluate(() => {
      const findFiber = (el) => {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
        return key ? el[key] : null;
      };

      const spans = Array.from(document.querySelectorAll('span'));
      const heading = spans.find(s => s.textContent.trim() === 'Market Depth');
      const panelDiv = heading.closest('div[class*="bg-fw-surface"]');
      const fiber = findFiber(panelDiv);

      // Find any component that has useDepth hook result
      let current = fiber;
      for (let i = 0; i < 30; i++) {
        if (!current) break;
        if (current.type && typeof current.type === 'function') {
          const name = current.type.name || '';
          if (name === 'MarketDepthPanel') {
            // The hooks in order based on our source code:
            // useAppStore (selector), useDepth, useMarketStore (quote), useMarketStore (status), useTradingStore
            // Each zustand hook = 1 memoizedState
            let hook = current.memoizedState;
            let idx = 0;
            const results = {};
            while (hook && idx < 8) {
              const val = hook.memoizedState;
              if (idx === 0) results.activeSymbol = JSON.stringify(val)?.substring(0, 200);
              if (idx === 1) results.liveDepth = JSON.stringify(val)?.substring(0, 300);
              if (idx === 2) results.quote = JSON.stringify(val)?.substring(0, 200);
              if (idx === 3) results.marketStatus = JSON.stringify(val)?.substring(0, 100);
              hook = hook.next;
              idx++;
            }
            return results;
          }
        }
        current = current.return;
      }
      return { error: 'not found' };
    });

    console.log('\n=== DEPTH HOOK VALUES ===');
    console.log(JSON.stringify(depthCheck, null, 2));

    // ── WS frames analysis ──
    console.log('\n=== WEBSOCKET FRAMES (' + wsFrames.length + ' total) ===');
    const depthFrames = wsFrames.filter(f => f.type === 'depth');
    const quoteFrames = wsFrames.filter(f => f.type === 'quote');
    const statusFrames = wsFrames.filter(f => f.type === 'market_status');
    console.log('  depth frames:', depthFrames.length);
    console.log('  quote frames:', quoteFrames.length);
    console.log('  status frames:', statusFrames.length);
    if (depthFrames.length > 0) {
      console.log('  First depth frame:', JSON.stringify(depthFrames[0]).substring(0, 500));
    }
    if (quoteFrames.length > 0) {
      console.log('  Sample quote frame:', JSON.stringify(quoteFrames[0]).substring(0, 300));
    }

    // ── Check the active token being subscribed for depth ──
    const subscriptions = await page.evaluate(() => {
      // Check what subscribe_depth messages were sent
      return { info: 'Check WS SENT logs above for subscribe_depth calls' };
    });

    await browser.close();
    console.log('\nDone.');
  } catch (err) {
    console.error('ERROR:', err.message, err.stack);
    if (browser) await browser.close();
  }
}

run();
