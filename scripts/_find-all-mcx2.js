const https = require('https');

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
  const csv = await fetch('https://images.dhan.co/api-data/api-scrip-master.csv');
  const lines = csv.split('\n');
  const header = lines[0].split(',');
  
  console.log('Header columns:');
  header.forEach((h, i) => console.log(`  [${i}] ${h}`));
  
  // Find a GOLD line for reference
  const goldLine = lines.find(l => l.includes('GOLD') && l.includes('MCX') && l.includes('FUTCOM') && !l.includes('GOLDM') && !l.includes('GOLDPETAL') && !l.includes('GOLDGUINEA') && !l.includes('GOLDTEN'));
  if (goldLine) {
    console.log('\nSample GOLD line:');
    const cols = goldLine.split(',');
    cols.forEach((c, i) => console.log(`  [${i}] ${header[i]}: ${c}`));
  }
}

main().catch(e => console.error(e));
