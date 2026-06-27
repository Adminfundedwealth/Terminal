import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function test() {
  // Test 1: Insert without peak_balance
  console.log('Test 1: Insert trading_account without peak_balance...');
  const { data: d1, error: e1 } = await supabase.from('trading_accounts').insert({
    trader_id: 'd35aab69-9f77-4f81-887b-71fa9b6b60ff', // re-use test trader if exists
    account_code: `FW-T-${Date.now().toString(36)}`,
    broker_provider: 'paper',
    balance: 1000000,
    status: 'active',
  }).select().single();
  
  if (e1) {
    console.log('  Error:', e1.message);
    // Try with different trader
    console.log('Test 1b: Create fresh trader first...');
    const { data: trader } = await supabase.from('terminal_traders').insert({
      external_id: `col_test_${Date.now()}`,
      email: `col-test-${Date.now()}@test.com`,
      display_name: 'Column Test',
      status: 'active',
    }).select().single();
    
    if (trader) {
      const { data: d2, error: e2 } = await supabase.from('trading_accounts').insert({
        trader_id: trader.id,
        account_code: `FW-T2-${Date.now().toString(36)}`,
        broker_provider: 'paper',
        balance: 1000000,
        status: 'active',
      }).select().single();
      console.log('  Result:', e2 ? `ERROR: ${e2.message}` : `OK id=${d2.id}`);
      if (d2) {
        console.log('  Columns returned:', Object.keys(d2).join(', '));
        // Cleanup
        await supabase.from('trading_accounts').delete().eq('id', d2.id);
      }
      await supabase.from('terminal_traders').delete().eq('id', trader.id);
    }
  } else {
    console.log('  OK! id=', d1.id);
    console.log('  Columns:', Object.keys(d1).join(', '));
    await supabase.from('trading_accounts').delete().eq('id', d1.id);
  }

  // Test 2: Check layouts constraint
  console.log('\nTest 2: Check layouts layout_type constraint...');
  const { data: lt, error: le } = await supabase.from('layouts').select('id, layout_type').limit(5);
  if (le) console.log('  Error:', le.message);
  else console.log('  Current layout_types in use:', lt?.map(l => l.layout_type));

  // Test 3: Check alerts columns  
  console.log('\nTest 3: Check alerts table columns...');
  const { data: al, error: ae } = await supabase.from('alerts').select('*').limit(1);
  if (ae) console.log('  Error:', ae.message);
  else console.log('  Alerts columns:', al ? 'accessible' : 'empty');
}

test();
