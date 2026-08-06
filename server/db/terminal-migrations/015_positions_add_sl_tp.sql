-- Add stop_loss and take_profit columns to positions table for chart visualization
-- Migration: 015_positions_add_sl_tp

ALTER TABLE terminal_positions
ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(12, 2),
ADD COLUMN IF NOT EXISTS take_profit DECIMAL(12, 2),
ADD COLUMN IF NOT EXISTS trailing_stop DECIMAL(12, 2),
ADD COLUMN IF NOT EXISTS break_even_activated BOOLEAN DEFAULT FALSE;

-- Create index for faster SL/TP queries
CREATE INDEX IF NOT EXISTS idx_positions_sl_tp ON terminal_positions(stop_loss, take_profit) 
WHERE is_open = TRUE AND (stop_loss IS NOT NULL OR take_profit IS NOT NULL);

COMMENT ON COLUMN terminal_positions.stop_loss IS 'Stop loss price for position (for chart visualization and order management)';
COMMENT ON COLUMN terminal_positions.take_profit IS 'Take profit price for position (for chart visualization and order management)';
COMMENT ON COLUMN terminal_positions.trailing_stop IS 'Trailing stop distance in points (optional)';
COMMENT ON COLUMN terminal_positions.break_even_activated IS 'Whether break-even stop has been activated';
