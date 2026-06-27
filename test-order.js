// Test order placement - runtime verification
const http = require('http');

const payload = JSON.stringify({
  symbol: 'RELIANCE',
  token: '2885',
  segment: 'NSE',
  side: 'BUY',
  orderType: 'MARKET',
  productType: 'MIS',
  qty: 1
});

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/orders/place',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cookie': 'fw_session=dev'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('RESPONSE:', data);
  });
});

req.on('error', (e) => console.error('ERROR:', e.message));
req.write(payload);
req.end();
