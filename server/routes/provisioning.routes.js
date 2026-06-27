/**
 * PROVISIONING ROUTES
 * 
 * API endpoints for account provisioning.
 * Called by Website (auto payment) and Admin (manual approval).
 * 
 * Endpoints:
 *   POST /provisioning/provision   — Create new trading account
 *   GET  /provisioning/status/:id  — Check provisioning status
 *   POST /provisioning/retry       — Retry failed provisioning
 * 
 * Authentication: API key in x-provisioning-key header.
 * Only Website and Admin backends have this key.
 */

import { Router } from 'express';
import { ProvisioningService, ProvisioningError } from '../services/provisioningService.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { pollPendingProvisioning } from '../cron/provisioningPoller.js';
import { supabase } from '../db/client.js';

const PROVISIONING_API_KEY = process.env.PROVISIONING_API_KEY;
if (!PROVISIONING_API_KEY) {
  console.error('[Provisioning] FATAL: PROVISIONING_API_KEY environment variable is required.');
}

/**
 * Middleware: Validate provisioning API key.
 * Rejects requests without valid key.
 */
function requireProvisioningKey(req, res, next) {
  const key = req.headers['x-provisioning-key'] || req.headers['x-api-key'];

  if (!key) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing provisioning API key. Include x-provisioning-key header.',
    });
  }

  if (key !== PROVISIONING_API_KEY) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Invalid provisioning API key.',
    });
  }

  next();
}

export function createProvisioningRouter() {
  const router = Router();

  // All provisioning routes require API key
  router.use(requireProvisioningKey);

  /**
   * POST /provisioning/provision
   * 
   * Provision a new trading account.
   * Called by Website after successful payment OR Admin after manual approval.
   * 
   * Body:
   *   email (required) - User email
   *   name (required) - User full name
   *   phone (optional) - User phone
   *   plan (required) - '10K' | '25K' | '50K' | '1L'
   *   orderId (required) - Order reference from Website/Admin
   *   paymentMethod (required) - 'razorpay' | 'upi_manual' | 'bank_transfer'
   *   paymentRef (optional) - Transaction/UTR reference
   *   source (required) - 'website' | 'admin'
   *   fwUserId (optional) - Existing user ID
   *   challengeType (optional) - 'flash' | 'instant' | '1-step' | '2-step'
   *   ruleProfile (required) - Rule profile from Main Site (SINGLE SOURCE OF TRUTH)
   *     {
   *       challengeType: '2-step',
   *       plan: '10K',
   *       phase: 'phase_1',
   *       initialBalance: 1000000,
   *       rules: {
   *         daily_loss_limit: { percent: 5, amount: 50000 },
   *         max_drawdown: { percent: 10, amount: 100000, type: 'static' },
   *         profit_target: { percent: 8, amount: 80000 },
   *         min_trading_days: { count: 5 },
   *         max_calendar_days: { count: 30 },
   *         consistency_rule: { maxDayProfitPercent: 40 },
   *         max_risk_per_trade: { percent: 2 },
   *         max_positions: { count: 10 },
   *         allowed_segments: { segments: ['NSE', 'NFO'] },
   *         trading_hours: { start: '09:15', end: '15:30' },
   *         no_overnight: { cutoffTime: '15:15', allowedProducts: ['MIS'] },
   *         profit_split: { percent: 80 },
   *         drawdown_type: { type: 'static' }
   *       }
   *     }
   * 
   * Response:
   *   201 - Account provisioned successfully
   *   200 - Already provisioned (idempotent)
   *   400 - Validation error
   *   500 - Server error
   */
  router.post('/provision', validateBody(schemas.provision), async (req, res) => {
    try {
      const result = await ProvisioningService.provisionAccount(req.validatedBody);

      if (result.duplicate) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          message: result.message,
          provisioningId: result.provisioningId,
          tradingAccountId: result.tradingAccountId,
          accountCode: result.accountCode,
        });
      }

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof ProvisioningError) {
        const status = err.code === 'VALIDATION_ERROR' || err.code === 'INVALID_PLAN' ? 400 : 500;
        return res.status(status).json({
          success: false,
          error: err.code,
          message: err.message,
        });
      }
      console.error('[Provisioning] Unexpected error:', err);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during provisioning.',
      });
    }
  });

  /**
   * GET /provisioning/status/:orderId
   * 
   * Check provisioning status for an order.
   * Used by Website to poll status or Admin to verify.
   */
  router.get('/status/:orderId', async (req, res) => {
    try {
      const status = await ProvisioningService.getProvisioningStatus(req.params.orderId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'No provisioning record found for this order.',
        });
      }

      res.json({ success: true, ...status });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  /**
   * POST /provisioning/retry
   * 
   * Retry a failed provisioning attempt.
   * Used by Admin when initial provisioning failed.
   * 
   * Body: Same as /provision
   */
  router.post('/retry', async (req, res) => {
    try {
      const { orderId } = req.body;
      if (!orderId) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'orderId is required for retry.',
        });
      }

      const result = await ProvisioningService.retryProvisioning(orderId, req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      if (err instanceof ProvisioningError) {
        return res.status(400).json({
          success: false,
          error: err.code,
          message: err.message,
        });
      }
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  /**
   * POST /provisioning/queue
   * 
   * Queue a provisioning request for async processing.
   * Creates a row in provisioning_logs with status='pending'.
   * The provisioning poller picks it up within 30 seconds.
   * 
   * Use this when Main Site wants fire-and-forget provisioning
   * (instead of waiting for synchronous /provision response).
   * 
   * Body: Same as /provision + optional ruleProfile
   * Response: 202 Accepted with provisioning log ID
   */
  router.post('/queue', async (req, res) => {
    try {
      const { email, name, phone, plan, orderId, paymentMethod, paymentRef, source, fwUserId, challengeType, ruleProfile } = req.body;

      if (!email || !name || !plan || !orderId || !source) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Required: email, name, plan, orderId, source',
        });
      }

      if (!supabase) {
        return res.status(503).json({ success: false, error: 'DB_NOT_CONFIGURED' });
      }

      // Check idempotency
      const { data: existing } = await supabase
        .from('provisioning_logs')
        .select('id, status')
        .eq('order_id', orderId)
        .in('status', ['pending', 'processing', 'completed'])
        .limit(1)
        .single();

      if (existing) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          provisioningId: existing.id,
          status: existing.status,
          message: `Already ${existing.status}`,
        });
      }

      // Insert pending row for poller
      const { data: logRow, error } = await supabase
        .from('provisioning_logs')
        .insert({
          order_id: orderId,
          plan,
          payment_method: paymentMethod || 'razorpay',
          payment_ref: paymentRef || null,
          source,
          status: 'pending',
          email,
          name,
          phone: phone || null,
          external_id: fwUserId || null,
          fw_user_id: fwUserId || null,
          challenge_type: challengeType || '2-step',
          rule_profile: ruleProfile || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: 'INSERT_FAILED', message: error.message });
      }

      res.status(202).json({
        success: true,
        provisioningId: logRow.id,
        status: 'pending',
        message: 'Queued for provisioning. Poll /provisioning/status/:orderId for updates.',
        estimatedProcessingTime: '30s',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  /**
   * POST /provisioning/poll-now
   * 
   * Manually trigger the provisioning poller (for Admin/debug).
   * Processes all pending rows immediately instead of waiting for interval.
   */
  router.post('/poll-now', async (req, res) => {
    try {
      const result = await pollPendingProvisioning();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
