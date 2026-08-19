/**
 * DHAN AUTH SERVICE
 * 
 * Manages Dhan access token lifecycle:
 *   - Loads credentials from environment
 *   - Tracks token expiry (Dhan tokens are valid ~24h from generation)
 *   - Auto-renews via GET /v2/RenewToken every day at 8:00 AM IST (cron)
 *   - Also renews 1 hour before computed expiry (timer fallback)
 *   - Emits events on token refresh / expiry
 * 
 * Renewal Strategy:
 *   1. Daily cron at 08:00 AM IST — calls GET /v2/RenewToken
 *   2. Timer-based — refreshes 1 hour before 24h expiry (backup)
 *   3. On-demand — if a request detects 401, calls renewToken()
 * 
 * Environment Variables:
 *   DHAN_CLIENT_ID       — Required
 *   DHAN_ACCESS_TOKEN    — Required (initial token, gets auto-updated in memory)
 *   DHAN_API_KEY         — Optional (for future consent-based flow)
 *   DHAN_API_SECRET      — Optional (for future consent-based flow)
 */

import axios from 'axios';
import https from 'https';
import { EventEmitter } from 'events';

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Refresh 1 hour before expiry as timer-based backup
const REFRESH_BUFFER_MS = 60 * 60 * 1000;
// Token validity: 30 days (Dhan developer console tokens are valid 30 days,
// NOT 24h — the 24h assumption was causing false token-expired states and
// blank charts after a server has been running for more than a day).
const TOKEN_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

export class DhanAuthService extends EventEmitter {
  constructor() {
    super();
    // Trim whitespace/newlines that may sneak in from env vars
    this.clientId = (process.env.DHAN_CLIENT_ID || '').trim() || null;
    this.accessToken = (process.env.DHAN_ACCESS_TOKEN || '').trim() || null;
    this.apiKey = (process.env.DHAN_API_KEY || '').trim() || null;
    this.apiSecret = (process.env.DHAN_API_SECRET || '').trim() || null;

    // Token metadata — parse exp from JWT if possible
    this._tokenIssuedAt = Date.now();
    this._tokenExpiresAt = this._parseJwtExpiry() || (Date.now() + TOKEN_VALIDITY_MS);
    this._refreshTimer = null;
    this._cronTimer = null;
    this._isRefreshing = false;
    this._consecutiveFailures = 0;
    this._maxConsecutiveFailures = 3;
  }

  /**
   * Parse expiry from JWT token.
   * NOTE: Dhan developer console tokens have an 'exp' claim, but the actual
   * server-side validity period is managed by Dhan independently. We no longer
   * trust the exp claim to gate API calls — a 401 response is the only reliable
   * signal that the token has been revoked. If exp is in the future we use it;
   * if exp is in the past we IGNORE it and assume 30-day validity from now.
   */
  _parseJwtExpiry() {
    try {
      if (!this.accessToken) return null;
      const parts = this.accessToken.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.exp) {
        const expMs = payload.exp * 1000;
        // Only trust the exp claim if it's in the future
        if (expMs > Date.now()) return expMs;
        // Expired JWT claim — ignore it, use TOKEN_VALIDITY_MS fallback
        console.warn(`[DhanAuth] JWT exp claim is in the past (${new Date(expMs).toISOString()}) — ignoring exp, trusting token until 401`);
        return null;
      }
      return null;
    } catch { return null; }
  }

  /**
   * Check if credentials are configured.
   */
  get isConfigured() {
    return !!(this.clientId && this.accessToken);
  }

  /**
   * Check if auto-renewal is possible.
   * Dhan RenewToken works with just access-token + clientId — no separate API key needed.
   */
  get canAutoRenew() {
    return !!(this.clientId && this.accessToken);
  }

  /**
   * Check if current token is still valid.
   * We trust the token is valid as long as credentials are present.
   * A 401 response from Dhan is the only reliable signal it has been revoked.
   */
  get isTokenValid() {
    return !!(this.accessToken && this.clientId);
  }

  /**
   * Mark the token as invalid after receiving a 401 from Dhan.
   * Called by DhanHistoricalService / adapter when Dhan returns 401.
   */
  markTokenInvalid() {
    console.warn('[DhanAuth] Dhan API returned 401 — marking token invalid, Angel One fallback active');
    this.accessToken = null;
    this.emit('token:invalid');
  }

  /**
   * Get current access token (or null if missing).
   */
  getToken() {
    return this.accessToken || null;
  }

  /**
   * Get standard headers for Dhan API calls.
   * Always reads from process.env so a token rotation in Railway env vars
   * takes effect without a full restart.
   */
  getHeaders() {
    const token = (process.env.DHAN_ACCESS_TOKEN || this.accessToken || '').trim();
    const clientId = (process.env.DHAN_CLIENT_ID || this.clientId || '').trim();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access-token': token,
      'client-id': clientId,
    };
  }

  /**
   * Initialize auth service — validate token, schedule cron + timer renewal.
   */
  async initialize() {
    if (!this.isConfigured) {
      console.warn('[DhanAuth] Not configured — DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN required');
      return false;
    }

    // Never reject a token purely based on local clock / JWT exp claim.
    // The JWT exp in Dhan dev-portal tokens doesn't reliably reflect server-side
    // validity — only a 401 from the API proves the token is revoked.
    // We always proceed and let the first real API call surface any auth error.
    console.log(`[DhanAuth] Token loaded for client ${this.clientId} (valid until ${new Date(this._tokenExpiresAt).toISOString()} or next 401)`);
    this.emit('token:valid', { clientId: this.clientId });

    // Schedule daily cron at 8:00 AM IST
    // DISABLED: Dhan RenewToken revokes old tokens. Only enable when
    // the renewal response is properly captured and saved.
    // this._scheduleDailyCron();

    // Timer-based renewal backup — also disabled for safety
    // this._scheduleTimerRenewal();

    return true;
  }

  /**
   * Renew the Dhan access token via GET /v2/RenewToken.
   * This is the primary renewal mechanism — Dhan returns a fresh token.
   * Returns new token on success, null on failure.
   */
  async renewToken() {
    if (this._isRefreshing) {
      // Wait for in-flight refresh
      return new Promise((resolve) => {
        this.once('token:refreshed', () => resolve(this.accessToken));
        this.once('token:refresh_failed', () => resolve(null));
      });
    }

    this._isRefreshing = true;

    try {
      console.log('[DhanAuth] Attempting token renewal via /v2/RenewToken...');

      const resp = await axios.get(`${DHAN_API_BASE}/RenewToken`, {
        httpsAgent: IPV4_AGENT,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'access-token': this.accessToken,
          'dhanClientId': this.clientId,
        },
      });

      // Dhan returns the new token in response
      const newToken = resp.data?.token || resp.data?.access_token || resp.data?.accessToken || resp.data?.data?.token;

      if (newToken) {
        this.accessToken = newToken;
        // Also update process.env so other services pick up the new token
        process.env.DHAN_ACCESS_TOKEN = newToken;
        this._tokenIssuedAt = Date.now();
        this._tokenExpiresAt = Date.now() + TOKEN_VALIDITY_MS;
        this._consecutiveFailures = 0;

        console.log('[DhanAuth] Token auto-renewed successfully.');
        this.emit('token:refreshed', { token: newToken, expiresAt: this._tokenExpiresAt });

        // Reschedule timer-based backup
        this._scheduleTimerRenewal();

        this._isRefreshing = false;
        return newToken;
      }

      throw new Error('No token in RenewToken response');
    } catch (err) {
      this._consecutiveFailures++;
      const errMsg = err.response?.data?.message || err.response?.data || err.message;
      console.error(`[DhanAuth] Token renewal failed (${this._consecutiveFailures}/${this._maxConsecutiveFailures}):`, errMsg);

      this.emit('token:refresh_failed', {
        error: err.message,
        attempts: this._consecutiveFailures,
      });

      // If max failures reached, emit critical event
      if (this._consecutiveFailures >= this._maxConsecutiveFailures) {
        console.error('[DhanAuth] Max refresh failures reached — token may expire. Manual regeneration needed.');
        this.emit('token:expired');
      }

      this._isRefreshing = false;
      return null;
    }
  }

  /**
   * Alias for renewToken — for backward compatibility with DataProviderSwitch.
   */
  async refreshToken() {
    return this.renewToken();
  }

  /**
   * Validate current token against Dhan profile endpoint.
   */
  async _validateToken() {
    try {
      const resp = await axios.get(`${DHAN_API_BASE}/profile`, {
        httpsAgent: IPV4_AGENT,
        timeout: 8000,
        headers: this.getHeaders(),
      });

      // Dhan returns 200 with profile data on success
      return resp.status === 200 && (resp.data?.dhanClientId || resp.data?.data || resp.data?.clientId);
    } catch (err) {
      // Any error response means token is invalid
      if (err.response) {
        console.error(`[DhanAuth] Token validation failed: HTTP ${err.response.status}`, err.response.data?.errorMessage || err.response.data);
        return false;
      }
      // Pure network error (no response at all) — assume token might still be valid
      console.warn('[DhanAuth] Profile validation network error (no response):', err.message);
      return true;
    }
  }

  /**
   * Schedule daily cron — renew token at 8:00 AM IST every day.
   * IST = UTC + 5:30, so 8:00 AM IST = 2:30 AM UTC.
   * 
   * Uses setInterval with next-trigger calculation instead of node-cron
   * to avoid adding a dependency. Same effect.
   */
  _scheduleDailyCron() {
    if (this._cronTimer) {
      clearTimeout(this._cronTimer);
    }

    const scheduleNext = () => {
      const now = new Date();
      // Target: next 8:00 AM IST (02:30 UTC)
      const targetHourUTC = 2;
      const targetMinUTC = 30;

      const next = new Date(now);
      next.setUTCHours(targetHourUTC, targetMinUTC, 0, 0);

      // If already past today's 8 AM IST, schedule for tomorrow
      if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
      }

      const msUntilNext = next.getTime() - now.getTime();
      console.log(`[DhanAuth] Daily renewal cron scheduled in ${Math.round(msUntilNext / 60000)} minutes (8:00 AM IST)`);

      this._cronTimer = setTimeout(async () => {
        console.log('[DhanAuth] Daily cron triggered — renewing token...');
        await this.renewToken();
        // Reschedule for tomorrow
        scheduleNext();
      }, msUntilNext);
    };

    scheduleNext();
  }

  /**
   * Schedule timer-based renewal as backup — 1 hour before computed expiry.
   */
  _scheduleTimerRenewal() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }

    const timeUntilRefresh = Math.max(
      (this._tokenExpiresAt - REFRESH_BUFFER_MS) - Date.now(),
      60000 // At least 1 minute from now
    );

    console.log(`[DhanAuth] Timer-based renewal backup in ${Math.round(timeUntilRefresh / 60000)} minutes`);

    this._refreshTimer = setTimeout(async () => {
      console.log('[DhanAuth] Timer-based renewal triggered (1h before expiry)...');
      await this.renewToken();
    }, timeUntilRefresh);
  }

  /**
   * Cleanup — cancel all scheduled refreshes.
   */
  destroy() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._cronTimer) {
      clearTimeout(this._cronTimer);
      this._cronTimer = null;
    }
    this.removeAllListeners();
  }
}
