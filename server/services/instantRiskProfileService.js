/**
 * INSTANT RISK PROFILE SERVICE
 *
 * Single source of truth for all Instant Funding risk parameters.
 * The Risk Engine reads this service for Instant accounts.
 *
 * Architecture:
 *   instant_risk_profile table (1 row, id='default')
 *   → InstantRiskProfileService.getProfile()
 *   → RiskEngine (validateOrder + postTradeCheck) for Instant accounts
 *
 * Flash, 1-Step, and 2-Step are COMPLETELY UNAFFECTED.
 * This service is Instant-only.
 *
 * Profile is cached in-memory for 60 seconds.
 * Admin changes invalidate the cache immediately.
 */

import { supabase } from '../db/client.js';

const PROFILE_ID    = 'default';
const CACHE_TTL_MS  = 60_000;

let _cachedProfile = null;
let _cacheExpiry   = 0;

/**
 * Hard-coded fallback — matches the INSERT seed in migration 020.
 * Used when DB is unavailable. Values are the canonical Instant defaults.
 */
const HARDCODED_DEFAULT = Object.freeze({
  id:                       'default',
  daily_loss_pct:           3.0,
  max_drawdown_pct:         5.0,
  max_open_positions:       20,
  leverage_max:             50,
  max_position_size_pct:    70.0,
  allowed_segments:         ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
  trading_hours_start:      '09:15',
  trading_hours_end:        '15:15',
  overnight_allowed:        false,
  overnight_cutoff:         '15:15',
  weekend_allowed:          false,
  holiday_restriction:      true,
  profit_target_pct:        0.0,
  profit_split_initial_pct: 70.0,
  profit_split_scaled_pct:  80.0,
  profit_split_scale_days:  30,
  payout_threshold_pct:     5.0,
  min_trading_days:         7,
  consistency_rule_pct:     15.0,
  daily_profit_cap_pct:     4.0,
  risk_per_idea_pct:        1.0,
  risk_per_idea_window_min: 10,
  inactivity_close_days:    60,
  updated_at:               null,
  updated_by:               null,
});

export class InstantRiskProfileService {
  /**
   * Get the current Instant risk profile.
   * 60-second cache. Falls back to HARDCODED_DEFAULT if DB is unavailable.
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
        .from('instant_risk_profile')
        .select('*')
        .eq('id', PROFILE_ID)
        .single();

      if (error || !data) {
        console.warn('[InstantRiskProfile] DB read failed — using hardcoded default:', error?.message);
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
      console.warn('[InstantRiskProfile] Exception — using hardcoded default:', err.message);
      return HARDCODED_DEFAULT;
    }
  }

  /**
   * Invalidate the in-memory cache.
   * Called after an admin updates the profile.
   */
  static invalidateCache() {
    _cachedProfile = null;
    _cacheExpiry   = 0;
    console.log('[InstantRiskProfile] Cache invalidated');
  }

  /**
   * Update the Instant risk profile from Admin.
   * Persists to DB, records audit trail, invalidates cache.
   *
   * @param {object} updates - Partial field updates
   * @param {string} adminId - Admin user ID for audit log
   * @returns {object} Updated profile
   */
  static async updateProfile(updates, adminId) {
    if (!supabase) throw new Error('Database not configured');

    const ALLOWED_FIELDS = [
      'daily_loss_pct', 'max_drawdown_pct',
      'max_open_positions', 'leverage_max', 'max_position_size_pct',
      'allowed_segments',
      'trading_hours_start', 'trading_hours_end',
      'overnight_allowed', 'overnight_cutoff',
      'weekend_allowed', 'holiday_restriction',
      'profit_target_pct',
      'profit_split_initial_pct', 'profit_split_scaled_pct', 'profit_split_scale_days',
      'payout_threshold_pct', 'min_trading_days',
      'consistency_rule_pct', 'daily_profit_cap_pct',
      'risk_per_idea_pct', 'risk_per_idea_window_min',
      'inactivity_close_days',
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
      .from('instant_risk_profile')
      .update(safeUpdates)
      .eq('id', PROFILE_ID)
      .select()
      .single();

    if (error) throw new Error(`Instant profile update failed: ${error.message}`);

    // Audit: one row per changed field
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
        .from('instant_risk_profile_audit')
        .insert(auditRows);
      if (auditErr) {
        console.error('[InstantRiskProfile] Audit log failed:', auditErr.message);
      }
    }

    this.invalidateCache();
    console.log(`[InstantRiskProfile] ✓ Updated by ${adminId}:`, Object.keys(safeUpdates).join(', '));
    return data;
  }

  /**
   * Get audit history.
   */
  static async getAuditLog(limit = 50) {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('instant_risk_profile_audit')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  }

  /**
   * Determine whether a trading_account belongs to an Instant Funding challenge.
   */
  static isInstantAccount(account) {
    const plan = (
      account?.challenge?.plan ||
      account?.plan ||
      ''
    ).toLowerCase().replace(/[-_\s]/g, '');
    return plan === 'instant';
  }

  /**
   * Compute the effective profit split % for an Instant account based on
   * how many trading days have elapsed since challenge start.
   *
   * Progression: starts at profit_split_initial_pct (70%),
   * scales to profit_split_scaled_pct (80%) after profit_split_scale_days (30 days).
   *
   * @param {object} profile - loaded Instant risk profile
   * @param {string|null} startedAt - challenge_accounts.started_at ISO string
   * @returns {number} effective split percentage (e.g. 70 or 80)
   */
  static getEffectiveSplitPct(profile, startedAt) {
    if (!startedAt) return profile.profit_split_initial_pct;
    const daysElapsed = Math.floor(
      (Date.now() - new Date(startedAt).getTime()) / (24 * 60 * 60 * 1000)
    );
    return daysElapsed >= (profile.profit_split_scale_days || 30)
      ? profile.profit_split_scaled_pct
      : profile.profit_split_initial_pct;
  }
}
