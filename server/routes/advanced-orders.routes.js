/**
 * Advanced Order Routes — OCO, Basket, Bracket
 */
import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { OrderRepository } from '../repositories/order.repository.js';

export function createAdvancedOrdersRouter() {
  const router = Router();
  const orderRepo = new OrderRepository();

  /**
   * POST /api/orders/oco — Place OCO (One-Cancels-Other) order
   */
  router.post('/orders/oco', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const { symbol, token, segment, side, productType, qty, leg1, leg2 } = req.body;
      if (!symbol || !token || !side || !qty || !leg1 || !leg2) {
        return res.status(400).json({ message: 'Missing OCO parameters' });
      }

      const groupId = crypto.randomUUID();
      const accountId = req.user.accountId;

      // Leg 1: Take Profit (LIMIT)
      const order1 = await orderRepo.createOrder(accountId, {
        symbol, token, segment: segment || 'NSE', side,
        orderType: leg1.orderType || 'LIMIT',
        productType: productType || 'MIS',
        qty, price: leg1.price,
        orderGroupId: groupId,
        orderGroupType: 'oco',
      });

      // Leg 2: Stop Loss (SL-M)
      const order2 = await orderRepo.createOrder(accountId, {
        symbol, token, segment: segment || 'NSE', side,
        orderType: leg2.orderType || 'SL-M',
        productType: productType || 'MIS',
        qty, triggerPrice: leg2.triggerPrice,
        orderGroupId: groupId,
        orderGroupType: 'oco',
      });

      res.json({ groupId, orders: [order1.id, order2.id], status: 'placed' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/orders/basket — Place basket of orders
   */
  router.post('/orders/basket', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const { legs } = req.body;
      if (!Array.isArray(legs) || legs.length === 0) {
        return res.status(400).json({ message: 'Basket requires at least 1 leg' });
      }

      const groupId = crypto.randomUUID();
      const accountId = req.user.accountId;
      const orderIds = [];

      for (const leg of legs) {
        const order = await orderRepo.createOrder(accountId, {
          symbol: leg.symbol,
          token: leg.token || '',
          segment: leg.segment || 'NSE',
          side: leg.side,
          orderType: leg.orderType || 'MARKET',
          productType: leg.productType || 'MIS',
          qty: leg.qty,
          price: leg.price || null,
          triggerPrice: leg.triggerPrice || null,
          orderGroupId: groupId,
          orderGroupType: 'basket',
        });
        orderIds.push(order.id);
      }

      res.json({ groupId, orders: orderIds, count: orderIds.length, status: 'placed' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/orders/bracket — Place bracket order (entry + SL + target)
   */
  router.post('/orders/bracket', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const { symbol, token, segment, side, productType, qty, price, orderType, targetPrice, stoplossPrice, trailingSl } = req.body;
      if (!symbol || !token || !side || !qty) {
        return res.status(400).json({ message: 'Missing bracket parameters' });
      }

      const groupId = crypto.randomUUID();
      const accountId = req.user.accountId;

      // Entry order
      const entry = await orderRepo.createOrder(accountId, {
        symbol, token, segment: segment || 'NSE', side,
        orderType: orderType || 'LIMIT',
        productType: 'BO',
        qty, price,
        targetPrice, stoplossPrice, trailingSl,
        orderGroupId: groupId,
        orderGroupType: 'bracket',
      });

      res.json({ groupId, orderId: entry.id, status: 'placed' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * GET /api/account/equity-curve — Get equity curve data
   */
  router.get('/account/equity-curve', requireAuth, async (req, res) => {
    try {
      const { MetricsRepository } = await import('../repositories/metrics.repository.js');
      const metricsRepo = new MetricsRepository();
      const days = parseInt(req.query.days) || 30;
      const metrics = await metricsRepo.getRecentMetrics(req.user.accountId, days);
      res.json(metrics.map(m => ({
        date: m.date,
        balance: parseFloat(m.ending_balance) || 0,
        pnl: parseFloat(m.realized_pnl) || 0,
      })));
    } catch (err) {
      res.json([]);
    }
  });

  /**
   * GET /api/account/metrics — Get daily metrics for calendar view
   */
  router.get('/account/metrics', requireAuth, async (req, res) => {
    try {
      const { MetricsRepository } = await import('../repositories/metrics.repository.js');
      const metricsRepo = new MetricsRepository();
      const days = parseInt(req.query.days) || 90;
      const metrics = await metricsRepo.getRecentMetrics(req.user.accountId, days);
      res.json(metrics);
    } catch (err) {
      res.json([]);
    }
  });

  /**
   * Chart Templates — CRUD (persisted to layouts table)
   */
  router.get('/chart-templates', requireAuth, async (req, res) => {
    try {
      const { data, error } = await (await import('../db/client.js')).supabase
        .from('layouts')
        .select('*')
        .eq('trader_id', req.user.userId)
        .eq('layout_type', 'custom')
        .order('created_at', { ascending: false });
      res.json(data || []);
    } catch { res.json([]); }
  });

  router.post('/chart-templates', requireAuth, async (req, res) => {
    try {
      const { supabase } = await import('../db/client.js');
      const { data, error } = await supabase.from('layouts').insert({
        trader_id: req.user.userId,
        name: req.body.name || 'Untitled',
        layout_type: 'custom',
        panel_config: { timeframe: req.body.timeframe, chartType: req.body.chartType, indicators: req.body.indicators || [] },
        chart_config: req.body,
      }).select().single();
      if (error) throw new Error(error.message);
      res.json(data);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.delete('/chart-templates/:id', requireAuth, async (req, res) => {
    try {
      const { supabase } = await import('../db/client.js');
      await supabase.from('layouts').delete().eq('id', req.params.id).eq('trader_id', req.user.userId);
      res.json({ status: 'deleted' });
    } catch { res.json({ status: 'ok' }); }
  });

  return router;
}
