import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';

import { TradingViewDatafeed } from '../realtime/tradingview.datafeed.js';

export function createApiRouter(accountService, instrumentService, marketDataEngine, candleService, depthService, optionChainService) {
  const router = Router();
  const tvDatafeed = new TradingViewDatafeed(instrumentService, marketDataEngine);

  // === PROTECTED ===

  router.get('/account', requireAuth, async (req, res) => {
    try {
      res.json(await accountService.getAccount(req.user.accountId));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.get('/account/challenge', requireAuth, async (req, res) => {
    try {
      const { ChallengeService } = await import('../services/challengeService.js');
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const progress = await ChallengeService.getProgress(realId);
      res.json(progress || {});
    } catch (err) {
      if (err.message && err.message.includes('schema cache')) {
        return res.json({});
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Challenge phase promotion (manual trigger for admin/testing)
  router.post('/account/challenge/promote', requireAuth, async (req, res) => {
    try {
      const { ChallengeService } = await import('../services/challengeService.js');
      const result = await ChallengeService.promoteToNextPhase(req.user.accountId);
      if (!result) {
        return res.status(422).json({ success: false, reason: 'Not eligible for promotion (challenge must be passed)' });
      }
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/account/rules', requireAuth, async (req, res) => {
    try {
      const rules = await accountService.getRules(req.user.accountId);
      res.json(rules);
    } catch (err) {
      if (err.message && err.message.includes('schema cache')) {
        return res.json([]);
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Real-time computed risk state (daily loss, DD, target progress)
  router.get('/account/risk-state', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const { RiskEngine } = await import('../services/riskEngine.js');
      const { AccountRepository } = await import('../repositories/account.repository.js');
      const { PositionRepository } = await import('../repositories/position.repository.js');
      const { RiskRulesRepository } = await import('../repositories/risk-rules.repository.js');
      const { TradeRepository } = await import('../repositories/trade.repository.js');

      const accountRepo = new AccountRepository();
      const positionRepo = new PositionRepository();
      const riskRulesRepo = new RiskRulesRepository();
      const tradeRepo = new TradeRepository();

      const account = await accountRepo.getWithChallenge(realId);
      if (!account) return res.json({ error: 'Account not found' });

      const rules = await riskRulesRepo.getRulesMap(realId);
      const challenge = account.challenge;
      const balance = parseFloat(account.balance) || 0;
      const initialBalance = challenge ? parseFloat(challenge.initial_balance) : balance;
      const peakBalance = parseFloat(account.peak_balance || challenge?.peak_balance || balance);

      // Today's realized P&L
      let todayRealizedPnl = 0;
      try { todayRealizedPnl = await RiskEngine.calculateTodayRealizedPnl(realId); } catch {}

      // Unrealized P&L from open positions
      let unrealizedPnl = 0;
      try { unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(realId, null); } catch {}

      const totalDailyPnl = todayRealizedPnl + unrealizedPnl;
      const currentEquity = balance + unrealizedPnl;
      const pnlFromStart = currentEquity - initialBalance;

      // Daily loss consumed
      const dailyLossLimit = rules.daily_loss_limit
        ? (rules.daily_loss_limit.amount || (rules.daily_loss_limit.percent / 100) * initialBalance)
        : initialBalance * 0.05;
      const dailyLoss = totalDailyPnl < 0 ? Math.abs(totalDailyPnl) : 0;
      const dailyLossUsedPct = dailyLossLimit > 0 ? (dailyLoss / dailyLossLimit) * 100 : 0;

      // Max drawdown consumed
      const maxDrawdownLimit = rules.max_drawdown
        ? (rules.max_drawdown.amount || (rules.max_drawdown.percent / 100) * initialBalance)
        : initialBalance * 0.10;
      const drawdown = Math.max(0, peakBalance - currentEquity);
      const maxDrawdownUsedPct = maxDrawdownLimit > 0 ? (drawdown / maxDrawdownLimit) * 100 : 0;

      // Profit target progress
      const profitTargetAmount = rules.profit_target
        ? (rules.profit_target.amount || (rules.profit_target.percent / 100) * initialBalance)
        : initialBalance * 0.10;
      const targetProgressPct = profitTargetAmount > 0 ? Math.max(0, (pnlFromStart / profitTargetAmount) * 100) : 0;

      // Today's trade count
      let todayTradeCount = 0;
      try { todayTradeCount = await tradeRepo.countTodayTrades(realId); } catch {}

      res.json({
        accountId: realId,
        balance,
        currentEquity,
        initialBalance,
        peakBalance,
        todayRealizedPnl: Math.round(todayRealizedPnl * 100) / 100,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        totalDailyPnl: Math.round(totalDailyPnl * 100) / 100,
        pnlFromStart: Math.round(pnlFromStart * 100) / 100,
        dailyLoss: Math.round(dailyLoss * 100) / 100,
        dailyLossLimit: Math.round(dailyLossLimit),
        dailyLossUsedPct: Math.round(dailyLossUsedPct * 100) / 100,
        dailyLossRemaining: Math.round(Math.max(0, dailyLossLimit - dailyLoss)),
        drawdown: Math.round(drawdown * 100) / 100,
        maxDrawdownLimit: Math.round(maxDrawdownLimit),
        maxDrawdownUsedPct: Math.round(maxDrawdownUsedPct * 100) / 100,
        maxDrawdownRemaining: Math.round(Math.max(0, maxDrawdownLimit - drawdown)),
        profitTargetAmount: Math.round(profitTargetAmount),
        targetProgressPct: Math.round(targetProgressPct * 100) / 100,
        targetRemaining: Math.round(Math.max(0, profitTargetAmount - Math.max(0, pnlFromStart))),
        todayTradeCount,
        accountStatus: account.status,
        challengeStatus: challenge?.status || 'active',
        challengeType: challenge?.type || 'evaluation_phase1',
      });
    } catch (err) {
      console.error('[RiskState] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Risk events for current account
  router.get('/account/risk-events', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const { RiskEventRepository } = await import('../repositories/risk-event.repository.js');
      const repo = new RiskEventRepository();
      const events = await repo.findByAccountId(realId, { limit: 50 });
      res.json(events);
    } catch (err) { res.json([]); }
  });

  // Live rule progress — shows current/allowed/remaining/status for every active rule
  router.get('/account/rule-progress', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const { RiskEngine } = await import('../services/riskEngine.js');
      const { RuleProgressService } = await import('../services/ruleProgressService.js');
      const { AccountRepository } = await import('../repositories/account.repository.js');
      const { PositionRepository } = await import('../repositories/position.repository.js');
      const { RiskRulesRepository } = await import('../repositories/risk-rules.repository.js');
      const { MetricsRepository } = await import('../repositories/metrics.repository.js');

      const accountRepo = new AccountRepository();
      const positionRepo = new PositionRepository();
      const riskRulesRepo = new RiskRulesRepository();
      const metricsRepo = new MetricsRepository();

      const account = await accountRepo.getWithChallenge(realId);
      if (!account) return res.json({ error: 'Account not found' });

      const rules = await riskRulesRepo.getRulesMap(realId);
      const todayPnl = await RiskEngine.calculateTodayRealizedPnl(realId);
      const unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(realId, null);
      const peakBalance = parseFloat(account.peak_balance || account.challenge?.peak_balance || account.balance);
      const tradingDays = await metricsRepo.getTradingDaysCount(realId);

      const progress = RuleProgressService.calculateProgress({
        accountId: realId,
        rules,
        account: { ...account, initial_balance: account.challenge?.initial_balance },
        todayPnl: todayPnl + unrealizedPnl,
        unrealizedPnl,
        peakBalance,
        tradingDays,
      });

      res.json({
        accountId: realId,
        timestamp: new Date().toISOString(),
        rules: progress,
      });
    } catch (err) {
      console.error('[RuleProgress] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Execution audits for current account
  router.get('/account/audits', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const { AuditRepository } = await import('../repositories/audit.repository.js');
      const repo = new AuditRepository();
      const audits = await repo.findByAccountId(realId, { limit: 50 });
      res.json(audits);
    } catch (err) { res.json([]); }
  });

  // Terminal operational status — execution mode, broker health, feed health
  router.get('/terminal/status', requireAuth, async (req, res) => {
    try {
      const { ExecutionMode } = await import('../services/executionMode.js');
      const { BrokerFactory } = await import('../brokers/broker.factory.js');

      const feedConnected = marketDataEngine.isLive;
      const cachedQuotes = marketDataEngine.quotes.size;

      res.json({
        executionMode: ExecutionMode.getState(),
        broker: {
          provider: 'angelone',
          connected: feedConnected,
          cachedQuotes,
        },
        feed: {
          isLive: feedConnected,
          cachedQuotes,
        },
        tradingAllowed: true, // paper mode allows simulated trading
        tradingBlocked: false,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Margin info
  router.get('/account/margin', requireAuth, async (req, res) => {
    try {
      const { MarginService } = await import('../services/marginService.js');
      const account = await accountService.getAccount(req.user.accountId);
      if (!account) return res.json({ balance: 0, usedMargin: 0, availableMargin: 0 });
      const balance = parseFloat(account.balance) || 0;
      const marginInfo = await MarginService.getAvailableMargin(req.user.accountId, balance);
      res.json(marginInfo);
    } catch (err) {
      res.json({ balance: 0, usedMargin: 0, availableMargin: 0 });
    }
  });

  // Holiday/market status
  router.get('/market/holiday', async (req, res) => {
    try {
      const { HolidayService } = await import('../services/holidayService.js');
      const status = HolidayService.checkMarketClosed();
      const upcoming = HolidayService.getUpcomingHolidays(5);
      res.json({ ...status, upcoming });
    } catch (err) {
      res.json({ isClosed: false, upcoming: [] });
    }
  });

  // Multiple accounts for a user
  router.get('/accounts', requireAuth, async (req, res) => {
    try {
      const { AccountRepository } = await import('../repositories/account.repository.js');
      const accounts = await new AccountRepository().findByUserId(req.user.userId);
      res.json(accounts || []);
    } catch (err) {
      if (err.message && err.message.includes('schema cache')) {
        return res.json([]);
      }
      res.json([]);
    }
  });

  // Switch active account (returns new account info)
  router.get('/accounts/:id', requireAuth, async (req, res) => {
    try {
      const account = await accountService.getAccount(req.params.id);
      if (!account) return res.status(404).json({ message: 'Account not found' });
      res.json(account);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get('/positions', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      res.json(await accountService.getPositions(realId));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/close-all', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const results = await accountService.closeAllPositions(realId, req.body?.reason || 'user_requested');
      res.json({ status: 'closed', results });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/exit', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const qty = req.body?.qty ? parseInt(req.body.qty) : null;
      const result = await accountService.exitPosition(realId, req.params.id, qty);
      res.json({ status: 'exited', orderId: result.orderId });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/reverse', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const result = await accountService.reversePosition(realId, req.params.id);
      res.json({ status: 'reversed', orderId: result.orderId });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/stoploss', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const result = await accountService.executionService.attachStopLoss(realId, req.params.id, parseFloat(req.body.triggerPrice));
      res.json(result);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/takeprofit', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const result = await accountService.executionService.attachTakeProfit(realId, req.params.id, parseFloat(req.body.targetPrice));
      res.json(result);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/breakeven', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const result = await accountService.executionService.breakEven(realId, req.params.id);
      res.json(result);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.get('/orders', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      res.json(await accountService.getOrders(realId));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/orders/place', requireAuth, requirePermission('trade'), validateBody(schemas.placeOrder), async (req, res) => {
    try {
      const p = req.validatedBody;
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const result = await accountService.placeOrder(realId, p);
      res.json(result);
    } catch (err) {
      res.status(err.message.includes('rejected') ? 422 : 500).json({ message: err.message });
    }
  });

  router.put('/orders/:id/modify', requireAuth, requirePermission('trade'), validateBody(schemas.modifyOrder), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      res.json(await accountService.modifyOrder(realId, req.params.id, req.validatedBody));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.delete('/orders/:id/cancel', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      res.json(await accountService.cancelOrder(realId, req.params.id));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.get('/trades', requireAuth, async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      res.json(await accountService.getTrades(realId, req.query.period));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  // Watchlists
  router.get('/watchlists', requireAuth, async (req, res) => {
    try {
      const { WatchlistRepository } = await import('../repositories/watchlist.repository.js');
      const data = await new WatchlistRepository().findByUserId(req.user.userId);
      res.json(data);
    } catch (err) {
      // Table may not exist — return empty array
      if (err.message && err.message.includes('schema cache')) {
        return res.json([]);
      }
      res.status(500).json({ message: err.message });
    }
  });

  router.post('/watchlists', requireAuth, async (req, res) => {
    try {
      const { WatchlistRepository } = await import('../repositories/watchlist.repository.js');
      res.json(await new WatchlistRepository().createWatchlist(req.user.userId, req.body));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.put('/watchlists/:id', requireAuth, async (req, res) => {
    try {
      const { WatchlistRepository } = await import('../repositories/watchlist.repository.js');
      const repo = new WatchlistRepository();
      // IDOR: verify watchlist belongs to user before updating
      const existing = await repo.findById(req.params.id);
      if (!existing || existing.user_id !== req.user.userId) {
        return res.status(403).json({ error: 'forbidden', message: 'Not your watchlist.' });
      }
      const { items, name, color } = req.body;
      if (items !== undefined) await repo.updateItems(req.params.id, items);
      if (name !== undefined) await repo.updateName(req.params.id, name);
      if (color !== undefined) await repo.updateColor(req.params.id, color);
      res.json(await repo.findById(req.params.id));
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.delete('/watchlists/:id', requireAuth, async (req, res) => {
    try {
      const { WatchlistRepository } = await import('../repositories/watchlist.repository.js');
      const repo = new WatchlistRepository();
      // IDOR: verify watchlist belongs to user before deleting
      const existing = await repo.findById(req.params.id);
      if (!existing || existing.user_id !== req.user.userId) {
        return res.status(403).json({ error: 'forbidden', message: 'Not your watchlist.' });
      }
      await repo.deleteWatchlist(req.params.id);
      res.json({ status: 'deleted' });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  // === PUBLIC ===

  router.get('/instruments/search', (req, res) => {
    const { q, segment } = req.query;
    if (!q) return res.json([]);
    res.json(instrumentService.search(q, segment));
  });

  router.get('/instruments', (req, res) => {
    const { segment } = req.query;
    if (!segment) return res.json([]);
    res.json(instrumentService.getBySegment(segment));
  });

  router.get('/market/history', async (req, res) => {
    const { token, tf, from, to } = req.query;
    if (!token || !tf) return res.status(400).json({ message: 'token and tf required' });

    // Use CandleService for historical data from Angel One API
    if (candleService) {
      const candles = await candleService.getHistoricalCandles(
        token, tf,
        from ? parseInt(from) : undefined,
        to ? parseInt(to) : undefined
      );
      if (candles.length > 0) return res.json(candles);
    }

    // Fallback: return empty
    res.json([]);
  });

  router.get('/market/depth', async (req, res) => {
    const { token, exchange } = req.query;
    if (!token) return res.status(400).json({ message: 'token required' });
    if (depthService) {
      const depth = await depthService.getDepth(token, exchange || 'NSE');
      return res.json(depth);
    }
    res.json(marketDataEngine.getDepth(token));
  });

  router.get('/market/quote', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'token required' });
    const quote = marketDataEngine.getQuote(token);
    if (!quote) return res.json(null);
    res.json(quote);
  });

  router.get('/market/status', (req, res) => {
    const mdeStatus = marketDataEngine.getStatus();
    const symbols = {};
    for (const [token, quote] of marketDataEngine.quotes) {
      symbols[token] = { ltp: quote.ltp, exchange: quote.exchange, timestamp: quote.timestamp };
    }
    res.json({
      feed: {
        connected: mdeStatus.isLive,
        adapterName: mdeStatus.adapterName,
        subscribedSymbols: mdeStatus.cachedQuotes,
      },
      symbols,
      socketClients: 0, // Will be populated when realtimeServer is accessible
    });
  });

  router.get('/market/option-chain', async (req, res) => {
    const { symbol, expiry } = req.query;
    if (!symbol || !expiry) return res.status(400).json({ message: 'symbol and expiry required' });
    if (optionChainService) {
      console.log(`[OptionChain] Request: symbol=${symbol}, expiry=${expiry}`);
      const chain = await optionChainService.getOptionChain(symbol, expiry);
      console.log(`[OptionChain] Response: ${chain.length} strikes returned`);
      return res.json(chain);
    }
    res.json([]);
  });

  router.get('/market/expiries', (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ message: 'symbol required' });
    res.json(instrumentService.getExpiries(symbol));
  });

  // === TRADINGVIEW DATAFEED ENDPOINTS ===

  router.get('/tv/config', (req, res) => {
    res.json({
      supported_resolutions: ['1', '3', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
      supports_group_request: false,
      supports_marks: false,
      supports_search: true,
      supports_timescale_marks: false,
      exchanges: [
        { value: 'NSE', name: 'NSE', desc: 'National Stock Exchange' },
        { value: 'NFO', name: 'NFO', desc: 'NSE Futures & Options' },
        { value: 'MCX', name: 'MCX', desc: 'Multi Commodity Exchange' },
        { value: 'CDS', name: 'CDS', desc: 'Currency Derivatives' },
      ],
    });
  });

  router.get('/tv/symbols', (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ s: 'error', errmsg: 'symbol required' });
    const info = tvDatafeed.resolveSymbol(symbol);
    if (!info) return res.status(404).json({ s: 'error', errmsg: 'Symbol not found' });
    res.json(info);
  });

  router.get('/tv/search', (req, res) => {
    const { query, type, exchange, limit } = req.query;
    const results = tvDatafeed.searchSymbols(query || '', type, exchange);
    res.json(results.slice(0, parseInt(limit) || 30));
  });

  router.get('/tv/history', async (req, res) => {
    const { symbol, resolution, from, to } = req.query;
    if (!symbol || !resolution) {
      return res.json({ s: 'error', errmsg: 'symbol and resolution required' });
    }

    // Resolve token from symbol name
    const info = tvDatafeed.resolveSymbol(symbol);
    const token = info?.token || symbol;

    // Fetch from CandleService (Angel One historical API)
    const candles = candleService
      ? await candleService.getHistoricalCandles(token, resolution, parseInt(from) || undefined, parseInt(to) || undefined)
      : [];

    if (!candles || candles.length === 0) {
      return res.json({ s: 'no_data' });
    }

    // TradingView UDF format
    res.json({
      s: 'ok',
      t: candles.map(b => b.time),
      o: candles.map(b => b.open),
      h: candles.map(b => b.high),
      l: candles.map(b => b.low),
      c: candles.map(b => b.close),
      v: candles.map(b => b.volume),
    });
  });

  // Broker health endpoint (for monitoring)
  router.get('/broker/health', async (req, res) => {
    try {
      const { BrokerFactory } = await import('../brokers/broker.factory.js');
      res.json(BrokerFactory.getHealthReport());
    } catch {
      res.json({ error: 'broker factory not available' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // SCANNER
  // ═══════════════════════════════════════════════════════════
  router.get('/market/scanner', async (req, res) => {
    try {
      const { ScannerService } = await import('../services/scannerService.js');
      const scanner = new ScannerService(marketDataEngine, instrumentService);
      const results = await scanner.scan(req.query.type || 'top_gainers', req.query.segment || 'NSE', parseInt(req.query.limit) || 30);
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // HEATMAP
  // ═══════════════════════════════════════════════════════════
  router.get('/market/heatmap', async (req, res) => {
    try {
      const { HeatmapService } = await import('../services/heatmapService.js');
      const heatmap = new HeatmapService(marketDataEngine);
      const results = await heatmap.getHeatmap(req.query.view || 'nifty50');
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // OI ANALYTICS
  // ═══════════════════════════════════════════════════════════
  router.get('/market/oi-analytics', async (req, res) => {
    try {
      const { OIAnalyticsService } = await import('../services/oiAnalyticsService.js');
      const oiService = new OIAnalyticsService(optionChainService);
      const data = await oiService.getOIAnalytics(req.query.symbol || 'NIFTY', req.query.expiry || null);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // EQUITY CURVE
  // ═══════════════════════════════════════════════════════════
  router.get('/account/equity-curve', requireAuth, async (req, res) => {
    try {
      const { MetricsRepository } = await import('../repositories/metrics.repository.js');
      const metricsRepo = new MetricsRepository();
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const days = parseInt(req.query.days) || 90;
      const data = await metricsRepo.getEquityCurve(realId, days);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // ACCOUNT METRICS (for calendar analytics)
  // ═══════════════════════════════════════════════════════════
  router.get('/account/metrics', requireAuth, async (req, res) => {
    try {
      const { MetricsRepository } = await import('../repositories/metrics.repository.js');
      const metricsRepo = new MetricsRepository();
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const from = req.query.from;
      const to = req.query.to;

      let data;
      if (from && to) {
        const { data: rows, error } = await metricsRepo.db
          .from('account_metrics')
          .select('*')
          .eq('trading_account_id', realId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true });
        if (error) throw new Error(error.message);
        data = rows || [];
      } else {
        data = await metricsRepo.getRecentMetrics(realId, parseInt(req.query.days) || 30);
      }
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
