// Individual metric widgets — one metric per widget (Journalit style).
//
// Each metric is a pure function of the filtered trade list, but the financial
// metrics are a function of ONE FinancialSummary — the shared population in
// lib/money.ts. Result metrics read `summary.net`: Net P&L, Closed trades,
// Win Rate, Net Profit Factor and Avg Net Result per Trade all come from the
// same scope, the same eligibility rule and the same Net classification of each
// aggregated decision (docs/UX-GUIDELINES.md §0). Gross stays available only
// under an explicit "Gross" name.
//
// `dayKey` (optional) lets day-based metrics follow the journal's day key; it
// defaults to the trade's recorded date. `zone` is the Journal Timezone, which
// hour-of-day metrics need to place an entry's canonical instant on the clock.

import type { Trade } from "../types";
import { fmtMoney2 } from "../tz";
import { holdMinutesOf, tradeHourInZone } from "./instant";
import { netPnl } from "./fees";
import { streakStats } from "./process";
import { accountResolver, accountScope } from "./scope";
import {
  summarizeFinancials,
  FinancialSummary,
  largestNetWin,
  largestNetLoss,
} from "./money";

export interface MetricResult {
  value: string;
  tone: "pos" | "neg" | "neutral";
}

/** What "a day" is, for day-based metrics. */
export type DayKey = (t: Trade) => string;

export interface MetricDef {
  id: string;
  label: string;
  /** `zone` is the Journal Timezone: hour-of-day metrics read the entry instant
   *  in it. Metrics that do not need it ignore the argument. */
  compute: (trades: Trade[], dayKey?: DayKey, financials?: FinancialSummary, zone?: string) => MetricResult;
}

const dateKey: DayKey = (t) => t.date;
const money = (v: number): string => fmtMoney2(v);
const pct = (v: number): string => `${v.toFixed(1)}%`;
/** Unsigned money (e.g. "-$1,086.00" where we add the sign ourselves). */
const moneyAbs = (v: number): string =>
  `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Classification counts for the metrics that still carry a Gross contract are
// declared where they live (streaks, hold-time splits); the result metrics
// below classify through the shared Net summary instead.

/** A standalone metric population is treated as one anonymous account scope. */
export function summarizeMetricTrades(trades: Trade[], dayKey: DayKey = dateKey): FinancialSummary {
  return summarizeFinancials(trades, {
    scope: accountScope(trades, { resolve: accountResolver() }),
    dayKey,
  });
}

function byDate(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.date.localeCompare(b.date) || (a.entryTime || "").localeCompare(b.entryTime || ""));
}

// Home-only, per-trade max drawdown: walks the trades in order and sums the
// NET of each (after fees). It is NOT the account-level, daily, balance-based
// drawdown in lib/accountMetrics.ts — see the "Max Trade Drawdown" widget.
// (No lib/money.ts equivalent yet; the Risk widget will absorb it in Phase D.)
function maxDrawdown(trades: Trade[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const t of byDate(trades)) {
    cum += netPnl(t);
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}

// Per-trade Sharpe on the NET result. (No lib/money.ts equivalent yet.)
function sharpe(trades: Trade[]): number | null {
  const n = trades.length;
  if (n < 2) return null;
  const mean = trades.reduce((s, t) => s + netPnl(t), 0) / n;
  const variance = trades.reduce((s, t) => s + (netPnl(t) - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (!sd) return null;
  return mean / sd;
}

function holdMinutes(t: Trade): number | null {
  // Real elapsed time when both instants exist (a hold across midnight or a DST
  // change is measured, not wrapped); the recorded clock otherwise.
  return holdMinutesOf(t);
}
function avgHold(trades: Trade[]): string {
  const mins: number[] = [];
  for (const t of trades) {
    const hm = holdMinutes(t);
    if (hm !== null) mins.push(hm);
  }
  if (!mins.length) return "—";
  const avg = mins.reduce((s, v) => s + v, 0) / mins.length;
  const totalSec = Math.round(avg * 60);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return s ? `${h}h ${m}m ${s}s` : m ? `${h}h ${m}m` : `${h}h`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Hour buckets on the NET result. (No lib/money.ts equivalent yet; the Timing
// widget will absorb best/worst hour in Phase D.)
function hourBuckets(trades: Trade[], zone = ""): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of trades) {
    // The hour the entry falls in, read in the Journal Timezone from the
    // canonical instant — not the hour string printed on the note.
    const h = tradeHourInZone(t, zone);
    if (h === null) continue;
    m.set(h, (m.get(h) ?? 0) + netPnl(t));
  }
  return m;
}
function bestHour(trades: Trade[], zone?: string): { h: number; v: number } | null {
  const m = hourBuckets(trades, zone);
  if (!m.size) return null;
  let best: { h: number; v: number } | null = null;
  for (const [h, v] of m) if (!best || v > best.v) best = { h, v };
  return best;
}
function worstHour(trades: Trade[], zone?: string): { h: number; v: number } | null {
  const m = hourBuckets(trades, zone);
  if (!m.size) return null;
  let worst: { h: number; v: number } | null = null;
  for (const [h, v] of m) if (!worst || v < worst.v) worst = { h, v };
  return worst;
}
function fmtHour(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

export const METRICS: MetricDef[] = [
  { id: "m.netpnl", label: "Net P&L", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.total;
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.winrate", label: "Win Rate", compute: (t, dayKey, financials) => {
    // The Net contract: positive ÷ decided aggregated decisions, breakevens out.
    const rate = (financials ?? summarizeMetricTrades(t, dayKey)).net.winRate;
    if (rate === null) return { value: "—", tone: "neutral" };
    const percent = rate * 100;
    return { value: pct(percent), tone: percent >= 50 ? "pos" : "neg" };
  }},
  { id: "m.trades", label: "Closed trades", compute: (t, dayKey, financials) => ({
    value: `${(financials ?? summarizeMetricTrades(t, dayKey)).decisionCount}`,
    tone: "neutral" as const,
  }) },
  { id: "m.maxdd", label: "Max Trade Drawdown", compute: (t) => {
    const v = maxDrawdown(t);
    return { value: v > 0 ? `-${moneyAbs(v)}` : "—", tone: v > 0 ? "neg" : "neutral" };
  }},
  { id: "m.profitfactor", label: "Net Profit Factor", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.profitFactor;
    return { value: v === Infinity ? "∞" : v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.grossprofitfactor", label: "Gross Profit Factor", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).gross.profitFactor;
    return { value: v === Infinity ? "∞" : v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.sharpe", label: "Sharpe Ratio", compute: (t) => {
    const v = sharpe(t);
    if (v === null) return { value: "—", tone: "neutral" };
    return { value: v.toFixed(2), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.expectancy", label: "Avg Net Result per Trade", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.averagePerDecision;
    if (v === null) return { value: "—", tone: "neutral" };
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.bestday", label: "Best Net Day", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    const v = days.size ? Math.max(...days.values()) : 0;
    return { value: v > 0 ? money(v) : "—", tone: v > 0 ? "pos" : "neutral" };
  }},
  { id: "m.worstday", label: "Worst Net Day", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    const v = days.size ? Math.min(...days.values()) : 0;
    return { value: v < 0 ? money(v) : "—", tone: v < 0 ? "neg" : "neutral" };
  }},
  { id: "m.largestwin", label: "Largest Net Win · Leg", compute: (t) => {
    const v = largestNetWin(t);
    return { value: v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.largestloss", label: "Largest Net Loss · Leg", compute: (t) => {
    const v = largestNetLoss(t);
    return { value: v < 0 ? money(v) : "—", tone: "neg" };
  }},
  { id: "m.winstreak", label: "Longest Win Streak", compute: (t) => {
    const v = streakStats(t).bestWin;
    return { value: `${v}`, tone: v > 0 ? "pos" : "neutral" };
  }},
  { id: "m.lossstreak", label: "Longest Loss Streak", compute: (t) => {
    const v = streakStats(t).worstLoss;
    return { value: `${v}`, tone: v > 0 ? "neg" : "neutral" };
  }},
  { id: "m.wintrades", label: "Winning Trades", compute: (t, dayKey, financials) => ({
    value: `${(financials ?? summarizeMetricTrades(t, dayKey)).net.positiveDecisionCount}`,
    tone: "pos" as const,
  }) },
  { id: "m.losstrades", label: "Losing Trades", compute: (t, dayKey, financials) => ({
    value: `${(financials ?? summarizeMetricTrades(t, dayKey)).net.negativeDecisionCount}`,
    tone: "neg" as const,
  }) },
  { id: "m.avgwin", label: "Avg Net Win per Trade", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.averageWinPerDecision;
    return { value: v !== null && v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.avgloss", label: "Avg Net Loss per Trade", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.averageLossPerDecision;
    return { value: v !== null && v > 0 ? `-${moneyAbs(v)}` : "—", tone: "neg" };
  }},
  { id: "m.avgrr", label: "Net Trade Payoff Ratio", compute: (t, dayKey, financials) => {
    const summary = financials ?? summarizeMetricTrades(t, dayKey);
    const aw = summary.net.averageWinPerDecision ?? 0;
    const al = summary.net.averageLossPerDecision ?? 0;
    if (!al) return { value: aw > 0 ? "∞" : "—", tone: "neutral" };
    const v = aw / al;
    return { value: v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.holdtime", label: "Avg Hold Time", compute: (t) => ({ value: avgHold(t), tone: "neutral" }) },
  { id: "m.winhold", label: "Avg Win Hold Time", compute: (t) => ({ value: avgHold(t.filter((x) => x.pnl > 0)), tone: "pos" }) },
  { id: "m.losshold", label: "Avg Loss Hold Time", compute: (t) => ({ value: avgHold(t.filter((x) => x.pnl < 0)), tone: "neg" }) },
  { id: "m.besthour", label: "Best Hour", compute: (t, _d, _f, zone) => {
    const b = bestHour(t, zone);
    if (!b) return { value: "—", tone: "neutral" };
    return { value: fmtHour(b.h), tone: "pos" };
  }},
  { id: "m.worsthour", label: "Worst Hour", compute: (t, _d, _f, zone) => {
    const w = worstHour(t, zone);
    if (!w) return { value: "—", tone: "neutral" };
    return { value: fmtHour(w.h), tone: "neg" };
  }},
];

export const METRIC_TITLES: Record<string, string> = Object.fromEntries(METRICS.map((m) => [m.id, m.label]));

export function metricById(id: string): MetricDef | undefined {
  return METRICS.find((m) => m.id === id);
}

// Test hook
if (typeof window !== "undefined") {
  (window as any).__tjMetrics = { METRICS, METRIC_TITLES, metricById };
}
