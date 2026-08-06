/**
 * ACCOUNT SERVICE
 * 
 * All account/portfolio operations query Supabase.
 * If database is unavailable or table missing: returns empty state.
 * NO fallback mock data. NO simulation.
 * 
 * Event Bus Integration:
 *   - order.created  → on placeOrder success
 *   - order.updated  → on modifyOrder / cancelOrder success
 *   - position.updated → on position exit/reverse
 * 
 * Execution Integration:
 *   - OrderExecutionService handles broker routing, risk checks, position/trade updates
 */

import { supabase } from '../db/client.js';
import { eventBus } from '../events/index.js';
import { OrderExecutionService } from './orderExecutionService.js';
import crypto from 'crypto';

// In-memory order store for when trading_orders table doesn't exist
const memOrders = new Map();

export class AccountService {
  constructor(marketDataEngine) {
    this.marketDataEngine = marketDataEngine;
    this.executionService = new OrderExecutionService(marketDataEngine);
    this._positionTrackingSubscriptions = new Map(); // token -> callback
    this._trackedAccountId = null;
    this._resolvedDevAccountId = null; // Cached resolution
  }

  /**
   * Resolve 'dev-account' to the real Supabase trading_account UUID.
   * Caches result to avoid repeated DB lookups.
   */
  async resolveAccountId(accountId) {
    if (accountId !== 'dev-account') return accountId;
    if (this._resolvedDevAccountId) return this._resolvedDevAccountId;
    if (!supabase) return accountId;
    try {
      const { data: trader } = await supabase.from('terminal_traders').select('id').eq('external_id', 'dev-user').single();
      if (!trader) return accountId;
      const { data: ta } = await supabase.from('trading_accounts').select('id').eq('trader_id', trader.id).eq('status', 'active').limit(1).single();
      if (ta) { this._resolvedDevAccountId = ta.id; return ta.id; }
    } catch {}
    return accountId;
  }

  /**
   * Start real-time P&L tracking for open positions.
   * Subscribes to MDE quotes for each position's token and publishes
   * position.updated events to the event bus on every tick.
   * @param {string} accountId
   */
  async startPositionTracking(accountId) {
    this._trackedAccountId = accountId;
    await this._refreshPositionTracking(accountId);

    // Re-subscribe when orders fill (positions may have changed)
    eventBus.subscribe('order.updated', (event) => {
      if (event.payload?.status === 'FILLED' && event.meta?.accountId === accountId) {
        // Delay slightly to let position repo update
        setTimeout(() => this._refreshPositionTracking(accountId), 500);
      }
    });
  }

  /**
   * Refresh position tracking subscriptions.
   * Unsubscribes old, subscribes to current open positions.
   * @private
   */
  async _refreshPositionTracking(accountId) {
    // Clean up existing subscriptions
    for (const [token, cb] of this._positionTrackingSubscriptions) {
      this.marketDataEngine.unsubscribe(token, cb);
    }
    this._positionTrackingSubscriptions.clear();

    // Get current open positions
    const positions = await this.getPositions(accountId);

    for (const pos of positions) {
      if (!pos.qty || pos.qty === 0) continue;

      const avgPrice = pos.avg_price || pos.avgPrice || 0;
      const qty = pos.qty;
      const token = pos.token;
      const symbol = pos.symbol;

      const callback = (event) => {
        const ltp = event.data?.ltp;
        if (!ltp) return;
        const pnl = qty > 0
          ? (ltp - avgPrice) * qty
          : (avgPrice - ltp) * Math.abs(qty);

        eventBus.publish('position.updated', {
          symbol,
          token,
          qty,
          pnl,
          ltp,
          avgPrice,
        }, { accountId });
      };

      this._positionTrackingSubscriptions.set(token, callback);
      this.marketDataEngine.subscribe(token, callback);
    }

    if (positions.length > 0) {
      console.log(`[AccountService] Position P&L tracking active for ${this._positionTrackingSubscriptions.size} tokens`);
    }
  }

  async getRules(accountId) {
    if (!supabase) {
      return [];
    }
    // Resolve dev-account to real trading account ID
    let resolvedId = accountId;
    if (accountId === 'dev-account') {
      const { data: trader } = await supabase.from('terminal_traders').select('id').eq('external_id', 'dev-user').single();
      if (trader) {
        const { data: ta } = await supabase.from('trading_accounts').select('id').eq('trader_id', trader.id).eq('status', 'active').limit(1).single();
        if (ta) resolvedId = ta.id;
      }
    }
    // Query risk_rules table with trading_account_id FK
    const { data, error } = await supabase
      .from('risk_rules')
      .select('rule_type, value, is_active')
      .eq('trading_account_id', resolvedId)
      .eq('is_active', true);

    if (error || !data) {
      return [];
    }

    return data;
  }

  async getAccount(accountId) {
    // Dev bypass — fetch real data from Supabase for dev user
    if (accountId === 'dev-account') {
      if (!supabase) {
        return { id: 'dev-account', accountCode: 'FW-DEV', clientId: 'FW-DEV', name: 'Dev Trader', balance: 1000000, peakBalance: 1000000, availableMargin: 1000000, usedMargin: 0, totalPnl: 0, status: 'active', brokerProvider: 'angelone' };
      }
      const { data: trader } = await supabase.from('terminal_traders').select('id').eq('external_id', 'dev-user').single();
      if (!trader) {
        return { id: 'dev-account', accountCode: 'FW-DEV', clientId: 'FW-DEV', name: 'Dev Trader', balance: 1000000, peakBalance: 1000000, availableMargin: 1000000, usedMargin: 0, totalPnl: 0, status: 'active', brokerProvider: 'angelone' };
      }
      const { data: ta } = await supabase
        .from('trading_accounts')
        .select('*, challenge_accounts!inner(id, type, plan, initial_balance, current_balance, peak_balance, profit_target_pct, daily_loss_limit_pct, max_drawdown_pct, status, started_at, expires_at)')
        .eq('trader_id', trader.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (!ta) {
        return { id: 'dev-account', accountCode: 'FW-DEV', clientId: 'FW-DEV', name: 'Dev Trader', balance: 1000000, peakBalance: 1000000, availableMargin: 1000000, usedMargin: 0, totalPnl: 0, status: 'active', brokerProvider: 'angelone' };
      }
      const ch = ta.challenge_accounts;
      
      // Plan-level rule defaults (matching main site product catalog)
      const planDefaults = {
        flash: { profitTargetPct: 0, dailyLossLimitPct: 2, maxDrawdownPct: 4 },
        instant: { profitTargetPct: 0, dailyLossLimitPct: 3, maxDrawdownPct: 5 },
        '1step': { profitTargetPct: 10, dailyLossLimitPct: 3, maxDrawdownPct: 6 },
        '2step': { profitTargetPct: 8, dailyLossLimitPct: 3, maxDrawdownPct: 8 },
      };
      // If plan is missing, infer from challenge type (fallback logic)
      let inferredPlan = ch?.plan || 'flash';
      if (!ch?.plan && ch?.type) {
        // For types like 'evaluation_phase1', '2step_evaluation_phase1', etc., infer the product
        const typeStr = String(ch.type).toLowerCase();
        if (typeStr.includes('2step')) inferredPlan = '2step';
        else if (typeStr.includes('1step')) inferredPlan = '1step';
        else if (typeStr.includes('instant')) inferredPlan = 'instant';
        else inferredPlan = 'flash';
      }
      const planKey = inferredPlan.toLowerCase();
      const defaults = planDefaults[planKey] || planDefaults.flash;
      
      return {
        id: ta.id,
        accountCode: ta.account_code,
        clientId: ta.broker_client_id || ta.account_code,
        name: 'Dev Trader',
        userId: trader.id,
        brokerProvider: ta.broker_provider,
        balance: parseFloat(ta.balance) || 0,
        peakBalance: parseFloat(ch?.peak_balance) || parseFloat(ta.balance) || 0,
        availableMargin: parseFloat(ta.available_margin) || 0,
        usedMargin: parseFloat(ta.used_margin) || 0,
        totalPnl: 0,
        status: ta.status,
        lockedReason: ta.locked_reason || null,
        challenge: ch ? {
          id: ch.id,
          type: ch.type,
          plan: inferredPlan,
          initialBalance: parseFloat(ch.initial_balance) || 0,
          status: ch.status,
          startedAt: ch.started_at,
          expiresAt: ch.expires_at,
          // Use explicit null/undefined check instead of falsy operator (0 is a valid value for Flash)
          profitTargetPct: ch.profit_target_pct !== null && ch.profit_target_pct !== undefined ? parseFloat(ch.profit_target_pct) : defaults.profitTargetPct,
          dailyLossLimitPct: ch.daily_loss_limit_pct !== null && ch.daily_loss_limit_pct !== undefined ? parseFloat(ch.daily_loss_limit_pct) : defaults.dailyLossLimitPct,
          maxDrawdownPct: ch.max_drawdown_pct !== null && ch.max_drawdown_pct !== undefined ? parseFloat(ch.max_drawdown_pct) : defaults.maxDrawdownPct,
        } : null,
      };
    }

    if (!supabase) {
      return null;
    }

    // Fetch trading account with joined challenge data in one query
    const { data, error } = await supabase
      .from('trading_accounts')
      .select('*, challenge_accounts(id, type, plan, initial_balance, current_balance, peak_balance, profit_target_pct, daily_loss_limit_pct, max_drawdown_pct, status, started_at, expires_at)')
      .eq('id', accountId)
      .single();

    if (error || !data) {
      return null;
    }

    // Look up trader display name
    let displayName = 'Trader';
    let email = null;
    if (data.trader_id) {
      const { data: trader } = await supabase
        .from('terminal_traders')
        .select('display_name, email')
        .eq('id', data.trader_id)
        .single();
      if (trader) {
        displayName = trader.display_name || 'Trader';
        email = trader.email || null;
      }
    }

    const ch = data.challenge_accounts;
    
    // Plan-level rule defaults (matching main site product catalog)
    const planDefaults = {
      flash: { profitTargetPct: 0, dailyLossLimitPct: 2, maxDrawdownPct: 4 },
      instant: { profitTargetPct: 0, dailyLossLimitPct: 3, maxDrawdownPct: 5 },
      '1step': { profitTargetPct: 10, dailyLossLimitPct: 3, maxDrawdownPct: 6 },
      '2step': { profitTargetPct: 8, dailyLossLimitPct: 3, maxDrawdownPct: 8 },
    };
    const planKey = ch?.plan?.toLowerCase() || 'flash';
    const defaults = planDefaults[planKey] || planDefaults.flash;

    // Map snake_case DB fields to camelCase AccountInfo shape
    return {
      id: data.id,
      accountCode: data.account_code,
      clientId: data.broker_client_id || data.account_code,
      name: displayName,
      email,
      userId: data.trader_id,
      brokerProvider: data.broker_provider,
      balance: parseFloat(data.balance) || 0,
      peakBalance: parseFloat(ch?.peak_balance ?? data.peak_balance) || parseFloat(data.balance) || 0,
      availableMargin: parseFloat(data.available_margin) || 0,
      usedMargin: parseFloat(data.used_margin) || 0,
      totalPnl: 0,
      status: data.status,
      lockedReason: data.locked_reason || null,
      challenge: ch ? {
        id: ch.id,
        type: ch.type,
        plan: ch.plan,
        initialBalance: parseFloat(ch.initial_balance) || 0,
        status: ch.status,
        startedAt: ch.started_at,
        expiresAt: ch.expires_at,
        // Use explicit null/undefined check instead of falsy operator (0 is a valid value for Flash)
        profitTargetPct: ch.profit_target_pct !== null && ch.profit_target_pct !== undefined ? parseFloat(ch.profit_target_pct) : defaults.profitTargetPct,
        dailyLossLimitPct: ch.daily_loss_limit_pct !== null && ch.daily_loss_limit_pct !== undefined ? parseFloat(ch.daily_loss_limit_pct) : defaults.dailyLossLimitPct,
        maxDrawdownPct: ch.max_drawdown_pct !== null && ch.max_drawdown_pct !== undefined ? parseFloat(ch.max_drawdown_pct) : defaults.maxDrawdownPct,
      } : null,
    };
  }

  async getPositions(accountId) {
    if (!supabase) {
      return [];
    }
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('is_open', true);

    if (error || !data) {
      return [];
    }

    return data.map(p => {
      const q = this.marketDataEngine.getQuote(p.token);
      const ltp = q?.ltp || parseFloat(p.current_price) || parseFloat(p.avg_price) || 0;
      const avgPrice = parseFloat(p.avg_price) || 0;
      const qty = p.qty || 0;
      const pnl = p.side === 'LONG'
        ? (ltp - avgPrice) * qty
        : (avgPrice - ltp) * qty;
      return {
        id: p.id,
        symbol: p.symbol,
        token: p.token,
        segment: p.segment,
        side: p.side,
        productType: p.product_type,
        qty,
        avgPrice,
        ltp,
        pnl: Math.round(pnl * 100) / 100,
        mtm: Math.round(pnl * 100) / 100,
        buyQty: p.buy_qty || 0,
        sellQty: p.sell_qty || 0,
        buyAvg: parseFloat(p.buy_avg) || 0,
        sellAvg: parseFloat(p.sell_avg) || 0,
        stopLoss: p.stop_loss ? parseFloat(p.stop_loss) : undefined,
        takeProfit: p.take_profit ? parseFloat(p.take_profit) : undefined,
        trailingStop: p.trailing_stop ? parseFloat(p.trailing_stop) : undefined,
        breakEvenActivated: p.break_even_activated || false,
      };
    });
  }

  async getOrders(accountId) {
    if (!supabase) {
      return [];
    }
    const { data, error } = await supabase
      .from('trading_orders')
      .select('*')
      .eq('trading_account_id', accountId)
      .order('placed_at', { ascending: false });

    if (error || !data) {
      return [];
    }
    return data.map(o => ({
      id: o.id,
      symbol: o.symbol,
      token: o.token,
      segment: o.segment,
      side: o.side,
      orderType: o.order_type,
      productType: o.product_type,
      qty: o.qty,
      price: parseFloat(o.price) || 0,
      triggerPrice: parseFloat(o.trigger_price) || 0,
      filledQty: o.filled_qty || 0,
      avgPrice: parseFloat(o.avg_fill_price) || 0,
      status: o.status,
      timestamp: o.placed_at,
      message: o.reject_reason || null,
    }));
  }

  async getTrades(accountId, period) {
    if (!supabase) {
      return [];
    }

    // Always fetch ALL executions for FIFO P&L computation, then filter by period for display
    let allQuery = supabase
      .from('executions')
      .select('*')
      .eq('trading_account_id', accountId)
      .order('executed_at', { ascending: true }); // ascending for FIFO

    const { data: allData, error: allError } = await allQuery;
    if (allError || !allData) {
      return [];
    }

    // ── FIFO P&L computation across all executions ─────────────────────────
    // openLots: per-token queue of { side, qty, price }
    const openLots = {};    // token → [{ side:'LONG'|'SHORT', qty, price }]
    const pnlByExec = {};   // execId → realizedPnl for this execution

    for (const t of allData) {
      const key = t.token || t.symbol;
      if (!openLots[key]) openLots[key] = [];

      const qty = parseInt(t.qty) || 0;
      const price = parseFloat(t.price) || 0;
      const incomingDir = t.side === 'BUY' ? 'LONG' : 'SHORT';
      const closingDir  = t.side === 'BUY' ? 'SHORT' : 'LONG';

      let remaining = qty;
      let execPnl = 0;

      // Close opposite lots first (FIFO)
      while (remaining > 0 && openLots[key].length > 0 && openLots[key][0].side === closingDir) {
        const lot = openLots[key][0];
        const closeQty = Math.min(remaining, lot.qty);
        const pnl = closingDir === 'LONG'
          ? (price - lot.price) * closeQty   // closing long via SELL
          : (lot.price - price) * closeQty;  // closing short via BUY
        execPnl += pnl;
        lot.qty -= closeQty;
        if (lot.qty <= 0) openLots[key].shift();
        remaining -= closeQty;
      }

      // Open new lot for remaining qty
      if (remaining > 0) {
        openLots[key].push({ side: incomingDir, qty: remaining, price });
      }

      pnlByExec[t.id] = execPnl;
    }

    // ── Filter by period for display ────────────────────────────────────────
    let filteredData = allData;
    if (period) {
      const now = new Date();
      let from;
      switch (period) {
        case 'today':
          from = new Date(now); from.setHours(0, 0, 0, 0); break;
        case 'week':
          from = new Date(now); from.setDate(from.getDate() - 7); break;
        case 'month':
          from = new Date(now); from.setMonth(from.getMonth() - 1); break;
        default:
          from = new Date(now); from.setHours(0, 0, 0, 0);
      }
      const fromIso = from.toISOString();
      filteredData = allData.filter(t => t.executed_at >= fromIso);
    }

    // Return most-recent-first for display, with P&L attached
    return filteredData
      .slice()
      .sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime())
      .map(t => ({
        id: t.id,
        orderId: t.order_id,
        symbol: t.symbol,
        token: t.token,
        segment: t.segment,
        side: t.side,
        qty: t.qty,
        price: parseFloat(t.price) || 0,
        timestamp: t.executed_at,
        pnl: Math.round((pnlByExec[t.id] || 0) * 100) / 100,
      }));
  }

  async placeOrder(accountId, params) {
    if (!supabase) {
      throw new Error('Database not configured. Cannot place orders.');
    }
    // Normalise exchange — defaults to segment when not provided
    const exchange = params.exchange || params.segment;

    // Insert order into trading_orders — FK is trading_account_id
    const { data, error } = await supabase.from('trading_orders').insert({
      trading_account_id: accountId,
      symbol: params.symbol,
      token: params.token || null,
      segment: params.segment || null,
      instrument_type: params.instrumentType || null,
      side: params.side,
      order_type: params.orderType,
      product_type: params.productType || 'MIS',
      qty: params.qty,
      price: params.price || null,
      trigger_price: params.triggerPrice || null,
      status: 'PENDING',
    }).select().single();

    if (error) {
      // Table doesn't exist — use in-memory store
      if (error.message && error.message.includes('schema cache')) {
        const orderId = crypto.randomUUID();
        const order = {
          id: orderId, account_id: accountId, symbol: params.symbol, token: params.token,
          segment: params.segment, side: params.side, order_type: params.orderType,
          product_type: params.productType, qty: params.qty, price: params.price || null,
          trigger_price: params.triggerPrice || null, status: 'PENDING', placed_at: new Date().toISOString(),
        };
        memOrders.set(orderId, order);

        eventBus.publish('order.created', {
          orderId, symbol: params.symbol, token: params.token, segment: params.segment,
          side: params.side, orderType: params.orderType, productType: params.productType,
          qty: params.qty, price: params.price || null, status: 'PENDING',
        }, { accountId });

        // Trigger execution even for in-memory path
        this._executeOrderAsync(accountId, orderId, { ...params, exchange });

        return { orderId, status: 'PENDING' };
      }
      throw new Error(`Order insert failed: ${error.message}`);
    }

    // Publish order.created event to event bus
    eventBus.publish('order.created', {
      orderId: data.id,
      symbol: params.symbol,
      token: params.token,
      segment: params.segment,
      side: params.side,
      orderType: params.orderType,
      productType: params.productType,
      qty: params.qty,
      price: params.price || null,
      status: 'PENDING',
    }, { accountId });

    // Trigger async execution (risk → broker → position → trade)
    this._executeOrderAsync(accountId, data.id, { ...params, exchange });

    return { orderId: data.id, status: 'PENDING' };
  }

  async modifyOrder(accountId, orderId, params) {
    if (!supabase) {
      throw new Error('Database not configured. Cannot modify orders.');
    }
    const updates = {};
    if (params.price !== undefined) updates.price = params.price;
    if (params.triggerPrice !== undefined) updates.trigger_price = params.triggerPrice;
    if (params.qty !== undefined) updates.qty = params.qty;
    if (params.orderType !== undefined) updates.order_type = params.orderType;

    const { data, error } = await supabase
      .from('trading_orders')
      .update(updates)
      .eq('id', orderId)
      .eq('trading_account_id', accountId)
      .select()
      .single();

    if (error) {
      // Fallback to in-memory
      if (error.message && error.message.includes('schema cache')) {
        const order = memOrders.get(orderId);
        if (order) { Object.assign(order, updates); return { orderId, status: order.status }; }
      }
      throw new Error(`Order modify failed: ${error.message}`);
    }

    // Publish order.updated event
    eventBus.publish('order.updated', {
      orderId: data.id,
      status: 'MODIFIED',
      price: data.price,
      triggerPrice: data.trigger_price,
      qty: data.qty,
      orderType: data.order_type,
      symbol: data.symbol,
      token: data.token,
      segment: data.segment,
    }, { accountId });

    return { orderId: data.id, status: data.status };
  }

  async cancelOrder(accountId, orderId) {
    if (!supabase) {
      throw new Error('Database not configured. Cannot cancel orders.');
    }
    const { data, error } = await supabase
      .from('trading_orders')
      .update({ status: 'CANCELLED' })
      .eq('id', orderId)
      .eq('trading_account_id', accountId)
      .in('status', ['PENDING', 'OPEN'])
      .select()
      .single();

    if (error) {
      // Fallback to in-memory
      if (error.message && error.message.includes('schema cache')) {
        const order = memOrders.get(orderId);
        if (order) { order.status = 'CANCELLED'; return { orderId, status: 'CANCELLED' }; }
      }
      // PGRST116 = no rows matched — order already filled/cancelled
      if (error.code === 'PGRST116') {
        throw new Error('Order cannot be cancelled — it may already be filled or cancelled.');
      }
      throw new Error(`Order cancel failed: ${error.message}`);
    }

    // Publish order.updated event (cancellation)
    eventBus.publish('order.updated', {
      orderId: data.id,
      status: 'CANCELLED',
      symbol: data.symbol,
      token: data.token,
      segment: data.segment,
    }, { accountId });

    return { orderId: data.id, status: 'CANCELLED' };
  }

  // ─── Execution Bridge ─────────────────────────────────────────

  /**
   * Fire-and-forget order execution.
   * Order is already PENDING in DB. This routes through risk → broker → fill handling.
   * If slPrice or tpPrice are set, attaches them automatically after fill.
   */
  _executeOrderAsync(accountId, orderId, params) {
    // Non-blocking — execution happens in background
    (async () => {
      try {
        const account = await this.getAccount(accountId);
        if (!account) {
          console.error(`[AccountService] Cannot execute order — account ${accountId} not found`);
          return;
        }
        const result = await this.executionService.executeOrder(accountId, orderId, params, account);

        // After a MARKET/FILLED order, auto-attach SL and/or TP if provided
        if (result?.status === 'FILLED' && (params.slPrice > 0 || params.tpPrice > 0)) {
          // Find the position that was just opened/modified
          const positions = await this.getPositions(accountId);
          const pos = positions.find(p => p.symbol === params.symbol && p.qty !== 0);
          if (pos) {
            if (params.slPrice > 0) {
              try {
                await this.executionService.attachStopLoss(accountId, pos.id, params.slPrice);
                console.log(`[AccountService] Auto-attached SL @ ${params.slPrice} for ${params.symbol}`);
              } catch (e) {
                console.warn(`[AccountService] SL attachment failed: ${e.message}`);
              }
            }
            if (params.tpPrice > 0) {
              try {
                await this.executionService.attachTakeProfit(accountId, pos.id, params.tpPrice);
                console.log(`[AccountService] Auto-attached TP @ ${params.tpPrice} for ${params.symbol}`);
              } catch (e) {
                console.warn(`[AccountService] TP attachment failed: ${e.message}`);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[AccountService] Order execution failed for ${orderId}:`, err.message);
      }
    })();
  }

  // ─── Position Management ──────────────────────────────────────

  /**
   * Exit (close) a position. Places a market order in opposite direction.
   * @param {string} accountId
   * @param {string} positionId
   * @param {number} [qty] - Partial close qty. Omit for full close.
   */
  async exitPosition(accountId, positionId, qty = null) {
    return this.executionService.exitPosition(accountId, positionId, qty);
  }

  /**
   * Reverse a position. Closes current + opens opposite side same qty.
   */
  async reversePosition(accountId, positionId) {
    return this.executionService.reversePosition(accountId, positionId);
  }

  /**
   * Close all open positions for the account.
   */
  async closeAllPositions(accountId, reason = 'user_requested') {
    return this.executionService.closeAllPositions(accountId, reason);
  }

  /**
   * Partial close — exit a specific qty from a position.
   */
  async partialClosePosition(accountId, positionId, qty) {
    return this.executionService.exitPosition(accountId, positionId, qty);
  }
}
