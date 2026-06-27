/**
 * KILL SWITCH SERVICE
 * 
 * Emergency trading halt that:
 *   1. Cancels all open/pending orders for target accounts
 *   2. Closes all open positions at market
 *   3. Locks all target accounts (prevents new orders)
 *   4. Logs the action for audit
 * 
 * Scope:
 *   - 'account': single trading account
 *   - 'group': all accounts for a trader
 *   - 'global': all active accounts (admin-only)
 * 
 * Rate limited: max 1 per 60 seconds per user.
 */

import { supabase } from '../db/client.js';
import { eventBus } from '../events/index.js';

// Rate limit tracking (in production, use Redis)
const lastKillSwitch = new Map(); // traderId → timestamp

export class KillSwitchService {
  /**
   * Execute kill switch.
   * @param {object} params
   * @param {string} params.triggeredBy - trader ID who triggered
   * @param {string} params.scope - 'account' | 'group' | 'global'
   * @param {string[]} params.targetAccountIds - specific accounts (for 'account' scope)
   * @param {string} params.reason - stated reason
   * @returns {object} Kill switch result
   */
  static async execute({ triggeredBy, scope = 'account', targetAccountIds = [], reason = 'Emergency kill switch' }) {
    if (!supabase) throw new Error('Database not configured');

    // Rate limit check (60 seconds cooldown)
    const lastTime = lastKillSwitch.get(triggeredBy);
    if (lastTime && Date.now() - lastTime < 60000) {
      const remaining = Math.ceil((60000 - (Date.now() - lastTime)) / 1000);
      throw new Error(`Kill switch rate limited. Wait ${remaining} seconds.`);
    }

    const startTime = Date.now();
    const timeout = 5000; // 5 second hard timeout
    let accountIds = [...targetAccountIds];

    // Resolve target accounts based on scope
    if (scope === 'group' && triggeredBy) {
      const { data } = await supabase
        .from('trading_accounts')
        .select('id')
        .eq('trader_id', triggeredBy)
        .in('status', ['active', 'locked']);
      accountIds = (data || []).map(a => a.id);
    } else if (scope === 'global') {
      const { data } = await supabase
        .from('trading_accounts')
        .select('id')
        .in('status', ['active']);
      accountIds = (data || []).map(a => a.id);
    }

    if (accountIds.length === 0) {
      throw new Error('No target accounts found for kill switch');
    }

    // Track results
    const results = {
      accountsProcessed: [],
      accountsPending: [...accountIds],
      accountsFailed: [],
      ordersCancelled: 0,
      positionsClosed: 0,
      totalPnlRealized: 0,
    };

    // Process each account sequentially (per spec: cancel orders → close positions → lock)
    for (const accountId of accountIds) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        break; // Return partial result
      }

      try {
        // Step 1: Cancel all open/pending orders
        const { data: orders } = await supabase
          .from('trading_orders')
          .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
          .eq('trading_account_id', accountId)
          .in('status', ['PENDING', 'OPEN', 'PARTIALLY_FILLED'])
          .select('id');
        
        const cancelledCount = orders?.length || 0;
        results.ordersCancelled += cancelledCount;

        // Step 2: Close all open positions (mark as closed at current price)
        const { data: positions } = await supabase
          .from('positions')
          .select('*')
          .eq('trading_account_id', accountId)
          .eq('is_open', true);

        let closedCount = 0;
        let pnlRealized = 0;

        for (const pos of (positions || [])) {
          if (pos.qty === 0) continue;
          
          // Mark position as closed (in a real scenario with broker, would place market orders)
          await supabase
            .from('positions')
            .update({
              qty: 0,
              is_open: false,
              closed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', pos.id);

          closedCount++;
          pnlRealized += pos.realized_pnl || 0;
        }

        results.positionsClosed += closedCount;
        results.totalPnlRealized += pnlRealized;

        // Step 3: Lock the account
        await supabase
          .from('trading_accounts')
          .update({
            status: 'locked',
            locked_reason: `Kill switch: ${reason}`,
            locked_at: new Date().toISOString(),
          })
          .eq('id', accountId);

        results.accountsProcessed.push(accountId);
        results.accountsPending = results.accountsPending.filter(id => id !== accountId);
      } catch (err) {
        results.accountsFailed.push({ accountId, error: err.message });
        results.accountsPending = results.accountsPending.filter(id => id !== accountId);
      }
    }

    const executionTimeMs = Date.now() - startTime;
    const status = results.accountsFailed.length === 0 && results.accountsPending.length === 0
      ? 'completed'
      : results.accountsPending.length > 0
        ? 'partial'
        : 'completed';

    // Log to audit (use execution_audits or a dedicated log)
    try {
      await supabase.from('execution_audits').insert({
        trading_account_id: accountIds[0],
        audit_type: 'kill_switch',
        checks_run: accountIds,
        all_passed: status === 'completed',
        rejection_reason: status !== 'completed' ? JSON.stringify(results.accountsFailed) : null,
        balance_before: null,
        balance_after: null,
      });
    } catch { /* best effort */ }

    // Record rate limit
    lastKillSwitch.set(triggeredBy, Date.now());

    // Publish event
    eventBus.publish('kill_switch.executed', {
      triggeredBy,
      scope,
      accountIds,
      reason,
      status,
      ordersCancelled: results.ordersCancelled,
      positionsClosed: results.positionsClosed,
      executionTimeMs,
    });

    return {
      status,
      executionTimeMs,
      ...results,
      totalPnlRealized: Math.round(results.totalPnlRealized * 100) / 100,
    };
  }

  /**
   * Check if kill switch is rate-limited for a user.
   */
  static isRateLimited(traderId) {
    const lastTime = lastKillSwitch.get(traderId);
    if (!lastTime) return { limited: false };
    const elapsed = Date.now() - lastTime;
    if (elapsed >= 60000) return { limited: false };
    return { limited: true, remainingSeconds: Math.ceil((60000 - elapsed) / 1000) };
  }
}
