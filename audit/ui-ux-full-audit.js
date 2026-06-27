/**
 * FundedWealth Terminal — Full UI/UX Audit (Comprehensive)
 * Run: node audit/ui-ux-full-audit.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'ui-audit-screenshots');
const issues = [];
const componentAudits = [];

function addIssue(severity, component, issue, details) {
  issues.push({ severity, component, issue, details });
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function setupPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0,150)); });

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/account')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ balance:1000000, margin:500000, usedMargin:120000, totalPnl:15200, dayPnl:3400, challenge:{initialBalance:1000000,phase:'Phase 1'}}) });
    if (url.includes('/api/positions')) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    if (url.includes('/api/orders')) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    if (url.includes('/api/trades')) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    if (url.includes('/api/market/option-chain')) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    if (url.includes('/api/market/expiries')) return route.fulfill({ status:200, contentType:'application/json', body:'["2026-06-25","2026-07-02"]' });
    if (url.includes('/api/market/history')) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    if (url.includes('/api/instruments')) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    return route.fulfill({ status:200, contentType:'application/json', body:'{}' });
  });
  await page.route('**/auth/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{"authenticated":true}' }));

  await page.goto(BASE_URL, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForTimeout(7000);
  return { page, context, errors };
}

async function auditTopBar(page) {
  console.log('\n📌 TopBar audit...');
  const header = await page.$('header');
  if (!header) { addIssue('P0','TopBar','Header not found',''); return; }
  const box = await header.boundingBox();
  const data = await page.evaluate(() => {
    const h = document.querySelector('header');
    if (!h) return null;
    const brand = h.querySelector('[data-brand]');
    const buttons = h.querySelectorAll('button');
    const cs = getComputedStyle(h);
    return {
      height: h.offsetHeight, width: h.offsetWidth,
      hasBrand: !!brand, brandText: brand?.innerText || '',
      buttonCount: buttons.length,
      bg: cs.backgroundColor, borderBottom: cs.borderBottom,
      hasAccountMetrics: h.innerText.includes('₹'),
      hasWorkspaceTabs: h.innerText.includes('IDX'),
    };
  });
  if (data) {
    componentAudits.push({ name:'TopBar', score:9, visible:true, details: data });
    if (data.height > 60) addIssue('P2','TopBar','Header too tall','Height: '+data.height+'px, expected ~48px');
    if (!data.hasBrand) addIssue('P1','TopBar','Brand/logo not visible','');
    if (!data.hasWorkspaceTabs) addIssue('P1','TopBar','Workspace tabs missing','');
    if (!data.hasAccountMetrics) addIssue('P2','TopBar','Account metrics not showing','');
    console.log(`   Height: ${data.height}px, Buttons: ${data.buttonCount}, Brand: ${data.hasBrand}`);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-topbar.png'), clip: { x:0, y:0, width:1920, height: box?.height || 50 } });
}

async function auditWatchlist(page) {
  console.log('\n📋 Watchlist audit...');
  const data = await page.evaluate(() => {
    // Find the watchlist panel (first child of main flex after header)
    const allDivs = document.querySelectorAll('div[style*="width"]');
    let wlPanel = null;
    allDivs.forEach(d => {
      if (d.className.includes('border-r') && d.style.width && parseInt(d.style.width) < 400) wlPanel = d;
    });
    if (!wlPanel) return null;
    const tabs = wlPanel.querySelectorAll('button');
    const items = wlPanel.querySelectorAll('[draggable="true"]');
    const searchInput = wlPanel.querySelector('input');
    const cs = getComputedStyle(wlPanel);
    return {
      width: wlPanel.offsetWidth, height: wlPanel.offsetHeight,
      tabCount: tabs.length, itemCount: items.length,
      hasSearch: !!searchInput, bg: cs.backgroundColor,
      text: wlPanel.innerText.slice(0, 300),
      hasAddButton: wlPanel.innerText.includes('Add Symbol'),
    };
  });
  if (!data) { addIssue('P1','Watchlist','Watchlist panel not found',''); componentAudits.push({name:'Watchlist',score:0,visible:false}); return; }
  
  let score = 7;
  if (data.hasSearch) score += 1;
  if (data.hasAddButton) score += 1;
  if (data.itemCount > 0) score += 1;
  componentAudits.push({ name:'Watchlist', score: Math.min(10,score), visible:true, details:data });

  if (!data.hasSearch) addIssue('P1','Watchlist','No search/filter input','Users need to filter watchlist items');
  if (data.itemCount === 0) addIssue('P2','Watchlist','No items visible','Watchlist should show default symbols');
  if (data.width < 160) addIssue('P1','Watchlist','Too narrow','Width: '+data.width+'px');
  console.log(`   Size: ${data.width}x${data.height}, Items: ${data.itemCount}, Tabs: ${data.tabCount}`);
}

async function auditChartPanel(page) {
  console.log('\n📈 Chart Panel audit...');
  const data = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { hasCanvas: false };
    const parent = canvas.closest('div');
    const controls = parent ? parent.querySelectorAll('button') : [];
    return {
      hasCanvas: true,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      displayWidth: canvas.offsetWidth, displayHeight: canvas.offsetHeight,
      controlCount: controls.length,
      parentText: parent?.innerText?.slice(0, 200) || '',
    };
  });
  if (!data.hasCanvas) {
    addIssue('P0','ChartPanel','No chart canvas rendered','TradingView chart missing');
    componentAudits.push({name:'ChartPanel',score:2,visible:false});
  } else {
    let score = 7;
    if (data.displayWidth > 500) score += 1;
    if (data.displayHeight > 300) score += 1;
    if (data.controlCount > 3) score += 1;
    componentAudits.push({name:'ChartPanel',score:Math.min(10,score),visible:true,details:data});
    if (data.displayWidth < 400) addIssue('P1','ChartPanel','Chart too small','Width: '+data.displayWidth+'px');
    console.log(`   Canvas: ${data.displayWidth}x${data.displayHeight}, Controls: ${data.controlCount}`);
  }
}

async function auditOrderPanel(page) {
  console.log('\n🛒 Order Panel audit...');
  const data = await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div[style*="width"]');
    let panel = null;
    allDivs.forEach(d => {
      if (d.className.includes('border-l') && d.style.width && parseInt(d.style.width) < 450) panel = d;
    });
    if (!panel) return null;
    const buttons = panel.querySelectorAll('button');
    const inputs = panel.querySelectorAll('input, select');
    const text = panel.innerText;
    return {
      width: panel.offsetWidth, height: panel.offsetHeight,
      buttonCount: buttons.length, inputCount: inputs.length,
      hasBuyBtn: text.includes('BUY'), hasSellBtn: text.includes('SELL'),
      hasQty: text.toLowerCase().includes('qty') || text.toLowerCase().includes('quantity'),
      hasPrice: text.toLowerCase().includes('price'),
      hasOrderType: text.includes('MARKET') || text.includes('LIMIT'),
      hasRiskMonitor: text.includes('Risk Monitor') || text.includes('Daily Loss'),
      text: text.slice(0, 400),
    };
  });
  if (!data) { addIssue('P1','OrderPanel','Order panel not found',''); componentAudits.push({name:'OrderPanel',score:0,visible:false}); return; }

  let score = 6;
  if (data.hasBuyBtn && data.hasSellBtn) score += 2;
  if (data.hasOrderType) score += 1;
  if (data.hasRiskMonitor) score += 1;
  componentAudits.push({name:'OrderPanel',score:Math.min(10,score),visible:true,details:data});

  if (!data.hasBuyBtn || !data.hasSellBtn) addIssue('P0','OrderPanel','Buy/Sell buttons missing','Critical trading function');
  if (!data.hasOrderType) addIssue('P1','OrderPanel','Order type selector missing','');
  if (data.inputCount < 2) addIssue('P1','OrderPanel','Insufficient input fields','Expected qty + price inputs');
  console.log(`   Size: ${data.width}x${data.height}, Inputs: ${data.inputCount}, Buttons: ${data.buttonCount}`);
  console.log(`   Buy: ${data.hasBuyBtn}, Sell: ${data.hasSellBtn}, Risk: ${data.hasRiskMonitor}`);
}

async function auditBottomPanel(page) {
  console.log('\n📊 Bottom Panel audit...');
  const data = await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div[style*="height"]');
    let panel = null;
    allDivs.forEach(d => {
      if (d.className.includes('border-t') && d.style.height && parseInt(d.style.height) < 450) panel = d;
    });
    if (!panel) return null;
    const tabs = panel.querySelectorAll('button');
    const table = panel.querySelector('table');
    const text = panel.innerText;
    return {
      width: panel.offsetWidth, height: panel.offsetHeight,
      tabCount: tabs.length,
      hasTable: !!table,
      hasPositionsTab: text.includes('Positions'),
      hasOrdersTab: text.includes('Orders'),
      hasTradesTab: text.includes('Trades') || text.includes('Trade Book'),
      hasEmptyState: text.includes('No open') || text.includes('No pending') || text.includes('empty'),
      text: text.slice(0, 300),
    };
  });
  if (!data) { addIssue('P1','BottomPanel','Bottom panel not found',''); componentAudits.push({name:'BottomPanel',score:0,visible:false}); return; }

  let score = 6;
  if (data.hasPositionsTab) score += 1;
  if (data.hasOrdersTab) score += 1;
  if (data.hasTradesTab) score += 1;
  if (data.hasEmptyState) score += 1;
  componentAudits.push({name:'BottomPanel',score:Math.min(10,score),visible:true,details:data});

  if (!data.hasPositionsTab) addIssue('P1','BottomPanel','Positions tab missing','');
  if (!data.hasOrdersTab) addIssue('P1','BottomPanel','Orders tab missing','');
  console.log(`   Size: ${data.width}x${data.height}, Tabs: ${data.tabCount}, Table: ${data.hasTable}`);
}

async function auditStatusBar(page) {
  console.log('\n📡 Status Bar audit...');
  const data = await page.evaluate(() => {
    // Status bar is the last child - h-[22px]
    const allDivs = document.querySelectorAll('div');
    let bar = null;
    allDivs.forEach(d => {
      if (d.className.includes('h-[22px]') || (d.offsetHeight <= 25 && d.offsetHeight >= 18 && d.className.includes('border-t'))) bar = d;
    });
    if (!bar) return null;
    const text = bar.innerText;
    return {
      height: bar.offsetHeight, width: bar.offsetWidth,
      hasBrokerStatus: text.includes('Broker'),
      hasWsStatus: text.includes('WS'),
      hasMarketStatus: text.includes('Market') || text.includes('Closed') || text.includes('Open'),
      hasWorkspace: text.includes('Workspace'),
      text: text.slice(0, 200),
    };
  });
  if (!data) { componentAudits.push({name:'StatusBar',score:5,visible:false}); return; }
  componentAudits.push({name:'StatusBar',score:8,visible:true,details:data});
  if (!data.hasBrokerStatus) addIssue('P2','StatusBar','Broker connection status not shown','');
  console.log(`   Height: ${data.height}px, Market: ${data.hasMarketStatus}, WS: ${data.hasWsStatus}`);
}

async function auditRiskWidget(page) {
  console.log('\n🛡️ Risk Widget audit...');
  const data = await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    let widget = null;
    allDivs.forEach(d => {
      if (d.innerText && d.innerText.includes('Risk Monitor') && d.offsetHeight < 200) widget = d;
    });
    if (!widget) return null;
    return {
      height: widget.offsetHeight, width: widget.offsetWidth,
      text: widget.innerText.slice(0, 300),
      hasDailyLoss: widget.innerText.includes('Daily Loss'),
      hasDrawdown: widget.innerText.includes('Drawdown'),
      hasTarget: widget.innerText.includes('Target'),
      hasProgressBars: widget.querySelectorAll('[class*="rounded-full"]').length > 0,
    };
  });
  if (!data) { componentAudits.push({name:'RiskWidget',score:5,visible:false}); return; }
  let score = 7;
  if (data.hasDailyLoss) score += 1;
  if (data.hasDrawdown) score += 1;
  if (data.hasTarget) score += 1;
  componentAudits.push({name:'RiskWidget',score:Math.min(10,score),visible:true,details:data});
  console.log(`   Daily Loss: ${data.hasDailyLoss}, Drawdown: ${data.hasDrawdown}, Target: ${data.hasTarget}`);
}

async function auditOptionChain(page) {
  console.log('\n⛓️ Option Chain audit...');
  // Switch to Options workspace to show OC
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    btns.forEach(b => { if (b.textContent === 'OPT') b.click(); });
  });
  await page.waitForTimeout(2000);
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasOC = text.includes('OPTION CHAIN') || text.includes('STRIKE');
    const ocPanel = document.querySelector('table');
    return {
      hasOC,
      hasTable: !!ocPanel,
      hasSymbolSelector: text.includes('NIFTY') && text.includes('BANKNIFTY'),
      hasExpirySelector: text.includes('2026'),
      hasEmptyState: text.includes('Waiting for option chain') || text.includes('Loading'),
      text: text.slice(0, 200),
    };
  });
  let score = 6;
  if (data.hasOC) score += 2;
  if (data.hasSymbolSelector) score += 1;
  if (data.hasExpirySelector) score += 1;
  componentAudits.push({name:'OptionChain',score:Math.min(10,score),visible:data.hasOC,details:data});
  if (!data.hasOC) addIssue('P1','OptionChain','Option chain not visible in options workspace','');
  console.log(`   Visible: ${data.hasOC}, Table: ${data.hasTable}, Empty: ${data.hasEmptyState}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-option-chain.png') });

  // Switch back to index
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    btns.forEach(b => { if (b.textContent === 'IDX') b.click(); });
  });
  await page.waitForTimeout(1000);
}

async function auditMarketDepth(page) {
  console.log('\n📊 Market Depth audit...');
  // Enable DOM panel
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    btns.forEach(b => { if (b.textContent === 'DOM') b.click(); });
  });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasDOM = text.includes('MARKET DEPTH') || text.includes('BID') || text.includes('ASK') || text.includes('Bid') || text.includes('Ask');
    return {
      hasDOM,
      hasBidAsk: (text.includes('Bid') || text.includes('BID')) && (text.includes('Ask') || text.includes('ASK')),
      hasEmptyState: text.includes('No depth') || text.includes('Waiting') || text.includes('Select a symbol'),
    };
  });
  componentAudits.push({name:'MarketDepth',score: data.hasDOM ? 8 : 5,visible:data.hasDOM,details:data});
  console.log(`   Visible: ${data.hasDOM}, Bid/Ask: ${data.hasBidAsk}`);
}

async function auditThemeConsistency(page) {
  console.log('\n🎨 Theme Consistency audit...');
  const data = await page.evaluate(() => {
    let whiteCount = 0; let offColorCount = 0;
    const bgColors = new Set(); const textColors = new Set(); const borderColors = new Set();
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bgColors.add(bg);
      if (bg === 'rgb(255, 255, 255)') whiteCount++;
      if (el.textContent?.trim()) textColors.add(cs.color);
      const bc = cs.borderTopColor;
      if (bc !== 'rgb(0, 0, 0)' && cs.borderTopWidth !== '0px') borderColors.add(bc);
    });
    return { whiteCount, bgColors: [...bgColors], textColors: [...textColors], borderColors: [...borderColors],
      bgCount: bgColors.size, textCount: textColors.size, borderCount: borderColors.size };
  });
  if (data.whiteCount > 0) addIssue('P1','Theme',`${data.whiteCount} white backgrounds in dark mode`,'Breaks dark theme immersion');
  if (data.bgCount > 15) addIssue('P2','Theme',`Too many background color variants (${data.bgCount})`,'Consider consolidating to design tokens');
  console.log(`   BG variants: ${data.bgCount}, Text: ${data.textCount}, Border: ${data.borderCount}, White: ${data.whiteCount}`);
  return data;
}

async function auditTypography(page) {
  console.log('\n📝 Typography audit...');
  const data = await page.evaluate(() => {
    const sizes = new Set(); const weights = new Set(); const families = new Set();
    document.querySelectorAll('span,p,div,td,th,button,label,h1,h2,h3').forEach(el => {
      if (el.textContent?.trim() && el.children.length === 0) {
        const cs = getComputedStyle(el);
        sizes.add(cs.fontSize); weights.add(cs.fontWeight);
        families.add(cs.fontFamily.split(',')[0].trim().replace(/"/g,''));
      }
    });
    return { sizes:[...sizes].sort(), weights:[...weights], families:[...families],
      sizeCount:sizes.size, weightCount:weights.size, familyCount:families.size };
  });
  if (data.sizeCount > 10) addIssue('P2','Typography',`${data.sizeCount} unique font sizes — consider a type scale`,'Sizes: '+data.sizes.join(', '));
  if (data.familyCount > 3) addIssue('P2','Typography',`${data.familyCount} font families — too many`,'');
  console.log(`   Sizes: ${data.sizeCount}, Weights: ${data.weightCount}, Families: ${data.familyCount}`);
  console.log(`   Families: ${data.families.join(', ')}`);
  return data;
}

async function auditAccessibility(page) {
  console.log('\n♿ Accessibility audit...');
  const data = await page.evaluate(() => {
    const issues = [];
    // Buttons without labels
    document.querySelectorAll('button').forEach(btn => {
      if (!btn.textContent?.trim() && !btn.getAttribute('aria-label') && !btn.title)
        issues.push({type:'button-no-label', html:btn.outerHTML.slice(0,80)});
    });
    // Images without alt
    document.querySelectorAll('img').forEach(img => {
      if (!img.alt && !img.getAttribute('aria-label'))
        issues.push({type:'img-no-alt', src:img.src.slice(0,50)});
    });
    // Inputs without labels
    document.querySelectorAll('input,select,textarea').forEach(inp => {
      if (!inp.getAttribute('aria-label') && !inp.placeholder && !document.querySelector(`label[for="${inp.id}"]`))
        issues.push({type:'input-no-label', html:inp.outerHTML.slice(0,80)});
    });
    // Focus visible check
    const focusable = document.querySelectorAll('button,a,[tabindex],input,select');
    // Color contrast (basic heuristic)
    let lowContrastCount = 0;
    document.querySelectorAll('span,p,td').forEach(el => {
      const cs = getComputedStyle(el);
      if (el.textContent?.trim() && cs.color.includes('rgb')) {
        const m = cs.color.match(/\d+/g);
        if (m && parseInt(m[0]) < 80 && parseInt(m[1]) < 80 && parseInt(m[2]) < 80) lowContrastCount++;
      }
    });
    return { issues, focusableCount: focusable.length, lowContrastCount, totalIssues: issues.length };
  });
  data.issues.slice(0,15).forEach(i => addIssue('P2','Accessibility',i.type, i.html || i.src || ''));
  if (data.lowContrastCount > 5) addIssue('P1','Accessibility',`${data.lowContrastCount} elements with potentially low contrast`,'May not meet WCAG AA');
  console.log(`   Issues: ${data.totalIssues}, Focusable: ${data.focusableCount}, Low contrast: ${data.lowContrastCount}`);
  return data;
}

async function auditResponsive(page) {
  console.log('\n📱 Responsive audit...');
  const results = {};
  const viewports = [
    ['Desktop 1920', 1920, 1080],
    ['Desktop 1440', 1440, 900],
    ['Laptop 1366', 1366, 768],
    ['Laptop 1280', 1280, 720],
    ['Tablet Landscape', 1024, 768],
    ['Tablet Portrait', 768, 1024],
    ['Mobile', 375, 812],
  ];
  for (const [name, w, h] of viewports) {
    try {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `responsive-${w}x${h}.png`) });
      const check = await page.evaluate(() => {
        const hOver = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        const header = document.querySelector('header');
        const headerClipped = header ? header.scrollWidth > header.offsetWidth : false;
        // Check if panels overlap
        let clipped = 0;
        document.querySelectorAll('div[style*="width"]').forEach(d => {
          const r = d.getBoundingClientRect();
          if (r.right > window.innerWidth + 5 && r.width > 50) clipped++;
        });
        return { hOver, headerClipped, clippedPanels: clipped, vw: window.innerWidth };
      });
      results[name] = { w, h, ...check };
      if (check.hOver && w >= 768) addIssue(w >= 1024 ? 'P0' : 'P1', 'Responsive', `Horizontal overflow at ${name} (${w}px)`, `${check.clippedPanels} panels clipped`);
      if (check.clippedPanels > 0 && w < 768) addIssue('P0', 'Mobile', `${check.clippedPanels} panels overflow on ${name}`, 'No mobile layout adaptation');
      console.log(`   ${name} (${w}x${h}): overflow=${check.hOver}, clipped=${check.clippedPanels}`);
    } catch(e) { console.log(`   ${name}: error - ${e.message.slice(0,40)}`); }
  }
  // Reset
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(1000);
  return results;
}

async function auditLoadingEmptyErrorStates(page) {
  console.log('\n⏳ State audit (Loading/Empty/Error)...');
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasLoadingIndicator: text.includes('Loading') || !!document.querySelector('[class*="animate-spin"]'),
      emptyStates: [],
      hasNoPositions: text.includes('No open positions') || text.includes('No positions'),
      hasNoOrders: text.includes('No pending orders') || text.includes('No orders'),
      hasChartEmpty: text.includes('No data') || text.includes('Select a symbol'),
      hasOptionChainEmpty: text.includes('Waiting for option chain'),
    };
  });
  // Check empty state design quality
  if (!data.hasNoPositions && !data.hasNoOrders) {
    addIssue('P2', 'EmptyStates', 'Empty state messages not visible for positions/orders', 'Should show helpful empty states');
  }
  console.log(`   Loading: ${data.hasLoadingIndicator}, Positions empty: ${data.hasNoPositions}, Orders empty: ${data.hasNoOrders}`);
  return data;
}

async function auditSearchModal(page) {
  console.log('\n🔍 Search Modal audit...');
  // Try Ctrl+K to open search
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => {
    const modal = document.querySelector('[class*="fixed"]') || document.querySelector('[role="dialog"]');
    if (!modal || !modal.querySelector('input')) return { visible: false };
    return {
      visible: true,
      hasInput: !!modal.querySelector('input'),
      hasBackdrop: !!document.querySelector('[class*="bg-black"]') || !!document.querySelector('[class*="backdrop"]'),
      placeholder: modal.querySelector('input')?.placeholder || '',
    };
  });
  if (data.visible) {
    componentAudits.push({name:'SearchModal',score:8,visible:true,details:data});
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-search-modal.png') });
    // Close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    componentAudits.push({name:'SearchModal',score:5,visible:false});
    addIssue('P2','SearchModal','Ctrl+K did not open search modal','Keyboard shortcut may not be working');
  }
  console.log(`   Visible: ${data.visible}, Has input: ${data.hasInput || false}`);
}

async function runFullAudit() {
  ensureDir(SCREENSHOT_DIR);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FundedWealth Terminal — Comprehensive UI/UX Audit');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════');

  const browser = await chromium.launch({ headless: true });
  const { page, context, errors } = await setupPage(browser);

  try {
    // Verify app loaded
    const rootCheck = await page.evaluate(() => document.getElementById('root')?.children.length || 0);
    if (rootCheck === 0) {
      addIssue('P0','App','React app failed to mount','App crashed on load. Errors: '+errors.slice(0,3).join(' | '));
      console.log('\n❌ App failed to mount. Errors:', errors.slice(0,3));
    } else {
      console.log('\n✅ App mounted successfully');
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00-full-terminal.png') });

    // Run all audits
    await auditTopBar(page);
    await auditWatchlist(page);
    await auditChartPanel(page);
    await auditOrderPanel(page);
    await auditBottomPanel(page);
    await auditStatusBar(page);
    await auditRiskWidget(page);
    await auditOptionChain(page);
    await auditMarketDepth(page);
    await auditSearchModal(page);
    const theme = await auditThemeConsistency(page);
    const typo = await auditTypography(page);
    const a11y = await auditAccessibility(page);
    const responsive = await auditResponsive(page);
    const states = await auditLoadingEmptyErrorStates(page);

    // Calculate final score
    const p0 = issues.filter(i => i.severity === 'P0').length;
    const p1 = issues.filter(i => i.severity === 'P1').length;
    const p2 = issues.filter(i => i.severity === 'P2').length;
    const visibleComponents = componentAudits.filter(c => c.visible);
    const avgComponentScore = visibleComponents.length > 0
      ? visibleComponents.reduce((a,c) => a + c.score, 0) / visibleComponents.length : 0;
    let finalScore = Math.round(avgComponentScore * 10) - (p0 * 12) - (p1 * 4) - (p2 * 0.5);
    finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));

    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log(`  📊 FINAL UI/UX SCORE: ${finalScore}/100`);
    console.log(`  P0 Critical: ${p0} | P1 Major: ${p1} | P2 Minor: ${p2}`);
    console.log(`  Components visible: ${visibleComponents.length}/${componentAudits.length}`);
    console.log(`  Avg component score: ${avgComponentScore.toFixed(1)}/10`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Save full results
    const results = {
      timestamp: new Date().toISOString(), finalScore, p0, p1, p2,
      componentAudits, issues, errors: errors.slice(0,20),
      theme, typography: typo, accessibility: a11y, responsive, states,
    };
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'full-audit-results.json'), JSON.stringify(results, null, 2));
    console.log('💾 Full results saved to audit/ui-audit-screenshots/full-audit-results.json');

  } catch (err) {
    console.error('❌ Audit error:', err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error.png') }).catch(()=>{});
  } finally {
    await browser.close();
  }
}

runFullAudit().catch(console.error);
