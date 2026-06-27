# FundedWealth Terminal — Architecture Alignment Requirements

## Introduction

The FundedWealth Terminal (`terminal.fundedwealth.com`) is a prop-firm trading terminal. The Dashboard (`fundedwealth.com`) handles all commercial activity — registration, KYC, payments, and challenge purchase. The Terminal handles only the trading lifecycle after a trader account has been provisioned.

The core architectural problem is that the two systems share a Supabase database but have never been properly integrated. The Dashboard creates users and payment records. The Terminal has complete trading logic but none of the terminal-specific database tables exist in production, and there is no automation that converts a paid order into an active trading account. Admin currently handles provisioning manually.

This document defines the requirements to make the terminal production-ready and establish a verified end-to-end flow from payment to first trade.

---

## Glossary

- **Dashboard** — `fundedwealth.com`. Handles registration, KYC, payments, challenge purchase. Uses Clerk Auth (`clerk_id`). Out of scope for terminal development.
- **Terminal** — `terminal.fundedwealth.com`. Handles the trading lifecycle only. Uses its own JWT session derived from SSO.
- **SSO Token** — A short-lived JWT signed by the Dashboard with `SSO_SHARED_SECRET` that authorises a specific trader + account to open the terminal.
- **Trading Account** — A single virtual trading account linked to one challenge phase. A user can have multiple (Phase 1, Phase 2, Funded).
- **Challenge Account** — The prop-firm evaluation record. Tracks phase, status, initial balance, expiry, and pass/fail reason.
- **Provisioning** — The act of creating a `trading_accounts` row and `challenge_accounts` row (plus risk rules) for a user whose payment has been confirmed.
- **fw_user_id** — The terminal's cross-system user identifier. Maps to `users.clerk_id` in the Dashboard users table.
- **Terminal-prefixed tables** — All terminal-owned tables use the `terminal_` prefix to avoid collision with Dashboard tables in the shared database.

---

## Requirement 1: User Identity Bridge

**User Story:** As the terminal backend, I need to look up a user from the Dashboard's `users` table using the identifier embedded in the SSO token, so that I can verify the user exists and is active before granting access.

### Acceptance Criteria

1. WHEN the SSO service (`server/services/sso.service.js`) receives a token with `sub = <clerk_id>`, THEN it SHALL query the `users` table using `.eq('clerk_id', fwUserId)` — not `fw_user_id` which does not exist.
2. WHEN a user record is found and `is_active = true`, THEN the SSO service SHALL proceed to account lookup.
3. WHEN a user record is not found or `is_active = false`, THEN the SSO service SHALL return `{ success: false, error: 'User not found or suspended' }` and redirect to Dashboard.
4. The `users` table SHALL NOT be modified by the Terminal — it is owned by the Dashboard.
5. The SSO token claim `sub` SHALL contain the user's `clerk_id` value (set by the Dashboard when signing the token).
6. The field formerly called `fw_user_id` in terminal code SHALL be understood to mean `clerk_id` — no new column is added to `users`.

---

## Requirement 2: Terminal-Owned Database Tables

**User Story:** As the terminal system, I need a set of database tables that I own and control, isolated from Dashboard tables by naming convention, so that terminal operations do not conflict with Dashboard data.

### Acceptance Criteria

1. ALL terminal-owned tables SHALL use the `terminal_` prefix: `terminal_accounts`, `terminal_challenges`, `terminal_orders`, `terminal_positions`, `terminal_trades`, `terminal_risk_rules`, `terminal_watchlists`, `terminal_sessions`, `terminal_account_metrics`, `terminal_audit_log`, `terminal_risk_events`, `terminal_order_audit`.
2. WHEN the terminal migration (`server/db/FULL_MIGRATION.sql`) is executed, THEN all tables above SHALL be created in the `public` schema of the shared Supabase database.
3. Terminal tables SHALL reference the `users.id` column (UUID) as the foreign key to user identity — they SHALL NOT have a FK to `clerk_id` directly.
4. The `positions` table that currently exists in the database (empty, unknown schema) SHALL be renamed or superseded by `terminal_positions` — the terminal SHALL NOT use the raw `positions` table.
5. The `sessions` table that currently exists (Dashboard session table) SHALL NOT be written to by the Terminal — the Terminal SHALL use `terminal_sessions` exclusively.
6. The `orders` table that currently exists (payment orders) SHALL NOT be read or written by Terminal trading logic — the Terminal SHALL use `terminal_orders` exclusively.
7. All repositories SHALL be updated to reference `terminal_*` table names as documented in `server/db/terminal-migrations/REPOSITORY_MAPPINGS.md`.

---

## Requirement 3: SSO Flow — End to End

**User Story:** As a trader, I want clicking "Open Terminal" on the Dashboard to open the terminal with my account already loaded, without entering credentials again.

### Acceptance Criteria

1. WHEN a user clicks "Open Terminal" on the Dashboard, THEN the Dashboard SHALL generate a signed SSO JWT containing: `sub` (clerk_id), `accountId` (terminal_accounts UUID), `challengeId` (terminal_challenges UUID), `nonce` (random string), `iat`, `exp` (60 seconds from now).
2. The SSO JWT SHALL be signed with `SSO_SHARED_SECRET` — the same secret set on both Dashboard and Terminal servers.
3. WHEN the Terminal receives `GET /auth/sso?token=<sso_token>` (`server/routes/auth.routes.js`), THEN it SHALL call `validateSSOToken()` in `server/services/sso.service.js`.
4. WHEN the SSO token signature is valid and not expired, THEN the terminal SHALL look up the user by `clerk_id` in the `users` table.
5. WHEN the user is found, THEN the terminal SHALL look up the trading account in `terminal_accounts` by `id = accountId AND user_id = users.id`.
6. WHEN the trading account is found and `status = 'active'`, THEN the terminal SHALL issue a terminal session JWT (`server/services/auth.service.js :: generateSessionJWT`) containing `userId`, `accountId`, `challengeId`, `accountCode`, `brokerProvider`, `permissions`.
7. WHEN the terminal session JWT is issued, THEN it SHALL be set as an httpOnly cookie named `fw_session` and the user redirected to `/`.
8. The terminal session JWT SHALL be persisted to `terminal_sessions` with `token_hash`, `user_id`, `account_id`, `ip_address`, `user_agent`, `expires_at`.
9. WHEN the frontend mounts (`src/hooks/useAuth.ts`), THEN it SHALL call `GET /api/account` which validates the `fw_session` cookie via `server/middleware/auth.js :: requireAuth()`.
10. IF the session is invalid or expired, THEN the frontend SHALL redirect to `${VITE_FW_DASHBOARD_URL}/login?redirect=<current_url>`.
11. The nonce replay protection in `server/services/sso.service.js` SHALL be backed by Redis (not an in-memory Set) in production to survive server restarts.

---

## Requirement 4: Account Provisioning — Dashboard to Terminal

**User Story:** As an admin, I need paid users to automatically receive active terminal trading accounts after their payment is confirmed, so that they can trade without manual intervention.

### Acceptance Criteria

1. WHEN a payment order in the `orders` table transitions to `status = 'paid'`, THEN an account provisioning event SHALL be triggered.
2. The provisioning trigger SHALL be implemented as either: (a) a Supabase database trigger on the `orders` table, or (b) a webhook from the Dashboard to the Terminal's provisioning API endpoint — the chosen approach SHALL be documented and agreed before implementation.
3. WHEN provisioning is triggered for a user + plan, THEN the following records SHALL be created atomically:
   - One row in `terminal_challenges` with `type = 'evaluation'`, `phase = 'phase_1'`, `status = 'active'`, `initial_balance` set per plan config, `expires_at` set per plan duration
   - One row in `terminal_accounts` linked to the challenge, with `status = 'active'`, `balance = initial_balance`, `peak_balance = initial_balance`, `broker_provider = 'angelone'`
   - Risk rules seeded in `terminal_risk_rules` for the account (daily loss limit, max drawdown, profit target, allowed segments, trading hours, no overnight, min trading days) — using `ChallengeService.seedRulesForAccount()` in `server/services/challengeService.js`
4. WHEN provisioning completes, THEN a row SHALL be created in `terminal_audit_log` with `event_type = 'account_provisioned'`.
5. WHEN provisioning fails for any reason, THEN the error SHALL be logged and an alert sent — the `orders` row SHALL NOT be marked as provisioned until all three records are confirmed created.
6. The Terminal SHALL expose a secure endpoint `POST /admin/provision` protected by `ADMIN_SECRET` header that accepts `{ userId, planType, orderId }` and executes the provisioning flow — this is the manual fallback and the webhook target.
7. The plan configuration (balance, targets, drawdown limits, duration) for each plan type SHALL be defined in `server/services/challengeService.js :: getPlanConfig()` and SHALL be the single source of truth.
8. Supported plan types: `'10K'` (₹10,00,000), `'25K'` (₹25,00,000), `'50K'` (₹50,00,000), `'1L'` (₹1,00,00,000). Plan names in `orders.plan_type` SHALL map to these keys.
9. The 17 existing paid orders in the `orders` table SHALL be provisionable via the `POST /admin/provision` endpoint as a one-time backfill — this SHALL NOT be automated retroactively without manual admin review per order.

---

## Requirement 5: Challenge Lifecycle

**User Story:** As a trader, I want my progress tracked through Phase 1, Phase 2, and Funded status automatically based on my trading performance, so that I advance without manual admin approval.

### Acceptance Criteria

1. A challenge SHALL have exactly these statuses: `active`, `passed`, `failed`, `expired`, `breached`.
2. WHEN a trader's balance increases to meet the profit target AND minimum trading days are satisfied, THEN `ChallengeService.checkTransitions()` (`server/services/challengeService.js`) SHALL mark the challenge as `passed` and call `promoteToNextPhase()`.
3. WHEN `promoteToNextPhase()` is called on a Phase 1 challenge, THEN it SHALL create a new Phase 2 `terminal_challenges` row and a new `terminal_accounts` row, seeding Phase 2 risk rules.
4. WHEN `promoteToNextPhase()` is called on a Phase 2 challenge, THEN it SHALL create a Funded `terminal_challenges` row and a `terminal_accounts` row with `payout_eligible = true` and no profit target rule.
5. WHEN max drawdown is breached, THEN `ChallengeService.checkTransitions()` SHALL mark the challenge as `failed` and the account as `breached`. The account SHALL be locked immediately and cannot trade.
6. WHEN the challenge `expires_at` is passed, THEN the challenge SHALL be marked `expired` and the account locked.
7. WHEN a daily loss limit is breached, THEN the account SHALL be locked for the day only (`status = 'locked'`). The daily cron (`server/cron/dailyChecks.js`) SHALL call `ChallengeService.unlockIfEligible()` at the start of the next trading day.
8. Challenge transition checks SHALL be called after every order fill via `RiskEngine.postTradeCheck()` in `server/services/riskEngine.js`.
9. Challenge progress SHALL be readable via `GET /api/account/challenge` which calls `ChallengeService.getProgress()`.
10. All challenge transitions SHALL be logged to `terminal_audit_log` and `terminal_risk_events` via the event bus.

---

## Requirement 6: Order Flow

**User Story:** As a trader, I want to place an order that is validated against my risk rules, routed to the broker, and recorded with full audit trail, so that every trade is accountable.

### Acceptance Criteria

1. WHEN `POST /api/orders/place` is called, THEN the order SHALL be inserted into `terminal_orders` with `status = 'PENDING'` before any broker interaction.
2. WHEN an order is inserted, THEN `OrderExecutionService.executeOrder()` (`server/services/orderExecutionService.js`) SHALL be called asynchronously (fire-and-forget).
3. WHEN `executeOrder()` runs, it SHALL execute steps in this exact sequence:
   - Step 1: `RiskEngine.validateOrder()` — pre-trade risk check
   - Step 2: `BrokerFactory.create('angelone')` → `AngelOneAdapter.placeOrder()` — broker routing
   - Step 3: On success — `OrderRepository.markFilled()` — update `terminal_orders`
   - Step 4: `PositionRepository.upsertPosition()` — update `terminal_positions`
   - Step 5: `TradeRepository.recordTrade()` — insert into `terminal_trades`
   - Step 6: `RiskEngine.postTradeCheck()` — post-trade drawdown/daily loss check
   - Step 7: Publish `order.updated`, `position.updated`, `trade.executed` to event bus
4. IF the risk check fails, THEN the order SHALL be marked `REJECTED` in `terminal_orders` with `reject_reason` populated — no broker call is made.
5. IF the broker call fails, THEN the order SHALL be marked `REJECTED` — no position or trade record is created.
6. For MARKET orders, fill price SHALL be the current LTP from `MarketDataEngine.getQuote()`.
7. For LIMIT/SL orders, the order SHALL be set to `OPEN` after broker acceptance and remain there until a fill notification arrives.
8. The complete order lifecycle SHALL be recorded in `terminal_order_audit` — one row per status transition.
9. `POST /api/orders/place` requires `requireAuth` and `requirePermission('trade')` — ref: `server/routes/api.js`.
10. Rate limiting: 60 orders per minute per IP — ref: `server/index.js :: orderLimiter`.

---

## Requirement 7: Position Management

**User Story:** As a trader, I want my open positions to show real-time unrealized P&L and to be closeable with a single click.

### Acceptance Criteria

1. Positions SHALL be stored in `terminal_positions` with columns: `id`, `account_id`, `symbol`, `token`, `segment`, `exchange`, `product_type`, `qty`, `avg_price` (`entry_price` in current code — SHALL be unified to `avg_price`), `realized_pnl`, `opened_at`, `closed_at`.
2. The unique index `(account_id, token, product_type) WHERE closed_at IS NULL` SHALL prevent duplicate open positions for the same instrument.
3. ALL position reads and writes SHALL use `account_id` as the filter — NOT `user_id`. The current `PositionRepository.findOpenByAccountId()` uses `user_id` which must be corrected to `account_id`.
4. `AccountService.getPositions()` SHALL enrich each position with live LTP from `MarketDataEngine.getQuote(token)` and compute `pnl` on the fly.
5. WHEN `GET /api/positions` is called, THEN positions for `req.user.accountId` SHALL be returned.
6. `POST /api/positions/:id/exit` SHALL place a MARKET order in the opposite direction for the full qty.
7. `POST /api/positions/:id/exit` with `{ qty: N }` in body SHALL place a partial close for qty N.
8. `POST /api/positions/:id/reverse` SHALL close the full position and open an equal opposite position.
9. `POST /api/positions/close-all` SHALL exit all open positions sequentially.
10. Real-time position P&L tracking SHALL be active via `AccountService.startPositionTracking()` which subscribes to `MarketDataEngine` ticks and publishes `position.updated` events to connected clients via Socket.IO.

---

## Requirement 8: Risk Engine

**User Story:** As the prop firm, I want every order validated against the trader's specific rules before it reaches the broker, and the account automatically locked or breached when rules are violated.

### Acceptance Criteria

1. Risk rules SHALL be stored in `terminal_risk_rules` as rows with `account_id`, `rule_type`, `value` (JSONB), `is_active`.
2. `RiskRulesRepository.getRulesMap()` SHALL query `terminal_risk_rules` by `account_id` and return a flat object keyed by `rule_type`.
3. The following rule types SHALL be supported: `daily_loss_limit`, `max_drawdown`, `profit_target`, `max_positions`, `max_lot_size`, `allowed_segments`, `trading_hours`, `no_overnight`, `max_daily_trades`, `news_blackout`.
4. Pre-trade validation SHALL check all active rules in sequence — the first failing check SHALL reject the order with a human-readable reason.
5. Market holiday and weekend checks SHALL run first (before DB rule checks) using `HolidayService.checkMarketClosed()`.
6. Post-trade checks SHALL run after every fill and SHALL compare current equity (balance + unrealized PnL) against `max_drawdown` from peak balance.
7. WHEN daily loss limit is hit, `AccountRepository.lockAccount()` SHALL set `terminal_accounts.status = 'locked'`.
8. WHEN max drawdown is hit, `AccountRepository.breachAccount()` SHALL set `terminal_accounts.status = 'breached'`. A breached account SHALL NOT be automatically unlocked.
9. All rule violations SHALL publish `risk.alert` events to the event bus and persist to `terminal_risk_events`.
10. The frontend `RiskOverlay` component SHALL display a full-screen block when account status is `locked` or `breached`, sourcing status from `GET /api/account`.

---

## Requirement 9: Broker Integration — Angel One

**User Story:** As the terminal, I need a persistent, authenticated connection to Angel One SmartStream for live market data and the Angel One REST API for order execution.

### Acceptance Criteria

1. Angel One credentials SHALL be configured via environment variables: `ANGEL_API_KEY`, `ANGEL_CLIENT_ID`, `ANGEL_PASSWORD`, `ANGEL_TOTP_SECRET` — ref: `server/.env.example`.
2. `AngelFeedConnector.login()` (`server/brokers/angelone/angel.feed.connector.js`) SHALL authenticate via TOTP on startup and maintain a live SmartStream WebSocket connection.
3. The SmartStream JWT SHALL be proactively refreshed every 55 minutes via `_scheduleProactiveRefresh()` — no polling interval is needed.
4. WHEN the SmartStream connection closes, `_attemptReconnect()` SHALL reconnect with exponential backoff (max 50 attempts, 3s → 30s delay).
5. The refreshed JWT SHALL be propagated immediately to `CandleService`, `DepthService`, and `OptionChainService` via the `onTokenRefresh()` callback — ref: `server/index.js :: connectAngelFeed()`.
6. The same Angel One session SHALL be shared with `AngelOneAdapter` for order execution via `BrokerFactory.registerInstance()`.
7. Historical candles SHALL be fetched via `CandleService.getHistoricalCandles()` → Angel One `getCandleData` REST API.
8. Market depth SHALL be fetched via `DepthService.getDepth()` → Angel One `FULL` mode quote REST API.
9. Option chain SHALL be fetched via `OptionChainService.getOptionChain()` → `searchScrip` + batch FULL quote.
10. IF Angel One credentials are not configured, the server SHALL start but market data SHALL be empty and orders SHALL be rejected with a clear error — not silently failed.

---

## Requirement 10: Market Data and Watchlists

**User Story:** As a trader, I want real-time prices for all instruments on my watchlist and the ability to save watchlists between sessions.

### Acceptance Criteria

1. Default watchlists (INDEX, STOCKS, FUTURES, OPTIONS, MCX, CDS) SHALL be seeded from `src/store/appStore.ts` and displayed immediately — no database dependency for the default lists.
2. User-customised watchlists SHALL be persisted in `terminal_watchlists` with `user_id`, `name`, `color`, `items` (JSONB array of `{ token, symbol, segment }`).
3. `GET /api/watchlists` SHALL return watchlists for `req.user.userId` via `WatchlistRepository.findByUserId()`.
4. Live quotes SHALL be delivered via the SmartStream WebSocket → `MarketDataEngine.pushQuote()` → Socket.IO `RealtimeServer` → frontend `marketStore`.
5. The frontend WebSocket service (`src/services/websocket.ts`) SHALL auto-subscribe all watchlist tokens on connect and resubscribe on reconnect.
6. Historical candles for charts SHALL be loaded via `GET /api/tv/history` (TradingView UDF format) → `CandleService.getHistoricalCandles()`.
7. Instrument search SHALL be served from `InstrumentService.search()` in-memory — no database dependency.
8. Expiry dates SHALL be computed algorithmically by `InstrumentService.getExpiries()` — the Terminal does not fetch expiry master from the exchange at this stage.

---

## Requirement 11: Terminal Boundary

**User Story:** As the system architect, I need clear boundaries on what the terminal owns vs what the Dashboard owns, so that the two systems remain decoupled and independently deployable.

### Acceptance Criteria

1. The Terminal SHALL NOT write to Dashboard-owned tables: `users`, `orders`, `sessions`.
2. The Terminal MAY read from `users` (user lookup during SSO) and `orders` (admin provisioning endpoint reads `plan_type` and `user_id` to create terminal accounts).
3. Payout processing (approval, payment transfer) SHALL remain on the Dashboard. The Terminal SHALL expose `GET /api/account/payout/eligibility` and `POST /api/account/payout/request` which write a payout request to `terminal_payouts` — the Dashboard reads that table and handles actual disbursement.
4. KYC status SHALL be read from `users.kyc_status` during SSO if payout eligibility is checked — the Terminal SHALL NOT modify it.
5. User registration SHALL NOT be possible via any Terminal API endpoint.
6. Challenge purchase and plan selection SHALL happen on the Dashboard only — the Terminal only activates accounts that have already been purchased.
7. The Terminal's `POST /admin/provision` endpoint SHALL be the only provisioning interface — it SHALL require `Authorization: Bearer <ADMIN_SECRET>` and SHALL be blocked in the browser-facing CORS policy.
