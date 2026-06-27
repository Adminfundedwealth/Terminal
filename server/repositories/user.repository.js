/**
 * TRADER REPOSITORY
 * 
 * Database operations for terminal_traders table.
 * Terminal-owned identity (no shared users table).
 */

import { BaseRepository } from './base.repository.js';

export class UserRepository extends BaseRepository {
  constructor() {
    super('terminal_traders');
  }

  async findByFwUserId(fwUserId) {
    return this.findOne({ external_id: fwUserId });
  }

  async findByExternalId(externalId) {
    return this.findOne({ external_id: externalId });
  }

  async findByEmail(email) {
    return this.findOne({ email });
  }

  async findActive(traderId) {
    const trader = await this.findById(traderId);
    if (!trader) return null;
    if (trader.status !== 'active') return null;
    return trader;
  }

  async upsertFromSSO({ externalId, email, displayName, avatarUrl, plan }) {
    const existing = await this.findByExternalId(externalId);
    if (existing) {
      return this.update(existing.id, {
        email,
        display_name: displayName,
        avatar_url: avatarUrl,
        plan,
        last_login_at: new Date().toISOString(),
      });
    }
    return this.insert({
      external_id: externalId,
      email,
      display_name: displayName,
      avatar_url: avatarUrl,
      plan,
      last_login_at: new Date().toISOString(),
    });
  }
}

