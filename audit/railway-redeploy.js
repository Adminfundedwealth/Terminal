const https = require('https');
const TOKEN = process.argv[2];

function gql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent': 'railway-cli/5.23.1'
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.substring(0, 500) }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Step 1: introspect to find correct queries
  const intro = await gql(`{
    __schema {
      queryType { fields { name } }
      mutationType { fields { name } }
    }
  }`);
  
  const queries = intro?.data?.__schema?.queryType?.fields?.map(f => f.name) || [];
  const mutations = intro?.data?.__schema?.mutationType?.fields?.map(f => f.name) || [];
  
  const projectQueries = queries.filter(n => n.toLowerCase().includes('project'));
  const deployMutations = mutations.filter(n => n.toLowerCase().includes('deploy') || n.toLowerCase().includes('redeploy'));
  
  console.log('Project queries:', projectQueries.join(', '));
  console.log('Deploy mutations:', deployMutations.join(', '));
  
  // Step 2: try projectsForUser or similar
  for (const q of ['projectsForUser', 'projectsByUser', 'myProjects']) {
    if (queries.includes(q)) {
      const r = await gql(`{ ${q} { edges { node { id name } } } }`);
      console.log(`\n${q}:`, JSON.stringify(r?.data || r?.errors, null, 2).substring(0, 300));
    }
  }
  
  // Step 3: try me with correct nested fields
  const meFields = await gql(`{
    __type(name: "User") {
      fields { name type { name kind ofType { name } } }
    }
  }`);
  const userFields = meFields?.data?.__type?.fields?.map(f => f.name) || [];
  console.log('\nUser fields:', userFields.join(', '));
  
  // Get projects via correct path
  const projectFields = userFields.filter(f => f.includes('project') || f.includes('Project'));
  if (projectFields.length) {
    for (const pf of projectFields) {
      const r = await gql(`{ me { ${pf} { edges { node { id name } } } } }`);
      if (r?.data?.me?.[pf]) {
        const items = r.data.me[pf].edges || r.data.me[pf];
        console.log(`\nme.${pf}:`, JSON.stringify(items, null, 2).substring(0, 500));
      }
    }
  }
}

main().catch(e => console.error('Fatal:', e.message));
