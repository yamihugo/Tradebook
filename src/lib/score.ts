/**
 * Trading Score v2 — five equal axes, with unavailable evidence kept as null.
 *
 * v2 changes, in response to the "Performance pinned at 100" problem:
 *  - Performance uses a bounded PF transform plus a sample-confidence factor,
 *    so it moves for every PF value instead of saturating at PF ≥ 2.
 *  - Risk scores loss discipline: the share of losing decisions closed at ≤1R.
 *  - Consistency scores the share of green trading days.
 *  - The composite applies a coverage factor (`available axes / 5`) so a
 *    provisional score cannot read like a fully-evidenced one.
 */

import type { Trade } from "../types";
import { knownFuturesSpec } from "../futures";
import { legBaseKey, uniqueTrades } from "./copy";
import { moneyStats, netByDay } from "./money";
import { reviewSummary } from "./review";

export type ScoreAxisId = "performance" | "risk" | "execution" | "process" | "consistency";

export interface ScoreCoverage {
  observed: number;
  eligible: number;
  pct: number;
}

export interface ScoreAxis {
  id: ScoreAxisId;
  label: string;
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

export interface ScoreResult {
  axes: ScoreAxis[];
  /** Mean of the available axes; null when none can be evaluated. */
  score: number | null;
  band: ScoreBand | null;
  availableAxes: number;
  complete: boolean;
  missing: { id: ScoreAxisId; label: string; reason: string }[];
}

export interface RecentScoreWindowOptions {
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
export function scoreAsOf(period: string, today: string, customTo = ""): string {
  if (period === "yesterday") return shiftDay(today, -1);
  if (period === "lastweek") {
    const date = new Date(`${today}T12:00:00Z`);
    const mondayIndex = date.getUTCDay() || 7;
    return shiftDay(today, -mondayIndex);
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
  const asOf = options.asOf ?? scoreAsOf(options.period, options.today, options.customTo);
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
  const decided = trades.filter((t) => t.pnl !== 0).length;
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

function executionAxis(trades: Trade[]): ScoreAxis {
  const rated = trades.filter((t) => Number.isFinite(Number(t.rating)) && Number(t.rating) >= 1 && Number(t.rating) <= 5);
  const average = rated.length ? rated.reduce((sum, t) => sum + (t.rating as number), 0) / rated.length : null;
  const coveragePct = pct(rated.length, trades.length);
  const reason = coveragePct < 80
    ? `Valid ratings cover ${rated.length}/${trades.length} trades; needs 80%.`
    : null;
  return {
    id: "execution",
    label: "Execution",
    weight: 0.2,
    value: reason || average === null ? null : clamp((average - 1) * 25, 0, 100),
    observed: average === null ? "No valid ratings" : `Average rating ${average.toFixed(2)}/5`,
    context: average === null
      ? "Formula: (average rating − 1) × 25."
      : `Formula: (average rating − 1) × 25. (${average.toFixed(2)} − 1) × 25 → ${Math.round(clamp((average - 1) * 25, 0, 100))} pts. Mistakes are context, not a deduction.`,
    coverage: { observed: rated.length, eligible: trades.length, pct: coveragePct },
    sampleSize: rated.length,
    reason,
  };
}

function processAxis(trades: Trade[]): ScoreAxis {
  const reviews = reviewSummary(trades);
  const reason = trades.length < 20 ? `Needs at least 20 trades; ${trades.length} available.` : null;
  return {
    id: "process",
    label: "Process",
    weight: 0.2,
    value: reason ? null : reviews.pct,
    observed: `${reviews.complete} of ${reviews.total} reviews complete`,
    context: `Formula: review-complete trades ÷ trades. ${reviews.complete}/${reviews.total} → ${reviews.pct} pts.`,
    coverage: { observed: reviews.complete, eligible: reviews.total, pct: reviews.pct },
    sampleSize: reviews.total,
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
    riskAxis(scoped),
    executionAxis(scoped),
    processAxis(scoped),
    consistencyAxis(scoped, dayKey),
  ];
  const available = axes.filter((axis) => axis.value !== null);
  const mean = available.length
    ? available.reduce((sum, axis) => sum + (axis.value as number), 0) / available.length
    : null;
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
    missing,
  };
}

if (typeof window !== "undefined") {
  (window as any).__tjScore = { computeScore, recentScoreWindow, scoreAsOf };
}
