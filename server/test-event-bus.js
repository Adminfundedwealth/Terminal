/**
 * EVENT BUS — Runtime Verification Script
 * 
 * Tests all 7 channels independently without requiring Supabase, Redis, or broker connections.
 * Verifies: publish → subscribe → bridge forwarding → metrics tracking.
 * 
 * Run: node server/test-event-bus.js
 */

import { eventBus, EventBridge, CHANNELS } from './events/index.js';

const PASS = '✓';
const FAIL = '✗';
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}

console.log('════════════════════════════════════════════════');
console.log('  EVENT BUS — Runtime Verification');
console.log('════════════════════════════════════════════════');
console.log('');

// ─── Test 1: Channel Definitions ─────────────────────────
console.log('[Test 1] Channel Definitions');

const expectedChannels = [
  'market.tick',
  'order.created',
  'order.updated',
  'position.updated',
  'trade.executed',
  'challenge.updated',
  'risk.alert',
];

for (const ch of expectedChannels) {
  assert(CHANNELS[ch] !== undefined, `Channel "${ch}" is defined`);
  assert(CHANNELS[ch].requiredFields.length > 0, `  → has required fields: [${CHANNELS[ch].requiredFields.join(', ')}]`);
  assert(CHANNELS[ch].wsEvent, `  → wsEvent: "${CHANNELS[ch].wsEvent}"`);
  assert(CHANNELS[ch].scope === 'global' || CHANNELS[ch].scope === 'account', `  → scope: "${CHANNELS[ch].scope}"`);
}

console.log('');

// ─── Test 2: Publish & Subscribe ─────────────────────────
console.log('[Test 2] Publish & Subscribe (all channels)');

const received = {};
for (const ch of expectedChannels) {
  received[ch] = [];
  eventBus.subscribe(ch, (event) => {
    received[ch].push(event);
  });
}

// Publish test events
eventBus.publish('market.tick', {
  token: '2885', ltp: 2950.50, timestamp: Date.now(),
  open: 2940, high: 2960, low: 2935, close: 2945,
  volume: 1500000, change: 10.5, changePercent: 0.36,
  bid: 2950.45, ask: 2950.55,
});

eventBus.publish('order.created', {
  orderId: 'ORD-001', symbol: 'RELIANCE', side: 'BUY',
  qty: 10, orderType: 'LIMIT', token: '2885', price: 2950,
}, { accountId: 'acc-001' });

eventBus.publish('order.updated', {
  orderId: 'ORD-001', status: 'FILLED', filledQty: 10, avgPrice: 2950,
}, { accountId: 'acc-001' });

eventBus.publish('position.updated', {
  symbol: 'RELIANCE', token: '2885', qty: 10,
  pnl: 150, avgPrice: 2935,
}, { accountId: 'acc-001' });

eventBus.publish('trade.executed', {
  tradeId: 'TRD-001', orderId: 'ORD-001', symbol: 'RELIANCE',
  side: 'BUY', qty: 10, price: 2950, token: '2885',
}, { accountId: 'acc-001' });

eventBus.publish('challenge.updated', {
  challengeId: 'ch-001', status: 'active',
  dailyPnl: 5000, totalPnl: 25000,
}, { accountId: 'acc-001' });

eventBus.publish('risk.alert', {
  type: 'warning', ruleType: 'daily_loss_limit',
  message: 'Approaching daily loss limit (80%)',
  currentValue: 40000, limitValue: 50000, percentUsed: 80,
}, { accountId: 'acc-001' });

// Verify all received
for (const ch of expectedChannels) {
  assert(received[ch].length === 1, `${ch} → received 1 event`);
  assert(received[ch][0].channel === ch, `  → event.channel = "${ch}"`);
  assert(received[ch][0].meta.timestamp > 0, `  → event.meta.timestamp present`);
}

console.log('');

// ─── Test 3: Wildcard Subscriptions ──────────────────────
console.log('[Test 3] Wildcard Subscriptions');

let wildcardCount = 0;
let orderWildcardCount = 0;

eventBus.subscribe('*', () => { wildcardCount++; });
eventBus.subscribe('order.*', () => { orderWildcardCount++; });

eventBus.publish('market.tick', { token: 'TEST', ltp: 100, timestamp: Date.now() });
eventBus.publish('order.created', { orderId: 'W-1', symbol: 'TEST', side: 'BUY', qty: 1, orderType: 'MARKET' }, { accountId: 'acc-001' });
eventBus.publish('order.updated', { orderId: 'W-1', status: 'FILLED' }, { accountId: 'acc-001' });

assert(wildcardCount === 3, `Global wildcard "*" received 3 events (got ${wildcardCount})`);
assert(orderWildcardCount === 2, `"order.*" wildcard received 2 events (got ${orderWildcardCount})`);

console.log('');

// ─── Test 4: Payload Validation ──────────────────────────
console.log('[Test 4] Payload Validation');

import { validatePayload } from './events/channels.js';

const validTick = validatePayload('market.tick', { token: '2885', ltp: 100, timestamp: Date.now() });
assert(validTick.valid === true, 'Valid market.tick payload passes');

const invalidTick = validatePayload('market.tick', { token: '2885' }); // missing ltp, timestamp
assert(invalidTick.valid === false, 'Invalid market.tick (missing ltp) fails');
assert(invalidTick.reason.includes('ltp'), `  → reason mentions "ltp"`);

const invalidOrder = validatePayload('order.created', { orderId: 'X' }); // missing symbol, side, qty, orderType
assert(invalidOrder.valid === false, 'Invalid order.created (missing fields) fails');

const unknownChannel = validatePayload('nonexistent.channel', { foo: 'bar' });
assert(unknownChannel.valid === false, 'Unknown channel fails validation');

console.log('');

// ─── Test 5: Metrics Tracking ────────────────────────────
console.log('[Test 5] Metrics Tracking');

const metrics = eventBus.getMetrics();
assert(metrics.totalEmitted > 0, `Total emitted: ${metrics.totalEmitted} events`);
assert(metrics.byChannel['market.tick'] >= 2, `  market.tick count: ${metrics.byChannel['market.tick']}`);
assert(metrics.byChannel['order.created'] >= 2, `  order.created count: ${metrics.byChannel['order.created']}`);
assert(metrics.byChannel['order.updated'] >= 2, `  order.updated count: ${metrics.byChannel['order.updated']}`);
assert(metrics.byChannel['position.updated'] >= 1, `  position.updated count: ${metrics.byChannel['position.updated']}`);
assert(metrics.byChannel['trade.executed'] >= 1, `  trade.executed count: ${metrics.byChannel['trade.executed']}`);
assert(metrics.byChannel['challenge.updated'] >= 1, `  challenge.updated count: ${metrics.byChannel['challenge.updated']}`);
assert(metrics.byChannel['risk.alert'] >= 1, `  risk.alert count: ${metrics.byChannel['risk.alert']}`);
assert(metrics.uptimeMs >= 0, `  Uptime: ${metrics.uptimeMs}ms`);
assert(metrics.redisConnected === false, `  Redis: not connected (expected in test)`);

console.log('');

// ─── Test 6: EventBridge (Mock Socket.IO) ────────────────
console.log('[Test 6] EventBridge Routing');

// Create mock Socket.IO server
const mockEmits = [];
const mockRooms = new Map();

const mockIO = {
  to: (room) => ({
    emit: (event, data) => {
      mockEmits.push({ room, event, data });
    },
  }),
};

const mockRealtimeServer = { io: mockIO };

// Create and start bridge
const bridge = new EventBridge();
bridge.setRealtimeServer(mockRealtimeServer);
bridge.start();

// Publish a market.tick (should go to quote:{token} room)
eventBus.publish('market.tick', {
  token: '99926000', ltp: 24500, timestamp: Date.now(),
});

// Publish an order event (should go to account:{id} room)
eventBus.publish('order.created', {
  orderId: 'BRIDGE-1', symbol: 'NIFTY', side: 'BUY', qty: 50, orderType: 'MARKET',
}, { accountId: 'acc-bridge-test' });

// Wait a tick for async processing
await new Promise(r => setTimeout(r, 10));

const tickEmit = mockEmits.find(e => e.room === 'quote:99926000');
assert(tickEmit !== undefined, 'market.tick routed to "quote:99926000" room');
assert(tickEmit?.event === 'quote', `  → event name: "quote"`);

const orderEmit = mockEmits.find(e => e.room === 'account:acc-bridge-test');
assert(orderEmit !== undefined, 'order.created routed to "account:acc-bridge-test" room');
assert(orderEmit?.event === 'order_update', `  → event name: "order_update"`);

const bridgeStats = bridge.getStats();
assert(bridgeStats.forwarded >= 2, `Bridge forwarded ${bridgeStats.forwarded} events`);

bridge.stop();

console.log('');

// ─── Test 7: Throttling ─────────────────────────────────
console.log('[Test 7] Throttling (position.updated @ 250ms)');

const throttleBridge = new EventBridge();
const throttleEmits = [];
const throttleMockIO = {
  to: (room) => ({
    emit: (event, data) => { throttleEmits.push({ room, event, data, ts: Date.now() }); },
  }),
};
throttleBridge.setRealtimeServer({ io: throttleMockIO });
throttleBridge.start();

// Rapid-fire 5 position updates (throttle = 250ms, so only 1 should pass)
for (let i = 0; i < 5; i++) {
  eventBus.publish('position.updated', {
    symbol: 'RELIANCE', token: '2885', qty: 10, pnl: 100 + i,
  }, { accountId: 'acc-throttle' });
}

assert(throttleEmits.filter(e => e.event === 'position_update').length === 1,
  'Only 1 of 5 rapid position.updated events forwarded (throttled)');

const throttleStats = throttleBridge.getStats();
assert(throttleStats.throttled >= 4, `  → ${throttleStats.throttled} events throttled`);

throttleBridge.stop();

console.log('');

// ─── Test 8: MarketDataEngine Integration ────────────────
console.log('[Test 8] MarketDataEngine → EventBus Integration');

import { MarketDataEngine } from './services/marketDataEngine.js';

const mde = new MarketDataEngine();
let mdeTickReceived = false;

eventBus.subscribe('market.tick', (event) => {
  if (event.payload.token === 'MDE-TEST') {
    mdeTickReceived = true;
  }
});

mde.pushQuote('MDE-TEST', {
  ltp: 1234.56,
  open: 1230,
  high: 1240,
  low: 1225,
  close: 1228,
  volume: 500000,
  change: 6.56,
  changePercent: 0.53,
  bid: 1234.50,
  ask: 1234.60,
  timestamp: Date.now(),
});

assert(mdeTickReceived, 'MarketDataEngine.pushQuote() publishes to event bus');
assert(mde.getQuote('MDE-TEST')?.ltp === 1234.56, '  → Quote cached in MDE');

mde.destroy();

console.log('');

// ─── Test 9: Unsubscribe ─────────────────────────────────
console.log('[Test 9] Unsubscribe');

let unsubCount = 0;
const unsub = eventBus.subscribe('market.tick', () => { unsubCount++; });

eventBus.publish('market.tick', { token: 'UNSUB', ltp: 1, timestamp: Date.now() });
assert(unsubCount === 1, 'Received before unsubscribe');

unsub(); // unsubscribe

eventBus.publish('market.tick', { token: 'UNSUB', ltp: 2, timestamp: Date.now() });
assert(unsubCount === 1, 'Not received after unsubscribe');

console.log('');

// ─── Summary ─────────────────────────────────────────────
console.log('════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('');
  console.log('  All event bus channels verified.');
  console.log('  Producers: MarketDataEngine, AccountService, RiskEngine, TradeRepo, PositionRepo');
  console.log('  Bridge:    EventBus → Socket.IO rooms (with throttling)');
  console.log('  Frontend:  Consumes via Socket.IO events (quote, order_update, position_update, etc.)');
  console.log('');
  process.exit(0);
}
