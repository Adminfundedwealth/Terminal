# TERMINAL ISOLATION — EXECUTION PLAN

> Date: 2026-06-18  
> Status: PLANNING ONLY — No code modified  
> Purpose: Step-by-step plan to move terminal to its own Supabase project

---

## 1. Files Using Bare Table Names (Complete Inventory)

### 1.1 — `server/services/sso.service.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 80 | `.from('users')` | `.from('t_users')` |
| 101 | `.from('accounts')` | `.from('t_accounts')` |

**Context:** SSO validation looks up user by `fw_user_id` and account by `id`. These are the entry-point queries when a user first arrives from Dashboard.

---

### 1.2 — `server/services/session.service.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 28 | `.from('sessions')` | `.from('t_sessions')` |
| 56 | `.from('sessions')` | `.from('t_sessions')` |
| 73 | `.from('sessions')` | `.from('t_sessions')` |
| 92 | `.from('sessions')` | `.from('t_sessions')` |

**Context:** Session CRUD (create, revoke, revoke-all, validate). Four occurrences, all the same table.

---

### 1.3 — `server/services/accountService.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 43 | `.from('accounts')` | `.from('t_accounts')` |
| 55 | `.from('positions')` | `.from('t_positions')` |
| 79 | `.from('orders')` | `.from('t_orders')` |
| 95 | `.from('trades')` | `.from('t_trades')` |
| 128 | `.from('orders')` | `.from('t_orders')` |
| 175 | `.from('orders')` | `.from('t_orders')` |
| 207 | `.from('orders')` | `.from('t_orders')` |

**Context:** All portfolio/trading operations. 7 occurrences across 4 different tables.

---

### 1.4 — `server/services/riskEngine.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 335 | `.from('challenges')` | `.from('t_challenges')` |

**Context:** `getChallengeForAccount()` helper — fetches challenge record to check profit target. 1 occurrence.

---

### 1.5 — `server/cron/dailyChecks.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 33 | `.from('accounts')` | `.from('t_accounts')` |
| 72 | `.from('accounts')` | `.from('t_accounts')` |

**Context:** Daily cron fetches active/locked accounts for morning unlock and EOD metrics. 2 occurrences.

---

### 1.6 — `server/db/client.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 38 | `.from('users')` | `.from('t_users')` |

**Context:** Health check — verifies Supabase connectivity by querying users table. 1 occurrence.

---

### 1.7 — `server/repositories/challenge.repository.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 33 | `.from('accounts')` | `.from('t_accounts')` |

**Context:** `findByAccountId()` — cross-references accounts table to get `challenge_id`. 1 occurrence. Note: the repository's own table is correctly `t_challenges`, but this internal cross-query uses a bare name.

---

### 1.8 — `server/repositories/broker-session.repository.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 13 | `super('broker_sessions')` | `super('t_broker_sessions')` |

**Context:** Repository constructor. Should point to `t_broker_sessions` (created in migration 005).

---

### 1.9 — `server/repositories/audit.repository.js`

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 14 | `super('audit_log')` | See note below |

**Context:** Points to `audit_log` table which does NOT exist in any migration. This is either dead code or relies on a table that was never created.

**Decision needed:** Either create `t_audit_log` table in schema, or refactor this repository to write to `t_risk_events` or `t_order_audit` instead.

---

### 1.10 — `server/db/setup.js` (Development script)

| Line | Current Code | Required Change |
|------|-------------|-----------------|
| 72 | `.from('users')` | `.from('t_users')` |
| 82 | `.from('users')` | `.from('t_users')` |
| 87 | `.from('accounts')` | `.from('t_accounts')` |
| 92 | `.from('risk_rules')` | `.from('t_risk_rules')` |
| 97 | `.from('watchlists')` | `.from('t_watchlists')` |
| 108 | `.from('users')` | `.from('t_users')` |
| 121 | `.from('challenges')` | `.from('t_challenges')` |
| 137 | `.from('accounts')` | `.from('t_accounts')` |
| 166 | `.from('risk_rules')` | `.from('t_risk_rules')` |
| 204 | `.from('watchlists')` | `.from('t_watchlists')` |

**Context:** Dev seed script. 10 occurrences. Non-critical for production but must be fixed for the script to work against isolated project.

---

## 2. Summary of All Required Changes

| # | File | Bare Refs | Tables Affected |
|---|------|-----------|-----------------|
| 1 | `server/services/sso.service.js` | 2 | users, accounts |
| 2 | `server/services/session.service.js` | 4 | sessions |
| 3 | `server/services/accountService.js` | 7 | accounts, positions, orders, trades |
| 4 | `server/services/riskEngine.js` | 1 | challenges |
| 5 | `server/cron/dailyChecks.js` | 2 | accounts |
| 6 | `server/db/client.js` | 1 | users |
| 7 | `server/repositories/challenge.repository.js` | 1 | accounts |
| 8 | `server/repositories/broker-session.repository.js` | 1 | broker_sessions |
| 9 | `server/repositories/audit.repository.js` | 1 | audit_log (MISSING TABLE) |
| 10 | `server/db/setup.js` | 10 | users, accounts, challenges, risk_rules, watchlists |

**Total bare references: 30**  
**Unique tables affected: 9** (users, accounts, sessions, positions, orders, trades, challenges, risk_rules, watchlists)

---

## 3. Repository Table Verification

### Correctly Using `t_` Prefix (12 of 14)

| Repository | Constructor Table | Status |
|-----------|------------------|--------|
| `user.repository.js` | `t_users` | ✅ CORRECT |
| `account.repository.js` | `t_accounts` | ✅ CORRECT |
| `challenge.repository.js` | `t_challenges` | ⚠️ Constructor OK, but has 1 internal bare query |
| `order.repository.js` | `t_orders` | ✅ CORRECT |
| `position.repository.js` | `t_positions` | ✅ CORRECT |
| `trade.repository.js` | `t_trades` | ✅ CORRECT |
| `watchlist.repository.js` | `t_watchlists` | ✅ CORRECT |
| `risk-rules.repository.js` | `t_risk_rules` | ✅ CORRECT |
| `metrics.repository.js` | `t_account_metrics` | ✅ CORRECT |
| `risk-event.repository.js` | `t_risk_events` | ✅ CORRECT |
| `challenge-metrics.repository.js` | `t_challenge_metrics` | ✅ CORRECT |
| `order-audit.repository.js` | `t_order_audit` | ✅ CORRECT |

### INCORRECT (2 of 14)

| Repository | Constructor Table | Should Be | Status |
|-----------|------------------|-----------|--------|
| `broker-session.repository.js` | `broker_sessions` | `t_broker_sessions` | ❌ WRONG |
| `audit.repository.js` | `audit_log` | TBD (table doesn't exist) | ❌ ORPHANED |

---

## 4. Step-by-Step Migration Sequence

### PHASE 1: Preparation (Zero downtime)

```
Step 1.1  Create new Supabase project
          - Go to supabase.com → New Project
          - Region: same as current (ap-south-1 recommended for India)
          - Note: URL and service role key

Step 1.2  Run migrations on new project
          - Open SQL Editor in new project
          - Execute: server/db/migrations/004_terminal_tables.sql
          - Execute: server/db/migrations/005_persistence_tables.sql
          - Verify: 14 tables created (t_users through t_order_audit)

Step 1.3  Create audit_log table (or decide to remove)
          OPTION A: Add to new project:
            CREATE TABLE IF NOT EXISTS t_audit_log (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              account_id UUID REFERENCES t_accounts(id),
              user_id UUID REFERENCES t_users(id),
              event_type TEXT NOT NULL,
              event_data JSONB DEFAULT '{}',
              created_at TIMESTAMPTZ DEFAULT NOW()
            );
          OPTION B: Remove audit.repository.js usage (refactor to t_risk_events)

Step 1.4  Verify new project tables
          - Run: SELECT tablename FROM pg_tables WHERE schemaname = 'public';
          - Confirm all 14 (or 15 with audit_log) tables present
```

### PHASE 2: Code Fix (Zero downtime — done before deployment)

```
Step 2.1  Fix server/services/sso.service.js
          Line 80:  .from('users')     → .from('t_users')
          Line 101: .from('accounts')  → .from('t_accounts')

Step 2.2  Fix server/services/session.service.js
          Line 28:  .from('sessions')  → .from('t_sessions')
          Line 56:  .from('sessions')  → .from('t_sessions')
          Line 73:  .from('sessions')  → .from('t_sessions')
          Line 92:  .from('sessions')  → .from('t_sessions')

Step 2.3  Fix server/services/accountService.js
          Line 43:  .from('accounts')  → .from('t_accounts')
          Line 55:  .from('positions') → .from('t_positions')
          Line 79:  .from('orders')    → .from('t_orders')
          Line 95:  .from('trades')    → .from('t_trades')
          Line 128: .from('orders')    → .from('t_orders')
          Line 175: .from('orders')    → .from('t_orders')
          Line 207: .from('orders')    → .from('t_orders')

Step 2.4  Fix server/services/riskEngine.js
          Line 335: .from('challenges') → .from('t_challenges')

Step 2.5  Fix server/cron/dailyChecks.js
          Line 33:  .from('accounts')  → .from('t_accounts')
          Line 72:  .from('accounts')  → .from('t_accounts')

Step 2.6  Fix server/db/client.js
          Line 38:  .from('users')     → .from('t_users')

Step 2.7  Fix server/repositories/challenge.repository.js
          Line 33:  .from('accounts')  → .from('t_accounts')

Step 2.8  Fix server/repositories/broker-session.repository.js
          Line 13:  super('broker_sessions') → super('t_broker_sessions')

Step 2.9  Fix server/repositories/audit.repository.js
          Line 14:  super('audit_log') → super('t_audit_log')
          (Only if Step 1.3 Option A was chosen)

Step 2.10 Fix server/db/setup.js (all 10 bare references → t_ prefix)
```

### PHASE 3: Local Testing (Zero downtime)

```
Step 3.1  Set local .env to new Supabase credentials:
          SUPABASE_URL=https://NEW-PROJECT.supabase.co
          SUPABASE_SERVICE_KEY=eyJ...new-service-key...

Step 3.2  Run: node server/db/setup.js
          - Should seed t_users, t_challenges, t_accounts, etc.
          - Verify: "All tables verified" + "Setup Complete"

Step 3.3  Start server: node server/index.js
          - Verify: health endpoint returns database.connected = true
          - Verify: no "table not found" errors in logs

Step 3.4  Test SSO flow:
          - GET /auth/dev/generate-sso → get test token
          - GET /auth/sso?token=<token> → should set cookie + redirect
          - GET /auth/verify → should return valid: true

Step 3.5  Test trading flow:
          - GET /api/positions → should return [] (empty)
          - GET /api/orders → should return []
          - POST /api/orders/place → should insert into t_orders

Step 3.6  Test cron:
          - Import and call runDailyChecks() manually
          - Verify it queries t_accounts without error
```

### PHASE 4: Data Migration (Optional — only if preserving history)

```
Step 4.1  Export from OLD Supabase project:
          pg_dump --data-only --table='t_users' --table='t_challenges' \
            --table='t_accounts' --table='t_risk_rules' --table='t_orders' \
            --table='t_positions' --table='t_trades' --table='t_watchlists' \
            --table='t_account_metrics' --table='t_sessions' \
            --table='t_broker_sessions' --table='t_risk_events' \
            --table='t_challenge_metrics' --table='t_order_audit' \
            postgres://OLD_CONNECTION_STRING > terminal_data.sql

Step 4.2  Import into NEW Supabase project:
          psql postgres://NEW_CONNECTION_STRING < terminal_data.sql

Step 4.3  Verify row counts match between old and new

Step 4.4  Verify FK integrity:
          SELECT count(*) FROM t_accounts WHERE user_id NOT IN (SELECT id FROM t_users);
          -- Should return 0 for all FK relationships
```

### PHASE 5: Production Cutover (~2-5 minutes downtime)

```
Step 5.1  Set maintenance mode (optional — display "upgrading" page)

Step 5.2  Update production environment variables:
          SUPABASE_URL=https://NEW-PROJECT.supabase.co
          SUPABASE_SERVICE_KEY=eyJ...new-service-key...

Step 5.3  Deploy code changes (Steps 2.1 through 2.10)

Step 5.4  Verify deployment:
          - GET /health → database.connected: true
          - GET /auth/verify → works for existing sessions (or requires re-login)
          - Check logs for any table-not-found errors

Step 5.5  Remove maintenance mode

Step 5.6  Monitor for 30 minutes:
          - Watch for 500 errors
          - Verify market data feed is unaffected
          - Test one full SSO login cycle
```

---

## 5. Rollback Sequence

### If Cutover Fails (any step in Phase 5)

```
ROLLBACK Step 1  Revert environment variables to OLD project:
                 SUPABASE_URL=https://OLD-PROJECT.supabase.co
                 SUPABASE_SERVICE_KEY=eyJ...old-service-key...

ROLLBACK Step 2  Revert code to previous version (git revert or redeploy previous commit)
                 - This restores bare table names which work on old shared project

ROLLBACK Step 3  Redeploy
                 - Terminal is immediately back on shared project
                 - All data intact (old project was never modified)

ROLLBACK Step 4  Verify:
                 - GET /health → connected: true
                 - Test SSO flow
                 - Confirm orders/positions accessible
```

**Rollback time: ~2-3 minutes** (env var change + redeploy)  
**Data loss: ZERO** — old project was read-only during migration

### If Data Migration Was Done (Phase 4) and Needs Rollback

- New project data can be discarded (delete project or leave idle)
- Old project still has original `t_` tables with all data
- No action needed — simply point back to old project

### Point of No Return

There is NO point of no return in this migration. You can rollback at any time because:
1. Old Supabase project is never deleted or modified
2. Code change is a simple find/replace (reversible via git)
3. Broker connections are independent of database
4. Redis sessions auto-expire (users re-login naturally)

---

## 6. Downtime Estimate

| Phase | Duration | Downtime? |
|-------|----------|-----------|
| Phase 1: Create new project + run migrations | 30 min | NO |
| Phase 2: Code fixes (30 string replacements) | 45 min | NO |
| Phase 3: Local testing | 1-2 hours | NO |
| Phase 4: Data migration (optional) | 30-60 min | NO |
| **Phase 5: Production cutover** | **2-5 min** | **YES** |
| Post-cutover monitoring | 30 min | NO |

### Total Downtime: 2-5 minutes

This is the time between:
- Deploying new code with `t_` table names
- And the server being healthy on the new Supabase project

### What Happens During Downtime

| Component | Impact |
|-----------|--------|
| Market data feed | **UNAFFECTED** — Angel One WebSocket is independent |
| Socket.IO connections | Clients reconnect automatically (< 5s) |
| REST API | Returns 503 for ~2-5 minutes during restart |
| Existing sessions | **INVALIDATED** — users must re-login via SSO |
| Active orders on broker | **UNAFFECTED** — orders live on Angel One, not in our DB |
| Positions at broker | **UNAFFECTED** — positions are tracked at broker level |

### Session Impact

All terminal sessions (`fw_session` cookies) will be invalidated because:
- Session records exist in OLD project's `sessions` / `t_sessions` table
- New project has empty `t_sessions` table
- Users will need to click "Open Terminal" from Dashboard again

**This is acceptable** — sessions are short-lived (24h) and SSO re-login takes < 3 seconds.

---

## 7. Go/No-Go Recommendation

### ✅ GO — Proceed with Isolation

**Rationale:**

| Factor | Assessment |
|--------|-----------|
| Architecture readiness | HIGH — t_ prefix design was explicitly built for this |
| Code change scope | LOW — 30 string replacements, no logic changes |
| Risk of data loss | ZERO — old project untouched |
| Rollback capability | INSTANT — revert env vars + redeploy |
| Downtime | MINIMAL — 2-5 minutes |
| Ongoing benefit | HIGH — clean separation, independent scaling, no Dashboard collision risk |
| Effort | LOW — 4-6 hours total (including testing) |

### Pre-Conditions for GO

| # | Condition | Met? |
|---|-----------|------|
| 1 | All 30 bare table references identified | ✅ Done (this document) |
| 2 | Migration SQL verified (004 + 005) | ✅ Already used in current project |
| 3 | Rollback plan documented | ✅ Done (Section 5) |
| 4 | SSO_SHARED_SECRET will be same in both projects | ✅ Config value, not DB-bound |
| 5 | Broker credentials independent of Supabase | ✅ Stored in env vars |
| 6 | No foreign keys to Dashboard tables | ✅ Only text-based fw_user_id mapping |
| 7 | New Supabase project created and tested | ⬜ Pending (Phase 1) |

### Blockers (Must Resolve Before Cutover)

| # | Blocker | Resolution |
|---|---------|-----------|
| 1 | `audit.repository.js` points to non-existent `audit_log` table | Decision: create `t_audit_log` OR refactor to use `t_risk_events` |
| 2 | `broker-session.repository.js` uses `broker_sessions` (no prefix) | Simple fix: change to `t_broker_sessions` |
| 3 | User provisioning after isolation — new users won't exist in `t_users` | Recommended: add auto-provision in `sso.service.js` (create user on first SSO if not found) |

### Risk Acceptance

| Risk | Probability | Impact | Accept? |
|------|------------|--------|---------|
| Bare table name missed in code | Low (grep verified) | 500 error on affected route | Yes — instant rollback available |
| Data migration FK mismatch | Low (self-referencing) | Import fails | Yes — retry or fresh start |
| Session invalidation annoys users | Medium | Users re-login (~3s) | Yes — acceptable UX cost |
| Dashboard SSO stops working | Very Low (same secret) | Can't login | Yes — rollback fixes instantly |

---

## 8. Execution Checklist (Day-of)

```
PRE-FLIGHT
□ New Supabase project created
□ Migrations 004 + 005 executed on new project
□ audit_log decision made and applied
□ Code branch with all 30 fixes created
□ Local tests passing against new project
□ setup.js seeds data successfully
□ SSO flow tested locally
□ Old project credentials saved for rollback
□ Team notified of maintenance window

CUTOVER (2-5 min window)
□ Enable maintenance page (optional)
□ Update production env: SUPABASE_URL
□ Update production env: SUPABASE_SERVICE_KEY
□ Deploy code branch
□ Wait for server restart
□ GET /health → database.connected: true
□ Remove maintenance page

POST-CUTOVER (30 min monitoring)
□ Test SSO login from Dashboard
□ Verify /api/positions returns (empty or migrated data)
□ Verify market data feed is live
□ Verify Socket.IO clients reconnect
□ Check error logs for any table-not-found
□ Test order placement (if market hours)
□ Confirm daily cron next run won't error

DONE
□ Notify team: isolation complete
□ Document new credentials in secure vault
□ Schedule: drop t_ tables from old project (after 7 days)
```
