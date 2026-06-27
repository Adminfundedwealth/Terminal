import { config } from 'dotenv';
config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Try known table names to see which exist
  const tables = ['trading_orders', 'positions', 'executions', 'execution_audits', 'audit_log', 't_users', 't_accounts', 't_orders', 't_positions', 't_trades', 't_executions', 'orders', 'trades'];
  
  console.log('TABLE EXISTENCE CHECK:');
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(`  ${t}: ✗ (${error.message.substring(0, 60)})`);
    } else {
      console.log(`  ${t}: ✓ EXISTS (${data.length} rows returned)`);
    }
  }
}

main().catch(e => console.error(e.message));
