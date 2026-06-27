# UI-REBUILD-IMPLEMENTATION-PLAN.md
## FundedWealth Terminal — Agent A Implementation Plan

---

## GUIDING PRINCIPLES

1. **NEVER remove any control** — all buttons, panels, features remain
2. **Dark terminal identity** — every change reinforces institutional dark theme
3. **Density over spaciousness** — professional traders want data, not whitespace
4. **Visual hierarchy** — clear layering with surface elevation
5. **Controls stay active** — use "Backend integration pending" tooltip, never disabled/hidden

---

## PHASE 1: BRANDING (Priority: CRITICAL)

### Objective
Restore full "FUNDEDWEALTH TERMINAL" identity across the application.

### Files to Modify
- `src/components/TopBar.tsx` — Brand block update
- `src/styles/index.css` — Brand animations/styling refinements
- `src/App.tsx` — Loading screen brand update
- `index.html` — Page title update

### Changes
1. **TopBar brand block**: Change from `FUNDEDWEALTH` to two-line layout:
   - Line 1: `FUNDEDWEALTH` (bold, gradient)
   - Line 2: `TERMINAL` (smaller, tracking-widest, accent color)
2. **Responsive brand**: Show `FW TERMINAL` on medium screens, icon-only on small
3. **Loading screen**: Update text to "FUNDEDWEALTH TERMINAL" with styled terminal badge
4. **Page title**: `<title>FundedWealth Terminal</title>`
5. **Status bar**: Add "FW Terminal v1.0" on the right side

### Success Criteria
- Brand reads "FUNDEDWEALTH TERMINAL" at all breakpoints (adapted form)
- Terminal identity is unmistakable

---

## PHASE 2: LAYOUT (Priority: CRITICAL)

### Objective
Restructure the terminal layout to match professional multi-panel trading terminals.

### Files to Modify
- `src/App.tsx` — Core layout restructure
- `src/styles/index.css` — New layout utilities, panel styles
- New: `src/components/Sidebar.tsx` — Vertical icon navigation rail

### Changes
1. **Add left sidebar rail** (40-48px wide):
   - Workspace icons (Index, Stocks, Futures, Options, MCX, CDS)
   - Tools section (Search, Alerts, Scanner, Analytics)
   - Settings at bottom
   - Replaces workspace tabs from TopBar
2. **TopBar restructure**:
   - Remove workspace tabs (moved to sidebar)
   - Keep: Brand, Panel toggles, Market status, Account metrics, Settings
   - Add: Layout switcher (1/2/4 chart grid)
   - Add: Account switcher dropdown
3. **Panel default sizes**:
   - Watchlist: 240px (up from 220)
   - Order panel: 280px (up from 240)
   - Bottom panel: 220px (up from 180)
4. **Panel headers**:
   - Add consistent header bar to every panel (watchlist, chart, order, bottom)
   - Header includes: title, collapse button, settings/more menu
5. **Remove dead space**:
   - Chart empty state: Show a minimal "Select Symbol" prompt, not a giant icon
   - Order empty state: Show order form with last-used symbol or compact message

### Success Criteria
- Sidebar navigation rail visible
- Panel headers consistent
- No large dead space areas
- Layout density matches TradeLocker reference

---

## PHASE 3: WATCHLIST (Priority: HIGH)

### Objective
Increase density and information richness of the watchlist.

### Files to Modify
- `src/components/Watchlist.tsx` — Row density, column headers, sorting
- `src/styles/index.css` — Watchlist-specific styles

### Changes
1. **Compact rows**: Reduce vertical padding from 7px to 4-5px
2. **Column headers**: Add thin header row (Price | Chg%)
3. **Two-column data display**:
   - Left: Symbol (truncated if needed)
   - Right: LTP aligned, change% below
4. **Row background flash**: Brief green/red flash on price tick
5. **Bid/Ask columns** (optional, toggle-able): Show bid/ask alongside LTP
6. **Sort controls**: Click column header to sort by symbol/price/change
7. **Segment badge**: Move to tooltip instead of inline text — saves horizontal space
8. **Multi-watchlist tabs**: Increase tab height slightly, add "+" button to create new
9. **Compact add button**: Move to header area, smaller footprint

### Success Criteria
- 15+ symbols visible without scrolling (in standard panel height)
- Price ticks flash on change
- Column headers visible
- Sort functional

---

## PHASE 4: CHART TOOLBAR (Priority: HIGH)

### Objective
Make chart toolbar fully professional with all controls active (not disabled).

### Files to Modify
- `src/components/ChartPanel.tsx` — Toolbar rework
- New: `src/components/IndicatorsModal.tsx` — Empty-state indicators panel
- New: `src/components/DrawingToolsPalette.tsx` — Drawing tools sidebar

### Changes
1. **Chart type selector**: Replace `<select>` with icon button group (candle/hollow/HA/line/area icons)
2. **Indicators button**: ACTIVE (not disabled)
   - Opens modal with list of indicator names
   - Each indicator shows "Backend integration pending" tooltip
   - Modal is searchable
   - Categories: Trend, Momentum, Volume, Volatility
3. **Drawing tools**: ACTIVE
   - Shows palette/dropdown with tool names and icons
   - Tools: Trendline, Horizontal line, Fibonacci, Rectangle, Text
   - Each tool shows "Backend integration pending" on use
4. **Layout switcher**: New button
   - Options: 1 chart, 2 charts (split), 4 charts (grid)
   - Shows "Backend integration pending" for multi-chart
5. **Additional toolbar buttons**:
   - Screenshot (captures chart area)
   - Crosshair mode toggle
   - Price scale toggle (auto/log/percentage)
   - Compare (overlay) — with pending tooltip
6. **OHLCV header enhancement**: Add bid/ask/spread display alongside OHLC

### Success Criteria
- No disabled/dimmed buttons
- All controls clickable and responsive
- Indicators modal opens with category list
- Drawing tools palette shows full tool list
- Layout switcher visible

---

## PHASE 5: ORDER ENTRY (Priority: HIGH)

### Objective
Transform order panel into a professional trading cockpit with all required controls.

### Files to Modify
- `src/components/OrderPanel.tsx` — Full rework

### Changes
1. **Panel header**: "ORDER ENTRY" with settings gear
2. **BUY/SELL toggle**: Larger, more prominent with glow effect when active
3. **Bracket order section**: Add inline SL and TP fields below main order:
   - SL price input + "points from entry" helper
   - TP price input + "points from entry" helper
   - Toggle: "Enable bracket order"
4. **Quick action buttons strip** (always visible):
   - `BE` — Break Even (tooltip: "Set SL at entry price")
   - `TP` — Take Profit
   - `SL` — Stop Loss
   - `TSL` — Trailing Stop Loss
   - `REV` — Reverse position
   - `EXIT` — Exit 100%
   - `HALF` — Close 50%
   - `CLOSE ALL` — Close all positions
   - All show "Backend integration pending" tooltip until wired
5. **One-click mode toggle**: Switch between confirmation and instant execution
6. **Risk preview**: Show estimated max loss if SL is set
7. **Advanced order types row**: GTT, AMO, IOC (with pending tooltip)
8. **Position-aware display**: If position exists, show current position size and PnL above order form
9. **Hotkey hints**: Keep but style more subtly

### Success Criteria
- All action buttons visible (BE, TP, SL, TSL, REV, EXIT, HALF, CLOSE ALL)
- Bracket order inputs present
- One-click mode toggle
- Risk preview section
- No controls removed

---

## PHASE 6: RISK PANEL (Priority: MEDIUM-HIGH)

### Objective
Enhance risk visibility — always-on risk awareness without hiding in tabs.

### Files to Modify
- `src/components/RiskWidget.tsx` — Enhanced sidebar widget
- `src/components/RiskPanel.tsx` — Bottom tab improvements
- `src/components/AccountSummaryBar.tsx` — Challenge progress

### Changes
1. **RiskWidget enhancement** (sidebar):
   - Add challenge phase badge (Phase 1/2, Funded)
   - Add days remaining counter
   - Add trading days count
   - Add consistency score indicator
   - Compact but information-dense
2. **AccountSummaryBar**:
   - Add account switcher dropdown (if multiple challenges)
   - Add challenge type badge
   - Slightly increase height to 36px for better readability
   - Add hover tooltips on each metric
3. **RiskPanel** (bottom tab):
   - Keep all existing metrics
   - Add visual warning overlays when limits approach
   - Better use of horizontal space at larger sizes
4. **Risk alerts**: Toast notifications when approaching daily/DD limits

### Success Criteria
- Challenge info visible at all times (phase, days, target)
- Account switcher present (even if single account)
- Risk alerts fire on threshold breach (UI only, backend pending)
- No risk controls removed

---

## PHASE 7: BOTTOM PANELS (Priority: MEDIUM)

### Objective
Improve density and professionalism of positions/orders/trades tables.

### Files to Modify
- `src/components/BottomPanel.tsx` — Tab styling, table density
- `src/components/JournalPanel.tsx` — Layout polish
- `src/components/AlertsPanel.tsx` — Layout polish
- `src/components/AnalyticsPanel.tsx` — Layout polish

### Changes
1. **Tab bar**: Reduce tab height to 32px, tighter padding
2. **Table row density**: Reduce row height from ~36px to 28-30px
3. **Positions table**:
   - Inline SL/TP display columns (show set values or "—")
   - Progress-to-target mini bar per position
   - Color-code entire row subtly based on P&L
4. **Close All button**: Make more prominent — red background, larger
5. **Empty states**: Reduce height, use inline text instead of centered blocks
6. **Auto-refresh indicator**: Small spinning dot in tab bar showing data is live
7. **Position actions**: Keep all (BE, TP, SL, TSL, %, Reverse, Exit, Add, Modify)
8. **Column resizing**: Allow drag-to-resize table columns (future)
9. **Orders table**: Add "Modify" action for open orders (with pending tooltip)
10. **Default bottom panel height**: Increase to 220px

### Success Criteria
- 3-4 positions visible without scrolling in default height
- All action buttons preserved
- Denser table rows
- Prominent Close All

---

## PHASE 8: POLISH (Priority: MEDIUM)

### Objective
Final visual refinements for institutional-grade appearance.

### Files to Modify
- `src/styles/index.css` — Global polish
- `src/components/StatusBar.tsx` — Enhanced status info
- `src/components/SearchModal.tsx` — Style refinement
- `src/components/MarketDepthPanel.tsx` — Visual polish
- `src/components/OptionChainModal.tsx` — Style refinement
- Various components — micro-interactions

### Changes
1. **Remove or restyle light theme**:
   - Option A: Remove light theme entirely (recommended for prop firm)
   - Option B: Replace with "Midnight" — a slightly lighter dark variant
2. **Theme toggle**: Move from TopBar to sidebar settings or remove
3. **Status bar enhancements**:
   - Add server/exchange clock
   - Add "FW Terminal v1.0" version
   - Remove duplicate panel toggles (keep only in TopBar)
4. **Panel elevation**: Add subtle `box-shadow` or border variations to create depth
5. **Transitions**: Add smooth panel collapse/expand animations
6. **Focus states**: Improve keyboard navigation visibility
7. **Tooltip system**: Consistent tooltip styling across all controls
8. **Loading states**: Professional skeleton loaders instead of spinners
9. **Font refinements**:
   - Ensure JetBrains Mono loaded for all numeric data
   - Ensure Inter loaded for all UI text
10. **Scrollbar styling**: Keep ultra-thin but add hover-reveal behavior
11. **Market Depth**: Add subtle gradient background to header
12. **Option Chain**: Ensure professional grid layout maintained
13. **Search Modal**: Add recent searches, keyboard navigation hints

### Success Criteria
- No light/white theme appearing unexpectedly
- Visual depth via shadows and borders
- Smooth transitions on panel toggle
- Professional tooltip system
- Exchange clock in status bar

---

## IMPLEMENTATION SEQUENCE

```
Phase 1 (Branding)         → 1-2 hours
Phase 2 (Layout)           → 3-4 hours
Phase 3 (Watchlist)        → 2-3 hours
Phase 4 (Chart Toolbar)    → 2-3 hours
Phase 5 (Order Entry)      → 3-4 hours
Phase 6 (Risk Panel)       → 2-3 hours
Phase 7 (Bottom Panels)    → 2-3 hours
Phase 8 (Polish)           → 2-3 hours
                           ─────────────
Total estimated:             17-25 hours
```

---

## CRITICAL CONSTRAINTS (REPEATED FOR CLARITY)

### DO NOT REMOVE:
- BE, TP, SL, TSL, REV, EXIT, HALF, CLOSE ALL buttons
- DOM (Market Depth) panel
- Option Chain modal/panel
- Indicators button
- Drawing Tools button
- Layout Switcher
- Multi Watchlists
- Price Alerts
- Risk Controls
- Account Switcher
- Workspace Controls
- Any existing functionality

### FOR UNIMPLEMENTED FEATURES:
- Keep control VISIBLE
- Keep layout COMPLETE
- Wire UI interaction (click handlers, state)
- Show "Backend integration pending" tooltip
- Preserve final production layout
- Use disabled visual state ONLY if it doesn't hide the control

---

## DEPENDENCIES

- **Agent B/C** will later connect: Market Data, WebSockets, Option Chain, Market Depth, Order Execution, Risk Engine, Challenge Engine
- **Agent A** (this agent) delivers the VISUAL SHELL — all controls wired to UI state, ready for backend hookup
- No backend changes required for any Phase 1-8 work
- No database changes required
- No API changes required

---

*Implementation plan created by Agent A*
*Date: 2026-06-19*
