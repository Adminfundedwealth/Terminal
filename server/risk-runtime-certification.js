import { RiskEngine } from './services/riskEngine.js';
import { eventBus } from './events/index.js';
import { CHANNELS } from './events/channels.js';
import { RiskRulesRepository } from './repositories/risk-rules.repository.js';
import { PositionRepository } from './repositories/position.repository.js';
import { TradeRepository } from './repositories/trade.repository.js';
import { AccountRepository } from './repositories/account.repository.js';
import { AuditRepository } from './repositories/audit.repository.js';

const results = [];
let testNum = 0;
const mockDbOps = [];

function log(label, status, evidence) {
  testNum++;
  const entry = { test: testNum, label, status, evidence };
  results.push(entry);
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${testNum}] ${label}: ${status}`);
  if (evidence) {
    const lines = JSON.stringify(evidence, null, 2).split('\n');
    for (const l of lines.slice(0, 10)) console.log('   ' + l);
    if (lines.length > 10) console.log(`   ...(${lines.length-10} more)`);
  }
  console.log('');
}

// === MOCK ACCOUNTS ===
const MOCK = {
  'locked-001': { id:'locked-001', user_id:'u1', status:'locked', balance:950000, peak_balance:1000000, locked_reason:'Daily loss limit breached', challenge_id:'c1', daily_loss_limit:50000, max_drawdown:100000, profit_target:100000 },
  'breached-002': { id:'breached-002', user_id:'u2', status:'breached', balance:880000, peak_balance:1000000, locked_reason:'Max drawdown breached', challenge_id:'c2', daily_loss_limit:50000, max_drawdown:100000, profit_target:100000 },
  'active-loss-003': { id:'active-loss-003', user_id:'u3', status:'active', balance:960000, peak_balance:1000000, challenge_id:'c3', daily_loss_limit:50000, max_drawdown:100000, profit_target:100000 },
  'active-dd-004': { id:'active-dd-004', user_id:'u4', status:'active', balance:890000, peak_balance:1000000, challenge_id:'c4', daily_loss_limit:50000, max_drawdown:100000, profit_target:100000 },
  'healthy-005': { id:'healthy-005', user_id:'u5', status:'active', balance:1050000, peak_balance:1050000, challenge_id:'c5', daily_loss_limit:50000, max_drawdown:100000, profit_target:100000 },
  'challenge-006': { id:'challenge-006', user_id:'u6', status:'active', balance:870000, peak_balance:1000000, challenge_id:'c6', daily_loss_limit:50000, max_drawdown:100000, profit_target:100000 },
};

const MOCK_CHALLENGES = {
  'c3': { id:'c3', user_id:'u3', type:'evaluation', plan:'10K', status:'active', initial_balance:1000000 },
  'c4': { id:'c4', user_id:'u4', type:'evaluation', plan:'10K', status:'active', initial_balance:1000000 },
  'c6': { id:'c6', user_id:'u6', type:'evaluation', plan:'10K', status:'active', initial_balance:1000000 },
};

const TRADES = [
  { token:'RELIANCE', side:'BUY', qty:100, price:2500 },
  { token:'RELIANCE', side:'SELL', qty:100, price:2450 },
  { token:'INFY', side:'BUY', qty:200, price:1500 },
  { token:'INFY', side:'SELL', qty:200, price:1520 },
];

// === MONKEY PATCHES ===
AccountRepository.prototype.findById = async function(id) {
  mockDbOps.push({ op:'findById', id });
  if (!MOCK[id]) throw new Error('not found');
  return MOCK[id];
};
AccountRepository.prototype.lockAccount = async function(id, reason) {
  mockDbOps.push({ op:'lockAccount', id, reason });
  if (MOCK[id]) { MOCK[id].status='locked'; MOCK[id].locked_reason=reason; }
  return MOCK[id];
};
AccountRepository.prototype.breachAccount = async function(id, reason) {
  mockDbOps.push({ op:'breachAccount', id, reason });
  if (MOCK[id]) { MOCK[id].status='breached'; MOCK[id].locked_reason=reason; }
  return MOCK[id];
};
AccountRepository.prototype.updatePeakBalance = async function(id, peak) {
  mockDbOps.push({ op:'updatePeakBalance', id, peak });
  if (MOCK[id]) MOCK[id].peak_balance = peak;
  return MOCK[id];
};
AccountRepository.prototype.getWithChallenge = async function(id) {
  const a = MOCK[id]; if (!a) return null;
  return { ...a, challenge: MOCK_CHALLENGES[a.challenge_id] || null };
};
RiskRulesRepository.prototype.getRulesMap = async function(accountId) {
  const a = MOCK[accountId]; if (!a) return {};
  const map = {};
  if (a.daily_loss_limit) map.daily_loss_limit = { amount: a.daily_loss_limit };
  if (a.max_drawdown) map.max_drawdown = { amount: a.max_drawdown };
  if (a.profit_target) map.profit_target = { amount: a.profit_target };
  return map;
};
PositionRepository.prototype.getTotalUnrealizedPnl = async function(accountId) {
  if (accountId === 'active-loss-003') return -55000;
  if (accountId === 'active-dd-004') return -15000;
  if (accountId === 'challenge-006') return -5000;
  if (accountId === 'healthy-005') return 5000;
  return 0;
};
PositionRepository.prototype.countOpenPositions = async function() { return 2; };
TradeRepository.prototype.getTodayRealizedPnl = async function(accountId) {
  if (accountId === 'active-loss-003' || accountId === 'healthy-005') return TRADES;
  return [];
};
TradeRepository.prototype.countTodayTrades = async function() { return 4; };
AuditRepository.prototype.log = async function(e) { mockDbOps.push({ op:'audit', ...e }); return e; };

// === TEST 1: Locked account order rejection ===
async function test1() {
  const r = await RiskEngine.validateOrder('locked-001', { symbol:'RELIANCE', token:'2885', segment:'NSE', exchange:'NSE', side:'BUY', orderType:'MARKET', productType:'MIS', qty:100, price:2500 });
  log('Locked account rejects orders', r.allowed===false && r.reason.includes('locked') ? 'PASS' : 'FAIL', {
    accountStatus: 'locked', apiResponse: r, dbRow: { status: MOCK['locked-001'].status, locked_reason: MOCK['locked-001'].locked_reason }
  });
}

// === TEST 2: Breached account order rejection ===
async function test2() {
  const r = await RiskEngine.validateOrder('breached-002', { symbol:'TCS', token:'11536', segment:'NSE', exchange:'NSE', side:'SELL', orderType:'LIMIT', productType:'MIS', qty:50, price:3500 });
  log('Breached account rejects orders', r.allowed===false && r.reason.includes('breached') ? 'PASS' : 'FAIL', {
    accountStatus: 'breached', apiResponse: r, dbRow: { status: MOCK['breached-002'].status, locked_reason: MOCK['breached-002'].locked_reason }
  });
}

// === TEST 3: Daily loss breach simulation ===
async function test3() {
  let lockedEvt = null, riskEvt = null;
  const u1 = eventBus.subscribe('account.locked', e => { lockedEvt = e; });
  const u2 = eventBus.subscribe('risk.alert', e => { riskEvt = e; });
  const r = await RiskEngine.postTradeCheck('active-loss-003', null);
  u1(); u2();
  log('Daily loss limit triggers lock', r.status==='locked' ? 'PASS' : 'FAIL', {
    preState: { balance:960000, dailyLossLimit:50000, unrealizedPnl:-55000 },
    result: r, postStatus: MOCK['active-loss-003'].status,
    events: { locked: lockedEvt?.payload, riskAlert: riskEvt?.payload },
    dbOps: mockDbOps.filter(o => o.id==='active-loss-003' || o.accountId==='active-loss-003')
  });
}

// === TEST 4: Max drawdown breach simulation ===
async function test4() {
  let breachEvt = null, riskEvt = null;
  const u1 = eventBus.subscribe('account.breached', e => { breachEvt = e; });
  const u2 = eventBus.subscribe('risk.alert', e => { riskEvt = e; });
  const r = await RiskEngine.postTradeCheck('active-dd-004', null);
  u1(); u2();
  log('Max drawdown triggers breach', r.status==='breached' ? 'PASS' : 'FAIL', {
    preState: { balance:890000, peakBalance:1000000, maxDrawdown:100000, unrealizedPnl:-15000 },
    calculation: { equity:875000, drawdown:125000, limit:100000 },
    result: r, postStatus: MOCK['active-dd-004'].status,
    events: { breached: breachEvt?.payload, riskAlert: riskEvt?.payload },
    dbOps: mockDbOps.filter(o => o.id==='active-dd-004' || o.accountId==='active-dd-004')
  });
}

// === TEST 5: Challenge failure simulation ===
async function test5() {
  let challengeEvt = null;
  const u1 = eventBus.subscribe('challenge.updated', e => { challengeEvt = e; });
  const r = await RiskEngine.postTradeCheck('challenge-006', null);
  u1();
  // balance:870000 + unrealized:-5000 = equity:865000
  // drawdown: 1000000 - 865000 = 135000 >= 100000
  log('Challenge fails on drawdown breach', r.status==='breached' ? 'PASS' : 'FAIL', {
    preState: { balance:870000, peakBalance:1000000, unrealizedPnl:-5000, maxDD:100000 },
    calculation: { equity:865000, drawdown:135000, limit:100000 },
    result: r, postStatus: MOCK['challenge-006'].status,
    challengeEvent: challengeEvt?.payload,
    dbOps: mockDbOps.filter(o => o.id==='challenge-006' || o.accountId==='challenge-006')
  });
}

// === TEST 6: PnL recalculation ===
async function test6() {
  // RELIANCE: BUY 100@2500, SELL 100@2450 => pnl = (2450-2500)*100 = -5000
  // INFY: BUY 200@1500, SELL 200@1520 => pnl = (1520-1500)*200 = +4000
  // Total = -1000
  const pnl = await RiskEngine.calculateTodayRealizedPnl('healthy-005');
  log('PnL FIFO recalculation', Math.abs(pnl - (-1000)) < 0.01 ? 'PASS' : 'FAIL', {
    trades: TRADES.map(t => `${t.side} ${t.qty} ${t.token} @ ₹${t.price}`),
    calculation: { RELIANCE: -5000, INFY: 4000, total: -1000 },
    actual: pnl, expected: -1000, method: 'FIFO'
  });

  // Post-trade check: realized=-1000 + unrealized=5000 = +4000 (no breach)
  const r = await RiskEngine.postTradeCheck('healthy-005', null);
  log('Healthy account passes post-trade check', r.status==='ok' ? 'PASS' : 'FAIL', {
    realizedPnl: -1000, unrealizedPnl: 5000, totalDailyPnl: 4000,
    dailyLossLimit: 50000, result: r
  });
}

// === TEST 7: Risk dashboard events ===
async function test7() {
  const channels = ['risk.alert','account.locked','account.breached','account.unlocked','challenge.updated'];
  const allExist = channels.every(c => CHANNELS[c]);
  log('Risk event channels registered', allExist ? 'PASS' : 'FAIL', {
    channels: channels.map(c => ({ name:c, wsEvent:CHANNELS[c]?.wsEvent, scope:CHANNELS[c]?.scope }))
  });

  let alertOk = false;
  const u1 = eventBus.subscribe('risk.alert', e => { alertOk = e.payload.type==='breach'; });
  eventBus.publish('risk.alert', { type:'breach', ruleType:'daily_loss_limit', message:'Test breach', currentValue:56000, limitValue:50000, percentUsed:100 }, { accountId:'test' });
  u1();
  log('risk.alert event fires correctly', alertOk ? 'PASS' : 'FAIL', { received: alertOk });

  let wc = 0;
  const u2 = eventBus.subscribe('account.*', () => { wc++; });
  eventBus.publish('account.locked', { accountId:'t', reason:'test' }, { accountId:'t' });
  eventBus.publish('account.breached', { accountId:'t', reason:'test' }, { accountId:'t' });
  eventBus.publish('account.unlocked', { accountId:'t', previousReason:'test' }, { accountId:'t' });
  u2();
  log('Wildcard account.* receives all events', wc===3 ? 'PASS' : 'FAIL', {
    expected:3, received:wc, frontendComponents:['RiskOverlay.tsx','RiskPanel.tsx','RiskWidget.tsx','RiskMonitor.tsx']
  });
}

// === MAIN ===
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  RISK ENGINE — RUNTIME CERTIFICATION                    ║');
console.log('║  ' + new Date().toISOString() + '                  ║');
console.log('║  Mode: Simulated account states (no live DB needed)     ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

try {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
} catch(err) {
  console.error('FATAL:', err.message, err.stack);
  log('Runtime error', 'FAIL', { error: err.message });
}

const passed = results.filter(r => r.status==='PASS').length;
const failed = results.filter(r => r.status==='FAIL').length;
console.log('════════════════════════════════════════════════════════════');
console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('');
results.forEach(r => console.log(`  ${r.status==='PASS'?'✅':'❌'} [${r.test}] ${r.label}`));
console.log('');
console.log(failed===0 ? '✅ VERDICT: CERTIFIED' : '❌ VERDICT: NOT CERTIFIED');
console.log('');
console.log('--- JSON ---');
console.log(JSON.stringify({ date:new Date().toISOString(), passed, failed, total:results.length, verdict:failed===0?'CERTIFIED':'FAILED', mockDbOps, results }, null, 2));
process.exit(failed > 0 ? 1 : 0);
