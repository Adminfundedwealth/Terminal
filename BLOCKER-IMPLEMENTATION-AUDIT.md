# BLOCKER IMPLEMENTATION AUDIT

**Date**: June 27, 2026  
**Scope**: Evidence-based implementation analysis of 5 production blockers  

---

## BLOCKER 1 — SSO NONCE STORED IN MEMORY

### Current Implementation

**File**: `server/services/sso.service.js`  
**Line**: 44  
**Code**:
```javascript
// Track used nonces to prevent replay attacks (in production, use Redis)
const usedNonces = new Set();
```

**Nonce Check** (Lines 62–71):
```javascript
// Step 2: Check nonce (replay protection)
if (decoded.nonce) {
  if (usedNonces.has(decoded.nonce)) {
    return { success: false, error: 'SSO token already used (replay detected).' };
  }
  usedNonces.add(decoded.nonce);
  if (usedNonces.size > 10000) {
    const arr = Array.from(usedNonces);
    arr.splice(0, 5000).forEach((n) => usedNonces.delete(n));
  }
}
```

### Why It Is a Production Blocker

The nonce store exists purely in the process memory of a single Node.js instance.

### Replay Risk

An attacker who intercepts an SSO token (e.g., via network sniffing, shared computer, browser history) can replay it within the 120-second validity window. On a single instance, the nonce Set catches this. But:

1. If the process restarts (deploy, crash, OOM kill), the Set is wiped. All previously-used nonces become valid again.
2. The cleanup logic (lines 68–70) aggressively prunes 5000 entries when hitting 10000. Recently-used nonces get deleted, reopening the replay window.

### Cluster Risk

With 2+ instances behind a load balancer:
- Instance A receives SSO token with nonce `abc123` → adds to its Set → returns JWT
- Instance B has never seen nonce `abc123` → accepts the same SSO token → issues a SECOND valid JWT
- Attacker now has two active sessions from one SSO launch

### Recommended Production Implementation

```javascript
// Option A: Redis (preferred for multi-instance)
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

async function checkAndStoreNonce(nonce) {
  // SET with NX (only if not exists) + EX (120s TTL matching token maxAge)
  const result = await redis.set(`sso:nonce:${nonce}`, '1', 'EX', 120, 'NX');
  return result === 'OK'; // true = new nonce, false = replay
}

// Option B: Supabase table (no Redis required)
// INSERT into sso_nonces (nonce, expires_at) VALUES ($1, NOW() + interval '120 seconds')
// ON CONFLICT DO NOTHING — if affected rows = 0, it's a replay
```

### Classification: **CRITICAL**

| Question | Answer |
|----------|--------|
| Can be fixed without DB schema change? | YES (Redis) or minimal change (1 new table) |
| Affects Main Site integration? | YES — Main Site generates SSO tokens. If replay works, unauthorized terminal access is possible from intercepted tokens |
| Affects Admin integration? | NO — Admin uses provisioning API key, not SSO |

---

## BLOCKER 2 — CREDENTIAL STORAGE

### Current Implementation

**File**: `server/services/provisioningService.js`  
**Function**: `_createTradingAccount()`  
**Lines**: 317–322  
**Code**:
```javascript
// Store credentials encrypted (base64 for now — swap to real encryption in production)
const credentialsPayload = JSON.stringify({
  loginId: credentials.loginId,
  passwordHash: credentials.passwordHash,
  createdAt: new Date().toISOString(),
});
const credentialsEncrypted = Buffer.from(credentialsPayload).toString('base64');
```

**Storage**: Written to `trading_accounts.broker_credentials_encrypted` column.

### Why It Is a Production Blocker

Base64 is **encoding**, not encryption. Anyone with database read access (including Supabase dashboard users, leaked service keys, SQL injection, or a data breach) can decode it instantly:

```javascript
Buffer.from(credentialsEncrypted, 'base64').toString() 
// → {"loginId":"FW10K1A2B3C4D","passwordHash":"abc...","createdAt":"..."}
```

The `passwordHash` is a SHA-256 hash (not bcrypt/scrypt), which while not reversible, combined with the `loginId` gives enough to authenticate if the system accepts hash-based auth.

### Encryption Status

- **Current**: Base64 encoding (trivially reversible)
- **Required**: AES-256-GCM with envelope encryption
- **Column name says "encrypted"** but content is NOT encrypted — this is a semantic lie in the schema

### Production-Safe Approach

```javascript
import crypto from 'crypto';

const KEY = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY, 'hex'); // 32 bytes

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store: iv + tag + ciphertext (all base64)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(encoded) {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ciphertext = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}
```

### Classification: **HIGH**

| Question | Answer |
|----------|--------|
| Can be fixed without DB schema change? | YES — same column, different content format |
| Affects Main Site integration? | NO — Main Site never reads broker_credentials_encrypted |
| Affects Admin integration? | NO — Admin doesn't decrypt credentials directly |

---

## BLOCKER 3 — SESSION VALIDATION

### Where Sessions Are Created

**File**: `server/services/session.service.js`  
**Function**: `createSession()`  
**Lines**: 16–37  
```javascript
export async function createSession({ traderId, accountId, token, ipAddress, userAgent, deviceFingerprint }) {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('terminal_sessions').insert({
    trader_id: traderId,
    token_hash: tokenHash,
    is_active: true,
    expires_at: expiresAt,
    ...
  });
}
```

### Where Sessions Are Validated (THE GAP)

**File**: `server/middleware/auth.js`  
**Function**: `requireAuth()`  
**Lines**: 40–58  
```javascript
const result = verifySessionJWT(token);

if (!result.valid) {
  return res.status(401).json({ ... });
}

// Attach user claims to request
req.user = result.claims;
req.token = token;
next();  // ← PASSES THROUGH WITHOUT CHECKING SESSION DB
```

**Critical observation**: Line 15 imports `isSessionValid` but **NEVER CALLS IT**:
```javascript
import { isSessionValid } from '../services/session.service.js';
```

The import exists. The function exists. It is never invoked in the request pipeline.

### Why Revoked Sessions Remain Usable

1. User logs out → `revokeSession()` sets `is_active = false` in `terminal_sessions`
2. JWT remains cryptographically valid (signature OK, not expired)
3. Next API request: `requireAuth()` calls `verifySessionJWT()` → signature valid → **PASSES**
4. `isSessionValid()` is never called → revoked session is invisible to the middleware
5. User retains full access for up to **24 hours** (JWT_EXPIRY)

### Real-World Impact

- Admin suspends a user → user keeps trading for 24 hours
- User logs out on a shared computer → the session cookie still works
- Account is breached/locked → user can still call APIs (though risk engine may separately block orders)

### Required Changes

```javascript
// In server/middleware/auth.js, after verifySessionJWT succeeds:
const result = verifySessionJWT(token);
if (!result.valid) { return res.status(401).json({ ... }); }

// ADD THIS — check if session is still active in DB
const sessionActive = await isSessionValid(token);
if (!sessionActive) {
  return res.status(401).json({
    error: 'session_revoked',
    message: 'Session has been revoked. Please re-open terminal from Dashboard.',
  });
}

req.user = result.claims;
req.token = token;
next();
```

**Performance note**: This adds 1 DB query per request. Mitigate with:
- Redis session cache (TTL 60s)
- Or check every Nth request (e.g., every 10th)
- Or check only on write operations (orders, position exits)

### Classification: **CRITICAL**

| Question | Answer |
|----------|--------|
| Can be fixed without DB schema change? | YES — session table already exists with is_active column |
| Affects Main Site integration? | YES — if Main Site revokes a user (ban/suspend), the terminal session must die |
| Affects Admin integration? | YES — Admin locking an account should immediately invalidate sessions |

---

## BLOCKER 4 — BROKER FEED RECONNECT

### Current Reconnect Logic

**File**: `server/brokers/angelone/angel.feed.connector.js`  
**Function**: `_attemptReconnect()`  
**Lines**: 316–336  
```javascript
_attemptReconnect() {
  if (this.reconnectAttempts >= this.maxReconnects) {
    console.error('[AngelFeed] Max reconnect attempts reached — restarting from scratch in 60s');
    this.reconnectAttempts = 0;
    this._reconnectTimer = setTimeout(() => this._attemptReconnect(), 60000);
    return;
  }
  this.reconnectAttempts++;
  const baseDelay = this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts - 1, 5));
  const delay = Math.min(baseDelay, this.maxReconnectDelay || 30000) + Math.random() * 1000;
  this._reconnectTimer = setTimeout(async () => {
    try {
      await this.login();
      await this.connect();
    } catch (err) {
      this._attemptReconnect();
    }
  }, delay);
}
```

**Trigger** (Lines 270–275):
```javascript
this.ws.on('close', (code, reason) => {
  this.isConnected = false;
  this._stopHeartbeat();
  console.warn(`[AngelFeed] WebSocket closed: code=${code} reason=${reason?.toString() || ''}`);
  this._attemptReconnect();
});
```

### What EXISTS (Partial Credit)

1. ✅ Exponential backoff with jitter (1.5x base, capped at 30s)
2. ✅ Heartbeat (ping every 25s)
3. ✅ Re-login on reconnect (token may have expired)
4. ✅ Resubscribe all tokens after reconnect (`_resubscribeAll()`)
5. ✅ Max 50 attempts before 60s cool-off then restart

### Missing Scenarios (The Blocker)

| Scenario | Current Behavior | Required Behavior |
|----------|-----------------|-------------------|
| Feed drops during market hours | Reconnects silently. No event emitted. | Should emit `risk.alert` with severity 'critical' so frontend shows "FEED DISCONNECTED" |
| Feed stale (connected but no ticks for >60s) | Not detected. MarketDataEngine still reports `isLive = true` | Need a staleness watchdog: if no ticks for 60s, mark feed as stale |
| Reconnect succeeds but subscriptions fail | No error handling on `_resubscribeAll()` | Should retry subscriptions or alert |
| All 50 reconnects fail | Logs error, waits 60s, tries again forever | Should emit a critical health alert and notify admin (webhook/email) |

### Impact on Risk Engine

When the feed is disconnected or stale:

1. `RiskEngine.postTradeCheck()` calls `positionRepo.getTotalUnrealizedPnl(accountId, quoteProvider)`
2. `quoteProvider` returns `this.marketDataEngine.getQuote(token)?.ltp || 0`
3. If feed is down, cached LTP is stale. If very old, it may be from a different price level.
4. **Daily loss calculation uses stale LTP** → user may actually be breached but system doesn't know
5. **Drawdown calculation uses stale LTP** → user may have exceeded max drawdown unknowingly

### Impact on Challenge Rules

1. `checkDailyLossLimit()` (pre-trade) uses `unrealizedPnl` from `positionRepo.getTotalUnrealizedPnl()` which relies on LTP
2. If LTP is stale (e.g., price dropped 5% but feed shows old price), the pre-trade check **incorrectly approves** the order
3. Post-trade check will also use stale LTP, missing the breach until feed reconnects
4. **Challenge could fail to auto-lock during a feed outage**, allowing the user to continue trading past breach

### Classification: **HIGH**

| Question | Answer |
|----------|--------|
| Can be fixed without DB schema change? | YES — purely application logic + event bus |
| Affects Main Site integration? | NO — Main Site doesn't depend on market data feed |
| Affects Admin integration? | YES — Admin should see feed health status. Currently available via /health endpoint but no proactive alert on disconnect |

---

## BLOCKER 5 — BACKEND TESTS

### Current Test Coverage

**Location**: `tests/` directory (root level)  
**Test Runner**: vitest (configured in root package.json)

| Test File | What It Tests | Backend Server Logic? |
|-----------|--------------|----------------------|
| `order-flow-integration.test.tsx` | Frontend store + API mocks | ❌ NO — mocks `@/services/api`, tests Zustand store |
| `kill-switch-integration.test.ts` | Frontend store logic | ❌ NO — tests in-memory kill switch algorithm |
| `kill-switch-integration.test.tsx` | Frontend rendering + store | ❌ NO — React component test |
| `risk-engine-pbt.test.ts` | Property-based risk rules | ⚠️ PARTIAL — tests a **local re-implementation** of rules (not the actual `server/services/riskEngine.js`) |
| `position-sizing-pbt.test.ts` | Position sizing formulas | ⚠️ PARTIAL — tests math only, not server integration |
| `order-flow-integration.spec.js` | Playwright E2E | ⚠️ PARTIAL — browser-level, requires running server |
| `risk-certification.spec.js` | Playwright E2E | ⚠️ PARTIAL — browser-level |
| `websocket-lifecycle.spec.js` | Playwright E2E | ⚠️ PARTIAL — browser-level |
| `execution-proof.spec.js` | Playwright E2E | ⚠️ PARTIAL — browser-level |

**Server-side directory**: `server/test-schema.js` — NOT a test file. Just a DB schema inspection utility.

### Critical Workflows With NO Automated Server Tests

| Workflow | Has Unit/Integration Test? | Evidence |
|----------|---------------------------|----------|
| SSO Login (`validateSSOToken`) | ❌ **NO** | No test file imports or calls `sso.service.js` |
| Auth Middleware (`requireAuth`) | ❌ **NO** | No test verifies JWT rejection, dev bypass, permission checks |
| Risk Engine (`RiskEngine.validateOrder`) | ❌ **NO** | `risk-engine-pbt.test.ts` re-implements logic locally; does NOT import `server/services/riskEngine.js` |
| Order Execution (`executeOrder`) | ❌ **NO** | No test verifies the full pipeline: risk → broker → position → trade |
| Broker Sync (`AngelOneAdapter.*`) | ❌ **NO** | No test for login, token refresh, order placement, error handling |
| Risk Post-Trade (`postTradeCheck`) | ❌ **NO** | No test verifies daily loss breach → account lock |
| Challenge Pass Logic | ❌ **NO** | No test for `checkTransitions()` when profit target is met + min days satisfied |
| Challenge Fail Logic | ❌ **NO** | No test for `checkTransitions()` when max drawdown is breached |
| Account Lock (`lockAccount`) | ❌ **NO** | No test for `postTradeCheck()` → `accountRepo.lockAccount()` |
| Phase Promotion (`promoteToNextPhase`) | ❌ **NO** | No test for Phase 1 pass → Phase 2 creation → rule seeding |
| Provisioning (`provisionAccount`) | ❌ **NO** | No test for full provisioning flow (trader + challenge + account + rules) |
| Session Revocation | ❌ **NO** | No test for logout → session invalidation |
| Daily Cron Checks | ❌ **NO** | No test for `runDailyChecks()` unlock logic |

### Why This Is a Production Blocker

1. **Financial system with no regression safety** — A single bad deploy could:
   - Break risk checks → unlimited trading → real money losses
   - Break account lock → breached users continue trading
   - Break provisioning → paid users don't get accounts
   - Break SSO → all users locked out

2. **Property-based tests exist but test LOCAL re-implementations** — The `risk-engine-pbt.test.ts` file defines its own `RiskEngine` class inline (interfaces + pure functions). It does NOT import or test the actual server code at `server/services/riskEngine.js`. If the real engine diverges from the test's local copy, the tests still pass while production breaks.

3. **E2E tests (Playwright .spec.js files) require a running server** — They test the browser layer, not the server logic. They cannot run in CI without a full environment (Supabase, broker credentials).

### Classification: **HIGH**

| Question | Answer |
|----------|--------|
| Can be fixed without DB schema change? | YES — purely adding test files |
| Affects Main Site integration? | INDIRECTLY — untested provisioning could silently break |
| Affects Admin integration? | INDIRECTLY — untested lock/unlock could cause admin actions to fail |

---

## CLASSIFICATION SUMMARY

| Blocker | Severity | Reason |
|---------|----------|--------|
| 1. SSO Nonce In-Memory | **CRITICAL** | Enables session hijacking via replay in multi-instance or after restart |
| 2. Credential Storage | **HIGH** | Data breach exposes all credentials in plaintext (but requires DB access first) |
| 3. Session Validation | **CRITICAL** | Revoked/locked users retain full API access for up to 24 hours |
| 4. Broker Feed Reconnect | **HIGH** | Risk engine uses stale prices during outage, potentially missing breaches |
| 5. Backend Tests | **HIGH** | No regression safety for financial logic; any deploy could break risk enforcement |

---

## FINAL ANSWER

### Can Main Site + Admin + Terminal be merged after fixing ONLY these 5 blockers?

# YES

**Evidence:**

After these 5 blockers are fixed:

1. **SSO flow is complete** — `sso.service.js` validates tokens, creates sessions, issues terminal JWT. Main Site generates SSO tokens via `generateSSOToken()`. The handoff protocol is implemented.

2. **Provisioning flow is complete** — Main Site calls `POST /provisioning/provision` with API key. Service creates trader + challenge + account + rules + logs. Callback to Website via `WebsiteCallbackClient.notifyProvisioned()` exists.

3. **Admin visibility is complete** — All data is in Supabase (shared database). challenge_accounts, trading_accounts, risk_events, execution_audits, kill_switch_logs are all queryable. /health endpoint provides live system status.

4. **Rule engine is server-side and not bypassable** — All 19 implemented rules run in `riskEngine.js` on the server. Client cannot skip them. Pre-trade AND post-trade checks are in place.

5. **Account lifecycle is automated** — Lock on daily loss breach, breach on max drawdown, pass on profit target + min days, promotion to next phase, expiry check — all implemented and event-driven.

6. **No remaining architectural gaps** exist between the three systems. The Terminal is a standalone backend that the Main Site launches via SSO and provisions via API. Admin reads from the shared Supabase database.

**The 5 blockers are security/reliability hardening issues, not missing features or broken integrations.**
