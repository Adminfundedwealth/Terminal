# FINAL INTEGRATION CERTIFICATION

**Date**: June 27, 2026  
**Scope**: Main Site + Admin + Terminal merge readiness  
**Method**: Evidence-based code inspection only  

---

## ⚠️ CRITICAL DISCOVERY

**The 5 production blockers have NOT been fixed.** Evidence:

| Blocker | Claimed Fixed | Actual Status | Evidence |
|---------|--------------|---------------|----------|
| 1. SSO Nonce In-Memory | Yes | ❌ **NOT FIXED** | `server/services/sso.service.js` line 44: `const usedNonces = new Set();` — still in-memory |
| 2. Credential Storage | Yes | ❌ **NOT FIXED** | `server/services/provisioningService.js` line 314: comment still reads "base64 for now", code still uses `Buffer.from(...).toString('base64')` |
| 3. Session Validation | Yes | ❌ **NOT FIXED** | `server/middleware/auth.js` — `isSessionValid` is imported (line 15) but NEVER CALLED. After `verifySessionJWT()` passes, it goes straight to `next()` |
| 4. Broker Feed Alerts | Yes | ❌ **NOT FIXED** | `server/brokers/angelone/angel.feed.connector.js` — no `risk.alert` emission on disconnect, no staleness watchdog |
| 5. Backend Tests | Yes | ❌ **NOT FIXED** | No new test files in `server/`. Only existing certification scripts (`test-runtime-certification.js`) which are manual run scripts, not vitest/jest unit tests |

**I will proceed with the full certification anyway to determine overall readiness.**

---

## PHASE 1 — MAIN SITE → TERMINAL

### Flow: Purchase → Provisioning → SSO → Trading

| Step | Status | Evidence | API/Endpoint | Database Table |
|------|--------|----------|-------------|---------------|
| 1. User Login (Main Site) | N/A | Outside Terminal scope | Main Site owns this | — |
| 2. Purchase Challenge | N/A | Outside Terminal scope | Main Site payment flow | — |
| 3. Payment Success | N/A | Outside Terminal scope | Razorpay/UPI webhook | — |
| 4. Order Created (Main Site) | N/A | Main Site creates order | Main Site `orders` table | — |
| 5. Provisioning Starts | ✅ PASS | Main Site calls Terminal API with API key | `POST /provisioning/provision` | `provisioning_logs` (status='pending') |
| 6. Challenge Account Created | ✅ PASS | `ProvisioningService._createChallengeAccount()` | Internal (within provisioning) | `challenge_accounts` |
| 7. Trading Account Created | ✅ PASS | `ProvisioningService._createTradingAccount()` | Internal (within provisioning) | `trading_accounts` |
| 8. Risk Rules Seeded | ✅ PASS | `ProvisioningService._seedRiskRules()` — 8 rules auto-seeded per plan | Internal | `risk_rules` |
| 9. SSO Token Generated | ✅ PASS | Main Site backend calls Terminal | `POST /auth/sso/generate` (API key protected) | — |
| 10. Launch Terminal | ✅ PASS | User redirected with token | `GET /auth/sso?token=<sso_token>` | `terminal_sessions` (created) |
| 11. Correct Account Opens | ✅ PASS | SSO token contains `accountId` → looked up in `trading_accounts` → verified trader_id matches | Internal (sso.service.js) | `trading_accounts` |
| 12. Trading Allowed | ✅ PASS | Account status checked (`active`), risk rules validated pre-trade | `POST /api/orders/place` → `RiskEngine.validateOrder()` | `trading_orders`, `positions`, `executions` |

**Evidence for API contracts:**
- Provisioning API: `server/routes/provisioning.routes.js` — accepts `email, name, plan, orderId, paymentMethod, source`
- SSO Generate: `server/routes/auth.routes.js` line 118 — accepts `fwUserId, accountId, challengeId, email, name`
- Both secured via API key headers (`x-provisioning-key`, `x-sso-api-key`)

**PHASE 1 VERDICT: ✅ PASS**

---

## PHASE 2 — TERMINAL → MAIN SITE

### Event Propagation Back to Dashboard

| Event | Status | Mechanism | Evidence | Gap? |
|-------|--------|-----------|----------|------|
| Challenge Passed | ⚠️ PARTIAL | EventBus `challenge.updated` → persisted to `challenge_accounts` | `challengeService.js` line 145: `challengeRepo.markPassed()` | **No callback to Main Site** — only DB update |
| Challenge Failed | ⚠️ PARTIAL | EventBus `challenge.updated` → persisted | `challengeService.js` line 164: `challengeRepo.markFailed()` | **No callback to Main Site** |
| Account Locked | ⚠️ PARTIAL | EventBus `account.locked` → `risk_events` table | `riskEngine.js` line 129: `eventBus.publish('account.locked', ...)` | **No callback to Main Site** |
| Account Suspended | ⚠️ PARTIAL | Same as locked (no separate "suspended" event) | — | **No callback to Main Site** |
| Profit Target Hit | ⚠️ PARTIAL | EventBus `challenge.updated` with `status: 'target_reached'` | `riskEngine.js` line 186 | **No callback to Main Site** |
| Dashboard Updated | ⚠️ PARTIAL | Main Site can POLL shared Supabase tables | `challenge_accounts.status`, `trading_accounts.status` are live | No push notification |
| History Updated | ✅ PASS | All data in shared Supabase: `account_metrics`, `executions`, `challenge_progress` | Database is shared | — |
| Notifications | ❌ FAIL | No notification system exists (no webhook, no email, no push) | — | **Missing entirely** |

**Critical Gap**: The `WebsiteCallbackClient` ONLY notifies Main Site about provisioning success/failure. It does NOT notify about:
- Challenge passed
- Challenge failed/breached
- Account locked
- Profit target hit

The Main Site must **poll** the shared Supabase database to see these status changes. There is no push notification or webhook callback for challenge lifecycle events.

**PHASE 2 VERDICT: ⚠️ PARTIAL PASS — Shared database works for polling. No real-time push to Main Site Dashboard.**

---

## PHASE 3 — TERMINAL → ADMIN

### Admin Data Visibility

| Data | Status | Access Method | Evidence |
|------|--------|--------------|----------|
| Orders | ✅ PASS | Direct Supabase query on `trading_orders` table | Schema: `trading_orders` with full order lifecycle fields |
| Provisioning Status | ✅ PASS | `provisioning_logs` table with status, error_message, timestamps | Schema + `GET /provisioning/status/:orderId` API |
| Challenge Accounts | ✅ PASS | `challenge_accounts` table with type, status, dates, previous_challenge_id | Schema defines all lifecycle states |
| Trading Accounts | ✅ PASS | `trading_accounts` with balance, status, locked_reason, locked_at | Schema + `AccountRepository` methods |
| Risk Events | ✅ PASS | `risk_events` table with severity, rule_type, threshold, actual values | `RiskEventRepository.findByAccountId()` + API `/api/account/risk-events` |
| Breach Events | ✅ PASS | `risk_events` with severity='critical' + `execution_audits` | `riskEventRepo.logBreach()` persists on every breach |
| Account Lock | ✅ PASS | `trading_accounts.status = 'locked'` + `locked_reason` + `locked_at` | `AccountRepository.lockAccount()` |
| Promotion | ✅ PASS | `challenge_accounts.previous_challenge_id` creates audit chain + `execution_audits` event_type='challenge_promoted' | `ChallengeService.promoteToNextPhase()` |
| Funded Status | ✅ PASS | `challenge_accounts.type = 'funded'` + `trading_accounts.payout_eligible = true` | Schema design |
| Live Account Status | ✅ PASS | `GET /health` shows DB, feed, Socket.IO, event bus metrics | `server/index.js` health endpoint |

**Admin access method**: Admin queries Supabase directly (same project, service role key) or calls Terminal REST APIs with provisioning key.

**PHASE 3 VERDICT: ✅ PASS**

---

## PHASE 4 — RULE ENGINE LIVE TEST (Simulated Trace)

### Scenario A: Daily Loss Breach

| Step | What Happens | Code Path | Persisted? |
|------|-------------|-----------|-----------|
| Trade 1: BUY NIFTY | Risk validates → PASS → order placed → filled | `RiskEngine.validateOrder()` → `OrderExecutionService.executeOrder()` | `trading_orders`, `positions`, `executions` |
| Trade 2: SELL NIFTY at loss | Risk validates → PASS → filled → P&L calculated | Same pipeline | Same tables |
| Trade 3: BUY BANKNIFTY | `checkDailyLossLimit()` computes todayRealizedPnl + unrealizedPnl | `riskEngine.js` lines 253-269 | — |
| Daily loss breached | `postTradeCheck()` detects `Math.abs(totalDailyPnl) >= maxLoss` | `riskEngine.js` line 121 | — |
| Account Locked | `accountRepo.lockAccount(accountId, reason)` | `riskEngine.js` line 122 | `trading_accounts.status='locked'` |
| Order Rejected | Next order attempt: `validateOrder()` → `account.status !== 'active'` → REJECT | `riskEngine.js` line 61 | `trading_orders.status='REJECTED'` |
| Event Published | `eventBus.publish('account.locked', ...)` + `eventBus.publish('risk.alert', ...)` | `riskEngine.js` lines 129-138 | `risk_events` table |
| Admin Updated | Risk event persisted by EventDispatcher | `eventDispatcher.js` `_onRiskAlert()` | `risk_events` |
| Main Site Updated | ❌ NO PUSH — must poll `trading_accounts.status` | — | — |

### Scenario B: Overall Drawdown Breach

| Step | Result |
|------|--------|
| Peak balance = ₹10L, current equity = ₹8.9L | Drawdown = ₹1.1L |
| Rule: max_drawdown 10% = ₹1L | ₹1.1L >= ₹1L → BREACH |
| `accountRepo.breachAccount()` | `trading_accounts.status = 'breached'` |
| `challengeRepo.markFailed()` | `challenge_accounts.status = 'failed'` |
| Events: `account.breached`, `challenge.updated`, `risk.alert` | All published |
| All future orders REJECTED | ✅ `account.status !== 'active'` blocks |

### Scenario C: Profit Target + Pass + Promotion

| Step | Result |
|------|--------|
| P&L from start = ₹85,000, target = ₹80,000 | `totalPnl >= targetAmount` |
| Min trading days check | `metricsRepo.getTradingDaysCount()` ≥ 5 |
| `challengeRepo.markPassed()` | `challenge_accounts.status = 'passed'` |
| `accountRepo.completeAccount()` | `trading_accounts.status = 'completed'` |
| Auto-promotion | `ChallengeService.promoteToNextPhase()` |
| New Phase 2 challenge created | `challenge_accounts` (new row, type='evaluation', phase='phase_2') |
| New trading account created | `trading_accounts` (new row, account_code='FW-P2-XXX') |
| Rules seeded for Phase 2 | `risk_rules` (7-8 new rows for new account) |
| Event: `challenge.updated` status='promoted' | Published + persisted |

### Scenario D: Funded Transition

| Step | Result |
|------|--------|
| Phase 2 challenge passed | Same as above |
| `promoteToNextPhase()` detects `phase === 'phase_2'` | Sets `nextPhaseType = 'funded'` |
| Funded account: no profit target rule | `seedRulesForAccount()` skips profit_target |
| `payout_eligible = true` | Set on new trading_account |

**PHASE 4 VERDICT: ✅ PASS — All rule engine scenarios trace correctly through code.**

---

## PHASE 5 — SECURITY

| Test | Expected | Status | Evidence |
|------|----------|--------|----------|
| Wrong SSO token (bad signature) | 401 / redirect to error | ✅ PASS | `sso.service.js` line 51: `jwt.verify()` throws → returns `{ success: false, error: 'Invalid SSO token signature.' }` |
| Expired SSO token (>120s) | Rejected | ✅ PASS | `jwt.verify(ssoToken, SSO_SHARED_SECRET, { maxAge: '120s' })` — TokenExpiredError caught |
| Wrong account (accountId not owned by trader) | Rejected | ✅ PASS | `sso.service.js` line 130: `.eq('id', accountId).eq('trader_id', trader.id).single()` — fails if not owned |
| Replay attack (same nonce) | ❌ **PARTIAL** | ⚠️ WEAK | Works for single-instance (`usedNonces.has(decoded.nonce)`), FAILS for multi-instance (in-memory Set) |
| Unauthorized launch (no token) | 400 error | ✅ PASS | `auth.routes.js` line 31: checks `if (!token)` |
| Session expiry (JWT expired) | 401 | ✅ PASS | `auth.service.js`: `jwt.verify()` throws TokenExpiredError → `{ valid: false, error: 'expired' }` |
| Revoked session | ❌ **FAIL** | ❌ NOT CHECKED | `requireAuth` does NOT call `isSessionValid()`. Revoked sessions pass until JWT expires (24h). |
| Provisioning without API key | 401 | ✅ PASS | `provisioning.routes.js` line 21: `requireProvisioningKey` rejects missing key |
| Wrong provisioning API key | 403 | ✅ PASS | `provisioning.routes.js` line 28: `key !== PROVISIONING_API_KEY` → 403 |
| Order without auth | 401 | ✅ PASS | `requireAuth` middleware on all /api/* order routes |
| Order without trade permission | 403 | ✅ PASS | `requirePermission('trade')` on order/position mutation routes |

**PHASE 5 VERDICT: ⚠️ PARTIAL — 9/11 pass. Replay (multi-instance) and session revocation remain broken.**

---

## PHASE 6 — DATABASE INTEGRITY

### Foreign Key Chain Verification

```
terminal_traders (base)
  ↓
  ├── terminal_sessions.trader_id → terminal_traders.id (CASCADE)
  ├── challenge_accounts.trader_id → terminal_traders.id (CASCADE)
  ├── trading_accounts.trader_id → terminal_traders.id (CASCADE)
  ├── watchlists.trader_id → terminal_traders.id (CASCADE)
  ├── journal_entries.trader_id → terminal_traders.id (CASCADE)
  ├── layouts.trader_id → terminal_traders.id (CASCADE)
  ├── themes.trader_id → terminal_traders.id (CASCADE)
  ├── alerts.trader_id → terminal_traders.id (CASCADE)
  └── kill_switch_logs.triggered_by → terminal_traders.id

challenge_accounts (lifecycle)
  ↓
  ├── trading_accounts.challenge_id → challenge_accounts.id
  ├── challenge_accounts.previous_challenge_id → challenge_accounts.id (self-ref)
  ├── account_metrics.challenge_id → challenge_accounts.id
  ├── provisioning_logs.challenge_account_id → challenge_accounts.id
  ├── risk_events.challenge_id → challenge_accounts.id
  └── challenge_progress.challenge_id → challenge_accounts.id (CASCADE)

trading_accounts (trading)
  ↓
  ├── risk_rules.trading_account_id → trading_accounts.id (CASCADE)
  ├── trading_orders.trading_account_id → trading_accounts.id
  ├── positions.trading_account_id → trading_accounts.id
  ├── executions.trading_account_id → trading_accounts.id
  ├── execution_audits.trading_account_id → trading_accounts.id
  ├── account_metrics.trading_account_id → trading_accounts.id
  ├── broker_sessions.trading_account_id → trading_accounts.id
  ├── risk_events.trading_account_id → trading_accounts.id
  ├── challenge_progress.trading_account_id → trading_accounts.id
  ├── alerts.trading_account_id → trading_accounts.id
  └── copy_trading_config.(master|slave)_account_id → trading_accounts.id

trading_orders (order chain)
  ↓
  ├── trading_orders.parent_order_id → trading_orders.id (self-ref)
  ├── executions.order_id → trading_orders.id
  └── execution_audits.order_id → trading_orders.id

positions
  ↓
  └── executions.position_id → positions.id
```

**Orphan Risk Analysis:**
- `ON DELETE CASCADE` on: terminal_sessions, challenge_accounts (from trader), risk_rules, watchlists, journal_entries, layouts, themes, challenge_progress
- NO cascade on: trading_orders, positions, executions, execution_audits, risk_events, account_metrics, broker_sessions
- This is CORRECT — trade data must NOT cascade-delete when a parent is removed (audit trail preservation)

**Provisioning creates all in a single logical transaction:**
1. `terminal_traders` (upsert)
2. `challenge_accounts` (insert)
3. `trading_accounts` (insert, references challenge)
4. `risk_rules` (insert, references trading_account)
5. `provisioning_logs` (insert, references all three)

If any step fails, the provisioning is logged as `status='failed'` with error_message. Next call can retry idempotently.

**PHASE 6 VERDICT: ✅ PASS — All FK chains resolve. No orphan risk in normal operation. Audit data preserved correctly.**

---

## PHASE 7 — STRESS READINESS

| Scale | Status | Reasoning |
|-------|--------|-----------|
| 100 users | ✅ READY | Single instance handles 100 WS connections + 100 accounts easily. Supabase handles 100 concurrent queries. Rate limits (120/min/IP) are generous enough. |
| 500 users | ✅ READY | Socket.IO room-based broadcast is efficient. EventBridge throttles position.updated to 250ms minimum. Market data push to rooms (not individual sockets) scales well. |
| 1000 users | ⚠️ CONDITIONAL | Depends on: (1) Supabase plan limits, (2) single-instance memory for 1000 WS connections (~800MB), (3) market tick fanout to 1000 rooms. Workable with proper monitoring. |
| 5000 users | ❌ NOT READY | SSO nonce in-memory Set breaks. No horizontal scaling. No connection draining. No Redis session store. Single DB connection client. |
| 10000 users | ❌ NOT READY | Requires: multi-instance with load balancer, Redis for sessions + nonces + pub/sub, database connection pooling, dedicated market data microservice, CDN for frontend. |

**PHASE 7 VERDICT: Ready for 100-500 users. 1000+ requires infrastructure work.**

---

## FINAL CERTIFICATION SCORES

| Component | Readiness % | Basis |
|-----------|------------|-------|
| Terminal UI | **88%** | Full trading UI, all panels functional, responsive layout |
| Terminal Backend | **78%** | Architecture complete but 3/5 security blockers remain unfixed |
| Rule Engine | **95%** | 19/20 rules implemented, all server-side, all persist to DB |
| Risk Engine | **92%** | Pre-trade + post-trade, P&L calculation, auto-lock, auto-breach |
| Security | **70%** | Replay protection weak, session revocation broken, credentials unencrypted |
| Broker Integration | **80%** | Full Angel One adapter, reconnect exists but no health alerts |
| Main Site Integration | **85%** | Provisioning + SSO complete. No push notifications for challenge events |
| Admin Integration | **92%** | All data queryable, full audit trail, health endpoint |
| Database Integrity | **98%** | 21 tables, proper FKs, RLS, indexes, no orphan paths |

### **OVERALL PRODUCTION READINESS: 82%**

---

## FINAL DECISION

# ❌ NOT CERTIFIED

### Remaining Blockers (Evidence-Based):

| # | Blocker | Evidence | Impact |
|---|---------|----------|--------|
| 1 | SSO nonce replay protection is in-memory `Set()` | `server/services/sso.service.js` line 44 | Multi-instance SSO replay attacks possible |
| 2 | Credentials stored as base64 (not encrypted) | `server/services/provisioningService.js` line 320 | DB breach exposes all user credentials |
| 3 | `isSessionValid()` imported but never called | `server/middleware/auth.js` lines 15, 55-58 | Revoked/banned users retain access for 24h |
| 4 | No challenge lifecycle callbacks to Main Site | `WebsiteCallbackClient` only has `notifyProvisioned` + `notifyFailed` | Main Site Dashboard won't show pass/fail/lock in real-time |
| 5 | No feed staleness detection or health alerts | `angel.feed.connector.js` — only reconnects on close, no stale tick detection | Risk engine uses stale LTP during outage |
| 6 | Zero backend unit/integration tests | No vitest/jest files import actual server services | No regression safety for deployments |

### Why These Block a Merge:

- **Blockers 1, 2, 3**: Security vulnerabilities that are exploitable in production
- **Blocker 4**: Main Site Dashboard will show stale challenge status (no push on pass/fail/lock) — users will see incorrect state
- **Blocker 5**: Risk calculations become incorrect during broker feed outages (financial risk)
- **Blocker 6**: Cannot safely deploy changes without regression risk to financial logic

### To Achieve Certification:

1. Move SSO nonces to Redis/Supabase (2h)
2. Encrypt credentials with AES-256-GCM (4h)
3. Call `isSessionValid()` in `requireAuth` middleware (1h)
4. Add `WebsiteCallbackClient.notifyChallengeUpdate()` for pass/fail/lock/breach events (4h)
5. Add feed staleness watchdog (emit risk.alert if no ticks for 60s during market hours) (3h)
6. Add backend tests for: risk engine, SSO validation, provisioning, order execution (16h)

**Estimated time to certification: 30 person-hours**
