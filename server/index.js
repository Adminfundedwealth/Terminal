/**
 * FUNDEDWEALTH TERMINAL — SERVER ENTRY POINT
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

// ─── Initialize Services ─────────────────────────────────────────
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

// ─── Express App ─────────────────────────────────────────────────
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

// Security headers — PRODUCTION: Full CSP enabled
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

// Rate limiting — Redis-backed in production, memory fallback in development only
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

// Health check (minimal — no sensitive internal state)
app.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: { connected: dbStatus.connected },
    uptime: process.uptime(),
  });
});

// Full market status (AUTHENTICATED — no public access to internal state)
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

// Provisioning routes (API key protected — called by Website/Admin)
app.use('/provisioning', createProvisioningRouter());

// Order rate limit (MUST be before API routes — more restrictive)
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
  const distExists = fs.existsSync(distPath);
  if (distExists) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      // Don't serve index.html for API/auth/health routes
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/health') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

// Global error handler — prevents stack trace leaks
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

// ─── WebSocket Server ────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss, marketDataEngine);

// ─── Startup ─────────────────────────────────────────────────────
async function startup() {
  console.log('════════════════════════════════════════════════');
  console.log('  FUNDEDWEALTH TERMINAL — Server Starting');
  console.log('════════════════════════════════════════════════');
  console.log(`  Port: ${PORT}`);
  console.log(`  Env:  ${process.env.NODE_ENV || 'development'}`);
  console.log('');

  // 1. Test Supabase Connection
  console.log('[Startup] Testing Supabase connection...');
  const dbResult = await testConnection();
  if (dbResult.connected) {
    console.log('[Startup] ✓ Supabase connected');
  } else {
    console.warn(`[Startup] ✗ Supabase NOT connected: ${dbResult.reason}`);
    console.warn('[Startup]   WARNING: Session validation will fail-closed (all sessions rejected).');
  }

  // 2. Initialize Market Data Engine
  console.log('[Startup] Initializing market data engine...');
  await marketDataEngine.initialize();
  console.log('[Startup] ✓ Market data engine ready (awaiting broker adapter)');

  // 2b. Initialize Event Dispatcher (persistence subscriber)
  console.log('[Startup] Initializing event dispatcher (persistence layer)...');
  eventDispatcher.initialize();
  console.log('[Startup] ✓ Event dispatcher active — all events will be persisted');

  // 3. Initialize Redis Pub/Sub (optional)
  console.log('[Startup] Initializing Redis Pub/Sub...');
  const redisConnected = await redisPubSub.initialize();
  if (redisConnected) {
    console.log('[Startup] ✓ Redis Pub/Sub connected');
  } else {
    console.log('[Startup] ○ Redis not configured — single-instance mode');
  }

  // 4. Initialize TradingView Datafeed
  tradingViewDatafeed = new TradingViewDatafeed(instrumentService, marketDataEngine);
  console.log('[Startup] ✓ TradingView Datafeed layer ready');

  // 5. Schedule daily checks (only if Supabase is connected)
  if (dbResult.connected) {
    scheduleDailyChecks();
    console.log('[Startup] ✓ Daily checks scheduler active');

    // 5b. Start provisioning poller (polls pending provisioning_logs)
    startProvisioningPoller();
    console.log('[Startup] ✓ Provisioning poller active (30s interval)');
  }

  // 6. Start HTTP server
  server.listen(PORT, () => {
    // 7. Initialize Socket.IO (needs server to be listening)
    realtimeServer = new RealtimeServer(server, marketDataEngine, {
      corsOrigin: corsOrigins,
    });
    console.log('[Startup] ✓ Socket.IO server initialized');

    // 7b. Start Event Bridge (connects eventBus → Socket.IO/WS clients)
    eventBridge.setRealtimeServer(realtimeServer);
    eventBridge.setWss(wss);
    eventBridge.start();
    console.log('[Startup] ✓ Event Bridge active (7 channels → client)');

    // 8. Start Broker Health Monitor
    healthMonitor.start();
    console.log('[Startup] ✓ Broker health monitor active');

    console.log('');
    console.log(`[Startup] ✓ Server listening on http://localhost:${PORT}`);
    console.log(`[Startup] ✓ WebSocket (legacy) on ws://localhost:${PORT}/ws`);
    console.log(`[Startup] ✓ Socket.IO on http://localhost:${PORT}/socket.io`);
    console.log('');
    console.log('  Broker Status:');
    const bh = BrokerFactory.getHealthReport();
    console.log(`    Angel One: configured=${bh._available.angelone.configured}, connected=${bh._available.angelone.status}`);
    console.log(`    Dhan:      configured=${bh._available.dhan.configured}, status=${bh._available.dhan.status}`);
    console.log('');
    console.log('════════════════════════════════════════════════');

    // 9. Connect Angel Feed (live market data) — fire and forget
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
      // Indices (mode 1 — LTP only)
      { token: '99926000', exchange: 'NSE', symbol: 'NIFTY 50' },
      { token: '99926009', exchange: 'NSE', symbol: 'BANKNIFTY' },
      { token: '99926037', exchange: 'NSE', symbol: 'FINNIFTY' },
      { token: '99926074', exchange: 'NSE', symbol: 'MIDCPNIFTY' },
      // NIFTY 50 constituents (mode 2 — Quote with OHLC + volume)
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

    // Register token exchanges for candle service
    defaultTokens.forEach(t => candleService.registerTokenExchange(t.token, t.exchange));

    // Split tokens: indices (mode 1 LTP) vs stocks (mode 2 Quote)
    const indexTokens = defaultTokens.filter(t => t.token.startsWith('999'));
    const stockTokens = defaultTokens.filter(t => !t.token.startsWith('999'));

    if (indexTokens.length > 0) {
      angelFeed.subscribe(indexTokens, 1); // LTP mode for indices (no order book)
    }
    if (stockTokens.length > 0) {
      angelFeed.subscribe(stockTokens, 2); // Quote mode for stocks (OHLC + volume + change)
    }
    console.log(`[AngelFeed] ✓ ${indexTokens.length} indices (mode 1) + ${stockTokens.length} stocks (mode 2) subscribed`);

    // Hook live ticks into candle aggregation
    for (const t of defaultTokens) {
      marketDataEngine.subscribe(t.token, (event) => {
        if (event.data?.ltp) {
          candleService.processLiveTick(t.token, event.data.ltp, event.data.volume, event.data.timestamp);
        }
      });
    }

    // Position P&L tracking starts when authenticated sessions are active
    // (no dev bypass — sessions drive tracking)
  } catch (err) {
    console.warn(`[AngelFeed] ✗ Connection failed: ${err.message}`);
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
