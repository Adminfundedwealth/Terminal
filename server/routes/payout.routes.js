/**
 * PAYOUT ROUTES
 * 
 * Endpoints:
 *   GET  /api/account/payout/eligibility  — Check payout eligibility (authenticated trader)
 *   POST /api/account/payout/request      — Request a payout (authenticated trader)
 *   GET  /api/account/payout/history      — Get payout history (authenticated trader)
 *   POST /api/admin/payout/:id/approve    — Approve payout (admin/founder)
 *   POST /api/admin/payout/:id/reject     — Reject payout (admin/founder)
 *   POST /api/admin/payout/:id/complete   — Mark payout completed (admin/founder)
 *   GET  /api/admin/payouts/pending       — List pending payouts (admin/founder)
 */

import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PayoutService } from '../services/payoutService.js';

export function createPayoutRouter() {
  const router = Router();

  // ═══════════════════════════════════════════════════════════
  // TRADER ENDPOINTS (authenticated)
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /api/account/payout/eligibility
   * Check if current account is eligible for payout.
   */
  router.get('/account/payout/eligibility', requireAuth, async (req, res) => {
    try {
      const result = await PayoutService.checkEligibility(req.user.accountId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ eligible: false, reason: err.message });
    }
  });

  /**
   * POST /api/account/payout/request
   * Request a payout for current account.
   */
  router.post('/account/payout/request', requireAuth, async (req, res) => {
    try {
      const result = await PayoutService.requestPayout(req.user.accountId, req.user.userId);

      if (!result.success) {
        return res.status(422).json(result);
      }

      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/account/payout/history
   * Get payout history for current account.
   */
  router.get('/account/payout/history', requireAuth, async (req, res) => {
    try {
      const history = await PayoutService.getPayoutHistory(req.user.accountId);
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS (founder/admin only)
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /api/admin/payouts/pending
   * List all pending payout requests.
   */
  router.get('/admin/payouts/pending', requireAuth, requireFounder, async (req, res) => {
    try {
      const payouts = await PayoutService.getPendingPayouts();
      res.json(payouts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/admin/payout/:id/approve
   * Approve a payout request.
   */
  router.post('/admin/payout/:id/approve', requireAuth, requireFounder, async (req, res) => {
    try {
      const result = await PayoutService.approvePayout(req.params.id, req.user.userId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/payout/:id/reject
   * Reject a payout request.
   * Body: { reason: "..." }
   */
  router.post('/admin/payout/:id/reject', requireAuth, requireFounder, async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason) {
        return res.status(400).json({ success: false, error: 'Rejection reason is required' });
      }

      const result = await PayoutService.rejectPayout(req.params.id, reason, req.user.userId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/payout/:id/complete
   * Mark a payout as completed (money transferred).
   */
  router.post('/admin/payout/:id/complete', requireAuth, requireFounder, async (req, res) => {
    try {
      const result = await PayoutService.completePayout(req.params.id);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

/**
 * Middleware: Require founder-level access.
 * Checks if user ID is in FOUNDER_USER_IDS env var.
 */
function requireFounder(req, res, next) {
  const founderIds = (process.env.FOUNDER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  if (founderIds.length === 0) {
    // No founders configured — allow any authenticated user (dev mode)
    return next();
  }

  if (!founderIds.includes(req.user.userId)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Founder/Admin access required for payout management.',
    });
  }

  next();
}
