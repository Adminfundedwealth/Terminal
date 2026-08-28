/**
 * PERSISTENCE ROUTES
 * Handles server-side save/load for:
 * - Layouts (workspace save)
 * - Themes (theme persistence)
 * - Journal entries (journal persistence)
 * - Chart templates
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../db/client.js';

export function createPersistenceRouter() {
  const router = Router();

  // ─── LAYOUTS (Workspace Save) ──────────────────────────────

  router.get('/layouts', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('layouts')
        .select('*')
        .eq('trader_id', req.user.userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e) { res.json([]); }
  });

  router.post('/layouts', requireAuth, async (req, res) => {
    try {
      const { name, layout_type, panel_config, chart_config, sidebar_collapsed, bottom_panel_height, watchlist_width, order_panel_width } = req.body;
      const { data, error } = await supabase
        .from('layouts')
        .insert({
          trader_id: req.user.userId,
          name: name || 'Untitled',
          layout_type: layout_type || 'custom',
          panel_config: panel_config || {},
          chart_config: chart_config || {},
          sidebar_collapsed: sidebar_collapsed || false,
          bottom_panel_height: bottom_panel_height || 200,
          watchlist_width: watchlist_width || 280,
          order_panel_width: order_panel_width || 300,
        })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.put('/layouts/:id', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('layouts')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('trader_id', req.user.userId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.delete('/layouts/:id', requireAuth, async (req, res) => {
    try {
      await supabase.from('layouts').delete().eq('id', req.params.id).eq('trader_id', req.user.userId);
      res.json({ status: 'deleted' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.post('/layouts/:id/activate', requireAuth, async (req, res) => {
    try {
      // Deactivate all
      await supabase.from('layouts').update({ is_active: false }).eq('trader_id', req.user.userId);
      // Activate selected
      const { data, error } = await supabase
        .from('layouts')
        .update({ is_active: true })
        .eq('id', req.params.id)
        .eq('trader_id', req.user.userId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ─── THEMES (Theme Persistence) ──────────────────────────────

  router.get('/themes', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('themes')
        .select('*')
        .eq('trader_id', req.user.userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e) { res.json([]); }
  });

  router.post('/themes', requireAuth, async (req, res) => {
    try {
      const { name, colors, font_family, font_size, chart_colors } = req.body;
      const theme = {
        trader_id: req.user.userId,
        name: name || 'Custom',
        colors: colors || {},
        font_family: font_family || 'Inter',
        font_size: font_size || 'normal',
        chart_colors: chart_colors || {},
      };

      // Update first so this remains idempotent even when PostgREST does not
      // apply the column-based upsert conflict target on the deployed schema.
      const existing = await supabase
        .from('themes')
        .select('id')
        .eq('trader_id', theme.trader_id)
        .eq('name', theme.name)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data?.id) {
        const { data, error } = await supabase
          .from('themes')
          .update({ ...theme, updated_at: new Date().toISOString() })
          .eq('id', existing.data.id)
          .eq('trader_id', theme.trader_id)
          .select()
          .single();
        if (error) throw error;
        return res.json(data);
      }

      const inserted = await supabase.from('themes').insert(theme).select().single();
      if (!inserted.error) return res.json(inserted.data);

      // Another tab may have inserted the same theme between the lookup and
      // insert. Re-read and update that row rather than returning HTTP 500.
      if (inserted.error.code === '23505') {
        const concurrent = await supabase
          .from('themes')
          .select('id')
          .eq('trader_id', theme.trader_id)
          .eq('name', theme.name)
          .single();
        if (concurrent.error) throw concurrent.error;
        const { data, error } = await supabase
          .from('themes')
          .update({ ...theme, updated_at: new Date().toISOString() })
          .eq('id', concurrent.data.id)
          .eq('trader_id', theme.trader_id)
          .select()
          .single();
        if (error) throw error;
        return res.json(data);
      }

      throw inserted.error;
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.put('/themes/:id/activate', requireAuth, async (req, res) => {
    try {
      await supabase.from('themes').update({ is_active: false }).eq('trader_id', req.user.userId);
      const { data, error } = await supabase
        .from('themes')
        .update({ is_active: true })
        .eq('id', req.params.id)
        .eq('trader_id', req.user.userId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.delete('/themes/:id', requireAuth, async (req, res) => {
    try {
      await supabase.from('themes').delete().eq('id', req.params.id).eq('trader_id', req.user.userId);
      res.json({ status: 'deleted' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ─── JOURNAL (Journal Persistence) ──────────────────────────

  router.get('/journal', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('trader_id', req.user.userId)
        .order('entry_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      res.json(data || []);
    } catch (e) { res.json([]); }
  });

  router.post('/journal', requireAuth, async (req, res) => {
    try {
      const entry = req.body;
      const { data, error } = await supabase
        .from('journal_entries')
        .insert({
          trader_id: req.user.userId,
          trading_account_id: entry.tradingAccountId || null,
          entry_date: entry.date || new Date().toISOString().split('T')[0],
          symbol: entry.symbol || null,
          side: entry.side || null,
          entry_price: entry.entryPrice || null,
          exit_price: entry.exitPrice || null,
          qty: entry.qty || null,
          pnl: entry.pnl || null,
          setup_type: entry.setupType || null,
          emotion: entry.emotion || 'neutral',
          rating: entry.rating || 3,
          trade_phase: entry.tradePhase || 'after',
          notes: entry.notes || '',
          lessons: entry.lessons || null,
          mistakes: entry.mistakes || null,
          tags: entry.tags || [],
          screenshot_urls: entry.screenshotUrls || [],
        })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.put('/journal/:id', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('journal_entries')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('trader_id', req.user.userId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.delete('/journal/:id', requireAuth, async (req, res) => {
    try {
      await supabase.from('journal_entries').delete().eq('id', req.params.id).eq('trader_id', req.user.userId);
      res.json({ status: 'deleted' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ─── CHART TEMPLATES ──────────────────────────────────────────

  router.get('/chart-templates', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('layouts')
        .select('*')
        .eq('trader_id', req.user.userId)
        .eq('layout_type', 'custom')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e) { res.json([]); }
  });

  router.post('/chart-templates', requireAuth, async (req, res) => {
    try {
      const tpl = req.body;
      const { data, error } = await supabase
        .from('layouts')
        .insert({
          trader_id: req.user.userId,
          name: tpl.name || 'Chart Template',
          layout_type: 'custom',
          panel_config: { timeframe: tpl.timeframe, chartType: tpl.chartType, indicators: tpl.indicators || [] },
          chart_config: { layout: tpl.chartLayout },
        })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  return router;
}
