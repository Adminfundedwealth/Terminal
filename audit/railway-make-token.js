const https = require('https');
const ACCESS_TOKEN = process.argv[2];
const PROJECT_ID = '246602ad-8de0-466e-bdad-55cc023e6502';
const ENV_ID = '3704e786-5da1-49fa-bea5-11ed269cec38';

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
  // Introspect projectTokenCreate input
  const inp = await gql(`{ __type(name: "ProjectTokenCreateInput") { inputFields { name type { name kind ofType { name } } } } }`);
  const fields = inp?.data?.__type?.inputFields?.map(f => f.name) || [];
  console.log('ProjectTokenCreateInput fields:', fields.join(', '));

  // Create token
  const r = await gql(`mutation($input: ProjectTokenCreateInput!) {
    projectTokenCreate(input: $input)
  }`, { input: { projectId: PROJECT_ID, environmentId: ENV_ID, name: 'kiro-deploy' } });
  
  if (r?.data?.projectTokenCreate) {
    console.log('\n✅ TOKEN:', r.data.projectTokenCreate);
  } else {
    console.log('Error:', JSON.stringify(r?.errors || r?.data, null, 2));
  }
}

main().catch(e => console.error(e.message));
