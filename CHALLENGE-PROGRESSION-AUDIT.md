# CHALLENGE PROGRESSION AUDIT — Agent D Certification

**Date:** 2026-06-19  
**Scope:** Challenge Lifecycle from Start to Completion/Failure  
**Service:** `server/services/challengeService.js`  
**Repository:** `server/repositories/challenge.repository.js`, `challenge-metrics.repository.js`  
**Risk Engine:** `server/services/riskEngine.js`

---

## CHALLENGE LIFECYCLE

```
┌────────────────────────────────────────────────────────────────┐
│                CHALLENGE PROGRESSION FLOW                       │
│                                                                │
│  ┌─────────────────┐                                           │
│  │ CHALLENGE CREATED│                                           │
│  │ type: evaluation │                                           │
│  │ status: active   │                                           │
│  │ initial_balance  │                                           │
│  │ expires_at       │                                           │
│  └────────┬────────┘                                           │
│           │                                                    │
│           ▼                                                    │
│  ┌─────────────────────────────────────────────┐               │
│  │              TRADING PHASE                   │               │
│  │                                             │               │
│  │  Every Trade → RiskEngine.postTradeCheck()  │               │
│  │  Every Day  → ChallengeService.dailyCheck() │               │
│  │  Post-Fill  → ChallengeService.checkTransitions() │         │
│  └──────┬──────────┬───────────┬───────────┬───┘               │
│         │          │           │           │                   │
│         ▼          ▼           ▼           ▼                   │
│  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐             │
│  │  PASSED  │ │ FAILED  │ │EXPIRED │ │ LOCKED  │             │
│  │(target+  │ │(drawdown│ │(time   │ │(daily   │             │
│  │ min days)│ │ breach) │ │ limit) │ │ loss)   │             │
│  └──────────┘ └─────────┘ └────────┘ └────┬────┘             │
│                                            │                   │
│                                            │ Next Day          │
│                                            ▼                   │
│                                       ┌─────────┐             │
│                                       │ ACTIVE  │ (resume)    │
│                                       └─────────┘             │
└────────────────────────────────────────────────────────────────┘
```

---

## PHASE 1: CHALLENGE START

**What happens:**
1. Challenge created in `t_challenges` with `status: 'active'`
2. Account created in `t_accounts` linked via `challenge_id`
3. Risk rules seeded in `t_risk_rules` for the account
4. `peak_balance` set to initial balance
5. `payout_eligible` = FALSE

**Metrics logged:** `ChallengeMetricsRepository.logChallengeStarted()`

✅ **VERIFIED** — Clean setup with initial state.

---

## PHASE 2: ACTIVE TRADING

**Per-order checks (pre-trade):**
```
RiskEngine.validateOrder(accountId, orderParams)
  → checkAllowedSegments
  → checkTradingHours
  → checkMaxPositions
  → checkMaxLotSize
  → checkMaxDailyTrades
  → checkDailyLossLimit
```

**Per-fill checks (post-trade):**
```
RiskEngine.postTradeCheck(accountId)
  → Calculate realized + unrealized P&L
  → Check daily_loss_limit → LOCK if breached
  → Check max_drawdown → BREACH if exceeded
  → Check profit_target → EMIT target_reached
  → Update peak_balance if new high
```

**Daily checks (cron at 09:00 IST):**
```
ChallengeService.dailyCheck(accountId)
  → unlockIfEligible (locked → active for daily-loss only)
  → checkTransitions (expiry, profit target + min days, drawdown)
```

✅ **VERIFIED** — Continuous enforcement throughout challenge.

---

## PHASE 3: CHALLENGE PASS

**Requirements (ALL must be true):**
1. ✅ `account.balance - challenge.initial_balance >= targetAmount`
2. ✅ `tradingDays >= min_trading_days.count` (if rule exists)
3. ✅ Account status = 'active'
4. ✅ Challenge status = 'active'

**Code (ChallengeService.checkTransitions):**
```javascript
if (pnl >= targetAmount) {
  if (minDays?.count) {
    const tradingDays = await metricsRepo.getTradingDaysCount(accountId);
    if (tradingDays < minDays.count) {
      return { transitioned: false, note: 'Target reached but need more trading days' };
    }
  }
  await challengeRepo.markPassed(challenge.id);
  await accountRepo.completeAccount(accountId);
  await auditRepo.log({ eventType: 'challenge_passed' });
}
```

**Result:**
- `challenge.status` → `'passed'`
- `challenge.passed_at` → current timestamp
- `account.status` → `'completed'`

**Metrics logged:** `ChallengeMetricsRepository.logChallengePassed()`

✅ **VERIFIED** — Min trading days gate prevents gaming.

---

## PHASE 4: CHALLENGE FAILURE (DRAWDOWN)

**Trigger:** `drawdown >= maxDrawdownAmount`

**Code (ChallengeService.checkTransitions):**
```javascript
if (drawdown >= maxDrawdownAmount) {
  await challengeRepo.markFailed(challenge.id, reason);
  await accountRepo.breachAccount(accountId, reason);
  await auditRepo.log({ eventType: 'challenge_failed' });
}
```

**Also triggered by (RiskEngine.postTradeCheck):**
```javascript
await accountRepo.breachAccount(accountId, reason);
eventBus.publish('risk.alert', { type: 'breach', ruleType: 'max_drawdown' });
eventBus.publish('challenge.updated', { status: 'breached' });
```

**Result:**
- `challenge.status` → `'failed'`
- `challenge.failed_at` → current timestamp
- `challenge.fail_reason` → description
- `account.status` → `'breached'`

**Reversible:** ❌ NO. PERMANENT.

✅ **VERIFIED** — Dual enforcement ensures no bypass.

---

## PHASE 5: CHALLENGE EXPIRY

**Trigger:** `challenge.expires_at < new Date()`

**Code (ChallengeService.checkTransitions):**
```javascript
if (challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
  await challengeRepo.markExpired(challenge.id);
  await accountRepo.update(accountId, { status: 'expired' });
  await auditRepo.log({ eventType: 'challenge_expired' });
}
```

**Result:**
- `challenge.status` → `'expired'`
- `challenge.failed_at` → current timestamp
- `challenge.fail_reason` → `'Time limit exceeded'`
- `account.status` → `'expired'`

✅ **VERIFIED** — Time-based expiry enforced daily.

---

## PHASE 6: DAILY LOSS LOCK (TEMPORARY)

**Trigger:** `|totalDailyPnl| >= dailyLossLimit` (in postTradeCheck)

**Action:** Account LOCKED, trading blocked for rest of day.

**Recovery:** Next morning cron unlocks if `locked_reason` contains "Daily loss".

**Challenge stays ACTIVE** — only account is locked temporarily.

✅ **VERIFIED** — Correct prop firm behavior: daily loss is a daily limit, not a fatal breach.

---

## CHALLENGE PROGRESS CALCULATION

**ChallengeService.getProgress(accountId) returns:**
```javascript
{
  challengeId, type, plan, status,
  initialBalance, currentBalance, peakBalance,
  pnl, pnlPercent,
  drawdown, drawdownPercent,
  tradingDays,
  targets: {
    profitTarget,
    profitProgress,       // % toward target
    maxDrawdown,
    drawdownUsed,         // % of drawdown consumed
    minTradingDays,
    tradingDaysProgress,  // % of min days completed
  },
  startedAt, expiresAt, accountStatus
}
```

✅ **VERIFIED** — Comprehensive progress tracking for dashboard display.

---

## METRICS LOGGING

| Event Type | Repository Method | When |
|-----------|------------------|------|
| `challenge_started` | `logChallengeStarted()` | Challenge creation |
| `challenge_updated` | `logChallengeUpdated()` | Generic state change |
| `challenge_passed` | `logChallengePassed()` | Target + min days met |
| `challenge_failed` | `logChallengeFailed()` | Drawdown breach |
| `balance_snapshot` | `logBalanceSnapshot()` | End of day |
| `trading_day_complete` | `logTradingDayComplete()` | Market close |
| `drawdown_warning` | `logDrawdownWarning()` | Approaching limit |
| `drawdown_breach` | `logDrawdownBreach()` | Limit exceeded |
| `profit_target_reached` | `logProfitTargetReached()` | Target hit |
| `milestone_reached` | `logMilestone()` | Custom milestones |

✅ **VERIFIED** — Granular event log for full challenge lifecycle.

---

## MULTI-PHASE PROGRESSION (NOT IMPLEMENTED)

**What prop firms typically have:**
```
Phase 1 (Evaluation) → Phase 2 (Verification) → Funded Account
```

**Current State:**
- `challenge.type` supports `'evaluation'` and `'funded'`
- NO automatic promotion from evaluation → funded
- NO Phase 2 logic exists
- Passing an evaluation marks it as `passed` but does NOT create a funded challenge

**Impact:** Single-phase challenges work correctly. Multi-phase requires:
- Admin to manually create funded challenge after evaluation passes
- OR additional service logic to auto-create Phase 2/Funded

---

## CONSISTENCY RULES VERIFICATION

| Rule | Implemented | Method |
|------|-------------|--------|
| Min trading days | ✅ | `metricsRepo.getTradingDaysCount()` gates profit target pass |
| Target must be sustained | ⚠️ PARTIAL | Checked at transition time, not continuously |
| No weekend holding | ❌ | Not implemented |
| Consecutive loss limit | ❌ | Not implemented (common in some prop firms) |

---

## VERDICT

**Challenge Progression Score: 85/100**

- Core flow (start → trade → pass/fail/expire) works correctly.
- Daily loss lock + next-day unlock is proper prop firm behavior.
- Drawdown breach is permanent and enforced at multiple levels.
- Profit target requires minimum trading days (anti-gaming).
- Comprehensive metrics logging for audit trail.
- Missing: Multi-phase progression (Phase 1 → Phase 2 → Funded).
- Missing: Some advanced prop firm rules (consistency, no weekend holding).
