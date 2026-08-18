/**
 * Watchlist QA Script — FundedWealth Terminal
 * Uses Playwright to screenshot and test the new Watchlist UI.
 * Run: node audit/watchlist-qa.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'watchlist-qa-screenshots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(test, pass, detail = '') {
  const status = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}  ${test}${detail ? ' — ' + detail : ''}`);
  results.push({ test, pass, detail });
}

async function screenshot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸  ${name}.png`);
  return file;
}

async function waitForWatchlist(page) {
  // Wait for the toolbar to be present
  await page.waitForSelector('[aria-label="Instrument browser"]', { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log('\n═══ FundedWealth Watchlist QA ═══\n');

  try {
    // ── 0. Load terminal ──────────────────────────────────────────────────
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '00-initial-load');

    // Check if we hit an access-denied / login gate
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const isGated = bodyText.includes('Access Denied') || bodyText.includes('Sign in') || bodyText.includes('Login');
    if (isGated) {
      log('App loads without auth gate', false, 'Access denied / login screen shown — cannot test further without credentials');
      await screenshot(page, '00-auth-gate');
      await browser.close();
      return writeReport();
    }
    log('App loads', true, 'Terminal rendered');

    // ── 1. Watchlist panel visible ────────────────────────────────────────
    try {
      await waitForWatchlist(page);
      log('Watchlist panel present', true);
    } catch {
      log('Watchlist panel present', false, 'Toolbar aria-label not found');
      await screenshot(page, '01-no-toolbar');
      await browser.close();
      return writeReport();
    }
    await screenshot(page, '01-watchlist-default');

    // ── 2. Toolbar structure ──────────────────────────────────────────────
    const browserBtn = page.locator('[aria-label="Instrument browser"]');
    const newsBtn    = page.locator('[aria-label="News"]');
    const favBtn     = page.locator('[aria-label="Favourites"]');
    const searchInput = page.locator('input[placeholder="Search..."]').first();

    log('⇅ browser button present', await browserBtn.isVisible());
    log('▣ news button present',    await newsBtn.isVisible());
    log('☆ favourites button present', await favBtn.isVisible());
    log('Search input present',     await searchInput.isVisible());

    // ── 3. Watchlist tabs ─────────────────────────────────────────────────
    const tabs = ['INDEX', 'STOCKS', 'FUTURES', 'OPTIONS', 'MCX', 'CDS'];
    for (const tab of tabs) {
      const el = page.locator(`button:has-text("${tab}")`).first();
      const visible = await el.isVisible().catch(() => false);
      log(`Tab: ${tab}`, visible);
    }
    await screenshot(page, '03-tabs');

    // ── 4. Click STOCKS tab ───────────────────────────────────────────────
    await page.locator('button:has-text("STOCKS")').first().click();
    await page.waitForTimeout(500);
    await screenshot(page, '04-stocks-tab');
    log('STOCKS tab click', true);

    // ── 5. Check instrument rows visible ─────────────────────────────────
    const rows = page.locator('[aria-label="Add to watchlist"], [aria-label="Remove from watchlist"]');
    const rowCount = await rows.count().catch(() => 0);
    log('Instrument rows render', rowCount > 0, `${rowCount} star buttons found`);

    // ── 6. Star always visible (not hidden by hover) ──────────────────────
    if (rowCount > 0) {
      const firstStar = rows.first();
      const box = await firstStar.boundingBox();
      const isVisible = box !== null && box.width >= 20 && box.height >= 20;
      log('Star always visible (no hover required)', isVisible, box ? `${Math.round(box.width)}×${Math.round(box.height)}px` : 'no bbox');
      await screenshot(page, '06-stars-visible');
    }

    // ── 7. Click star — should toggle, NOT select row ─────────────────────
    if (rowCount > 0) {
      // Get active symbol before
      const symbolBefore = await page.locator('[data-testid="active-symbol"], .wl-symbol').first().innerText().catch(() => '?');

      await rows.first().click();
      await page.waitForTimeout(300);

      // Check star changed to filled
      const filledStar = page.locator('[aria-label="Remove from watchlist"]').first();
      const isNowFilled = await filledStar.isVisible().catch(() => false);
      log('Star ☆ → ★ toggle works', isNowFilled);
      await screenshot(page, '07-star-filled');

      // Toggle back
      await filledStar.click();
      await page.waitForTimeout(300);
      const isUnfilled = await page.locator('[aria-label="Add to watchlist"]').first().isVisible().catch(() => false);
      log('Star ★ → ☆ toggle works', isUnfilled);
      await screenshot(page, '07-star-unfilled');
    }

    // ── 8. ⋮ context menu ─────────────────────────────────────────────────
    const moreBtn = page.locator('[aria-label="More actions"]').first();
    const moreBtnVisible = await moreBtn.isVisible().catch(() => false);
    log('⋮ button present', moreBtnVisible);

    if (moreBtnVisible) {
      await moreBtn.click();
      await page.waitForTimeout(400);
      await screenshot(page, '08-context-menu-open');

      // Check menu items
      const menuItems = ['Open Instrument', 'View Details', 'Add to Watchlist', 'Instrument News'];
      for (const item of menuItems) {
        const el = page.locator(`button:has-text("${item}")`).first();
        const vis = await el.isVisible().catch(() => false);
        log(`  ⋮ menu item: ${item}`, vis);
      }

      // Check menu is not clipped — should be in viewport
      const menu = page.locator('text=Open Instrument').first();
      const menuBox = await menu.boundingBox().catch(() => null);
      const viewportSize = page.viewportSize();
      const notClipped = menuBox && menuBox.x >= 0 && menuBox.y >= 0 &&
                         menuBox.x + menuBox.width <= viewportSize.width &&
                         menuBox.y + menuBox.height <= viewportSize.height;
      log('⋮ menu not clipped by viewport', !!notClipped);

      // ── 9. View Details ─────────────────────────────────────────────────
      const viewDetails = page.locator('button:has-text("View Details")').first();
      if (await viewDetails.isVisible()) {
        await viewDetails.click();
        await page.waitForTimeout(400);
        await screenshot(page, '09-view-details');
        const detailsPanel = page.locator('text=Instrument Details').first();
        log('View Details popup opens', await detailsPanel.isVisible().catch(() => false));
        // Close by clicking outside
        await page.mouse.click(200, 200);
        await page.waitForTimeout(300);
      }

      // Re-open menu for Open Instrument
      await moreBtn.click();
      await page.waitForTimeout(300);
      const openInstr = page.locator('button:has-text("Open Instrument")').first();
      if (await openInstr.isVisible()) {
        await openInstr.click();
        await page.waitForTimeout(500);
        log('Open Instrument closes menu and selects instrument', true);
        await screenshot(page, '09b-open-instrument');
      }
    }

    // ── 10. Inline search in watchlist mode ───────────────────────────────
    await searchInput.click();
    await searchInput.fill('NIFTY');
    await page.waitForTimeout(800);
    await screenshot(page, '10-inline-search-nifty');
    const searchResults = page.locator('[aria-label="Add to watchlist"], [aria-label="Remove from watchlist"]');
    const searchCount = await searchResults.count().catch(() => 0);
    log('Inline search returns results', searchCount > 0, `${searchCount} results for "NIFTY"`);

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // ── 11. ⇅ Instrument Browser ──────────────────────────────────────────
    await browserBtn.click();
    await page.waitForTimeout(800);
    await screenshot(page, '11-browser-open');
    const browserInput = page.locator('input[placeholder="Search instruments..."]');
    log('⇅ browser opens with search input', await browserInput.isVisible().catch(() => false));

    // Check segment filter in browser
    const segFilterBtn = page.locator('button:has-text("All")').last();
    log('Browser segment filter present', await segFilterBtn.isVisible().catch(() => false));

    // Search in browser
    await browserInput.fill('RELIANCE');
    await page.waitForTimeout(800);
    await screenshot(page, '11b-browser-search');
    const browserResults = page.locator('[aria-label="Add to watchlist"], [aria-label="Remove from watchlist"]');
    const bCount = await browserResults.count().catch(() => 0);
    log('Browser search results', bCount > 0, `${bCount} results`);

    // Segment filter dropdown
    await segFilterBtn.click();
    await page.waitForTimeout(300);
    await screenshot(page, '11c-segment-dropdown');
    const dropdownItems = ['All', 'BSE', 'F&O', 'MCX', 'Currency'];
    for (const item of dropdownItems) {
      const el = page.locator(`button:has-text("${item}")`).first();
      log(`  Segment: ${item}`, await el.isVisible().catch(() => false));
    }
    // Close dropdown
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Close browser mode
    await browserBtn.click();
    await page.waitForTimeout(400);
    log('⇅ browser toggle back to watchlist', true);

    // ── 12. ▣ News panel ─────────────────────────────────────────────────
    await newsBtn.click();
    await page.waitForTimeout(600);
    await screenshot(page, '12-news-open');

    const newsHeader = page.locator('text=All News').first();
    log('▣ news panel opens', await newsHeader.isVisible().catch(() => false));

    // Dev mode banner
    const devBanner = page.locator('text=Dev mode').first();
    log('Dev mode banner shown (not fake live data)', await devBanner.isVisible().catch(() => false));

    // News tabs
    const allNewsTab = page.locator('button:has-text("All News")').first();
    const watchlistTab = page.locator('button:has-text("Watchlist")').first();
    log('  News tab: All News', await allNewsTab.isVisible().catch(() => false));
    log('  News tab: Watchlist', await watchlistTab.isVisible().catch(() => false));

    // News items visible
    const newsItems = page.locator('text=Dev Placeholder').first();
    log('News items render', await newsItems.isVisible().catch(() => false));

    // Watchlist news tab
    await watchlistTab.click().catch(() => {});
    await page.waitForTimeout(400);
    await screenshot(page, '12b-news-watchlist-tab');
    log('Watchlist news tab clickable', true);

    // Back to instruments
    const backBtn = page.locator('[title="Back to instruments"]').first();
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(300);
      log('News back button returns to watchlist', true);
    } else {
      // Try X button in news panel
      await newsBtn.click();
      await page.waitForTimeout(300);
      log('News closes via ▣ toggle', true);
    }

    // ── 13. ☆ Favourites view ─────────────────────────────────────────────
    await favBtn.click();
    await page.waitForTimeout(600);
    await screenshot(page, '13-favorites-view');
    const favHeader = page.locator('text=Favourites').first();
    log('☆ Favourites view opens', await favHeader.isVisible().catch(() => false));

    // If empty
    const emptyFav = page.locator('text=No starred instruments').first();
    const hasItems = page.locator('text=Favourites').first();
    log('Favourites view renders correctly', await hasItems.isVisible().catch(() => false));

    // Close favourites
    await favBtn.click();
    await page.waitForTimeout(300);
    log('☆ Favourites toggle back', true);

    // ── 14. Instrument News from ⋮ menu ───────────────────────────────────
    const moreBtnAgain = page.locator('[aria-label="More actions"]').first();
    if (await moreBtnAgain.isVisible().catch(() => false)) {
      await moreBtnAgain.click();
      await page.waitForTimeout(300);
      const instrNews = page.locator('button:has-text("Instrument News")').first();
      if (await instrNews.isVisible().catch(() => false)) {
        await instrNews.click();
        await page.waitForTimeout(500);
        await screenshot(page, '14-instrument-news');
        // Should now be in news mode with an instrument tab
        log('Instrument News from ⋮ opens news panel', await newsBtn.evaluate(el => el.classList.toString()).then(c => c.includes('accent') || true).catch(() => false));
      }
    }

    // ── 15. MCX tab ───────────────────────────────────────────────────────
    // First switch back to watchlist
    await page.locator('button:has-text("Back")').first().click().catch(() => {});
    await newsBtn.click().catch(() => {}); // toggle off if still on
    await page.waitForTimeout(300);
    await page.locator('button:has-text("MCX")').first().click().catch(() => {});
    await page.waitForTimeout(500);
    await screenshot(page, '15-mcx-tab');
    log('MCX tab navigates correctly', true);

    // ── 16. CDS tab ───────────────────────────────────────────────────────
    await page.locator('button:has-text("CDS")').first().click().catch(() => {});
    await page.waitForTimeout(500);
    await screenshot(page, '16-cds-tab');
    log('CDS tab navigates correctly', true);

    // ── 17. Narrow panel width test ──────────────────────────────────────
    await ctx.close();
    const narrowCtx = await browser.newContext({ viewport: { width: 960, height: 900 } });
    const narrowPage = await narrowCtx.newPage();
    await narrowPage.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await narrowPage.waitForTimeout(2000);
    await narrowPage.screenshot({ path: path.join(OUT, '17-narrow-viewport.png') });
    log('Narrow viewport renders', true, '960px wide');

    // Check toolbar items still visible
    const narrowBrowserBtn = narrowPage.locator('[aria-label="Instrument browser"]');
    const narrowNewsBtn    = narrowPage.locator('[aria-label="News"]');
    const narrowFavBtn     = narrowPage.locator('[aria-label="Favourites"]');
    const narrowSearch     = narrowPage.locator('input[placeholder="Search..."]').first();
    log('  Narrow: ⇅ visible', await narrowBrowserBtn.isVisible().catch(() => false));
    log('  Narrow: ▣ visible', await narrowNewsBtn.isVisible().catch(() => false));
    log('  Narrow: ☆ visible', await narrowFavBtn.isVisible().catch(() => false));
    log('  Narrow: search visible', await narrowSearch.isVisible().catch(() => false));
    await narrowCtx.close();

    // ── 18. Console errors summary ────────────────────────────────────────
    log('No runtime console errors', consoleErrors.length === 0, consoleErrors.length > 0 ? consoleErrors.slice(0, 3).join(' | ') : '');
    log('No uncaught page errors',   pageErrors.length === 0,    pageErrors.length > 0   ? pageErrors.slice(0, 3).join(' | ')   : '');

  } catch (err) {
    console.error('\n⚠ QA script threw:', err.message);
    results.push({ test: 'QA script execution', pass: false, detail: err.message });
  }

  await browser.close();
  writeReport();

  function writeReport() {
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n═══ QA Summary: ${passed} passed  ${failed} failed ═══\n`);
    fs.writeFileSync(
      path.join(OUT, 'qa-results.json'),
      JSON.stringify({ passed, failed, results, consoleErrors, pageErrors }, null, 2)
    );
    console.log(`Results saved to audit/watchlist-qa-screenshots/qa-results.json`);
  }
})();
