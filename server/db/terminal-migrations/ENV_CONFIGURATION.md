# Terminal Environment Configuration

**Date:** 2026-06-20  
**Purpose:** Document all required and optional environment variables for the terminal database integration.

---

## Required Environment Variables

These MUST be set before the terminal server can connect to the database.

```env
# ─── SUPABASE DATABASE (REQUIRED) ───
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your-service-role-key-here

# ─── AUTHENTICATION (REQUIRED) ───
JWT_SECRET=your-256-bit-terminal-jwt-secret
SSO_SHARED_SECRET=your-256-bit-sso-shared-secret-same-as-dashboard

# ─── FUNDEDWEALTH DASHBOARD (REQUIRED) ───
FW_DASHBOARD_URL=https://fundedwealth.com
```

---

## Optional Environment Variables

```env
# ─── SERVER ───
PORT=4000
NODE_ENV=development
JWT_EXPIRY=24h
ADMIN_SECRET=your-admin-secret-for-cron-triggers
FRONTEND_URL=http://localhost:3000

# ─── DEVELOPMENT ONLY ───
DEV_BYPASS_AUTH=true

# ─── REDIS (Multi-instance pub/sub) ───
REDIS_URL=redis://localhost:6379

# ─── BROKER CREDENTIALS (Required for live trading) ───
ANGEL_API_KEY=your-angel-api-key
ANGEL_CLIENT_ID=your-angel-client-id
ANGEL_PASSWORD=your-angel-password
ANGEL_TOTP_SECRET=your-angel-totp-secret
DHAN_ACCESS_TOKEN=your-dhan-token
DHAN_CLIENT_ID=your-dhan-client-id
```

---

## Where to Get Values

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase Dashboard → Settings → API → Service Role Key (starts with `eyJ`) |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `SSO_SHARED_SECRET` | Must match FundedWealth Dashboard config (shared secret for SSO token exchange) |
| `FW_DASHBOARD_URL` | Production: `https://fundedwealth.com` |
| `ANGEL_API_KEY` | Angel One Developer Portal → Your App → API Key |
| `ANGEL_CLIENT_ID` | Angel One account client ID |
| `ANGEL_TOTP_SECRET` | Angel One → Enable TOTP → Secret key |

---

## Verification

After setting environment variables, verify connection:

```bash
# Start server
node server/index.js

# Check health
curl http://localhost:4000/health
```

Expected response:
```json
{
  "status": "ok",
  "database": {
    "connected": true
  }
}
```

---

## Security Notes

1. **NEVER commit `.env` files** — they are in `.gitignore`
2. **Service Role Key** bypasses Row Level Security — keep it server-side only
3. **JWT_SECRET** must be unique per environment (dev/staging/prod)
4. **SSO_SHARED_SECRET** must be synchronized between FW Dashboard and Terminal
5. Use different secrets for development vs production
