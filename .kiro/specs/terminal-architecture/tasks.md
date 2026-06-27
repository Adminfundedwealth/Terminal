# Implementation Tasks

## Phase 1: Database Foundation
- [ ] 1. Write `server/db/final-migration.sql` with all `terminal_*` tables using schemas from design document
- [ ] 2. Run migration against production Supabase (manual SQL editor execution)
- [ ] 3. Verify all 15 `terminal_*` tables exist using `server/db/supabase-reality-check.js`

## Phase 2: Repository Alignment
- [ ] 4. Update all 13 repository `super()` constructors to `terminal_*` table names
- [ ] 5. Update all direct `.from()` calls in 6 service files + 1 cron file to `terminal_*` names
- [ ] 6. Fix `position.repository.js` to use `account_id` consistently instead of `user_id`
- [ ] 7. Verify all repositories connect to correct tables with `server/test-tables.js`

## Phase 3: SSO Fix
- [ ] 8. Change `sso.service.js` user lookup from `.eq('fw_user_id', sub)` to `.eq('id', sub)`
- [ ] 9. Change `sso.service.js` account lookup from `trading_accounts` to `terminal_accounts`
- [ ] 10. Change `session.service.js` from `sessions` to `terminal_sessions` (4 occurrences)
- [ ] 11. Configure `SSO_SHARED_SECRET` and `JWT_SECRET` in production environment
- [ ] 12. Coordinate with Dashboard team to send `users.id` UUID as `sub` claim in SSO token

## Phase 4: Account Provisioning
- [ ] 13. Create `server/routes/admin.routes.js` with `POST /admin/provision` endpoint
- [ ] 14. Implement provisioning logic: create challenge + account + seed risk rules
- [ ] 15. Mount admin routes in `server/index.js` with `ADMIN_SECRET` auth guard
- [ ] 16. Backfill existing 17 paid orders via admin provisioning endpoint
- [ ] 17. Wire Dashboard to call `/admin/provision` on payment confirmation

## Phase 5: Broker Credentials
- [ ] 18. Configure Angel One credentials in production server environment
- [ ] 19. Verify SmartStream WebSocket connects and live quotes flow to frontend
- [ ] 20. Verify historical candles load in chart panel
- [ ] 21. Verify option chain and market depth return real data

## Phase 6: End-to-End Trading Test
- [ ] 22. Place one test MARKET order and verify full pipeline (order → position → trade)
- [ ] 23. Verify risk engine rejects orders outside trading hours
- [ ] 24. Verify daily loss limit locks account correctly
- [ ] 25. Verify challenge pass/fail transitions fire correctly

## Phase 7: Production Hardening
- [ ] 26. Replace in-memory nonce Set with Redis SETNX for SSO replay protection
- [ ] 27. Remove `DEV_BYPASS_AUTH` and dev endpoints from production build
- [ ] 28. Enable RLS policies on all `terminal_*` tables
- [ ] 29. Set up monitoring alerts for feed disconnects, order failures, account breaches
