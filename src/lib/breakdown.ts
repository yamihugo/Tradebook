/**
 * Breakdown dimension adapter — one shape for "P&L + win% by X".
 *
 * The Dashboard's breakdowns (hour / session / weekday / symbol / setup /
 * order-type) are all the same question asked of a different key. This folds
 * the trade list into buckets and hands back a treemap tile list, so the
 * widgets stay thin and the basis can never drift between them.
 *
 * Basis contract (docs/ARCHITECTURE.md): money is NET (`netPnl`, every leg);
 * win/loss classification is the GROSS sign (the counted list).
 */

import type { Trade } from "../types";
import { netPnl } from "./fees";
import type { TreemapTile } from "./chartKit";

interface Bucket {
  net: number;
  count: number;
  wins: number;
}

/** Fold the trade list into `{ net, count, wins }` buckets keyed by `keyFn`. */
function bucketize(trades: Trade[], counted: Trade[], keyFn: (t: Trade) => string): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  const bucketOf = (k: string): Bucket => {
    const b = map.get(k) ?? { net: 0, count: 0, wins: 0 };
    map.set(k, b);
    return b;
  };
  // Money over every leg; counts over the logical (counted) list.
  for (const t of trades) {
    const k = keyFn(t);
    if (k) bucketOf(k).net += netPnl(t);
  }
  for (const t of counted) {
    const k = keyFn(t);
    if (!k) continue;
    const b = bucketOf(k);
    b.count += 1;
    if (t.pnl > 0) b.wins += 1;
  }
  return map;
}

const winSub = (b: Bucket): string =>
  `${b.count} trade${b.count === 1 ? "" : "s"} · ${b.count ? Math.round((b.wins / b.count) * 100) : 0}% win`;

export interface DimensionTilesOpts {
  /** Display label for a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Chronological/rank order for keys; defaults to activity (|net| desc). */
  orderOf?: (key: string) => number;
  /** Money formatter; defaults to a plain number. */
  formatMoney?: (v: number) => string;
}

/**
 * Treemap tiles for a dimension. Categorical dimensions are ordered by activity
 * (trade count, so the widest tiles are the busiest); pass `orderOf` for a
 * timeline dimension to read chronologically instead.
 */
export function dimensionTiles(
  trades: Trade[],
  counted: Trade[],
  keyFn: (t: Trade) => string,
  opts: DimensionTilesOpts = {}
): TreemapTile[] {
  const map = bucketize(trades, counted, keyFn);
  const label = opts.labelOf ?? ((k) => k);
  const fmt = opts.formatMoney ?? ((v) => String(v));

  const tiles = [...map.entries()].map(([k, b]) => ({
    key: k,
    label: label(k),
    net: b.net,
    count: b.count,
    wins: b.wins,
    tip: { title: label(k), value: fmt(b.net), sub: winSub(b) },
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
