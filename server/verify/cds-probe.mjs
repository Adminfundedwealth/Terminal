/**
 * CDS contract probe — calls the production server's internal debug endpoint
 * to find what Dhan security IDs exist for NSE_CURRENCY in the live scrip master.
 */
import https from 'https';

const PROD = 'https://terminal.fundedwealth.com';

function get(path) {
  return new Promise((resolve, reject) => {
    https.get(`${PROD}${path}`, { timeout: 20000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// Test multiple possible CDS security IDs against the Dhan historical endpoint
// by calling /api/market/history with them directly (using numeric securityIds
// in NSE_CURRENCY segment — these are the IDs from the Dhan scrip master)
async function testId(secId, label) {
  const path = `/api/market/history?token=${secId}&tf=5&exchange=NSE_CURRENCY`;
  process.stdout.write(`  [${label}] secId=${secId} → `);
  try {
    const { status, body } = await get(path);
    if (status === 401) { console.log('401 (auth required)'); return false; }
    if (status === 200 && Array.isArray(body) && body.length > 0) {
      console.log(`✓ ${body.length} candles (last close=${body[body.length-1].close})`);
      return true;
    }
    console.log(`0 candles (status=${status})`);
    return false;
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== CDS Security ID Probe ===');
  console.log('Testing NSE_CURRENCY security IDs from Dhan scrip master\n');

  // From the live scrip master dump (all NSE CDS FUTCUR contracts with 2025/2026 dates)
  // Sorted by expiry: most recent future-dated first
  // NSE segment='C' → dhanSeg='NSE_CURRENCY'
  
  console.log('--- USDINR ---');
  // These are from the scrip master (expired but try anyway for recent history)
  const usdIds = [
    ['6601', 'USDINR-Jun2026-FUT'],
    ['3225', 'USDINR-May2026-FUT'],
    ['1196', 'USDINR-Apr2026-FUT'],
    ['2264', 'USDINR-Mar2026-FUT'],
    ['1065', 'USDINR-Feb2026-FUT'],
    ['2932', 'USDINR-Jan2026-FUT'],
    ['2122', 'USDINR-Dec2025-FUT'],
    ['1212', 'USDINR-Nov2025-FUT'],
    ['1104', 'USDINR-Oct2025-FUT'],
    // Weekly contracts
    ['14642','USDINR-12Sep2025-FUT weekly'],
    ['1518', 'USDINR-19Sep2025-FUT weekly'],
    ['1061', 'USDINR-14Aug2025-FUT weekly'],
  ];
  for (const [id, label] of usdIds) {
    const ok = await testId(id, label);
    if (ok) { console.log(`    ^^^ WORKING ID FOR USDINR: ${id}`); break; }
  }

  console.log('\n--- EURINR ---');
  const eurIds = [
    ['6572', 'EURINR-Jun2026-FUT'],
    ['3150', 'EURINR-May2026-FUT'],
    ['1147', 'EURINR-Apr2026-FUT'],
    ['2195', 'EURINR-Mar2026-FUT'],
    ['1007', 'EURINR-Feb2026-FUT'],
    ['2792', 'EURINR-Jan2026-FUT'],
  ];
  for (const [id, label] of eurIds) {
    const ok = await testId(id, label);
    if (ok) { console.log(`    ^^^ WORKING ID FOR EURINR: ${id}`); break; }
  }

  console.log('\n--- GBPINR ---');
  const gbpIds = [
    ['6598', 'GBPINR-Jun2026-FUT'],
    ['3180', 'GBPINR-May2026-FUT'],
    ['1162', 'GBPINR-Apr2026-FUT'],
    ['2221', 'GBPINR-Mar2026-FUT'],
    ['1024', 'GBPINR-Feb2026-FUT'],
  ];
  for (const [id, label] of gbpIds) {
    const ok = await testId(id, label);
    if (ok) { console.log(`    ^^^ WORKING ID FOR GBPINR: ${id}`); break; }
  }

  console.log('\n--- JPYINR ---');
  const jpyIds = [
    ['6600', 'JPYINR-Jun2026-FUT'],
    ['3219', 'JPYINR-May2026-FUT'],
    ['1195', 'JPYINR-Apr2026-FUT'],
    ['2263', 'JPYINR-Mar2026-FUT'],
    ['1057', 'JPYINR-Feb2026-FUT'],
  ];
  for (const [id, label] of jpyIds) {
    const ok = await testId(id, label);
    if (ok) { console.log(`    ^^^ WORKING ID FOR JPYINR: ${id}`); break; }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
