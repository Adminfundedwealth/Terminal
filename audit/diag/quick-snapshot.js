const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const b = await chromium.launch({ headless: false });
  const p = await b.newPage();
  const logs = [];
  p.on('console', m => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); console.log(t); });
  p.on('pageerror', e => { logs.push('[PAGEERROR] ' + e.message); console.error('[PAGEERROR]', e.message); });

  await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: 'audit/diag/00-initial-state.png', fullPage: true });

  const body = await p.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log('[BODY TEXT]', body);

  const buttons = await p.evaluate(() => 
    Array.from(document.querySelectorAll('button')).map(e => e.innerText.trim()).filter(t => t).slice(0, 50)
  );
  console.log('[BUTTONS FOUND]', JSON.stringify(buttons));

  const hasCanvas = await p.evaluate(() => !!document.querySelector('canvas'));
  console.log('[HAS CANVAS]', hasCanvas);

  const url = p.url();
  console.log('[CURRENT URL]', url);

  fs.writeFileSync('audit/diag/quick-report.json', JSON.stringify({ logs, body, buttons, hasCanvas, url }, null, 2));
  console.log('Report saved.');
  await b.close();
})();
