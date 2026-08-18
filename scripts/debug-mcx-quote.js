/**
 * Debug MCX/CDS Quote Resolution
 * Queries production endpoint to inspect raw responses
 */

const BASE = process.argv[2] || 'https://terminal.fundedwealth.com';

async function test() {
  console.log('=== MCX & CDS Quote Debug ===\n');
  console.log(`Target: ${BASE}\n`);

  const tokens = [
    { token: 'GOLD_F', label: 'Gold Futures' },
    { token: 'SILVER_F', label: 'Silver Futures' },
    { token: 'CRUDE_F', label: 'Crude Oil' },
    { token: 'USDINR_F', label: 'USD/INR' },
    { token: 'NF_FUT', label: 'Nifty Futures (control)' },
  ];

  for (const { token, label } of tokens) {
    try {
      const resp = await fetch(`${BASE}/api/market/quote?token=${token}`);
      const status = resp.status;
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      
      const ltp = data?.ltp || 'NULL';
      const statusIcon = (ltp !== 'NULL' && ltp > 0) ? '✓' : '✗';
      console.log(`${statusIcon} ${label.padEnd(20)} [${token.padEnd(10)}] → HTTP ${status} | LTP: ${typeof ltp === 'number' ? ltp.toFixed(2) : ltp}`);
      if (ltp === 'NULL' || ltp === 0) {
        console.log(`  Raw: ${JSON.stringify(data).slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`✗ ${label.padEnd(20)} [${token.padEnd(10)}] → ERROR: ${err.message}`);
    }
  }

  // Also test the provider status
  console.log('\n=== Provider Status ===');
  try {
    const resp = await fetch(`${BASE}/api/provider/status`);
    const data = await resp.json();
    console.log(`Active: ${data.activeProvider} | Dhan Ready: ${data.dhanReady}`);
    if (data.lastDhanError) {
      console.log(`Last Error: ${data.lastDhanError.msg} @ ${new Date(data.lastDhanError.time).toISOString()}`);
    }
  } catch (err) {
    console.log(`Error fetching status: ${err.message}`);
  }

  // Test the Dhan diagnostic endpoint if it exists
  console.log('\n=== Dhan Direct Test ===');
  try {
    const resp = await fetch(`${BASE}/api/debug/dhan-quote?securityId=429604&segment=MCX_COMM`);
    if (resp.ok) {
      const data = await resp.json();
      console.log(`Dhan MCX 429604: ${JSON.stringify(data).slice(0, 300)}`);
    } else {
      console.log(`Dhan debug endpoint: HTTP ${resp.status}`);
    }
  } catch (err) {
    console.log(`No debug endpoint: ${err.message}`);
  }
}

test().catch(console.error);
