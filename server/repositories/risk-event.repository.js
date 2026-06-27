/**
 * RISK EVENT REPOSITORY
 * 
 * Database operations for risk_events table.
 * All queries scoped by trading_account_id.
 */

import { BaseRepository } from './base.repository.js';

export class RiskEventRepository extends BaseRepository {
  constructor() {
    super('risk_events');
  }

  async log(accountId, eventType, severity, ruleType, thresholdValue, actualValue, metadata = {}, challengeId = null) {
    return this.insert({
      trading_account_id: accountId,
      challenge_id: challengeId,
      event_type: eventType,
      severity,
      rule_type: ruleType || null,
      threshold_value: thresholdValue || null,
      actual_value: actualValue || null,
      metadata,
      acknowledged: false,
    });
  }

  async logWarning(accountId, ruleType, thresholdValue, actualValue, metadata = {}) {
    const eventTypeMap = {
      'daily_loss_limit': 'daily_loss_warning',
      'max_drawdown':     'drawdown_warning',
      'profit_target':    'profit_target_reached',
      'max_positions':    'position_limit_hit',
    };
    const eventType = eventTypeMap[ruleType] || 'daily_loss_warning';
    return this.log(accountId, eventType, 'warning', ruleType, thresholdValue, actualValue, metadata);
  }

  async logBreach(accountId, ruleType, thresholdValue, actualValue, metadata = {}) {
    const eventTypeMap = {
      'daily_loss_limit': 'daily_loss_breach',
      'max_drawdown':     'drawdown_breach',
    };
    const eventType = eventTypeMap[ruleType] || 'daily_loss_breach';
    return this.log(accountId, eventType, 'critical', ruleType, thresholdValue, actualValue, metadata);
  }

  async logAccountLocked(accountId, reason, metadata = {}) {
    return this.log(accountId, 'account_locked', 'critical', null, null, null, { reason, ...metadata });
  }

  async logAccountBreached(accountId, reason, metadata = {}) {
    return this.log(accountId, 'account_breached', 'critical', null, null, null, { reason, ...metadata });
  }

  async findByAccountId(accountId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .order('created_at', { ascending: false });

    if (options.severity) query = query.eq('severity', options.severity);
    if (options.eventType) query = query.eq('event_type', options.eventType);
    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw new Error(`[risk_events] findByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findUnacknowledged(accountId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('acknowledged', false)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`[risk_events] findUnacknowledged failed: ${error.message}`);
    return data || [];
  }

  async acknowledge(eventId) {
    return this.update(eventId, { acknowledged: true });
  }

  async countTodayCritical(accountId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error } = await this.db
      .from(this.tableName)
      .select('id', { count: 'exact', head: true })
      .eq('trading_account_id', accountId)
      .eq('severity', 'critical')
      .gte('created_at', today.toISOString());

    if (error) throw new Error(`[risk_events] countTodayCritical failed: ${error.message}`);
    return count || 0;
  }
}
