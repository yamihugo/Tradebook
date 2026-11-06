import type { Trade } from "../types";

/** Preserve every legacy assignment until the trader explicitly resolves it. */
export function strategiesOf(trade: Pick<Trade, "setup" | "setups">): string[] {
  const values = [...(trade.setups ?? []), trade.setup ?? ""];
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasSingleStrategy(trade: Pick<Trade, "setup" | "setups">): boolean {
  return strategiesOf(trade).length === 1;
}

export function hasValidRating(trade: Pick<Trade, "rating">): boolean {
  return typeof trade.rating === "number" && Number.isInteger(trade.rating) && trade.rating >= 1 && trade.rating <= 5;
}
