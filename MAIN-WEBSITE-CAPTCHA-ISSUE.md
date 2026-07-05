# MAIN WEBSITE CAPTCHA ISSUE

**Date:** 2026-01-XX  
**Location:** fundedwealth.com/sign-in (Main Website)  
**Error:** "CAPTCHA failed to load. Please refresh the page."  
**Captcha Provider:** Cloudflare Turnstile  
**Console Error:** `[Cloudflare Turnstile] Error: 40002`

---

## IMPORTANT

⚠️ **This is NOT a Terminal issue.**

The error occurs on the **Main Website** (fundedwealth.com), not the Terminal (terminal.fundedwealth.com).

The Terminal has **NO captcha implementation** and uses SSO authentication from the Main Website.

---

## ERROR DETAILS

### Screenshot Analysis

**Page:** `fundedwealth.com/sign-in`  
**Error Message:** "CAPTCHA failed to load. Please refresh the page."  
**Console Errors:**
```
[Cloudflare Turnstile] Error: 40002
Failed to execute 'postMessage' on 'Window'
Failed to load resource: the server responded with 40002
```

### Cloudflare Turnstile Error Code 40002

**Error Code:** `40002`  
**Meaning:** Invalid Site Key or Domain Mismatch

**Common Causes:**
1. Site key doesn't match the domain (fundedwealth.com)
2. Wrong environment (dev key used in production, or vice versa)
3. Site key hasn't been activated yet
4. Domain not added to Cloudflare Turnstile allowed domains

---

## ROOT CAUSES

### 1. **Wrong Turnstile Site Key** ⚠️ HIGH PROBABILITY

The Main Website is using a Cloudflare Turnstile site key that doesn't match the domain.

**Fix (Main Website Code):**
```javascript
// WRONG - Using wrong site key
<Turnstile siteKey="1x00000000000000000000AA" />

// CORRECT - Use the correct site key for fundedwealth.com
<Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
```

**Verification:**
1. Go to Cloudflare Dashboard → Turnstile
2. Check the site key for fundedwealth.com
3. Verify it matches the key in Main Website code
4. Check if domain is in "Allowed Domains" list

---

### 2. **Development Key in Production** ⚠️ MEDIUM PROBABILITY

The Main Website is using a development/localhost Turnstile key in production.

**Fix:**
- Get a production Turnstile site key from Cloudflare
- Set it in Main Website environment variables
- Redeploy Main Website

---

### 3. **Domain Not Whitelisted** ⚠️ MEDIUM PROBABILITY

The Turnstile site key is configured for a different domain (e.g., `www.fundedwealth.com` instead of `fundedwealth.com`).

**Fix:**
1. Log in to Cloudflare Dashboard
2. Go to Turnstile → Your Site
3. Add both domains:
   - `fundedwealth.com`
   - `www.fundedwealth.com`
4. Save changes

---

### 4. **Expired or Inactive Site Key** ⚠️ LOW PROBABILITY

The Turnstile site key expired or was deactivated.

**Fix:**
- Create a new Turnstile site in Cloudflare Dashboard
- Update Main Website environment variables
- Redeploy

---

## VERIFICATION STEPS

### Step 1: Check Cloudflare Turnstile Dashboard

```
1. Log in to Cloudflare Dashboard
2. Go to Turnstile section
3. Find the site for fundedwealth.com
4. Verify:
   ✓ Site is active
   ✓ Domain matches (fundedwealth.com)
   ✓ Site key is correct
   ✓ No errors or warnings
```

### Step 2: Check Main Website Environment Variables

```bash
# SSH into Main Website server
ssh fundedwealth.com

# Check environment variables
echo $NEXT_PUBLIC_TURNSTILE_SITE_KEY
# OR
echo $REACT_APP_TURNSTILE_SITE_KEY
# OR
echo $VITE_TURNSTILE_SITE_KEY
```

### Step 3: Check Main Website Code

Look for Turnstile integration in the login page:

```javascript
// Likely location: pages/sign-in.tsx or components/LoginForm.tsx
import { Turnstile } from '@marsidev/react-turnstile';

<Turnstile
  siteKey="YOUR_SITE_KEY_HERE"  // ← Check this value
  onSuccess={(token) => handleCaptcha(token)}
/>
```

### Step 4: Test with Different Turnstile Site Key

If you have access to Main Website code:

```javascript
// Temporarily hardcode a known-good site key for testing
<Turnstile
  siteKey="1x00000000000000000000AA"  // ← Use test key
  onSuccess={(token) => console.log('Captcha OK:', token)}
/>
```

---

## TEMPORARY WORKAROUND (DISABLE CAPTCHA)

If you need to unblock users immediately, **temporarily disable captcha** on the Main Website:

### Option 1: Environment Flag (Recommended)

```javascript
// In Main Website code
const CAPTCHA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_CAPTCHA === 'true';

{CAPTCHA_ENABLED && (
  <Turnstile
    siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
    onSuccess={handleCaptcha}
  />
)}
```

Then set:
```bash
NEXT_PUBLIC_ENABLE_CAPTCHA=false
```

### Option 2: Comment Out Captcha (Quick Fix)

```javascript
// Temporarily comment out captcha
{/* <Turnstile siteKey="..." onSuccess={...} /> */}

// Skip captcha validation
const handleSubmit = async () => {
  // const captchaToken = await getCaptchaToken();  // ← Comment out
  const response = await fetch('/api/login', {
    body: JSON.stringify({ email, password /* , captchaToken */ })
  });
};
```

---

## RESOLUTION CHECKLIST

- [ ] **Cloudflare:** Verify Turnstile site exists for fundedwealth.com
- [ ] **Cloudflare:** Verify domain is in "Allowed Domains" list
- [ ] **Cloudflare:** Site key is active (not expired)
- [ ] **Main Website:** TURNSTILE_SITE_KEY env var matches Cloudflare
- [ ] **Main Website:** Using production site key (not test key)
- [ ] **Main Website:** Turnstile component has correct siteKey prop
- [ ] **Main Website:** Captcha library is installed (`@marsidev/react-turnstile` or similar)
- [ ] **Network:** No firewall blocking Cloudflare Turnstile domain

---

## TERMINAL IMPACT

### Does This Affect Terminal Launch?

**YES, indirectly.**

```
User visits fundedwealth.com
  ↓
User tries to login
  ✗ BLOCKED by captcha error
  ↓
Cannot login to Dashboard
  ↓
Cannot click "Launch Terminal" button
  ✗ CANNOT ACCESS TERMINAL
```

**However**, if the user is already logged in to the Main Website Dashboard, they can still launch the Terminal without encountering this captcha error.

### Terminal SSO Flow (No Captcha)

Once the user is past the Main Website login:

```
User clicks "Launch Terminal" (Dashboard)
  ↓
Main Website Backend → Terminal API
  POST /auth/sso/generate
  ↓
Terminal generates SSO token
  ↓
User redirected to Terminal
  ↓
Terminal validates SSO token
  ↓
Terminal Home (NO CAPTCHA)
```

---

## RECOMMENDATION

### Immediate Action (Choose One)

**Option A: Fix Turnstile (Recommended)**
1. Verify Cloudflare Turnstile site key
2. Update Main Website environment variables
3. Redeploy Main Website
4. Test login page

**Option B: Temporarily Disable Captcha (Quick Fix)**
1. Set `ENABLE_CAPTCHA=false` in Main Website env
2. Redeploy Main Website
3. Users can login without captcha
4. Fix Turnstile later

### Long-Term Solution

1. ✅ Use Cloudflare Turnstile with correct site key
2. ✅ Add both `fundedwealth.com` and `www.fundedwealth.com` to allowed domains
3. ✅ Use environment variables for site key (not hardcoded)
4. ✅ Add error handling for captcha load failures
5. ✅ Add fallback (e.g., email verification link if captcha fails)

---

## TERMINAL CODEBASE STATUS

✅ **Terminal has NO captcha implementation**  
✅ **Terminal uses SSO authentication**  
✅ **No changes needed in Terminal codebase**

This is a **Main Website issue only**.

---

## NEXT STEPS

1. **Access Main Website codebase** (fundedwealth.com repository)
2. **Check Cloudflare Turnstile Dashboard** for site key
3. **Verify Main Website environment variables**
4. **Apply fix** (update site key or disable captcha)
5. **Test login flow** before re-enabling

---

## FILES INVOLVED

### Main Website (NOT in this repo)

| File | Location | Purpose |
|------|----------|---------|
| Login Page | `pages/sign-in.tsx` or similar | Contains Turnstile component |
| Environment | `.env` or `.env.production` | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Login API | `api/auth/login` or similar | Validates captcha token |

### Terminal (This repo)

| Status | Notes |
|--------|-------|
| ✅ No changes needed | Terminal has no captcha |
| ✅ SSO flow unaffected | Once user passes Main Website login |

---

## CONCLUSION

⚠️ **This is a Main Website issue, not a Terminal issue.**

The captcha error (`[Cloudflare Turnstile] Error: 40002`) occurs on the **Main Website login page** (fundedwealth.com/sign-in).

**Root Cause:** Invalid or misconfigured Cloudflare Turnstile site key on the Main Website.

**Impact:** Users cannot login to Main Website Dashboard, so they cannot click "Launch Terminal" button.

**Fix Location:** Main Website codebase (NOT Terminal)

**Terminal Status:** ✅ No action required in Terminal codebase
