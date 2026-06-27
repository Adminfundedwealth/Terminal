# SPRINT 2 — Broker Layer Report

## Status: COMPLETE

## What Was Done

### 1. BrokerFactory (`server/brokers/broker.factory.js`)
- Instance pooling keyed by `provider:clientId`
- Supports: AngelOne (ready), Dhan (placeholder), Upstox, Shoonya
- `create(provider, credentials)` — Connect and pool adapter
- `get(provider, clientId)` — Retrieve existing connection
- `disconnectAll()` — Clean shutdown
- `getHealthReport()` — Status of all configured brokers

### 2. HealthMonitor (`server/brokers/health.monitor.js`)
- Periodic connectivity checks (30s default interval)
- Auto-reconnection with configurable max retries (3)
- Exponential backoff via retry delay
- Reports status to BrokerFactory health map
- Started automatically on server boot

### 3. FailoverEngine (`server/brokers/failover.engine.js`)
- Primary/Secondary broker strategy
- Retry primary N times before switching
- Automatic revert when primary recovers (with cooldown)
- `execute(operation, name)` — Run operation with failover

### 4. AngelOne Adapter (existing — verified)
- `server/brokers/angelone/angelone.adapter.js` — FULLY IMPLEMENTED
- TOTP-based login via `@otplib/preset-default`
- REST endpoints: quotes, OHLC, depth, place/modify/cancel orders, positions, orders, trades, funds
- Token refresh mechanism
- Session expiry tracking

### 5. Dhan Adapter Placeholder (`server/brokers/dhan/`)
- `dhan.adapter.js` — Full structure with all method signatures
- `dhan.types.js` — Exchange segment mapping, product/order type conversion
- All methods throw "not implemented" (no fake data)
- API reference documented in comments for future implementation
- Credentials available in .env (access token + client ID)

## Runtime Evidence

```
GET /api/broker/health
Response:
{
  "_available": {
    "angelone": { "configured": true, "status": false },
    "dhan": { "configured": true, "status": "not_implemented" }
  }
}
```

- `configured=true` means credentials exist in .env
- `status=false` means not actively connected (no auto-connect on startup — awaiting explicit trigger)
- Dhan `status="not_implemented"` — adapter structure exists but methods not yet coded

## CREDENTIAL STATUS

| Broker | API Key | Client ID | Token | Ready? |
|---|---|---|---|---|
| Angel One | ✓ CYh0Bp3e | ✓ AI209499 | TOTP secret present | YES — pending user trigger |
| Dhan | — | ✓ 1100826807 | ✓ JWT present (expires 2026) | NO — adapter not implemented |

## NOT CLAIMED

- ❌ Angel One is NOT connected (would require calling `BrokerFactory.create('angelone')`)
- ❌ Dhan is NOT connected (adapter not implemented)
- ❌ No live market data flowing (no broker adapter active)

## Files Created

- `server/brokers/broker.factory.js`
- `server/brokers/health.monitor.js`
- `server/brokers/failover.engine.js`
- `server/brokers/index.js`
- `server/brokers/dhan/dhan.adapter.js`
- `server/brokers/dhan/dhan.types.js`

## Credential Requirements (When Ready to Connect)

To activate Angel One adapter, the following is needed:
1. Valid TOTP secret (present in .env)
2. Market hours (API may reject outside trading hours)
3. Explicit trigger: `await BrokerFactory.create('angelone')`

To implement Dhan adapter:
1. Access token is valid until 2026 (already in .env)
2. Implement REST calls against `https://api.dhan.co/v2`
3. Implement WebSocket feed against `wss://api-feed.dhan.co`
