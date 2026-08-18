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
  
  const commodities = ['GOLD', 'SILVER', 'CRUDEOIL', 'NATURALGAS', 'COPPER', 'ALUMINIUM', 'ZINC', 'LEAD', 'NICKEL'];
  
  console.log('Current MCX FUTCOM security IDs (nearest expiry):\n');
  
  for (const comm of commodities) {
    const matches = lines.filter(l => {
      const cols = l.split(',');
      // col[0]=MCX, col[3]=FUTCOM, col[15]=symbol name
      return cols[0] === 'MCX' && cols[3] === 'FUTCOM' && cols[15] === comm;
    });
    
    if (matches.length === 0) {
      console.log(`  ${comm}: NOT FOUND`);
      continue;
    }
    
    const parsed = matches.map(l => {
      const cols = l.split(',');
      return { secId: cols[2], trading: cols[5], display: cols[7], expiry: cols[8] };
    }).sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
    
    const nearest = parsed[0];
    console.log(`  '${nearest.secId}', // ${comm} - ${nearest.display} (exp ${nearest.expiry.split(' ')[0]})`);
  }
}

main().catch(e => console.error(e));
