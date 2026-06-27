# UI-REBUILD-AUDIT.md
## FundedWealth Terminal — Agent A UI Audit Report

---

## 1. BRANDING PROBLEMS

### Current State
- **Logo area**: Shows "FUNDEDWEALTH" only (no "TERMINAL" text)
- **Brand identity incomplete**: The branding block in `TopBar.tsx` displays just `FUNDEDWEALTH` with a gradient text, missing the terminal designation
- **Logo fallback**: Falls back to "FW" initials if image fails — no terminal identity
- **Favicon**: Basic `favicon.png` with no terminal-specific identity
- **Loading screen**: Shows "Connecting to FundedWealth..." — missing "TERMINAL" suffix
- **Hidden on smaller screens**: Brand text is `hidden xl:block`, meaning branding disappears entirely below 1280px

### Expected (Reference: TradeLocker, MatchTrader)
- Full brand: **FUNDEDWEALTH TERMINAL** always visible
- Secondary tagline or version indicator
- Logo + text should remain visible at all breakpoints (condensed form)
- Firm identity visible in status bar and tab title

---

## 2. LAYOUT PROBLEMS

### Dead Space Analysis
- **Chart area**: When no symbol is selected, shows a massive empty state with just an icon — wastes 60%+ of screen real estate
- **Right panel (Order + Risk + DOM)**: Default width 240px is too narrow for professional order entry; MatchTrader uses 280-320px
- **Left panel (Watchlist)**: Default 220px — acceptable but lacks density compared to TradeLocker (which fits 15+ symbols in view)
- **Bottom panel**: Default height 180px — too short to display position data meaningfully; professional terminals use 200-260px
- **Gap between panels**: No visual breathing room; panels feel crushed together with only 4px dividers
- **No sidebar navigation**: Professional terminals (TradeLocker, DXTrade) have a vertical icon sidebar for workspace/tool switching

### Layout Structure Issues
- **Flat layout**: Everything lives at one level — no visual depth or layering
- **No panel headers with controls**: Panels lack consistent header bars with collapse/expand/popout options
- **Missing workspace context**: No visual indicator of which workspace layout is active beyond the small tab underline
- **AccountSummaryBar at 32px**: Too thin for the density of data it shows; feels cramped
- **TopBar at 48px**: Adequate height but content is poorly organized — workspace tabs, tools, metrics, and theme all compete for attention

---

## 3. THEME / DARK MODE ISSUES

### Current Problem
- **Light theme exists and is selectable** via theme toggle in TopBar
- The light theme (`[data-theme='light']`) uses white backgrounds — this is UNEXPECTED for a prop trading terminal
- Professional prop firm terminals (TopStepX, FundingPips) are dark-only or heavily dark-default
- **Theme persistence**: Theme is persisted to localStorage — if a user accidentally selects light mode, it stays on reload
- **Three themes available**: dark, fw-blue, light — light should either be removed or significantly redesigned to feel professional (not "admin dashboard white")

### Expected
- Default MUST be dark (current: ✓ dark is default)
- Light theme should be removed or replaced with a darker "midnight blue" variant
- fw-blue theme (TradingView style) is acceptable as secondary

---

## 4. WATCHLIST ISSUES

### Current State
- Watchlist rows are vertically sparse — 7px padding per row means fewer visible symbols
- No column headers (Price, Change columns are implied but not labeled)
- Segment badge takes valuable space (`text-[9px]` — barely readable)
- Pin and remove icons only show on hover — reduces discoverability
- Tab bar for multi-watchlist uses very small `text-[10px]` labels
- "Add Symbol" button at bottom is underweight — just a plus icon with small text
- No column sorting (by name, change%, price)
- No heatmap/color intensity for change magnitude

### Comparison: TradeLocker
- Compact rows (4-5px padding)
- Visible bid/ask columns alongside LTP
- Color-coded entire row background on extreme moves
- Column headers with sort arrows
- Fixed "Add" button in header, not footer

### Comparison: MatchTrader
- Two-line rows: Symbol + segment on line 1, prices on line 2
- Sparkline mini-charts in each row
- Collapsible watchlist sections by segment

---

## 5. CHART AREA ISSUES

### Current State
- Chart toolbar (`36px`) contains timeframes + chart type + indicators (disabled) + drawings (disabled)
- Indicators button: Shows "Indicators" text with `cursor-not-allowed opacity-60` — **WRONG approach**
  - Per project rules: should be VISIBLE and ACTIVE, showing "Backend integration pending" tooltip
- Drawing tools button: Same issue — disabled and dimmed
- No chart layout switcher (2-chart, 4-chart grid)
- OHLCV header is minimal — no bid/ask/spread display
- Missing chart tools: crosshair toggle, screenshot, comparison overlay, price scale toggle
- Chart type selector is a `<select>` dropdown — looks non-professional (should be icon buttons)

### Comparison: TradeLocker / TradingView
- Toolbar has icon-based chart type selector (not dropdown)
- Indicator list is a searchable modal even without backend
- Drawing tools palette on left side rail
- Layout selector (1/2/4/6 chart grids)
- Additional tools: measure tool, screenshot, replay mode

---

## 6. ORDER PANEL ISSUES

### Current State
- Panel is functional but feels like a form, not a trading cockpit
- BUY/SELL toggle uses flat buttons — should have strong visual weight with prominent glow
- Quick quantity buttons (1, 5, 10, 25, 50, 100) — good but no lot multiplier awareness
- Missing controls that are REQUIRED (per project rules):
  - **BE (Break Even)** — not in order panel
  - **TP (Take Profit)** — not in order panel (only in positions table)
  - **SL (Stop Loss)** — not in order panel (only in positions table)
  - **TSL (Trailing Stop Loss)** — not in order panel
  - **REV (Reverse)** — not in order panel
  - **EXIT** — not in order panel
  - **HALF** — not in order panel
  - **CLOSE ALL** — exists only in bottom panel
- No bracket order support visible
- No advanced order types (GTT, AMO, IOC/FOK)
- Missing "Max Position" risk indicator
- No order confirmation modal/preview
- `ProBtn` component exists but is UNUSED (defined but never rendered in JSX)

### Comparison: TopStepX / FundingPips
- One-click trade buttons with size prominent
- Bracket order inline (SL+TP in order form)
- Risk preview (max loss if SL hit)
- Position-aware buttons (shows current position, allows quick reverse)

---

## 7. RISK PANEL ISSUES

### Current State — RiskWidget (right sidebar)
- Shows 3 bars: Daily Loss, Max Drawdown, Profit Target
- Compact and functional but lacks:
  - Real-time P&L counter
  - Challenge phase info
  - Days remaining
  - Trading days count
  - Consistency score

### Current State — RiskPanel (bottom tab)
- Comprehensive dashboard with 12 metrics, 4 progress bars, streak info
- **Problem**: Too much information packed into a bottom panel tab that's only 180px tall
- Risk score calculation is good but the presentation feels like a dashboard widget, not a terminal component
- No risk alerts/warnings as overlays or notifications

### Expected (TopStepX, FundingPips model)
- Risk info is ALWAYS visible — not hidden in a tab
- Challenge progress card in sidebar or top bar
- Pop-up risk warnings when approaching limits
- Color-coded status changes in real-time

---

## 8. BOTTOM PANEL ISSUES

### Current State
- 7 tabs: Positions, Orders, Trade Book, Journal, Alerts, Analytics, Risk
- Tab bar is well-structured with counts
- Position table has all professional action buttons (BE, TP, SL, TSL, %, Reverse, Add)
- **Problem**: Default height 180px means only 1-2 positions visible before scrolling
- **Problem**: Close All button is small and non-prominent
- **Problem**: Tab labels use 12px font — should be 11px with tighter spacing for pro look
- **Problem**: Empty states are too large — waste vertical space with 28px icons and centered text
- **Problem**: No auto-refresh indicator visible to user
- Orders and Trades tables lack inline modify capability

### Comparison: TradeLocker
- Bottom panel has thin tabs (24-28px tab bar)
- Position rows are denser (28px row height vs current ~36px)
- Drag-to-resize is more visible with a grabber line
- Quick-action buttons appear inline on row hover

---

## 9. STATUS BAR ISSUES

### Current State
- Height 24px — appropriate
- Shows: Feed status, Ping, Market status, Workspace, Symbol, Panel toggles
- **Problem**: Feed shows "Disconnected" with red icon — this is the default state and looks alarming
- **Problem**: Panel toggle buttons in status bar duplicate TopBar controls
- **Missing**: Server time / exchange clock
- **Missing**: Account identifier
- **Missing**: Version number
- **Missing**: Quick-access to settings

---

## 10. ACCOUNT SUMMARY BAR ISSUES

### Current State
- Height 32px, shows Balance, Equity, Day P&L, Total P&L, DD Used, Target, Phase
- Mini progress bars for DD and Target — good
- **Problem**: Too horizontal — all metrics in a single line makes scanning difficult
- **Problem**: No hover tooltips explaining each metric
- **Problem**: Phase indicator is just plain text with no visual weight
- **Problem**: No account switcher (prop firms often have multiple challenges)

---

## 11. PROFESSIONAL TERMINAL COMPARISON

| Feature | FW Terminal (Current) | TradeLocker | MatchTrader | TopStepX | DXTrade | FundingPips |
|---------|----------------------|-------------|-------------|----------|---------|-------------|
| Sidebar Navigation | ✗ None | ✓ Icon rail | ✓ Icon rail | ✓ Left bar | ✓ Left dock | ✓ Side menu |
| Dark-only default | ~ (light exists) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Brand + Terminal text | ✗ Missing | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chart toolbar icons | ~ (some disabled) | ✓ Full | ✓ Full | ✓ Full | ✓ Full | ✓ Full |
| Indicators panel | ✗ Disabled | ✓ Modal | ✓ Modal | ✓ Sidebar | ✓ List | ✓ Modal |
| Drawing tools | ✗ Disabled | ✓ Rail | ✓ Rail | ✓ Rail | ✓ Menu | ✓ Rail |
| Bracket orders | ✗ None | ✓ | ✓ | ✓ | ✓ | ✓ |
| One-click trading | ✗ Two clicks | ✓ | ✓ | ✓ | ✓ | ✓ |
| Risk always visible | ~ (widget) | ✓ Bar | ✓ Header | ✓ Bar | ✓ Widget | ✓ Bar |
| Challenge progress | ~ (minimal) | N/A | N/A | ✓ Card | ✓ Card | ✓ Card |
| Layout switcher | ✗ None | ✓ | ✓ | ✓ | ✓ | ✓ |
| Account switcher | ✗ None | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dense watchlist | ~ (sparse rows) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Visual hierarchy | ✗ Flat | ✓ Layered | ✓ Layered | ✓ Depth | ✓ Depth | ✓ Depth |

---

## 12. SUMMARY OF CRITICAL ISSUES

### Must Fix (Blocking institutional feel)
1. ❌ "TERMINAL" text missing from branding
2. ❌ Light theme accessible — should be dark-only or deeply styled
3. ❌ No sidebar navigation rail
4. ❌ Indicators/Drawing tools shown as disabled instead of active with pending state
5. ❌ No chart layout switcher
6. ❌ Order panel missing bracket order (SL+TP inline)
7. ❌ Dead space when no symbol selected
8. ❌ Visual hierarchy is flat — no depth/layering
9. ❌ Panel headers lack professional controls (collapse, popout, settings)
10. ❌ No account/workspace switcher in a professional location

### Should Fix (Professional polish)
1. ⚠ Watchlist rows too sparse
2. ⚠ Bottom panel default height too short
3. ⚠ Status bar duplicates TopBar controls
4. ⚠ Risk widget needs challenge info (days, phase, consistency)
5. ⚠ Chart type selector is a dropdown not icon buttons
6. ⚠ No server clock / exchange time display
7. ⚠ Account summary bar too compressed
8. ⚠ Theme toggle in TopBar wastes space — move to settings

### Nice to Have (Differentiation)
1. 💡 Sparkline mini-charts in watchlist rows
2. 💡 Heatmap coloring for watchlist
3. 💡 Risk alert overlays/toasts
4. 💡 Order confirmation modal
5. 💡 Position PnL ticker animation

---

## 13. CONCLUSION

The current terminal has solid **functional foundations** — all major components exist (watchlist, chart, order entry, positions, risk management, market depth, option chain). The code quality is good and the architecture supports the required features.

However, the **visual presentation** falls short of institutional-grade prop firm terminals:
- It looks like a well-built **developer prototype** rather than a production terminal
- Lacks the visual density, depth, and polish of TradeLocker/MatchTrader/TopStepX
- Missing key UI patterns (sidebar rail, layout switcher, bracket orders)
- Branding is incomplete and the light theme undermines the professional dark terminal identity
- Controls that should always be visible are disabled or missing from their professional locations

**The rebuild must focus on visual shell, density, hierarchy, and identity — NOT functionality removal.**

---

*Audit completed by Agent A*
*Date: 2026-06-19*
