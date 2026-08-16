const fs=require('fs');
const re=fs.readFileSync('services/riskEngine.js','utf8');
let p=0,f=0;
const ok=m=>{p++;};const er=m=>{console.error('X '+m);f++;};
// Separate blocks
re.includes('InstantRiskProfileService.getProfile()')?ok():er('Instant:getProfile missing');
re.includes('TwoStepRiskProfileService.getProfile()')?ok():er('2Step:getProfile missing');
// They are in separate if blocks (not combined)
const iIdx=re.indexOf('InstantRiskProfileService.isInstantAccount(account))');
const tIdx=re.indexOf('TwoStepRiskProfileService.isTwoStepAccount(account))');
(iIdx>0&&tIdx>0&&tIdx>iIdx)?ok():er('blocks not separate or wrong order');
// Instant block reads ip
const iBlock=re.substring(iIdx, iIdx+200);
iBlock.includes('InstantRiskProfileService.getProfile()')?ok():er('Instant block reads wrong profile');
// 2-Step block reads tp
const tBlock=re.substring(tIdx, tIdx+200);
tBlock.includes('TwoStepRiskProfileService.getProfile()')?ok():er('2Step block reads wrong profile');
// Leverage fix for both
re.includes('OneStepRiskProfileService.isOneStepAccount(account))')?ok():er('Leverage not for both');
// Isolation: no cross-read
!iBlock.includes('TwoStepRiskProfileService')?ok():er('Instant block has TwoStep');
!tBlock.includes('InstantRiskProfileService')?ok():er('2Step block has Instant');
// Flash still uses own engine
const oes=fs.readFileSync('services/orderExecutionService.js','utf8');
oes.includes('FlashRiskEngine.validateOrder')?ok():er('Flash routing broken');
// Instant v8 suite
const ips=fs.readFileSync('services/instantRiskProfileService.js','utf8');
ips.includes("'15:30'")?ok():er('Instant hours');
ips.includes('profit_split_pct')?ok():er('Instant split');
// 2-Step
const tsp=fs.readFileSync('services/twoStepRiskProfileService.js','utf8');
tsp.includes('twostep_risk_profile')?ok():er('2Step DB table');
tsp.includes('getPhase')?ok():er('2Step getPhase');
console.log('\nCROSS-AUDIT: '+p+' passed, '+f+' failed');
process.exit(f>0?1:0);