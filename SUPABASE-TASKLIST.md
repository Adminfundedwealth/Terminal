# Supabase Implementation — Executable Task List

**Phase:** 2  
**Prerequisite:** PHASE-2-SUPABASE-IMPLEMENTATION.md reviewed  
**Output:** Working Supabase integration with auth, accounts, and rules  

---

## PART A — Supabase Project Setup

- [ ] **A1.** Create new Supabase project (region: Mumbai/Singapore)
- [ ] **A2.** Copy project URL and service role key
- [ ] **A3.** Run `server/db/schema.sql` in Supabase SQL Editor
- [ ] **A4.** Verify all 10 tables created successfully
- [ ] **A5.** Run migration: `updated_at` trigger function
- [ ] **A6.** Run migration: RLS policies (all 10 tables)
- [ ] **A7.** Run migration: fix positions UNIQUE constraint (add WHERE closed_at IS NULL)
- [ ] **A8.** Run migration: add `peak_balance` column to accounts
- [ ] **A9.** Run migration: add `payout_eligible` column to accounts
- [ ] **A10.** Run migration: add `min_trading_days` column to challenges
- [ ] **A11.** Run seed script (test user + challenge + account + rules)
- [ ] **A12.** Verify seed data via Supabase Table Editor

---

## PART B — Server Connection

- [ ] **B1.** Create file: `server/db/client.ts`
- [ ] **B2.** Install `@supabase/supabase-js` in server package
- [ ] **B3.** Create `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- [ ] **B4.** Export initialized Supabase client from `client.ts`
- [ ] **B5.** Test connection: query `SELECT * FROM users` and log result
- [ ] **B6.** Verify: server starts without errors with Supabase connected

---

## PART C — Authentication Middleware

- [ ] **C1.** Install `jsonwebtoken` package in server
- [ ] **C2.** Create file: `server/middleware/auth.ts`
- [ ] **C3.** Implement: extract JWT from cookie or Authorization header
- [ ] **C4.** Implement: verify JWT signature using `JWT_SECRET`
- [ ] **C5.** Implement: check expiry, reject if expired (401)
- [ ] **C6.** Implement: attach decoded claims to `req.user`
- [ ] **C7.** Add `JWT_SECRET` to `.env`
- [ ] **C8.** Test: request without token → 401
- [ ] **C9.** Test: request with valid token → 200 + `req.user` populated

---

## PART D — SSO Endpoint

- [ ] **D1.** Create file: `server/routes/auth.routes.ts`
- [ ] **D2.** Implement: `GET /auth/sso?token=<sso_token>`
- [ ] **D3.** Implement: verify SSO token signature (shared secret with Dashboard)
- [ ] **D4.** Implement: check timestamp freshness (< 60 seconds)
- [ ] **D5.** Implement: lookup user in Supabase by `fw_user_id`
- [ ] **D6.** Implement: lookup account in Supabase by `accountId`
- [ ] **D7.** Implement: verify account status is 'active'
- [ ] **D8.** Implement: generate terminal JWT with claims
- [ ] **D9.** Implement: insert into `sessions` table
- [ ] **D10.** Implement: set httpOnly secure cookie with JWT
- [ ] **D11.** Implement: redirect to `/` (terminal main page)
- [ ] **D12.** Implement: error handling → redirect to Dashboard with error code
- [ ] **D13.** Add `SSO_SHARED_SECRET` to `.env`
- [ ] **D14.** Test: valid SSO token → cookie set → terminal loads
- [ ] **D15.** Test: expired SSO token → redirect to dashboard

---

## PART E — Account Data Endpoints (replace hardcoded data)

- [ ] **E1.** Create: `GET /api/account` → query accounts table by JWT accountId
- [ ] **E2.** Create: `GET /api/account/challenge` → query challenges table
- [ ] **E3.** Create: `GET /api/account/rules` → query risk_rules table
- [ ] **E4.** Create: `GET /api/accounts` → list all accounts for JWT userId (if multiple)
- [ ] **E5.** Remove: hardcoded `DEMO001` response from brokerService.js line 155
- [ ] **E6.** Update: frontend `getAccount()` to use new endpoint data
- [ ] **E7.** Test: API returns real data from Supabase seed
- [ ] **E8.** Test: balance, status, broker_provider come from DB

---

## PART F — Watchlist Persistence

- [ ] **F1.** Create: `GET /api/watchlists` → query watchlists by JWT userId
- [ ] **F2.** Create: `POST /api/watchlists` → insert new watchlist
- [ ] **F3.** Create: `PUT /api/watchlists/:id` → update items/name/color
- [ ] **F4.** Create: `DELETE /api/watchlists/:id` → delete watchlist
- [ ] **F5.** Update frontend: load watchlists from API instead of localStorage
- [ ] **F6.** Update frontend: save changes to API on add/remove symbol
- [ ] **F7.** Keep localStorage as offline fallback (if API fails)
- [ ] **F8.** Test: add symbol → refresh page → symbol still there (from DB)

---

## PART G — Apply Auth Middleware to All Routes

- [ ] **G1.** Apply auth middleware to `/api/account*`
- [ ] **G2.** Apply auth middleware to `/api/positions`
- [ ] **G3.** Apply auth middleware to `/api/orders*`
- [ ] **G4.** Apply auth middleware to `/api/trades`
- [ ] **G5.** Apply auth middleware to `/api/watchlists*`
- [ ] **G6.** Keep `/api/instruments/search` and `/api/market/*` open (public data)
- [ ] **G7.** Add auth validation to WebSocket `on('connection')` handler
- [ ] **G8.** Test: all protected routes return 401 without valid JWT
- [ ] **G9.** Test: all protected routes return data with valid JWT

---

## PART H — Frontend Auth Hook

- [ ] **H1.** Create file: `src/hooks/useAuth.ts`
- [ ] **H2.** On app mount: check if session cookie exists (call `/api/account`)
- [ ] **H3.** If 401: redirect to `FW_DASHBOARD_URL` (configurable env var)
- [ ] **H4.** If 200: store account data in Zustand store
- [ ] **H5.** Show loading state while auth checking
- [ ] **H6.** Add logout function: call `/auth/logout`, clear cookie, redirect
- [ ] **H7.** Test: fresh browser (no cookie) → redirects to dashboard
- [ ] **H8.** Test: valid cookie → terminal loads normally

---

## PART I — Integration Verification

- [ ] **I1.** Start terminal with Supabase connected
- [ ] **I2.** Run Playwright: confirm terminal still renders all components
- [ ] **I3.** Confirm: no TypeScript errors
- [ ] **I4.** Confirm: no runtime console errors
- [ ] **I5.** Confirm: watchlists load from DB
- [ ] **I6.** Confirm: account data shows from DB (not DEMO001)
- [ ] **I7.** Confirm: unauthenticated access properly blocked
- [ ] **I8.** Capture screenshots as evidence

---

## COMPLETION CRITERIA

Phase 2 is complete when:

1. ✅ Supabase project running with all tables + indexes + RLS
2. ✅ Server connects to Supabase successfully
3. ✅ SSO endpoint accepts token from Dashboard and issues terminal JWT
4. ✅ All `/api/*` routes are protected by auth middleware
5. ✅ Account data comes from database (not hardcoded)
6. ✅ Risk rules load from database per account
7. ✅ Watchlists persist to database
8. ✅ WebSocket requires auth before subscription
9. ✅ Frontend redirects to Dashboard if no session
10. ✅ Playwright verification passes

**After Phase 2:** Proceed to Phase 3 (SSO fine-tuning) → Phase 4 (Account Mapping UI) → Phase 5 (Risk Engine) → Phase 6 (Challenge Engine) → Phase 7 (Angel One) → Phase 8 (Dhan) → Phase 9 (TradingView)
