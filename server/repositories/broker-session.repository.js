/**
 * BROKER SESSION REPOSITORY
 * 
 * Database operations for broker_sessions table.
 * Tracks broker auth state per trading account.
 */

import { BaseRepository } from './base.repository.js';

export class BrokerSessionRepository extends BaseRepository {
  constructor() {
    super('broker_sessions');
  }

  async findByAccountId(accountId, provider) {
    const query = this.db
      .from(this.tableName)
      .select('*')
      .eq('trading_account_id', accountId)
      .eq('broker_provider', provider)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data, error } = await query;
    if (error && error.code !== 'PGRST116') throw new Error(`[broker_sessions] findByAccountId failed: ${error.message}`);
    return data || null;
  }

  async getValidSession(accountId, provider) {
    const session = await this.findByAccountId(accountId, provider);
    if (!session) return null;

    if (session.session_expiry && new Date(session.session_expiry) <= new Date()) {
      await this.update(session.id, { is_active: false });
      return null;
    }

    return session;
  }

  async createSession(accountId, params) {
    // Deactivate any existing session for this account+provider
    await this.db
      .from(this.tableName)
      .update({ is_active: false })
      .eq('trading_account_id', accountId)
      .eq('broker_provider', params.provider);

    return this.insert({
      trading_account_id: accountId,
      broker_provider: params.provider,
      access_token_encrypted: params.accessToken,
      refresh_token_encrypted: params.refreshToken || null,
      feed_token: params.feedToken || null,
      session_expiry: params.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      last_heartbeat_at: new Date().toISOString(),
    });
  }

  async updateHeartbeat(sessionId) {
    return this.update(sessionId, { last_heartbeat_at: new Date().toISOString() });
  }

  async recordError(sessionId, errorMessage) {
    const session = await this.findById(sessionId);
    if (!session) return null;

    return this.update(sessionId, {
      error_count: (session.error_count || 0) + 1,
      last_error: errorMessage,
    });
  }

  async deactivateSession(accountId, provider) {
    const { error } = await this.db
      .from(this.tableName)
      .update({ is_active: false })
      .eq('trading_account_id', accountId)
      .eq('broker_provider', provider);

    if (error) throw new Error(`[broker_sessions] deactivateSession failed: ${error.message}`);
    return true;
  }

  async findExpired() {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('is_active', true)
      .lt('session_expiry', new Date().toISOString());

    if (error) throw new Error(`[broker_sessions] findExpired failed: ${error.message}`);
    return data || [];
  }
}
