/**
 * Create the 2 missing terminal tables via Supabase insert test.
 * kill_switch_logs and copy_trading_config need DATABASE_URL or SQL Editor.
 * For now, we'll note these as pending and proceed with backend fixes.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function verify() {
  console.log('[Verify] Checking all 21 terminal tables...');
  
  const tables = [
    'terminal_traders', 'terminal_sessions', 'challenge_accounts',
    'trading_accounts', 'risk_rules', 'trading_orders', 'positions',
    'executions', 'watchlists', 'layouts', 'themes', 'journal_entries',
    'account_metrics', 'broker_sessions', 'risk_events', 'challenge_progress',
    'provisioning_logs', 'execution_audits', 'alerts', 'kill_switch_logs',
    'copy_trading_config',
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    const status = error?.message?.includes('schema cache') ? '✗ MISSING' : '✓ EXISTS';
    console.log(`  ${status} — ${table}`);
  }
}

verify();
