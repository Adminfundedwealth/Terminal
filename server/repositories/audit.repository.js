/**
 * AUDIT REPOSITORY
 * 
 * Immutable event log using execution_audits table.
 * Records pre/post trade risk checks.
 */

import { BaseRepository } from './base.repository.js';

export class AuditRepository extends BaseRepository {
  constructor() {
    super('execution_audits');
  }

  async log({ accountId, orderId, executionId, auditType, checksRun, allPassed, rejectionReason, balanceBefore, balanceAfter, marginBefore, marginAfter }) {
    return this.insert({
      trading_account_id: accountId,
      order_id: orderId || null,
      execution_id: executionId || null,
      audit_type: auditType || 'pre_trade',
      checks_run: checksRun || [],
      all_passed: allPassed !== false,
      rejection_reason: rejectionReason || null,
      balance_before: balanceBefore || null,
      balance_after: balanceAfter || null,
      margin_before: marginBefore || null,
      margin_after: marginAfter || null,
    });
  }

  async findByAccountId(accountId, options = {}) {
    let query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .order('created_at', { ascending: false });

    if (options.auditType) query = query.eq('audit_type', options.auditType);
    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw new Error(`[execution_audits] findByAccountId failed: ${error.message}`);
    return data || [];
  }

  async findByOrderId(orderId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`[execution_audits] findByOrderId failed: ${error.message}`);
    return data || [];
  }

  async findFailedChecks(accountId, limit = 50) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('all_passed', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`[execution_audits] findFailedChecks failed: ${error.message}`);
    return data || [];
  }

  // Audit records are immutable
  async update() { throw new Error('[execution_audits] Audit records are immutable.'); }
  async delete() { throw new Error('[execution_audits] Audit records are immutable.'); }
  async deleteWhere() { throw new Error('[execution_audits] Audit records are immutable.'); }
}
