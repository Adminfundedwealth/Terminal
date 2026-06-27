# DATABASE TRUTH AUDIT — Phase C1

## Date: 2026-06-19

---

## COMPLETE TABLE DEPENDENCY MAP

### OrderExecutionService → Tables Used

| File | Repository | Table |
|------|-----------|-------|
| orderExecutionService.js | OrderRepository | `t_orders` |
| orderExecutionService.js | PositionRepository | `t_positions` |
| orderExecutionService.js | TradeRepository | `t_trades` |
| orderExecutionService.js | direct supabase | `t_positions` (findPosition) |
| orderExecutionService.js | direct supabase | `t_orders` (findOrder) |
| orderExecutionService.js | direct supabase | `t_accounts` (getAccount) |

### RiskEngine → Tables Used

| File | Repository | Table |
|------|-----------|-------|
| riskEngine.js | RiskRulesRepository | `t_risk_rules` |
| riskEngine.js | AccountRepository | `t_accounts` |
| riskEngine.js | PositionRepository | `t_positions` |
| riskEngine.js | TradeRepository | `t_trades` |
| riskEngine.js | MetricsRepository | `t_account_metrics` |
| riskEngine.js | AuditRepository | `audit_log` |
| riskEngine.js | direct query | `t_challenges` |

### EventDispatcher → Tables Used

| File | Repository | Table |
|------|-----------|-------|
| eventDispatcher.js | OrderAuditRepository | `t_order_audit` |
| eventDispatcher.js | RiskEventRepository | `t_risk_events` |
| eventDispatcher.js | ChallengeMetricsRepository | `t_challenge_metrics` |
| eventDispatcher.js | BrokerSessionRepository | `t_broker_sessions` |

### ChallengeService → Tables Used

| File | Repository | Table |
|------|-----------|-------|
| challengeService.js | ChallengeRepository | `t_challenges` |
| challengeService.js | AccountRepository | `t_accounts` |
| challengeService.js | RiskRulesRepository | `t_risk_rules` |
| challengeService.js | MetricsRepository | `t_account_metrics` |
| challengeService.js | AuditRepository | `audit_log` |

### AccountService → Tables Used

| File | Repository | Table |
|------|-----------|-------|
| accountService.js | direct supabase | `t_risk_rules` |
| accountService.js | direct supabase | `t_accounts` |
| accountService.js | direct supabase | `t_positions` |
| accountService.js | direct supabase | `t_orders` |
| accountService.js | direct supabase | `t_trades` |

---

## ALL TABLES REQUIRED (17 total)

| # | Table | Created By | Purpose |
|---|-------|-----------|---------|
| 1 | `t_users` | 004_terminal_tables.sql | User accounts |
| 2 | `t_challenges` | 004_terminal_tables.sql | Prop firm challenges |
| 3 | `t_accounts` | 004_terminal_tables.sql | Trading accounts |
| 4 | `t_risk_rules` | 004_terminal_tables.sql | Risk enforcement rules |
| 5 | `t_orders` | 004_terminal_tables.sql | Order records |
| 6 | `t_positions` | 004_terminal_tables.sql | Position tracking |
| 7 | `t_trades` | 004_terminal_tables.sql | Trade execution log |
| 8 | `t_watchlists` | 004_terminal_tables.sql | User watchlists |
| 9 | `t_account_metrics` | 004_terminal_tables.sql | Daily snapshots |
| 10 | `t_sessions` | 004_terminal_tables.sql | Auth sessions |
| 11 | `audit_log` | foundation hardening | General audit trail |
| 12 | `broker_sessions` | foundation hardening | Broker connections |
| 13 | `t_broker_sessions` | 005_persistence_tables.sql | Broker lifecycle events |
| 14 | `t_risk_events` | 005_persistence_tables.sql | Risk check audit |
| 15 | `t_challenge_metrics` | 005_persistence_tables.sql | Challenge progression |
| 16 | `t_order_audit` | 005_persistence_tables.sql | Order lifecycle audit |
| 17 | `t_payouts` | 006_phase_progression.sql | Payout tracking |

---

## CURRENT STATE: ALL 17 TABLES MISSING

Verified via `check-tables.js`:
```
MISSING  t_users
MISSING  t_challenges
MISSING  t_accounts
MISSING  t_risk_rules
MISSING  t_orders
MISSING  t_positions
MISSING  t_trades
MISSING  t_watchlists
MISSING  t_account_metrics
MISSING  t_sessions
MISSING  audit_log
MISSING  broker_sessions
MISSING  t_broker_sessions
MISSING  t_risk_events
MISSING  t_challenge_metrics
MISSING  t_order_audit
MISSING  t_payouts
```

---

## CRITICAL PATH — Tables Required for Order Execution

To execute a single BUY MARKET order, these tables MUST exist:

1. **`t_accounts`** — Account lookup (getAccount)
2. **`t_orders`** — Order INSERT + status UPDATE
3. **`t_risk_rules`** — Risk validation (can be empty but must exist)
4. **`t_positions`** — Position upsert on fill
5. **`t_trades`** — Trade record on fill
6. **`t_order_audit`** — Audit trail (EventDispatcher)

Dependencies (must exist due to FK constraints):
- `t_users` (referenced by t_accounts, t_challenges)
- `t_challenges` (referenced by t_accounts)
