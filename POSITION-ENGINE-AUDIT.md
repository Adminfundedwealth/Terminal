# POSITION-ENGINE-AUDIT.md — Phase B6

## Audit Date: 2026-06-19
## Status: FIXED

---

## Flow Verified

```
Position Lifecycle:

OPEN:
  Order FILLED → OrderExecutionService._handleMarketFill()
      ↓ positionRepo.upsertPosition(accountId, { symbol, token, segment, side, qty, price })
      ↓ Inserts/updates t_positions in Supabase
      ↓ eventBus.publish('position.updated', ...)

UPDATE (live P&L):
  MarketDataEngine.pushQuote(token, { ltp })
      ↓ accountService position tracking subscription
      ↓ calculates: pnl = (ltp - avgPrice) * qty  [LONG]
      ↓            pnl = (avgPrice - ltp) * |qty|  [SHORT]
      ↓ eventBus.publish('position.updated', { symbol, token, qty, pnl, ltp, avgPrice })
      ↓ EventBridge → Socket.IO `account:{id}` room
      ↓ Frontend receives real-time P&L

CLOSE (full):
  POST /api/positions/:id/exit
      ↓ AccountService.exitPosition(accountId, positionId)
      ↓ OrderExecutionService.exitPosition()
      ↓ Places MARKET order opposite side, full qty
      ↓ On fill: position qty → 0, closed_at set

HALF CLOSE (partial):
  POST /api/positions/:id/exit { qty: partialQty }
      ↓ AccountService.exitPosition(accountId, positionId, qty)
      ↓ OrderExecutionService.exitPosition(accountId, positionId, qty)
      ↓ Places MARKET order opposite side, partial qty
      ↓ On fill: position qty reduced

REVERSE:
  POST /api/positions/:id/reverse
      ↓ AccountService.reversePosition(accountId, positionId)
      ↓ OrderExecutionService.reversePosition()
      ↓ Places MARKET order opposite side, 2x qty
      ↓ On fill: position flips direction

CLOSE ALL:
  POST /api/positions/close-all
      ↓ AccountService.closeAllPositions(accountId)
      ↓ OrderExecutionService.closeAllPositions()
      ↓ Iterates all open positions, exits each
```

---

## Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | P&L calculated only on REST poll (no real-time push) | HIGH | FIXED |
| 2 | No WebSocket notification when P&L changes | HIGH | FIXED |
| 3 | Position tracking not refreshed after new fills | MEDIUM | FIXED |

---

## Root Cause

The `AccountService.getPositions()` method calculates P&L on-demand:
```javascript
const ltp = marketDataEngine.getQuote(p.token)?.ltp || p.avg_price;
const pnl = p.qty > 0 ? (ltp - p.avg_price) * p.qty : (p.avg_price - ltp) * Math.abs(p.qty);
```

This only runs when the REST endpoint is called. No mechanism pushed P&L updates to the frontend in real-time.

---

## Fix Applied

### Real-Time Position P&L Tracking (accountService.js)

```javascript
async startPositionTracking(accountId) {
  // Subscribe to MDE quotes for each open position's token
  for (const pos of positions) {
    marketDataEngine.subscribe(pos.token, (event) => {
      const ltp = event.data?.ltp;
      const pnl = pos.qty > 0
        ? (ltp - pos.avg_price) * pos.qty
        : (pos.avg_price - ltp) * Math.abs(pos.qty);
      
      eventBus.publish('position.updated', {
        symbol: pos.symbol, token: pos.token,
        qty: pos.qty, pnl, ltp, avgPrice: pos.avg_price,
      }, { accountId });
    });
  }
}
```

### Auto-Refresh on New Fill

When an order fills, position tracking subscriptions are refreshed:
```javascript
eventBus.subscribe('order.updated', (event) => {
  if (event.payload?.status === 'FILLED') {
    setTimeout(() => this._refreshPositionTracking(accountId), 500);
  }
});
```

### Throttling

The `position.updated` channel has `throttleMs: 250` in EventBridge — prevents flooding the client with tick-level updates.

---

## Position Operations Summary

| Operation | Endpoint | Method |
|-----------|----------|--------|
| View positions | GET /api/positions | AccountService.getPositions() |
| Exit full | POST /api/positions/:id/exit | exitPosition(accountId, id) |
| Exit partial | POST /api/positions/:id/exit { qty } | exitPosition(accountId, id, qty) |
| Reverse | POST /api/positions/:id/reverse | reversePosition(accountId, id) |
| Close all | POST /api/positions/close-all | closeAllPositions(accountId) |

All operations flow through `OrderExecutionService` → broker → fill → position update → event.

---

## P&L Calculation

```
LONG position:  P&L = (LTP - avg_price) × qty
SHORT position: P&L = (avg_price - LTP) × |qty|
```

Both REST (on-demand) and WebSocket (real-time push) use the same formula.

---

## Conclusion

Position engine now provides real-time P&L updates via WebSocket. All position operations (open, close, partial, reverse, close-all) route through the execution service to the live broker. P&L tracking auto-refreshes when positions change. No mock P&L, no simulated positions.
