const https = require('https');
const config = require('C:/Users/jitro/.railway/config.json');

const REFRESH_TOKEN = config.user.refreshToken;

function post(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function gql(token, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${token}`, 'User-Agent': 'railway-cli/5.23.1' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  console.log('Refreshing Railway token...');
  
  // Try using refresh token via OAuth endpoint
  const refresh = await post('backboard.railway.com', '/auth/token/refresh', {
    refreshToken: REFRESH_TOKEN
  });
  
  console.log('Refresh response:', refresh.status, JSON.stringify(refresh.body).substring(0, 200));
  
  // Try GraphQL mutation for token refresh
  const gqlRefresh = await gql(config.user.accessToken, `
    mutation($refreshToken: String!) {
      authRefreshToken(refreshToken: $refreshToken) {
        accessToken refreshToken expiresAt
      }
    }
  `, { refreshToken: REFRESH_TOKEN });
  
  console.log('\nGraphQL refresh:', JSON.stringify(gqlRefresh?.data || gqlRefresh?.errors)?.substring(0, 300));
  
  if (gqlRefresh?.data?.authRefreshToken?.accessToken) {
    const newToken = gqlRefresh.data.authRefreshToken.accessToken;
    console.log('\n✅ New access token:', newToken.substring(0, 16) + '...');
    
    // Update config
    const fs = require('fs');
    config.user.accessToken = newToken;
    config.user.refreshToken = gqlRefresh.data.authRefreshToken.refreshToken;
    config.user.tokenExpiresAt = gqlRefresh.data.authRefreshToken.expiresAt;
    fs.writeFileSync('C:/Users/jitro/.railway/config.json', JSON.stringify(config, null, 2));
    console.log('Config updated.');
    return newToken;
  }
  
  return config.user.accessToken;
}

main().catch(e => console.error(e.message));
