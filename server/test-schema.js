import { config } from 'dotenv';
config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function describeTable(name) {
  console.log(`\n─── ${name} ───`);
  const { data, error } = await supabase.from(name).select('*').limit(1);
  if (error) {
    console.log(`  ERROR: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    console.log(`  Columns: ${Object.keys(data[0]).join(', ')}`);
    console.log(`  Sample row: ${JSON.stringify(data[0]).substring(0, 300)}`);
  } else {
    // Try inserting a minimal record to see what columns are required via error messages
    // Or try a raw SQL approach
    console.log(`  (empty table, attempting column discovery...)`);
    // Insert with empty object to trigger column listing in error
    const { error: insertErr } = await supabase.from(name).insert({}).select();
    if (insertErr) {
      console.log(`  Insert error reveals: ${insertErr.message}`);
    }
  }
}

async function main() {
  await describeTable('trading_orders');
  await describeTable('positions');
  await describeTable('executions');
  await describeTable('execution_audits');
  await describeTable('orders');
}

main().catch(e => console.error(e.message));
