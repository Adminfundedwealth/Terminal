-- Fix: positions unique constraint (WHERE clause not valid in UNIQUE CONSTRAINT, use partial index)
-- Drop and recreate if the constraint is wrong

-- Fix positions table constraint
ALTER TABLE positions DROP CONSTRAINT IF EXISTS unique_open_position;
CREATE UNIQUE INDEX IF NOT EXISTS unique_open_position ON positions(trading_account_id, token, product_type) WHERE (is_open = TRUE);

-- Fix: executions table references
-- Verify executions has all columns
ALTER TABLE executions ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id);
ALTER TABLE executions ADD COLUMN IF NOT EXISTS broker_trade_id TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS exchange_timestamp TIMESTAMPTZ;

-- Fix: execution_audits references
ALTER TABLE execution_audits ADD COLUMN IF NOT EXISTS execution_id UUID REFERENCES executions(id);

-- Fix: journal_entries references  
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS execution_id UUID REFERENCES executions(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id);

-- Indexes that failed due to IMMUTABLE requirement
-- Fix: cast to date using explicit cast instead of ::date
CREATE INDEX IF NOT EXISTS idx_orders_placed_date ON trading_orders(trading_account_id, (placed_at AT TIME ZONE 'UTC'));
CREATE INDEX IF NOT EXISTS idx_executions_date ON executions(trading_account_id, (executed_at AT TIME ZONE 'UTC'));

-- Indexes on positions
CREATE INDEX IF NOT EXISTS idx_positions_open ON positions(trading_account_id) WHERE is_open = TRUE;
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol, trading_account_id) WHERE is_open = TRUE;
CREATE INDEX IF NOT EXISTS idx_positions_closed ON positions(trading_account_id, closed_at DESC) WHERE is_open = FALSE;

-- Indexes on executions
CREATE INDEX IF NOT EXISTS idx_executions_account_time ON executions(trading_account_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_order ON executions(order_id);
CREATE INDEX IF NOT EXISTS idx_executions_position ON executions(position_id);
CREATE INDEX IF NOT EXISTS idx_executions_symbol ON executions(symbol, trading_account_id);

-- Indexes on execution_audits
CREATE INDEX IF NOT EXISTS idx_audits_account ON execution_audits(trading_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_order ON execution_audits(order_id);
CREATE INDEX IF NOT EXISTS idx_audits_type ON execution_audits(audit_type, trading_account_id);
CREATE INDEX IF NOT EXISTS idx_audits_failed ON execution_audits(trading_account_id) WHERE all_passed = FALSE;

-- Indexes on journal_entries
CREATE INDEX IF NOT EXISTS idx_journal_trader ON journal_entries(trader_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_entries(trading_account_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_symbol ON journal_entries(symbol, trader_id);
CREATE INDEX IF NOT EXISTS idx_journal_emotion ON journal_entries(emotion, trader_id);
CREATE INDEX IF NOT EXISTS idx_journal_rating ON journal_entries(rating, trader_id);
CREATE INDEX IF NOT EXISTS idx_journal_tags ON journal_entries USING GIN(tags);

-- RLS on positions, executions, execution_audits, journal_entries
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

-- RLS policies for positions
DROP POLICY IF EXISTS positions_own_read ON positions;
CREATE POLICY positions_own_read ON positions
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );

-- RLS policies for executions
DROP POLICY IF EXISTS executions_own_read ON executions;
CREATE POLICY executions_own_read ON executions
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );

-- RLS policies for execution_audits
DROP POLICY IF EXISTS audits_own_read ON execution_audits;
CREATE POLICY audits_own_read ON execution_audits
    FOR SELECT USING (
        trading_account_id IN (
            SELECT id FROM trading_accounts WHERE trader_id = auth.uid()
        )
    );

-- RLS policies for journal_entries
DROP POLICY IF EXISTS journal_own_all ON journal_entries;
CREATE POLICY journal_own_all ON journal_entries
    FOR ALL USING (trader_id = auth.uid());
