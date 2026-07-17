/**
 * Railway browserless login flow:
 * 1. loginSessionCreate → get session code + browser URL
 * 2. User visits URL and clicks authorize
 * 3. loginSessionVerify(code) → get access token
 */
const https = require('https');
const fs = require('fs');
const readline = require('readline');

function gql(query, variables = {}, token = null) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'railway-cli/5.23.1' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST', headers
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Step 1: Create login session
  const session = await gql(`mutation { loginSessionCreate }`);
  const sessionCode = session?.data?.loginSessionCreate;
  if (!sessionCode) { console.error('Failed to create session:', JSON.stringify(session?.errors)); return; }
  
  console.log('\n🔐 Railway Login Required');
  console.log('═══════════════════════════════════════');
  console.log('Visit this URL to authorize:');
  console.log(`  https://railway.com/activate?user_code=${sessionCode}`);
  console.log('\nOr go to https://railway.com/activate');
  console.log(`And enter code: ${sessionCode}`);
  console.log('═══════════════════════════════════════\n');
  
  // Poll for completion
  console.log('Waiting for authorization (checking every 3s)...');
  let attempts = 0;
  while (attempts < 60) { // 3 min timeout
    await new Promise(r => setTimeout(r, 3000));
    attempts++;
    
    const verify = await gql(`mutation($code: String!) { loginSessionVerify(code: $code) }`, { code: sessionCode });
    const token = verify?.data?.loginSessionVerify;
    
    if (token && token !== null && typeof token === 'string') {
      console.log('\n✅ Authorization successful!');
      
      // Save to config
      const configPath = 'C:/Users/jitro/.railway/config.json';
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Get user info
      const me = await gql(`{ me { id email } }`, {}, token);
      const userId = me?.data?.me?.id;
      const email = me?.data?.me?.email;
      console.log(`Logged in as: ${email}`);
      
      config.user.token = token;
      config.user.accessToken = token;
      if (userId) config.user.id = userId;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('Token saved to Railway config.');
      console.log('\nTOKEN:', token.substring(0, 20) + '...');
      return token;
    }
    
    process.stdout.write('.');
    if (attempts % 20 === 0) process.stdout.write(`\n[${attempts * 3}s]`);
  }
  
  console.log('\nTimeout — authorization not completed');
}

main().then(token => {
  if (token) {
    console.log('\nNow run: node audit/railway-terminal.js <token>');
    console.log(`Or: node audit/railway-terminal.js ${token.substring(0, 40)}...`);
  }
}).catch(e => console.error(e.message));
