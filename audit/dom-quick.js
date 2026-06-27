const { chromium } = require('playwright');

async function run() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    
    console.log('Loading...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);
    
    console.log('Clicking MCX...');
    await page.click('button:has-text("MCX")', { timeout: 3000 });
    await page.waitForTimeout(1500);
    
    console.log('Taking screenshot...');
    await page.screenshot({ path: 'audit/dom-audit/01-mcx.png' });
    
    console.log('Extracting state...');
    const result = await page.evaluate(() => {
      const body = document.body.innerHTML;
      const text = document.body.innerText;
      return {
        hasMarketDepth: body.includes('Market Depth'),
        emptyState: body.includes('Waiting for depth data'),
        activatesWhen: body.includes('Activates when broker feed'),
        hasBidQtyHeader: body.includes('Bid Qty'),
        hasAskQtyHeader: body.includes('Ask Qty'),
        hasTotalBuy: body.includes('Total Buy'),
        hasTotalSell: body.includes('Total Sell'),
        hasSpreadRow: body.includes('Spread'),
        bodyTextFirst500: text.substring(0, 500),
      };
    });
    console.log(JSON.stringify(result, null, 2));
    
    // Try to get the depth panel HTML
    const panelHtml = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      const heading = spans.find(s => s.textContent.trim() === 'Market Depth');
      if (!heading) return 'HEADING_NOT_FOUND';
      // Walk up to find the panel container
      let el = heading.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!el) break;
        if (el.children.length > 3) return el.outerHTML.substring(0, 3000);
        el = el.parentElement;
      }
      return heading.parentElement ? heading.parentElement.parentElement.outerHTML.substring(0, 2000) : 'NO_PARENT';
    });
    console.log('\n=== PANEL HTML ===');
    console.log(panelHtml);
    
    await browser.close();
    console.log('\nDone.');
  } catch (err) {
    console.error('ERROR:', err.message);
    if (browser) await browser.close();
  }
}

run();
