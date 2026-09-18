import type { Trade } from "../types";
import { futuresSpec } from "../futures";

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
  const m = String(s ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Absolute minutes for a moment (date + time), so gaps across midnight work. */
const absMinutes = (date: string, time: unknown): number | null => {
  const day = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(day)) return null;
  return day / 60000 + (minutesOfTime(time) ?? 0);
};

/** When the trade was entered / left, in absolute minutes. */
const entryAbs = (t: Trade): number | null => (t.date ? absMinutes(t.date, t.entryTime) : null);

const exitAbs = (t: Trade): number | null => {
  const entry = entryAbs(t);
  if (entry === null) return null;
  const out = minutesOfTime(t.exitTime);
  return out === null ? entry : entry - (minutesOfTime(t.entryTime) ?? 0) + out;
};

const holdMinutes = (t: Trade): number | null => {
  const from = minutesOfTime(t.entryTime);
  const to = minutesOfTime(t.exitTime);
  if (from === null || to === null) return null;
  const diff = to - from;
  // A trade that closes after midnight is the same trade, not a negative one.
  return diff >= 0 ? diff : diff + 1440;
};

const rMultiple = (t: Trade): number | null => {
  const stop = Number(t.stopLoss);
  const entry = Number(t.entryPrice);
  if (!Number.isFinite(stop) || !Number.isFinite(entry) || stop <= 0) return null;
  const qty = Number.isFinite(t.quantity) && t.quantity > 0 ? t.quantity : 1;
  const risk = Math.abs(entry - stop) * futuresSpec(t.symbol).pointValue * qty;
  if (!(risk > 0)) return null;
  return t.pnl / risk;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Every metric a trend row can hold, computed over one side of the split. */
const measure = (trades: Trade[]): Record<string, number | null> => {
  const n = trades.length;
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const decided = wins.length + losses.length;

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
    expectancy: n ? net / n : null,
    r: mean(rs),
    winRate: decided ? (wins.length / decided) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : null,
    mistakeRate: n ? (mistakes / n) * 100 : null,
    revengeRate: n ? (revenge / n) * 100 : null,
    hold: mean(holds),
  };
};

const ROWS: Array<{ id: string; label: string; unit: TrendRow["unit"]; betterWhen: TrendRow["betterWhen"] }> = [
  { id: "expectancy", label: "Expectancy per trade", unit: "money", betterWhen: "up" },
  { id: "r", label: "Average R", unit: "r", betterWhen: "up" },
  { id: "winRate", label: "Win rate", unit: "percent", betterWhen: "up" },
  { id: "profitFactor", label: "Profit factor", unit: "factor", betterWhen: "up" },
  { id: "mistakeRate", label: "Tagged mistakes", unit: "percent", betterWhen: "down" },
  { id: "revengeRate", label: "Revenge trades", unit: "percent", betterWhen: "down" },
  { id: "hold", label: "Average hold", unit: "minutes", betterWhen: null },
];

/**
 * Split `trades` in half and measure both sides. The lists are chronological,
 * so "before" is the older half — the same order the equity curve uses.
 */
export function computeTrends(trades: Trade[], opts: { window?: number; minSample?: number } = {}): Trends {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const clean = trades
    .filter((t) => Number.isFinite(t.pnl) && !!t.date)
    .sort((a, b) => (a.date + (a.entryTime ?? "")).localeCompare(b.date + (b.entryTime ?? "")));

  const half = Math.floor(clean.length / 2);
  const window = Math.min(opts.window ?? DEFAULT_WINDOW, half);
  const before = window > 0 ? clean.slice(clean.length - window * 2, clean.length - window) : [];
  const after = window > 0 ? clean.slice(clean.length - window) : [];

  const a = measure(before);
  const b = measure(after);
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
        have: clean.filter((t) => rMultiple(t) !== null).length,
        total: clean.length,
        needs: "a stop loss and an entry price",
      },
      {
        metric: "hold",
        have: clean.filter((t) => holdMinutes(t) !== null).length,
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
