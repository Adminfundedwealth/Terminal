# REPOSITORY AUDIT — Phase C3

## Date: 2026-06-19

---

## BASE REPOSITORY

File: `server/repositories/base.repository.js`
- Extends: None (base class)
- DB Access: `supabase` singleton from `server/db/client.js`
- Methods: findById, findOne, findMany, insert, insertMany, update, updateWhere, delete, deleteWhere, count

---

## REPOSITORY TABLE MAP

| Repository | File | Table Name | Primary Key | Critical Queries |
|-----------|------|-----------|-------------|-----------------|
| AccountRepository | account.repository.js | `t_accounts` | UUID `id` | findById, updateBalance, lockAccount, breachAccount |
| OrderRepository | order.repository.js | `t_orders` | UUID `id` | createOrder, markFilled, markRejected, markCancelled, updateStatus |
| PositionRepository | position.repository.js | `t_positions` | UUID `id` | upsertPosition, findOpenPosition, closePosition, countOpenPositions |
| TradeRepository | trade.repository.js | `t_trades` | UUID `id` | recordTrade, findTodayTrades, countTodayTrades, getTodayRealizedPnl |
| RiskRulesRepository | risk-rules.repository.js | `t_risk_rules` | UUID `id` | getRulesMap, findByAccountId, upsertRule |
| OrderAuditRepository | order-audit.repository.js | `t_order_audit` | UUID `id` | logOrderCreated/Filled/Rejected/Cancelled, logPositionOpened/Closed |
| RiskEventRepository | risk-event.repository.js | `t_risk_events` | UUID `id` | logCheckPassed/Failed, logViolation, logAccountLocked |
| ChallengeMetricsRepository | challenge-metrics.repository.js | `t_challenge_metrics` | UUID `id` | logChallengeStarted/Passed/Failed, logBalanceSnapshot |
| BrokerSessionRepository | broker-session.repository.js | `t_broker_sessions` | UUID `id` | recordConnect/Disconnect/Expired/Failure |
| MetricsRepository | metrics.repository.js | `t_account_metrics` | UUID `id` | upsertDailyMetrics, getTradingDaysCount |
| AuditRepository | audit.repository.js | `audit_log` | UUID `id` | log (general audit) |
| UserRepository | user.repository.js | `t_users` | UUID `id` | findByFwUserId |
| ChallengeRepository | challenge.repository.js | `t_challenges` | UUID `id` | markPassed/Failed/Expired |
| WatchlistRepository | watchlist.repository.js | `t_watchlists` | UUID `id` | findByUserId, createWatchlist, updateItems |

---

## CRITICAL EXECUTION PATH REPOSITORIES

### OrderRepository.createOrder()
```js
INSERT INTO t_orders: {
  account_id, symbol, token, segment, exchange,
  side, order_type, product_type, qty, price,
  trigger_price, status: 'PENDING'
}
```

### OrderRepository.markFilled()
```js
UPDATE t_orders SET status='FILLED', filled_qty, avg_price, broker_order_id
WHERE id = orderId
```

### PositionRepository.upsertPosition()
```js
1. SELECT FROM t_positions WHERE account_id AND token AND product_type AND closed_at IS NULL
2. If exists: UPDATE qty, avg_price, realized_pnl
3. If not: INSERT { account_id, symbol, token, segment, exchange, product_type, qty, avg_price }
```

### TradeRepository.recordTrade()
```js
INSERT INTO t_trades: {
  account_id, order_id, symbol, token, segment,
  exchange, side, qty, price
}
```

### RiskRulesRepository.getRulesMap()
```js
SELECT * FROM t_risk_rules WHERE account_id = ? AND is_active = true
→ Returns object: { rule_type: value, ... }
```

---

## FK DEPENDENCY CHAIN

```
t_users
  └── t_challenges (user_id → t_users.id)
       └── t_accounts (challenge_id → t_challenges.id)
            ├── t_orders (account_id → t_accounts.id)
            │    └── t_order_audit (order_id → t_orders.id)
            │    └── t_trades (order_id → t_orders.id)
            ├── t_positions (account_id → t_accounts.id)
            ├── t_risk_rules (account_id → t_accounts.id)
            ├── t_risk_events (account_id → t_accounts.id)
            ├── t_account_metrics (account_id → t_accounts.id)
            ├── t_broker_sessions (account_id → t_accounts.id)
            └── t_challenge_metrics (account_id → t_accounts.id)
```

Tables MUST be created in FK order: users → challenges → accounts → (everything else).
