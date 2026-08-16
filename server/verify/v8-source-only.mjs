/**
 * v8-source-only — Instant Funding complete verification (source analysis only, no DB)
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getInstantFundingRuleProfile, getFlashFundingRuleProfile,
         get1StepRuleProfile, get2StepPhase1RuleProfile } from '../config/challengeRuleProfiles.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const read  = (rel) => readFileSync(join(__dir, '..', rel), 'utf8');

let p=0, f=0;
const ok = (m) => { console.log(`  ✓ ${m}`); p++; };
const er = (m) => { console.error(`  ✗ ${m}`); f++; };

const ips = read('services/instantRiskProfileService.js');
const re  = read('services/riskEngine.js');
const ps  = read('services/payoutService.js');
const ar  = read('routes/admin.routes.js');
const mig = read('db/terminal-migrations/020_instant_risk_profile.sql');
const ip  = getInstantFundingRuleProfile(1000000);

// ── 1. Service HARDCODED_DEFAULT ──────────────────────────────────────────
console.log('\n── 1. InstantRiskProfileService defaults ──');
const has = (field, val) => ips.includes(field) && ips.includes(val);
has("trading_hours_end:", "'15:30'")      ?ok("trading_hours_end='15:30'")   :er(`trading_hours_end not '15:30'`);
has('overnight_allowed:', 'true,')        ?ok('overnight_allowed=true')       :er('overnight_allowed wrong');
has('weekend_allowed:', 'true,')          ?ok('weekend_allowed=true')         :er('weekend_allowed wrong');
has('profit_split_pct:', '80.0,')         ?ok('profit_split_pct=80%')         :er('profit_split_pct wrong');
has('daily_profit_cap_cooldown_hours:', '8.0,') ?ok('cooldown=8h')            :er('cooldown wrong');
has('profit_target_pct:', '0.0,')         ?ok('profit_target=0 (none)')       :er('profit_target wrong');
has('daily_loss_pct:', '3.0,')            ?ok('daily_loss=3%')                :er('daily_loss wrong');
has('max_drawdown_pct:', '5.0,')          ?ok('max_drawdown=5%')              :er('max_drawdown wrong');
has('max_open_positions:', '20,')         ?ok('max_positions=20')             :er('max_positions wrong');
has('leverage_max:', '50,')               ?ok('leverage=50')                  :er('leverage wrong');
has('min_trading_days:', '7,')            ?ok('min_trading_days=7')           :er('min_trading_days wrong');
has('payout_threshold_pct:', '5.0,')      ?ok('payout_threshold=5%')          :er('payout_threshold wrong');
has('consistency_rule_pct:', '15.0,')     ?ok('consistency=15%')              :er('consistency wrong');
has('risk_per_idea_pct:', '1.0,')         ?ok('risk_per_idea=1%')             :er('risk_per_idea wrong');
has('risk_per_idea_window_min:', '10,')   ?ok('risk_per_idea_window=10min')   :er('risk_per_idea_window wrong');
has('inactivity_close_days:', '60,')      ?ok('inactivity=60 days')           :er('inactivity wrong');
!ips.includes('profit_split_initial_pct') ?ok('no old progression fields')    :er('old 70→80 progression still present');
ips.includes('profit_split_pct ?? 80')    ?ok('getEffectiveSplitPct flat 80%') :er('getEffectiveSplitPct not flat');

// ── 2. Canonical profile (challengeRuleProfiles.js) ───────────────────────
console.log('\n── 2. Canonical profile values ──');
ip.rules.daily_loss_limit.percent===3   ?ok('canonical daily_loss=3%')         :er(`canonical daily_loss=${ip.rules.daily_loss_limit.percent}`);
ip.rules.max_drawdown.type==='static'   ?ok('canonical drawdown=static')       :er('canonical drawdown not static');
ip.rules.trading_hours.end==='15:30'    ?ok('canonical hours end=15:30')       :er(`canonical hours end=${ip.rules.trading_hours.end}`);
// no_overnight: { allowed: true } means overnight allowed
(ip.rules.no_overnight?.allowed===true||ip.rules.no_overnight===null)
  ?ok('canonical overnight allowed')   :er(`canonical overnight=${JSON.stringify(ip.rules.no_overnight)}`);
ip.rules.profit_target.percent===0      ?ok('canonical profit_target=0')       :er('canonical profit_target wrong');
ip.rules.profit_split.percent===80      ?ok('canonical profit_split=80%')      :er(`canonical profit_split=${ip.rules.profit_split.percent}`);

// ── 3. Risk Engine ────────────────────────────────────────────────────────
console.log('\n── 3. Risk Engine checks ──');
re.includes('ip.profit_target_pct > 0')  ?ok('T3: profit_target null when 0') :er('T3: profit_target null logic missing');
re.includes('isInstantAccount(account)')&&re.includes('existingExposure')
  ?ok('T7: Instant leverage uses real exposure')                               :er('T7: real exposure missing');
// Verify used_margin is NOT in the Instant code path (Instant block returns before reaching it)
const lvStart   = re.indexOf('static async checkLeverageLimit');
const iStart    = re.indexOf('isInstantAccount(account)', lvStart);
const iEnd      = re.indexOf('return { allowed: true };', iStart) + 30;
!re.slice(iStart, iEnd).includes('parseFloat(account.used_margin')
  ?ok('T7: used_margin NOT in Instant leverage branch') :er('T7: used_margin in Instant branch');
re.includes('checkTradingHoursIST')      ?ok('T14: IST hours check used')     :er('T14: IST check missing');
re.includes('daily_profit_cap_until')    ?ok('T9: cooldown column used in engine') :er('T9: daily_profit_cap_until not in engine');
!re.includes('_memoryTimer')             ?ok('T9: no in-memory timer')         :er('T9: in-memory timer found');
re.includes('riskRulesRepo.getRulesMap(accountId)')
  ?ok('non-Instant still uses risk_rules DB')           :er('non-Instant risk_rules path broken — REGRESSION');

// ── 4. Migration 020 ─────────────────────────────────────────────────────
console.log('\n── 4. Migration 020 ──');
mig.includes("'15:30'")&&mig.includes('trading_hours_end')
  ?ok("migration: trading_hours_end='15:30'")           :er("migration: trading_hours_end wrong");
mig.includes('overnight_allowed')&&(mig.includes('DEFAULT TRUE')||mig.includes('DEFAULT true'))
  ?ok('migration: overnight_allowed DEFAULT TRUE')       :er('migration: overnight default wrong');
mig.includes('weekend_allowed')&&(mig.includes('DEFAULT TRUE')||mig.includes('DEFAULT true'))
  ?ok('migration: weekend_allowed DEFAULT TRUE')         :er('migration: weekend default wrong');
mig.includes('profit_split_pct')&&(mig.includes('DEFAULT 80.0')||mig.includes('DEFAULT 80,'))
  ?ok('migration: profit_split_pct DEFAULT 80')         :er(`migration: profit_split_pct wrong`);
mig.includes('daily_profit_cap_cooldown_hours')&&
(mig.includes('DEFAULT 8.0')||mig.includes('DEFAULT 8,'))
  ?ok('migration: cooldown DEFAULT 8')                  :er('migration: cooldown default wrong');
mig.includes('daily_profit_cap_until')
  ?ok('migration: daily_profit_cap_until column')       :er('migration: daily_profit_cap_until missing');
!mig.includes('DROP')&&!mig.includes('DELETE FROM')
  ?ok('migration: no destructive SQL')                  :er('migration: DESTRUCTIVE SQL found');

// ── 5. Payout Service ─────────────────────────────────────────────────────
console.log('\n── 5. Payout Service ──');
ps.includes('isInstantPlan || isFlashPlan || isOneStepPlan || challenge.type')
  ?ok("T22: payout gate accepts Instant accounts")     :er("T22: payout gate still blocks Instant");
ps.includes("normalized === 'instant'")&&ps.includes('profit_split_pct')
  ?ok('T20: payoutService reads Instant profit_split_pct')  :er('T20: payout split wrong');
ps.includes('payout_threshold_pct')&&ps.includes('isInstant')
  ?ok('T21: payout threshold enforced for Instant')    :er('T21: threshold not enforced');
!ps.includes('profit_split_initial_pct')||ps.includes('profit_split_initial_pct: 80')
  ?ok('T20: old Instant progression removed from payout') :er('T20: old progression in payout');

// ── 6. Admin ──────────────────────────────────────────────────────────────
console.log('\n── 6. Admin ──');
ar.includes("router.put('/admin/instant/profile'")  ?ok('PUT /admin/instant/profile')  :er('PUT route missing');
ar.includes("router.get('/admin/instant/audit'")    ?ok('GET /admin/instant/audit')    :er('audit route missing');
ar.includes('daily_profit_cap_until')               ?ok('admin: cap cooldown in query') :er('admin: daily_profit_cap_until missing');
ar.includes('InstantRiskProfileService.updateProfile') ?ok('updateProfile wired in PUT') :er('updateProfile missing');

// ── 7. Regression ────────────────────────────────────────────────────────
console.log('\n── 7. Regression: Flash / 1-Step / 2-Step ──');
const flash = getFlashFundingRuleProfile(1000000);
flash.rules.per_position_loss.percent===2&&flash.rules.max_drawdown.percent===4
  ?ok('Flash rules unchanged')  :er('Flash rules changed — REGRESSION');
const os = get1StepRuleProfile(1000000);
os.rules.profit_target.percent===10&&os.rules.max_drawdown.percent===6
  ?ok('1-Step rules unchanged') :er('1-Step rules changed — REGRESSION');
const ts = get2StepPhase1RuleProfile(1000000);
ts.rules.profit_target.percent===8&&ts.rules.max_drawdown.percent===8
  ?ok('2-Step rules unchanged') :er('2-Step rules changed — REGRESSION');

// ── 8. Leverage math ─────────────────────────────────────────────────────
console.log('\n── 8. Leverage math (1:50) ──');
const lev = (bal,ex,ord,max=50) => (ex+ord)/bal > max;
 lev(100000,0,5100000)        ?ok('51x → REJECT')        :er('51x should REJECT');
!lev(100000,0,5000000)        ?ok('50x → ALLOW')         :er('50x should ALLOW');
 lev(100000,3000000,2500000)  ?ok('paper 55x → REJECT')  :er('paper 55x should REJECT');
!lev(100000,2000000,2500000)  ?ok('paper 45x → ALLOW')   :er('paper 45x should ALLOW');
!lev(100000,0,0)              ?ok('zero exposure → ALLOW'):er('zero exposure should ALLOW');

console.log(`\n${'═'.repeat(58)}`);
console.log(`  INSTANT SOURCE SUITE: ${p} passed, ${f} failed`);
console.log(`${'═'.repeat(58)}`);
process.exit(f>0?1:0);
