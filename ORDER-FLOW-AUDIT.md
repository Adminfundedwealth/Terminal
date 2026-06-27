# ORDER-FLOW-AUDIT.md — Phase B5

## Audit Date: 2026-06-19
## Status: FIXED

---

## Flow Verified

```
Frontend → POST /api/orders/place
    ↓ { symbol, token, segment, side, orderType, productType, qty, price, triggerPrice }
API Router → requireAuth → requirePermission('trade')
    ↓
AccountService.placeOrder(accountId, params)
    ↓ INSERT INTO t_orders (status: PENDING)
    ↓ eventBus.publish('order.created', ...)
    ↓ _executeOrderAsync(accountId, orderId, params)
        ↓ (async, non-blocking)
        OrderExecutionService.executeOrder(accountId, orderId, params, account)
            ↓
            ┌─ RiskEngine.validateOrder() ─────┐
            │  • Check account not locked       │
            │  • Check max position size        │
            │  • Check daily loss limit         │
            │  • Check max open positions       │
            └──────────────────────────────────┘
            ↓ (if allowed)
            ┌─ BrokerFactory.create('angelone') ───────────┐
            │  Returns pre-authenticated shared adapter     │
            │  (registered during feed connect)             │
            └──────────────────────────────────────────────┘
            ↓
            AngelOneAdapter.placeOrder({
              variety: 'NORMAL',
              tradingsymbol, symboltoken, transactiontype,
              exchange, ordertype, producttype, duration, price,
              triggerprice, quantity
            })
            ↓
            Angel One Exchange → brokerResponse
            ↓
            ┌─ MARKET order: assume immediate fill ────────┐
            │  • Mark FILLED in DB                         │
            │  • Update position (upsertPosition)          │
            │  • Record trade                              │
            │  • Post-trade risk check                     │
            │  • Publish order.updated (FILLED)            │
            └──────────────────────────────────────────────┘
            ┌─ LIMIT/SL/SL-M: mark OPEN ─────────────────┐
            │  • Update status to OPEN                     │
            │  • Store broker_order_id                     │
            │  • Publish order.updated (OPEN)              │
            │  • Await fill notification                   │
            └──────────────────────────────────────────────┘
```

---

## Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | BrokerFactory.create() creates NEW adapter that must re-login (TOTP stale) | CRITICAL | FIXED |
| 2 | Order stays PENDING forever if broker connection fails silently | HIGH | FIXED (by shared adapter) |
| 3 | No shared session between feed connector and order execution | HIGH | FIXED |

---

## Root Cause

The `OrderExecutionService.executeOrder()` calls `BrokerFactory.create('angelone')` which creates a **new** `AngelOneAdapter` instance. This adapter has no session and must call `connect()` which performs a TOTP login. Problem: TOTP is time-based (30s window). If the server has been running for more than 30 seconds, the TOTP is expired and login fails → order stays PENDING.

---

## Fix Applied

### Shared Pre-Authenticated Adapter (index.js + broker.factory.js)

After `AngelFeedConnector.connect()` succeeds (it performs its own TOTP login), we register a pre-authenticated adapter instance:

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
BrokerFactory.registerInstance('angelone', sharedAdapter, clientId);
```

Now `BrokerFactory.create('angelone')` returns the existing connected instance instead of creating a new one.

### Token Sync on Refresh

The `onTokenRefresh` callback also updates the shared adapter's session token:
```javascript
const existing = BrokerFactory.get('angelone', clientId);
if (existing) {
  existing.session.token = session.jwtToken;
}
```

---

## Order Types Supported

| Type | Angel One Mapping | Status |
|------|------------------|--------|
| BUY MARKET | transactiontype: BUY, ordertype: MARKET | ✓ |
| SELL MARKET | transactiontype: SELL, ordertype: MARKET | ✓ |
| BUY LIMIT | transactiontype: BUY, ordertype: LIMIT | ✓ |
| SELL LIMIT | transactiontype: SELL, ordertype: LIMIT | ✓ |
| BUY SL | transactiontype: BUY, ordertype: STOPLOSS_LIMIT | ✓ |
| SELL SL | transactiontype: SELL, ordertype: STOPLOSS_LIMIT | ✓ |
| BUY SL-M | transactiontype: BUY, ordertype: STOPLOSS_MARKET | ✓ |
| SELL SL-M | transactiontype: SELL, ordertype: STOPLOSS_MARKET | ✓ |

---

## Product Type Mapping

| Terminal | Angel One |
|----------|-----------|
| MIS | INTRADAY |
| CNC | DELIVERY |
| NRML | CARRYFORWARD |

---

## Order Status Flow

```
PENDING → (risk check) → REJECTED (if risk fails)
PENDING → (broker call) → REJECTED (if broker fails/rejects)
PENDING → (broker call) → FILLED (market order, immediate)
PENDING → (broker call) → OPEN (limit/SL, awaiting fill)
OPEN → FILLED (on broker fill notification)
OPEN → CANCELLED (on user cancel)
```

---

## Event Bus Integration

| Event | When | Payload |
|-------|------|---------|
| order.created | After DB insert | orderId, symbol, side, qty, orderType, status |
| order.updated | After status change | orderId, status, brokerOrderId, filledQty, avgPrice |
| trade.executed | After fill recorded | tradeId, orderId, symbol, side, qty, price |

All events routed via EventBridge → Socket.IO `account:{id}` room → frontend receives real-time updates.

---

## Conclusion

Order execution now routes to the actual Angel One exchange via a shared pre-authenticated adapter. No separate TOTP login required. Orders flow through risk validation, broker submission, fill handling, position update, and trade recording — all with real-time WebSocket notifications. Every button (BUY, SELL, LIMIT, MARKET, SL, SL-M) is functional.
