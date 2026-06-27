# ACTUAL DATA SOURCE REPORT

Based on codebase search. No browser needed — server is not running (no Supabase connected).

---

## API RESPONSES (Current Behavior)

Since `SUPABASE_URL` is not set, the Supabase client is `null`. All repository calls will throw `"Supabase not configured"`. Auth middleware will reject with 401 (no JWT cookie).

| Endpoint | Current Response | Reason |
|----------|-----------------|--------|
| `GET /api/account` | `401 { error: 'unauthorized' }` | No JWT cookie — auth middleware rejects |
| `GET /api/positions` | `401 { error: 'unauthorized' }` | Same |
| `GET /api/orders` | `401 { error: 'unauthorized' }` | Same |
| `GET /api/trades` | `401 { error: 'unauthorized' }` | Same |
| `GET /api/market/depth?token=X` | `{ bids: [], asks: [], totalBuyQty: 0, totalSellQty: 0 }` | Public endpoint, no broker adapter connected |
| `GET /api/market/option-chain?symbol=NIFTY&expiry=X` | `[]` | Public endpoint, no broker adapter connected |
| `GET /api/market/history?token=X&tf=5` | `[]` | Public endpoint, no broker adapter connected |
| `GET /api/instruments/search?q=rel` | `[{token:'2885', symbol:'RELIANCE', ...}]` | Static list in `instrumentService.js` — always works |

---

## EVERY VISIBLE ITEM ON SCREEN — EXACT SOURCE

### 1. CHART (Candlestick / Line)

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Candle data | `src/components/ChartPanel.tsx` line 102 | `GET /api/market/history?token={token}&tf={timeframe}` | `marketDataEngine.getHistoricalData()` |
| Fallback on error | `src/components/ChartPanel.tsx` line 105 | — | `generateDemoData()` → returns `[]` (empty) |
| Chart rendering | `src/components/ChartPanel.tsx` | `lightweight-charts` library | Above data |

**What user sees when no broker:** Empty chart area (no candles rendered).

---

### 2. DOM (Market Depth / Level 2)

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Live depth via WS | `src/hooks/useMarketData.ts` → `useDepth()` | WebSocket `subscribe_depth` | `marketDataEngine` → broker adapter |
| Fallback | `src/components/MarketDepthPanel.tsx` line 16 | — | `generateDemoDepth()` → returns `{ bids: [], asks: [] }` |
| Display | `src/components/MarketDepthPanel.tsx` | — | Above data |

**What user sees when no broker:** Empty depth panel (no bids/asks).

---

### 3. POSITIONS

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Fetch | `src/components/BottomPanel.tsx` line 23 | `GET /api/positions` | `accountService.getPositions(accountId)` → `positionRepo.findOpenByAccountId()` → Supabase `positions` table |
| Fallback on error | `src/components/BottomPanel.tsx` line 24 | — | `.catch(() => [])` — empty array |
| Store | `src/store/tradingStore.ts` | — | `setPositions(posData)` |
| LTP enrichment | `server/services/accountService.js` line 88 | — | `marketDataEngine.getQuote(token)` → broker adapter |

**What user sees when no Supabase:** Empty positions tab. When Supabase connected but no trades: Empty positions tab.

---

### 4. ORDERS

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Fetch | `src/components/BottomPanel.tsx` line 24 | `GET /api/orders` | `accountService.getOrders(accountId)` → `orderRepo.findTodayOrders()` → Supabase `orders` table |
| Fallback on error | `src/components/BottomPanel.tsx` line 24 | — | `.catch(() => [])` — empty array |
| Store | `src/store/tradingStore.ts` | — | `setOrders(ordData)` |

**What user sees when no Supabase:** Empty orders tab.

---

### 5. TRADEBOOK

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Fetch | `src/components/BottomPanel.tsx` line 25 | `GET /api/trades?period={today\|week\|month}` | `accountService.getTrades(accountId, period)` → `tradeRepo.findByPeriod()` → Supabase `trades` table |
| Fallback on error | `src/components/BottomPanel.tsx` line 25 | — | `.catch(() => [])` — empty array |
| Store | `src/store/tradingStore.ts` | — | `setTrades(trdData)` |

**What user sees when no Supabase:** Empty trades tab.

---

### 6. RISK (Analytics Panel)

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| All KPIs | `src/components/AnalyticsPanel.tsx` line 5 | **NONE** — hardcoded const | `const analyticsData = { winRate: 62.5, profitFactor: 1.85, ... }` |
| Should come from | — | `GET /api/account/challenge` | `ChallengeService.getProgress()` → Supabase |

**STATUS: HARDCODED. Not connected to any API.** This is the one remaining static fake display.

---

### 7. WATCHLISTS (Left Panel)

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Initial data | `src/store/appStore.ts` line 48 | **NONE on first load** | `const defaultWatchlists` — hardcoded in zustand store, persisted to localStorage |
| API available | — | `GET /api/watchlists` | `watchlistRepo.findByUserId()` → Supabase `watchlists` table |
| Symbols rendering | `src/components/Watchlist.tsx` | — | From store, LTP from WebSocket |

**STATUS: Frontend uses localStorage-persisted defaults. Server API is wired to Supabase but frontend does NOT call `GET /api/watchlists` yet — it uses zustand+localStorage.**

---

### 8. OPTION CHAIN

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Fetch | `src/components/OptionChainModal.tsx` line 61 | `GET /api/market/option-chain?symbol={sym}&expiry={exp}` | `marketDataEngine.getOptionChain()` → broker adapter |
| Fallback on error | `src/components/OptionChainModal.tsx` line 64 | — | `generateDemoOC()` → returns `[]` (empty) |

**What user sees when no broker:** Empty option chain (no strikes displayed).

---

### 9. SEARCH MODAL

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Search query | `src/components/SearchModal.tsx` line 68 | `GET /api/instruments/search?q={query}&segment={seg}` | `instrumentService.search()` — static array |
| Fallback on error | `src/components/SearchModal.tsx` line 72 | — | `DEMO_INSTRUMENTS.filter()` — same static list client-side |
| On open (no query) | `src/components/SearchModal.tsx` line 54 | — | `DEMO_INSTRUMENTS.slice(0, 10)` |

**STATUS: Both server and client have the same static instrument list. Server always responds (no auth needed). Client fallback is redundant but harmless.**

---

### 10. ACCOUNT HEADER (Balance/Margin/P&L)

| Attribute | Source File | API Endpoint | Data Source |
|-----------|-------------|--------------|-------------|
| Fetch | `src/hooks/useAuth.ts` line 38 | `GET /api/account` | `accountService.getAccount(accountId)` → Supabase `accounts` + `challenges` tables |
| Display | `src/components/TopBar.tsx` line 135 | — | `account.balance`, `account.availableMargin`, `account.totalPnl` |
| On auth failure | `src/hooks/useAuth.ts` line 51 | — | Redirects to dashboard URL |

**What user sees when no Supabase:** Redirect to dashboard (auth fails → no account data → redirect).

---

## SUMMARY: FILES WITH REMAINING NON-API DATA

| # | File | Static Data | Connected to API? |
|---|------|-------------|-------------------|
| 1 | `src/components/AnalyticsPanel.tsx` | `analyticsData` — 14 hardcoded KPIs | ❌ NO — needs to call `/api/account/challenge` |
| 2 | `src/store/appStore.ts` | `defaultWatchlists` — 6 lists with 38 symbols | ❌ NO — needs to call `/api/watchlists` on mount |
| 3 | `src/components/SearchModal.tsx` | `DEMO_INSTRUMENTS` — 20 instruments | ⚠️ PARTIAL — server always works, this is just offline fallback |
| 4 | `server/services/instrumentService.js` | Static 55-instrument array | ✅ YES — this IS the API data source (acceptable until broker daily file download) |

---

## FILES WITH ZERO REMAINING FAKE DATA

| File | Status |
|------|--------|
| `server/services/marketDataEngine.js` | ✅ Clean — returns empty, waits for adapter |
| `server/routes/api.js` | ✅ Clean — all routes use AccountService + Supabase |
| `server/services/accountService.js` | ✅ Clean — all queries hit Supabase |
| `server/services/riskEngine.js` | ✅ Clean — reads rules from DB |
| `server/services/challengeService.js` | ✅ Clean — reads challenge from DB |
| `server/index.js` | ✅ Clean — no BrokerService, no simulation |
| `src/components/ChartPanel.tsx` | ✅ Clean — `generateDemoData()` returns `[]` |
| `src/components/OptionChainModal.tsx` | ✅ Clean — `generateDemoOC()` returns `[]` |
| `src/components/MarketDepthPanel.tsx` | ✅ Clean — `generateDemoDepth()` returns empty |
| `src/components/BottomPanel.tsx` | ✅ Clean — fetches from API, `.catch(() => [])` |
| `src/components/OrderPanel.tsx` | ✅ Clean — calls `POST /api/orders/place` |
