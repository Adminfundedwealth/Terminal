# PAYOUT ELIGIBILITY AUDIT — Agent D Certification

**Date:** 2026-06-19  
**Scope:** Payout eligibility determination for funded accounts  
**Schema:** `t_accounts.payout_eligible` column  
**Status:** ⚠️ PARTIALLY IMPLEMENTED

---

## CURRENT STATE

### Database Schema
```sql
-- In t_accounts table (004_terminal_tables.sql)
payout_eligible BOOLEAN DEFAULT FALSE
```

The column exists in the database schema. It defaults to `FALSE`.

### Code Implementation

**Result of full codebase search for `payout_eligible`:** ❌ NO HITS in any `.js` or `.ts` file.

The `payout_eligible` flag is:
- ✅ Defined in the database schema
- ❌ Never read by any service
- ❌ Never set/updated by any service
- ❌ No payout eligibility calculation logic exists
- ❌ No payout request/approval workflow exists
- ❌ No payout lifecycle table exists

---

## EXPECTED PAYOUT ELIGIBILITY LOGIC (Per Prop Firm Standards)

For a funded account to be payout-eligible, ALL must be true:

| # | Requirement | Current Status |
|---|-------------|----------------|
| 1 | Challenge type = `'funded'` | ✅ Type field exists |
| 2 | Account status = `'active'` | ✅ Status field enforced |
| 3 | Profit > 0 (net positive) | ❌ Not checked against payout |
| 4 | Min trading days met | ⚠️ Logic exists in challenge pass but not payout |
| 5 | No active violations | ❌ Not checked for payout |
| 6 | No breaches in payout period | ❌ Not tracked |
| 7 | Minimum payout amount reached | ❌ No minimum defined |
| 8 | Payout cycle timing (bi-weekly/monthly) | ❌ No cycle logic |

---

## WHAT EXISTS vs WHAT'S NEEDED

### What EXISTS (building blocks):
- `challenge.type` = `'evaluation'` or `'funded'` — can distinguish funded accounts
- `account.balance` and `challenge.initial_balance` — can calculate net profit
- `metricsRepo.getTradingDaysCount()` — can verify min days
- `RiskEventRepository.findUnresolved()` — can check for active violations
- `account.status` — can verify no breach
- `AuditRepository.log()` — can log payout requests

### What's MISSING:
1. **Payout calculation service** — No logic to compute eligible payout amount
2. **Profit split logic** — No 80/20 or configurable split
3. **Payout request workflow** — No create/approve/reject/complete flow
4. **Payout history table** — No `t_payouts` table
5. **Payout schedule** — No bi-weekly/monthly cycle enforcement
6. **Withdrawal impact on balance** — No balance deduction on payout

---

## RECOMMENDED IMPLEMENTATION

```javascript
// PayoutService.checkEligibility(accountId) — DOES NOT EXIST YET
static async checkEligibility(accountId) {
  const account = await accountRepo.getWithChallenge(accountId);
  
  // Must be funded type
  if (account.challenge.type !== 'funded') 
    return { eligible: false, reason: 'Not a funded account' };
  
  // Must be active
  if (account.status !== 'active') 
    return { eligible: false, reason: `Account is ${account.status}` };
  
  // Must have net profit
  const profit = account.balance - account.challenge.initial_balance;
  if (profit <= 0) 
    return { eligible: false, reason: 'No net profit' };
  
  // Must meet min trading days
  const tradingDays = await metricsRepo.getTradingDaysCount(accountId);
  const minDays = rules.min_trading_days?.count || 5;
  if (tradingDays < minDays) 
    return { eligible: false, reason: `Need ${minDays - tradingDays} more trading days` };
  
  // No active violations
  const violations = await riskEventRepo.findUnresolved(accountId);
  if (violations.length > 0) 
    return { eligible: false, reason: 'Active violations exist' };
  
  // Calculate payout
  const split = 0.80; // 80% to trader
  const payoutAmount = profit * split;
  
  return { 
    eligible: true, 
    profit,
    payoutAmount,
    traderSplit: split,
    tradingDays,
  };
}
```

---

## GAP ANALYSIS

| Component | Status | Priority |
|-----------|--------|----------|
| `payout_eligible` DB column | ✅ EXISTS | — |
| Payout eligibility service | ❌ MISSING | HIGH |
| Payout request API | ❌ MISSING | HIGH |
| Payout approval workflow | ❌ MISSING | HIGH |
| `t_payouts` table | ❌ MISSING | HIGH |
| Profit split configuration | ❌ MISSING | MEDIUM |
| Payout schedule (cycle) | ❌ MISSING | MEDIUM |
| Balance deduction on payout | ❌ MISSING | HIGH |
| Payout history display | ❌ MISSING | MEDIUM |
| Email/notification on payout | ❌ MISSING | LOW |

---

## WHAT WORKS TODAY

The **pre-conditions** for payout eligibility CAN be checked using existing infrastructure:
1. ✅ Can verify account is funded type
2. ✅ Can calculate net profit (balance - initial)
3. ✅ Can check trading days
4. ✅ Can check for violations
5. ✅ Can audit all actions

The **payout execution** (request → approval → balance deduction → payment) does NOT exist.

---

## VERDICT

**Payout Eligibility Score: 25/100**

- Database column exists but is never used.
- All prerequisite data (profit, days, violations) is available via existing services.
- No payout service, API, or workflow exists.
- No payout table for lifecycle tracking.
- This is a documented gap in the PRODUCTION-GAP-REPORT.md (item #3, priority: 1-2 days effort).
- **Recommendation:** Implement PayoutService with eligibility check, request workflow, and balance deduction before going live with funded accounts.
