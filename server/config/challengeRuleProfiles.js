/**
 * CHALLENGE RULE PROFILES — Single Source of Truth Registry
 * 
 * ═══════════════════════════════════════════════════════════════
 * IMPORTANT: These values are LOADED FROM THE MAIN SITE at provisioning time.
 * This file is ONLY the schema definition and fallback structure.
 * 
 * The actual rule values are passed IN the provisioning request body
 * from the Main Site. They are then stored in the risk_rules table
 * per trading_account_id.
 * 
 * The Risk Engine NEVER reads from this file at trade time.
 * The Risk Engine ALWAYS reads from the risk_rules table.
 * ═══════════════════════════════════════════════════════════════
 * 
 * Challenge Types on Main Site:
 *   - Flash
 *   - Instant
 *   - 1-Step
 *   - 2-Step (Phase 1 + Phase 2)
 * 
 * Account Sizes:
 *   - 10K (₹10,00,000)
 *   - 25K (₹25,00,000)
 *   - 50K (₹50,00,000)
 *   - 1L  (₹1,00,00,000)
 * 
 * Rule Types Supported:
 *   - daily_loss_limit      (% or absolute — max loss per day)
 *   - max_drawdown          (% or absolute — max drawdown from peak/initial)
 *   - profit_target         (% or absolute — target to pass challenge)
 *   - min_trading_days      (count — minimum active trading days)
 *   - max_calendar_days     (count — time limit for challenge)
 *   - consistency_rule      (% — no single day > X% of total profit)
 *   - max_risk_per_trade    (% — max capital risk per single trade)
 *   - max_positions         (count — max concurrent open positions)
 *   - max_lot_size          (per-segment lot limits)
 *   - leverage_limit        (multiplier — max allowed leverage)
 *   - allowed_segments      (array — which exchanges can trade)
 *   - trading_hours         (start/end — allowed trading window)
 *   - no_overnight          (boolean + cutoff time)
 *   - news_blackout         (time windows)
 *   - max_daily_trades      (count — max trades per day)
 *   - profit_split          (% — profit split for funded accounts)
 *   - drawdown_type         (trailing | static | equity-based)
 */

/**
 * All supported rule types.
 * The Risk Engine checks for each of these in the risk_rules table.
 */
export const RULE_TYPES = [
  'daily_loss_limit',
  'max_drawdown',
  'profit_target',
  'min_trading_days',
  'max_calendar_days',
  'consistency_rule',
  'max_risk_per_trade',
  'max_positions',
  'max_lot_size',
  'max_position_size',
  'leverage_limit',
  'allowed_segments',
  'trading_hours',
  'no_overnight',
  'news_blackout',
  'max_daily_trades',
  'profit_split',
  'drawdown_type',
  'daily_profit_cap',
  'risk_per_trade_idea',
  'payout_threshold',
  'scaling',
  'inactivity_close',
  // Flash-specific rule types
  'per_position_loss',
  'flash_duration',
  'weekend_allowed',
  'holiday_restriction',
];

/**
 * Validate a rule profile received from Main Site provisioning.
 * Ensures all required fields are present and values are sane.
 * 
 * @param {object} profile - The rule profile from Main Site
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRuleProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: ['Profile must be a non-null object'] };
  }

  // Required fields
  if (!profile.challengeType) errors.push('Missing challengeType');
  if (!profile.plan) errors.push('Missing plan');
  if (!profile.initialBalance || profile.initialBalance <= 0) errors.push('Invalid initialBalance');
  if (!profile.rules || typeof profile.rules !== 'object') errors.push('Missing or invalid rules object');

  // Validate individual rules if present
  if (profile.rules) {
    if (profile.rules.daily_loss_limit !== undefined) {
      const dl = profile.rules.daily_loss_limit;
      if (!dl.percent && !dl.amount) errors.push('daily_loss_limit must have percent or amount');
      if (dl.percent && (dl.percent <= 0 || dl.percent > 100)) errors.push('daily_loss_limit.percent must be 0-100');
    }
    if (profile.rules.max_drawdown !== undefined) {
      const md = profile.rules.max_drawdown;
      if (!md.percent && !md.amount) errors.push('max_drawdown must have percent or amount');
    }
    if (profile.rules.profit_target !== undefined) {
      const pt = profile.rules.profit_target;
      if (!pt.percent && !pt.amount) errors.push('profit_target must have percent or amount');
    }
    if (profile.rules.consistency_rule !== undefined) {
      const cr = profile.rules.consistency_rule;
      if (!cr.maxDayProfitPercent) errors.push('consistency_rule must have maxDayProfitPercent');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Convert a Main Site rule profile into risk_rules table rows.
 * Called during provisioning to persist rules per trading_account_id.
 * 
 * @param {string} tradingAccountId - The trading account UUID
 * @param {object} profile - Validated rule profile from Main Site
 * @returns {Array} Array of { trading_account_id, rule_type, value, is_active } rows
 */
export function profileToRuleRows(tradingAccountId, profile) {
  const rows = [];
  const rules = profile.rules || {};

  for (const [ruleType, ruleValue] of Object.entries(rules)) {
    if (RULE_TYPES.includes(ruleType) && ruleValue !== null && ruleValue !== undefined) {
      rows.push({
        trading_account_id: tradingAccountId,
        rule_type: ruleType,
        value: typeof ruleValue === 'object' ? ruleValue : { value: ruleValue },
        is_active: true,
      });
    }
  }

  return rows;
}

/**
 * FLASH FUNDING — canonical rule profile.
 * Called by provisioningService when planType === 'flash' AND no ruleProfile
 * is provided by the Main Site.
 *
 * NOTE: The Flash Risk Engine reads live values from the flash_risk_profile
 * DB table at runtime (via FlashRiskProfileService). These seeded risk_rules
 * rows are kept for audit/history but the Flash Risk Engine does NOT use them
 * for enforcement — it uses the centralized profile exclusively.
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function getFlashFundingRuleProfile(balance) {
  return {
    challengeType: 'flash',
    plan: 'flash',
    phase: 'funded',
    initialBalance: balance,
    rules: {
      // ── Core risk limits (Flash Risk Engine reads these from flash_risk_profile table) ──
      per_position_loss:  { percent: 2,   amount: balance * 0.02 },
      max_drawdown:       { percent: 4,   amount: balance * 0.04, type: 'static' },
      profit_target:      { percent: 0,   amount: 0 },             // none

      // ── Duration ─────────────────────────────────────────────────────────
      flash_duration:     { hours: 24, timer_start_event: 'first_position' },

      // ── Position / leverage ───────────────────────────────────────────────
      max_positions:      { count: 50 },
      leverage_limit:     { maxMultiplier: 50 },

      // ── Session rules ─────────────────────────────────────────────────────
      allowed_segments:   { segments: ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'] },
      trading_hours:      { start: '09:15', end: '15:30' },
      no_overnight:       { allowed: true },                        // overnight ALLOWED
      weekend_allowed:    { allowed: true },                        // weekend ALLOWED
      holiday_restriction:{ enabled: false },                       // no holiday block

      // ── Payout ────────────────────────────────────────────────────────────
      profit_split:       { percent: 90 },
      payout_threshold:   { percent: 3,   amount: balance * 0.03 },
      consistency_rule:   { maxDayProfitPercent: 15 },
    },
  };
}

/**
 * INSTANT FUNDING — canonical rule profile.
 * Called by api-server provisioning-service when planType === 'instant'.
 * Pass this as the ruleProfile body to the terminal's /provisioning/provision.
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function getInstantFundingRuleProfile(balance) {
  return {
    challengeType: 'instant',
    plan: 'instant',
    phase: 'funded',
    initialBalance: balance,
    rules: {
      // ── Core risk limits ─────────────────────────────────────────────────
      daily_loss_limit:   { percent: 3,  amount: balance * 0.03 },
      max_drawdown:       { percent: 5,  amount: balance * 0.05, type: 'static' },
      profit_target:      { percent: 0,  amount: 0 },             // none — instant funded

      // ── Payout conditions ────────────────────────────────────────────────
      min_trading_days:   { count: 7 },
      payout_threshold:   { percent: 5,  amount: balance * 0.05 },
      consistency_rule:   { maxDayProfitPercent: 15 },             // best trade ≤ 15% of total profit

      // ── Daily profit cap (kill-switch) ───────────────────────────────────
      daily_profit_cap:   { percent: 4,  amount: balance * 0.04 },

      // ── Per-trade-idea risk limit ────────────────────────────────────────
      risk_per_trade_idea: {
        percent: 1,
        amount: balance * 0.01,
        sameDirectionWindowMinutes: 10,
      },

      // ── Position / lot limits ────────────────────────────────────────────
      max_positions:      { count: 20 },
      max_lot_size: {
        nfo_nifty:   Math.round(balance / 50000)  * 2,   // ~2 lots per ₹1L
        nfo_banknifty: Math.round(balance / 100000),      // ~1 lot per ₹1L
        nfo_finnifty: Math.round(balance / 100000),
        nfo_stock_fut: Math.max(1, Math.round(balance / 100000)),
        nfo_index_opt: Math.round(balance / 10000) * 5,  // ~5 lots per ₹1L (options)
        nfo_stock_opt: Math.round(balance / 50000) * 2,
        cds:           Math.round(balance / 20000) * 5,
        mcx:           Math.max(1, Math.round(balance / 100000)),
        default:       Math.max(1, Math.round(balance / 100000)),
      },

      // ── Max position size (70% of account) ──────────────────────────────
      max_position_size:  { percent: 70, amount: balance * 0.70 },

      // ── Session rules ────────────────────────────────────────────────────
      allowed_segments:   { segments: ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'] },
      trading_hours:      { start: '09:15', end: '15:30' },      // 15:30 IST
      no_overnight:       { allowed: true },                      // overnight ALLOWED
      weekend_allowed:    { allowed: true },                      // weekend ALLOWED
      news_blackout:      { windows: [], blockAll: false },

      // ── Scaling ──────────────────────────────────────────────────────────
      scaling: {
        triggerPct: 10,
        rewardPct:  25,
        capPct:     100,
        cycleDays:  90,
      },

      // ── Inactivity ───────────────────────────────────────────────────────
      inactivity_close:   { days: 60 },

      // ── Payout / split ───────────────────────────────────────────────────
      profit_split:       { percent: 80 },
      leverage_limit:     { maxMultiplier: 50 },
      drawdown_type:      { type: 'static' },
    },
  };
}

/**
 * 2-STEP EVALUATION Phase 1 — canonical rule profile.
 * Called by provisioningService when planType === '2step' on initial purchase.
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function get2StepPhase1RuleProfile(balance) {
  return {
    challengeType: '2step',
    plan: '2step',
    phase: 'phase_1',
    initialBalance: balance,
    rules: {
      daily_loss_limit:   { percent: 3, amount: balance * 0.03 },
      max_drawdown:       { percent: 8, amount: balance * 0.08, type: 'static' },
      profit_target:      { percent: 8, amount: balance * 0.08 },
      min_trading_days:   { count: 5 },
      max_positions:      { count: 20 },
      max_position_size:  { percent: 70, amount: balance * 0.70 },
      daily_profit_cap:   { percent: 4, amount: balance * 0.04 },
      max_risk_per_trade: { percent: 1.5, amount: balance * 0.015 },
      allowed_segments:   { segments: ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'] },
      trading_hours:      { start: '09:15', end: '15:30' },
      no_overnight:       { cutoffTime: '15:15', allowedProducts: ['MIS'], blockWeekends: true },
      news_blackout:      { windows: [], blockAll: false },
      profit_split:       { percent: 80 },
      leverage_limit:     { maxMultiplier: 30 },
      drawdown_type:      { type: 'static' },
      inactivity_close:   { days: 60 },
      scaling:            { triggerPct: 10, rewardPct: 25, capPct: 100, cycleDays: 90 },
      // No consistency rule during evaluation
    },
  };
}

/**
 * 2-STEP EVALUATION Phase 2 — canonical rule profile.
 * Used at promotion from Phase 1 → Phase 2.
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function get2StepPhase2RuleProfile(balance) {
  const p1 = get2StepPhase1RuleProfile(balance);
  return {
    ...p1,
    phase: 'phase_2',
    rules: {
      ...p1.rules,
      profit_target: { percent: 5, amount: balance * 0.05 },
      // All other limits same as Phase 1
    },
  };
}

/**
 * 2-STEP FUNDED — canonical rule profile.
 * Used at promotion from Phase 2 → Funded.
 * Max drawdown drops from 8% (eval) to 6% (funded).
 * Consistency rule (40%) activates. Profit target removed.
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function get2StepFundedRuleProfile(balance) {
  return {
    challengeType: '2step',
    plan: '2step',
    phase: 'funded',
    initialBalance: balance,
    rules: {
      daily_loss_limit:   { percent: 3,  amount: balance * 0.03 },
      max_drawdown:       { percent: 6,  amount: balance * 0.06, type: 'static' }, // 6% funded
      profit_target:      { percent: 0,  amount: 0 },                               // none when funded
      payout_threshold:   { percent: 5,  amount: balance * 0.05 },
      min_trading_days:   { count: 3 },                                              // 3 days per payout
      consistency_rule:   { maxDayProfitPercent: 40 },                              // 40% funded rule
      max_positions:      { count: 20 },
      max_position_size:  { percent: 70, amount: balance * 0.70 },
      daily_profit_cap:   { percent: 4,  amount: balance * 0.04 },
      max_risk_per_trade: { percent: 1.5, amount: balance * 0.015 },
      allowed_segments:   { segments: ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'] },
      trading_hours:      { start: '09:15', end: '15:30' },
      no_overnight:       { cutoffTime: '15:15', allowedProducts: ['MIS'], blockWeekends: true },
      news_blackout:      { windows: [], blockAll: false },
      profit_split:       { percent: 80 },
      leverage_limit:     { maxMultiplier: 30 },
      drawdown_type:      { type: 'static' },
      inactivity_close:   { days: 60 },
      scaling:            { triggerPct: 10, rewardPct: 25, capPct: 100, cycleDays: 90 },
    },
  };
}

/**
 * 1-STEP EVALUATION — canonical rule profile.
 * Called by provisioningService when planType === '1step' on initial purchase.
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function get1StepRuleProfile(balance) {
  return {
    challengeType: '1step',
    plan: '1step',
    phase: 'phase_1',
    initialBalance: balance,
    rules: {
      // ── Core risk limits ─────────────────────────────────────────────────
      daily_loss_limit:   { percent: 3,   amount: balance * 0.03 },
      max_drawdown:       { percent: 6,   amount: balance * 0.06,  type: 'static' },
      profit_target:      { percent: 10,  amount: balance * 0.10 },
      min_trading_days:   { count: 5 },
      max_positions:      { count: 20 },
      max_position_size:  { percent: 70,  amount: balance * 0.70 },
      daily_profit_cap:   { percent: 4,   amount: balance * 0.04, cooldown_hours: 8 },
      max_risk_per_trade: { percent: 1.5, amount: balance * 0.015 },

      // ── Session rules ─────────────────────────────────────────────────────
      // Trading hours 09:15–15:30 IST (spec requirement).
      // NOTE: enforcement is done by OneStepRiskEngine reading onestep_risk_profile table.
      // These risk_rules rows are kept for audit/provisioning history only.
      allowed_segments:   { segments: ['NSE', 'NFO', 'BFO', 'CDS', 'MCX'] },
      trading_hours:      { start: '09:15', end: '15:30' },

      // Overnight ALLOWED for 1-Step (spec requirement).
      no_overnight:       { allowed: true },

      // ── Consistency (enabled in both eval and funded) ─────────────────────
      consistency_rule:   { maxDayProfitPercent: 40 },

      // ── Payout / split ────────────────────────────────────────────────────
      profit_split:       { percent: 80 },
      payout_threshold:   { percent: 3,   amount: balance * 0.03 },

      // ── Position / leverage ───────────────────────────────────────────────
      leverage_limit:     { maxMultiplier: 30 },
      drawdown_type:      { type: 'static' },
    },
  };
}

/**
 * 1-STEP FUNDED — canonical rule profile.
 * Used at promotion from Phase 1 → Funded (1-Step skips Phase 2).
 *
 * @param {number} balance - account starting balance in INR
 * @returns {object} rule profile
 */
export function get1StepFundedRuleProfile(balance) {
  const eval1 = get1StepRuleProfile(balance);
  return {
    ...eval1,
    phase: 'funded',
    rules: {
      ...eval1.rules,
      // Funded: no profit target, 3 min trading days, 3% payout threshold
      profit_target:    { percent: 0,  amount: 0 },
      payout_threshold: { percent: 3,  amount: balance * 0.03 },
      min_trading_days: { count: 3 },
      consistency_rule: { maxDayProfitPercent: 40 },
      // Profit split: 80% initially → 90% after 3% payout threshold is satisfied once
      profit_split:     { percent: 80, scaled_percent: 90, threshold_pct: 3 },
    },
  };
}

/**
 * FALLBACK ONLY: Default rule profile used ONLY when Main Site does NOT
 * provide rules in the provisioning request. This ensures backward
 * compatibility with older provisioning calls.
 * 
 * In production, Main Site MUST always provide the full rule profile.
 */
export function getDefaultFallbackProfile(plan, challengeType = '2-step', phase = 'phase_1') {
  const balances = { '10K': 1000000, '25K': 2500000, '50K': 5000000, '1L': 10000000 };
  const balance = balances[plan] || 1000000;

  return {
    challengeType,
    plan,
    phase,
    initialBalance: balance,
    rules: {
      daily_loss_limit: { percent: 5, amount: balance * 0.05 },
      max_drawdown: { percent: 10, amount: balance * 0.10, type: 'static' },
      profit_target: { percent: 8, amount: balance * 0.08 },
      min_trading_days: { count: 5 },
      max_calendar_days: { count: plan === '1L' ? 60 : plan === '10K' ? 30 : 45 },
      max_positions: { count: 10 },
      allowed_segments: { segments: ['NSE', 'NFO', 'BFO'] },
      trading_hours: { start: '09:15', end: '15:30' },
      no_overnight: { cutoffTime: '15:15', allowedProducts: ['MIS'] },
    },
  };
}
