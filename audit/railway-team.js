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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({raw:d}); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Try teams query
  const teams = await gql(`{
    me {
      id email
      teams { edges { node { id name projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } } } }
    }
  }`);
  
  console.log('teams query:', JSON.stringify(teams?.data?.me?.teams || teams?.errors, null, 2).substring(0, 1000));
  
  // Try workspaces
  const ws = await gql(`{ workspaceForUser { id name projects { edges { node { id name } } } } }`);
  console.log('\nworkspaceForUser:', JSON.stringify(ws?.data || ws?.errors, null, 2).substring(0, 500));
  
  // Try all projects via different query  
  const projects = await gql(`{ projects(first: 20) { edges { node { id name } } } }`);
  console.log('\nprojects query:', JSON.stringify(projects?.data || projects?.errors, null, 2).substring(0, 500));
}

main().catch(e => console.error(e.message));
