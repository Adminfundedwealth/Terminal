/**
 * ALERTS ROUTES — Price alerts CRUD (PRODUCTION HARDENED)
 * 
 * Zod-validated. IDOR-protected (trader_id from JWT, not client).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { supabase } from '../db/client.js';

export function createAlertsRouter() {
  const router = Router();

  /**
   * GET /api/alerts — Get all alerts for the authenticated trader
   */
  router.get('/alerts', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .eq('trader_id', req.user.userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e) { res.json([]); }
  });

  /**
   * POST /api/alerts — Create a new alert (Zod validated)
   */
  router.post('/alerts', requireAuth, validateBody(schemas.createAlert), async (req, res) => {
    try {
      const { symbol, token, condition, price, message } = req.validatedBody;

      const { data, error } = await supabase
        .from('alerts')
        .insert({
          trader_id: req.user.userId,
          symbol,
          token,
          segment: 'NSE',
          condition,
          target_price: price,
          notification_type: 'toast',
          is_active: true,
          is_triggered: false,
          note: message || null,
        })
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  /**
   * DELETE /api/alerts/:id — Delete an alert (IDOR: trader_id enforced)
   */
  router.delete('/alerts/:id', requireAuth, async (req, res) => {
    try {
      await supabase
        .from('alerts')
        .delete()
        .eq('id', req.params.id)
        .eq('trader_id', req.user.userId); // IDOR: only own alerts
      res.json({ status: 'deleted' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  /**
   * PUT /api/alerts/:id/deactivate — Deactivate an alert (IDOR: trader_id enforced)
   */
  router.put('/alerts/:id/deactivate', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('alerts')
        .update({ is_active: false })
        .eq('id', req.params.id)
        .eq('trader_id', req.user.userId) // IDOR: only own alerts
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  return router;
}
