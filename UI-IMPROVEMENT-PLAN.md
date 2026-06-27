# FundedWealth Terminal — UI Improvement Plan

**Based on:** UI/UX Audit of June 19, 2026  
**Current Score:** 68/100  
**Target Score:** 90/100  
**Priority:** P0 → P1 → P2  

---

## Phase 1: Critical Fixes (P0) — Target: 1-2 days

### 1.1 Add Error Boundaries (Prevents App Crash)

**Problem:** A single undefined value in `WatchlistRow` crashes the entire app with no recovery.

**Solution:**
- Add null guards in `formatPrice()` and `formatChangePercent()` in `src/utils/helpers.ts`
- Add React Error Boundary component wrapping each panel independently
- Each panel (Watchlist, Chart, OrderPanel, BottomPanel) should crash in isolation

**Files to modify:**
- `src/utils/helpers.ts` — Add `if (price == null) return '—'` guards
- `src/components/ErrorBoundary.tsx` — New component
- `src/App.tsx` — Wrap each panel section in `<ErrorBoundary>`

**Effort:** ~2 hours

---

### 1.2 Mobile Responsive Layout

**Problem:** All panels render side-by-side at any viewport, making the terminal unusable below 768px.

**Solution — Tabbed Mobile Layout:**
- At < 768px: Collapse to single-panel tabbed view
- Tabs: Chart | Watchlist | Trade | Positions
- Bottom nav bar with icons for quick switching
- TopBar: Collapse to logo + hamburger + key metrics only

**Implementation approach:**
- Add `useMobile()` hook that checks `window.innerWidth < 768`
- Conditional layout in `App.tsx` — render `<MobileLayout>` vs `<DesktopLayout>`
- MobileLayout: Full-screen panels with bottom tab bar
- Keep all existing component code, just change container/visibility

**Files to create/modify:**
- `src/hooks/useMobile.ts` — New hook
- `src/components/MobileLayout.tsx` — New component
- `src/App.tsx` — Conditional render
- `src/styles/index.css` — Mobile-specific styles

**Effort:** ~1-2 days

---

### 1.3 Panel Overflow Fix at < 1440px

**Problem:** 5 panels clip content at viewports 1024–1440px.

**Solution:**
- Auto-collapse Watchlist and OrderPanel when viewport < 1280px
- Add panel show/hide animation
- Keep panels accessible via TopBar toggle buttons (WL, OP already exist)
- Set min-width constraints: Chart must always have ≥ 600px

**Files to modify:**
- `src/App.tsx` — Add viewport-aware panel defaults
- `src/store/appStore.ts` — Add responsive panel state logic

**Effort:** ~4 hours

---

## Phase 2: Major UX Improvements (P1) — Target: 3-5 days

### 2.1 Accessibility Fixes

**Problem:** 12 buttons without labels, 2 inputs without labels.

**Actions:**
| Component | Fix |
|-----------|-----|
| Theme switcher buttons (3) | Add `aria-label="Switch to dark/blue/light theme"` |
| Watchlist close buttons (5) | Add `aria-label="Remove from watchlist"` |
| Search/Settings icon buttons (2) | Add `aria-label="Search symbols"` and `aria-label="Settings"` |
| Chart toolbar buttons (2) | Add `aria-label` for each control |
| Timeframe select | Add `aria-label="Chart timeframe"` |
| Quantity input | Add `aria-label="Order quantity"` |

**Files to modify:**
- `src/components/TopBar.tsx` — Theme buttons, toolbar buttons
- `src/components/Watchlist.tsx` — Close/pin buttons
- `src/components/OrderPanel.tsx` — Quantity input
- `src/components/ChartPanel.tsx` — Toolbar buttons

**Effort:** ~2 hours

---

### 2.2 ARIA Landmarks & Keyboard Navigation

**Actions:**
- Add `role="banner"` to TopBar
- Add `role="navigation"` to workspace tabs
- Add `role="main"` to chart area
- Add `role="complementary"` to side panels
- Add `role="contentinfo"` to StatusBar
- Implement Tab key navigation between panels
- Add `aria-live="polite"` to P&L display (updates frequently)

**Effort:** ~3 hours

---

### 2.3 Order Panel Price Input Visibility

**Problem:** LIMIT order price input may not be immediately visible.

**Solution:**
- When user selects "Limit" or "SL" order type, animate the price input into view
- Add visual indicator showing which fields are required per order type
- Show tooltip: "Set limit price" when order type changes

**Effort:** ~2 hours

---

### 2.4 Empty State Improvements

**Current state:**
- Positions: ✅ Has message
- Orders: ❌ No message
- Trades: ❌ Unknown
- Chart (no data): Shows blank canvas

**Solution:**
- Add "No pending orders" empty state with CTA: "Place your first order →"
- Add "No trades today" with period context
- Chart empty state: "Select a symbol or search with Ctrl+K"
- Consistent empty state design: Icon + Title + Description + CTA

**Effort:** ~2 hours

---

## Phase 3: Polish & Parity (P2) — Target: 1 week

### 3.1 Chart Drawing Tools

**Gap vs TradingView:** No trendlines, horizontals, or drawing tools.

**Options:**
1. **lightweight-charts plugins** — Limited but possible (horizontal lines, markers)
2. **TradingView Charting Library** — Full-featured but requires license
3. **Custom overlay canvas** — Draw tools rendered on top of chart

**Recommendation:** Start with horizontal price lines and markers via lightweight-charts API. Drawing tools are a significant investment — evaluate if users need them or if clean charting is sufficient for a prop firm terminal.

**Effort:** 3-5 days for basic tools

---

### 3.2 Loading States & Skeletons

**Current:** No loading indicators when app starts.

**Solution:**
- Add skeleton loader for Watchlist (5 gray bars)
- Add skeleton for chart area (gradient shimmer)
- Add skeleton for BottomPanel table
- Show loading spinner overlay on first mount before auth resolves

**Effort:** ~4 hours

---

### 3.3 Micro-interactions & Polish

**Items:**
- Add subtle panel resize animations (ease-out)
- Add toast notifications for order placement/cancellation
- Add price flash animation (green/red pulse) in watchlist when prices change
- Add smooth tab transitions in bottom panel
- Add focus ring styles for keyboard navigation (`:focus-visible`)

**Effort:** ~1 day

---

### 3.4 Tablet Layout Optimization (1024–1280px)

**Solution:**
- Auto-hide Market Depth panel
- Reduce watchlist width to 180px
- Reduce order panel width to 220px
- Collapse TopBar toolbar icons into overflow menu

**Effort:** ~4 hours

---

## Phase 4: Future Enhancements

### 4.1 PWA / Mobile App
- Service worker for offline access
- Web app manifest for installation
- Push notifications for alerts/fills
- Touch-optimized interactions

### 4.2 Theme Editor
- Allow users to customize accent colors
- Save custom themes to localStorage
- Light theme Polish (currently implemented but likely undertested)

### 4.3 Layout Persistence
- Save panel sizes to localStorage
- Save workspace-specific layouts
- Drag-and-drop panel reordering

### 4.4 Performance Optimization
- Virtualize watchlist (react-window) for 100+ symbols
- Debounce resize handlers
- Memoize expensive option chain table renders
- Web Worker for market data processing

---

## Implementation Priority Matrix

| Task | Impact | Effort | Priority |
|------|--------|--------|----------|
| Error boundaries + null guards | Critical | 2hr | Do First |
| Mobile responsive layout | High | 2 days | Do First |
| Panel overflow fix | High | 4hr | Do First |
| Accessibility labels | Medium | 2hr | Sprint 1 |
| Empty state improvements | Medium | 2hr | Sprint 1 |
| ARIA landmarks | Medium | 3hr | Sprint 1 |
| Loading skeletons | Low | 4hr | Sprint 2 |
| Chart drawing tools | Medium | 5 days | Sprint 2 |
| Micro-interactions | Low | 1 day | Sprint 3 |
| Tablet optimization | Medium | 4hr | Sprint 2 |

---

## Score Projection

| After Phase | Estimated Score | Key Unlocks |
|-------------|----------------|-------------|
| Phase 1 (P0 fixes) | 82/100 | App stability, mobile usable |
| Phase 2 (P1 fixes) | 88/100 | Accessibility, UX completeness |
| Phase 3 (P2 polish) | 93/100 | Professional parity with competitors |
| Phase 4 (Enhancements) | 95+/100 | Market-leading prop firm terminal |

---

## Benchmark Targets

To match industry leaders:
- **TradeLocker:** Full mobile responsive, smooth animations, error recovery ✓ Phase 1-2
- **MatchTrader:** Clean empty states, loading skeletons, accessible ✓ Phase 2-3
- **Topstep X:** Risk-focused UX (already strong), mobile support ✓ Phase 1
- **TradingView:** Drawing tools, layout persistence, PWA ✓ Phase 3-4
