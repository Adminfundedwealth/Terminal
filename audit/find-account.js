/**
 * Finds a test trading account from Supabase to use for SSO testing
 */
const https = require('https');

const SUPABASE_URL = 'https://nysrxvpjdlvzvcawysvh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c3J4dnBqZGx2enZjYXd5c3ZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODk5NjczNiwiZXhwIjoyMDk0NTcyNzM2fQ.gLsZkCROY0n7YSXaIc_MmYgaHDwJ9DfSpYeSb3uu7j0';

function query(table, params = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`/rest/v1/${table}?${params}&limit=5`, SUPABASE_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Querying Supabase for test data...\n');

  // Find terminal_traders
  const traders = await query('terminal_traders', 'select=id,external_id,email,display_name,status&order=created_at.desc');
  console.log('terminal_traders:', traders.status);
  if (Array.isArray(traders.data) && traders.data.length > 0) {
    traders.data.forEach(t => console.log(`  Trader: ${t.id} | ${t.email} | ${t.display_name} | status:${t.status}`));
  } else {
    console.log('  No traders found or error:', JSON.stringify(traders.data).substring(0,200));
  }

  // Find trading_accounts
  console.log('');
  const accounts = await query('trading_accounts', 'select=id,account_code,trader_id,broker_provider,balance,status&order=created_at.desc');
  console.log('trading_accounts:', accounts.status);
  if (Array.isArray(accounts.data) && accounts.data.length > 0) {
    accounts.data.forEach(a => console.log(`  Account: ${a.id} | ${a.account_code} | broker:${a.broker_provider} | balance:${a.balance} | status:${a.status}`));
    // Output the first active account for use in tests
    const active = accounts.data.find(a => a.status === 'active') || accounts.data[0];
    if (active) {
      console.log('\n✅ USE THIS FOR TESTING:');
      console.log(`  ACCOUNT_ID=${active.id}`);
      console.log(`  FW_USER_ID=${active.trader_id}`);
    }
  } else {
    console.log('  No accounts found or error:', JSON.stringify(accounts.data).substring(0,200));
  }
}

main().catch(e => console.error('Error:', e.message));
