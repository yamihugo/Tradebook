import type { Trade } from "../types";
import { entryInstantDate, exitInstantDate, holdMinutesOf, chronological, byEntryInstant } from "./instant";
import { knownFuturesSpec } from "../futures";
import { logicalDecisionKey } from "./copy";
import { isEligibleFinancialLeg, summarizeFinancials } from "./money";
import { DEFAULT_REENTRY_WINDOW_MINUTES, netOutcomes } from "./process";
import { netPnl } from "./fees";

/**
 * Trends — "am I getting better?"
 *
 * The journal already tells you what happened. This answers the harder
 * question: is any of it improving? It splits the account's history into two
 * equal halves (the most recent N trades against the N before them) and reports
 * the same metrics on both sides.
 *
 * The honesty rule matters more than the maths: below `MIN_SAMPLE` trades a
 * side, we refuse to claim a direction. A trend drawn from three trades is
 * noise with good presentation, and a journal that invents a trend is worse
 * than one that admits it does not know yet.
 * (docs/UX-GUIDELINES.md §4 — no substitutes; §6 — show the data, not a story.)
 */

/** Trades needed on each side before a direction may be claimed. */
export const MIN_SAMPLE = 10;

/** How many trades per side, unless the history is shorter. */
export const DEFAULT_WINDOW = 20;

/** Is a move distinguishable from chance? A reading, never an instruction. */
export type Reliability = "real" | "unclear" | "noise";

/** Metrics that measure the same thing share a family, so a "top moves" list
 *  never names three variants of one story (avg win / PF / runner rate are all
 *  payoff). */
export type TrendFamily = "result" | "risk" | "hit" | "payoff" | "process" | "consistency" | "timing";

export interface TrendRow {
  id: string;
  label: string;
  /** How the number is written. */
  unit: "money" | "r" | "percent" | "factor" | "minutes";
  before: number | null;
  after: number | null;
  /** after − before, or null when either side is missing. */
  delta: number | null;
  /** "up" | "down" understood as improvement, or null when neutral. */
  betterWhen: "up" | "down" | null;
  family: TrendFamily;
  /** True for the seven the table always shows. */
  core: boolean;
  /** Two-sided permutation p-value for the delta, or null when untestable. */
  p: number | null;
  /** Reading of `p`: how likely the move is to be more than noise. */
  reliability: Reliability | null;
}

export interface Trends {
  window: number;
  nBefore: number;
  nAfter: number;
  /** True when both sides hold at least MIN_SAMPLE trades. */
  enough: boolean;
  minSample: number;
  /** The seven the table always shows, in fixed order. */
  rows: TrendRow[];
  /** Every candidate measured on both sides, for the "top moves" ranking. */
  moves: TrendRow[];
  /**
   * How many trades actually carry the field a metric needs. A row that reads
   * "—" because nobody recorded a stop loss is a different problem from one that
   * reads "—" because there are no trades, and the user can only act on the
   * first if we say so.
   */
  coverage: Array<{ metric: string; have: number; total: number; needs: string }>;
}

/** Minutes of "HH:MM", or null when the string is not a time. */
const minutesOfTime = (s: unknown): number | null => {
  const m = (typeof s === "string" ? s : "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 60 + minute + second / 60;
};

/** Absolute minutes for a moment (date + time), so gaps across midnight work.
 *  The floor is a UTC calendar date: the same scale on every machine, with no
 *  host-zone offset folded in. */
const absMinutes = (date: string, time: unknown): number | null => {
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return null;
  const day = Date.UTC(y, m - 1, d);
  if (Number.isNaN(day)) return null;
  const minute = minutesOfTime(time);
  return minute === null ? null : day / 60000 + minute;
};

/** When the trade was entered / left, in absolute minutes: the canonical
 *  instants when the note has them, the recorded clock otherwise. */
const entryAbs = (t: Trade): number | null => {
  const instant = entryInstantDate(t);
  if (instant) return instant.getTime() / 60000;
  return t.date ? absMinutes(t.date, t.entryTime) : null;
};

const exitAbs = (t: Trade): number | null => {
  const instant = exitInstantDate(t);
  if (instant) return instant.getTime() / 60000;
  const entry = entryAbs(t);
  if (entry === null) return null;
  const out = minutesOfTime(t.exitTime);
  const inTime = minutesOfTime(t.entryTime);
  if (out === null || inTime === null) return null;
  const elapsed = out >= inTime ? out - inTime : out + 1440 - inTime;
  return entry + elapsed;
};

/** Minutes held: real elapsed time from the instants, recorded clock else. */
const holdMinutes = (t: Trade): number | null => holdMinutesOf(t);

const rMultiple = (t: Trade): number | null => {
  const stop = Number(t.stopLoss);
  const entry = Number(t.entryPrice);
  const qty = Number(t.quantity);
  const spec = knownFuturesSpec(t.symbol);
  if (!spec || !Number.isFinite(stop) || !Number.isFinite(entry) || entry <= 0 || stop <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
  if (t.direction === "long" ? stop >= entry : t.direction === "short" ? stop <= entry : true) return null;
  const risk = Math.abs(entry - stop) * spec.pointValue * qty;
  if (!(risk > 0)) return null;
  return t.pnl / risk;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Revenge: entered within the window of the previous losing exit, where
 *  "losing" is the Net of the decision. A trend-sweep definition, looser than
 *  process.ts's observed re-entry (which also requires the same day and symbol).
 *  Returns a flag per trade so the rate and its confidence read the same sweep. */
const revengeFlags = (trades: Trade[], financials: ReturnType<typeof summarizeFinancials>, windowMinutes: number): Map<Trade, boolean> => {
  const ordered = chronological(trades);
  const outcomes = netOutcomes(trades, financials);
  const flags = new Map<Trade, boolean>();
  let lastLossExit: number | null = null;
  for (const t of ordered) {
    const at = entryAbs(t);
    let flag = false;
    if (at !== null && lastLossExit !== null) {
      const gap = at - lastLossExit;
      if (gap >= 0 && gap <= windowMinutes) flag = true;
    }
    flags.set(t, flag);
    if ((outcomes.get(t) ?? netPnl(t)) < 0) lastLossExit = exitAbs(t);
  }
  return flags;
};

/** Every metric a trend row can hold, computed over one side of the split. */
const measure = (trades: Trade[], financials: ReturnType<typeof summarizeFinancials>, windowMinutes: number): Record<string, number | null> => {
  const n = trades.length;
  // Net of the decision, after costs: the same classification as every other
  // unqualified win/loss in the product.
  const wins = financials.decisions.filter((decision) => decision.net > 0).length;
  const losses = financials.decisions.filter((decision) => decision.net < 0).length;

  const rs = trades.map(rMultiple).filter((r): r is number => r !== null);
  const holds = trades.map(holdMinutes).filter((h): h is number => h !== null);
  const mistakes = trades.filter((t) => String(t.mistake ?? "").trim()).length;
  const revenge = [...revengeFlags(trades, financials, windowMinutes).values()].filter(Boolean).length;

  // Runner rate: decisions that reached at least 2R, over those with a usable R.
  const runners = rs.filter((r) => r >= 2).length;
  // Green days: positive days over decided days (a flat day is neither).
  let green = 0;
  let red = 0;
  for (const v of financials.net.byDay.values()) {
    if (v > 0) green++;
    else if (v < 0) red++;
  }

  return {
    expectancy: financials.net.averagePerDecision,
    r: mean(rs),
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    profitFactor: financials.net.profitFactor,
    mistakeRate: n ? (mistakes / n) * 100 : null,
    revengeRate: n ? (revenge / n) * 100 : null,
    hold: mean(holds),
    avgWin: financials.net.averageWinPerDecision,
    avgLoss: financials.net.averageLossPerDecision,
    runnerRate: rs.length ? (runners / rs.length) * 100 : null,
    greenDays: green + red ? (green / (green + red)) * 100 : null,
  };
};

interface TrendMetricDef {
  id: string;
  label: string;
  unit: TrendRow["unit"];
  betterWhen: TrendRow["betterWhen"];
  family: TrendFamily;
  /** The seven the table always shows. */
  core: boolean;
}

/**
 * Every metric the trend engine measures on both sides. The first seven are the
 * core table; the rest feed the "top moves" ranking. `betterWhen` is the
 * direction of improvement — `null` means the move has no good or bad way, so
 * the metric is shown but never ranked.
 */
const TREND_METRICS: TrendMetricDef[] = [
  { id: "expectancy", label: "Avg Net Result per Trade", unit: "money", betterWhen: "up", family: "result", core: true },
  { id: "r", label: "Average R", unit: "r", betterWhen: "up", family: "risk", core: true },
  { id: "winRate", label: "Net win rate", unit: "percent", betterWhen: "up", family: "hit", core: true },
  { id: "profitFactor", label: "Net Profit Factor", unit: "factor", betterWhen: "up", family: "payoff", core: true },
  { id: "mistakeRate", label: "Tagged mistakes", unit: "percent", betterWhen: "down", family: "process", core: true },
  { id: "revengeRate", label: "Quick re-entry after loss", unit: "percent", betterWhen: "down", family: "process", core: true },
  { id: "hold", label: "Average hold", unit: "minutes", betterWhen: null, family: "timing", core: true },
  { id: "avgWin", label: "Average win", unit: "money", betterWhen: "up", family: "payoff", core: false },
  { id: "avgLoss", label: "Average loss", unit: "money", betterWhen: "down", family: "payoff", core: false },
  { id: "runnerRate", label: "Runner rate", unit: "percent", betterWhen: "up", family: "payoff", core: false },
  { id: "greenDays", label: "% Green days", unit: "percent", betterWhen: "up", family: "consistency", core: false },
];

/** How many shuffles the test runs. Fixed so the same history always reads the
 *  same way, and a seeded generator so the result is reproducible in tests. */
export const PERMUTATIONS = 1000;

/** Deterministic PRNG (mulberry32) — same input, same p-value, every render. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** The per-decision values a metric is built from, so the same statistic can be
 *  recomputed on a shuffled split. Empty when the metric is not testable. */
const valuesFor = (id: string, trades: Trade[], financials: ReturnType<typeof summarizeFinancials>, windowMinutes: number): number[] => {
  switch (id) {
    case "expectancy":
    case "profitFactor":
      // One value per decision: the Net of the aggregated decision.
      return financials.decisions.map((decision) => decision.net);
    case "winRate":
      // Decided results only — a break-even is not a win or a loss.
      return financials.decisions.filter((decision) => decision.net !== 0).map((decision) => (decision.net > 0 ? 1 : 0));
    case "avgWin":
      return financials.decisions.filter((decision) => decision.net > 0).map((decision) => decision.net);
    case "avgLoss":
      // A loss written as a positive magnitude, so "smaller is better" holds.
      return financials.decisions.filter((decision) => decision.net < 0).map((decision) => -decision.net);
    case "runnerRate":
      return trades
        .map(rMultiple)
        .filter((r): r is number => r !== null)
        .map((r) => (r >= 2 ? 1 : 0));
    case "greenDays":
      return [...financials.net.byDay.values()].filter((v) => v !== 0).map((v) => (v > 0 ? 1 : 0));
    case "r":
      return trades.map(rMultiple).filter((r): r is number => r !== null);
    case "hold":
      return trades.map(holdMinutes).filter((h): h is number => h !== null);
    case "mistakeRate":
      return trades.map((t) => (String(t.mistake ?? "").trim() ? 1 : 0));
    case "revengeRate": {
      const flags = revengeFlags(trades, financials, windowMinutes);
      return trades.map((t) => (flags.get(t) ? 1 : 0));
    }
    default:
      return [];
  }
};

/** Recompute a metric from its per-decision values. Percent metrics are means
 *  of 0/1, profit factor is the ratio of sums, the rest are plain means. */
const statFor = (id: string, xs: number[]): number | null => {
  if (!xs.length) return null;
  if (id === "profitFactor") {
    const pos = xs.filter((x) => x > 0).reduce((s, x) => s + x, 0);
    const neg = Math.abs(xs.filter((x) => x < 0).reduce((s, x) => s + x, 0));
    if (neg > 0) return pos / neg;
    return pos > 0 ? Infinity : null;
  }
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const percent = id === "winRate" || id === "mistakeRate" || id === "revengeRate" || id === "runnerRate" || id === "greenDays";
  return percent ? m * 100 : m;
};

/**
 * Two-sided permutation test: pool both sides, shuffle many times, and measure
 * how often chance produces a delta at least as large as the one observed.
 * Distribution-free and deliberately blunt — with ~20 trades a side, most real
 * week-to-week moves are indistinguishable from noise, and saying so is the
 * point. Never an instruction, only a reading.
 */
const permutationP = (before: number[], after: number[], stat: (xs: number[]) => number | null, rng: () => number): number | null => {
  const sa = stat(before);
  const sb = stat(after);
  if (sa === null || sb === null || !Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  const observed = Math.abs(sb - sa);
  const pooled = [...before, ...after];
  const nBefore = before.length;
  if (pooled.length < 4) return null;
  let hits = 0;
  let tested = 0;
  for (let i = 0; i < PERMUTATIONS; i++) {
    for (let j = pooled.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [pooled[j], pooled[k]] = [pooled[k], pooled[j]];
    }
    const shuffledA = pooled.slice(0, nBefore);
    const shuffledB = pooled.slice(nBefore);
    const ta = stat(shuffledA);
    const tb = stat(shuffledB);
    if (ta === null || tb === null || !Number.isFinite(ta) || !Number.isFinite(tb)) continue;
    tested++;
    if (Math.abs(tb - ta) >= observed - 1e-9) hits++;
  }
  return tested ? hits / tested : null;
};

/** Reading of a p-value. House thresholds: a move has to be quite unlikely to
 *  be chance before we call it real; everything else is noise. */
const reliabilityOf = (p: number | null): Reliability | null => {
  if (p === null) return null;
  if (p <= 0.05) return "real";
  if (p <= 0.2) return "unclear";
  return "noise";
};

/**
 * Split `trades` in half and measure both sides. The lists are chronological,
 * so "before" is the older half — the same order the equity curve uses.
 *
 * `dayKey` is the caller's journal day convention. The rows themselves read
 * decisions and Net totals, which do not depend on the day; it is threaded so
 * the summary this builds never comes back carrying day buckets on the
 * recorded date's convention.
 */
export interface DecisionGroup {
  representative: Trade;
  legs: Trade[];
}

/** One logical decision per group, chronological. Copies collapse to one row. */
const buildDecisions = (trades: Trade[]): DecisionGroup[] => {
  const groups = new Map<string, DecisionGroup>();
  let anonymous = 0;
  for (const trade of trades.filter(isEligibleFinancialLeg)) {
    const durable = logicalDecisionKey(trade);
    const key = durable ?? `unidentified:${String(trade.id ?? "") || anonymous++}`;
    const current = groups.get(key);
    if (current) {
      current.legs.push(trade);
      if (current.representative.isCopiedTrade && !trade.isCopiedTrade) current.representative = trade;
    } else groups.set(key, { representative: trade, legs: [trade] });
  }
  return [...groups.values()].sort((a, b) =>
    // Chronological by instant when both notes carry one; the recorded clock
    // (date then time) decides otherwise — the shared rule in lib/instant.ts.
    byEntryInstant(a.representative, b.representative)
  );
};

/** Net summary of a set of decisions, scoped to exactly the legs in the set. */
const summarizeGroups = (groups: DecisionGroup[], dayKey?: (t: Trade) => string) => {
  const legs = groups.flatMap((group) => group.legs);
  const accountKey = (t: Trade): string => String(t.account ?? "").trim().toLocaleLowerCase() || "unassigned";
  return summarizeFinancials(legs, {
    scope: { kind: "all-included-accounts", accountIdOf: accountKey, includedAccountIds: new Set(legs.map(accountKey)) },
    dayKey: dayKey ?? ((t) => t.date),
  });
};

export function computeTrends(
  trades: Trade[],
  opts: { window?: number; minSample?: number; dayKey?: (t: Trade) => string; reentryWindowMinutes?: number } = {},
): Trends {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const windowMinutes = opts.reentryWindowMinutes ?? DEFAULT_REENTRY_WINDOW_MINUTES;
  const clean = buildDecisions(trades);

  const half = Math.floor(clean.length / 2);
  const window = Math.min(opts.window ?? DEFAULT_WINDOW, half);
  const before = window > 0 ? clean.slice(clean.length - window * 2, clean.length - window) : [];
  const after = window > 0 ? clean.slice(clean.length - window) : [];
  const beforeTrades = before.map((group) => group.representative);
  const afterTrades = after.map((group) => group.representative);

  // Coverage is judged on the whole history, so a row that can never fill says
  // why. Win rate needs a decided result; profit factor needs a losing decision
  // to be finite. Both are read from the same Net classification the rows use.
  const outcomes = netOutcomes(clean.flatMap((group) => group.legs));
  const netOf = (group: (typeof clean)[number]): number =>
    outcomes.get(group.representative) ?? netPnl(group.representative);
  const decided = clean.filter((group) => netOf(group) !== 0).length;
  const losers = clean.filter((group) => netOf(group) < 0).length;

  const finBefore = summarizeGroups(before, opts.dayKey);
  const finAfter = summarizeGroups(after, opts.dayKey);
  const a = measure(beforeTrades, finBefore, windowMinutes);
  const b = measure(afterTrades, finAfter, windowMinutes);
  // Seed from the sample size on both sides, so identical input yields the same
  // p-value on every render (no flicker between shuffles).
  const rng = mulberry32(0x9e3779b9 ^ (beforeTrades.length << 16) ^ afterTrades.length);
  const moves: TrendRow[] = TREND_METRICS.map((row) => {
    const bv = a[row.id] ?? null;
    const av = b[row.id] ?? null;
    const delta = bv !== null && av !== null && Number.isFinite(bv) && Number.isFinite(av) ? av - bv : null;
    const p = delta === null
      ? null
      : permutationP(valuesFor(row.id, beforeTrades, finBefore, windowMinutes), valuesFor(row.id, afterTrades, finAfter, windowMinutes), (xs) => statFor(row.id, xs), rng);
    return { ...row, before: bv, after: av, delta, p, reliability: reliabilityOf(p) };
  });
  const rows = moves.filter((row) => row.core);

  return {
    window,
    nBefore: before.length,
    nAfter: after.length,
    enough: window >= minSample,
    minSample,
    rows,
    moves,
    coverage: [
      {
        metric: "r",
        have: clean.filter((group) => rMultiple(group.representative) !== null).length,
        total: clean.length,
        needs: "a stop loss and an entry price",
      },
      {
        metric: "hold",
        have: clean.filter((group) => holdMinutes(group.representative) !== null).length,
        total: clean.length,
        needs: "an entry time and an exit time",
      },
      {
        metric: "winRate",
        have: decided,
        total: clean.length,
        needs: "a decided result (a win or a loss)",
      },
      {
        metric: "profitFactor",
        have: losers,
        total: clean.length,
        needs: "at least one losing decision",
      },
    ],
  };
}

/** True when the metric moved in the direction that is an improvement. */
export function isBetter(row: TrendRow): boolean | null {
  if (row.betterWhen === null || row.delta === null) return null;
  // Standing still is not an improvement and not a decline.
  if (Math.abs(row.delta) < 1e-9) return null;
  return row.betterWhen === "up" ? row.delta > 0 : row.delta < 0;
}

export interface RankedMoves {
  gains: TrendRow[];
  declines: TrendRow[];
}

/**
 * The "top moves" list: improvements and declines ranked by how far they stand
 * out from chance (`p`, which has no unit) and never three variants of one
 * story (one metric per family). Noise is excluded — a list padded with chance
 * would be a story we invented. Pure and deterministic.
 */
export function rankTrendMoves(rows: TrendRow[], opts: { limit?: number } = {}): RankedMoves {
  const limit = opts.limit ?? 3;
  const rank = (want: boolean): TrendRow[] => {
    const pool = rows
      .filter((row) => row.delta !== null && isBetter(row) === want && row.reliability !== null && row.reliability !== "noise")
      .sort((a, b) => (a.p ?? 1) - (b.p ?? 1) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
    const out: TrendRow[] = [];
    const seenFamilies = new Set<TrendFamily>();
    for (const row of pool) {
      if (seenFamilies.has(row.family)) continue;
      seenFamilies.add(row.family);
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  };
  return { gains: rank(true), declines: rank(false) };
}

// Test hook: the harness reads the maths straight from the module. The widget
// moved off the account page, but the numbers must keep their coverage.
if (typeof window !== "undefined") {
  (window as any).__tjTrends = { computeTrends, rankTrendMoves, isBetter, MIN_SAMPLE, DEFAULT_WINDOW, PERMUTATIONS };
}
