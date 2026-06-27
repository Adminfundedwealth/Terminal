# Phase 2 — Supabase Implementation Blueprint

**Prerequisite:** PRODUCTION-GAP-REPORT.md accepted  
**Scope:** Database + Auth + SSO + Account mapping  
**No broker integration in this phase.**

---

## 1. SCHEMA REVIEW — Current vs Required

### Current State (from `server/db/schema.sql`)

| Table | Defined | Columns | FK | Indexes | RLS Enabled |
|-------|---------|---------|----|---------|----|
| users | ✅ | 6 | — | — | ✅ |
| challenges | ✅ | 10 | users.id | — | ✅ |
| accounts | ✅ | 11 | users.id, challenges.id | 2 | ✅ |
| risk_rules | ✅ | 5 | accounts.id | — | ✅ |
| orders | ✅ | 16 | accounts.id | 2 (partial) | ✅ |
| positions | ✅ | 10 | accounts.id | 1 (partial) | ✅ |
| trades | ✅ | 10 | accounts.id, orders.id | 1 | ✅ |
| watchlists | ✅ | 7 | users.id | 1 | ✅ |
| account_metrics | ✅ | 13 | accounts.id | 1 | ✅ |
| sessions | ✅ | 8 | users.id, accounts.id | 1 (partial) | ✅ |

### Missing Migrations Required


| # | Migration | Reason | SQL |
|---|-----------|--------|-----|
| 1 | `updated_at` auto-trigger | Schema has `updated_at` columns but no trigger to auto-update them | `CREATE FUNCTION` + `CREATE TRIGGER` on users, accounts, orders, watchlists |
| 2 | RLS policies | RLS is enabled but no `CREATE POLICY` statements exist | Must add policy per table |
| 3 | Position unique constraint fix | `UNIQUE(account_id, token, product_type)` conflicts on re-open after close | Change to partial unique: `WHERE closed_at IS NULL` |
| 4 | Challenge `min_trading_days` column | Some challenges require minimum days traded | Add column |
| 5 | Account `peak_balance` column | Needed for drawdown calculation from high-water mark | Add column |
| 6 | Account `payout_eligible` column | Track if funded account can request payout | Add column |

### Missing RLS Policies (must add before Supabase goes live)

```sql
-- POLICY: Users can only see their own data
CREATE POLICY "users_own_data" ON users
  FOR ALL USING (id = auth.uid());

-- POLICY: Service role can do everything (for backend)
-- Backend uses SUPABASE_SERVICE_KEY which bypasses RLS

-- POLICY: Accounts belong to user
CREATE POLICY "accounts_own" ON accounts
  FOR ALL USING (user_id = auth.uid());

-- POLICY: Challenges belong to user
CREATE POLICY "challenges_own" ON challenges
  FOR ALL USING (user_id = auth.uid());

-- POLICY: Orders belong to user's accounts
CREATE POLICY "orders_own" ON orders
  FOR ALL USING (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  );

-- POLICY: Positions belong to user's accounts
CREATE POLICY "positions_own" ON positions
  FOR ALL USING (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  );

-- POLICY: Trades belong to user's accounts
CREATE POLICY "trades_own" ON trades
  FOR ALL USING (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  );

-- POLICY: Watchlists belong to user
CREATE POLICY "watchlists_own" ON watchlists
  FOR ALL USING (user_id = auth.uid());

-- POLICY: Risk rules visible to account owner
CREATE POLICY "risk_rules_own" ON risk_rules
  FOR ALL USING (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  );

-- POLICY: Metrics visible to account owner
CREATE POLICY "metrics_own" ON account_metrics
  FOR ALL USING (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  );

-- POLICY: Sessions belong to user
CREATE POLICY "sessions_own" ON sessions
  FOR ALL USING (user_id = auth.uid());
```

**IMPORTANT:** The terminal backend uses `SUPABASE_SERVICE_KEY` (service role) which **bypasses RLS**. RLS policies protect direct client access only. Backend is trusted.

---

## 2. SSO FLOW — Dashboard → Terminal

### Flow Diagram

```
┌─────────────────────────────────────────────┐
│         FUNDEDWEALTH DASHBOARD              │
│                                             │
│  User clicks "Open Terminal" button         │
│                                             │
│  Dashboard generates SSO payload:           │
│  {                                          │
│    userId: "usr_aman_001",                  │
│    accountId: "acc_fw10001",                │
│    challengeId: "ch_001",                   │
│    timestamp: 1718600000,                   │
│    nonce: "abc123xyz"                       │
│  }                                          │
│                                             │
│  Signs with shared secret → sso_token       │
│                                             │
│  Redirects to:                              │
│  terminal.fundedwealth.com/auth/sso         │
│    ?token=<signed_sso_token>                │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│         FUNDEDWEALTH TERMINAL               │
│                                             │
│  GET /auth/sso?token=<sso_token>            │
│                                             │
│  Backend validates:                         │
│  1. Verify signature (shared secret/RSA)    │
│  2. Check timestamp < 60 seconds old        │
│  3. Check nonce not reused                  │
│  4. Lookup userId in users table            │
│  5. Lookup accountId in accounts table      │
│  6. Verify account.status == 'active'       │
│  7. Verify challenge.status == 'active'     │
│                                             │
│  If valid:                                  │
│  → Generate terminal JWT                    │
│  → Store in sessions table                  │
│  → Set httpOnly cookie                      │
│  → Redirect to terminal.fundedwealth.com/   │
│                                             │
│  If invalid:                                │
│  → Redirect to dashboard with error         │
└─────────────────────────────────────────────┘
```

### JWT Claims Required

```json
{
  "sub": "usr_aman_001",
  "accountId": "acc_fw10001",
  "challengeId": "ch_001",
  "accountCode": "FW-10001",
  "brokerProvider": "angelone",
  "permissions": ["trade", "view_positions", "view_orders"],
  "iat": 1718600000,
  "exp": 1718686400
}
```

| Claim | Purpose |
|-------|---------|
| `sub` | FW user ID — identifies the trader |
| `accountId` | Which trading account is active |
| `challengeId` | Which challenge this belongs to |
| `accountCode` | Display code (FW-10001) |
| `brokerProvider` | Which broker adapter to use |
| `permissions` | What the user can do (trade vs view-only) |
| `iat` | Issued at timestamp |
| `exp` | Expiry (24 hours from issue) |

### Session Lifecycle

```
1. SSO token arrives → validate → issue JWT (24h)
2. Every API request → check JWT in cookie → extract claims
3. If JWT expires → frontend detects 401 → redirect to dashboard
4. If user closes browser → cookie persists (httpOnly, secure, sameSite)
5. Manual logout → revoke session in DB → clear cookie
```

---

## 3. USER → CHALLENGE → ACCOUNT MAPPING

### Data Flow

```
Dashboard creates challenge
        │
        │ Webhook / API sync
        ▼
Terminal DB: INSERT INTO challenges (...)
Terminal DB: INSERT INTO accounts (...)
Terminal DB: INSERT INTO risk_rules (...)
        │
        ▼
User opens terminal via SSO
        │
        │ JWT contains accountId
        ▼
Terminal loads:
  → account (balance, status, broker)
  → challenge (type, plan, progress)
  → risk_rules (all rules for this account)
        │
        ▼
Risk Engine initialized with rules
Trading Engine ready to accept orders
```

### Relationship Cardinality

```
users (1) ──── (N) challenges
challenges (1) ──── (1) accounts
accounts (1) ──── (N) risk_rules
accounts (1) ──── (N) orders
accounts (1) ──── (N) positions
accounts (1) ──── (N) trades
accounts (1) ──── (N) account_metrics
users (1) ──── (N) watchlists
users (1) ──── (N) sessions
```

**One user can have multiple challenges (evaluation, funded, etc).  
Each challenge has exactly one trading account.  
Each account has its own set of risk rules.**

---

## 4. PROP FIRM RULES — TABLE DESIGN

### `risk_rules` table — rule_type values:

| rule_type | value (JSONB) | Enforcement Point |
|-----------|---------------|-------------------|
| `daily_loss_limit` | `{"amount": 500000, "percent": 5}` | Pre-trade + post-trade |
| `max_drawdown` | `{"amount": 1000000, "percent": 10, "from": "peak"}` | Post-trade |
| `profit_target` | `{"amount": 1000000, "percent": 10}` | Post-trade (pass detection) |
| `max_positions` | `{"count": 15}` | Pre-trade |
| `max_lot_size` | `{"nifty": 6, "banknifty": 3, "stocks": 4, "default": 2}` | Pre-trade |
| `allowed_segments` | `{"segments": ["NSE", "NFO", "MCX"]}` | Pre-trade |
| `trading_hours` | `{"start": "09:15", "end": "15:30", "timezone": "Asia/Kolkata"}` | Pre-trade |
| `no_overnight` | `{"enabled": true, "auto_square_off": "15:15"}` | Pre-trade + scheduler |
| `max_daily_trades` | `{"count": 50}` | Pre-trade |
| `min_trading_days` | `{"count": 10}` | Challenge pass condition |
| `news_blackout` | `{"minutes_before": 5, "minutes_after": 5}` | Pre-trade (optional) |

### Account Status Transitions

```
active ──→ locked (daily loss hit / manual lock)
active ──→ breached (max drawdown hit → challenge failed)
active ──→ completed (profit target hit → challenge passed)
active ──→ expired (time limit exceeded)
locked ──→ active (next trading day / admin unlock)
```

---

## 5. DATA FLOW DIAGRAMS

### Order Flow (with Supabase)

```
Frontend: User clicks BUY
        │
        ▼
POST /api/orders/place (JWT in cookie)
        │
        ▼
Auth Middleware: validate JWT → extract accountId
        │
        ▼
Risk Engine: load risk_rules from Supabase for accountId
        │  → check daily_loss_limit
        │  → check max_positions
        │  → check allowed_segments
        │  → check trading_hours
        │
        ▼ (PASS)
INSERT INTO orders (status='PENDING') → Supabase
        │
        ▼
Broker Adapter: placeOrder() → exchange
        │
        ▼ (FILLED / REJECTED)
UPDATE orders SET status=... → Supabase
        │
        ▼ (if FILLED)
INSERT INTO trades → Supabase
UPDATE positions (upsert) → Supabase
UPDATE accounts SET balance=... → Supabase
        │
        ▼
Post-Trade Risk Check:
  → daily_loss recalculated
  → drawdown recalculated
  → if breach → lock account → close all positions
        │
        ▼
WebSocket push: order_update + position_update to client
```

### Account Load Flow

```
SSO validates → JWT issued with accountId
        │
        ▼
Frontend mounts → GET /api/account
        │
        ▼
Backend queries Supabase:
  SELECT * FROM accounts WHERE id = jwt.accountId
  SELECT * FROM challenges WHERE id = account.challenge_id
  SELECT * FROM risk_rules WHERE account_id = jwt.accountId AND is_active = true
        │
        ▼
Returns to frontend:
{
  account: { code, balance, status, broker },
  challenge: { type, plan, initial_balance, progress },
  rules: { daily_loss_limit, max_drawdown, profit_target, ... }
}
```

---

## 6. IMPLEMENTATION ORDER

| Step | Action | Depends On | Outcome |
|------|--------|-----------|---------|
| 1 | Create Supabase project | Nothing | Project URL + keys |
| 2 | Run schema.sql in Supabase SQL editor | Step 1 | 10 tables created |
| 3 | Run migrations (triggers, policies, column additions) | Step 2 | Schema production-ready |
| 4 | Create `server/db/client.ts` | Step 1 (URL + key) | Supabase JS client configured |
| 5 | Add env vars to server `.env` | Step 1 | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| 6 | Seed test data | Step 2 | 1 user, 1 challenge, 1 account, 5 risk rules |
| 7 | Create `server/middleware/auth.ts` | Step 4 | JWT validation middleware |
| 8 | Create `GET /auth/sso` endpoint | Step 7 | SSO token → terminal JWT |
| 9 | Apply auth middleware to all `/api/*` routes | Step 7 | Routes now protected |
| 10 | Create `GET /api/account` (from DB) | Step 4 | Replace hardcoded DEMO001 |
| 11 | Create `GET /api/account/rules` | Step 4 | Load risk rules |
| 12 | Create `GET /api/account/challenge` | Step 4 | Load challenge progress |
| 13 | Create `src/hooks/useAuth.ts` | Step 8 | Frontend auth state |
| 14 | Update frontend to redirect if 401 | Step 13 | No-login = redirect to dashboard |
| 15 | Replace localStorage watchlists with DB | Step 4 | Persist watchlists server-side |
| 16 | Verify: terminal loads, auth works, data from DB | All above | Phase 2 complete |

---

## 7. ENVIRONMENT VARIABLES REQUIRED

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ... (service role key, bypasses RLS)
SUPABASE_ANON_KEY=eyJ... (public key, for frontend if needed)

# SSO
SSO_SHARED_SECRET=your-256-bit-secret (shared with FW Dashboard)
JWT_SECRET=your-terminal-jwt-secret (for signing terminal JWTs)
JWT_EXPIRY=24h

# FW Dashboard
FW_DASHBOARD_URL=https://fundedwealth.com
FW_DASHBOARD_API_KEY=... (for webhook verification)
```

---

## 8. TEST DATA — Seed Script

```sql
-- Test User
INSERT INTO users (id, fw_user_id, email, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'usr_test_001', 'test@fundedwealth.com', 'Test Trader');

-- Test Challenge
INSERT INTO challenges (id, user_id, type, plan, initial_balance, status, expires_at) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'evaluation', '100K', 10000000, 'active', NOW() + INTERVAL '30 days');

-- Test Account
INSERT INTO accounts (id, user_id, account_code, challenge_id, broker_provider, balance, status) VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'FW-10001', '22222222-2222-2222-2222-222222222222', 'angelone', 10000000, 'active');

-- Risk Rules
INSERT INTO risk_rules (account_id, rule_type, value) VALUES
  ('33333333-3333-3333-3333-333333333333', 'daily_loss_limit', '{"amount": 500000, "percent": 5}'),
  ('33333333-3333-3333-3333-333333333333', 'max_drawdown', '{"amount": 1000000, "percent": 10}'),
  ('33333333-3333-3333-3333-333333333333', 'profit_target', '{"amount": 1000000, "percent": 10}'),
  ('33333333-3333-3333-3333-333333333333', 'max_positions', '{"count": 15}'),
  ('33333333-3333-3333-3333-333333333333', 'allowed_segments', '{"segments": ["NSE", "NFO", "MCX"]}'),
  ('33333333-3333-3333-3333-333333333333', 'trading_hours', '{"start": "09:15", "end": "15:30"}'),
  ('33333333-3333-3333-3333-333333333333', 'no_overnight', '{"enabled": true}');

-- Test Watchlist
INSERT INTO watchlists (user_id, name, color, items, sort_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'INDEX', '#2962ff', '[{"token":"99926000","symbol":"NIFTY 50","segment":"NSE"},{"token":"99926009","symbol":"BANKNIFTY","segment":"NSE"}]', 0);
```
