# LOCAL AUTH REDIRECT — ROOT CAUSE ANALYSIS

## Date: 2026-06-18
## Status: Root cause identified, fix defined

---

## Symptom

Opening `http://localhost:3000` in a browser redirects to:
```
https://www.fundedwealth.com/login?redirect=http%3A%2F%2Flocalhost%3A3000%2F
```

---

## Root Cause Chain

```
1. Browser opens http://localhost:3000
2. React app loads → App.tsx mounts → useAuth() runs
3. useAuth() calls getAccount() → fetch('/api/account', { credentials: 'include' })
4. Vite proxy forwards to http://localhost:4000/api/account
5. Backend auth middleware (requireAuth) checks for token:
   - Cookie 'fw_session': NOT PRESENT (no login has occurred)
   - Authorization header: NOT PRESENT
6. Backend returns: 401 { error: 'unauthorized', message: 'No session token...' }
7. useAuth() catches error → err.status === 401
8. Condition matches: status === 401 → calls redirectToDashboard()
9. redirectToDashboard() sets:
   window.location.href = 'https://fundedwealth.com/login?redirect=...'
10. Browser navigates away from localhost
```

---

## Why Playwright Works But Browser Doesn't

Playwright test pre-sets a `fw_session` cookie via:
```javascript
await context.addCookies([{
  name: 'fw_session',
  value: '<valid JWT>',
  domain: 'localhost',
  path: '/',
}]);
```

This cookie is sent with the `/api/account` request. The backend validates the JWT signature (valid) → extracts claims → passes auth → calls `accountService.getAccount('test-acc')`.

**However:** `accountService.getAccount('test-acc')` queries `t_accounts` table which doesn't exist → returns `null`. The API returns `null` as the response body (HTTP 200). The frontend `getAccount()` receives `null` and since `response.ok` is true (200), it doesn't throw — `setAccount(null)` runs and `isAuthenticated` becomes `true`.

In a normal browser: **no cookie exists** → 401 → redirect.

---

## The Two Problems

### Problem 1: No Session Cookie (the redirect trigger)

There's no way to get a `fw_session` cookie without:
- Going through SSO flow (`/auth/sso?token=...`)
- Which requires the FundedWealth Dashboard to generate an SSO token
- Which requires production Dashboard infrastructure

The dev endpoint `/auth/dev/generate-sso` exists but:
- It generates a short-lived SSO token (60s)
- The SSO validation (`validateSSOToken`) looks up user in `t_users` table
- `t_users` table doesn't exist → returns `{ success: false, error: 'User not found in terminal database.' }`
- No cookie gets set

### Problem 2: Database Tables Missing (the SSO lookup failure)

Even if you navigate to `/auth/sso?token=...`:
- SSO service queries `t_users` table → table doesn't exist → null
- Returns: "User not found in terminal database"
- Redirects to: `fundedwealth.com/terminal-error?reason=User+not+found...`

---

## Auth Middleware Dev Bypass (NOT active)

```javascript
// server/middleware/auth.js line 24
if (process.env.NODE_ENV !== 'production' && !process.env.SUPABASE_URL) {
  req.user = { userId: 'dev-user', ... };
  return next();
}
```

The bypass condition is: `NODE_ENV !== 'production' AND SUPABASE_URL is NOT set`.

Current `.env`:
```
NODE_ENV=development     ← passes first check
SUPABASE_URL=https://... ← FAILS second check (URL IS set)
```

Because `SUPABASE_URL` is set, the dev bypass does NOT activate. Auth is fully enforced.

---

## The Exact Fix

There are two approaches. **Choose one:**

### Option A: Add `/auth` proxy + auto-dev-login (recommended for local dev)

1. Add `/auth` to Vite proxy config:
```typescript
// vite.config.ts
proxy: {
  '/api': { target: 'http://localhost:4000', changeOrigin: true },
  '/auth': { target: 'http://localhost:4000', changeOrigin: true },
  '/ws': { target: 'ws://localhost:4000', ws: true },
}
```

2. Change auth middleware dev bypass to:
```javascript
if (process.env.NODE_ENV !== 'production' && process.env.DEV_BYPASS_AUTH === 'true') {
  req.user = { userId: 'dev-user', accountId: 'dev-account', ... };
  return next();
}
```

3. Add to `server/.env`:
```
DEV_BYPASS_AUTH=true
```

4. Update `accountService.getAccount()` to return a dev account object when accountId is 'dev-account':
```javascript
if (accountId === 'dev-account') {
  return { id: 'dev-account', accountCode: 'FW-DEV', balance: 10000000, status: 'active', brokerProvider: 'angelone' };
}
```

This allows the frontend to load without any cookie or database tables.

### Option B: Apply database migration + seed (production-correct path)

1. Run `server/db/migrations/004_terminal_tables.sql` in Supabase SQL Editor
2. Run `node server/db/setup.js` to seed test user/account
3. Navigate to `http://localhost:4000/auth/dev/generate-sso` to get SSO token
4. Visit `http://localhost:4000/auth/sso?token=<TOKEN>` within 60 seconds
5. This sets the `fw_session` cookie
6. Now `http://localhost:3000` works (cookie is sent via proxy)

This requires the migration to succeed first.

### Option C: Simplest one-line fix (unsafe for production, fine for dev)

Change the dev bypass condition in `server/middleware/auth.js`:

```javascript
// FROM:
if (process.env.NODE_ENV !== 'production' && !process.env.SUPABASE_URL) {

// TO:
if (process.env.NODE_ENV !== 'production' && process.env.DEV_BYPASS_AUTH === 'true') {
```

And add `DEV_BYPASS_AUTH=true` to `.env`. This makes ALL `/api/*` requests pass auth automatically with a dev user context. Combined with a hardcoded dev account return in `accountService`, the terminal loads fully.

---

## Summary

| Question | Answer |
|---|---|
| Where does redirect happen? | `src/hooks/useAuth.ts` → `redirectToDashboard()` |
| What triggers it? | `GET /api/account` returns 401 |
| Why 401? | No `fw_session` cookie in browser |
| Why no cookie? | No SSO login has occurred |
| Why can't SSO work locally? | `t_users` table doesn't exist (migration pending) |
| Why does dev bypass not help? | Bypass requires `!SUPABASE_URL` which is set |
| Why does Playwright work? | Cookie injected manually via `context.addCookies()` |
| What's the fix? | Option A (DEV_BYPASS_AUTH flag) or Option B (apply migration) |

---

## Recommended Fix: Option A

Minimal code changes:
1. `server/middleware/auth.js` — Change bypass condition to use `DEV_BYPASS_AUTH` env var
2. `server/.env` — Add `DEV_BYPASS_AUTH=true`
3. `server/services/accountService.js` — Return dev account data for `'dev-account'` ID
4. `vite.config.ts` — Add `/auth` proxy

This is 4 lines of change. Terminal loads immediately. No migration needed for dev.
