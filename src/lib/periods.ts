/** Calendar-period helpers for Home and Analytics. Dates are ISO calendar
 * dates in the journal's configured zone; calculations never depend on the host zone. */

export type PeriodId =
  | "today"
  | "yesterday"
  | "thisweek"
  | "lastweek"
  | "1m"
  | "lastmonth"
  | "thisquarter"
  | "lastquarter"
  | "thisyear"
  | "lastyear"
  | "all"
  | "custom";

export interface PeriodBounds {
  start: string | null;
  end: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function partsInZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = Number(part.value);
  return { year: values.year, month: values.month, day: values.day };
}

/** The current ISO calendar date in an IANA timezone, independent of the OS zone. */
export function dateInZone(timeZone: string, now = new Date()): string {
  if (!timeZone) {
    return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  try {
    const { year, month, day } = partsInZone(now, timeZone);
    return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The first day key covered by a journal-zone calendar date.
 *
 * The day-key domain *is* the journal's own civil days (see
 * `journalDayKey`: entry instant → journal zone), so this is the identity —
 * stated as a function so the contract stays visible where periods and buckets
 * meet. It also avoids reading a wall clock that a DST transition may not even
 * have.
 */
export function tradingDayAtJournalDateStart(iso: string, journalZone: string): string {
  void journalZone;
  return isValidIsoDate(iso) ? iso : iso;
}

/** The last day key covered by a journal-zone calendar date (see above). */
export function tradingDayAtJournalDateEnd(iso: string, journalZone: string): string {
  void journalZone;
  return isValidIsoDate(iso) ? iso : iso;
}

/**
 * Express journal-calendar bounds in the day-key domain used for bucketing
 * (`journalDayKey`), so a period filter and a day bucket can never disagree.
 *
 * Both are the journal's civil days, so this hands the bounds straight through:
 * the conversion it used to do (journal date → market/New York day) described a
 * different domain than the one day keys now live in.
 */
export function periodDayBounds(bounds: PeriodBounds | null, journalZone: string): PeriodBounds | null {
  if (!bounds) return null;
  return {
    start: bounds.start ? tradingDayAtJournalDateStart(bounds.start, journalZone) : null,
    end: bounds.end ? tradingDayAtJournalDateEnd(bounds.end, journalZone) : null,
  };
}

/** Strict validation, including month length and leap days. */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shiftDays(iso: string, amount: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + amount);
  date.setUTCHours(0, 0, 0, 0);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function monthStart(year: number, monthIndex: number): string {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, 1);
  date.setUTCHours(0, 0, 0, 0);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-01`;
}

function monthEnd(year: number, monthIndex: number): string {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex + 1, 0);
  date.setUTCHours(0, 0, 0, 0);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Inclusive bounds for a preset. Current periods end today; completed presets
 * always resolve to their actual calendar boundaries. */
export function periodBounds(period: PeriodId, today: string, from = "", to = ""): PeriodBounds {
  if (!isValidIsoDate(today)) return { start: null, end: null };
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const thisMonday = shiftDays(today, -mondayOffset);
  const thisMonth = monthStart(year, month - 1);
  const quarterMonth = Math.floor((month - 1) / 3) * 3;

  switch (period) {
    case "today": return { start: today, end: today };
    case "yesterday": {
      const yesterday = shiftDays(today, -1);
      return { start: yesterday, end: yesterday };
    }
    case "thisweek": return { start: thisMonday, end: today };
    case "lastweek": {
      const end = shiftDays(thisMonday, -1);
      return { start: shiftDays(end, -6), end };
    }
    case "1m": return { start: thisMonth, end: today };
    case "lastmonth": {
      const start = monthStart(year, month - 2);
      const end = monthEnd(year, month - 2);
      return { start, end };
    }
    case "thisquarter": return { start: monthStart(year, quarterMonth), end: today };
    case "lastquarter": {
      const startMonth = quarterMonth - 3;
      const start = monthStart(year, startMonth);
      const end = monthEnd(year, startMonth + 2);
      return { start, end };
    }
    case "thisyear": return { start: `${year}-01-01`, end: today };
    case "lastyear": return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
    case "custom":
      return isValidIsoDate(from) && isValidIsoDate(to) && from <= to
        ? { start: from, end: to }
        : { start: null, end: null };
    case "all":
    default: return { start: null, end: null };
  }
}

/** Previous comparable window for Home/Analytics metric deltas. Current calendar
 * periods compare the elapsed portion; completed presets compare full periods. */
export function previousPeriodBounds(period: PeriodId, today: string, from = "", to = ""): PeriodBounds | null {
  const current = periodBounds(period, today, from, to);
  if (!current.start || !current.end) return null;
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const thisMonday = shiftDays(today, -mondayOffset);
  const quarterMonth = Math.floor((month - 1) / 3) * 3;

  switch (period) {
    case "today": {
      const previous = shiftDays(today, -1);
      return { start: previous, end: previous };
    }
    case "yesterday": {
      const previous = shiftDays(today, -2);
      return { start: previous, end: previous };
    }
    case "thisweek": {
      const start = shiftDays(thisMonday, -7);
      return { start, end: shiftDays(start, mondayOffset) };
    }
    case "lastweek": {
      const end = shiftDays(current.start, -1);
      return { start: shiftDays(end, -6), end };
    }
    case "1m": {
      const previousStart = monthStart(year, month - 2);
      const previousEnd = monthEnd(year, month - 2);
      const elapsedDay = Math.min(day, Number(previousEnd.slice(-2)));
      return { start: previousStart, end: previousStart.slice(0, 8) + pad(elapsedDay) };
    }
    case "lastmonth": {
      const start = monthStart(year, month - 3);
      return { start, end: monthEnd(year, month - 3) };
    }
    case "thisquarter": {
      const previousStart = monthStart(year, quarterMonth - 3);
      const elapsedDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${current.start}T00:00:00Z`)) / 86400000);
      const previousEnd = monthEnd(year, quarterMonth - 1);
      const end = shiftDays(previousStart, Math.min(elapsedDays, Math.round((Date.parse(`${previousEnd}T00:00:00Z`) - Date.parse(`${previousStart}T00:00:00Z`)) / 86400000)));
      return { start: previousStart, end };
    }
    case "lastquarter": {
      const start = monthStart(year, quarterMonth - 6);
      return { start, end: monthEnd(year, quarterMonth - 4) };
    }
    case "thisyear": {
      const previousStart = `${year - 1}-01-01`;
      const previousEnd = `${year - 1}-12-31`;
      const elapsedDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${current.start}T00:00:00Z`)) / 86400000);
      const candidate = shiftDays(previousStart, elapsedDays);
      const end = candidate > previousEnd ? previousEnd : candidate;
      return { start: previousStart, end };
    }
    case "lastyear": return { start: `${year - 2}-01-01`, end: `${year - 2}-12-31` };
    case "custom": {
      const span = Math.round((Date.parse(`${current.end}T00:00:00Z`) - Date.parse(`${current.start}T00:00:00Z`)) / 86400000) + 1;
      const end = shiftDays(current.start, -1);
      return { start: shiftDays(end, -(span - 1)), end };
    }
    case "all": return null;
    default: return null;
  }
}

/** Reference date for independent-window widgets. Future custom ranges do not
 * move an independent analysis into the future. */
export function periodAsOf(period: PeriodId, today: string, from = "", to = ""): string {
  const bounds = periodBounds(period, today, from, to);
  if (period === "all") return today;
  if (period === "custom") return bounds.end && bounds.end < today ? bounds.end : today;
  return bounds.end ?? today;
}

/**
 * Inclusive historical-data bounds for a selected period. Open-ended periods
 * stop at their as-of date, and future Custom ends are capped there too. A
 * malformed Custom range is invalid (null), never an accidental All Time range.
 * Trade membership is still based on the stored journal date, not a converted
 * timestamp/trading-day key.
 */
export function periodDataBounds(
  period: PeriodId,
  today: string,
  from = "",
  to = "",
): PeriodBounds | null {
  if (!isValidIsoDate(today)) return null;
  const bounds = periodBounds(period, today, from, to);
  if (period === "custom" && (!bounds.start || !bounds.end)) return null;
  const asOf = periodAsOf(period, today, from, to);
  const end = bounds.end && bounds.end < asOf ? bounds.end : asOf;
  return { start: bounds.start, end };
}

/** Inclusive comparison for a stored journal-date key and resolved bounds. */
export function dateWithinPeriod(date: string, bounds: PeriodBounds | null): boolean {
  if (!bounds || !isValidIsoDate(date)) return false;
  return (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end);
}

/** Small test hook used by the existing smoke harness. */
if (typeof window !== "undefined") {
  (window as any).__tjPeriods = {
    dateInZone, isValidIsoDate, periodBounds, periodAsOf, periodDataBounds,
    dateWithinPeriod, previousPeriodBounds, tradingDayAtJournalDateEnd,
    tradingDayAtJournalDateStart, periodDayBounds,
  };
}
