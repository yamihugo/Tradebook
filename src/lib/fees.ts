/**
 * What a trade paid, and what the journal was told it paid.
 *
 * Two different numbers live here. The platform's own commission and fees are
 * facts that came out of its reports; an allocation is a slice of a balance
 * correction — a share of a difference nobody itemised. They are never added
 * together silently: every surface asks for `real`, `allocated` and `total`
 * separately, so the model can be labelled as a model.
 */

import { FeeAdjustment, Trade } from "../types";

/** Rounded to the cent — money is never shown with fractions of a cent. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Every key this trade answers to, most specific first.
 *
 * The fill id is the platform's own identity and never collides. A hand-entered
 * trade has none, so the note's path is used instead — two trades can share a
 * date, symbol, direction and time, and only the file tells them apart. The old
 * compound key is kept as a fallback so slices logged before this change still
 * find their trade instead of turning into orphans.
 */
export function tradeFeeKeys(t: Trade): string[] {
  const out: string[] = [];
  if (t.fillId) out.push(`id:${t.fillId}`);
  if (t.id) out.push(`k:${t.id}`);
  out.push(`k:${t.date}|${t.symbol}|${t.direction}|${t.entryTime ?? ""}`);
  return out;
}

/** The canonical key a new slice is written under. */
export function tradeFeeKey(t: Trade): string {
  return tradeFeeKeys(t)[0];
}

/** Every key that already carries a slice of a correction on this account. */
export function allocatedKeys(adjustments: FeeAdjustment[]): Set<string> {
  const keys = new Set<string>();
  for (const a of adjustments) for (const s of a.allocations ?? []) keys.add(s.key);
  return keys;
}

/** What one trade carries: the platform's number, the correction's slice, and their sum. */
export interface AllocatedFee {
  /** Commission and fees the platform reported for this trade. */
  real: number;
  /** The slice of a balance correction laid on it — a model, not a line the broker wrote. */
  allocated: number;
  /** Both, for the places that need one number, always shown with its split. */
  total: number;
}

export function feeForTrade(t: Trade, adjustments: FeeAdjustment[]): AllocatedFee {
  const keys = tradeFeeKeys(t);
  let allocated = 0;
  for (const a of adjustments) {
    for (const s of a.allocations ?? []) if (keys.includes(s.key)) allocated += s.amount;
  }
  const real = (t.commission || 0) + (t.fees || 0);
  return { real: round2(real), allocated: round2(allocated), total: round2(real + allocated) };
}

/**
 * Divide a correction across the trades of its window, in proportion to size.
 *
 * A futures bill is charged per contract, so a trade that carried ten contracts
 * takes ten times the slice of a one-contract trade. The amount is worked in
 * whole cents and the few cents that cannot be divided go, one each, to the
 * trades with the largest fractional share — so the slices add up to the amount
 * exactly, never a cent more or less.
 */
export function allocateProportional(
  trades: Trade[],
  total: number
): { key: string; date: string; amount: number }[] {
  if (trades.length === 0) return [];
  const weights = trades.map((t) => (Number.isFinite(t.quantity) && t.quantity > 0 ? t.quantity : 1));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return [];
  const cents = Math.round(total * 100);
  const raw = weights.map((w) => (cents * w) / weightSum);
  const out = raw.map((x) => Math.floor(x));
  let rest = cents - out.reduce((s, x) => s + x, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && rest > 0; k++, rest--) out[order[k].i] += 1;
  return trades.map((t, i) => ({ key: tradeFeeKey(t), date: t.date, amount: out[i] / 100 }));
}
