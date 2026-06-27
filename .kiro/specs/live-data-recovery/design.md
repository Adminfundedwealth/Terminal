# Technical Design: Live Data Recovery

## Overview

This design addresses 6 root causes breaking live data flows across the FundedWealth terminal backend. All fixes are confined to the server layer (broker feed, WebSocket, execution) — no UI/CSS/layout changes.

## Architecture Context

```
Angel One SmartAPI
    ├── REST (JWT auth)  ──→ CandleService / DepthService / OptionChainService
    └── SmartStream WS (feedToken auth) ──→ AngelFeedConnector ──→ MarketDataEngine
                                                                         │
                                                                    EventBus
                                                                         │
                                                              EventBridge + Socket.IO
                                                                         │
                                                                    Frontend
```

---

## Design Component 1: JWT Token Auto-Refresh (Fixes 1.1, 1.3, 1.4, 1.6, 1.11)

### Problem
The Angel One JWT expires after ~1-4 hours. The `AngelFeedConnector` stores the JWT in `this.session.jwtToken` and propagates it to dependent services via a 60-second `setInterval`. When the JWT expires mid-interval, all REST API calls return 403.

### Solution
Introduce a `TokenManager` utility class within the `AngelFeedConnector` that:
1. Tracks JWT expiry time (parsed from the token or set to login_time + 1h conservatively)
2. Proactively refreshes 5 minutes before expiry via Angel One's `generateTokens` endpoint
3. Provides an `ensureValidToken()` method that services call before any REST request
4. Immediately propagates fresh tokens on successful refresh (no 60s delay)
5. On 403 detection in any service, triggers immediate refresh + retry once

### Files Modified
- `server/brokers/angelone/angel.feed.connector.js` — Add `refreshToken()` method, `onTokenRefresh` callback, proactive refresh timer
- `server/services/candleService.js` — Add 403 detection + retry with fresh token
- `server/services/depthService.js` — Add 403 detection + retry with fresh token
- `server/services/optionChainService.js` — Add 403 detection + retry with fresh token
- `server/index.js` — Replace `setInterval(propagateToken, 60000)` with `angelFeed.onTokenRefresh(propagateToken)` callback

### Interface

```javascript
// angel.feed.connector.js additions
class AngelFeedConnector {
  // New: refresh JWT using refreshToken endpoint
  async refreshJWT() → { jwtToken, feedToken, refreshToken }
  
  // New: register callback for immediate token propagation
  onTokenRefresh(callback: (session) => void)
  
  // New: get current valid JWT (refreshes if expired/near-expiry)
  async ensureValidToken() → string (jwtToken)
}
```

### Regression Safety (3.1, 3.4)
- Feed connection sequence unchanged
- SmartStream uses `feedToken` (separate from JWT) — unaffected by JWT refresh
- Binary tick parsing unchanged

---

## Design Component 2: SmartStream Mode Upgrade (Fixes 1.2, 1.7, 1.8)

### Problem
All tokens are subscribed in mode 1 (LTP only, 51 bytes). This means:
- No OHLC/volume/change data flows through the feed
- No depth data is ever pushed from the live feed
- Watchlist shows prices without change values

### Solution
Change the subscription logic in `server/index.js` → `connectAngelFeed()` to:
- Subscribe **index tokens** (99926xxx) in mode 1 (LTP) — indices have no order book
- Subscribe **stock/futures tokens** in mode 2 (Quote) — provides OHLC + volume + change
- Provide a `subscribeDepthTokens(tokens)` method that subscribes specific tokens to mode 3 (SnapQuote) on-demand when a user opens market depth panel

### Files Modified
- `server/index.js` — Split `defaultTokens` subscription into mode 1 (indices) and mode 2 (stocks)
- `server/brokers/angelone/angel.feed.connector.js` — Add `upgradeSubscription(token, newMode)` method for on-demand mode 3

### Token Classification Logic

```javascript
function getSubscriptionMode(token) {
  // Index tokens start with 999260xx
  if (token.startsWith('999')) return 1; // LTP only (no order book)
  return 2; // Quote mode (OHLC + volume)
}
```

### Regression Safety (3.1, 3.3)
- Index tokens remain mode 1 → correct behavior (no depth for indices)
- Binary parser already handles all 3 modes — no changes needed to `_parseTick()`
- Quote subscribers get enriched data; existing LTP-only consumers still get `ltp` field

---

## Design Component 3: Option Chain Expiry Format Fix (Fixes 1.5)

### Problem
Frontend sends ISO date expiry (e.g. `2026-06-25`). The `OptionChainService._findOptionInstruments()` concatenates it directly: `NIFTY2026-06-25`. Angel One's searchScrip requires format `NIFTY25JUN26` (DDMMMYY).

### Solution
Add a date format conversion function in `OptionChainService` that detects ISO format and converts to Angel One's DDMMMYY format.

### Files Modified
- `server/services/optionChainService.js` — Add `_formatExpiry(expiry)` method

### Conversion Logic

```javascript
_formatExpiry(expiry) {
  // If already in Angel format YY+MMM+DD (e.g. "26JUN29"), pass through
  if (/^\d{2}[A-Z]{3}\d{2}$/.test(expiry)) return expiry;
  
  // Convert ISO "2026-06-29" → "26JUN29" (YY+MMM+DD)
  const date = new Date(expiry);
  const yy = String(date.getFullYear()).slice(-2);
  const mmm = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][date.getMonth()];
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mmm}${dd}`;
}
```

### Regression Safety
- If expiry is already in DDMMMYY format, passes through unchanged
- No other service uses this format — isolated change

---

## Design Component 4: Order Execution Routing Fix (Fixes 1.9)

### Problem
Code review shows `AccountService.placeOrder()` **does** call `this._executeOrderAsync()` which invokes `OrderExecutionService.executeOrder()`. However, `BrokerFactory.create('angelone')` inside the execution service creates a **new** `AngelOneAdapter` instance that must separately `connect()` (login). If Angel One credentials fail or TOTP is stale (>30s since server start), the broker connection fails silently and orders stay PENDING.

### Solution
1. Share the already-authenticated broker session from `AngelFeedConnector` with `BrokerFactory` so order routing doesn't require a separate login
2. Add an `angelone` instance to `BrokerFactory.instances` during startup after `AngelFeedConnector.connect()` succeeds
3. This ensures `OrderExecutionService.executeOrder()` gets a pre-authenticated adapter

### Files Modified
- `server/index.js` — After `angelFeed.connect()`, register the adapter session with `BrokerFactory`
- `server/brokers/broker.factory.js` — Add `registerInstance(provider, adapter)` static method

### Interface

```javascript
// broker.factory.js addition
static registerInstance(provider, adapter, clientId = 'default') {
  const key = `${provider}:${clientId}`;
  this.instances.set(key, adapter);
  this.healthStatus.set(key, { provider, clientId, connected: true, lastCheck: Date.now() });
}
```

```javascript
// index.js — after angelFeed.connect()
const sharedAdapter = new AngelOneAdapter();
sharedAdapter.session = {
  provider: 'angelone',
  clientId: angelFeed.session.clientId,
  token: angelFeed.session.jwtToken,
  refreshToken: angelFeed.session.refreshToken,
  feedToken: angelFeed.session.feedToken,
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
};
sharedAdapter._isConnected = true;
BrokerFactory.registerInstance('angelone', sharedAdapter, angelFeed.session.clientId);
```

### Regression Safety (3.9)
- Order cancellation flow unchanged (uses DB status update + eventBus)
- The placeOrder → executeOrder → BrokerAdapter.placeOrder chain is the same, just with a working adapter instance

---

## Design Component 5: Real-Time Position P&L Push (Fixes 1.10)

### Problem
Position P&L is only calculated when `/api/positions` is polled. No live P&L updates are pushed via WebSocket.

### Solution
Subscribe to live quotes for all open position tokens. On each tick, recalculate P&L and publish `position.updated` to the event bus (which EventBridge routes to the account's Socket.IO room).

### Files Modified
- `server/services/accountService.js` — Add `_startPositionPnLTracking()` method that subscribes to MDE quotes for open position tokens
- `server/index.js` — Call position tracking after services are initialized

### Design

```javascript
// accountService.js — new method
async _startPositionPnLTracking(accountId) {
  const positions = await this.getPositions(accountId);
  for (const pos of positions) {
    if (pos.qty === 0) continue;
    this.marketDataEngine.subscribe(pos.token, (event) => {
      const ltp = event.data?.ltp;
      if (!ltp) return;
      const pnl = pos.qty > 0
        ? (ltp - pos.avg_price) * pos.qty
        : (pos.avg_price - ltp) * Math.abs(pos.qty);
      eventBus.publish('position.updated', {
        symbol: pos.symbol, token: pos.token, qty: pos.qty, pnl,
        ltp, avgPrice: pos.avg_price,
      }, { accountId });
    });
  }
}
```

### Throttling
The `position.updated` channel already has `throttleMs: 250` in `channels.js`, so rapid ticks won't flood the client.

### Regression Safety (3.6)
- REST `/api/positions` endpoint still calculates P&L on-demand (unchanged)
- This adds a parallel push mechanism — doesn't replace the pull

---

## Design Component 6: Immediate Token Propagation on Reconnect (Fixes 1.11)

### Problem
After `AngelFeedConnector` reconnects (calls `login()` again), the new JWT only reaches CandleService/DepthService/OptionChainService on the next 60-second interval tick.

### Solution
This is solved by Design Component 1's `onTokenRefresh` callback approach. The `login()` method in `AngelFeedConnector` will call the registered callback immediately after obtaining a new session, eliminating the 60-second gap.

### Files Modified
Same as Component 1 — `angel.feed.connector.js` and `index.js`.

---

## Sequence Diagram: Token Refresh Flow

```
AngelFeedConnector                 CandleService/DepthService/OptionChainService
       │                                              │
       │──── proactiveRefreshTimer (55min) ──────────▶│
       │     calls refreshJWT()                       │
       │     updates this.session.jwtToken            │
       │     calls _tokenRefreshCallbacks             │
       │──── propagateToken() ──────────────────────▶│
       │                                              │ setAuthToken(newJwt)
       │                                              │
       │  ... later, if 403 detected by a service ... │
       │◀──── service calls angelFeed.ensureValidToken()
       │     refreshes if needed                      │
       │──── returns valid JWT ─────────────────────▶│
       │                                              │ retries request
```

## Sequence Diagram: Order Execution (Fixed)

```
Frontend ──POST /api/orders/place──▶ AccountService.placeOrder()
                                          │
                                          ├─ INSERT t_orders (PENDING)
                                          ├─ eventBus.publish('order.created')
                                          └─ _executeOrderAsync()
                                                │
                                       OrderExecutionService.executeOrder()
                                                │
                                          ┌─────┴─────┐
                                          │ RiskEngine │
                                          └─────┬─────┘
                                                │ (if allowed)
                                          ┌─────┴──────────┐
                                          │ BrokerFactory   │
                                          │ .create('angel')│ ← now returns pre-authenticated instance
                                          └─────┬──────────┘
                                                │
                                          AngelOneAdapter.placeOrder()
                                                │
                                          ┌─────┴─────┐
                                          │ Angel One  │
                                          │ Exchange   │
                                          └─────┬─────┘
                                                │
                                          brokerResponse
                                                │
                                          ┌─────┴─────┐
                                          │ Update DB  │ (FILLED/OPEN/REJECTED)
                                          │ Position   │
                                          │ Trade      │
                                          └─────┬─────┘
                                                │
                                          eventBus.publish('order.updated')
                                                │
                                          EventBridge → Socket.IO → Frontend
```

---

## Summary of File Changes

| File | Change Type | Component |
|------|-------------|-----------|
| `server/brokers/angelone/angel.feed.connector.js` | Modify | 1, 2, 6 |
| `server/services/candleService.js` | Modify | 1 |
| `server/services/depthService.js` | Modify | 1 |
| `server/services/optionChainService.js` | Modify | 1, 3 |
| `server/index.js` | Modify | 1, 2, 4, 5 |
| `server/brokers/broker.factory.js` | Modify | 4 |
| `server/services/accountService.js` | Modify | 5 |

Total: 7 files modified, 0 new files, 0 deleted files.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Token refresh during active REST call | Retry mechanism handles this — single retry after refresh |
| Mode 2 increases bandwidth from SmartStream | Only 9 default tokens affected; SmartStream handles thousands |
| Shared adapter session staleness | `onTokenRefresh` keeps adapter session synced with feed connector |
| Position P&L tracking for many positions | Throttled at 250ms per token; unsubscribe on position close |
| Double login (adapter + feed connector) | Eliminated — shared session means single login |
