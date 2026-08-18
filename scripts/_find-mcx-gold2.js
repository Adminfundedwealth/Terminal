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

// Use compact CSV scrip master
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching Dhan scrip master CSV (compact)...');
  const csv = await fetch('https://images.dhan.co/api-data/api-scrip-master.csv');
  
  const lines = csv.split('\n');
  console.log('Total instruments:', lines.length - 1);
  console.log('Header:', lines[0].slice(0, 200));
  
  // Find GOLD futures in MCX
  const goldLines = lines.filter(l => {
    const lower = l.toLowerCase();
    return lower.includes('gold') && lower.includes('mcx') && lower.includes('futcom');
  });
  
  console.log('\nGOLD FUTCOM contracts found:', goldLines.length);
  for (const line of goldLines.slice(0, 10)) {
    console.log(' ', line.slice(0, 200));
  }
}

main().catch(e => console.error(e));
