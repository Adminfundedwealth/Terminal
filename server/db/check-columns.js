import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function checkTable(table) {
  // Try to insert a minimal row and see what columns are available
  // Or better: try select with specific columns
  const { data, error } = await supabase.from(table).select('*').limit(0);
  if (error) {
    console.log(`${table}: ERROR — ${error.message}`);
    return;
  }
  // The data is empty array but the columns are in the response headers
  // Let's try a different approach - insert with all expected columns
  console.log(`${table}: accessible (0 rows returned)`);
}

// Test each table with a specific column to find what's missing
async function testColumn(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (error && error.message.includes('schema cache')) {
    return false;
  }
  return true;
}

async function main() {
  console.log('Checking trading_accounts columns...');
  const tradingAccountCols = ['id', 'trader_id', 'challenge_id', 'account_code', 'broker_provider', 'balance', 'peak_balance', 'available_margin', 'used_margin', 'status', 'locked_reason', 'created_at'];
  for (const col of tradingAccountCols) {
    const exists = await testColumn('trading_accounts', col);
    console.log(`  trading_accounts.${col}: ${exists ? '✓' : '✗ MISSING'}`);
  }

  console.log('\nChecking layouts columns...');
  const layoutCols = ['id', 'trader_id', 'name', 'layout_type', 'panel_config', 'chart_config', 'is_active', 'created_at'];
  for (const col of layoutCols) {
    const exists = await testColumn('layouts', col);
    console.log(`  layouts.${col}: ${exists ? '✓' : '✗ MISSING'}`);
  }

  console.log('\nChecking alerts columns...');
  const alertCols = ['id', 'trader_id', 'alert_type', 'symbol', 'condition', 'is_active', 'created_at'];
  for (const col of alertCols) {
    const exists = await testColumn('alerts', col);
    console.log(`  alerts.${col}: ${exists ? '✓' : '✗ MISSING'}`);
  }
}

main();
