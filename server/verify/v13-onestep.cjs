const fs=require('fs');
const re=fs.readFileSync('services/riskEngine.js','utf8');
const ps=fs.readFileSync('services/payoutService.js','utf8');
const ar=fs.readFileSync('routes/admin.routes.js','utf8');
const os=fs.readFileSync('services/oneStepRiskProfileService.js','utf8');
const mig=fs.readFileSync('db/terminal-migrations/023_onestep_risk_profile.sql','utf8');
let p=0,f=0;
const ok=m=>{p++;};const er=m=>{console.error('X '+m);f++;};
// Service
os.includes('onestep_risk_profile')?ok():er('1S:DB');
os.includes('isOneStepAccount')?ok():er('1S:isOneStep');
os.includes('getPhase')?ok():er('1S:getPhase');
os.includes('getEffectiveSplitPct')?ok():er('1S:splitPct');
os.includes('e_profit_target_pct:10')?ok():er('1S:eval target!=10');
os.includes('f_profit_target_pct:0')?ok():er('1S:funded target!=0');
os.includes('e_max_drawdown_pct:6')?ok():er('1S:eval DD!=6');
os.includes('f_max_drawdown_pct:6')?ok():er('1S:funded DD!=6');
os.includes('e_leverage_max:30')?ok():er('1S:eval leverage!=30');
os.includes('f_consistency_rule_pct:40')?ok():er('1S:funded consistency!=40');
os.includes('f_profit_split_initial_pct:80')?ok():er('1S:split initial!=80');
os.includes('f_profit_split_scaled_pct:90')?ok():er('1S:split scaled!=90');
os.includes('f_payout_threshold_pct:3')?ok():er('1S:threshold!=3');
os.includes('time_limit_days:0')?ok():er('1S:not unlimited');
os.includes("'15:30'")?ok():er('1S:hours');
os.includes('overnight_allowed:true')?ok():er('1S:overnight');
os.includes('weekend_allowed:true')?ok():er('1S:weekend');
// RiskEngine
re.includes('OneStepRiskProfileService')?ok():er('RE:1Step import');
re.includes('isOneStepAccount(account)')?ok():er('RE:1Step detect');
re.includes('OneStepRiskProfileService.getProfile()')?ok():er('RE:1Step getProfile');
re.includes('_onestep_weekend_allowed')?ok():er('RE:1Step weekend flag');
re.includes('OneStepRiskProfileService.isOneStepAccount(account))')?ok():er('RE:1Step leverage');
// Admin
ar.includes('OneStepRiskProfileService')?ok():er('Admin:1Step import');
ar.includes('/admin/onestep/profile')?ok():er('Admin:1Step routes');
ar.includes('/admin/onestep/audit')?ok():er('Admin:1Step audit');
ar.includes('OneStepRiskProfileService.updateProfile')?ok():er('Admin:1Step update');
// Payout
ps.includes('OneStepRiskProfileService')?ok():er('PS:1Step import');
ps.includes('isOneStep')?ok():er('PS:1Step detect');
ps.includes('f_payout_threshold_pct')?ok():er('PS:1Step threshold');
ps.includes('isOneStepPlan')?ok():er('PS:1Step payout gate');
// Migration
mig.includes('onestep_risk_profile')?ok():er('MIG:table');
mig.includes('onestep_risk_profile_audit')?ok():er('MIG:audit');
!mig.includes('DROP')?ok():er('MIG:destructive');
mig.includes("DEFAULT '15:30'")?ok():er('MIG:hours');
mig.includes('DEFAULT 0,')?ok():er('MIG:unlimited');
// Isolation
!os.includes('FlashRiskProfileService')?ok():er('ISO:1Step has Flash');
!os.includes('InstantRiskProfileService')?ok():er('ISO:1Step has Instant');
!os.includes('TwoStepRiskProfileService')?ok():er('ISO:1Step has 2Step');
console.log('\n1-STEP SUITE: '+p+' passed, '+f+' failed');
process.exit(f>0?1:0);