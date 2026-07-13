const https = require('https');

// Check the Railway backend directly
function get(host, path) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: host, path, method: 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.substring(0, 300) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

async function main() {
  // Direct Railway backend
  const r = await get('terminal-production-4429.up.railway.app', '/health');
  console.log('Railway direct /health:', r.status, r.body);
  
  const t = await get('terminal-production-4429.up.railway.app', '/auth/test/session');
  console.log('Railway /auth/test/session:', t.status);
}

main();
