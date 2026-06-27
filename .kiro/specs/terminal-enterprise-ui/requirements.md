# Requirements Document

## Introduction

FundedWealth Terminal Enterprise UI is an institutional-grade trading terminal interface that provides multi-layout charting, professional order execution, depth-of-market trading, options analytics, AI-powered insights, and comprehensive risk management within a themeable, high-density UI shell. The system is architected as a modular, workspace-driven application where each functional area operates as an independent workspace module coordinated by a centralized state bus.

## Glossary

- **Terminal_Shell**: The top-level application frame that contains all workspace modules, manages global state, theming, layout, and hotkey management
- **Theme_Engine**: The module responsible for managing CSS custom property injection, theme switching, density modes, and trading profiles
- **Layout_Engine**: The module responsible for managing workspace layouts, dock panels, tab systems, multi-chart grids, and drag-and-drop panel rearrangement
- **State_Hub**: The centralized Zustand-based event bus that coordinates cross-module communication including symbol linking, theme propagation, and risk alerts
- **Order_Execution_Center**: The module responsible for professional order entry with all order types, risk preview, position sizing, and one-click execution
- **DOM_Panel**: The Depth of Market panel providing a professional price ladder with depth levels, one-click trading, and order flow visualization
- **Options_Workspace**: The module for professional options analysis with live Greeks, strategy building, payoff diagrams, and multi-leg order construction
- **Scanner_Workspace**: The module for real-time market scanning with predefined and custom conditions, alert triggers, and saved configurations
- **AI_Workspace**: The module providing AI-powered trading assistance including trade review, risk analysis, coaching, and behavioral analysis
- **Risk_Center**: The module for comprehensive risk monitoring with daily loss tracking, drawdown limits, rule breach warnings, and emergency account locking
- **Journal_Workspace**: The module for trade journaling with auto-capture, screenshot annotation, emotion tracking, and strategy tagging
- **Analytics_Workspace**: The module for performance analytics with metrics, heat calendars, performance curves, and setup analysis
- **Founder_Scale**: The module for multi-account management, master-slave trading, portfolio exposure monitoring, and emergency kill switch
- **Kill_Switch**: An emergency function that immediately closes all positions, cancels all orders, and locks all accounts
- **LTP**: Last Traded Price — the most recent price at which a trade executed
- **DOM_Ladder**: A vertical price ladder display showing order book depth, user orders, volume, and delta at each price level
- **Trading_Profile**: A preset configuration (scalper, intraday, swing, options-trader) that adjusts density, font size, and layout for a specific trading style
- **Risk_Rule**: A configurable rule that defines limits on daily loss, drawdown, position count, lot size, or margin usage

## Requirements

### Requirement 1: Theme Management

**User Story:** As a trader, I want to switch between pre-built themes and customize my own theme, so that the terminal appearance matches my preferences and reduces eye strain during long sessions.

#### Acceptance Criteria

1. WHEN a trader selects a theme preset from the available set (Dark Pro, Light, Midnight Blue, High Contrast), THE Theme_Engine SHALL update all CSS custom properties on the document root without triggering React component re-renders
2. WHEN a theme is applied, THE Theme_Engine SHALL persist the theme preference to localStorage and synchronize it to the server within 5 seconds
3. IF server synchronization of a theme preference fails, THEN THE Theme_Engine SHALL retain the theme locally, retry synchronization on the next application load, and not revert the visual change
4. WHEN a trader sets a density mode (compact, default, comfortable), THE Theme_Engine SHALL update padding and spacing CSS variables so that all visible panels use the spacing scale defined for the selected mode
5. WHEN a trader selects a trading profile (scalper, intraday, swing, options-trader), THE Theme_Engine SHALL apply the corresponding density and font size preset automatically
6. IF a custom theme configuration is corrupted or invalid (missing required color properties, containing non-parseable CSS color values, or having an empty theme name), THEN THE Theme_Engine SHALL fall back to the default Dark Pro theme and display a visible notification indicating the theme was reset. THE Theme_Engine SHALL only display reset notifications when actual corruption or invalidity is detected; valid theme configurations SHALL NOT trigger any notification even if the theme name is empty but colors are valid
7. THE Theme_Engine SHALL complete all visual theme changes within 16 milliseconds (one animation frame)
8. WHEN a trader creates a custom theme, THE Theme_Engine SHALL validate that all color values are valid CSS colors and the theme name is between 1 and 50 characters, unique among the trader's saved themes, and non-empty

### Requirement 2: Layout Management

**User Story:** As a trader, I want to manage my workspace layout with dockable panels, multi-chart grids, and resizable regions, so that I can arrange information optimally for my trading style.

#### Acceptance Criteria

1. WHEN a trader selects a chart layout mode, THE Layout_Engine SHALL arrange the center workspace into the specified configuration (1-chart, 2-chart-horizontal, 2-chart-vertical, or 4-chart)
2. WHEN a trader drags a panel border, THE Layout_Engine SHALL resize the panel while keeping dock width between 200 pixels minimum and 600 pixels maximum, and panel height between 150 pixels minimum and the viewport height minus the header height
3. WHEN a trader saves a layout, THE Layout_Engine SHALL persist the complete panel configuration (panel positions, dimensions, dock state, collapse state, chart layout mode, and active workspace assignments). THE Layout_Engine SHALL only enforce completeness of persistence during the save operation; restoration behavior is not governed by this criterion
4. WHEN the viewport width decreases below 1024 pixels, THE Layout_Engine SHALL always auto-collapse dock panels to preserve chart space, regardless of whether charts are currently visible
5. THE Layout_Engine SHALL maintain at least one visible chart in any layout mode
6. WHEN a trader switches between workspace types, THE Layout_Engine SHALL complete the transition within 100 milliseconds
7. WHEN a trader reloads the application, THE Layout_Engine SHALL restore the previously active layout state per user account
8. IF a saved layout references panels or modules that are no longer available, THEN THE Layout_Engine SHALL restore all valid panels from the layout configuration and substitute a default empty panel for any unavailable module
9. IF a layout resize drag would result in a dimension outside the permitted bounds, THEN THE Layout_Engine SHALL clamp the panel dimension to the nearest permitted limit and stop the resize at that boundary

### Requirement 3: Order Execution

**User Story:** As a trader, I want to place various order types with real-time risk preview and one-click execution, so that I can execute trades quickly and confidently.

#### Acceptance Criteria

1. WHEN a trader configures an order by setting symbol, quantity, order type, and price (where applicable), THE Order_Execution_Center SHALL calculate and display risk metrics including margin required, max loss, risk-reward ratio, and account risk percentage within 100 milliseconds of the last input change
2. WHEN a trader submits an order, THE State_Hub SHALL dispatch the order through the Risk_Center for validation before routing to the trading engine. THE dispatch to Risk_Center SHALL occur regardless of the validation outcome
3. IF the Risk_Center rejects an order, THEN THE Order_Execution_Center SHALL display the rejection reason inline on the order panel and show a toast notification to the trader within 200 milliseconds of rejection
4. WHEN an order is confirmed by the broker, THE State_Hub SHALL update positions, the DOM_Ladder, and the order panel within 200 milliseconds of confirmation
5. THE Order_Execution_Center SHALL support Market, Limit, Stop-Loss, Stop-Loss Market, Bracket, OCO, GTT, Basket, and Algo order types
6. WHEN a trader submits an order with a client-generated nonce that has been used previously within a 60-second deduplication window, THE Order_Execution_Center SHALL reject the duplicate and place only one order (idempotent submission)
7. WHEN a trader submits a bracket order, THE Order_Execution_Center SHALL create entry, stop-loss, and take-profit legs as a single atomic operation
8. IF a bracket order entry leg is filled but a child leg (stop-loss or take-profit) fails to be placed, THEN THE Order_Execution_Center SHALL retry the failed leg up to 3 times and display an error notification indicating the incomplete bracket if all retries fail
9. IF the risk preview cannot be calculated due to missing market data (no LTP available), THEN THE Order_Execution_Center SHALL display a stale-data indicator in the risk preview area and disable order submission until live data is restored. THE Order_Execution_Center SHALL allow order submission when connectivity issues or account restrictions exist but market data is available
10. WHILE an order is being submitted to the broker, THE Order_Execution_Center SHALL disable the submit button and display a processing indicator until confirmation or rejection is received or a 10-second timeout elapses

### Requirement 4: Depth of Market (DOM) Panel

**User Story:** As a trader, I want to view and trade directly on a price ladder showing order book depth, so that I can execute orders at specific price levels with one click.

#### Acceptance Criteria

1. WHEN depth data is received, THE DOM_Panel SHALL render a price ladder with exactly the configured number of levels (minimum 5, maximum 50, default 20) centered on the LTP
2. THE DOM_Panel SHALL mark exactly one level as the LTP level in each render
3. WHEN a trader clicks the ask side of a price level, THE DOM_Panel SHALL initiate a Limit BUY order at that price with the configured quantity and route it through the Risk_Center for validation
4. WHEN a trader clicks the bid side of a price level, THE DOM_Panel SHALL initiate a Limit SELL order at that price with the configured quantity and route it through the Risk_Center for validation
5. WHEN a trader drags a stop-loss marker on the ladder, THE DOM_Panel SHALL modify the corresponding order to the new price level. IF the order modification fails due to market conditions or connectivity issues, THEN THE DOM_Panel SHALL allow the marker drag to complete visually and display an error notification, and SHALL revert the marker to its previous position once the failure is confirmed
6. WHEN a trader drags a take-profit marker on the ladder, THE DOM_Panel SHALL modify the corresponding order to the new price level. IF the order modification fails due to market conditions or connectivity issues, THEN THE DOM_Panel SHALL allow the marker drag to complete visually and display an error notification, and SHALL revert the marker to its previous position once the failure is confirmed
7. THE DOM_Panel SHALL refresh the ladder display within 8 milliseconds per frame
8. WHEN depth data updates, THE DOM_Panel SHALL display bid quantity, ask quantity, volume, and delta (buy minus sell volume) at each price level
9. IF an order initiated or modified from the DOM_Panel is rejected by the Risk_Center or fails to submit due to both a risk rejection AND a technical issue simultaneously, THEN THE DOM_Panel SHALL handle this as a special case by displaying both the risk rejection reason and the technical failure separately, showing the error indication at the relevant price level for at least 3 seconds and reverting any visual marker to its previous position
10. IF depth data has not been received for more than 5 seconds, THEN THE DOM_Panel SHALL display a stale-data indicator on the ladder, disable one-click trading, and retain the last known price levels until fresh data arrives

### Requirement 5: Options Analytics

**User Story:** As an options trader, I want to analyze option chains with live Greeks, build multi-leg strategies, and visualize payoff diagrams, so that I can make informed options trading decisions.

#### Acceptance Criteria

1. WHEN an options trader loads an option chain, THE Options_Workspace SHALL display all available strikes for the selected expiry with delta, gamma, theta, vega, and implied volatility updated within 200 milliseconds of each underlying quote change
2. WHEN an options trader builds a strategy with one to six legs, THE Options_Workspace SHALL calculate max profit, max loss, breakeven points, net premium, and net Greeks, displaying "Unlimited" when profit or loss is theoretically unbounded
3. WHEN an options trader requests a payoff diagram, THE Options_Workspace SHALL generate a curve spanning from exactly 20 percent below to exactly 20 percent above the current spot price with at least 100 evenly spaced price points showing profit and loss at each spot price. THE Options_Workspace SHALL enforce these exact 20% range bounds and SHALL NOT allow customizable range specification. IF the system cannot compute at least 100 price points due to system constraints, THEN THE Options_Workspace SHALL refuse to generate the diagram and display an error message indicating the minimum point requirement cannot be met
4. THE Options_Workspace SHALL identify breakeven points where the payoff curve changes sign, computed to a precision within 0.01 of the underlying price unit
5. WHEN an options trader requests max pain, THE Options_Workspace SHALL calculate the strike price at which the total value of all outstanding puts and calls that expire worthless is maximized
6. WHEN an options trader requests the Put-Call Ratio, THE Options_Workspace SHALL compute the ratio of total put open interest to total call open interest for the specified underlying and expiry, displayed to two decimal places. WHEN put open interest is zero and call open interest is non-zero, THE Options_Workspace SHALL display the ratio as 0.00
7. IF implied volatility cannot be computed for a strike due to zero volume or zero open interest, THEN THE Options_Workspace SHALL display a dash or "N/A" indicator for that strike's IV and dependent Greeks and exclude that strike from strategy Greeks aggregation

### Requirement 6: Market Scanner

**User Story:** As a trader, I want to scan the market in real-time using predefined and custom conditions, so that I can identify trading opportunities quickly.

#### Acceptance Criteria

1. WHEN a scanner is executed, THE Scanner_Workspace SHALL evaluate all instruments in the configured universe against all scan conditions using AND logic
2. WHEN an instrument matches all conditions, THE Scanner_Workspace SHALL include it in results sorted by relevance score, where the relevance score is the sum of normalized deviations from each condition's threshold value
3. WHEN an instrument has market data older than 5 seconds, THE Scanner_Workspace SHALL exclude it from results and display a stale data warning badge indicating the count of excluded instruments
4. THE Scanner_Workspace SHALL complete a full scan cycle of up to 500 instruments within 500 milliseconds
5. WHEN a trader creates a custom scanner, THE Scanner_Workspace SHALL validate that conditions reference valid fields and operators, and reject invalid configurations with an error message indicating which condition failed validation. THE Scanner_Workspace SHALL allow saving and executing scanners even when validation fails, displaying the validation warnings inline. THE Scanner_Workspace SHALL only execute with warnings when validation actually fails; successful validation SHALL proceed without warnings
6. WHEN a trader sets an alert on a scanner, THE Scanner_Workspace SHALL notify the trader via a toast notification and an optional sound when new instruments match the scanner conditions that were not present in the previous scan cycle
7. IF a scanner execution returns zero matching instruments, THEN THE Scanner_Workspace SHALL display an empty-state message indicating no instruments matched the configured conditions

### Requirement 7: AI-Powered Insights

**User Story:** As a trader, I want AI-powered analysis of my trades and behavior, so that I can identify patterns, mistakes, and areas for improvement.

#### Acceptance Criteria

1. WHEN a trader requests a trade review, THE AI_Workspace SHALL analyze the trade and provide entry quality, exit quality, and risk management scores on a 1-10 scale, along with a text explanation for each score, within 10 seconds of the request
2. WHEN a trader requests behavioral analysis, THE AI_Workspace SHALL analyze trades from the specified date range (defaulting to the last 30 calendar days) and identify patterns including overtrading (exceeding the trader's average daily trade count by more than 2x), revenge trading (a loss followed by a larger position within 5 minutes), fear of missing out (entries after extended price moves), and emotional triggers
3. WHEN a trader requests a daily summary, THE AI_Workspace SHALL generate a summary covering total trades taken, win/loss count, net P&L, and between 1 and 5 improvement suggestions referencing specific trades from that day
4. WHEN a trader requests coaching advice, THE AI_Workspace SHALL provide guidance referencing the trader's performance metrics and open positions from the last 7 calendar days, delivered within 10 seconds of the request
5. IF the AI service is unavailable or fails to respond within 15 seconds, THEN THE AI_Workspace SHALL display an error message indicating the service is temporarily unavailable and allow the trader to retry the request. AI-related UI elements SHALL remain visible but display the error state rather than being hidden or disabled
6. IF the trader has fewer than 5 completed trades in the requested analysis period (whether zero trades or 1-4 trades), THEN THE AI_Workspace SHALL display the same insufficient data message indicating that a minimum of 5 trades is required, without distinguishing between zero and 1-4 trades

### Requirement 8: Risk Management

**User Story:** As a trader, I want comprehensive risk monitoring with configurable limits and breach warnings, so that I can protect my capital and comply with firm rules.

#### Acceptance Criteria

1. WHEN a trader's daily loss (sum of realized losses and unrealized losses on open positions for the current trading day) reaches or exceeds 80 percent of the configured daily loss limit, THE Risk_Center SHALL display a breach warning indicating the current loss amount, the daily loss limit, and the percentage consumed
2. WHEN a proposed order would cause the daily loss (realized losses plus unrealized losses plus the maximum potential loss of the proposed order) to exceed the configured daily loss limit, THE Risk_Center SHALL reject the order with an explanation indicating the current daily loss, the order's potential loss contribution, and the configured daily loss limit
3. WHEN a proposed order would cause the account drawdown (decline from the account's peak equity) to exceed the configured maximum drawdown limit, THE Risk_Center SHALL reject the order with an explanation indicating the current drawdown, the order's potential impact, and the configured maximum drawdown limit
4. WHEN a proposed order requires more margin than the account's available free margin, THE Risk_Center SHALL reject the order with an explanation indicating the margin required by the order and the available free margin. WHEN the margin required by an order equals the available free margin (including when both are zero), THE Risk_Center SHALL allow the order
5. WHEN a trader's open position count equals the configured maximum position count for the account, THE Risk_Center SHALL reject additional orders with an explanation indicating the current position count and the configured maximum
6. WHEN a proposed order's lot size exceeds the configured maximum lot size for the account, THE Risk_Center SHALL reject the order with an explanation indicating the requested lot size and the configured maximum lot size
7. IF the market is closed for the order's segment, THEN THE Risk_Center SHALL reject the order with a message indicating the segment name and its current closed status
8. IF the order's segment is not in the account's configured list of allowed segments, THEN THE Risk_Center SHALL reject the order with an explanation indicating the requested segment and the allowed segments for the account
9. WHEN a Risk_Rule configuration is updated for an account, THE Risk_Center SHALL apply the new limit values to all subsequent order validations for that account within 1 second of the configuration change
10. WHEN the Risk_Center rejects an order, THE Risk_Center SHALL identify the specific Risk_Rule that caused the rejection so the trader can distinguish between daily loss, drawdown, margin, position count, lot size, segment, and market-hours violations

### Requirement 9: Position Sizing

**User Story:** As a trader, I want automatic position size calculation based on my risk parameters, so that I never risk more than my defined percentage on a single trade.

#### Acceptance Criteria

1. WHEN a trader provides balance, risk percentage, entry price, and stop-loss price, THE Order_Execution_Center SHALL calculate a position size in lots such that the maximum loss (quantity × absolute difference between entry and stop-loss) does not exceed the risk amount (balance × risk percentage ÷ 100)
2. WHEN the position size is calculated, THE Order_Execution_Center SHALL round the result down to any valid multiple of the instrument's lot size that does not exceed the calculated size, and SHALL re-verify that the risk constraint (quantity × |entry − stop-loss| ≤ balance × risk% ÷ 100) is satisfied after rounding
3. IF the calculated position size is less than one lot, THEN THE Order_Execution_Center SHALL return the minimum lot size with a warning indicating that risk may exceed the defined percentage
4. THE Order_Execution_Center SHALL ensure the calculated quantity multiplied by the absolute difference between entry and stop-loss is less than or equal to the account balance multiplied by the risk percentage divided by 100
5. IF the entry price equals the stop-loss price, or any input (balance, risk percentage, entry price, stop-loss price) is zero or negative, THEN THE Order_Execution_Center SHALL reject the calculation and display an error message indicating which input is invalid
6. THE Order_Execution_Center SHALL accept risk percentage values in the range 0.01 to 100 inclusive, and reject values outside this range with an error message indicating the valid range

### Requirement 10: Emergency Kill Switch

**User Story:** As a firm administrator, I want an emergency kill switch that immediately closes all positions and locks all accounts, so that catastrophic losses can be prevented.

#### Acceptance Criteria

1. WHEN a kill switch is triggered, THE Founder_Scale SHALL cancel all pending orders (status PENDING or OPEN) across all specified accounts before closing positions
2. WHEN a kill switch is triggered, THE Founder_Scale SHALL close all open positions at market price across all specified accounts, processing each account sequentially to ensure orders are cancelled before positions are closed for that account
3. WHEN a kill switch is triggered, THE Founder_Scale SHALL lock all specified accounts (set status to "locked") preventing further trading, applied per account after its positions are closed
4. THE Founder_Scale SHALL complete the kill switch operation within 5000 milliseconds, returning a partial result (listing accounts completed, accounts pending, and accounts failed) if the timeout is reached
5. IF some positions fail to close during a kill switch, THEN THE Founder_Scale SHALL continue processing remaining positions and retry failed closures every 2 seconds for a maximum of 15 retries (30 seconds total), then mark remaining failures as requiring manual intervention
6. WHEN a kill switch is executed, THE Founder_Scale SHALL log the action with timestamp, executing user ID, affected account IDs, positions closed count, orders cancelled count, and stated reason for audit trail
7. THE Founder_Scale SHALL require additional confirmation (a second click within 5 seconds of the first, or a PIN entry) before executing the kill switch
8. THE Founder_Scale SHALL rate-limit kill switch execution to a maximum of one per 60 seconds per user, rejecting subsequent attempts within the cooldown with a message indicating remaining wait time
9. IF all positions and orders are successfully closed and cancelled, THEN THE Founder_Scale SHALL display a confirmation summary showing total P&L realized, number of positions closed, number of orders cancelled, and execution duration. THE Founder_Scale SHALL only display the confirmation summary when all positions and orders are successfully processed; partial completions SHALL NOT display the confirmation summary
10. WHEN the kill switch is in progress, THE Founder_Scale SHALL display a real-time progress indicator showing the number of accounts processed out of total accounts

### Requirement 11: Trade Journaling

**User Story:** As a trader, I want to journal my trades with automatic capture, emotion tagging, and strategy annotations, so that I can review and learn from my trading history.

#### Acceptance Criteria

1. WHEN a `trade.executed` event is published on the event bus, THE Journal_Workspace SHALL auto-capture a journal entry containing symbol, side (BUY or SELL), realized P&L, entry price, exit price, quantity, and execution timestamp
2. WHEN a trader tags an emotion to a journal entry, THE Journal_Workspace SHALL associate exactly one of the defined emotion types (confident, fearful, greedy, calm, frustrated, euphoric, anxious, neutral) with the entry
3. WHEN a trader tags a mistake to a journal entry, THE Journal_Workspace SHALL associate one or more of the defined mistake types (fomo, revenge, oversize, no-sl, moved-sl, early-exit, late-entry, against-trend, custom) with the entry, where a custom mistake label is limited to 50 characters. IF a custom label exceeds 50 characters, THE Journal_Workspace SHALL reject only the invalid custom label while allowing predefined mistake types to be saved independently
4. WHEN a trader requests journal analytics for a date range, THE Journal_Workspace SHALL compute and display: total trades, win rate (percentage of entries with P&L greater than zero), total P&L, average P&L per trade, most frequent emotion, and most frequent mistake type across the filtered entries
5. IF the auto-capture of a journal entry fails, THEN THE Journal_Workspace SHALL retain the entry data in a retry queue and notify the trader that the entry requires manual review. THE Journal_Workspace SHALL only notify traders and require manual review when auto-capture actually fails; successful auto-captures SHALL NOT generate notifications or manual review flags

### Requirement 12: Performance Analytics

**User Story:** As a trader, I want comprehensive performance analytics with visual charts and exportable reports, so that I can track my progress and identify strengths and weaknesses.

#### Acceptance Criteria

1. WHEN a trader requests performance metrics for a date range, THE Analytics_Workspace SHALL compute and return: win rate (percentage of profitable trades), profit factor (gross profit divided by gross loss), Sharpe ratio (using annualized daily returns with a risk-free rate of 0%), expectancy (win_rate × average_win − loss_rate × average_loss), max drawdown (largest peak-to-trough decline in cumulative P&L during the period), average win (mean P&L of profitable trades), average loss (mean P&L of losing trades), and total trades (count of closed trades) — all computed from trades for the trader's account within the specified date range
2. WHEN a trader requests an equity curve for a date range, THE Analytics_Workspace SHALL generate a time-series of daily cumulative P&L data points (one point per calendar day with trading activity) for the specified period, where each point contains the date and end-of-day cumulative realized P&L. IF the date range contains zero trades, THE Analytics_Workspace SHALL display an empty chart with no data points
3. WHEN a trader requests a heat calendar, THE Analytics_Workspace SHALL display daily P&L and trade count for each day of the specified year
4. WHEN a trader exports a report, THE Analytics_Workspace SHALL generate the report in the requested format (PDF or CSV) containing the performance metrics from criterion 1, the equity curve data from criterion 2, and the account identifier and date range used — and SHALL deliver the generated file within 30 seconds of the request
5. IF a trader requests performance metrics or an equity curve for a date range containing zero closed trades, THEN THE Analytics_Workspace SHALL return all numeric metrics as zero (or null for ratios requiring division) and an empty data series for the equity curve, along with an indication that no trades exist for the selected period

### Requirement 13: Multi-Account Management

**User Story:** As a firm owner, I want to manage multiple trading accounts with master-slave replication and portfolio exposure monitoring, so that I can operate at scale.

#### Acceptance Criteria

1. WHEN a master account places a trade, THE Founder_Scale SHALL replicate the order to each configured slave account by computing the slave quantity as the master quantity multiplied by the slave's copy ratio, rounded down to the nearest valid lot size for the instrument using floor rounding within this computation step, using the configured copy mode (mirror: same direction and price; proportional: quantity scaled by ratio; fixed-lot: fixed quantity defined per slave)
2. IF a replicated order is rejected by a slave account (due to insufficient margin, risk limit breach, or segment restriction), THEN THE Founder_Scale SHALL skip that slave, continue replicating to remaining valid slaves, and display a notification indicating which slave accounts failed and the rejection reason
3. WHEN a trader requests portfolio exposure, THE Founder_Scale SHALL compute aggregate net position quantity and net notional value (quantity multiplied by LTP) across all accounts, grouped by symbol, sector, and segment, and display results within 2 seconds of the request
4. WHEN a trader switches the active account, THE State_Hub SHALL update all panels (order entry, positions, orders, risk) to reflect the selected account's data within 500 milliseconds
5. WHEN a master account modifies or cancels an order that was previously replicated, THE Founder_Scale SHALL propagate the modification or cancellation to all slave accounts that received the original replicated order
6. WHEN a master account places a trade and the computed slave quantity rounds to zero lots, THE Founder_Scale SHALL skip replication for that slave account and log a warning indicating the copy ratio is too small for the instrument's lot size

### Requirement 14: Market Data and WebSocket Management

**User Story:** As a trader, I want real-time market data with minimal latency and reliable reconnection, so that I always see accurate prices for informed decision-making.

#### Acceptance Criteria

1. WHEN market data is received, THE State_Hub SHALL update the UI within 50 milliseconds of quote arrival
2. WHEN no WebSocket message has been received for 10 seconds, THE Terminal_Shell SHALL consider the connection dropped, display a reconnecting banner, freeze prices with a stale indicator (dimmed opacity), and disable one-click trading on the DOM_Panel
3. WHEN the WebSocket reconnects, THE Terminal_Shell SHALL re-subscribe all previously subscribed tokens, refresh full depth data, and continuously evaluate incoming quote messages until 3 consecutive quote messages are received within 5 seconds each, at which point one-click trading SHALL be re-enabled
4. THE Terminal_Shell SHALL attempt WebSocket reconnection using exponential backoff starting at 1 second, doubling each attempt, with a maximum interval of 30 seconds, and a maximum of 20 reconnection attempts before displaying a permanent connection failure message requiring manual retry
5. THE State_Hub SHALL throttle UI updates to a maximum of 5 updates per second per symbol, rendering only the latest value each animation frame
6. IF a WebSocket disconnection occurs while an order is in-flight (submitted but not yet confirmed or rejected), THEN THE Terminal_Shell SHALL display a warning indicating that order status is uncertain and prompt the trader to verify the order state once the connection is restored. THE Terminal_Shell SHALL allow displaying order status warnings regardless of disconnection state when orders are in-flight

### Requirement 15: Global Search and Navigation

**User Story:** As a trader, I want to quickly search for instruments, switch contexts, and navigate the terminal using keyboard shortcuts, so that I can work efficiently without lifting my hands from the keyboard.

#### Acceptance Criteria

1. WHEN a trader activates global search via a dedicated keyboard shortcut or search icon, THE Terminal_Shell SHALL display a search modal within 100 milliseconds that accepts text input for symbol names, instrument identifiers, and workspace commands, displaying a maximum of 50 matching results filtered as the trader types. IF more than 50 matches exist, THE Terminal_Shell SHALL display exactly the first 50 results and not exceed this limit
2. WHEN a trader selects a symbol from search results, THE State_Hub SHALL propagate the symbol change to all linked modules (chart, DOM, order panel, option chain) within 200 milliseconds and close the search modal
3. WHEN a trader presses a registered hotkey, THE Terminal_Shell SHALL execute the associated action within 100 milliseconds of the key event
4. IF global search returns no matching results for the entered query, THEN THE Terminal_Shell SHALL display an empty-state message indicating no instruments or commands matched
5. WHEN a trader presses Escape or clicks outside the search modal, THE Terminal_Shell SHALL dismiss the search modal and return focus to the previously active panel. IF the previously active panel is unavailable, THE Terminal_Shell SHALL keep the modal open rather than closing it without a valid focus target
6. THE Terminal_Shell SHALL update filtered search results within 150 milliseconds of each keystroke in the search input

### Requirement 16: Application Performance

**User Story:** As a trader, I want the terminal to load quickly and respond instantly to interactions, so that I never miss a trading opportunity due to UI lag.

#### Acceptance Criteria

1. THE Terminal_Shell SHALL reach Time to Interactive within 2 seconds of initial load on a simulated 4G connection (9 Mbps down, 1.5 Mbps up, 170ms RTT) with an empty browser cache
2. THE Terminal_Shell SHALL use virtual scrolling for all lists (watchlists, positions, orders, option chain) to render only visible rows plus a buffer, supporting up to 10,000 items without frame drops below 60 frames per second during scrolling
3. WHEN computation for Greeks, payoff curves, or scanner evaluation is required, THE Terminal_Shell SHALL offload the computation to Web Workers such that no main-thread task exceeds 50 milliseconds during the computation. THE Terminal_Shell SHALL initialize Web Workers immediately on application load regardless of whether computations are pending. THE Terminal_Shell SHALL require Web Worker availability and SHALL refuse to start if Web Workers are unavailable, displaying a fatal error rather than falling back to main-thread computation
4. THE Terminal_Shell SHALL batch market data updates to coalesce ticks within 16-millisecond frames, ensuring the main thread maintains frame rendering at 60 frames per second during sustained market data streaming
5. WHEN panels are hidden or minimized, THE Terminal_Shell SHALL unsubscribe from market data for those panels within 1 second of the panel state change, ceasing all data accumulation for the hidden panels
6. WHEN a hidden or minimized panel is restored to visible, THE Terminal_Shell SHALL re-subscribe to market data and display live prices within 2 seconds of the panel becoming visible
