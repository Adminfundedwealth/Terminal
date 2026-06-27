# Bugfix Requirements Document

## Introduction

The FundedWealth trading terminal has multiple broken live data flows across the backend pipeline. The primary root cause is that the Angel One JWT token expires after login (typically 1-4 hours) but is never refreshed, causing all REST API calls to fail with 403 while the WebSocket feed continues on a separate `feedToken`. Secondary issues include: subscription mode stuck at LTP-only (mode 1) — preventing OHLC, change, and depth data from flowing through the feed; option chain expiry format mismatch with Angel One's API; and orders being stored in the database but never actually routed to the broker for execution. These failures break charts, option chain, market depth, watchlist display, and order execution — all critical for a trading terminal.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Angel One JWT token expires (after 1-4 hours of uptime) THEN all REST API calls (historical candles, searchScrip, FULL quotes) return 403 Forbidden and the system returns empty arrays to the frontend

1.2 WHEN the server subscribes to broker SmartStream feed THEN it subscribes all tokens in mode 1 (LTP-only), so quote data contains only `ltp` without open, high, low, close, volume, change, or changePercent fields

1.3 WHEN the frontend requests historical candles via `/api/market/history` and the JWT is expired THEN the CandleService returns an empty array `[]` and the chart renders a blank canvas

1.4 WHEN the CandleService fails to fetch historical data THEN there is no retry mechanism and no automatic JWT refresh — the system silently returns empty data indefinitely

1.5 WHEN the frontend requests option chain data via `/api/market/option-chain` with an ISO date expiry (e.g. `2026-06-25`) THEN the OptionChainService concatenates it literally as `NIFTY2026-06-25` instead of converting to Angel One's required DDMMMYY format (`25JUN26`), causing zero results even when the JWT is valid

1.6 WHEN the frontend requests option chain data and the JWT is expired THEN the searchScrip API call returns 403 and the system returns an empty array with no option strikes

1.7 WHEN a token is subscribed in mode 1 (LTP-only) THEN the SmartStream sends only 51-byte packets with no depth data, so `marketDataEngine.pushDepth()` is never called from the live feed for any token

1.8 WHEN the server receives LTP-only ticks (mode 1) THEN the watchlist displays prices without change/changePercent values, causing the frontend to show dashes or incorrect formatting

1.9 WHEN an order is placed via `/api/orders/place` THEN the system inserts the order into the database with status PENDING but never routes it to the Angel One broker for actual execution on the exchange

1.10 WHEN a position exists and LTP updates arrive THEN the position P&L is calculated only on-demand when the `/api/positions` endpoint is called, not pushed in real-time via WebSocket

1.11 WHEN the Angel One SmartStream WebSocket disconnects and reconnects THEN the system re-logins and gets a new JWT, but the token propagation to CandleService/DepthService/OptionChainService only happens on the next 60-second interval — leaving a window where REST calls still fail with the old expired token

### Expected Behavior (Correct)

2.1 WHEN the Angel One JWT token is about to expire or returns a 403 THEN the system SHALL automatically refresh the token (via refreshToken API or re-login) and propagate the new token to all dependent services (CandleService, DepthService, OptionChainService) immediately

2.2 WHEN the server subscribes watchlist tokens to the broker SmartStream feed THEN it SHALL subscribe index tokens in mode 1 (LTP) and stock/futures/options tokens in mode 2 (Quote) so that open, high, low, close, volume, change, and changePercent flow through the feed

2.3 WHEN the frontend requests historical candles via `/api/market/history` THEN the CandleService SHALL ensure a valid JWT is available (refreshing if needed) and return OHLCV candle data from Angel One's historical API

2.4 WHEN the CandleService encounters a 403 error from Angel One THEN it SHALL trigger an immediate token refresh and retry the request once before returning empty data

2.5 WHEN the frontend requests option chain data with an ISO date expiry (e.g. `2026-06-25`) THEN the OptionChainService SHALL convert it to Angel One's DDMMMYY format (e.g. `25JUN26`) before calling the searchScrip API

2.6 WHEN the frontend requests option chain data with a valid expiry and working JWT THEN the system SHALL return a list of option strikes with live CE/PE LTP, OI, volume, bid/ask quantities from the broker API

2.7 WHEN stocks, futures, or options tokens are subscribed in mode 2 (Quote) or mode 3 (SnapQuote) THEN the SmartStream SHALL deliver 123-byte or 379-byte packets, and the feed connector SHALL parse and push depth data (5-level bids/asks) to the MarketDataEngine for tokens subscribed in mode 3

2.8 WHEN live ticks arrive in mode 2 (Quote mode) THEN the MarketDataEngine SHALL receive full quote data including open, high, low, close, volume, change, and changePercent, enabling the watchlist to display accurate live prices with change values

2.9 WHEN an order is placed via `/api/orders/place` THEN the system SHALL validate the order parameters, route it to the Angel One broker adapter for execution on the exchange, update the order status based on the broker response (OPEN, FILLED, REJECTED), and emit an `order_update` WebSocket event to the client

2.10 WHEN a position's LTP changes (from live tick data) THEN the system SHALL recalculate P&L in real-time and push a `position_update` event via WebSocket to the connected client

2.11 WHEN the Angel One SmartStream reconnects and a new JWT is obtained THEN the system SHALL immediately propagate the new token to all dependent services without waiting for the 60-second interval

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the SmartStream WebSocket is connected and receiving ticks THEN the system SHALL CONTINUE TO parse binary tick data correctly (LTP at offset 43, OHLC at offset 47-63 for Quote mode, depth at offset 87 for SnapQuote) and push quotes to the MarketDataEngine

3.2 WHEN a client connects via Socket.IO and subscribes to token quotes THEN the system SHALL CONTINUE TO join the client to the appropriate room and emit cached quotes immediately followed by live updates

3.3 WHEN an index token (e.g. NIFTY 99926000) is queried for market depth THEN the system SHALL CONTINUE TO return empty depth `{bids:[], asks:[]}` because indices have no order book — this is correct behavior

3.4 WHEN the server starts up THEN it SHALL CONTINUE TO login to Angel One, connect SmartStream, subscribe default tokens, and start the event bus and Socket.IO server in the same sequence

3.5 WHEN the REST API `/api/market/depth` is called for a stock token with a valid JWT THEN the system SHALL CONTINUE TO fetch 5-level depth from Angel One's FULL quote API and cache it in the MarketDataEngine

3.6 WHEN positions are fetched via `/api/positions` THEN the system SHALL CONTINUE TO calculate P&L using the latest LTP from MarketDataEngine for each open position

3.7 WHEN the CandleService receives a live tick THEN it SHALL CONTINUE TO aggregate it into the current candle for 1m, 5m, and 15m timeframes using the existing `processLiveTick` logic

3.8 WHEN the frontend calls TradingView datafeed endpoints (`/tv/history`, `/tv/symbols`, `/tv/search`) THEN the system SHALL CONTINUE TO resolve symbols via InstrumentService and return candle data in UDF format

3.9 WHEN an order is cancelled via `DELETE /api/orders/:id/cancel` THEN the system SHALL CONTINUE TO update the database status to CANCELLED and emit an `order.updated` event on the event bus

3.10 WHEN the WebSocket legacy client at `/ws` connects and subscribes to tokens THEN the system SHALL CONTINUE TO register callbacks with MarketDataEngine and push quote/depth events to the client
