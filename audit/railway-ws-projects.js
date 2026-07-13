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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.substring(0,200) }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Introspect workspace projects field
  const wsType = await gql(`{ __type(name: "Workspace") { fields { name type { name kind ofType { name kind ofType { name kind } } } } } }`);
  const projField = wsType?.data?.__type?.fields?.find(f => f.name === 'projects');
  console.log('projects field type:', JSON.stringify(projField?.type, null, 2));

  // Try different project query structures
  const queries = [
    `{ workspace(id: "${WS_ID}") { projects { id name } } }`,
    `{ workspace(id: "${WS_ID}") { projects(first: 20) { edges { node { id name } } } } }`,
    `{ projects(input: { workspaceId: "${WS_ID}" }) { edges { node { id name } } } }`,
  ];

  for (const q of queries) {
    const r = await gql(q);
    if (!r.errors && r.data) {
      const proj = r.data?.workspace?.projects || r.data?.projects;
      if (proj) {
        const items = Array.isArray(proj) ? proj : (proj.edges?.map(e => e.node) || []);
        if (items.length) {
          console.log('\nFound projects with query:', q.substring(0, 60));
          items.forEach(p => console.log('  -', p.id, p.name));
          
          // Get services + environments for first terminal project
          const terminal = items.find(p => p.name.toLowerCase().includes('terminal') || p.name.toLowerCase().includes('funded')) || items[0];
          if (terminal) {
            console.log('\nGetting details for:', terminal.name);
            const details = await gql(`query($id: String!) {
              project(id: $id) {
                services { edges { node { id name } } }
                environments { edges { node { id name } } }
              }
            }`, { id: terminal.id });
            
            const services = details?.data?.project?.services?.edges || [];
            const envs = details?.data?.project?.environments?.edges || [];
            console.log('Services:', services.map(s => `${s.node.id} "${s.node.name}"`).join(', '));
            console.log('Envs:', envs.map(e => `${e.node.id} "${e.node.name}"`).join(', '));

            if (services.length && envs.length) {
              const serviceId = services[0].node.id;
              const envId = (envs.find(e => e.node.name === 'production') || envs[0]).node.id;
              
              // Get latest deployment
              const deps = await gql(`query($sId: String!, $eId: String!) {
                deployments(first: 3 input: { serviceId: $sId, environmentId: $eId }) {
                  edges { node { id status createdAt } }
                }
              }`, { sId: serviceId, eId: envId });

              const depList = deps?.data?.deployments?.edges || [];
              console.log('\nDeployments:', depList.map(d => `${d.node.id.substring(0,8)}..${d.node.status} ${d.node.createdAt}`).join('\n  '));

              if (depList.length) {
                console.log('\n→ Triggering redeploy of latest deployment...');
                const redeploy = await gql(`mutation($id: String!) {
                  deploymentRedeploy(id: $id) { id status }
                }`, { id: depList[0].node.id });
                
                if (redeploy?.data?.deploymentRedeploy) {
                  console.log('✅ REDEPLOY TRIGGERED:', redeploy.data.deploymentRedeploy.id, redeploy.data.deploymentRedeploy.status);
                } else {
                  console.log('deploymentRedeploy error:', JSON.stringify(redeploy?.errors || redeploy?.data));
                  
                  // Try serviceInstanceRedeploy
                  const r2 = await gql(`mutation {
                    serviceInstanceRedeploy(serviceId: "${serviceId}", environmentId: "${envId}")
                  }`);
                  console.log('serviceInstanceRedeploy:', JSON.stringify(r2?.data || r2?.errors));
                }
              }
            }
          }
          return;
        }
      }
    } else if (r.errors) {
      console.log('Query failed:', q.substring(0, 60), '->', r.errors[0]?.message?.substring(0, 80));
    }
  }
  console.log('\nAll queries failed to return projects');
}

main().catch(e => console.error('Fatal:', e.message));
