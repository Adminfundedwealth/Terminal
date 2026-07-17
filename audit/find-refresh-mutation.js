const https = require('https');
const TOKEN = (require('C:/Users/jitro/.railway/config.json')).user.accessToken;

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
  // Find auth-related mutations
  const r = await gql(`{
    __schema {
      mutationType { fields { name args { name type { name kind ofType { name } } } } }
    }
  }`);
  
  const authMuts = (r?.data?.__schema?.mutationType?.fields || [])
    .filter(f => f.name.toLowerCase().includes('auth') || f.name.toLowerCase().includes('token') || f.name.toLowerCase().includes('refresh') || f.name.toLowerCase().includes('login'));
  
  console.log('Auth/token mutations:');
  authMuts.forEach(m => {
    const args = m.args.map(a => a.name).join(', ');
    console.log(`  ${m.name}(${args})`);
  });

  // Try me query to check if token still partially works
  const me = await gql(`{ me { id email } }`);
  console.log('\nme:', JSON.stringify(me?.data?.me || me?.errors));
  
  // Try deployments query directly
  const deps = await gql(`query {
    deployments(first: 3 input: { serviceId: "07fcda72-6e99-4d46-b8e6-a5335d74dd3a", environmentId: "3704e786-5da1-49fa-bea5-11ed269cec38" }) {
      edges { node { id status createdAt } }
    }
  }`);
  console.log('\ndeployments:', JSON.stringify(deps?.data || deps?.errors)?.substring(0, 300));
}

main().catch(e => console.error(e.message));
