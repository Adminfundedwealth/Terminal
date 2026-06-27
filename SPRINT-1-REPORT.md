# SPRINT 1 — Foundation Implementation Report

## Status: COMPLETE

## What Was Done

### 1. Supabase Wiring
- `server/db/client.js` — Supabase client initialized with service role key
- Connection test returns `{ connected: true }` at runtime
- Graceful degradation: if tables are missing, reports "OK (tables pending migration)"

### 2. Repository Initialization
All 10 repositories updated to use `t_` prefixed table names (avoiding collision with existing Dashboard tables in shared Supabase project):

| Repository | Table Name | Status |
|---|---|---|
| UserRepository | `t_users` | ✓ Wired |
| AccountRepository | `t_accounts` | ✓ Wired |
| ChallengeRepository | `t_challenges` | ✓ Wired |
| OrderRepository | `t_orders` | ✓ Wired |
| PositionRepository | `t_positions` | ✓ Wired |
| TradeRepository | `t_trades` | ✓ Wired |
| WatchlistRepository | `t_watchlists` | ✓ Wired |
| RiskRulesRepository | `t_risk_rules` | ✓ Wired |
| MetricsRepository | `t_account_metrics` | ✓ Wired |
| (Sessions via service) | `t_sessions` | ✓ Wired |

### 3. Dashboard → Terminal SSO
- `server/services/sso.service.js` — Validates JWT signed by Dashboard
- `server/routes/auth.routes.js` — `/auth/sso?token=...` endpoint
- `server/middleware/auth.js` — Dev bypass mode when not in production
- SSO flow: Dashboard generates token → Terminal validates → Sets httpOnly cookie → Redirects to terminal

### 4. User → Challenge → Account Mapping
- SSO token contains `{ sub: fwUserId, accountId, challengeId }`
- Terminal validates user exists in `t_users`, account exists in `t_accounts`
- Account must be `status: 'active'` to proceed
- Challenge linked via `t_accounts.challenge_id` FK

### 5. Risk Persistence
- `server/services/riskEngine.js` — Reads rules from `t_risk_rules` via RiskRulesRepository
- 9 rule types supported: daily_loss_limit, max_drawdown, profit_target, max_positions, max_lot_size, allowed_segments, trading_hours, no_overnight, max_daily_trades
- Pre-trade and post-trade checks fully implemented

### 6. Challenge Persistence
- `server/services/challengeService.js` — Full lifecycle management
- States: active → passed | failed | expired
- Auto-transitions based on profit target, drawdown, expiry
- Daily unlock for accounts locked by daily loss

## Runtime Evidence

```
Health endpoint: GET /health
Response:
{
  "status": "ok",
  "database": { "connected": true, "reason": "OK (tables pending migration)" },
  "marketData": { "isLive": false, "adapterConnected": false },
  "uptime": 143
}
```

## Migration Required

Tables need to be created via Supabase SQL Editor:
- File: `server/db/migrations/004_terminal_tables.sql`
- Once applied, `server/db/setup.js` will seed test data

## Files Modified/Created

- `server/index.js` — Complete rewrite (removed mock simulation server)
- `server/db/client.js` — Updated table reference for connectivity test
- `server/db/setup.js` — Updated to use t_ prefixed tables
- `server/db/migrations/004_terminal_tables.sql` — New migration
- `server/db/migrate.js` — Migration verification tool
- `server/repositories/*.js` — All updated to t_ prefix (9 files)
- `server/services/accountService.js` — Updated table references
- `server/services/sso.service.js` — Updated table references
- `server/services/session.service.js` — Updated table references
- `server/services/riskEngine.js` — Updated table reference
- `server/cron/dailyChecks.js` — Updated table references
