/**
 * AUTH MIDDLEWARE — PRODUCTION HARDENED
 * 
 * Validates JWT on every protected route.
 * Extracts user claims and attaches to req.user.
 * 
 * Token sources (checked in order):
 * 1. Cookie: "fw_session"
 * 2. Header: "Authorization: Bearer <token>"
 * 
 * If invalid/missing: returns 401.
 * 
 * SECURITY: All dev bypasses REMOVED. No backdoors. No fallbacks.
 */

import { verifySessionJWT } from '../services/auth.service.js';
import { isSessionValid } from '../services/session.service.js';
import { AuditLogger } from '../services/auditLogger.js';

/**
 * Require valid authentication.
 * Use on all /api/* routes that need user context.
 * PRODUCTION: No bypasses. No dev mode. JWT required always.
 */
export async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    AuditLogger.authFailure({ reason: 'no_token', ip: req.ip, path: req.path });
    return res.status(401).json({
      error: 'unauthorized',
      message: 'No session token provided. Please login via FundedWealth Dashboard.',
    });
  }

  const result = verifySessionJWT(token);

  if (!result.valid) {
    AuditLogger.authFailure({ reason: result.error, ip: req.ip, path: req.path });
    return res.status(401).json({
      error: result.error === 'expired' ? 'session_expired' : 'invalid_token',
      message: result.error === 'expired'
        ? 'Session expired. Please re-open terminal from Dashboard.'
        : 'Invalid session token.',
    });
  }

  // Verify session has not been revoked in database (fail-closed)
  const sessionActive = await isSessionValid(token);
  if (!sessionActive) {
    AuditLogger.authFailure({ reason: 'session_revoked', userId: result.claims.userId, ip: req.ip, path: req.path });
    return res.status(401).json({
      error: 'session_revoked',
      message: 'Session has been revoked. Please re-open terminal from Dashboard.',
    });
  }

  // Attach user claims to request
  req.user = result.claims;
  req.token = token;
  next();
}

/**
 * Check if user has a specific permission.
 * Must be used AFTER requireAuth.
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
    }
    const perms = req.user.permissions || [];
    if (!perms.includes(permission)) {
      AuditLogger.authzFailure({ userId: req.user.userId, permission, path: req.path });
      return res.status(403).json({
        error: 'forbidden',
        message: `Permission '${permission}' required.`,
      });
    }
    next();
  };
}

/**
 * Require FOUNDER role for emergency/global operations.
 * Validates against FOUNDER_USER_IDS environment variable.
 * Must be used AFTER requireAuth.
 */
export function requireFounder(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' });
  }

  const founderIds = (process.env.FOUNDER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  
  if (founderIds.length === 0) {
    // No founders configured = nobody can access founder-only routes
    AuditLogger.authzFailure({ userId: req.user.userId, permission: 'founder', path: req.path, reason: 'no_founders_configured' });
    return res.status(403).json({
      error: 'forbidden',
      message: 'Founder access not configured. Contact system administrator.',
    });
  }

  if (!founderIds.includes(req.user.userId)) {
    AuditLogger.authzFailure({ userId: req.user.userId, permission: 'founder', path: req.path });
    return res.status(403).json({
      error: 'forbidden',
      message: 'Founder authorization required for this operation.',
    });
  }

  next();
}

/**
 * Optional auth — does not reject if no token.
 * Attaches user if present, allows anonymous if not.
 * Use for public endpoints that benefit from user context.
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req);

  if (token) {
    const result = verifySessionJWT(token);
    if (result.valid) {
      req.user = result.claims;
      req.token = token;
    }
  }

  next();
}

/**
 * Validate WebSocket connection auth.
 * Called during WS upgrade before allowing subscription.
 * Returns user claims or null.
 * PRODUCTION: No bypasses. JWT required always.
 */
export function validateWSAuth(request) {
  // Try cookie first
  const cookieHeader = request.headers.cookie || '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies['fw_session'];

  if (!token) {
    // Try query param (for WS connections that can't send cookies)
    const url = new URL(request.url, `http://${request.headers.host}`);
    const queryToken = url.searchParams.get('token');
    if (!queryToken) return null;

    const result = verifySessionJWT(queryToken);
    return result.valid ? result.claims : null;
  }

  const result = verifySessionJWT(token);
  return result.valid ? result.claims : null;
}

/**
 * Validate account ownership — prevents IDOR.
 * Ensures the requested accountId belongs to the authenticated user.
 */
export function requireAccountOwnership(accountIdExtractor) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const targetAccountId = typeof accountIdExtractor === 'function'
      ? accountIdExtractor(req)
      : req.params[accountIdExtractor] || req.body[accountIdExtractor];

    if (!targetAccountId) {
      return next(); // No target account specified, let route handler decide
    }

    // User can only access their own account
    if (targetAccountId !== req.user.accountId) {
      AuditLogger.idorAttempt({ userId: req.user.userId, targetAccountId, path: req.path });
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not have access to this account.',
      });
    }

    next();
  };
}

/**
 * Extract token from request (cookie or Authorization header).
 */
function extractToken(req) {
  // 1. Check cookie
  if (req.cookies && req.cookies.fw_session) {
    return req.cookies.fw_session;
  }

  // Parse cookie header manually if cookie-parser not used
  const cookieHeader = req.headers.cookie || '';
  const cookies = parseCookies(cookieHeader);
  if (cookies['fw_session']) {
    return cookies['fw_session'];
  }

  // 2. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Parse raw cookie header into key-value object.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const [key, ...vals] = cookie.trim().split('=');
    if (key) {
      cookies[key.trim()] = vals.join('=').trim();
    }
  });

  return cookies;
}
