# OPTION-CHAIN-AUDIT.md — Phase B4

## Audit Date: 2026-06-19
## Status: FIXED

---

## Flow Verified

```
Frontend → GET /api/market/option-chain?symbol=NIFTY&expiry=2026-06-26
    ↓
API Router (api.js)
    ↓
OptionChainService.getOptionChain(symbol, expiry)
    ↓ _formatExpiry("2026-06-26") → "26JUN26"
    ↓ _findOptionInstruments("NIFTY", "26JUN26")
    ↓     POST /rest/secure/angelbroking/order/v1/searchScrip
    ↓     { exchange: "NFO", searchscrip: "NIFTY26JUN26" }
    ↓     → returns option tokens (CE/PE for each strike)
    ↓
    ↓ _batchQuote(tokens) — batch of 50
    ↓     POST /rest/secure/angelbroking/market/v1/quote/
    ↓     { mode: "FULL", exchangeTokens: { NFO: [...tokens] } }
    ↓     → returns LTP, OI, volume, depth for each token
    ↓
    ↓ _buildChain(instruments, quotes)
    ↓     Groups by strike, maps CE/PE data
    ↓
Frontend receives sorted option chain
```

---

## Issues Found

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Expiry format mismatch: frontend sends ISO `2026-06-25`, API needs `25JUN26` | CRITICAL | FIXED |
| 2 | JWT expiry causes 403 on searchScrip — returns empty chain | HIGH | FIXED |
| 3 | JWT expiry causes 403 on batch quote — returns empty chain | HIGH | FIXED |
| 4 | No token at startup → returns empty immediately | MEDIUM | FIXED |

---

## Root Cause

The frontend sends expiry as ISO date (e.g. `2026-06-25`). The `_findOptionInstruments()` method concatenated it directly:

```javascript
// BEFORE (broken):
const searchTerm = `${symbol}${expiry}`; 
// Result: "NIFTY2026-06-25" — Angel One returns 0 results

// AFTER (fixed):
const formattedExpiry = this._formatExpiry(expiry);
const searchTerm = `${symbol}${formattedExpiry}`;
// Result: "NIFTY25JUN26" — Angel One returns all option strikes
```

---

## Fixes Applied

### 1. Expiry Format Conversion (optionChainService.js)
```javascript
_formatExpiry(expiry) {
  // Pass through if already in Angel format: "25JUN26"
  if (/^\d{2}[A-Z]{3}\d{2}$/.test(expiry)) return expiry;
  
  // Convert ISO "2026-06-25" → "25JUN26"
  const date = new Date(expiry);
  const dd = String(date.getDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mmm = months[date.getMonth()];
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}${mmm}${yy}`;
}
```

### 2. 403 Retry in searchScrip (optionChainService.js)
On 403/401 response from `searchScrip`, refreshes JWT via callback and retries once.

### 3. 403 Retry in batchQuote (optionChainService.js)
Same pattern applied to the FULL quote batch call.

### 4. Self-Healing on Empty Token (optionChainService.js)
```javascript
if (!this.jwtToken) {
  if (this._refreshCallback) {
    this.jwtToken = await this._refreshCallback();
  }
  if (!this.jwtToken) return [];
}
```

---

## Option Chain Data Format

```json
[
  {
    "strike": 24000,
    "callToken": "12345",
    "callSymbol": "NIFTY26JUN2624000CE",
    "callLtp": 185.50,
    "callVolume": 450000,
    "callOi": 1200000,
    "callBidQty": 50000,
    "callAskQty": 45000,
    "callBidPrice": 185.00,
    "callAskPrice": 186.00,
    "putToken": "12346",
    "putSymbol": "NIFTY26JUN2624000PE",
    "putLtp": 92.30,
    "putVolume": 380000,
    "putOi": 980000,
    "putBidQty": 42000,
    "putAskQty": 38000,
    "putBidPrice": 92.00,
    "putAskPrice": 92.50
  }
]
```

---

## Expiry Selection

Expiries are served via:
```
GET /api/market/expiries?symbol=NIFTY
```
This calls `instrumentService.getExpiries(symbol)` which reads from the loaded instrument master file. The frontend selects an expiry and sends it to the option chain endpoint.

---

## Caching Strategy

- Instrument cache: 5 minutes per `symbol:expiry` key
- No quote caching — always fetches live from broker
- Cache auto-clears via `setTimeout`

---

## Conclusion

Option chain now works end-to-end. The critical expiry format mismatch is fixed (ISO → DDMMMYY). JWT failures are self-healed via refresh callback. All data (LTP, OI, volume, bid/ask) comes live from Angel One — no generated strikes, no mock OI.
