const https = require('https');

const TOKEN = process.argv[2];
if (!TOKEN) { console.error('Usage: node railway-trigger.js <access_token>'); process.exit(1); }

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com',
      path: '/graphql/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${TOKEN}`,
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.substring(0,400) }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Get all projects + services
  const me = await gql(`query {
    me {
      projects {
        edges {
          node {
            id
            name
            services { edges { node { id name } } }
            environments { edges { node { id name } } }
          }
        }
      }
    }
  }`);

  if (me.errors) { console.error('Auth error:', JSON.stringify(me.errors)); process.exit(1); }

  const projects = me?.data?.me?.projects?.edges || [];
  console.log('Projects:');
  projects.forEach(p => {
    const services = p.node.services?.edges?.map(s => `${s.node.name}(${s.node.id})`).join(', ');
    const envs = p.node.environments?.edges?.map(e => `${e.node.name}(${e.node.id})`).join(', ');
    console.log(`  [${p.node.id}] ${p.node.name}`);
    console.log(`    Services: ${services || 'none'}`);
    console.log(`    Envs: ${envs || 'none'}`);
  });

  // 2. Find Terminal project
  const terminal = projects.find(p => p.node.name.toLowerCase().includes('terminal'));
  if (!terminal) { console.error('\nNo Terminal project found'); return; }

  const projectId = terminal.node.id;
  const service = terminal.node.services?.edges?.[0]?.node;
  const env = terminal.node.environments?.edges?.find(e => e.node.name === 'production')?.node
           || terminal.node.environments?.edges?.[0]?.node;

  if (!service || !env) { console.error('Missing service or env'); return; }

  console.log(`\nTarget: project=${projectId} service=${service.id}(${service.name}) env=${env.id}(${env.name})`);

  // 3. Trigger redeploy
  console.log('\nTriggering redeploy...');
  const deploy = await gql(`
    mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `, { serviceId: service.id, environmentId: env.id });

  if (deploy.errors) {
    console.error('Redeploy error:', JSON.stringify(deploy.errors));
    // Try alternative mutation
    console.log('\nTrying deploymentCreate...');
    const deploy2 = await gql(`
      mutation($serviceId: String!, $environmentId: String!) {
        deploymentCreate(input: { serviceId: $serviceId, environmentId: $environmentId }) { id status }
      }
    `, { serviceId: service.id, environmentId: env.id });
    console.log('deploymentCreate result:', JSON.stringify(deploy2, null, 2));
  } else {
    console.log('Redeploy triggered:', JSON.stringify(deploy.data, null, 2));
  }

  // 4. Check latest deployment status
  await new Promise(r => setTimeout(r, 2000));
  const deployments = await gql(`
    query($serviceId: String!, $environmentId: String!) {
      deployments(
        first: 3
        input: { serviceId: $serviceId, environmentId: $environmentId }
      ) {
        edges {
          node {
            id
            status
            createdAt
            url
          }
        }
      }
    }
  `, { serviceId: service.id, environmentId: env.id });

  const deps = deployments?.data?.deployments?.edges || [];
  console.log('\nLatest deployments:');
  deps.forEach(d => {
    console.log(`  [${d.node.id.substring(0,8)}] status=${d.node.status} created=${d.node.createdAt}`);
  });
}

main().catch(e => console.error('Fatal:', e.message));
