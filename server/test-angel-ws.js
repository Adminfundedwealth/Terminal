/**
 * Angel One WebSocket V2 - Live Tick Verification
 * Subscribes to NIFTY and BANKNIFTY, captures 5 ticks
 */

import { config } from 'dotenv';
config();

import axios from 'axios';
import https from 'https';
import WebSocket from 'ws';
import { authenticator } from '@otplib/preset-default';

const BASE = 'https://apiconnect.angelone.in';
const WS_URL = 'wss://smartapisocket.angelone.in/smart-stream';
const apiKey = process.env.ANGEL_API_KEY;
const clientId = process.env.ANGEL_CLIENT_ID;
const totpSecret = process.env.ANGEL_TOTP_SECRET;
const password = process.env.ANGEL_PASSWORD;

const agent = new https.Agent({ family: 4 });

async function login() {
  const totp = authenticator.generate(totpSecret);
  const resp = await axios.post(BASE + '/rest/auth/angelbroking/user/v1/loginByPassword', {
    clientcode: clientId, password, totp,
  }, {
    httpsAgent: agent, timeout: 12000,
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1', 'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': apiKey,
    },
  });

  if (!resp.data?.data?.jwtToken) throw new Error('Login failed: ' + resp.data?.message);
  return resp.data.data;
}

function parseTickBinary(buffer) {
  // Angel SmartStream V2 binary format
  // Byte 0: subscription mode (1=LTP, 2=Quote, 3=SnapQuote)
  // Byte 1: exchange type (1=NSE_CM, 2=NSE_FO, etc.)
  // Bytes 2-26: token (25 bytes padded)
  // Bytes 27+: depends on mode
  if (buffer.length < 30) return null;

  const mode = buffer[0];
  const exchangeType = buffer[1];
  const tokenBytes = buffer.slice(2, 27);
  const token = tokenBytes.toString('utf8').replace(/\0/g, '').trim();

  if (mode === 1 && buffer.length >= 35) {
    // LTP mode: 8 bytes for LTP (int64 divided by 100)
    const seqNo = buffer.readBigInt64LE(27);
    const ltp = Number(buffer.readBigInt64LE(35)) / 100;
    return { mode: 'LTP', exchange: exchangeType, token, ltp, seq: Number(seqNo) };
  }

  if (mode === 2 && buffer.length >= 75) {
    // Quote mode
    const ltp = Number(buffer.readBigInt64LE(35)) / 100;
    const open = Number(buffer.readBigInt64LE(51)) / 100;
    const high = Number(buffer.readBigInt64LE(59)) / 100;
    const low = Number(buffer.readBigInt64LE(67)) / 100;
    const close = Number(buffer.readBigInt64LE(43)) / 100;
    return { mode: 'Quote', exchange: exchangeType, token, ltp, open, high, low, close };
  }

  return { mode, exchange: exchangeType, token, rawLen: buffer.length };
}

async function main() {
  console.log('=== ANGEL ONE WEBSOCKET VERIFICATION ===\n');

  // Login first
  console.log('Logging in...');
  const session = await login();
  console.log('Login OK. Feed token obtained.\n');

  const jwtToken = session.jwtToken;
  const feedToken = session.feedToken;

  // Connect WebSocket
  console.log('Connecting to SmartStream WebSocket...');
  console.log(`URL: ${WS_URL}`);

  const ws = new WebSocket(WS_URL, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'x-api-key': apiKey,
      'x-client-code': clientId,
      'x-feed-token': feedToken,
    },
  });

  let tickCount = 0;
  const maxTicks = 8;
  let connected = false;

  ws.on('open', () => {
    connected = true;
    console.log('WebSocket CONNECTED\n');

    // Subscribe to NIFTY 50 and BANKNIFTY (exchange 1 = NSE_CM)
    // Mode 2 = Quote (LTP + OHLC)
    // Token format: { exchangeType, tokens: [{ token }] }
    const subscribePayload = JSON.stringify({
      correlationID: 'fw_test_1',
      action: 1, // subscribe
      params: {
        mode: 2, // Quote mode
        tokenList: [
          { exchangeType: 1, tokens: ['99926000', '99926009'] }, // NSE: NIFTY, BANKNIFTY
        ],
      },
    });

    console.log('Subscribing to NIFTY (99926000) + BANKNIFTY (99926009)...');
    ws.send(subscribePayload);
  });

  ws.on('message', (data) => {
    tickCount++;

    if (Buffer.isBuffer(data)) {
      const parsed = parseTickBinary(data);
      if (parsed) {
        const name = parsed.token === '99926000' ? 'NIFTY' : parsed.token === '99926009' ? 'BANKNIFTY' : parsed.token;
        console.log(`TICK #${tickCount}: ${name} | LTP: ${parsed.ltp} | Mode: ${parsed.mode} | Bytes: ${data.length}`);
      } else {
        console.log(`TICK #${tickCount}: Binary ${data.length} bytes (unparsed)`);
      }
    } else {
      const msg = data.toString();
      console.log(`MSG #${tickCount}: ${msg.substring(0, 150)}`);
    }

    if (tickCount >= maxTicks) {
      console.log(`\n=== ${tickCount} ticks received. Closing. ===`);
      ws.close();
    }
  });

  ws.on('error', (err) => {
    console.log('WS ERROR:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`WS CLOSED: code=${code} reason=${reason?.toString() || ''}`);
    process.exit(0);
  });

  // Timeout after 15s
  setTimeout(() => {
    if (tickCount === 0) {
      console.log('\nTIMEOUT: No ticks received in 15s');
      if (!connected) console.log('WebSocket never connected');
    } else {
      console.log(`\nTIMEOUT: ${tickCount} ticks received`);
    }
    ws.close();
    process.exit(tickCount > 0 ? 0 : 1);
  }, 15000);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
