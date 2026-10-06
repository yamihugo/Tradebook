/**
 * Process / discipline signals — pure, cross-account.
 *
 * These answer "how am I trading?", not "how much did I make?". They need only
 * the filtered trade list and a timezone-aware `dayKey`; no account rules, no
 * balances. `accountMetrics.computeAccountMetrics` consumes them so the account
 * page and Home/Dashboard read one definition.
 *
 * Classification is the sign of the **Net** result of the logical decision
 * (copy legs summed, costs applied) — the same rule as `summarizeFinancials`
 * and every unqualified win/loss in the product (docs/ARCHITECTURE.md). The
 * caller's shared summary is used when it has one, so a decision that wins in
 * one account and loses in another reads as its net across the scope.
 */

import type { Trade } from "../types";
import { chronological, entryInstantDate, exitInstantDate, holdMinutesOf } from "./instant";
import { netPnl } from "./fees";
import { legBaseKey, logicalDecisionKey } from "./copy";
import type { FinancialSummary } from "./money";
import { reviewStatus } from "./review";
import { isDeclaredRevenge, mistakeTagsOf } from "./tags";

/**
 * Default re-entry window, in minutes: a trade opened within this many minutes
 * of a losing exit on the same symbol, on the same day. The trader can change
 * it in Settings → Psychology (Tier B) — every surface reads the same value.
 */
export const DEFAULT_REENTRY_WINDOW_MINUTES = 15;

/** "HH:MM" (or "HH:MM:SS") into minutes from midnight, or null. */
const minutesOf = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t || "");
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0) : null;
};

/** What "a day" is here: the caller's day key (the journal's), or — for callers
 *  that have none — the date the note itself records. */
type DayKey = (t: Trade) => string;
const recordedDay: DayKey = (t) => t.date;

/**
 * The Net result behind each row, for classification.
 *
 * `financials.decisions` when the caller has the shared summary: one Net per
 * decision, legs summed across the scope, costs applied — a decision that wins
 * in one account and loses in another reads as what it did overall. Otherwise
 * the rows in hand are grouped by decision key and summed, which is the same
 * arithmetic on the population actually available (an account page, where every
 * row of that account is present).
 *
 * Rows are keyed by identity, so the caller's list stays the thing measured.
 */
export function netOutcomes(trades: Trade[], financials?: FinancialSummary): Map<Trade, number> {
  const outcomes = new Map<Trade, number>();
  if (financials) {
    const netByKey = new Map<string, number>();
    for (const decision of financials.decisions) {
      outcomes.set(decision.representative, decision.net);
      if (decision.key) netByKey.set(decision.key, decision.net);
    }
    for (const row of trades) {
      if (outcomes.has(row)) continue;
      const key = logicalDecisionKey(row);
      const net = key ? netByKey.get(key) : undefined;
      outcomes.set(row, net ?? netPnl(row));
    }
    return outcomes;
  }
  const groups = new Map<string, Trade[]>();
  for (const row of trades) {
    const key = logicalDecisionKey(row);
    if (!key) {
      outcomes.set(row, netPnl(row));
      continue;
    }
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }
  for (const members of groups.values()) {
    const total = members.reduce((sum, row) => sum + netPnl(row), 0);
    for (const row of members) outcomes.set(row, total);
  }
  return outcomes;
}

/** Minutes from one trade's exit to the next trade's entry: real elapsed time
 *  when both notes carry instants, the recorded clock otherwise. */
function reentryMinutes(prev: Trade, cur: Trade): number | null {
  const from = exitInstantDate(prev);
  const to = entryInstantDate(cur);
  if (from && to) return (to.getTime() - from.getTime()) / 60000;
  const out = minutesOf(prev.exitTime);
  const inn = minutesOf(cur.entryTime);
  if (out === null || inn === null) return null;
  return inn >= out ? inn - out : null;
}

export interface ProcessSignals {
  tradeCount: number;
  /** Trades carrying a non-empty mistake label, as a percentage. */
  mistakeRate: number;
  avgRating: number;
  /** Decisions reviewed — the required steps written, or the trader's mark
   *  (see lib/review.ts). */
  reviewedPct: number;
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
 * Fold the flat list into logical trades so a copied decision is one step in
 * the sequence, not two. Only a real copy link groups records (`legBaseKey`);
 * the representative is the original note, which carries the review and tags.
 */
function decisionGroups(trades: Trade[]): { reps: Trade[]; legs: Map<Trade, Trade[]> } {
  const groups = new Map<string, { rep: Trade; legs: Trade[] }>();
  for (const t of trades) {
    const key = legBaseKey(t);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { rep: t, legs: [t] });
      continue;
    }
    group.legs.push(t);
    if (group.rep.isCopiedTrade && !t.isCopiedTrade) group.rep = t;
  }
  const reps: Trade[] = [];
  const legs = new Map<Trade, Trade[]>();
  for (const group of groups.values()) {
    reps.push(group.rep);
    legs.set(group.rep, group.legs);
  }
  return { reps, legs };
}

/**
 * The observed pattern: a re-entry within `windowMinutes` of a **Net** loss on
 * the SAME symbol, the next decision in the sequence, same day. A pattern read
 * from the instants, never a motive. `outcomes` says what each decision was
 * worth; a hit flags every leg of the decision so callers can read by row.
 */
function observedReentries(
  reps: Trade[],
  legs: Map<Trade, Trade[]>,
  dayKey: DayKey,
  outcomes: Map<Trade, number>,
  windowMinutes: number,
): { hits: Set<Trade>; escalated: Set<Trade> } {
  const ordered = chronological(reps);
  const hits = new Set<Trade>();
  const escalated = new Set<Trade>();
  const flag = (set: Set<Trade>, cur: Trade): void => {
    for (const leg of legs.get(cur) ?? [cur]) set.add(leg);
  };
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    // "Right after" means the same day (the caller's day key) and a gap the
    // clock really had — read from the instants when the notes carry them.
    const prevNet = outcomes.get(prev) ?? netPnl(prev);
    if (prevNet >= 0 || dayKey(prev) !== dayKey(cur)) continue;
    const gap = reentryMinutes(prev, cur);
    if (gap === null || gap < 0 || gap > windowMinutes) continue;
    if ((prev.symbol || "") !== (cur.symbol || "")) continue;
    flag(hits, cur);
    if ((cur.quantity || 0) > (prev.quantity || 0)) flag(escalated, cur);
  }
  return { hits, escalated };
}

/** The two axes, kept apart: observed behaviour vs what the trader declared. */
export interface ReentrySignals {
  observed: Set<Trade>;
  declared: Set<Trade>;
  /** Observed re-entries entered with more size than the loss they followed. */
  escalated: Set<Trade>;
}

/**
 * Classify a list once, on both axes. Observed = a re-entry within the window
 * of a Net loss on the same symbol, same day. Declared = the trader tagged the
 * trade "Revenge entry" / "Revenge". Motive is never inferred from a P&L or a
 * timestamp (docs/UX-GUIDELINES.md §0).
 */
export function reentrySignals(
  trades: Trade[],
  dayKey: DayKey = recordedDay,
  financials?: FinancialSummary,
  windowMinutes: number = DEFAULT_REENTRY_WINDOW_MINUTES,
): ReentrySignals {
  const outcomes = netOutcomes(trades, financials);
  const { reps, legs } = decisionGroups(trades);
  const { hits: observed, escalated } = observedReentries(reps, legs, dayKey, outcomes, windowMinutes);
  const declared = new Set<Trade>();
  for (const rep of reps) {
    const members = legs.get(rep) ?? [rep];
    if (!isDeclaredRevenge(rep) && !members.some(isDeclaredRevenge)) continue;
    for (const leg of members) declared.add(leg);
  }
  return { observed, declared, escalated };
}

/**
 * Revenge: the union of the two axes — observed re-entry after a Net loss on
 * the same symbol, or a trade the trader declared as revenge. Count and rate
 * are over the rows handed in.
 */
export function revengeStats(
  trades: Trade[],
  dayKey: DayKey = recordedDay,
  financials?: FinancialSummary,
  windowMinutes: number = DEFAULT_REENTRY_WINDOW_MINUTES,
): { count: number; rate: number } {
  const { observed, declared } = reentrySignals(trades, dayKey, financials, windowMinutes);
  const union = new Set<Trade>([...observed, ...declared]);
  return { count: union.size, rate: trades.length ? (union.size / trades.length) * 100 : 0 };
}

/**
 * Current / best-win / worst-loss runs, over an already-classified list.
 * Break-even pauses a run, never resets it.
 */
function streakRun(trades: Trade[], outcomes: Map<Trade, number>): {
  current: number;
  bestWin: number;
  worstLoss: number;
} {
  const netOf = (t: Trade): number => outcomes.get(t) ?? netPnl(t);
  const ordered = chronological(trades);
  let bestWin = 0;
  let worstLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of ordered) {
    const net = netOf(t);
    if (net > 0) {
      curWin += 1;
      curLoss = 0;
      bestWin = Math.max(bestWin, curWin);
    } else if (net < 0) {
      curLoss += 1;
      curWin = 0;
      worstLoss = Math.max(worstLoss, curLoss);
    }
    // break-even: pause the run (do not reset) — matches common journal behaviour
  }
  const lastNonFlat = ordered.filter((t) => netOf(t) !== 0).pop();
  const current = lastNonFlat ? (netOf(lastNonFlat) > 0 ? curWin : -curLoss) : 0;
  return { current, bestWin, worstLoss };
}

/**
 * Runs, classified by the Net sign of each decision — the same answer the
 * Streaks widget and `m.winstreak`/`m.lossstreak` show.
 */
export function streakStats(trades: Trade[], financials?: FinancialSummary): {
  current: number;
  bestWin: number;
  worstLoss: number;
} {
  return streakRun(trades, netOutcomes(trades, financials));
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
 * caller controls the timezone; `financials`, when the caller has the shared
 * summary, decides what each decision is worth (legs summed across its scope).
 */
export function computeProcessSignals(
  trades: Trade[],
  dayKey: (t: Trade) => string,
  financials?: FinancialSummary,
  windowMinutes: number = DEFAULT_REENTRY_WINDOW_MINUTES,
): ProcessSignals {
  const tradeCount = trades.length;
  const pct = (n: number): number => (tradeCount ? (n / tradeCount) * 100 : 0);

  const withMistake = trades.filter((t) => mistakeTagsOf(t).length > 0).length;
  const rated = trades.filter((t) => (t.rating ?? 0) > 0);
  const avgRating = rated.length ? rated.reduce((a, t) => a + (t.rating ?? 0), 0) / rated.length : 0;
  const reviewedPct = pct(trades.filter((t) => reviewStatus(t).complete).length);
  const stopDefinedPct = pct(trades.filter((t) => (t.stopLoss ?? 0) > 0).length);
  const untaggedPct = pct(trades.filter((t) => !(t.setup || "").trim()).length);

  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(dayKey(t), (byDay.get(dayKey(t)) ?? 0) + 1);
  const daysWithTrades = byDay.size;
  const maxTradesInDay = daysWithTrades ? Math.max(...byDay.values()) : 0;
  const tradesPerDay = daysWithTrades ? tradeCount / daysWithTrades : 0;

  // Classified once, then read by every run-shaped signal below.
  const outcomes = netOutcomes(trades, financials);
  const ordered = chronological(trades);

  const revenge = revengeStats(trades, dayKey, financials, windowMinutes);

  // impulsive: finished within 1 minute — the instants when there are any, so
  // the answer does not depend on how the note spells its clock.
  const fastCount = trades.filter((t) => {
    const minutes = holdMinutesOf(t);
    return minutes !== null && minutes >= 0 && minutes < 1;
  }).length;

  // tilt: opened right after two consecutive losses
  let afterTwoLosses = 0;
  let runLosses = 0;
  for (const t of ordered) {
    if (runLosses >= 2) afterTwoLosses += 1;
    runLosses = (outcomes.get(t) ?? netPnl(t)) < 0 ? runLosses + 1 : 0;
  }

  const streaks = streakRun(trades, outcomes);

  return {
    tradeCount,
    mistakeRate: pct(withMistake),
    avgRating,
    reviewedPct,
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
  window.__tjProcess = {
    computeProcessSignals,
    revengeStats,
    reentrySignals,
    DEFAULT_REENTRY_WINDOW_MINUTES,
    streakStats,
    streakState,
    netOutcomes,
  };
}
