/**
 * HOLIDAY BANNER
 * 
 * Shows a banner when market is closed due to holiday or weekend.
 * Fetches status from /api/market/holiday endpoint.
 */

import { useState, useEffect } from 'react';
import { getHolidayStatus } from '@/services/api';
import { Calendar, X } from 'lucide-react';

export function HolidayBanner() {
  const [holidayInfo, setHolidayInfo] = useState<{
    isClosed: boolean;
    reason: string | null;
    holidayName: string | null;
    isWeekend: boolean;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkHoliday();
    // Recheck every 5 minutes
    const interval = setInterval(checkHoliday, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function checkHoliday() {
    try {
      const data = await getHolidayStatus();
      setHolidayInfo(data);
    } catch {
      // Fallback: check locally
      const now = new Date();
      const day = now.getDay();
      if (day === 0 || day === 6) {
        setHolidayInfo({
          isClosed: true,
          reason: `Market closed (${day === 0 ? 'Sunday' : 'Saturday'})`,
          holidayName: null,
          isWeekend: true,
        });
      }
    }
  }

  if (!holidayInfo || !holidayInfo.isClosed || dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-3 relative">
      <Calendar size={14} className="text-amber-400 flex-shrink-0" />
      <span className="text-[12px] font-medium text-amber-200">
        {holidayInfo.holidayName
          ? `Market closed — ${holidayInfo.holidayName}`
          : holidayInfo.reason || 'Market is closed'
        }
      </span>
      {holidayInfo.holidayName && (
        <span className="text-[10px] text-amber-400/70 ml-2">Trading resumes next business day</span>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 p-1 rounded hover:bg-white/10 transition-colors"
      >
        <X size={12} className="text-amber-400/60" />
      </button>
    </div>
  );
}
