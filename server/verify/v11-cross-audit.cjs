const fs=require('fs');
const re=fs.readFileSync('services/riskEngine.js','utf8');
const ps=fs.readFileSync('services/payoutService.js','utf8');
const ar=fs.readFileSync('routes/admin.routes.js','utf8');
const fre=fs.readFileSync('services/flashRiskEngine.js','utf8');
const fps=fs.readFileSync('services/flashRiskProfileService.js','utf8');
const ips=fs.readFileSync('services/instantRiskProfileService.js','utf8');
const tsp=fs.readFileSync('services/twoStepRiskProfileService.js','utf8');
const oes=fs.readFileSync('services/orderExecutionService.js','utf8');
const dc=fs.readFileSync('cron/dailyChecks.js','utf8');
let p=0,f=0;
const ok=m=>{p++;};const er=m=>{console.error('X '+m);f++;};
// FLASH
fps.includes('flash_risk_profile')?ok():er('Flash:DB');
fps.includes('per_position_loss_pct')?ok():er('Flash:per_pos');
fps.includes('duration_hours')?ok():er('Flash:duration');
fre.includes('FlashRiskProfileService.getProfile()')?ok():er('Flash:engine');
fre.includes('sweepExpiredFlashAccounts')?ok():er('Flash:sweep');
oes.includes('FlashRiskEngine.validateOrder')?ok():er('Flash:route');
ar.includes('/admin/flash/profile')?ok():er('Flash:admin');
ar.includes('FlashRiskProfileService.updateProfile')?ok():er('Flash:admin_update');
// INSTANT
ips.includes('instant_risk_profile')?ok():er('Instant:DB');
ips.includes("'15:30'")?ok():er('Instant:hours');
ips.includes('profit_split_pct')?ok():er('Instant:split');
ips.includes('daily_profit_cap_cooldown_hours')?ok():er('Instant:cooldown');
re.includes('InstantRiskProfileService.isInstantAccount')?ok():er('Instant:detect');
re.includes('InstantRiskProfileService.getProfile()')?ok():er('Instant:read');
ar.includes('/admin/instant/profile')?ok():er('Instant:admin');
ar.includes('InstantRiskProfileService.updateProfile')?ok():er('Instant:admin_update');
ps.includes('InstantRiskProfileService')?ok():er('Instant:payout');
// 2-STEP
tsp.includes('twostep_risk_profile')?ok():er('2Step:DB');
tsp.includes('recordFirstPayout')?ok():er('2Step:recordFirstPayout');
tsp.includes('hasReceivedApprovedPayout')?ok():er('2Step:hasPayout');
re.includes('TwoStepRiskProfileService.isTwoStepAccount')?ok():er('2Step:detect');
re.includes('TwoStepRiskProfileService.getProfile()')?ok():er('2Step:read');
ar.includes('/admin/twostep/profile')?ok():er('2Step:admin');
ar.includes('TwoStepRiskProfileService.updateProfile')?ok():er('2Step:admin_update');
ps.includes('TwoStepRiskProfileService')?ok():er('2Step:payout');
ps.includes('recordFirstPayout')?ok():er('2Step:split_trigger');
ps.includes('f_payout_threshold_pct')?ok():er('2Step:threshold');
// 1-STEP
ar.includes('/admin/onestep/profile')?ok():er('1Step:admin');
// ISOLATION
!fre.includes('InstantRiskProfileService')?ok():er('ISO:Flash_Instant');
!fre.includes('TwoStepRiskProfileService')?ok():er('ISO:Flash_2Step');
!ips.includes('FlashRiskProfileService')?ok():er('ISO:Instant_Flash');
!tsp.includes('FlashRiskProfileService')?ok():er('ISO:2Step_Flash');
!tsp.includes('InstantRiskProfileService')?ok():er('ISO:2Step_Instant');
// LEVERAGE
re.includes('TwoStepRiskProfileService.isTwoStepAccount(account))')?ok():er('LEV:2Step');
fre.includes('existingExposure')?ok():er('LEV:Flash');
// IST
re.includes('checkTradingHoursIST')?ok():er('IST:method');
re.includes('5 * 60 + 30')?ok():er('IST:offset_RE');
fre.includes('5 * 60 + 30')?ok():er('IST:offset_Flash');
// PAYOUT
ps.includes('isInstantPlan || isFlashPlan')?ok():er('PAYOUT:gate');
ps.includes('SPLIT_CONFIGS')?ok():er('PAYOUT:legacy');
// CRON
dc.includes('FlashRiskEngine.sweepExpiredFlashAccounts')?ok():er('CRON:Flash');
// OLD PATH
re.includes('riskRulesRepo.getRulesMap(accountId)')?ok():er('LEGACY:risk_rules_path');
console.log('\nAUDIT: '+p+' passed, '+f+' failed');
process.exit(f>0?1:0);