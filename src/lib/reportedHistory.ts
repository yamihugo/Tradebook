/**
 * Reported history — context the trader reported from before tracking began.
 *
 * Display only. It never becomes a trade and never enters a calculated figure:
 * not Net Trading P&L, Closed trades, Win Rate, Profit Factor, Expectancy, a
 * curve or the account balance. This module only turns the saved
 * `historicalContext` into readable text, and only from fields that genuinely
 * carry a value — a missing field is omitted, never shown as zero.
 *
 * Pure: no DOM, no plugin, no obsidian.
 */

import type { PropAccount } from "../types";
import { fmtMoney } from "../tz";

export type ReportedHistory = PropAccount["historicalContext"];

export interface ReportedHistorySummary {
  /** One readable segment per present field, in a compact human order. */
  segments: string[];
  /** The reported note, trimmed, or "". */
  note: string;
  /** True when at least one field genuinely carries a value. */
  hasAny: boolean;
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * Build the display-only summary from the fields that actually exist. A
 * reported win rate alone cannot reconstruct wins or losses, so it is shown on
 * its own and never used to invent counts.
 */
export function reportedHistorySummary(ctx: ReportedHistory | undefined | null): ReportedHistorySummary {
  if (!ctx) return { segments: [], note: "", hasAny: false };

  const segments: string[] = [];
  const trades = finite(ctx.previousTradeCount);
  if (trades !== null) segments.push(count(trades, "trade", "trades"));
  const wins = finite(ctx.previousWins);
  if (wins !== null) segments.push(count(wins, "win", "wins"));
  const losses = finite(ctx.previousLosses);
  if (losses !== null) segments.push(count(losses, "loss", "losses"));
  const breakevens = finite(ctx.previousBreakevens);
  if (breakevens !== null) segments.push(count(breakevens, "breakeven", "breakevens"));
  const winRate = finite(ctx.previousWinRate);
  if (winRate !== null) segments.push(`${winRate}% win rate`);
  const pnl = finite(ctx.previousPnl);
  if (pnl !== null) segments.push(fmtMoney(pnl));

  const note = (ctx.note ?? "").trim();
  return { segments, note, hasAny: segments.length > 0 || note.length > 0 };
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  window.__tjReportedHistory = { reportedHistorySummary };
}
