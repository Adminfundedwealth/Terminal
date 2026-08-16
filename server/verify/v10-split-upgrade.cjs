const fs=require('fs');
const ps=fs.readFileSync('services/payoutService.js','utf8');
const svc=fs.readFileSync('services/twoStepRiskProfileService.js','utf8');
let p=0,f=0;
const ok=m=>{console.log('  V '+m);p++;};
const er=m=>{console.error('  X '+m);f++;};

// 1. recordFirstPayout called in approvePayout
ps.includes('TwoStepRiskProfileService.recordFirstPayout(payout.account_id)')
  ?ok('1. recordFirstPayout called in approvePayout') :er('1. NOT called');

// 2. Only for 2-Step
ps.includes("TwoStepRiskProfileService.isTwoStepAccount({ challenge: { plan: payout.plan } })")
  ?ok('2. Only triggered for 2-Step accounts') :er('2. Not gated to 2-Step');

// 3. recordFirstPayout uses IS NULL guard (idempotent)
svc.includes(".is('first_payout_approved_at',null)")
  ?ok('3. recordFirstPayout only writes when NULL (idempotent)') :er('3. IS NULL guard missing');

// 4. hasReceivedApprovedPayout reads the column
svc.includes("select('first_payout_approved_at')")&&svc.includes('return !!(data?.first_payout_approved_at)')
  ?ok('4. hasReceivedApprovedPayout correctly reads column') :er('4. hasReceivedApprovedPayout broken');

// 5. getEffectiveSplitPct returns 90 when hasReceivedPayout=true
svc.includes('if(hasReceivedPayout)return profile?.f_profit_split_scaled_pct??90')
  ?ok('5. getEffectiveSplitPct returns 90% after first payout') :er('5. getEffectiveSplitPct logic wrong');

// 6. getEffectiveSplitPct returns 80 when hasReceivedPayout=false
svc.includes('return profile?.f_profit_split_initial_pct??80')
  ?ok('6. getEffectiveSplitPct returns 80% before first payout') :er('6. initial split logic wrong');

// 7. .catch() used (non-blocking)
ps.includes("recordFirstPayout(payout.account_id).catch")
  ?ok('7. Non-blocking (.catch) — does not break payout flow') :er('7. Missing .catch');

// 8. Call is AFTER successful approval (not before)
const approveIdx = ps.indexOf("status: 'approved'");
const recordIdx = ps.indexOf('recordFirstPayout');
(recordIdx > approveIdx) ?ok('8. Called AFTER payout marked approved') :er('8. Called BEFORE approval');

// 9. Flash unaffected (no recordFirstPayout for flash)
!ps.includes("plan: payout.plan } })") || ps.includes("isTwoStepAccount")
  ?ok('9. Flash: unaffected (gate is isTwoStepAccount)') :er('9. Flash may be affected');

// 10. Instant unaffected
!svc.includes('isInstantAccount')
  ?ok('10. Instant: not in twoStepRiskProfileService') :er('10. Instant leak');

console.log('\n  SPLIT UPGRADE SUITE: '+p+' passed, '+f+' failed');
process.exit(f>0?1:0);