const https = require('https');
const TOKEN = process.argv[2];
const WS_ID = 'ab2e48f4-fcf8-4268-8dfe-28dcd480e464';

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
  // Get all projects in workspace
  const r = await gql(`query($wsId: String!) {
    projects(workspaceId: $wsId, first: 20) {
      edges {
        node {
          id name
          services { edges { node { id name } } }
          environments { edges { node { id name } } }
        }
      }
    }
  }`, { wsId: WS_ID });

  const projects = r?.data?.projects?.edges || [];
  console.log('Projects:');
  projects.forEach(p => {
    const svcs = (p.node.services?.edges || []).map(s => `${s.node.name}(${s.node.id})`).join(', ');
    const envs = (p.node.environments?.edges || []).map(e => `${e.node.name}(${e.node.id})`).join(', ');
    console.log(`  [${p.node.id}] "${p.node.name}"`);
    console.log(`    services: ${svcs}`);
    console.log(`    envs: ${envs}`);
  });

  // Find terminal/funded project
  const target = projects.find(p =>
    p.node.name.toLowerCase().includes('terminal') ||
    p.node.name.toLowerCase().includes('funded') ||
    p.node.name.toLowerCase().includes('distinguished')
  ) || projects[0];

  if (!target) { console.log('\nNo project found'); return; }

  const projectId = target.node.id;
  const serviceId = target.node.services?.edges?.[0]?.node?.id;
  const envId = (target.node.environments?.edges?.find(e => e.node.name === 'production')
              || target.node.environments?.edges?.[0])?.node?.id;

  console.log(`\nTarget: "${target.node.name}" service=${serviceId} env=${envId}`);

  if (!serviceId || !envId) { console.log('Missing IDs'); return; }

  // Get latest deployment
  const deps = await gql(`query($sId: String!, $eId: String!) {
    deployments(first: 3 input: { serviceId: $sId, environmentId: $eId }) {
      edges { node { id status createdAt } }
    }
  }`, { sId: serviceId, eId: envId });

  const depList = deps?.data?.deployments?.edges || [];
  console.log('Recent deployments:');
  depList.forEach(d => console.log(`  ${d.node.id.substring(0,12)} status=${d.node.status} created=${d.node.createdAt}`));

  if (!depList.length) { console.log('No deployments found'); return; }

  // Redeploy latest
  const latestId = depList[0].node.id;
  console.log(`\n→ Redeploying ${latestId.substring(0,12)}...`);

  const redeploy = await gql(`mutation($id: String!) {
    deploymentRedeploy(id: $id) { id status }
  }`, { id: latestId });

  if (redeploy?.data?.deploymentRedeploy) {
    console.log('✅ REDEPLOY TRIGGERED!');
    console.log('  New deployment:', redeploy.data.deploymentRedeploy.id);
    console.log('  Status:', redeploy.data.deploymentRedeploy.status);
  } else {
    console.log('Error:', JSON.stringify(redeploy?.errors || redeploy?.data));

    // Fallback: serviceInstanceRedeploy
    const r2 = await gql(`mutation($sId: String!, $eId: String!) {
      serviceInstanceRedeploy(serviceId: $sId, environmentId: $eId)
    }`, { sId: serviceId, eId: envId });

    if (r2?.data?.serviceInstanceRedeploy !== undefined) {
      console.log('✅ serviceInstanceRedeploy result:', r2.data.serviceInstanceRedeploy);
    } else {
      console.log('serviceInstanceRedeploy error:', JSON.stringify(r2?.errors));
    }
  }
}

main().catch(e => console.error('Fatal:', e.message));
