const https = require('https');
const TOKEN = process.argv[2];

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    // Try both API endpoints
    const endpoints = [
      { hostname: 'backboard.railway.com', path: '/graphql/v2' },
      { hostname: 'backboard.railway.app', path: '/graphql/v2' },
    ];
    
    function tryNext(i) {
      if (i >= endpoints.length) { resolve(null); return; }
      const ep = endpoints[i];
      const req = https.request({
        hostname: ep.hostname, path: ep.path, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Bearer ${TOKEN}`,
          'User-Agent': 'railway-cli/5.23.1'
        }
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          console.log(`  ${ep.hostname}: HTTP ${res.statusCode}`);
          try {
            const j = JSON.parse(d);
            if (j.data || j.errors) { resolve(j); }
            else { console.log('  body:', d.substring(0, 100)); tryNext(i+1); }
          } catch { console.log('  raw:', d.substring(0,100)); tryNext(i+1); }
        });
      });
      req.on('error', e => { console.log(`  ${ep.hostname}: error ${e.message}`); tryNext(i+1); });
      req.write(body); req.end();
    }
    tryNext(0);
  });
}

async function main() {
  console.log(`Testing with token: ${TOKEN.substring(0,12)}...`);
  
  const r = await gql(`{ me { id email projects { edges { node { id name } } } } }`);
  if (!r) { console.log('All endpoints failed'); return; }
  if (r.errors) { console.log('Errors:', JSON.stringify(r.errors)); return; }
  
  console.log('Me:', r.data?.me?.email);
  const projects = r.data?.me?.projects?.edges || [];
  console.log('Projects:');
  projects.forEach(p => console.log(`  [${p.node.id}] "${p.node.name}"`));
  
  // Find terminal
  const terminal = projects.find(p => p.node.name.toLowerCase().includes('terminal') || p.node.name.toLowerCase().includes('funded'));
  if (!terminal) { console.log('\nNo matching project — listing all names:', projects.map(p=>p.node.name)); return; }
  
  const projectId = terminal.node.id;
  console.log(`\nUsing project: ${terminal.node.name} (${projectId})`);
  
  // Get services + envs
  const details = await gql(`query($id: String!) {
    project(id: $id) {
      services { edges { node { id name } } }
      environments { edges { node { id name } } }
    }
  }`, { id: projectId });
  
  const services = details?.data?.project?.services?.edges || [];
  const envs = details?.data?.project?.environments?.edges || [];
  console.log('Services:', services.map(s=>`${s.node.name}(${s.node.id})`).join(', '));
  console.log('Envs:', envs.map(e=>`${e.node.name}(${e.node.id})`).join(', '));
  
  if (!services.length || !envs.length) return;
  
  const serviceId = services[0].node.id;
  const envId = (envs.find(e=>e.node.name==='production') || envs[0]).node.id;
  
  // Trigger redeploy
  console.log(`\nRedeploying service=${serviceId} env=${envId}...`);
  const redeploy = await gql(`
    mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `, { serviceId, environmentId: envId });
  
  console.log('Result:', JSON.stringify(redeploy?.data || redeploy?.errors, null, 2));
}

main().catch(e => console.error('Fatal:', e.message));
