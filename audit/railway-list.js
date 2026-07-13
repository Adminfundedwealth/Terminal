const https = require('https');
const TOKEN = process.argv[2];

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${TOKEN}` }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.substring(0,500) }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

gql(`query { me { projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } } }`)
  .then(r => {
    if (r.errors) { console.log('Errors:', JSON.stringify(r.errors)); return; }
    const projects = r?.data?.me?.projects?.edges || [];
    projects.forEach(p => {
      console.log(`PROJECT: "${p.node.id}" name="${p.node.name}"`);
      (p.node.services?.edges||[]).forEach(s => console.log(`  service: ${s.node.id} "${s.node.name}"`));
      (p.node.environments?.edges||[]).forEach(e => console.log(`  env: ${e.node.id} "${e.node.name}"`));
    });
  })
  .catch(e => console.error(e.message));
