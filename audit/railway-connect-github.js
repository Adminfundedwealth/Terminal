const https = require('https');
const TOKEN = process.argv[2];
const SERVICE_ID = '07fcda72-6e99-4d46-b8e6-a5335d74dd3a';
const ENV_ID = '3704e786-5da1-49fa-bea5-11ed269cec38';
const REPO = process.argv[3] || 'Adminfundedwealth/Terminal'; // GitHub repo

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
  console.log(`Creating GitHub deploy trigger: ${REPO}@main`);
  console.log(`Service: ${SERVICE_ID}, Env: ${ENV_ID}`);
  
  // Introspect DeploymentTriggerCreateInput
  const inputType = await gql(`{ __type(name: "DeploymentTriggerCreateInput") { inputFields { name type { name kind ofType { name } } } } }`);
  const fields = inputType?.data?.__type?.inputFields?.map(f => f.name) || [];
  console.log('\nDeploymentTriggerCreateInput fields:', fields.join(', '));
  
  // Create the trigger
  const create = await gql(`
    mutation($input: DeploymentTriggerCreateInput!) {
      deploymentTriggerCreate(input: $input) {
        id
        provider
        repository
        branch
      }
    }
  `, {
    input: {
      serviceId: SERVICE_ID,
      environmentId: ENV_ID,
      provider: 'GITHUB',
      repository: REPO,
      branch: 'main',
    }
  });
  
  if (create?.data?.deploymentTriggerCreate) {
    const t = create.data.deploymentTriggerCreate;
    console.log('\n✅ Deploy trigger CREATED!');
    console.log(`  ID: ${t.id}`);
    console.log(`  Provider: ${t.provider}`);
    console.log(`  Repo: ${t.repository}`);
    console.log(`  Branch: ${t.branch}`);
    console.log('\nRailway will now auto-deploy on every push to main.');
    
    // Immediately trigger a deploy from latest commit
    console.log('\nTriggering deploy now from latest commit...');
    const deploy = await gql(`mutation($eId: String!) {
      environmentTriggersDeploy(input: { environmentId: $eId })
    }`, { eId: ENV_ID });
    console.log('Environment deploy:', JSON.stringify(deploy?.data || deploy?.errors));
  } else {
    console.log('\n❌ Failed to create trigger:');
    console.log(JSON.stringify(create?.errors || create?.data, null, 2));
    
    if (create?.errors?.[0]?.message?.includes('github')) {
      console.log('\nNOTE: Railway needs GitHub OAuth authorization to create triggers.');
      console.log('You must connect your GitHub account to Railway in the dashboard:');
      console.log('https://railway.com/project/246602ad-8de0-466e-bdad-55cc023e6502');
      console.log('\nAlternatively, use railway CLI:');
      console.log('  railway link (select Terminal fundedwealth project)');
      console.log('  railway up --service Terminal');
    }
  }
}

main().catch(e => console.error(e.message));
