/**
 * Angel One Live Verification Script
 * Uses axios with forced IPv4 to bypass IPv6 timeout
 */

import { config } from 'dotenv';
config();

import axios from 'axios';
import https from 'https';
import { authenticator } from '@otplib/preset-default';

const BASE = 'https://apiconnect.angelone.in';
const apiKey = process.env.ANGEL_API_KEY;
const clientId = process.env.ANGEL_CLIENT_ID;
const totpSecret = process.env.ANGEL_TOTP_SECRET;
const password = process.env.ANGEL_PASSWORD;

// Force IPv4 to avoid IPv6 timeout on this machine
const agent = new https.Agent({ family: 4 });
const http = axios.create({ httpsAgent: agent, timeout: 12000 });

let jwtToken = null;
let feedToken = null;

function headers() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': apiKey,
    ...(jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {}),
  };
}

async function main() {
  console.log('=== ANGEL ONE LIVE VERIFICATION ===\n');

  // 1. LOGIN
  console.log('--- 1. LOGIN ---');
  const totp = authenticator.generate(totpSecret);
  console.log(`Client: ${clientId}, TOTP: ${totp}`);

  const loginResp = await http.post(BASE + '/rest/auth/angelbroking/user/v1/loginByPassword', {
    clientcode: clientId,
    password: password,
    totp: totp,
  }, { headers: headers() });

  const loginData = loginResp.data;
  console.log(`Status: ${loginData.status}`);
  console.log(`Message: ${loginData.message}`);

  if (!loginData.data?.jwtToken) {
    console.log('LOGIN FAILED:', JSON.stringify(loginData).substring(0, 200));
    process.exit(1);
  }

  jwtToken = loginData.data.jwtToken;
  feedToken = loginData.data.feedToken;
  console.log(`JWT: ${jwtToken.substring(0, 50)}...`);
  console.log(`Feed Token: ${feedToken ? feedToken.substring(0, 20) + '...' : 'NONE'}`);
  console.log(`Refresh Token: ${loginData.data.refreshToken ? 'PRESENT' : 'NONE'}`);
  console.log('');

  // 2. PROFILE
  console.log('--- 2. PROFILE ---');
  try {
    const profileResp = await http.get(BASE + '/rest/secure/angelbroking/user/v1/getProfile', { headers: headers() });
    const p = profileResp.data?.data;
    if (p) {
      console.log(`Name: ${p.name}`);
      console.log(`Client Code: ${p.clientcode}`);
      console.log(`Email: ${p.email}`);
      console.log(`Exchanges: ${JSON.stringify(p.exchanges)}`);
    } else {
      console.log('Response:', JSON.stringify(profileResp.data).substring(0, 200));
    }
  } catch (e) {
    console.log('ERROR:', e.response?.data?.message || e.message);
  }
  console.log('');

  // 3. FUNDS
  console.log('--- 3. FUNDS ---');
  try {
    const fundsResp = await http.get(BASE + '/rest/secure/angelbroking/user/v1/getRMS', { headers: headers() });
    const f = fundsResp.data?.data;
    if (f) {
      console.log(`Available Cash: ${f.availablecash}`);
      console.log(`Net: ${f.net}`);
      console.log(`Used Margin: ${f.utiliseddebits}`);
      console.log(`Collateral: ${f.collateral}`);
    } else {
      console.log('Response:', JSON.stringify(fundsResp.data).substring(0, 200));
    }
  } catch (e) {
    console.log('ERROR:', e.response?.data?.message || e.message);
  }
  console.log('');

  // 4. POSITIONS
  console.log('--- 4. POSITIONS ---');
  try {
    const posResp = await http.get(BASE + '/rest/secure/angelbroking/order/v1/getPosition', { headers: headers() });
    const positions = posResp.data?.data;
    if (positions && Array.isArray(positions)) {
      console.log(`Count: ${positions.length}`);
      positions.slice(0, 3).forEach(p => {
        console.log(`  ${p.tradingsymbol} | Qty: ${p.netqty} | P&L: ${p.unrealised}`);
      });
    } else {
      console.log(`Response: ${posResp.data?.message || 'No positions'}`);
    }
  } catch (e) {
    console.log('ERROR:', e.response?.data?.message || e.message);
  }
  console.log('');

  // 5. ORDERS
  console.log('--- 5. ORDERS ---');
  try {
    const ordResp = await http.get(BASE + '/rest/secure/angelbroking/order/v1/getOrderBook', { headers: headers() });
    const orders = ordResp.data?.data;
    if (orders && Array.isArray(orders)) {
      console.log(`Count: ${orders.length}`);
      orders.slice(0, 3).forEach(o => {
        console.log(`  ${o.tradingsymbol} | ${o.transactiontype} | ${o.orderstatus} | Qty: ${o.quantity}`);
      });
    } else {
      console.log(`Response: ${ordResp.data?.message || 'No orders'}`);
    }
  } catch (e) {
    console.log('ERROR:', e.response?.data?.message || e.message);
  }
  console.log('');

  // 6. MARKET QUOTE
  console.log('--- 6. MARKET QUOTE (NIFTY + BANKNIFTY) ---');
  try {
    const quoteResp = await http.post(BASE + '/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'FULL',
      exchangeTokens: { NSE: ['99926000', '99926009'] },
    }, { headers: headers() });
    const fetched = quoteResp.data?.data?.fetched;
    if (fetched) {
      fetched.forEach(q => {
        console.log(`  ${q.tradingSymbol || q.symbolToken}: LTP=${q.ltp} Open=${q.open} High=${q.high} Low=${q.low} Close=${q.close}`);
      });
    } else {
      console.log('Response:', JSON.stringify(quoteResp.data).substring(0, 200));
    }
  } catch (e) {
    console.log('ERROR:', e.response?.data?.message || e.message);
  }
  console.log('');

  console.log('=== DONE ===');
  console.log(`Feed Token: ${feedToken || 'NONE'}`);
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
