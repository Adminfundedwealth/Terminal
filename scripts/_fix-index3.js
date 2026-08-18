const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../server/index.js');
let content = fs.readFileSync(file, 'utf8');

// Find the connectAngelFeedForBroker function
const fnStart = content.indexOf('async function connectAngelFeedForBroker()');
if (fnStart === -1) { console.log('connectAngelFeedForBroker not found'); process.exit(1); }

// Find the end of this function — it ends with the catch block before startup().catch
const fnBody = content.slice(fnStart);
const startupCatch = fnBody.indexOf('startup().catch');
if (startupCatch === -1) { console.log('startup().catch not found after function'); process.exit(1); }

// Go backwards from startup().catch to find the closing brace of the function
let fnEnd = fnStart + startupCatch;
// The function ends with "}\n\n" before startup
while (fnEnd > fnStart && content[fnEnd-1] !== '}') fnEnd--;

const oldFunction = content.slice(fnStart, fnEnd);
console.log('Old function length:', oldFunction.length, 'chars');

// New slimmed-down function — only connects Angel for broker adapter registration
const newFunction = `async function connectAngelFeedForBroker() {
  try {
    angelFeed.setEventBus(eventBus);
    await angelFeed.connect();
    // NOTE: Angel feed is SECONDARY — only used for broker adapter registration (order execution).
    // Dhan WebSocket is the PRIMARY live tick source.
    console.log('[AngelFeed] Connected (broker adapter only — NOT used for live ticks)');

    // Wire token propagation for Angel-based services (still needed for order execution)
    const propagateToken = (session) => {
      if (session) {
        // Update the shared broker adapter session
        const clientId = session.clientId || process.env.ANGEL_CLIENT_ID || 'default';
        const existing = BrokerFactory.get('angelone', clientId);
        if (existing) {
          existing.session.token = session.jwtToken;
          existing.session.refreshToken = session.refreshToken;
          existing.session.feedToken = session.feedToken;
          existing.session.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        }
      }
    };

    angelFeed.onTokenRefresh(propagateToken);
    propagateToken(angelFeed.session);

    // Register a shared AngelOneAdapter instance for order execution
    const { AngelOneAdapter } = await import('./brokers/angelone/angelone.adapter.js');
    const sharedAdapter = new AngelOneAdapter();
    sharedAdapter.session = {
      provider: 'angelone',
      clientId: angelFeed.session.clientId,
      token: angelFeed.session.jwtToken,
      refreshToken: angelFeed.session.refreshToken,
      feedToken: angelFeed.session.feedToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    sharedAdapter._isConnected = true;
    sharedAdapter.feedToken = angelFeed.session.feedToken;
    BrokerFactory.registerInstance('angelone', sharedAdapter, angelFeed.session.clientId);
    console.log('[AngelFeed] ✓ Broker adapter registered for order execution');

  } catch (err) {
    console.warn('[AngelFeed] Connection failed:', err.message);
    console.warn('[AngelFeed]   Order execution via Angel One will be unavailable');
  }
}
`;

content = content.slice(0, fnStart) + newFunction + content.slice(fnEnd);
fs.writeFileSync(file, content);
console.log('DONE - connectAngelFeedForBroker slimmed down (no live tick subscriptions)');
