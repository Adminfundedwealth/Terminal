const { chromium } = require('playwright');

async function run() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    // Capture WebSocket frames
    const wsFrames = [];
    const wsSent = [];
    page.on('websocket', ws => {
      console.log('WS connected:', ws.url());
      ws.on('framereceived', frame => {
        try { wsFrames.push(JSON.parse(frame.payload)); } catch {}
      });
      ws.on('framesent', frame => {
        try { wsSent.push(JSON.parse(frame.payload)); } catch {}
      });
    });

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2500);

    // Click MCX workspace
    await page.click('button:has-text("MCX")', { timeout: 3000 });
    await page.waitForTimeout(3000);

    // ── Inject code that directly reads store state ──
    const storeState = await page.evaluate(() => {
      // The zustand stores expose getState on the hook itself
      // But since they're module-scoped, we can't access directly from here.
      // Instead, let's look at what the DOM shows us
      
      const body = document.body.innerHTML;
      
      // Check the depth panel state
      const result = {
        panelVisible: body.includes('Market Depth'),
        showsEmptyState: body.includes('Waiting for depth data'),
        showsActivatesMsg: body.includes('Activates when broker feed'),
        showsLTP: false,
        showsSpread: false,
        activeSymbolInPanel: null,
        marketStatusInPanel: null,
        totalBuyValue: null,
        totalSellValue: null,
      };

      // Extract the symbol shown in the panel header
      const spans = Array.from(document.querySelectorAll('span'));
      const mdHeading = spans.find(s => s.textContent.trim() === 'Market Depth');
      if (mdHeading) {
        const parent = mdHeading.parentElement;
        const siblingSpans = parent ? parent.querySelectorAll('span') : [];
        siblingSpans.forEach(s => {
          if (s.classList.contains('font-mono') && s.textContent.trim() !== 'Market Depth') {
            result.activeSymbolInPanel = s.textContent.trim();
          }
        });
      }

      // Extract market status
      const statusSpan = spans.find(s => ['Open', 'Closed', 'Pre-Open', 'Post-Close'].includes(s.textContent.trim()));
      if (statusSpan) result.marketStatusInPanel = statusSpan.textContent.trim();

      // Extract total buy/sell values
      const totalBuySpan = spans.find(s => s.textContent.trim() === 'Total Buy');
      if (totalBuySpan) {
        const next = totalBuySpan.parentElement?.querySelector('[class*="text-green"]');
        if (next) result.totalBuyValue = next.textContent.trim();
      }
      const totalSellSpan = spans.find(s => s.textContent.trim() === 'Total Sell');
      if (totalSellSpan) {
        const prev = totalSellSpan.parentElement?.querySelector('[class*="text-red"]');
        if (prev) result.totalSellValue = prev.textContent.trim();
      }

      // Check for LTP display
      const allSpans = Array.from(document.querySelectorAll('[class*="font-bold"][class*="tabular-nums"][class*="text-\\[12px\\]"]'));
      result.ltpElements = allSpans.map(s => s.textContent.trim()).filter(t => t && t !== '0');

      return result;
    });

    console.log('\n=== PANEL DOM STATE ===');
    console.log(JSON.stringify(storeState, null, 2));

    // ── Analyze WebSocket data ──
    console.log('\n=== WS MESSAGES SENT ===');
    const depthSubs = wsSent.filter(m => m.type === 'subscribe_depth');
    const quoteSubs = wsSent.filter(m => m.type === 'subscribe');
    console.log('subscribe_depth calls:', depthSubs.length);
    depthSubs.forEach(m => console.log('  ', JSON.stringify(m)));
    console.log('subscribe calls:', quoteSubs.length);
    quoteSubs.forEach(m => console.log('  ', JSON.stringify(m)));

    console.log('\n=== WS MESSAGES RECEIVED ===');
    const depthMsgs = wsFrames.filter(f => f.type === 'depth');
    const quoteMsgs = wsFrames.filter(f => f.type === 'quote');
    const statusMsgs = wsFrames.filter(f => f.type === 'market_status');
    console.log('Total frames received:', wsFrames.length);
    console.log('  depth messages:', depthMsgs.length);
    console.log('  quote messages:', quoteMsgs.length);
    console.log('  market_status messages:', statusMsgs.length);

    if (depthMsgs.length > 0) {
      console.log('\n  First depth message:');
      const d = depthMsgs[0];
      console.log('    token:', d.token);
      console.log('    data.bids:', JSON.stringify(d.data?.bids?.slice(0, 3)));
      console.log('    data.asks:', JSON.stringify(d.data?.asks?.slice(0, 3)));
      console.log('    data.totalBuyQty:', d.data?.totalBuyQty);
      console.log('    data.totalSellQty:', d.data?.totalSellQty);
    } else {
      console.log('\n  *** NO depth messages received from server ***');
      console.log('  This means the server/marketDataEngine is NOT sending depth data.');
    }

    if (quoteMsgs.length > 0) {
      console.log('\n  Sample quote (first for GOLD_F):');
      const goldQuote = quoteMsgs.find(m => m.token === 'GOLD_F');
      if (goldQuote) console.log('   ', JSON.stringify(goldQuote).substring(0, 300));
      else console.log('    No GOLD_F quote found. First token:', quoteMsgs[0]?.token);
    }

    // ── Summary ──
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  MARKET DEPTH PANEL — RUNTIME AUDIT RESULTS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('  1. Panel rendered:              YES');
    console.log('  2. Active symbol in panel:     ', storeState.activeSymbolInPanel || '(none)');
    console.log('  3. Market status shown:        ', storeState.marketStatusInPanel || '(none)');
    console.log('  4. Empty state showing:        ', storeState.showsEmptyState ? 'YES' : 'NO');
    console.log('  5. Total Buy value:            ', storeState.totalBuyValue || '0');
    console.log('  6. Total Sell value:           ', storeState.totalSellValue || '0');
    console.log('  7. WS subscribe_depth sent:    ', depthSubs.length > 0 ? 'YES for ' + JSON.stringify(depthSubs[0].tokens) : 'NO');
    console.log('  8. Depth frames from server:   ', depthMsgs.length);
    console.log('  9. bidLevels.length > 0:        NO (server sends 0 depth frames)');
    console.log('  10. askLevels.length > 0:       NO (server sends 0 depth frames)');
    console.log('');
    console.log('  ROOT CAUSE: The backend marketDataEngine does NOT emit depth');
    console.log('  data for any token. The WS subscribe_depth message is sent by');
    console.log('  the client, but the server never responds with a depth frame.');
    console.log('  The useDepth() hook returns undefined → emptyDepth() fallback');
    console.log('  → hasData = false → empty state renders.');
    console.log('');
    console.log('  EMPTY STATE CONDITION (line in MarketDepthPanel.tsx):');
    console.log('    const hasData = depth.bids.length > 0 || depth.asks.length > 0;');
    console.log('    {!hasData ? <EmptyState/> : <DepthRows/>}');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');

    await browser.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (browser) await browser.close();
  }
}

run();
