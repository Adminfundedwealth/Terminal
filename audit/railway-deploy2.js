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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.substring(0, 300) }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Get workspaces and their projects
  const ws = await gql(`{
    me {
      workspaces {
        edges {
          node {
            id name
            projects {
              edges {
                node {
                  id name
                  services { edges { node { id name } } }
                  environments { edges { node { id name } } }
                }
              }
            }
          }
        }
      }
    }
  }`);

  if (ws.errors) { console.error('Errors:', JSON.stringify(ws.errors)); return; }

  const workspaces = ws?.data?.me?.workspaces?.edges || [];
  workspaces.forEach(w => {
    console.log(`Workspace: [${w.node.id}] "${w.node.name}"`);
    (w.node.projects?.edges || []).forEach(p => {
      console.log(`  Project: [${p.node.id}] "${p.node.name}"`);
      (p.node.services?.edges || []).forEach(s => console.log(`    Service: ${s.node.id} "${s.node.name}"`));
      (p.node.environments?.edges || []).forEach(e => console.log(`    Env: ${e.node.id} "${e.node.name}"`));
    });
  });

  // Find terminal project across all workspaces
  let serviceId = null, envId = null, projectName = null;
  for (const w of workspaces) {
    for (const p of (w.node.projects?.edges || [])) {
      if (p.node.name.toLowerCase().includes('terminal') || p.node.name.toLowerCase().includes('funded')) {
        projectName = p.node.name;
        const services = p.node.services?.edges || [];
        const envs = p.node.environments?.edges || [];
        if (services.length && envs.length) {
          serviceId = services[0].node.id;
          envId = (envs.find(e => e.node.name === 'production') || envs[0]).node.id;
        }
      }
    }
  }

  if (!serviceId) {
    console.log('\nNo Terminal project found. Trying projects query directly...');
    const proj = await gql(`{ projects(first: 20) { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } }`);
    const allProjects = proj?.data?.projects?.edges || [];
    allProjects.forEach(p => {
      console.log(`  [${p.node.id}] "${p.node.name}"`);
      if (p.node.name.toLowerCase().includes('terminal') || p.node.name.toLowerCase().includes('funded')) {
        serviceId = p.node.services?.edges?.[0]?.node?.id;
        envId = (p.node.environments?.edges?.find(e => e.node.name === 'production') || p.node.environments?.edges?.[0])?.node?.id;
        projectName = p.node.name;
      }
    });
  }

  if (!serviceId) { console.log('\nStill no Terminal project found'); return; }

  console.log(`\n→ Redeploying "${projectName}" service=${serviceId} env=${envId}`);

  // Try serviceInstanceRedeploy
  const r1 = await gql(`
    mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `, { serviceId, environmentId: envId });

  if (r1.errors) {
    console.log('serviceInstanceRedeploy failed:', JSON.stringify(r1.errors));
    
    // Try deploymentRedeploy — need a deployment ID first
    const deps = await gql(`
      query($serviceId: String!, $environmentId: String!) {
        deployments(first: 1 input: { serviceId: $serviceId, environmentId: $environmentId }) {
          edges { node { id status } }
        }
      }
    `, { serviceId, environmentId: envId });
    
    const depId = deps?.data?.deployments?.edges?.[0]?.node?.id;
    if (depId) {
      console.log(`Latest deployment: ${depId}`);
      const r2 = await gql(`
        mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }
      `, { id: depId });
      console.log('deploymentRedeploy:', JSON.stringify(r2?.data || r2?.errors, null, 2));
    }
  } else {
    console.log('✅ serviceInstanceRedeploy triggered:', JSON.stringify(r1.data, null, 2));
  }
}

main().catch(e => console.error('Fatal:', e.message));
