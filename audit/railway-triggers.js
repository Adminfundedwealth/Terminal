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
  // Check deployment triggers
  const trType = await gql(`{ __type(name: "DeploymentTrigger") { fields { name } } }`);
  console.log('DeploymentTrigger fields:', trType?.data?.__type?.fields?.map(f=>f.name).join(', '));

  const dt = await gql(`query($sId: String!, $eId: String!) {
    deploymentTriggers(serviceId: $sId, environmentId: $eId) {
      edges { node { id provider repository branch validBranches } }
    }
  }`, { sId: SERVICE_ID, eId: ENV_ID });
  
  const triggers = dt?.data?.deploymentTriggers?.edges || [];
  console.log('\nDeploy triggers:', JSON.stringify(triggers, null, 2));

  // Check serviceInstance for autodeploy + source
  const si = await gql(`query($sId: String!, $eId: String!) {
    serviceInstance(serviceId: $sId, environmentId: $eId) {
      id source { image repo }
      latestDeployment { id status }
      builder dockerfilePath
    }
  }`, { sId: SERVICE_ID, eId: ENV_ID });
  
  console.log('\nServiceInstance:', JSON.stringify(si?.data?.serviceInstance || si?.errors, null, 2));
  
  // If there's a trigger, update it or create one pointing to main
  if (triggers.length === 0) {
    console.log('\n⚠️  No deployment triggers found! Railway is not connected to GitHub.');
    console.log('This explains why pushes do not trigger automatic redeploys.');
    
    // Try to create a trigger
    const repo = si?.data?.serviceInstance?.source?.repo;
    if (repo) {
      console.log(`\nCreating deploy trigger for ${repo}@main...`);
      const create = await gql(`mutation($input: DeploymentTriggerCreateInput!) {
        deploymentTriggerCreate(input: $input) { id provider repository branch }
      }`, { input: { serviceId: SERVICE_ID, environmentId: ENV_ID, provider: 'GITHUB', repository: repo, branch: 'main' } });
      console.log('Create trigger result:', JSON.stringify(create?.data || create?.errors, null, 2));
    }
  } else {
    console.log('\n✅ Deploy triggers exist - GitHub webhook should work');
    // Update the trigger to point to main
    const triggerId = triggers[0].node.id;
    const update = await gql(`mutation($id: String!, $input: DeploymentTriggerUpdateInput!) {
      deploymentTriggerUpdate(id: $id, input: $input) { id branch }
    }`, { id: triggerId, input: { branch: 'main' } });
    console.log('Updated trigger:', JSON.stringify(update?.data || update?.errors, null, 2));
  }
}

main().catch(e => console.error(e.message));
