/**
 * ADMIN ROUTES — Account Management
 *
 * Provides freeze / unfreeze / breach / list / search for trading accounts.
 * All endpoints require:
 *   1. Valid JWT session (requireAuth)
 *   2. Founder-level authorization (requireFounder from auth.js)
 *
 * Mounted at /api (see server/index.js)
 *
 * Endpoints:
 *   GET  /api/admin/accounts               — list all accounts (paginated + search)
 *   GET  /api/admin/accounts/:id           — get single account detail
 *   POST /api/admin/accounts/:id/freeze    — lock account (blocks all trading)
 *   POST /api/admin/accounts/:id/unfreeze  — unlock account (restores trading)
 *   POST /api/admin/accounts/:id/close-positions — force-close all open positions
 *   GET  /api/admin/accounts/:id/positions — list open positions for account
 *   GET  /api/admin/accounts/:id/risk-events — recent risk events for account
 */

import { Router } from 'express';
import { requireAuth, requireFounder } from '../middleware/auth.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { AuditLogger } from '../services/auditLogger.js';
import { supabase } from '../db/client.js';

const accountRepo = new AccountRepository();

export function createAdminRouter() {
  const router = Router();

  /**
   * GET /api/admin/check
   * Returns whether the current user has founder/admin access.
   * Used by the frontend to conditionally show the Admin tab.
   * Requires auth but NOT founder — anyone can call it, just returns true/false.
   */
  router.get('/admin/check', requireAuth, (req, res) => {
    const founderIds = (process.env.FOUNDER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const isFounder = founderIds.length === 0 || founderIds.includes(req.user.userId);
    res.json({ isFounder });
  });

  // All remaining admin routes require auth + founder
  router.use('/admin', requireAuth, requireFounder);

  // ─── List / search accounts ─────────────────────────────────────────────────

  /**
   * GET /api/admin/accounts
   * Query params: search (email/code), status, page (1-based), limit (default 20)
   */
  router.get('/admin/accounts', async (req, res) => {
    try {
      const { search = '', status = '', page = '1', limit = '20' } = req.query;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const offset = (pageNum - 1) * limitNum;

      if (!supabase) return res.status(503).json({ error: 'Database not configured' });

      // Join trading_accounts with terminal_traders to get email + display_name
      let query = supabase
        .from('trading_accounts')
        .select(`
          id,
          account_code,
          broker_provider,
          balance,
          available_margin,
          used_margin,
          status,
          locked_reason,
          locked_at,
          unlocked_at,
          created_at,
          updated_at,
          trader_id,
          challenge_id,
          terminal_traders!trader_id (
            id,
            email,
            display_name,
            status
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (status) query = query.eq('status', status);

      const { data, error, count } = await query;

      if (error) throw new Error(error.message);

      // If search provided, filter client-side (Supabase free tier limitation)
      let accounts = data || [];
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        accounts = accounts.filter(a =>
          (a.account_code || '').toLowerCase().includes(s) ||
          (a.terminal_traders?.email || '').toLowerCase().includes(s) ||
          (a.terminal_traders?.display_name || '').toLowerCase().includes(s)
        );
      }

      res.json({
        success: true,
        accounts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          pages: Math.ceil((count || 0) / limitNum),
        },
      });
    } catch (err) {
      console.error('[AdminRoutes] list accounts error:', err.message);
      res.status(500).json({ error: 'Failed to fetch accounts', message: err.message });
    }
  });

  // ─── Single account detail ───────────────────────────────────────────────────

  /**
   * GET /api/admin/accounts/:id
   */
  router.get('/admin/accounts/:id', async (req, res) => {
    try {
      const account = await accountRepo.getWithChallenge(req.params.id);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      // Fetch trader info
      let trader = null;
      if (supabase) {
        const { data } = await supabase
          .from('terminal_traders')
          .select('id, email, display_name, status, external_id')
          .eq('id', account.trader_id)
          .single();
        trader = data;
      }

      // Fetch open positions
      let positions = [];
      if (supabase) {
        const { data } = await supabase
          .from('positions')
          .select('id, symbol, side, qty, product_type, avg_price, is_open, opened_at')
          .eq('trading_account_id', req.params.id)
          .eq('is_open', true);
        positions = data || [];
      }

      res.json({ success: true, account, trader, positions });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch account', message: err.message });
    }
  });

  // ─── Freeze (lock) ──────────────────────────────────────────────────────────

  /**
   * POST /api/admin/accounts/:id/freeze
   * Body: { reason: string }
   *
   * Sets account status = 'locked'. All trading is blocked.
   * The RiskOverlay in the terminal will immediately show the locked screen.
   */
  router.post('/admin/accounts/:id/freeze', async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'Freeze reason is required' });
      }

      const account = await accountRepo.findById(req.params.id);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      if (account.status === 'locked') {
        return res.status(409).json({ error: 'Account is already frozen' });
      }
      if (account.status === 'breached') {
        return res.status(409).json({ error: 'Account is permanently breached — cannot freeze. Use unfreeze to restore.' });
      }

      await accountRepo.lockAccount(req.params.id, reason.trim());

      AuditLogger.adminAction?.({
        adminId: req.user.userId,
        action: 'account_frozen',
        targetAccountId: req.params.id,
        reason: reason.trim(),
        previousStatus: account.status,
      }) ?? console.log(`[Admin] FREEZE account=${req.params.id} by=${req.user.userId} reason="${reason.trim()}"`);

      res.json({
        success: true,
        message: `Account ${account.account_code} frozen`,
        accountId: req.params.id,
        status: 'locked',
        reason: reason.trim(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Freeze failed', message: err.message });
    }
  });

  // ─── Unfreeze (unlock) ──────────────────────────────────────────────────────

  /**
   * POST /api/admin/accounts/:id/unfreeze
   *
   * Restores account status = 'active'.
   * Works for both 'locked' and 'breached' accounts.
   */
  router.post('/admin/accounts/:id/unfreeze', async (req, res) => {
    try {
      const account = await accountRepo.findById(req.params.id);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      if (account.status === 'active') {
        return res.status(409).json({ error: 'Account is already active' });
      }

      const previousStatus = account.status;
      await accountRepo.unlockAccount(req.params.id);

      AuditLogger.adminAction?.({
        adminId: req.user.userId,
        action: 'account_unfrozen',
        targetAccountId: req.params.id,
        previousStatus,
      }) ?? console.log(`[Admin] UNFREEZE account=${req.params.id} by=${req.user.userId} prevStatus=${previousStatus}`);

      res.json({
        success: true,
        message: `Account ${account.account_code} unfrozen — trading restored`,
        accountId: req.params.id,
        status: 'active',
        previousStatus,
      });
    } catch (err) {
      res.status(500).json({ error: 'Unfreeze failed', message: err.message });
    }
  });

  // ─── Force-close all positions ──────────────────────────────────────────────

  /**
   * POST /api/admin/accounts/:id/close-positions
   *
   * Admin manually closes all open positions for a user.
   * Does NOT require the risk engine — writes directly to DB.
   * Used when risk engine is blocking the user from closing themselves.
   */
  router.post('/admin/accounts/:id/close-positions', async (req, res) => {
    try {
      const account = await accountRepo.findById(req.params.id);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      if (!supabase) return res.status(503).json({ error: 'Database not configured' });

      // Fetch all open positions
      const { data: openPositions, error: fetchErr } = await supabase
        .from('positions')
        .select('id, symbol, side, qty')
        .eq('trading_account_id', req.params.id)
        .eq('is_open', true);

      if (fetchErr) throw new Error(fetchErr.message);
      if (!openPositions || openPositions.length === 0) {
        return res.json({ success: true, message: 'No open positions to close', closed: 0 });
      }

      const now = new Date().toISOString();
      const ids = openPositions.map(p => p.id);

      // Bulk-close all positions
      const { error: updateErr } = await supabase
        .from('positions')
        .update({ is_open: false, qty: 0, closed_at: now, updated_at: now })
        .in('id', ids);

      if (updateErr) throw new Error(updateErr.message);

      AuditLogger.adminAction?.({
        adminId: req.user.userId,
        action: 'positions_force_closed',
        targetAccountId: req.params.id,
        closedCount: openPositions.length,
        symbols: openPositions.map(p => p.symbol),
      }) ?? console.log(`[Admin] FORCE-CLOSE ${openPositions.length} positions for account=${req.params.id} by=${req.user.userId}`);

      res.json({
        success: true,
        message: `Closed ${openPositions.length} position(s) for ${account.account_code}`,
        closed: openPositions.length,
        positions: openPositions.map(p => ({ id: p.id, symbol: p.symbol, side: p.side, qty: p.qty })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Force-close failed', message: err.message });
    }
  });

  // ─── Account positions ───────────────────────────────────────────────────────

  /**
   * GET /api/admin/accounts/:id/positions
   */
  router.get('/admin/accounts/:id/positions', async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Database not configured' });

      const { data, error } = await supabase
        .from('positions')
        .select('id, symbol, side, qty, product_type, avg_price, realized_pnl, unrealized_pnl, is_open, opened_at, closed_at')
        .eq('trading_account_id', req.params.id)
        .order('opened_at', { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message);
      res.json({ success: true, positions: data || [] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch positions', message: err.message });
    }
  });

  // ─── Risk events ─────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/accounts/:id/risk-events
   */
  router.get('/admin/accounts/:id/risk-events', async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Database not configured' });

      const { data, error } = await supabase
        .from('risk_events')
        .select('id, event_type, severity, rule_type, metadata, acknowledged, created_at')
        .eq('trading_account_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw new Error(error.message);
      res.json({ success: true, events: data || [] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch risk events', message: err.message });
    }
  });

  return router;
}
