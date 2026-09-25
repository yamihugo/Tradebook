import type { Trade } from "../types";

/** Stable identity for the population a bulk selection belongs to. */
export function tradeSelectionScopeKey(scope: Record<string, unknown>): string {
  return JSON.stringify(scope);
}

/** Keep bulk operations inside the current filtered population. */
export function eligibleTradeIds(trades: Trade[], selected: Set<string>): Set<string> {
  const allowed = new Set(trades.map((trade) => trade.id).filter((id): id is string => !!id));
  return new Set([...selected].filter((id) => allowed.has(id)));
}
