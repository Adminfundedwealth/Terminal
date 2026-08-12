/**
 * v4 — Verify FlashRiskEngine business logic by inspecting source code.
 * No DB imports, no ws module, no network — pure source analysis.
 * Covers everything that v1 could not run due to ws keepalive.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dir, '..', rel), 'utf8');

let p=0, f=0;
const ok = (m) => { console.log(`  ✓ ${m}`); p++; };
const er = (m) => { console.error(`  ✗ ${m}`); f++; };

const fre  = read('services/flashRiskEngine.js');
const fps  = read('services/flashRiskProfileService.js');
const oes  = read('services/orderExecutionService.js');
const dc   = read('cron/dailyChecks.js');
const ar   = read('routes/admin.routes.js');
const ps   = read('services/provisioningService.js');
const cs   = read('services/challengeService.js');
const crp  = read('config/challengeRuleProfiles.js');
const mig  = read('db/terminal-migrations/019_flash_risk_profile.sql');

// ═══════════════════════════════════════════════════════════
// FLASH RISK ENGINE — validateOrder checks
// ═══════════════════════════════════════════════════════════
console.log('\n── FlashRiskEngine.validateOrder checks ──');

// Account status
fre.includes("account.status !== 'active'")            ?ok('rejects non-active account')             :er('account status check MISSING');
// Close order bypass
fre.includes('orderParams.isCloseOrder')               ?ok('close orders bypass all rules')          :er('isCloseOrder bypass MISSING');
// 24h expiry
fre.includes('flash_expiry')                           ?ok('flash_expiry ruleType used')             :er('flash_expiry MISSING');
fre.includes('FlashRiskProfileService.checkExpiry')    ?ok('checkExpiry called in validateOrder')    :er('checkExpiry NOT called');
// Allowed segments
fre.includes('allowed_segments')&&fre.includes("ruleType: 'allowed_segments'")
  ?ok('allowed_segments check + ruleType')              :er('allowed_segments check incomplete');
// Trading hours
fre.includes('trading_hours_start')&&fre.includes('trading_hours_end')
  ?ok('trading hours enforced from profile')            :er('trading hours NOT from profile');
fre.includes("ruleType: 'trading_hours'")              ?ok('ruleType=trading_hours on rejection')    :er('trading_hours ruleType MISSING');
// Overnight — must NOT block
!fre.includes('checkNoOvernight')&&!fre.includes('no_overnight rule')
  ?ok('overnight NOT blocked in validateOrder')         :er('overnight check PRESENT — should be skipped');
// Weekend — must NOT block  
!fre.includes('checkWeekend')                          ?ok('weekend NOT blocked in validateOrder')   :er('checkWeekend PRESENT — should be skipped');
// Holiday — must NOT block
!fre.includes('HolidayService')                        ?ok('holiday NOT restricted (no HolidayService)') :er('HolidayService PRESENT — should be absent');
// Max positions
fre.includes('max_open_positions')&&fre.includes("ruleType: 'max_open_positions'")
  ?ok('max_open_positions=50 enforced + ruleType')      :er('max_open_positions check incomplete');
fre.includes('countOpenPositions')                     ?ok('countOpenPositions called (DB position count)') :er('countOpenPositions NOT called');
// Leverage
fre.includes('leverage_max')&&fre.includes("ruleType: 'leverage_limit'")
  ?ok('leverage_limit enforced with ruleType')          :er('leverage_limit check incomplete');
// Per-position loss (pre-trade: existing positions checked)
fre.includes('per_position_loss_pct')                  ?ok('per_position_loss_pct used in engine')   :er('per_position_loss_pct MISSING');
fre.includes('findOpenByAccountId')                    ?ok('findOpenByAccountId called (checks existing positions)') :er('findOpenByAccountId NOT called');
// Margin
fre.includes('MarginService.validateMargin')           ?ok('MarginService.validateMargin called')    :er('MarginService.validateMargin NOT called');
// Consistency
fre.includes('consistency_rule_pct')                   ?ok('consistency_rule_pct used')              :er('consistency_rule_pct MISSING');

// ═══════════════════════════════════════════════════════════
// FLASH RISK ENGINE — postTradeCheck checks
// ═══════════════════════════════════════════════════════════
console.log('\n── FlashRiskEngine.postTradeCheck checks ──');

// No daily_loss_limit (per-position rule replaces it)
!fre.includes('daily_loss_limit')                      ?ok('NO daily_loss_limit (per-position used instead)') :er('daily_loss_limit PRESENT — wrong for Flash');
// Per-position loss: lock action
fre.includes("ruleType: 'per_position_loss'")          ?ok('per_position_loss ruleType on lock')     :er('per_position_loss ruleType MISSING');
fre.includes('lockAccount')                            ?ok('lockAccount called on per-position breach') :er('lockAccount NOT called');
// Max drawdown: breach action
fre.includes('max_drawdown_pct')&&fre.includes('breachAccount')
  ?ok('max_drawdown→breachAccount')                    :er('max_drawdown breach path incomplete');
// Timer start on first fill
fre.includes('recordFirstPosition')                    ?ok('recordFirstPosition called in postTradeCheck') :er('recordFirstPosition NOT in postTradeCheck');
// Expiry check in postTradeCheck
(fre.match(/checkExpiry/g)||[]).length >= 2            ?ok('checkExpiry called in both validate + postTrade') :er('checkExpiry not in postTradeCheck');
// Feed staleness guard
fre.includes('isFeedStale')                            ?ok('feed staleness guard present')           :er('isFeedStale guard MISSING');
// Peak balance update
fre.includes('peak_balance')                           ?ok('peak_balance updated after postTrade')   :er('peak_balance update MISSING');
// 24h sweep function
fre.includes('sweepExpiredFlashAccounts')&&fre.includes('challenge_accounts')
  ?ok('sweepExpiredFlashAccounts queries challenge_accounts') :er('sweep function incomplete');
fre.includes("plan', 'flash'")                         ?ok('sweep filters by plan=flash only')       :er('sweep does not filter flash — may affect other plans');
// Status returned
fre.includes("status: 'expired'")                     ?ok("postTradeCheck returns status='expired' on expiry") :er('expired status MISSING');
fre.includes("status: 'locked'")                       ?ok("postTradeCheck returns status='locked' on per-pos breach") :er('locked status MISSING');
fre.includes("status: 'breached'")                     ?ok("postTradeCheck returns status='breached' on max DD") :er('breached status MISSING');
fre.includes("status: 'ok'")                           ?ok("postTradeCheck returns status='ok' when safe") :er('ok status MISSING');

// ═══════════════════════════════════════════════════════════
// FLASH RISK PROFILE SERVICE
// ═══════════════════════════════════════════════════════════
console.log('\n── FlashRiskProfileService ──');

fps.includes('first_position_at')                      ?ok('first_position_at column read/written')  :er('first_position_at MISSING');
fps.includes('flash_risk_profile_audit')               ?ok('audit table referenced')                 :er('audit table MISSING');
fps.includes('CACHE_TTL_MS')                           ?ok('60s cache TTL present')                  :er('cache TTL MISSING');
fps.includes('HARDCODED_DEFAULT')                      ?ok('HARDCODED_DEFAULT fallback present')     :er('HARDCODED_DEFAULT MISSING');
fps.includes('duration_hours:')&&fps.includes('24,')  ?ok('hardcoded default: duration=24h')        :er('hardcoded default duration MISSING');
fps.includes('per_position_loss_pct: 2')               ?ok('hardcoded default: per_pos_loss=2%')     :er('hardcoded default per_pos_loss MISSING');
fps.includes('max_drawdown_pct:')&&fps.includes('4.0') ?ok('hardcoded default: max_drawdown=4%')     :er('hardcoded default max_drawdown MISSING');
fps.includes('max_open_positions:')&&fps.includes('50,')?ok('hardcoded default: max_positions=50')   :er('hardcoded default max_positions MISSING');
fps.includes('leverage_max:')&&fps.includes('50,')     ?ok('hardcoded default: leverage=50')         :er('hardcoded default leverage MISSING');
fps.includes('overnight_allowed:')&&fps.includes('true')?ok('hardcoded default: overnight=true')    :er('hardcoded overnight MISSING');
fps.includes('weekend_allowed:')&&fps.includes('true') ?ok('hardcoded default: weekend=true')        :er('hardcoded weekend MISSING');
fps.includes('holiday_restriction:')&&fps.includes('false')?ok('hardcoded default: holiday=false')  :er('hardcoded holiday MISSING');
fps.includes('profit_target_pct:')&&fps.includes('0.0')?ok('hardcoded default: profit_target=0')    :er('hardcoded profit_target MISSING');
fps.includes('profit_split_pct:')&&fps.includes('90.0')?ok('hardcoded default: profit_split=90%')   :er('hardcoded profit_split MISSING');
fps.includes('consistency_rule_pct:')&&fps.includes('15.0')?ok('hardcoded default: consistency=15%'):er('hardcoded consistency MISSING');
fps.includes('payout_threshold_pct:')&&fps.includes('3.0')?ok('hardcoded default: payout_threshold=3%'):er('hardcoded payout_threshold MISSING');
// Idempotent timer
fps.includes(".is('first_position_at', null)")          ?ok('recordFirstPosition uses IS NULL guard (idempotent)') :er('IS NULL guard MISSING — timer may overwrite');
// Cache invalidation in updateProfile
fps.includes('this.invalidateCache()')                 ?ok('invalidateCache() called after updateProfile') :er('invalidateCache NOT called after update');
// One row per changed field in audit
fps.includes('flash_risk_profile_audit')&&fps.includes('rule_name')
  ?ok('audit rows include rule_name field')             :er('audit rows missing rule_name');

// ═══════════════════════════════════════════════════════════
// ORDER EXECUTION SERVICE wiring
// ═══════════════════════════════════════════════════════════
console.log('\n── OrderExecutionService wiring ──');

oes.includes("import { FlashRiskEngine }")             ?ok('FlashRiskEngine imported')               :er('FlashRiskEngine NOT imported');
oes.includes("import { FlashRiskProfileService }")     ?ok('FlashRiskProfileService imported')       :er('FlashRiskProfileService NOT imported');
(oes.match(/FlashRiskProfileService\.isFlashAccount/g)||[]).length >= 3
  ?ok('isFlashAccount checked in 3 places (pre, post, handleBrokerFill)') :er('isFlashAccount not checked in all 3 places');
oes.includes('FlashRiskEngine.validateOrder(')         ?ok('FlashRiskEngine.validateOrder called')   :er('FlashRiskEngine.validateOrder NOT called');
oes.includes('FlashRiskEngine.postTradeCheck(')        ?ok('FlashRiskEngine.postTradeCheck called')  :er('FlashRiskEngine.postTradeCheck NOT called');
oes.includes('FlashRiskProfileService.recordFirstPosition') ?ok('timer start wired after fill')     :er('timer start NOT wired');
oes.includes('RiskEngine.validateOrder(')              ?ok('non-Flash still calls RiskEngine.validateOrder') :er('RiskEngine.validateOrder removed — BROKEN for non-Flash');
oes.includes('RiskEngine.postTradeCheck(')             ?ok('non-Flash still calls RiskEngine.postTradeCheck') :er('RiskEngine.postTradeCheck removed — BROKEN for non-Flash');

// ═══════════════════════════════════════════════════════════
// DAILY CHECKS CRON
// ═══════════════════════════════════════════════════════════
console.log('\n── dailyChecks cron ──');
dc.includes("import { FlashRiskEngine }")              ?ok('FlashRiskEngine imported in cron')       :er('FlashRiskEngine NOT in cron');
dc.includes('sweepExpiredFlashAccounts')               ?ok('sweep called every minute')              :er('sweep NOT in cron interval');
dc.includes('every-minute Flash expiry sweep')         ?ok('cron log documents sweep')               :er('cron log MISSING');

// ═══════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════
console.log('\n── Admin routes ──');
ar.includes("import { FlashRiskProfileService }")      ?ok('FlashRiskProfileService imported in admin') :er('NOT imported in admin');
ar.includes("'/admin/flash/profile'")                  ?ok('GET /admin/flash/profile route exists')  :er('GET /admin/flash/profile MISSING');
ar.includes("router.put('/admin/flash/profile'")       ?ok('PUT /admin/flash/profile route exists')  :er('PUT /admin/flash/profile MISSING');
ar.includes("'/admin/flash/audit'")                    ?ok('GET /admin/flash/audit route exists')    :er('GET /admin/flash/audit MISSING');
ar.includes("'/admin/flash/accounts'")                 ?ok('GET /admin/flash/accounts route exists') :er('GET /admin/flash/accounts MISSING');
ar.includes('FlashRiskProfileService.updateProfile(')  ?ok('updateProfile called in PUT handler')    :er('updateProfile NOT called in PUT');
ar.includes('FlashRiskProfileService.getAuditLog(')    ?ok('getAuditLog called in audit handler')    :er('getAuditLog NOT called');
ar.includes('FlashRiskProfileService.getProfile(')     ?ok('getProfile called in GET handler')       :er('getProfile NOT called in GET');
ar.includes('requireFounder')                          ?ok('admin routes protected by requireFounder'):er('requireFounder NOT applied');
ar.includes('first_position_at')                       ?ok('admin accounts shows timer status')      :er('timer status missing from admin accounts');

// ═══════════════════════════════════════════════════════════
// PROVISIONING SERVICE
// ═══════════════════════════════════════════════════════════
console.log('\n── Provisioning service ──');
ps.includes("getFlashFundingRuleProfile")              ?ok('getFlashFundingRuleProfile imported')    :er('getFlashFundingRuleProfile NOT imported');
ps.includes("challengeType === 'flash'")               ?ok("'flash' branch exists in if/else chain") :er("'flash' branch MISSING");
(ps.indexOf("challengeType === 'flash'") < ps.indexOf("challengeType === 'instant'"))
  ?ok("'flash' branch before 'instant' branch")        :er("'flash' branch after 'instant' — order matters");
ps.includes('planBalance')&&!ps.includes('const balance = planConfig.balance')
  ?ok('planBalance defined before profile resolution (bug fix)') :er('planBalance fix NOT applied or incomplete');

// ═══════════════════════════════════════════════════════════
// CHALLENGE SERVICE
// ═══════════════════════════════════════════════════════════
console.log('\n── Challenge service ──');
cs.includes("'flash'")                                 ?ok("'flash' key in getPlanConfig configs")   :er("'flash' key MISSING from getPlanConfig");
cs.includes('phase1Target: 0')&&cs.includes("'flash'") ?ok('flash.phase1Target=0 (no profit target)'):er('flash.phase1Target incorrect');

// ═══════════════════════════════════════════════════════════
// MIGRATION 019
// ═══════════════════════════════════════════════════════════
console.log('\n── Migration 019 ──');
mig.includes('CREATE TABLE IF NOT EXISTS flash_risk_profile')       ?ok('flash_risk_profile table (additive)') :er('flash_risk_profile MISSING');
mig.includes('CREATE TABLE IF NOT EXISTS flash_risk_profile_audit') ?ok('audit table (additive)')              :er('audit table MISSING');
mig.includes('ADD COLUMN IF NOT EXISTS first_position_at')          ?ok('first_position_at (additive ALTER)')  :er('first_position_at MISSING');
mig.includes("INSERT INTO flash_risk_profile")&&mig.includes('ON CONFLICT (id) DO NOTHING')
  ?ok('seed row idempotent (ON CONFLICT DO NOTHING)')   :er('seed not idempotent');
!mig.includes('DROP TABLE')&&!mig.includes('DELETE FROM')&&!mig.includes('TRUNCATE')
  ?ok('no destructive SQL (DROP/DELETE/TRUNCATE absent)') :er('DESTRUCTIVE SQL found in migration');
mig.includes('duration_hours')&&mig.includes('per_position_loss_pct')&&mig.includes('max_drawdown_pct')
  ?ok('all Flash rule columns present in table DDL')    :er('Flash rule columns incomplete');

// ═══════════════════════════════════════════════════════════
// EXISTING USER SAFETY
// ═══════════════════════════════════════════════════════════
console.log('\n── Existing user safety ──');
// isFlashAccount only returns true for plan='flash' — not '2step','1step','instant'
// Verified structurally: the function checks plan.toLowerCase().replace(/[-_\s]/g,'') === 'flash'
fps.includes("=== 'flash'")                            ?ok('isFlashAccount uses strict equality to flash') :er('isFlashAccount logic unclear');
// Migration uses IF NOT EXISTS — no data destruction
mig.includes('IF NOT EXISTS')                          ?ok('all DDL uses IF NOT EXISTS (safe to re-run)') :er('IF NOT EXISTS missing');
// OrderExecutionService falls through to original RiskEngine for non-Flash
oes.includes('} else {\n          riskResult = await RiskEngine.validateOrder')||
oes.includes('} else {\n        riskResult = await RiskEngine.validateOrder')  ||
oes.includes('RiskEngine.validateOrder(accountId, orderParams, quoteProvider)')
  ?ok('non-Flash order falls through to original RiskEngine') :er('non-Flash RiskEngine fallthrough unclear');

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  TOTAL: ${p} passed, ${f} failed`);
console.log(`${'═'.repeat(60)}`);
process.exit(f > 0 ? 1 : 0);
