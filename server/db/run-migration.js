/**
 * Provisioning system migration.
 * 
 * Creates the provisioning_logs table (if not exists).
 * Uses the exec_sql RPC function available in this Supabase project.
 * 
 * Run: node db/run-migration.js
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function run() {
  console.log('Running provisioning migration...\n');

  const statements = [
    {
      name: 'Create provisioning_logs table',
      sql: `CREATE TABLE IF NOT EXISTS provisioning_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trader_id UUID REFERENCES terminal_traders(id),
        trading_account_id UUID REFERENCES trading_accounts(id),
        challenge_account_id UUID REFERENCES challenge_accounts(id),
        order_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        payment_method TEXT,
        payment_ref TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    },
    { name: 'Index: order_id', sql: `CREATE INDEX IF NOT EXISTS idx_provisioning_order ON provisioning_logs(order_id)` },
    { name: 'Index: trader_id', sql: `CREATE INDEX IF NOT EXISTS idx_provisioning_trader ON provisioning_logs(trader_id)` },
    { name: 'Index: status', sql: `CREATE INDEX IF NOT EXISTS idx_provisioning_status ON provisioning_logs(status)` },
    { name: 'Unique index: completed orders', sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_provisioning_order_success ON provisioning_logs(order_id) WHERE status = 'completed'` },
    { name: 'Enable RLS', sql: `ALTER TABLE provisioning_logs ENABLE ROW LEVEL SECURITY` },
  ];

  for (const { name, sql } of statements) {
    const { error } = await s.rpc('exec_sql', { sql_query: sql });
    if (error) {
      console.log(`  ✗ ${name}: ${error.message}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  }

  // Reload PostgREST schema cache
  await s.rpc('exec_sql', { sql_query: "NOTIFY pgrst, 'reload schema'" });
  console.log('\n  ✓ Schema cache reloaded');

  // Verify
  await new Promise(r => setTimeout(r, 2000));
  const { error: verifyErr } = await s.from('provisioning_logs').select('id').limit(1);
  if (verifyErr) {
    console.log(`\n  ⚠ Table not yet visible (may need a few more seconds): ${verifyErr.message}`);
  } else {
    console.log('\n✓ Migration complete. provisioning_logs is accessible.');
  }
}

run().catch(e => console.error(e));
