# Repository Table Name Mappings

**Date:** 2026-06-20  
**Purpose:** Map old table names to new terminal-prefixed table names in repository constructors.

---

## Required Changes

| File | Current Table Name | New Table Name | Line to Change |
|---|---|---|---|
| `server/repositories/user.repository.js` | `'users'` | `'terminal_users'` | `super('users')` → `super('terminal_users')` |
| `server/repositories/account.repository.js` | `'trading_accounts'` | `'terminal_accounts'` | `super('trading_accounts')` → `super('terminal_accounts')` |
| `server/repositories/challenge.repository.js` | `'challenge_accounts'` | `'challenges'` | `super('challenge_accounts')` → `super('challenges')` |
| `server/repositories/risk-rules.repository.js` | `'challenge_rules'` | `'risk_rules'` | `super('challenge_rules')` → `super('risk_rules')` |
| `server/repositories/order.repository.js` | `'trading_orders'` | `'terminal_orders'` | `super('trading_orders')` → `super('terminal_orders')` |
| `server/repositories/position.repository.js` | `'positions'` | `'terminal_positions'` | `super('positions')` → `super('terminal_positions')` |
| `server/repositories/trade.repository.js` | `'executions'` | `'terminal_trades'` | `super('executions')` → `super('terminal_trades')` |
| `server/repositories/watchlist.repository.js` | `'watchlists'` | `'watchlists'` | ✓ No change needed |
| `server/repositories/metrics.repository.js` | `'account_metrics'` | `'account_metrics'` | ✓ No change needed |
| `server/repositories/audit.repository.js` | `'audit_log'` | `'audit_log'` | ✓ No change needed |
| `server/repositories/risk-event.repository.js` | `'risk_events'` | `'risk_events'` | ✓ No change needed |
| `server/repositories/challenge-metrics.repository.js` | `'challenge_metrics'` | `'challenge_metrics'` | ✓ No change needed |
| `server/repositories/order-audit.repository.js` | `'order_audit'` | `'order_audit'` | ✓ No change needed |
| `server/repositories/broker-session.repository.js` | `'broker_sessions'` | `'broker_sessions'` | ✓ No change needed |

---

## Service-Level Direct `.from()` Changes

| File | Old Reference | New Reference |
|---|---|---|
| `server/services/sso.service.js` | `.from('users')` | `.from('terminal_users')` |
| `server/services/sso.service.js` | `.from('trading_accounts')` | `.from('terminal_accounts')` |
| `server/services/session.service.js` | `.from('sessions')` (×4) | `.from('terminal_sessions')` |
| `server/services/riskEngine.js` | `.from('challenge_accounts')` | `.from('challenges')` |
| `server/services/payoutService.js` | `.from('audit_logs')` | `.from('audit_log')` ← BUG FIX |
| `server/services/orderExecutionService.js` | `.from('positions')` | `.from('terminal_positions')` |
| `server/services/orderExecutionService.js` | `.from('trading_orders')` (×2) | `.from('terminal_orders')` |
| `server/services/orderExecutionService.js` | `.from('trading_accounts')` | `.from('terminal_accounts')` |
| `server/services/accountService.js` | `.from('challenge_rules')` | `.from('risk_rules')` |
| `server/services/accountService.js` | `.from('trading_accounts')` | `.from('terminal_accounts')` |
| `server/services/accountService.js` | `.from('positions')` | `.from('terminal_positions')` |
| `server/services/accountService.js` | `.from('trading_orders')` (×3) | `.from('terminal_orders')` |
| `server/services/accountService.js` | `.from('executions')` | `.from('terminal_trades')` |
| `server/cron/dailyChecks.js` | `.from('trading_accounts')` (×2) | `.from('terminal_accounts')` |

---

## Also In challenge.repository.js

| Location | Old | New |
|---|---|---|
| `findByAccountId()` method | `.from('trading_accounts')` | `.from('terminal_accounts')` |
| `getWithChallenge()` in account.repository.js | `challenge:challenge_accounts(*)` | `challenge:challenges(*)` |

---

## Summary

- **7 repositories** need `super()` table name change
- **6 services** need `.from()` table name changes
- **1 cron job** needs `.from()` table name change
- **1 bug fix**: `audit_logs` → `audit_log` (singular) in payoutService.js
- **Total changes**: ~25 string replacements across 14 files
