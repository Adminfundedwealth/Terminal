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

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const b = JSON.stringify(body);
    const opts = {
      hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', agent, timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'access-token': T, 'client-id': C, 'dhanClientId': C, 'Content-Length': Buffer.byteLength(b) }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, d: JSON.parse(d) }); } catch { resolve({ s: res.statusCode, d }); } });
    });
    req.on('error', reject);
    req.write(b);
    req.end();
  });
}

async function main() {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 10);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // Try multiple MCX GOLD security IDs to find the active contract
  const candidates = ['429604', '437820', '444302', '441825', '445396', '447122', '449543'];
  
  for (const id of candidates) {
    const payload = { securityId: id, exchangeSegment: 'MCX_COMM', instrument: 'FUTCOM', interval: 'DAY', fromDate: fmt(from), toDate: fmt(now) };
    const r = await post('https://api.dhan.co/v2/charts/historical', payload);
    const d = r.d?.data || r.d;
    const count = d?.timestamp?.length || d?.open?.length || 0;
    const lastClose = count > 0 ? d.close[d.close.length - 1] : 'N/A';
    console.log(`SecId ${id}: ${count} candles${count > 0 ? ' | Last close: ' + lastClose : ' | EMPTY (expired)'}`);
    await new Promise(r => setTimeout(r, 600));
  }
}

main().catch(e => console.error(e));
