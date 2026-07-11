/**
 * AUTH ROUTES
 * 
 * Handles SSO login, logout, session verification, and SSO token generation.
 * 
 * Endpoints:
 *   GET  /auth/sso?token=<sso_token>       — SSO login from Dashboard (user-facing redirect)
 *   POST /auth/sso/generate                — Generate SSO token (main site backend → terminal, API-key protected)
 *   POST /auth/logout                      — Revoke session
 *   GET  /auth/verify                      — Check if current session is valid
 */

import { Router } from 'express';
import { validateSSOToken, generateSSOToken, generateTestSSOToken } from '../services/sso.service.js';
import { revokeSession, revokeAllTraderSessions } from '../services/session.service.js';
import { hashToken, verifySessionJWT } from '../services/auth.service.js';
import { validateBody, schemas } from '../middleware/validate.js';

export function createAuthRouter() {
  const router = Router();

  /**
   * SSO Login — called when user clicks "Open Terminal" in FW Dashboard.
   * Validates SSO token, creates session, sets cookie, redirects to terminal.
   */
  router.get('/sso', async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        error: 'missing_token',
        message: 'SSO token is required. Open terminal from FundedWealth Dashboard.',
      });
    }

    const result = await validateSSOToken(token, {
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    if (!result.success) {
      // In production: redirect to dashboard with error
      const dashboardUrl = process.env.FW_DASHBOARD_URL || 'https://fundedwealth.com';
      return res.redirect(`${dashboardUrl}/terminal-error?reason=${encodeURIComponent(result.error)}`);
    }

    // Set httpOnly secure cookie with terminal JWT
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('fw_session', result.jwt, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-origin redirect (dashboard → terminal)
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    // Redirect to terminal main page
    res.redirect('/');
  });

  /**
   * Logout — revoke current session.
   */
  router.post('/logout', async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const token = extractCookie(cookieHeader, 'fw_session');

    if (token) {
      const tokenHash = hashToken(token);
      await revokeSession(tokenHash);
    }

    res.clearCookie('fw_session', { path: '/' });
    res.json({ success: true, message: 'Logged out' });
  });

  /**
   * Verify — check if current session is still valid.
   * Frontend calls this on mount to decide: show terminal or redirect.
   */
  router.get('/verify', async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    let token = extractCookie(cookieHeader, 'fw_session');

    // Also check Authorization header (for API clients / test tooling)
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    // Also check req.cookies if cookie-parser is present
    if (!token && req.cookies && req.cookies.fw_session) {
      token = req.cookies.fw_session;
    }

    if (!token) {
      return res.status(401).json({ valid: false, reason: 'no_session' });
    }

    const result = verifySessionJWT(token);

    if (!result.valid) {
      res.clearCookie('fw_session', { path: '/' });
      return res.status(401).json({ valid: false, reason: result.error });
    }

    // Full session DB check — reject revoked/expired sessions
    const { isSessionValid } = await import('../services/session.service.js');
    const sessionActive = await isSessionValid(token);
    if (!sessionActive) {
      res.clearCookie('fw_session', { path: '/' });
      return res.status(401).json({ valid: false, reason: 'session_revoked' });
    }

    res.json({
      valid: true,
      user: {
        userId: result.claims.userId,
        accountId: result.claims.accountId,
        accountCode: result.claims.accountCode,
        brokerProvider: result.claims.brokerProvider,
      },
    });
  });

  /**
   * POST /auth/sso/generate
   * 
   * PRODUCTION ENDPOINT — Called by fundedwealth.com backend when user clicks "Launch Terminal".
   * Generates a one-time, short-lived SSO token for the given user + account.
   * 
   * Authentication: x-sso-api-key header (shared with main site backend only).
   * 
   * Body:
   *   fwUserId (required) — User's ID on fundedwealth.com
   *   accountId (required) — trading_accounts.id (UUID) of the purchased account
   *   challengeId (optional) — challenge_accounts.id
   *   email (optional) — User's email (for first-time terminal_trader creation)
   *   name (optional) — User's display name
   * 
   * Response:
   *   { success: true, token, launchUrl, expiresIn }
   */
  router.post('/sso/generate', validateBody(schemas.ssoGenerate), (req, res) => {
    // Validate API key
    const apiKey = req.headers['x-sso-api-key'] || req.headers['x-provisioning-key'];
    const expectedKey = process.env.SSO_API_KEY || process.env.PROVISIONING_API_KEY;

    if (!expectedKey) {
      return res.status(500).json({
        error: 'server_error',
        message: 'SSO API key not configured on server.',
      });
    }

    if (!apiKey || apiKey !== expectedKey) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Invalid or missing x-sso-api-key header.',
      });
    }

    const { fwUserId, accountId, challengeId, email, name } = req.validatedBody;

    if (!fwUserId || !accountId) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'fwUserId and accountId are required.',
      });
    }

    const token = generateSSOToken({
      fwUserId,
      accountId,
      challengeId: challengeId || null,
      email: email || null,
      name: name || null,
    });

    const terminalBaseUrl = process.env.TERMINAL_URL || 'https://terminal.fundedwealth.com';
    const launchUrl = `${terminalBaseUrl}/auth/sso?token=${encodeURIComponent(token)}`;

    res.json({
      success: true,
      token,
      launchUrl,
      expiresIn: 60, // seconds
    });
  });

  /**
   * POST /auth/logout-all — Revoke ALL sessions for current user (logout everywhere)
   */
  router.post('/logout-all', async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    let token = extractCookie(cookieHeader, 'fw_session');
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (token) {
      const result = verifySessionJWT(token);
      if (result.valid) {
        await revokeAllTraderSessions(result.claims.userId);
      }
    }

    res.clearCookie('fw_session', { path: '/' });
    res.json({ success: true, message: 'All sessions revoked' });
  });

  return router;
}

function extractCookie(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
