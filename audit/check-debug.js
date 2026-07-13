const https = require('https');
// The /debug/secret-hash endpoint returns hash of SSO_API_KEY
// We can compare against known values to identify which key production uses
const req = https.request({
  hostname: 'terminal.fundedwealth.com',
  path: '/debug/secret-hash',
  method: 'GET'
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      console.log('Debug hash response:', JSON.stringify(j, null, 2));
      
      // Compare against known keys
      const crypto = require('crypto');
      const candidates = [
        'fw-provision-key-2024-secure',
        'fw-provision-key-2024',
        'fundedwealth-provision-key',
      ];
      candidates.forEach(k => {
        const h = crypto.createHash('sha256').update(k).digest('hex');
        console.log(`  ${k} => ${h} ${h === j.hash ? '✅ MATCH' : ''}`);
      });
    } catch { console.log('Response:', d.substring(0,200)); }
  });
});
req.on('error', e => console.error(e.message));
req.end();
