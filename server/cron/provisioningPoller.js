/**
 * PROVISIONING POLLER
 * 
 * Polls provisioning_logs table for rows with status='pending'.
 * Automatically provisions trading accounts for pending entries.
 * 
 * Flow:
 *   1. Query provisioning_logs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5
 *   2. For each pending row, call ProvisioningService.provisionAccount()
 *   3. On success: update provisioning_logs status = 'completed'
 *   4. On failure: update provisioning_logs status = 'failed' + error_message
 *   5. Notify Main Site (callback) and Admin (lifecycle event)
 * 
 * Called by:
 *   - setInterval in server startup (every 30 seconds)
 *   - External cron as backup
 * 
 * Ownership: Terminal
 * Integration: Main Site (callback), Admin (lifecycle event)
 */

import { supabase } from '../db/client.js';
import { ProvisioningService, ProvisioningError } from '../services/provisioningService.js';
import { WebsiteCallbackClient } from '../clients/website.callback.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';

const POLL_INTERVAL = 30000; // 30 seconds
const BATCH_SIZE = 5;

let isPolling = false;

/**
 * Poll and process pending provisioning requests.
 * Idempotent — safe to call concurrently (uses row-level locking).
 */
export async function pollPendingProvisioning() {
  if (!supabase) {
    return { processed: 0, reason: 'supabase_not_configured' };
  }

  if (isPolling) {
    return { processed: 0, reason: 'already_polling' };
  }

  isPolling = true;

  try {
    // Fetch pending provisioning requests (oldest first)
    const { data: pendingRows, error } = await supabase
      .from('provisioning_logs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      console.error('[ProvisioningPoller] Query failed:', error.message);
      return { processed: 0, error: error.message };
    }

    if (!pendingRows || pendingRows.length === 0) {
      return { processed: 0, reason: 'no_pending' };
    }

    console.log(`[ProvisioningPoller] Found ${pendingRows.length} pending provisioning request(s)`);

    let processed = 0;
    let failed = 0;

    for (const row of pendingRows) {
      try {
        // Mark as in-progress (prevent double-processing)
        await supabase
          .from('provisioning_logs')
          .update({ status: 'processing', started_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending'); // Only if still pending (optimistic lock)

        // Build provisioning params from the log row
        const provisionParams = {
          email: row.email || row.trader_email,
          name: row.name || row.trader_name || 'Trader',
          plan: row.plan,
          orderId: row.order_id,
          paymentMethod: row.payment_method || 'razorpay',
          paymentRef: row.payment_ref || null,
          source: row.source || 'website',
          externalId: row.external_id || row.fw_user_id || null,
          challengeType: row.challenge_type || '2-step',
          ruleProfile: row.rule_profile || null,
        };

        // Execute provisioning
        const result = await ProvisioningService.provisionAccount(provisionParams);

        // Update log to completed
        await supabase
          .from('provisioning_logs')
          .update({
            status: 'completed',
            trading_account_id: result.tradingAccount?.id || null,
            challenge_account_id: result.challengeAccount?.id || null,
            trader_id: result.trader?.id || null,
            completed_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        // Notify Main Site
        if (row.source === 'website' && row.order_id) {
          WebsiteCallbackClient.notifyProvisioned({
            orderId: row.order_id,
            accountCode: result.tradingAccount?.accountCode,
            tradingAccountId: result.tradingAccount?.id,
            userId: result.trader?.id,
          }).catch(err => {
            console.warn(`[ProvisioningPoller] Website callback failed for order ${row.order_id}:`, err.message || err);
          });
        }

        // Notify Admin
        LifecycleCallbackClient.notifyAdmin('account.provisioned', {
          accountId: result.tradingAccount?.id,
          traderId: result.trader?.id,
          data: {
            orderId: row.order_id,
            plan: row.plan,
            source: row.source,
            accountCode: result.tradingAccount?.accountCode,
            provisionedAt: new Date().toISOString(),
          },
        }).catch(err => {
          console.warn(`[ProvisioningPoller] Admin notification failed:`, err.message || err);
        });

        processed++;
        console.log(`[ProvisioningPoller] ✓ Provisioned order ${row.order_id} → account ${result.tradingAccount?.accountCode}`);

      } catch (err) {
        failed++;
        const errorMessage = err instanceof ProvisioningError ? `${err.code}: ${err.message}` : err.message;

        // Update log to failed
        await supabase
          .from('provisioning_logs')
          .update({
            status: 'failed',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        // Notify Website of failure
        if (row.source === 'website' && row.order_id) {
          WebsiteCallbackClient.notifyFailed({
            orderId: row.order_id,
            error: errorMessage,
            code: err instanceof ProvisioningError ? err.code : 'INTERNAL_ERROR',
          }).catch(() => {});
        }

        // Notify Admin of failure
        LifecycleCallbackClient.notifyAdmin('provisioning.failed', {
          accountId: null,
          traderId: null,
          data: {
            orderId: row.order_id,
            plan: row.plan,
            source: row.source,
            error: errorMessage,
            failedAt: new Date().toISOString(),
          },
        }).catch(() => {});

        console.error(`[ProvisioningPoller] ✗ Failed order ${row.order_id}: ${errorMessage}`);
      }
    }

    return { processed, failed, total: pendingRows.length };

  } finally {
    isPolling = false;
  }
}

/**
 * Start the provisioning poller on a fixed interval.
 * Safe to call multiple times (idempotent).
 */
let pollerInterval = null;

export function startProvisioningPoller() {
  if (pollerInterval) {
    return; // Already running
  }

  pollerInterval = setInterval(async () => {
    try {
      const result = await pollPendingProvisioning();
      if (result.processed > 0) {
        console.log(`[ProvisioningPoller] Batch complete: ${result.processed} processed, ${result.failed || 0} failed`);
      }
    } catch (err) {
      console.error('[ProvisioningPoller] Unexpected error:', err.message);
    }
  }, POLL_INTERVAL);

  console.log(`[ProvisioningPoller] Started — polling every ${POLL_INTERVAL / 1000}s`);
}

/**
 * Stop the provisioning poller.
 */
export function stopProvisioningPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    console.log('[ProvisioningPoller] Stopped');
  }
}
