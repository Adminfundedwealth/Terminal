# ANGEL ONE LIVE VERIFICATION

## Date: 2026-06-18
## Status: ALL CHECKS PASS

---

## 1. SmartAPI Login ✓

```
POST https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword
Body: { clientcode: "A1209499", password: "2822", totp: "215487" }

Response:
  status: true
  message: SUCCESS
  jwtToken: eyJhbGciOiJIUzUxMiJ9.eyJ1c2VybmFtZSI6IkExMjA5NDk5I...
  feedToken: eyJhbGciOiJIUzUxMiJ9...
  refreshToken: PRESENT
```

**RESULT: ✓ LOGIN SUCCESSFUL**

---

## 2. Session Token Generated ✓

```
JWT: eyJhbGciOiJIUzUxMiJ9.eyJ1c2VybmFtZSI6IkExMjA5NDk5I...
Feed Token: eyJhbGciOiJIUzUxMiJ9.eyJ1c2VybmFtZSI6IkExMjA5NDk5Iiw...
Refresh Token: PRESENT
```

**RESULT: ✓ ALL THREE TOKENS OBTAINED**

---

## 3. Profile Fetch ✓

```
GET /rest/secure/angelbroking/user/v1/getProfile

Response:
  Name: AMAN KUMAR SINGH
  Client Code: A1209499
  Exchanges: ["nse_fo","nse_cm","cde_fo","ncx_fo","bse_fo","bse_cm","mcx_fo"]
```

**RESULT: ✓ PROFILE VERIFIED — AMAN KUMAR SINGH, all exchanges enabled**

---

## 4. Funds Fetch ✓

```
GET /rest/secure/angelbroking/user/v1/getRMS

Response:
  Available Cash: 0.0700
  Net: 0.0700
  Used Margin: 0.0000
  Collateral: 0.0000
```

**RESULT: ✓ FUNDS RETRIEVED (account has ₹0.07 available)**

---

## 5. Positions Fetch ✓

```
GET /rest/secure/angelbroking/order/v1/getPosition

Response:
  message: SUCCESS
  data: (empty — no open positions)
```

**RESULT: ✓ POSITIONS ENDPOINT WORKS (0 open positions)**

---

## 6. Orderbook Fetch ✓

```
GET /rest/secure/angelbroking/order/v1/getOrderBook

Response:
  message: SUCCESS
  data: (empty — no orders today)
```

**RESULT: ✓ ORDERBOOK ENDPOINT WORKS (0 orders today)**

---

## 7. SmartWebSocketV2 Connected ✓

```
URL: wss://smartapisocket.angelone.in/smart-stream
Headers: Authorization, x-api-key, x-client-code, x-feed-token

Result: WebSocket CONNECTED
```

**RESULT: ✓ WEBSOCKET ESTABLISHED**

---

## 8. Subscribe NIFTY + BANKNIFTY ✓

```
Sent: { action: 1, params: { mode: 1, tokenList: [{ exchangeType: 1, tokens: ["99926000", "99926009"] }] } }

Result: Ticks begin arriving immediately
```

**RESULT: ✓ SUBSCRIPTION ACTIVE**

---

## 9. Realtime Ticks Verified ✓

```
Tick #1: NIFTY (99926000) | LTP: 24179.15 | 51 bytes binary
Tick #2: BANKNIFTY (99926009) | LTP: 58001.50 | 51 bytes binary
Tick #3: BANKNIFTY (99926009) | LTP: 58001.50 | 51 bytes binary
Tick #4: NIFTY (99926000) | LTP: 24179.15 | 51 bytes binary
Tick #5: BANKNIFTY (99926009) | LTP: 58002.85 | 51 bytes binary

Binary format (LTP mode, 51 bytes):
  Byte 0: mode (1 = LTP)
  Byte 1: exchange (1 = NSE_CM)
  Bytes 2-26: token (25 bytes, null-padded string)
  Bytes 27-34: sequence number (int64LE)
  Bytes 35-42: exchange timestamp (int64LE)
  Bytes 43-46: LTP (int32LE / 100)
```

**RESULT: ✓ LIVE TICKS CONFIRMED — NIFTY 24179.15, BANKNIFTY 58002.85**

---

## Cross-Verification: REST vs WebSocket

| Symbol | REST Quote (earlier) | WebSocket Tick (later) | Match? |
|---|---|---|---|
| NIFTY 50 | 24110.00 | 24179.15 | ✓ (price moved up in ~3 min) |
| BANKNIFTY | 57863.40 | 58002.85 | ✓ (price moved up in ~3 min) |

---

## Credential Fix Applied

| Field | Old (broken) | New (working) |
|---|---|---|
| Client ID | `AI209499` (letter I) | `A1209499` (digit 1) |
| Password | `4564` | `2822` |
| API Key | `CYh0Bp3e` | `CYh0Bp3e` (unchanged) |
| TOTP Secret | `YGQBBPXXZOJURRRNWSKDYDBG6M` | Same (unchanged) |

---

## IPv4 Requirement

Node.js `https` module defaults to IPv6 which times out for Angel One API. Solution applied in test scripts:

```javascript
import https from 'https';
const agent = new https.Agent({ family: 4 });
axios.create({ httpsAgent: agent });
```

This must be added to the Angel One adapter for production use.

---

## Summary

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | SmartAPI Login | ✓ PASS | `status: true, message: SUCCESS` |
| 2 | Session Token | ✓ PASS | JWT + Feed + Refresh tokens |
| 3 | Profile Fetch | ✓ PASS | `AMAN KUMAR SINGH, A1209499` |
| 4 | Funds Fetch | ✓ PASS | `Available Cash: 0.0700` |
| 5 | Positions Fetch | ✓ PASS | `SUCCESS` (0 positions) |
| 6 | Orderbook Fetch | ✓ PASS | `SUCCESS` (0 orders) |
| 7 | SmartWebSocketV2 | ✓ PASS | `WebSocket CONNECTED` |
| 8 | Subscribe NIFTY/BNF | ✓ PASS | Ticks arriving immediately |
| 9 | Realtime Ticks | ✓ PASS | `NIFTY 24179.15, BNF 58002.85` |
