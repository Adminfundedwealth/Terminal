/**
 * PROVISIONING SERVICE
 * 
 * Creates trading accounts for new users.
 * Called by Website (auto payment) or Admin (manual UPI/bank).
 * 
 * Flow:
 *   1. Validate provisioning request
 *   2. Create or find terminal_trader
 *   3. Create challenge_account
 *   4. Create trading_account
 *   5. Seed risk_rules
 *   6. Generate credentials
 *   7. Send welcome email with credentials
 *   8. Log provisioning event
 *   9. Callback to Website (order_status = provisioned)
 * 
 * Database Tables Used:
 *   - terminal_traders (user identity in Terminal)
 *   - challenge_accounts (evaluation/funded lifecycle)
 *   - trading_accounts (actual trading account)
 *   - risk_rules (per-account risk parameters)
 *   - provisioning_logs (audit trail)
 */

import crypto from 'crypto';
import { supabase } from '../db/client.js';
import { EmailService } from './emailService.js';
import { WebsiteCallbackClient } from '../clients/website.callback.js';
import { LifecycleCallbackClient } from '../clients/lifecycle.callback.js';
import { eventBus } from '../events/index.js';
import { encryptCredentials } from './credentialEncryption.js';
import { validateRuleProfile, profileToRuleRows, getDefaultFallbackProfile } from '../config/challengeRuleProfiles.js';

export class ProvisioningService {

  /**
   * Provision a new trading account.
   * 
   * @param {Object} params
   * @param {string} params.email - User email
   * @param {string} params.name - User full name
   * @param {string} params.plan - Challenge plan: '10K', '25K', '50K', '1L'
   * @param {string} params.orderId - Website/Admin order reference
   * @param {string} params.paymentMethod - 'razorpay', 'upi_manual', 'bank_transfer'
   * @param {string} [params.paymentRef] - Payment reference (UTR, txn ID)
   * @param {string} params.source - 'website' or 'admin'
   * @param {string} [params.externalId] - User's ID on the calling system
   * @param {string} [params.challengeType] - 'flash', 'instant', '1-step', '2-step'
   * @param {object} [params.ruleProfile] - Full rule profile from Main Site (SINGLE SOURCE OF TRUTH)
   * @returns {Object} Provisioning result
   */
  static async provisionAccount(params) {
    const { email, name, plan, orderId, paymentMethod, paymentRef, source, externalId, fwUserId, challengeType, ruleProfile } = params;
    const resolvedExternalId = externalId || fwUserId || null;

    // Validate
    if (!email || !name || !plan || !orderId || !source) {
      throw new ProvisioningError('Missing required fields: email, name, plan, orderId, source', 'VALIDATION_ERROR');
    }

    const validPlans = ['10K', '25K', '50K', '1L'];
    if (!validPlans.includes(plan)) {
      throw new ProvisioningError(`Invalid plan: ${plan}. Valid: ${validPlans.join(', ')}`, 'INVALID_PLAN');
    }

    if (!supabase) {
      throw new ProvisioningError('Database not configured', 'DB_NOT_CONFIGURED');
    }

    // Idempotency check — already provisioned for this order?
    const existing = await this._checkDuplicate(orderId);
    if (existing) {
      return { success: true, duplicate: true, message: 'Already provisioned', ...existing };
    }

    const provisioningId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    try {
      // 1. Create or find terminal_trader
      const trader = await this._ensureTrader({ email, name, externalId: resolvedExternalId, plan });

      // 2. Generate credentials
      const credentials = this._generateCredentials(plan);

      // 3. Get rule profile — Main Site provides it, fallback for backward compat
      let resolvedProfile;
      if (ruleProfile && typeof ruleProfile === 'object' && ruleProfile.rules) {
        // Main Site provided the full rule profile (SINGLE SOURCE OF TRUTH)
        const validation = validateRuleProfile(ruleProfile);
        if (!validation.valid) {
          throw new ProvisioningError(`Invalid rule profile from Main Site: ${validation.errors.join(', ')}`, 'INVALID_RULE_PROFILE');
        }
        resolvedProfile = ruleProfile;
      } else {
        // Fallback: use default profile (backward compatibility with older Main Site)
        resolvedProfile = getDefaultFallbackProfile(plan, challengeType || '2-step', 'phase_1');
        console.warn(`[Provisioning] No ruleProfile from Main Site — using fallback defaults for ${plan}`);
      }

      const planConfig = {
        balance: resolvedProfile.initialBalance,
        profitTarget: resolvedProfile.rules.profit_target?.percent || 8,
        maxDD: resolvedProfile.rules.max_drawdown?.percent || 10,
        dailyLoss: resolvedProfile.rules.daily_loss_limit?.percent || 5,
        minDays: resolvedProfile.rules.min_trading_days?.count || 5,
        maxDays: resolvedProfile.rules.max_calendar_days?.count || 30,
      };

      // 4. Create challenge_account
      const challenge = await this._createChallengeAccount(trader.id, plan, planConfig);

      // 5. Create trading_account
      const account = await this._createTradingAccount(trader.id, challenge.id, planConfig, credentials);

      // 6. Seed risk_rules from Main Site profile
      await this._seedRiskRulesFromProfile(account.id, resolvedProfile);

      // 7. Log provisioning
      await this._logProvisioning({
        id: provisioningId, traderId: trader.id,
        tradingAccountId: account.id, challengeAccountId: challenge.id,
        orderId, plan, paymentMethod, paymentRef, source,
        status: 'completed', startedAt, completedAt: new Date().toISOString(),
      });

      // 8. Send email
      const emailResult = await EmailService.sendProvisioningEmail({
        to: email, name, plan,
        accountCode: account.account_code,
        credentials, initialBalance: planConfig.balance,
      });

      // 9. Publish event
      eventBus.publish('account.provisioned', {
        provisioningId, traderId: trader.id,
        tradingAccountId: account.id, challengeAccountId: challenge.id,
        plan, orderId, source,
      });

      // 10. Callback to Website (async, non-blocking)
      if (source === 'website') {
        WebsiteCallbackClient.notifyProvisioned({
          orderId, accountCode: account.account_code,
          tradingAccountId: account.id, userId: trader.id,
        }).catch(err => {
          console.warn('[Provisioning] Website callback failed:', err.message || err.error);
        });
      }

      // 11. Notify Admin (async, non-blocking)
      LifecycleCallbackClient.notifyAdmin('account.provisioned', {
        accountId: account.id,
        traderId: trader.id,
        data: {
          orderId, plan, source,
          accountCode: account.account_code,
          challengeId: challenge.id,
          email,
          provisionedAt: new Date().toISOString(),
        },
      }).catch(err => {
        console.warn('[Provisioning] Admin notification failed:', err.message || err);
      });

      return {
        success: true, duplicate: false, provisioningId,
        trader: { id: trader.id, email: trader.email, name: trader.display_name },
        tradingAccount: { id: account.id, accountCode: account.account_code, plan, initialBalance: planConfig.balance, status: 'active' },
        challengeAccount: { id: challenge.id, type: challenge.type, phase: challenge.type === 'evaluation_phase1' ? 'phase_1' : challenge.type === 'evaluation_phase2' ? 'phase_2' : 'funded', status: 'active' },
        credentials: { loginId: credentials.loginId, temporaryPassword: credentials.password },
        email: { sent: emailResult.sent, error: emailResult.error || null },
      };
    } catch (err) {
      await this._logProvisioning({
        id: provisioningId, traderId: null,
        tradingAccountId: null, challengeAccountId: null,
        orderId, plan, paymentMethod, paymentRef, source,
        status: 'failed', startedAt, completedAt: new Date().toISOString(),
        errorMessage: err.message,
      }).catch(() => {});
      throw err;
    }
  }

  /**
   * Check provisioning status for an order.
   */
  static async getProvisioningStatus(orderId) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('provisioning_logs')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error || !data) return null;
    return data;
  }

  /**
   * Retry a failed provisioning.
   */
  static async retryProvisioning(orderId, params) {
    const existing = await this.getProvisioningStatus(orderId);
    if (existing && existing.status === 'completed') {
      return { success: true, duplicate: true, message: 'Already provisioned' };
    }
    return this.provisionAccount({ ...params, orderId });
  }

  // ─── Private ──────────────────────────────────────────────────

  static async _checkDuplicate(orderId) {
    const { data, error } = await supabase
      .from('provisioning_logs')
      .select('id, trading_account_id, challenge_account_id')
      .eq('order_id', orderId)
      .eq('status', 'completed')
      .limit(1)
      .single();

    if (error || !data) return null;

    // Get account code
    const { data: acct } = await supabase
      .from('trading_accounts')
      .select('account_code, status')
      .eq('id', data.trading_account_id)
      .single();

    return {
      provisioningId: data.id,
      tradingAccountId: data.trading_account_id,
      accountCode: acct?.account_code,
      accountStatus: acct?.status,
    };
  }

  static async _ensureTrader({ email, name, externalId, plan }) {
    // Find by external_id or email
    let trader = null;

    if (externalId) {
      const { data } = await supabase
        .from('terminal_traders')
        .select('*')
        .eq('external_id', externalId)
        .single();
      trader = data;
    }

    if (!trader) {
      const { data } = await supabase
        .from('terminal_traders')
        .select('*')
        .eq('email', email)
        .single();
      trader = data;
    }

    if (trader) return trader;

    // Create new terminal_trader
    const extId = externalId || `ext_${crypto.randomBytes(8).toString('hex')}`;
    const { data: newTrader, error } = await supabase
      .from('terminal_traders')
      .insert({
        external_id: extId,
        email,
        display_name: name,
        plan,
        status: 'active',
        preferences: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new ProvisioningError(`Failed to create trader: ${error.message}`, 'TRADER_CREATE_FAILED');
    return newTrader;
  }

  static _generateCredentials(plan) {
    const planPrefix = plan.replace(/[^A-Z0-9]/g, '');
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const loginId = `FW${planPrefix}${randomPart}`;
    const password = this._generatePassword();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    return { loginId, password, passwordHash };
  }

  static _generatePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '@#$!&';
    let p = '';
    p += upper[Math.floor(Math.random() * upper.length)];
    p += lower[Math.floor(Math.random() * lower.length)];
    p += lower[Math.floor(Math.random() * lower.length)];
    p += digits[Math.floor(Math.random() * digits.length)];
    p += digits[Math.floor(Math.random() * digits.length)];
    p += digits[Math.floor(Math.random() * digits.length)];
    p += digits[Math.floor(Math.random() * digits.length)];
    p += special[Math.floor(Math.random() * special.length)];
    p += special[Math.floor(Math.random() * special.length)];
    return p;
  }

  static _getPlanConfig(plan) {
    const configs = {
      '10K': { balance: 1000000, profitTarget: 8, maxDD: 10, dailyLoss: 5, minDays: 5, maxDays: 30 },
      '25K': { balance: 2500000, profitTarget: 8, maxDD: 10, dailyLoss: 5, minDays: 5, maxDays: 45 },
      '50K': { balance: 5000000, profitTarget: 8, maxDD: 10, dailyLoss: 5, minDays: 5, maxDays: 45 },
      '1L':  { balance: 10000000, profitTarget: 8, maxDD: 10, dailyLoss: 5, minDays: 5, maxDays: 60 },
    };
    return configs[plan];
  }

  static async _createChallengeAccount(traderId, plan, cfg) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + cfg.maxDays);

    const { data, error } = await supabase
      .from('challenge_accounts')
      .insert({
        trader_id: traderId,
        type: 'evaluation_phase1',
        plan,
        initial_balance: cfg.balance,
        current_balance: cfg.balance,
        peak_balance: cfg.balance,
        profit_target_pct: cfg.profitTarget,
        daily_loss_limit_pct: cfg.dailyLoss,
        max_drawdown_pct: cfg.maxDD,
        min_trading_days: cfg.minDays,
        max_calendar_days: cfg.maxDays,
        status: 'active',
        started_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw new ProvisioningError(`Failed to create challenge: ${error.message}`, 'CHALLENGE_CREATE_FAILED');
    return data;
  }

  static async _createTradingAccount(traderId, challengeId, cfg, credentials) {
    const accountCode = `FW-P1-${Date.now().toString(36).toUpperCase()}`;

    // Store credentials encrypted with AES-256-GCM
    const credentialsPayload = JSON.stringify({
      loginId: credentials.loginId,
      passwordHash: credentials.passwordHash,
      createdAt: new Date().toISOString(),
    });
    const credentialsEncrypted = encryptCredentials(credentialsPayload);

    const { data, error } = await supabase
      .from('trading_accounts')
      .insert({
        trader_id: traderId,
        challenge_id: challengeId,
        account_code: accountCode,
        broker_provider: 'paper',
        balance: cfg.balance,
        available_margin: cfg.balance,
        used_margin: 0,
        broker_credentials_encrypted: credentialsEncrypted,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw new ProvisioningError(`Failed to create trading account: ${error.message}`, 'ACCOUNT_CREATE_FAILED');
    return data;
  }

  static async _seedRiskRules(tradingAccountId, cfg) {
    const rules = [
      { trading_account_id: tradingAccountId, rule_type: 'daily_loss_limit', value: { percent: cfg.dailyLoss, amount: (cfg.dailyLoss / 100) * cfg.balance }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'max_drawdown', value: { percent: cfg.maxDD, amount: (cfg.maxDD / 100) * cfg.balance }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'profit_target', value: { percent: cfg.profitTarget, amount: (cfg.profitTarget / 100) * cfg.balance }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'max_positions', value: { count: 10 }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'allowed_segments', value: { segments: ['NSE', 'NFO', 'BFO'] }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'trading_hours', value: { start: '09:15', end: '15:30' }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'no_overnight', value: { cutoffTime: '15:15', allowedProducts: ['MIS'] }, is_active: true },
      { trading_account_id: tradingAccountId, rule_type: 'min_trading_days', value: { count: cfg.minDays }, is_active: true },
    ];

    const { error } = await supabase.from('risk_rules').insert(rules);
    if (error) console.warn('[Provisioning] risk_rules seed failed (non-fatal):', error.message);
  }

  /**
   * Seed risk rules from a Main Site-provided rule profile.
   * This is the preferred method — rules come from Main Site, not hardcoded.
   */
  static async _seedRiskRulesFromProfile(tradingAccountId, profile) {
    const rows = profileToRuleRows(tradingAccountId, profile);

    if (rows.length === 0) {
      console.warn('[Provisioning] No rules in profile — using legacy _seedRiskRules');
      return;
    }

    const { error } = await supabase.from('risk_rules').insert(rows);
    if (error) console.warn('[Provisioning] risk_rules seed from profile failed (non-fatal):', error.message);
    else console.log(`[Provisioning] ✓ Seeded ${rows.length} rules from Main Site profile`);
  }

  static async _logProvisioning(log) {
    const { error } = await supabase
      .from('provisioning_logs')
      .insert({
        id: log.id,
        trader_id: log.traderId,
        trading_account_id: log.tradingAccountId,
        challenge_account_id: log.challengeAccountId,
        order_id: log.orderId,
        plan: log.plan,
        payment_method: log.paymentMethod,
        payment_ref: log.paymentRef,
        source: log.source,
        status: log.status,
        error_message: log.errorMessage || null,
        started_at: log.startedAt,
        completed_at: log.completedAt,
      });
    if (error) console.error('[Provisioning] Log failed:', error.message);
  }
}

export class ProvisioningError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ProvisioningError';
    this.code = code;
  }
}
