/**
 * Triggers a Railway deployment from the latest GitHub commit
 */
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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.substring(0,500) }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Get the service instance details to find GitHub source
  const svc = await gql(`query($sId: String!, $eId: String!) {
    serviceInstance(serviceId: $sId, environmentId: $eId) {
      id
      source { image repo branch commit }
      latestDeployment { id status commitSha }
    }
  }`, { sId: SERVICE_ID, eId: ENV_ID });

  console.log('Service instance:', JSON.stringify(svc?.data?.serviceInstance, null, 2));
  if (svc?.errors) console.log('Errors:', JSON.stringify(svc.errors));

  // Try githubRepoDeploy mutation to trigger from latest commit
  const repo = svc?.data?.serviceInstance?.source?.repo;
  const branch = svc?.data?.serviceInstance?.source?.branch || 'main';

  if (repo) {
    console.log(`\nRepo: ${repo}, branch: ${branch}`);
    console.log('Triggering GitHub deploy...');
    const deploy = await gql(`mutation($input: GitHubRepoDeployInput!) {
      githubRepoDeploy(input: $input) { id status }
    }`, {
      input: { repo, branch, serviceId: SERVICE_ID, environmentId: ENV_ID }
    });
    console.log('githubRepoDeploy:', JSON.stringify(deploy?.data || deploy?.errors, null, 2));
  }

  // Also try serviceInstanceDeploy
  console.log('\nTrying serviceInstanceDeploy...');
  const deploy2 = await gql(`mutation($sId: String!, $eId: String!) {
    serviceInstanceDeploy(serviceId: $sId, environmentId: $eId)
  }`, { sId: SERVICE_ID, eId: ENV_ID });
  console.log('serviceInstanceDeploy:', JSON.stringify(deploy2?.data || deploy2?.errors, null, 2));
}

main().catch(e => console.error(e.message));
