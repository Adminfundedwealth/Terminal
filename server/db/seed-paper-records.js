import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ACCT = '40995deb-4f1e-4bc6-9603-f28563bfefcf';
const CHALLENGE = 'd45b1c81-3530-4cb8-8398-2b67f709cc30';

async function run() {
  // 1. trading_orders
  const { data: order, error: e1 } = await sb.from('trading_orders').insert({
    trading_account_id: ACCT, symbol: 'NIFTY 50', token: '99926000', segment: 'NSE',
    side: 'BUY', order_type: 'MARKET', product_type: 'MIS', qty: 50,
    filled_qty: 50, avg_fill_price: 24021.65, status: 'FILLED', validity: 'DAY',
    broker_order_id: 'PAPER-' + Date.now(), placed_at: new Date().toISOString(), filled_at: new Date().toISOString(),
  }).select().single();
  console.log('[trading_orders]', e1 ? 'ERR: ' + e1.message : '✓ ' + order.id);

  // 2. positions
  const { data: pos, error: e2 } = await sb.from('positions').insert({
    trading_account_id: ACCT, symbol: 'NIFTY 50', token: '99926000', segment: 'NSE',
    product_type: 'MIS', side: 'LONG', qty: 50, avg_price: 24021.65,
    current_price: 24021.65, realized_pnl: 0, unrealized_pnl: 0, is_open: true,
  }).select().single();
  console.log('[positions]', e2 ? 'ERR: ' + e2.message : '✓ ' + pos.id);

  // 3. executions
  const { data: exec, error: e3 } = await sb.from('executions').insert({
    trading_account_id: ACCT, order_id: order?.id || null, position_id: pos?.id || null,
    symbol: 'NIFTY 50', token: '99926000', segment: 'NSE', side: 'BUY', qty: 50, price: 24021.65,
    executed_at: new Date().toISOString(),
  }).select().single();
  console.log('[executions]', e3 ? 'ERR: ' + e3.message : '✓ ' + exec.id);

  // 4. risk_events
  const { data: risk, error: e4 } = await sb.from('risk_events').insert({
    trading_account_id: ACCT, challenge_id: CHALLENGE,
    event_type: 'daily_loss_warning', severity: 'info', rule_type: 'daily_loss_limit',
    threshold_value: 50000, actual_value: 0, metadata: { source: 'paper_mode_verification' },
  }).select().single();
  console.log('[risk_events]', e4 ? 'ERR: ' + e4.message : '✓ ' + risk.id);

  // 5. Verify all reads for dev account
  console.log('\n=== READ BACK (dev account only) ===');
  for (const t of ['trading_orders', 'positions', 'executions', 'risk_events', 'account_metrics', 'challenge_progress']) {
    const { data, error } = await sb.from(t).select('id').eq('trading_account_id', ACCT).limit(3);
    if (error) console.log(`[${t}] ERR: ${error.message}`);
    else console.log(`[${t}] ${data.length} row(s)`);
  }
}
run().catch(e => console.error(e.message));
