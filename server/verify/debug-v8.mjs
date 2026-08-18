import { InstantRiskProfileService } from '../services/instantRiskProfileService.js';
InstantRiskProfileService.invalidateCache();
const p = await InstantRiskProfileService.getProfile();
console.log('overnight_allowed:', p.overnight_allowed);
console.log('profit_split_pct:', p.profit_split_pct);
console.log('daily_profit_cap_cooldown_hours:', p.daily_profit_cap_cooldown_hours);
console.log('trading_hours_end:', p.trading_hours_end);
process.exit(0);
