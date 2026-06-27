/**
 * ORDER AUDIT REPOSITORY
 * 
 * Logs order and position lifecycle events to execution_audits.
 * Re-uses AuditRepository with order-centric helpers.
 */

import { AuditRepository } from './audit.repository.js';

export class OrderAuditRepository extends AuditRepository {
  async logPreTrade(accountId, orderId, checksRun, allPassed, rejectionReason, balanceBefore, marginBefore) {
    return this.log({
      accountId,
      orderId,
      auditType: 'pre_trade',
      checksRun,
      allPassed,
      rejectionReason,
      balanceBefore,
      marginBefore,
    });
  }

  async logPostTrade(accountId, orderId, executionId, checksRun, balanceBefore, balanceAfter, marginBefore, marginAfter) {
    return this.log({
      accountId,
      orderId,
      executionId,
      auditType: 'post_trade',
      checksRun,
      allPassed: true,
      balanceBefore,
      balanceAfter,
      marginBefore,
      marginAfter,
    });
  }

  async logPositionExit(accountId, orderId, checksRun, allPassed, rejectionReason) {
    return this.log({
      accountId,
      orderId,
      auditType: 'position_exit',
      checksRun,
      allPassed,
      rejectionReason,
    });
  }

  async logRiskBreach(accountId, checksRun, balanceBefore) {
    return this.log({
      accountId,
      auditType: 'risk_breach',
      checksRun,
      allPassed: false,
      balanceBefore,
    });
  }
}
