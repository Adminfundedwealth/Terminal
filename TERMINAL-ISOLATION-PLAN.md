# TERMINAL ISOLATION PLAN

> Audit Date: 2026-06-18  
> Status: AUDIT ONLY — No code changes made  
> Scope: Can the FundedWealth Terminal run on a separate Supabase project?

---

## Executive Summary

**Answer: YES — the terminal CAN run on a separate Supabase project**, but there are:
- 1 hard dependency (SSO shared secret with Dashboard)
- 1 critical code bug (services use wrong table names)
- 1 data sync requirement (user provisioning)

The terminal is architecturally designed for isolation (t_ prefix tables, own JWT, own session management). The remaining coupling is minimal and fixable.

---

## 1. Tables Required by Terminal

### Terminal-Owned Tables (14 total, all t_ prefix)

| # | Table | Purpose | Migration |
|---|-------|---------|-----------|
| 1 | `t_users` | Terminal user records (mapped from Dashboard via fw_user_id) | 004 |
| 2 | `t_challenges` | Prop firm challenge definitions | 004 |
| 3 | `t_accounts` | Trading accounts (one per challenge) | 004 |
| 4 | `t_risk_rules` | Per-account risk rules (JSONB) | 004 |
| 5 | `t_orders` | Trading orders | 004 |
| 6 | `t_positions` | Open/closed positions | 004 |
| 7 | `t_trades` | Execution log (immutable) | 004 |
| 8 | `t_watchlists` | User watchlists | 004 |
| 9 | `t_account_metrics` | Daily P&L snapshots | 004 |
| 10 | `t_sessions` | Terminal auth sessions | 004 |
| 11 | `t_broker_sessions` | Broker connection lifecycle audit | 005 |
| 12 | `t_risk_events` | Risk violations & alerts audit | 005 |
| 13 | `t_challenge_metrics` | Challenge progress event log | 005 |
| 14 | `t_order_audit` | Order state transition audit | 005 |

These 14 tables are 100% terminal-owned with zero foreign keys to external tables.

---

## 2. Tables Belonging to Old Website / Dashboard

The `server/db/schema.sql` file defines tables **without** the `t_` prefix. These are the original Dashboard schema or early development tables:

| Table (no prefix) | Dashboard Equivalent | Terminal t_ Version |
|---|---|---|
| `users` | FW Dashboard users | `t_users` |
| `challenges` | Dashboard challenge records | `t_challenges` |
| `accounts` | Dashboard trading accounts | `t_accounts` |
| `risk_rules` | Dashboard risk rules | `t_risk_rules` |
| `orders` | Dashboard order records | `t_orders` |
| `positions` | Dashboard positions | `t_positions` |
| `trades` | Dashboard trade log | `t_trades` |
| `watchlists` | Dashboard watchlists | `t_watchlists` |
| `account_metrics` | Dashboard metrics | `t_account_metrics` |
| `sessions` | Dashboard sessions | `t_sessions` |

**Current situation:** Both table sets likely exist in the same Supabase project. The `t_` prefix was added in migration 004 specifically to "avoid collision with existing Dashboard tables" (stated in migration comments and SPRINT-1-REPORT.md).

---

## 3. Critical Bug: Bare Table Name Usage

Several services bypass the repository layer and query **bare table names** (no `t_` prefix). If the terminal moves to its own Supabase project, these queries will fail because only `t_` tables will exist.

### Files Using Wrong Table Names

| File | Queries Table | Should Be |
|------|--------------|-----------|
| `server/services/sso.service.js` | `'users'` | `'t_users'` |
| `server/services/sso.service.js` | `'accounts'` | `'t_accounts'` |
| `server/services/session.service.js` | `'sessions'` (4 calls) | `'t_sessions'` |
| `server/services/accountService.js` | `'accounts'` | `'t_accounts'` |
| `server/services/accountService.js` | `'positions'` | `'t_positions'` |
| `server/services/accountService.js` | `'orders'` (3 calls) | `'t_orders'` |
| `server/services/accountService.js` | `'trades'` | `'t_trades'` |
| `server/services/riskEngine.js` | `'challenges'` | `'t_challenges'` |
| `server/repositories/challenge.repository.js` | `'accounts'` (1 call) | `'t_accounts'` |
| `server/cron/dailyChecks.js` | `'accounts'` (2 calls) | `'t_accounts'` |
| `server/db/client.js` | `'users'` (health check) | `'t_users'` |
| `server/db/setup.js` | Multiple bare names | All need `t_` prefix |

**Impact:** These services are currently hitting the Dashboard's tables in the shared project. On isolation, they would hit non-existent tables and fail.

---

## 4. Can Terminal Run on a Separate Supabase Project?

### YES — with the following conditions:

| Condition | Effort | Blocking? |
|-----------|--------|-----------|
| Fix bare table names in services → `t_` prefix | Low (find/replace) | YES |
| Run migrations 004 + 005 on new project | Low (SQL copy) | YES |
| Update `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars | Trivial | YES |
| Keep `SSO_SHARED_SECRET` matching Dashboard | Zero effort (same value) | NO |
| Seed user data or build provisioning API | Medium | DEPENDS |

### Architecture Already Supports Isolation

1. **Single connection point:** `server/db/client.js` — one place to change Supabase URL
2. **Service role key:** Backend bypasses RLS, so no auth provider coupling
3. **No shared foreign keys:** `t_users.fw_user_id` is a TEXT field (not a FK to Dashboard)
4. **Own JWT system:** Terminal issues its own JWTs, independent of Supabase Auth
5. **Own session management:** Terminal tracks sessions in `t_sessions`, not Supabase Auth sessions

---

## 5. Environment Variables That Would Change

### Must Change (New Supabase Project)

| Variable | Current | After Isolation |
|----------|---------|-----------------|
| `SUPABASE_URL` | Shared project URL | New terminal-only project URL |
| `SUPABASE_SERVICE_KEY` | Shared project service key | New project service key |

### Must Stay Same (Shared with Dashboard)

| Variable | Reason |
|----------|--------|
| `SSO_SHARED_SECRET` | Dashboard signs SSO tokens with this; terminal validates with it |
| `FW_DASHBOARD_URL` | Terminal redirects to Dashboard on auth errors |

### No Change Needed

| Variable | Reason |
|----------|--------|
| `JWT_SECRET` | Terminal's own secret (not shared) |
| `JWT_EXPIRY` | Terminal-internal |
| `REDIS_URL` | Terminal-only Redis instance |
| `ANGEL_*` | Broker credentials (terminal-only) |
| `DHAN_*` | Broker credentials (terminal-only) |
| `PORT`, `NODE_ENV`, `FRONTEND_URL` | Infrastructure config |
| `ADMIN_SECRET` | Terminal-only admin auth |

---

## 6. Migration Steps

### Phase 1: Pre-Migration (No Downtime)

```
1. Create new Supabase project for terminal
2. Run migration 004_terminal_tables.sql in new project SQL editor
3. Run migration 005_persistence_tables.sql in new project SQL editor
4. Verify all 14 t_ tables exist in new project
5. Note new project's URL and service role key
```

### Phase 2: Code Fix (Required Before Switch)

```
6. Fix all bare table name references (Section 3 above):
   - sso.service.js: 'users' → 't_users', 'accounts' → 't_accounts'
   - session.service.js: 'sessions' → 't_sessions' (4 places)
   - accountService.js: all bare names → t_ prefix (6 places)
   - riskEngine.js: 'challenges' → 't_challenges' (1 place)
   - challenge.repository.js: 'accounts' → 't_accounts' (1 place)
   - dailyChecks.js: 'accounts' → 't_accounts' (2 places)
   - client.js: 'users' → 't_users' (health check)
   - setup.js: all bare names → t_ prefix (not critical, dev script)

7. Test terminal locally against the NEW Supabase project
8. Run seed data (setup.js) against new project
9. Verify: SSO login, order placement, position tracking, watchlists
```

### Phase 3: Data Migration (Optional, Only if Preserving History)

```
10. Export data from shared project's t_ tables:
    - t_users, t_challenges, t_accounts, t_risk_rules
    - t_orders, t_positions, t_trades
    - t_watchlists, t_account_metrics, t_sessions
    - t_broker_sessions, t_risk_events, t_challenge_metrics, t_order_audit

11. Import into new project (pg_dump/pg_restore or Supabase export)
12. Verify row counts match
```

### Phase 4: Cutover

```
13. Update terminal deployment env vars:
    - SUPABASE_URL → new project URL
    - SUPABASE_SERVICE_KEY → new project key

14. Deploy updated terminal code
15. Verify health endpoint returns connected: true
16. Test SSO flow end-to-end
17. Monitor for 24h
```

### Phase 5: Cleanup (Post-Migration)

```
18. Drop t_ tables from shared Dashboard project (optional, they're now unused)
19. Remove bare-name schema.sql (it's superseded by migration 004)
20. Update documentation
```

---

## 7. Downtime Risk Assessment

### Scenario A: Fresh Start (No Data Migration)

| Step | Downtime | Risk |
|------|----------|------|
| Create new Supabase project | 0 | None |
| Run migrations in new project | 0 | None |
| Fix bare table names in code | 0 (pre-deploy) | Low — straightforward find/replace |
| Seed fresh data | 0 | None |
| Switch env vars + deploy | **~2-5 minutes** | Low — single deployment restart |
| Verify SSO flow | 0 | Low |

**Total downtime: ~2-5 minutes** (deployment restart only)  
**Risk: LOW** — old project remains untouched as fallback

### Scenario B: With Data Migration (Preserve History)

| Step | Downtime | Risk |
|------|----------|------|
| Export t_ tables from shared project | 0 (read-only) | None |
| Import into new project | 0 | Low — may need FK ordering |
| Code fix + deploy | **~2-5 minutes** | Low |
| Verify data integrity | 0 | Medium — UUID FKs must be consistent |

**Total downtime: ~2-5 minutes** (same — export/import is pre-work)  
**Risk: LOW-MEDIUM** — FK integrity between t_accounts → t_challenges, etc.

### Scenario C: Rollback Plan

If anything fails after cutover:
1. Revert env vars to old Supabase URL/key
2. Redeploy (2 min)
3. Terminal is back on shared project immediately

**No data loss possible** — old project is untouched during migration.

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bare table names cause 500 errors | HIGH (if not fixed) | Critical | Fix all `.from()` calls before cutover |
| SSO breaks after switch | LOW | Critical | `SSO_SHARED_SECRET` doesn't change |
| Data loss during migration | NONE | — | Old project left intact |
| Redis session invalidation | LOW | Minor | Users re-login (normal 24h expiry) |
| Broker feed interruption | NONE | — | Broker connections are independent of Supabase |
| Cron jobs fail | MEDIUM (if unfixed) | Low | Fix `dailyChecks.js` table names |

---

## 8. Recommended Terminal-Only Schema

For a clean isolated deployment, the terminal needs exactly this:

### Core Schema (run in new Supabase SQL Editor)

```sql
-- ═══════════════════════════════════════════════════════
-- FUNDEDWEALTH TERMINAL — ISOLATED SCHEMA
-- Run: 004_terminal_tables.sql then 005_persistence_tables.sql
-- ═══════════════════════════════════════════════════════

-- Total: 14 tables
-- All self-referencing (no external FKs)
-- RLS enabled on all tables
-- Service role bypasses RLS (backend access)

-- EXECUTION ORDER:
--   1. t_users (root)
--   2. t_challenges (depends on t_users)
--   3. t_accounts (depends on t_users, t_challenges)
--   4. t_risk_rules (depends on t_accounts)
--   5. t_orders (depends on t_accounts)
--   6. t_positions (depends on t_accounts)
--   7. t_trades (depends on t_accounts, t_orders)
--   8. t_watchlists (depends on t_users)
--   9. t_account_metrics (depends on t_accounts)
--   10. t_sessions (depends on t_users, t_accounts)
--   11. t_broker_sessions (depends on t_accounts)
--   12. t_risk_events (depends on t_accounts)
--   13. t_challenge_metrics (depends on t_challenges, t_accounts)
--   14. t_order_audit (depends on t_orders, t_accounts)
```

### What's NOT Needed in the Isolated Project

| Item | Why |
|------|-----|
| Dashboard `users` table | Terminal has `t_users` |
| Dashboard `orders` table | Terminal has `t_orders` |
| Dashboard `challenges` table | Terminal has `t_challenges` |
| Supabase Auth (GoTrue) | Terminal uses own JWT system |
| Supabase Storage | Not used by terminal |
| Supabase Edge Functions | Terminal uses own cron |
| Supabase Realtime subscriptions | Terminal uses Socket.IO |

### Minimum Supabase Plan for Terminal

| Resource | Usage |
|----------|-------|
| Database rows | ~100K-1M (orders + trades grow daily) |
| Database size | ~500MB first year |
| API requests | Low — backend uses service role, not REST API |
| Auth users | 0 (terminal manages own auth) |
| Storage | 0 |
| Realtime connections | 0 (using Socket.IO instead) |

**Recommendation:** Supabase Free tier is sufficient for development. Pro tier ($25/mo) for production (better connection pooling, daily backups, 8GB database).

---

## 9. Coupling Diagram

```
┌─────────────────────────────────────┐
│     FW DASHBOARD (Website)          │
│                                     │
│  - Manages user accounts            │
│  - Creates challenges               │
│  - Processes payments               │
│  - Has own Supabase project         │
│                                     │
│  OUTBOUND to Terminal:              │
│  ┌───────────────────────────────┐  │
│  │ SSO Token (JWT)               │  │
│  │ Signed with SSO_SHARED_SECRET │  │
│  │ Contains: fwUserId,           │  │
│  │   accountId, challengeId     │  │
│  │ Short-lived: 120s            │  │
│  └───────────────┬───────────────┘  │
└──────────────────┼──────────────────┘
                   │ HTTPS redirect
                   ▼
┌─────────────────────────────────────┐
│     FW TERMINAL (Trading App)       │
│                                     │
│  INBOUND from Dashboard:           │
│  - Validates SSO token signature    │
│  - Looks up user by fw_user_id     │
│  - Creates own session JWT          │
│                                     │
│  INDEPENDENT:                       │
│  - Own Supabase project (14 tables) │
│  - Own JWT (24h sessions)           │
│  - Own Redis (optional)             │
│  - Own broker connections           │
│  - Own Socket.IO server             │
│  - Own cron jobs                    │
│                                     │
│  NO OUTBOUND to Dashboard:         │
│  - Does NOT call Dashboard APIs     │
│  - Does NOT write to Dashboard DB   │
│  - Does NOT share Redis             │
└─────────────────────────────────────┘
```

### Coupling Points (Only 2)

| # | Coupling | Direction | Type | Can Break? |
|---|----------|-----------|------|-----------|
| 1 | `SSO_SHARED_SECRET` | Dashboard → Terminal | Config (shared secret) | NO — needed for auth |
| 2 | `fw_user_id` mapping | Dashboard → Terminal | Data (text identifier) | NO — needed to link users |

**Both are intentional, minimal, and one-directional.** The Dashboard pushes info into the terminal; the terminal never calls back.

---

## 10. User Provisioning After Isolation

### Current Flow (Shared Project)
1. Dashboard creates user in its `users` table
2. Dashboard creates challenge in its `challenges` table
3. User clicks "Open Terminal" → SSO token has accountId
4. Terminal's `sso.service.js` queries `users` table (Dashboard's table in shared project)
5. Session created

### After Isolation (Separate Projects)
The terminal's `t_users` and `t_accounts` must be populated BEFORE a user can SSO in.

**Options for user provisioning:**

| Option | Complexity | Recommended? |
|--------|-----------|--------------|
| **A. Webhook from Dashboard** | Low | ✓ YES — Dashboard POSTs to terminal `/admin/provision` on challenge creation |
| **B. Sync script (cron)** | Low | Acceptable — periodic sync of new users/challenges |
| **C. Auto-provision on first SSO** | Medium | ✓ YES — if user not found in `t_users`, create them from SSO claims |
| **D. Admin API** | Medium | Good for manual management |

**Recommended: Option C (auto-provision on first SSO)**

When SSO validation finds no matching `fw_user_id` in `t_users`:
1. Create `t_users` record from SSO claims (name, email from Dashboard token)
2. Create `t_challenges` record from SSO claims (challengeId, type, plan)
3. Create `t_accounts` record from SSO claims (accountId, balance, broker)
4. Create default `t_risk_rules` for the account
5. Proceed with normal session creation

This makes the terminal fully self-bootstrapping — no manual provisioning needed.

---

## 11. Final Verdict

| Question | Answer |
|----------|--------|
| Can terminal run on separate Supabase? | **YES** |
| Is it already isolated? | **PARTIALLY** — repositories use t_ prefix, but services have bare table name bug |
| What blocks isolation today? | Bare table names in 6 service files (Section 3) |
| Is there downtime risk? | **~2-5 min** deployment restart, instant rollback possible |
| Is data migration complex? | **NO** — 14 self-contained tables, no external FKs |
| Does SSO break? | **NO** — only needs matching `SSO_SHARED_SECRET` |
| Will broker feeds be affected? | **NO** — completely independent of Supabase |
| Estimated effort to isolate? | **4-6 hours** (code fix + new project setup + testing) |

---

## 12. Action Items (Priority Order)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 1 | Fix bare table names in services (Section 3) | CRITICAL | 1 hour |
| 2 | Create new Supabase project | HIGH | 15 min |
| 3 | Run migrations 004 + 005 in new project | HIGH | 10 min |
| 4 | Add auto-provision logic to sso.service.js | HIGH | 2 hours |
| 5 | Update .env with new project credentials | HIGH | 5 min |
| 6 | Test SSO flow end-to-end | HIGH | 30 min |
| 7 | Migrate existing data (if needed) | MEDIUM | 1 hour |
| 8 | Drop t_ tables from shared project | LOW | After verification |
| 9 | Remove `schema.sql` (superseded by migration 004) | LOW | Cleanup |
| 10 | Document new architecture in ARCHITECTURE.md | LOW | 30 min |
