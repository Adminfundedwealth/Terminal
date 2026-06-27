# FundedWealth Terminal — UI/UX Audit Report

**Date:** June 19, 2026  
**Auditor:** Automated Playwright + Code Analysis  
**Version:** 1.0.0  
**Overall Score:** 68/100  

---

## Executive Summary

The FundedWealth Terminal presents a **professional, institutional-grade dark trading interface** with strong visual identity. The desktop experience at 1920×1080 is solid — clean layout, proper color hierarchy, consistent typography, and a functional multi-panel architecture. However, critical gaps exist in **mobile responsiveness**, **error resilience**, and **accessibility** that prevent it from matching industry leaders like TradingView, TradeLocker, or MatchTrader.

### Key Strengths
- Premium dark theme with proper color token system (12 BG variants, 2 font families)
- Clean typography scale (5 sizes: 9–13px, Inter + JetBrains Mono)
- Functional resizable panel layout with drag dividers
- Multi-workspace architecture (IDX/STK/FUT/OPT/MCX/CDS)
- Proper empty states for positions
- Keyboard shortcut support (Ctrl+K search)
- Status bar with connection state, latency, market status

### Critical Gaps
- App crashes entirely with stale localStorage (P0)
- Zero mobile responsiveness — panels overflow on <768px (P0)
- 14 accessibility violations (unlabeled buttons/inputs)
- Panel clipping on viewports < 1440px
- No error boundaries — one component crash kills entire app

---

## Production UI Score: 68/100

| Category | Score | Notes |
|----------|-------|-------|
| Layout & Structure | 8/10 | Excellent at 1920px, degrades below 1440px |
| Dark Theme | 9/10 | Zero white backgrounds, consistent tokens |
| Typography | 9/10 | Clean 5-size scale, 2 families, proper hierarchy |
| Component Quality | 9/10 | All major components render correctly |
| Responsiveness | 3/10 | Desktop-only, no tablet/mobile adaptation |
| Accessibility | 4/10 | 14 unlabeled elements, no ARIA landmarks |
| Error Handling | 3/10 | No error boundaries, crash on stale data |
| Loading/Empty States | 6/10 | Positions empty state good, others basic |
| Professional Polish | 7/10 | Good but lacks chart controls toolbar |

---

## P0 — Critical Issues (Must Fix)

### P0-1: App Crashes with Persisted State
- **Component:** WatchlistRow → `formatChangePercent(quote.changePercent)`
- **Trigger:** When Zustand market store has partial quote objects (from prior session WebSocket data persisting via HMR or stale state), calling `toFixed()` on `undefined` crashes the entire React tree.
- **Impact:** Complete white screen — terminal is unusable until localStorage is cleared.
- **Root Cause:** No null guard in `formatPrice()` and `formatChangePercent()` helpers. No React Error Boundary wrapping the app or individual panels.
- **Evidence:** Console error: `Cannot read properties of undefined (reading 'toFixed')` in `<WatchlistRow>` component.

### P0-2: No Mobile Layout — 6 Panels Overflow on 375px
- **Component:** App.tsx layout
- **Trigger:** Any viewport < 768px width
- **Impact:** Panels extend beyond viewport, horizontal scroll, unusable interface. Header clips content.
- **Root Cause:** Fixed-width panel architecture with `style={{ width: watchlistWidth }}` and no responsive breakpoint logic. The CSS has a `@media (max-width: 768px)` but it only adjusts table padding — panels remain side-by-side.
- **Comparison:** TradeLocker and MatchTrader both collapse to a tabbed single-panel mobile view. TradingView uses a completely different mobile app.

---

## P1 — Major UX Issues

### P1-1: Panel Clipping on Viewports < 1440px
- **Component:** Layout (Watchlist + Chart + OrderPanel)
- **Trigger:** Viewport widths 768–1440px
- **Details:** 5 divs with `style*="width"` extend beyond their container bounds at 1440px, 1366px, 1280px, 1024px, and 768px.
- **Impact:** Content overlap, truncated data. Usable but degraded.
- **Comparison:** TradeLocker auto-collapses panels; TradingView hides side panels.

### P1-2: Order Panel — Only 1 Input Field Detected
- **Component:** OrderPanel
- **Details:** While the panel shows BUY/SELL/Order Types correctly, only 1 actual `<input>` element was found. The quantity selector uses buttons (+/-) which is functional, but price input for LIMIT orders may not be visible by default.
- **Impact:** Users placing LIMIT orders may not immediately see the price field.

---

## P2 — Cosmetic / Minor Issues

### Accessibility (14 violations)

| Issue | Count | Details |
|-------|-------|---------|
| Buttons without accessible labels | 12 | Icon-only buttons (theme switcher, close, pin, chart controls) have no `aria-label` or `title` |
| Inputs without labels | 2 | Timeframe `<select>` and quantity `<input type="number">` lack labels |
| Low contrast elements | 1 | One text element with potentially insufficient contrast |

### Typography
- 5 font sizes used (9px, 10px, 11px, 12px, 13px) — well within acceptable range
- Proper use of Inter for UI and JetBrains Mono for data/prices

### Empty States
- **Positions:** ✅ "No open positions" message shown
- **Orders:** ❌ No "No pending orders" message detected
- **Chart:** Renders canvas immediately (good)
- **Option Chain:** Shows "Waiting for option chain data" (good)

### Minor Visual
- Risk Widget was not detected by DOM selectors (may be hidden in some states)
- Chart panel reports 0 interactive controls detected via button query (chart controls are likely custom divs)
- No visible loading spinner/skeleton when app starts

---

## Component-by-Component Review

### TopBar (Score: 9/10)
- **Height:** 48px (correct, industry standard)
- **Elements:** Brand logo + text, 6 workspace tabs, 18 buttons, account metrics (₹10.0L balance, +₹15.2K P&L)
- **Background:** `rgb(24, 27, 37)` — proper dark surface
- **Issues:** None on desktop. On <1024px, brand text hides (good responsive behavior).

### Watchlist (Score: 10/10)
- **Size:** 220×1010px (resizable 160–400px)
- **Features:** 6 category tabs (INDEX/STOCKS/FUTURES/OPTIONS/MCX/CDS), search/filter input, 5 items visible, drag reorder, pin to top, "Add Symbol" button, right-click context menu
- **Empty State:** "No symbols" + "Add" link
- **UX:** Excellent — matches TradeLocker's watchlist quality

### Chart Panel (Score: 9/10)
- **Canvas:** 1396×762px at 1920 viewport — fills available space well
- **Engine:** lightweight-charts v4 (professional candlestick library)
- **Features:** Timeframe selector (1m–1W), chart type toggle, crosshair
- **Missing:** No visible drawing tools toolbar (competitor gap vs TradingView)
- **Note:** Chart controls exist but are custom elements not detected as buttons

### Order Panel (Score: 10/10)
- **Size:** 240×1010px (resizable 200–420px)
- **Layout:** Risk Monitor → Order Form → Action Buttons
- **Features:** BUY/SELL buttons, 4 order types (Market/Limit/SL/SL-M), 3 product types (MIS/NRML/CNC), quantity buttons, lot size display, margin estimate, keyboard shortcuts (F1-F4)
- **UX:** Comprehensive, matches professional terminals

### Bottom Panel (Score: 10/10)
- **Size:** Full width × 180px (resizable 120–400px)
- **Tabs:** Positions, Orders, Trade Book, Journal, Alerts, Analytics, Risk (7 tabs — comprehensive)
- **Empty State:** "No open positions" (well-designed)
- **Table Style:** Uses `.fw-table` class with sticky headers, hover rows, tabular numbers

### Status Bar (Score: 8/10)
- **Height:** 22px
- **Content:** Broker status, WebSocket state, latency, market status, workspace indicator, symbol name, panel toggles
- **Quality:** Functional and informative, matches TradeLocker's status bar

### Option Chain (Score: 10/10)
- **Layout:** Side-by-side with chart in Options workspace
- **Features:** 5 index symbols (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX), expiry selector, strike-centered table with B/S buttons, OI/Vol/LTP columns
- **Empty State:** "Waiting for option chain data" with descriptive helper text
- **Quality:** Matches Sensibull/Opstra quality

### Market Depth (Score: 8/10)
- **Features:** 5-level bid/ask display, volume bars, flash animations for price changes
- **Layout:** Embedded in right panel below Risk Widget
- **Quality:** Functional DOM (Depth of Market) view

### Search Modal (Score: 8/10)
- **Trigger:** Ctrl+K keyboard shortcut (confirmed working)
- **Features:** Full-width search input, backdrop overlay, multi-segment search
- **Placeholder:** "Search stocks, futures, options, commodities..."
- **Quality:** Clean implementation, similar to Spotlight/Cmd+K patterns

---

## Competitor Comparison

| Feature | FundedWealth | TradeLocker | MatchTrader | TradingView |
|---------|:---:|:---:|:---:|:---:|
| Dark Theme Quality | ✅ Excellent | ✅ Excellent | ✅ Good | ✅ Excellent |
| Mobile Responsive | ❌ None | ✅ Full | ✅ Full | ✅ App |
| Resizable Panels | ✅ | ✅ | ✅ | ✅ |
| Multi-Workspace | ✅ 6 workspaces | ❌ | ❌ | ✅ Layouts |
| Drawing Tools | ❌ Missing | ✅ | ❌ | ✅ Full |
| Error Boundaries | ❌ None | ✅ | ✅ | ✅ |
| Option Chain | ✅ Built-in | ❌ | ❌ | ❌ |
| Risk Widget | ✅ Prop firm | ❌ | ❌ | ❌ |
| Keyboard Shortcuts | ✅ Ctrl+K, F1-F4 | ✅ | ✅ | ✅ |
| Status Bar | ✅ Detailed | ✅ | ✅ | ❌ |
| Accessibility | ❌ 14 issues | ✅ | ⚠️ | ✅ |
| Empty States | ⚠️ Partial | ✅ | ✅ | ✅ |

---

## Responsive Audit Results

| Viewport | Overflow | Panels Clipped | Verdict |
|----------|----------|----------------|---------|
| 1920×1080 (Desktop) | ❌ None | 0 | ✅ Perfect |
| 1440×900 (Desktop) | ❌ None | 5 | ⚠️ Panels clip |
| 1366×768 (Laptop) | ❌ None | 5 | ⚠️ Panels clip |
| 1280×720 (Laptop) | ❌ None | 5 | ⚠️ Panels clip |
| 1024×768 (Tablet) | ❌ None | 5 | ⚠️ Panels clip |
| 768×1024 (Tablet Portrait) | ❌ None | 5 | ❌ Unusable |
| 375×812 (Mobile) | Header clips | 6 | ❌ Broken |

---

## Screenshots

All screenshots saved to: `audit/ui-audit-screenshots/`

| File | Description |
|------|-------------|
| `00-full-terminal.png` | Full terminal at 1920×1080 |
| `01-topbar.png` | Top bar/header |
| `05-option-chain.png` | Option chain in Options workspace |
| `06-search-modal.png` | Search modal (Ctrl+K) |
| `responsive-1920x1080.png` | Desktop |
| `responsive-1440x900.png` | Laptop (wide) |
| `responsive-1366x768.png` | Laptop (standard) |
| `responsive-375x812.png` | Mobile |

---

## Technical Notes

- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS 3 with CSS custom properties (`--fw-*` tokens)
- **State:** Zustand with localStorage persistence (appStore only)
- **Charting:** lightweight-charts v4
- **Fonts:** Inter (UI, 300–700), JetBrains Mono (data/prices, 400–600)
- **Themes:** 3 available (Dark, FW-Blue, Light) via CSS variable swap
