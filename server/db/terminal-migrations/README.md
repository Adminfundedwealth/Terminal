# Terminal Database Migration Package

**Date:** 2026-06-20  
**Status:** Files generated. No deployment. No execution.

---

## Package Contents

### Migration Files (run individually in order)

| File | Phase | Table(s) |
|---|---|---|
| `001_terminal_users.sql` | 1 | `terminal_users` |
| `002_challenges.sql` | 2 | `challenges` |
| `003_terminal_sessions.sql` | 2 | `terminal_sessions` |
| `004_watchlists.sql` | 2 | `watchlists` |
| `005_terminal_accounts.sql` | 3 | `terminal_accounts` |
| `006_risk_rules.sql` | 4 | `risk_rules` |
| `007_account_metrics.sql` | 4 | `account_metrics` |
| `008_terminal_orders.sql` | 4 | `terminal_orders` |
| `009_terminal_positions.sql` | 4 | `terminal_positions` |
| `010_audit_log.sql` | 4 | `audit_log` |
| `011_risk_events.sql` | 4 | `risk_events` |
| `012_broker_sessions.sql` | 4 | `broker_sessions` |
| `013_payouts.sql` | 4 | `payouts` |
| `014_terminal_trades.sql` | 5 | `terminal_trades` |
| `015_order_audit.sql` | 5 | `order_audit` |
| `016_challenge_metrics.sql` | 5 | `challenge_metrics` |
| `017_triggers_and_rls.sql` | 6 | Triggers + RLS |

### Combined Files

| File | Purpose |
|---|---|
| `MASTER_MIGRATION.sql` | Single file with ALL tables, indexes, triggers, RLS in a transaction |
| `VALIDATION.sql` | Post-migration verification queries |
| `ROLLBACK.sql` | Complete teardown (removes all 16 terminal tables) |

### Documentation

| File | Purpose |
|---|---|
| `REPOSITORY_MAPPINGS.md` | Code changes needed in repositories and services |
| `ENV_CONFIGURATION.md` | Environment variables required for database connection |
| `README.md` | This file |

---

## Usage

### Option A: Run the single master file
```
Supabase Dashboard → SQL Editor → Paste MASTER_MIGRATION.sql → Run
```

### Option B: Run individual migrations in order
```
Run 001 through 017 sequentially in Supabase SQL Editor
```

### After Migration
```
Run VALIDATION.sql to confirm all tables, FKs, indexes, triggers, and RLS
```

### If Something Goes Wrong
```
Run ROLLBACK.sql to cleanly remove all terminal tables
```

---

## What This Does NOT Touch

- `users` table (platform authentication)
- `orders` table (platform payment records)
- `sessions` table (platform auth sessions)
- `kyc_*` tables (KYC verification)
- Website code
- Admin code

---

## FK Dependency Chain

```
users (platform, existing)
  └── terminal_users
        ├── challenges
        │     └── terminal_accounts
        │           ├── risk_rules
        │           ├── account_metrics
        │           ├── terminal_orders
        │           │     ├── terminal_trades
        │           │     └── order_audit
        │           ├── terminal_positions
        │           ├── risk_events
        │           ├── challenge_metrics
        │           ├── broker_sessions
        │           └── payouts
        ├── terminal_sessions
        └── watchlists
```
