import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(__dir,'..', f), 'utf8');

const re  = read('services/riskEngine.js');
const m   = read('db/terminal-migrations/020_instant_risk_profile.sql');
const ps  = read('services/payoutService.js');
const crp = read('config/challengeRuleProfiles.js');
const ar  = read('routes/admin.routes.js');

console.log('T3 profit_target > 0 in _getRulesMap:', re.includes('ip.profit_target_pct > 0'));
console.log('T9 cooldown in migration:', m.includes('daily_profit_cap_cooldown_hours'));
console.log('T9 cap_until in migration:', m.includes('daily_profit_cap_until'));
console.log('T9 cooldown in riskEngine:', re.includes('daily_profit_cap_until'));
console.log("T14 canonical end '15:30':", crp.includes("end: '15:30'"));
console.log("T15 canonical no_overnight allowed:true:", crp.includes("no_overnight:       { allowed: true }"));
console.log('T22 isFunded gate pattern:', ps.includes('isInstantPlan || isFlashPlan'));
console.log("mig end DEFAULT '15:30':", m.includes("DEFAULT '15:30'"));
console.log('mig profit_split_pct:', m.includes('profit_split_pct'));
console.log('mig DEFAULT 80.0:', m.includes('DEFAULT 80.0'));
console.log('mig DEFAULT 8.0:', m.includes('DEFAULT 8.0'));
console.log('admin daily_profit_cap_until:', ar.includes('daily_profit_cap_until'));

// Show relevant snippets
const migLines = m.split('\n').filter(l => l.includes('15:30')||l.includes('overnight')||l.includes('profit_split')||l.includes('cooldown')||l.includes('cap_until'));
console.log('\nMigration relevant lines:');
migLines.forEach(l => console.log(' ', l.trim()));

const crpLines = crp.split('\n').filter((_,i,a) => a.slice(i,i+3).join('').includes('no_overnight')||a.slice(i,i+3).join('').includes("'15:30'"));
console.log('\nCRP overnight/15:30 lines (10 around):');
const overnightIdx = crp.indexOf('no_overnight') + crp.indexOf("instant") ;
const slice = crp.slice(crp.indexOf("getInstantFundingRuleProfile"), crp.indexOf("get2StepPhase1RuleProfile")).split('\n').filter(l=>l.includes('no_overnight')||l.includes("'15:30'")||l.includes('weekend'));
slice.forEach(l => console.log(' ', l.trim()));

process.exit(0);
