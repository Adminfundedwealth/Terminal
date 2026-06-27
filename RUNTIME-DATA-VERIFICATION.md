# RUNTIME DATA VERIFICATION

Server started: `node server/index.js`  
Supabase: NOT CONNECTED (env vars not set)  
Broker Adapter: NOT CONNECTED  

---

## SERVER STARTUP CONSOLE OUTPUT

```
[Supabase] WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set. Database features disabled.
[WebSocket] Server initialized
[FW] port 4000
[FW] DB: Environment variables not set
```

---

## HEALTH CHECK

```
GET http://localhost:4000/health
200 OK
{
  "status": "ok",
  "database": { "connected": false, "reason": "Environment variables not set" },
  "marketData": {
    "isLive": false,
    "adapterConnected": false,
    "adapterName": null,
    "subscribedTokens": 0,
    "cachedQuotes": 0
  }
}
```

---

## API ENDPOINT RESPONSES (RUNTIME)

### /api/account
```
500
{"message":"[accounts] Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY."}
```
**Source:** `server/services/accountService.js` → `AccountRepository` → `BaseRepository.db` getter throws  
**Database query attempted:** `supabase.from('accounts').select('*, challenge:challenges(*)').eq('id', 'dev-account')`  
**Fallback used:** NONE — throws error  

### /api/positions
```
500
{"message":"[positions] Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY."}
```
**Source:** `server/services/accountService.js` → `PositionRepository.findOpenByAccountId()`  
**Database query attempted:** `supabase.from('positions').select('*').eq('account_id','dev-account').is('closed_at', null)`  
**Fallback used:** NONE — throws error  

### /api/orders
```
500
{"message":"[orders] Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY."}
```
**Source:** `server/services/accountService.js` → `OrderRepository.findTodayOrders()`  
**Database query attempted:** `supabase.from('orders').select('*').eq('account_id','dev-account').gte('placed_at', today)`  
**Fallback used:** NONE — throws error  

### /api/trades
```
500
{"message":"[trades] Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY."}
```
**Source:** `server/services/accountService.js` → `TradeRepository.findByPeriod()`  
**Database query attempted:** `supabase.from('trades').select('*').eq('account_id','dev-account').gte('executed_at', from)`  
**Fallback used:** NONE — throws error  

### /api/market/depth?token=2885
```
200
{"bids":[],"asks":[],"totalBuyQty":0,"totalSellQty":0}
```
**Source:** `server/services/marketDataEngine.js` → `getDepth('2885')` → no cached data  
**Broker adapter called:** NO (adapter is null)  
**Fallback used:** Returns empty structure `{ bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 }`  

### /api/market/option-chain?symbol=NIFTY&expiry=2026-06-25
```
200
[]
```
**Source:** `server/services/marketDataEngine.js` → `getOptionChain('NIFTY', '2026-06-25')` → adapter is null  
**Broker adapter called:** NO  
**Fallback used:** Returns `[]` (empty array)  

### /api/market/history?token=2885&tf=5
```
200
[]
```
**Source:** `server/services/marketDataEngine.js` → `getHistoricalData('2885', '5')` → adapter is null  
**Broker adapter called:** NO  
**Fallback used:** Returns `[]` (empty array)  

### /api/instruments/search?q=reli
```
200
[{"token":"2885","symbol":"RELIANCE","name":"Reliance Industries Ltd","segment":"NSE","instrumentType":"EQ","exchange":"NSE","lotSize":1,"tickSize":0.05},{"token":"REL_FUT","symbol":"RELIANCE FUT","name":"Reliance Futures Jun 2026","segment":"NFO",...}]
```
**Source:** `server/services/instrumentService.js` → `search('reli')`  
**Data source:** Static array in `instrumentService.js` (55 instruments hardcoded)  
**Database query:** NONE — this is a static in-memory list  

---

## WORKSPACE BEHAVIOR (All Workspaces)

All workspaces (INDEX, STOCKS, FUTURES, OPTIONS, MCX, CDS) trigger the same API calls:

| Action | Endpoint | Response |
|--------|----------|----------|
| Load workspace | Frontend sets `activeSymbol` from `appStore.ts` `workspaceDefaults` | No API call — local store |
| Subscribe quotes | WebSocket `subscribe {tokens: [token]}` | Accepted, but no data flows (no adapter) |
| Load chart | `GET /api/market/history?token={x}&tf=5` | `[]` |
| Load positions | `GET /api/positions` | `500` (no Supabase) |
| Load orders | `GET /api/orders` | `500` (no Supabase) |
| Load trades | `GET /api/trades` | `500` (no Supabase) |

---

## WHAT EACH VISIBLE WIDGET ACTUALLY SHOWS RIGHT NOW

| Widget | Source | Runtime Data |
|--------|--------|--------------|
| **Chart** | `src/components/ChartPanel.tsx` → calls `/api/market/history` → gets `[]` → calls `generateDemoData()` → returns `[]` | **Empty chart — no candles** |
| **Market Depth** | `src/components/MarketDepthPanel.tsx` → WebSocket depth subscription → no data → `generateDemoDepth()` → returns `{ bids:[], asks:[] }` | **Empty depth panel** |
| **Option Chain** | `src/components/OptionChainModal.tsx` → calls `/api/market/option-chain` → gets `[]` → calls `generateDemoOC()` → returns `[]` | **Empty option chain** |
| **Positions** | `src/components/BottomPanel.tsx` → calls `/api/positions` → gets 500 → `.catch(() => [])` | **Empty positions tab** |
| **Orders** | `src/components/BottomPanel.tsx` → calls `/api/orders` → gets 500 → `.catch(() => [])` | **Empty orders tab** |
| **Tradebook** | `src/components/BottomPanel.tsx` → calls `/api/trades` → gets 500 → `.catch(() => [])` | **Empty trades tab** |
| **Account header** | `src/hooks/useAuth.ts` → calls `/api/account` → gets 500 → treated as network error → allows through | **Shows "—" for account code, ₹0 for balance** |
| **Watchlists** | `src/store/appStore.ts` → `defaultWatchlists` hardcoded in zustand, persisted to localStorage | **Shows static watchlist symbols, NO live prices** |
| **Analytics** | `src/components/AnalyticsPanel.tsx` → `const analyticsData = {...}` hardcoded | **Shows fake KPIs (winRate: 62.5%, etc.)** |
| **Search** | `src/components/SearchModal.tsx` → calls `/api/instruments/search` → gets real data from `instrumentService.js` → shows results. On error falls back to `DEMO_INSTRUMENTS` | **Works — shows real instrument list from server** |

---

## REMAINING STATIC/HARDCODED DATA IN RUNTIME

| # | File | Line | Content | Type |
|---|------|------|---------|------|
| 1 | `src/components/AnalyticsPanel.tsx` | 5 | `const analyticsData = { winRate: 62.5, profitFactor: 1.85, expectancy: 1250, ... }` | **HARDCODED DISPLAY** — never calls any API |
| 2 | `src/store/appStore.ts` | 48 | `const defaultWatchlists: Watchlist[] = [...]` — 6 watchlists, 38 symbols | **HARDCODED INITIAL STATE** — frontend never calls `GET /api/watchlists` |
| 3 | `src/store/appStore.ts` | 81 | `const workspaceDefaults` — default symbol per workspace | **HARDCODED** — determines which symbol loads on workspace switch |
| 4 | `src/components/SearchModal.tsx` | 18 | `const DEMO_INSTRUMENTS` — 20 instruments | **OFFLINE FALLBACK** — used when API fails or before first keystroke |
| 5 | `server/services/instrumentService.js` | all | `loadInstruments()` — 55 static instruments | **STATIC SERVER DATA** — not downloaded from broker |
| 6 | `server/middleware/auth.js` | 25 | Dev bypass: `req.user = { userId: 'dev-user', accountId: 'dev-account', ... }` | **DEV BYPASS** — skips auth when no Supabase configured |

---

## Math.random / mock / demo / hardcoded / fallback — RUNTIME OCCURRENCES

### Math.random()
**Zero functional occurrences** in any server or src file.  
Confirmed via: `Select-String -Path server/**/*.js,src/**/*.ts,src/**/*.tsx -Pattern "Math.random"` → 0 results in functional code.

### "mock"
Zero occurrences in functional code.

### "demo"
| File | Line | Context |
|------|------|---------|
| `src/components/SearchModal.tsx` | 18 | `DEMO_INSTRUMENTS` — static fallback array (no randomness) |
| `src/components/ChartPanel.tsx` | 105 | `generateDemoData(500)` — **returns `[]`** (empty) |
| `src/components/OptionChainModal.tsx` | 34 | `generateDemoOC(atm)` — **returns `[]`** (empty) |
| `src/components/MarketDepthPanel.tsx` | 16 | `generateDemoDepth(...)` — **returns `{ bids:[], asks:[] }`** (empty) |
| `src/components/AnalyticsPanel.tsx` | 5 | `// Demo analytics data` comment + hardcoded const |

### "hardcoded"
| File | Line | Context |
|------|------|---------|
| `server/services/accountService.js` | 4 | Comment: `Replaces all demo/hardcoded data` |
| `server/middleware/auth.js` | — | Dev bypass injects hardcoded `userId: 'dev-user'` |

### "fallback"
| File | Context |
|------|---------|
| `src/components/SearchModal.tsx` | Falls back to `DEMO_INSTRUMENTS` on API error |
| `src/components/ChartPanel.tsx` | Falls back to `generateDemoData()` → `[]` |
| `src/components/OptionChainModal.tsx` | Falls back to `generateDemoOC()` → `[]` |
| `src/components/MarketDepthPanel.tsx` | Falls back to `generateDemoDepth()` → `{}` |

---

## FACTS

1. Server starts and runs on port 4000.
2. No `Math.random()` executes anywhere at runtime.
3. `/api/account`, `/api/positions`, `/api/orders`, `/api/trades` all return `500` because Supabase is not connected — they do NOT return fake data.
4. `/api/market/depth`, `/api/market/option-chain`, `/api/market/history` all return empty (`[]` or `{bids:[],asks:[]}`) because no broker adapter is connected — they do NOT generate random data.
5. `/api/instruments/search` returns real static data from `instrumentService.js`.
6. Frontend fallback functions (`generateDemoData`, `generateDemoOC`, `generateDemoDepth`) all return EMPTY — they no longer generate random values.
7. Two frontend files still display hardcoded static values: `AnalyticsPanel.tsx` (fake KPIs) and `appStore.ts` (default watchlists). These are NOT connected to any API.
8. Auth middleware has a dev bypass that injects `dev-user`/`dev-account` when Supabase is not configured.
