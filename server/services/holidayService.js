/**
 * HOLIDAY SERVICE
 * 
 * NSE/BSE market holidays for India.
 * Blocks trading on holidays and weekends.
 * 
 * Used by:
 *   - RiskEngine (pre-trade validation)
 *   - Frontend (status banner)
 *   - WebSocket (market status)
 */

// NSE Holidays 2025-2026
const HOLIDAYS = {
  2025: [
    { date: '2025-01-26', name: 'Republic Day' },
    { date: '2025-02-26', name: 'Mahashivratri' },
    { date: '2025-03-14', name: 'Holi' },
    { date: '2025-03-31', name: 'Id-ul-Fitr (Ramadan)' },
    { date: '2025-04-10', name: 'Mahavir Jayanti' },
    { date: '2025-04-14', name: 'Dr. Ambedkar Jayanti' },
    { date: '2025-04-18', name: 'Good Friday' },
    { date: '2025-05-01', name: 'Maharashtra Day' },
    { date: '2025-08-15', name: 'Independence Day' },
    { date: '2025-08-27', name: 'Ganesh Chaturthi' },
    { date: '2025-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2025-10-21', name: 'Dussehra' },
    { date: '2025-11-05', name: 'Diwali (Laxmi Puja)' },
    { date: '2025-11-06', name: 'Diwali (Balipratipada)' },
    { date: '2025-11-25', name: 'Guru Nanak Jayanti' },
    { date: '2025-12-25', name: 'Christmas' },
  ],
  2026: [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-02-26', name: 'Mahashivratri' },
    { date: '2026-03-14', name: 'Holi' },
    { date: '2026-03-31', name: 'Id-ul-Fitr' },
    { date: '2026-04-10', name: 'Mahavir Jayanti' },
    { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti' },
    { date: '2026-04-18', name: 'Good Friday' },
    { date: '2026-05-01', name: 'May Day / Maharashtra Day' },
    { date: '2026-06-26', name: 'Id-ul-Adha (Bakrid)' },
    { date: '2026-07-26', name: 'Muharram' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-08-16', name: 'Janmashtami' },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2026-10-21', name: 'Dussehra' },
    { date: '2026-11-05', name: 'Diwali (Laxmi Puja)' },
    { date: '2026-11-06', name: 'Diwali (Balipratipada)' },
    { date: '2026-11-25', name: 'Guru Nanak Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  2027: [
    { date: '2027-01-26', name: 'Republic Day' },
    { date: '2027-03-04', name: 'Holi' },
    { date: '2027-03-21', name: 'Id-ul-Fitr' },
    { date: '2027-04-02', name: 'Good Friday' },
    { date: '2027-04-14', name: 'Dr. Ambedkar Jayanti' },
    { date: '2027-05-01', name: 'May Day' },
    { date: '2027-08-15', name: 'Independence Day' },
    { date: '2027-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2027-12-25', name: 'Christmas' },
  ],
};

export class HolidayService {
  /**
   * Check if today is a market holiday or weekend.
   * Returns { isClosed: true, reason: "..." } or { isClosed: false }
   */
  static checkMarketClosed(date = new Date()) {
    // Check weekend
    const day = date.getDay();
    if (day === 0) {
      return { isClosed: true, reason: 'Market closed (Sunday)', isWeekend: true, holidayName: null };
    }
    if (day === 6) {
      return { isClosed: true, reason: 'Market closed (Saturday)', isWeekend: true, holidayName: null };
    }

    // Check holiday
    const holiday = this.getHoliday(date);
    if (holiday) {
      return { isClosed: true, reason: `Market closed today (${holiday.name})`, isWeekend: false, holidayName: holiday.name };
    }

    return { isClosed: false, reason: null, isWeekend: false, holidayName: null };
  }

  /**
   * Get holiday info for a specific date.
   * @param {Date} date
   * @returns {{ date: string, name: string } | null}
   */
  static getHoliday(date = new Date()) {
    const year = date.getFullYear();
    const dateStr = this._formatDate(date);

    const yearHolidays = HOLIDAYS[year] || [];
    return yearHolidays.find(h => h.date === dateStr) || null;
  }

  /**
   * Check if a specific date is a trading day.
   */
  static isTradingDay(date = new Date()) {
    const { isClosed } = this.checkMarketClosed(date);
    return !isClosed;
  }

  /**
   * Get next trading day from a given date.
   */
  static getNextTradingDay(date = new Date()) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);

    while (!this.isTradingDay(next)) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  /**
   * Get all holidays for a year.
   */
  static getHolidaysForYear(year) {
    return HOLIDAYS[year] || [];
  }

  /**
   * Get upcoming holidays (next 30 days).
   */
  static getUpcomingHolidays(count = 5) {
    const now = new Date();
    const year = now.getFullYear();
    const allHolidays = [...(HOLIDAYS[year] || []), ...(HOLIDAYS[year + 1] || [])];

    const today = this._formatDate(now);
    return allHolidays
      .filter(h => h.date >= today)
      .slice(0, count);
  }

  /**
   * Check whether the market is currently open for normal-session trading.
   *
   * Rules (NSE normal session):
   *   - Monday–Friday only
   *   - Not a NSE holiday
   *   - Current IST time is between 09:15 and 15:30
   *
   * AMO (After-Market Orders) are intentionally excluded from this check
   * because they are intentionally placed outside normal hours.
   *
   * Returns: { open: boolean, reason: string }
   *
   * NOTE: pre-open (09:00–09:15) is intentionally excluded from "open"
   * because limit/SL orders during pre-open behave differently.
   * Normal-session trading begins at 09:15.
   */
  static isMarketOpen() {
    // Work entirely in IST (UTC+5:30) — server may be in any timezone
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const now = new Date(Date.now() + IST_OFFSET_MS);

    // 1. Weekend check (use UTC day because we shifted to IST above)
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0) return { open: false, reason: 'Market closed (Sunday)' };
    if (day === 6) return { open: false, reason: 'Market closed (Saturday)' };

    // 2. Holiday check — compare IST date
    const istDateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
    const year = now.getUTCFullYear();
    const yearHolidays = (HOLIDAYS[year] || []);
    const holiday = yearHolidays.find(h => h.date === istDateStr);
    if (holiday) return { open: false, reason: `Market closed (holiday: ${holiday.name})` };

    // 3. Trading hours check — IST HH:MM
    const hh = now.getUTCHours();
    const mm = now.getUTCMinutes();
    const minuteOfDay = hh * 60 + mm;
    const OPEN_MINUTES  = 9 * 60 + 15;  // 09:15 IST
    const CLOSE_MINUTES = 15 * 60 + 30; // 15:30 IST

    if (minuteOfDay < OPEN_MINUTES) {
      return { open: false, reason: `Market not yet open (opens 09:15 IST, current IST: ${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')})` };
    }
    if (minuteOfDay >= CLOSE_MINUTES) {
      return { open: false, reason: `Market closed (closes 15:30 IST, current IST: ${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')})` };
    }

    return { open: true, reason: 'Market open' };
  }

  /**
   * Format date as YYYY-MM-DD (IST).
   */
  static _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
