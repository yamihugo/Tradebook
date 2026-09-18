import type { Trade } from "../types";
import { toZoneTime } from "../tz";

/**
 * Multi-session market classification for futures.
 *
 * Every futures day has distinct sessions based on which major market is open.
 * The split is measured on the ENTRY time, converted to Eastern Time, because
 * that is the standard timezone for session classification in US-listed futures.
 *
 * Sessions (all times in ET):
 *   New York  — 09:30–16:00  (RTH, the cash market, highest volume)
 *   London    — 03:00–09:30  (European hours leading into NY open)
 *   Asia      — 19:00–03:00  (Tokyo/Globex electronic, crosses midnight)
 *   Off Hours — 16:00–19:00  (maintenance break + gap between NY close and Asia open)
 *
 * The boundaries are non-overlapping: the first match wins in order
 * NY → London → Asia → Off.
 */

/* ---- minute offsets (ET) ---- */

export const NY_OPEN = 9 * 60 + 30;   // 09:30
export const NY_CLOSE = 16 * 60;      // 16:00

export const LDN_OPEN = 3 * 60;       // 03:00
export const LDN_CLOSE = 9 * 60 + 30; // 09:30

export const ASIA_OPEN = 19 * 60;     // 19:00 (7 PM)
export const ASIA_CLOSE = 3 * 60;     // 03:00 (next day, wraps midnight)

export const OFF_OPEN = 16 * 60;      // 16:00
export const OFF_CLOSE = 19 * 60;     // 19:00

// Keep old names for backward compat with code that references RTH directly
export const RTH_OPEN = NY_OPEN;
export const RTH_CLOSE = NY_CLOSE;

/** Session keys used internally. */
export type SessionKey = "newyork" | "london" | "asia" | "off" | "none";

/** Display labels for each session. */
export const SESSION_LABELS: Record<string, string> = {
  newyork: "New York",
  london: "London",
  asia: "Asia",
  off: "Off Hours",
  none: "No time",
  // Legacy aliases — map old values to new ones so existing filters stay alive
  rth: "New York",
  overnight: "Off Hours",
};

/** Short badge labels for compact display. */
export const SESSION_BADGES: Record<string, string> = {
  newyork: "NY",
  london: "LDN",
  asia: "ASI",
  off: "OFF",
  none: "—",
  rth: "NY",
  overnight: "OFF",
};

/** CSS tone class for each session badge. */
export const SESSION_TONES: Record<string, string> = {
  newyork: "ny",
  london: "ldn",
  asia: "asi",
  off: "off",
  none: "",
  rth: "ny",
  overnight: "off",
};

/** A trade with no entry time cannot be placed in a session — say so. */
export const SESSION_UNKNOWN = "No time";

function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? "").trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Classify a trade into its market session based on entry time (ET).
 *
 * Returns one of: "newyork" | "london" | "asia" | "off" | "" (no usable time).
 *
 * The check order matters: NY is first because it is the primary session.
 * London overlaps with NY in the 03:00–09:30 window but we resolve to London
 * because a trade entered before the NY bell is a London-hours trade.
 * Asia wraps around midnight (19:00–03:00), so we check both sides of 00:00.
 */
export function sessionOf(trade: Trade, zone: string): SessionKey | "" {
  if (!/^\d{1,2}:\d{2}/.test(String(trade.entryTime ?? "").trim())) return "";
  const ny = toZoneTime(trade.date, trade.entryTime ?? "", zone);
  const mins = minutesOf(ny);
  if (!Number.isFinite(mins)) return "";

  // New York RTH: 09:30–16:00
  if (mins >= NY_OPEN && mins < NY_CLOSE) return "newyork";

  // London: 03:00–09:30
  if (mins >= LDN_OPEN && mins < LDN_CLOSE) return "london";

  // Asia: 19:00–03:00 (crosses midnight — check both sides)
  if (mins >= ASIA_OPEN || mins < ASIA_CLOSE) return "asia";

  // Off Hours: 16:00–19:00 (gap between NY close and Asia open)
  return "off";
}

/** The human-readable label the UI shows. */
export function sessionLabel(trade: Trade, zone: string): string {
  const s = sessionOf(trade, zone);
  return SESSION_LABELS[s] ?? SESSION_UNKNOWN;
}

/** Short badge text for compact display (header, chips). */
export function sessionBadge(trade: Trade, zone: string): string {
  const s = sessionOf(trade, zone);
  return SESSION_BADGES[s] ?? "—";
}

/** CSS tone class for badge coloring. */
export function sessionTone(trade: Trade, zone: string): string {
  const s = sessionOf(trade, zone);
  return SESSION_TONES[s] ?? "";
}

/** Chronological order for the breakdown tiles and filter UI. */
export function sessionRank(label: string): number {
  if (label === SESSION_LABELS.newyork || label === "newyork") return 0;
  if (label === SESSION_LABELS.london || label === "london") return 1;
  if (label === SESSION_LABELS.asia || label === "asia") return 2;
  if (label === SESSION_LABELS.off || label === "off" || label === SESSION_LABELS.overnight) return 3;
  return 4;
}

// Test hook, same pattern as the other pure libs (grid, review, metrics).
if (typeof window !== "undefined") {
  (window as any).__tjSessions = {
    sessionOf, sessionLabel, sessionBadge, sessionTone, sessionRank,
    SESSION_LABELS, SESSION_BADGES, SESSION_TONES,
    RTH_OPEN, RTH_CLOSE, NY_OPEN, NY_CLOSE, LDN_OPEN, LDN_CLOSE,
    ASIA_OPEN, ASIA_CLOSE, OFF_OPEN, OFF_CLOSE,
  };
}
