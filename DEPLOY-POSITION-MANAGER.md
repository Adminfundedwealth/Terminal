# Position Manager Deployment Checklist

## 🚀 Deployment Steps (Production)

### Pre-Deployment Verification

```bash
# 1. Pull latest code
git pull origin main

# 2. Verify all files present
ls src/components/chart/Position*.tsx
ls server/db/terminal-migrations/015_*.sql

# 3. Check TypeScript compilation
npx tsc --noEmit
# Expected: No errors

# 4. Check for any lint issues (optional)
npm run lint
```

---

## 📊 Database Migration (CRITICAL)

**⚠️ Run this BEFORE deploying new code**

### Option 1: Manual Migration (Recommended for Production)

```bash
# Connect to production database
psql -U your_user -h your_host -d your_database

# Run migration
\i server/db/terminal-migrations/015_positions_add_sl_tp.sql

# Verify columns added
\d terminal_positions

# Expected output should include:
# - stop_loss (numeric)
# - take_profit (numeric)
# - trailing_stop (numeric)
# - break_even_activated (boolean)
```

### Option 2: Automated Migration Script

```bash
# If you have a migration runner
node server/db/migrate.js
```

### Rollback Plan (If Issues Occur)

```sql
-- Rollback migration (removes columns)
ALTER TABLE terminal_positions
DROP COLUMN IF EXISTS stop_loss,
DROP COLUMN IF EXISTS take_profit,
DROP COLUMN IF EXISTS trailing_stop,
DROP COLUMN IF EXISTS break_even_activated;

DROP INDEX IF EXISTS idx_positions_sl_tp;
```

---

## 🔧 Server Deployment

### Railway / Vercel / Standard Node Deployment

```bash
# 1. Build application
npm run build

# 2. Restart server
npm run server
# OR if using PM2:
pm2 restart all

# 3. Monitor logs for errors
tail -f logs/server.log
# OR
pm2 logs
```

### Docker Deployment

```bash
# Rebuild container
docker-compose down
docker-compose build
docker-compose up -d

# Check logs
docker-compose logs -f server
```

### Railway Specific

```bash
# Push to main triggers auto-deploy
git push origin main

# Monitor deployment at:
# https://railway.app/project/YOUR_PROJECT/deployments
```

---

## ✅ Post-Deployment Verification

### 1. Health Check

```bash
# Check server is responding
curl https://your-domain.com/api/terminal/status

# Expected: 200 OK with JSON response
```

### 2. Database Verification

```sql
-- Check columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'terminal_positions' 
  AND column_name IN ('stop_loss', 'take_profit');

-- Check index exists
SELECT indexname FROM pg_indexes 
WHERE tablename = 'terminal_positions' 
  AND indexname = 'idx_positions_sl_tp';
```

### 3. API Endpoint Test

```bash
# Test PATCH endpoint (replace with actual values)
curl -X PATCH https://your-domain.com/api/positions/test-id \
  -H "Content-Type: application/json" \
  -H "Cookie: your_session_cookie" \
  -d '{"stopLoss": 24620}'

# Expected: 200 OK with JSON { "status": "updated", ... }
# OR: 401 if not authenticated (expected, means endpoint exists)
```

### 4. Frontend Verification

**Manual Testing:**
1. Login to terminal
2. Open any position (or place a new trade)
3. Navigate to chart
4. **Verify you see:**
   - ✅ Blue Entry line with P/L
   - ✅ Red SL line (if set) — draggable
   - ✅ Green TP line (if set) — draggable
   - ✅ Entry marker (▲ or ▼)

5. **Test Drag:**
   - Hover over SL or TP line
   - Cursor should change to `↕`
   - Drag line up/down
   - Live tooltip should appear
   - Release mouse
   - Check browser Network tab → PATCH request sent

6. **Test Right-Click:**
   - Right-click Entry line
   - Context menu should appear
   - Menu should have: Close Position, Partial Close, etc.

### 5. Console Check

**Open Browser DevTools Console:**
```javascript
// Should see no errors

// Check WebSocket connection
console.log('[WS] Connected:', wsService?.connected);
// Expected: true

// Check Position Manager loaded
console.log('PositionManager:', document.querySelector('canvas'));
// Expected: HTMLCanvasElement
```

---

## 🔍 Monitoring

### Key Metrics to Watch

1. **Server CPU/Memory**
   - Canvas rendering is client-side, no server impact
   - Watch for any API call spikes

2. **Database Performance**
   - Monitor `terminal_positions` table queries
   - Index should keep queries fast (< 10ms)

3. **WebSocket Load**
   - Position updates broadcast to all clients
   - Watch for increased message rate

4. **API Response Times**
   - PATCH `/api/positions/:id` should be < 100ms
   - GET `/api/positions` should be < 50ms

### Logging

**Look for these log messages:**

✅ **Success:**
```
[PositionManager] Initialized with 5 positions
[API] PATCH /positions/pos-123 → 200 OK
[WS] position_update broadcast to 12 clients
```

❌ **Errors to watch for:**
```
[PositionManager] Failed to update position: Network error
[API] PATCH /positions/pos-123 → 500 Internal Server Error
[DB] ERROR: column "stop_loss" does not exist
```

---

## 🚨 Rollback Procedure (If Major Issues)

### Quick Rollback (Frontend Only)

```bash
# 1. Comment out PositionManager in ChartPanel
# src/components/ChartPanel.tsx:
# import { PositionManager } from './chart/PositionManager';
# <PositionManager chart={...} />

# 2. Rebuild and deploy
npm run build
pm2 restart all
```

### Full Rollback (Code + Database)

```bash
# 1. Revert to previous commit
git revert HEAD~1
git push origin main

# 2. Drop database columns (see Rollback Plan above)

# 3. Redeploy
npm run build
pm2 restart all
```

---

## 📊 Performance Benchmarks

**Expected Performance (per client):**

| Metric | Target | Acceptable | Critical |
|--------|--------|------------|----------|
| Canvas FPS | 60 | 45+ | < 30 |
| API Response | < 50ms | < 100ms | > 200ms |
| WebSocket Latency | < 50ms | < 100ms | > 200ms |
| Memory per Position | ~5KB | ~10KB | > 50KB |
| Max Positions | 100+ | 50+ | < 20 |

**If performance degrades:**
1. Check browser console for errors
2. Reduce RAF rate from 60 FPS to 30 FPS (see POSITION-MANAGER-SETUP.md)
3. Implement position limit per symbol

---

## 🎯 User Communication

### Announcement Template (Slack/Discord)

```
🎉 New Feature: Professional Position Manager!

Your charts now have interactive position lines, just like TradeLocker and MT5!

✨ What's New:
• Visual position lines on chart (Entry, SL, TP)
• Drag & Drop to modify Stop Loss and Take Profit — no popups!
• Real-time P/L updates on every tick
• Risk/Reward zones visualization
• Right-click context menus for quick actions

🎯 How to Use:
1. Open any position
2. See the blue Entry line appear on chart
3. Drag the red SL or green TP lines to adjust
4. Right-click for more options

📚 Full Guide: [link to POSITION-MANAGER-FEATURE.md]

Feedback welcome! 🚀
```

---

## 🐛 Known Issues & Workarounds

### Issue: Lines not appearing

**Cause:** Position missing `side` field  
**Workaround:** Run SQL to populate side:
```sql
UPDATE terminal_positions 
SET side = CASE 
  WHEN buy_qty > sell_qty THEN 'LONG' 
  WHEN sell_qty > buy_qty THEN 'SHORT' 
  ELSE 'LONG' 
END 
WHERE side IS NULL AND is_open = TRUE;
```

### Issue: Drag feels laggy

**Cause:** Too many positions or slow client hardware  
**Workaround:** Reduce canvas update rate in `PositionCanvas.tsx`:
```typescript
// Change from 60 FPS to 30 FPS
setTimeout(() => { ... }, 33); // 33ms = 30 FPS
```

### Issue: SL/TP not persisting

**Cause:** Database migration not run  
**Workaround:** Run migration manually (see above)

---

## 📞 Support Contacts

- **Database Issues:** DBA Team
- **Server Issues:** DevOps Team  
- **Frontend Issues:** Frontend Team
- **Urgent:** Page on-call engineer

---

## ✅ Final Checklist

Before marking deployment complete:

- [ ] Database migration applied and verified
- [ ] Server restarted and healthy
- [ ] Frontend loads without console errors
- [ ] Test trade placed and position lines appear
- [ ] Drag & drop works smoothly
- [ ] Right-click menus functional
- [ ] WebSocket updates working (P/L changes)
- [ ] Monitoring alerts configured
- [ ] Team notified of new feature
- [ ] Documentation accessible to users
- [ ] Rollback plan tested and ready

---

## 🎉 Success Criteria

Deployment is successful when:

1. ✅ All existing features working (no regression)
2. ✅ New position lines visible on chart
3. ✅ Drag & drop modifies SL/TP via API
4. ✅ Real-time P/L updates functioning
5. ✅ No critical errors in logs (1 hour post-deploy)
6. ✅ User feedback positive (within 24 hours)

---

**Deployment Date:** _____________  
**Deployed By:** _____________  
**Verified By:** _____________  
**Status:** [ ] Success [ ] Partial [ ] Rollback

---

🚀 **Ready to give your users a professional trading experience!**
