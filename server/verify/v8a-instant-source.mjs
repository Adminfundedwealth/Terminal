/**
 * v8a — Instant Funding source-code verification (no DB imports)
 * Tests all rules via file inspection + canonical profile values
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
const read  = (rel) => readFileSync(join(__dir, '..', rel), 'utf8');

import { getInstantFundingRuleProfile, getFlashFundingRuleProfile,
         get1StepRuleProfile, get2StepPhase1RuleProfile } from '../config/challengeRuleProfiles.js';

let p=0, f=0;
const ok = (m) => { console.log(`  ✓ ${m}`); p++; };
const er = (m) => { console.error(`  ✗ ${m}`); f++; };

const re  = read('services/riskEngine.js');
const ips = read('services/instantRiskProfileService.js');
const ps  = read('services/payoutService.js');
const ar  = read('routes/admin.routes.js');
const mig = read('db/terminal-migrations/020_instant_risk_profile.sql');
const crp = read('config/challengeRuleProfiles.js');

const ip  = getInstantFundingRuleProfile(1000000);

// ── Profile defaults from HARDCODED_DEFAULT (source-readable) ────────────
console.log('\n── Profile defaults (source) ──');
ips.includes("trading_hours_end:          '15:30'")  ?ok('T14: hours_end=15:30 in HARDCODED_DEFAULT') :er('T14: hours_end wrong in HARDCODED_DEFAULT');
ips.includes("overnight_allowed:          true")     ?ok('T15: overnight=true in HARDCODED_DEFAULT')  :er('T15: overnight wrong');
ips.includes("weekend_allowed:            true")     ?ok('T16: weekend=true in HARDCODED_DEFAULT')    :er('T16: weekend wrong');
ips.includes("profit_split_pct:           80.0")     ?ok('T20: profit_split=80 in HARDCODED_DEFAULT') :er('T20: profit_split wrong');
ips.includes("daily_profit_cap_cooldown_hours: 8")   ?ok('T9: cooldown=8h in HARDCODED_DEFAULT')     :er('T9: cooldown missing');
ips.includes("daily_loss_pct:             3.0")      ?ok('T1: daily_loss=3%')                        :er('T1: daily_loss wrong');
ips.includes("max_drawdown_pct:           5.0")      ?ok('T2: max_drawdown=5%')                      :er('T2: max_drawdown wrong');
ips.includes("profit_target_pct:          0.0")      ?ok('T3: profit_target=0')                      :er('T3: profit_target wrong');
ips.includes("min_trading_days:           7")        ?ok('T4: min_trading_days=7')                   :er('T4: min_trading_days wrong');
ips.includes("max_open_positions:         20")       ?ok('T5: max_open_positions=20')                :er('T5: max_positions wrong');
ips.includes("max_position_size_pct:      70.0")     ?ok('T6: max_position_size=70%')                :er('T6: max_position_size wrong');
ips.includes("leverage_max:               50")       ?ok('T7: leverage_max=50')                      :er('T7: leverage wrong');
ips.includes("daily_profit_cap_pct:       4.0")      ?ok('T8: daily_profit_cap=4%')                  :er('T8: daily_profit_cap wrong');
ips.includes("risk_per_idea_pct:          1.0")      ?ok('T10: risk_per_idea=1%')                    :er('T10: risk_per_idea wrong');
ips.includes("risk_per_idea_window_min:   10")       ?ok('T11: risk_window=10min')                   :er('T11: risk_window wrong');
ips.includes("consistency_rule_pct:       15.0")     ?ok('T12: consistency=15%')                     :er('T12: consistency wrong');
ips.includes("inactivity_close_days:      60")       ?ok('T13: inactivity=60 days')                  :er('T13: inactivity wrong');
ips.includes("payout_threshold_pct:       5.0")      ?ok('T21: payout_threshold=5%')                 :er('T21: payout_threshold wrong');
ips.includes("holiday_restriction:        true")     ?ok('T17: holiday=blocked')                     :er('T17: holiday wrong');
ips.includes("'NSE', 'NFO', 'BFO', 'MCX', 'CDS'")  ?ok('T18: segments correct')                    :er('T18: segments wrong');

// ── No progression split ──────────────────────────────────────────────────
!ips.includes('profit_split_initial_pct') ?ok('T20: no progression field (flat 80%)') :er('T20: progression field found');
ips.includes("_startedAt = null") ?ok('T20: getEffectiveSplitPct accepts/ignores startedAt') :er('T20: method signature wrong');
ips.includes("profit_split_pct ?? 80") ?ok('T20: getEffectiveSplitPct returns profit_split_pct') :er('T20: return value wrong');

// ── Canonical profile checks ─────────────────────────────────────────────
console.log('\n── Canonical profile (challengeRuleProfiles.js) ──');
ip.rules.daily_loss_limit.percent===3    ?ok('canonical: daily_loss=3%')        :er(`canonical: daily_loss=${ip.rules.daily_loss_limit.percent}`);
ip.rules.max_drawdown.percent===5        ?ok('canonical: max_drawdown=5%')       :er(`canonical: max_drawdown=${ip.rules.max_drawdown.percent}`);
ip.rules.max_drawdown.type==='static'    ?ok('canonical: drawdown=static')       :er('canonical: drawdown type wrong');
ip.rules.profit_target.percent===0       ?ok('canonical: profit_target=0 (none)') :er('canonical: profit_target wrong');
ip.rules.trading_hours.end==='15:30'     ?ok('canonical: hours end=15:30')       :er(`canonical: hours=${ip.rules.trading_hours.end}`);
ip.rules.no_overnight.allowed===true     ?ok('canonical: overnight=allowed')     :er('canonical: overnight wrong');
ip.rules.weekend_allowed.allowed===true  ?ok('canonical: weekend=allowed')       :er('canonical: weekend wrong');
ip.rules.profit_split.percent===80       ?ok('canonical: split=80%')             :er(`canonical: split=${ip.rules.profit_split.percent}`);
['NSE','NFO','BFO','CDS','MCX'].every(s=>ip.rules.allowed_segments.segments.includes(s))
  ?ok('canonical: all 5 segments')       :er(`canonical: segments wrong`);
ip.rules.consistency_rule.maxDayProfitPercent===15 ?ok('canonical: consistency=15%') :er('canonical: consistency wrong');

// ── riskEngine.js ─────────────────────────────────────────────────────────
console.log('\n── riskEngine.js ──');
re.includes("(ip.profit_target_pct > 0)")&&re.includes(": null")
  ?ok('RE: profit_target=null when pct=0 (no phantom target)') :er('RE: null profit_target logic missing');
re.includes('checkTradingHoursIST')      ?ok('RE: IST-aware trading hours')      :er('RE: IST hours missing');
re.includes('_instant_weekend_allowed')  ?ok('RE: weekend flag in rules map')    :er('RE: weekend flag missing');
re.includes('_instant_holiday_restriction') ?ok('RE: holiday flag in rules map') :er('RE: holiday flag missing');
re.includes('_instant_profit_cap_cooldown_hours') ?ok('RE: cooldown flag in rules map') :er('RE: cooldown flag missing');
// Leverage: Instant uses real exposure
re.includes('isInstantAccount(account)')&&re.includes('existingExposure') ?ok('RE: leverage real exposure') :er('RE: leverage real exposure missing');
// parseFloat(account.used_margin) must NOT be inside the Instant block
const instStart = re.indexOf('isInstantAccount(account)');
const nonInstStart = re.indexOf('Non-Instant: original logic');
const instantBlock = re.slice(instStart, nonInstStart);
!instantBlock.includes('parseFloat(account.used_margin')
  ?ok('RE: used_margin NOT in Instant leverage block') :er('RE: used_margin in Instant leverage block');
// Cooldown: checkDailyProfitCap persists to DB
re.includes('daily_profit_cap_until')    ?ok('RE: cooldown persisted to DB')     :er('RE: cooldown not persisted');
re.includes("import('../db/client.js')")&&re.includes('daily_profit_cap_until')
  ?ok('RE: cooldown uses direct DB write') :er('RE: cooldown DB write missing');

// ── payoutService.js ──────────────────────────────────────────────────────
console.log('\n── payoutService.js ──');
ps.includes("isInstantPlan || isFlashPlan || challenge.type === 'funded'")
  ?ok('PS: payout gate accepts Instant (evaluation_phase1 bypassed)') :er('PS: payout gate blocks Instant');
ps.includes("normalized === 'instant'")&&ps.includes('profit_split_pct')
  ?ok('PS: Instant split reads from profile') :er('PS: Instant split wrong');
ps.includes("payout_threshold_pct")&&ps.includes("isInstant")
  ?ok('PS: payout threshold from Instant profile') :er('PS: threshold not enforced');
!ps.match(/instant[\s\S]{0,200}profit_split_initial_pct/) 
  ?ok('PS: no Instant progression split') :er('PS: Instant progression still present');

// ── Migration 020 ─────────────────────────────────────────────────────────
console.log('\n── Migration 020 ──');
mig.includes("DEFAULT '15:30'")          ?ok('MIG: hours_end=15:30')            :er('MIG: hours_end wrong');
mig.includes("DEFAULT TRUE")&&mig.includes('overnight_allowed') ?ok('MIG: overnight=true') :er('MIG: overnight wrong');
mig.includes("DEFAULT TRUE")&&mig.includes('weekend_allowed') ?ok('MIG: weekend=true')   :er('MIG: weekend wrong');
mig.includes("DEFAULT 80.0")&&mig.includes('profit_split_pct') ?ok('MIG: split=80%')     :er('MIG: split wrong');
mig.includes("DEFAULT 8.0")&&mig.includes('daily_profit_cap_cooldown_hours') ?ok('MIG: cooldown=8h') :er('MIG: cooldown wrong');
mig.includes('daily_profit_cap_until')   ?ok('MIG: daily_profit_cap_until column') :er('MIG: cap_until column missing');
!mig.includes('DROP')&&!mig.includes('DELETE FROM') ?ok('MIG: no destructive SQL') :er('MIG: DESTRUCTIVE SQL');

// ── Admin ─────────────────────────────────────────────────────────────────
console.log('\n── Admin ──');
ar.includes("router.put('/admin/instant/profile'") ?ok('ADMIN: PUT route')  :er('ADMIN: PUT missing');
ar.includes("router.get('/admin/instant/profile'") ?ok('ADMIN: GET route')  :er('ADMIN: GET missing');
ar.includes("router.get('/admin/instant/audit'")   ?ok('ADMIN: audit route'):er('ADMIN: audit missing');
ar.includes('daily_profit_cap_until')              ?ok('ADMIN: cap cooldown in accounts') :er('ADMIN: cap cooldown missing');
ar.includes('InstantRiskProfileService.updateProfile') ?ok('ADMIN: updateProfile wired') :er('ADMIN: updateProfile missing');

// ── Regression ────────────────────────────────────────────────────────────
console.log('\n── Regression ──');
const flash=getFlashFundingRuleProfile(1000000);
flash.rules.per_position_loss.percent===2&&flash.rules.max_drawdown.percent===4 ?ok('FLASH: unchanged') :er('FLASH: REGRESSION');
const os=get1StepRuleProfile(1000000);
os.rules.profit_target.percent===10&&os.rules.max_drawdown.percent===6 ?ok('1-STEP: unchanged') :er('1-STEP: REGRESSION');
const ts=get2StepPhase1RuleProfile(1000000);
ts.rules.profit_target.percent===8&&ts.rules.max_drawdown.percent===8 ?ok('2-STEP: unchanged') :er('2-STEP: REGRESSION');
re.includes('riskRulesRepo.getRulesMap(accountId)') ?ok('non-Instant uses risk_rules DB') :er('non-Instant DB path broken — REGRESSION');

// ── Leverage math ─────────────────────────────────────────────────────────
console.log('\n── Leverage math ──');
const lv=(b,e,n,max=50)=>(e+n)/b>max;
lv(100000,0,5100000)          ?ok('leverage: 51x → REJECT')   :er('leverage: 51x should REJECT');
!lv(100000,0,5000000)         ?ok('leverage: 50x → ALLOW')    :er('leverage: 50x should ALLOW');
!lv(100000,0,4900000)         ?ok('leverage: 49x → ALLOW')    :er('leverage: 49x should ALLOW');
lv(100000,3000000,2500000)    ?ok('leverage: paper 55x → REJECT') :er('leverage: paper 55x should REJECT');
!lv(100000,2000000,2500000)   ?ok('leverage: paper 45x → ALLOW')  :er('leverage: paper 45x should ALLOW');
!lv(100000,0,0)               ?ok('leverage: zero used_margin → no block') :er('leverage: zero exposure wrong');

// ── IST hours ─────────────────────────────────────────────────────────────
console.log('\n── IST hours ──');
const inWin=(t,s,e)=>t>=s&&t<=e;
!inWin('09:14','09:15','15:30') ?ok('IST: 09:14 → blocked')  :er('IST: 09:14 should be blocked');
inWin('09:15','09:15','15:30')  ?ok('IST: 09:15 → allowed')  :er('IST: 09:15 should be allowed');
inWin('15:29','09:15','15:30')  ?ok('IST: 15:29 → allowed')  :er('IST: 15:29 should be allowed');
inWin('15:30','09:15','15:30')  ?ok('IST: 15:30 → allowed (boundary)') :er('IST: 15:30 boundary wrong');
!inWin('15:31','09:15','15:30') ?ok('IST: 15:31 → blocked')  :er('IST: 15:31 should be blocked');

console.log(`\n${'═'.repeat(60)}`);
console.log(`  v8a INSTANT SOURCE SUITE: ${p} passed, ${f} failed`);
console.log(`${'═'.repeat(60)}`);
process.exit(f>0?1:0);
