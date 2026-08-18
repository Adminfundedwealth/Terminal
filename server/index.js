﻿﻿﻿/**
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
import { createDashboardSyncRouter } from './routes/dashboard-sync.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createProvisioningRouter } from './routes/provisioning.routes.js';
import { createAdvancedOrdersRouter } from './routes/advanced-orders.routes.js';
import { createPersistenceRouter } from './routes/persistence.routes.js';
import { createKillSwitchRouter } from './routes/killswitch.routes.js';
import { createAIRouter } from './routes/ai.routes.js';
import { createCopyTradingRouter } from './routes/copytrading.routes.js';
import { createAlertsRouter } from './routes/alerts.routes.js';
import { createPayoutRouter } from './routes/payout.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';
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
import { DhanWebSocketFeed } from './brokers/dhan/dhan.websocket.js';
import { eventBus, EventBridge } from './events/index.js';
import { eventDispatcher } from './services/eventDispatcher.js';
import { DataProviderSwitch } from './services/dataProviderSwitch.js';

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
const dataProviderSwitch = new DataProviderSwitch(candleService, optionChainService);
let dhanFeed = null; // Dhan WebSocket — primary real-time feed
let tradingViewDatafeed = null;
let realtimeServer = null;

// â”€â”€â”€ Express App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const app = express();
const server = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins = isProduction
  ? [FRONTEND_URL, 'https://fundedwealth.com', 'https://www.fundedwealth.com', 'https://admin.fundedwealth.com'].filter(Boolean)
  : [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000', 'https://fundedwealth.com'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    // Allow any subdomain of fundedwealth.com
    if (/\.fundedwealth\.com$/.test(origin) || origin === 'https://fundedwealth.com') return callback(null, true);
    callback(null, false);
  },
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
      sharedSecretConfigured: !!(process.env.SSO_SHARED_SECRET) && process.env.SSO_SHARED_SECRET !== 'sso-shared-secret-change-in-production',
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

// Option chain gets a dedicated, higher limit � it is heavier but infrequent.
// Each chain load fires multiple internal batch calls; allow 30 req/min per user.
const redisStoreOptionChain = createRedisRateLimitStore('rl:oc:');
const optionChainLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStoreOptionChain || undefined,
  message: { error: 'rate_limited', message: 'Option chain rate limit � wait a moment before switching pairs.' },
});
// Register before the global apiLimiter so these routes use the dedicated limit
app.use('/api/market/option-chain', optionChainLimiter);
app.use('/api/market/expiries', optionChainLimiter);

// API routes (protected + public)
app.use('/api', createApiRouter(accountService, instrumentService, marketDataEngine, candleService, depthService, optionChainService, dataProviderSwitch));

// Dashboard sync routes — called by fundedwealth.com main site (API key auth, no session needed)
app.use('/api/dashboard', createDashboardSyncRouter());

// Persistence routes (layouts, themes, journal, chart templates)
// Mounted under both /api and /api/persistence for frontend compatibility
app.use('/api', createPersistenceRouter());
app.use('/api/persistence', createPersistenceRouter());

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

// Admin routes (account freeze/unfreeze, force-close positions)
app.use('/api', createAdminRouter());

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
// Pass a getter so that websocket handler always gets the current dhanFeed reference
setupWebSocket(wss, marketDataEngine, angelFeed, { get feed() { return dhanFeed; } });

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

  // 2a. Initialize Data Provider Switch (Dhan + Angel One failover)
  console.log('[Startup] Initializing data provider switch...');
  await dataProviderSwitch.initialize();
  const dpStatus = dataProviderSwitch.getStatus();
  console.log('[Startup] Data provider switch ready (active: ' + dpStatus.activeProvider + ', dhan: ' + dpStatus.dhanReady + ')');

  // Wire LTP fallbacks into MarketDataEngine and OrderExecution
  const dhanAdapter = dataProviderSwitch.getDhanAdapter();
  if (dhanAdapter) dhanAdapter.setMarketDataEngine(marketDataEngine);
  marketDataEngine.setLtpFallbacks(dhanAdapter, candleService);

  // Pre-load Dhan scrip master in background (prevents 502 timeout on first MCX/CDS quote)
  if (dhanAdapter?.historical?._getScripMaster) {
    dhanAdapter.historical._getScripMaster()
      .then(m => console.log(`[Startup] ✓ Dhan scrip master pre-loaded: ${m?.byId?.size || 0} instruments`))
      .catch(e => console.warn(`[Startup] Scrip master pre-load failed (will retry on demand): ${e.message}`));
  }

  // Wire LTP fallback into order execution engine
  if (accountService.executionService) {
    accountService.executionService.setFallbackServices(dataProviderSwitch, candleService);
    console.log('[Startup] Order execution LTP fallback wired (Dhan + CandleService)');
  }

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

    // 9. Connect Dhan WebSocket Feed (PRIMARY live market data) - fire and forget
    connectDhanFeed().catch(e => console.error("[connectDhanFeed] Fatal error:", e.message));

    // 9b. Connect Angel Feed (SECONDARY - broker adapter only, NOT live ticks)
    connectAngelFeedForBroker().catch(e => console.error("[connectAngelFeedForBroker] Error:", e.message));
  });
}


/**
 * Connect Dhan WebSocket Feed as PRIMARY real-time market data source.
 * Pipes all tick data directly into MarketDataEngine.
 */
async function connectDhanFeed() {
  const dhanAdapter = dataProviderSwitch.getDhanAdapter();
  if (!dhanAdapter || !dhanAdapter.auth || !dhanAdapter.auth.isTokenValid) {
    console.warn('[DhanFeed] Dhan adapter not ready — cannot connect WebSocket feed');
    console.warn('[DhanFeed] Historical/REST data still available via DataProviderSwitch');
    return;
  }

  try {
    dhanFeed = new DhanWebSocketFeed(dhanAdapter.auth);
    await dhanFeed.connect();
    marketDataEngine.connectAdapter('dhan-websocket');
    console.log('[DhanFeed] ✓ Connected — PRIMARY real-time feed active');

    // Pipe tick events into MarketDataEngine
    dhanFeed.on('tick', (tick) => {
      if (tick.token && tick.ltp > 0) {
        const existing = marketDataEngine.getQuote(tick.token);
        marketDataEngine.pushQuote(tick.token, {
          ltp: tick.ltp,
          open: tick.open || existing?.open,
          high: tick.high || existing?.high,
          low: tick.low || existing?.low,
          close: tick.close || existing?.close,
          volume: tick.volume || existing?.volume,
          timestamp: Date.now(),
          symbol: existing?.symbol,
          exchange: existing?.exchange,
          segment: existing?.segment,
        });
      }
    });

    // Pipe depth events
    dhanFeed.on('depth', (depth) => {
      if (depth.token) {
        marketDataEngine.pushDepth(depth.token, depth);
      }
    });

    // Handle disconnection — mark feed as stale
    dhanFeed.on('disconnected', () => {
      console.warn('[DhanFeed] WebSocket disconnected — feed stale');
      marketDataEngine.setFeedStale(true);
    });

    dhanFeed.on('connected', () => {
      marketDataEngine.setFeedStale(false);
    });

    // Default token subscriptions
    const defaultTokens = [
      // Indices (IDX_I)
      { securityId: '13', segment: 'IDX_I', symbol: 'NIFTY 50' },
      { securityId: '25', segment: 'IDX_I', symbol: 'BANKNIFTY' },
      { securityId: '27', segment: 'IDX_I', symbol: 'FINNIFTY' },
      { securityId: '442', segment: 'IDX_I', symbol: 'MIDCPNIFTY' },
      { securityId: '51', segment: 'IDX_I', symbol: 'SENSEX' },
      // NIFTY 50 constituents (NSE_EQ)
      { securityId: '2885', segment: 'NSE_EQ', symbol: 'RELIANCE' },
      { securityId: '3045', segment: 'NSE_EQ', symbol: 'SBIN' },
      { securityId: '1333', segment: 'NSE_EQ', symbol: 'HDFCBANK' },
      { securityId: '11536', segment: 'NSE_EQ', symbol: 'TCS' },
      { securityId: '1594', segment: 'NSE_EQ', symbol: 'INFY' },
      { securityId: '317', segment: 'NSE_EQ', symbol: 'BAJFINANCE' },
      { securityId: '5633', segment: 'NSE_EQ', symbol: 'MARUTI' },
      { securityId: '11483', segment: 'NSE_EQ', symbol: 'NTPC' },
      { securityId: '3787', segment: 'NSE_EQ', symbol: 'TECHM' },
      { securityId: '2031', segment: 'NSE_EQ', symbol: 'KOTAKBANK' },
      { securityId: '1660', segment: 'NSE_EQ', symbol: 'ITC' },
      { securityId: '10999', segment: 'NSE_EQ', symbol: 'WIPRO' },
      { securityId: '236', segment: 'NSE_EQ', symbol: 'ASIANPAINT' },
      { securityId: '16669', segment: 'NSE_EQ', symbol: 'BAJAJFINSV' },
      { securityId: '1363', segment: 'NSE_EQ', symbol: 'HINDUNILVR' },
      { securityId: '3506', segment: 'NSE_EQ', symbol: 'TATAMOTORS' },
      { securityId: '3499', segment: 'NSE_EQ', symbol: 'TATASTEEL' },
      { securityId: '5900', segment: 'NSE_EQ', symbol: 'ADANIENT' },
      { securityId: '11630', segment: 'NSE_EQ', symbol: 'TITAN' },
      { securityId: '694', segment: 'NSE_EQ', symbol: 'COALINDIA' },
      { securityId: '547', segment: 'NSE_EQ', symbol: 'BRITANNIA' },
      { securityId: '11532', segment: 'NSE_EQ', symbol: 'ULTRACEMCO' },
      { securityId: '2475', segment: 'NSE_EQ', symbol: 'ONGC' },
      { securityId: '20374', segment: 'NSE_EQ', symbol: 'BHARTIARTL' },
      { securityId: '3432', segment: 'NSE_EQ', symbol: 'TATACONSUM' },
      { securityId: '2181', segment: 'NSE_EQ', symbol: 'M&M' },
      { securityId: '15083', segment: 'NSE_EQ', symbol: 'ADANIPORTS' },
      { securityId: '11723', segment: 'NSE_EQ', symbol: 'HCLTECH' },
      { securityId: '14418', segment: 'NSE_EQ', symbol: 'JSWSTEEL' },
      { securityId: '4963', segment: 'NSE_EQ', symbol: 'IOC' },
      { securityId: '1922', segment: 'NSE_EQ', symbol: 'ICICIBANK' },
      { securityId: '288', segment: 'NSE_EQ', symbol: 'AXISBANK' },
      { securityId: '2303', segment: 'NSE_EQ', symbol: 'LT' },
      { securityId: '881', segment: 'NSE_EQ', symbol: 'DRREDDY' },
      { securityId: '3456', segment: 'NSE_EQ', symbol: 'SUNPHARMA' },
      { securityId: '6191', segment: 'NSE_EQ', symbol: 'CIPLA' },
      { securityId: '4717', segment: 'NSE_EQ', symbol: 'APOLLOHOSP' },
      { securityId: '910', segment: 'NSE_EQ', symbol: 'EICHERMOT' },
      { securityId: '14977', segment: 'NSE_EQ', symbol: 'POWERGRID' },
    ];

    // MCX commodity tokens
    const mcxTokens = [
      { securityId: '429604', segment: 'MCX_COMM', symbol: 'GOLD' },
      { securityId: '429638', segment: 'MCX_COMM', symbol: 'SILVER' },
      { securityId: '425475', segment: 'MCX_COMM', symbol: 'CRUDEOIL' },
      { securityId: '431765', segment: 'MCX_COMM', symbol: 'NATURALGAS' },
      { securityId: '430596', segment: 'MCX_COMM', symbol: 'COPPER' },
      { securityId: '438629', segment: 'MCX_COMM', symbol: 'ALUMINIUM' },
      { securityId: '437561', segment: 'MCX_COMM', symbol: 'ZINC' },
      { securityId: '431659', segment: 'MCX_COMM', symbol: 'LEAD' },
      { securityId: '432468', segment: 'MCX_COMM', symbol: 'NICKEL' },
    ];

    // CDS currency tokens
    const cdsTokens = [
      { securityId: '11091', segment: 'CUR', symbol: 'USDINR' },
      { securityId: '11363', segment: 'CUR', symbol: 'EURINR' },
      { securityId: '11096', segment: 'CUR', symbol: 'GBPINR' },
      { securityId: '11098', segment: 'CUR', symbol: 'JPYINR' },
    ];

    const allTokens = [...defaultTokens, ...mcxTokens, ...cdsTokens];

    // Seed symbol names into MarketDataEngine
    allTokens.forEach(t => {
      const exchange = t.segment === 'MCX_COMM' ? 'MCX' : t.segment === 'CUR' ? 'CDS' : t.segment === 'IDX_I' ? 'NSE' : 'NSE';
      marketDataEngine.pushQuote(t.securityId, { symbol: t.symbol, exchange, segment: t.segment });
      candleService.registerTokenExchange(t.securityId, exchange);
    });

    // Subscribe all in Quote mode (17) for OHLC + volume
    dhanFeed.subscribe(allTokens.map(t => ({ securityId: t.securityId, segment: t.segment })), 17);
    console.log('[DhanFeed] Subscribed ' + allTokens.length + ' instruments (mode 17 Quote)');

    // Hook live ticks into candle aggregation
    dhanFeed.on('tick', (tick) => {
      if (tick.ltp > 0) {
        candleService.processLiveTick(tick.token, tick.ltp, tick.volume, Date.now());
      }
    });

  } catch (err) {
    console.error('[DhanFeed] Connection failed:', err.message);
    console.error('[DhanFeed]   Live ticks unavailable — historical/REST still works via DataProviderSwitch');
  }
}

async function connectAngelFeedForBroker() {
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


startup().catch((err) => {
  console.error('[Startup] FATAL:', err.message);
  process.exit(1);
});

// -- Crash guards � prevent unhandled promise rejections from killing the process --
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
  // Log but don't crash � unhandled rejections in fire-and-forget paths (order execution,
  // market data, option chain) should not kill the entire server process.
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err.message, err.stack);
  // For uncaught exceptions we still exit � the process state is unknown.
  // Railway/Docker will restart automatically.
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
  if (dhanFeed) dhanFeed.disconnect();
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
  if (dhanFeed) dhanFeed.disconnect();
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

