/**
 * "Start Tracking From Here" — the account's tracked-history boundary.
 *
 * An account may declare that Tradebook only began measuring it on a date. Trades
 * before that date are real journal history, but they belong to a different
 * population: they are not counted in tracked analytics and never become the
 * account's value baseline. `size` stays the prop-rule anchor; `openingBalance`
 * is the value anchor; `historicalContext` is display-only and never becomes a
 * trade or a calculated metric.
 *
 * Pure: no DOM, no plugin, no obsidian.
 */

import type { PropAccount, Trade } from "../types";

export type HistoryAvailability = "tracked" | "not-tracked";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The account's tracking boundary date, or "" when it has none. */
export function trackingStartOf(account: PropAccount | null | undefined): string {
  const start = String(account?.trackingStart ?? "").trim();
  return ISO.test(start) ? start : "";
}

/** True when the account has declared a tracking boundary. */
export function hasTrackingStart(account: PropAccount | null | undefined): boolean {
  return !!trackingStartOf(account);
}

/**
 * The boundary an ACCOUNT's own views measure from: the declared tracking
 * boundary, or — for an account that never declared one — the account's start,
 * which is what those views have always used.
 *
 * The portfolio surfaces (Home, the Trade Log) deliberately do **not** include
 * that fallback: they keep their own long-standing rule so nothing changes for
 * an existing vault. Two rules with two names, so neither can drift silently.
 */
export function accountBoundary(account: PropAccount | null | undefined): string {
  return trackingStartOf(account) || String(account?.createdAt ?? "").trim() || "";
}

/**
 * The account value at the boundary — the balance baseline. Falls back to the
 * configured size so an account without an opening balance behaves as today.
 */
export function openingCapital(account: PropAccount | null | undefined): number {
  const balance = account?.openingBalance;
  if (typeof balance === "number" && Number.isFinite(balance)) return balance;
  return account?.size ?? 0;
}

/** True when the account carries its own declared opening value. */
export function hasOpeningBalance(account: PropAccount | null | undefined): boolean {
  const balance = account?.openingBalance;
  return typeof balance === "number" && Number.isFinite(balance);
}

/**
 * True when a boundary is set but the account value at that boundary is not.
 *
 * The setup cannot be saved in that state: the account balance would silently
 * become the configured size, which is the one number the trader expects to
 * match the platform. The fix is the trader's call — their own value, or an
 * explicit "use the account size".
 */
export function missingOpeningBalance(
  account: (Pick<PropAccount, "trackingStart" | "openingBalance"> | null | undefined)
): boolean {
  return !!trackingStartOf(account as PropAccount) && !hasOpeningBalance(account as PropAccount);
}

/** The one sentence the setup shows when the opening value is still missing. */
export const OPENING_BALANCE_REQUIRED_NOTE =
  "Enter the account balance on your tracking date, or confirm using the account size as the starting balance. Tradebook will not guess it.";

/** The account's declared pre-boundary high-water mark, or null when undeclared. */
export function openingPeakOf(account: PropAccount | null | undefined): number | null {
  const peak = account?.openingPeak;
  return typeof peak === "number" && Number.isFinite(peak) ? peak : null;
}

/** The stored journal day a trade belongs to (the same domain views filter by). */
export function tradeDay(t: Trade | null | undefined): string {
  return String(t?.date ?? "").slice(0, 10);
}

/** A trade is tracked when it is on/after the boundary (or there is none). */
export function isTrackedTrade(t: Trade, trackingStart: string): boolean {
  const start = ISO.test(trackingStart) ? trackingStart : "";
  if (!start) return true;
  const day = tradeDay(t);
  // A trade with no valid day cannot be placed on the timeline; keep it tracked
  // rather than silently hide it — the views already require a date elsewhere.
  return !ISO.test(day) || day >= start;
}

/**
 * Whether calculated metrics may speak for an account, or must stay silent.
 * No boundary means "tracked" (today's behaviour). A boundary with no tracked
 * trades in the population is "not-tracked": unavailable, never a fake zero.
 */
export function historyAvailability(
  account: PropAccount | null | undefined,
  trackedTradeCount: number
): HistoryAvailability {
  if (!hasTrackingStart(account)) return "tracked";
  return trackedTradeCount > 0 ? "tracked" : "not-tracked";
}

/**
 * The one sentence every surface uses to explain a missing figure, so the
 * account page, Home and the Accounts overview cannot word it three ways.
 */
export const NO_TRACKED_DATA_NOTE =
  "No tracked trades yet, so this figure is not calculated. Trades before the tracking start stay in the journal as history.";

/**
 * The reading a performance figure takes: its calculated value, or the app's own
 * "—" when the tracked population is empty. Views call this instead of deciding
 * for themselves, so no surface can print a zero nobody has traded yet. A real
 * zero — a tracked trade that closed flat — is a value like any other and stays.
 */
export function trackedReading(
  account: PropAccount | null | undefined,
  trackedTradeCount: number,
  value: string
): string {
  return historyAvailability(account, trackedTradeCount) === "tracked" ? value : "—";
}

/** The explanation a figure carries: its own, or why it is not calculated. */
export function trackedNote(
  account: PropAccount | null | undefined,
  trackedTradeCount: number,
  note: string
): string {
  return historyAvailability(account, trackedTradeCount) === "tracked" ? note : NO_TRACKED_DATA_NOTE;
}
