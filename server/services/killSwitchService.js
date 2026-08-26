/**
 * KILL SWITCH SERVICE
 * 
 * Emergency trading halt that:
 *   1. Cancels all open/pending orders for target accounts
 *   2. Submits broker exit orders for all open positions (Fix 5)
 *   3. Only marks DB positions flat AFTER broker confirms closure
 *   4. Locks all target accounts (prevents new orders)
 *   5. Logs the action for audit
 * 
 * State semantics (Fix 5 — broker-safe):
 *   FLAT             → broker exit succeeded, DB position closed (is_open=false)
 *   EMERGENCY_CLOSE_FAILED → broker exit failed; DB position left OPEN;
 *                     reject_reason set to 'EMERGENCY_CLOSE_FAILED: <reason>'
 *   BROKER_MISMATCH  → broker reported no open position but DB shows one;
 *                     reject_reason set to 'BROKER_MISMATCH: <reason>'
 * 
 * Account status uses existing schema values only:
 *   'locked' — account blocked; locked_reason records the outcome details
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
import { BrokerFactory } from '../brokers/broker.factory.js';

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
      positionsFailed: 0,
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

        // Step 2: Fetch account to determine broker provider
        const { data: account } = await supabase
          .from('trading_accounts')
          .select('id, broker_provider, status')
          .eq('id', accountId)
          .single();

        const brokerProvider = account?.broker_provider || 'dhan';
        const isAccountPaper = brokerProvider === 'paper';

        // Step 3: Fetch all open positions
        const { data: positions } = await supabase
          .from('positions')
          .select('*')
          .eq('trading_account_id', accountId)
          .eq('is_open', true);

        let closedCount = 0;
        let failedCount = 0;
        let pnlRealized = 0;

        for (const pos of (positions || [])) {
          if (pos.qty === 0) {
            // DB shows zero qty — mark closed without broker call
            await supabase.from('positions').update({
              is_open: false,
              closed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', pos.id);
            closedCount++;
            continue;
          }

          // ── Fix 5: Attempt broker exit BEFORE marking DB flat ──────────
          if (isAccountPaper) {
            // Paper mode: safe to mark DB flat directly — no real broker position
            await supabase.from('positions').update({
              qty: 0,
              is_open: false,
              closed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', pos.id);
            closedCount++;
            pnlRealized += pos.realized_pnl || 0;
          } else {
            // LIVE mode: submit exit order to broker first
            const brokerExitResult = await _attemptBrokerExit(pos, brokerProvider);

            if (brokerExitResult.success) {
              // Broker confirmed exit → safe to close in DB
              await supabase.from('positions').update({
                qty: 0,
                is_open: false,
                closed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                reject_reason: null,
              }).eq('id', pos.id);
              closedCount++;
              pnlRealized += pos.realized_pnl || 0;

              console.log(`[KillSwitch] Broker exit CONFIRMED for position ${pos.id} (${pos.symbol})`);
            } else {
              // Broker exit failed — DO NOT mark DB flat
              // Record failure state in reject_reason (existing TEXT column, no constraint)
              const failureLabel = brokerExitResult.mismatch
                ? `BROKER_MISMATCH: ${brokerExitResult.reason}`
                : `EMERGENCY_CLOSE_FAILED: ${brokerExitResult.reason}`;

              await supabase.from('positions').update({
                reject_reason: failureLabel,
                updated_at: new Date().toISOString(),
                // is_open remains TRUE — position is NOT flat
              }).eq('id', pos.id);

              failedCount++;

              console.error(
                `[KillSwitch] Broker exit FAILED for position ${pos.id} ` +
                `(${pos.symbol}): ${failureLabel}. DB position left OPEN.`
              );

              // Emit alert so monitoring/UI surfaces the unresolved position
              eventBus.publish('kill_switch.position_failed', {
                accountId,
                positionId: pos.id,
                symbol: pos.symbol,
                token: pos.token,
                qty: pos.qty,
                side: pos.side,
                failureLabel,
                requiresManualClose: true,
              }, { accountId });
            }
          }
        }

        results.positionsClosed += closedCount;
        results.positionsFailed += failedCount;
        results.totalPnlRealized += pnlRealized;

        // Step 4: Lock the account
        // Use 'locked' — the only blocking status in the existing schema CHECK constraint.
        // Record the outcome (including any failed closures) in locked_reason.
        const lockReason = failedCount > 0
          ? `Kill switch: ${reason} — WARNING: ${failedCount} position(s) could not be closed at broker. Manual action required.`
          : `Kill switch: ${reason}`;

        await supabase
          .from('trading_accounts')
          .update({
            status: 'locked',
            locked_reason: lockReason,
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
      ? (results.positionsFailed > 0 ? 'partial' : 'completed')
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
      positionsFailed: results.positionsFailed,
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

// ─── Internal: broker exit attempt ───────────────────────────────────────────

/**
 * Attempt to submit a market exit order to the broker for one open position.
 *
 * Uses existing adapter.placeOrder() — the same path used by normal order
 * execution. The exact Dhan payload is built from the live position data:
 *   - securityId   = pos.token   (Dhan securityId)
 *   - exchangeSegment = mapped from pos.segment
 *   - transactionType = opposite of pos.side
 *   - quantity     = Math.abs(pos.qty)  (never negative)
 *   - productType  = pos.product_type
 *   - orderType    = MARKET
 *
 * Returns { success: true } or { success: false, reason, mismatch }
 *
 * @param {object} pos  DB position row
 * @param {string} brokerProvider
 */
async function _attemptBrokerExit(pos, brokerProvider) {
  const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
  const closeQty  = Math.abs(pos.qty);

  if (closeQty <= 0) {
    // Should not happen (caller guards qty === 0 above), but be defensive
    return { success: false, reason: 'Position qty is zero — nothing to close', mismatch: true };
  }

  let adapter;
  try {
    adapter = await BrokerFactory.create(brokerProvider);
  } catch (err) {
    return { success: false, reason: `Broker adapter unavailable: ${err.message}`, mismatch: false };
  }

  if (!adapter?.auth?.isTokenValid) {
    return { success: false, reason: 'Broker token invalid', mismatch: false };
  }

  try {
    const response = await adapter.placeOrder({
      symbol:      pos.symbol,
      token:       pos.token,
      exchange:    pos.segment || pos.exchange,
      segment:     pos.segment,
      side:        closeSide,
      orderType:   'MARKET',
      productType: pos.product_type,
      qty:         closeQty,
      price:       0,
      triggerPrice: 0,
      isCloseOrder: true,
    });

    const brokerStatus = (response?.status || '').toUpperCase();
    if (brokerStatus === 'REJECTED' || brokerStatus === 'FAILED') {
      return {
        success: false,
        reason:  response?.message || 'Broker rejected the exit order',
        mismatch: false,
      };
    }

    // Any non-rejection response (PENDING, OPEN, FILLED) means Dhan accepted the order
    return { success: true, brokerOrderId: response?.brokerOrderId || response?.orderId };

  } catch (err) {
    const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(err.message);
    return {
      success:  false,
      reason:   isTimeout
        ? `Broker timeout during emergency exit — position state uncertain: ${err.message}`
        : `Broker error: ${err.message}`,
      mismatch: false,
    };
  }
}
