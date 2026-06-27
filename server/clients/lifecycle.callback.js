/**
 * LIFECYCLE CALLBACK CLIENT
 * 
 * Notifies Main Site and Admin about challenge/account lifecycle events.
 * 
 * Events pushed:
 *   challenge.passed     → Dashboard shows "Challenge Passed", enables promotion
 *   challenge.failed     → Dashboard shows "Challenge Failed", disables trading
 *   account.locked       → Dashboard shows "Account Locked (Daily Loss)"
 *   account.suspended    → Dashboard shows "Account Suspended"
 *   account.promoted     → Dashboard shows "Promoted to Phase 2" or "Funded"
 *   funded.created       → Dashboard shows "Funded Account Active"
 *   risk.warning         → Dashboard notification (approaching limit)
 *   risk.breached        → Dashboard alert (limit breached)
 *   account.archived     → Dashboard shows challenge completed/archived
 * 
 * Endpoints expected on Main Site:
 *   POST /api/terminal/events
 *   Header: x-callback-key
 *   Body: { event, accountId, traderId, data, timestamp }
 * 
 * Endpoints expected on Admin:
 *   POST /api/terminal/events  
 *   Header: x-admin-callback-key
 *   Body: { event, accountId, traderId, data, timestamp }
 */

import axios from 'axios';

const WEBSITE_API_URL = process.env.WEBSITE_API_URL || 'https://fundedwealth.com/api';
const ADMIN_API_URL = process.env.ADMIN_API_URL || 'https://admin.fundedwealth.com/api';
const WEBSITE_CALLBACK_KEY = process.env.WEBSITE_CALLBACK_KEY || process.env.PROVISIONING_API_KEY;
const ADMIN_CALLBACK_KEY = process.env.ADMIN_CALLBACK_KEY || process.env.PROVISIONING_API_KEY;
const CALLBACK_TIMEOUT = 10000;
const MAX_RETRIES = 2;

export class LifecycleCallbackClient {
  /**
   * Notify Main Site about a lifecycle event.
   * Non-blocking — failures are logged but don't break the terminal.
   */
  static async notifyWebsite(event, { accountId, traderId, data = {} }) {
    return this._send(WEBSITE_API_URL, WEBSITE_CALLBACK_KEY, event, { accountId, traderId, data });
  }

  /**
   * Notify Admin about a lifecycle event.
   * Non-blocking — failures are logged but don't break the terminal.
   */
  static async notifyAdmin(event, { accountId, traderId, data = {} }) {
    return this._send(ADMIN_API_URL, ADMIN_CALLBACK_KEY, event, { accountId, traderId, data });
  }

  /**
   * Notify both Main Site and Admin simultaneously.
   */
  static async notifyAll(event, { accountId, traderId, data = {} }) {
    const [websiteResult, adminResult] = await Promise.allSettled([
      this.notifyWebsite(event, { accountId, traderId, data }),
      this.notifyAdmin(event, { accountId, traderId, data }),
    ]);

    return {
      website: websiteResult.status === 'fulfilled' ? websiteResult.value : { success: false, error: websiteResult.reason?.message },
      admin: adminResult.status === 'fulfilled' ? adminResult.value : { success: false, error: adminResult.reason?.message },
    };
  }

  // ─── Event-Specific Helpers ────────────────────────────────

  static async challengePassed({ accountId, traderId, challengeId, pnl, targetAmount, tradingDays }) {
    return this.notifyAll('challenge.passed', {
      accountId, traderId,
      data: { challengeId, pnl, targetAmount, tradingDays, passedAt: new Date().toISOString() },
    });
  }

  static async challengeFailed({ accountId, traderId, challengeId, reason, drawdown, limit }) {
    return this.notifyAll('challenge.failed', {
      accountId, traderId,
      data: { challengeId, reason, drawdown, limit, failedAt: new Date().toISOString() },
    });
  }

  static async accountLocked({ accountId, traderId, reason, ruleType }) {
    return this.notifyAll('account.locked', {
      accountId, traderId,
      data: { reason, ruleType, lockedAt: new Date().toISOString() },
    });
  }

  static async accountSuspended({ accountId, traderId, reason }) {
    return this.notifyAll('account.suspended', {
      accountId, traderId,
      data: { reason, suspendedAt: new Date().toISOString() },
    });
  }

  static async accountPromoted({ accountId, traderId, fromPhase, toPhase, newChallengeId, newAccountId }) {
    return this.notifyAll('account.promoted', {
      accountId, traderId,
      data: { fromPhase, toPhase, newChallengeId, newAccountId, promotedAt: new Date().toISOString() },
    });
  }

  static async fundedCreated({ accountId, traderId, challengeId, plan, balance }) {
    return this.notifyAll('funded.created', {
      accountId, traderId,
      data: { challengeId, plan, balance, createdAt: new Date().toISOString() },
    });
  }

  static async riskWarning({ accountId, traderId, ruleType, currentValue, limitValue, percentUsed }) {
    return this.notifyAll('risk.warning', {
      accountId, traderId,
      data: { ruleType, currentValue, limitValue, percentUsed, warnedAt: new Date().toISOString() },
    });
  }

  static async riskBreached({ accountId, traderId, ruleType, currentValue, limitValue }) {
    return this.notifyAll('risk.breached', {
      accountId, traderId,
      data: { ruleType, currentValue, limitValue, breachedAt: new Date().toISOString() },
    });
  }

  static async accountArchived({ accountId, traderId, reason }) {
    return this.notifyAll('account.archived', {
      accountId, traderId,
      data: { reason, archivedAt: new Date().toISOString() },
    });
  }

  // ─── Internal ─────────────────────────────────────────────

  static async _send(baseUrl, apiKey, event, payload) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${baseUrl}/terminal/events`,
          {
            event,
            ...payload,
            timestamp: new Date().toISOString(),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-callback-key': apiKey,
            },
            timeout: CALLBACK_TIMEOUT,
          }
        );

        return { success: true, status: response.status };
      } catch (err) {
        const status = err.response?.status;
        const message = err.response?.data?.message || err.message;

        // Don't retry on 4xx client errors
        if (status && status >= 400 && status < 500) {
          console.warn(`[LifecycleCallback] ${event} → ${baseUrl} rejected (${status}): ${message}`);
          return { success: false, error: message, status, retriable: false };
        }

        if (attempt === MAX_RETRIES) {
          console.warn(`[LifecycleCallback] ${event} → ${baseUrl} failed after ${MAX_RETRIES} attempts: ${message}`);
          return { success: false, error: message, retriable: true };
        }

        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}
