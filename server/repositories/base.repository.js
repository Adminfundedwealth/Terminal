/**
 * BASE REPOSITORY
 * 
 * Provides common Supabase query patterns.
 * All repositories extend this class.
 * 
 * Uses service role key — bypasses RLS (backend is trusted).
 */

import { supabase } from '../db/client.js';

export class BaseRepository {
  constructor(tableName) {
    this.tableName = tableName;
  }

  /**
   * Resolve actual table name. Uses production schema directly.
   */
  get table() {
    return this.tableName;
  }

  get db() {
    if (!supabase) {
      throw new Error(`[${this.tableName}] Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.`);
    }
    return supabase;
  }

  async findById(id) {
    const { data, error } = await this.db
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`[${this.tableName}] findById failed: ${error.message}`);
    return data;
  }

  async findOne(filters) {
    let query = this.db.from(this.tableName).select('*');
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }
    const { data, error } = await query.single();
    if (error && error.code !== 'PGRST116') {
      throw new Error(`[${this.tableName}] findOne failed: ${error.message}`);
    }
    return data || null;
  }

  async findMany(filters, options = {}) {
    let query = this.db.from(this.tableName).select(options.select || '*');

    for (const [key, value] of Object.entries(filters)) {
      if (value === null) {
        query = query.is(key, null);
      } else {
        query = query.eq(key, value);
      }
    }

    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? false });
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`[${this.tableName}] findMany failed: ${error.message}`);
    return data || [];
  }

  async insert(record) {
    const { data, error } = await this.db
      .from(this.tableName)
      .insert(record)
      .select()
      .single();

    if (error) throw new Error(`[${this.tableName}] insert failed: ${error.message}`);
    return data;
  }

  async insertMany(records) {
    const { data, error } = await this.db
      .from(this.tableName)
      .insert(records)
      .select();

    if (error) throw new Error(`[${this.tableName}] insertMany failed: ${error.message}`);
    return data || [];
  }

  async update(id, updates) {
    const { data, error } = await this.db
      .from(this.tableName)
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`[${this.tableName}] update failed: ${error.message}`);
    return data;
  }

  async updateWhere(filters, updates) {
    let query = this.db.from(this.tableName).update(updates);
    for (const [key, value] of Object.entries(filters)) {
      if (value === null) {
        query = query.is(key, null);
      } else {
        query = query.eq(key, value);
      }
    }
    const { data, error } = await query.select();
    if (error) throw new Error(`[${this.tableName}] updateWhere failed: ${error.message}`);
    return data || [];
  }

  async delete(id) {
    const { error } = await this.db
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) throw new Error(`[${this.tableName}] delete failed: ${error.message}`);
    return true;
  }

  async deleteWhere(filters) {
    let query = this.db.from(this.tableName).delete();
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }
    const { error } = await query;
    if (error) throw new Error(`[${this.tableName}] deleteWhere failed: ${error.message}`);
    return true;
  }

  async count(filters = {}) {
    let query = this.db.from(this.tableName).select('id', { count: 'exact', head: true });
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }
    const { count, error } = await query;
    if (error) throw new Error(`[${this.tableName}] count failed: ${error.message}`);
    return count || 0;
  }
}
