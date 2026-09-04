import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { supabase } from '../db/client.js';
import { eventBus } from '../events/eventBus.js';

import { TradingViewDatafeed } from '../realtime/tradingview.datafeed.js';
import { futuresContractService } from '../services/futuresContractService.js';
import { enrichOptionChainEntry } from '../services/optionChainNormalizer.js';

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

  const NUMERIC_DHAN_DERIVATIVE_MAP = {
    '429604': { symbol: 'GOLD', segment: 'MCX_COMM' },
    '429638': { symbol: 'SILVER', segment: 'MCX_COMM' },
    '425475': { symbol: 'CRUDEOIL', segment: 'MCX_COMM' },
    '11091': { symbol: 'USDINR', segment: 'NSE_CURRENCY' },
    '11363': { symbol: 'EURINR', segment: 'NSE_CURRENCY' },
    '11096': { symbol: 'GBPINR', segment: 'NSE_CURRENCY' },
    '11098': { symbol: 'JPYINR', segment: 'NSE_CURRENCY' },
  };

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
      const providerStatus = dataProviderSwitch?.getStatus?.();
      const brokerHealth = BrokerFactory.getHealthReport();
      const brokerEntry = brokerHealth.angelone || brokerHealth[`angelone:${process.env.ANGEL_CLIENT_ID}`];

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
          provider: providerStatus?.activeProvider || brokerEntry?.provider || 'unknown',
          connected: providerStatus?.dhanReady === true || brokerEntry?.connected === true,
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
      const marginInfo = await MarginService.getAvailableMargin(req.user.accountId, balance, null, account);
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

  // ── Margin quote — SINGLE SOURCE OF TRUTH for order margin ──────────────
  // The frontend calls this to display "Est. Margin" so the number shown to
  // the trader is EXACTLY what the backend risk engine will validate against.
  // Returns tradeability, required margin, available margin, and the maximum
  // affordable quantity/lots. Never let the UI show an affordable trade the
  // backend would reject.
  router.post('/orders/margin-quote', requireAuth, async (req, res) => {
    try {
      const { MarginService } = await import('../services/marginService.js');
      const { RiskEngine } = await import('../services/riskEngine.js');

      const realId = await accountService.resolveAccountId(req.user.accountId);
      const account = await accountService.getAccount(realId);
      if (!account) return res.status(404).json({ message: 'Account not found' });

      const {
        symbol, token, segment, side,
        productType = 'MIS', instrumentType, qty = 0, price,
      } = req.body || {};

      const orderParams = { symbol, token, segment, side, productType, instrumentType, qty: Number(qty) || 0 };

      // 1. Tradeability guard (spot indices are not tradeable)
      const tradeable = RiskEngine.checkTradeableInstrument(orderParams);
      if (!tradeable.allowed) {
        return res.json({ tradeable: false, reason: tradeable.reason, requiredMargin: 0 });
      }

      // 2. Resolve LTP: explicit price → live quote cache
      let ltp = Number(price) || 0;
      if (!ltp && token) {
        const q = marketDataEngine.getQuote(token);
        if (q?.ltp > 0) ltp = q.ltp;
      }

      // 3. Effective leverage from the account's challenge profile (SSOT)
      const leverage = await RiskEngine.getEffectiveLeverage(realId, account);
      account.effective_leverage = leverage;

      // 4. Required margin — identical calculation to validateMargin
      const { requiredMargin, marginType } = MarginService.calculateOrderMargin(
        { ...orderParams, price: ltp },
        (t) => { const q = marketDataEngine.getQuote(t); return q?.ltp > 0 ? q.ltp : 0; },
        account,
      );

      const balance = parseFloat(account.balance) || 0;
      const { availableMargin, usedMargin } = await MarginService.getAvailableMargin(
        realId, balance,
        (t) => { const q = marketDataEngine.getQuote(t); return q?.ltp > 0 ? q.ltp : 0; },
        account,
      );

      // 5. Max affordable qty (best-effort — proportional for equity/derivative)
      let maxAffordableQty = 0;
      if (requiredMargin > 0 && Number(qty) > 0) {
        maxAffordableQty = Math.floor((availableMargin / requiredMargin) * Number(qty));
      }

      res.json({
        tradeable: true,
        requiredMargin,
        marginType,
        leverage,
        availableMargin,
        usedMargin,
        balance,
        orderValue: ltp * (Number(qty) || 0),
        maxAffordableQty,
        sufficient: requiredMargin <= availableMargin,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
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

  router.get('/instruments', async (req, res) => {
    const { segment } = req.query;
    if (!segment) return res.json([]);
    const instruments = instrumentService.getBySegment(segment);
    if (!['NFO', 'MCX', 'CDS'].includes(segment)) return res.json(instruments);

    const resolved = await Promise.all(instruments.map(async (instrument) => {
      if (!instrument.isPlaceholder) return instrument;
      try {
        const contract = await futuresContractService.resolve(instrument.token);
        if (!contract?.securityId) return instrument;
        return {
          ...instrument,
          token: String(contract.securityId),
          exchange: instrument.exchange,
          instrumentType: contract.instrument === 'FUT' ? 'FUT' : instrument.instrumentType,
          symbol: contract.tradingSymbol || instrument.symbol,
          name: contract.tradingSymbol || instrument.name,
          expiry: contract.expiry || instrument.expiry,
          lotSize: contract.lotSize > 1 ? contract.lotSize : instrument.lotSize,
          tickSize: contract.tickSize || instrument.tickSize,
          isPlaceholder: false,
          _resolvedFrom: 'futures-contract-service',
        };
      } catch (error) {
        console.warn(`[Instruments] Failed to resolve ${instrument.symbol}:`, error.message);
        return instrument;
      }
    }));
    res.json(resolved);
  });

  /**
   * Option lot-size lookup — returns the exchange-mandated lot size for an
   * option underlying from the Dhan scrip master (SEM_LOT_UNITS column).
   *
   * Example: GET /api/market/lot-size?symbol=RELIANCE → { symbol:"RELIANCE", lotSize:500 }
   *
   * The scrip master is pre-loaded at server startup.  If it is not yet
   * available (first few seconds after cold start) the response contains
   * { lotSize: 1, source: "fallback" } so callers can tell the difference.
   *
   * This endpoint is public (no auth required) because lot size is not
   * sensitive information and is needed before the order ticket is shown.
   */
  router.get('/market/lot-size', (req, res) => {
    const symbol = (req.query.symbol || '').toUpperCase().trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const dhanAdapter = dataProviderSwitch?.getDhanAdapter();
    const historical = dhanAdapter?.historical;

    if (!historical) {
      return res.json({ symbol, lotSize: 1, source: 'fallback-no-adapter' });
    }

    // getLotSize reads from the in-memory scrip master — zero network cost
    const lot = historical.getLotSize(symbol);
    const source = (historical._scripMaster?.underlyingLotSize?.size > 0)
      ? 'dhan-scrip-master'
      : 'fallback-loading';

    res.json({ symbol, lotSize: lot, source });
  });

  router.get('/market/history', async (req, res) => {
    let { token, from, to, exchange } = req.query;
    const rawSymbol = req.query.symbol; // Support ?symbol= as alternative to ?token=
    const tf = req.query.tf || req.query.timeframe || req.query.resolution;
    
    // Support both ?token= and ?symbol= interchangeably
    if (!token && rawSymbol) token = rawSymbol;
    if (!token || !tf) return res.status(400).json({ message: 'token and tf required' });

    // Native Dhan mapping for placeholder tokens.
    // NSE/BSE Futures placeholders are resolved via FuturesContractService
    // (real NSE_FNO/BSE_FNO securityIds from Dhan scrip master).
    // MCX/CDS retain their own resolution path below.
    const NSE_BSE_FUT_PLACEHOLDERS = new Set([
      'NF_FUT','NF_FUT_N','NF_FUT_F',
      'BNF_FUT','BNF_FUT_N',
      'FNF_FUT','MCN_FUT','MNF_FUT',
      'SEN_FUT','SNX_FUT',
      'REL_FUT','HDFC_FUT','ICICI_FUT','SBIN_FUT','TCS_FUT','INFY_FUT',
      'ITC_FUT','LT_FUT','AXIS_FUT','HCL_FUT','BAJF_FUT','KOTAK_FUT',
      'TATAM_FUT','TATAS_FUT','MARUTI_FUT','TITAN_FUT','ADANIE_FUT',
      'ADANIP_FUT','BEL_FUT','HAL_FUT','ZOMATO_FUT','DLF_FUT',
      'SUNP_FUT','PWRGRD_FUT','NTPC_FUT','COAL_FUT','BHARTI_FUT',
      'TIIN_FUT','VOLTAS_FUT','WIPRO_FUT',
    ]);
    const PLACEHOLDER_TO_DHAN = {
      // MCX Commodities — keep using active contract resolution
      'GOLD_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'GOLD' },
      'GOLDM_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'GOLDM' },
      'SILVER_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'SILVER' },
      'SILVERM_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'SILVERM' },
      'CRUDE_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'CRUDEOIL' },
      'NATGAS_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'NATURALGAS' },
      'COPPER_F': { securityId: null, segment: 'MCX_COMM', scripSymbol: 'COPPER' },
      // CDS Currency — keep using active contract resolution
      'USDINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'USDINR' },
      'USDINR_FN': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'USDINR' },
      'USDINR_FF': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'USDINR' },
      'EURINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'EURINR' },
      'GBPINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'GBPINR' },
      'JPYINR_F': { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'JPYINR' },
    };

    // ── NSE/BSE Futures: resolve via FuturesContractService ──────────────
    if (NSE_BSE_FUT_PLACEHOLDERS.has(token)) {
      try {
        const contract = await futuresContractService.resolve(token);
        if (contract?.securityId) {
          token    = contract.securityId;
          exchange = contract.segment;
          console.log(`[History] ${req.query.token} → FuturesContractSvc → ${token}/${exchange}`);
        } else {
          // FuturesContractService not warm yet — fall back to the legacy IDX_I mapping
          // so the chart still loads during the first few seconds after cold start.
          console.warn(`[History] FuturesContractService not yet warm for ${req.query.token} — using IDX_I fallback`);
          const LEGACY_IDX_FALLBACK = {
            'NF_FUT': '13', 'NF_FUT_N': '13', 'NF_FUT_F': '13',
            'BNF_FUT': '25', 'BNF_FUT_N': '25',
            'FNF_FUT': '27',
            'MCN_FUT': '442', 'MNF_FUT': '442',
            'SEN_FUT': '51', 'SNX_FUT': '51',
          };
          const legacyId = LEGACY_IDX_FALLBACK[req.query.token];
          if (legacyId) {
            token    = legacyId;
            exchange = 'IDX_I';
          }
          // Stock futures without a legacy fallback: just let it proceed as-is —
          // the Dhan adapter will attempt resolution internally.
        }
      } catch (fcsErr) {
        console.error(`[History] FuturesContractService error for ${req.query.token}:`, fcsErr.message);
        // Don't 503 — fall through and let Dhan adapter try with the raw token
      }
    }

    // ─── Numeric token → segment mapping for MCX/CDS/ETF direct tokens ───
    // When the frontend passes numeric tokens with MCX/CDS exchange, map them
    // to the correct Dhan segment and resolve active contracts if needed.
    const NUMERIC_TOKEN_MAP = {
      // MCX tokens
      '429604': { segment: 'MCX_COMM', scripSymbol: 'GOLD' },
      '429638': { segment: 'MCX_COMM', scripSymbol: 'SILVER' },
      '425475': { segment: 'MCX_COMM', scripSymbol: 'CRUDEOIL' },
      '431765': { segment: 'MCX_COMM', scripSymbol: 'NATURALGAS' },
      '430596': { segment: 'MCX_COMM', scripSymbol: 'COPPER' },
      // CDS tokens
      '11091': { segment: 'NSE_CURRENCY', scripSymbol: 'USDINR' },
      '11363': { segment: 'NSE_CURRENCY', scripSymbol: 'EURINR' },
      '11096': { segment: 'NSE_CURRENCY', scripSymbol: 'GBPINR' },
      '11098': { segment: 'NSE_CURRENCY', scripSymbol: 'JPYINR' },
      // ETF tokens (NSE equity)
      '2150': { segment: 'NSE_EQ', scripSymbol: 'NIFTYBEES' },
      '15068': { segment: 'NSE_EQ', scripSymbol: 'BANKBEES' },
      '13751': { segment: 'NSE_EQ', scripSymbol: 'JUNIORBEES' },
      '22536': { segment: 'NSE_EQ', scripSymbol: 'SILVERBEES' },
      '14428': { segment: 'NSE_EQ', scripSymbol: 'ITBEES' },
      '14423': { segment: 'NSE_EQ', scripSymbol: 'PHARMABEES' },
    };

    // ─── Symbol name mapping (frontend may pass "NIFTY FUT", "GOLD", "USDINR", etc.) ───
    // NSE/BSE Futures symbol names resolve via FuturesContractService (see Step 2 below).
    // This map covers spot indices, MCX, CDS, and ETFs only.
    const SYMBOL_NAME_MAP = {
      // Index names (spot — NOT futures)
      'NIFTY': { securityId: '13', segment: 'IDX_I' },
      'NIFTY 50': { securityId: '13', segment: 'IDX_I' },
      'BANKNIFTY': { securityId: '25', segment: 'IDX_I' },
      'FINNIFTY': { securityId: '27', segment: 'IDX_I' },
      'MIDCPNIFTY': { securityId: '442', segment: 'IDX_I' },
      'SENSEX': { securityId: '51', segment: 'IDX_I' },
      // MCX Commodity names — securityId intentionally null; always resolved via getActiveContract
      'GOLD':        { securityId: null, segment: 'MCX_COMM', scripSymbol: 'GOLD' },
      'SILVER':      { securityId: null, segment: 'MCX_COMM', scripSymbol: 'SILVER' },
      'CRUDEOIL':    { securityId: null, segment: 'MCX_COMM', scripSymbol: 'CRUDEOIL' },
      'NATURALGAS':  { securityId: null, segment: 'MCX_COMM', scripSymbol: 'NATURALGAS' },
      'COPPER':      { securityId: null, segment: 'MCX_COMM', scripSymbol: 'COPPER' },
      // CDS Currency names — securityId intentionally null; always resolved via getActiveContract
      'USDINR':      { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'USDINR' },
      'EURINR':      { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'EURINR' },
      'GBPINR':      { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'GBPINR' },
      'JPYINR':      { securityId: null, segment: 'NSE_CURRENCY', scripSymbol: 'JPYINR' },
      // ETF names
      'NIFTYBEES': { securityId: '2150', segment: 'NSE_EQ' },
      'BANKBEES': { securityId: '15068', segment: 'NSE_EQ' },
      'JUNIORBEES': { securityId: '13751', segment: 'NSE_EQ' },
      'GOLDBEES': { securityId: '1660', segment: 'NSE_EQ' },
      'SILVERBEES': { securityId: '22536', segment: 'NSE_EQ' },
      'ITBEES': { securityId: '14428', segment: 'NSE_EQ' },
      'PHARMABEES': { securityId: '14423', segment: 'NSE_EQ' },
    };

    // Helper: resolve active contract via scrip master for MCX/CDS
    // Uses resolveActiveContractLive which tries: scrip master → live API → static fallback
    const resolveActiveContract = async (scripSymbol, segment) => {
      try {
        const dhan = dataProviderSwitch?.getDhanAdapter();
        if (dhan?.historical) {
          // Ensure scrip master is loaded before attempting resolution
          await dhan.historical._getScripMaster();
          const activeId = await dhan.historical.resolveActiveContractLive(scripSymbol, segment);
          if (activeId) return activeId;
        }
      } catch (e) {
        console.warn(`[History] Active contract resolution failed for ${scripSymbol}/${segment}: ${e.message}`);
      }
      return null;
    };

    // Step 1: Check placeholder token map
    const mapping = PLACEHOLDER_TO_DHAN[token];
    if (mapping) {
      if (mapping.securityId) {
        token = mapping.securityId;
        exchange = mapping.segment;
      } else if (mapping.scripSymbol) {
        const activeId = await resolveActiveContract(mapping.scripSymbol, mapping.segment);
        if (activeId) {
          token = activeId;
          exchange = mapping.segment;
        } else {
          console.warn(`[History] Could not resolve active contract for placeholder ${token} (${mapping.scripSymbol}/${mapping.segment})`);
          exchange = mapping.segment;
        }
      }
    }
    // Step 1b: Check numeric token map (known MCX/CDS/ETF tokens from frontend watchlists)
    else if (/^\d+$/.test(token) && NUMERIC_TOKEN_MAP[token]) {
      const numMapping = NUMERIC_TOKEN_MAP[token];
      exchange = numMapping.segment;
      // For MCX/CDS derivatives, resolve the active contract dynamically (async — never use stale IDs)
      if ((numMapping.segment === 'MCX_COMM' || numMapping.segment === 'NSE_CURRENCY') && numMapping.scripSymbol) {
        const activeId = await resolveActiveContract(numMapping.scripSymbol, numMapping.segment);
        if (activeId) {
          console.log(`[History] Known token ${token} (${numMapping.scripSymbol}) → active contract ${activeId}`);
          token = activeId;
        } else {
          console.warn(`[History] Could not resolve active contract for ${numMapping.scripSymbol}/${numMapping.segment} — token stays ${token}`);
        }
      }
      // For ETFs/equities: try scrip master symbol lookup to get the correct Dhan securityId
      else if (numMapping.segment === 'NSE_EQ' && numMapping.scripSymbol) {
        try {
          const dhan = dataProviderSwitch?.getDhanAdapter();
          if (dhan?.historical?._scripMaster?.bySymbol) {
            const entry = dhan.historical._scripMaster.bySymbol.get(`${numMapping.scripSymbol}:NSE_EQ`) ||
                         dhan.historical._scripMaster.bySymbol.get(`${numMapping.scripSymbol}:E`);
            if (entry?.securityId && entry.securityId !== token) {
              console.log(`[History] ETF ${numMapping.scripSymbol} token ${token} → Dhan ${entry.securityId}`);
              token = entry.securityId;
            }
          }
        } catch (_) {}
      }
    }
    // Step 2: Check if token is a symbol name (non-numeric, not a known placeholder)
    else if (!/^\d+$/.test(token)) {
      const upper = token.toUpperCase().trim();
      const symMapping = SYMBOL_NAME_MAP[upper];
      if (symMapping) {
        if (symMapping.securityId) {
          token = symMapping.securityId;
          exchange = symMapping.segment;
        } else if (symMapping.scripSymbol) {
          // Always resolve dynamically — never use stale hardcoded IDs for futures
          const activeId = await resolveActiveContract(symMapping.scripSymbol, symMapping.segment);
          if (activeId) {
            token = activeId;
            exchange = symMapping.segment;
          } else {
            console.warn(`[History] Could not resolve active contract for ${symMapping.scripSymbol}/${symMapping.segment}`);
            exchange = symMapping.segment;
          }
        }
      } else {
        // Try to resolve via scrip master as equity/ETF
        try {
          const dhan = dataProviderSwitch?.getDhanAdapter();
          if (dhan?.historical?._scripMaster?.bySymbol) {
            const seg = exchange === 'MCX' ? 'MCX_COMM' : exchange === 'CDS' ? 'NSE_CURRENCY' : exchange === 'NFO' ? 'NSE_FNO' : 'NSE_EQ';
            const entry = dhan.historical._scripMaster.bySymbol.get(`${upper}:${seg}`) ||
                         dhan.historical._scripMaster.bySymbol.get(`${upper}:NSE_EQ`) ||
                         dhan.historical._scripMaster.bySymbol.get(`${upper}:E`);
            if (entry?.securityId) {
              token = entry.securityId;
              exchange = entry.segment;
            }
          }
        } catch (_) {}
      }
    }
    // Step 3: Numeric token with MCX/CDS exchange — verify it's valid or resolve active contract
    else if (/^\d+$/.test(token) && (exchange === 'MCX' || exchange === 'CDS' || exchange === 'MCX_COMM' || exchange === 'NSE_CURRENCY')) {
      // Map exchange to Dhan segment format
      const dhanSegment = exchange === 'MCX' ? 'MCX_COMM' : exchange === 'CDS' ? 'NSE_CURRENCY' : exchange;
      exchange = dhanSegment;

      // Check if this is a known numeric token with a symbol we can resolve
      const numMapping = NUMERIC_TOKEN_MAP[token];
      if (numMapping && numMapping.scripSymbol) {
        const activeId = await resolveActiveContract(numMapping.scripSymbol, numMapping.segment);
        if (activeId) {
          console.log(`[History] Numeric token ${token} (${numMapping.scripSymbol}) → active contract ${activeId}`);
          token = activeId;
          exchange = numMapping.segment;
        } else {
          console.warn(`[History] Could not resolve active contract for ${numMapping.scripSymbol}/${numMapping.segment} — using token as-is`);
        }
      } else {
        // Not in our known map — try scrip master lookup
        try {
          const dhan = dataProviderSwitch?.getDhanAdapter();
          if (dhan?.historical?._scripMaster) {
            const scripEntry = dhan.historical._scripMaster.byId.get(token);
            if (scripEntry) {
              exchange = scripEntry.segment;
            } else {
              const quote = marketDataEngine.getQuote(token);
              const symbolName = quote?.symbol;
              if (symbolName) {
                const baseSymbol = symbolName.replace(/\s*(FUT|FUTURES?)\s*/i, '').trim().toUpperCase();
                const activeId = dhan.historical.getActiveContract(baseSymbol, dhanSegment);
                if (activeId) {
                  console.log(`[History] MCX/CDS token ${token} (${symbolName}) → active contract ${activeId}`);
                  token = activeId;
                }
              }
            }
          }
        } catch (_) {}
      }
    }
    // Step 4: Numeric token with NFO exchange — it's a futures/options contract ID
    else if (/^\d+$/.test(token) && (exchange === 'NFO' || exchange === 'NSE_FNO')) {
      exchange = 'NSE_FNO';
    }
    // Step 5: Numeric token with NSE/BSE/no exchange — equities & ETFs
    else if (/^\d+$/.test(token)) {
      // Ensure exchange is mapped to Dhan segment format
      if (exchange === 'NSE' || exchange === 'BSE' || !exchange) {
        // Check if this is an NSE_EQ token (stocks, ETFs)
        exchange = exchange === 'BSE' ? 'BSE_EQ' : 'NSE_EQ';
      }
    }

    // Historical charts are Dhan-only. Angel remains available to unrelated paths.
    if (dataProviderSwitch) {
      try {
        const resolvedExchange = exchange ? String(exchange) : 'NSE';
        // Also register exchange in candleService for live candle aggregation
        if (candleService && resolvedExchange && token) {
          candleService.registerTokenExchange(String(token), resolvedExchange);
        }

        const fromTs = from ? parseInt(String(from), 10) : 0;
        const toTs = to ? parseInt(String(to), 10) : Math.floor(Date.now() / 1000);

        let result = await dataProviderSwitch.getHistoricalCandles(
          token, tf, resolvedExchange, fromTs, toTs
        );

        let candles = result.data || result;
        if (!Array.isArray(candles)) candles = [];

        // ─── MCX/CDS/NFO empty-data retry: the token may be an expired contract ───
        // Try resolving the active contract by looking up the symbol name from the quote cache
        if (candles.length === 0 && (resolvedExchange === 'MCX_COMM' || resolvedExchange === 'NSE_CURRENCY' || resolvedExchange === 'NSE_FNO')) {
          const dhan = dataProviderSwitch.getDhanAdapter();
          if (dhan?.historical) {
            // Get symbol name from quote cache to identify the underlying
            const quote = marketDataEngine.getQuote(token);
            const symbolName = quote?.symbol;
            if (symbolName) {
              const baseSymbol = symbolName.replace(/\s*(FUT|FUTURES?)\s*/i, '').trim().toUpperCase();
              const activeId = await dhan.historical.resolveActiveContractLive(baseSymbol, resolvedExchange);
              if (activeId && activeId !== token) {
                console.log(`[History] Retrying with active contract: ${token} → ${activeId} for ${baseSymbol}/${resolvedExchange}`);
                const retryResult = await dataProviderSwitch.getHistoricalCandles(
                  activeId, tf, resolvedExchange, fromTs, toTs
                );
                candles = retryResult.data || retryResult;
                if (!Array.isArray(candles)) candles = [];
              }
            }
          }
        }

        if (candles.length > 0) {
          // Normalize candle format: ensure flat array with { time, open, high, low, close, volume }
          const normalized = candles.map(c => {
            const close = Number(c.close) || 0;
            const open  = Number(c.open)  || close;
            const high  = Number(c.high)  || Math.max(open, close);
            const low   = Number(c.low)   || Math.min(open, close);
            return {
              time:   typeof c.time === 'number' ? c.time : Math.floor(new Date(c.timestamp || c.datetime || c.date || 0).getTime() / 1000),
              open,
              high,
              low,
              close,
              volume: Number(c.volume || 0),
            };
          }).filter(c => c.time > 0 && c.close > 0 && !isNaN(c.time) && !isNaN(c.close));

          if (normalized.length > 0) {
            // Deduplicate by timestamp and sort ascending — required by Lightweight Charts
            const seen = new Set();
            const deduped = normalized
              .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
              .sort((a, b) => a.time - b.time);
            return res.json(deduped);
          }
        }

        console.warn(`[API] /market/history returned 0 candles for ${token}/${tf} via ${result.provider}`, {
          provider: result.provider,
          token,
          exchange: resolvedExchange,
          resolution: tf,
          from: fromTs,
          to: toTs,
          requestedRangeSeconds: Math.max(0, toTs - fromTs),
          rawCandleCount: 0,
          normalizedCandleCount: 0,
          fallbackUsed: result.provider !== 'DHAN',
        });
      } catch (err) {
        console.error('[API] /market/history Dhan error:', err.message || err);
        return res.status(err.code === 'DHAN_NOT_READY' ? 503 : 502).json({
          error: err.code || 'DHAN_HISTORICAL_FAILED',
          message: err.message || 'Dhan historical provider failed',
          provider: 'DHAN',
          status: err.status || null,
          details: err.details || null,
          token: String(token),
          exchange: exchange || null,
          resolution: String(tf),
        });
      }
    }

    // No candles from a valid Dhan response means the requested range is empty.
    return res.status(502).json({
      error: 'DHAN_HISTORICAL_EMPTY',
      message: 'Dhan returned no candles for the requested range',
      provider: 'DHAN',
      token: String(token),
      exchange: exchange || null,
      resolution: String(tf),
      from: from ? parseInt(String(from), 10) : null,
      to: to ? parseInt(String(to), 10) : null,
    });
  });

  router.get('/market/depth', async (req, res) => {
    const { token, exchange } = req.query;
    if (!token) return res.status(400).json({ message: 'token required' });

    const dhan = dataProviderSwitch?.getDhanAdapter?.();
    const alias = NUMERIC_DHAN_DERIVATIVE_MAP[String(token)];
    if (dhan?.isConnected && alias) {
      try {
        const activeId = dhan.historical?.getActiveContract(alias.symbol, alias.segment);
        const securityId = activeId || String(token);
        const depth = await dhan.getDepth(securityId, alias.segment === 'NSE_CURRENCY' ? 'CUR' : alias.segment);
        if (depth) return res.json({ ...depth, token: String(token), securityId, exchange: alias.segment });
      } catch (error) {
        console.warn(`[Depth] Dhan lookup failed for ${token}:`, error.message);
      }
    }
    if (depthService) {
      const depth = await depthService.getDepth(token, exchange || 'NSE');
      return res.json(depth);
    }
    res.json(marketDataEngine.getDepth(token));
  });

  router.get('/market/quote', async (req, res) => {
    let { token, exchange } = req.query;
    if (!token) return res.status(400).json({ message: 'token required' });
    const dhan = dataProviderSwitch?.getDhanAdapter?.();

    // Native Dhan mapping for Futures, Commodities & Currencies.
    // NSE/BSE Futures placeholders are resolved via FuturesContractService
    // to real NSE_FNO/BSE_FNO securityIds. MCX/CDS retain their own path.
    const NSE_BSE_FUT_PH = new Set([
      'NF_FUT','NF_FUT_N','NF_FUT_F',
      'BNF_FUT','BNF_FUT_N','FNF_FUT','MCN_FUT','MNF_FUT',
      'SEN_FUT','SNX_FUT',
      'REL_FUT','SBIN_FUT','HDFC_FUT','ICICI_FUT','TCS_FUT','INFY_FUT',
      'ITC_FUT','LT_FUT','AXIS_FUT','HCL_FUT','BAJF_FUT','KOTAK_FUT',
      'TATAM_FUT','TATAS_FUT','MARUTI_FUT','TITAN_FUT','ADANIE_FUT',
      'ADANIP_FUT','BEL_FUT','HAL_FUT','ZOMATO_FUT','DLF_FUT',
      'SUNP_FUT','PWRGRD_FUT','NTPC_FUT','COAL_FUT','BHARTI_FUT',
      'TIIN_FUT','VOLTAS_FUT','WIPRO_FUT',
    ]);

    if (NSE_BSE_FUT_PH.has(token)) {
      try {
        const contract = await futuresContractService.resolve(token);
        if (contract?.securityId) {
          const dhan = dataProviderSwitch?.getDhanAdapter();
          // Try marketDataEngine cache first (zero network)
          const cachedQuote = marketDataEngine.getQuote(contract.securityId);
          if (cachedQuote?.ltp > 0) {
            return res.json({ ...cachedQuote, token });
          }
          // Fetch live quote from Dhan
          if (dhan?.isConnected) {
            try {
              const result = await Promise.race([
                dhan.getQuote(contract.securityId, contract.segment),
                new Promise(resolve => setTimeout(() => resolve(null), 1500)),
              ]);
              const ltp = _parseDhanQuote(result, contract.securityId, contract.segment);
              if (ltp && ltp > 0) {
                return res.json({ token, ltp, securityId: contract.securityId, segment: contract.segment, exchange: contract.segment, timestamp: Date.now() });
              }
            } catch (_) {}
          }
          // Dhan not connected or returned nothing — return metadata so UI knows the real token
          return res.json({ token, ltp: null, securityId: contract.securityId, segment: contract.segment, exchange: contract.segment, expiry: contract.expiry });
        }
      } catch (fcsErr) {
        console.warn(`[Quote] FuturesContractService error for ${token}:`, fcsErr.message);
      }
      return res.json(null);
    }

    const PLACEHOLDER_TO_DHAN = {
      // MCX Commodities (MCX_COMM) — static securityIds where known; dynamic otherwise
      'GOLD_F':    { securityId: '483079', segment: 'MCX_COMM', scripSymbol: 'GOLD' },
      'GOLDM_F':   { securityId: '483079', segment: 'MCX_COMM', scripSymbol: 'GOLDM' },
      'SILVER_F':  { securityId: '471725', segment: 'MCX_COMM', scripSymbol: 'SILVER' },
      'SILVERM_F': { securityId: '471725', segment: 'MCX_COMM', scripSymbol: 'SILVERM' },
      'CRUDE_F':   { securityId: '560977', segment: 'MCX_COMM', scripSymbol: 'CRUDEOIL' },
      'NATGAS_F':  { securityId: null,     segment: 'MCX_COMM', scripSymbol: 'NATURALGAS' },
      'COPPER_F':  { securityId: null,     segment: 'MCX_COMM', scripSymbol: 'COPPER' },
      // CDS Currencies (CUR)
      'USDINR_F':  { securityId: '2', segment: 'CUR', scripSymbol: 'USDINR' },
      'EURINR_F':  { securityId: '3', segment: 'CUR', scripSymbol: 'EURINR' },
      'GBPINR_F':  { securityId: '4', segment: 'CUR', scripSymbol: 'GBPINR' },
      'JPYINR_F':  { securityId: '5', segment: 'CUR', scripSymbol: 'JPYINR' },
    };

    const mapping = PLACEHOLDER_TO_DHAN[token];
    if (mapping) {
      // Dhan API resolution for MCX/CDS — wrapped in strict 1.5s timeout
      const resolveViaDhan = async () => {
        const dhan = dataProviderSwitch?.getDhanAdapter();
        if (!dhan?.isConnected) return null;

        // Path A: known static securityId
        if (mapping.securityId) {
          const dhanSeg = mapping.segment;
          const result = await dhan.getQuote(mapping.securityId, dhanSeg);
          return _parseDhanQuote(result, mapping.securityId, dhanSeg);
        }

        // Path B: dynamic resolution via getActiveContract (MCX/CDS nearest expiry)
        if (mapping.scripSymbol && dhan.historical) {
          const dhanSeg = mapping.segment;
          const activeId = dhan.historical.getActiveContract(mapping.scripSymbol, mapping.segment);
          if (activeId) {
            const result = await dhan.getQuote(activeId, dhanSeg);
            return _parseDhanQuote(result, activeId, dhanSeg);
          }
          if (dhan.historical._scripMaster?.bySymbol) {
            const entry = dhan.historical._scripMaster.bySymbol.get(`${mapping.scripSymbol}:${dhanSeg}`) ||
                          dhan.historical._scripMaster.bySymbol.get(`${mapping.scripSymbol}:${mapping.segment}`) ||
                          dhan.historical._scripMaster.bySymbol.get(`${mapping.scripSymbol}:E`);
            if (entry?.securityId) {
              const result = await dhan.getQuote(entry.securityId, dhanSeg);
              return _parseDhanQuote(result, entry.securityId, dhanSeg);
            }
          }
        }
        return null;
      };

      try {
        const ltp = await Promise.race([
          resolveViaDhan(),
          new Promise(resolve => setTimeout(() => resolve(null), 1500)),
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
    const numericAlias = NUMERIC_DHAN_DERIVATIVE_MAP[String(token)];
    if (dhan?.isConnected && numericAlias) {
      try {
        const activeId = dhan.historical?.getActiveContract(numericAlias.symbol, numericAlias.segment);
        const securityId = activeId || String(token);
        const dhanSegment = numericAlias.segment;
        const result = await dhan.getQuote(securityId, dhanSegment);
        let ltp = _parseDhanQuote(result, securityId, dhanSegment);
        // Dhan's LTP endpoint is the authoritative fallback when the quote
        // endpoint returns an empty or differently shaped payload for a
        // derivative contract. Keep the resolved active ID and segment.
        let batchQuote = null;
        if (!ltp && dhan.getQuotes) {
          const quotes = await dhan.getQuotes([{ token: securityId, segment: dhanSegment }]);
          batchQuote = quotes?.find(quote => String(quote.token) === String(securityId)) || quotes?.[0] || null;
          ltp = batchQuote?.ltp || batchQuote?.last_price || null;
        }
        if (ltp && ltp > 0) {
          return res.json({
            token: String(token),
            securityId,
            ltp,
            volume: batchQuote?.volume,
            oi: batchQuote?.oi,
            exchange: numericAlias.segment,
            symbol: numericAlias.symbol,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        console.warn(`[Quote] Dhan lookup failed for ${token}:`, error.message);
      }
    }

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
    // Normalize symbol — strip trailing " 50" so "NIFTY 50" → "NIFTY"
    const symbol = req.query.symbol
      ? String(req.query.symbol).toUpperCase().replace(/\s+50$/, '').trim()
      : null;

    if (!symbol) return res.status(400).json({ message: 'symbol required' });

    // Auto-resolve expiry when not provided by the client:
    // Ask DataProviderSwitch (Dhan first, Angel fallback) for the nearest expiry.
    let expiry = req.query.expiry ? String(req.query.expiry) : '';
    if (!expiry && dataProviderSwitch) {
      try {
        const result = await dataProviderSwitch.getExpiries(symbol);
        if (result.data && result.data.length > 0) expiry = result.data[0];
      } catch (_) {}
    }
    if (!expiry) return res.status(400).json({ message: 'expiry required and could not be auto-resolved' });

    console.log(`[OptionChain] Request: symbol=${symbol}, expiry=${expiry}`);

    // Try DataProviderSwitch first (routes to Dhan with Greeks or Angel One)
    if (dataProviderSwitch) {
      try {
        const result = await dataProviderSwitch.getOptionChain(symbol, expiry);
        let chain = result.data;

        // If Dhan returned the raw 'oc' map format, normalize it here
        if (chain && !Array.isArray(chain) && chain.oc) {
          chain = _normalizeOcMap(chain);
        }

        if (Array.isArray(chain) && chain.length > 0) {
          // Ensure every entry has the required fields with correct types.
          // P5.3: bid/ask/qty + change/change%/spread are computed via
          // enrichOptionChainEntry so every underlying (NFO + BFO) gets the
          // same normalized market-data shape.
          const normalized = chain.map(entry => enrichOptionChainEntry({
            strike: Number(entry.strike || entry.strikePrice || entry.strike_price || 0),
            callToken: String(entry.callToken || entry.ce_security_id || ''),
            callSymbol: entry.callSymbol || '',
            callLtp: Number(entry.callLtp || entry.ce_ltp || 0),
            callVolume: Number(entry.callVolume || entry.ce_volume || 0),
            callOi: Number(entry.callOi || entry.ce_oi || 0),
            callOiChange: Number(entry.callOiChange || entry.ce_oi_change || 0),
            callBidPrice: Number(entry.callBidPrice || 0),
            callAskPrice: Number(entry.callAskPrice || 0),
            callBidQty: Number(entry.callBidQty || 0),
            callAskQty: Number(entry.callAskQty || 0),
            callPrevClose: Number(entry.callPrevClose || 0),
            callIv: Number(entry.callIv || entry.ce_iv || 0),
            callDelta: Number(entry.callDelta || entry.ce_delta || 0),
            callGamma: Number(entry.callGamma || entry.ce_gamma || 0),
            callTheta: Number(entry.callTheta || entry.ce_theta || 0),
            callVega: Number(entry.callVega || entry.ce_vega || 0),
            putToken: String(entry.putToken || entry.pe_security_id || ''),
            putSymbol: entry.putSymbol || '',
            putLtp: Number(entry.putLtp || entry.pe_ltp || 0),
            putVolume: Number(entry.putVolume || entry.pe_volume || 0),
            putOi: Number(entry.putOi || entry.pe_oi || 0),
            putOiChange: Number(entry.putOiChange || entry.pe_oi_change || 0),
            putBidPrice: Number(entry.putBidPrice || 0),
            putAskPrice: Number(entry.putAskPrice || 0),
            putBidQty: Number(entry.putBidQty || 0),
            putAskQty: Number(entry.putAskQty || 0),
            putPrevClose: Number(entry.putPrevClose || 0),
            putIv: Number(entry.putIv || entry.pe_iv || 0),
            putDelta: Number(entry.putDelta || entry.pe_delta || 0),
            putGamma: Number(entry.putGamma || entry.pe_gamma || 0),
            putTheta: Number(entry.putTheta || entry.pe_theta || 0),
            putVega: Number(entry.putVega || entry.pe_vega || 0),
          })).filter(e => e.strike > 0)
            .sort((a, b) => a.strike - b.strike);

          // Enrich zero-LTP entries from live quote cache (market closed / past expiry)
          let enrichCount = 0;
          for (const e of normalized) {
            if (e.callLtp === 0 && e.callToken) {
              const q = marketDataEngine.getQuote(e.callToken);
              if (q?.ltp > 0) { e.callLtp = q.ltp; enrichCount++; }
            }
            if (e.putLtp === 0 && e.putToken) {
              const q = marketDataEngine.getQuote(e.putToken);
              if (q?.ltp > 0) { e.putLtp = q.ltp; enrichCount++; }
            }
          }
          if (enrichCount > 0) {
            console.log(`[OptionChain] Enriched ${enrichCount} zero-LTP entries from quote cache`);
          }

          console.log(`[OptionChain] Response via ${result.provider}: ${normalized.length} strikes`);
          return res.json(normalized);
        }
      } catch (err) {
        console.warn(`[OptionChain] DataProviderSwitch failed: ${err.message}`);
      }
    }

    // Fallback: existing Angel One optionChainService
    if (!optionChainService) return res.json([]);

    // Try to get token — retry up to 3s if it's still initializing
    if (!optionChainService.jwtToken) {
      await optionChainService._ensureToken();
    }
    // Second chance: if still no token after _ensureToken, wait briefly and retry once
    if (!optionChainService.jwtToken && optionChainService._refreshCallback) {
      try {
        const tok = await optionChainService._refreshCallback();
        if (tok) optionChainService.setAuthToken(tok);
      } catch (_) {}
    }

    if (!optionChainService.jwtToken) {
      console.warn('[OptionChain] No JWT token available from any source — returning empty chain');
      return res.json([]);
    }

    try {
      const chain = await optionChainService.getOptionChain(symbol, expiry);
      console.log(`[OptionChain] Response via Angel: ${chain.length} strikes returned`);
      return res.json(chain);
    } catch (err) {
      console.error('[OptionChain] Angel fallback failed:', err.message);
      return res.json([]);
    }
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

    // TradingView history is Dhan-only, just like /market/history.
    let candles = [];
    if (dataProviderSwitch) {
      try {
        const fromTs = parseInt(from) || Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
        const toTs = parseInt(to) || Math.floor(Date.now() / 1000);
        const result = await dataProviderSwitch.getHistoricalCandles(token, resolution, exchange, fromTs, toTs);
        candles = result.data || [];
      } catch (err) {
        console.warn(`[TV] DataProviderSwitch error: ${err.message}`);
        return res.status(err.code === 'DHAN_NOT_READY' ? 503 : 502).json({
          s: 'error',
          errmsg: err.message || 'Dhan historical provider failed',
          provider: 'DHAN',
          error: err.code || 'DHAN_HISTORICAL_FAILED',
          details: err.details || null,
        });
      }
    }

    if (!candles || candles.length === 0) {
      return res.status(502).json({
        s: 'error',
        errmsg: 'Dhan returned no historical candles',
        provider: 'DHAN',
        error: 'DHAN_HISTORICAL_EMPTY',
      });
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

  /**
   * Safe Dhan authentication diagnostic endpoint.
   * Makes a real authenticated request to Dhan /v2/profile.
   * Reports HTTP status, auth result, and Dhan error codes — never reveals credentials.
   */
  router.get('/provider/dhan-auth-check', async (req, res) => {
    const dhan = dataProviderSwitch?.getDhanAdapter();
    if (!dhan) return res.json({ checked: false, reason: 'No DhanAdapter' });

    const clientId = process.env.DHAN_CLIENT_ID || '';
    const token = process.env.DHAN_ACCESS_TOKEN || '';
    const credentialSummary = {
      DHAN_CLIENT_ID: clientId ? 'SET' : 'MISSING',
      DHAN_ACCESS_TOKEN: token ? 'SET' : 'MISSING',
      tokenLength: token.length,
      clientIdMasked: clientId ? `****${clientId.slice(-4)}` : 'MISSING',
      isTokenValid_inMemory: dhan.auth?.isTokenValid || false,
      tokenRejectedFlag: dhan.auth?._tokenRejected || false,
    };

    if (!token || !clientId) {
      return res.json({ checked: false, reason: 'Missing credentials', credentials: credentialSummary });
    }

    // Make real /v2/profile request — proves credentials are accepted by Dhan
    const https = await import('https');
    const axios = (await import('axios')).default;
    const IPV4_AGENT = new https.Agent({ family: 4 });

    const start = Date.now();
    try {
      const resp = await axios.get('https://api.dhan.co/v2/profile', {
        httpsAgent: IPV4_AGENT,
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'access-token': token.trim(),
          'client-id': clientId.trim(),
        },
      });
      const latencyMs = Date.now() - start;
      // Dhan returns profile data — confirm it looks valid without exposing PII
      const profileValid = resp.status === 200 &&
        !!(resp.data?.dhanClientId || resp.data?.clientId || resp.data?.data);

      // Clear any stale _tokenRejected flag since the real call just succeeded
      if (profileValid && dhan.auth?._tokenRejected) {
        dhan.auth.recordValidationSuccess();
        console.log('[DhanAuthCheck] Cleared stale _tokenRejected flag — token confirmed valid by /v2/profile');
      }

      return res.json({
        checked: true,
        endpoint: '/v2/profile',
        httpStatus: resp.status,
        dhanAuth: profileValid ? 'PASS' : 'UNKNOWN',
        profileValid,
        latencyMs,
        credentials: credentialSummary,
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      const httpStatus = err.response?.status || null;
      const dhanErrorCode = err.response?.data?.errorCode || null;
      const dhanErrorMessage = err.response?.data?.errorMessage || err.response?.data?.message || err.message;
      return res.json({
        checked: true,
        endpoint: '/v2/profile',
        httpStatus,
        dhanAuth: httpStatus === 401 ? 'FAIL — 401 Unauthorized' : 'FAIL — network/other',
        dhanErrorCode,
        dhanErrorMessage,
        latencyMs,
        credentials: credentialSummary,
      });
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
  // MARKET MOVERS — Top Gainers / Top Losers / Most Traded
  // Fetches directly from Dhan quote API so data is always
  // available regardless of MDE cache state (market open or closed).
  // ═══════════════════════════════════════════════════════════
  router.get('/market/movers', requireAuth, async (req, res) => {
    const LIMIT = Math.min(parseInt(req.query.limit) || 10, 20);

    // NIFTY 50 equity universe — canonical Dhan security IDs (NSE_EQ)
    // These are the tokens that have real, reliable LTP from Dhan REST.
    const NIFTY50_UNIVERSE = [
      { token: '2885',  symbol: 'RELIANCE'   },
      { token: '1333',  symbol: 'HDFCBANK'   },
      { token: '4963',  symbol: 'ICICIBANK'  },
      { token: '3045',  symbol: 'SBIN'       },
      { token: '11536', symbol: 'TCS'        },
      { token: '1594',  symbol: 'INFY'       },
      { token: '1660',  symbol: 'ITC'        },
      { token: '11483', symbol: 'LT'         },
      { token: '5900',  symbol: 'AXISBANK'   },
      { token: '7229',  symbol: 'HCLTECH'    },
      { token: '317',   symbol: 'BAJFINANCE' },
      { token: '1922',  symbol: 'KOTAKBANK'  },
      { token: '3456',  symbol: 'TATAMOTORS' },
      { token: '3499',  symbol: 'TATASTEEL'  },
      { token: '10999', symbol: 'MARUTI'     },
      { token: '3506',  symbol: 'TITAN'      },
      { token: '25215', symbol: 'ADANIENT'   },
      { token: '15083', symbol: 'ADANIPORTS' },
      { token: '383',   symbol: 'BEL'        },
      { token: '2303',  symbol: 'HAL'        },
      { token: '5097',  symbol: 'ZOMATO'     },
      { token: '14732', symbol: 'DLF'        },
      { token: '881',   symbol: 'SUNPHARMA'  },
      { token: '14977', symbol: 'POWERGRID'  },
      { token: '11630', symbol: 'NTPC'       },
      { token: '694',   symbol: 'COALINDIA'  },
      { token: '467',   symbol: 'BHARTIARTL' },
      { token: '1410',  symbol: 'TIINDIA'    },
      { token: '3718',  symbol: 'VOLTAS'     },
      { token: '3787',  symbol: 'WIPRO'      },
    ];

    try {
      // ── Strategy 1: try Dhan REST quote API directly ─────────────────────
      // This returns last_price + close_price (prev session close) even when
      // market is closed — giving valid changePercent in all cases.
      const dhanAdapter = dataProviderSwitch?.getDhanAdapter?.();

      if (dhanAdapter && dhanAdapter.auth?.isTokenValid) {
        const instrumentList = NIFTY50_UNIVERSE.map(s => ({ token: s.token, segment: 'NSE_EQ' }));
        const rawQuotes = await dhanAdapter.getQuotes(instrumentList);

        if (rawQuotes && rawQuotes.length > 0) {
          // Build symbol map for O(1) lookup
          const symbolMap = new Map(NIFTY50_UNIVERSE.map(s => [s.token, s.symbol]));

          // Enrich: use close from MDE cache to compute changePercent when REST
          // only returns ltp (e.g. during off-hours the Dhan LTP endpoint may
          // not always include the open/close fields).
          const enriched = rawQuotes
            .filter(q => q.ltp && q.ltp > 0)
            .map(q => {
              const cached = marketDataEngine.getQuote(q.token);
              const close  = q.close  || cached?.close  || 0;
              const open   = q.open   || cached?.open   || 0;
              const high   = q.high   || cached?.high   || 0;
              const low    = q.low    || cached?.low    || 0;
              const volume = q.volume || cached?.volume || 0;

              // changePercent = (ltp - prevClose) / prevClose * 100
              const changePct = close > 0
                ? parseFloat(((q.ltp - close) / close * 100).toFixed(2))
                : (cached?.changePercent || 0);
              const change = close > 0
                ? parseFloat((q.ltp - close).toFixed(2))
                : (cached?.change || 0);

              return {
                token: q.token,
                symbol: symbolMap.get(q.token) || cached?.symbol || q.token,
                ltp: q.ltp,
                change,
                changePct,
                volume,
                open, high, low, close,
              };
            });

          // Derive the three lists
          const withChangePct = enriched.filter(r => r.changePct !== 0 || r.ltp > 0);
          const gainers = [...withChangePct]
            .filter(r => r.changePct > 0)
            .sort((a, b) => b.changePct - a.changePct)
            .slice(0, LIMIT);
          const losers = [...withChangePct]
            .filter(r => r.changePct < 0)
            .sort((a, b) => a.changePct - b.changePct)
            .slice(0, LIMIT);
          const mostTraded = [...enriched]
            .filter(r => r.volume > 0)
            .sort((a, b) => b.volume - a.volume)
            .slice(0, LIMIT);

          // Push fresh quotes back into MDE so WS clients benefit too
          for (const q of enriched) {
            if (q.ltp > 0) {
              marketDataEngine.pushQuote(q.token, {
                ltp: q.ltp,
                change: q.change,
                changePercent: q.changePct,
                volume: q.volume,
                open: q.open,
                high: q.high,
                low: q.low,
                close: q.close,
                symbol: q.symbol,
                exchange: 'NSE',
                timestamp: Date.now(),
              });
            }
          }

          return res.json({
            source: 'dhan_rest',
            asOf: new Date().toISOString(),
            gainers,
            losers,
            mostTraded,
          });
        }
      }

      // ── Strategy 2: fall back to MDE cache (works when market is open) ───
      const allQuotes = marketDataEngine.getAllQuotes();
      const mdeResults = [];
      for (const [token, quote] of allQuotes) {
        if (quote.exchange !== 'NSE' && quote.segment !== 'NSE_EQ') continue;
        if (!quote.ltp || quote.ltp <= 0) continue;
        const sym = NIFTY50_UNIVERSE.find(s => s.token === token);
        if (!sym) continue;
        mdeResults.push({
          token,
          symbol: quote.symbol || sym.symbol,
          ltp: quote.ltp,
          change: quote.change || 0,
          changePct: quote.changePercent || 0,
          volume: quote.volume || 0,
        });
      }

      if (mdeResults.length > 0) {
        return res.json({
          source: 'mde_cache',
          asOf: new Date().toISOString(),
          gainers: [...mdeResults].filter(r => r.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, LIMIT),
          losers:  [...mdeResults].filter(r => r.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, LIMIT),
          mostTraded: [...mdeResults].filter(r => r.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, LIMIT),
        });
      }

      // ── No data available ─────────────────────────────────────────────────
      return res.json({
        source: 'unavailable',
        asOf: new Date().toISOString(),
        gainers: [],
        losers: [],
        mostTraded: [],
      });
    } catch (err) {
      console.error('[/market/movers] Error:', err.message);
      res.status(500).json({ error: err.message });
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
      // Primary: DataProviderSwitch (routes to Dhan — native OI change + Greeks)
      // Fallback: Angel One optionChainService (used when Dhan unavailable)
      const oiService = new OIAnalyticsService(dataProviderSwitch, optionChainService);
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

/**
 * Normalize Dhan option chain 'oc' map format into flat OptionChainEntry array.
 * Dhan returns: { last_price, oc: { "24200.000000": { ce: {...}, pe: {...} }, ... } }
 */
function _normalizeOcMap(data) {
  const oc = data.oc || {};
  const chain = [];
  for (const [strikeStr, sides] of Object.entries(oc)) {
    const strike = parseFloat(strikeStr);
    if (!strike || isNaN(strike)) continue;
    const ce = sides.ce || {};
    const pe = sides.pe || {};
    chain.push(enrichOptionChainEntry({
      strike,
      callToken: String(ce.security_id || ''),
      callLtp: Number(ce.last_price || 0),
      callVolume: Number(ce.volume || 0),
      callOi: Number(ce.oi || 0),
      callOiChange: Number(ce.previous_oi ? (ce.oi || 0) - ce.previous_oi : 0),
      callBidPrice: Number(ce.top_bid_price || ce.bid || 0),
      callAskPrice: Number(ce.top_ask_price || ce.ask || 0),
      callBidQty: Number(ce.top_bid_quantity || 0),
      callAskQty: Number(ce.top_ask_quantity || 0),
      callPrevClose: Number(ce.previous_close_price || 0),
      callIv: Number(ce.implied_volatility || 0),
      callDelta: Number(ce.greeks?.delta || 0),
      callGamma: Number(ce.greeks?.gamma || 0),
      callTheta: Number(ce.greeks?.theta || 0),
      callVega: Number(ce.greeks?.vega || 0),
      putToken: String(pe.security_id || ''),
      putLtp: Number(pe.last_price || 0),
      putVolume: Number(pe.volume || 0),
      putOi: Number(pe.oi || 0),
      putOiChange: Number(pe.previous_oi ? (pe.oi || 0) - pe.previous_oi : 0),
      putBidPrice: Number(pe.top_bid_price || pe.bid || 0),
      putAskPrice: Number(pe.top_ask_price || pe.ask || 0),
      putBidQty: Number(pe.top_bid_quantity || 0),
      putAskQty: Number(pe.top_ask_quantity || 0),
      putPrevClose: Number(pe.previous_close_price || 0),
      putIv: Number(pe.implied_volatility || 0),
      putDelta: Number(pe.greeks?.delta || 0),
      putGamma: Number(pe.greeks?.gamma || 0),
      putTheta: Number(pe.greeks?.theta || 0),
      putVega: Number(pe.greeks?.vega || 0),
    }));
  }
  chain.sort((a, b) => a.strike - b.strike);
  return chain;
}
