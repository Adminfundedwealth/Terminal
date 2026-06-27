# Tasks

## Task 1: Theme Engine - CSS Variable Injection and Theme Switching

- [x] Create `src/store/themeStore.ts` with Zustand store managing theme state (activeThemeId, densityMode, activeProfile, customThemes)
- [x] Implement `applyTheme()` action that injects CSS custom properties on document root without React re-renders
- [x] Implement 4 built-in theme presets (Dark Pro, Light, Midnight Blue, High Contrast) with full color token sets
- [x] Implement density modes (compact, default, comfortable) updating padding/spacing CSS variables
- [x] Implement trading profile presets (scalper, intraday, swing, options-trader) that auto-apply density and font size
- [x] Add localStorage persistence and server sync with 5-second timeout and retry on next load
- [x] Add theme validation: reject invalid CSS colors, enforce name 1-50 chars unique non-empty, fallback to Dark Pro on corruption
- [x] Ensure theme switch completes within 16ms (one animation frame) by using batch CSS property updates
- [x] Create `src/styles/themes.css` with CSS custom property definitions for all theme tokens

### Requirement References
- Requirement 1: AC 1, 2, 3, 4, 5, 6, 7, 8

## Task 2: Layout Engine - Workspace Layout Management

- [x] Create `src/store/layoutStore.ts` with Zustand store managing layout state (chartLayout, docks, bottomPanel, savedLayouts)
- [x] Implement chart layout modes (1-chart, 2-chart-horizontal, 2-chart-vertical, 4-chart)
- [x] Implement dock resize with width clamped between 200px-600px and height between 150px and viewport-header
- [x] Implement layout save/load with complete panel configuration persistence
- [x] Implement auto-collapse docks when viewport < 1024px using ResizeObserver
- [x] Ensure at least one chart remains visible in all layout modes
- [x] Implement workspace switching within 100ms transition time
- [x] Implement layout restore on app reload per user account
- [x] Handle unavailable modules in saved layouts with default empty panel substitution

### Requirement References
- Requirement 2: AC 1, 2, 3, 4, 5, 6, 7, 8, 9

## Task 3: State Hub - Centralized Event Bus

- [x] Enhance `src/store/appStore.ts` as the centralized State Hub with symbol linking, theme propagation, and risk alert channels
- [x] Implement symbol link groups that propagate symbol changes to chart, DOM, order panel, and option chain
- [x] Implement cross-module event dispatch (ORDER_SUBMIT, ORDER_CONFIRMED, RISK_ALERT, SYMBOL_CHANGE)
- [x] Implement market data state slice with quote throttling (max 5 updates/second per symbol)
- [x] Implement UI update batching within 16ms frames using requestAnimationFrame

### Requirement References
- Requirement 14: AC 1, 5
- Requirement 15: AC 2

## Task 4: Order Execution Center - Professional Order Entry

- [x] Enhance `src/components/OrderPanel.tsx` with all order types (Market, Limit, SL, SL-M, Bracket, OCO, GTT, Basket, Algo)
- [x] Implement real-time risk preview calculation (margin, max loss, risk-reward, account risk %) within 100ms of input change
- [x] Implement order submission flow through Risk_Center validation before routing to trading engine
- [x] Implement idempotent submission with client-generated nonce and 60-second deduplication window
- [x] Implement bracket order atomic creation (entry + SL + TP as single operation) with 3 retries on child leg failure
- [x] Implement submit button disable with processing indicator during submission (10-second timeout)
- [x] Implement stale-data indicator when LTP unavailable, disabling order submission until live data restored
- [x] Update `src/store/tradingStore.ts` with order dispatch, confirmation handling, and position updates within 200ms

### Requirement References
- Requirement 3: AC 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

## Task 5: DOM Panel - Depth of Market Price Ladder

- [x] Enhance `src/components/MarketDepthPanel.tsx` as full DOM panel with configurable levels (5-50, default 20) centered on LTP
- [x] Implement one-click trading: ask side click → Limit BUY, bid side click → Limit SELL routed through Risk_Center
- [x] Implement draggable SL/TP markers with visual completion, error notification on failure, and revert on confirmed failure
- [x] Implement 8ms per frame rendering with CSS transforms for price scrolling
- [x] Display bid qty, ask qty, volume, and delta (buy - sell volume) at each level
- [x] Implement stale-data detection (>5 seconds) disabling one-click trading with last known levels retained
- [x] Handle combined risk rejection and technical failure with dual error display for 3+ seconds

### Requirement References
- Requirement 4: AC 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

## Task 6: Options Workspace - Analytics and Strategy Builder

- [x] Enhance `src/components/OptionChainModal.tsx` as full Options Workspace with live Greeks (delta, gamma, theta, vega, IV)
- [x] Implement multi-leg strategy builder (1-6 legs) with max profit, max loss, breakeven, net premium, net Greeks calculations
- [x] Implement payoff diagram: 20% below to 20% above spot, minimum 100 points, refuse generation if cannot meet minimum
- [x] Implement breakeven point identification (sign change detection) to 0.01 precision
- [x] Implement max pain calculation (strike where most options expire worthless)
- [x] Implement Put-Call Ratio (put OI / call OI to 2 decimals, display 0.00 when puts are zero)
- [x] Handle zero volume/OI strikes: display N/A for IV and dependent Greeks, exclude from strategy aggregation
- [x] Create Web Worker (`src/workers/optionsWorker.ts`) for Greeks and payoff computation off main thread

### Requirement References
- Requirement 5: AC 1, 2, 3, 4, 5, 6, 7

## Task 7: Scanner Workspace - Market Scanner

- [x] Create `src/components/ScannerPanel.tsx` with predefined and custom scanner configuration UI
- [x] Implement scanner execution: evaluate all instruments against conditions using AND logic
- [x] Implement relevance scoring (sum of normalized deviations) and sorted results
- [x] Implement stale data exclusion (>5s age) with warning badge showing excluded count
- [x] Ensure full scan cycle of 500 instruments within 500ms using Web Worker
- [x] Implement custom scanner validation (valid fields/operators), allow save/execute with warnings only when validation fails
- [x] Implement scanner alerts via toast notification and optional sound for new matches
- [x] Implement empty-state message when zero instruments match
- [x] Create Web Worker (`src/workers/scannerWorker.ts`) for scan evaluation off main thread

### Requirement References
- Requirement 6: AC 1, 2, 3, 4, 5, 6, 7

## Task 8: AI Workspace - AI-Powered Trading Insights

- [x] Create `src/components/AIPanel.tsx` with trade review, behavioral analysis, daily summary, and coaching tabs
- [x] Implement trade review: entry/exit/risk scores (1-10) with text explanations within 10 seconds
- [x] Implement behavioral analysis: overtrading (>2x avg), revenge trading (loss → larger position in 5min), FOMO, emotional triggers
- [x] Implement daily summary: total trades, win/loss, net P&L, 1-5 improvement suggestions referencing specific trades
- [x] Implement coaching advice referencing last 7 days metrics and open positions within 10 seconds
- [x] Handle AI service unavailability (15-second timeout): show error, allow retry, keep UI elements visible
- [x] Handle insufficient data (<5 trades): show same message for 0 and 1-4 trades without distinction

### Requirement References
- Requirement 7: AC 1, 2, 3, 4, 5, 6

## Task 9: Risk Center - Comprehensive Risk Management

- [x] Enhance `src/components/RiskPanel.tsx` with daily loss tracking, drawdown monitoring, and rule breach warnings
- [x] Implement pre-trade risk validation in `src/store/tradingStore.ts` checking all risk rules before order dispatch
- [x] Implement daily loss limit check: 80% warning threshold display, rejection when exceeded
- [x] Implement drawdown limit check with rejection and explanation
- [x] Implement margin check: reject when required > available, allow when equal (including both zero)
- [x] Implement position count limit, lot size limit, market hours check, and segment restriction checks
- [x] Implement risk rule configuration updates applied within 1 second
- [x] Identify specific violated Risk_Rule in rejection messages (daily loss, drawdown, margin, position, lot, segment, hours)

### Requirement References
- Requirement 8: AC 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

## Task 10: Position Sizing Calculator

- [x] Add position sizing to `src/components/OrderPanel.tsx` with balance, risk%, entry, and stop-loss inputs
- [x] Implement calculation: qty = risk_amount / |entry - stopLoss|, round down to lot size multiple, re-verify constraint
- [x] Handle minimum lot size case: return 1 lot with risk-exceed warning
- [x] Validate inputs: reject zero/negative values, equal entry/stop-loss, risk% outside 0.01-100 range
- [x] Display clear error messages indicating which specific input is invalid

### Requirement References
- Requirement 9: AC 1, 2, 3, 4, 5, 6

## Task 11: Emergency Kill Switch

- [x] Create kill switch UI in `src/components/RiskPanel.tsx` or dedicated component with 2-click confirmation (second within 5s) or PIN
- [x] Implement kill switch logic: cancel all pending/open orders → close positions at market → lock accounts (sequential per account)
- [x] Implement 5000ms hard timeout returning partial results (completed, pending, failed accounts)
- [x] Implement retry for failed position closures: every 2s for max 15 retries, then mark for manual intervention
- [x] Log audit trail (timestamp, user ID, account IDs, positions closed, orders cancelled, reason)
- [x] Implement rate limiting: max 1 per 60 seconds per user with remaining wait time in rejection message
- [x] Display confirmation summary only when ALL positions/orders successfully processed
- [x] Display real-time progress indicator (accounts processed / total)

### Requirement References
- Requirement 10: AC 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

## Task 12: Journal Workspace - Trade Journaling

- [x] Enhance `src/components/JournalPanel.tsx` with auto-capture, emotion tagging, mistake categorization
- [x] Implement auto-capture on `trade.executed` event: symbol, side, P&L, entry/exit price, qty, timestamp
- [x] Implement emotion tagging: exactly one from (confident, fearful, greedy, calm, frustrated, euphoric, anxious, neutral)
- [x] Implement mistake tagging: one or more from predefined types + custom (max 50 chars), save predefined even if custom is invalid
- [x] Implement journal analytics: total trades, win rate, total P&L, avg P&L, most frequent emotion/mistake
- [x] Implement retry queue for failed auto-captures with notification only on failure
- [x] Update `src/store/journalStore.ts` with entry management, tagging, and analytics computation

### Requirement References
- Requirement 11: AC 1, 2, 3, 4, 5

## Task 13: Analytics Workspace - Performance Analytics

- [x] Enhance `src/components/AnalyticsPanel.tsx` with metrics, equity curve, heat calendar, and report export
- [x] Implement performance metrics: win rate, profit factor, Sharpe ratio (0% risk-free), expectancy, max drawdown, avg win/loss, total trades
- [x] Implement equity curve: daily cumulative P&L time-series, empty chart for zero trades
- [x] Implement heat calendar: daily P&L and trade count per day for specified year
- [x] Implement report export (PDF/CSV) with metrics, equity data, account ID, date range within 30 seconds
- [x] Handle zero-trade periods: all metrics zero/null, empty data series, indication of no trades

### Requirement References
- Requirement 12: AC 1, 2, 3, 4, 5

## Task 14: Multi-Account Management (Founder Scale)

- [x] Create `src/components/AccountManager.tsx` with master-slave configuration and portfolio exposure
- [x] Implement master-slave replication: compute slave qty = master qty × copy ratio, round down to lot size (floor rounding in computation step)
- [x] Implement copy modes: mirror (same direction/price), proportional (scaled by ratio), fixed-lot (per slave)
- [x] Handle slave rejection: skip failed slave, continue to remaining, notify which failed and why
- [x] Implement portfolio exposure: aggregate positions by symbol/sector/segment across all accounts within 2 seconds
- [x] Implement master order modification/cancellation propagation to all slave accounts
- [x] Handle zero-lot rounding: skip replication for that slave, log warning
- [x] Create `src/store/founderStore.ts` for multi-account state management

### Requirement References
- Requirement 13: AC 1, 2, 3, 4, 5, 6

## Task 15: WebSocket and Market Data Management

- [x] Enhance `src/services/websocket.ts` with reconnection logic (exponential backoff: 1s, 2s, 4s... max 30s, max 20 attempts)
- [x] Implement 10-second no-message detection: show reconnecting banner, freeze prices with stale indicator, disable DOM trading
- [x] Implement reconnection recovery: re-subscribe tokens, refresh depth, continuously evaluate quotes until 3 consecutive within 5s each
- [x] Implement UI update throttling: max 5 updates/second per symbol, render latest value each animation frame
- [x] Implement panel subscription lifecycle: unsubscribe hidden panels within 1s, re-subscribe on visible within 2s
- [x] Handle in-flight order warning on disconnection: display uncertain status, prompt verification on reconnect

### Requirement References
- Requirement 14: AC 1, 2, 3, 4, 5, 6
- Requirement 16: AC 4, 5, 6

## Task 16: Global Search and Navigation

- [x] Enhance `src/components/SearchModal.tsx` with keyboard shortcut activation, symbol/command search, max 50 results
- [x] Implement search result selection propagating symbol to all linked modules within 200ms
- [x] Implement hotkey execution within 100ms using `src/hooks/useHotkeys.ts`
- [x] Implement empty-state message for no matching results
- [x] Implement Escape/outside-click dismiss: keep modal open if focus target panel unavailable
- [x] Implement filtered results update within 150ms of each keystroke

### Requirement References
- Requirement 15: AC 1, 2, 3, 4, 5, 6

## Task 17: Application Performance - Web Workers and Virtual Scrolling

- [x] Initialize Web Workers on application load regardless of computation needs; refuse to start if unavailable
- [x] Implement virtual scrolling for all lists (watchlists, positions, orders, option chain) supporting 10,000 items at 60fps
- [x] Ensure no main-thread task exceeds 50ms during Web Worker computation
- [x] Implement market data batching: coalesce ticks within 16ms frames maintaining 60fps
- [x] Achieve Time to Interactive < 2 seconds on simulated 4G connection

### Requirement References
- Requirement 16: AC 1, 2, 3, 4

## Task 18: Integration Testing and Verification

- [x] Write integration tests for order flow: entry → risk check → broker → position update → UI refresh
- [x] Write integration tests for WebSocket lifecycle: connect → subscribe → data → disconnect → reconnect → resubscribe
- [-] Write integration tests for layout persistence: save → reload → verify restoration
- [x] Write integration tests for kill switch: trigger → positions closed → accounts locked → UI blocked
- [x] Write property-based tests for position sizing (fast-check): qty × risk_per_unit ≤ max_risk for all valid inputs
- [ ] Write property-based tests for risk engine: approved orders keep account within all limits
- [~] Write property-based tests for DOM ladder: exactly N levels, one LTP marker, descending prices
