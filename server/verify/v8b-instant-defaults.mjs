/**
 * v8b — Instant HARDCODED_DEFAULT values check (no Supabase import, exits cleanly)
 * Uses process.exit(0) immediately after tests to prevent ws keepalive.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
const ips = readFileSync(join(__dir, '..', 'services', 'instantRiskProfileService.js'), 'utf8');
const mig = readFileSync(join(__dir, '..', 'db', 'terminal-migrations', '020_instant_risk_profile.sql'), 'utf8');

let p=0, f=0;
const ok = (m) => { console.log(`  ✓ ${m}`); p++; };
const er = (m) => { console.error(`  ✗ ${m}`); f++; };

// HARDCODED_DEFAULT field checks
ips.includes("trading_hours_end:                '15:30'")  ?ok('hours_end=15:30')        :er(`hours_end wrong: ${ips.match(/trading_hours_end[^,\n]*/)?.[0]}`);
ips.includes("overnight_allowed:                true")     ?ok('overnight=true')          :er(`overnight wrong: ${ips.match(/overnight_allowed[^,\n]*/)?.[0]}`);
ips.includes("weekend_allowed:                  true")     ?ok('weekend=true')            :er(`weekend wrong: ${ips.match(/weekend_allowed[^,\n]*/)?.[0]}`);
ips.includes("profit_split_pct:                 80.0")     ?ok('profit_split_pct=80.0')   :er(`split wrong: ${ips.match(/profit_split_pct[^,\n]*/)?.[0]}`);
ips.includes("daily_profit_cap_cooldown_hours:  8.0")      ?ok('cooldown=8h')             :er(`cooldown wrong: ${ips.match(/daily_profit_cap_cooldown_hours[^,\n]*/)?.[0]}`);
ips.includes("daily_loss_pct:                   3.0")      ?ok('daily_loss=3%')           :er(`daily_loss wrong: ${ips.match(/daily_loss_pct[^,\n]*/)?.[0]}`);
ips.includes("max_drawdown_pct:                 5.0")      ?ok('max_drawdown=5%')         :er(`max_drawdown wrong: ${ips.match(/max_drawdown_pct[^,\n]*/)?.[0]}`);
ips.includes("profit_target_pct:                0.0")      ?ok('profit_target=0')         :er(`profit_target wrong: ${ips.match(/profit_target_pct[^,\n]*/)?.[0]}`);
ips.includes("min_trading_days:                 7")        ?ok('min_trading_days=7')      :er(`min_days wrong: ${ips.match(/min_trading_days[^,\n]*/)?.[0]}`);
ips.includes("max_open_positions:               20")       ?ok('max_positions=20')        :er(`max_positions wrong: ${ips.match(/max_open_positions[^,\n]*/)?.[0]}`);
ips.includes("max_position_size_pct:            70.0")     ?ok('max_position_size=70%')   :er(`position_size wrong: ${ips.match(/max_position_size_pct[^,\n]*/)?.[0]}`);
ips.includes("leverage_max:                     50")       ?ok('leverage_max=50')         :er(`leverage wrong: ${ips.match(/leverage_max[^,\n]*/)?.[0]}`);
ips.includes("daily_profit_cap_pct:             4.0")      ?ok('profit_cap=4%')           :er(`profit_cap wrong: ${ips.match(/daily_profit_cap_pct[^,\n]*/)?.[0]}`);
ips.includes("risk_per_idea_pct:                1.0")      ?ok('risk_per_idea=1%')        :er(`risk_idea wrong: ${ips.match(/risk_per_idea_pct[^,\n]*/)?.[0]}`);
ips.includes("risk_per_idea_window_min:         10")       ?ok('risk_window=10min')       :er(`risk_window wrong: ${ips.match(/risk_per_idea_window_min[^,\n]*/)?.[0]}`);
ips.includes("consistency_rule_pct:             15.0")     ?ok('consistency=15%')         :er(`consistency wrong: ${ips.match(/consistency_rule_pct[^,\n]*/)?.[0]}`);
ips.includes("inactivity_close_days:            60")       ?ok('inactivity=60 days')      :er(`inactivity wrong: ${ips.match(/inactivity_close_days[^,\n]*/)?.[0]}`);
ips.includes("payout_threshold_pct:             5.0")      ?ok('payout_threshold=5%')     :er(`payout_threshold wrong: ${ips.match(/payout_threshold_pct[^,\n]*/)?.[0]}`);
ips.includes("holiday_restriction:              true")     ?ok('holiday=blocked')         :er(`holiday wrong: ${ips.match(/holiday_restriction[^,\n]*/)?.[0]}`);

// No progression fields
!ips.includes('profit_split_initial_pct')                  ?ok('no progression fields')   :er('progression fields found');
ips.includes('_startedAt = null')                          ?ok('getEffectiveSplitPct flat signature') :er('getEffectiveSplitPct signature wrong');
ips.includes('profit_split_pct ?? 80')                     ?ok('flat 80% return')         :er('flat return wrong');

// Migration 020 defaults
mig.includes("DEFAULT '15:30'")                            ?ok('MIG: hours_end=15:30')    :er(`MIG: hours_end=${mig.match(/trading_hours_end[^\n]*/)?.[0]}`);
mig.includes("DEFAULT TRUE")&&mig.includes('overnight_allowed') ?ok('MIG: overnight=true') :er('MIG: overnight wrong');
mig.includes("DEFAULT TRUE")&&mig.includes('weekend_allowed')   ?ok('MIG: weekend=true')  :er('MIG: weekend wrong');
mig.includes("DEFAULT 80.0")&&mig.includes('profit_split_pct')  ?ok('MIG: split=80%')     :er(`MIG: split=${mig.match(/profit_split_pct[^\n]*/)?.[0]}`);
mig.includes("DEFAULT 8.0")&&mig.includes('daily_profit_cap_cooldown_hours') ?ok('MIG: cooldown=8h') :er(`MIG: cooldown=${mig.match(/daily_profit_cap_cooldown_hours[^\n]*/)?.[0]}`);
mig.includes('daily_profit_cap_until')                     ?ok('MIG: cap_until column')   :er('MIG: cap_until missing');
!mig.includes('profit_split_initial_pct')                  ?ok('MIG: no progression cols') :er('MIG: progression cols present');

console.log(`\n  v8b DEFAULTS: ${p} passed, ${f} failed`);
process.exit(f > 0 ? 1 : 0);
