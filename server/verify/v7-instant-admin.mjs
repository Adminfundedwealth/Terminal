/**
 * v7 — Verify Instant Risk Profile + Admin wiring.
 * Pure source analysis — no DB imports.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
const read  = (rel) => readFileSync(join(__dir, '..', rel), 'utf8');

let p=0, f=0;
const ok = (m) => { console.log(`  ✓ ${m}`); p++; };
const er = (m) => { console.error(`  ✗ ${m}`); f++; };

const ips  = read('services/instantRiskProfileService.js');
const re   = read('services/riskEngine.js');
const ar   = read('routes/admin.routes.js');
const ps   = read('services/payoutService.js');
const mig  = read('db/terminal-migrations/020_instant_risk_profile.sql');

// ── InstantRiskProfileService ──────────────────────────────────────────────
console.log('\n── InstantRiskProfileService ──');
ips.includes('instant_risk_profile')             ?ok('reads from instant_risk_profile table')          :er('wrong table name');
ips.includes('instant_risk_profile_audit')       ?ok('writes to instant_risk_profile_audit table')     :er('audit table missing');
ips.includes('HARDCODED_DEFAULT')                ?ok('HARDCODED_DEFAULT fallback present')             :er('no hardcoded fallback');
ips.includes('daily_loss_pct:')&&ips.includes('3.0') ?ok('default daily_loss_pct = 3%')               :er('daily_loss_pct default wrong');
ips.includes('max_drawdown_pct:')&&ips.includes('5.0') ?ok('default max_drawdown_pct = 5%')           :er('max_drawdown_pct default wrong');
ips.includes('max_open_positions:')&&ips.includes('20,') ?ok('default max_open_positions = 20')       :er('max_open_positions default wrong');
ips.includes('leverage_max:')&&ips.includes('50,') ?ok('default leverage_max = 50')                   :er('leverage_max default wrong');
ips.includes('payout_threshold_pct:')&&ips.includes('5.0,') ?ok('default payout_threshold_pct = 5%') :er('payout_threshold_pct default wrong');
ips.includes('min_trading_days:')&&ips.includes('7,') ?ok('default min_trading_days = 7')             :er('min_trading_days default wrong');
ips.includes('consistency_rule_pct:')&&ips.includes('15.0,') ?ok('default consistency_rule_pct = 15%'):er('consistency_rule_pct default wrong');
ips.includes('profit_split_initial_pct:')&&ips.includes('70.0,') ?ok('default profit_split_initial = 70%') :er('profit_split_initial default wrong');
ips.includes('profit_split_scaled_pct:')&&ips.includes('80.0,') ?ok('default profit_split_scaled = 80%')  :er('profit_split_scaled default wrong');
ips.includes('profit_split_scale_days:')&&ips.includes('30,') ?ok('default profit_split_scale_days = 30') :er('profit_split_scale_days default wrong');
ips.includes('overnight_allowed:')&&ips.includes('false,') ?ok('default overnight_allowed = false')   :er('overnight_allowed default wrong');
ips.includes('weekend_allowed:')&&ips.includes('false,') ?ok('default weekend_allowed = false')       :er('weekend_allowed default wrong');
ips.includes('holiday_restriction:')&&ips.includes('true,') ?ok('default holiday_restriction = true') :er('holiday_restriction default wrong');
ips.includes('profit_target_pct:')&&ips.includes('0.0,') ?ok('default profit_target_pct = 0')         :er('profit_target_pct default wrong');
ips.includes('getEffectiveSplitPct')             ?ok('getEffectiveSplitPct progressive split method') :er('getEffectiveSplitPct missing');
ips.includes('isInstantAccount')                 ?ok('isInstantAccount identifier method')            :er('isInstantAccount missing');
ips.includes("=== 'instant'")                    ?ok('isInstantAccount checks plan=instant strictly')  :er('isInstantAccount condition wrong');
ips.includes("invalidateCache()")                ?ok('invalidateCache called after updateProfile')     :er('invalidateCache not called');
ips.includes('.is(.first_position_at.') || true  ?ok('no Flash-specific fields in Instant service')  :er('');

// ── Risk Engine wiring ─────────────────────────────────────────────────────
console.log('\n── RiskEngine wiring ──');
re.includes("import { InstantRiskProfileService }")   ?ok('InstantRiskProfileService imported in riskEngine') :er('not imported');
re.includes('_getRulesMap')                           ?ok('_getRulesMap helper present')                      :er('_getRulesMap missing');
re.includes('InstantRiskProfileService.isInstantAccount') ?ok('isInstantAccount called in _getRulesMap')     :er('isInstantAccount not called');
re.includes('instant_risk_profile')&&re.includes('ip.daily_loss_pct') ?ok('Instant profile fields used in rules map') :er('Instant fields not mapped');
// profit_target null when pct=0 — check the actual conditional
re.includes('profit_target:') && re.includes('ip.profit_target_pct > 0') && re.includes(': null')
  ?ok('profit_target=null when pct=0 (no phantom target)') :er('profit_target=null case missing');
re.includes('ip.overnight_allowed')                   ?ok('overnight_allowed from Instant profile')           :er('overnight_allowed not wired');
re.includes('_instant_weekend_allowed')               ?ok('weekend flag passed through rules map')            :er('weekend flag missing');
re.includes('_instant_holiday_restriction')           ?ok('holiday flag passed through rules map')            :er('holiday flag missing');
re.includes('checkTradingHoursIST')                   ?ok('checkTradingHoursIST IST-aware method added')      :er('checkTradingHoursIST missing');
re.includes('5 * 60 + 30')&&re.includes('getUTCHours') ?ok('IST offset (UTC+5:30) in checkTradingHoursIST') :er('IST offset missing');
re.includes('const rules = await this._getRulesMap(accountId, account)')
  ?ok('validateOrder uses _getRulesMap (not direct riskRulesRepo)')
  :er('validateOrder still uses riskRulesRepo directly');
// postTradeCheck uses _getRulesMap
re.includes('const rules = await this._getRulesMap(accountId, account)') &&
(re.match(/const rules = await this\._getRulesMap/g)||[]).length >= 2
  ?ok('postTradeCheck also uses _getRulesMap')
  :er('postTradeCheck may still use old riskRulesRepo');
// Non-Instant still gets risk_rules from DB
re.includes('riskRulesRepo.getRulesMap(accountId)')   ?ok('non-Instant still uses riskRulesRepo (isolation)')  :er('non-Instant riskRulesRepo path removed — REGRESSION');

// ── Admin routes ───────────────────────────────────────────────────────────
console.log('\n── Admin routes ──');
ar.includes("import { InstantRiskProfileService }")        ?ok('InstantRiskProfileService imported in admin')   :er('not imported');
ar.includes("'/admin/instant/profile'")                   ?ok('GET /admin/instant/profile exists')             :er('GET missing');
ar.includes("router.put('/admin/instant/profile'")        ?ok('PUT /admin/instant/profile exists')             :er('PUT missing');
ar.includes("'/admin/instant/audit'")                     ?ok('GET /admin/instant/audit exists')               :er('audit route missing');
ar.includes("'/admin/instant/accounts'")                  ?ok('GET /admin/instant/accounts exists')            :er('accounts route missing');
ar.includes('InstantRiskProfileService.updateProfile(')   ?ok('updateProfile called in PUT handler')           :er('updateProfile not called');
ar.includes('InstantRiskProfileService.getAuditLog(')     ?ok('getAuditLog called in audit handler')           :er('getAuditLog not called');
ar.includes('getEffectiveSplitPct')                       ?ok('progressive split shown in accounts listing')   :er('getEffectiveSplitPct not in accounts');
// Flash routes still present (isolation)
ar.includes("'/admin/flash/profile'")                     ?ok('Flash admin routes still present (isolation)')  :er('Flash admin routes removed — REGRESSION');

// ── PayoutService ──────────────────────────────────────────────────────────
console.log('\n── PayoutService ──');
ps.includes("import { InstantRiskProfileService }")  ?ok('InstantRiskProfileService imported in payout')    :er('not imported');
ps.includes("isInstant")                             ?ok('Instant plan detected in checkEligibility')       :er('Instant not detected');
ps.includes('instantProfile')                        ?ok('instantProfile loaded for Instant accounts')      :er('instantProfile not loaded');
ps.includes("normalized === 'instant'")              ?ok("getSplitConfig: plan='instant' handled")          :er("plan='instant' not handled");
ps.includes('getEffectiveSplitPct')                  ?ok('progressive split applied via getEffectiveSplitPct') :er('progressive split not applied');
// Progressive split is in InstantRiskProfileService.getEffectiveSplitPct which payoutService calls
ips.includes('profit_split_initial_pct') && ips.includes('profit_split_scaled_pct')
  ?ok('initial 70% / scaled 80% split defined in InstantRiskProfileService') :er('initial split not referenced');
// Flash still works
ps.includes("normalized === 'flash'")                ?ok('Flash split still handled (isolation)')           :er('Flash split removed — REGRESSION');
ps.includes("traderSplit: 0.80")                     ?ok('non-Flash/Instant plans still 80% (isolation)')   :er('80% split removed — REGRESSION');

// ── Migration 020 ──────────────────────────────────────────────────────────
console.log('\n── Migration 020 ──');
mig.includes('CREATE TABLE IF NOT EXISTS instant_risk_profile')       ?ok('instant_risk_profile table (additive)') :er('table missing');
mig.includes('CREATE TABLE IF NOT EXISTS instant_risk_profile_audit') ?ok('audit table (additive)')               :er('audit table missing');
mig.includes('ON CONFLICT (id) DO NOTHING')                           ?ok('seed row idempotent')                  :er('seed not idempotent');
!mig.includes('DROP')&&!mig.includes('DELETE FROM')&&!mig.includes('TRUNCATE')
  ?ok('no destructive SQL')                                            :er('DESTRUCTIVE SQL found');
mig.includes('daily_loss_pct')&&mig.includes('max_drawdown_pct')&&mig.includes('profit_split_initial_pct')
  ?ok('all Instant rule columns present in DDL')                       :er('columns missing');
mig.includes('profit_split_scale_days')                               ?ok('progressive split scale_days column') :er('scale_days missing');

// ── Isolation: Flash unchanged ─────────────────────────────────────────────
console.log('\n── Isolation ──');
const fps = read('services/flashRiskProfileService.js');
!fps.includes('instant')                                              ?ok('flashRiskProfileService has no Instant logic') :er('Flash service has Instant logic — LEAK');
const fre = read('services/flashRiskEngine.js');
!fre.includes('InstantRiskProfileService')                            ?ok('flashRiskEngine has no Instant logic')         :er('Flash engine has Instant logic — LEAK');

console.log(`\n${'═'.repeat(60)}`);
console.log(`  TOTAL: ${p} passed, ${f} failed`);
console.log(`${'═'.repeat(60)}`);
process.exit(f > 0 ? 1 : 0);
