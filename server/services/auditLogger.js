/**
 * AUDIT LOGGER — Security Event Persistence
 * 
 * Logs ALL security-relevant events to Supabase audit table and console.
 * Events: auth failures, IDOR attempts, permission denials, trade actions,
 * kill switch activations, session events, config changes.
 * 
 * PRODUCTION: Every trade action, every auth failure, every privilege escalation attempt is logged.
 */

import { supabase } from '../db/client.js';

const LOG_BUFFER = [];
const FLUSH_INTERVAL = 5000; // 5 seconds
const MAX_BUFFER = 100;

export class AuditLogger {
  /**
   * Log authentication failure.
   */
  static authFailure({ reason, userId, ip, path, userAgent }) {
    this._log('AUTH_FAILURE', { reason, userId, ip, path, userAgent });
  }

  /**
   * Log authorization failure (permission denied).
   */
  static authzFailure({ userId, permission, path, reason }) {
    this._log('AUTHZ_FAILURE', { userId, permission, path, reason });
  }

  /**
   * Log IDOR attempt (user trying to access another user's resource).
   */
  static idorAttempt({ userId, targetAccountId, path }) {
    this._log('IDOR_ATTEMPT', { userId, targetAccountId, path }, 'critical');
  }

  /**
   * Log trade action (order placed, modified, cancelled).
   */
  static tradeAction({ userId, accountId, action, orderId, symbol, side, qty, price, result }) {
    this._log('TRADE_ACTION', { userId, accountId, action, orderId, symbol, side, qty, price, result });
  }

  /**
   * Log kill switch activation.
   */
  static killSwitch({ userId, scope, targetAccountIds, reason, result }) {
    this._log('KILL_SWITCH', { userId, scope, targetAccountIds, reason, result }, 'critical');
  }

  /**
   * Log session event (create, revoke, expire).
   */
  static sessionEvent({ userId, action, ip, userAgent, sessionId }) {
    this._log('SESSION_EVENT', { userId, action, ip, userAgent, sessionId });
  }

  /**
   * Log provisioning event.
   */
  static provisioningEvent({ action, orderId, email, plan, source, result }) {
    this._log('PROVISIONING', { action, orderId, email, plan, source, result });
  }

  /**
   * Log configuration change.
   */
  static configChange({ userId, action, target, before, after }) {
    this._log('CONFIG_CHANGE', { userId, action, target, before, after }, 'high');
  }

  /**
   * Log WebSocket connection event.
   */
  static wsConnection({ userId, accountId, action, ip }) {
    this._log('WS_CONNECTION', { userId, accountId, action, ip });
  }

  /**
   * Log tamper detection event.
   */
  static tamperDetected({ type, details, ip }) {
    this._log('TAMPER_DETECTED', { type, details, ip }, 'critical');
  }

  /**
   * Internal: buffer and persist log entry.
   */
  static _log(event, data, severity = 'info') {
    const entry = {
      event,
      severity,
      data,
      timestamp: new Date().toISOString(),
      server_id: process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'unknown',
    };

    // Always log critical events to console immediately
    if (severity === 'critical') {
      console.error(`[AUDIT:${severity.toUpperCase()}] ${event}`, JSON.stringify(data));
    }

    LOG_BUFFER.push(entry);

    // Auto-flush if buffer is full
    if (LOG_BUFFER.length >= MAX_BUFFER) {
      this._flush();
    }
  }

  /**
   * Flush buffered audit logs to database.
   */
  static async _flush() {
    if (LOG_BUFFER.length === 0) return;
    if (!supabase) {
      // In production without DB, log to console as fallback
      LOG_BUFFER.forEach(entry => {
        console.log(`[AUDIT] ${entry.event} | ${JSON.stringify(entry.data)}`);
      });
      LOG_BUFFER.length = 0;
      return;
    }

    const batch = LOG_BUFFER.splice(0, LOG_BUFFER.length);

    try {
      await supabase.from('security_audit_log').insert(
        batch.map(entry => ({
          event: entry.event,
          severity: entry.severity,
          data: entry.data,
          server_id: entry.server_id,
          created_at: entry.timestamp,
        }))
      );
    } catch (err) {
      // Fallback to console if DB write fails
      console.error('[AuditLogger] DB flush failed:', err.message);
      batch.forEach(entry => {
        console.log(`[AUDIT:FALLBACK] ${entry.event} | ${JSON.stringify(entry.data)}`);
      });
    }
  }

  /**
   * Start periodic flush.
   */
  static startPeriodicFlush() {
    setInterval(() => this._flush(), FLUSH_INTERVAL);
  }

  /**
   * Force flush (call on shutdown).
   */
  static async shutdown() {
    await this._flush();
  }
}

// Start periodic flush on module load
AuditLogger.startPeriodicFlush();
