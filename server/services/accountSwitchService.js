/**
 * ACCOUNT SWITCH SERVICE
 *
 * Stores per-session active account overrides in memory.
 * When a user switches accounts inside the terminal, the override is stored
 * here keyed by tokenHash. The auth middleware checks this map and injects
 * the override into req.user.accountId before any route handler runs.
 *
 * This does NOT issue a new JWT — the session cookie stays the same.
 * Security: ownership is verified before the override is accepted.
 */

import { hashToken } from './auth.service.js';
import { supabase } from '../db/client.js';

// tokenHash → { accountId, accountCode, switchedAt }
const overrides = new Map();

/**
 * Validate that the given accountId belongs to the trader and is active.
 * Returns the account row on success, null on failure.
 */
async function verifyOwnership(traderId, accountId) {
  if (!supabase) return { id: accountId, account_code: 'FW-DEV', status: 'active' };

  const { data, error } = await supabase
    .from('trading_accounts')
    .select('id, account_code, status')
    .eq('id', accountId)
    .eq('trader_id', traderId)
    .single();

  if (error || !data) return null;

  const allowed = ['active'];
  if (!allowed.includes(data.status)) return null;

  return data;
}

/**
 * Set the active account for a session.
 * @param {string} token  - raw fw_session token
 * @param {string} traderId
 * @param {string} accountId - trading_accounts.id to switch to
 * @returns {{ success, accountId, accountCode } | { success: false, error }}
 */
export async function switchAccount(token, traderId, accountId) {
  const account = await verifyOwnership(traderId, accountId);
  if (!account) {
    return { success: false, error: 'Account not found or not owned by this user.' };
  }

  const tokenHash = hashToken(token);
  overrides.set(tokenHash, {
    accountId: account.id,
    accountCode: account.account_code,
    switchedAt: Date.now(),
  });

  return { success: true, accountId: account.id, accountCode: account.account_code };
}

/**
 * Get the active account override for a token hash, if any.
 * Returns null if no override exists.
 */
export function getOverride(tokenHash) {
  return overrides.get(tokenHash) || null;
}

/**
 * Clear the override for a session (on logout).
 */
export function clearOverride(tokenHash) {
  overrides.delete(tokenHash);
}
