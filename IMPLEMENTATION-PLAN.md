# FUNDEDWEALTH TERMINAL — IMPLEMENTATION PLAN

## SCHEMA SUMMARY

### Tables Created (19 terminal-owned)

| # | Table | Replaces | Purpose |
|---|-------|----------|---------|
| 1 | `terminal_traders` | shared `users` | Terminal-owned identity |
| 2 | `terminal_sessions` | shared `sessions` | Terminal-owned auth sessions |
| 3 | `challenge_accounts` | `challenges` | Prop firm lifecycle |
| 4 | `trading_accounts` | `accounts` | Broker connection |
| 5 | `broker_sessions` | NEW | Broker auth state (tokens, heartbeat) |
| 6 | `risk_rules` | `risk_rules` | Per-account configurable rules |
| 7 | `trading_orders` | `orders` | Full order lifecycle + bracket/OCO/basket |
| 8 | `positions` | `positions` | Open/closed with side tracking |
| 9 | `executions` | `trades` | Immutable fill log |
| 10 | `execution_audits` | NEW | Pre/post trade risk check log |
| 11 | `watchlists` | `watchlists` | User watchlists |
| 12 | `account_metrics` | `account_metrics` | Daily P&L snapshots |
| 13 | `risk_events` | NEW | Risk engine event log |
| 14 | `challenge_progress` | NEW | Daily challenge state tracking |
| 15 | `alerts` | NEW | Price alerts |
| 16 | `layouts` | NEW | Workspace/panel configuration |
| 17 | `themes` | NEW | User theme preferences |
| 18 | `journal_entries` | NEW (from zustand) | Trade journal (DB-backed) |
| 19 | `analytics_snapshots` | NEW | Periodic computed analytics |

### Relationships

```
terminal_traders (root)
├── terminal_sessions (1:N)
├── challenge_accounts (1:N)
│   ├── trading_accounts (1:1)
│   │   ├── broker_sessions (1:1)
│   │   ├── risk_rules (1:N)
│   │   ├── trading_orders (1:N)
│   │   │   └── executions (1:N)
│   │   ├── positions (1:N)
│   │   ├── execution_audits (1:N)
│   │   ├── account_metrics (1:N per day)
│   │   └── risk_events (1:N)
│   └── challenge_progress (1:N per day)
├── watchlists (1:N)
├── alerts (1:N)
├── layouts (1:N)
├── themes (1:N)
├── journal_entries (1:N)
└── analytics_snapshots (via trading_account)
```

### Migration Order

Run in sequence (each depends on prior):
1. `001_terminal_schema.sql` — All 19 tables
2. `002_indexes.sql` — All performance indexes
3. `003_rls_policies.sql` — Row-level security

---

## FEATURE GAP CLASSIFICATION

| Feature | Status | Evidence |
|---------|--------|---------|
| Scanner | MISSING | Sidebar icon only, no component or service |
| Heatmap | MISSING | No implementation |
| OCO (One-Cancels-Other) | MISSING | No logic; schema now supports `order_group_type = 'oco'` |
| Basket Orders | MISSING | No implementation; schema supports `order_group_type = 'basket'` |
| Workspace Save/Restore | PARTIAL | Workspace switching exists; no custom save to DB. Schema `layouts` table ready |
| Chart Templates | MISSING | No save/load template mechanism |
| Full Greeks (live computed) | PARTIAL | Types defined, broker provides some. No local Black-Scholes |
| OI Analytics (standalone panel) | MISSING | OI data flows but no dedicated analytics view |
| Strategy Builder | MISSING | No strategy definition, backtest, or automation |
| Time & Sales | MISSING | No tick-by-tick tape |
| Order Flow | MISSING | No cumulative delta, footprint, or order flow |
| 20-Level DOM | MISSING | 5-level exists; 20-level needs Level 3 data |
| Equity Curve | MISSING | Data available in `analytics_snapshots.equity_curve`; no frontend chart |
| Calendar Analytics | MISSING | No calendar component |
| AI Trade Review | MISSING | No AI integration |
| AI Coach | MISSING | No AI integration |
| Multi-Chart Layout | PARTIAL | Type defined (2/4/8); only single renders |
| Bracket Orders (full) | PARTIAL | UI fields exist; not wired to broker adapter |

---

## PHASED IMPLEMENTATION

### PHASE 1 — FINISH PARTIAL FEATURES
*Complete what already has code/types/UI but isn't fully wired.*

| # | Feature | Current State | Work Required |
|---|---------|--------------|---------------|
| 1.1 | Bracket Orders | UI fields + types exist | Wire `target_price`/`stoploss_price` to broker adapter, implement leg management |
| 1.2 | Multi-Chart Layout | Type `'2-chart' | '4-chart' | '8-chart'` defined | Build grid renderer in ChartPanel, independent symbol/timeframe per pane |
| 1.3 | Workspace Save/Restore | Switching works (6 presets) | Persist to `layouts` table, add save/rename/delete UI |
| 1.4 | Full Greeks (local compute) | Types + broker partial data | Add Black-Scholes IV solver, compute delta/gamma/theta/vega client-side |
| 1.5 | GTT/AMO/IOC | Buttons stubbed | Implement AMO (validity='AMO_PENDING'), IOC (validity='IOC'), GTT (new scheduler) |
| 1.6 | Journal → DB persistence | Zustand-only (localStorage) | Migrate to `journal_entries` table, add API endpoints, sync |
| 1.7 | Theme persistence | CSS vars + data-theme | Save to `themes` table, load on session start |

**Estimated scope:** 7 features, moderate complexity. Schema already supports all.

---

### PHASE 2 — BUILD MISSING FEATURES
*Net-new implementations that have no existing code.*

| # | Feature | Description | Dependencies |
|---|---------|-------------|-------------|
| 2.1 | OCO Orders | Place 2 orders, cancel sibling on fill | `trading_orders.order_group_type = 'oco'`, order update WebSocket listener |
| 2.2 | Basket Orders | Multi-leg simultaneous entry | `trading_orders.order_group_type = 'basket'`, batch placement API |
| 2.3 | Equity Curve | P&L line chart over time | `analytics_snapshots.equity_curve` data, lightweight-charts line series |
| 2.4 | Calendar Analytics | Calendar grid, day-color by P&L | `account_metrics` daily data, new `CalendarPanel.tsx` |
| 2.5 | Scanner | Pre-built + custom scans | New `ScannerPanel.tsx`, server `scannerService.js`, criteria engine |
| 2.6 | Heatmap | Sector/index heatmap by change% | New `HeatmapPanel.tsx`, aggregate quote data by sector |
| 2.7 | Time & Sales | Tick-by-tick tape | New `TimeAndSalesPanel.tsx`, subscribe to Mode 3 (full tick) |
| 2.8 | Chart Templates | Save/load indicator + drawing presets | New template CRUD, localStorage + DB hybrid |
| 2.9 | OI Analytics Panel | OI change visualization, PCR | New `OIAnalyticsPanel.tsx`, aggregate from option chain data |
| 2.10 | 20-Level DOM | Extended depth view | Requires Level 3 market data (broker limitation check needed) |

**Estimated scope:** 10 features, high complexity. Schema supports OCO/Basket/Equity/Calendar natively.

---

### PHASE 3 — ENTERPRISE UPGRADES
*Differentiation features. Higher complexity, potential external dependencies.*

| # | Feature | Description | Complexity |
|---|---------|-------------|-----------|
| 3.1 | Order Flow (Cumulative Delta) | Tick-by-tick buy/sell pressure | Requires trade-level data classification (uptick/downtick) |
| 3.2 | Footprint Chart | Volume @ price per candle | Needs tick-level aggregation engine |
| 3.3 | Strategy Builder | Visual rule builder → auto-execute | Rule DSL, condition engine, auto-order placement |
| 3.4 | AI Trade Review | LLM reviews trade journal entries | OpenAI/Claude API integration, prompt engineering |
| 3.5 | AI Coach | Context-aware trading suggestions | Historical pattern matching + LLM, risk-aware |
| 3.6 | Advanced Greeks Dashboard | IV surface, skew chart, term structure | Multi-expiry option chain aggregation, 3D visualization |
| 3.7 | Multi-Broker Simultaneous | Trade same account on 2+ brokers | Failover already exists; needs unified position tracking |
| 3.8 | Custom Indicator Builder | User-defined Pine-like scripting | Formula parser, sandbox execution, chart overlay |
| 3.9 | Social/Copy Trading | Follow other traders' positions | New social layer, position mirroring engine |
| 3.10 | Performance Certificates | PDF generation for challenge completion | PDF renderer, template system |

**Estimated scope:** 10 features, very high complexity. External API dependencies for AI features.

---

## SCHEMA MIGRATION PATH

### From Current → New

| Old Table | New Table | Migration Strategy |
|-----------|-----------|-------------------|
| `users` | `terminal_traders` | Copy `fw_user_id` → `external_id`, `email`, `name` → `display_name` |
| `sessions` | `terminal_sessions` | Copy active sessions, add `is_active`, `device_fingerprint` |
| `challenges` | `challenge_accounts` | Add `current_balance`, `peak_balance`, rule percentages |
| `accounts` | `trading_accounts` | Add `available_margin`, `used_margin`, `locked_at` |
| `orders` | `trading_orders` | Add bracket/OCO/group fields, `validity`, `is_amo` |
| `positions` | `positions` | Add `side`, `is_open`, `unrealized_pnl`, `margin_used` |
| `trades` | `executions` | Rename, add `position_id`, `broker_trade_id` |
| `watchlists` | `watchlists` | Add `icon`, `is_default` |
| `account_metrics` | `account_metrics` | Add `challenge_id`, `gross_profit/loss`, `profit_factor` |
| `risk_rules` | `risk_rules` | Rename FK `account_id` → `trading_account_id` |
| — | `broker_sessions` | NEW — extract from broker adapter state |
| — | `execution_audits` | NEW — backfill from risk engine logs |
| — | `risk_events` | NEW — backfill from event bus history |
| — | `challenge_progress` | NEW — compute from `account_metrics` |
| — | `alerts` | NEW — migrate from frontend localStorage |
| — | `layouts` | NEW — migrate from zustand persist |
| — | `themes` | NEW — seed system themes |
| — | `journal_entries` | NEW — migrate from journalStore localStorage |
| — | `analytics_snapshots` | NEW — compute on first run |

### Shared Dependency Removal

| Removed Dependency | Replacement |
|-------------------|-------------|
| Shared `users` table | `terminal_traders` — populated on SSO exchange |
| Shared `sessions` table | `terminal_sessions` — terminal-managed JWT lifecycle |
| Dashboard DB read access | SSO token carries all needed identity claims |
| Any cross-DB foreign keys | `external_id` as opaque reference (no FK) |

---

## FILES GENERATED

```
server/db/migrations/
├── 001_terminal_schema.sql    (19 tables, full DDL)
├── 002_indexes.sql            (80+ indexes, partial/conditional)
└── 003_rls_policies.sql       (19 tables, user-scoped policies)
```

---

## EXECUTION PRIORITY

```
IMMEDIATE (before any feature work):
  → Run 001 → 002 → 003 migrations
  → Update repositories to reference new table names
  → Update SSO service to create terminal_traders on first login
  → Migrate session service to terminal_sessions

PHASE 1 (2-3 weeks):
  → 7 partial features completed
  → All existing functionality preserved

PHASE 2 (4-6 weeks):
  → 10 new features built
  → Terminal feature parity with institutional platforms

PHASE 3 (8-12 weeks):
  → 10 enterprise features
  → Market differentiation
```
