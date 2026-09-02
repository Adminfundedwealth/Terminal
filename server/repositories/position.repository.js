/**
 * POSITION REPOSITORY
 * 
 * Database operations for positions table.
 * All queries scoped by trading_account_id.
 */

import { BaseRepository } from './base.repository.js';
import { eventBus } from '../events/index.js';

export class PositionRepository extends BaseRepository {
  constructor() {
    super('positions');
  }

  async findOpenByAccountId(accountId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('is_open', true)
      .order('opened_at', { ascending: false });

    if (error) throw new Error(`[positions] findOpenByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findAllByAccountId(accountId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .order('opened_at', { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`[positions] findAllByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findOpenPosition(accountId, token, productType) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('token', token)
      .eq('product_type', productType)
      .eq('is_open', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`[positions] findOpenPosition failed: ${error.message}`);
    }
    return data || null;
  }

  async upsertPosition(accountId, params) {
    const existing = await this.findOpenPosition(accountId, params.token, params.productType);

    if (existing) {
      const isSameDirection = (existing.side === 'LONG' && params.side === 'BUY') ||
                              (existing.side === 'SHORT' && params.side === 'SELL');

      let newQty, newAvgPrice, realizedPnl, newSide;

      if (isSameDirection) {
        // Adding to position
        newQty = existing.qty + params.qty;
        newAvgPrice = ((existing.avg_price * existing.qty) + (params.price * params.qty)) / newQty;
        realizedPnl = existing.realized_pnl;
        newSide = existing.side;

        // Update buy/sell tracking
        const buyQty = existing.buy_qty + (params.side === 'BUY' ? params.qty : 0);
        const sellQty = existing.sell_qty + (params.side === 'SELL' ? params.qty : 0);
        const buyAvg = params.side === 'BUY'
          ? ((existing.buy_avg * existing.buy_qty) + (params.price * params.qty)) / buyQty
          : existing.buy_avg;
        const sellAvg = params.side === 'SELL'
          ? ((existing.sell_avg * existing.sell_qty) + (params.price * params.qty)) / sellQty
          : existing.sell_avg;

        const result = await this.update(existing.id, {
          qty: newQty,
          avg_price: Math.round(newAvgPrice * 100) / 100,
          buy_qty: buyQty,
          sell_qty: sellQty,
          buy_avg: Math.round(buyAvg * 100) / 100,
          sell_avg: Math.round(sellAvg * 100) / 100,
          updated_at: new Date().toISOString(),
        });

        eventBus.publish('position.updated', {
          id: result.id,
          symbol: existing.symbol, token: existing.token,
          qty: newQty, side: newSide, avgPrice: newAvgPrice,
          pnl: realizedPnl, status: 'open',
        }, { accountId });

        return result;
      } else {
        // Reducing or reversing
        const closeQty = Math.min(params.qty, existing.qty);
        const pnlPerUnit = existing.side === 'LONG'
          ? (params.price - existing.avg_price)
          : (existing.avg_price - params.price);
        realizedPnl = (existing.realized_pnl || 0) + (pnlPerUnit * closeQty);

        const remainingQty = existing.qty - closeQty;
        const excessQty = params.qty - closeQty;

        if (remainingQty === 0 && excessQty === 0) {
          // Fully closed
          const result = await this.update(existing.id, {
            qty: 0,
            realized_pnl: Math.round(realizedPnl * 100) / 100,
            is_open: false,
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          eventBus.publish('position.updated', {
            id: result.id,
            symbol: existing.symbol, token: existing.token,
            qty: 0, pnl: realizedPnl, status: 'closed',
          }, { accountId });

          return result;
        } else if (remainingQty > 0) {
          // Reduced
          const result = await this.update(existing.id, {
            qty: remainingQty,
            realized_pnl: Math.round(realizedPnl * 100) / 100,
            updated_at: new Date().toISOString(),
          });

          eventBus.publish('position.updated', {
            symbol: existing.symbol, token: existing.token,
            qty: remainingQty, side: existing.side,
            pnl: realizedPnl, status: 'open',
          }, { accountId });

          return result;
        } else {
          // Reversed: close old, open new
          await this.update(existing.id, {
            qty: 0,
            realized_pnl: Math.round(realizedPnl * 100) / 100,
            is_open: false,
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          newSide = params.side === 'BUY' ? 'LONG' : 'SHORT';
          const newPos = await this.insert({
            trading_account_id: accountId,
            symbol: params.symbol,
            token: params.token,
            segment: params.segment,
            instrument_type: params.instrumentType || null,
            product_type: params.productType,
            side: newSide,
            qty: excessQty,
            avg_price: params.price,
            buy_qty: params.side === 'BUY' ? excessQty : 0,
            sell_qty: params.side === 'SELL' ? excessQty : 0,
            buy_avg: params.side === 'BUY' ? params.price : 0,
            sell_avg: params.side === 'SELL' ? params.price : 0,
            is_open: true,
          });

          eventBus.publish('position.updated', {
            id: newPos.id,
            symbol: params.symbol, token: params.token,
            qty: excessQty, side: newSide,
            pnl: 0, status: 'open',
          }, { accountId });

          return newPos;
        }
      }
    } else {
      // New position
      const side = params.side === 'BUY' ? 'LONG' : 'SHORT';
      const result = await this.insert({
        trading_account_id: accountId,
        symbol: params.symbol,
        token: params.token,
        segment: params.segment,
        instrument_type: params.instrumentType || null,
        product_type: params.productType,
        side,
        qty: params.qty,
        avg_price: params.price,
        buy_qty: params.side === 'BUY' ? params.qty : 0,
        sell_qty: params.side === 'SELL' ? params.qty : 0,
        buy_avg: params.side === 'BUY' ? params.price : 0,
        sell_avg: params.side === 'SELL' ? params.price : 0,
        is_open: true,
      });

      eventBus.publish('position.updated', {
        id: result.id,
        symbol: params.symbol, token: params.token,
        qty: params.qty, side, pnl: 0, status: 'open',
      }, { accountId });

      return result;
    }
  }

  async closePosition(positionId, exitPrice) {
    const position = await this.findById(positionId);
    if (!position) throw new Error('Position not found');

    const pnlPerUnit = position.side === 'LONG'
      ? (exitPrice - position.avg_price)
      : (position.avg_price - exitPrice);
    const realizedPnl = (position.realized_pnl || 0) + (pnlPerUnit * position.qty);

    return this.update(positionId, {
      qty: 0,
      realized_pnl: Math.round(realizedPnl * 100) / 100,
      is_open: false,
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  async countOpenPositions(accountId) {
    const { count, error } = await this.db
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .eq('is_open', true);

    if (error) throw new Error(`[positions] countOpenPositions failed: ${error.message}`);
    return count || 0;
  }

  async getTotalUnrealizedPnl(accountId, quoteProvider) {
    const positions = await this.findOpenByAccountId(accountId);
    let totalPnl = 0;

    for (const pos of positions) {
      if (pos.qty === 0) continue;

      // ── Safe LTP resolution ──────────────────────────────────────────────
      // NEVER use 0 as a fallback price. A zero LTP causes the entire
      // position to appear worthless, generating a fake loss of
      // (0 − avgPrice) × qty. This was the direct cause of the Aug-10
      // incident where a single blank HCLTECH tick produced a false
      // −₹59,000 daily-loss reading and nearly breached the account.
      //
      // Rules:
      //   1. If a quoteProvider is supplied and returns a valid positive
      //      number, use it for the MTM calculation.
      //   2. If the quote is unavailable (null / undefined / 0 / NaN),
      //      fall back to the position's own avg_price (= break-even,
      //      unrealized P&L = 0 for that position). This is conservative:
      //      it neither inflates gains nor fabricates losses.
      //   3. Never use NaN or Infinity as a price.
      let ltp = quoteProvider ? quoteProvider(pos.token) : null;

      // Validate the returned LTP
      if (ltp === null || ltp === undefined || !Number.isFinite(ltp) || ltp <= 0) {
        // Quote unavailable or invalid — assume break-even for this position.
        // This means unrealized P&L contribution = 0; no fake loss is generated.
        ltp = pos.avg_price;
      }

      const pnl = pos.side === 'LONG'
        ? (ltp - pos.avg_price) * pos.qty
        : (pos.avg_price - ltp) * pos.qty;
      totalPnl += pnl;
    }

    return Math.round(totalPnl * 100) / 100;
  }
}
