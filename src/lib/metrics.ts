// Individual metric widgets — one metric per widget.
//
// Each metric is a pure function of the filtered trade list, but the financial
// metrics are a function of ONE FinancialSummary — the shared population in
// lib/money.ts. Result metrics read `summary.net`: Net P&L, Total trades,
// Win Rate, Profit Factor and Expectancy all come from the
// same scope, the same eligibility rule and the same Net classification of each
// aggregated decision (docs/UX-GUIDELINES.md §0). Gross stays available only
// under an explicit "Gross" name.
//
// `dayKey` (optional) lets day-based metrics follow the journal's day key; it
// defaults to the trade's recorded date. `zone` is the Journal Timezone, which
// hour-of-day metrics need to place an entry's canonical instant on the clock.

import type { Trade } from "../types";
import { fmtMoney2 } from "../tz";
import { holdMinutesOf, tradeHourInZone, chronological } from "./instant";
import { netPnl } from "./fees";
import { streakStats } from "./process";
import { accountResolver, accountScope } from "./scope";
import { computeDrawdownEpisodes, type DrawdownAnalysis } from "./accountMetrics";
import { tradeR } from "./tradeTable";
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

// One classification, decided by the shared Net summary: an unqualified
// win/loss is the sign of the Net result of the logical decision. The only
// metric still classifying by Gross is the streak pair — it lives in
// lib/process.ts and says so in its own header and tooltips.

/**
 * The representative row of every decision that ended on one side of zero —
 * measured by the Net sign of the aggregated decision, never the Gross sign of
 * a single row. One row per decision, so copied legs are not measured twice.
 */
function representativesByNetSign(
  trades: Trade[],
  dayKey?: DayKey,
  financials?: FinancialSummary,
  side: "pos" | "neg" = "pos",
): Trade[] {
  const summary = financials ?? summarizeMetricTrades(trades, dayKey);
  return summary.decisions
    .filter((decision) => (side === "pos" ? decision.net > 0 : decision.net < 0))
    .map((decision) => decision.representative);
}

/**
 * A standalone metric population is treated as one anonymous account scope.
 *
 * Caller must pre-scope the trades list. This helper does not apply account
 * scope rules (demo exclusion, archived filtering). Pass a list already
 * filtered by the caller.
 */
export function summarizeMetricTrades(trades: Trade[], dayKey: DayKey = dateKey): FinancialSummary {
  return summarizeFinancials(trades, {
    scope: accountScope(trades, { resolve: accountResolver() }),
    dayKey,
  });
}

// Home-only, per-trade max drawdown: walks the trades in order and sums the
// NET of each (after fees). It is NOT the account-level, daily, balance-based
// drawdown in lib/accountMetrics.ts — see the "Max DD" widget.
// (No lib/money.ts equivalent yet; the Risk widget will absorb it in Phase D.)
// Order matters here, so the walk uses the shared chronological rule.
export function maxDrawdown(trades: Trade[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const t of chronological(trades)) {
    cum += netPnl(t);
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}

/**
 * The daily cumulative Net series — the same curve Home's equity chart draws
 * (one point per journaled day, baseline zero), read off the shared Net day
 * buckets so it can never disagree with Net P&L, Best Day or the curve.
 *
 * No configured capital is involved: a constant baseline shift leaves
 * episodes, depths and durations unchanged, and a payout is an account
 * movement, never a trading result — drawdown here is drawdown of trading
 * results (docs/UX-GUIDELINES.md §0).
 */
function dailyNetSeries(financials: FinancialSummary): Array<{ date: string; balance: number }> {
  const days = [...financials.net.byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  let cumulative = 0;
  return days.map(([date, net]) => {
    cumulative += net;
    return { date, balance: cumulative };
  });
}

/** Drawdown episodes of the population's daily Net curve. */
function drawdownOf(trades: Trade[], dayKey?: DayKey, financials?: FinancialSummary): DrawdownAnalysis {
  return computeDrawdownEpisodes(dailyNetSeries(financials ?? summarizeMetricTrades(trades, dayKey)), 0);
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
    const summary = financials ?? summarizeMetricTrades(t, dayKey);
    if (summary.decisionCount === 0 && summary.net.total === 0) return { value: "—", tone: "neutral" };
    return { value: money(summary.net.total), tone: summary.net.total >= 0 ? "pos" : "neg" };
  }},
  { id: "m.winrate", label: "Win Rate", compute: (t, dayKey, financials) => {
    // The Net contract: positive ÷ decided aggregated decisions, breakevens out.
    const rate = (financials ?? summarizeMetricTrades(t, dayKey)).net.winRate;
    if (rate === null) return { value: "—", tone: "neutral" };
    const percent = rate * 100;
    return { value: pct(percent), tone: percent >= 50 ? "pos" : "neg" };
  }},
  { id: "m.trades", label: "Total trades", compute: (t, dayKey, financials) => ({
    value: `${(financials ?? summarizeMetricTrades(t, dayKey)).decisionCount}`,
    tone: "neutral" as const,
  }) },
  { id: "m.maxdd", label: "Max DD", compute: (t) => {
    const v = maxDrawdown(t);
    return { value: v > 0 ? `-${moneyAbs(v)}` : "—", tone: v > 0 ? "neg" : "neutral" };
  }},
  { id: "m.profitfactor", label: "Profit Factor", compute: (t, dayKey, financials) => {
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
  { id: "m.expectancy", label: "Expectancy", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.averagePerDecision;
    if (v === null) return { value: "—", tone: "neutral" };
    return { value: money(v), tone: v >= 0 ? "pos" : "neg" };
  }},
  { id: "m.bestday", label: "Best day", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    const v = days.size ? Math.max(...days.values()) : 0;
    return { value: v > 0 ? money(v) : "—", tone: v > 0 ? "pos" : "neutral" };
  }},
  { id: "m.worstday", label: "Worst day", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    const v = days.size ? Math.min(...days.values()) : 0;
    return { value: v < 0 ? money(v) : "—", tone: v < 0 ? "neg" : "neutral" };
  }},
  { id: "m.largestwin", label: "Largest win", compute: (t) => {
    const v = largestNetWin(t);
    return { value: v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.largestloss", label: "Largest loss", compute: (t) => {
    const v = largestNetLoss(t);
    return { value: v < 0 ? money(v) : "—", tone: "neg" };
  }},
  { id: "m.winstreak", label: "Longest win", compute: (t, dayKey, financials) => {
    const v = streakStats(t, financials).bestWin;
    return { value: `${v}`, tone: v > 0 ? "pos" : "neutral" };
  }},
  { id: "m.lossstreak", label: "Longest loss", compute: (t, dayKey, financials) => {
    const v = streakStats(t, financials).worstLoss;
    return { value: `${v}`, tone: v > 0 ? "neg" : "neutral" };
  }},
  { id: "m.wintrades", label: "Wins", compute: (t, dayKey, financials) => ({
    value: `${(financials ?? summarizeMetricTrades(t, dayKey)).net.positiveDecisionCount}`,
    tone: "pos" as const,
  }) },
  { id: "m.losstrades", label: "Losses", compute: (t, dayKey, financials) => ({
    value: `${(financials ?? summarizeMetricTrades(t, dayKey)).net.negativeDecisionCount}`,
    tone: "neg" as const,
  }) },
  { id: "m.avgwin", label: "Avg win", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.averageWinPerDecision;
    return { value: v !== null && v > 0 ? money(v) : "—", tone: "pos" };
  }},
  { id: "m.avgloss", label: "Avg loss", compute: (t, dayKey, financials) => {
    const v = (financials ?? summarizeMetricTrades(t, dayKey)).net.averageLossPerDecision;
    return { value: v !== null && v > 0 ? `-${moneyAbs(v)}` : "—", tone: "neg" };
  }},
  { id: "m.holdtime", label: "Hold time", compute: (t) => ({ value: avgHold(t), tone: "neutral" }) },
  // The hold split is a win/loss question, so it classifies the way every other
  // result metric does: the sign of the Net result of the aggregated decision,
  // not the Gross sign of a single row. A decision that wins before costs and
  // loses once commission is recorded is a loser here, as everywhere.
  { id: "m.winhold", label: "Win hold", compute: (t, dayKey, financials) => ({
    value: avgHold(representativesByNetSign(t, dayKey, financials, "pos")),
    tone: "pos",
  }) },
  { id: "m.losshold", label: "Loss hold", compute: (t, dayKey, financials) => ({
    value: avgHold(representativesByNetSign(t, dayKey, financials, "neg")),
    tone: "neg",
  }) },
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

  // ---- Drawdown shape: episodes of the daily Net curve ----
  { id: "m.timeindd", label: "Time in DD", compute: (t, dayKey, financials) => ({
    value: `${drawdownOf(t, dayKey, financials).pctTimeInDD.toFixed(0)}%`,
    tone: "neutral",
  }) },
  { id: "m.longestdd", label: "Longest DD", compute: (t, dayKey, financials) => {
    // Durations count the days of the series — journaled days with a result,
    // the same clock the episodes are measured on.
    const longest = Math.max(0, ...drawdownOf(t, dayKey, financials).episodes.map((e) => e.durationDays));
    return { value: longest ? `${longest}d` : "—", tone: "neg" };
  }},
  { id: "m.ddepisodes", label: "DD episodes", compute: (t, dayKey, financials) => ({
    value: `${drawdownOf(t, dayKey, financials).totalEpisodes}`,
    tone: "neutral",
  }) },
  { id: "m.avgrecovery", label: "Avg recovery", compute: (t, dayKey, financials) => {
    const avg = drawdownOf(t, dayKey, financials).avgRecoveryDays;
    return { value: avg > 0 ? `${avg.toFixed(0)}d` : "—", tone: "neutral" };
  }},
  { id: "m.recoveryfactor", label: "Recovery", compute: (t, dayKey, financials) => {
    const net = (financials ?? summarizeMetricTrades(t, dayKey)).net.total;
    // The same per-trade Net walk "Max DD" shows, so the two reconcile.
    const maxDD = maxDrawdown(t);
    if (maxDD <= 0) return { value: "—", tone: "neutral" };
    const rf = net / maxDD;
    return { value: rf.toFixed(2), tone: rf >= 2 ? "pos" : rf >= 1 ? "neutral" : "neg" };
  }},

  // ---- Expectancy in R ----
  { id: "m.expr", label: "Expectancy R", compute: (t, dayKey, financials) => {
    // One R per aggregated decision (its representative), so copied account
    // legs are never measured twice. A decision without a recorded stop has no
    // R and is left out — R cannot be read without a risk.
    const rs = (financials ?? summarizeMetricTrades(t, dayKey)).decisions
      .map((d) => tradeR(d.representative))
      .filter((r): r is number => r !== null && Number.isFinite(r));
    if (!rs.length) return { value: "—", tone: "neutral" };
    const avgR = rs.reduce((a, b) => a + b, 0) / rs.length;
    return { value: `${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R`, tone: avgR >= 0 ? "pos" : "neg" };
  }},

  // ---- Daily shape ----
  { id: "m.avgdailypl", label: "Avg day", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    if (!days.size) return { value: "—", tone: "neutral" };
    const avg = [...days.values()].reduce((a, b) => a + b, 0) / days.size;
    return { value: money(avg), tone: avg >= 0 ? "pos" : "neg" };
  }},
  { id: "m.tradesperday", label: "Trades per Day", compute: (t, dayKey, financials) => {
    const summary = financials ?? summarizeMetricTrades(t, dayKey);
    if (!summary.net.byDay.size) return { value: "—", tone: "neutral" };
    return { value: (summary.decisionCount / summary.net.byDay.size).toFixed(1), tone: "neutral" };
  }},
  // ---- Day quality ----
  { id: "m.greendays", label: "Green Days", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    let green = 0;
    for (const v of days.values()) if (v > 0) green++;
    return { value: `${green}`, tone: "neutral" };
  }},
  { id: "m.reddays", label: "Red Days", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    let red = 0;
    for (const v of days.values()) if (v < 0) red++;
    return { value: `${red}`, tone: "neutral" };
  }},
  { id: "m.pctgreendays", label: "% Green Days", compute: (t, dayKey, financials) => {
    const days = (financials ?? summarizeMetricTrades(t, dayKey)).net.byDay;
    let green = 0;
    let red = 0;
    for (const v of days.values()) {
      if (v > 0) green++;
      else if (v < 0) red++;
    }
    if (green + red === 0) return { value: "—", tone: "neutral" };
    return { value: `${((green / (green + red)) * 100).toFixed(0)}%`, tone: "neutral" };
  }},

  // ---- Streak (current) ----
  { id: "m.currentstreak", label: "Current Streak", compute: (t, dayKey, financials) => {
    const v = streakStats(t, financials).current;
    if (v === 0) return { value: "—", tone: "neutral" };
    return { value: `${v > 0 ? "+" : ""}${v}`, tone: v > 0 ? "pos" : "neg" };
  }},

  // ---- Trade shape ----
  { id: "m.runnerrate", label: "Runner Rate", compute: (t, dayKey, financials) => {
    // One R per decision, the same base as m.expr: a proportional copy leg is
    // the same decision, never a second runner.
    const rs = (financials ?? summarizeMetricTrades(t, dayKey)).decisions
      .map((d) => tradeR(d.representative))
      .filter((r): r is number => r !== null && Number.isFinite(r));
    if (!rs.length) return { value: "—", tone: "neutral" };
    const pct = (rs.filter((r) => r >= 2).length / rs.length) * 100;
    return { value: `${pct.toFixed(0)}%`, tone: pct >= 30 ? "pos" : "neutral" };
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
