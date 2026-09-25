import type { Trade } from "../types";
import { entryInstantDate, exitInstantDate, holdMinutesOf } from "./instant";
import { knownFuturesSpec } from "../futures";
import { logicalDecisionKey } from "./copy";
import { isEligibleFinancialLeg, summarizeFinancials } from "./money";

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
}

export interface Trends {
  window: number;
  nBefore: number;
  nAfter: number;
  /** True when both sides hold at least MIN_SAMPLE trades. */
  enough: boolean;
  minSample: number;
  rows: TrendRow[];
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
  const m = String(s ?? "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
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

/** Every metric a trend row can hold, computed over one side of the split. */
const measure = (trades: Trade[], financials: ReturnType<typeof summarizeFinancials>): Record<string, number | null> => {
  const n = trades.length;
  const wins = financials.decisions.filter((decision) => decision.gross > 0).length;
  const losses = financials.decisions.filter((decision) => decision.gross < 0).length;

  const rs = trades.map(rMultiple).filter((r): r is number => r !== null);
  const holds = trades.map(holdMinutes).filter((h): h is number => h !== null);
  const mistakes = trades.filter((t) => String(t.mistake ?? "").trim()).length;

  // Revenge: entered within 15 minutes of the previous losing exit.
  const ordered = [...trades].sort((a, b) => (entryAbs(a) ?? 0) - (entryAbs(b) ?? 0));
  let revenge = 0;
  let lastLossExit: number | null = null;
  for (const t of ordered) {
    const at = entryAbs(t);
    if (at !== null && lastLossExit !== null) {
      const gap = at - lastLossExit;
      if (gap >= 0 && gap <= 15) revenge++;
    }
    if (t.pnl < 0) lastLossExit = exitAbs(t);
  }

  return {
    expectancy: financials.net.averagePerDecision,
    r: mean(rs),
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    profitFactor: financials.net.profitFactor,
    mistakeRate: n ? (mistakes / n) * 100 : null,
    revengeRate: n ? (revenge / n) * 100 : null,
    hold: mean(holds),
  };
};

const ROWS: Array<{ id: string; label: string; unit: TrendRow["unit"]; betterWhen: TrendRow["betterWhen"] }> = [
  { id: "expectancy", label: "Avg Net Result per Trade", unit: "money", betterWhen: "up" },
  { id: "r", label: "Average R", unit: "r", betterWhen: "up" },
  { id: "winRate", label: "Gross-sign win rate", unit: "percent", betterWhen: "up" },
  { id: "profitFactor", label: "Net Profit Factor", unit: "factor", betterWhen: "up" },
  { id: "mistakeRate", label: "Tagged mistakes", unit: "percent", betterWhen: "down" },
  { id: "revengeRate", label: "Quick re-entry after loss", unit: "percent", betterWhen: "down" },
  { id: "hold", label: "Average hold", unit: "minutes", betterWhen: null },
];

/**
 * Split `trades` in half and measure both sides. The lists are chronological,
 * so "before" is the older half — the same order the equity curve uses.
 */
export function computeTrends(trades: Trade[], opts: { window?: number; minSample?: number } = {}): Trends {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const groups = new Map<string, { representative: Trade; legs: Trade[] }>();
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
  const clean = [...groups.values()].sort((a, b) => {
    // Chronological by instant when both notes carry one; the recorded clock
    // (date then time) decides otherwise.
    const ia = entryInstantDate(a.representative)?.getTime();
    const ib = entryInstantDate(b.representative)?.getTime();
    if (ia !== undefined && ib !== undefined && ia !== ib) return ia - ib;
    return (a.representative.date + (a.representative.entryTime ?? "")).localeCompare(
      b.representative.date + (b.representative.entryTime ?? "")
    );
  });

  const half = Math.floor(clean.length / 2);
  const window = Math.min(opts.window ?? DEFAULT_WINDOW, half);
  const before = window > 0 ? clean.slice(clean.length - window * 2, clean.length - window) : [];
  const after = window > 0 ? clean.slice(clean.length - window) : [];
  const summaryFor = (groups: typeof clean) => {
    const legs = groups.flatMap((group) => group.legs);
    const accountKey = (t: Trade): string => String(t.account ?? "").trim().toLocaleLowerCase() || "unassigned";
    return summarizeFinancials(legs, {
      scope: { kind: "all-included-accounts", accountIdOf: accountKey, includedAccountIds: new Set(legs.map(accountKey)) },
      dayKey: (t) => t.date,
    });
  };
  const beforeTrades = before.map((group) => group.representative);
  const afterTrades = after.map((group) => group.representative);

  const a = measure(beforeTrades, summaryFor(before));
  const b = measure(afterTrades, summaryFor(after));
  const rows: TrendRow[] = ROWS.map((row) => {
    const bv = a[row.id] ?? null;
    const av = b[row.id] ?? null;
    const delta = bv !== null && av !== null && Number.isFinite(bv) && Number.isFinite(av) ? av - bv : null;
    return { ...row, before: bv, after: av, delta };
  });

  return {
    window,
    nBefore: before.length,
    nAfter: after.length,
    enough: window >= minSample,
    minSample,
    rows,
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

// Test hook: the harness reads the maths straight from the module. The widget
// moved off the account page, but the numbers must keep their coverage.
if (typeof window !== "undefined") {
  (window as any).__tjTrends = { computeTrends, isBetter, MIN_SAMPLE, DEFAULT_WINDOW };
}
