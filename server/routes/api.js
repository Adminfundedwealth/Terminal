import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { supabase } from '../db/client.js';
import { eventBus } from '../events/eventBus.js';

import { TradingViewDatafeed } from '../realtime/tradingview.datafeed.js';

export function createApiRouter(accountService, instrumentService, marketDataEngine, candleService, depthService, optionChainService, dataProviderSwitch) {
  const router = Router();
  const tvDatafeed = new TradingViewDatafeed(instrumentService, marketDataEngine);

  // Helper: parse Dhan marketfeed/quote nested response into LTP number
  function _parseDhanQuote(result, securityId, segment) {
    if (!result) return null;
    if (result.ltp && Number.isFinite(result.ltp)) return result.ltp;
    if (result.last_price && Number.isFinite(result.last_price)) return result.last_price;
    if (typeof result === 'object') {
      // Dhan returns: { "MCX_COMM": { "429604": { "ltp": 72500 } } }
      const segData = result[segment] || Object.values(result)[0];
      if (segData && typeof segData === 'object') {
        const entry = segData[securityId] || segData[parseInt(securityId)] || Object.values(segData)[0];
        if (entry?.ltp) return entry.ltp;
        if (entry?.last_price) return entry.last_price;
      }
    }
    return null;
  }

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
      const { TradeRepository } = await import('../repositories/trade.repository.js');

      const accountRepo = new AccountRepository();
      const positionRepo = new PositionRepository();
      const tradeRepo = new TradeRepository();

      const account = await accountRepo.getWithChallenge(realId);
      if (!account) return res.json({ error: 'Account not found' });

      const challenge = account.challenge;
      const balance = parseFloat(account.balance) || 0;

      // initialBalance: must be a positive number. If challenge.initial_balance is null/0
      // (fresh account not yet provisioned), fall back to current balance so that
      // all limit calculations remain valid and never produce divide-by-zero.
      const rawInitial = challenge ? parseFloat(challenge.initial_balance) : null;
      const initialBalance = (rawInitial && rawInitial > 0) ? rawInitial : balance;

      // peakBalance: never less than initialBalance so drawdown is always >= 0
      const rawPeak = parseFloat(account.peak_balance || challenge?.peak_balance || 0);
      const peakBalance = rawPeak > 0 ? Math.max(rawPeak, initialBalance) : initialBalance;

      // Today's realized P&L
      let todayRealizedPnl = 0;
      try { todayRealizedPnl = await RiskEngine.calculateTodayRealizedPnl(realId); } catch {}

      // Unrealized P&L from open positions
      let unrealizedPnl = 0;
      try { unrealizedPnl = await positionRepo.getTotalUnrealizedPnl(realId, null); } catch {}

      const totalDailyPnl = todayRealizedPnl + unrealizedPnl;
      const currentEquity = balance + unrealizedPnl;
      const pnlFromStart = currentEquity - initialBalance;

      // Read rule percentages — DB stores as whole numbers: 8 = 8%, 5 = 5%, 10 = 10%
      // Fallback values are also whole numbers.
      const dailyLossPct = (challenge?.daily_loss_limit_pct !== null && challenge?.daily_loss_limit_pct !== undefined)
        ? parseFloat(challenge.daily_loss_limit_pct)
        : 5;   // 5% fallback
      const maxDrawdownPct = (challenge?.max_drawdown_pct !== null && challenge?.max_drawdown_pct !== undefined)
        ? parseFloat(challenge.max_drawdown_pct)
        : 10;  // 10% fallback
      const profitTargetPct = (challenge?.profit_target_pct !== null && challenge?.profit_target_pct !== undefined)
        ? parseFloat(challenge.profit_target_pct)
        : 10;  // 10% fallback

      // Daily loss consumed
      const dailyLossLimit = (dailyLossPct / 100) * initialBalance;
      const dailyLoss = totalDailyPnl < 0 ? Math.abs(totalDailyPnl) : 0;
      const dailyLossUsedPct = dailyLossLimit > 0 ? Math.min(100, (dailyLoss / dailyLossLimit) * 100) : 0;

      // Max drawdown consumed
      const maxDrawdownLimit = (maxDrawdownPct / 100) * initialBalance;
      const drawdown = Math.max(0, peakBalance - currentEquity);
      const maxDrawdownUsedPct = maxDrawdownLimit > 0 ? Math.min(100, (drawdown / maxDrawdownLimit) * 100) : 0;

      // Profit target progress
      const profitTargetAmount = (profitTargetPct / 100) * initialBalance;
      const targetProgressPct = profitTargetAmount > 0 ? Math.min(100, Math.max(0, (pnlFromStart / profitTargetAmount) * 100)) : 0;

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

      // Check account status for trading block
      let tradingBlocked = false;
      let blockReason = null;
      try {
        const account = await accountService.getAccount(req.user.accountId);
        if (account && (account.status === 'locked' || account.status === 'breached' || account.status === 'suspended')) {
          tradingBlocked = true;
          blockReason = account.lockedReason || account.locked_reason || `Account is ${account.status}`;
        }
      } catch (_e) {
        // Non-critical — don't block status endpoint
      }

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
        tradingAllowed: !tradingBlocked,
        tradingBlocked,
        blockReason,
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

  // Multiple accounts for a user — returns all active accounts with challenge data
  router.get('/accounts', requireAuth, async (req, res) => {
    try {
      if (!supabase) return res.json([]);

      // Fetch all active accounts for this trader with challenge data
      const { data: rows, error } = await supabase
        .from('trading_accounts')
        .select('*, challenge_accounts(id, type, plan, initial_balance, peak_balance, profit_target_pct, daily_loss_limit_pct, max_drawdown_pct, status, started_at, expires_at)')
        .eq('trader_id', req.user.userId)
        .in('status', ['active', 'funded', 'evaluation', 'completed'])
        .order('created_at', { ascending: false });

      if (error || !rows) return res.json([]);

      const accounts = rows.map(row => {
        const ch = row.challenge_accounts;
        return {
          id: row.id,
          accountCode: row.account_code,
          clientId: row.broker_client_id || row.account_code,
          userId: row.trader_id,
          brokerProvider: row.broker_provider,
          balance: parseFloat(row.balance) || 0,
          peakBalance: parseFloat(ch?.peak_balance ?? row.peak_balance) || parseFloat(row.balance) || 0,
          availableMargin: parseFloat(row.available_margin) || 0,
          usedMargin: parseFloat(row.used_margin) || 0,
          status: row.status,
          lockedReason: row.locked_reason || null,
          challenge: ch ? {
            id: ch.id,
            type: ch.type,
            plan: ch.plan,
            initialBalance: parseFloat(ch.initial_balance) || 0,
            status: ch.status,
            startedAt: ch.started_at,
            expiresAt: ch.expires_at,
            profitTargetPct: parseFloat(ch.profit_target_pct) || 10,
            dailyLossLimitPct: parseFloat(ch.daily_loss_limit_pct) || 5,
            maxDrawdownPct: parseFloat(ch.max_drawdown_pct) || 10,
          } : null,
        };
      });

      res.json(accounts);
    } catch (err) {
      if (err.message && err.message.includes('schema cache')) return res.json([]);
      res.json([]);
    }
  });

  // Switch active account — validates ownership, sets server-side override
  router.post('/account/switch', requireAuth, async (req, res) => {
    const { accountId } = req.body;
    if (!accountId || typeof accountId !== 'string') {
      return res.status(400).json({ success: false, message: 'accountId is required.' });
    }
    try {
      const { switchAccount } = await import('../services/accountSwitchService.js');
      const result = await switchAccount(req.token, req.user.userId, accountId);
      if (!result.success) {
        return res.status(403).json({ success: false, message: result.error });
      }
      // Return full account info for the new account
      const account = await accountService.getAccount(result.accountId);
      res.json({ success: true, account });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
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
      const triggerPrice = parseFloat(req.body.triggerPrice);
      const result = await accountService.executionService.attachStopLoss(realId, req.params.id, triggerPrice);

      // Immediately broadcast position_update so the chart SL line appears
      // without waiting for the next MTM tick or page refresh.
      try {
        const positions = await accountService.getPositions(realId);
        const pos = positions.find(p => p.id === req.params.id);
        if (pos) {
          eventBus.publish('position.updated', {
            ...pos,
            stopLoss: triggerPrice,
            pnl: pos.pnl ?? 0,
          }, { accountId: realId });
        }
      } catch (_e) { /* non-critical — order already placed */ }

      res.json({ ...result, stopLoss: triggerPrice });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/takeprofit', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const targetPrice = parseFloat(req.body.targetPrice);
      const result = await accountService.executionService.attachTakeProfit(realId, req.params.id, targetPrice);

      // Immediately broadcast position_update so the chart TP line appears.
      try {
        const positions = await accountService.getPositions(realId);
        const pos = positions.find(p => p.id === req.params.id);
        if (pos) {
          eventBus.publish('position.updated', {
            ...pos,
            takeProfit: targetPrice,
            pnl: pos.pnl ?? 0,
          }, { accountId: realId });
        }
      } catch (_e) { /* non-critical — order already placed */ }

      res.json({ ...result, takeProfit: targetPrice });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  router.post('/positions/:id/breakeven', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const result = await accountService.executionService.breakEven(realId, req.params.id);
      res.json(result);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  // PATCH /positions/:id — Update SL/TP from chart drag
  router.patch('/positions/:id', requireAuth, requirePermission('trade'), async (req, res) => {
    try {
      const realId = await accountService.resolveAccountId(req.user.accountId);
      const { stopLoss, takeProfit } = req.body;

      const results = {};

      if (stopLoss !== undefined && stopLoss !== null) {
        const slPrice = parseFloat(stopLoss);
        if (isNaN(slPrice) || slPrice <= 0) {
          return res.status(400).json({ message: 'Invalid stopLoss price' });
        }
        try {
          const result = await accountService.executionService.attachStopLoss(realId, req.params.id, slPrice);
          results.stopLoss = result;
        } catch (err) {
          // Store SL locally if execution service not available
          const { PositionRepository } = await import('../repositories/position.repository.js');
          const repo = new PositionRepository();
          await repo.update(req.params.id, { stop_loss: slPrice, updated_at: new Date().toISOString() });
          results.stopLoss = { status: 'stored', price: slPrice };
        }
      }

      if (takeProfit !== undefined && takeProfit !== null) {
        const tpPrice = parseFloat(takeProfit);
        if (isNaN(tpPrice) || tpPrice <= 0) {
          return res.status(400).json({ message: 'Invalid takeProfit price' });
        }
        try {
          const result = await accountService.executionService.attachTakeProfit(realId, req.params.id, tpPrice);
          results.takeProfit = result;
        } catch (err) {
          // Store TP locally if execution service not available
          const { PositionRepository } = await import('../repositories/position.repository.js');
          const repo = new PositionRepository();
          await repo.update(req.params.id, { take_profit: tpPrice, updated_at: new Date().toISOString() });
          results.takeProfit = { status: 'stored', price: tpPrice };
        }
      }

      // Broadcast position_update so chart lines appear immediately
      try {
        const positions = await accountService.getPositions(realId);
        const pos = positions.find(p => p.id === req.params.id);
        if (pos) {
          eventBus.publish('position.updated', {
            ...pos,
            ...(stopLoss  != null ? { stopLoss:  parseFloat(stopLoss)  } : {}),
            ...(takeProfit != null ? { takeProfit: parseFloat(takeProfit) } : {}),
            pnl: pos.pnl ?? 0,
          }, { accountId: realId });
        }
      } catch (_e) { /* non-critical */ }

      res.json({ status: 'updated', ...results });
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
      // Add a 10-second timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Order execution timeout — please retry')), 10000)
      );
      const result = await Promise.race([
        accountService.placeOrder(realId, p),
        timeoutPromise,
      ]);
      res.json(result);
    } catch (err) {
      const status = err.message.includes('rejected') ? 422 
        : err.message.includes('timeout') ? 504 
        : 500;
      res.status(status).json({ message: err.message });
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
      const result = await accountService.cancelOrder(realId, req.params.id);
      res.json(result);
    } catch (err) {
      // Order may already be filled — return 409 conflict, not 500
      if (err.message && (err.message.includes('cancel') || err.message.includes('No rows') || err.message.includes('0 rows'))) {
        return res.status(409).json({ status: 'error', message: 'Order cannot be cancelled — it may already be filled or cancelled.' });
      }
      res.status(500).json({ message: err.message });
    }
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
      if (!existing || (existing.trader_id !== req.user.userId && existing.user_id !== req.user.userId)) {
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
      if (!existing || (existing.trader_id !== req.user.userId && existing.user_id !== req.user.userId)) {
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
    let { token, from, to, exchange } = req.query;
    const tf = req.query.tf || req.query.timeframe || req.query.resolution;
    if (!token || !tf) return res.status(400).json({ message: 'token and tf required' });

    // Native Dhan mapping for placeholder tokens
    const PLACEHOLDER_TO_DHAN = {
      'NF_FUT': { securityId: '13', segment: 'IDX_I', spotToken: '99926000' },
      'NF_FUT_N': { securityId: '13', segment: 'IDX_I', spotToken: '99926000' },
      'NF_FUT_F': { securityId: '13', segment: 'IDX_I', spotToken: '99926000' },
      'BNF_FUT': { securityId: '25', segment: 'IDX_I', spotToken: '99926009' },
      'BNF_FUT_N': { securityId: '25', segment: 'IDX_I', spotToken: '99926009' },
      'FNF_FUT': { securityId: '27', segment: 'IDX_I', spotToken: '99926037' },
      'MCN_FUT': { securityId: '442', segment: 'IDX_I', spotToken: '99926074' },
      'SEN_FUT': { securityId: '51', segment: 'IDX_I', spotToken: '99919000' },
      'REL_FUT': { securityId: '2885', segment: 'NSE_EQ', spotToken: '2885' },
      'SBIN_FUT': { securityId: '3045', segment: 'NSE_EQ', spotToken: '3045' },
      'HDFC_FUT': { securityId: '1333', segment: 'NSE_EQ', spotToken: '1333' },
      'ICICI_FUT': { securityId: '4963', segment: 'NSE_EQ', spotToken: '4963' },
      'TCS_FUT': { securityId: '11536', segment: 'NSE_EQ', spotToken: '11536' },
      'INFY_FUT': { securityId: '1594', segment: 'NSE_EQ', spotToken: '1594' },
      'GOLD_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'GOLD' },
      'GOLDM_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'GOLDM' },
      'SILVER_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'SILVER' },
      'SILVERM_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'SILVERM' },
      'CRUDE_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'CRUDEOIL' },
      'NATGAS_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'NATURALGAS' },
      'COPPER_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'COPPER' },
      'USDINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'USDINR' },
      'EURINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'EURINR' },
      'GBPINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'GBPINR' },
      'JPYINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'JPYINR' },
    };

    const mapping = PLACEHOLDER_TO_DHAN[token];
    if (mapping) {
      if (mapping.securityId) {
        // Static resolution (Index/Stock futures → use securityId directly)
        token = mapping.securityId;
        exchange = mapping.segment;
      } else if (mapping.scripSymbol && dataProviderSwitch) {
        // Dynamic resolution via scrip master for MCX/CDS
        try {
          const dhan = dataProviderSwitch.getDhanAdapter();
          if (dhan?.historical?._getScripMaster) {
            const master = await dhan.historical._getScripMaster();
            if (master?.bySymbol) {
              const dhanSeg = mapping.segment === 'NSE_CURRENCY' ? 'CUR' : mapping.segment;
              const entry = master.bySymbol.get(`${mapping.scripSymbol}:${dhanSeg}`) ||
                           master.bySymbol.get(`${mapping.scripSymbol}:${mapping.segment}`);
              if (entry?.securityId) {
                token = entry.securityId;
                exchange = mapping.segment;
              }
            }
          }
        } catch (e) {
          console.warn(`[History] Scrip resolution failed for ${token}: ${e.message}`);
        }
      }
    }

    // Use DataProviderSwitch for historical data (routes to Dhan or Angel One with failover)
    if (dataProviderSwitch) {
      try {
        const resolvedExchange = exchange ? String(exchange) : 'NSE';
        // Also register exchange in candleService for live candle aggregation
        if (candleService && resolvedExchange && token) {
          candleService.registerTokenExchange(String(token), resolvedExchange);
        }

        const fromTs = from ? parseInt(String(from), 10) : 0;
        const toTs = to ? parseInt(String(to), 10) : Math.floor(Date.now() / 1000);

        const result = await dataProviderSwitch.getHistoricalCandles(
          token, tf, resolvedExchange, fromTs, toTs
        );

        if (result.data && result.data.length > 0) {
          return res.json(result.data);
        }

        // If provider returned empty, try live candle fallback
        if (candleService) {
          const currentCandle = candleService.getCurrentCandle(token, String(tf));
          if (currentCandle) {
            console.warn(`[API] /market/history (${result.provider}) returned 0 candles for ${token}/${tf}, returning live candle fallback`);
            return res.json([currentCandle]);
          }
        }

        console.warn(`[API] /market/history returned 0 candles for ${token}/${tf} via ${result.provider}`);
      } catch (err) {
        console.error('[API] /market/history dataProviderSwitch error:', err.message || err);
      }
    }

    // Legacy fallback: Use CandleService directly (Angel One only)
    if (candleService) {
      try {
        const resolvedExchange = exchange ? String(exchange) : undefined;
        if (resolvedExchange && token) {
          candleService.registerTokenExchange(String(token), resolvedExchange);
        }

        const candles = await candleService.getHistoricalCandles(
          token,
          tf,
          resolvedExchange,
          from ? parseInt(String(from), 10) : undefined,
          to ? parseInt(String(to), 10) : undefined
        );
        if (candles.length > 0) return res.json(candles);
      } catch (err) {
        console.error('[API] /market/history candleService fallback error:', err.message || err);
      }
    }

    // Final fallback: return empty
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

  router.get('/market/quote', async (req, res) => {
    let { token, exchange } = req.query;
    if (!token) return res.status(400).json({ message: 'token required' });

    // Native Dhan mapping for Futures, Commodities & Currencies
    const PLACEHOLDER_TO_DHAN = {
      // Index Futures (NSE_FNO)
      'NF_FUT': { securityId: '13', segment: 'IDX_I', spotToken: '99926000' },
      'NF_FUT_N': { securityId: '13', segment: 'IDX_I', spotToken: '99926000' },
      'NF_FUT_F': { securityId: '13', segment: 'IDX_I', spotToken: '99926000' },
      'BNF_FUT': { securityId: '25', segment: 'IDX_I', spotToken: '99926009' },
      'BNF_FUT_N': { securityId: '25', segment: 'IDX_I', spotToken: '99926009' },
      'FNF_FUT': { securityId: '27', segment: 'IDX_I', spotToken: '99926037' },
      'MCN_FUT': { securityId: '442', segment: 'IDX_I', spotToken: '99926074' },
      'SEN_FUT': { securityId: '51', segment: 'IDX_I', spotToken: '99919000' },
      // Stock Futures (NSE_FNO)
      'REL_FUT': { securityId: '2885', segment: 'NSE_EQ', spotToken: '2885' },
      'SBIN_FUT': { securityId: '3045', segment: 'NSE_EQ', spotToken: '3045' },
      'HDFC_FUT': { securityId: '1333', segment: 'NSE_EQ', spotToken: '1333' },
      'ICICI_FUT': { securityId: '4963', segment: 'NSE_EQ', spotToken: '4963' },
      'TCS_FUT': { securityId: '11536', segment: 'NSE_EQ', spotToken: '11536' },
      'INFY_FUT': { securityId: '1594', segment: 'NSE_EQ', spotToken: '1594' },
      // MCX Commodities (MCX_COMM) — dynamic resolution via scrip master preferred
      'GOLD_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'GOLD' },
      'GOLDM_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'GOLDM' },
      'SILVER_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'SILVER' },
      'SILVERM_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'SILVERM' },
      'CRUDE_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'CRUDEOIL' },
      'NATGAS_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'NATURALGAS' },
      'COPPER_F': { securityId: null, segment: 'MCX_COMM', spotToken: null, scripSymbol: 'COPPER' },
      // CDS Currencies (NSE_CURRENCY) — dynamic resolution
      'USDINR_F': { securityId: null, segment: 'NSE_CURRENCY', spotToken: null, scripSymbol: 'USDINR' },
      'EURINR_F': { securityId: null, segment: 'NSE_CURRENCY', spotToken: null, scripSymbol: 'EURINR' },
      'GBPINR_F': { securityId: null, segment: 'NSE_CURRENCY', spotToken: null, scripSymbol: 'GBPINR' },
      'JPYINR_F': { securityId: null, segment: 'NSE_CURRENCY', spotToken: null, scripSymbol: 'JPYINR' },
    };

    const mapping = PLACEHOLDER_TO_DHAN[token];
    if (mapping) {
      // FAST PATH: spot token from Angel feed (instant, no network)
      if (mapping.spotToken) {
        const spotQuote = marketDataEngine.getQuote(mapping.spotToken);
        if (spotQuote && spotQuote.ltp > 0) return res.json({ ...spotQuote, token });
      }

      // SLOW PATH: Dhan API resolution — wrapped in strict 1.5s timeout
      // If scrip master isn't loaded yet or Dhan is slow, return null immediately
      const resolveViaDhan = async () => {
        const dhan = dataProviderSwitch?.getDhanAdapter();
        if (!dhan?.isConnected) return null;

        // Path A: Static security ID (Index/Stock futures)
        if (mapping.securityId) {
          const dhanSeg = mapping.segment === 'NSE_CURRENCY' ? 'CUR' : mapping.segment;
          const result = await dhan.getQuote(mapping.securityId, dhanSeg);
          return _parseDhanQuote(result, mapping.securityId, dhanSeg);
        }

        // Path B: Dynamic resolution via pre-loaded scrip master (MCX/CDS)
        if (mapping.scripSymbol && dhan.historical?._scripMaster) {
          const master = dhan.historical._scripMaster; // Already loaded — no await
          if (!master?.bySymbol) return null;
          const dhanSeg = mapping.segment === 'NSE_CURRENCY' ? 'CUR' : mapping.segment;
          const entry = master.bySymbol.get(`${mapping.scripSymbol}:${dhanSeg}`) ||
                       master.bySymbol.get(`${mapping.scripSymbol}:${mapping.segment}`) ||
                       master.bySymbol.get(`${mapping.scripSymbol}:E`);
          if (!entry?.securityId) return null;
          const result = await dhan.getQuote(entry.securityId, dhanSeg);
          return _parseDhanQuote(result, entry.securityId, dhanSeg);
        }
        return null;
      };

      try {
        const ltp = await Promise.race([
          resolveViaDhan(),
          new Promise(resolve => setTimeout(() => resolve(null), 1500)), // 1.5s max
        ]);
        if (ltp && Number.isFinite(ltp) && ltp > 0) {
          return res.json({ token, ltp, exchange: mapping.segment, timestamp: Date.now(), symbol: mapping.scripSymbol || token });
        }
      } catch (e) {
        console.warn(`[Quote] MCX/CDS resolution failed for ${token}: ${e.message}`);
      }

      return res.json(null);
    }

    // Non-placeholder token — standard lookup
    const quote = marketDataEngine.getQuote(token);
    if (quote && quote.ltp > 0) return res.json(quote);

    // No cached quote — try getLivePrice fallback (Dhan API, candle close, depth midpoint)
    if (marketDataEngine.getLivePrice) {
      try {
        const ltp = await marketDataEngine.getLivePrice(token, exchange || 'NSE');
        if (ltp && ltp > 0) {
          const fallbackQuote = { token, ltp, exchange: exchange || 'NSE', timestamp: Date.now() };
          return res.json(fallbackQuote);
        }
      } catch (_) {}
    }

    res.json(quote || null);
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

    console.log(`[OptionChain] Request: symbol=${symbol}, expiry=${expiry}`);

    // Try DataProviderSwitch first (routes to Dhan with Greeks or Angel One)
    if (dataProviderSwitch) {
      try {
        const result = await dataProviderSwitch.getOptionChain(symbol, expiry);
        if (result.data && result.data.length > 0) {
          console.log(`[OptionChain] Response via ${result.provider}: ${result.data.length} strikes`);
          return res.json(result.data);
        }
      } catch (err) {
        console.warn(`[OptionChain] DataProviderSwitch failed: ${err.message} — falling back to Angel`);
      }
    }

    // Fallback: existing Angel One optionChainService
    if (!optionChainService) return res.json([]);

    await optionChainService._ensureToken();

    if (!optionChainService.jwtToken) {
      console.warn('[OptionChain] No JWT token — returning 503 so client retries');
      return res.status(503).json({ message: 'Market data service initializing. Retrying…' });
    }

    const chain = await optionChainService.getOptionChain(symbol, expiry);
    console.log(`[OptionChain] Response via Angel: ${chain.length} strikes returned`);

    return res.json(chain);
  });

  router.get('/market/expiries', async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ message: 'symbol required' });

    // Try DataProviderSwitch first (Dhan or Angel with failover)
    if (dataProviderSwitch) {
      try {
        const result = await dataProviderSwitch.getExpiries(symbol);
        if (result.data && result.data.length > 0) {
          return res.json(result.data);
        }
      } catch (err) {
        console.warn(`[Expiries] DataProviderSwitch failed: ${err.message}`);
      }
    }

    // Fallback: existing Angel One optionChainService
    if (optionChainService) {
      await optionChainService._ensureToken();

      if (optionChainService.jwtToken) {
        try {
          const expiries = await optionChainService.getExpiries(symbol);
          if (expiries && expiries.length > 0) return res.json(expiries);
        } catch (err) {
          console.error('[Expiries] optionChainService failed:', err.message);
        }
      }
    }

    // Final fallback: instrumentService hardcoded expiries (always returns something)
    return res.json(instrumentService.getExpiries(symbol));
  });

  // Alias: /market/option-expiries → same handler as /market/expiries
  router.get('/market/option-expiries', async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ message: 'symbol required' });

    if (dataProviderSwitch) {
      try {
        const result = await dataProviderSwitch.getExpiries(symbol);
        if (result.data && result.data.length > 0) {
          return res.json(result.data);
        }
      } catch (_) {}
    }
    if (optionChainService) {
      try {
        await optionChainService._ensureToken();
        const expiries = await optionChainService.getExpiries(symbol);
        if (expiries && expiries.length > 0) return res.json(expiries);
      } catch (_) {}
    }
    return res.json(instrumentService.getExpiries(symbol));
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
    const exchange = info?.exchange || 'NSE';

    // Use DataProviderSwitch if available (Dhan/Angel failover)
    let candles = [];
    if (dataProviderSwitch) {
      try {
        const fromTs = parseInt(from) || Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
        const toTs = parseInt(to) || Math.floor(Date.now() / 1000);
        const result = await dataProviderSwitch.getHistoricalCandles(token, resolution, exchange, fromTs, toTs);
        candles = result.data || [];
      } catch (err) {
        console.warn(`[TV] DataProviderSwitch error: ${err.message}`);
      }
    }

    // Fallback to direct CandleService if DataProviderSwitch returned empty
    if (candles.length === 0 && candleService) {
      candles = await candleService.getHistoricalCandles(token, resolution, parseInt(from) || undefined, parseInt(to) || undefined) || [];
    }

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

  // Data provider switch status — FULL DIAGNOSTICS
  router.get('/provider/status', (req, res) => {
    if (dataProviderSwitch) {
      res.json(dataProviderSwitch.getStatus());
    } else {
      res.json({ activeProvider: 'ANGELONE', dhanReady: false, error: 'DataProviderSwitch not initialized' });
    }
  });

  // Direct Dhan test endpoint — bypasses all caching/fallback
  router.get('/provider/test-dhan', async (req, res) => {
    if (!dataProviderSwitch) return res.json({ error: 'not initialized' });
    const dhan = dataProviderSwitch.getDhanAdapter();
    if (!dhan) return res.json({ error: 'no dhan adapter' });
    try {
      const token = req.query.token || '2885';
      const exchange = req.query.exchange || 'NSE';
      const tf = req.query.tf || '5';
      const result = await dhan.getHistoricalData(token, exchange, tf, 0, Math.floor(Date.now() / 1000));
      res.json({ success: true, candles: result?.length || 0, sample: result?.slice(0, 2) || [] });
    } catch (err) {
      res.json({ success: false, error: err.message, response: err.response?.data });
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
  // LIVE ACCOUNT ANALYTICS — computed from executions + positions
  // Used by the dashboard Analytics page to show real-time data.
  // This mirrors AnalyticsPanel.tsx but server-side so the dashboard
  // can fetch it without being inside the terminal.
  // ═══════════════════════════════════════════════════════════
  router.get('/account/analytics', requireAuth, async (req, res) => {
    try {
      const { TradeRepository } = await import('../repositories/trade.repository.js');
      const { PositionRepository } = await import('../repositories/position.repository.js');

      const realId = await accountService.resolveAccountId(req.user.accountId);
      const tradeRepo = new TradeRepository();
      const positionRepo = new PositionRepository();

      // Fetch all executions for this account (all time, for total stats)
      const allExecutions = await tradeRepo.findByAccountId(realId);
      // Fetch open positions for unrealized P&L
      const positions = await positionRepo.findOpenByAccountId(realId);

      // Helper: FIFO P&L computation from a list of executions
      // Handles both long (BUY→SELL) and short (SELL→BUY) round trips correctly.
      function computePnlFromExecutions(executions) {
        // Group by token, sort by time ascending, then FIFO match
        const byToken = {};
        for (const t of executions) {
          const key = t.token || t.symbol;
          if (!byToken[key]) byToken[key] = [];
          byToken[key].push(t);
        }

        const trades = []; // { pnl, date, symbol }

        for (const [, symbolTrades] of Object.entries(byToken)) {
          symbolTrades.sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());

          // Use a queue of open lots: each lot = { side: 'LONG'|'SHORT', qty, price, date }
          const openLots = []; // FIFO queue

          for (const t of symbolTrades) {
            const qty = parseInt(t.qty) || 0;
            const price = parseFloat(t.price) || 0;
            const date = (t.executed_at || '').split('T')[0];
            const symbol = t.symbol;

            // Incoming direction: BUY opens LONG or closes SHORT; SELL opens SHORT or closes LONG
            const incomingDir = t.side === 'BUY' ? 'LONG' : 'SHORT';
            const closingDir  = t.side === 'BUY' ? 'SHORT' : 'LONG'; // this BUY closes an open SHORT, etc.

            let remaining = qty;

            // First: try to close existing opposite-side lots (FIFO)
            while (remaining > 0 && openLots.length > 0 && openLots[0].side === closingDir) {
              const lot = openLots[0];
              const closeQty = Math.min(remaining, lot.qty);

              // P&L: for closing a LONG (selling it), pnl = (sell_price - buy_price) * qty
              //       for closing a SHORT (buying it back), pnl = (sell_price - buy_price) * qty
              let pnl;
              if (closingDir === 'LONG') {
                // Closing a long via SELL
                pnl = (price - lot.price) * closeQty;
              } else {
                // Closing a short via BUY
                pnl = (lot.price - price) * closeQty;
              }

              trades.push({ pnl, date, symbol });

              lot.qty -= closeQty;
              if (lot.qty <= 0) openLots.shift();
              remaining -= closeQty;
            }

            // If any qty left, it opens a new position
            if (remaining > 0) {
              openLots.push({ side: incomingDir, qty: remaining, price, date });
            }
          }
        }

        return trades;
      }

      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Start of week (Monday)
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - mondayOffset);
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      // Start of month
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      // Compute realized P&L from all executions
      const allTrades = computePnlFromExecutions(allExecutions);

      // Add today's unrealized from open positions
      const unrealizedPnl = positions.reduce((sum, p) => {
        const pnl = parseFloat(p.unrealized_pnl || 0);
        return sum + pnl;
      }, 0);

      // Include unrealized in today's P&L
      const todayUnrealized = unrealizedPnl; // only add once for today

      const totalTrades = allTrades.length;
      const winners = allTrades.filter(t => t.pnl > 0);
      const losers = allTrades.filter(t => t.pnl < 0);
      const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
      const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
      const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
      const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
      const avgWin = winners.length > 0 ? grossProfit / winners.length : 0;
      const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;
      const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
      const bestTrade = allTrades.length > 0 ? Math.max(...allTrades.map(t => t.pnl)) : 0;
      const worstTrade = allTrades.length > 0 ? Math.min(...allTrades.map(t => t.pnl)) : 0;

      const dailyTrades = allTrades.filter(t => t.date === today);
      const dailyPnl = dailyTrades.reduce((s, t) => s + t.pnl, 0) + todayUnrealized;
      const weeklyPnl = allTrades.filter(t => t.date >= weekStartStr).reduce((s, t) => s + t.pnl, 0);
      const monthlyPnl = allTrades.filter(t => t.date >= monthStart).reduce((s, t) => s + t.pnl, 0);

      const dailyWinRate = dailyTrades.length > 0
        ? (dailyTrades.filter(t => t.pnl > 0).length / dailyTrades.length) * 100
        : 0;

      // Win/loss streaks
      let maxWinStreak = 0, maxLossStreak = 0, currentStreak = 0, streakType = null;
      for (const t of allTrades) {
        if (t.pnl > 0) {
          if (streakType === 'win') { currentStreak++; } else { currentStreak = 1; streakType = 'win'; }
          maxWinStreak = Math.max(maxWinStreak, currentStreak);
        } else if (t.pnl < 0) {
          if (streakType === 'loss') { currentStreak++; } else { currentStreak = 1; streakType = 'loss'; }
          maxLossStreak = Math.max(maxLossStreak, currentStreak);
        }
      }

      // Expectancy
      const expectancy = totalTrades > 0
        ? ((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss)
        : 0;

      // Symbol breakdown
      const symbolMap = {};
      for (const t of allTrades) {
        if (!t.symbol) continue;
        if (!symbolMap[t.symbol]) symbolMap[t.symbol] = { symbol: t.symbol, trades: 0, pnl: 0 };
        symbolMap[t.symbol].trades++;
        symbolMap[t.symbol].pnl += t.pnl;
      }
      const symbolBreakdown = Object.values(symbolMap)
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
        .slice(0, 10);

      // Day of week breakdown
      const dowMap = { Mon: { pnl: 0, trades: 0 }, Tue: { pnl: 0, trades: 0 }, Wed: { pnl: 0, trades: 0 }, Thu: { pnl: 0, trades: 0 }, Fri: { pnl: 0, trades: 0 } };
      const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (const t of allTrades) {
        const d = new Date(t.date);
        const dow = dowNames[d.getDay()];
        if (dowMap[dow]) {
          dowMap[dow].pnl += t.pnl;
          dowMap[dow].trades++;
        }
      }

      res.json({
        // Period P&L
        dailyPnl: Math.round(dailyPnl * 100) / 100,
        weeklyPnl: Math.round(weeklyPnl * 100) / 100,
        monthlyPnl: Math.round(monthlyPnl * 100) / 100,
        totalPnl: Math.round(totalPnl * 100) / 100,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,

        // Key metrics
        totalTrades,
        winners: winners.length,
        losers: losers.length,
        winRate: Math.round(winRate * 100) / 100,
        profitFactor: profitFactor !== null ? Math.round(profitFactor * 100) / 100 : null,
        avgWin: Math.round(avgWin * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        avgRR: Math.round(avgRR * 100) / 100,
        expectancy: Math.round(expectancy * 100) / 100,
        bestTrade: Math.round(bestTrade * 100) / 100,
        worstTrade: Math.round(worstTrade * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossLoss: Math.round(grossLoss * 100) / 100,

        // Daily
        dailyTradeCount: dailyTrades.length,
        dailyWinRate: Math.round(dailyWinRate * 100) / 100,

        // Streaks
        maxWinStreak,
        maxLossStreak,

        // Breakdowns
        symbolBreakdown,
        dayOfWeekBreakdown: dowMap,

        // Timestamps
        computedAt: new Date().toISOString(),
        accountId: realId,
      });
    } catch (err) {
      console.error('[Analytics] Error computing live analytics:', err.message);
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
