/**
 * SSO SERVICE
 * 
 * Handles the FundedWealth Dashboard → Terminal SSO flow.
 * 
 * Flow:
 * 1. Dashboard generates signed SSO token with user/account info
 * 2. User redirected to terminal.fundedwealth.com/auth/sso?token=<token>
 * 3. This service validates the SSO token
 * 4. If valid: looks up/creates terminal_trader, creates terminal session, returns JWT
 * 5. If invalid: returns error
 * 
 * Identity table: terminal_traders (external_id = website user id)
 * Session table: terminal_sessions
 * 
 * SSO Token Format (signed JWT from Dashboard):
 * {
 *   sub: "fw_user_id",        — website user identifier
 *   accountId: "uuid",        — trading_accounts.id
 *   challengeId: "uuid",      — challenge_accounts.id
 *   email: "user@example.com",
 *   name: "User Name",
 *   nonce: "random-string",
 *   iat: timestamp,
 *   exp: timestamp (short-lived, ~60 seconds)
 * }
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabase } from '../db/client.js';
import { generateSessionJWT } from './auth.service.js';
import { createSession } from './session.service.js';
import { NonceStore } from './nonceStore.js';
import { config } from 'dotenv';

config();

const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET;
if (!SSO_SHARED_SECRET) {
  throw new Error('FATAL: SSO_SHARED_SECRET environment variable is required. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}

// Nonce store — uses Redis (SET NX EX) when available, Supabase fallback, in-memory last resort
const nonceStore = new NonceStore();

/**
 * Validate an SSO token from FundedWealth Dashboard.
 * Returns terminal JWT if valid, error if not.
 */
export async function validateSSOToken(ssoToken, { ipAddress, userAgent } = {}) {
  // Step 1: Verify SSO token signature and expiry
  let decoded;
  try {
    decoded = jwt.verify(ssoToken, SSO_SHARED_SECRET, { maxAge: '120s' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { success: false, error: 'SSO token expired. Please try again from Dashboard.' };
    }
    return { success: false, error: 'Invalid SSO token signature.' };
  }

  // Step 2: Check nonce (replay protection via Redis SET NX EX)
  if (decoded.nonce) {
    const isNew = await nonceStore.checkAndStore(decoded.nonce, 120);
    if (!isNew) {
      return { success: false, error: 'SSO token already used (replay detected).' };
    }
  }

  // Step 3: Extract claims
  const externalUserId = decoded.sub;
  const accountId = decoded.accountId;
  const challengeId = decoded.challengeId;
  const email = decoded.email;
  const name = decoded.name;

  if (!externalUserId || !accountId) {
    return { success: false, error: 'SSO token missing required claims (sub, accountId).' };
  }

  // Step 4: Lookup or create terminal_trader by external_id
  let trader = null;
  if (supabase) {
    // Find by external_id (= website user id)
    const { data, error } = await supabase
      .from('terminal_traders')
      .select('*')
      .eq('external_id', externalUserId)
      .single();

    if (error && error.code === 'PGRST116') {
      // Not found — create terminal_trader (first-time SSO)
      const { data: newTrader, error: createErr } = await supabase
        .from('terminal_traders')
        .insert({
          external_id: externalUserId,
          email: email || `${externalUserId}@terminal.local`,
          display_name: name || 'Trader',
          status: 'active',
          preferences: {},
          last_login_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createErr) {
        return { success: false, error: `Failed to create terminal trader: ${createErr.message}` };
      }
      trader = newTrader;
    } else if (error) {
      // Schema cache or other DB error
      if (error.message && error.message.includes('schema cache')) {
        trader = { id: externalUserId, external_id: externalUserId, display_name: 'Dev User', status: 'active' };
      } else {
        return { success: false, error: 'Terminal trader lookup failed.' };
      }
    } else {
      if (data.status === 'suspended' || data.status === 'banned') {
        return { success: false, error: `Account is ${data.status}.` };
      }
      trader = data;
      // Update last_login_at
      await supabase.from('terminal_traders').update({ last_login_at: new Date().toISOString() }).eq('id', trader.id);
    }
  } else {
    // Dev mode without Supabase
    trader = { id: externalUserId, external_id: externalUserId, display_name: 'Dev User', status: 'active' };
  }

  // Step 5: Lookup trading account
  let account = null;
  if (supabase) {
    const { data, error } = await supabase
      .from('trading_accounts')
      .select('id, account_code, challenge_id, broker_provider, balance, status')
      .eq('id', accountId)
      .eq('trader_id', trader.id)
      .single();

    if (error || !data) {
      if (error && error.message && error.message.includes('schema cache')) {
        account = { id: accountId, account_code: 'FW-DEV', broker_provider: 'paper', status: 'active' };
      } else {
        return { success: false, error: 'Trading account not found.' };
      }
    } else {
      if (data.status !== 'active') {
        return { success: false, error: `Trading account is ${data.status}. Cannot trade.` };
      }
      account = data;
    }
  } else {
    account = { id: accountId, account_code: 'FW-DEV', broker_provider: 'paper', status: 'active' };
  }

  // Step 6: Generate terminal session JWT
  const terminalJWT = generateSessionJWT({
    userId: trader.id,
    accountId: account.id,
    challengeId: challengeId || account.challenge_id,
    accountCode: account.account_code,
    brokerProvider: account.broker_provider,
    permissions: ['trade', 'view_positions', 'view_orders'],
  });

  // Step 7: Persist session + enforce concurrent session limit
  const { enforceSessionLimit } = await import('./session.service.js');
  await enforceSessionLimit(trader.id, 3); // Max 3 concurrent sessions per trader

  await createSession({
    traderId: trader.id,
    accountId: account.id,
    token: terminalJWT,
    ipAddress,
    userAgent,
  });

  return {
    success: true,
    jwt: terminalJWT,
    account: {
      id: account.id,
      code: account.account_code,
      broker: account.broker_provider,
    },
    user: {
      id: trader.id,
      name: trader.display_name,
    },
  };
}

/**
 * Generate an SSO token for a given user/account.
 * In production, called by the /auth/sso/generate endpoint (main site backend → terminal).
 * In development, also used by /auth/dev/generate-sso.
 */
export function generateSSOToken(payload) {
  return jwt.sign(
    {
      sub: payload.fwUserId,
      accountId: payload.accountId,
      challengeId: payload.challengeId || null,
      email: payload.email || null,
      name: payload.name || null,
      nonce: crypto.randomUUID(),
    },
    SSO_SHARED_SECRET,
    { expiresIn: '60s' }
  );
}

/**
 * @deprecated Use generateSSOToken instead. Kept for backwards compatibility.
 */
export const generateTestSSOToken = generateSSOToken;
