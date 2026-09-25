/** Pure calendar windows for comparing a selected Analytics period to its baseline.
 * Bounds are inclusive journal-date keys; trade timestamps and host timezone are
 * deliberately not involved in period membership.
 */

import {
  dateWithinPeriod,
  isValidIsoDate,
  periodDataBounds,
  PeriodBounds,
  PeriodId,
} from "./periods";

export type ComparisonUnavailableReason = "invalid-period" | "invalid-custom-range" | "future-period" | "no-baseline";

export interface PeriodComparison {
  current: PeriodBounds | null;
  baseline: PeriodBounds | null;
  eligible: boolean;
  unavailableReason: ComparisonUnavailableReason | null;
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + days);
  date.setUTCHours(0, 0, 0, 0);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

function previousCalendarBounds(period: PeriodId, current: PeriodBounds): PeriodBounds | null {
  if (!current.start || !current.end) return null;
  if (period === "lastweek") {
    return { start: shiftDate(current.start, -7), end: shiftDate(current.end, -7) };
  }
  // `current.start` is the first day of this completed calendar period. Asking
  // the existing period helper for the same completed preset at that boundary
  // resolves the preceding month, quarter, or year (without trade-date input).
  const anchor = shiftDate(current.start, 1);
  return periodDataBounds(period, anchor);
}

/**
 * Resolve an inclusive current window and its previous comparable calendar
 * window. `asOf` must already be expressed as a date in the journal timezone.
 * Pass the view's selected Custom endpoints unchanged; dates are never inferred
 * from trades.
 */
export function periodComparison(
  period: PeriodId,
  asOf: string,
  customFrom = "",
  customTo = "",
): PeriodComparison {
  if (!isValidIsoDate(asOf)) {
    return { current: null, baseline: null, eligible: false, unavailableReason: "invalid-period" };
  }
  if (period === "all") {
    return { current: null, baseline: null, eligible: false, unavailableReason: "no-baseline" };
  }
  if (period === "custom" && (!isValidIsoDate(customFrom) || !isValidIsoDate(customTo) || customFrom > customTo)) {
    return { current: null, baseline: null, eligible: false, unavailableReason: "invalid-custom-range" };
  }

  const current = periodDataBounds(period, asOf, customFrom, customTo);
  if (!current?.start || !current.end) {
    return { current: null, baseline: null, eligible: false, unavailableReason: period === "custom" ? "invalid-custom-range" : "invalid-period" };
  }
  if (current.start > asOf) {
    return { current, baseline: null, eligible: false, unavailableReason: "future-period" };
  }

  if (period === "today" || period === "yesterday") {
    const day = shiftDate(current.start, -1);
    return { current, baseline: { start: day, end: day }, eligible: true, unavailableReason: null };
  }

  const isCompletedPreset = period === "lastweek" || period === "lastmonth" || period === "lastquarter" || period === "lastyear";
  if (isCompletedPreset && current.end < asOf) {
    const baseline = previousCalendarBounds(period, current);
    return baseline?.start && baseline.end
      ? { current, baseline, eligible: true, unavailableReason: null }
      : { current, baseline: null, eligible: false, unavailableReason: "no-baseline" };
  }

  // Partial and Custom windows compare the elapsed number of journal calendar
  // dates immediately before the current start. A future-only window has
  // already been rejected above; a future Custom end is capped by periodDataBounds.
  const span = daysInclusive(current.start, current.end);
  if (!Number.isFinite(span) || span < 1) {
    return { current, baseline: null, eligible: false, unavailableReason: "invalid-period" };
  }
  const baselineEnd = shiftDate(current.start, -1);
  const baseline = { start: shiftDate(baselineEnd, -(span - 1)), end: baselineEnd };
  return { current, baseline, eligible: true, unavailableReason: null };
}

/** Date membership convenience; uses the recorded journal date, not a timestamp. */
export function dateInComparison(date: string, bounds: PeriodBounds | null): boolean {
  return dateWithinPeriod(date, bounds);
}

if (typeof window !== "undefined") {
  (window as any).__tjPeriodComparisons = { periodComparison, dateInComparison };
}
