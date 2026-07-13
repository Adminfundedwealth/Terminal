/**
 * FUNDEDWEALTH TERMINAL â€” SERVER ENTRY POINT
 * 
 * Wires together all backend components:
 * - Express REST API with auth middleware
 * - SSO authentication routes
 * - WebSocket server for real-time market data
 * - Supabase database connection
 * - Market data engine
 * - Instrument service
 * - Cron scheduler
 * 
 * NO simulation. NO fake data. All data flows from Supabase or broker adapters.
 */

import express from 'express';
import { createHash } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';

config();

import { supabase, testConnection } from './db/client.js';
import { tamperDetection } from './middleware/tamperDetection.js';
import { AuditLogger } from './services/auditLogger.js';
import { createRedisRateLimitStore } from './middleware/rateLimitStore.js';
import { createApiRouter } from './routes/api.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createProvisioningRouter } from './routes/provisioning.routes.js';
import { createAdvancedOrdersRouter } from './routes/advanced-orders.routes.js';
import { createPersistenceRouter } from './routes/persistence.routes.js';
import { createKillSwitchRouter } from './routes/killswitch.routes.js';
import { createAIRouter } from './routes/ai.routes.js';
import { createCopyTradingRouter } from './routes/copytrading.routes.js';
import { createAlertsRouter } from './routes/alerts.routes.js';
import { createPayoutRouter } from './routes/payout.routes.js';
import { setupWebSocket } from './routes/websocket.js';
import { requireAuth as authMiddleware } from './middleware/auth.js';
import { verifySessionJWT as verifyJWT } from './services/auth.service.js';
import { AccountService } from './services/accountService.js';
import { InstrumentService } from './services/instrumentService.js';
import { MarketDataEngine } from './services/marketDataEngine.js';
import { CandleService } from './services/candleService.js';
import { DepthService } from './services/depthService.js';
import { OptionChainService } from './services/optionChainService.js';
import { scheduleDailyChecks } from './cron/dailyChecks.js';
import { startProvisioningPoller, stopProvisioningPoller } from './cron/provisioningPoller.js';
import { RealtimeServer } from './realtime/socketio.server.js';
import { RedisPubSub } from './realtime/redis.pubsub.js';
import { TradingViewDatafeed } from './realtime/tradingview.datafeed.js';
import { BrokerFactory } from './brokers/broker.factory.js';
import { HealthMonitor } from './brokers/health.monitor.js';
import { AngelFeedConnector } from './brokers/angelone/angel.feed.connector.js';
import { eventBus, EventBridge } from './events/index.js';
import { eventDispatcher } from './services/eventDispatcher.js';

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// â”€â”€â”€ Initialize Services â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const marketDataEngine = new MarketDataEngine();
const instrumentService = new InstrumentService();
const accountService = new AccountService(marketDataEngine);
const candleService = new CandleService(marketDataEngine);
const depthService = new DepthService(marketDataEngine);
const optionChainService = new OptionChainService();
const redisPubSub = new RedisPubSub();
const healthMonitor = new HealthMonitor({ interval: 30000 });
const angelFeed = new AngelFeedConnector(marketDataEngine);
const eventBridge = new EventBridge();
let tradingViewDatafeed = null;
let realtimeServer = null;

// â”€â”€â”€ Express App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const app = express();
const server = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins = isProduction
  ? [FRONTEND_URL]
  : [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' })); // Limit request body size

// Tamper detection (before any route processing)
app.use(tamperDetection);

// Trust proxy (Railway/Vercel/Docker proxy)
app.set('trust proxy', 1);

// Security headers â€” PRODUCTION: Full CSP enabled
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Vite requires inline for HMR in dev
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:", FRONTEND_URL],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Allow WebSocket/Socket.IO
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));

// Rate limiting â€” Redis-backed in production, memory fallback in development only
const redisStore = createRedisRateLimitStore('rl:api:');
const redisStoreAuth = createRedisRateLimitStore('rl:auth:');
const redisStoreOrder = createRedisRateLimitStore('rl:order:');
const redisStoreProvision = createRedisRateLimitStore('rl:prov:');

if (isProduction && !redisStore) {
  console.warn('[SECURITY] WARNING: Redis not available for rate limiting in production. Using in-memory fallback. Set REDIS_URL for multi-instance safety.');
}

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore || undefined,
  message: { error: 'rate_limited', message: 'Too many requests. Please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStoreAuth || undefined,
  message: { error: 'rate_limited', message: 'Too many authentication attempts.' },
});

const orderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStoreOrder || undefined,
  message: { error: 'rate_limited', message: 'Order rate limit exceeded.' },
});

const provisionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStoreProvision || undefined,
  message: { error: 'rate_limited', message: 'Provisioning rate limit exceeded.' },
});

app.use('/api', apiLimiter);
app.use('/auth', authLimiter);
app.use('/provisioning', provisionLimiter);
app.get('/debug/secret-hash', (_req, res) => {
  const secret = process.env.SSO_API_KEY || '';
  res.json({
    hash: createHash('sha256').update(secret).digest('hex'),
    length: secret.length,
    varName: 'SSO_API_KEY',
  });
});
// Health check (minimal â€” no sensitive internal state)
app.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: { connected: dbStatus.connected, reason: dbStatus.reason },
    uptime: process.uptime(),
    sso: {
      apiKeyConfigured: !!(process.env.SSO_API_KEY || process.env.PROVISIONING_API_KEY),
      sharedSecretConfigured: !!process.env.SSO_SHARED_SECRET,
    },
  });
});

// Full market status (AUTHENTICATED â€” no public access to internal state)
app.get('/api/market/live', authMiddleware, (req, res) => {
  const feedStatus = angelFeed.getStatus();
  const sioStatus = realtimeServer ? realtimeServer.getStatus() : { clients: 0, rooms: 0, subscriptions: 0 };
  res.json({
    feed: {
      connected: feedStatus.connected,
      subscribedTokens: feedStatus.subscribedTokens,
    },
    socketIO: { clients: sioStatus.clients },
  });
});
// Auth routes (SSO, logout, verify)
app.use('/auth', createAuthRouter());

// Provisioning routes (API key protected â€” called by Website/Admin)
app.use('/provisioning', createProvisioningRouter());

// Order rate limit (MUST be before API routes â€” more restrictive)
app.use('/api/orders', orderLimiter);

// API routes (protected + public)
app.use('/api', createApiRouter(accountService, instrumentService, marketDataEngine, candleService, depthService, optionChainService));

// Persistence routes (layouts, themes, journal, chart templates)
app.use('/api', createPersistenceRouter());

// Advanced order routes (OCO, Basket, Bracket, Equity Curve, Chart Templates)
app.use('/api', createAdvancedOrdersRouter());

// Kill switch routes
app.use('/api', createKillSwitchRouter());

// AI routes (trade review, behavioral analysis, coaching)
app.use('/api', createAIRouter());

// Copy trading routes (master-slave config, exposure)
app.use('/api', createCopyTradingRouter());

// Alerts routes (price alerts CRUD)
app.use('/api', createAlertsRouter());

// Payout routes (eligibility, request, admin approval)
app.use('/api', createPayoutRouter());

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const { default: path } = await import('path');
  const { default: fs } = await import('fs');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(__dirname, '../dist');
  // Also check ./dist (when server files are at same level as dist in Docker)
  const distPath2 = path.resolve(__dirname, './dist');
  const resolvedDistPath = fs.existsSync(distPath) ? distPath : (fs.existsSync(distPath2) ? distPath2 : distPath);
  const distExists = fs.existsSync(resolvedDistPath);
  console.log('[Terminal] dist exists:', distExists, 'at:', resolvedDistPath);
  if (distExists) {
    app.use(express.static(resolvedDistPath));
    app.get('*', async (req, res, next) => {
      // Don't serve index.html for API/auth/health routes
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/health') || req.path.startsWith('/ws')) {
        return next();
      }

      // SSO GATE: Check for valid session before serving terminal frontend.
      // The /auth/sso route sets the cookie â€” users must arrive via SSO first.
      const cookieHeader = req.headers.cookie || '';
      const sessionMatch = cookieHeader.match(/(?:^|;\s*)fw_session=([^;]*)/);
      const token = sessionMatch ? sessionMatch[1] : null;

      if (!token) {
        // No session cookie â€” user visited directly without SSO
        AuditLogger.authFailure({ reason: 'direct_access_no_session', ip: req.ip, path: req.path, userAgent: req.headers['user-agent'] });
        return res.status(401).send(getAccessDeniedHTML());
      }

      // Validate JWT signature (lightweight check â€” full session DB check happens on API calls)
      const result = verifyJWT(token);

      if (!result.valid) {
        // Invalid or expired session â€” destroy the cookie and deny access
        AuditLogger.authFailure({ reason: result.error === 'expired' ? 'session_expired_direct_access' : 'invalid_token_direct_access', ip: req.ip, path: req.path });
        res.clearCookie('fw_session', { path: '/' });
        return res.status(401).send(getAccessDeniedHTML());
      }

      // Valid session â€” serve terminal
      res.sendFile(path.join(resolvedDistPath, 'index.html'));
    });
  } else {
    // dist/ not built — check session, serve minimal page or access denied
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/health') || req.path.startsWith('/ws') || req.path.startsWith('/provisioning')) {
        return next();
      }
      const cookieHeader = req.headers.cookie || '';
      const sessionMatch = cookieHeader.match(/(?:^|;\s*)fw_session=([^;]*)/);
      const token = sessionMatch ? sessionMatch[1] : null;
      if (!token) {
        return res.status(401).send(getAccessDeniedHTML());
      }
      const result = verifyJWT(token);
      if (!result.valid) {
        res.clearCookie('fw_session', { path: '/' });
        return res.status(401).send(getAccessDeniedHTML());
      }
      // Valid session but no frontend build — serve placeholder
      const { isSessionValid } = await import('./services/session.service.js');
      const sessionActive = await isSessionValid(token);
      if (!sessionActive) {
        res.clearCookie('fw_session', { path: '/' });
        return res.status(401).send(getAccessDeniedHTML());
      }
      return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FundedWealth Terminal</title></head><body style="background:#0a0a0f;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;flex-direction:column;gap:16px"><h2>Terminal Loading...</h2><p style="color:#9ca3af">Frontend build pending. Please check back shortly.</p><a href="https://fundedwealth.com/dashboard" style="color:#7c3aed">Back to Dashboard</a></body></html>`);
    });
  }
}

/**
 * Server-side Access Denied HTML page.
 * Shown when a user visits the terminal URL directly without a valid SSO session.
 */
function getAccessDeniedHTML() {
  const dashboardUrl = process.env.FW_DASHBOARD_URL || 'https://fundedwealth.com';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FundedWealth Terminal â€” Access Denied</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; max-width: 420px; padding: 2rem; }
    .logo { width: 64px; height: 64px; margin: 0 auto 1.5rem; border-radius: 12px; background: linear-gradient(135deg, #0a0a0a, #1a1a2e); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; }
    .logo img { width: 44px; height: 44px; object-fit: contain; }
    .brand { font-size: 16px; font-weight: 800; letter-spacing: 0.05em; background: linear-gradient(90deg, #00D4FF, #4F46E5, #7C3AED); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .sub { font-size: 10px; font-weight: 700; letter-spacing: 0.25em; color: rgba(99,102,241,0.7); margin-top: 2px; }
    .alert { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 1.5rem 0 0.75rem; }
    .alert svg { width: 20px; height: 20px; color: #f87171; }
    .alert span { font-size: 14px; font-weight: 600; color: #f87171; }
    .message { font-size: 13px; color: #9ca3af; line-height: 1.6; margin-bottom: 1.5rem; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 24px; border-radius: 8px; background: linear-gradient(90deg, #4F46E5, #7C3AED); color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
    .hint { font-size: 11px; color: rgba(156,163,175,0.6); margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><img src="/logo.png" alt="FW" onerror="this.style.display='none'" /></div>
    <div class="brand">FUNDEDWEALTH</div>
    <div class="sub">TERMINAL</div>
    <div class="alert">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v.01M12 9v3m0-9a9 9 0 110 18 9 9 0 010-18z"/></svg>
      <span>Access Denied</span>
    </div>
    <p class="message">Please login from your FundedWealth Dashboard to access the Trading Terminal.</p>
    <a href="${dashboardUrl}/login" class="btn">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
      Go to FundedWealth Dashboard
    </a>
    <p class="hint">Click "Launch Terminal" from your Dashboard after logging in.</p>
  </div>
</body>
</html>`;
}

// Global error handler â€” prevents stack trace leaks
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  console.error(`[ERROR] ${req.method} ${req.path}:`, isProduction ? err.message : err.stack);

  res.status(status).json({
    error: status >= 500 ? 'internal_error' : 'request_error',
    message: isProduction ? 'An unexpected error occurred.' : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

// â”€â”€â”€ WebSocket Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss, marketDataEngine);

// â”€â”€â”€ Startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startup() {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  FUNDEDWEALTH TERMINAL â€” Server Starting');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`  Port: ${PORT}`);
  console.log(`  Env:  ${process.env.NODE_ENV || 'development'}`);
  console.log('');

  // 1. Test Supabase Connection
  console.log('[Startup] Testing Supabase connection...');
  const dbResult = await testConnection();
  if (dbResult.connected) {
    console.log('[Startup] âœ“ Supabase connected');
  } else {
    console.warn(`[Startup] âœ— Supabase NOT connected: ${dbResult.reason}`);
    console.warn('[Startup]   WARNING: Session validation will fail-closed (all sessions rejected).');
  }

  // 2. Initialize Market Data Engine
  console.log('[Startup] Initializing market data engine...');
  await marketDataEngine.initialize();
  console.log('[Startup] âœ“ Market data engine ready (awaiting broker adapter)');

  // 2b. Initialize Event Dispatcher (persistence subscriber)
  console.log('[Startup] Initializing event dispatcher (persistence layer)...');
  eventDispatcher.initialize();
  console.log('[Startup] âœ“ Event dispatcher active â€” all events will be persisted');

  // 3. Initialize Redis Pub/Sub (optional)
  console.log('[Startup] Initializing Redis Pub/Sub...');
  const redisConnected = await redisPubSub.initialize();
  if (redisConnected) {
    console.log('[Startup] âœ“ Redis Pub/Sub connected');
  } else {
    console.log('[Startup] â—‹ Redis not configured â€” single-instance mode');
  }

  // 4. Initialize TradingView Datafeed
  tradingViewDatafeed = new TradingViewDatafeed(instrumentService, marketDataEngine);
  console.log('[Startup] âœ“ TradingView Datafeed layer ready');

  // 5. Schedule daily checks (only if Supabase is connected)
  if (dbResult.connected) {
    scheduleDailyChecks();
    console.log('[Startup] âœ“ Daily checks scheduler active');

    // 5b. Start provisioning poller (polls pending provisioning_logs)
    startProvisioningPoller();
    console.log('[Startup] âœ“ Provisioning poller active (30s interval)');
  }

  // 6. Start HTTP server
  server.listen(PORT, () => {
    // 7. Initialize Socket.IO (needs server to be listening)
    realtimeServer = new RealtimeServer(server, marketDataEngine, {
      corsOrigin: corsOrigins,
    });
    console.log('[Startup] âœ“ Socket.IO server initialized');

    // 7b. Start Event Bridge (connects eventBus â†’ Socket.IO/WS clients)
    eventBridge.setRealtimeServer(realtimeServer);
    eventBridge.setWss(wss);
    eventBridge.start();
    console.log('[Startup] âœ“ Event Bridge active (7 channels â†’ client)');

    // 8. Start Broker Health Monitor
    healthMonitor.start();
    console.log('[Startup] âœ“ Broker health monitor active');

    console.log('');
    console.log(`[Startup] âœ“ Server listening on http://localhost:${PORT}`);
    console.log(`[Startup] âœ“ WebSocket (legacy) on ws://localhost:${PORT}/ws`);
    console.log(`[Startup] âœ“ Socket.IO on http://localhost:${PORT}/socket.io`);
    console.log('');
    console.log('  Broker Status:');
    const bh = BrokerFactory.getHealthReport();
    console.log(`    Angel One: configured=${bh._available.angelone.configured}, connected=${bh._available.angelone.status}`);
    console.log(`    Dhan:      configured=${bh._available.dhan.configured}, status=${bh._available.dhan.status}`);
    console.log('');
    console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

    // 9. Connect Angel Feed (live market data) â€” fire and forget
    connectAngelFeed();
  });
}

async function connectAngelFeed() {
  try {
    angelFeed.setEventBus(eventBus);
    await angelFeed.connect();
    marketDataEngine.connectAdapter('angelone-smartstream');

    // Wire token propagation via callback (replaces old 60-second setInterval)
    const propagateToken = (session) => {
      if (session) {
        candleService.setAuthToken(session.jwtToken);
        depthService.setAuthToken(session.jwtToken);
        optionChainService.setAuthToken(session.jwtToken);

        // Also update the shared broker adapter session
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

    // Register callback for immediate token propagation on refresh/reconnect
    angelFeed.onTokenRefresh(propagateToken);

    // Initial propagation
    propagateToken(angelFeed.session);

    // Wire refresh callbacks so services can self-heal on 403
    const refreshFn = async () => {
      const token = await angelFeed.ensureValidToken();
      return token;
    };
    candleService.setRefreshCallback(refreshFn);
    depthService.setRefreshCallback(refreshFn);
    optionChainService.setRefreshCallback(refreshFn);

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

    const defaultTokens = [
      // Indices (mode 1 â€” LTP only)
      { token: '99926000', exchange: 'NSE', symbol: 'NIFTY 50' },
      { token: '99926009', exchange: 'NSE', symbol: 'BANKNIFTY' },
      { token: '99926037', exchange: 'NSE', symbol: 'FINNIFTY' },
      { token: '99926074', exchange: 'NSE', symbol: 'MIDCPNIFTY' },
      // NIFTY 50 constituents (mode 2 â€” Quote with OHLC + volume)
      { token: '2885', exchange: 'NSE', symbol: 'RELIANCE' },
      { token: '3045', exchange: 'NSE', symbol: 'SBIN' },
      { token: '1333', exchange: 'NSE', symbol: 'HDFCBANK' },
      { token: '11536', exchange: 'NSE', symbol: 'TCS' },
      { token: '1594', exchange: 'NSE', symbol: 'INFY' },
      { token: '317', exchange: 'NSE', symbol: 'BAJFINANCE' },
      { token: '5633', exchange: 'NSE', symbol: 'MARUTI' },
      { token: '11483', exchange: 'NSE', symbol: 'NTPC' },
      { token: '3787', exchange: 'NSE', symbol: 'TECHM' },
      { token: '2031', exchange: 'NSE', symbol: 'KOTAKBANK' },
      { token: '1660', exchange: 'NSE', symbol: 'ITC' },
      { token: '10999', exchange: 'NSE', symbol: 'WIPRO' },
      { token: '236', exchange: 'NSE', symbol: 'ASIANPAINT' },
      { token: '16669', exchange: 'NSE', symbol: 'BAJAJFINSV' },
      { token: '1363', exchange: 'NSE', symbol: 'HINDUNILVR' },
      { token: '3506', exchange: 'NSE', symbol: 'TATAMOTORS' },
      { token: '3499', exchange: 'NSE', symbol: 'TATASTEEL' },
      { token: '5900', exchange: 'NSE', symbol: 'ADANIENT' },
      { token: '11630', exchange: 'NSE', symbol: 'TITAN' },
      { token: '694', exchange: 'NSE', symbol: 'COALINDIA' },
      { token: '547', exchange: 'NSE', symbol: 'BRITANNIA' },
      { token: '11532', exchange: 'NSE', symbol: 'ULTRACEMCO' },
      { token: '2475', exchange: 'NSE', symbol: 'ONGC' },
      { token: '467', exchange: 'NSE', symbol: 'BHARTIARTL' },
      { token: '3432', exchange: 'NSE', symbol: 'TATACONSUM' },
      { token: '2181', exchange: 'NSE', symbol: 'M&M' },
      { token: '15083', exchange: 'NSE', symbol: 'ADANIPORTS' },
      { token: '11723', exchange: 'NSE', symbol: 'HCLTECH' },
      { token: '14418', exchange: 'NSE', symbol: 'JSWSTEEL' },
      { token: '4963', exchange: 'NSE', symbol: 'IOC' },
      { token: '1922', exchange: 'NSE', symbol: 'ICICIBANK' },
      { token: '288', exchange: 'NSE', symbol: 'AXISBANK' },
      { token: '2303', exchange: 'NSE', symbol: 'LT' },
      { token: '881', exchange: 'NSE', symbol: 'DRREDDY' },
      { token: '3456', exchange: 'NSE', symbol: 'SUNPHARMA' },
      { token: '6191', exchange: 'NSE', symbol: 'CIPLA' },
      { token: '4717', exchange: 'NSE', symbol: 'APOLLOHOSP' },
      { token: '910', exchange: 'NSE', symbol: 'EICHERMOT' },
      { token: '14977', exchange: 'NSE', symbol: 'POWERGRID' },
    ];

    // Seed symbol names into MarketDataEngine so scanner can return them
    defaultTokens.forEach(t => {
      marketDataEngine.pushQuote(t.token, { symbol: t.symbol, exchange: t.exchange, segment: t.exchange });
    });

    // MCX commodity tokens (mode 2 -- Quote with OHLC + volume)
    const mcxTokens = [
      { token: '429604', exchange: 'MCX', symbol: 'GOLD' },
      { token: '429638', exchange: 'MCX', symbol: 'SILVER' },
      { token: '425475', exchange: 'MCX', symbol: 'CRUDEOIL' },
      { token: '431765', exchange: 'MCX', symbol: 'NATURALGAS' },
      { token: '430596', exchange: 'MCX', symbol: 'COPPER' },
      { token: '438629', exchange: 'MCX', symbol: 'ALUMINIUM' },
      { token: '437561', exchange: 'MCX', symbol: 'ZINC' },
      { token: '431659', exchange: 'MCX', symbol: 'LEAD' },
      { token: '432468', exchange: 'MCX', symbol: 'NICKEL' },
    ];

    // CDS currency tokens (mode 2 -- Quote)
    const cdsTokens = [
      { token: '11091', exchange: 'CDS', symbol: 'USDINR' },
      { token: '11363', exchange: 'CDS', symbol: 'EURINR' },
      { token: '11096', exchange: 'CDS', symbol: 'GBPINR' },
      { token: '11098', exchange: 'CDS', symbol: 'JPYINR' },
    ];

    // Seed MCX + CDS symbols into engine
    [...mcxTokens, ...cdsTokens].forEach(t => {
      marketDataEngine.pushQuote(t.token, { symbol: t.symbol, exchange: t.exchange, segment: t.exchange });
    });

    // Register token exchanges for candle service
    defaultTokens.forEach(t => candleService.registerTokenExchange(t.token, t.exchange));
    [...mcxTokens, ...cdsTokens].forEach(t => candleService.registerTokenExchange(t.token, t.exchange));

    // Split tokens: indices (mode 1 LTP) vs stocks (mode 2 Quote)
    const indexTokens = defaultTokens.filter(t => t.token.startsWith('999'));
    const stockTokens = defaultTokens.filter(t => !t.token.startsWith('999'));

    if (indexTokens.length > 0) {
      angelFeed.subscribe(indexTokens, 1); // LTP mode for indices (no order book)
    }
    if (stockTokens.length > 0) {
      angelFeed.subscribe(stockTokens, 2); // Quote mode for stocks (OHLC + volume + change)
    }
    if (mcxTokens.length > 0) {
      angelFeed.subscribe(mcxTokens, 2); // Quote mode for MCX commodities
    }
    if (cdsTokens.length > 0) {
      angelFeed.subscribe(cdsTokens, 2); // Quote mode for CDS currencies
    }
    console.log(`[AngelFeed] subscribed: ${indexTokens.length} indices + ${stockTokens.length} stocks + ${mcxTokens.length} MCX + ${cdsTokens.length} CDS`);

    const allFeedTokens = [...defaultTokens, ...mcxTokens, ...cdsTokens];

    // Hook live ticks into candle aggregation
    for (const t of allFeedTokens) {
      marketDataEngine.subscribe(t.token, (event) => {
        if (event.data?.ltp) {
          candleService.processLiveTick(t.token, event.data.ltp, event.data.volume, event.data.timestamp);
        }
      });
    }

    // Position P&L tracking starts when authenticated sessions are active
    // (no dev bypass -- sessions drive tracking)
  } catch (err) {
    console.warn(`[AngelFeed] Connection failed: ${err.message}`);
    console.warn('[AngelFeed]   Market data will be empty until feed connects');
  }
}

startup().catch((err) => {
  console.error('[Startup] FATAL:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Shutdown] SIGTERM received, closing...');
  stopProvisioningPoller();
  await AuditLogger.shutdown();
  eventDispatcher.destroy();
  healthMonitor.stop();
  eventBridge.stop();
  angelFeed.disconnect();
  marketDataEngine.destroy();
  eventBus.destroy();
  if (tradingViewDatafeed) tradingViewDatafeed.destroy();
  if (realtimeServer) realtimeServer.close();
  await redisPubSub.shutdown();
  await BrokerFactory.disconnectAll();
  wss.close();
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('[Shutdown] SIGINT received, closing...');
  stopProvisioningPoller();
  await AuditLogger.shutdown();
  eventDispatcher.destroy();
  healthMonitor.stop();
  eventBridge.stop();
  angelFeed.disconnect();
  marketDataEngine.destroy();
  eventBus.destroy();
  if (tradingViewDatafeed) tradingViewDatafeed.destroy();
  if (realtimeServer) realtimeServer.close();
  await redisPubSub.shutdown();
  await BrokerFactory.disconnectAll();
  wss.close();
  server.close(() => process.exit(0));
});

