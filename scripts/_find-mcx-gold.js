const https = require('https');
const path = require('path');
const fs = require('fs');

function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const t = l.trim();
    if (!t || t[0] === '#') continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(path.resolve(__dirname, '../server/.env'));

const T = process.env.DHAN_ACCESS_TOKEN.trim();
const C = process.env.DHAN_CLIENT_ID.trim();
const agent = new https.Agent({ family: 4 });

// Fetch MCX instrument list from Dhan API
function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: 443, path: u.pathname, method: 'GET', agent, timeout: 30000,
      headers: { 'Accept': 'application/json', 'access-token': T, 'client-id': C }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ s: res.statusCode, d }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Fetching MCX_COMM instrument list from Dhan...');
  const r = await get('https://api.dhan.co/v2/instrument/MCX_COMM');
  
  if (r.s !== 200) {
    console.log('Failed:', r.s, r.d.slice(0, 200));
    return;
  }

  // Parse CSV
  const lines = r.d.split('\n');
  console.log('Total MCX instruments:', lines.length - 1);
  
  // Find GOLD futures
  const goldLines = lines.filter(l => l.includes('GOLD') && l.includes('FUTCOM'));
  console.log('\nGOLD FUTCOM contracts:');
  
  // Parse header
  const header = lines[0].split(',');
  const secIdIdx = header.findIndex(h => h.includes('SEM_SMST_SECURITY_ID') || h.includes('SECURITY_ID'));
  const symbolIdx = header.findIndex(h => h.includes('DISPLAY_NAME') || h.includes('SEM_CUSTOM_SYMBOL'));
  const expiryIdx = header.findIndex(h => h.includes('EXPIRY') || h.includes('SM_EXPIRY_DATE'));
  const tradSymIdx = header.findIndex(h => h.includes('TRADING_SYMBOL') || h.includes('SEM_TRADING_SYMBOL'));
  
  console.log('Header (first 10):', header.slice(0, 10));
  console.log('SecID col:', secIdIdx, 'Symbol col:', symbolIdx, 'Expiry col:', expiryIdx);
  
  for (const line of goldLines.slice(0, 10)) {
    const cols = line.split(',');
    console.log(`  SecId: ${cols[secIdIdx] || cols[0]} | ${cols[symbolIdx] || cols[3]} | Expiry: ${cols[expiryIdx] || 'N/A'}`);
  }
}

main().catch(e => console.error(e));
