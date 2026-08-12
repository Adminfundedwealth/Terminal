// Verify: challengeRuleProfiles Flash function + isolation of other plans
import {
  getFlashFundingRuleProfile,
  getInstantFundingRuleProfile,
  get1StepRuleProfile,
  get2StepPhase1RuleProfile,
  profileToRuleRows,
} from '../config/challengeRuleProfiles.js';

let p=0,f=0;
const ok=(m)=>{console.log(`  ✓ ${m}`);p++;};
const er=(m)=>{console.error(`  ✗ ${m}`);f++;};

// Flash profile function exists
typeof getFlashFundingRuleProfile==='function'?ok('getFlashFundingRuleProfile exported'):er('getFlashFundingRuleProfile MISSING');

const fp=getFlashFundingRuleProfile(1000000);
fp.challengeType==='flash'                              ?ok('challengeType=flash')       :er(`challengeType=${fp.challengeType}`);
fp.rules.per_position_loss?.percent===2                 ?ok('per_position_loss=2%')      :er(`per_position_loss=${fp.rules.per_position_loss?.percent}`);
fp.rules.max_drawdown?.percent===4                      ?ok('max_drawdown=4%')           :er(`max_drawdown=${fp.rules.max_drawdown?.percent}`);
fp.rules.profit_target?.percent===0                     ?ok('profit_target=0')           :er(`profit_target=${fp.rules.profit_target?.percent}`);
fp.rules.max_positions?.count===50                      ?ok('max_positions=50')          :er(`max_positions=${fp.rules.max_positions?.count}`);
fp.rules.leverage_limit?.maxMultiplier===50             ?ok('leverage=1:50')             :er(`leverage=${fp.rules.leverage_limit?.maxMultiplier}`);
fp.rules.no_overnight?.allowed===true                   ?ok('no_overnight.allowed=true') :er(`no_overnight=${JSON.stringify(fp.rules.no_overnight)}`);
fp.rules.weekend_allowed?.allowed===true                ?ok('weekend_allowed=true')      :er(`weekend_allowed=${JSON.stringify(fp.rules.weekend_allowed)}`);
fp.rules.holiday_restriction?.enabled===false           ?ok('holiday_restriction=false') :er(`holiday_restriction=${JSON.stringify(fp.rules.holiday_restriction)}`);
fp.rules.profit_split?.percent===90                     ?ok('profit_split=90%')          :er(`profit_split=${fp.rules.profit_split?.percent}`);
fp.rules.consistency_rule?.maxDayProfitPercent===15     ?ok('consistency=15%')           :er(`consistency=${fp.rules.consistency_rule?.maxDayProfitPercent}`);
fp.rules.payout_threshold?.percent===3                  ?ok('payout_threshold=3%')       :er(`payout_threshold=${fp.rules.payout_threshold?.percent}`);
fp.rules.flash_duration?.hours===24                     ?ok('flash_duration=24h')        :er(`flash_duration=${fp.rules.flash_duration?.hours}`);
fp.rules.flash_duration?.timer_start_event==='first_position'?ok('timer=first_position'):er(`timer=${fp.rules.flash_duration?.timer_start_event}`);
const s=fp.rules.allowed_segments?.segments||[];
['NSE','NFO','BFO','MCX','CDS'].every(x=>s.includes(x))?ok(`segments=${s.join(',')}`)  :er(`segments=${JSON.stringify(s)}`);

// profileToRuleRows includes Flash-specific rules
const rows=profileToRuleRows('test-id',fp);
const types=rows.map(r=>r.rule_type);
types.includes('per_position_loss') ?ok('profileToRuleRows: per_position_loss included'):er(`profileToRuleRows missing per_position_loss — got: ${types.join(',')}`);
types.includes('flash_duration')    ?ok('profileToRuleRows: flash_duration included')   :er('profileToRuleRows missing flash_duration');

// ISOLATION — other plans unchanged
const inst=getInstantFundingRuleProfile(1000000);
inst.challengeType==='instant'                  ?ok('instant: challengeType unchanged')  :er(`instant: challengeType=${inst.challengeType}`);
inst.rules.daily_loss_limit?.percent===3        ?ok('instant: daily_loss=3% unchanged')  :er(`instant: daily_loss=${inst.rules.daily_loss_limit?.percent}`);
inst.rules.max_drawdown?.percent===5            ?ok('instant: max_drawdown=5% unchanged'):er(`instant: max_drawdown=${inst.rules.max_drawdown?.percent}`);
!inst.rules.per_position_loss                   ?ok('instant: no per_position_loss rule'):er('instant: has per_position_loss (WRONG)');
!inst.rules.flash_duration                      ?ok('instant: no flash_duration rule')   :er('instant: has flash_duration (WRONG)');

const os=get1StepRuleProfile(1000000);
os.challengeType==='1step'                      ?ok('1step: challengeType unchanged')     :er(`1step: challengeType=${os.challengeType}`);
os.rules.profit_target?.percent===10            ?ok('1step: profit_target=10% unchanged') :er(`1step: profit_target=${os.rules.profit_target?.percent}`);
os.rules.max_drawdown?.percent===6              ?ok('1step: max_drawdown=6% unchanged')   :er(`1step: max_drawdown=${os.rules.max_drawdown?.percent}`);
!os.rules.per_position_loss                     ?ok('1step: no per_position_loss rule')   :er('1step: has per_position_loss (WRONG)');

const ts=get2StepPhase1RuleProfile(1000000);
ts.challengeType==='2step'                      ?ok('2step: challengeType unchanged')     :er(`2step: challengeType=${ts.challengeType}`);
ts.rules.profit_target?.percent===8             ?ok('2step: profit_target=8% unchanged')  :er(`2step: profit_target=${ts.rules.profit_target?.percent}`);
ts.rules.max_drawdown?.percent===8              ?ok('2step: max_drawdown=8% unchanged')   :er(`2step: max_drawdown=${ts.rules.max_drawdown?.percent}`);
!ts.rules.per_position_loss                     ?ok('2step: no per_position_loss rule')   :er('2step: has per_position_loss (WRONG)');

console.log(`\n  ${p} passed, ${f} failed`); process.exit(f>0?1:0);
