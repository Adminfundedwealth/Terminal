/**
 * DATABASE TABLE VERIFICATION
 * 
 * Checks if all required Terminal tables exist in Supabase.
 */

import { supabase } from './db/client.js';

const REQUIRED_TABLES = [
  'terminal_traders',
  'terminal_sessions', 
  'challenge_accounts',
  'trading_accounts',
  'risk_rules',
  'trading_orders',
  'positions',
  'executions',
  'watchlists',
  'account_metrics',
  'broker_sessions',
  'risk_events',
  'challenge_metrics',
  'order_audit',
];

async function verifyTables() {
  console.log('═══════════════════════════════════════════');
  console.log('  DATABASE TABLE VERIFICATION');
  console.log('═══════════════════════════════════════════\n');

  if (!supabase) {
    console.error('❌ Supabase client not initialized');
    process.exit(1);
  }

  const results = [];
  
  for (const table of REQUIRED_TABLES) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      
      if (error) {
        if (error.message.includes('does not exist') || error.message.includes('schema cache')) {
          results.push({ table, status: '❌ MISSING', error: error.message });
        } else {
          results.push({ table, status: '⚠️  ERROR', error: error.message });
        }
      } else {
        results.push({ table, status: '✅ EXISTS', rowCount: data?.length || 0 });
      }
    } catch (err) {
      results.push({ table, status: '❌ FAILED', error: err.message });
    }
  }

  console.log('Table Status:\n');
  results.forEach(r => {
    if (r.error) {
      console.log(`${r.status} ${r.table}`);
      console.log(`   → ${r.error.substring(0, 80)}...\n`);
    } else {
      console.log(`${r.status} ${r.table} (${r.rowCount} rows)`);
    }
  });

  const existing = results.filter(r => r.status === '✅ EXISTS').length;
  const missing = results.filter(r => r.status === '❌ MISSING').length;

  console.log(`\n${'═'.repeat(45)}`);
  console.log(`SUMMARY: ${existing}/${REQUIRED_TABLES.length} tables exist`);
  console.log(`Missing: ${missing} tables`);
  console.log(`${'═'.repeat(45)}\n`);

  if (missing > 0) {
    console.log('⚠️  ACTION REQUIRED: Run database migration');
    console.log('   File: server/db/FULL_MIGRATION.sql');
    console.log('   Execute via: Supabase SQL Editor\n');
  }

  process.exit(missing > 0 ? 1 : 0);
}

verifyTables();
