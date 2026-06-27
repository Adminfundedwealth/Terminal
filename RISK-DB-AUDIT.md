# RISK DB AUDIT — Agent D

**Date:** 2026-06-19  
**Scope:** Every table used by Risk/Challenge services

---

## TABLE USAGE MAP

| File | Repository | Table | Purpose |
|------|-----------|-------|---------|
| `riskEngine.js` | `RiskRulesRepository` | `t_risk_rules` | Per-account rule storage |
| `riskEngine.js` | `PositionRepository` | `t_positions` | Open positions count + unrealized P&L |
| `riskEngine.js` | `TradeRepository` | `t_trades` | Today's realized P&L (FIFO) |
| `riskEngine.js` | `AccountRepository` | `t_accounts` | Account balance, status, peak_balance |
| `riskEngine.js` | `MetricsRepository` | `t_account_metrics` | Daily snapshots |
| `riskEngine.js` | `AuditRepository` | `audit_log` | Immutable state change log |
| `challengeService.js` | `ChallengeRepository` | `t_challenges` | Challenge lifecycle |
| `challengeService.js` | `AccountRepository` | `t_accounts` | Account state transitions |
| `challengeService.js` | `RiskRulesRepository` | `t_risk_rules` | Rule lookups for targets/limits |
| `challengeService.js` | `MetricsRepository` | `t_account_metrics` | Trading days count |
| `challengeService.js` | `AuditRepository` | `audit_log` | Audit events |
| `payoutService.js` | `AccountRepository` | `t_accounts` | Balance + payout_eligible flag |
| `payoutService.js` | `ChallengeRepository` | `t_challenges` | Challenge type + initial_balance |
| `payoutService.js` | `RiskRulesRepository` | `t_risk_rules` | Min payout days rule |
| `payoutService.js` | `MetricsRepository` | `t_account_metrics` | Trading days count |
| `payoutService.js` | `RiskEventRepository` | `t_risk_events` | Unresolved violations check |
| `payoutService.js` | `AuditRepository` | `audit_log` | Payout request log |
| `challenge.repository.js` | — | `t_challenges` | Challenge CRUD |
| `challenge.repository.js` | — | `t_accounts` | Cross-query for challenge_id |
| `risk-rules.repository.js` | — | `t_risk_rules` | Rule CRUD |
| `risk-event.repository.js` | — | `t_risk_events` | Risk event audit trail |
| `challenge-metrics.repository.js` | — | `t_challenge_metrics` | Challenge progression events |
| `account.repository.js` | — | `t_accounts` | Account state + balance |
| `metrics.repository.js` | — | `t_account_metrics` | Daily balance snapshots |
| `audit.repository.js` | — | `audit_log` | General audit log (NO t_ prefix) |

---

## UNIQUE TABLES REQUIRED (Risk Domain)

| # | Table | Prefix | Created By | Repository |
|---|-------|--------|-----------|------------|
| 1 | `t_users` | t_ | 004_terminal_tables.sql | UserRepository |
| 2 | `t_accounts` | t_ | 004_terminal_tables.sql | AccountRepository |
| 3 | `t_challenges` | t_ | 004_terminal_tables.sql | ChallengeRepository |
| 4 | `t_risk_rules` | t_ | 004_terminal_tables.sql | RiskRulesRepository |
| 5 | `t_account_metrics` | t_ | 004_terminal_tables.sql | MetricsRepository |
| 6 | `t_risk_events` | t_ | 005_persistence_tables.sql | RiskEventRepository |
| 7 | `t_challenge_metrics` | t_ | 005_persistence_tables.sql | ChallengeMetricsRepository |
| 8 | `t_payouts` | t_ | 006_phase_progression.sql | — (PayoutService direct) |
| 9 | `audit_log` | NONE | 004_foundation_hardening.sql | AuditRepository |
| 10 | `t_trades` | t_ | 004_terminal_tables.sql | TradeRepository |
| 11 | `t_positions` | t_ | 004_terminal_tables.sql | PositionRepository |
| 12 | `t_orders` | t_ | 004_terminal_tables.sql | OrderRepository |

---

## NOTE

The `AuditRepository` uses `audit_log` (no `t_` prefix). All other repositories use `t_` prefixed tables.
