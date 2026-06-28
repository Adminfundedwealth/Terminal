/**
 * REDIS RATE LIMIT STORE
 * 
 * Uses Redis as the backing store for express-rate-limit.
 * Multi-instance safe — all Railway replicas share the same rate limit state.
 * 
 * Falls back to in-memory store if Redis is unavailable (logs warning).
 */

let RedisStore = null;
let Redis = null;

try {
  const rlRedis = await import('rate-limit-redis');
  RedisStore = rlRedis.default || rlRedis.RedisStore;
} catch {
  // rate-limit-redis not installed
}

try {
  const ioredis = await import('ioredis');
  Redis = ioredis.default;
} catch {
  // ioredis not installed
}

/**
 * Create a Redis-backed rate limit store, or null if Redis unavailable.
 * @returns {object|undefined} RedisStore instance or undefined (express-rate-limit uses MemoryStore)
 */
export function createRedisRateLimitStore(prefix = 'rl:') {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl || !Redis || !RedisStore) {
    console.warn('[RateLimit] Redis not available — using in-memory store (single-instance only)');
    return undefined;
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 500, 5000),
      lazyConnect: true,
      connectTimeout: 10000,
      enableOfflineQueue: true,
    });

    client.connect().catch(err => {
      console.error('[RateLimit] Redis connection failed:', err.message);
    });

    return new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix,
    });
  } catch (err) {
    console.error('[RateLimit] Failed to create Redis store:', err.message);
    return undefined;
  }
}
