/**
 * One place that decides what counts as money and what counts as a trade.
 *
 * Copy trading means one decision can live in several accounts at once: the
 * base trade plus one leg per copier. Both are real money in their own account,
 * but they are the SAME trade logically. So:
 *
 *   money  — every leg. Sum these for P&L; that is capital that actually moved.
 *   unique — one entry per logical trade (deduped by copyBaseKey). Use these
 *            for counts, win rate, streaks and anything "per trade".
 *
 * Views must go through this instead of deciding for themselves — that is how
 * the Home, Accounts and Trade Log stop disagreeing with each other.
 */

import type { Trade } from "../types";
import { uniqueTrades } from "./copy";

export interface AnalyticsScope {
  /** Every leg with a finite P&L — the real money. */
  money: Trade[];
  /** One trade per logical trade — the honest counts. */
  unique: Trade[];
  /**
   * What counts/win rate/streaks should be computed from. Normally `unique`,
   * but a user who wants copies treated as separate trades gets `money`.
   */
  counts: Trade[];
}

/**
 * `countCopies` mirrors the "Count copies as separate trades" setting. Money is
 * never affected by it: the P&L of an account is always what actually moved.
 */
export function analyticsTrades(trades: Trade[], countCopies = false): AnalyticsScope {
  const money = trades.filter((t) => Number.isFinite(t.pnl));
  const unique = uniqueTrades(money);
  return { money, unique, counts: countCopies ? money : unique };
}
