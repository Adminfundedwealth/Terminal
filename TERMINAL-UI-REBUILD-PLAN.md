# Terminal UI Rebuild Plan — FundedWealth

**Date:** June 19, 2026  
**Type:** Audit + Redesign Proposal  
**Scope:** Frontend only — no backend/API/broker changes  
**Status:** AUDIT ONLY — No code modified  

---

## Part 1: Current State Audit

### Component-by-Component Analysis

| # | Component | File | Working? | Data Source | Mock Data? | Production Ready? | Verdict |
|---|-----------|------|----------|-------------|------------|-------------------|---------|
| 1 | TopBar | `TopBar.tsx` | ✅ Yes | appStore, tradingStore, marketStore | ❌ None | ✅ Yes | **KEEP** — Needs layout revision |
| 2 | AccountSummaryBar | `AccountSummaryBar.tsx` | ✅ Yes | tradingStore (account + positions) | ❌ None | ✅ Yes | **KEEP** — Move to right panel |
| 3 | Watchlist | `Watchlist.tsx` | ✅ Yes | appStore (persisted), marketStore (live quotes) | ❌ None | ✅ Yes | **KEEP** — Core feature |
| 4 | ChartPanel | `ChartPanel.tsx` | ⚠️ Partial | API (`/api/market/history`), falls back to **DEMO DATA** | ✅ **YES** — `generateDemoData()` creates 500 fake candles | ❌ No | **REBUILD** — Remove demo, show empty state only |
| 5 | OrderPanel | `OrderPanel.tsx` | ✅ Yes | tradingStore, marketStore, API (`placeOrder`) | ❌ None | ✅ Yes | **KEEP** — Enhance with R:R calculator |
| 6 | BottomPanel | `BottomPanel.tsx` | ✅ Yes | API (positions/orders/trades), tradingStore | ❌ None | ✅ Yes | **KEEP** — Core feature |
| 7 | OptionChainModal | `OptionChainModal.tsx` | ⚠️ Partial | API (`/api/market/option-chain`), `generateDemoOC` returns `[]` | ⚠️ Empty fallback only | ✅ Yes | **KEEP** — Already production-safe |
| 8 | MarketDepthPanel | `MarketDepthPanel.tsx` | ✅ Yes | WebSocket depth data via `useDepth` hook | ❌ None | ✅ Yes | **KEEP** — Shows waiting state when no data |
| 9 | RiskWidget | `RiskWidget.tsx` | ✅ Yes | tradingStore (account + positions) | ❌ None | ⚠️ Hardcoded limits | **REPLACE** — Merge into right panel |
| 10 | StatusBar | `StatusBar.tsx` | ✅ Yes | wsService, marketStore, appStore | ❌ None | ✅ Yes | **KEEP** |
| 11 | SearchModal | `SearchModal.tsx` | ⚠️ Partial | API (`searchInstruments`), falls back to **DEMO_INSTRUMENTS** | ✅ **YES** — 20 hardcoded instruments | ❌ No | **REBUILD** — Remove demo fallback |
| 12 | ErrorBoundary | `ErrorBoundary.tsx` | ✅ Yes | N/A | ❌ None | ✅ Yes | **KEEP** |
| 13 | JournalPanel | `JournalPanel.tsx` | ✅ Yes | journalStore (localStorage persistence) | ❌ None | ✅ Yes | **KEEP** — Full CRUD |
| 14 | AlertsPanel | `AlertsPanel.tsx` | ✅ Yes | journalStore + live marketStore quotes | ❌ None | ✅ Yes | **KEEP** — Real price alerts |
| 15 | AnalyticsPanel | `AnalyticsPanel.tsx` | ✅ Yes | tradingStore + journalStore (computed) | ❌ None | ✅ Yes | **KEEP** — Real analytics |
| 16 | RiskPanel | `RiskPanel.tsx` | ✅ Yes | tradingStore + journalStore | ❌ None | ⚠️ Hardcoded rules | **KEEP** — Make limits configurable |

---

### Dead Panels / Non-Working Elements

| Issue | Location | Details |
|-------|----------|---------|
| **Demo chart data** | `ChartPanel.tsx:418-435` | `generateDemoData()` creates 500 fake OHLC candles when API fails — shown as real data |
| **Demo instruments** | `SearchModal.tsx:18-50` | 20 hardcoded `DEMO_INSTRUMENTS` used as fallback when server offline |
| **Dead hotkey: F3** | `useHotkeys.ts:40` | "Reverse position" — empty handler, only comment |
| **Dead hotkey: F4** | `useHotkeys.ts:44` | "Exit position" — empty handler, only comment |
| **Dead hotkey: Ctrl+B** | `useHotkeys.ts:55` | "Open basket order" — empty handler, only comment |
| **Non-functional buttons** | `OrderPanel.tsx` ProBtns | BE, TP, SL, TSL, REV, EXIT, ½, ALL — visual only, no handlers |
| **Non-functional buttons** | `BottomPanel.tsx` PosActionBtns | BE, TP, SL, TSL buttons on position rows — no actual logic |
| **Indicator toggles** | `ChartPanel.tsx` | EMA, SMA, VWAP etc. toggle in/out of `activeIndicators` array but **do nothing on chart** |
| **Drawing tools** | `ChartPanel.tsx` | Drawing tool dropdown renders buttons but **no drawing logic exists** |
| **Layout toggle** | `ChartPanel.tsx` | 2-chart/4-chart layout buttons — change state but **no multi-chart rendering** |
| **Option Chain VDivider** | `App.tsx:198` | `<VDivider onDrag={() => {}} />` — divider does nothing (empty handler) |

---

### Duplicate / Redundant UI Elements

| Duplicate | Locations | Resolution |
|-----------|-----------|------------|
| Risk display | `RiskWidget.tsx` (right panel) + `RiskPanel.tsx` (bottom tab) + `AccountSummaryBar.tsx` (top) | 3 separate risk views — consolidate into ONE comprehensive Risk section in right panel |
| Account metrics | `TopBar.tsx` (Bal/P&L) + `AccountSummaryBar.tsx` (full bar) | Duplicate — remove from TopBar, keep only AccountSummaryBar |
| Panel toggles | `TopBar.tsx` (WL/OP/OC/DOM) + `StatusBar.tsx` (WL/OP/BP/DOM) | Duplicate — keep only in StatusBar |
| Market status | `TopBar.tsx` (dot + "Live"/"Closed") + `StatusBar.tsx` (dot + full label) | Duplicate — remove from TopBar, keep in StatusBar |

---

### Unused / Low-Value Tabs

| Tab | Panel | Usage | Verdict |
|-----|-------|-------|---------|
| `Journal` | BottomPanel | ✅ Fully functional | KEEP — Move to dedicated section |
| `Alerts` | BottomPanel | ✅ Fully functional | KEEP — Move to left panel |
| `Analytics` | BottomPanel | ✅ Fully functional but cramped | KEEP — Needs more space |
| `Risk` | BottomPanel | ✅ Full dashboard | KEEP — But redundant with RiskWidget |

---

### Mock Data Sources to Remove

| File | Line | What | Action |
|------|------|------|--------|
| `ChartPanel.tsx` | 418–435 | `generateDemoData()` — 500 fake candles | **REMOVE** — Show "Waiting for data" state instead |
| `ChartPanel.tsx` | 105 | `const demoData = generateDemoData(500)` in catch block | **REMOVE** — Let empty state show |
| `SearchModal.tsx` | 18–50 | `DEMO_INSTRUMENTS` array with 20 hardcoded instruments | **REMOVE** — Show "Server unavailable" message |
| `SearchModal.tsx` | 55 | Initial results set to `DEMO_INSTRUMENTS.slice(0, 10)` | **REMOVE** |
| `SearchModal.tsx` | 64 | Empty query fallback to demo | **REMOVE** |
| `SearchModal.tsx` | 74–75 | Catch block fallback to demo search | **REMOVE** |

---

## Part 2: Proposed New Terminal Layout

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  TopBar: Logo | Workspaces (IDX/STK/FUT/OPT/MCX/CDS) | Theme | Settings       │
├──────────┬──────────────────────────────────────────────────┬───────────────────┤
│          │                                                  │                   │
│  LEFT    │              CENTER                              │     RIGHT         │
│  PANEL   │                                                  │     PANEL         │
│          │  ┌──────────────────────────────────────────┐    │                   │
│ Watchlist│  │                                          │    │ Account Summary   │
│ (220px)  │  │         TradingView Chart Area           │    │ Challenge Progress│
│          │  │         - Timeframes                      │    │ ─────────────────│
│ ─────────│  │         - Chart Type                      │    │ Risk Monitor     │
│ Search   │  │         - Indicators (when implemented)   │    │ - Daily Loss     │
│ (Ctrl+K) │  │         - Drawing Tools (when implemented)│    │ - Max Drawdown   │
│ ─────────│  │                                          │    │ - Profit Target  │
│ Alerts   │  │                                          │    │ - Margin Used    │
│          │  │  Empty State: "Waiting for market data"  │    │ ─────────────────│
│          │  │  Loading State: Spinner                   │    │ Order Entry      │
│          │  │  Error State: "Feed disconnected"        │    │ - Buy/Sell       │
│          │  │                                          │    │ - Order Types    │
│          │  └──────────────────────────────────────────┘    │ - Quantity       │
│          │                                                  │ - Price (Limit)  │
│          │  ┌──────────────────────────────────────────┐    │ - Position Calc  │
│          │  │              BOTTOM PANEL                 │    │ - R:R Preview    │
│          │  │  Positions | Orders | Trade History |     │    │                   │
│          │  │  Journal | Analytics                     │    │                   │
│          │  └──────────────────────────────────────────┘    │                   │
├──────────┴──────────────────────────────────────────────────┴───────────────────┤
│  StatusBar: Feed Status | Latency | Market Status | Workspace | Symbol          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Component Rebuild Specifications

### LEFT PANEL (220px, resizable)

#### Watchlist — **KEEP, ENHANCE**
- **Current State:** Working, production-ready
- **Data Source:** appStore (persisted) + marketStore (live WebSocket quotes)
- **Production Ready:** ✅ Yes
- **Changes Needed:**
  - Remove demo data dependency (none exists — clean)
  - Already has: tabs, search/filter, drag reorder, pin, context menu
  - Add: Percentage badges ✅ (already done)

#### Search — **REBUILD (remove demo)**
- **Current State:** Works but falls back to 20 hardcoded demo instruments
- **Data Source:** API `/api/instruments/search` → falls back to `DEMO_INSTRUMENTS`
- **Production Ready:** ❌ No (demo data renders as real results)
- **Changes Needed:**
  - Remove `DEMO_INSTRUMENTS` array entirely
  - On API failure: show "Server unavailable — search requires live connection"
  - On empty query: show "Type to search" instead of demo results

#### Alerts — **MOVE FROM BOTTOM TO LEFT**
- **Current State:** Full implementation with price crossing detection
- **Data Source:** journalStore (persisted) + live marketStore quotes (WebSocket)
- **Production Ready:** ✅ Yes
- **Changes Needed:**
  - Move from bottom panel tab to left panel section (below watchlist)
  - Compact view showing active alert count + list

---

### CENTER PANEL (flexible)

#### TradingView Chart — **REBUILD (remove demo data)**
- **Current State:** lightweight-charts v4, works when API returns data, shows fake candles on failure
- **Data Source:** API `/api/market/history` → falls back to `generateDemoData(500)` fake candles
- **Production Ready:** ❌ No (demo data looks like real market data — misleading)
- **Changes Needed:**
  - **Remove** `generateDemoData()` function entirely
  - **Remove** the catch block that calls it
  - On API failure: show professional empty state "Waiting for market data feed"
  - On no symbol: show "Select a symbol from watchlist"
  - Keep: timeframe selector, chart type, toolbar structure
  - Remove or disable: Indicators toggle (no implementation), Drawing tools (no implementation), Multi-chart layout (no implementation)
  - Mark dead buttons as "Coming Soon" or hide them

#### Chart Trading — **NOT IMPLEMENTED (future)**
- Does not exist currently
- Would require on-chart order placement (click-to-trade)
- Proposal: Phase 2 feature

#### Drawing Tools — **DEAD CODE**
- **Current State:** Dropdown renders 7 tool names but has ZERO drawing logic
- **Production Ready:** ❌ No
- **Verdict:** Hide dropdown until implemented, or show "Coming Soon" label

#### Indicators — **DEAD CODE**
- **Current State:** 10 indicator names toggle in/out of an array, nothing renders on chart
- **Production Ready:** ❌ No
- **Verdict:** Hide or mark "Coming Soon" until lightweight-charts plugins added

---

### RIGHT PANEL (240px, resizable)

#### Account Summary + Challenge Progress — **CONSOLIDATE**
- **Current State:** Exists as `AccountSummaryBar.tsx` (horizontal bar) + `RiskWidget.tsx` (small widget) + TopBar metrics
- **Production Ready:** ⚠️ Partially (3 locations showing overlapping data)
- **Changes Needed:**
  - Create unified "Account & Challenge" section at top of right panel
  - Show: Balance, Equity, Day P&L, Total P&L
  - Show: Challenge phase, start date, expiry, status
  - Show: Target progress bar, Drawdown used bar
  - Remove duplicate from TopBar and AccountSummaryBar horizontal bar

#### Risk Monitor — **CONSOLIDATE**
- **Current State:** `RiskWidget.tsx` (small, right panel) + `RiskPanel.tsx` (full dashboard, bottom tab)
- **Production Ready:** ⚠️ Hardcoded 5%/10%/10% limits
- **Changes Needed:**
  - Merge into a single collapsible "Risk Monitor" section in right panel
  - Daily loss progress bar with buffer
  - Max drawdown progress bar with buffer
  - Profit target progress bar
  - Margin utilization
  - Remove separate "Risk" tab from bottom panel (redundant)

#### Order Entry — **KEEP, ENHANCE**
- **Current State:** Full order form — BUY/SELL, 4 order types, 3 product types, qty, price, preview
- **Data Source:** tradingStore + API `placeOrder`
- **Production Ready:** ✅ Yes
- **Changes Needed:**
  - Add position size calculator (based on SL distance + risk %)
  - Add R:R ratio preview (show profit/loss at TP/SL levels)
  - Add SL distance display (points + % from LTP)
  - Remove non-functional ProBtns (BE, TP, SL, TSL, REV, EXIT, ½, ALL) OR implement them
  - Better spacing between sections

---

### BOTTOM PANEL (180px, resizable)

#### Positions — **KEEP**
- **Current State:** Full table with MTM/P&L/Actions, partial close, reverse
- **Data Source:** API `/api/positions` + tradingStore
- **Production Ready:** ✅ Yes (but PosActionBtns are non-functional)
- **Changes Needed:**
  - Implement or remove BE/TP/SL/TSL buttons on position rows
  - Currently they render but have no click handlers

#### Orders — **KEEP**
- **Current State:** Full table with status, cancel action
- **Data Source:** API `/api/orders` + tradingStore
- **Production Ready:** ✅ Yes

#### Trade History — **KEEP**
- **Current State:** Trade book table
- **Data Source:** API `/api/trades` + tradingStore
- **Production Ready:** ✅ Yes

#### Journal — **KEEP**
- **Current State:** Full CRUD with emotions, ratings, tags, screenshots, phase tracking
- **Data Source:** journalStore (localStorage persistence)
- **Production Ready:** ✅ Yes

#### Analytics — **KEEP**
- **Current State:** Win rate, profit factor, streaks, period P&L, expectancy
- **Data Source:** Computed from tradingStore + journalStore
- **Production Ready:** ✅ Yes

#### Tabs to REMOVE from bottom:
- **Risk** tab — redundant with right panel Risk Monitor
- **Alerts** tab — moving to left panel

---

## Part 4: Dead Code / Non-Functional Buttons Inventory

### Buttons That Do Nothing

| Button | Location | Handler | Status |
|--------|----------|---------|--------|
| `BE` (Break Even) | OrderPanel ProBtns | None | Dead |
| `TP` (Take Profit) | OrderPanel ProBtns | None | Dead |
| `SL` (Stop Loss) | OrderPanel ProBtns | None | Dead |
| `TSL` (Trailing Stop) | OrderPanel ProBtns | None | Dead |
| `REV` (Reverse) | OrderPanel ProBtns | None | Dead |
| `EXIT` (Close) | OrderPanel ProBtns | None | Dead |
| `½` (Scale Out) | OrderPanel ProBtns | None | Dead |
| `ALL` (Close All) | OrderPanel ProBtns | None | Dead |
| `BE` | BottomPanel PosActionBtns | None | Dead |
| `TP` | BottomPanel PosActionBtns | None | Dead |
| `SL` | BottomPanel PosActionBtns | None | Dead |
| `TSL` | BottomPanel PosActionBtns | None | Dead |
| Indicator buttons (EMA, SMA...) | ChartPanel | Toggles array, no chart effect | Dead |
| Drawing tools (Trendline...) | ChartPanel | No handler at all | Dead |
| Layout 2-chart/4-chart | ChartPanel | Changes state, no rendering | Dead |
| Bell (Alerts toolbar) | TopBar | No handler | Dead |
| Scanner (BarChart3 toolbar) | TopBar | No handler | Dead |

**Total dead buttons: 22**

---

## Part 5: Old Terminal Design Patterns to Replace

| Pattern | Current | Proposed |
|---------|---------|----------|
| Horizontal Account Bar | Takes 32px of vertical space for metrics that belong in right panel | Move to right panel header |
| 3 risk displays | Widget + Panel + Bar all showing same data | Single consolidated Risk section |
| Panel toggles in 2 places | TopBar + StatusBar | StatusBar only |
| Fixed workspace tabs in TopBar | Workspace tabs embedded in header | Keep but remove redundant market status/metrics from header |
| Option Chain as separate panel | Shows beside chart only in Options workspace | Keep — this pattern is good |
| Market Depth embedded in right panel | DOM below risk, above order form | Keep — standard placement |
| SearchModal as floating overlay | Full-screen modal with backdrop | Keep — Spotlight/Cmd+K pattern is good |
| Demo data as production fallback | Chart/Search show fake data when backend unavailable | Show clear "disconnected" states only |

---

## Part 6: Implementation Priority

### Phase 1 — Remove Mock Data + Dead Code (1 day)
1. Remove `generateDemoData()` from ChartPanel — show empty state
2. Remove `DEMO_INSTRUMENTS` from SearchModal — show "server unavailable"
3. Remove or disable dead buttons (Indicators, Drawings, Layouts, ProBtns)
4. Implement or remove F3/F4/Ctrl+B hotkey stubs

### Phase 2 — Consolidate Layout (2-3 days)
1. Remove AccountSummaryBar horizontal bar
2. Create unified "Account + Challenge + Risk" section at top of right panel
3. Remove "Risk" tab from bottom panel
4. Move "Alerts" from bottom tab to left panel section
5. Remove duplicate panel toggles and market status from TopBar
6. Remove duplicate account metrics from TopBar

### Phase 3 — Enhance Working Components (3-5 days)
1. OrderPanel: Add position size calculator, R:R preview, SL distance
2. Implement BE/TP/SL/TSL handlers (or hide the buttons)
3. SearchModal: Graceful "offline" mode without fake results
4. Chart: Mark Indicators/Drawings as "Coming Soon" with proper UI

### Phase 4 — New Features (1-2 weeks)
1. Chart-on-trade (click to place orders on chart)
2. Real indicator overlays (EMA/SMA via lightweight-charts plugins)
3. Basic drawing tools (horizontal lines, trendlines)
4. Mobile responsive layout

---

## Part 7: Summary

| Metric | Current | After Rebuild |
|--------|---------|---------------|
| Total Components | 16 | 14 (consolidated) |
| Dead Buttons | 22 | 0 |
| Mock Data Sources | 2 (chart + search) | 0 |
| Duplicate UI Elements | 4 areas | 0 |
| Unused Tabs | 0 (all functional) | Remove 1 (Risk — redundant) |
| Non-functional Features | Indicators, Drawings, Multi-chart | Clearly marked or hidden |
| Production Ready Score | ~70% | Target: 95% |

**The terminal has strong bones — most components are real, production-wired implementations. The main issues are:**
1. Mock data masquerading as real data (chart + search)
2. 22 buttons that render but do nothing
3. 3 redundant risk/account displays
4. Dead code for features never implemented (indicators, drawings, multi-chart)

**No backend changes required for any of these fixes.**
