# Market Depth Live Audit — Failure Point Analysis

**Date:** June 19, 2026  
**Status:** AUDIT ONLY — No code modified  
**Result:** 🔴 Market Depth does NOT receive live data — exact failure point identified  

---

## Executive Summary

Market depth (DOM/Level 2) fails because the **backend subscribes all tokens in LTP mode (mode 1) only**. Mode 1 packets are 51 bytes and contain **only the LTP** — no depth data. Depth data requires **SnapQuote mode (mode 3)** which produces 379-byte packets containing 5-level bid/ask depth.

The frontend correctly sends `subscribe_depth` → the backend correctly registers a depth callback → but **no broker adapter ever subscribes the token in mode 3**, so `pushDepth()` is never called, and the depth callback never fires.

---

## Data Flow Trace

```
FRONTEND                          BACKEND                           BROKER (Angel SmartStream)
────────                          ───────                           ──────────────────────────

1. useDepth(token)                                                  
   │                                                                
2. wsService.send({               3. handleMessage()                
     type: 'subscribe_depth',        case 'subscribe_depth':        
     tokens: [token]                    callback = (data) => ws.send(data)
   })                                   depthSubscriptions.set(token, callback)
                                        marketDataEngine.subscribeDepth(token, callback)
                                        │
                                  4. marketDataEngine.subscribeDepth()
                                        depthSubscribers.set(token, callback)
                                        checks depthCache → EMPTY (nothing in cache)
                                        │
                                  ❌ DEAD END — Nothing triggers pushDepth()
                                  ❌ No code calls angelFeed.subscribe([token], 3)
                                  ❌ No code calls depthService.getDepth(token)
                                  ❌ Feed only subscribes in mode 1 (LTP)
                                                                    
                                  ════════════════════════════════════
                                  
                                  Meanwhile, for QUOTES (working):
                                  
                                  connectAngelFeed():
                                     angelFeed.subscribe(defaultTokens, 1) ← MODE 1 ONLY
                                                                    
                                                                    SmartStream sends 51-byte
                                                                    LTP packets → _parseTick()
                                                                    → pushQuote() ✅ WORKS
```

---

## Verification Points

### 1. Backend Depth Feed — ❌ NOT PRODUCING DATA

**File:** `server/index.js` line 240  
```javascript
angelFeed.subscribe(defaultTokens, 1); // LTP mode
```

**Problem:** All tokens are subscribed in **mode 1 (LTP)** exclusively. Mode 1 produces 51-byte packets with only the LTP price. No depth information is included.

**What's needed:** Mode 3 (SnapQuote) produces 379-byte packets that include 5-level bid/ask depth. The `_parseTick()` method in `angel.feed.connector.js` correctly parses mode 3 and calls `pushDepth()` — but this code path is never reached because no tokens are subscribed in mode 3.

---

### 2. WebSocket Events — ✅ CORRECTLY WIRED

**File:** `server/routes/websocket.js` lines 109-124  
```javascript
case 'subscribe_depth': {
  const tokens = data.tokens || [];
  tokens.forEach((token) => {
    if (depthSubscriptions.has(token)) return;
    const callback = (depthData) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(depthData));
    };
    depthSubscriptions.set(token, callback);
    marketDataEngine.subscribeDepth(token, callback);  // ← Registers correctly
  });
  break;
}
```

**Verdict:** The WebSocket handler correctly receives `subscribe_depth` from the frontend and registers a callback with `marketDataEngine`. This part works. The callback just never fires because `pushDepth()` is never called.

---

### 3. Payload Structure — ✅ CORRECT (when data exists)

**File:** `server/brokers/angelone/angel.feed.connector.js` lines 284-335  
```javascript
} else if (mode === 3 && buffer.length >= 379) {
  // SnapQuote mode — parses 5-level depth
  // Parse bids/asks from offset 87, each level = 10 bytes
  this.marketDataEngine.pushDepth(token, {
    token, bids, asks,
    totalBuyQty: bids.reduce(...),
    totalSellQty: asks.reduce(...),
  });
}
```

**Verdict:** The binary parsing logic for mode 3 SnapQuote is complete and correctly calls `pushDepth()` with the right structure: `{ token, bids: [{price, qty, orders}], asks: [...], totalBuyQty, totalSellQty }`.

---

### 4. Frontend Listener — ⚠️ WORKS BUT HAS A TIMING GAP

**File:** `src/hooks/useMarketData.ts` lines 33-45  
```typescript
export function useDepth(token: string | undefined) {
  const depth = useMarketStore((s) => s.depth);
  useEffect(() => {
    if (!token) return;
    wsService.send({ type: 'subscribe_depth', tokens: [token] });
    return () => {
      wsService.send({ type: 'unsubscribe_depth', tokens: [token] });
    };
  }, [token]);
  return token ? depth[token] : undefined;
}
```

**Problems:**
1. Uses `wsService.send()` which silently fails if WebSocket is not yet connected (no queuing, no retry)
2. Unlike `wsService.subscribe()` (for quotes) which stores tokens in `subscribedTokens` and re-sends on reconnect, `useDepth` uses raw `send()` — **depth subscriptions are NOT resubscribed on reconnect**
3. If the component mounts before WebSocket connects, the `subscribe_depth` message is lost forever

**Compare with quotes (working):**  
`wsService.subscribe()` → stores token in `subscribedTokens` set → re-subscribes in `onopen` handler  
`useDepth` → raw `send()` → lost if WS not connected, lost on reconnect

---

### 5. Frontend Rendering Conditions — ✅ CORRECT

**File:** `src/components/MarketDepthPanel.tsx` lines 166-170  
```typescript
const liveDepth = useDepth(activeSymbol?.token);
const depth = liveDepth ?? emptyDepth();
const hasData = depth.bids.length > 0 || depth.asks.length > 0;
```

**Verdict:** Rendering logic is correct. Shows data when `bids.length > 0` or `asks.length > 0`, shows empty state otherwise. The store update path (`updateDepth`) is also correct.

---

## Root Cause: THREE Failures

| # | Failure | Layer | Severity |
|---|---------|-------|----------|
| **1** | `angelFeed.subscribe(tokens, 1)` — only LTP mode, never mode 3 | Backend (`server/index.js:240`) | 🔴 PRIMARY |
| **2** | No code triggers `depthService.getDepth()` when `subscribe_depth` received | Backend (`websocket.js`) | 🔴 PRIMARY |
| **3** | `useDepth` uses raw `send()` — not queued, not re-sent on reconnect | Frontend (`useMarketData.ts`) | 🟡 SECONDARY |

---

## Why Charts Work But Depth Doesn't

| Aspect | Quotes (Working) | Depth (Broken) |
|--------|-------------------|----------------|
| Broker subscription mode | Mode 1 (LTP) ✅ | Mode 3 (SnapQuote) ❌ never called |
| Backend auto-subscribes on startup | Yes (`connectAngelFeed`) | No |
| Frontend subscription method | `wsService.subscribe()` — queued + re-sent | `wsService.send()` — fire-and-forget |
| On reconnect | Resubscribes via `subscribedTokens` | Lost — never re-sent |
| `pushDepth()` called | N/A | Never (no mode 3 ticks arrive) |
| REST API fallback | N/A | `depthService.getDepth()` exists but is never called from WS handler |

---

## Fix Required (What Would Need to Change)

> ⚠️ These are BACKEND changes — not implemented per instructions.

### Fix Option A: Subscribe tokens in Mode 3 (real-time depth)

In `server/index.js`, change:
```javascript
angelFeed.subscribe(defaultTokens, 1); // LTP mode
```
to:
```javascript
angelFeed.subscribe(defaultTokens, 2); // Quote mode (OHLC + best bid/ask)
// OR for full depth:
// angelFeed.subscribe(defaultTokens, 3); // SnapQuote mode (5-level depth)
```

**Trade-off:** Mode 3 generates 379 bytes/tick vs 51 bytes/tick — 7.4x more bandwidth. Should only be used for actively-viewed symbols, not all subscribed tokens.

### Fix Option B: On-demand depth polling via REST

In `server/routes/websocket.js`, when `subscribe_depth` is received, call `depthService.getDepth(token)` to fetch via REST and push to cache:
```javascript
case 'subscribe_depth': {
  tokens.forEach(async (token) => {
    // Subscribe to engine for future pushes
    marketDataEngine.subscribeDepth(token, callback);
    // Also fetch current depth via REST API
    const depth = await depthService.getDepth(token, exchange);
    if (depth.bids.length > 0) callback({ type: 'depth', token, data: depth });
  });
}
```

### Fix Option C (Frontend): Add depth to reconnect logic

In `src/services/websocket.ts`, track depth subscriptions and re-send on reconnect:
```typescript
private depthTokens: Set<string> = new Set();

subscribeDepth(tokens: string[]) {
  tokens.forEach(t => this.depthTokens.add(t));
  this.send({ type: 'subscribe_depth', tokens });
}

// In onopen:
if (this.depthTokens.size > 0) {
  this.send({ type: 'subscribe_depth', tokens: Array.from(this.depthTokens) });
}
```

---

## Conclusion

The market depth panel is **correctly implemented** on both frontend and backend from a code structure perspective. The failure is a **missing integration step**: no code actually subscribes tokens with the broker in mode 3 (SnapQuote), and no code calls the REST-based `depthService.getDepth()` as a fallback when a depth subscription is requested.

The `depthService.getDepth()` function works perfectly — it fetches from Angel One API in FULL mode and parses the 5-level depth. It just has no caller in the WebSocket subscription flow.

**Exact failure point:** `server/index.js` line 240 — `angelFeed.subscribe(defaultTokens, 1)` should include a mechanism to upgrade tokens to mode 3 when depth is requested by a client.
