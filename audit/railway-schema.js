const https = require('https');
const TOKEN = process.argv[2];

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
  // Get workspace query args
  const wsField = await gql(`{
    __schema {
      queryType {
        fields {
          name
          args { name type { name kind ofType { name } } }
        }
      }
    }
  }`);

  const fields = wsField?.data?.__schema?.queryType?.fields || [];
  const wsQ = fields.find(f => f.name === 'workspace');
  const projQ = fields.find(f => f.name === 'projects');
  
  console.log('workspace query args:', JSON.stringify(wsQ?.args));
  console.log('projects query args:', JSON.stringify(projQ?.args));
  
  // Try workspace with correct args
  for (const arg of wsQ?.args || []) {
    console.log(`  workspace arg: ${arg.name} type=${arg.type?.name || arg.type?.kind}`);
  }

  // Try the correct workspace query  
  const r = await gql(`{ workspace { id name projects { edges { node { id name } } } } }`);
  console.log('\nworkspace (no args):', JSON.stringify(r?.data || r?.errors)?.substring(0, 400));
  
  // Try projects with correct args
  for (const arg of projQ?.args || []) {
    console.log(`  projects arg: ${arg.name} type=${arg.type?.name || arg.type?.kind}`);
  }
}

main().catch(e => console.error(e.message));
