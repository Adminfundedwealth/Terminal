import { supabase } from '../db/client.js';
const PROFILE_ID='default';const CACHE_TTL_MS=60000;
let _cached=null,_exp=0;

const DEFAULTS=Object.freeze({
  id:'default',
  // Evaluation
  e_daily_loss_pct:3,e_max_drawdown_pct:6,e_profit_target_pct:10,
  e_min_trading_days:5,e_max_open_positions:20,e_max_position_size_pct:70,
  e_max_risk_per_trade_pct:1.5,e_daily_profit_cap_pct:4,e_leverage_max:30,
  // Funded
  f_daily_loss_pct:3,f_max_drawdown_pct:6,f_profit_target_pct:0,
  f_min_trading_days:3,f_max_open_positions:20,f_max_position_size_pct:70,
  f_max_risk_per_trade_pct:1.5,f_daily_profit_cap_pct:4,f_leverage_max:30,
  f_consistency_rule_pct:40,
  f_profit_split_initial_pct:80,f_profit_split_scaled_pct:90,
  f_payout_threshold_pct:3,
  // Shared
  allowed_segments:['NSE','NFO','BFO','MCX','CDS'],
  trading_hours_start:'09:15',trading_hours_end:'15:30',
  overnight_allowed:true,weekend_allowed:true,holiday_restriction:true,
  inactivity_close_days:60,time_limit_days:0,
  updated_at:null,updated_by:null
});

export class OneStepRiskProfileService {
  static async getProfile(){
    const now=Date.now();if(_cached&&now<_exp)return _cached;
    if(!supabase)return DEFAULTS;
    try{
      const{data,error}=await supabase.from('onestep_risk_profile').select('*').eq('id',PROFILE_ID).single();
      if(error||!data){console.warn('[1StepProfile] DB read failed:',error?.message);return DEFAULTS;}
      const p={...data,allowed_segments:Array.isArray(data.allowed_segments)?data.allowed_segments:JSON.parse(data.allowed_segments||'[]')};
      _cached=Object.freeze(p);_exp=now+CACHE_TTL_MS;return _cached;
    }catch(e){console.warn('[1StepProfile] Exception:',e.message);return DEFAULTS;}
  }
  static invalidateCache(){_cached=null;_exp=0;console.log('[1StepProfile] Cache invalidated');}
  static async updateProfile(updates,adminId){
    if(!supabase)throw new Error('Database not configured');
    const current=await this.getProfile();
    const safe={};const allowed=Object.keys(DEFAULTS).filter(k=>k!=='id'&&k!=='updated_at'&&k!=='updated_by');
    for(const f of allowed){if(Object.prototype.hasOwnProperty.call(updates,f))safe[f]=updates[f];}
    if(!Object.keys(safe).length)throw new Error('No valid fields');
    safe.updated_at=new Date().toISOString();safe.updated_by=adminId;
    const{data,error}=await supabase.from('onestep_risk_profile').update(safe).eq('id',PROFILE_ID).select().single();
    if(error)throw new Error('Update failed: '+error.message);
    const rows=[];
    for(const[f,v]of Object.entries(safe)){
      if(f==='updated_at'||f==='updated_by')continue;
      const old=current[f]!==undefined?current[f]:null;
      if(JSON.stringify(old)!==JSON.stringify(v))rows.push({rule_name:f,phase:f.startsWith('e_')?'evaluation':f.startsWith('f_')?'funded':'shared',old_value:old!=null?{value:old}:null,new_value:{value:v},changed_by:adminId,changed_at:safe.updated_at});
    }
    if(rows.length)await supabase.from('onestep_risk_profile_audit').insert(rows).catch(e=>console.error('[1StepAudit]',e.message));
    this.invalidateCache();console.log('[1StepProfile] Updated by',adminId);return data;
  }
  static async getAuditLog(limit=50){
    if(!supabase)return[];
    const{data}=await supabase.from('onestep_risk_profile_audit').select('*').order('changed_at',{ascending:false}).limit(limit);
    return data||[];
  }
  static isOneStepAccount(account){
    const plan=(account?.challenge?.plan||account?.plan||'').toLowerCase().replace(/[-_\s]/g,'');
    return plan==='1step';
  }
  static getPhase(account){
    const type=(account?.challenge?.type||account?.type||'').toLowerCase();
    const phase=(account?.challenge?.phase||account?.phase||'').toLowerCase();
    if(type==='funded'||phase==='funded')return 'funded';
    return 'evaluation';
  }
  static getEffectiveSplitPct(profile,hasReceivedPayout){
    if(hasReceivedPayout)return profile?.f_profit_split_scaled_pct??90;
    return profile?.f_profit_split_initial_pct??80;
  }
  static async hasMetPayoutThreshold(accountId){
    if(!supabase)return false;
    const{data}=await supabase.from('trading_accounts').select('first_payout_approved_at').eq('id',accountId).single();
    return !!(data?.first_payout_approved_at);
  }
}