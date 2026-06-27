/**
 * KILL SWITCH ROUTES — PRODUCTION HARDENED
 * 
 * Emergency trading halt with FOUNDER authorization for global/group scope.
 * Regular users can only kill their own account.
 * 
 * Authorization Matrix:
 *   scope: 'account' → requireAuth (own account only)
 *   scope: 'group'   → requireFounder
 *   scope: 'global'  → requireFounder
 */
import { Router } from 'express';
import { requireAuth, requireFounder } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { KillSwitchService } from '../services/killSwitchService.js';
import { AuditLogger } from '../services/auditLogger.js';

export function createKillSwitchRouter() {
  const router = Router();

  /**
   * POST /api/kill-switch — Execute kill switch
   * Body: { scope: 'account'|'group'|'global', targetAccountIds?: [], reason: string }
   * 
   * SECURITY:
   *   - 'account' scope: user can only target their OWN account
   *   - 'group'/'global' scope: FOUNDER authorization required
   */
  router.post('/kill-switch', requireAuth, validateBody(schemas.killSwitch), async (req, res) => {
    const { scope, targetAccountIds, reason } = req.validatedBody;

    // FOUNDER GATE: group and global scope require founder authorization
    if (scope === 'group' || scope === 'global') {
      const founderIds = (process.env.FOUNDER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!founderIds.includes(req.user.userId)) {
        AuditLogger.killSwitch({
          userId: req.user.userId,
          scope,
          targetAccountIds,
          reason,
          result: 'DENIED_NOT_FOUNDER',
        });
        return res.status(403).json({
          error: 'forbidden',
          message: `Founder authorization required for '${scope}' kill switch.`,
        });
      }
    }

    // IDOR PROTECTION: 'account' scope can only target user's own account
    let effectiveTargetIds;
    if (scope === 'account') {
      // Force to user's own account — ignore any targetAccountIds they send
      effectiveTargetIds = [req.user.accountId];
    } else {
      effectiveTargetIds = targetAccountIds || [];
    }

    try {
      const result = await KillSwitchService.execute({
        triggeredBy: req.user.userId,
        scope,
        targetAccountIds: effectiveTargetIds,
        reason,
      });

      // Audit log every kill switch activation
      AuditLogger.killSwitch({
        userId: req.user.userId,
        scope,
        targetAccountIds: effectiveTargetIds,
        reason,
        result: result.status,
      });

      res.json(result);
    } catch (err) {
      if (err.message.includes('rate limited')) {
        return res.status(429).json({ error: 'rate_limited', message: err.message });
      }
      res.status(500).json({ error: 'kill_switch_failed', message: err.message });
    }
  });

  /**
   * GET /api/kill-switch/status — Check if rate limited
   */
  router.get('/kill-switch/status', requireAuth, (req, res) => {
    const status = KillSwitchService.isRateLimited(req.user.userId);
    res.json({ ...status, ready: !status.limited });
  });

  return router;
}
