const https = require('https');
const TOKEN = process.argv[2];
const SERVICE_ID = '07fcda72-6e99-4d46-b8e6-a5335d74dd3a';
const ENV_ID = '3704e786-5da1-49fa-bea5-11ed269cec38';

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${TOKEN}`, 'User-Agent': 'railway-cli/5.23.1' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // serviceInstanceDeploy with latestCommit=true
  console.log('Deploying latest commit...');
  const r = await gql(`mutation($sId: String!, $eId: String!) {
    serviceInstanceDeploy(serviceId: $sId, environmentId: $eId, latestCommit: true)
  }`, { sId: SERVICE_ID, eId: ENV_ID });
  console.log('serviceInstanceDeploy(latestCommit):', JSON.stringify(r?.data || r?.errors, null, 2));

  // Also try V2
  console.log('\nTrying serviceInstanceDeployV2...');
  const r2 = await gql(`mutation($sId: String!, $eId: String!) {
    serviceInstanceDeployV2(serviceId: $sId, environmentId: $eId)
  }`, { sId: SERVICE_ID, eId: ENV_ID });
  console.log('serviceInstanceDeployV2:', JSON.stringify(r2?.data || r2?.errors, null, 2));
  
  // Try environmentTriggersDeploy
  console.log('\nTrying environmentTriggersDeploy with input...');
  const r3 = await gql(`mutation($input: EnvironmentTriggersDeployInput!) {
    environmentTriggersDeploy(input: $input)
  }`, { input: { environmentId: ENV_ID } });
  console.log('environmentTriggersDeploy:', JSON.stringify(r3?.data || r3?.errors, null, 2));

  // Poll health after 30s
  console.log('\nWaiting 30s then checking health...');
  await new Promise(r => setTimeout(r, 30000));
  
  await new Promise((resolve) => {
    const req = https.request({ hostname: 'terminal-production-4429.up.railway.app', path: '/health', method: 'GET' }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { const h = JSON.parse(d); console.log(`Health: uptime=${h.uptime}s, tokens=${h.marketData?.subscribedTokens}`); }
        catch { console.log('Health raw:', d.substring(0, 100)); }
        resolve();
      });
    });
    req.on('error', e => { console.log('Health error:', e.message); resolve(); });
    req.end();
  });
}

main().catch(e => console.error(e.message));
