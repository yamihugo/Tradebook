/**
 * Trading Score v3 — five axes in two groups, all nullable, formula declared.
 *
 * Result (how the money reads): Performance (bounded PF + sample confidence),
 * Consistency (green days), Recovery (Net ÷ Max DD).
 * Discipline (how you traded): Risk (losses closed at ≤1R), Behaviour (the
 * Tilt composite inverted — revenge · fast · after-2-losses · adverse state).
 *
 * Journal hygiene (review, rating, stops, strategy) is deliberately NOT graded
 * here: it lives in Focus Areas and the account's Discipline score. The two
 * sub-scores are the means of their groups; the total is the mean of the
 * available axes pulled toward neutral by the coverage factor (`available/5`),
 * so a provisional score cannot read like a fully-evidenced one.
 */

import type { Trade } from "../types";
import { knownFuturesSpec } from "../futures";
import { legBaseKey, uniqueTrades } from "./copy";
import { moneyStats, netByDay } from "./money";
import { computeProcessSignals, netOutcomes } from "./process";
import { maxDrawdown } from "./metrics";
import { inNegativeState } from "./tags";
import { netPnl } from "./fees";

export type ScoreAxisId = "performance" | "consistency" | "recovery" | "risk" | "behaviour";
export type ScoreGroupId = "result" | "discipline";

export interface ScoreCoverage {
  observed: number;
  eligible: number;
  pct: number;
}

export interface ScoreAxis {
  id: ScoreAxisId;
  label: string;
  group: ScoreGroupId;
  weight: 0.2;
  value: number | null;
  /** The metric and value actually observed, ready for the axis detail. */
  observed: string;
  /** Extra context that does not contribute points. */
  context: string;
  coverage: ScoreCoverage;
  sampleSize: number;
  reason: string | null;
}

export type ScoreBand = "bad" | "low" | "mid" | "good" | "top";

export const SCORE_BAND_TOKEN: Record<ScoreBand, string> = {
  bad: "var(--tj-chart-bad)",
  low: "color-mix(in srgb, var(--tj-chart-good) 25%, var(--tj-chart-bad))",
  mid: "color-mix(in srgb, var(--tj-chart-good) 50%, var(--tj-chart-bad))",
  good: "color-mix(in srgb, var(--tj-chart-good) 75%, var(--tj-chart-bad))",
  top: "var(--tj-chart-good)",
};

/** The name the trader sees for each band. A grade, never an unlock. */
export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  bad: "Developing",
  low: "Fair",
  mid: "Solid",
  good: "Strong",
  top: "Leading",
};

export interface ScoreResult {
  axes: ScoreAxis[];
  /** Mean of the available axes; null when none can be evaluated. */
  score: number | null;
  band: ScoreBand | null;
  availableAxes: number;
  complete: boolean;
  /** Mean of the available axes per group; null when the group has none. */
  groups: { result: number | null; discipline: number | null };
  missing: { id: ScoreAxisId; label: string; reason: string }[];
}

export interface RecentScoreWindowOptions {
  /** First day of the week, so "last week" matches the rest of the plugin. */
  weekStart?: "monday" | "sunday";
  period: string;
  customTo?: string;
  /** Explicit cutoff in the `dayKey` domain, when another view owns the calendar range. */
  asOf?: string;
  /** Explicit upper bound in the stored journal-date domain. */
  throughDate?: string;
  /** Today's trading-day key, injected for deterministic tests. */
  today: string;
  dayKey: (t: Trade) => string;
  limit?: number;
}

export interface RecentScoreWindow {
  trades: Trade[];
  asOf: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(observed: number, eligible: number): number {
  return eligible > 0 ? (observed / eligible) * 100 : 0;
}

function shiftDay(iso: string, amount: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** End boundary used by the Home score. Period starts never apply here. */
export function scoreAsOf(period: string, today: string, customTo = "", weekStart: "monday" | "sunday" = "monday"): string {
  if (period === "yesterday") return shiftDay(today, -1);
  if (period === "lastweek") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const offset = weekStart === "sunday" ? dow : (dow + 6) % 7; // days since the week start
    return shiftDay(today, -(offset + 1)); // last week ends the day before it
  }
  if (period === "lastmonth") return shiftDay(`${today.slice(0, 7)}-01`, -1);
  if (period === "lastquarter") {
    const month = Number(today.slice(5, 7));
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3;
    const start = new Date(`${today.slice(0, 4)}-${String(quarterStartMonth + 1).padStart(2, "0")}-01T12:00:00Z`);
    start.setUTCDate(0);
    return start.toISOString().slice(0, 10);
  }
  if (period === "lastyear") return `${Number(today.slice(0, 4)) - 1}-12-31`;
  if (period === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    return customTo < today ? customTo : today;
  }
  return today;
}

/**
 * Home score scope: account filters are applied by the caller first; this
 * helper applies the inclusive as-of boundary, collapses copy legs into one
 * logical decision, and only then selects the latest decisions.
 */
export function recentScoreWindow(trades: Trade[], options: RecentScoreWindowOptions): RecentScoreWindow {
  const asOf = options.asOf ?? scoreAsOf(options.period, options.today, options.customTo, options.weekStart);
  const beforeCutoff = trades.filter(
    (t) =>
      Number.isFinite(t.pnl) &&
      !!t.date &&
      (!options.throughDate || t.date <= options.throughDate) &&
      options.dayKey(t) <= asOf
  );
  const decisions = uniqueTrades(beforeCutoff);
  // Resolve the day key once per decision: calling it inside the comparator
  // runs a timezone conversion on every comparison (O(n log n) formatting).
  const keyed = decisions.map((trade) => ({
    trade,
    day: options.dayKey(trade),
    id: trade.id || legBaseKey(trade),
  }));
  keyed.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.trade.entryTime || "").localeCompare(b.trade.entryTime || "") ||
      a.id.localeCompare(b.id)
  );
  const limit = Math.max(1, options.limit ?? 30);
  return { trades: keyed.slice(-limit).map((x) => x.trade), asOf };
}

function performanceAxis(trades: Trade[]): ScoreAxis {
  const count = trades.length;
  const money = moneyStats(trades);
  // Decided means Net-decided, like the PF next to it: a row that is gross
  // positive and Net negative decided, and counts here.
  const outcomes = netOutcomes(trades);
  const decided = trades.filter((t) => (outcomes.get(t) ?? netPnl(t)) !== 0).length;
  const noDecidedResults = decided === 0;
  const reason =
    count < 20
      ? `Needs at least 20 trades; ${count} available.`
      : noDecidedResults
        ? "No winning or losing results in this sample."
        : null;
  const pf = money.profitFactor;
  // Bounded magnitude: 0 at PF 0, 50 at PF 1, never reaches 100 on its own.
  const magnitude = pf === Infinity ? 100 : clamp((100 * pf) / (pf + 1), 0, 100);
  // Confidence pulls a small sample toward neutral (50), so 30 decisions do
  // not score the same as 500.
  const confidence = count / (count + 30);
  const value = reason ? null : clamp(50 + (magnitude - 50) * confidence, 0, 100);
  const context = reason
    ? noDecidedResults
      ? "No Net wins or losses in this sample."
      : ""
    : pf === Infinity
      ? `No Net losses. Formula: 50 + (100×PF/(PF+1) − 50) × n/(n+30). PF ∞ → ${Math.round(value as number)} pts.`
      : `Formula: 50 + (100×PF/(PF+1) − 50) × n/(n+30). PF ${pf.toFixed(2)}, n ${count} → ${Math.round(value as number)} pts.`;
  const observed = Number.isFinite(pf)
    ? `Net profit factor ${pf.toFixed(2)} over ${count} trades`
    : `Net profit factor ∞ over ${count} trades`;
  return {
    id: "performance",
    label: "Performance",
    group: "result",
    weight: 0.2,
    value,
    observed,
    context,
    coverage: { observed: decided, eligible: count, pct: count ? (decided / count) * 100 : 0 },
    sampleSize: count,
    reason,
  };
}

interface RiskObservation {
  valid: boolean;
  registeredRisk: number;
  lossR: number | null;
  unknownInstrument: boolean;
}

function riskObservation(t: Trade): RiskObservation {
  const spec = knownFuturesSpec(t.symbol || "");
  const entry = Number(t.entryPrice);
  const stop = Number(t.stopLoss);
  const quantity = Number(t.quantity);
  const directionValid = t.direction === "long" || t.direction === "short";
  const sideValid =
    directionValid && Number.isFinite(entry) && Number.isFinite(stop) &&
    (t.direction === "long" ? stop < entry : stop > entry);
  const valid =
    !!spec && Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && stop > 0 &&
    Number.isFinite(quantity) && quantity > 0 && sideValid;
  if (!valid || !spec) return { valid: false, registeredRisk: 0, lossR: null, unknownInstrument: !spec };
  const registeredRisk = Math.abs(entry - stop) * spec.pointValue * quantity;
  // R stays on the recorded result before costs — the ratio is against a
  // planned stop, and Trends' Average R and the account page's Avg R read the
  // same way (recorded decision: tests/trends.test.mjs). What a "loss" *is*
  // stays a Net question everywhere else; here the whole axis is Gross-in,
  // Gross-out so the grade cannot mix two bases.
  return {
    valid: Number.isFinite(registeredRisk) && registeredRisk > 0,
    registeredRisk,
    lossR: t.pnl < 0 && registeredRisk > 0 ? Math.abs(t.pnl) / registeredRisk : null,
    unknownInstrument: false,
  };
}

function riskAxis(trades: Trade[]): ScoreAxis {
  const observations = trades.map(riskObservation);
  const valid = observations.filter((o) => o.valid);
  const losses = observations.filter((o) => o.valid && o.lossR !== null);
  const coveragePct = pct(valid.length, trades.length);
  const disciplined = losses.filter((o) => (o.lossR as number) <= 1).length;
  // Graded loss discipline: each loss scores 1 at ≤1R and 0 at ≥2R, linearly
  // between. Avoids the 1R cliff (a 1.05R loss is not a 3R blowout).
  const perLoss = losses.map((o) => clamp(2 - (o.lossR as number), 0, 1));
  const share = losses.length ? (perLoss.reduce((sum, v) => sum + v, 0) / perLoss.length) * 100 : null;
  const averageLossR = losses.length
    ? losses.reduce((sum, o) => sum + (o.lossR ?? 0), 0) / losses.length
    : null;
  const reasons: string[] = [];
  if (coveragePct < 80) reasons.push(`Registered risk is calculable for ${valid.length}/${trades.length} trades; needs 80%.`);
  if (losses.length < 3) reasons.push(`Needs at least 3 losing trades with valid R; ${losses.length} available.`);
  const unknown = observations.filter((o) => o.unknownInstrument).length;
  return {
    id: "risk",
    label: "Risk",
    group: "discipline",
    weight: 0.2,
    value: reasons.length || share === null ? null : clamp(share, 0, 100),
    observed: share === null
      ? "No valid losing R observations"
      : `${losses.length} losses · average loss ${averageLossR === null ? "—" : averageLossR.toFixed(2)}R`,
    context: share === null
      ? "Risk needs losing trades with a registered stop."
      : `Formula: each loss scores (2 − loss R), capped 0–1; the axis is their mean × 100 — 100 at 1R or less, 0 at 2R or more. ${disciplined}/${losses.length} losses at ≤1R → ${Math.round(share)} pts. Registered stops only, not plan compliance.${unknown ? ` ${unknown} unknown instrument${unknown === 1 ? "" : "s"}.` : ""}`,
    coverage: { observed: valid.length, eligible: trades.length, pct: coveragePct },
    sampleSize: losses.length,
    reason: reasons.length ? reasons.join(" ") : null,
  };
}

/** Recovery factor → 0–100: 0 at ≤0, 50 at 1, 100 at 4 or more. Pure. */
export function recoveryScore(rf: number): number {
  return clamp(rf <= 0 ? 0 : rf >= 4 ? 100 : rf < 1 ? rf * 50 : 50 + ((rf - 1) / 3) * 50, 0, 100);
}

function recoveryAxis(trades: Trade[]): ScoreAxis {
  const count = trades.length;
  const net = moneyStats(trades).net;
  const dd = maxDrawdown(trades);
  const reasons: string[] = [];
  if (count < 10) reasons.push(`Needs at least 10 trades; ${count} available.`);
  if (dd <= 0) reasons.push("No drawdown in this sample.");
  const rf = dd > 0 ? net / dd : null;
  const value = reasons.length || rf === null ? null : recoveryScore(rf);
  return {
    id: "recovery",
    label: "Recovery",
    group: "result",
    weight: 0.2,
    value,
    observed: dd > 0
      ? `Recovery factor ${(rf as number).toFixed(2)} (Net ${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(2)} over $${dd.toFixed(2)} drawdown)`
      : "No drawdown in this sample",
    context: reasons.length
      ? reasons.join(" ")
      : `Formula: Net ÷ Max DD, then 0 at ≤0, 50 at 1, 100 at ≥4. Net ${net.toFixed(2)}, Max DD ${dd.toFixed(2)} → ${Math.round(value as number)} pts.`,
    coverage: { observed: count, eligible: count, pct: count ? 100 : 0 },
    sampleSize: count,
    reason: reasons.length ? reasons.join(" ") : null,
  };
}

function behaviourAxis(trades: Trade[], dayKey: (t: Trade) => string): ScoreAxis {
  const count = trades.length;
  const reason = count < 10 ? `Needs at least 10 trades; ${count} available.` : null;
  const signals = computeProcessSignals(trades, dayKey);
  const afterTwo = count ? (signals.afterTwoLosses / count) * 100 : 0;
  const fast = signals.fastTradesPct;
  const mistake = signals.mistakeRate;
  const adverse = count ? (trades.filter(inNegativeState).length / count) * 100 : 0;
  const tilt = Math.round((afterTwo + fast + mistake + adverse) / 4);
  const value = reason ? null : clamp(100 - tilt, 0, 100);
  return {
    id: "behaviour",
    label: "Behaviour",
    group: "discipline",
    weight: 0.2,
    value,
    observed: `Tilt ${tilt}/100 over ${count} decisions`,
    context: `Formula: 100 − the Tilt mean of four shares — after 2 losses ${afterTwo.toFixed(0)}%, fast ${fast.toFixed(0)}%, mistakes ${mistake.toFixed(0)}%, adverse state ${adverse.toFixed(0)}%.`,
    coverage: { observed: count, eligible: count, pct: count ? 100 : 0 },
    sampleSize: count,
    reason,
  };
}

function consistencyAxis(trades: Trade[], dayKey: (t: Trade) => string): ScoreAxis {
  const days = netByDay(trades, dayKey);
  const total = days.size;
  const green = [...days.values()].filter((v) => v > 0).length;
  const reason = total < 8 ? `Needs at least 8 trading days; ${total} available.` : null;
  const value = reason ? null : total ? (green / total) * 100 : 0;
  return {
    id: "consistency",
    label: "Consistency",
    group: "result",
    weight: 0.2,
    value,
    observed: total ? `${green} of ${total} days green` : "No trading days in this sample",
    context: total
      ? `Formula: green days ÷ trading days. ${green}/${total} → ${Math.round((green / total) * 100)} pts.`
      : "Consistency needs trading days.",
    coverage: { observed: green, eligible: total, pct: total ? (green / total) * 100 : 0 },
    sampleSize: total,
    reason,
  };
}

export function computeScore(trades: Trade[], dayKey: (t: Trade) => string): ScoreResult {
  const scoped = trades.filter((t) => Number.isFinite(t.pnl) && !!t.date);
  const axes: ScoreAxis[] = [
    performanceAxis(scoped),
    consistencyAxis(scoped, dayKey),
    recoveryAxis(scoped),
    riskAxis(scoped),
    behaviourAxis(scoped, dayKey),
  ];
  const available = axes.filter((axis) => axis.value !== null);
  const mean = available.length
    ? available.reduce((sum, axis) => sum + (axis.value as number), 0) / available.length
    : null;
  const groupMean = (group: ScoreGroupId): number | null => {
    const values = axes.filter((axis) => axis.group === group && axis.value !== null).map((axis) => axis.value as number);
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  };
  // Coverage factor: a score built on few axes is pulled toward neutral (50),
  // so a 1/5 provisional cannot read like a fully-evidenced score.
  const coverageFactor = available.length / axes.length;
  const score = mean === null ? null : clamp(50 + (mean - 50) * coverageFactor, 0, 100);
  const band: ScoreBand | null = score === null
    ? null
    : score < 30 ? "bad" : score < 50 ? "low" : score < 70 ? "mid" : score < 90 ? "good" : "top";
  const missing = axes
    .filter((axis) => axis.value === null)
    .map((axis) => ({ id: axis.id, label: axis.label, reason: axis.reason ?? "Not enough data." }));
  return {
    axes,
    score,
    band,
    availableAxes: available.length,
    complete: available.length === axes.length,
    groups: { result: groupMean("result"), discipline: groupMean("discipline") },
    missing,
  };
}

if (typeof window !== "undefined") {
  (window as any).__tjScore = { computeScore, recentScoreWindow, scoreAsOf, recoveryScore };
}
