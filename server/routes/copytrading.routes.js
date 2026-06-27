/**
 * COPY TRADING ROUTES — PRODUCTION HARDENED
 * 
 * Master-Slave configuration and replication.
 * IDOR protection: validates that slaveAccountId belongs to the same trader.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { CopyTradingService } from '../services/copyTradingService.js';
import { AuditLogger } from '../services/auditLogger.js';
import { supabase } from '../db/client.js';

export function createCopyTradingRouter() {
  const router = Router();

  /**
   * GET /api/copy-trading/config — Get copy trading config for current account
   */
  router.get('/copy-trading/config', requireAuth, async (req, res) => {
    try {
      const config = await CopyTradingService.getConfig(req.user.accountId);
      res.json(config);
    } catch (err) {
      res.json([]);
    }
  });

  /**
   * POST /api/copy-trading/config — Set/update copy trading relationship
   * SECURITY: Validates slaveAccountId belongs to the same trader (IDOR prevention)
   */
  router.post('/copy-trading/config', requireAuth, validateBody(schemas.copyTradingConfig), async (req, res) => {
    const { slaveAccountId, copyMode, copyRatio, fixedLotSize } = req.validatedBody;

    // IDOR PROTECTION: Verify slaveAccountId belongs to the same trader
    if (supabase) {
      const { data: slaveAccount, error } = await supabase
        .from('trading_accounts')
        .select('id, trader_id')
        .eq('id', slaveAccountId)
        .single();

      if (error || !slaveAccount) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Slave account not found.',
        });
      }

      // Check: slave account must belong to the same trader
      if (slaveAccount.trader_id !== req.user.userId) {
        AuditLogger.idorAttempt({
          userId: req.user.userId,
          targetAccountId: slaveAccountId,
          path: req.path,
        });
        return res.status(403).json({
          error: 'forbidden',
          message: 'You do not own the specified slave account.',
        });
      }

      // Cannot set own account as slave
      if (slaveAccountId === req.user.accountId) {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Cannot set current account as its own slave.',
        });
      }
    }

    try {
      const result = await CopyTradingService.setConfig({
        masterAccountId: req.user.accountId,
        slaveAccountId,
        copyMode,
        copyRatio,
        fixedLotSize,
      });

      AuditLogger.configChange({
        userId: req.user.userId,
        action: 'copy_trading_set',
        target: slaveAccountId,
        before: null,
        after: { copyMode, copyRatio, fixedLotSize },
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * DELETE /api/copy-trading/config/:slaveId — Remove copy trading relationship
   */
  router.delete('/copy-trading/config/:slaveId', requireAuth, async (req, res) => {
    try {
      await CopyTradingService.removeConfig(req.user.accountId, req.params.slaveId);
      AuditLogger.configChange({
        userId: req.user.userId,
        action: 'copy_trading_remove',
        target: req.params.slaveId,
        before: 'active',
        after: 'removed',
      });
      res.json({ status: 'removed' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * GET /api/copy-trading/exposure — Get portfolio exposure across all copy accounts
   */
  router.get('/copy-trading/exposure', requireAuth, async (req, res) => {
    try {
      const exposure = await CopyTradingService.getPortfolioExposure(req.user.accountId);
      res.json(exposure);
    } catch (err) {
      res.json({ bySymbol: [], bySegment: [], totalAccounts: 0, totalPositions: 0 });
    }
  });

  return router;
}
