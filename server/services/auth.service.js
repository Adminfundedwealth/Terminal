/**
 * AUTH SERVICE
 * 
 * Handles JWT generation, validation, and session management.
 * Used by: SSO endpoint, auth middleware, WebSocket auth.
 * 
 * JWT is terminal-scoped — issued after SSO validation.
 * Contains: userId, accountId, challengeId, brokerProvider, permissions.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from 'dotenv';

config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

/**
 * Generate a terminal session JWT.
 * Called after SSO token is validated.
 */
export function generateSessionJWT(payload) {
  const claims = {
    sub: payload.userId,
    accountId: payload.accountId,
    challengeId: payload.challengeId,
    accountCode: payload.accountCode,
    brokerProvider: payload.brokerProvider,
    permissions: payload.permissions || ['trade', 'view_positions', 'view_orders'],
  };

  return jwt.sign(claims, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode a terminal session JWT.
 * Returns decoded claims or throws on invalid/expired token.
 */
export function verifySessionJWT(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      valid: true,
      claims: {
        userId: decoded.sub,
        accountId: decoded.accountId,
        challengeId: decoded.challengeId,
        accountCode: decoded.accountCode,
        brokerProvider: decoded.brokerProvider,
        permissions: decoded.permissions,
        issuedAt: decoded.iat,
        expiresAt: decoded.exp,
      },
    };
  } catch (err) {
    return {
      valid: false,
      claims: null,
      error: err.name === 'TokenExpiredError' ? 'expired' : 'invalid',
    };
  }
}

/**
 * Hash a token for storage in sessions table.
 * Never store raw tokens in the database.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure nonce.
 * Used for SSO replay protection.
 */
export function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}
