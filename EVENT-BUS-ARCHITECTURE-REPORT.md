# EVENT BUS ARCHITECTURE REPORT
## FundedWealth Terminal — Phase C2

> **Scope:** Implement event bus with 7 channels. Frontend consumes events only. Reduce polling.
> **Constraints:** No UI changes. No broker adapter/frontend/Supabase modifications.
> **Verification:** 77/77 tests pass (`node server/test-event-bus.js`)

---

## 1. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PRODUCERS (Server-side)                                                 │
│                                                                           │
│  MarketDataEngine.pushQuote()  ──→  market.tick                          │
│  AccountService.placeOrder()   ──→  order.created                        │
│  AccountService.modifyOrder()  ──→  order.updated                        │
│  AccountService.cancelOrder()  ──→  order.updated                        │
│  PositionRepository.upsert()   ──→  position.updated                     │
│  TradeRepository.recordTrade() ──→  trade.executed                       │
│  RiskEngine.postTradeCheck()   ──→  risk.alert + challenge.updated       │
│                                                                           │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  EVENT BUS (In-process, EventEmitter-based)                              │
│  server/events/eventBus.js                                               │
│                                                                           │
│  Features:                                                               │
│  ├── Typed channels with payload validation                              │
│  ├── Wildcard subscriptions (order.*, *)                                 │
│  ├── Metrics collection (per-channel counts, uptime)                     │
│  ├── Optional Redis forwarding (multi-instance scaling)                  │
│  └── Unsubscribe returns cleanup function                                │
│                                                                           │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  EVENT BRIDGE (server/events/eventBridge.js)                             │
│                                                                           │
│  Responsibilities:                                                       │
│  ├── Subscribes to all 7 event bus channels                              │
│  ├── Routes global events → Socket.IO rooms (quote:{token})             │
│  ├── Routes account events → Socket.IO rooms (account:{id})             │
│  ├── Applies per-channel throttling                                      │
│  ├── Fallback: legacy WS broadcast                                       │
│  └── Stats tracking (forwarded, throttled, by channel)                   │
│                                                                           │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  FRONTEND CONSUMERS (Socket.IO client)                                   │
│                                                                           │
│  Events received (no polling needed):                                    │
│  ├── "quote"            ← market.tick (per-token subscription)           │
│  ├── "order_update"     ← order.created + order.updated                  │
│  ├── "position_update"  ← position.updated                               │
│  ├── "trade_executed"   ← trade.executed                                  │
│  ├── "challenge_update" ← challenge.updated                               │
│  └── "risk_alert"       ← risk.alert                                     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CHANNEL DEFINITIONS

| Channel | Scope | WS Event | Throttle | Required Fields |
|---------|-------|----------|----------|-----------------|
| `market.tick` | global | `quote` | 0ms | token, ltp, timestamp |
| `order.created` | account | `order_update` | 0ms | orderId, symbol, side, qty, orderType |
| `order.updated` | account | `order_update` | 0ms | orderId, status |
| `position.updated` | account | `position_update` | 250ms | symbol, token, qty, pnl |
| `trade.executed` | account | `trade_executed` | 0ms | tradeId, orderId, symbol, side, qty, price |
| `challenge.updated` | account | `challenge_update` | 1000ms | challengeId, status |
| `risk.alert` | account | `risk_alert` | 5000ms | type, ruleType, message |

**Scope behavior:**
- `global` → Event routed to Socket.IO room `quote:{token}` (any client subscribed to that token)
- `account` → Event routed to Socket.IO room `account:{accountId}` (only that user's session)

**Throttle behavior:**
- Per unique key (token, accountId, ruleType combination)
- Prevents flooding clients during high-frequency tick updates
- position.updated: max 4 updates/second per token per account
- risk.alert: max 1 alert per 5 seconds per rule type per account

---

## 3. PRODUCERS WIRED

| Producer | File | Channel(s) Published |
|----------|------|---------------------|
| MarketDataEngine | `server/services/marketDataEngine.js` | `market.tick` on every `pushQuote()` |
| AccountService | `server/services/accountService.js` | `order.created` on `placeOrder()` |
| AccountService | `server/services/accountService.js` | `order.updated` on `modifyOrder()` / `cancelOrder()` |
| PositionRepository | `server/repositories/position.repository.js` | `position.updated` on `upsertPosition()` |
| TradeRepository | `server/repositories/trade.repository.js` | `trade.executed` on `recordTrade()` |
| RiskEngine | `server/services/riskEngine.js` | `risk.alert` on daily loss / drawdown breach |
| RiskEngine | `server/services/riskEngine.js` | `challenge.updated` on lock / breach / target reached |

---

## 4. EVENT BRIDGE STARTUP

Wired in `server/index.js` during startup sequence:

```javascript
// Step 7b (after Socket.IO init):
eventBridge.setRealtimeServer(realtimeServer);
eventBridge.setWss(wss);
eventBridge.start();
```

Cleaned up on shutdown (`SIGTERM`/`SIGINT`):
```javascript
eventBridge.stop();
eventBus.destroy();
```

---

## 5. POLLING ELIMINATION

| Data | Before (Polling) | After (Event-Driven) |
|------|-------------------|---------------------|
| Market quotes | WS subscribe (already push) | `market.tick` → EventBridge → Socket.IO |
| Order status | REST `GET /api/orders` on interval | `order.created` / `order.updated` pushed via Socket.IO |
| Position P&L | REST `GET /api/positions` on interval | `position.updated` pushed on fill + MTM recalc |
| Trade fills | REST `GET /api/trades` on interval | `trade.executed` pushed immediately on fill |
| Challenge status | REST `GET /api/account/challenge` | `challenge.updated` pushed on state change |
| Risk alerts | Not available before | `risk.alert` pushed when thresholds hit |

**Frontend now receives all state changes via Socket.IO events.** REST endpoints remain for:
- Initial page load (hydration)
- Historical data queries
- Actions (place/modify/cancel orders)

---

## 6. RUNTIME VERIFICATION

```
$ node server/test-event-bus.js

════════════════════════════════════════════════
  EVENT BUS — Runtime Verification
════════════════════════════════════════════════

[Test 1] Channel Definitions          — 28 assertions ✓
[Test 2] Publish & Subscribe           — 21 assertions ✓
[Test 3] Wildcard Subscriptions        — 2 assertions  ✓
[Test 4] Payload Validation            — 5 assertions  ✓
[Test 5] Metrics Tracking              — 10 assertions ✓
[Test 6] EventBridge Routing           — 5 assertions  ✓
[Test 7] Throttling                    — 2 assertions  ✓
[Test 8] MarketDataEngine Integration  — 2 assertions  ✓
[Test 9] Unsubscribe                   — 2 assertions  ✓

  RESULTS: 77 passed, 0 failed
```

**What the tests verify:**
1. All 7 channels exist with correct schema definitions
2. Publish/subscribe works for every channel
3. Wildcard subscriptions (`order.*`, `*`) receive correct events
4. Payload validation rejects malformed data
5. Metrics track total emitted and per-channel counts
6. EventBridge routes global events to `quote:{token}` rooms
7. EventBridge routes account events to `account:{id}` rooms
8. Throttling prevents flood (position.updated: 1/5 forwarded at 250ms)
9. MarketDataEngine.pushQuote() automatically publishes to event bus
10. Unsubscribe cleans up listeners properly

---

## 7. FILE MANIFEST

| File | Role |
|------|------|
| `server/events/eventBus.js` | Core pub/sub engine (EventEmitter + Redis optional) |
| `server/events/channels.js` | Channel schema definitions + validation |
| `server/events/eventBridge.js` | Bus → Socket.IO/WS client routing with throttle |
| `server/events/index.js` | Module exports |
| `server/services/marketDataEngine.js` | Modified: publishes `market.tick` on pushQuote() |
| `server/services/accountService.js` | Modified: publishes order events |
| `server/services/riskEngine.js` | Modified: publishes risk.alert + challenge.updated |
| `server/repositories/trade.repository.js` | Modified: publishes trade.executed on recordTrade() |
| `server/repositories/position.repository.js` | Modified: publishes position.updated on upsert |
| `server/index.js` | Modified: starts EventBridge, cleanup on shutdown |
| `server/test-event-bus.js` | Runtime verification script (77 tests) |

---

## 8. MONITORING

### Health Endpoint

`GET /health` now includes event bus metrics:

```json
{
  "eventBus": {
    "totalEmitted": 45230,
    "byChannel": {
      "market.tick": 44800,
      "order.created": 12,
      "order.updated": 18,
      "position.updated": 340,
      "trade.executed": 8,
      "challenge.updated": 2,
      "risk.alert": 1
    },
    "uptimeMs": 3600000,
    "redisConnected": false
  },
  "eventBridge": {
    "forwarded": 42100,
    "throttled": 3130,
    "byChannel": { ... }
  }
}
```

---

## 9. FRONTEND CONSUMPTION PATTERN

Frontend subscribes via Socket.IO (no changes to UI code required in this phase):

```javascript
// Already handled by Socket.IO client setup:
socket.on('quote', ({ token, data }) => { /* update Zustand marketStore */ });
socket.on('order_update', ({ data }) => { /* update order list */ });
socket.on('position_update', ({ data }) => { /* update position P&L */ });
socket.on('trade_executed', ({ data }) => { /* append to trade book */ });
socket.on('challenge_update', ({ data }) => { /* update challenge progress */ });
socket.on('risk_alert', ({ data }) => { /* show warning/breach notification */ });
```

**No REST polling intervals needed for live state updates.**

---

*Generated by Agent C — Phase C2: Event Bus Architecture*
*Date: 2026-06-18*
*Verification: 77/77 tests passing*
