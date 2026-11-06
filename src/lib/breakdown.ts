/**
 * Breakdown dimension adapter — one shape for "P&L + win% by X".
 *
 * The Dashboard's breakdowns (hour / session / weekday / symbol / setup /
 * order-type) are all the same question asked of a different key. This folds
 * the trade list into buckets and hands back a treemap tile list, so the
 * widgets stay thin and the basis can never drift between them.
 *
 * Result, counts and win rate are all Net over the counted population: the win
 * rate is Net-positive ÷ (Net-positive + Net-negative), the same formula the
 * heatmap and every other "win rate" in the product uses. Break-evens are
 * counted in the bucket's size and kept out of the rate.
 */

import type { Trade } from "../types";
import { summarizeFinancials } from "./money";
import type { TreemapTile } from "./chartKit";

interface Bucket {
  net: number;
  /** Every decision (or leg) in the bucket, break-evens included. */
  count: number;
  /** Net-positive results. */
  wins: number;
  /** Wins + losses: the denominator of the win rate. */
  decided: number;
}

/** Summarize each category independently so copies count once within its bucket. */
function bucketize(
  trades: Trade[],
  keyFn: (t: Trade) => string,
  population: "trade" | "account leg",
  dayKey: (t: Trade) => string,
): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    if (!k) continue;
    const rows = groups.get(k) ?? [];
    rows.push(t);
    groups.set(k, rows);
  }
  for (const [key, rows] of groups) {
    const accountKey = (t: Trade): string => String(t.account ?? "").trim().toLocaleLowerCase() || "unassigned";
    const summary = summarizeFinancials(rows, {
      scope: {
        kind: "all-included-accounts",
        accountIdOf: accountKey,
        includedAccountIds: new Set(rows.map(accountKey)),
      },
      dayKey,
    });
    const net = summary.net;
    const wins = population === "trade" ? net.positiveDecisionCount : net.positiveAccountLegCount;
    const losses = population === "trade" ? net.negativeDecisionCount : net.negativeAccountLegCount;
    map.set(key, {
      net: net.total,
      count: population === "trade" ? summary.decisionCount : summary.eligibleLegCount,
      wins,
      decided: wins + losses,
    });
  }
  return map;
}

const winSub = (b: Bucket, population: "trade" | "account leg"): string =>
  `${b.count} ${population}${b.count === 1 ? "" : "s"} · ${
    b.decided ? `${Math.round((b.wins / b.decided) * 100)}% Net win rate` : "no decided results"
  }`;

export interface DimensionTilesOpts {
  /** Display label for a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Chronological/rank order for keys; defaults to activity (|net| desc). */
  orderOf?: (key: string) => number;
  /** Money formatter; defaults to a plain number. */
  formatMoney?: (v: number) => string;
  countPopulation?: "trade" | "account leg";
  /**
   * What "a day" is inside the summary behind the tiles — the caller's journal
   * day key. The tile figures themselves are day-independent (totals, counts,
   * win rates), but the summary carries day buckets, and they must not come
   * back on the recorded date's convention. Defaults to the recorded date.
   */
  dayKey?: (t: Trade) => string;
}

/**
 * Treemap tiles for a dimension. Categorical dimensions are ordered by activity
 * (trade count, so the widest tiles are the busiest); pass `orderOf` for a
 * timeline dimension to read chronologically instead.
 */
export function dimensionTiles(
  trades: Trade[],
  keyFn: (t: Trade) => string,
  opts: DimensionTilesOpts = {}
): TreemapTile[] {
  const population = opts.countPopulation ?? "trade";
  const dayKey = opts.dayKey ?? ((t: Trade) => t.date);
  const map = bucketize(trades, keyFn, population, dayKey);
  const label = opts.labelOf ?? ((k) => k);
  const fmt = opts.formatMoney ?? ((v) => String(v));

  const tiles = [...map.entries()].map(([k, b]) => ({
    key: k,
    label: label(k),
    net: b.net,
    count: b.count,
    wins: b.wins,
    decided: b.decided,
    tip: { title: label(k), value: fmt(b.net), sub: winSub(b, population) },
  }));

  if (opts.orderOf) {
    const order = opts.orderOf;
    return tiles.sort((a, b) => order(a.key) - order(b.key));
  }
  return tiles.sort((a, b) => b.count - a.count || Math.abs(b.net) - Math.abs(a.net));
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  window.__tjBreakdown = { dimensionTiles };
}
