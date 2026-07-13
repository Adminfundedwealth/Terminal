/**
 * Triggers a Railway redeploy via their GraphQL API
 */
const https = require('https');

// Get Railway token from CLI config
const fs = require('fs');
const os = require('os');
const path = require('path');

// Railway stores token in various locations
function getToken() {
  const locations = [
    path.join(os.homedir(), '.railway', 'config.json'),
    path.join(os.homedir(), '.config', 'railway', 'config.json'),
  ];
  for (const loc of locations) {
    try {
      const data = JSON.parse(fs.readFileSync(loc, 'utf8'));
      return data.token || data.tokens?.find(t => t)?.token;
    } catch {}
  }
  return process.env.RAILWAY_TOKEN;
}

function gql(token, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com',
      path: '/graphql/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${token}`,
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const token = getToken();
  if (!token) { console.error('No Railway token found'); process.exit(1); }
  console.log('Railway token found:', token.substring(0, 12) + '...');

  // Get projects
  const projects = await gql(token, `
    query { me { projects { edges { node { id name services { edges { node { id name } } } } } } } }
  `);
  
  const projectEdges = projects?.data?.me?.projects?.edges || [];
  console.log('\nProjects:');
  projectEdges.forEach(p => {
    console.log(`  ${p.node.id} — ${p.node.name}`);
    p.node.services?.edges?.forEach(s => console.log(`    Service: ${s.node.id} — ${s.node.name}`));
  });

  // Find Terminal project
  const terminalProject = projectEdges.find(p => p.node.name.toLowerCase().includes('terminal'));
  if (!terminalProject) { console.error('Terminal project not found'); return; }
  
  const projectId = terminalProject.node.id;
  const serviceId = terminalProject.node.services?.edges?.[0]?.node?.id;
  
  console.log(`\nFound: project=${projectId}, service=${serviceId}`);

  if (!serviceId) { console.error('No service found'); return; }

  // Get environments
  const envs = await gql(token, `
    query($projectId: String!) {
      project(id: $projectId) { environments { edges { node { id name } } } }
    }
  `, { projectId });
  
  const envEdges = envs?.data?.project?.environments?.edges || [];
  console.log('Environments:', envEdges.map(e => `${e.node.id}:${e.node.name}`).join(', '));
  
  const prodEnv = envEdges.find(e => e.node.name === 'production') || envEdges[0];
  if (!prodEnv) { console.error('No environment found'); return; }
  
  const environmentId = prodEnv.node.id;
  console.log(`Using environment: ${environmentId} (${prodEnv.node.name})`);

  // Trigger redeploy
  console.log('\nTriggering redeploy...');
  const deploy = await gql(token, `
    mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `, { serviceId, environmentId });
  
  console.log('Redeploy result:', JSON.stringify(deploy, null, 2));
}

main().catch(e => { console.error('Error:', e.message); });
