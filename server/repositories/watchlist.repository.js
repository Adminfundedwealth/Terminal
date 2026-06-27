/**
 * WATCHLIST REPOSITORY
 * 
 * Database operations for watchlists table.
 * Scoped by trader_id.
 */

import { BaseRepository } from './base.repository.js';

export class WatchlistRepository extends BaseRepository {
  constructor() {
    super('watchlists');
  }

  async findByTraderId(traderId) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('trader_id', traderId)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(`[watchlists] findByTraderId failed: ${error.message}`);
    return data || [];
  }

  // Legacy alias
  async findByUserId(userId) {
    return this.findByTraderId(userId);
  }

  async createWatchlist(traderId, params) {
    const existing = await this.findByTraderId(traderId);
    const nextOrder = existing.length > 0
      ? Math.max(...existing.map(w => w.sort_order)) + 1
      : 0;

    return this.insert({
      trader_id: traderId,
      name: params.name,
      color: params.color || '#2962ff',
      icon: params.icon || 'list',
      items: params.items || [],
      sort_order: params.sortOrder ?? nextOrder,
      is_default: params.isDefault || false,
    });
  }

  async updateItems(watchlistId, items) {
    return this.update(watchlistId, { items });
  }

  async updateName(watchlistId, name) {
    return this.update(watchlistId, { name });
  }

  async updateColor(watchlistId, color) {
    return this.update(watchlistId, { color });
  }

  async reorder(traderId, orderedIds) {
    const updates = orderedIds.map((id, index) =>
      this.update(id, { sort_order: index })
    );
    await Promise.all(updates);
    return true;
  }

  async addItem(watchlistId, item) {
    const watchlist = await this.findById(watchlistId);
    if (!watchlist) throw new Error('Watchlist not found');

    const items = watchlist.items || [];
    if (items.some(i => i.token === item.token)) return watchlist;

    items.push(item);
    return this.update(watchlistId, { items });
  }

  async removeItem(watchlistId, token) {
    const watchlist = await this.findById(watchlistId);
    if (!watchlist) throw new Error('Watchlist not found');

    const items = (watchlist.items || []).filter(i => i.token !== token);
    return this.update(watchlistId, { items });
  }

  async deleteWatchlist(watchlistId) {
    return this.delete(watchlistId);
  }
}
