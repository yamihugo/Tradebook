/**
 * Breakdown dimension adapter — one shape for "P&L + win% by X".
 *
 * The Dashboard's hour / session / weekday widgets are all the same question
 * asked of a different key. This folds the trade list into buckets and hands
 * back a ready continuous-bar segment list, so the widgets stay thin and the
 * basis can never drift between them.
 *
 * Basis contract (docs/ARCHITECTURE.md): money is NET (`netPnl`, every leg);
 * win/loss classification is the GROSS sign (the counted list).
 */

import type { Trade } from "../types";
import { netPnl } from "./fees";
import type { ContinuousSegment } from "./chartKit";

export interface DimensionBarsOpts {
  /** Canonical slots to always show, in order (missing ones read as empty). */
  slots?: string[];
  /** Display label for a key; defaults to the key itself. */
  labelOf?: (key: string) => string;
  /** Chronological/rank order for keys; defaults to slot order or |net| desc. */
  orderOf?: (key: string) => number;
  /** Money formatter used in the tooltip; defaults to a plain number. */
  formatMoney?: (v: number) => string;
}

export interface DimensionBarsResult {
  items: ContinuousSegment[];
  /** The bucket with the highest net, for a one-line summary. */
  best: ContinuousSegment | null;
}

export function dimensionBars(
  trades: Trade[],
  counted: Trade[],
  keyFn: (t: Trade) => string,
  opts: DimensionBarsOpts = {}
): DimensionBarsResult {
  interface Bucket {
    net: number;
    count: number;
    wins: number;
  }
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

  const keys = opts.slots ? [...opts.slots] : [...map.keys()];
  if (opts.slots) for (const k of map.keys()) if (!keys.includes(k)) keys.push(k);
  if (opts.orderOf) {
    const order = opts.orderOf;
    keys.sort((a, b) => order(a) - order(b));
  }

  const label = opts.labelOf ?? ((k) => k);
  const fmt = opts.formatMoney ?? ((v) => String(v));
  let best: ContinuousSegment | null = null;

  const items: ContinuousSegment[] = keys.map((k) => {
    const b = map.get(k);
    if (!b) return { key: k, label: label(k), value: 0, tone: "neutral" };
    const item: ContinuousSegment = {
      key: k,
      label: label(k),
      value: b.net,
      tone: b.net >= 0 ? "pos" : "neg",
      tip: {
        title: label(k),
        value: fmt(b.net),
        sub: `${b.count} trade${b.count === 1 ? "" : "s"} · ${Math.round((b.wins / b.count) * 100)}% win`,
      },
    };
    if (!best || b.net > best.value) best = item;
    return item;
  });

  return { items, best };
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  (window as any).__tjBreakdown = { dimensionBars };
}
