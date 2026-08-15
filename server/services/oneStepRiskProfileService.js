/**
 * ONE-STEP RISK PROFILE SERVICE
 *
 * Single source of truth for all 1-Step Funding risk parameters.
 * The 1-Step Risk Engine reads this service for every 1-Step account.
 *
 * Architecture:
 *   onestep_risk_profile table (1 row, id='default')
 *   → OneStepRiskProfileService.getProfile()
 *   → OneStepRiskEngine (validateOrder + postTradeCheck)
 *
 * Flash, Instant, and 2-Step are COMPLETELY UNAFFECTED.
 * This service is 1-Step ONLY.
 *
 * Profile is cached in-memory for 60 seconds.
 * Admin changes invalidate the cache immediately.
 */

import { supabase } from '../db/client.js';

const PROFILE_ID   = 'default';
const CACHE_TTL_MS = 60_000; // 60 seconds

let _cachedProfile = null;
let _cacheExpiry   = 0;

/**
 * Hard-coded fallback — matches the INSERT seed in migration 021.
 * Used when DB is unavailable. Values are the canonical 1-Step defaults.
 */
const HARDCODED_DEFAULT = Object.freeze({
  id:                              'default',
  // Shared (eval + funded)
  daily_loss_pct:                  3.0,
  max_drawdown_pct:                6.0,
  max_open_positions:              20,
  leverage_max:                    30,
  max_position_size_pct:           70.0,
  daily_profit_cap_pct:            4.0,
  daily_profit_cap_cooldown_hours: 8.0,
  max_risk_per_trade_pct:          1.5,
  consistency_rule_pct:            40.0,
  // Markets
  allowed_segments:                ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'],
  trading_hours_start:             '09:15',
  trading_hours_end:               '15:30',
  overnight_allowed:               true,
  weekend_allowed:                 false,
  holiday_restriction:             true,
  // Evaluation
  profit_target_pct:               10.0,
  min_trading_days_eval:           5,
  time_limit_days:                 0,       // 0 = unlimited
  // Funded
  min_trading_days_funded:         3,
  payout_threshold_pct:            3.0,
  profit_split_initial_pct:        80.0,
  profit_split_scaled_pct:         90.0,
  // Meta
  updated_at:                      null,
  updated_by:                      null,
});

export class OneStepRiskProfileService {
  /**
   * Get the current 1-Step risk profile.
   * 60-second cache. Falls back to HARDCODED_DEFAULT if DB is unavailable.
   *
   * @returns {object} 1-Step risk profile
   */
  static async getProfile() {
    const now = Date.now();
    if (_cachedProfile && now < _cacheExpiry) {
      return _cachedProfile;
    }

    if (!supabase) {
      return HARDCODED_DEFAULT;
    }

    try {
      const { data, error } = await supabase
        .from('onestep_risk_profile')
        .select('*')
        .eq('id', PROFILE_ID)
        .single();

      if (error || !data) {
        console.warn('[OneStepRiskProfile] DB read failed — using hardcoded default:', error?.message);
        return HARDCODED_DEFAULT;
      }

      const profile = {
        ...data,
        allowed_segments: Array.isArray(data.allowed_segments)
          ? data.allowed_segments
          : (typeof data.allowed_segments === 'string'
              ? JSON.parse(data.allowed_segments)
              : HARDCODED_DEFAULT.allowed_segments),
      };

      _cachedProfile = Object.freeze(profile);
      _cacheExpiry   = now + CACHE_TTL_MS;
      return _cachedProfile;
    } catch (err) {
      console.warn('[OneStepRiskProfile] Exception — using hardcoded default:', err.message);
      return HARDCODED_DEFAULT;
    }
  }

  /**
   * Invalidate the in-memory cache immediately.
   * Called after an admin updates the profile.
   */
  static invalidateCache() {
    _cachedProfile = null;
    _cacheExpiry   = 0;
    console.log('[OneStepRiskProfile] Cache invalidated');
  }

  /**
   * Update the 1-Step risk profile from Admin.
   * Persists to DB, records audit trail, invalidates cache.
   *
   * @param {object} updates  - Partial field updates (only allowed fields)
   * @param {string} adminId  - Admin user ID (for audit log)
   * @returns {object} Updated profile
   */
  static async updateProfile(updates, adminId) {
    if (!supabase) throw new Error('Database not configured');

    const ALLOWED_FIELDS = [
      'daily_loss_pct', 'max_drawdown_pct',
      'max_open_positions', 'leverage_max', 'max_position_size_pct',
      'daily_profit_cap_pct', 'daily_profit_cap_cooldown_hours',
      'max_risk_per_trade_pct', 'consistency_rule_pct',
      'allowed_segments',
      'trading_hours_start', 'trading_hours_end',
      'overnight_allowed', 'weekend_allowed', 'holiday_restriction',
      'profit_target_pct', 'min_trading_days_eval', 'time_limit_days',
      'min_trading_days_funded', 'payout_threshold_pct',
      'profit_split_initial_pct', 'profit_split_scaled_pct',
    ];

    const current = await this.getProfile();

    const safeUpdates = {};
    for (const field of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        safeUpdates[field] = updates[field];
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    safeUpdates.updated_at = new Date().toISOString();
    safeUpdates.updated_by = adminId;

    const { data, error } = await supabase
      .from('onestep_risk_profile')
      .update(safeUpdates)
      .eq('id', PROFILE_ID)
      .select()
      .single();

    if (error) throw new Error(`1-Step profile update failed: ${error.message}`);

    // Write audit rows — one row per changed field
    const auditRows = [];
    for (const [field, newVal] of Object.entries(safeUpdates)) {
      if (field === 'updated_at' || field === 'updated_by') continue;
      const oldVal = current[field] !== undefined ? current[field] : null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        auditRows.push({
          rule_name:  field,
          old_value:  JSON.stringify(oldVal) !== 'null' ? { value: oldVal } : null,
          new_value:  { value: newVal },
          changed_by: adminId,
          changed_at: safeUpdates.updated_at,
        });
      }
    }

    if (auditRows.length > 0) {
      const { error: auditErr } = await supabase
        .from('onestep_risk_profile_audit')
        .insert(auditRows);
      if (auditErr) {
        console.error('[OneStepRiskProfile] Audit log failed:', auditErr.message);
      }
    }

    this.invalidateCache();
    console.log(`[OneStepRiskProfile] ✓ Updated by ${adminId}:`, Object.keys(safeUpdates).join(', '));
    return data;
  }

  /**
   * Get audit history for the 1-Step profile.
   * @param {number} limit
   * @returns {Array}
   */
  static async getAuditLog(limit = 50) {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('onestep_risk_profile_audit')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  }

  /**
   * Determine whether a trading account belongs to a 1-Step challenge.
   * Reads challenge_accounts.plan.
   *
   * @param {object} account - trading_accounts row (with challenge joined, or with plan field)
   * @returns {boolean}
   */
  static isOneStepAccount(account) {
    const plan = (
      account?.challenge?.plan ||
      account?.plan ||
      ''
    ).toLowerCase().replace(/[-_\s]/g, '');
    return plan === '1step';
  }

  /**
   * Determine whether this 1-Step account is in the funded phase.
   * @param {object} account - trading_accounts row with challenge joined
   * @returns {boolean}
   */
  static isFundedPhase(account) {
    const type  = (account?.challenge?.type  || '').toLowerCase();
    const phase = (account?.challenge?.phase || '').toLowerCase();
    return type === 'funded' || phase === 'funded';
  }

  /**
   * Get the effective profit split % for a 1-Step funded account.
   *
   * Logic:
   *   - Starts at profit_split_initial_pct (80%)
   *   - Upgrades to profit_split_scaled_pct (90%) once the trader has
   *     made at least one approved payout (i.e. payout_threshold was met once).
   *
   * @param {object} profile   - loaded 1-Step risk profile
   * @param {boolean} hasMetPayoutThreshold - true once first payout was approved
   * @returns {number} effective split percentage (e.g. 80 or 90)
   */
  static getEffectiveSplitPct(profile, hasMetPayoutThreshold) {
    if (hasMetPayoutThreshold) {
      return profile.profit_split_scaled_pct ?? 90.0;
    }
    return profile.profit_split_initial_pct ?? 80.0;
  }

  /**
   * Check whether a 1-Step account has already satisfied the payout threshold
   * at least once (i.e. has at least one approved or completed payout).
   *
   * @param {string} accountId
   * @returns {Promise<boolean>}
   */
  static async hasMetPayoutThreshold(accountId) {
    if (!supabase) return false;
    const { count, error } = await supabase
      .from('payouts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .in('status', ['approved', 'completed']);
    if (error) return false;
    return (count || 0) > 0;
  }
}
