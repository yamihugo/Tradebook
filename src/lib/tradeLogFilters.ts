import type { Trade } from "../types";

/** Search one logical decision across visible legs and its canonical trade record. */
export function matchesTradeLogSearch(trades: Trade[], query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = trades
    .flatMap((t) => [
      t.symbol,
      t.setup,
      ...(Array.isArray(t.setups) ? t.setups : []),
      t.mistake,
      t.notes,
      t.review,
      t.thesis,
      t.review_what_happened,
      t.review_repeat_change,
      t.exit_reason,
      t.orderType,
      t.account,
      (t.tags || []).join(" "),
      (t.mistake_tags || []).join(" "),
      (t.psychology_tags || []).join(" "),
    ])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => hay.includes(term));
}

/** Match a selected strategy against both current multi-strategy and legacy fields. */
export function tradeMatchesStrategies(trade: Trade, selected: string[]): boolean {
  if (!selected.length) return true;
  const wanted = new Set(selected.map((value) => value.toLowerCase()));
  return [trade.setup, ...(Array.isArray(trade.setups) ? trade.setups : [])].some(
    (value) => typeof value === "string" && wanted.has(value.toLowerCase())
  );
}
