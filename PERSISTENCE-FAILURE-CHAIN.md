# PERSISTENCE FAILURE CHAIN — Phase C4

## Date: 2026-06-19

---

## EXACT FAILURE PATH

```
Frontend: OrderPanel.handleSubmit('BUY')
  ↓
  placeOrder({ symbol:'RELIANCE', token:'2885', segment:'NSE', side:'BUY', 
               orderType:'MARKET', productType:'MIS', qty:1 })
  ↓
API: POST /api/orders/place
  ↓ requireAuth → req.user = { accountId: 'dev-account' }
  ↓ requirePermission('trade') → PASS
  ↓
AccountService.placeOrder('dev-account', params)
  ↓
  supabase.from('t_orders').insert({...}).select().single()
  ↓
  ❌ ERROR: "Could not find the table 'public.t_orders' in the schema cache"
  ↓
  FALLBACK: error.message.includes('schema cache') → in-memory store
  ↓
  memOrders.set(orderId, order)  // stored in RAM only
  ↓
  eventBus.publish('order.created', {...})  ✓
  ↓
  _executeOrderAsync(accountId, orderId, params)
    ↓
    this.getAccount('dev-account') → returns dev bypass object ✓
    ↓
    executionService.executeOrder(accountId, orderId, params, account)
      ↓
      ──── Step 1: Risk Validation ────
      RiskEngine.validateOrder(accountId, params, quoteProvider)
        ↓
        riskRulesRepo.getRulesMap(accountId)
          ↓
          supabase.from('t_risk_rules').select('*').eq('account_id', 'dev-account')
          ↓
          ❌ "Could not find the table 'public.t_risk_rules' in the schema cache"
          ↓
          THROWS → caught by try/catch in executeOrder
          ↓
          riskResult = { allowed: true }  // bypass: no rules = no restrictions
      ↓
      ──── Step 2: Route to Broker ────
      BrokerFactory.create('angelone')
        ↓
        AngelOneAdapter.connect() → TOTP login → ✓ Connected
        ↓
        adapter.placeOrder({...}) → calls Angel One SmartAPI ✓
        ↓
        brokerResponse = { orderId: 'XXXXX', status: 'PENDING' }
      ↓
      ──── Step 3: Handle Response (MARKET order → _handleMarketFill) ────
      ↓
      ──── Step 4: Mark Order FILLED ────
      orderRepo.markFilled(orderId, filledQty, fillPrice, brokerOrderId)
        ↓
        BaseRepository.update(orderId, { status: 'FILLED', ... })
          ↓
          supabase.from('t_orders').update({...}).eq('id', orderId).select().single()
          ↓
          ❌ "Could not find the table 'public.t_orders' in the schema cache"
          ↓
          CAUGHT: if (!dbErr.message?.includes('schema cache')) → silent skip
      ↓
      eventBus.publish('order.updated', { status: 'FILLED', ... }) ✓
      ↓
      ──── Step 5: Update Position ────
      positionRepo.upsertPosition(accountId, {...})
        ↓
        findOpenPosition() → supabase.from('t_positions').select(...)
          ↓
          ❌ "Could not find the table 'public.t_positions' in the schema cache"
          ↓
          CAUGHT: silent skip
      ↓
      ──── Step 6: Record Trade ────
      tradeRepo.recordTrade(accountId, orderId, {...})
        ↓
        BaseRepository.insert({...})
          ↓
          supabase.from('t_trades').insert({...}).select().single()
          ↓
          ❌ "Could not find the table 'public.t_trades' in the schema cache"
          ↓
          CAUGHT: silent skip
      ↓
      ──── Step 7: Post-Trade Risk Check ────
      RiskEngine.postTradeCheck(accountId, quoteProvider)
        ↓
        ❌ t_risk_rules missing → CAUGHT: silent skip
      ↓
      RETURN { orderId, status: 'FILLED', brokerOrderId, avgPrice, filledQty }
```

---

## FAILURE SUMMARY

| Step | Operation | Table | Result |
|------|-----------|-------|--------|
| placeOrder | INSERT order | `t_orders` | ❌ FAILS → in-memory fallback |
| executeOrder Step 1 | Risk rules query | `t_risk_rules` | ❌ FAILS → bypassed |
| executeOrder Step 2 | Broker call | N/A | ✓ WORKS |
| executeOrder Step 4 | UPDATE order FILLED | `t_orders` | ❌ FAILS → silent skip |
| executeOrder Step 5 | INSERT/UPDATE position | `t_positions` | ❌ FAILS → silent skip |
| executeOrder Step 6 | INSERT trade | `t_trades` | ❌ FAILS → silent skip |
| executeOrder Step 7 | Post-trade risk | `t_risk_rules` | ❌ FAILS → silent skip |
| EventDispatcher | INSERT audit | `t_order_audit` | ❌ FAILS → logged error |

---

## WHY getOrders() RETURNS EMPTY

```
AccountService.getOrders('dev-account')
  ↓
  supabase.from('t_orders').select('*').eq('account_id', 'dev-account')
  ↓
  error: "Could not find the table 'public.t_orders' in the schema cache"
  ↓
  if (error || !data) return []  ← RETURNS EMPTY
```

The in-memory `memOrders` Map is never queried by `getOrders()` — it only reads from Supabase.

---

## FIX REQUIRED

**The ONLY fix is to create the tables in Supabase.**

Once tables exist:
1. `placeOrder()` will INSERT into real `t_orders` table → returns real UUID
2. `markFilled()` will UPDATE the order → status = FILLED
3. `upsertPosition()` will INSERT into `t_positions` → position tracked
4. `recordTrade()` will INSERT into `t_trades` → trade recorded
5. `getOrders()`/`getPositions()`/`getTrades()` will query real data

The code is correct. The infrastructure is not deployed.
