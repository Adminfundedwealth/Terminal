/**
 * SESSION SERVICE
 * 
 * Manages terminal sessions in the terminal_sessions table.
 * Sessions are created on SSO login, revoked on logout.
 * 
 * Table: terminal_sessions
 * Columns: id, trader_id, token_hash, refresh_token_hash, device_fingerprint,
 *          ip_address, user_agent, is_active, created_at, expires_at,
 *          last_activity_at, revoked_at, revoke_reason
 */

import { supabase } from '../db/client.js';
import { hashToken } from './auth.service.js';

/**
 * Create a new session record in terminal_sessions.
 * Called after successful SSO validation and JWT generation.
 */
export async function createSession({ traderId, accountId, token, ipAddress, userAgent, deviceFingerprint }) {
  if (!supabase) {
    console.warn('[Session] Supabase not configured — session not persisted');
    return { id: null };
  }

  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  const { data, error } = await supabase
    .from('terminal_sessions')
    .insert({
      trader_id: traderId,
      token_hash: tokenHash,
      device_fingerprint: deviceFingerprint || null,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      is_active: true,
      expires_at: expiresAt,
      last_activity_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Session] Failed to create session:', error.message);
    return { id: null, error: error.message };
  }

  return { id: data.id };
}

/**
 * Revoke a session (logout).
 * Sets revoked_at + is_active = false.
 */
export async function revokeSession(tokenHash) {
  if (!supabase) return;

  const { error } = await supabase
    .from('terminal_sessions')
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoke_reason: 'logout',
    })
    .eq('token_hash', tokenHash)
    .eq('is_active', true);

  if (error) {
    console.error('[Session] Failed to revoke session:', error.message);
  }
}

/**
 * Revoke all sessions for a trader (force logout everywhere).
 */
export async function revokeAllTraderSessions(traderId) {
  if (!supabase) return;

  const { error } = await supabase
    .from('terminal_sessions')
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoke_reason: 'force_logout_all',
    })
    .eq('trader_id', traderId)
    .eq('is_active', true);

  if (error) {
    console.error('[Session] Failed to revoke all sessions:', error.message);
  }
}

/**
 * Check if a session token hash is still valid (active, not expired).
 */
export async function isSessionValid(token) {
  if (!supabase) return false; // PRODUCTION: Fail-closed. No DB = no valid sessions.

  const tokenHash = hashToken(token);

  const { data, error } = await supabase
    .from('terminal_sessions')
    .select('id, expires_at, is_active')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .single();

  if (error || !data) return false;

  return new Date(data.expires_at) > new Date();
}

/**
 * Update last activity timestamp for a session.
 */
export async function touchSession(tokenHash) {
  if (!supabase) return;

  await supabase
    .from('terminal_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .eq('is_active', true);
}

/**
 * ROTATION: Rotate session token.
 * Invalidates old token, creates new session record with new hash.
 * Returns new session ID. Caller must issue new JWT.
 * 
 * Used after: SSO login, privilege elevation, periodic refresh.
 */
export async function rotateSession({ oldToken, newToken, traderId, ipAddress, userAgent }) {
  if (!supabase) return { id: null };

  // Revoke old session
  const oldHash = hashToken(oldToken);
  await supabase
    .from('terminal_sessions')
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoke_reason: 'rotation',
    })
    .eq('token_hash', oldHash)
    .eq('is_active', true);

  // Create new session
  const newHash = hashToken(newToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('terminal_sessions')
    .insert({
      trader_id: traderId,
      token_hash: newHash,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      is_active: true,
      expires_at: expiresAt,
      last_activity_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Session] Rotation failed:', error.message);
    return { id: null, error: error.message };
  }

  return { id: data.id };
}

/**
 * CONCURRENT SESSION ENFORCEMENT: Count active sessions for a trader.
 * Returns count. Caller decides whether to revoke oldest.
 */
export async function getActiveSessionCount(traderId) {
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from('terminal_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('trader_id', traderId)
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString());

  if (error) return 0;
  return count || 0;
}

/**
 * CONCURRENT SESSION ENFORCEMENT: Revoke oldest sessions if over limit.
 * @param {string} traderId
 * @param {number} maxSessions - Maximum allowed concurrent sessions
 */
export async function enforceSessionLimit(traderId, maxSessions = 3) {
  if (!supabase) return;

  const { data: sessions, error } = await supabase
    .from('terminal_sessions')
    .select('id, created_at')
    .eq('trader_id', traderId)
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });

  if (error || !sessions) return;

  // If over limit, revoke oldest sessions
  if (sessions.length > maxSessions) {
    const toRevoke = sessions.slice(0, sessions.length - maxSessions);
    for (const session of toRevoke) {
      await supabase
        .from('terminal_sessions')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoke_reason: 'session_limit_exceeded',
        })
        .eq('id', session.id);
    }
  }
}
