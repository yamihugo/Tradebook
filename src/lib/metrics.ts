// Individual metric widgets — one metric per widget (Journalit style).
//
// Each metric is a pure function of the filtered trade list, returning the
// display value and a tone. Kept dependency-light so it is easy to test.

import type { Trade } from "../types";
import { fmtMoney2 } from "../tz";

export interface MetricResult {
  value: string;
  tone: "pos" | "neg" | "neutral";
}

export interface MetricDef {
  id: string;
  label: string;
  compute: (trades: Trade[]) => MetricResult;
}

const money = (v: number): string => fmtMoney2(v);
const pct = (v: number): string => `${v.toFixed(1)}%`;
/** Unsigned money (e.g. "-$1,086.00" where we add the sign ourselves). */
const moneyAbs = (v: number): string =>
  `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function wins(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.pnl > 0);
}
function losses(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.pnl < 0);
}
function grossWin(trades: Trade[]): number {
  return wins(trades).reduce((s, t) => s + t.pnl, 0);
}
function grossLoss(trades: Trade[]): number {
  return Math.abs(losses(trades).reduce((s, t) => s + t.pnl, 0));
}
function byDate(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.date.localeCompare(b.date) || (a.entryTime || "").localeCompare(b.entryTime || ""));
}
function maxDrawdown(trades: Trade[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const t of byDate(trades)) {
    cum += t.pnl;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
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
function streaks(trades: Trade[]): { win: number; loss: number } {
  let win = 0, loss = 0, curW = 0, curL = 0;
  for (const t of byDate(trades)) {
    if (t.pnl > 0) { curW++; curL = 0; } else if (t.pnl < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
    win = Math.max(win, curW);
    loss = Math.max(loss, curL);
  }
  return { win, loss };
}
function sharpe(trades: Trade[]): number | null {
  const n = trades.length;
  if (n < 2) return null;
  const mean = trades.reduce((s, t) => s + t.pnl, 0) / n;
  const variance = trades.reduce((s, t) => s + (t.pnl - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (!sd) return null;
  return mean / sd;
}
function bestDay(trades: Trade[]): number {
  const days = new Map<string, number>();
  for (const t of trades) days.set(t.date, (days.get(t.date) ?? 0) + t.pnl);
  return days.size ? Math.max(...days.values()) : 0;
}
function worstDay(trades: Trade[]): number {
  const days = new Map<string, number>();
  for (const t of trades) days.set(t.date, (days.get(t.date) ?? 0) + t.pnl);
  return days.size ? Math.min(...days.values()) : 0;
}
function hourBuckets(trades: Trade[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of trades) {
    const hh = /^(\d{1,2}):/.exec(t.entryTime || "");
    if (!hh) continue;
    const h = parseInt(hh[1], 10);
    m.set(h, (m.get(h) ?? 0) + t.pnl);
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
  { id: "m.netpnl", label: "Net P&L", compute: (t) => {
    const v = t.reduce((s, x) => s + x.pnl, 0);
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.winrate", label: "Win Rate", compute: (t) => {
    if (!t.length) return { value: "—", tone: "neutral" };
    const v = (wins(t).length / t.length) * 100;
    return { value: pct(v), tone: v >= 50 ? "pos" : "neg" };
  }},
  { id: "m.trades", label: "Total Trades", compute: (t) => ({ value: `${t.length}`, tone: "neutral" }) },
  { id: "m.maxdd", label: "Max Drawdown", compute: (t) => {
    const v = maxDrawdown(t);
    return { value: v > 0 ? `-${moneyAbs(v)}` : "—", tone: v > 0 ? "neg" : "neutral" };
  }},
  { id: "m.profitfactor", label: "Profit Factor", compute: (t) => {
    const gl = grossLoss(t);
    const gw = grossWin(t);
    const v = gl > 0 ? gw / gl : gw > 0 ? Infinity : 0;
    return { value: v === Infinity ? "∞" : v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.sharpe", label: "Sharpe Ratio", compute: (t) => {
    const v = sharpe(t);
    if (v === null) return { value: "—", tone: "neutral" };
    return { value: v.toFixed(2), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.expectancy", label: "Expectancy", compute: (t) => {
    if (!t.length) return { value: "—", tone: "neutral" };
    const v = t.reduce((s, x) => s + x.pnl, 0) / t.length;
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.bestday", label: "Best Day", compute: (t) => {
    const v = bestDay(t);
    return { value: v > 0 ? money(v) : "—", tone: v > 0 ? "pos" : "neutral" };
  }},
  { id: "m.worstday", label: "Worst Day", compute: (t) => {
    const v = worstDay(t);
    return { value: v < 0 ? money(v) : "—", tone: v < 0 ? "neg" : "neutral" };
  }},
  { id: "m.largestwin", label: "Largest Win", compute: (t) => {
    const v = t.length ? Math.max(...t.map((x) => x.pnl)) : 0;
    return { value: v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.largestloss", label: "Largest Loss", compute: (t) => {
    const v = t.length ? Math.min(...t.map((x) => x.pnl)) : 0;
    return { value: v < 0 ? money(v) : "—", tone: "neg" };
  }},
  { id: "m.winstreak", label: "Longest Win Streak", compute: (t) => {
    const s = streaks(t);
    return { value: `${s.win}`, tone: s.win > 0 ? "pos" : "neutral" };
  }},
  { id: "m.lossstreak", label: "Longest Loss Streak", compute: (t) => {
    const s = streaks(t);
    return { value: `${s.loss}`, tone: s.loss > 0 ? "neg" : "neutral" };
  }},
  { id: "m.wintrades", label: "Winning Trades", compute: (t) => ({ value: `${wins(t).length}`, tone: "pos" }) },
  { id: "m.losstrades", label: "Losing Trades", compute: (t) => ({ value: `${losses(t).length}`, tone: "neg" }) },
  { id: "m.avgwin", label: "Avg Win", compute: (t) => {
    const w = wins(t);
    const v = w.length ? grossWin(t) / w.length : 0;
    return { value: v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.avgloss", label: "Avg Loss", compute: (t) => {
    const l = losses(t);
    const v = l.length ? grossLoss(t) / l.length : 0;
    return { value: v > 0 ? `-${moneyAbs(v)}` : "—", tone: "neg" };
  }},
  { id: "m.avgrr", label: "Avg RR (Payoff)", compute: (t) => {
    const w = wins(t), l = losses(t);
    const aw = w.length ? grossWin(t) / w.length : 0;
    const al = l.length ? grossLoss(t) / l.length : 0;
    if (!al) return { value: aw > 0 ? "∞" : "—", tone: "neutral" };
    const v = aw / al;
    return { value: v.toFixed(2), tone: v >= 1 ? "pos" : "neg" };
  }},
  { id: "m.holdtime", label: "Avg Hold Time", compute: (t) => ({ value: avgHold(t), tone: "neutral" }) },
  { id: "m.winhold", label: "Avg Win Hold Time", compute: (t) => ({ value: avgHold(wins(t)), tone: "pos" }) },
  { id: "m.losshold", label: "Avg Loss Hold Time", compute: (t) => ({ value: avgHold(losses(t)), tone: "neg" }) },
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
