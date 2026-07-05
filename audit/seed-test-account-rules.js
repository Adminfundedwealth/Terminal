'use strict';
/**
 * One-time seed: add risk_rules for the pre-existing RT-TEST-001 account
 * so integration tests have a complete account to work against.
 */
const https = require('https');
const fs   = require('fs');
const path = require('path');

const env  = fs.readFileSync(path.join(__dirname, '../server/.env'), 'utf8');
const BASE  = (env.match(/SUPABASE_URL=(.+)/)         || [])[1]?.trim();
const KEY   = (env.match(/SUPABASE_SERVICE_KEY=(.+)/) || [])[1]?.trim();
const ACCT  = 'a8d527a1-ce57-410e-b217-0577dd10d8d4';
const BALANCE = 50000;

const rules = [
  { trading_account_id: ACCT, rule_type: 'daily_loss_limit',  value: { percent: 5,  amount: BALANCE * 0.05  }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'max_drawdown',       value: { percent: 10, amount: BALANCE * 0.10, type: 'static' }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'profit_target',      value: { percent: 8,  amount: BALANCE * 0.08  }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'min_trading_days',   value: { count: 5  }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'max_positions',      value: { count: 10 }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'allowed_segments',   value: { segments: ['NSE','NFO','MCX','CDS'] }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'trading_hours',      value: { start: '09:15', end: '15:30' }, is_active: true },
  { trading_account_id: ACCT, rule_type: 'no_overnight',       value: { cutoffTime: '15:15', allowedProducts: ['MIS'] }, is_active: true },
];

function post(table, body) {
  return new Promise(resolve => {
    const b = JSON.stringify(body);
    const u = new URL(BASE + '/rest/v1/' + table);
    const r = https.request(u, {
      method: 'POST',
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(b),
        Prefer: 'return=minimal',
      },
    }, res => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    r.on('error', e => resolve({ status: 0, body: e.message }));
    r.write(b); r.end();
  });
}

function get(table, qs) {
  return new Promise(resolve => {
    const u = new URL(BASE + '/rest/v1/' + table + (qs || ''));
    const r = https.request(u, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }, res => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => { let j; try { j = JSON.parse(s); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', e => resolve({ status: 0 }));
    r.end();
  });
}

(async () => {
  // Check existing rules first (idempotency)
  const existing = await get('risk_rules', `?trading_account_id=eq.${ACCT}&select=rule_type`);
  if (existing.status === 200 && existing.json?.length > 0) {
    console.log(`RT-TEST-001 already has ${existing.json.length} rules — skipping seed`);
    existing.json.forEach(r => console.log('  ', r.rule_type));
    return;
  }

  const res = await post('risk_rules', rules);
  if (res.status === 201 || res.status === 200) {
    console.log(`✅ Seeded ${rules.length} risk_rules for RT-TEST-001 (${ACCT})`);
  } else {
    console.log(`❌ Seed failed: HTTP ${res.status} — ${res.body.substring(0,200)}`);
  }
})();
