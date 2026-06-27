# WEBSOCKET-AUDIT.md — Phase B7

## Audit Date: 2026-06-19
## Status: VERIFIED + FIXED

---

## Architecture

Two WebSocket layers serve the frontend:

### 1. Socket.IO (Primary — `/socket.io`)
- Auth: JWT from handshake auth token, cookie (`fw_session`), or query param
- Transport: WebSocket with polling fallback
- Rooms: `quote:{token}`, `depth:{token}`, `account:{accountId}`
- Ping/pong: 25s interval, 20s timeout

### 2. Legacy WS (Backward compat — `/ws`)
- Auth: JWT from cookie or query param
- Transport: Raw WebSocket
- Subscription model: per-client callback map

---

## Channels Verified

| Channel | Event Name | Scope | Throttle | Status |
|---------|-----------|-------|----------|--------|
| market.tick | `quote` | Global (room) | 0ms | ✓ Working |
| depth (push) | `depth` | Global (room) | 0ms | ✓ Working |
| order.created | `order_update` | Account | 0ms | ✓ Working |
| order.updated | `order_update` | Account | 0ms | ✓ Working |
| position.updated | `position_update` | Account | 250ms | ✓ Fixed (now pushed) |
| trade.executed | `trade_executed` | Account | 0ms | ✓ Working |
| challenge.updated | `challenge_update` | Account | 1000ms | ✓ Working |
| risk.alert | `risk_alert` | Account | 5000ms | ✓ Working |

---

## Reconnection Behavior

### SmartStream (Broker Feed) Reconnect
```
WebSocket close event
    ↓ _attemptReconnect()
    ↓ exponential backoff: 3s, 4.5s, 6.75s, ... (capped at 30s)
    ↓ jitter: +0-1000ms random
    ↓ max 50 attempts, then 60s cooldown + restart
    ↓
    ↓ login() → new JWT + feedToken
    ↓ connect() → new WebSocket connection
    ↓ _resubscribeAll() → restore all token subscriptions by mode
    ↓ _notifyTokenRefresh() → propagate new JWT to all services immediately
```

**Fix applied:** `login()` now calls `_notifyTokenRefresh()` so all services get the fresh JWT immediately on reconnect (not after 60s interval).

### Socket.IO Client Reconnect
- Built-in Socket.IO reconnection (transport-level)
- Client re-subscribes to rooms on `connect` event
- Server re-joins client to `account:{id}` room on new connection

---

## Subscription Restoration

After SmartStream reconnect:
```javascript
_resubscribeAll() {
  // Groups tokens by mode from subscribedTokens Map
  // Re-subscribes each group at the correct mode (1, 2, or 3)
  for (const [mode, tokens] of Object.entries(byMode)) {
    this.subscribe(tokens, parseInt(mode));
  }
}
```

The `subscribedTokens` Map persists across reconnects (stored in memory, not on WS connection).

---

## Memory Leak Prevention

| Component | Cleanup Mechanism |
|-----------|------------------|
| Socket.IO subscriptions | `subscriptionMap` cleared on disconnect |
| Legacy WS subscriptions | `subscriptions` + `depthSubscriptions` Maps cleared on close |
| MDE callbacks | `unsubscribe(token, callback)` removes specific callback from Set |
| EventBridge throttle cache | `cleanThrottleCache()` removes entries older than 60s |
| TradingView bar subscriptions | `_barSubscriptions` cleared on `unsubscribeBars()` |
| Position tracking | `_positionTrackingSubscriptions` cleared on refresh |

### Verified Patterns:
- Every `subscribe()` has a corresponding `unsubscribe()` on disconnect
- Socket.IO: `disconnect` event cleans `subscriptionMap`
- Legacy WS: `close` event iterates and unsubscribes all callbacks
- MarketDataEngine: `destroy()` clears all Maps
- EventBus: `destroy()` removes all listeners

---

## Heartbeat Configuration

| Layer | Mechanism | Interval |
|-------|-----------|----------|
| SmartStream | WebSocket ping | 25s |
| Socket.IO | Engine.IO ping | 25s (pingInterval) |
| Socket.IO | Timeout | 20s (pingTimeout) |
| Legacy WS | Market status broadcast | 30s |

---

## Event Flow: EventBus → Client

```
Service publishes event
    ↓
EventBus.publish(channel, payload, meta)
    ↓
EventBridge._handleEvent(channel, def, event)
    ↓ throttle check (per channel definition)
    ↓
    ├─ scope: "global" → Socket.IO room `quote:{token}` or `depth:{token}`
    └─ scope: "account" → Socket.IO room `account:{accountId}`
    
Additionally:
RealtimeServer._setupMarketDataBridge()
    ↓ intercepts MarketDataEngine.pushQuote/pushDepth
    ↓ emits directly to Socket.IO rooms (zero-latency path)
```

---

## Auth Flow

### Socket.IO
1. Middleware checks `socket.handshake.auth.token`
2. Falls back to cookie `fw_session`
3. Falls back to query param `?token=`
4. Dev bypass: if no Supabase configured, assigns dev user
5. On success: `socket.user` set, joins `account:{id}` room

### Legacy WS
1. `validateWSAuth(request)` checks cookie then query param
2. Returns user claims or null
3. On null: sends error message, closes with 4001

---

## Metrics Available

```
GET /health
{
  "socketIO": { "clients": 2, "rooms": 15, "subscriptions": 45 },
  "eventBus": { "totalEmitted": 12500, "byChannel": {...}, "listenerCounts": {...} },
  "eventBridge": { "forwarded": 8200, "throttled": 1500, "byChannel": {...} }
}
```

---

## Conclusion

WebSocket layer is fully verified:
- All 8 channels working (quote, depth, order, position, trade, challenge, risk, account)
- Reconnection restores subscriptions with correct modes
- JWT propagation is immediate on reconnect (no 60s gap)
- No memory leaks — all subscriptions cleaned on disconnect
- Throttling prevents flood on high-frequency channels (position: 250ms, challenge: 1s, risk: 5s)
