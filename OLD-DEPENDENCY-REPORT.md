# OLD DEPENDENCY REPORT

**Date:** 2026-06-18T19:28:26.917Z
**Scanner:** Playwright Runtime Audit + Source Scan

---

## Summary

- **Old table references (runtime-affecting):** 24
- **Old URL references:** 0
- **Old network requests (runtime):** 0

---

## Expected Tables (t_ prefix)

The terminal should ONLY use these tables:
- `t_users`
- `t_accounts`
- `t_orders`
- `t_positions`
- `t_trades`
- `t_challenges`
- `t_sessions`
- `t_risk_rules`
- `t_watchlists`
- `t_account_metrics`

## Files Using Old Bare Table Names

These files use `.from('table_name')` instead of `.from('t_table_name')`:

### `server\cron\dailyChecks.js`

| Line | Table | Code |
|------|-------|------|
| 33 | accounts | `.from('accounts')` |
| 72 | accounts | `.from('accounts')` |

### `server\db\client.js`

| Line | Table | Code |
|------|-------|------|
| 38 | users | `.from('users')` |

### `server\db\setup.js`

| Line | Table | Code |
|------|-------|------|
| 72 | users | `.from('users')` |
| 82 | users | `.from('users')` |
| 87 | accounts | `.from('accounts')` |
| 108 | users | `.from('users')` |
| 121 | challenges | `.from('challenges')` |
| 137 | accounts | `.from('accounts')` |

### `server\repositories\challenge.repository.js`

| Line | Table | Code |
|------|-------|------|
| 33 | accounts | `.from('accounts')` |

### `server\services\accountService.js`

| Line | Table | Code |
|------|-------|------|
| 43 | accounts | `.from('accounts')` |
| 55 | positions | `.from('positions')` |
| 79 | orders | `.from('orders')` |
| 95 | trades | `.from('trades')` |
| 128 | orders | `.from('orders')` |
| 175 | orders | `.from('orders')` |
| 207 | orders | `.from('orders')` |

### `server\services\riskEngine.js`

| Line | Table | Code |
|------|-------|------|
| 335 | challenges | `.from('challenges')` |

### `server\services\session.service.js`

| Line | Table | Code |
|------|-------|------|
| 27 | sessions | `.from('sessions')` |
| 55 | sessions | `.from('sessions')` |
| 72 | sessions | `.from('sessions')` |
| 91 | sessions | `.from('sessions')` |

### `server\services\sso.service.js`

| Line | Table | Code |
|------|-------|------|
| 79 | users | `.from('users')` |
| 100 | accounts | `.from('accounts')` |

## Old URL References

✅ None found.

## Repositories (Correctly Using t_ prefix)

The following repositories are correctly configured:
- UserRepository → `t_users` ✅
- AccountRepository → `t_accounts` ✅
- ChallengeRepository → `t_challenges` ✅
- OrderRepository → `t_orders` ✅
- PositionRepository → `t_positions` ✅
- TradeRepository → `t_trades` ✅
- WatchlistRepository → `t_watchlists` ✅
- RiskRulesRepository → `t_risk_rules` ✅
- MetricsRepository → `t_account_metrics` ✅

## Services BYPASSING Repositories (Direct Supabase Queries)

These services query Supabase directly using bare table names, bypassing the repository layer:

| Service | Tables Referenced | Impact |
|---------|-----------------|--------|
| accountService.js | accounts, positions, orders, trades | ❌ Will query wrong tables |
| sso.service.js | users, accounts | ❌ SSO login will fail |
| session.service.js | sessions | ❌ Session CRUD will fail |
| riskEngine.js | challenges (via accountRepo.db) | ❌ Challenge lookup will fail |
| dailyChecks.js | accounts | ❌ Cron will query wrong table |
| db/client.js | users (testConnection) | ⚠️ Health check may fail |
| db/setup.js | users, challenges, accounts | ⚠️ Setup seeds wrong tables |
| challenge.repository.js | accounts (cross-table lookup) | ❌ Wrong table |

## Verdict: C. Critical old-project dependencies remain

### Impact Assessment

If only `t_` prefixed tables exist in the database:
- ❌ **accountService.js** — getAccount, getPositions, getOrders, getTrades, placeOrder, modifyOrder, cancelOrder will ALL fail
- ❌ **sso.service.js** — SSO login from Dashboard will fail (cannot find user/account)
- ❌ **session.service.js** — Sessions cannot be created/revoked/validated
- ❌ **riskEngine.js** — Challenge lookup in postTradeCheck will fail
- ❌ **dailyChecks.js** — Daily cron will not find any accounts
- ⚠️ **db/client.js** — testConnection will report "users table not found"

### Required Fix

All direct `.from('bare_name')` calls must be changed to `.from('t_bare_name')` OR refactored to use the corresponding Repository class.
