// Individual metric widgets — one metric per widget (Journalit style).
//
// Each metric is a pure function of the filtered trade list. The money basis is
// net (see lib/money.ts and docs/ARCHITECTURE.md): a dollar RESULT reads netPnl
// (gross minus costs); win/loss CLASSIFICATION uses the gross sign of `t.pnl`.
// The canonical win rate excludes break-even from the denominator.
//
// `dayKey` (optional) lets day-based metrics follow the journal's timezone; it
// defaults to the trade's own date.

import type { Trade } from "../types";
import { fmtMoney2 } from "../tz";
import { netPnl } from "./fees";
import { streakStats } from "./process";
import {
  netTotal,
  expectancy,
  avgWin,
  avgLoss,
  profitFactor,
  largestWin,
  largestLoss,
  bestDay,
  worstDay,
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
  compute: (trades: Trade[], dayKey?: DayKey) => MetricResult;
}

const dateKey: DayKey = (t) => t.date;
const money = (v: number): string => fmtMoney2(v);
const pct = (v: number): string => `${v.toFixed(1)}%`;
/** Unsigned money (e.g. "-$1,086.00" where we add the sign ourselves). */
const moneyAbs = (v: number): string =>
  `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Classification counts (gross sign) — used by win-rate and the W/L metrics.
function winCount(trades: Trade[]): number {
  return trades.filter((t) => t.pnl > 0).length;
}
function lossCount(trades: Trade[]): number {
  return trades.filter((t) => t.pnl < 0).length;
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
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t.entryTime || "");
  const x = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t.exitTime || "");
  if (!m || !x) return null;
  const s = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0);
  const e = parseInt(x[1], 10) * 60 + parseInt(x[2], 10) + (x[3] ? parseInt(x[3], 10) / 60 : 0);
  return e >= s ? e - s : null;
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
function hourBuckets(trades: Trade[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of trades) {
    const hh = /^(\d{1,2}):/.exec(t.entryTime || "");
    if (!hh) continue;
    const h = parseInt(hh[1], 10);
    m.set(h, (m.get(h) ?? 0) + netPnl(t));
  }
  return m;
}
function bestHour(trades: Trade[]): { h: number; v: number } | null {
  const m = hourBuckets(trades);
  if (!m.size) return null;
  let best: { h: number; v: number } | null = null;
  for (const [h, v] of m) if (!best || v > best.v) best = { h, v };
  return best;
}
function worstHour(trades: Trade[]): { h: number; v: number } | null {
  const m = hourBuckets(trades);
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
  { id: "m.netpnl", label: "P&L", compute: (t) => {
    const v = netTotal(t);
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.winrate", label: "Win Rate", compute: (t) => {
    const decided = winCount(t) + lossCount(t);
    if (!decided) return { value: "—", tone: "neutral" };
    const v = (winCount(t) / decided) * 100;
    return { value: pct(v), tone: v >= 50 ? "pos" : "neg" };
  }},
  { id: "m.trades", label: "Total Trades", compute: (t) => ({ value: `${t.length}`, tone: "neutral" }) },
  { id: "m.maxdd", label: "Max Trade Drawdown", compute: (t) => {
    const v = maxDrawdown(t);
    return { value: v > 0 ? `-${moneyAbs(v)}` : "—", tone: v > 0 ? "neg" : "neutral" };
  }},
  { id: "m.profitfactor", label: "Profit Factor", compute: (t) => {
    const v = profitFactor(t);
    return { value: v === Infinity ? "∞" : v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.sharpe", label: "Sharpe Ratio", compute: (t) => {
    const v = sharpe(t);
    if (v === null) return { value: "—", tone: "neutral" };
    return { value: v.toFixed(2), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.expectancy", label: "Expectancy", compute: (t) => {
    const decided = winCount(t) + lossCount(t);
    if (!decided) return { value: "—", tone: "neutral" };
    const v = expectancy(t);
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.bestday", label: "Best Day", compute: (t, dayKey) => {
    const v = bestDay(t, dayKey ?? dateKey);
    return { value: v > 0 ? money(v) : "—", tone: v > 0 ? "pos" : "neutral" };
  }},
  { id: "m.worstday", label: "Worst Day", compute: (t, dayKey) => {
    const v = worstDay(t, dayKey ?? dateKey);
    return { value: v < 0 ? money(v) : "—", tone: v < 0 ? "neg" : "neutral" };
  }},
  { id: "m.largestwin", label: "Largest Win", compute: (t) => {
    const v = largestWin(t);
    return { value: v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.largestloss", label: "Largest Loss", compute: (t) => {
    const v = largestLoss(t);
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
  { id: "m.wintrades", label: "Winning Trades", compute: (t) => ({ value: `${winCount(t)}`, tone: "pos" }) },
  { id: "m.losstrades", label: "Losing Trades", compute: (t) => ({ value: `${lossCount(t)}`, tone: "neg" }) },
  { id: "m.avgwin", label: "Avg Win", compute: (t) => {
    const v = avgWin(t);
    return { value: v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.avgloss", label: "Avg Loss", compute: (t) => {
    const v = avgLoss(t);
    return { value: v > 0 ? `-${moneyAbs(v)}` : "—", tone: "neg" };
  }},
  { id: "m.avgrr", label: "Avg RR (Payoff)", compute: (t) => {
    const aw = avgWin(t), al = avgLoss(t);
    if (!al) return { value: aw > 0 ? "∞" : "—", tone: "neutral" };
    const v = aw / al;
    return { value: v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.holdtime", label: "Avg Hold Time", compute: (t) => ({ value: avgHold(t), tone: "neutral" }) },
  { id: "m.winhold", label: "Avg Win Hold Time", compute: (t) => ({ value: avgHold(t.filter((x) => x.pnl > 0)), tone: "pos" }) },
  { id: "m.losshold", label: "Avg Loss Hold Time", compute: (t) => ({ value: avgHold(t.filter((x) => x.pnl < 0)), tone: "neg" }) },
  { id: "m.besthour", label: "Best Hour", compute: (t) => {
    const b = bestHour(t);
    if (!b) return { value: "—", tone: "neutral" };
    return { value: fmtHour(b.h), tone: "pos" };
  }},
  { id: "m.worsthour", label: "Worst Hour", compute: (t) => {
    const w = worstHour(t);
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
