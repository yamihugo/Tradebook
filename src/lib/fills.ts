// Fills: the executions behind a trade.
//
// A trade entered once and exited once stores no fills at all — its scalar
// fields (`quantity`, `entryPrice`, `exitPrice`, `entryTime`, `exitTime`) are the
// whole truth, and every reader in the app keeps working untouched. Fills exist
// only when a position was scaled in or out, and then those scalars are the
// **weighted averages** of the fills, so the ledger, the metrics, the R multiple
// and the copy engine never need a special case.
//
// This module is pure: no DOM, no plugin. The table and the trade page render it.

import type { Trade, TradeFill } from "../types";
import { knownFuturesSpec } from "../futures";

/** Which side opens the position, given the trade's direction. */
export function entrySide(t: Trade): "buy" | "sell" {
  return t.direction === "short" ? "sell" : "buy";
}

export interface FillSet {
  /** Chronological, as executed. */
  fills: TradeFill[];
  /** True when the note really carries fills; false when they were inferred. */
  explicit: boolean;
  entries: TradeFill[];
  exits: TradeFill[];
  entryQty: number;
  exitQty: number;
  /** Contracts still on: `entryQty - exitQty`. The import only ever emits closed trades. */
  openQty: number;
  avgEntry: number;
  avgExit: number;
  /** Biggest position held at once — the "position size" of the trade. */
  positionSize: number;
  /** More than one entry or more than one exit: the only case worth a badge. */
  isMulti: boolean;
  firstEntryTime: string;
  lastExitTime: string;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

/** Weighted average price over fills that actually carry a price. 0 when none do. */
function weighted(list: TradeFill[]): number {
  let qty = 0;
  let sum = 0;
  for (const f of list) {
    const q = num(f.qty);
    const p = num(f.price);
    if (!(q > 0) || !Number.isFinite(p)) continue;
    qty += q;
    sum += q * p;
  }
  return qty > 0 ? sum / qty : 0;
}

const sumQty = (list: TradeFill[]): number =>
  list.reduce((s, f) => s + (num(f.qty) > 0 ? num(f.qty) : 0), 0);

/**
 * Biggest number of contracts held at the same time, walking the fills in order.
 * Scale in 2 twice and out 4 → 4; scale in 4, take 2 off, add 2, take 4 off → 4.
 */
function positionSize(fills: TradeFill[], side: "buy" | "sell"): number {
  let open = 0;
  let peak = 0;
  for (const f of fills) {
    const q = num(f.qty);
    if (!(q > 0)) continue;
    open += f.side === side ? q : -q;
    if (open > peak) peak = open;
  }
  return peak;
}

/**
 * A fill inferred from the trade's own scalars — the single-fill case. The
 * closing side carries the trade's realised P&L and fees: a note with no fills
 * has nowhere else to record them, and an empty P&L row for a closed trade
 * would be the journal lying by omission.
 */
function inferred(t: Trade, side: "buy" | "sell", isEntry: boolean): TradeFill {
  const qty = num(t.quantity);
  const price = num(isEntry ? t.entryPrice : t.exitPrice);
  const canonical = isEntry ? t.entryInstant : t.exitInstant;
  const fill: TradeFill = {
    side: isEntry ? side : side === "buy" ? "sell" : "buy",
    time: isEntry ? t.entryTime : t.exitTime,
    qty,
    price,
    // The synthetic fill stands for the real event, so it carries that event's
    // instant — which is what makes a note without a fills block readable in the
    // same order and duration as one that has them.
    ...(canonical ? { instant: canonical } : {}),
  };
  if (isEntry || !(price > 0)) return fill;
  const entry = num(t.entryPrice);
  const dist = t.direction === "long" ? price - entry : entry - price;
  const fees = (t.commission || 0) + (t.fees || 0);
  const spec = knownFuturesSpec(t.symbol || "");
  // The fill's P&L is GROSS, like the platform's own fills; the cost sits in
  // `fees`, never subtracted twice. An unpriced contract gets no fabricated P&L.
  const pnl = spec ? dist * spec.pointValue * qty : NaN;
  if (spec && Number.isFinite(pnl)) {
    fill.pnl = round(pnl);
    if (fees > 0) fill.fees = round(fees);
  }
  return fill;
}

/**
 * Fill order, decided by `fill.instant` when both sides have one.
 *
 * A trade that crosses midnight must not be ordered by its clock reading: the
 * 00:10 exit would sort before the 23:50 entry and the rows (and the peak
 * position walked from them) would read backwards. Civil time stays as the
 * fallback for notes that predate the contract, and equal keys keep the note's
 * own order — `Array#sort` is stable.
 */
export function compareFills(a: TradeFill, b: TradeFill): number {
  const ia = Number(Date.parse(String(a.instant ?? "")));
  const ib = Number(Date.parse(String(b.instant ?? "")));
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
  return String(a.time ?? "").localeCompare(String(b.time ?? ""));
}

export function fillSet(t: Trade): FillSet {
  const own = (t.fills ?? []).filter((f) => num(f.qty) > 0);
  const side = entrySide(t);
  const explicit = own.length > 0;

  const entries = explicit ? own.filter((f) => f.side === side) : [inferred(t, side, true)];
  // Anything on the other side of a long is an exit, and vice versa. A note with
  // no fills but no exit either (an open trade) simply gets an empty exit list.
  const exits = explicit
    ? own.filter((f) => f.side !== side)
    : num(t.exitPrice) > 0 || t.exitTime
    ? [inferred(t, side, false)]
    : [];

  const byTime = compareFills;
  const filled = [...entries, ...exits].sort(byTime);
  const entryQty = sumQty(entries);
  const exitQty = sumQty(exits);

  return {
    fills: filled,
    explicit,
    entries: entries.sort(byTime),
    exits: exits.sort(byTime),
    entryQty,
    exitQty,
    openQty: Math.max(0, entryQty - exitQty),
    avgEntry: weighted(entries),
    avgExit: weighted(exits),
    positionSize: explicit ? positionSize(filled, side) : entryQty,
    isMulti: entries.length > 1 || exits.length > 1,
    firstEntryTime: entries.length ? entries.slice().sort(byTime)[0].time : t.entryTime,
    lastExitTime: exits.length ? exits.slice().sort(byTime)[exits.length - 1].time : t.exitTime,
  };
}

/** Display the executed result automatically: profitable TP, losing SL, flat BE.
 * These badges describe the close, not its order type or the trader's reason. */
export function fillLabel(f: TradeFill, i: number, set: FillSet, pointValue = 0): string {
  if (set.entries.includes(f)) return set.entries.length > 1 ? `entry ${i + 1}` : "entry";
  const outcome = (exit: TradeFill): "TP" | "SL" | "BE" | "Exit" => {
    if (isBreakEven(exit, set.avgEntry, pointValue)) return "BE";
    // Prefer the matched execution's gross P&L. Costs never change its badge.
    const movement = set.entries[0]?.side === "sell" ? set.avgEntry - exit.price : exit.price - set.avgEntry;
    const value = Number.isFinite(exit.pnl) ? exit.pnl as number :
      set.avgEntry > 0 && Number.isFinite(exit.price) && exit.price > 0 ? movement : Number.NaN;
    if (!Number.isFinite(value)) return "Exit";
    return value > 0 ? "TP" : value < 0 ? "SL" : "BE";
  };
  const kind = outcome(f);
  if (kind === "BE") return kind;
  if (kind === "Exit") return `Exit ${set.exits.indexOf(f) + 1}`;
  return `${kind}${set.exits.filter((exit) => outcome(exit) === kind).indexOf(f) + 1}`;
}

/** A flat executed close, before costs; a nearby price is not evidence of break-even. */
export function isBreakEven(f: TradeFill, entry: number, _pointValue: number): boolean {
  return Number.isFinite(entry) && entry > 0 && Number.isFinite(f.price) &&
    Math.abs(f.price - entry) < 0.0000001 && Number.isFinite(f.pnl) && Math.abs(f.pnl as number) < 0.005;
}

/** Signed realized gross points per closed contract, quantity-weighted.
 * Explicit fills must carry realized P&L to preserve the matched-lot result;
 * estimating from the best exit or an incomplete ledger would overstate it. */
export function pointsOf(
  direction: "long" | "short",
  entry: number,
  exits: TradeFill[],
  pointValue: number,
  explicit: boolean,
): number {
  if (!exits.length || !(entry > 0)) return Number.NaN;
  const closedQty = sumQty(exits);
  if (!(closedQty > 0)) return Number.NaN;
  if (explicit) {
    if (!(pointValue > 0) || !exits.every((f) => Number.isFinite(f.pnl))) return Number.NaN;
    const realizedPointContracts = exits.reduce((sum, f) => sum + (f.pnl as number) / pointValue, 0);
    return round(realizedPointContracts / closedQty);
  }
  const exit = num(exits[0].price);
  if (!Number.isFinite(exit)) return Number.NaN;
  return round(direction === "long" ? exit - entry : entry - exit);
}

/** Realized points per closed contract, from the fill ledger or scalar actuals. */
export function tradePoints(t: Trade): number {
  const set = fillSet(t);
  const spec = knownFuturesSpec(t.symbol || "");
  return pointsOf(
    t.direction,
    set.avgEntry || num(t.entryPrice),
    set.exits,
    spec?.pointValue ?? 0,
    set.explicit,
  );
}

/**
 * Tone for a number: green up, red down, and neither when it is exactly flat.
 * A take profit that ends at break-even is a decision, not a loss — colouring it
 * green or red would tell the reader something that did not happen.
 */
export function toneClass(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return v > 0 ? "tj-pos" : v < 0 ? "tj-neg" : "tj-flat";
}

/** Index of a fill inside its own side, so labels stay stable. */
export function fillIndex(f: TradeFill, set: FillSet): number {
  const list = set.entries.includes(f) ? set.entries : set.exits;
  return Math.max(0, list.indexOf(f));
}

/**
 * Rebuild the trade's scalar fields from its fills. Used by the import and by
 * hand editing — one place, so the averages can never disagree with the fills.
 *
 * The P&L is only recomputed when every exit fill carries a realised value;
 * a hand-journalled direct-P&L trade keeps the number the user typed.
 */
export function applyFillsToTrade(t: Trade): void {
  const set = fillSet(t);
  if (!set.explicit) return;
  if (set.entryQty > 0) t.quantity = set.positionSize || set.entryQty;
  if (set.avgEntry > 0) t.entryPrice = round(set.avgEntry);
  if (set.avgExit > 0) t.exitPrice = round(set.avgExit);
  if (set.firstEntryTime) t.entryTime = set.firstEntryTime;
  if (set.lastExitTime) t.exitTime = set.lastExitTime;
  if (set.exits.length && set.exits.every((f) => Number.isFinite(f.pnl))) {
    // The fill P&L is gross; the trade's own P&L is gross too, so it is simply
    // their sum. Costs live on commission/fees, never folded into the result.
    const gross = set.exits.reduce((s, f) => s + (f.pnl ?? 0), 0);
    t.pnl = round(gross);
  }
  t.pnlPoints = tradePoints(t);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Test hook, same pattern as the other pure modules (grid, review, trends):
// the smoke harness has no bundler, so the maths is reachable from window.
if (typeof window !== "undefined") {
  window.__tjFills = {
    fillSet, fillLabel, fillIndex, toneClass, applyFillsToTrade, entrySide,
    isBreakEven, pointsOf, tradePoints,
  };
}
