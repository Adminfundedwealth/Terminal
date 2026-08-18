# Account Audit: ejudha@gmail.com

**Date:** 2026-08-18  
**Status:** RESOLVED — code fixes applied

---

## 1. User Identity & Account Status

| Field | Value |
|-------|-------|
| Email | ejudha@gmail.com |
| Display Name | judha raja singh |
| Trader ID | `c2015f94-6beb-4a27-a5b4-b99e854e81c1` |
| External ID | `d880f607-0097-478b-ad3b-308a93bbab05` |
| Trader Status | **active** ✓ |
| Last Login | 2026-08-18T04:24 UTC |
| Account Created | 2026-08-16 |

### Trading Account

| Field | Value |
|-------|-------|
| Account Code | FW-W4CCSG5ORO |
| Account ID | `f42f807c-9b6a-417f-a8f7-d0bb3e28ff47` |
| Account Status | **active** ✓ |
| Balance | ₹1,00,000 |
| Peak Balance | ₹1,00,000 |
| Challenge Plan | Instant Funding |
| Challenge Type | funded |
| Broker | **paper** (simulated execution) |
| Drawdown Used | 0% (no losses recorded) |
| Daily Loss | 3% limit — NOT breached |
| Max Drawdown | 5% limit — NOT breached |

**Conclusion:** Account is fully active. No drawdown breach. No lock/suspension.

---

## 2. Order Rejections — Root Cause

### Rejected Order Found

```
[2026-08-18T04:03:01] BUY 1x NIFTY 24300 PE (MARKET)
  Reason: Market data unavailable — LTP is zero or missing. Order not executed.
  Token:  NIFTY_24300_PE
  Segment: NFO
```

### Root Cause: Synthetic Token vs Real Broker Token

The option chain modal was generating **synthetic placeholder tokens** like `NIFTY_24300_PE` when the user clicked a strike price. These are human-readable labels, NOT real Angel One instrument tokens (which are numeric like `46527`).

**The flow:**
1. Server fetches option chain from Angel One API → returns chain data with `callToken: "46527"` (real numeric token)
2. Frontend receives the chain data but **discards the real token**
3. Frontend constructs a synthetic `NIFTY_24300_PE` token and passes it to the order panel
4. Order is placed with this synthetic token
5. SmartStream feed never delivers ticks for a non-numeric token
6. `MarketDataEngine.getQuote("NIFTY_24300_PE")` returns `null` (no LTP)
7. All LTP fallbacks fail (Dhan, candle service) because the token is unrecognized
8. Order is rejected: "Market data unavailable — LTP is zero or missing"

### Option Chart Disconnection

The option chart also appears "disconnected" because:
- The WebSocket subscribes the synthetic `NIFTY_24300_PE` token to SmartStream
- SmartStream cannot resolve a non-numeric token → no ticks delivered
- Frontend shows "no data" / disconnected state for the option

---

## 3. Fixes Applied

### Fix 1: Frontend — Use real broker token from chain data
**File:** `src/components/OptionChainModal.tsx`

`handleStrikeClick` now accepts the real token (`e.callToken` / `e.putToken`) from the option chain API response and uses it as the primary token. Falls back to synthetic format only if the API didn't provide a token.

### Fix 2: Frontend Type — Add token fields to OptionChainEntry
**File:** `src/types/index.ts`

Added `callToken`, `callSymbol`, `putToken`, `putSymbol` optional fields to the `OptionChainEntry` interface so TypeScript properly types the chain data from the server.

### Fix 3: Server — Paper mode LTP fallback
**File:** `server/services/orderExecutionService.js`

Added a guarded fallback in `_handleMarketFill`: when in **paper mode** and LTP is unavailable (e.g., synthetic token edge case), the order's explicit price (set from option chain LTP at click time) is accepted as the fill price. This prevents rejection in paper mode while maintaining safety in live mode.

**Safety:** This fallback ONLY activates in paper mode. In live mode, orders with unavailable LTP are still correctly rejected — you never want to fill a live order without confirmed market pricing.

---

## 4. Session Status

- 5 sessions found, 3 currently valid (non-expired)
- User can access the terminal without re-login
- Session limit (max 3 concurrent) NOT exceeded

---

## 5. Risk Profile Check

- Plan: Instant Funding
- Daily loss limit: 3% of ₹1,00,000 = ₹3,000 — **NOT breached** (0 realized loss)
- Max drawdown: 5% of ₹1,00,000 = ₹5,000 — **NOT breached**
- No open positions
- No risk alerts
- No account lock/breach events
- Trading permissions: fully enabled (trade, view_positions, view_orders)

---

## 6. Summary

| Issue | Root Cause | Fix Status |
|-------|-----------|------------|
| Cannot buy/sell options | Synthetic token — no LTP from feed | ✅ Fixed — real token now passed |
| Option chart disconnected | Same synthetic token — feed ignores it | ✅ Fixed — real token subscribes correctly |
| Orders rejected | "LTP is zero or missing" due to synthetic token | ✅ Fixed — real token + paper fallback |
| Account locked/breached | NOT the issue — account is active | N/A |
| Drawdown limit hit | NOT the issue — 0% drawdown | N/A |

**User can now trade options from the option chain.** The real Angel One numeric token will be used for feed subscription and order execution, resolving both the LTP unavailability and the chart disconnection.
