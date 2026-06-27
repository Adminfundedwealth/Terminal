# PLAYWRIGHT FULL RUNTIME AUDIT

**Date:** 2026-06-18T19:28:26.917Z
**Auditor:** Playwright Automated Runtime Audit
**Backend:** http://localhost:4000
**Frontend:** http://localhost:3000

---

## VERDICT: C. Critical old-project dependencies remain

---

## 1. Backend Health

| Field | Value |
|-------|-------|
| Status | ok |
| Database | ✅ Connected |
| Market Feed | ✅ Connected |
| Socket.IO Clients | 0 |
| EventBus Emitted | 45 |
| Uptime | 120min |

## 2. API Endpoints

| Endpoint | Status | Data |
|----------|--------|------|
| Account Info (/api/account) | 200 | object |
| Challenge Progress (/api/account/challenge) | 500 | object |
| Risk Rules (/api/account/rules) | 500 | object |
| Positions (/api/positions) | 200 | array[0] |
| Orders (/api/orders) | 200 | array[0] |
| Trades (/api/trades) | 200 | array[0] |
| Trades Today (/api/trades?period=today) | 200 | array[0] |
| Watchlists (/api/watchlists) | 500 | object |
| Search Instruments (/api/instruments/search?q=nifty) | 200 | array[11] |
| Get Instruments by Segment (/api/instruments?segment=NSE) | 200 | array[24] |
| Market History (/api/market/history?token=99926000&tf=5) | 200 | array[0] |
| Market Depth (/api/market/depth?token=99926000) | 200 | object |
| Market Quote (/api/market/quote?token=99926000) | 200 | object |
| Market Status (/api/market/status) | 200 | object |
| Option Chain (/api/market/option-chain?symbol=NIFTY&expiry=2026-06-26) | 200 | array[0] |
| Expiries (/api/market/expiries?symbol=NIFTY) | 200 | array[8] |
| Market Live Feed Status (/api/market/live) | 200 | object |
| Broker Health (/api/broker/health) | 200 | object |

## 3. TradingView Datafeed

| Endpoint | Status | Result |
|----------|--------|--------|
| /api/tv/config | 200 | ✅ |
| /api/tv/symbols | 200 | NIFTY |
| /api/tv/search | 200 | 2 results |
| /api/tv/history | 200 | s=no_data, bars=0 |

## 4. Authentication

| Flow | Status | Result |
|------|--------|--------|
| Verify (no session) | 401 | no_session |
| Dev SSO Token | 200 | ✅ Generated |
| SSO (invalid token) | 302 | Redirected (correct) |
| Logout | 200 | ✅ |

## 5. WebSocket & Socket.IO

| Channel | Status | Details |
|---------|--------|---------|
| WebSocket /ws | ✅ Connected | 1 messages received |
| Socket.IO /socket.io | ✅ Handshake OK | OK |

**WebSocket Messages Received:**
```
  type=error, token=n/a
```

## 6. Frontend

| Check | Result |
|-------|--------|
| Page Loads | ✅ |
| Redirected | ✅ No |
| TopBar | ❌ Not found |
| Watchlist | ❌ Not found |
| Chart | ✅ Present |
| OrderPanel | ✅ Present |
| BottomPanel | ✅ Present |
| StatusBar | ❌ Not found |
| SearchModal trigger (Ctrl+K) | ✅ Present |
| Chart Canvas | ✅ Present |
| Old URL in network | 0 refs |
| Console errors | 0 |

## 7. EventBus

| Metric | Value |
|--------|-------|
| Total Emitted | 45 |
| Redis Connected | false |
| Uptime | 7172s |
| Channel: market.tick | 45 events |

## 8. Isolation Analysis

### Old Table References (bare names, should use t_ prefix)

| File | Line | Reference |
|------|------|-----------|
| server\cron\dailyChecks.js | 33 | `.from('accounts')` |
| server\cron\dailyChecks.js | 72 | `.from('accounts')` |
| server\db\client.js | 38 | `.from('users')` |
| server\db\setup.js | 72 | `.from('users')` |
| server\db\setup.js | 82 | `.from('users')` |
| server\db\setup.js | 87 | `.from('accounts')` |
| server\db\setup.js | 108 | `.from('users')` |
| server\db\setup.js | 121 | `.from('challenges')` |
| server\db\setup.js | 137 | `.from('accounts')` |
| server\repositories\challenge.repository.js | 33 | `.from('accounts')` |
| server\services\accountService.js | 43 | `.from('accounts')` |
| server\services\accountService.js | 55 | `.from('positions')` |
| server\services\accountService.js | 79 | `.from('orders')` |
| server\services\accountService.js | 95 | `.from('trades')` |
| server\services\accountService.js | 128 | `.from('orders')` |
| server\services\accountService.js | 175 | `.from('orders')` |
| server\services\accountService.js | 207 | `.from('orders')` |
| server\services\riskEngine.js | 335 | `.from('challenges')` |
| server\services\session.service.js | 27 | `.from('sessions')` |
| server\services\session.service.js | 55 | `.from('sessions')` |
| server\services\session.service.js | 72 | `.from('sessions')` |
| server\services\session.service.js | 91 | `.from('sessions')` |
| server\services\sso.service.js | 79 | `.from('users')` |
| server\services\sso.service.js | 100 | `.from('accounts')` |

### Old URL References

✅ No old-project URL references found.

---

## FINAL VERDICT: C. Critical old-project dependencies remain
