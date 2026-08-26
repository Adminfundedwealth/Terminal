/**
 * POSITION RECONCILIATION SERVICE — Fix 4
 *
 * Compares FundedWealth's DB positions against the live Dhan position snapshot.
 * Emits POSITION_MISMATCH events and blocks further trading on the affected
 * account when a discrepancy is detected.
 *
 * Design constraints (from P3.2 audit):
 *   - Do NOT silently overwrite DB positions.
 *   - Do NOT invent quantities or prices.
 *   - Emit position.mismatch for every discrepancy found.
 *   - Block the account (status = 'locked', locked_reason = 'POSITION_MISMATCH...')
 *     so no new orders can be placed until a human reviews the mismatch.
 *     Uses the existing schema-valid 'locked' status (not a new status value).
 *   - Mismatches are classified:
 *       BROKER_ONLY   — Dhan has an open position, DB has none
 *       DB_ONLY       — DB has an open position, Dhan has none (net qty = 0)
 *       QTY_MISMATCH  — both sides agree on the instrument but disagree on qty
 *       SIDE_MISMATCH — both sides have a position but disagree on direction
 *
 * What reconcile() does NOT do:
 *   - Does NOT close positions automatically.
 *   - Does NOT write new positions to DB.
 *   - Does NOT modify existing DB position rows.
 *   - Does NOT call any broker order placement.
 *
 * Integration:
 *   Call reconcile(accountId, dhanAdapter) from a scheduled job or from the
 *   kill-switch / risk engine as a pre-trade safety check.
 *   Result contains a list of mismatches and whether the account was blocked.
 */

import { supabase }  from '../db/client.js';
import { eventBus }  from '../events/index.js';
import { PositionRepository } from '../repositories/position.repository.js';

const positionRepo = new PositionRepository();

// Tolerance: qty differences ≤ this are ignored (handles rounding / lot splits)
const QTY_TOLERANCE = 0;

export class PositionReconciliationService {
  /**
   * Reconcile Dhan positions against DB for a single account.
   *
   * @param {string}  accountId    FundedWealth trading_account_id
   * @param {object}  dhanAdapter  Live DhanAdapter instance (auth must be valid)
   * @returns {Promise<ReconcileResult>}
   */
  static async reconcile(accountId, dhanAdapter) {
    if (!supabase) throw new Error('[Reconcile] Database not configured');
    if (!dhanAdapter?.auth?.isTokenValid) {
      throw new Error('[Reconcile] Dhan adapter token invalid — cannot reconcile');
    }

    // ── 1. Fetch both sides ──────────────────────────────────────────────────
    const [dbPositions, brokerPositions] = await Promise.all([
      positionRepo.findOpenByAccountId(accountId),
      dhanAdapter.getPositions(),
    ]);

    // ── 2. Build lookup maps ─────────────────────────────────────────────────
    // Key: `${token}:${productType}` (most specific stable key available)
    const dbMap     = new Map();
    const brokerMap = new Map();

    for (const pos of dbPositions) {
      // Only consider positions that are genuinely open (qty ≠ 0)
      if (pos.qty === 0) continue;
      const key = `${pos.token}:${(pos.product_type || '').toUpperCase()}`;
      dbMap.set(key, pos);
    }

    for (const pos of brokerPositions) {
      // Dhan reports net qty — skip truly flat broker positions
      if (pos.qty === 0) continue;
      const key = `${pos.token}:${(pos.productType || '').toUpperCase()}`;
      brokerMap.set(key, pos);
    }

    // ── 3. Compare ───────────────────────────────────────────────────────────
    const mismatches = [];

    // Check all DB positions against broker
    for (const [key, dbPos] of dbMap) {
      const brokerPos = brokerMap.get(key);

      if (!brokerPos) {
        // DB says open — Dhan says flat
        mismatches.push({
          type:      'DB_ONLY',
          token:     dbPos.token,
          symbol:    dbPos.symbol,
          productType: dbPos.product_type,
          dbQty:     dbPos.qty,
          brokerQty: 0,
          description: `DB has open position (qty=${dbPos.qty}) but Dhan reports flat`,
        });
        continue;
      }

      // Both sides have a position — check direction
      const dbSide     = _normaliseSide(dbPos.side);
      const brokerSide = _normaliseSide(brokerPos.qty > 0 ? 'LONG' : 'SHORT');

      if (dbSide !== brokerSide) {
        mismatches.push({
          type:        'SIDE_MISMATCH',
          token:       dbPos.token,
          symbol:      dbPos.symbol,
          productType: dbPos.product_type,
          dbQty:       dbPos.qty,
          brokerQty:   brokerPos.qty,
          dbSide,
          brokerSide,
          description: `Side mismatch: DB=${dbSide} Dhan=${brokerSide}`,
        });
        continue;
      }

      // Check quantity
      const dbAbsQty     = Math.abs(dbPos.qty);
      const brokerAbsQty = Math.abs(brokerPos.qty);
      const delta        = Math.abs(dbAbsQty - brokerAbsQty);

      if (delta > QTY_TOLERANCE) {
        mismatches.push({
          type:        'QTY_MISMATCH',
          token:       dbPos.token,
          symbol:      dbPos.symbol,
          productType: dbPos.product_type,
          dbQty:       dbPos.qty,
          brokerQty:   brokerPos.qty,
          delta,
          description: `Qty mismatch: DB=${dbAbsQty} Dhan=${brokerAbsQty} (delta=${delta})`,
        });
      }
    }

    // Check broker-only positions (Dhan has them but DB doesn't)
    for (const [key, brokerPos] of brokerMap) {
      if (!dbMap.has(key)) {
        mismatches.push({
          type:        'BROKER_ONLY',
          token:       brokerPos.token,
          symbol:      brokerPos.symbol,
          productType: brokerPos.productType,
          dbQty:       0,
          brokerQty:   brokerPos.qty,
          description: `Dhan has open position (qty=${brokerPos.qty}) but DB has none`,
        });
      }
    }

    // ── 4. Act on mismatches ─────────────────────────────────────────────────
    const hasMismatch   = mismatches.length > 0;
    let accountBlocked  = false;

    if (hasMismatch) {
      console.error(
        `[Reconcile] ${mismatches.length} mismatch(es) found for account ${accountId}:`,
        mismatches.map(m => m.description).join(' | ')
      );

      // Publish one event per mismatch so downstream consumers can react
      for (const mismatch of mismatches) {
        eventBus.publish('position.mismatch', {
          accountId,
          ...mismatch,
          detectedAt: new Date().toISOString(),
        }, { accountId });
      }

      // Block the account from placing new orders
      accountBlocked = await _blockAccount(accountId, mismatches);
    } else {
      console.log(`[Reconcile] Account ${accountId}: positions match (${dbMap.size} open)`);
    }

    return {
      accountId,
      checkedAt:      new Date().toISOString(),
      dbPositions:    dbMap.size,
      brokerPositions: brokerMap.size,
      mismatches,
      hasMismatch,
      accountBlocked,
    };
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Normalise position side to 'LONG' | 'SHORT'.
 * DB stores 'BUY'/'SELL'/'LONG'/'SHORT'; broker qty sign also used.
 */
function _normaliseSide(raw) {
  const s = (raw || '').toUpperCase();
  if (s === 'BUY'  || s === 'LONG')  return 'LONG';
  if (s === 'SELL' || s === 'SHORT') return 'SHORT';
  return s;
}

/**
 * Lock a trading account due to position mismatch, preventing new orders.
 * Uses 'locked' status — the existing schema-valid blocking status.
 * The mismatch detail is recorded in locked_reason (existing TEXT column).
 * Best-effort: DB write failure is logged but does NOT throw.
 *
 * @param {string}   accountId
 * @param {object[]} mismatches
 * @returns {boolean} true if the account was successfully locked
 */
async function _blockAccount(accountId, mismatches) {
  if (!supabase) return false;

  const summary = mismatches.map(m => `${m.type}:${m.symbol}(DB=${m.dbQty},Dhan=${m.brokerQty})`).join('; ');

  try {
    const { error } = await supabase
      .from('trading_accounts')
      .update({
        // Use 'locked' — the only schema-valid blocking status.
        // 'mismatch_hold' is NOT in the trading_accounts.status CHECK constraint.
        status:        'locked',
        locked_reason: `POSITION_MISMATCH — ${summary}`,
        locked_at:     new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      })
      .eq('id', accountId)
      // Only lock accounts that are currently active — don't overwrite an
      // already-locked or already-suspended account's locked_reason.
      .in('status', ['active']);

    if (error) {
      console.error(`[Reconcile] Failed to lock account ${accountId}:`, error.message);
      return false;
    }

    console.warn(`[Reconcile] Account ${accountId} locked (POSITION_MISMATCH): ${summary}`);
    eventBus.publish('account.status_changed', {
      accountId,
      status:    'locked',
      reason:    `POSITION_MISMATCH — ${summary}`,
      changedAt: new Date().toISOString(),
    }, { accountId });

    return true;
  } catch (err) {
    console.error(`[Reconcile] Unexpected error locking account ${accountId}:`, err.message);
    return false;
  }
}
