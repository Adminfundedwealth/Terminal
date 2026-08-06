# Position Manager Setup Guide

## Quick Start (3 Steps)

### 1. Run Database Migration

The position manager requires new columns in the `terminal_positions` table.

```bash
# Connect to your database
psql -U your_user -d your_database

# Run the migration
\i server/db/terminal-migrations/015_positions_add_sl_tp.sql

# Verify columns were added
\d terminal_positions
# Should show: stop_loss, take_profit, trailing_stop, break_even_activated
```

**Or using your migration system:**
```bash
node server/db/migrate.js
```

### 2. Restart Server

The server needs to pick up the updated API routes and position mapping:

```bash
# Stop the server (Ctrl+C)
npm run server

# Or if using PM2
pm2 restart terminal-server
```

### 3. Reload Frontend

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

---

## Verification Steps

### ✅ Step 1: Check Database

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'terminal_positions' 
  AND column_name IN ('stop_loss', 'take_profit', 'trailing_stop', 'break_even_activated');
```

**Expected Output:**
```
     column_name      |  data_type  
----------------------+-------------
 stop_loss            | numeric
 take_profit          | numeric
 trailing_stop        | numeric
 break_even_activated | boolean
```

### ✅ Step 2: Check API Endpoint

```bash
# Test PATCH endpoint (requires active session)
curl -X PATCH http://localhost:3000/api/positions/YOUR_POSITION_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: your_session_cookie" \
  -d '{"stopLoss": 24620, "takeProfit": 24700}'
```

**Expected Response:**
```json
{
  "status": "updated",
  "stopLoss": { "status": "stored", "price": 24620 },
  "takeProfit": { "status": "stored", "price": 24710 }
}
```

### ✅ Step 3: Visual Verification

1. **Login to terminal**
2. **Open a position** (any symbol)
3. **Check chart** — You should see:
   - **Blue Entry Line** with floating P/L
   - **Red SL Line** (if you set stop loss) — **should be draggable**
   - **Green TP Line** (if you set take profit) — **should be draggable**
   - **Risk/Reward zones** (semi-transparent fills)
   - **Entry marker** (▲ or ▼) at entry price

4. **Test Drag:**
   - Hover over SL or TP line → cursor changes to `↕`
   - Click and drag → live tooltip shows metrics
   - Release → check Network tab → should see `PATCH /positions/:id`

5. **Test Right-Click:**
   - Right-click Entry line → Context menu appears
   - Should show: Close Position, Partial Close, Break Even, etc.

---

## Troubleshooting

### Issue: Lines Not Showing

**Cause:** Position data missing `side` field or incorrect `qty`

**Fix:**
```sql
-- Check position data
SELECT id, symbol, side, qty, avg_price, stop_loss, take_profit 
FROM terminal_positions 
WHERE is_open = TRUE;

-- If side is NULL, infer from buy_qty/sell_qty
UPDATE terminal_positions 
SET side = CASE 
  WHEN buy_qty > sell_qty THEN 'LONG' 
  WHEN sell_qty > buy_qty THEN 'SHORT' 
  ELSE 'LONG' 
END 
WHERE side IS NULL AND is_open = TRUE;
```

### Issue: Drag Not Working

**Cause:** Canvas not receiving mouse events

**Check:**
1. Open browser console → Look for errors
2. Check element inspector → Verify `<canvas>` element exists with `z-index: 10`
3. Check `containerRef` is properly passed to `PositionManager`

**Fix:**
```typescript
// In ChartPanel.tsx, verify:
<PositionManager
  chart={chartRef.current}      // ← Must not be null
  series={seriesRef.current}    // ← Must not be null
  containerRef={chartContainerRef}  // ← Must ref the chart container
/>
```

### Issue: API Returns 404

**Cause:** Server route not registered

**Check:**
```bash
# Verify PATCH route exists
grep -n "router.patch('/positions/:id'" server/routes/api.js
```

**Expected:** Line number with `router.patch('/positions/:id', requireAuth, ...`

**If missing**, ensure `server/routes/api.js` has been updated with the new PATCH endpoint.

### Issue: TypeScript Errors

**Cause:** Types not updated or missing imports

**Fix:**
```bash
# Recompile TypeScript
npx tsc --noEmit

# If errors persist, check:
# 1. src/types/index.ts has stopLoss, takeProfit fields
# 2. src/services/api.ts has apiService.patch method
# 3. All imports are correct
```

### Issue: WebSocket Updates Not Working

**Cause:** WebSocket not connected or `position_update` handler missing

**Check:**
```javascript
// Browser console
console.log('[WS] Connected:', wsService.connected);

// Should print: true
```

**Fix:**
```typescript
// In src/services/websocket.ts, verify:
case 'position_update': {
  const position = data.data || data.position;
  if (position?.id) {
    trading.updatePosition(position.id, position);
  }
  break;
}
```

---

## Performance Tuning

### High Position Count (50+)

If you have many open positions, consider:

1. **Limit visible positions to active symbol only** (already implemented)
2. **Reduce RAF rate** from 60 FPS to 30 FPS:
   ```typescript
   // In PositionCanvas.tsx
   const loop = () => {
     setTimeout(() => {
       if (!running) return;
       render();
       rafRef.current = requestAnimationFrame(loop);
     }, 33); // 30 FPS (33ms)
   };
   ```

3. **Debounce WebSocket updates**:
   ```typescript
   // Throttle position updates to max 10/sec
   const throttledUpdate = _.throttle(updatePosition, 100);
   ```

---

## Rollback (If Needed)

If you need to rollback the feature:

### 1. Remove from ChartPanel
```typescript
// Comment out in ChartPanel.tsx:
// import { PositionManager } from './chart/PositionManager';
// <PositionManager ... />
```

### 2. Revert API Route
```bash
git checkout HEAD -- server/routes/api.js
```

### 3. Drop Database Columns (Optional)
```sql
ALTER TABLE terminal_positions
DROP COLUMN IF EXISTS stop_loss,
DROP COLUMN IF EXISTS take_profit,
DROP COLUMN IF EXISTS trailing_stop,
DROP COLUMN IF EXISTS break_even_activated;
```

### 4. Rebuild
```bash
npm run build
```

---

## Environment-Specific Notes

### Production Deployment

1. **Database migration** should be run during maintenance window
2. **Server restart** required (rolling restart recommended)
3. **Cache clear** may be needed for CDN-cached assets
4. **Monitoring**: Watch for increased WebSocket traffic (position updates)

### Development Environment

- **Hot reload** works for all components except ChartPanel (requires full reload)
- **Mock data**: Use mock positions if broker API unavailable:
  ```typescript
  useTradingStore.setState({
    positions: [
      { id: '1', symbol: 'NIFTY', token: '99926000', qty: 50, avgPrice: 24600, ltp: 24650, pnl: 2500, stopLoss: 24550, takeProfit: 24700, side: 'LONG', ... }
    ]
  });
  ```

---

## Support

If you encounter issues:

1. **Check browser console** for JavaScript errors
2. **Check server logs** for API errors
3. **Check database logs** for migration issues
4. **Review POSITION-MANAGER-FEATURE.md** for architecture details

**Common Log Messages:**

✅ **Success:**
```
[PositionManager] Drag end: position=pos-123, type=sl, price=24620
[API] PATCH /positions/pos-123 { stopLoss: 24620 } → 200 OK
[WS] position_update broadcast to 3 clients
```

❌ **Error:**
```
[PositionManager] Failed to update position: Network error
[API] PATCH /positions/pos-123 → 500 Internal Server Error
```

---

## Next Steps

Once verified, you can:

1. **Customize colors** in `PositionCanvas.tsx` (COLORS object)
2. **Add more context menu actions** in `PositionContextMenu.tsx`
3. **Implement trailing stop logic** in `PositionManager.tsx`
4. **Add mobile touch support** for drag gestures

Enjoy your professional trading terminal! 🚀
