/**
 * Gets a shell token from Railway that works with railway CLI
 * Uses loginSessionConsume flow
 */
const https = require('https');

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
  // Check generateShellToken input
  const inp = await gql(`{ __type(name: "GenerateShellTokenInput") { inputFields { name type { name } } } }`);
  console.log('GenerateShellTokenInput:', JSON.stringify(inp?.data?.__type?.inputFields));

  // Try loginSessionCreate then immediately consume with a known code
  // The session create flow is the only way to get a token without a browser
  
  // Alternative: try apiTokenCreate which might work with the current session
  const apiInp = await gql(`{ __type(name: "ApiTokenCreateInput") { inputFields { name type { name } } } }`);
  console.log('ApiTokenCreateInput:', JSON.stringify(apiInp?.data?.__type?.inputFields));

  // Create an API token using the current (possibly expired) session cookie approach
  // Railway sessions are stored differently  
  console.log('\nAttempting to create API token...');
  
  // Try loginSessionAuth with a new session
  const sessionR = await gql(`mutation { loginSessionCreate }`);
  const code = sessionR?.data?.loginSessionCreate;
  if (code) {
    console.log(`\nNew login session: ${code}`);
    console.log(`Authorize at: https://railway.com/activate?user_code=${code}`);
    
    // Poll
    console.log('Polling for 90 seconds...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const verify = await gql(`mutation($code: String!) { loginSessionVerify(code: $code) }`, { code });
      const token = verify?.data?.loginSessionVerify;
      if (token && typeof token === 'string') {
        console.log('\n✅ TOKEN OBTAINED:', token);
        
        // Save it
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('C:/Users/jitro/.railway/config.json', 'utf8'));
        config.user.token = token;
        config.user.accessToken = token;
        fs.writeFileSync('C:/Users/jitro/.railway/config.json', JSON.stringify(config, null, 2));
        
        // Now trigger redeploy
        console.log('\nTriggering Terminal redeploy...');
        const deps = await gql(`query {
          deployments(first: 1 input: { serviceId: "07fcda72-6e99-4d46-b8e6-a5335d74dd3a", environmentId: "3704e786-5da1-49fa-bea5-11ed269cec38" }) {
            edges { node { id status } }
          }
        }`, {}, token);
        
        const depId = deps?.data?.deployments?.edges?.[0]?.node?.id;
        if (depId) {
          const r = await gql(`mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }`, { id: depId }, token);
          console.log('Redeploy:', JSON.stringify(r?.data || r?.errors));
        }
        return;
      }
      process.stdout.write('.');
    }
    console.log('\nTimeout.');
  }
}

main().catch(e => console.error(e.message));
