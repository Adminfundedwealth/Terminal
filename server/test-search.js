import axios from 'axios';
import https from 'https';
import { config } from 'dotenv';

config();

const ANGEL_API_BASE = 'https://apiconnect.angelone.in';
const IPV4_AGENT = new https.Agent({ family: 4 });

// Login first
async function login() {
  const resp = await axios.post(`${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    clientcode: process.env.ANGEL_CLIENT_ID,
    password: process.env.ANGEL_PIN,
    totp: '', // Will use TOTP if available
  }, { httpsAgent: IPV4_AGENT, timeout: 10000, headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY,
  }});
  return resp.data?.data?.jwtToken;
}

async function searchScrip(token, searchTerm) {
  console.log(`\nSearching: exchange=NFO, searchscrip="${searchTerm}"`);
  const resp = await axios.post(
    `${ANGEL_API_BASE}/rest/secure/angelbroking/order/v1/searchScrip`,
    { exchange: 'NFO', searchscrip: searchTerm },
    { httpsAgent: IPV4_AGENT, timeout: 10000, headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY,
      'Authorization': `Bearer ${token}`,
    }}
  );
  console.log(`Status: ${resp.data?.status}, Message: ${resp.data?.message}`);
  if (Array.isArray(resp.data?.data)) {
    console.log(`Results: ${resp.data.data.length} items`);
    resp.data.data.slice(0, 5).forEach(i => console.log(`  ${i.tradingsymbol} (token: ${i.symboltoken})`));
  } else {
    console.log(`Data type: ${typeof resp.data?.data}`, JSON.stringify(resp.data?.data).substring(0, 200));
  }
}

async function main() {
  console.log('Logging in...');
  // Use the existing angel feed session instead
  // Let's use a fresh login with TOTP
  const { authenticator } = await import('@otplib/preset-default');
  const totp = authenticator.generate(process.env.ANGEL_TOTP_SECRET);
  
  const resp = await axios.post(`${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    clientcode: process.env.ANGEL_CLIENT_ID,
    password: process.env.ANGEL_PASSWORD,
    totp: totp,
  }, { httpsAgent: IPV4_AGENT, timeout: 10000, headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY,
  }});
  
  const jwt = resp.data?.data?.jwtToken;
  if (!jwt) {
    console.log('Login failed:', resp.data?.message);
    return;
  }
  console.log('Login OK');

  // Find actual current-week expiries
  await searchScrip(jwt, 'NIFTY22JUN26');
  await new Promise(r => setTimeout(r, 2000));
  await searchScrip(jwt, 'NIFTY23JUN26');
  await new Promise(r => setTimeout(r, 2000));
  await searchScrip(jwt, 'NIFTY24JUN26');
  await new Promise(r => setTimeout(r, 2000));
  await searchScrip(jwt, 'NIFTY25JUN26');
  await new Promise(r => setTimeout(r, 2000));
  await searchScrip(jwt, 'NIFTY26JUN26');
  await new Promise(r => setTimeout(r, 2000));
  await searchScrip(jwt, 'NIFTY27JUN26');
  await new Promise(r => setTimeout(r, 2000));
  await searchScrip(jwt, 'NIFTY07JUL26');
}

main().catch(e => console.error(e.response?.data || e.message));
