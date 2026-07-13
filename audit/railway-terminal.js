const https = require('https');
const TOKEN = process.argv[2];

// Correct IDs from previous discovery
const SERVICE_ID = '07fcda72-6e99-4d46-b8e6-a5335d74dd3a'; // Terminal service
const ENV_ID = '3704e786-5da1-49fa-bea5-11ed269cec38';     // production env

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
  console.log('Getting latest deployment for Terminal service...');
  
  const deps = await gql(`query($sId: String!, $eId: String!) {
    deployments(first: 5 input: { serviceId: $sId, environmentId: $eId }) {
      edges { node { id status createdAt } }
    }
  }`, { sId: SERVICE_ID, eId: ENV_ID });

  const depList = deps?.data?.deployments?.edges || [];
  if (deps?.errors) { console.log('Errors:', JSON.stringify(deps.errors)); return; }
  
  console.log('Recent deployments:');
  depList.forEach(d => console.log(`  ${d.node.id} status=${d.node.status} ${d.node.createdAt}`));

  if (!depList.length) {
    // Try serviceInstanceRedeploy directly
    console.log('\nNo deployments found, trying serviceInstanceRedeploy...');
    const r = await gql(`mutation { serviceInstanceRedeploy(serviceId: "${SERVICE_ID}", environmentId: "${ENV_ID}") }`);
    console.log('Result:', JSON.stringify(r?.data || r?.errors));
    return;
  }

  // Redeploy latest
  const latestId = depList[0].node.id;
  console.log(`\n→ Redeploying terminal: ${latestId}`);

  const r = await gql(`mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }`, { id: latestId });

  if (r?.data?.deploymentRedeploy) {
    console.log('✅ TERMINAL REDEPLOY TRIGGERED!');
    console.log('  Deployment ID:', r.data.deploymentRedeploy.id);
    console.log('  Status:', r.data.deploymentRedeploy.status);
    console.log('\n  Watch build at: https://railway.com/project/246602ad-8de0-466e-bdad-55cc023e6502');
  } else {
    console.log('deploymentRedeploy error:', JSON.stringify(r?.errors || r?.data));
    
    // Try serviceInstanceRedeploy
    const r2 = await gql(`mutation { serviceInstanceRedeploy(serviceId: "${SERVICE_ID}", environmentId: "${ENV_ID}") }`);
    console.log('serviceInstanceRedeploy:', JSON.stringify(r2?.data || r2?.errors));
  }
}

main().catch(e => console.error('Fatal:', e.message));
