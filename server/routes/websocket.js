/**
 * WebSocket Handler — PRODUCTION HARDENED
 * 
 * Manages real-time market data streaming to connected clients.
 * Requires valid JWT (cookie or query param) to subscribe to data.
 * 
 * SECURITY:
 *   - No dev bypasses
 *   - JWT required always
 *   - Message rate limiting per connection
 *   - Audit logging for connections
 */
import { validateWSAuth } from '../middleware/auth.js';
import { AuditLogger } from '../services/auditLogger.js';

// Rate limiting per WebSocket connection
const WS_MAX_MESSAGES_PER_SECOND = 30;
const WS_MAX_SUBSCRIPTIONS = 200;

export function setupWebSocket(wss, marketDataEngine) {
  console.log('[WebSocket] Server initialized (production mode — auth enforced)');

  wss.on('connection', (ws, request) => {
    // PRODUCTION: Always validate auth. No bypasses.
    const user = validateWSAuth(request);

    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    AuditLogger.wsConnection({
      userId: user.userId,
      accountId: user.accountId,
      action: 'connected',
      ip: request.headers['x-forwarded-for'] || request.socket.remoteAddress,
    });

    const subscriptions = new Map(); // token -> callback
    const depthSubscriptions = new Map();

    // Message rate limiting
    let messageCount = 0;
    const rateLimitReset = setInterval(() => { messageCount = 0; }, 1000);

    // Send market status
    ws.send(JSON.stringify({
      type: 'market_status',
      status: getMarketStatus(),
    }));

    ws.on('message', (message) => {
      // Rate limit check
      messageCount++;
      if (messageCount > WS_MAX_MESSAGES_PER_SECOND) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded. Slow down.' }));
        return;
      }

      try {
        const data = JSON.parse(message.toString());
        handleMessage(ws, data, subscriptions, depthSubscriptions, marketDataEngine);
      } catch (err) {
        // Don't log parse errors to console in production (DoS via log spam)
      }
    });

    ws.on('close', () => {
      clearInterval(rateLimitReset);
      subscriptions.forEach((callback, token) => {
        marketDataEngine.unsubscribe(token, callback);
      });
      depthSubscriptions.forEach((callback, token) => {
        marketDataEngine.unsubscribeDepth(token, callback);
      });
      subscriptions.clear();
      depthSubscriptions.clear();
    });

    ws.on('error', () => {
      clearInterval(rateLimitReset);
    });
  });

  // Periodic market status broadcast
  setInterval(() => {
    const status = getMarketStatus();
    const message = JSON.stringify({ type: 'market_status', status });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }, 30000);
}

function handleMessage(ws, data, subscriptions, depthSubscriptions, marketDataEngine) {
  switch (data.type) {
    case 'subscribe': {
      const tokens = data.tokens || [];
      // Limit total subscriptions per connection
      if (subscriptions.size + tokens.length > WS_MAX_SUBSCRIPTIONS) {
        ws.send(JSON.stringify({ type: 'error', message: `Max ${WS_MAX_SUBSCRIPTIONS} subscriptions per connection.` }));
        return;
      }
      tokens.forEach((token) => {
        if (subscriptions.has(token)) return;
        // Validate token format — numeric tokens (Angel One) or alphanumeric identifiers (MCX/CDS/NFO)
        if (!token || typeof token !== 'string' || token.length > 30 || !/^[A-Za-z0-9_]{1,30}$/.test(token)) return;

        const callback = (quoteData) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify(quoteData));
          }
        };
        subscriptions.set(token, callback);
        marketDataEngine.subscribe(token, callback);
      });
      break;
    }

    case 'unsubscribe': {
      const tokens = data.tokens || [];
      tokens.forEach((token) => {
        const callback = subscriptions.get(token);
        if (callback) {
          marketDataEngine.unsubscribe(token, callback);
          subscriptions.delete(token);
        }
      });
      break;
    }

    case 'subscribe_depth': {
      const tokens = data.tokens || [];
      if (depthSubscriptions.size + tokens.length > WS_MAX_SUBSCRIPTIONS) {
        ws.send(JSON.stringify({ type: 'error', message: `Max ${WS_MAX_SUBSCRIPTIONS} depth subscriptions.` }));
        return;
      }
      tokens.forEach((token) => {
        if (depthSubscriptions.has(token)) return;
        if (!token || typeof token !== 'string' || token.length > 30 || !/^[A-Za-z0-9_]{1,30}$/.test(token)) return;

        const callback = (depthData) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify(depthData));
          }
        };
        depthSubscriptions.set(token, callback);
        marketDataEngine.subscribeDepth(token, callback);
      });
      break;
    }

    case 'unsubscribe_depth': {
      const tokens = data.tokens || [];
      tokens.forEach((token) => {
        const callback = depthSubscriptions.get(token);
        if (callback) {
          marketDataEngine.unsubscribeDepth(token, callback);
          depthSubscriptions.delete(token);
        }
      });
      break;
    }

    case 'ping':
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
      break;
  }
}

function getMarketStatus() {
  // Always compute in IST (UTC+5:30) regardless of server timezone
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const time = hours * 60 + minutes;
  const day = ist.getUTCDay();

  if (day === 0 || day === 6) return 'CLOSED';
  if (time >= 555 && time < 570) return 'PRE_OPEN';
  if (time >= 570 && time < 930) return 'OPEN';
  if (time >= 930 && time < 960) return 'POST_CLOSE';
  return 'CLOSED';
}
