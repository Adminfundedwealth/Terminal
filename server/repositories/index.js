/**
 * REPOSITORY LAYER — Central Export
 * 
 * All database access goes through repositories.
 * No direct Supabase queries in routes or services.
 */

export { BaseRepository } from './base.repository.js';
export { UserRepository } from './user.repository.js';
export { AccountRepository } from './account.repository.js';
export { ChallengeRepository } from './challenge.repository.js';
export { OrderRepository } from './order.repository.js';
export { PositionRepository } from './position.repository.js';
export { TradeRepository } from './trade.repository.js';
export { WatchlistRepository } from './watchlist.repository.js';
export { RiskRulesRepository } from './risk-rules.repository.js';
export { MetricsRepository } from './metrics.repository.js';
export { AuditRepository } from './audit.repository.js';
export { BrokerSessionRepository } from './broker-session.repository.js';

// Persistence / Audit repositories
export { RiskEventRepository } from './risk-event.repository.js';
export { ChallengeMetricsRepository } from './challenge-metrics.repository.js';
export { OrderAuditRepository } from './order-audit.repository.js';
