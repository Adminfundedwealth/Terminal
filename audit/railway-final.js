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
  // 1. Introspect Workspace type
  const wsType = await gql(`{ __type(name: "Workspace") { fields { name type { name kind ofType { name kind } } } } }`);
  const wsFields = wsType?.data?.__type?.fields?.map(f => f.name) || [];
  console.log('Workspace fields:', wsFields.join(', '));

  // 2. Get me.workspaces using correct structure
  const me = await gql(`{ me { workspaces { id name } } }`);
  const workspaces = me?.data?.me?.workspaces || [];
  console.log('\nWorkspaces:', JSON.stringify(workspaces).substring(0, 200));

  if (!workspaces.length) { console.log('No workspaces'); return; }

  // 3. Get projects for each workspace
  for (const ws of Array.isArray(workspaces) ? workspaces : [workspaces]) {
    console.log(`\nWorkspace: ${ws.id} "${ws.name}"`);
    const proj = await gql(`
      query($id: String!) {
        workspace(id: $id) {
          projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } }
        }
      }
    `, { id: ws.id });

    const projects = proj?.data?.workspace?.projects?.edges || [];
    projects.forEach(p => {
      console.log(`  Project: [${p.node.id}] "${p.node.name}"`);
      (p.node.services?.edges || []).forEach(s => console.log(`    Service: ${s.node.id} "${s.node.name}"`));
      (p.node.environments?.edges || []).forEach(e => console.log(`    Env: ${e.node.id} "${e.node.name}"`));
    });

    // Find Terminal and redeploy
    const terminal = projects.find(p => p.node.name.toLowerCase().includes('terminal') || p.node.name.toLowerCase().includes('funded'));
    if (terminal) {
      const serviceId = terminal.node.services?.edges?.[0]?.node?.id;
      const envId = (terminal.node.environments?.edges?.find(e => e.node.name === 'production') || terminal.node.environments?.edges?.[0])?.node?.id;

      if (!serviceId || !envId) { console.log('Missing service/env IDs'); continue; }

      console.log(`\n→ Triggering redeploy: service=${serviceId} env=${envId}`);
      
      // Get latest deployment first
      const deps = await gql(`
        query($serviceId: String!, $environmentId: String!) {
          deployments(first: 3 input: { serviceId: $serviceId, environmentId: $environmentId }) {
            edges { node { id status createdAt } }
          }
        }
      `, { serviceId, environmentId: envId });
      
      const deployList = deps?.data?.deployments?.edges || [];
      console.log('Recent deployments:', deployList.map(d => `${d.node.id.substring(0,8)} ${d.node.status}`).join(', '));

      if (deployList.length) {
        const latestId = deployList[0].node.id;
        const r = await gql(`mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }`, { id: latestId });
        if (r?.data?.deploymentRedeploy) {
          console.log('✅ Redeploy triggered! New deployment:', r.data.deploymentRedeploy.id, r.data.deploymentRedeploy.status);
        } else {
          console.log('deploymentRedeploy result:', JSON.stringify(r?.data || r?.errors));
          
          // Try serviceInstanceRedeploy
          const r2 = await gql(`mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`, { serviceId, environmentId: envId });
          console.log('serviceInstanceRedeploy:', JSON.stringify(r2?.data || r2?.errors));
        }
      }
    }
  }
}

main().catch(e => console.error('Fatal:', e.message));
