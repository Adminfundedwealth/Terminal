# POSITION LIFECYCLE AUDIT — AGENT C PHASE C3

## Date: 2026-06-19
## Status: COMPLETE (All Lifecycle Methods Implemented)

---

## POSITION ENGINE IMPLEMENTATION

Located in: `server/repositories/position.repository.js`

The position engine uses `PositionRepository.upsertPosition()` as the central method.
It handles ALL position transitions in a single function based on trade context.

---

## LIFECYCLE STATES

### ✓ Open Position (New)
**Trigger:** First BUY or SELL for a token/productType combo
**Logic:** No existing open position found → INSERT new record
```
qty = BUY ? +qty : -qty
avg_price = fill price
realized_pnl = 0
closed_at = NULL
```
**Event:** `position.updated` → { status: 'open', qty, pnl: 0, avgPrice }

### ✓ Add Quantity (Pyramid)
**Trigger:** Same-direction trade on existing position
**Logic:** `isSameDirection = true` → add qty, recalculate weighted avg
```
newQty = existing.qty + addedQty
newAvgPrice = (oldAvg * oldQty + newPrice * newQty) / totalQty
```
**Event:** `position.updated` → { status: 'open', qty: newQty, avgPrice: newAvgPrice }

### ✓ Reduce Quantity (Partial Close)
**Trigger:** Opposite-direction trade, qty < existing position qty
**Logic:** `isSameDirection = false`, `closeQty < |existing.qty|`
```
realizedPnl += (exitPrice - avgPrice) * closeQty  [for longs]
realizedPnl += (avgPrice - exitPrice) * closeQty  [for shorts]
remainingQty = |existing.qty| - closeQty
```
**Event:** `position.updated` → { status: 'open', qty: remainingQty, pnl: realizedPnl }

### ✓ Reverse Position
**Trigger:** Opposite-direction trade, qty > existing position qty
**Logic:** `isSameDirection = false`, `excessQty > 0`
```
Step 1: Close existing (realize P&L)
Step 2: Open new position with excess qty in new direction
newQty = direction * excessQty
newAvgPrice = trade.price
```
**Event:** `position.updated` → { status: 'open', qty: newQty (opposite sign), avgPrice: trade.price }

### ✓ Close Position (Full Exit)
**Trigger:** Opposite-direction trade, qty == existing position qty
**Logic:** `remainingQty == 0 && excessQty == 0`
```
qty = 0
closed_at = NOW()
realized_pnl = accumulated + final close P&L
```
**Event:** `position.updated` → { status: 'closed', qty: 0, pnl: finalPnl }

### ✓ Half Close
**Trigger:** `exitPosition(accountId, positionId, qty)` where qty = Math.abs(position.qty) / 2
**Logic:** Calls `OrderExecutionService.exitPosition()` with specific qty
**Flow:** Creates market order → executes → upsertPosition handles partial reduction
**API:** `POST /positions/:id/exit` with body `{ qty: N }`

### ✓ Close All
**Trigger:** `closeAllPositions(accountId, reason)`
**Logic:** Iterates all open positions → calls exitPosition for each
**Flow:** Creates market orders for each position → parallel execution
**API:** `POST /positions/close-all`

---

## POSITION DATABASE SCHEMA

```sql
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    product_type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    CONSTRAINT unique_open_position UNIQUE(account_id, token, product_type)
);
```

**Key:** The UNIQUE constraint ensures one open position per token+productType per account.

---

## P&L CALCULATION

### Realized P&L
Calculated during `upsertPosition()` on reduce/close:
```
Long: (exitPrice - avgPrice) * closeQty
Short: (avgPrice - exitPrice) * closeQty
```

### Unrealized P&L
Calculated on-the-fly in `AccountService.getPositions()`:
```
Long: (ltp - avgPrice) * qty
Short: (avgPrice - ltp) * |qty|
```

Uses `marketDataEngine.getQuote(token)` for live LTP.

### Total P&L
```
totalPnl = realized_pnl + unrealizedPnl
```

---

## POSITION EVENTS

| Event | Channel | Payload |
|-------|---------|---------|
| New Position | position.updated | { symbol, token, qty, pnl: 0, avgPrice, status: 'open' } |
| Add/Reduce | position.updated | { symbol, token, qty, pnl, avgPrice, status: 'open' } |
| Close | position.updated | { symbol, token, qty: 0, pnl, avgPrice, status: 'closed' } |

All events include `meta: { accountId }` for account-room routing via EventBridge.

---

## VERIFICATION MATRIX

| Operation | Repository | Execution Service | API Route | Frontend | Event |
|-----------|------------|-------------------|-----------|----------|-------|
| Open | ✓ | ✓ (via executeOrder) | POST /orders/place | ✓ OrderPanel | ✓ |
| Add Qty | ✓ | ✓ (same token order) | POST /orders/place | ✓ OrderPanel | ✓ |
| Reduce Qty | ✓ | ✓ (exitPosition w/ qty) | POST /positions/:id/exit | ✓ BottomPanel % | ✓ |
| Reverse | ✓ | ✓ | POST /positions/:id/reverse | ✓ BottomPanel ↺ | ✓ |
| Close | ✓ | ✓ (exitPosition full) | POST /positions/:id/exit | ✓ BottomPanel ✕ | ✓ |
| Half Close | ✓ | ✓ (exitPosition 50%) | POST /positions/:id/exit | ✓ BottomPanel 50% | ✓ |
| Close All | ✓ | ✓ | POST /positions/close-all | ✓ CLOSE ALL btn | ✓ |
