# MARKET DATA GAP CERTIFICATION

## Date: 2026-06-19

---

## SUMMARY

| Module | Status | Detail |
|--------|--------|--------|
| LTP | **WORKING** | Live ticks via SmartStream WebSocket, 9 symbols |
| OHLC | **WORKING** | Angel One Historical REST API + live candle aggregation |
| Depth | **WORKING** | REST polling (FULL mode quote) + SnapQuote (mode 3) |
| Option Chain | **WORKING** | searchScrip + batch FULL quote, grouped by strike |
| OI | **PARTIAL** | Available in option chain quotes (opnInterest field). Missing: OI change tracking |
| Greeks | **BROKEN** | Not implemented. No IV/Delta/Gamma/Theta/Vega calculation |
| WebSocket Reconnect | **WORKING** | Exponential backoff, re-login, auto-resubscribe |
| Snapshot Recovery | **WORKING** | Cached quotes served immediately on new subscribe |

---

## 1. LTP (Last Traded Price)

**Status: WORKING**

### Source
- `server/brokers/angelone/angel.feed.connector.js` → SmartStream WebSocket V2
- Binary protocol, mode 1 (LTP): 51 bytes per tick

### Flow
```
Angel One SmartStream WSS
  → Binary frame (mode 1, 51 bytes)
  → AngelFeedConnector._parseTick()
  → marketDataEngine.pushQuote(token, { ltp, exchange, timestamp })
  → eventBus.publish('market.tick', ...)
  → EventBridge → Socket.IO → Frontend
```

### Evidence
- 9 symbols subscribed at startup (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, RELIANCE, SBIN, HDFCBANK, TCS, INFY)
- Tick count continuously increments (verified via `/health` endpoint)
- `market.tick` events: thousands emitted per minute during market hours

### Gaps
- None for LTP mode

---

## 2. OHLC (Historical Candles)

**Status: WORKING**

### Source
- `server/services/candleService.js`
- Angel One REST: `POST /rest/secure/angelbroking/historical/v1/getCandleData`

### Supported Timeframes
| TF | Angel API Interval | Range Default |
|----|-------------------|---------------|
| 1m | ONE_MINUTE | 3 days |
| 3m | THREE_MINUTE | 3 days |
| 5m | FIVE_MINUTE | 3 days |
| 15m | FIFTEEN_MINUTE | 15 days |
| 30m | THIRTY_MINUTE | 15 days |
| 1H | ONE_HOUR | 60 days |
| 4H | ONE_HOUR (aggregate) | 60 days |
| D | ONE_DAY | 365 days |
| W | ONE_DAY (aggregate) | 365 days |

### Live Candle Aggregation
- `processLiveTick()` builds real-time candles from live ticks
- Tracks current candle for 1m, 5m, 15m simultaneously
- Updates OHLC on every tick: high = max, low = min, close = ltp

### Token Refresh
- On 403/401: auto-refreshes JWT via `_refreshCallback`, retries once
- Proactive refresh scheduled every 55 minutes

### Gaps
- 4H and Weekly are served as 1H/Daily respectively (no server-side aggregation into larger TF)

---

## 3. Market Depth (DOM)

**Status: WORKING**

### Sources (two modes)

#### Mode A: REST Polling (on-demand)
- `server/services/depthService.js`
- `POST /rest/secure/angelbroking/market/v1/quote/` with `mode: "FULL"`
- Returns: 5 bid levels + 5 ask levels + totalBuyQty + totalSellQty
- Triggered by: `GET /api/market/depth?token=X&exchange=NSE`

#### Mode B: SmartStream SnapQuote (real-time)
- `angel.feed.connector.js` → mode 3 (379 bytes)
- Parses binary depth at offset 87: 5×bid (qty+price+orders) + 5×ask
- Pushes to `marketDataEngine.pushDepth()` → subscribers + Socket.IO

### Output Shape
```js
{
  token: "2885",
  bids: [{ price: 2934.50, qty: 150, orders: 12 }, ...], // 5 levels
  asks: [{ price: 2935.00, qty: 200, orders: 8 }, ...],  // 5 levels
  totalBuyQty: 450000,
  totalSellQty: 380000
}
```

### Depth Upgrade
- `upgradeSubscription(tokens, 3)` → switches from LTP mode to SnapQuote mode for real-time depth

### Gaps
- Default subscription is mode 1 (LTP only). Depth requires explicit upgrade to mode 3.
- No automatic upgrade when user opens depth panel (frontend must request it)

---

## 4. Option Chain

**Status: WORKING**

### Source
- `server/services/optionChainService.js`
- Step 1: `searchScrip` → find all CE/PE tokens for underlying+expiry
- Step 2: Batch `FULL` quote (50 tokens/batch) → get LTP, OI, volume, depth
- Step 3: Group by strike → return sorted array

### Flow
```
GET /api/market/option-chain?symbol=NIFTY&expiry=2026-06-29
  → OptionChainService.getOptionChain('NIFTY', '2026-06-29')
  → _formatExpiry('2026-06-29') → '26JUN29'
  → _findOptionInstruments('NIFTY', '26JUN29')
    → searchScrip: { exchange:'NFO', searchscrip:'NIFTY26JUN29' }
    → Returns all tokens: NIFTY26JUN2924000CE, NIFTY26JUN2924000PE, etc.
  → _batchQuote(tokens) → FULL mode quote for all strikes
  → _buildChain() → group by strike, separate CE/PE
```

### Output Per Strike
```js
{
  strike: 24000,
  callToken: "12345", callSymbol: "NIFTY26JUN2924000CE",
  callLtp: 150.25, callVolume: 45000, callOi: 1200000,
  callBidQty: 50000, callAskQty: 45000,
  putToken: "12346", putSymbol: "NIFTY26JUN2924000PE",
  putLtp: 85.50, putVolume: 38000, putOi: 980000,
  putBidQty: 42000, putAskQty: 40000,
}
```

### Caching
- Instrument list cached for 5 minutes (strikes don't change intraday)
- Quotes are always fresh (no quote caching)

### Gaps
- No Greeks (IV, Delta, Gamma, Theta, Vega) — see section 6
- No OI change (previous day OI not stored)
- No auto-refresh — must poll

---

## 5. OI (Open Interest)

**Status: PARTIAL**

### What Works
- Raw OI value available from Angel One FULL quote: `opnInterest` field
- Exposed in option chain as `callOi` / `putOi`
- Also available in LTP+Quote mode ticks for subscribed tokens

### What's Missing
- **OI Change** (today vs previous day): requires storing previous close OI
- **OI Change %**: not calculated
- **Total OI** (aggregate across all strikes): not computed
- **Max Pain calculation**: not implemented
- **PCR (Put-Call Ratio)**: not computed from OI data

### Where OI Appears
| Context | OI Available | OI Change |
|---------|:---:|:---:|
| Option Chain per strike | ✓ | ✗ |
| Quote (subscribed token) | ✓ | ✗ |
| Watchlist item | ✗ | ✗ |
| Aggregate (total CE OI, total PE OI) | ✗ | ✗ |

---

## 6. Greeks (IV, Delta, Gamma, Theta, Vega)

**Status: BROKEN — NOT IMPLEMENTED**

### Current State
- Frontend type defines `OptionChainEntry` with fields: `callIv, callDelta, callGamma, callTheta, callVega`
- Backend **never calculates or returns these values**
- Angel One API does NOT provide Greeks
- No Black-Scholes or Binomial model implemented
- All Greek fields would be `0` or `undefined`

### What Would Be Needed
1. **Implied Volatility (IV)**: Newton-Raphson solver using Black-Scholes
   - Inputs: LTP, strike, underlying LTP, time to expiry, risk-free rate
2. **Delta/Gamma/Theta/Vega**: Direct Black-Scholes partial derivatives
   - Requires: IV (from step 1), underlying price, time to expiry, strike
3. **Risk-free rate**: Hardcoded or fetched (e.g., 91-day T-bill rate ~6.5%)
4. **Time to expiry**: Calculated from expiry date − current date (in years)

### Effort Estimate
- Medium: ~200 lines of Black-Scholes math + integration into optionChainService
- No external dependency needed (pure math)

---

## 7. WebSocket Reconnect

**Status: WORKING**

### Implementation: `angel.feed.connector.js`

| Feature | Implemented |
|---------|:-----------:|
| Auto-reconnect on close | ✓ |
| Exponential backoff | ✓ (base 3s, ×1.5 per attempt, capped 30s) |
| Jitter | ✓ (+random 0-1s) |
| Max reconnect attempts | ✓ (50, then 60s cooldown and restart) |
| Re-login before reconnect | ✓ (TOTP-based fresh login) |
| Auto-resubscribe all tokens | ✓ (`_resubscribeAll()`) |
| Heartbeat (keep-alive) | ✓ (ping every 25s) |
| JWT proactive refresh | ✓ (every 55 min before 1h expiry) |
| Token refresh notification | ✓ (callbacks propagate to CandleService, DepthService, OptionChainService) |

### Reconnect Flow
```
WebSocket 'close' event
  → _attemptReconnect()
  → Wait (backoff delay)
  → login() (fresh TOTP)
  → connect() (new WebSocket)
  → _resubscribeAll() (restore all token subscriptions)
  → Resume ticks
```

### Edge Cases Handled
- Token expired during reconnect → full re-login
- Max attempts exceeded → 60s cooldown → reset counter → retry
- Connection timeout → treated as close → reconnect path

---

## 8. Snapshot Recovery

**Status: WORKING**

### Implementation: `marketDataEngine.js`

| Feature | Implemented |
|---------|:-----------:|
| Quote cache (in-memory Map) | ✓ |
| Immediate cache delivery on subscribe | ✓ |
| Depth cache | ✓ |
| Immediate depth on subscribe | ✓ |
| Cache survives reconnect | ✓ (not cleared on disconnect) |

### How It Works
```js
// When a new subscriber registers:
subscribe(token, cb) {
  // Add to subscriber set
  this.subscribers.get(token).add(cb);
  // Immediately deliver cached quote (no wait for next tick)
  const cached = this.quotes.get(token);
  if (cached) cb({ type: 'quote', token, data: cached });
}
```

- After reconnect, the quote cache still holds last-known values
- New subscribers (e.g., user switches to a symbol) get the cached LTP instantly
- Live ticks overwrite the cache as they arrive

### Gaps
- No TTL on cached quotes (stale quotes persist if feed disconnects for a long time)
- No "stale" indicator flag sent to frontend

---

## GAP SUMMARY

| Gap | Severity | Module | Fix Effort |
|-----|----------|--------|-----------|
| Greeks not calculated | HIGH | Option Chain | Medium (Black-Scholes implementation) |
| OI Change not tracked | MEDIUM | Option Chain / MarketData | Low (store prev day close OI) |
| 4H/Weekly candle aggregation | LOW | CandleService | Low (group 1H/Daily candles) |
| No auto depth-upgrade on UI open | LOW | Feed Connector / Socket.IO | Low (socket event trigger) |
| No stale-data indicator | LOW | MarketDataEngine | Trivial (add timestamp check) |
| PCR / Max Pain not computed | MEDIUM | OptionChainService | Medium (aggregate OI + iterate strikes) |
