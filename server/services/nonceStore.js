/**
 * NONCE STORE — Replay Attack Prevention
 * 
 * Stores used SSO nonces with TTL to prevent token replay.
 * 
 * Strategy (ordered by preference):
 *   1. Redis SET NX EX (multi-instance safe, automatic TTL expiry)
 *   2. Supabase table (if Redis unavailable, single table query)
 *   3. In-memory Set (last resort, single-instance only)
 * 
 * The SET NX EX pattern:
 *   - NX = only set if key does NOT exist (atomic check-and-set)
 *   - EX = expire after N seconds (automatic cleanup)
 *   - Returns 'OK' if set (nonce is new), null if exists (replay)
 */

let Redis;
try {
  Redis = (await import('ioredis')).default;
} catch {
  Redis = null;
}

import { supabase } from '../db/client.js';

export class NonceStore {
  constructor() {
    this._redis = null;
    this._fallbackSet = new Set();
    this._initialized = false;
    this._mode = 'memory'; // 'redis' | 'supabase' | 'memory'
  }

  /**
   * Initialize Redis connection for nonce storage.
   * Called lazily on first use.
   */
  async _ensureInitialized() {
    if (this._initialized) return;
    this._initialized = true;

    const redisUrl = process.env.REDIS_URL;

    if (redisUrl && Redis) {
      try {
        this._redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 2,
          retryStrategy: (times) => Math.min(times * 100, 3000),
          lazyConnect: true,
          connectTimeout: 5000,
        });
        await this._redis.connect();
        this._mode = 'redis';
        console.log('[NonceStore] ✓ Using Redis for nonce storage (multi-instance safe)');
        return;
      } catch (err) {
        console.warn(`[NonceStore] Redis connection failed: ${err.message}`);
        this._redis = null;
      }
    }

    // Fallback: check if Supabase sso_nonces table exists
    if (supabase) {
      try {
        const { error } = await supabase.from('sso_nonces').select('nonce').limit(1);
        if (!error) {
          this._mode = 'supabase';
          console.log('[NonceStore] ✓ Using Supabase sso_nonces table for nonce storage');
          return;
        }
      } catch {
        // Table doesn't exist — fall through to memory
      }
    }

    this._mode = 'memory';
    console.warn('[NonceStore] ⚠ Using in-memory nonce store (single-instance only)');
  }

  /**
   * Check if a nonce has been used, and store it if new.
   * Returns true if nonce is NEW (safe to proceed).
   * Returns false if nonce was ALREADY USED (replay attack).
   * 
   * @param {string} nonce - The nonce to check
   * @param {number} ttlSeconds - Time-to-live in seconds (matches SSO token maxAge)
   * @returns {Promise<boolean>} true = new nonce, false = replay
   */
  async checkAndStore(nonce, ttlSeconds = 120) {
    await this._ensureInitialized();

    switch (this._mode) {
      case 'redis':
        return this._checkRedis(nonce, ttlSeconds);
      case 'supabase':
        return this._checkSupabase(nonce, ttlSeconds);
      default:
        return this._checkMemory(nonce, ttlSeconds);
    }
  }

  /**
   * Redis: SET key NX EX ttl — atomic check-and-set with auto-expiry.
   */
  async _checkRedis(nonce, ttlSeconds) {
    try {
      const result = await this._redis.set(`sso:nonce:${nonce}`, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      console.error('[NonceStore] Redis SET NX failed:', err.message);
      // PRODUCTION: Fail-closed on Redis error — reject the request to prevent replay
      return false;
    }
  }

  /**
   * Supabase: INSERT with ON CONFLICT DO NOTHING.
   * If affected rows = 0, nonce already exists (replay).
   */
  async _checkSupabase(nonce, ttlSeconds) {
    try {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const { data, error } = await supabase
        .from('sso_nonces')
        .insert({ nonce, expires_at: expiresAt })
        .select('nonce');

      if (error) {
        // Unique constraint violation = nonce already exists = replay
        if (error.code === '23505') return false;
        // Other error — fall through to memory
        console.error('[NonceStore] Supabase insert error:', error.message);
        return this._checkMemory(nonce, ttlSeconds);
      }

      return data && data.length > 0;
    } catch (err) {
      console.error('[NonceStore] Supabase check failed:', err.message);
      return this._checkMemory(nonce, ttlSeconds);
    }
  }

  /**
   * Memory: In-process Set with manual TTL cleanup.
   * Last resort — only works for single-instance deployments.
   */
  _checkMemory(nonce, ttlSeconds) {
    if (this._fallbackSet.has(nonce)) return false;

    this._fallbackSet.add(nonce);

    // Auto-remove after TTL
    setTimeout(() => {
      this._fallbackSet.delete(nonce);
    }, ttlSeconds * 1000);

    // Safety: cap size
    if (this._fallbackSet.size > 50000) {
      const iter = this._fallbackSet.values();
      for (let i = 0; i < 25000; i++) {
        this._fallbackSet.delete(iter.next().value);
      }
    }

    return true;
  }

  /**
   * Get current store mode for diagnostics.
   */
  getMode() {
    return this._mode;
  }
}
