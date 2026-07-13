const https = require('https');
const ACCESS_TOKEN = process.argv[2];
const PROJECT_ID = '246602ad-8de0-466e-bdad-55cc023e6502';

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'User-Agent': 'railway-cli/5.23.1' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Get existing project tokens
  const tokens = await gql(`query($projectId: String!) {
    projectTokens(projectId: $projectId) {
      edges { node { id name displayToken } }
    }
  }`, { projectId: PROJECT_ID });
  
  console.log('Existing tokens:', JSON.stringify(tokens?.data?.projectTokens?.edges || tokens?.errors, null, 2));

  // Create a new project token
  console.log('\nCreating project token...');
  const create = await gql(`mutation($projectId: String!, $name: String!, $environmentId: String!) {
    projectTokenCreate(projectId: $projectId, name: $name, environmentId: $environmentId) {
      id token
    }
  }`, {
    projectId: PROJECT_ID,
    name: 'deploy-token',
    environmentId: '3704e786-5da1-49fa-bea5-11ed269cec38'
  });
  
  if (create?.data?.projectTokenCreate?.token) {
    console.log('\n✅ PROJECT TOKEN CREATED!');
    console.log('Token:', create.data.projectTokenCreate.token);
    console.log('\nUse this with: RAILWAY_TOKEN=<token> railway up');
  } else {
    console.log('Error:', JSON.stringify(create?.errors || create?.data, null, 2));
  }
}

main().catch(e => console.error(e.message));
