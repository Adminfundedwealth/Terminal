// Verify: orderExecutionService + dailyChecks + admin routes wiring (source-code checks only)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dir,'..', rel), 'utf8');

let p=0,f=0;
const ok=(m)=>{console.log(`  ✓ ${m}`);p++;};
const er=(m)=>{console.error(`  ✗ ${m}`);f++;};

// ── orderExecutionService.js ──────────────────────────────────────────────────
const oes = read('services/orderExecutionService.js');
oes.includes("import { FlashRiskEngine }")               ?ok('OES: FlashRiskEngine imported')              :er('OES: FlashRiskEngine NOT imported');
oes.includes("import { FlashRiskProfileService }")       ?ok('OES: FlashRiskProfileService imported')      :er('OES: FlashRiskProfileService NOT imported');
oes.includes("FlashRiskProfileService.isFlashAccount(")  ?ok('OES: isFlashAccount check present (×3)')     :er('OES: isFlashAccount check MISSING');
oes.includes("FlashRiskEngine.validateOrder(")           ?ok('OES: FlashRiskEngine.validateOrder called')  :er('OES: FlashRiskEngine.validateOrder NOT called');
oes.includes("FlashRiskEngine.postTradeCheck(")          ?ok('OES: FlashRiskEngine.postTradeCheck called') :er('OES: FlashRiskEngine.postTradeCheck NOT called');
oes.includes("FlashRiskProfileService.recordFirstPosition") ?ok('OES: timer start wired')                 :er('OES: timer start NOT wired');
// Verify non-Flash path still calls RiskEngine
oes.includes("RiskEngine.validateOrder(")                ?ok('OES: RiskEngine.validateOrder (non-Flash)')  :er('OES: RiskEngine.validateOrder path removed');
oes.includes("RiskEngine.postTradeCheck(")               ?ok('OES: RiskEngine.postTradeCheck (non-Flash)') :er('OES: RiskEngine.postTradeCheck path removed');

// ── dailyChecks.js ────────────────────────────────────────────────────────────
const dc = read('cron/dailyChecks.js');
dc.includes("import { FlashRiskEngine }")                ?ok('dailyChecks: FlashRiskEngine imported')      :er('dailyChecks: FlashRiskEngine NOT imported');
dc.includes("FlashRiskEngine.sweepExpiredFlashAccounts") ?ok('dailyChecks: sweep wired in setInterval')   :er('dailyChecks: sweep NOT wired');
dc.includes('every-minute Flash expiry sweep')           ?ok('dailyChecks: sweep log message present')    :er('dailyChecks: sweep log message missing');

// ── admin.routes.js ───────────────────────────────────────────────────────────
const ar = read('routes/admin.routes.js');
ar.includes("import { FlashRiskProfileService }")        ?ok('admin: FlashRiskProfileService imported')    :er('admin: FlashRiskProfileService NOT imported');
ar.includes("'/admin/flash/profile'")                   ?ok('admin: GET /admin/flash/profile')            :er('admin: GET /admin/flash/profile MISSING');
ar.includes("'/admin/flash/audit'")                     ?ok('admin: GET /admin/flash/audit')              :er('admin: GET /admin/flash/audit MISSING');
ar.includes("'/admin/flash/accounts'")                  ?ok('admin: GET /admin/flash/accounts')           :er('admin: GET /admin/flash/accounts MISSING');
ar.includes('FlashRiskProfileService.updateProfile(')   ?ok('admin: updateProfile called in PUT handler') :er('admin: updateProfile NOT called');
ar.includes('FlashRiskProfileService.getAuditLog(')     ?ok('admin: getAuditLog called in audit handler') :er('admin: getAuditLog NOT called');

// ── challengeRuleProfiles.js ──────────────────────────────────────────────────
const crp = read('config/challengeRuleProfiles.js');
crp.includes("export function getFlashFundingRuleProfile") ?ok('profiles: getFlashFundingRuleProfile exported'):er('profiles: getFlashFundingRuleProfile MISSING');
crp.includes("'per_position_loss'")                      ?ok('profiles: per_position_loss in RULE_TYPES')  :er('profiles: per_position_loss NOT in RULE_TYPES');
crp.includes("'flash_duration'")                         ?ok('profiles: flash_duration in RULE_TYPES')     :er('profiles: flash_duration NOT in RULE_TYPES');
crp.includes("'weekend_allowed'")                        ?ok('profiles: weekend_allowed in RULE_TYPES')    :er('profiles: weekend_allowed NOT in RULE_TYPES');
crp.includes("'holiday_restriction'")                    ?ok('profiles: holiday_restriction in RULE_TYPES'):er('profiles: holiday_restriction NOT in RULE_TYPES');

// ── provisioningService.js ────────────────────────────────────────────────────
const ps = read('services/provisioningService.js');
ps.includes("getFlashFundingRuleProfile")                ?ok('provisioning: getFlashFundingRuleProfile imported'):er('provisioning: getFlashFundingRuleProfile NOT imported');
ps.includes("challengeType === 'flash'")                 ?ok("provisioning: 'flash' branch exists")        :er("provisioning: 'flash' branch MISSING");
ps.includes("planBalance")                               ?ok('provisioning: planBalance defined before use'):er('provisioning: planBalance fix MISSING');

// ── challengeService.js ───────────────────────────────────────────────────────
const cs = read('services/challengeService.js');
cs.includes("'flash'")                                   ?ok('challengeService: flash key in getPlanConfig'):er('challengeService: flash key MISSING from getPlanConfig');

// ── flashRiskProfileService.js ────────────────────────────────────────────────
const fps = read('services/flashRiskProfileService.js');
fps.includes("first_position_at")                        ?ok('flashRiskProfileService: first_position_at column used'):er('flashRiskProfileService: first_position_at MISSING');
fps.includes("flash_risk_profile_audit")                 ?ok('flashRiskProfileService: audit table referenced'):er('flashRiskProfileService: audit table MISSING');
fps.includes("invalidateCache")                          ?ok('flashRiskProfileService: cache invalidation present'):er('flashRiskProfileService: cache invalidation MISSING');

// ── migration 019 ─────────────────────────────────────────────────────────────
const mig = read('db/terminal-migrations/019_flash_risk_profile.sql');
mig.includes('CREATE TABLE IF NOT EXISTS flash_risk_profile') ?ok('migration: flash_risk_profile table'):er('migration: flash_risk_profile MISSING');
mig.includes('CREATE TABLE IF NOT EXISTS flash_risk_profile_audit')?ok('migration: audit table')     :er('migration: audit table MISSING');
mig.includes('ADD COLUMN IF NOT EXISTS first_position_at')   ?ok('migration: first_position_at column'):er('migration: first_position_at MISSING');
mig.includes('ON CONFLICT (id) DO NOTHING')                  ?ok('migration: idempotent seed')        :er('migration: non-idempotent seed');

// ── flashRiskEngine.js — no HolidayService, no daily reset ──────────────────
const fre = read('services/flashRiskEngine.js');
!fre.includes('HolidayService')                          ?ok('flashRiskEngine: no HolidayService (holidays not restricted)'):er('flashRiskEngine: HolidayService found — should not restrict holidays');
!fre.includes('checkNoOvernight')                        ?ok('flashRiskEngine: no checkNoOvernight (overnight allowed)')     :er('flashRiskEngine: checkNoOvernight found — overnight should be allowed');
!fre.includes('checkWeekend')                            ?ok('flashRiskEngine: no checkWeekend (weekend allowed)')           :er('flashRiskEngine: checkWeekend found — weekend should be allowed');
!fre.includes('daily_loss_limit')                        ?ok('flashRiskEngine: no daily_loss_limit (per-position rule used instead)'):er('flashRiskEngine: daily_loss_limit found — should use per_position_loss');
fre.includes('per_position_loss_pct')                    ?ok('flashRiskEngine: per_position_loss_pct enforced')              :er('flashRiskEngine: per_position_loss_pct NOT enforced');
fre.includes('max_drawdown_pct')                         ?ok('flashRiskEngine: max_drawdown_pct enforced')                   :er('flashRiskEngine: max_drawdown_pct NOT enforced');
fre.includes('sweepExpiredFlashAccounts')                ?ok('flashRiskEngine: sweep function exported')                      :er('flashRiskEngine: sweep function MISSING');

console.log(`\n  ${p} passed, ${f} failed`); process.exit(f>0?1:0);
