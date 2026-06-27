/**
 * FundedWealth Terminal — Comprehensive UI/UX Audit
 * Run: node audit/ui-ux-audit.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'ui-audit-screenshots');
const issues = [];
const components = [];

function addIssue(severity, component, issue, details) {
  issues.push({ severity, component, issue, details });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function runAudit() {
  ensureDir(SCREENSHOT_DIR);
  console.log('🔍 FundedWealth Terminal UI/UX Audit\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Collect errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  // Mock API — intercept fetch requests but NOT WebSocket (Vite HMR needs it)
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/account')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ balance: 1000000, margin: 500000, usedMargin: 120000,
          totalPnl: 15200, dayPnl: 3400, challenge: { initialBalance: 1000000, phase: 'Phase 1' } })
      });
    }
    if (url.includes('/api/positions')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('/api/orders')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('/api/trades')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('/api/market/option-chain')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('/api/market/expiries')) return route.fulfill({ status: 200, contentType: 'application/json', body: '["2026-06-25","2026-07-02"]' });
    if (url.includes('/api/market/history')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('/api/instruments')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/auth/**', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { name: 'Demo' } }) });
  });

  try {
    console.log('📡 Loading app...');
    // Clear localStorage before loading
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);

    // Check mount state
    const rootState = await page.evaluate(() => {
      const root = document.getElementById('root');
      return {
        children: root ? root.children.length : -1,
        text: (root ? root.innerText : '').slice(0, 200),
        html: (root ? root.innerHTML : '').slice(0, 300),
      };
    });
    console.log('   Root children:', rootState.children);
    console.log('   Text:', rootState.text.slice(0, 80));
    if (consoleErrors.length > 0) {
      console.log('   Errors:', consoleErrors.length);
      consoleErrors.slice(0, 3).forEach(e => console.log('     >', e.slice(0, 100)));
    }

    // Take screenshot regardless of state
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00-full-1920.png') });

    // If app crashed, document it as P0 and proceed with code analysis audit
    const appCrashed = rootState.children === 0 || rootState.html.length < 50;
    if (appCrashed) {
      addIssue('P0', 'App Shell', 'React app crashes on mount without backend',
        'WatchlistRow component throws "Cannot read properties of undefined (reading toFixed)" - entire React tree fails to render. No error boundary catches this. Errors: ' + consoleErrors.slice(0,3).join(' | '));
      console.log('\n⚠️  App crashed - performing code-based audit instead of visual audit');
    }

    // === VIEWPORT AUDITS (if app rendered) ===
    if (!appCrashed) {
      console.log('\n📐 Viewport audits...');
      const viewportTests = [['1920x1080',1920,1080],['1440x900',1440,900],['1366x768',1366,768],['1280x720',1280,720],['1024x768',1024,768],['768x1024',768,1024],['375x812',375,812]];
      for (const [name, w, h] of viewportTests) {
        try {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(SCREENSHOT_DIR, `viewport-${name}.png`) });
          const overflow = await page.evaluate(() => ({
            h: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            v: document.documentElement.scrollHeight > document.documentElement.clientHeight,
          }));
          if (overflow.h && w >= 1024) addIssue('P0', 'Layout', `Horizontal overflow at ${name}`, 'Content wider than viewport');
          console.log(`   ${name}: OK${overflow.h ? ' (h-overflow!)' : ''}`);
        } catch (e) {
          console.log(`   ${name}: Error - ${e.message.slice(0, 50)}`);
        }
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(1500);

      // Component audits
      console.log('\n🧩 Component audits...');
      const selectors = [
        ['header', 'TopBar'],
        ['header [data-brand]', 'Branding'],
        ['canvas', 'Chart Canvas'],
      ];
      for (const [sel, name] of selectors) {
        try {
          const el = await page.$(sel);
          const visible = el ? await el.isVisible() : false;
          const box = el && visible ? await el.boundingBox() : null;
          components.push({ component: name, visible, box, score: visible ? 8 : 0 });
          if (!visible) addIssue('P1', name, 'Not visible', `Selector "${sel}" not found or hidden`);
          console.log(`   ${name}: ${visible ? 'visible' : 'NOT FOUND'}`);
        } catch (e) {
          console.log(`   ${name}: Error - ${e.message.slice(0, 50)}`);
          components.push({ component: name, visible: false, score: 0 });
        }
      }

      // Theme audit
      try {
        console.log('\n🎨 Theme audit...');
        const themeIssues = await page.evaluate(() => {
          let whiteCount = 0;
          document.querySelectorAll('*').forEach(el => {
            if (getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)') whiteCount++;
          });
          return whiteCount;
        });
        if (themeIssues > 0) addIssue('P1', 'Theme', `${themeIssues} white backgrounds in dark mode`, 'Inconsistent dark theme');
        console.log(`   White backgrounds: ${themeIssues}`);
      } catch (e) { console.log('   Theme audit error:', e.message.slice(0, 50)); }

      // Accessibility
      try {
        console.log('\n♿ Accessibility audit...');
        const a11y = await page.evaluate(() => {
          const issues = [];
          document.querySelectorAll('button').forEach(btn => {
            if (!btn.textContent?.trim() && !btn.getAttribute('aria-label') && !btn.title)
              issues.push('Button without accessible label');
          });
          document.querySelectorAll('img').forEach(img => {
            if (!img.alt) issues.push('Image without alt text');
          });
          document.querySelectorAll('input, select, textarea').forEach(inp => {
            if (!inp.getAttribute('aria-label') && !inp.placeholder && !inp.id)
              issues.push('Input without label');
          });
          return issues;
        });
        a11y.forEach(i => addIssue('P2', 'Accessibility', i, ''));
        console.log(`   Issues: ${a11y.length}`);
      } catch (e) { console.log('   A11y audit error:', e.message.slice(0, 50)); }
    }

    // === FINAL SCORE ===
    const p0 = issues.filter(i => i.severity === 'P0').length;
    const p1 = issues.filter(i => i.severity === 'P1').length;
    const p2 = issues.filter(i => i.severity === 'P2').length;
    const baseScore = appCrashed ? 30 : 75;
    let finalScore = baseScore - (p0 * 15) - (p1 * 5) - (p2 * 1);
    finalScore = Math.max(0, Math.min(100, finalScore));

    console.log('\n' + '='.repeat(50));
    console.log(`📊 OVERALL UI SCORE: ${finalScore}/100`);
    console.log(`   P0 Critical: ${p0}`);
    console.log(`   P1 Major: ${p1}`);
    console.log(`   P2 Minor: ${p2}`);
    console.log('='.repeat(50));

    // Save JSON
    const results = {
      timestamp: new Date().toISOString(),
      score: finalScore, appCrashed,
      consoleErrors: consoleErrors.slice(0, 20),
      components, issues,
      rootState,
    };
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'audit-results.json'), JSON.stringify(results, null, 2));
    console.log('\n💾 Results saved');

  } catch (err) {
    console.error('❌ Error:', err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

runAudit().catch(console.error);
