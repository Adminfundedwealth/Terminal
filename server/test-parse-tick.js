import { config } from 'dotenv'; config();
import axios from 'axios';
import https from 'https';
import WebSocket from 'ws';
import { authenticator } from '@otplib/preset-default';

const agent = new https.Agent({ family: 4 });
const totp = authenticator.generate(process.env.ANGEL_TOTP_SECRET);

const resp = await axios.post('https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword', {
  clientcode: process.env.ANGEL_CLIENT_ID, password: process.env.ANGEL_PASSWORD, totp,
}, { httpsAgent: agent, timeout: 12000, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '127.0.0.1', 'X-ClientPublicIP': '127.0.0.1', 'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': process.env.ANGEL_API_KEY } });

const { jwtToken, feedToken } = resp.data.data;
console.log('Logged in. Connecting WS...');

const ws = new WebSocket('wss://smartapisocket.angelone.in/smart-stream', {
  headers: { 'Authorization': 'Bearer ' + jwtToken, 'x-api-key': process.env.ANGEL_API_KEY, 'x-client-code': process.env.ANGEL_CLIENT_ID, 'x-feed-token': feedToken },
});

ws.on('open', () => {
  console.log('WS open. Subscribing NIFTY+BANKNIFTY in LTP mode...');
  ws.send(JSON.stringify({ correlationID: 'test', action: 1, params: { mode: 1, tokenList: [{ exchangeType: 1, tokens: ['99926000', '99926009'] }] } }));
});

let count = 0;
ws.on('message', (data) => {
  if (!Buffer.isBuffer(data)) { console.log('TEXT:', data.toString().substring(0, 100)); return; }
  count++;
  if (count <= 5) {
    console.log(`\nTick #${count} (${data.length} bytes)`);
    // Angel SmartStream binary: subscription_mode(1) + exchange_type(1) + token(25 bytes, null padded) + sequence(8) + exchange_ts(8) + ltp(4 int32/100)
    // Total LTP packet = 1+1+25+8+8+4 = 47 bytes? Let's check
    // OR: sub_mode(1) + exchange(1) + token_size(1) + token(variable) ...
    // Dump hex
    console.log('Hex:', data.slice(0, Math.min(60, data.length)).toString('hex'));
    console.log('Byte[0] mode:', data[0]);
    console.log('Byte[1] exchange:', data[1]);
    // Token as string from bytes 2-26
    const tokenStr = data.slice(2, 27).toString('utf8').replace(/\0/g, '');
    console.log('Token str[2:27]:', tokenStr);
    // Try int32 at various offsets for LTP
    for (const off of [27, 31, 35, 39, 43]) {
      if (off + 4 <= data.length) console.log(`  Int32LE @${off}: ${data.readInt32LE(off)} (/ 100 = ${data.readInt32LE(off) / 100})`);
    }
  }
  if (count >= 5) { ws.close(); process.exit(0); }
});

ws.on('error', e => { console.log('ERR:', e.message); process.exit(1); });
setTimeout(() => { ws.close(); process.exit(0); }, 12000);
