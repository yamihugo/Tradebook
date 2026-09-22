/**
 * Money stats — one definition of "how much", shared by every surface.
 *
 * Basis contract (see docs/ARCHITECTURE.md):
 *   money = net; classification = gross sign.
 *
 * A dollar RESULT (totals, averages, extremes, factors) reads `netPnl` — gross
 * minus commission and fees. Win/loss CLASSIFICATION still uses the gross sign
 * of `t.pnl`, because a trade is a win or a loss by its trading result, not by
 * its costs. `grossWin`/`grossLoss` are kept as those classification sums so a
 * caller can still reproduce the old gross figures while the flip lands.
 *
 * Pure: no DOM, no plugin. Phase D Build 1 creates this library; the consumers
 * flip onto its net helpers in Build 2.
 */

import type { Trade } from "../types";
import { netPnl } from "./fees";

/** Trades with a finite result and a date — the same scope every metric uses. */
function scoped(trades: Trade[]): Trade[] {
  return trades.filter((t) => Number.isFinite(t.pnl) && !!t.date);
}
function wins(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.pnl > 0);
}
function losses(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.pnl < 0);
}
function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

/** Net dollars made/lost across the list (gross minus costs). */
export function netTotal(trades: Trade[]): number {
  return sum(scoped(trades).map(netPnl));
}

/** Gross dollars across the list, before costs. */
export function grossTotal(trades: Trade[]): number {
  return sum(scoped(trades).map((t) => t.pnl));
}

/** Net dollars contributed by winning trades (classified by gross sign). */
export function netWins(trades: Trade[]): number {
  return sum(wins(scoped(trades)).map(netPnl));
}

/** Net dollars lost by losing trades, as a positive number. */
export function netLosses(trades: Trade[]): number {
  return Math.abs(sum(losses(scoped(trades)).map(netPnl)));
}

/** Gross dollars from winning trades — a classification sum, not a result. */
export function grossWin(trades: Trade[]): number {
  return sum(wins(scoped(trades)).map((t) => t.pnl));
}

/** Gross dollars lost by losing trades, as a positive number. */
export function grossLoss(trades: Trade[]): number {
  return Math.abs(sum(losses(scoped(trades)).map((t) => t.pnl)));
}

/** Gross win/loss ratio. Infinity when there are wins but no losses. */
export function profitFactor(trades: Trade[]): number {
  const gw = netWins(trades);
  const gl = netLosses(trades);
  return gl > 0 ? gw / gl : gw > 0 ? Infinity : 0;
}

/** Net dollars per decided trade (break-even excluded from the denominator). */
export function expectancy(trades: Trade[]): number {
  const decided = scoped(trades).filter((t) => t.pnl !== 0);
  return decided.length ? netTotal(trades) / decided.length : 0;
}

/** Net dollars per winning trade. */
export function avgWin(trades: Trade[]): number {
  const w = wins(scoped(trades));
  return w.length ? netWins(trades) / w.length : 0;
}

/** Net dollars per losing trade, as a positive number. */
export function avgLoss(trades: Trade[]): number {
  const l = losses(scoped(trades));
  return l.length ? netLosses(trades) / l.length : 0;
}

/** The single best trade by net, or 0 when nothing made money. */
export function largestWin(trades: Trade[]): number {
  const xs = scoped(trades).map(netPnl);
  const v = xs.length ? Math.max(...xs) : 0;
  return v > 0 ? v : 0;
}

/** The single worst trade by net, or 0 when nothing lost money. */
export function largestLoss(trades: Trade[]): number {
  const xs = scoped(trades).map(netPnl);
  const v = xs.length ? Math.min(...xs) : 0;
  return v < 0 ? v : 0;
}

/** Net P&L of the best day (grouped by the trade's own date). */
export function bestDay(trades: Trade[]): number {
  const days = new Map<string, number>();
  for (const t of scoped(trades)) days.set(t.date, (days.get(t.date) ?? 0) + netPnl(t));
  return days.size ? Math.max(...days.values()) : 0;
}

/** Net P&L of the worst day (grouped by the trade's own date). */
export function worstDay(trades: Trade[]): number {
  const days = new Map<string, number>();
  for (const t of scoped(trades)) days.set(t.date, (days.get(t.date) ?? 0) + netPnl(t));
  return days.size ? Math.min(...days.values()) : 0;
}

/** Everything at once, for widgets that need several fields. */
export interface MoneyStats {
  net: number;
  gross: number;
  netWins: number;
  netLosses: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  bestDay: number;
  worstDay: number;
}

export function moneyStats(trades: Trade[]): MoneyStats {
  return {
    net: netTotal(trades),
    gross: grossTotal(trades),
    netWins: netWins(trades),
    netLosses: netLosses(trades),
    grossWin: grossWin(trades),
    grossLoss: grossLoss(trades),
    profitFactor: profitFactor(trades),
    expectancy: expectancy(trades),
    avgWin: avgWin(trades),
    avgLoss: avgLoss(trades),
    largestWin: largestWin(trades),
    largestLoss: largestLoss(trades),
    bestDay: bestDay(trades),
    worstDay: worstDay(trades),
  };
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  (window as any).__tjMoney = {
    netTotal, grossTotal, netWins, netLosses, grossWin, grossLoss,
    profitFactor, expectancy, avgWin, avgLoss, largestWin, largestLoss,
    bestDay, worstDay, moneyStats,
  };
}
