# AGENT HANDOFF — Execution Layer Gaps

## Date: 2026-06-19
## From: Agent C (Order Execution)
## To: Relevant Agents

---

## HANDOFF 1: Limit Order Fill Detection

**Owner:** Agent C / New Task  
**Blocking:** LIMIT, SL, SL-M orders complete lifecycle  
**Impact:** Medium — Market orders work fully; limit orders go to OPEN but never transition to FILLED

### Problem
When a LIMIT or SL/SL-M order is placed and sent to Angel One, it goes to `OPEN` status. The broker will fill it when price hits the level, but there is no mechanism to detect that fill and trigger the position/trade update pipeline.

### Solution Required
One of:
1. **Broker WebSocket Callback:** Angel One SmartAPI has order update websocket — subscribe to order status changes
2. **Polling Service:** Create a cron/interval that polls `getOrders()` from broker and compares with local status
3. **Webhook:** If Angel One supports push notifications (postback URL)

### Implementation Stub
`OrderExecutionService.handleBrokerFill(accountId, orderId, fillData)` already exists and handles the full pipeline (update order → position → trade → risk check). It just needs to be invoked when a fill is detected.

---

## HANDOFF 2: Frontend Socket Consumer

**Owner:** UI Agent (NOT Agent C scope)  
**Blocking:** Real-time updates without polling  
**Impact:** Low — 5s polling works, socket is enhancement

### Problem
Server emits `order_update`, `position_update`, `trade_executed` via Socket.IO to account rooms. Frontend doesn't consume these events — relies on 5-second polling interval in BottomPanel.

### Solution Required
Create a `useSocketUpdates()` hook in React that:
1. Connects Socket.IO client
2. Listens for `order_update`, `position_update`, `trade_executed`
3. Updates `useTradingStore` on each event
4. Falls back to polling if socket disconnects

---

## NO OTHER BLOCKERS

All other execution paths work end-to-end without dependency on other agents.
