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
  // Introspect ServiceSource and ServiceInstance
  const ssType = await gql(`{ __type(name: "ServiceSource") { fields { name } } }`);
  console.log('ServiceSource fields:', ssType?.data?.__type?.fields?.map(f=>f.name).join(', '));
  
  const siType = await gql(`{ __type(name: "ServiceInstance") { fields { name } } }`);
  const siFields = siType?.data?.__type?.fields?.map(f=>f.name) || [];
  console.log('ServiceInstance fields:', siFields.join(', '));

  // Get service instance
  const svc = await gql(`query($sId: String!, $eId: String!) {
    serviceInstance(serviceId: $sId, environmentId: $eId) {
      id source { image repo }
    }
  }`, { sId: SERVICE_ID, eId: ENV_ID });
  
  console.log('\nServiceInstance:', JSON.stringify(svc?.data?.serviceInstance, null, 2));
  
  const repo = svc?.data?.serviceInstance?.source?.repo;
  if (!repo) { console.log('No repo'); }

  // Check available deploy mutations
  const mutType = await gql(`{ __schema { mutationType { fields { name args { name type { name kind ofType { name } } } } } } }`);
  const deployMuts = (mutType?.data?.__schema?.mutationType?.fields || [])
    .filter(f => f.name.toLowerCase().includes('deploy') || f.name.toLowerCase().includes('trigger'));
  
  console.log('\nDeploy-related mutations:');
  deployMuts.forEach(m => {
    const args = m.args.map(a => `${a.name}:${a.type?.name || a.type?.ofType?.name}`).join(', ');
    console.log(`  ${m.name}(${args})`);
  });

  // Try environmentTriggersDeploy
  console.log('\nTrying environmentTriggersDeploy...');
  const r = await gql(`mutation($eId: String!) { environmentTriggersDeploy(environmentId: $eId) }`, { eId: ENV_ID });
  console.log('result:', JSON.stringify(r?.data || r?.errors));

  // Try deploymentTriggerCreate
  if (repo) {
    console.log('\nTrying deploymentTriggerCreate...');
    const r2 = await gql(`
      mutation($input: DeploymentTriggerCreateInput!) {
        deploymentTriggerCreate(input: $input) { id }
      }
    `, { input: { serviceId: SERVICE_ID, environmentId: ENV_ID, provider: 'GITHUB', repo, branch: 'main' } });
    console.log('deploymentTriggerCreate:', JSON.stringify(r2?.data || r2?.errors));
  }
}

main().catch(e => console.error(e.message));
