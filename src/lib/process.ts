/**
 * Process / discipline signals — pure, cross-account.
 *
 * These answer "how am I trading?", not "how much did I make?". They need only
 * the filtered trade list and a timezone-aware `dayKey`; no account rules, no
 * balances. `accountMetrics.computeAccountMetrics` consumes them so the account
 * page and Home/Dashboard read one definition.
 *
 * Classification is by the gross sign of `t.pnl` (see docs/ARCHITECTURE.md).
 */

import type { Trade } from "../types";
import { reviewStatus } from "./review";

/** "HH:MM" (or "HH:MM:SS") into minutes from midnight, or null. */
const minutesOf = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t || "");
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0) : null;
};

export interface ProcessSignals {
  tradeCount: number;
  /** Trades carrying a non-empty mistake label, as a percentage. */
  mistakeRate: number;
  avgRating: number;
  /** Required checklist complete, as a percentage (see lib/review.ts). */
  reviewCompletePct: number;
  stopDefinedPct: number;
  untaggedPct: number;
  /** Trades opened and closed inside one minute, as a percentage. */
  fastTradesPct: number;
  /** Trades opened right after two consecutive losses. */
  afterTwoLosses: number;
  revengeCount: number;
  revengeRate: number;
  tradesPerDay: number;
  maxTradesInDay: number;
  /** Signed: positive = current win run, negative = current loss run. */
  streakCurrent: number;
  streakWinBest: number;
  streakLossWorst: number;
}

/**
 * Revenge: a re-entry within 15 minutes of a loss on the SAME symbol, or any
 * trade the trader explicitly flagged as a mistake right after a loss.
 */
export function revengeStats(trades: Trade[]): { count: number; rate: number } {
  const ordered = [...trades].sort((a, b) =>
    (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || ""))
  );
  let count = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev.pnl >= 0 || prev.date !== cur.date) continue;
    const out = minutesOf(prev.exitTime);
    const inn = minutesOf(cur.entryTime);
    const quick = out !== null && inn !== null && inn >= out && inn - out <= 15;
    const sameSymbol = (prev.symbol || "") === (cur.symbol || "");
    const flagged = (cur.mistake || "").trim().length > 0;
    if ((quick && sameSymbol) || flagged) count += 1;
  }
  return { count, rate: trades.length ? (count / trades.length) * 100 : 0 };
}

/** Current / best-win / worst-loss runs. Break-even pauses a run, never resets it. */
export function streakStats(trades: Trade[]): { current: number; bestWin: number; worstLoss: number } {
  let bestWin = 0;
  let worstLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of [...trades].sort((a, b) =>
    (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || ""))
  )) {
    if (t.pnl > 0) {
      curWin += 1;
      curLoss = 0;
      bestWin = Math.max(bestWin, curWin);
    } else if (t.pnl < 0) {
      curLoss += 1;
      curWin = 0;
      worstLoss = Math.max(worstLoss, curLoss);
    }
    // break-even: pause the run (do not reset) — matches common journal behaviour
  }
  const lastNonFlat = [...trades]
    .sort((a, b) => (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || "")))
    .filter((t) => t.pnl !== 0)
    .pop();
  const current = lastNonFlat ? (lastNonFlat.pnl > 0 ? curWin : -curLoss) : 0;
  return { current, bestWin, worstLoss };
}

/**
 * A calm, motivating phrase for the current run. No scolding — a loss run is a
 * prompt to refocus, never a verdict.
 */
export function streakState(current: number): string {
  if (current > 0) {
    if (current >= 10) return "locked in";
    if (current >= 8) return "unstoppable";
    if (current >= 6) return "on fire";
    if (current >= 5) return "focused";
    if (current >= 4) return "in the zone";
    if (current >= 3) return "on a roll";
    if (current >= 2) return "building up";
    return "good start";
  }
  if (current < 0) {
    const n = -current;
    if (n >= 5) return "back to basics";
    if (n >= 4) return "breathe";
    if (n >= 3) return "reset";
    if (n >= 2) return "refocus";
    return "stay calm";
  }
  return "ready";
}

/**
 * All process signals for a trade list. `dayKey` decides what "a day" is, so the
 * caller controls the timezone.
 */
export function computeProcessSignals(trades: Trade[], dayKey: (t: Trade) => string): ProcessSignals {
  const tradeCount = trades.length;
  const pct = (n: number): number => (tradeCount ? (n / tradeCount) * 100 : 0);

  const withMistake = trades.filter((t) => (t.mistake || "").trim().length > 0).length;
  const rated = trades.filter((t) => (t.rating ?? 0) > 0);
  const avgRating = rated.length ? rated.reduce((a, t) => a + (t.rating ?? 0), 0) / rated.length : 0;
  const reviewCompletePct = pct(trades.filter((t) => reviewStatus(t).complete).length);
  const stopDefinedPct = pct(trades.filter((t) => (t.stopLoss ?? 0) > 0).length);
  const untaggedPct = pct(trades.filter((t) => !(t.setup || "").trim()).length);

  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(dayKey(t), (byDay.get(dayKey(t)) ?? 0) + 1);
  const daysWithTrades = byDay.size;
  const maxTradesInDay = daysWithTrades ? Math.max(...byDay.values()) : 0;
  const tradesPerDay = daysWithTrades ? tradeCount / daysWithTrades : 0;

  const ordered = [...trades].sort((a, b) =>
    (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || ""))
  );

  const revenge = revengeStats(trades);

  // impulsive: finished within 1 minute
  const fastCount = trades.filter((t) => {
    const a = minutesOf(t.entryTime);
    const b = minutesOf(t.exitTime);
    return a !== null && b !== null && b - a >= 0 && b - a < 1;
  }).length;

  // tilt: opened right after two consecutive losses
  let afterTwoLosses = 0;
  let runLosses = 0;
  for (const t of ordered) {
    if (runLosses >= 2) afterTwoLosses += 1;
    runLosses = t.pnl < 0 ? runLosses + 1 : 0;
  }

  const streaks = streakStats(trades);

  return {
    tradeCount,
    mistakeRate: pct(withMistake),
    avgRating,
    reviewCompletePct,
    stopDefinedPct,
    untaggedPct,
    fastTradesPct: pct(fastCount),
    afterTwoLosses,
    revengeCount: revenge.count,
    revengeRate: revenge.rate,
    tradesPerDay,
    maxTradesInDay,
    streakCurrent: streaks.current,
    streakWinBest: streaks.bestWin,
    streakLossWorst: streaks.worstLoss,
  };
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  (window as any).__tjProcess = { computeProcessSignals, revengeStats, streakStats, streakState };
}
