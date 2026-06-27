/**
 * RISK RULES REPOSITORY
 * 
 * Database operations for risk_rules table.
 * All queries scoped by trading_account_id.
 */

import { BaseRepository } from './base.repository.js';

export class RiskRulesRepository extends BaseRepository {
  constructor() {
    super('risk_rules');
  }

  async findByAccountId(accountId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('is_active', true);

    if (error) throw new Error(`[risk_rules] findByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findRule(accountId, ruleType) {
    return this.findOne({ trading_account_id: accountId, rule_type: ruleType });
  }

  async getRulesMap(accountId) {
    const rules = await this.findByAccountId(accountId);
    const map = {};
    for (const rule of rules) {
      map[rule.rule_type] = rule.value;
    }
    return map;
  }

  async upsertRule(accountId, ruleType, value) {
    const existing = await this.findRule(accountId, ruleType);

    if (existing) {
      return this.update(existing.id, {
        value,
        is_active: true,
        updated_at: new Date().toISOString(),
      });
    }

    return this.insert({
      trading_account_id: accountId,
      rule_type: ruleType,
      value,
      is_active: true,
    });
  }

  async deactivateRule(accountId, ruleType) {
    const rule = await this.findRule(accountId, ruleType);
    if (!rule) return null;
    return this.update(rule.id, { is_active: false, updated_at: new Date().toISOString() });
  }

  async seedDefaultRules(accountId, plan, phase) {
    // Default rules per plan and phase
    const planConfigs = {
      '10k': { dailyLoss: 0.05, maxDrawdown: 0.10, profitTarget: 0.08, minDays: 5, maxPositions: 5 },
      '25k': { dailyLoss: 0.05, maxDrawdown: 0.10, profitTarget: 0.08, minDays: 5, maxPositions: 8 },
      '50k': { dailyLoss: 0.05, maxDrawdown: 0.10, profitTarget: 0.08, minDays: 5, maxPositions: 10 },
      '1l':  { dailyLoss: 0.05, maxDrawdown: 0.10, profitTarget: 0.08, minDays: 5, maxPositions: 15 },
    };

    const cfg = planConfigs[plan?.toLowerCase()] || planConfigs['10k'];

    const rules = [
      { rule_type: 'daily_loss_limit', value: { percent: cfg.dailyLoss } },
      { rule_type: 'max_drawdown',     value: { percent: cfg.maxDrawdown } },
      { rule_type: 'profit_target',    value: { percent: cfg.profitTarget } },
      { rule_type: 'min_trading_days', value: { days: cfg.minDays } },
      { rule_type: 'max_positions',    value: { count: cfg.maxPositions } },
      { rule_type: 'no_overnight',     value: { enabled: true } },
      { rule_type: 'allowed_segments', value: { segments: ['NSE', 'NFO', 'MCX', 'CDS'] } },
      { rule_type: 'trading_hours',    value: { start: '09:15', end: '15:20', timezone: 'Asia/Kolkata' } },
    ];

    for (const rule of rules) {
      await this.upsertRule(accountId, rule.rule_type, rule.value);
    }

    return rules.length;
  }
}
