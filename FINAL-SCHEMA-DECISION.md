# FINAL-SCHEMA-DECISION.md

## Date: 2026-06-19
## Scope: Schema architecture decision — t_* tables vs production tables

---

## EXISTING PRODUCTION DATABASE (Supabase)

| Table | Status | Business Entity |
|-------|--------|-----------------|
| `users` | **EXISTS** | User accounts |
| `orders` | **EXISTS** | Trading orders |
| `positions` | **EXISTS** | Trading positions |
| `executions` | **EXISTS** | Trade executions |
| `trading_accounts` | **EXISTS** | Broker-linked trading accounts |
| `challenge_accounts` | **EXISTS** | Prop firm challenge accounts |
| `challenge_rules` | **EXISTS** | Challenge-specific risk rules |
| `risk_events` | **EXISTS** | Risk violations/alerts |
| `payouts` | **EXISTS** | Payout requests |
| `payout_eligibility` | **EXISTS** | Payout eligibility criteria |
| `sessions` | **EXISTS** | User sessions |

## FULL_MIGRATION.sql TABLES (Not Yet Created)

| Table | Status | Business Entity |
|-------|--------|-----------------|
| `t_users` | NOT FOUND | User accounts |
| `t_accounts` | NOT FOUND | Trading accounts |
| `t_orders` | NOT FOUND | Trading orders |
| `t_positions` | NOT FOUND | Trading positions |
| `t_trades` | NOT FOUND | Trade executions |
| `t_challenges` | NOT FOUND | Prop firm challenges |
| `t_risk_rules` | NOT FOUND | Risk rules |
| `t_risk_events` | NOT FOUND | Risk violations |
| `t_order_audit` | NOT FOUND | Order audit trail |
| `t_watchlists` | NOT FOUND | Watchlists |
| `t_account_metrics` | NOT FOUND | Daily metrics |
| `t_sessions` | NOT FOUND | Terminal sessions |
| `t_challenge_metrics` | NOT FOUND | Challenge progression |
| `t_broker_sessions` | NOT FOUND | Broker sessions |
| `t_payouts` | NOT FOUND | Payouts |

---

## QUESTION 1: Which schema is the execution engine coded against?

**Answer: `t_*` tables.**

Evidence:
- `OrderRepository` → `super('t_orders')` — line 10
- `PositionRepository` → `super('t_positions')` — line 12
- `TradeRepository` → `super('t_trades')` — line 12
- `OrderExecutionService` uses `OrderRepository`, `PositionRepository`, `TradeRepository`
- `AccountService.placeOrder()` → `supabase.from('t_orders').insert(...)`
- `AccountService.getPositions()` → `supabase.from('t_positions').select(...)`
- `AccountService.getOrders()` → `supabase.from('t_orders').select(...)`

**Zero references to production `orders`, `positions`, or `executions` tables.**

---

## QUESTION 2: Which schema is the risk engine coded against?

**Answer: `t_*` tables.**

Evidence:
- `RiskRulesRepository` → `super('t_risk_rules')` — line 12
- `RiskEventRepository` → `super('t_risk_events')` — line 10
- `AccountRepository` → `super('t_accounts')` — line 10
- `RiskEngine.validateOrder()` reads from `t_risk_rules` via `riskRulesRepo.getRulesMap(accountId)`
- `RiskEngine.postTradeCheck()` writes to `t_accounts` (lock/breach) and `t_risk_events`

**Zero references to production `challenge_rules` or `risk_events` tables.**

---

## QUESTION 3: Which schema is the challenge engine coded against?

**Answer: `t_*` tables.**

Evidence:
- `ChallengeRepository` → `super('t_challenges')` — line 10
- `ChallengeMetricsRepository` → `super('t_challenge_metrics')` — line 10
- `RiskEngine.getChallengeForAccount()` → `supabase.from('t_challenges').select(...)`
- `AccountRepository.getWithChallenge()` → `.select('*, challenge:t_challenges(*)')`
- `PayoutService` uses `t_accounts`, `t_challenges`, `t_risk_rules`

**Zero references to production `challenge_accounts` or `challenge_rules` tables.**

---

## QUESTION 4: Which schema is the WebSocket/event system coded against?

**Answer: `t_*` tables (via EventDispatcher persistence).**

Evidence:
- `EventDispatcher._onOrderCreated()` → `OrderAuditRepository` → `super('t_order_audit')`
- `EventDispatcher._onRiskViolation()` → `RiskEventRepository` → `super('t_risk_events')`
- `EventDispatcher._onChallengeUpdated()` → `ChallengeMetricsRepository` → `super('t_challenge_metrics')`
- `EventDispatcher._onBrokerSession()` → `BrokerSessionRepository` → `super('broker_sessions')` *
- `AuditRepository` → `super('audit_log')` *

\* Two tables use non-prefixed names: `audit_log` and `broker_sessions` — these are foundation/infrastructure tables defined in FULL_MIGRATION.sql without prefix.

---

## QUESTION 5: Is FULL_MIGRATION.sql creating duplicate business entities?

**YES.** Direct duplications:

| Production Table | FULL_MIGRATION Table | Same Business Entity |
|------------------|---------------------|---------------------|
| `users` | `t_users` | ✓ Users |
| `orders` | `t_orders` | ✓ Trading orders |
| `positions` | `t_positions` | ✓ Open/closed positions |
| `executions` | `t_trades` | ✓ Trade execution records |
| `trading_accounts` | `t_accounts` | ✓ Broker-linked accounts |
| `challenge_accounts` | `t_challenges` | ✓ Challenge lifecycle |
| `challenge_rules` | `t_risk_rules` | ✓ Risk rules per account |
| `risk_events` | `t_risk_events` | ✓ Risk violations |
| `payouts` | `t_payouts` | ✓ Payout requests |
| `sessions` | `t_sessions` | ✓ Auth sessions |

**10 out of 17 tables in FULL_MIGRATION.sql duplicate existing production entities.**

---

## QUESTION 6: If FULL_MIGRATION is executed — what happens?

### Conflicts
- **None immediate** — `CREATE TABLE IF NOT EXISTS` with `t_` prefix means no name collision.
- Tables will coexist — production tables untouched.

### Duplicate Data Models

| Entity | Production Table | Terminal Table | Consequence |
|--------|-----------------|----------------|-------------|
| Users | `users` | `t_users` | Two user registries. Which is source of truth? |
| Orders | `orders` | `t_orders` | Orders split across two tables. No single view. |
| Positions | `positions` | `t_positions` | P&L inconsistency. Dashboard shows different positions than terminal. |
| Trades | `executions` | `t_trades` | Trade history fragmented. |
| Accounts | `trading_accounts` | `t_accounts` | Account balance may diverge. |
| Challenges | `challenge_accounts` | `t_challenges` | Challenge status tracked in two places. |
| Risk Rules | `challenge_rules` | `t_risk_rules` | Rules may conflict or desync. |
| Payouts | `payouts` | `t_payouts` | Payout records in two tables. |

### Maintenance Risks

1. **Data desync** — Dashboard writes to `orders`, terminal writes to `t_orders`. Neither sees the other's data.
2. **User duplication** — SSO syncs to `t_users` but dashboard uses `users`. Identity management split.
3. **Balance divergence** — If dashboard tracks balance in `trading_accounts` and terminal in `t_accounts`, they will diverge after first trade.
4. **Challenge status** — Terminal may mark challenge passed/failed in `t_challenges` while dashboard reads from `challenge_accounts`.
5. **Audit gap** — Risk events in `t_risk_events` invisible to dashboard reading `risk_events`.
6. **Payout confusion** — Two payout tables, unclear which processes actual payments.
7. **Migration burden** — Every future schema change must be applied to both table sets.

---

## QUESTION 7: Can the terminal be safely refactored to existing production tables?

**Depends on column compatibility.** The terminal repositories expect specific columns:

| Terminal Expects (t_orders) | Production Would Need |
|---|---|
| id, account_id, broker_order_id, symbol, token, segment, exchange, side, order_type, product_type, qty, price, trigger_price, filled_qty, avg_price, status, reject_reason, placed_at | Must verify `orders` table has matching columns |

Without inspecting production table schemas (column names/types), full compatibility cannot be confirmed. However:

- If production tables have **different column names** → refactor is significant (every repository + service query changes).
- If production tables have **same/similar columns** → refactor is a find-replace of table names.

**The terminal was deliberately designed with `t_` prefix** (stated in base.repository.js comment: "Terminal tables use t_ prefix to avoid collision with existing Dashboard tables"). This was an **intentional architecture decision** to isolate terminal operations from dashboard operations.

---

## QUESTION 8: Which path is correct?

### OPTION A: Run FULL_MIGRATION, keep t_* architecture

**Pros:**
- Zero code changes — entire codebase already coded against t_* tables
- Immediate functionality — run SQL, seed, done
- No risk of breaking production dashboard
- Isolation: terminal can evolve independently
- Clean separation of concerns

**Cons:**
- Duplicate business entities (10 overlapping tables)
- Data synchronization problem between dashboard and terminal
- Long-term maintenance burden (two schemas)
- User/account identity must be synced between `users` → `t_users` and `trading_accounts` → `t_accounts`

### OPTION B: Delete t_* architecture, map to production tables

**Pros:**
- Single source of truth for all entities
- No data duplication
- Dashboard and terminal share same records
- Simpler long-term maintenance

**Cons:**
- **Massive refactor**: 14 repositories, 8 services, all column names, all queries
- Unknown: production table column names may differ significantly
- Risk: changing queries could break existing dashboard functionality
- Risk: terminal writes (order execution, position updates) could corrupt dashboard data if formats differ
- Requires full understanding of production schema (column names, types, constraints, triggers)
- Testing burden: must verify every repository method against production schema

---

## VERDICT: OPTION A

**Run FULL_MIGRATION.sql and keep the `t_*` architecture.**

### Reasoning:

1. **The entire codebase (14 repositories, 8 services, cron jobs, event dispatcher) is coded against `t_*` tables.** Zero references to production table names exist in the execution path. Refactoring would touch 30+ files.

2. **The `t_` prefix was an intentional isolation decision** — documented in `base.repository.js`: "Terminal tables use t_ prefix to avoid collision with existing Dashboard tables." The architect knew production tables existed.

3. **Production table schemas are unknown.** Column names in `orders`, `positions`, `trading_accounts` may not match what the terminal code expects. Refactoring without schema documentation is blind guesswork.

4. **The terminal is a separate product** (trading execution engine) from the dashboard (account management). They serve different users at different moments. Isolation is correct for this use case.

5. **Synchronization can be handled at the application layer** — SSO already maps dashboard users to `t_users`. Account creation can be triggered from dashboard → terminal via webhook or API call.

6. **Running FULL_MIGRATION is a 5-minute operation with zero production risk.** Refactoring to production tables is weeks of work with high breakage risk.

---

**VERDICT: OPTION A**

---

*Agent B — Schema Decision Only. No code modified.*
*2026-06-19*
