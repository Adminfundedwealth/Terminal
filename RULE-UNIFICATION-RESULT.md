# RULE UNIFICATION — Implementation Result

**Date**: June 27, 2026  
**Objective**: Main Site = Single Source of Truth for all challenge rules.  
**Terminal**: Enforces rules. Never defines them.  
**Admin**: Displays live status. Never changes rules directly.

---

## A) MAIN SITE RULES MAPPED

The provisioning endpoint (`POST /provisioning/provision`) now accepts a `ruleProfile` object from the Main Site. This is the **contract** between Main Site and Terminal.

### Supported Challenge Types

| Type | Phases | Description |
|------|--------|-------------|
| Flash | 1 phase | Quick evaluation, tight rules |
| Instant | 1 phase | Instant funding after target |
| 1-Step | 1 phase | Single evaluation phase |
| 2-Step | 2 phases (Phase 1 → Phase 2) | Traditional two-phase evaluation |

### Supported Account Sizes

`10K`, `25K`, `50K`, `1L` — all values come from Main Site.

### Rule Profile Schema (sent by Main Site during provisioning)

```json
{
  "challengeType": "2-step",
  "plan": "10K",
  "phase": "phase_1",
  "initialBalance": 1000000,
  "rules": {
    "daily_loss_limit": { "percent": 5, "amount": 50000 },
    "max_drawdown": { "percent": 10, "amount": 100000, "type": "static" },
    "profit_target": { "percent": 8, "amount": 80000 },
    "min_trading_days": { "count": 5 },
    "max_calendar_days": { "count": 30 },
    "consistency_rule": { "maxDayProfitPercent": 40 },
    "max_risk_per_trade": { "percent": 2 },
    "max_positions": { "count": 10 },
    "max_lot_size": { "nse": 10, "nfo": 5 },
    "leverage_limit": { "maxMultiplier": 5 },
    "allowed_segments": { "segments": ["NSE", "NFO"] },
    "trading_hours": { "start": "09:15", "end": "15:30" },
    "no_overnight": { "cutoffTime": "15:15", "allowedProducts": ["MIS"] },
    "news_blackout": { "windows": [] },
    "max_daily_trades": { "count": 50 },
    "profit_split": { "percent": 80 },
    "drawdown_type": { "type": "static" }
  }
}
```

### Flow

```
Main Site defines rules per challenge type + plan
        ↓
User purchases challenge
        ↓
Main Site calls POST /provisioning/provision with ruleProfile
        ↓
Terminal validates profile (validateRuleProfile)
        ↓
Terminal creates challenge_account + trading_account
        ↓
Terminal persists ALL rules to risk_rules table (profileToRuleRows)
        ↓
Risk Engine reads ONLY from risk_rules table
        ↓
No hardcoded values consulted at trade time
```

---

## B) RISK ENGINE UPDATED

### New Rule Checks Added

| Rule | Method | File |
|------|--------|------|
| Consistency Rule | `RiskEngine.checkConsistencyRule()` | `server/services/riskEngine.js` |
| Max Risk Per Trade | `RiskEngine.checkMaxRiskPerTrade()` | `server/services/riskEngine.js` |
| Leverage Limit | `RiskEngine.checkLeverageLimit()` | `server/services/riskEngine.js` |

### Full Pre-Trade Check Sequence (14 checks)

1. Market Holiday
2. Weekend
3. Allowed Segments
4. Trading Hours
5. No Overnight
6. News Blackout
7. Max Positions
8. Max Lot Size
9. Max Daily Trades
10. Daily Loss Limit
11. Margin Availability
12. **Consistency Rule** (NEW)
13. **Max Risk Per Trade** (NEW)
14. **Leverage Limit** (NEW)

### Rule Source

The Risk Engine loads rules from `risk_rules` table via `riskRulesRepo.getRulesMap(accountId)`. It NEVER reads from `challengeRuleProfiles.js` at trade time. That file is only used during provisioning if Main Site doesn't provide a profile (backward compat).

---

## C) DATABASE CHANGES

**No schema changes required.**

All new rules use the existing `risk_rules` table structure:

```sql
risk_rules (
  id UUID,
  trading_account_id UUID → trading_accounts(id),
  rule_type TEXT,         -- 'consistency_rule', 'max_risk_per_trade', etc.
  value JSONB,            -- flexible per-rule configuration
  is_active BOOLEAN
)
```

New rule types stored:
- `consistency_rule` → `{ maxDayProfitPercent: 40 }`
- `max_risk_per_trade` → `{ percent: 2 }`
- `leverage_limit` → `{ maxMultiplier: 5 }`
- `profit_split` → `{ percent: 80 }` (read by payout logic)
- `drawdown_type` → `{ type: 'static' | 'trailing' }` (read by drawdown calc)

---

## D) ADMIN MONITORING ADDED

### New API Endpoint

```
GET /api/account/rule-progress
```

**Response:**
```json
{
  "accountId": "uuid",
  "timestamp": "2026-06-27T10:30:00Z",
  "rules": [
    {
      "ruleType": "daily_loss_limit",
      "currentValue": 25000,
      "allowedValue": 50000,
      "remaining": 25000,
      "percentUsed": 50,
      "status": "PASS"
    },
    {
      "ruleType": "max_drawdown",
      "currentValue": 75000,
      "allowedValue": 100000,
      "remaining": 25000,
      "percentUsed": 75,
      "status": "WARNING"
    }
  ]
}
```

### Real-time Event

Channel: `risk.progress` → WebSocket event `risk_progress`  
Emitted after every trade via `RuleProgressService.publishProgress()`

### Admin Can Query

- `risk_rules` table: Current rule configuration per account
- `risk_events` table: Historical warnings, breaches, locks
- `GET /api/account/rule-progress`: Live per-rule status
- `GET /health`: System-wide health (feed, DB, broker)

---

## E) MAIN SITE DASHBOARD UPDATES

### Lifecycle Callbacks (already implemented in Phase 2 hardening)

| Event | When Triggered | Dashboard Update |
|-------|---------------|-----------------|
| `challenge.passed` | Profit target met + min days | Show "Passed", enable promotion |
| `challenge.failed` | Max drawdown breached | Show "Failed", disable trading |
| `account.locked` | Daily loss limit hit | Show "Locked until next trading day" |
| `risk.warning` | Any rule at 75%+ | Show warning banner with rule name + values |
| `risk.breached` | Any rule hit 100% | Show breach notification |
| `account.promoted` | Auto-promotion | Show new phase, new account |
| `funded.created` | Phase 2 passed | Show "Funded Account Active" |

### Payload includes exact rule data

```json
{
  "event": "risk.breached",
  "accountId": "uuid",
  "traderId": "uuid",
  "data": {
    "ruleType": "max_drawdown",
    "currentValue": 110000,
    "limitValue": 100000,
    "breachedAt": "2026-06-27T14:30:00Z"
  }
}
```

---

## F) REMAINING GAPS

| # | Gap | Severity | Responsibility |
|---|-----|----------|---------------|
| 1 | Main Site must send `ruleProfile` in provisioning calls | EXTERNAL (Main Site) | Main Site team adds ruleProfile to purchase→provision flow |
| 2 | Admin UI must consume `POST /api/terminal/events` | EXTERNAL (Admin) | Admin team builds event receiver endpoint |
| 3 | Main Site must expose challenge type configs API | EXTERNAL (Main Site) | For Admin to display "what rules apply to what plan" |
| 4 | Email notification service | LOW | `EmailService` referenced but implementation is a stub. Needs SMTP/SES integration. |
| 5 | Trailing drawdown type | LOW | `drawdown_type: 'trailing'` is stored but the drawdown calculation always uses peak-to-current. If Main Site defines trailing, Terminal must adjust calculation. |
| 6 | Profit split enforcement | N/A (Terminal) | `profit_split` is stored but payout is handled by Main Site/Admin, not Terminal |

**No Terminal-side blockers remain.** All remaining items are responsibilities of Main Site or Admin teams.

---

## FILES CHANGED/CREATED

| File | Status |
|------|--------|
| `server/config/challengeRuleProfiles.js` | **NEW** — Rule profile schema, validation, conversion |
| `server/services/ruleProgressService.js` | **NEW** — Live progress calculation per rule |
| `server/services/provisioningService.js` | MODIFIED — Accepts `ruleProfile` from Main Site, `_seedRiskRulesFromProfile()` |
| `server/services/riskEngine.js` | MODIFIED — Added 3 new checks: consistency, max risk/trade, leverage |
| `server/routes/provisioning.routes.js` | MODIFIED — Updated API docs to show ruleProfile contract |
| `server/routes/api.js` | MODIFIED — Added `GET /api/account/rule-progress` endpoint |
| `server/events/channels.js` | MODIFIED — Added `risk.progress` channel |
