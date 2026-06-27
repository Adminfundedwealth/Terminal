# FUNDEDWEALTH TERMINAL — SOURCE OF TRUTH

> Last updated: 2026-06-18  
> Database: Supabase (PostgreSQL)  
> Backend: Node.js (Express + Socket.IO)  
> Frontend: React + TradingView Charting Library  
> Broker: Angel One (live), Dhan (placeholder)

---

## Table of Contents

1. [Complete Database Schema](#1-complete-database-schema)
2. [All Tables](#2-all-tables)
3. [All Repositories](#3-all-repositories)
4. [Broker Adapters](#4-broker-adapters)
5. [Socket Architecture](#5-socket-architecture)
6. [TradingView Architecture](#6-tradingview-architecture)
7. [Challenge Engine Architecture](#7-challenge-engine-architecture)

---

## 1. Complete Database Schema

**Database:** PostgreSQL on Supabase  
**Naming Convention:** All terminal tables use `t_` prefix (avoids collision with FW Dashboard tables)  
**RLS:** Enabled on all tables; backend uses service role (bypasses RLS)  
**Triggers:** Auto-update `updated_at` columns on t_users, t_accounts, t_orders, t_watchlists

### Migrations

| File | Purpose |
|------|---------|
| `001_initial_setup.sql` | Base schema (users, challenges, accounts, etc.) |
| `002_rls_policies.sql` | Row Level Security policies |
| `003_schema_additions.sql` | peak_balance, payout_eligible, min_trading_days, exchange columns |
| `004_terminal_tables.sql` | Production t_ prefixed tables (full schema) |
| `005_persistence_tables.sql` | Audit tables (broker_sessions, risk_events, challenge_metrics, order_audit) |

### Schema DDL (Production — t_ prefix)

```sql
-- ═══════════════════════════════════════════════════════
-- T_USERS — Synced from FundedWealth Dashboard
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_CHALLENGES — Prop firm evaluation/funded accounts
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('evaluation', 'funded')),
    plan TEXT NOT NULL,
    initial_balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'passed', 'failed', 'expired')),
    min_trading_days INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT
);

-- ═══════════════════════════════════════════════════════
-- T_ACCOUNTS — Trading accounts (one per challenge)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    account_code TEXT UNIQUE NOT NULL,
    challenge_id UUID NOT NULL REFERENCES t_challenges(id),
    broker_provider TEXT NOT NULL CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    broker_client_id TEXT,
    broker_credentials_encrypted TEXT,
    balance NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2),
    payout_eligible BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_RISK_RULES — Per-account risk rules (JSONB values)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(account_id, rule_type)
);

-- ═══════════════════════════════════════════════════════
-- T_ORDERS — Trading orders
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'SL', 'SL-M')),
    product_type TEXT NOT NULL CHECK (product_type IN ('MIS', 'CNC', 'NRML', 'BO', 'CO')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2),
    trigger_price NUMERIC(12,2),
    filled_qty INTEGER DEFAULT 0,
    avg_price NUMERIC(12,2),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'REJECTED')),
    reject_reason TEXT,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_POSITIONS — Open & closed positions
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    product_type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);
-- Partial unique index: only one open position per token/product combo
CREATE UNIQUE INDEX idx_t_unique_open_position
  ON t_positions (account_id, token, product_type)
  WHERE closed_at IS NULL;

-- ═══════════════════════════════════════════════════════
-- T_TRADES — Execution log (immutable)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    order_id UUID REFERENCES t_orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_WATCHLISTS — Per-user, synced across devices
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_ACCOUNT_METRICS — Daily snapshot for reporting
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id),
    date DATE NOT NULL,
    starting_balance NUMERIC(15,2) NOT NULL,
    ending_balance NUMERIC(15,2) NOT NULL,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    unrealized_pnl NUMERIC(12,2) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    max_drawdown NUMERIC(12,2) DEFAULT 0,
    daily_loss NUMERIC(12,2) DEFAULT 0,
    peak_balance NUMERIC(15,2),
    UNIQUE(account_id, date)
);

-- ═══════════════════════════════════════════════════════
-- T_SESSIONS — Terminal auth sessions
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES t_users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES t_accounts(id),
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════
-- T_BROKER_SESSIONS — Broker connection lifecycle (Migration 005)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    client_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'expired', 'failed', 'failover')),
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    feed_token TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_RISK_EVENTS — Immutable risk audit trail (Migration 005)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'check_passed', 'check_failed', 'violation', 'breach', 'warning',
        'account_locked', 'daily_loss_limit', 'max_drawdown', 'position_limit',
        'lot_size_exceeded', 'margin_insufficient', 'segment_blocked',
        'trading_hours', 'overnight_block', 'instrument_blocked', 'manual_lock'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'fatal')),
    rule_type TEXT,
    rule_value JSONB,
    actual_value JSONB,
    order_id UUID,
    description TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_CHALLENGE_METRICS — Challenge progress events (Migration 005)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_challenge_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES t_challenges(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'challenge_started', 'challenge_updated', 'challenge_passed',
        'challenge_failed', 'challenge_expired', 'daily_target_hit',
        'profit_target_reached', 'drawdown_warning', 'drawdown_breach',
        'balance_snapshot', 'trading_day_complete', 'milestone_reached'
    )),
    balance_before NUMERIC(15,2),
    balance_after NUMERIC(15,2),
    pnl NUMERIC(12,2),
    pnl_percent NUMERIC(8,4),
    drawdown NUMERIC(12,2),
    drawdown_percent NUMERIC(8,4),
    peak_balance NUMERIC(15,2),
    trading_days_elapsed INTEGER,
    total_trades INTEGER,
    win_rate NUMERIC(5,2),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- T_ORDER_AUDIT — Immutable order lifecycle log (Migration 005)
-- ═══════════════════════════════════════════════════════
CREATE TABLE t_order_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES t_orders(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES t_accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'order_created', 'order_submitted', 'order_accepted', 'order_open',
        'order_partially_filled', 'order_filled', 'order_modified',
        'order_cancelled', 'order_rejected', 'order_expired',
        'position_opened', 'position_updated', 'position_closed', 'position_reversed'
    )),
    previous_status TEXT,
    new_status TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    side TEXT CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER,
    price NUMERIC(12,2),
    filled_qty INTEGER,
    avg_price NUMERIC(12,2),
    broker_order_id TEXT,
    broker_provider TEXT,
    reject_reason TEXT,
    latency_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Indexes

```sql
-- Core table indexes
CREATE INDEX idx_t_accounts_user ON t_accounts(user_id);
CREATE INDEX idx_t_accounts_challenge ON t_accounts(challenge_id);
CREATE INDEX idx_t_orders_account_time ON t_orders(account_id, placed_at DESC);
CREATE INDEX idx_t_orders_status ON t_orders(account_id, status) WHERE status IN ('PENDING', 'OPEN');
CREATE INDEX idx_t_positions_open ON t_positions(account_id) WHERE closed_at IS NULL;
CREATE INDEX idx_t_trades_account_time ON t_trades(account_id, executed_at DESC);
CREATE INDEX idx_t_metrics_account_date ON t_account_metrics(account_id, date DESC);
CREATE INDEX idx_t_sessions_token ON t_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_t_watchlists_user ON t_watchlists(user_id);

-- Audit table indexes
CREATE INDEX idx_broker_sessions_account ON t_broker_sessions(account_id);
CREATE INDEX idx_broker_sessions_provider ON t_broker_sessions(provider, status);
CREATE INDEX idx_broker_sessions_active ON t_broker_sessions(account_id, status) WHERE status = 'connected';
CREATE INDEX idx_risk_events_account ON t_risk_events(account_id, created_at DESC);
CREATE INDEX idx_risk_events_type ON t_risk_events(event_type);
CREATE INDEX idx_risk_events_severity ON t_risk_events(severity) WHERE severity IN ('critical', 'fatal');
CREATE INDEX idx_risk_events_unresolved ON t_risk_events(account_id) WHERE resolved = FALSE;
CREATE INDEX idx_challenge_metrics_challenge ON t_challenge_metrics(challenge_id, created_at DESC);
CREATE INDEX idx_challenge_metrics_account ON t_challenge_metrics(account_id, created_at DESC);
CREATE INDEX idx_order_audit_order ON t_order_audit(order_id, created_at ASC);
CREATE INDEX idx_order_audit_account ON t_order_audit(account_id, created_at DESC);
CREATE INDEX idx_order_audit_today ON t_order_audit(account_id, created_at DESC) WHERE created_at >= CURRENT_DATE;
```

### Risk Rule Types (JSONB values in t_risk_rules)

| rule_type | Example JSONB value |
|-----------|-------------------|
| `daily_loss_limit` | `{"amount": 50000, "percent": 5}` |
| `max_drawdown` | `{"amount": 100000, "percent": 10}` |
| `profit_target` | `{"amount": 100000, "percent": 10}` |
| `max_positions` | `{"count": 10}` |
| `max_lot_size` | `{"nfo": 10, "mcx": 5, "default": 99}` |
| `allowed_segments` | `{"segments": ["NSE", "NFO", "MCX", "CDS"]}` |
| `trading_hours` | `{"start": "09:15", "end": "15:30"}` |
| `no_overnight` | `{"enabled": true, "cutoff": "15:15"}` |
| `max_daily_trades` | `{"count": 50}` |
| `min_trading_days` | `{"count": 10}` |

---

## 2. All Tables

### Summary (14 Tables Total)

| # | Table Name | Purpose | Migration |
|---|-----------|---------|-----------|
| 1 | `t_users` | Users synced from FW Dashboard | 004 |
| 2 | `t_challenges` | Prop firm challenge lifecycle | 004 |
| 3 | `t_accounts` | Trading accounts (one per challenge) | 004 |
| 4 | `t_risk_rules` | Per-account risk rules (JSONB) | 004 |
| 5 | `t_orders` | Trading orders | 004 |
| 6 | `t_positions` | Open & closed positions | 004 |
| 7 | `t_trades` | Trade execution log (immutable) | 004 |
| 8 | `t_watchlists` | User watchlists | 004 |
| 9 | `t_account_metrics` | Daily P&L snapshots | 004 |
| 10 | `t_sessions` | Terminal auth sessions | 004 |
| 11 | `t_broker_sessions` | Broker connection lifecycle audit | 005 |
| 12 | `t_risk_events` | Risk violations & alerts audit | 005 |
| 13 | `t_challenge_metrics` | Challenge progress event log | 005 |
| 14 | `t_order_audit` | Order state transition audit | 005 |

### Entity Relationships

```
t_users
 ├── t_challenges (user_id → t_users.id)
 │    └── t_accounts (challenge_id → t_challenges.id)
 │         ├── t_risk_rules (account_id → t_accounts.id)
 │         ├── t_orders (account_id → t_accounts.id)
 │         │    └── t_order_audit (order_id → t_orders.id)
 │         ├── t_positions (account_id → t_accounts.id)
 │         ├── t_trades (account_id → t_accounts.id, order_id → t_orders.id)
 │         ├── t_account_metrics (account_id → t_accounts.id)
 │         ├── t_broker_sessions (account_id → t_accounts.id)
 │         ├── t_risk_events (account_id → t_accounts.id)
 │         └── t_challenge_metrics (account_id + challenge_id)
 ├── t_watchlists (user_id → t_users.id)
 └── t_sessions (user_id → t_users.id, account_id → t_accounts.id)
```

---

## 3. All Repositories

**Location:** `server/repositories/`  
**Pattern:** All extend `BaseRepository` which wraps `@supabase/supabase-js` service role client  
**Database Client:** `server/db/client.js` (Supabase instance)

### Repository Files

| # | File | Table | Key Methods |
|---|------|-------|-------------|
| 1 | `base.repository.js` | — | `findById`, `findOne`, `findMany`, `insert`, `insertMany`, `update`, `updateWhere`, `delete`, `deleteWhere`, `count` |
| 2 | `user.repository.js` | `t_users` | User CRUD, findByFwUserId |
| 3 | `account.repository.js` | `t_accounts` | `getWithChallenge`, `lockAccount`, `breachAccount`, `completeAccount`, `updatePeakBalance` |
| 4 | `challenge.repository.js` | `t_challenges` | `findByUserId`, `findActiveByUserId`, `findByAccountId`, `markPassed`, `markFailed`, `markExpired`, `getProgress` |
| 5 | `order.repository.js` | `t_orders` | Order CRUD, status queries |
| 6 | `position.repository.js` | `t_positions` | `countOpenPositions`, `getTotalUnrealizedPnl`, open/close position |
| 7 | `trade.repository.js` | `t_trades` | `findTodayTrades`, `countTodayTrades`, `getTodayRealizedPnl` |
| 8 | `watchlist.repository.js` | `t_watchlists` | `findByUserId`, `createWatchlist`, `updateItems`, `updateName`, `updateColor`, `deleteWatchlist` |
| 9 | `risk-rules.repository.js` | `t_risk_rules` | `getRulesMap` (returns all rules for account as key-value map) |
| 10 | `metrics.repository.js` | `t_account_metrics` | `upsertDailyMetrics`, `getTradingDaysCount` |
| 11 | `audit.repository.js` | — | `log` (general audit logging) |
| 12 | `broker-session.repository.js` | `t_broker_sessions` | Broker connection lifecycle persistence |
| 13 | `risk-event.repository.js` | `t_risk_events` | Risk event logging |
| 14 | `challenge-metrics.repository.js` | `t_challenge_metrics` | Challenge progress event storage |
| 15 | `order-audit.repository.js` | `t_order_audit` | Order state transition audit logging |

### BaseRepository CRUD Pattern

```javascript
class BaseRepository {
  constructor(tableName) { this.tableName = tableName; }
  get db() { return supabase; }  // service role — bypasses RLS

  async findById(id)            → single row
  async findOne(filters)        → single row matching filters
  async findMany(filters, opts) → array with ordering/limit
  async insert(record)          → insert + return
  async update(id, updates)     → update + return
  async deleteWhere(filters)    → bulk delete
  async count(filters)          → row count
}
```

---

## 4. Broker Adapters

**Location:** `server/brokers/`  
**Pattern:** Abstract interface + Factory + Provider-specific adapters  
**Live:** Angel One | **Placeholder:** Dhan | **Planned:** Upstox, Shoonya

### File Structure

```
server/brokers/
├── broker.interface.ts           # Abstract base class (IBrokerAdapter)
├── broker.factory.js             # Factory with instance pooling + health
├── broker.factory.ts             # TypeScript interface for factory
├── broker.failover.service.js    # Auto-failover between providers
├── broker.health.service.js      # Health check monitoring
├── broker.manager.js             # Multi-broker lifecycle manager
├── failover.engine.js            # Failover decision engine
├── health.monitor.js             # Periodic health monitoring
├── index.js                      # Barrel export
├── angelone/
│   ├── angelone.adapter.js       # Full REST implementation
│   └── angel.feed.connector.js   # SmartStream WebSocket binary feed
└── dhan/
    ├── dhan.adapter.js           # Placeholder (not implemented)
    └── dhan.types.js             # Type definitions
```

### Broker Interface (Abstract Methods)

```typescript
abstract class BaseBrokerAdapter implements IBrokerAdapter {
  abstract readonly name: string;
  get isConnected(): boolean;

  // Authentication
  abstract connect(credentials: BrokerCredentials): Promise<BrokerSession>;
  abstract disconnect(): Promise<void>;
  abstract refreshSession(): Promise<BrokerSession>;

  // Market Data
  abstract getQuotes(tokens: string[]): Promise<Quote[]>;
  abstract getOHLC(params: OHLCRequest): Promise<OHLC[]>;
  abstract getDepth(token: string): Promise<MarketDepth>;
  abstract getOptionChain(params: OptionChainRequest): Promise<OptionChainEntry[]>;

  // Trading
  abstract placeOrder(order: OrderRequest): Promise<OrderResponse>;
  abstract modifyOrder(orderId: string, params: ModifyOrderRequest): Promise<OrderResponse>;
  abstract cancelOrder(orderId: string): Promise<CancelResponse>;

  // Portfolio
  abstract getPositions(): Promise<Position[]>;
  abstract getOrders(): Promise<Order[]>;
  abstract getTrades(): Promise<Trade[]>;
  abstract getFunds(): Promise<FundsData>;

  // Instruments
  abstract getInstruments(): Promise<Instrument[]>;
  abstract getOptionInstruments(underlying: string, expiry: string): Promise<Instrument[]>;

  // Margin
  abstract getMarginRequired(order: OrderRequest): Promise<{ required: number; available: number }>;

  // Real-time Feed
  abstract subscribeQuotes(tokens: string[], callback: QuoteCallback): void;
  abstract subscribeDepth(tokens: string[], callback: DepthCallback): void;
  abstract unsubscribe(tokens: string[]): void;

  // Callbacks
  abstract onOrderUpdate(callback: (order: Order) => void): void;
}
```

### Angel One Adapter (LIVE)

**File:** `server/brokers/angelone/angelone.adapter.js`  
**API Base:** `https://apiconnect.angelone.in`  
**Auth:** API Key + Client ID + Password + TOTP (via `@otplib/preset-default`)

| Endpoint | SmartAPI Path |
|----------|-------------|
| Login | `POST /rest/auth/angelbroking/user/v1/loginByPassword` |
| Refresh Token | `POST /rest/auth/angelbroking/jwt/v1/generateTokens` |
| Logout | `POST /rest/secure/angelbroking/user/v1/logout` |
| Quotes (LTP/FULL) | `POST /rest/secure/angelbroking/market/v1/quote/` |
| Historical OHLC | `POST /rest/secure/angelbroking/historical/v1/getCandleData` |
| Place Order | `POST /rest/secure/angelbroking/order/v1/placeOrder` |
| Modify Order | `POST /rest/secure/angelbroking/order/v1/modifyOrder` |
| Cancel Order | `POST /rest/secure/angelbroking/order/v1/cancelOrder` |
| Positions | `GET /rest/secure/angelbroking/order/v1/getPosition` |
| Order Book | `GET /rest/secure/angelbroking/order/v1/getOrderBook` |
| Trade Book | `GET /rest/secure/angelbroking/order/v1/getTradeBook` |
| Funds (RMS) | `GET /rest/secure/angelbroking/user/v1/getRMS` |
| Holdings | `GET /rest/secure/angelbroking/portfolio/v1/getHolding` |

**Session Management:**
- JWT token (24h expiry)
- Auto-refresh on 401
- Full reconnect fallback

### Angel Feed Connector (WebSocket)

**File:** `server/brokers/angelone/angel.feed.connector.js`  
**URL:** `wss://smartapisocket.angelone.in/smart-stream`  
**Protocol:** SmartStream V2 (binary)

**Binary Tick Format:**

| Mode | Bytes | Data |
|------|-------|------|
| LTP (mode=1) | 51 | token + LTP |
| Quote (mode=2) | 123 | token + OHLC + volume + bid/ask + circuits + 52w |
| SnapQuote (mode=3) | 379 | token + OHLC + volume + 5-level depth |

**Exchange Type Mapping:**

| Exchange | Code |
|----------|------|
| NSE (Cash) | 1 |
| NFO (F&O) | 2 |
| BSE (Cash) | 3 |
| BFO (BSE F&O) | 4 |
| MCX (Commodity) | 5 |
| CDS (Currency) | 13 |

**Features:**
- Auto-reconnect with exponential backoff (max 10 attempts)
- Heartbeat ping every 25s
- Resubscribe all tokens on reconnect
- Auto re-login on token expiry

### Broker Factory

**File:** `server/brokers/broker.factory.js`

```javascript
BrokerFactory.create(provider, credentials)  → adapter instance
BrokerFactory.get(provider, clientId)        → cached instance
BrokerFactory.disconnect(provider, clientId) → close session
BrokerFactory.disconnectAll()                → shutdown all
BrokerFactory.getHealthReport()              → { provider: status }
```

- Instance pooled by `provider:clientId` key
- Health status tracked per connection
- Available providers read from env vars

---

## 5. Socket Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  BROKER WEBSOCKET FEED                                           │
│  Angel SmartStream (binary)                                      │
│  wss://smartapisocket.angelone.in/smart-stream                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Binary ticks
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  MARKET DATA ENGINE (server/services/marketDataEngine.js)        │
│  pushQuote(token, data)  →  quotes Map  →  publish to EventBus  │
│  pushDepth(token, data)  →  depthCache  →  notify subscribers   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ eventBus.publish('market.tick', ...)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  EVENT BUS (server/events/eventBus.js)                           │
│  Channels: market.tick, order.created, order.updated,            │
│            position.updated, trade.executed,                     │
│            challenge.updated, risk.alert                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  EVENT BRIDGE (server/events/eventBridge.js)                     │
│  Routes bus events → Socket.IO rooms (with throttling)           │
│  global → io.to('quote:{token}')                                │
│  account → io.to('account:{id}')                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  SOCKET.IO SERVER (server/realtime/socketio.server.js)           │
│  Path: /socket.io                                                │
│  Auth: JWT (cookie / handshake / query param)                   │
│  Transports: websocket, polling                                 │
│  Ping: 25s interval / 20s timeout                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  REDIS PUB/SUB (server/realtime/redis.pubsub.js) [OPTIONAL]     │
│  For horizontal scaling across multiple server instances         │
│  Channels: fw:quote:{token}, fw:depth:{token},                  │
│            fw:order:{accountId}, fw:risk:{accountId}             │
└──────────────────────────────────────────────────────────────────┘
```

### Socket.IO Server Details

**File:** `server/realtime/socketio.server.js`

**Authentication:**
- Dev mode: bypass auth (when no SUPABASE_URL)
- Production: JWT from handshake auth → cookie → query param

**Room Structure:**

| Room Pattern | Purpose | Join On |
|------|---------|---------|
| `quote:{token}` | LTP updates for instrument | Client `subscribe` event |
| `depth:{token}` | Market depth updates | Client `subscribe_depth` event |
| `account:{id}` | Order/position/risk updates | Auto-join on connect |

**Client → Server Events:**

| Event | Payload | Action |
|-------|---------|--------|
| `subscribe` | `{ tokens: string[] }` | Join quote rooms, send cached quotes |
| `unsubscribe` | `{ tokens: string[] }` | Leave quote rooms |
| `subscribe_depth` | `{ tokens: string[] }` | Join depth rooms |
| `unsubscribe_depth` | `{ tokens: string[] }` | Leave depth rooms |
| `ping` | — | Respond with `pong` + timestamp |

**Server → Client Events:**

| Event | Payload | Scope |
|-------|---------|-------|
| `quote` | `{ token, data: Quote }` | Room: `quote:{token}` |
| `depth` | `{ token, data: Depth }` | Room: `depth:{token}` |
| `order_update` | `{ data: Order }` | Room: `account:{id}` |
| `position_update` | `{ data: Position }` | Room: `account:{id}` |
| `risk_alert` | `{ data: RiskAlert }` | Room: `account:{id}` |
| `market_status` | `{ status: string }` | All clients |
| `challenge_update` | `{ data: ChallengeProgress }` | Room: `account:{id}` |
| `trade_executed` | `{ data: Trade }` | Room: `account:{id}` |

### Event Bus Channels

**File:** `server/events/channels.js`

| Channel | Required Fields | Scope | WS Event | Throttle |
|---------|----------------|-------|----------|----------|
| `market.tick` | token, ltp, timestamp | global | `quote` | 0ms |
| `order.created` | orderId, symbol, side, qty, orderType | account | `order_update` | 0ms |
| `order.updated` | orderId, status | account | `order_update` | 0ms |
| `position.updated` | symbol, token, qty, pnl | account | `position_update` | 250ms |
| `trade.executed` | tradeId, orderId, symbol, side, qty, price | account | `trade_executed` | 0ms |
| `challenge.updated` | challengeId, status | account | `challenge_update` | 1000ms |
| `risk.alert` | type, ruleType, message | account | `risk_alert` | 5000ms |

### Redis Pub/Sub (Optional — for Scaling)

**File:** `server/realtime/redis.pubsub.js`  
**Required:** `REDIS_URL` env var + `ioredis` package  
**Fallback:** Single-instance mode (no-op) when Redis unavailable

| Redis Channel | Purpose |
|--------------|---------|
| `fw:quote:{token}` | LTP updates across instances |
| `fw:depth:{token}` | Depth updates across instances |
| `fw:order:{accountId}` | Order status sync |
| `fw:risk:{accountId}` | Risk alerts sync |
| `fw:market_status` | Market open/close broadcast |

---

## 6. TradingView Architecture

### Overview

**File:** `server/realtime/tradingview.datafeed.js`  
**Library:** TradingView Charting Library (licensed)  
**Interface:** `IExternalDatafeed` (server-side adapter for REST endpoints)

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND — TradingView Charting Library                         │
│                                                                   │
│  chart.setSymbol('RELIANCE')                                     │
│      │                                                            │
│      ├── resolveSymbol() → GET /api/tv/symbols?symbol=RELIANCE  │
│      ├── getBars()       → GET /api/tv/history?symbol=...       │
│      └── subscribeBars() → Socket.IO quote subscription          │
│                                                                   │
│  Chart Trading (IBrokerConnectionAdapter):                       │
│      ├── placeOrder()    → POST /api/orders/place               │
│      ├── modifyOrder()   → PUT /api/orders/:id/modify           │
│      └── cancelOrder()   → DELETE /api/orders/:id/cancel        │
└─────────────────────────────────────────────────────────────────┘
```

### REST Endpoints (TradingView UDF)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tv/config` | GET | Supported resolutions, exchanges |
| `/api/tv/symbols?symbol=X` | GET | Resolve symbol → SymbolInfo |
| `/api/tv/search?query=X&exchange=Y` | GET | Symbol search |
| `/api/tv/history?symbol=X&resolution=R&from=F&to=T` | GET | Historical OHLCV bars |

### Config Response

```json
{
  "supported_resolutions": ["1", "3", "5", "15", "30", "60", "240", "D", "W", "M"],
  "supports_group_request": false,
  "supports_marks": false,
  "supports_search": true,
  "supports_timescale_marks": false,
  "exchanges": [
    { "value": "NSE", "name": "NSE", "desc": "National Stock Exchange" },
    { "value": "NFO", "name": "NFO", "desc": "NSE Futures & Options" },
    { "value": "MCX", "name": "MCX", "desc": "Multi Commodity Exchange" },
    { "value": "CDS", "name": "CDS", "desc": "Currency Derivatives" }
  ]
}
```

### SymbolInfo Response Shape

```json
{
  "name": "RELIANCE",
  "full_name": "NSE:RELIANCE",
  "description": "Reliance Industries Ltd",
  "type": "stock",
  "session": "0915-1530",
  "exchange": "NSE",
  "timezone": "Asia/Kolkata",
  "format": "price",
  "pricescale": 100,
  "minmov": 1,
  "has_intraday": true,
  "has_daily": true,
  "supported_resolutions": ["1","3","5","15","30","60","240","D","W","M"],
  "volume_precision": 0,
  "data_status": "streaming",
  "token": "2885",
  "segment": "NSE",
  "lotSize": 1,
  "tickSize": 0.05
}
```

### History Response (UDF Format)

```json
{
  "s": "ok",
  "t": [1718700000, 1718700300, 1718700600],
  "o": [2800.5, 2801.0, 2799.5],
  "h": [2802.0, 2803.5, 2801.0],
  "l": [2799.0, 2800.0, 2798.0],
  "c": [2801.0, 2799.5, 2800.0],
  "v": [150000, 200000, 175000]
}
```

### Real-Time Bar Updates (via Socket.IO)

The `TradingViewDatafeed.subscribeBars()` method:
1. Subscribes to `MarketDataEngine` quotes for the instrument token
2. On each tick, builds/updates the current OHLCV bar
3. Fires callback with updated bar (TradingView updates the chart)
4. Bar time is calculated from resolution (aligned to candle boundaries)

**Session Mappings:**

| Segment | Trading Session |
|---------|----------------|
| NSE/BSE | `0915-1530` |
| MCX | `0900-2330` |
| CDS | `0900-1700` |

### Historical Data Source

**File:** `server/services/candleService.js`  
**Source:** Angel One Historical API (`/rest/secure/angelbroking/historical/v1/getCandleData`)

**Supported Timeframes:**

| Resolution | Angel API Interval |
|-----------|-------------------|
| 1 | ONE_MINUTE |
| 3 | THREE_MINUTE |
| 5 | FIVE_MINUTE |
| 15 | FIFTEEN_MINUTE |
| 30 | THIRTY_MINUTE |
| 60 | ONE_HOUR |
| D | ONE_DAY |

---

## 7. Challenge Engine Architecture

### Overview

The Challenge Engine manages the full lifecycle of prop firm trading challenges:
- **Evaluation** → user proves consistent profitability
- **Funded** → user trades with firm capital after passing evaluation

### Engines & Services

| File | Role |
|------|------|
| `server/engines/challenge.engine.ts` | Interface definition (IChallengeEngine) |
| `server/services/challengeService.js` | Full implementation |
| `server/engines/risk.engine.ts` | Interface definition (IRiskEngine) |
| `server/services/riskEngine.js` | Risk rule enforcement |
| `server/engines/trading.engine.ts` | Order routing orchestration |
| `server/engines/position.engine.ts` | Position tracking & MTM |
| `server/engines/reporting.engine.ts` | P&L metrics & reporting |

### Challenge Lifecycle

```
                  ┌─────────────────┐
                  │    ACTIVE       │
                  │  (trading)      │
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐ ┌──────────┐ ┌────────────────┐
│    PASSED       │ │  FAILED  │ │   EXPIRED      │
│ (profit target  │ │ (max DD  │ │ (time limit    │
│  + min days)    │ │  breach) │ │  exceeded)     │
└─────────────────┘ └──────────┘ └────────────────┘

           ACTIVE → LOCKED (daily loss limit hit)
           LOCKED → ACTIVE (next trading day auto-unlock)
```

### Pre-Trade Validation Pipeline

```
User places order
        │
        ▼
┌─────────────────────────────────────┐
│  1. ACCOUNT STATUS CHECK            │
│     Is account 'active'?            │
│     (locked/breached/expired = NO)  │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
┌─────────────────────────────────────┐
│  2. ALLOWED SEGMENTS                │
│     Is segment in allowed list?     │
│     (NSE, NFO, MCX, CDS)           │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
┌─────────────────────────────────────┐
│  3. TRADING HOURS                   │
│     Is current time within          │
│     start-end window? (09:15-15:30) │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
┌─────────────────────────────────────┐
│  4. MAX POSITIONS                   │
│     Would this exceed max open      │
│     positions count?                │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
┌─────────────────────────────────────┐
│  5. MAX LOT SIZE                    │
│     Does qty exceed per-segment     │
│     lot limit?                      │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
┌─────────────────────────────────────┐
│  6. MAX DAILY TRADES                │
│     Has today's trade count         │
│     exceeded limit?                 │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
┌─────────────────────────────────────┐
│  7. DAILY LOSS LIMIT                │
│     Would this order bring          │
│     today's P&L below limit?        │
└───────────────┬─────────────────────┘
                │ PASS
                ▼
        ORDER SENT TO BROKER
```

### Post-Trade Evaluation

After every fill, the risk engine runs:

```
Trade filled
    │
    ├── Calculate today's realized P&L (FIFO method)
    ├── Calculate unrealized P&L from open positions
    ├── Total daily P&L = realized + unrealized
    │
    ├── CHECK: Daily loss limit breached?
    │   YES → Lock account (trading disabled for today)
    │         → Publish risk.alert event
    │         → Publish challenge.updated (status: locked)
    │
    ├── CHECK: Max drawdown breached? (peak balance - current equity)
    │   YES → Breach account (challenge FAILED permanently)
    │         → Publish risk.alert event
    │         → Publish challenge.updated (status: breached)
    │
    ├── CHECK: Profit target reached? (current P&L >= target)
    │   YES → Publish challenge.updated (status: target_reached)
    │         → ChallengeService.checkTransitions() → mark PASSED
    │
    └── UPDATE: Peak balance (if current equity > peak)
```

### Challenge Service Methods

```javascript
ChallengeService.getProgress(accountId)        → Full progress object
ChallengeService.checkTransitions(accountId)   → Auto-transition check
ChallengeService.unlockIfEligible(accountId)   → Daily unlock for daily-loss locks
ChallengeService.dailyCheck(accountId)         → Start-of-day routine
```

### Progress Response Shape

```json
{
  "challengeId": "uuid",
  "type": "evaluation",
  "plan": "10K",
  "status": "active",
  "initialBalance": 1000000,
  "currentBalance": 1045000,
  "peakBalance": 1050000,
  "pnl": 45000,
  "pnlPercent": 4.5,
  "drawdown": 5000,
  "drawdownPercent": 0.48,
  "tradingDays": 7,
  "targets": {
    "profitTarget": 100000,
    "profitProgress": 45,
    "maxDrawdown": 100000,
    "drawdownUsed": 5,
    "minTradingDays": 10,
    "tradingDaysProgress": 70
  },
  "startedAt": "2026-06-01T09:15:00Z",
  "expiresAt": "2026-07-01T15:30:00Z",
  "accountStatus": "active"
}
```

### Cron Jobs

| Script | Schedule | Action |
|--------|----------|--------|
| `npm run daily-checks` | Start of trading day | Unlock daily-loss-locked accounts, check expiry |
| `npm run eod-metrics` | End of trading day | Snapshot account_metrics, calculate daily P&L |

### Event Flow on Challenge Transition

```
RiskEngine.postTradeCheck()
    │
    ├── eventBus.publish('risk.alert', {...})
    │       └── EventBridge → Socket.IO → account:{id} room
    │
    ├── eventBus.publish('challenge.updated', {...})
    │       └── EventBridge → Socket.IO → account:{id} room
    │
    └── Database updates:
        ├── accountRepo.lockAccount() / breachAccount()
        ├── challengeRepo.markFailed() / markPassed()
        └── auditRepo.log({...})
```

---

## Appendix: Services Layer

| File | Purpose |
|------|---------|
| `server/services/accountService.js` | Account operations (place/modify/cancel orders, positions, trades) |
| `server/services/auth.service.js` | JWT creation/verification |
| `server/services/brokerService.js` | Broker lifecycle management |
| `server/services/candleService.js` | Historical OHLC from Angel One API |
| `server/services/challengeService.js` | Challenge lifecycle management |
| `server/services/depthService.js` | Market depth fetching |
| `server/services/eventDispatcher.js` | Event routing helper |
| `server/services/instrumentService.js` | Instrument master search/lookup |
| `server/services/marketDataEngine.js` | Quote/depth cache + event publishing |
| `server/services/optionChainService.js` | Option chain aggregation |
| `server/services/riskEngine.js` | Pre/post-trade risk checks |
| `server/services/session.service.js` | Session management |
| `server/services/sso.service.js` | SSO token validation with FW Dashboard |

## Appendix: Dependencies

```json
{
  "@otplib/preset-default": "^12.0.1",
  "@supabase/supabase-js": "^2.108.2",
  "axios": "^1.18.0",
  "cors": "^2.8.5",
  "dotenv": "^16.4.5",
  "express": "^4.19.2",
  "ioredis": "^5.4.1",
  "jsonwebtoken": "^9.0.3",
  "pg": "^8.21.0",
  "socket.io": "^4.8.3",
  "ws": "^8.17.1"
}
```

## Appendix: Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (bypasses RLS) |
| `REDIS_URL` | Redis connection (optional, for scaling) |
| `ANGEL_API_KEY` | Angel One API key |
| `ANGEL_CLIENT_ID` | Angel One client code |
| `ANGEL_PASSWORD` | Angel One password |
| `ANGEL_TOTP_SECRET` | TOTP secret for 2FA |
| `DHAN_ACCESS_TOKEN` | Dhan API token (placeholder) |
| `DHAN_CLIENT_ID` | Dhan client ID (placeholder) |
| `JWT_SECRET` | Terminal session JWT signing key |
| `SSO_DASHBOARD_URL` | FW Dashboard SSO validation endpoint |
