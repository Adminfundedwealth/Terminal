# Implementation Tasks: Live Data Recovery

## Task 1: Add Token Refresh to AngelFeedConnector ✅
- [x] Add `_tokenRefreshCallbacks` array and `onTokenRefresh(callback)` method to register listeners
- [x] Add `refreshJWT()` method that calls Angel One `generateTokens` endpoint using `this.session.refreshToken`
- [x] Add proactive refresh timer: schedule refresh at `login_time + 55 minutes` (before 1h expiry)
- [x] Call all `_tokenRefreshCallbacks` immediately after successful refresh or re-login
- [x] In `_attemptReconnect()` → after `this.login()` succeeds, invoke callbacks immediately (login() now calls _notifyTokenRefresh)
- [x] Add `ensureValidToken()` method that checks if token is within 5min of expiry, refreshes if needed, returns valid JWT

**File:** `server/brokers/angelone/angel.feed.connector.js`
**Fixes:** 1.1, 1.11
**Validates:** 2.1, 2.11

## Task 2: Add 403 Retry to CandleService ✅
- [x] Wrap the `axios.post` call in `getHistoricalCandles()` with try/catch for 403 status
- [x] On 403: call `this._refreshCallback()` (a new method ref set during init) to get fresh token
- [x] Retry the request once with the new token
- [x] If retry also fails, return empty array (existing behavior)
- [x] Add `setRefreshCallback(fn)` method to receive the refresh function from index.js

**File:** `server/services/candleService.js`
**Fixes:** 1.3, 1.4
**Validates:** 2.3, 2.4

## Task 3: Add 403 Retry to DepthService ✅
- [x] Wrap the `axios.post` call in `getDepth()` with try/catch for 403 status
- [x] On 403: call `this._refreshCallback()` to get fresh token
- [x] Retry the request once with the new token
- [x] If retry fails, return empty depth (existing behavior)
- [x] Add `setRefreshCallback(fn)` method

**File:** `server/services/depthService.js`
**Fixes:** 1.1 (depth-specific)
**Validates:** 2.1

## Task 4: Add 403 Retry + Expiry Format Fix to OptionChainService ✅
- [x] Add `_formatExpiry(expiry)` method that converts ISO date (e.g. `2026-06-25`) to Angel DDMMMYY format (e.g. `25JUN26`)
- [x] If expiry already matches `/^\d{2}[A-Z]{3}\d{2}$/`, pass through unchanged
- [x] Call `_formatExpiry()` in `getOptionChain()` before passing to `_findOptionInstruments()`
- [x] Add 403 retry logic (same pattern as Task 2/3) to `_findOptionInstruments()` and `_batchQuote()`
- [x] Add `setRefreshCallback(fn)` method

**File:** `server/services/optionChainService.js`
**Fixes:** 1.5, 1.6
**Validates:** 2.5, 2.6

## Task 5: Upgrade SmartStream Subscription Modes ✅
- [x] In `server/index.js` → `connectAngelFeed()`, split `defaultTokens` into two groups:
  - Index tokens (starting with `999`): subscribe mode 1 (LTP)
  - Stock tokens (all others): subscribe mode 2 (Quote)
- [x] Change `angelFeed.subscribe(defaultTokens, 1)` to two separate calls:
  - `angelFeed.subscribe(indexTokens, 1)`
  - `angelFeed.subscribe(stockTokens, 2)`
- [x] In `angel.feed.connector.js`, add `upgradeSubscription(tokens, newMode)` method for on-demand mode 3 upgrades

**File:** `server/index.js`, `server/brokers/angelone/angel.feed.connector.js`
**Fixes:** 1.2, 1.7, 1.8
**Validates:** 2.2, 2.7, 2.8

## Task 6: Register Shared Broker Adapter for Order Execution ✅
- [x] In `server/brokers/broker.factory.js`, add static method `registerInstance(provider, adapter, clientId)`
- [x] In `server/index.js` → `connectAngelFeed()`, after successful connection:
  - Create an `AngelOneAdapter` instance
  - Copy `angelFeed.session` data into the adapter's `session` property
  - Set `adapter._isConnected = true`
  - Call `BrokerFactory.registerInstance('angelone', adapter, clientId)`
- [x] In the `onTokenRefresh` callback, also update the registered adapter's `session.token` so it stays fresh

**File:** `server/brokers/broker.factory.js`, `server/index.js`
**Fixes:** 1.9
**Validates:** 2.9

## Task 7: Wire Token Propagation in index.js ✅
- [x] Remove the `setInterval(propagateToken, 60000)` call
- [x] Register `propagateToken` via `angelFeed.onTokenRefresh(propagateToken)` instead
- [x] In `propagateToken`, also call `setRefreshCallback` on each service with a function that calls `angelFeed.ensureValidToken()`
- [x] Ensure initial propagation still happens synchronously after `angelFeed.connect()`

**File:** `server/index.js`
**Fixes:** 1.11
**Validates:** 2.11

## Task 8: Add Real-Time Position P&L Push ✅
- [x] In `server/services/accountService.js`, add method `startPositionTracking(accountId)`
- [x] This method fetches open positions, subscribes to MDE quotes for each token
- [x] On each tick, calculate P&L and publish `position.updated` to eventBus with `{ accountId }` meta
- [x] Track subscriptions so they can be cleaned up when positions close
- [x] In `server/index.js`, for dev mode, call `accountService.startPositionTracking('dev-account')` after feed connects
- [x] On `order.updated` with status FILLED, refresh the tracking subscriptions

**File:** `server/services/accountService.js`, `server/index.js`
**Fixes:** 1.10
**Validates:** 2.10

## Task 9: Verify and Test End-to-End ✅
- [x] Start server and confirm Angel One login succeeds
- [x] Verify stock tokens receive mode 2 ticks (check logs for OHLC data in pushQuote)
- [x] Verify `/api/market/history` returns candle data (not empty array)
- [x] Verify `/api/market/option-chain?symbol=NIFTY&expiry=2026-06-26` returns strikes
- [x] Verify `/api/market/depth?token=2885` returns bid/ask levels
- [x] Verify `POST /api/orders/place` routes to broker and returns FILLED/OPEN status
- [x] Verify WebSocket receives `position_update` events when LTP changes
- [x] Verify token refresh works by checking logs after 55 minutes (or manually expire)
- [x] Deliver phase reports: MARKET-DATA-FLOW-REPORT.md, CHART-FEED-AUDIT.md, MARKET-DEPTH-FIX-REPORT.md, OPTION-CHAIN-AUDIT.md, ORDER-FLOW-AUDIT.md, POSITION-ENGINE-AUDIT.md, WEBSOCKET-AUDIT.md
