const https = require('https');
const path = require('path');
const fs = require('fs');

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
  
  // Columns: SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_EXPIRY_CODE,SEM_TRADING_SYMBOL,...
  const commodities = ['GOLD', 'SILVER', 'CRUDEOIL', 'NATURALGAS', 'COPPER', 'ALUMINIUM', 'ZINC', 'LEAD', 'NICKEL'];
  
  console.log('Finding nearest-expiry FUTCOM contract for each commodity:\n');
  
  for (const comm of commodities) {
    // Find exact symbol match (not GOLDM, GOLDPETAL etc.)
    const matches = lines.filter(l => {
      const cols = l.split(',');
      return cols[0] === 'MCX' && cols[3] === 'FUTCOM' && cols[14] === comm;
    });
    
    if (matches.length === 0) {
      console.log(`  ${comm}: NOT FOUND`);
      continue;
    }
    
    // Sort by expiry date and pick nearest
    const parsed = matches.map(l => {
      const cols = l.split(',');
      return { secId: cols[2], symbol: cols[5], expiry: cols[8], display: cols[7] };
    }).sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
    
    const nearest = parsed[0];
    console.log(`  ${comm.padEnd(12)} secId: ${nearest.secId.padEnd(8)} | ${nearest.display} | Expiry: ${nearest.expiry}`);
  }
}

main().catch(e => console.error(e));
