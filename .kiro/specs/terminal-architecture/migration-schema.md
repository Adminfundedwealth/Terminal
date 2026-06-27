# Final Migration Schema — Reference Only

## DO NOT EXECUTE. This is the architectural reference for the migration SQL.

---

## Table: terminal_accounts

```sql
CREATE TABLE terminal_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    account_code TEXT UNIQUE NOT NULL,
    challenge_id UUID NOT NULL,  -- FK added after terminal_challenges exists
    broker_provider TEXT NOT NULL DEFAULT 'angelone'
        CHECK (broker_provider IN ('angelone', 'dhan', 'upstox', 'shoonya')),
    broker_client_id TEXT,
    balance NUMERIC(15,2) NOT NULL,
    peak_balance NUMERIC(15,2),
    daily_loss_limit NUMERIC(15,2),
    max_drawdown NUMERIC(15,2),
    profit_target NUMERIC(15,2),
    payout_eligible BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'locked', 'breached', 'completed', 'expired')),
    locked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_accounts_user ON terminal_accounts(user_id);
CREATE INDEX idx_terminal_accounts_status ON terminal_accounts(status) WHERE status = 'active';
```

## Table: terminal_challenges

```sql
CREATE TABLE terminal_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('evaluation', 'funded')),
    phase TEXT CHECK (phase IN ('phase_1', 'phase_2', 'funded')),
    plan TEXT NOT NULL,
    initial_balance NUMERIC(15,2) NOT NULL,
    status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'passed', 'failed', 'expired', 'breached')),
    min_trading_days INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    fail_reason TEXT,
    previous_challenge_id UUID REFERENCES terminal_challenges(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE terminal_accounts
    ADD CONSTRAINT fk_terminal_accounts_challenge
    FOREIGN KEY (challenge_id) REFERENCES terminal_challenges(id);

CREATE INDEX idx_terminal_challenges_user ON terminal_challenges(user_id);
CREATE INDEX idx_terminal_challenges_active ON terminal_challenges(user_id, status)
    WHERE status = 'active';
```

## Table: terminal_risk_rules

```sql
CREATE TABLE terminal_risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, rule_type)
);

CREATE INDEX idx_terminal_risk_rules_account ON terminal_risk_rules(account_id)
    WHERE is_active = TRUE;
```

## Table: terminal_orders

```sql
CREATE TABLE terminal_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
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
    status TEXT NOT NULL
        CHECK (status IN ('PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'REJECTED')),
    reject_reason TEXT,
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_orders_account ON terminal_orders(account_id, placed_at DESC);
CREATE INDEX idx_terminal_orders_open ON terminal_orders(account_id, status)
    WHERE status IN ('PENDING', 'OPEN');
```

## Table: terminal_positions

```sql
CREATE TABLE terminal_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    product_type TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    avg_price NUMERIC(12,2) NOT NULL,
    exit_price NUMERIC(12,2),
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Prevent duplicate open positions for same instrument
CREATE UNIQUE INDEX idx_terminal_positions_unique_open
    ON terminal_positions (account_id, token, product_type)
    WHERE status = 'open';

CREATE INDEX idx_terminal_positions_open
    ON terminal_positions(account_id) WHERE status = 'open';
```

## Table: terminal_trades

```sql
CREATE TABLE terminal_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    order_id UUID REFERENCES terminal_orders(id),
    symbol TEXT NOT NULL,
    token TEXT NOT NULL,
    segment TEXT NOT NULL,
    exchange TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    qty INTEGER NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_trades_account ON terminal_trades(account_id, executed_at DESC);
CREATE INDEX idx_terminal_trades_today ON terminal_trades(account_id, executed_at)
    WHERE executed_at >= CURRENT_DATE;
```

## Table: terminal_sessions

```sql
CREATE TABLE terminal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    account_id UUID REFERENCES terminal_accounts(id),
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_terminal_sessions_token
    ON terminal_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_terminal_sessions_user
    ON terminal_sessions(user_id) WHERE revoked_at IS NULL;
```

## Table: terminal_watchlists

```sql
CREATE TABLE terminal_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2962ff',
    items JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_watchlists_user ON terminal_watchlists(user_id);
```

## Table: terminal_account_metrics

```sql
CREATE TABLE terminal_account_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
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

CREATE INDEX idx_terminal_metrics_account ON terminal_account_metrics(account_id, date DESC);
```

## Table: terminal_audit_log

```sql
CREATE TABLE terminal_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID,
    user_id UUID,
    event_type TEXT NOT NULL,
    event_data JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_audit_account ON terminal_audit_log(account_id, created_at DESC);
CREATE INDEX idx_terminal_audit_type ON terminal_audit_log(event_type);
```

## Table: terminal_risk_events

```sql
CREATE TABLE terminal_risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical', 'fatal')),
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

CREATE INDEX idx_terminal_risk_events_account
    ON terminal_risk_events(account_id, created_at DESC);
CREATE INDEX idx_terminal_risk_events_unresolved
    ON terminal_risk_events(account_id) WHERE resolved = FALSE;
```

## Table: terminal_order_audit

```sql
CREATE TABLE terminal_order_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES terminal_orders(id),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    event_type TEXT NOT NULL,
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

CREATE INDEX idx_terminal_order_audit_order
    ON terminal_order_audit(order_id, created_at ASC);
CREATE INDEX idx_terminal_order_audit_account
    ON terminal_order_audit(account_id, created_at DESC);
```

## Table: terminal_broker_sessions

```sql
CREATE TABLE terminal_broker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES terminal_accounts(id),
    provider TEXT NOT NULL,
    client_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected',
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    feed_token TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_terminal_broker_sessions_active
    ON terminal_broker_sessions(provider, status) WHERE status = 'connected';
```

## Table: terminal_challenge_metrics

```sql
CREATE TABLE terminal_challenge_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES terminal_challenges(id),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    event_type TEXT NOT NULL,
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

CREATE INDEX idx_terminal_challenge_metrics_challenge
    ON terminal_challenge_metrics(challenge_id, created_at DESC);
```

## Table: terminal_payouts

```sql
CREATE TABLE terminal_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES terminal_accounts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    challenge_id UUID NOT NULL REFERENCES terminal_challenges(id),
    net_profit NUMERIC(15,2) NOT NULL,
    payout_amount NUMERIC(15,2) NOT NULL,
    firm_amount NUMERIC(15,2) NOT NULL,
    trader_split NUMERIC(4,3) NOT NULL DEFAULT 0.800,
    plan TEXT NOT NULL,
    trading_days INTEGER NOT NULL,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rejected_reason TEXT
);

CREATE INDEX idx_terminal_payouts_account ON terminal_payouts(account_id);
CREATE INDEX idx_terminal_payouts_pending ON terminal_payouts(status)
    WHERE status IN ('pending', 'processing');
```

---

## Triggers (apply to all terminal tables with updated_at)

```sql
CREATE OR REPLACE FUNCTION terminal_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_terminal_accounts_updated
    BEFORE UPDATE ON terminal_accounts
    FOR EACH ROW EXECUTE FUNCTION terminal_update_timestamp();

CREATE TRIGGER trg_terminal_orders_updated
    BEFORE UPDATE ON terminal_orders
    FOR EACH ROW EXECUTE FUNCTION terminal_update_timestamp();

CREATE TRIGGER trg_terminal_watchlists_updated
    BEFORE UPDATE ON terminal_watchlists
    FOR EACH ROW EXECUTE FUNCTION terminal_update_timestamp();
```

---

## Row Level Security

```sql
-- Enable RLS on all terminal tables
ALTER TABLE terminal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_account_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_order_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_broker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_challenge_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_payouts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS. No client-side access needed.
```

---

## Table Count: 15 terminal-owned tables

| # | Table | Purpose |
|---|---|---|
| 1 | terminal_accounts | Trading accounts (balance, status) |
| 2 | terminal_challenges | Challenge lifecycle (phase, pass/fail) |
| 3 | terminal_risk_rules | Per-account JSONB rules |
| 4 | terminal_orders | Trading order book |
| 5 | terminal_positions | Open/closed positions |
| 6 | terminal_trades | Execution log (immutable) |
| 7 | terminal_sessions | Terminal JWT sessions |
| 8 | terminal_watchlists | User watchlists |
| 9 | terminal_account_metrics | Daily P&L snapshots |
| 10 | terminal_audit_log | All events |
| 11 | terminal_risk_events | Risk violations |
| 12 | terminal_order_audit | Order state transitions |
| 13 | terminal_broker_sessions | Broker connection lifecycle |
| 14 | terminal_challenge_metrics | Challenge milestones |
| 15 | terminal_payouts | Payout requests |
