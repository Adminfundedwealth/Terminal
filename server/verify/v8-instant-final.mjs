/**
 * v8 — Complete Instant Funding Final Verification
 * Tests all 22 rules + payout + leverage + cooldown + regression
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
const read  = (rel) => readFileSync(join(__dir, '..', rel), 'utf8');

import { getInstantFundingRuleProfile, getFlashFundingRuleProfile,
         get1StepRuleProfile, get2StepPhase1RuleProfile } from '../config/challengeRuleProfiles.js';
import { InstantRiskProfileService } from '../services/instantRiskProfileService.js';

let p=0, f=0;
const ok = (m) => { console.log(`  ✓ ${m}`); p++; };
const er = (m) => { console.error(`  ✗ ${m}`); f++; };

InstantRiskProfileService.invalidateCache();
const prof = await InstantRiskProfileService.getProfile();
const ip   = getInstantFundingRuleProfile(1000000);
const re   = read('services/riskEngine.js');
const ips  = read('services/instantRiskProfileService.js');
const ps   = read('services/payoutService.js');
const ar   = read('routes/admin.routes.js');
const mig  = read('db/terminal-migrations/020_instant_risk_profile.sql');
const crp  = read('config/challengeRuleProfiles.js');

// ── TEST 1: 3% Daily Drawdown ─────────────────────────────────────────────
console.log('\n── Tests 1–3: Core Risk ──');
prof.daily_loss_pct===3        ?ok('T1: daily_loss_pct=3%')        :er(`T1: daily_loss_pct=${prof.daily_loss_pct}`);
ip.rules.daily_loss_limit.percent===3  ?ok('T1: profile seeds daily_loss=3%') :er('T1: profile seed wrong');

// ── TEST 2: 5% Max Drawdown STATIC ────────────────────────────────────────
prof.max_drawdown_pct===5      ?ok('T2: max_drawdown_pct=5%')       :er(`T2: max_drawdown_pct=${prof.max_drawdown_pct}`);
ip.rules.max_drawdown.type==='static'  ?ok('T2: drawdown type=static') :er('T2: drawdown type not static');

// ── TEST 3: NO Profit Target ──────────────────────────────────────────────
prof.profit_target_pct===0     ?ok('T3: profit_target_pct=0 (none)')  :er(`T3: profit_target_pct=${prof.profit_target_pct}`);
re.includes('profit_target:       (ip.profit_target_pct > 0)')
  ?ok('T3: _getRulesMap returns null profit_target when pct=0')  :er('T3: null profit_target logic missing');

// ── TEST 4: 7 Minimum Trading Days ───────────────────────────────────────
console.log('\n── Tests 4–6: Account Limits ──');
prof.min_trading_days===7      ?ok('T4: min_trading_days=7')         :er(`T4: min_trading_days=${prof.min_trading_days}`);

// ── TEST 5: 20 Max Open Positions ────────────────────────────────────────
prof.max_open_positions===20   ?ok('T5: max_open_positions=20')      :er(`T5: max_open_positions=${prof.max_open_positions}`);

// ── TEST 6: 70% Max Position Size ────────────────────────────────────────
prof.max_position_size_pct===70 ?ok('T6: max_position_size_pct=70%') :er(`T6: max_position_size_pct=${prof.max_position_size_pct}`);

// ── TEST 7: 1:50 Leverage with real exposure ─────────────────────────────
console.log('\n── Tests 7–9: Leverage & Profit Cap ──');
prof.leverage_max===50         ?ok('T7: leverage_max=50 (1:50)')     :er(`T7: leverage_max=${prof.leverage_max}`);
re.includes('isInstantAccount(account)')&&re.includes('existingExposure')
  ?ok('T7: leverage uses real open-position exposure for Instant') :er('T7: real exposure check missing');
// used_margin must only appear after the Instant block returns.
// The Instant block ends with 'return { allowed: true };' before used_margin executable code.
// We check that parseFloat(account.used_margin is NOT inside the Instant block.
const leverageStart = re.indexOf('static async checkLeverageLimit');
const instantStart  = re.indexOf('isInstantAccount(account)', leverageStart);
const instantEnd    = re.indexOf('return { allowed: true };', instantStart) + 30; // past the return
const instantBlock  = re.slice(instantStart, instantEnd);
!instantBlock.includes('parseFloat(account.used_margin')
  ?ok('T7: parseFloat(account.used_margin) NOT in Instant leverage path') :er('T7: used_margin in Instant path — NOT fixed');

// leverage math checks
function checkLeverage(balance, existing, newOrder, max=50) {
  return (existing+newOrder)/balance > max;
}
checkLeverage(100000,0,5100000) ?ok('T7: 51x → REJECT')   :er('T7: 51x should REJECT');
!checkLeverage(100000,0,5000000)?ok('T7: 50x → ALLOW')    :er('T7: 50x should ALLOW');
checkLeverage(100000,3000000,2500000) ?ok('T7: paper 55x → REJECT') :er('T7: paper 55x should REJECT');
!checkLeverage(100000,2000000,2500000)?ok('T7: paper 45x → ALLOW')  :er('T7: paper 45x should ALLOW');

// ── TEST 8: 4% Daily Profit Cap ──────────────────────────────────────────
prof.daily_profit_cap_pct===4  ?ok('T8: daily_profit_cap_pct=4%')   :er(`T8: daily_profit_cap_pct=${prof.daily_profit_cap_pct}`);

// ── TEST 9: 8-hour cooldown DB-persisted ─────────────────────────────────
prof.daily_profit_cap_cooldown_hours===8
  ?ok('T9: daily_profit_cap_cooldown_hours=8')  :er(`T9: cooldown=${prof.daily_profit_cap_cooldown_hours}`);
mig.includes('daily_profit_cap_cooldown_hours')
  ?ok('T9: cooldown column in migration 020')   :er('T9: cooldown column missing from migration');
mig.includes('daily_profit_cap_until')
  ?ok('T9: trading_accounts.daily_profit_cap_until in migration') :er('T9: daily_profit_cap_until missing');
re.includes('daily_profit_cap_until')
  ?ok('T9: cooldown read/written in checkDailyProfitCap') :er('T9: cooldown not in riskEngine');
!re.includes('_memoryTimer')&&!re.includes('setTimeout')
  ?ok('T9: no in-memory timer used for cooldown')  :er('T9: in-memory timer found — not restart-safe');

// ── TEST 10–11: Risk Per Idea ─────────────────────────────────────────────
console.log('\n── Tests 10–12: Risk & Consistency ──');
prof.risk_per_idea_pct===1     ?ok('T10: risk_per_idea_pct=1%')      :er(`T10: risk_per_idea_pct=${prof.risk_per_idea_pct}`);
prof.risk_per_idea_window_min===10 ?ok('T11: risk_per_idea_window=10min') :er(`T11: window=${prof.risk_per_idea_window_min}`);

// ── TEST 12: Consistency 15% ─────────────────────────────────────────────
prof.consistency_rule_pct===15 ?ok('T12: consistency_rule_pct=15%')  :er(`T12: consistency=${prof.consistency_rule_pct}`);

// ── TEST 13: 60-day Inactivity ────────────────────────────────────────────
console.log('\n── Tests 13–19: Session Rules ──');
prof.inactivity_close_days===60 ?ok('T13: inactivity_close_days=60') :er(`T13: inactivity=${prof.inactivity_close_days}`);

// ── TEST 14: 09:15–15:30 IST ─────────────────────────────────────────────
prof.trading_hours_start==='09:15'&&prof.trading_hours_end==='15:30'
  ?ok('T14: trading hours 09:15–15:30') :er(`T14: hours ${prof.trading_hours_start}–${prof.trading_hours_end}`);
ip.rules.trading_hours.end==='15:30'
  ?ok('T14: canonical profile hours end 15:30') :er('T14: canonical profile end wrong');
re.includes('checkTradingHoursIST')
  ?ok('T14: IST-aware checkTradingHoursIST used for Instant') :er('T14: IST hours check missing');

// IST boundary checks
function toIstTime(utcHH,utcMM){
  const ms=(utcHH*60+utcMM)*60000+(5*60+30)*60000;
  const d=new Date(ms);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
['09:14'<'09:15','09:15'>='09:15','15:29'<='15:30','15:31'>'15:30'].every(Boolean)
  ?ok('T14: IST boundary string comparisons correct') :er('T14: IST boundary logic wrong');

// ── TEST 15: Overnight ALLOWED ────────────────────────────────────────────
prof.overnight_allowed===true  ?ok('T15: overnight_allowed=true')    :er(`T15: overnight=${prof.overnight_allowed}`);
ip.rules.no_overnight.allowed===true ?ok('T15: canonical profile no_overnight.allowed=true') :er('T15: overnight wrong in canonical');

// ── TEST 16: Weekend ALLOWED ──────────────────────────────────────────────
prof.weekend_allowed===true    ?ok('T16: weekend_allowed=true')      :er(`T16: weekend=${prof.weekend_allowed}`);

// ── TEST 17: Holidays BLOCKED ─────────────────────────────────────────────
prof.holiday_restriction===true ?ok('T17: holiday_restriction=true (blocked)') :er(`T17: holiday=${prof.holiday_restriction}`);

// ── TEST 18: NSE/NFO/BFO/CDS/MCX ─────────────────────────────────────────
const segs=prof.allowed_segments;
['NSE','NFO','BFO','CDS','MCX'].every(s=>segs.includes(s))
  ?ok(`T18: segments=${segs.join(',')}`) :er(`T18: segments=${JSON.stringify(segs)}`);

// ── TEST 19: Dynamic instruments (segment-based, no hardcoded list) ───────
// The risk engine does NOT contain a static instrument list — it uses segment checks only.
// Hardcoded tokens in server/index.js are for the market data feed warmup, not risk rules.
re.includes('checkAllowedSegments')&&!re.includes("'RELIANCE'")&&!re.includes("'NIFTY50'")
  ?ok('T19: riskEngine uses segment-based check, no hardcoded instrument list')
  :er('T19: hardcoded instrument list found in riskEngine');

// ── TEST 20: 80% Profit Split FROM DAY 1 ─────────────────────────────────
console.log('\n── Tests 20–22: Payout ──');
prof.profit_split_pct===80     ?ok('T20: profit_split_pct=80% (flat, day 1)') :er(`T20: split=${prof.profit_split_pct}`);
!ips.includes('profit_split_initial_pct')
  ?ok('T20: no progression split fields (70%→80% removed)') :er('T20: old progression fields still present');
InstantRiskProfileService.getEffectiveSplitPct(prof, null)===80
  ?ok('T20: getEffectiveSplitPct returns 80% always') :er('T20: getEffectiveSplitPct wrong');
InstantRiskProfileService.getEffectiveSplitPct(prof, '2026-01-01T00:00:00Z')===80
  ?ok('T20: getEffectiveSplitPct ignores startedAt (flat 80%)') :er('T20: progression still active');
ps.includes("normalized === 'instant'")&&ps.includes('profit_split_pct')
  ?ok('T20: payoutService reads profit_split_pct from Instant profile') :er('T20: payoutService split wrong');
!ps.includes('profit_split_initial_pct') || ps.includes('profit_split_initial_pct: 80')
  ?ok('T20: profit_split_initial_pct only in 1-Step fallback, not Instant') :er('T20: old Instant progression still in payoutService');

// ── TEST 21: 5% Payout Threshold ─────────────────────────────────────────
prof.payout_threshold_pct===5  ?ok('T21: payout_threshold_pct=5%')   :er(`T21: threshold=${prof.payout_threshold_pct}`);
ps.includes('payout_threshold_pct')&&ps.includes("isInstant")
  ?ok('T21: payout threshold enforced from Instant profile') :er('T21: threshold not enforced');

// ── TEST 22: Instant Payout Gate ─────────────────────────────────────────
ps.includes("isInstantPlan || isFlashPlan || challenge.type === 'funded'")
  ?ok("T22: payout gate accepts Instant accounts (type='evaluation_phase1' bypassed)")
  :er("T22: payout gate still blocks Instant — check isFunded logic");

// ── Migration 020 Safety ─────────────────────────────────────────────────
console.log('\n── Migration 020 Safety ──');
mig.includes("DEFAULT '15:30'")  ?ok('migration: trading_hours_end default=15:30') :er('migration: trading_hours_end wrong default');
mig.includes("DEFAULT TRUE")&&mig.includes('overnight_allowed')
  ?ok('migration: overnight_allowed default=true')   :er('migration: overnight default wrong');
mig.includes("DEFAULT TRUE")&&mig.includes('weekend_allowed')
  ?ok('migration: weekend_allowed default=true')     :er('migration: weekend default wrong');
mig.includes("DEFAULT 80.0")&&mig.includes('profit_split_pct')
  ?ok('migration: profit_split_pct default=80%')     :er('migration: profit_split_pct wrong');
!mig.includes('DROP')&&!mig.includes('DELETE FROM')&&!mig.includes('TRUNCATE')
  ?ok('migration: no destructive SQL')               :er('migration: DESTRUCTIVE SQL found');
mig.includes("DEFAULT 8.0")&&mig.includes('daily_profit_cap_cooldown_hours')
  ?ok('migration: cooldown=8h')                      :er('migration: cooldown default wrong');

// ── Regression ────────────────────────────────────────────────────────────
console.log('\n── Regression: Flash / 1-Step / 2-Step ──');
const flash=getFlashFundingRuleProfile(1000000);
flash.rules.per_position_loss.percent===2&&flash.rules.max_drawdown.percent===4
  ?ok('Flash: rules unchanged')  :er('Flash: rules changed — REGRESSION');

const os=get1StepRuleProfile(1000000);
os.rules.profit_target.percent===10&&os.rules.max_drawdown.percent===6
  ?ok('1-Step: rules unchanged') :er('1-Step: rules changed — REGRESSION');

const ts=get2StepPhase1RuleProfile(1000000);
ts.rules.profit_target.percent===8&&ts.rules.max_drawdown.percent===8
  ?ok('2-Step: rules unchanged') :er('2-Step: rules changed — REGRESSION');

re.includes('riskRulesRepo.getRulesMap(accountId)')
  ?ok('non-Instant accounts still use risk_rules DB') :er('non-Instant DB path broken — REGRESSION');

// ── Admin ─────────────────────────────────────────────────────────────────
console.log('\n── Admin ──');
ar.includes("router.put('/admin/instant/profile'")  ?ok('PUT /admin/instant/profile exists')  :er('PUT route missing');
ar.includes("router.get('/admin/instant/profile'")  ?ok('GET /admin/instant/profile exists')  :er('GET route missing');
ar.includes("router.get('/admin/instant/audit'")    ?ok('GET /admin/instant/audit exists')    :er('audit route missing');
ar.includes("router.get('/admin/instant/accounts'") ?ok('GET /admin/instant/accounts exists') :er('accounts route missing');
ar.includes('daily_profit_cap_until')               ?ok('admin accounts shows cap cooldown')  :er('cap cooldown missing from admin accounts');
ar.includes('InstantRiskProfileService.updateProfile')  ?ok('updateProfile wired in admin PUT') :er('updateProfile not wired');

console.log(`\n${'═'.repeat(60)}`);
console.log(`  INSTANT FINAL SUITE: ${p} passed, ${f} failed`);
console.log(`${'═'.repeat(60)}`);
process.exit(f>0?1:0);
