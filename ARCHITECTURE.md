# FundedWealth Terminal — Production Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FUNDEDWEALTH DASHBOARD                            │
│                    (Existing Application)                            │
│                                                                     │
│   User logs in → Manages Challenges → Click "Open Terminal" →       │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ SSO Token (JWT)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FUNDEDWEALTH TERMINAL                             │
│                    terminal.fundedwealth.com                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      FRONTEND (React)                         │   │
│  │  TradingView Chart │ Watchlist │ Order Panel │ Positions      │   │
│  │  Option Chain │ Market Depth │ Trade Book                     │   │
│  └────────────────────────┬─────────────────────────────────────┘   │
│                           │ REST + WebSocket                         │
│  ┌────────────────────────▼─────────────────────────────────────┐   │
│  │                      BACKEND (Node.js)                        │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │   │
│  │  │ Auth Layer  │  │ Trading      │  │ Market Data      │    │   │
│  │  │ (SSO/JWT)   │  │ Engine       │  │ Engine           │    │   │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘    │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │   │
│  │  │ Risk Engine │  │ Position     │  │ Challenge Rules  │    │   │
│  │  │             │  │ Engine       │  │ Engine           │    │   │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘    │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │   │
│  │  │ Reporting   │  │ WebSocket    │  │ Broker Adapter   │    │   │
│  │  │ Engine      │  │ Server       │  │ Layer            │    │   │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘    │   │
│  │                                                               │   │
│  └───────┬──────────────────┬───────────────────┬───────────────┘   │
│          │                  │                   │                    │
│  ┌───────▼──────┐  ┌───────▼───────┐  ┌───────▼───────────────┐   │
│  │  Supabase    │  │    Redis      │  │   Broker APIs          │   │
│  │  PostgreSQL  │  │    Cache      │  │   (Angel/Dhan/etc)     │   │
│  └──────────────┘  └───────────────┘  └────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
fundedwealth-terminal/
├── public/
│   └── logo.png                          # FundedWealth logo
│
├── src/                                   # FRONTEND
│   ├── main.tsx                           # React entry
│   ├── App.tsx                            # Layout shell
│   │
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── Watchlist.tsx
│   │   ├── ChartPanel.tsx
│   │   ├── OrderPanel.tsx
│   │   ├── BottomPanel.tsx
│   │   ├── MarketDepthPanel.tsx
│   │   ├── OptionChainModal.tsx
│   │   └── SearchModal.tsx
│   │
│   ├── hooks/
│   │   ├── useHotkeys.ts
│   │   ├── useMarketData.ts
│   │   └── useAuth.ts                    # SSO session hook
│   │
│   ├── services/
│   │   ├── api.ts                         # REST client
│   │   └── websocket.ts                   # WS client
│   │
│   ├── store/
│   │   ├── appStore.ts
│   │   ├── marketStore.ts
│   │   └── tradingStore.ts
│   │
│   ├── types/
│   │   ├── index.ts                       # Domain types
│   │   ├── market.ts                      # Market data types
│   │   ├── trading.ts                     # Order/position types
│   │   ├── account.ts                     # User/challenge types
│   │   └── broker.ts                      # Broker interface types
│   │
│   ├── utils/
│   │   └── helpers.ts
│   │
│   └── styles/
│       └── index.css
│
├── server/                                # BACKEND
│   ├── index.ts                           # Express entry
│   │
│   ├── config/
│   │   ├── env.ts                         # Environment vars
│   │   └── constants.ts                   # Trading constants
│   │
│   ├── middleware/
│   │   ├── auth.ts                        # JWT validation
│   │   ├── rateLimit.ts                   # Rate limiting
│   │   └── errorHandler.ts               # Global error handler
│   │
│   ├── routes/
│   │   ├── auth.routes.ts                 # SSO endpoints
│   │   ├── account.routes.ts              # Account/challenge
│   │   ├── market.routes.ts               # Market data
│   │   ├── trading.routes.ts              # Orders/positions
│   │   └── websocket.ts                   # WS handler
│   │
│   ├── engines/
│   │   ├── trading.engine.ts              # Order routing
│   │   ├── position.engine.ts             # Position tracking
│   │   ├── risk.engine.ts                 # Pre-trade risk checks
│   │   ├── challenge.engine.ts            # Challenge rules
│   │   ├── marketdata.engine.ts           # Quote aggregation
│   │   └── reporting.engine.ts            # P&L, metrics
│   │
│   ├── brokers/
│   │   ├── broker.interface.ts            # Abstract interface
│   │   ├── broker.factory.ts              # Provider factory
│   │   ├── angelone/
│   │   │   ├── angelone.adapter.ts        # Angel One implementation
│   │   │   ├── angelone.auth.ts           # TOTP + login
│   │   │   ├── angelone.websocket.ts      # SmartConnect
│   │   │   └── angelone.types.ts          # Angel-specific types
│   │   ├── dhan/
│   │   │   ├── dhan.adapter.ts
│   │   │   ├── dhan.auth.ts
│   │   │   ├── dhan.websocket.ts
│   │   │   └── dhan.types.ts
│   │   ├── upstox/
│   │   │   ├── upstox.adapter.ts
│   │   │   └── upstox.types.ts
│   │   └── shoonya/
│   │       ├── shoonya.adapter.ts
│   │       └── shoonya.types.ts
│   │
│   ├── services/
│   │   ├── instrument.service.ts          # Instrument master
│   │   ├── optionchain.service.ts         # OC aggregation
│   │   └── cache.service.ts               # Redis wrapper
│   │
│   ├── db/
│   │   ├── client.ts                      # Supabase client
│   │   ├── schema.sql                     # Full DDL
│   │   └── migrations/                    # Schema migrations
│   │
│   └── types/
│       └── index.ts                       # Server-side types
│
├── docker-compose.yml
├── Dockerfile.frontend
├── Dockerfile.backend
├── nginx.conf
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── ARCHITECTURE.md                        # This file
```

---

## Authentication & SSO Flow

```
User in FW Dashboard
        │
        │ Click "Open Terminal"
        ▼
Dashboard generates short-lived SSO token
        │
        │ Redirect: terminal.fundedwealth.com?token=<sso_token>
        ▼
Terminal Backend validates token with FW Dashboard API
        │
        │ Returns session JWT (terminal-scoped)
        ▼
Terminal Frontend stores JWT in httpOnly cookie
        │
        │ All subsequent requests use this JWT
        ▼
JWT contains: { userId, accountId, challengeId, permissions }
```

**No separate login page on Terminal.** 
User is always authenticated via FW Dashboard SSO.

---

## Account System

```
User (FW Dashboard)
 │
 ├── Challenge: FW-10K
 │    ├── Trading Account: FW-10001
 │    │    ├── Balance: ₹10,00,000
 │    │    ├── Daily Loss Limit: ₹50,000 (5%)
 │    │    ├── Max Drawdown: ₹1,00,000 (10%)
 │    │    ├── Profit Target: ₹1,00,000 (10%)
 │    │    ├── Max Positions: 10
 │    │    ├── Allowed Segments: [NSE, NFO, MCX, CDS]
 │    │    ├── Trading Hours: 9:15 - 15:30
 │    │    └── Status: ACTIVE
 │    │
 │    └── Broker Mapping: Angel One (Client: ABC123)
 │
 └── Challenge: FW-25K
      ├── Trading Account: FW-10002
      │    ├── Balance: ₹25,00,000
      │    └── ...rules...
      └── Broker Mapping: Dhan (Client: XYZ456)
```

---

## Trading Engine Architecture

```
User places order
        │
        ▼
┌─────────────────────────┐
│   Risk Engine           │  ← Pre-trade checks
│   - Daily loss limit    │
│   - Max drawdown        │
│   - Position limits     │
│   - Segment allowed?    │
│   - Market hours?       │
│   - Sufficient margin?  │
└───────────┬─────────────┘
            │ PASS / REJECT
            ▼
┌─────────────────────────┐
│   Challenge Rules       │  ← Prop firm rules
│   - Max lot size        │
│   - Allowed instruments │
│   - No overnight?       │
│   - News trading?       │
└───────────┬─────────────┘
            │ PASS / REJECT
            ▼
┌─────────────────────────┐
│   Trading Engine        │  ← Route to broker
│   - Select broker       │
│   - Format order        │
│   - Send to exchange    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Broker Adapter        │  ← Angel/Dhan/Upstox
│   - placeOrder()        │
│   - Returns orderId     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Position Engine       │  ← Update state
│   - Update positions    │
│   - Update margin       │
│   - Update P&L          │
│   - Check limits        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Reporting Engine      │  ← Persist
│   - Log trade           │
│   - Update metrics      │
│   - Check targets       │
└─────────────────────────┘
```

---

## Market Data Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                   BROKER WEBSOCKET FEEDS                        │
│                                                                 │
│  Angel One SmartConnect    Dhan Market Feed    (Backup)         │
│  wss://smartapisocket...   wss://api-feed...                   │
└──────────────┬────────────────────┬────────────────────────────┘
               │                    │
               ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              MARKET DATA ENGINE                       │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Tick Parser │  │ OHLC Builder │  │ Depth      │  │
│  │ (Binary)    │  │ (Candles)    │  │ Aggregator │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                │         │
│         ▼                 ▼                ▼         │
│  ┌─────────────────────────────────────────────┐    │
│  │              REDIS CACHE                     │    │
│  │  quotes:{token} │ depth:{token} │ ohlc:...  │    │
│  └─────────────────────────┬───────────────────┘    │
│                            │                         │
└────────────────────────────┼─────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────┐
│              WEBSOCKET SERVER                         │
│                                                       │
│  Client subscribes to tokens                          │
│  Server pushes: quote | depth | ohlc | status        │
│                                                       │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│              FRONTEND (Browser)                       │
│                                                       │
│  Watchlist LTP │ Chart Candles │ Depth │ OC Prices   │
└─────────────────────────────────────────────────────┘
```

**Supported Data Types:**

| Segment | Quotes | OHLC | Depth | Option Chain |
|---------|--------|------|-------|--------------|
| NSE Equity | ✓ | ✓ | ✓ | — |
| NSE Futures | ✓ | ✓ | ✓ | — |
| NSE Options | ✓ | ✓ | ✓ | ✓ |
| MCX Commodity | ✓ | ✓ | ✓ | — |
| CDS Currency | ✓ | ✓ | ✓ | — |
| BSE | ✓ | ✓ | ✓ | — |

---

## Broker Adapter Architecture

```
┌──────────────────────────────────────────────────────┐
│                  BROKER INTERFACE                      │
│                                                        │
│  connect()          → Authenticate with broker         │
│  disconnect()       → Close session                    │
│                                                        │
│  getQuotes(tokens)  → Subscribe to live quotes         │
│  getOHLC(params)    → Historical candle data           │
│  getDepth(token)    → 5-level order book               │
│  getOptionChain()   → OC for underlying+expiry         │
│                                                        │
│  placeOrder(order)  → Send order to exchange           │
│  modifyOrder(id,p)  → Modify pending order             │
│  cancelOrder(id)    → Cancel pending order             │
│                                                        │
│  getPositions()     → Current positions                │
│  getOrders()        → Order book                       │
│  getTrades()        → Trade book                       │
│  getFunds()         → Available margin/balance         │
│                                                        │
│  getInstruments()   → Full instrument master           │
└──────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│Angel One │   │  Dhan    │   │ Upstox   │   │ Shoonya  │
│ Adapter  │   │ Adapter  │   │ Adapter  │   │ Adapter  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
```

**Terminal never calls broker directly.** Always goes through adapter.

---

## TradingView Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                TRADINGVIEW CHARTING LIBRARY                   │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Datafeed Adapter (implements IExternalDatafeed)       │  │
│  │                                                         │  │
│  │  onReady()           → supported resolutions            │  │
│  │  searchSymbols()     → instrument search                │  │
│  │  resolveSymbol()     → symbol info                      │  │
│  │  getBars()           → historical OHLCV                 │  │
│  │  subscribeBars()     → real-time updates                │  │
│  │  unsubscribeBars()   → cleanup                         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Trading Adapter (implements IBrokerConnectionAdapter) │  │
│  │                                                         │  │
│  │  placeOrder()        → chart trading                    │  │
│  │  modifyOrder()       → drag order lines                 │  │
│  │  cancelOrder()       → click X on order line            │  │
│  │  positions()         → show position lines              │  │
│  │  orders()            → show pending orders              │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  Features:                                                    │
│  - 100+ indicators (built-in)                                │
│  - Drawing tools (50+)                                       │
│  - Multi-chart layouts                                       │
│  - Compare symbols                                           │
│  - Chart trading (order/position lines)                      │
│  - Custom timeframes                                         │
│  - Replay mode                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema (Supabase PostgreSQL)

```sql
-- Users (synced from FW Dashboard)
CREATE TABLE users (
    id UUID PRIMARY KEY,
    fw_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trading Accounts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    account_code TEXT UNIQUE NOT NULL,        -- e.g. FW-10001
    challenge_id UUID REFERENCES challenges(id),
    broker_provider TEXT NOT NULL,            -- 'angelone' | 'dhan' | etc
    broker_client_id TEXT,                    -- broker's client ID
    broker_credentials JSONB,                 -- encrypted
    balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active',             -- active | breached | completed
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenges (prop firm rules)
CREATE TABLE challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    type TEXT NOT NULL,                       -- 'evaluation' | 'funded'
    plan TEXT NOT NULL,                       -- '10K' | '25K' | '50K'
    initial_balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- Risk Rules per account
CREATE TABLE risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    rule_type TEXT NOT NULL,
    -- Rule types:
    -- 'daily_loss_limit' | 'max_drawdown' | 'profit_target'
    -- 'max_positions' | 'max_lot_size' | 'allowed_segments'
    -- 'trading_hours' | 'no_overnight' | 'news_blackout'
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    side TEXT NOT NULL,                       -- 'BUY' | 'SELL'
    order_type TEXT NOT NULL,                 -- 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
    product_type TEXT NOT NULL,              -- 'MIS' | 'CNC' | 'NRML'
    qty INTEGER NOT NULL,
    price NUMERIC(12,2),
    trigger_price NUMERIC(12,2),
    filled_qty INTEGER DEFAULT 0,
    avg_price NUMERIC(12,2),
    status TEXT NOT NULL,                     -- 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED'
    reject_reason TEXT,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Positions
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    product_type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    ltp NUMERIC(12,2),
    pnl NUMERIC(12,2),
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Trades (execution log)
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    order_id UUID REFERENCES orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    side TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlists
CREATE TABLE watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    color TEXT,
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Account Metrics (daily snapshot)
CREATE TABLE account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    date DATE NOT NULL,
    starting_balance NUMERIC(15,2),
    ending_balance NUMERIC(15,2),
    realized_pnl NUMERIC(12,2),
    unrealized_pnl NUMERIC(12,2),
    total_trades INTEGER,
    winning_trades INTEGER,
    losing_trades INTEGER,
    max_drawdown NUMERIC(12,2),
    daily_loss NUMERIC(12,2),
    UNIQUE(account_id, date)
);

-- Indexes
CREATE INDEX idx_orders_account ON orders(account_id, placed_at DESC);
CREATE INDEX idx_positions_account ON positions(account_id) WHERE closed_at IS NULL;
CREATE INDEX idx_trades_account ON trades(account_id, executed_at DESC);
CREATE INDEX idx_metrics_account_date ON account_metrics(account_id, date DESC);
```

---

## WebSocket Architecture

```
CLIENT → SERVER Messages:
{
  type: 'subscribe',
  tokens: ['2885', '99926000']
}
{
  type: 'unsubscribe',
  tokens: ['2885']
}
{
  type: 'subscribe_depth',
  tokens: ['2885']
}
{
  type: 'subscribe_oc',
  symbol: 'NIFTY',
  expiry: '2026-06-25'
}

SERVER → CLIENT Messages:
{
  type: 'quote',
  token: '2885',
  data: { ltp, open, high, low, close, volume, change, changePercent, bid, ask, oi, timestamp }
}
{
  type: 'depth',
  token: '2885',
  data: { bids: [{price,qty,orders}], asks: [{price,qty,orders}], totalBuyQty, totalSellQty }
}
{
  type: 'order_update',
  data: { orderId, status, filledQty, avgPrice, ... }
}
{
  type: 'position_update',
  data: { symbol, qty, ltp, pnl, ... }
}
{
  type: 'risk_alert',
  data: { type: 'daily_loss_warning', current: -40000, limit: -50000, percent: 80 }
}
{
  type: 'market_status',
  status: 'OPEN' | 'CLOSED' | 'PRE_OPEN' | 'POST_CLOSE'
}
```

---

## Challenge Rules Engine

```
Per-Account Rules Evaluated:

BEFORE every order:
├── Is market open?
├── Is segment allowed for this account?
├── Is instrument tradeable?
├── Does qty exceed max lot size?
├── Would this exceed max positions?
├── Would this exceed daily loss limit?
├── Would this breach max drawdown?
├── Is there sufficient margin?
└── Is overnight holding allowed? (if near close)

AFTER every trade:
├── Update realized P&L
├── Check if profit target hit → CHALLENGE PASSED
├── Check if daily loss limit hit → LOCK ACCOUNT
├── Check if max drawdown hit → CHALLENGE FAILED
├── Update account_metrics
└── Send risk_alert if approaching limits

DAILY at market close:
├── Square off all MIS positions (if auto-square-off enabled)
├── Calculate daily P&L
├── Snapshot account_metrics
└── Check challenge expiry
```

---

## Phase Execution Plan

| Phase | Scope | Depends On |
|-------|-------|------------|
| **Phase 1** (Current) | Architecture + Interfaces + Types | — |
| **Phase 2** | Supabase Integration (DB + Auth) | Phase 1 |
| **Phase 3** | Angel One Adapter (Auth + Market Data + Orders) | Phase 2 |
| **Phase 4** | Dhan Adapter (Backup feed) | Phase 2 |
| **Phase 5** | TradingView Charting Library | Phase 3 |
| **Phase 6** | Risk Engine + Challenge Rules | Phase 3 |
| **Phase 7** | Reporting + Metrics | Phase 6 |
| **Phase 8** | Upstox/Shoonya Adapters | Phase 3 |
