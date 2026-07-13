const https = require('https');

function get(path) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'terminal.fundedwealth.com', path, method: 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.substring(0, 300) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

async function main() {
  const health = await get('/health');
  console.log('/health:', health.status, health.body);

  const testEp = await get('/auth/test/session');
  console.log('/auth/test/session GET:', testEp.status, testEp.body.substring(0,100));
}

main();
