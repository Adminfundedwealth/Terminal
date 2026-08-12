/**
 * FLASH RISK PROFILE SERVICE
 *
 * Single source of truth for all Flash Funding risk parameters.
 * The Risk Engine reads this service — NOT risk_rules rows — for Flash accounts.
 *
 * Architecture:
 *   flash_risk_profile table (1 row, id='default')
 *   → FlashRiskProfileService.getProfile()
 *   → FlashRiskEngine (used by validateOrder + postTradeCheck)
 *
 * Other challenge types (Instant, 1-Step, 2-Step) are UNAFFECTED.
 * This service is Flash-only.
 *
 * Profile is cached in-memory for 60 seconds to avoid a DB hit on every
 * order. Admin changes invalidate the cache immediately.
 */

import { supabase } from '../db/client.js';

const PROFILE_ID = 'default';
const CACHE_TTL_MS = 60_000; // 60 seconds

let _cachedProfile = null;
let _cacheExpiry   = 0;

/**
 * The hard-coded fallback used when the DB is unavailable.
 * Matches the INSERT seed in migration 019.
 */
const HARDCODED_DEFAULT = Object.freeze({
  id:                    'default',
  duration_hours:        24,
  timer_start_event:     'first_position',
  per_position_loss_pct: 2.0,
  max_drawdown_pct:      4.0,
  max_open_positions:    50,
  leverage_max:          50,
  allowed_segments:      ['NSE', 'NFO', 'BFO', 'MCX', 'CDS'],
  trading_hours_start:   '09:15',
  trading_hours_end:     '15:30',
  overnight_allowed:     true,
  weekend_allowed:       true,
  holiday_restriction:   false,
  profit_target_pct:     0.0,
  profit_split_pct:      90.0,
  consistency_rule_pct:  15.0,
  payout_threshold_pct:  3.0,
  updated_at:            null,
  updated_by:            null,
});

export class FlashRiskProfileService {
  /**
   * Get the current Flash risk profile.
   * Reads from DB with a 60-second in-memory cache.
   * Falls back to HARDCODED_DEFAULT if DB is unavailable.
   *
   * @returns {object} Flash risk profile
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
        .from('flash_risk_profile')
        .select('*')
        .eq('id', PROFILE_ID)
        .single();

      if (error || !data) {
        console.warn('[FlashRiskProfile] DB read failed — using hardcoded default:', error?.message);
        return HARDCODED_DEFAULT;
      }

      // Normalise allowed_segments — stored as JSONB array in DB
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
      console.warn('[FlashRiskProfile] Exception — using hardcoded default:', err.message);
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
    console.log('[FlashRiskProfile] Cache invalidated');
  }

  /**
   * Update the Flash risk profile from Admin.
   * Persists to DB, records audit trail, invalidates cache.
   *
   * @param {object} updates  - Partial field updates (only allowed fields)
   * @param {string} adminId  - Admin user ID (for audit log)
   * @returns {object} Updated profile
   */
  static async updateProfile(updates, adminId) {
    if (!supabase) throw new Error('Database not configured');

    const ALLOWED_FIELDS = [
      'duration_hours', 'timer_start_event',
      'per_position_loss_pct', 'max_drawdown_pct',
      'max_open_positions', 'leverage_max',
      'allowed_segments',
      'trading_hours_start', 'trading_hours_end',
      'overnight_allowed', 'weekend_allowed', 'holiday_restriction',
      'profit_target_pct', 'profit_split_pct',
      'consistency_rule_pct', 'payout_threshold_pct',
    ];

    // Read current profile for diffing
    const current = await this.getProfile();

    // Filter to only allowed fields
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

    // Persist update
    const { data, error } = await supabase
      .from('flash_risk_profile')
      .update(safeUpdates)
      .eq('id', PROFILE_ID)
      .select()
      .single();

    if (error) throw new Error(`Flash profile update failed: ${error.message}`);

    // Write audit rows — one per changed field
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
        .from('flash_risk_profile_audit')
        .insert(auditRows);
      if (auditErr) {
        // Audit failure is non-fatal — profile was already saved
        console.error('[FlashRiskProfile] Audit log failed:', auditErr.message);
      }
    }

    // Invalidate cache so next risk check gets fresh values
    this.invalidateCache();

    console.log(`[FlashRiskProfile] ✓ Updated by ${adminId}:`, Object.keys(safeUpdates).join(', '));
    return data;
  }

  /**
   * Get audit history for the Flash profile.
   * @param {number} limit
   * @returns {Array}
   */
  static async getAuditLog(limit = 50) {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('flash_risk_profile_audit')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  }

  /**
   * Determine whether a trading_account belongs to a Flash Funding challenge.
   * Reads the joined challenge_accounts.plan field.
   *
   * @param {object} account - trading_accounts row (must have challenge joined)
   * @returns {boolean}
   */
  static isFlashAccount(account) {
    // challenge_accounts.plan is 'flash' for Flash Funding accounts
    const plan = (
      account?.challenge?.plan ||
      account?.plan ||
      ''
    ).toLowerCase().replace(/[-_\s]/g, '');
    return plan === 'flash';
  }

  /**
   * Get or set the first_position_at timestamp for a Flash account.
   * This is the start of the 24-hour timer.
   *
   * @param {string} challengeId - challenge_accounts.id
   * @returns {string|null} ISO timestamp or null if not started
   */
  static async getFirstPositionAt(challengeId) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('challenge_accounts')
      .select('first_position_at')
      .eq('id', challengeId)
      .single();
    if (error || !data) return null;
    return data.first_position_at || null;
  }

  /**
   * Record the first position timestamp for a Flash account.
   * Only sets the value if it is not already set (idempotent).
   *
   * @param {string} challengeId
   * @param {string} [isoTimestamp] - defaults to now
   */
  static async recordFirstPosition(challengeId, isoTimestamp = null) {
    if (!supabase) return;

    // Only set if not already set — never overwrite
    const existing = await this.getFirstPositionAt(challengeId);
    if (existing) {
      // Timer already started — do not change it
      return;
    }

    const ts = isoTimestamp || new Date().toISOString();
    const { error } = await supabase
      .from('challenge_accounts')
      .update({ first_position_at: ts, updated_at: new Date().toISOString() })
      .eq('id', challengeId)
      .is('first_position_at', null); // extra guard: only update if still NULL

    if (error) {
      console.error('[FlashRiskProfile] recordFirstPosition failed:', error.message);
    } else {
      console.log(`[FlashRiskProfile] ✓ Timer started for challenge ${challengeId} at ${ts}`);
    }
  }

  /**
   * Check if a Flash account has expired (24h elapsed since first position).
   *
   * @param {string} challengeId
   * @param {object} [profile] - optionally pass pre-loaded profile to avoid extra fetch
   * @returns {{ expired: boolean, firstPositionAt: string|null, expiresAt: string|null }}
   */
  static async checkExpiry(challengeId, profile = null) {
    const fp = profile || await this.getProfile();
    const firstPositionAt = await this.getFirstPositionAt(challengeId);

    if (!firstPositionAt) {
      // Timer hasn't started — not expired
      return { expired: false, firstPositionAt: null, expiresAt: null };
    }

    const startMs  = new Date(firstPositionAt).getTime();
    const durationMs = fp.duration_hours * 60 * 60 * 1000;
    const expiresAt  = new Date(startMs + durationMs).toISOString();
    const expired    = Date.now() >= startMs + durationMs;

    return { expired, firstPositionAt, expiresAt };
  }
}
