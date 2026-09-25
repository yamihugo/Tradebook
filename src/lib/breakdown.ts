/**
 * Breakdown dimension adapter — one shape for "P&L + win% by X".
 *
 * The Dashboard's breakdowns (hour / session / weekday / symbol / setup /
 * order-type) are all the same question asked of a different key. This folds
 * the trade list into buckets and hands back a treemap tile list, so the
 * widgets stay thin and the basis can never drift between them.
 *
 * Result is Net over eligible in-scope account legs. Counts and win-rate
 * classifications remain Gross-based under the existing counted population.
 */

import type { Trade } from "../types";
import { summarizeFinancials } from "./money";
import type { TreemapTile } from "./chartKit";

interface Bucket {
  net: number;
  count: number;
  wins: number;
}

/** Summarize each category independently so copies count once within its bucket. */
function bucketize(trades: Trade[], keyFn: (t: Trade) => string, population: "trade" | "account leg"): Map<string, Bucket> {
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
      dayKey: (t) => t.date,
    });
    map.set(key, {
      net: summary.net.total,
      count: population === "trade" ? summary.decisionCount : summary.eligibleLegCount,
      wins: population === "trade" ? summary.gross.positiveDecisionCount : summary.gross.positiveAccountLegCount,
    });
  }
  return map;
}

const winSub = (b: Bucket, population: "trade" | "account leg"): string =>
  `${b.count} ${population}${b.count === 1 ? "" : "s"} · ${b.count ? Math.round((b.wins / b.count) * 100) : 0}% Gross-sign win rate`;

export interface DimensionTilesOpts {
  /** Display label for a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Chronological/rank order for keys; defaults to activity (|net| desc). */
  orderOf?: (key: string) => number;
  /** Money formatter; defaults to a plain number. */
  formatMoney?: (v: number) => string;
  countPopulation?: "trade" | "account leg";
}

/**
 * Treemap tiles for a dimension. Categorical dimensions are ordered by activity
 * (trade count, so the widest tiles are the busiest); pass `orderOf` for a
 * timeline dimension to read chronologically instead.
 */
export function dimensionTiles(
  trades: Trade[],
  _counted: Trade[],
  keyFn: (t: Trade) => string,
  opts: DimensionTilesOpts = {}
): TreemapTile[] {
  const population = opts.countPopulation ?? "trade";
  const map = bucketize(trades, keyFn, population);
  const label = opts.labelOf ?? ((k) => k);
  const fmt = opts.formatMoney ?? ((v) => String(v));

  const tiles = [...map.entries()].map(([k, b]) => ({
    key: k,
    label: label(k),
    net: b.net,
    count: b.count,
    wins: b.wins,
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
  (window as any).__tjBreakdown = { dimensionTiles };
}
