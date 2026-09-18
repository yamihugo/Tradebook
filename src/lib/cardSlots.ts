import { AccountType } from "../types";

/**
 * What a card can show, and what it shows by default.
 *
 * This file is the single source of truth for both ends: `accountsListView`
 * renders from these ids, and Manage → Cards offers exactly the same list. A
 * slot that is not here cannot be picked, and a slot picked here always has a
 * builder to draw it — the two can never drift apart.
 */

export interface SlotDef {
  id: string;
  label: string;
  /** One line for the Manage tab: what the number actually means. */
  hint: string;
}

/** The two wide bars. Progress, not decoration: bar length beats a ring. */
export const BAR_CATALOG: SlotDef[] = [
  { id: "target", label: "Profit target", hint: "Progress toward the profit target, and how much is still missing" },
  { id: "drawdown", label: "Drawdown level", hint: "How much of the loss limit has been used, and the room left" },
  { id: "dailyRoom", label: "Daily room", hint: "What is left of the daily loss limit today" },
  { id: "greenDays", label: "Green days", hint: "Share of trading days that closed positive" },
  { id: "ddFromPeak", label: "Drawdown from peak", hint: "Distance below the highest balance this account reached" },
];

/** The four quiet numbers under the bars. */
export const MINI_CATALOG: SlotDef[] = [
  { id: "trades", label: "Trades", hint: "How many trades the account holds" },
  { id: "win", label: "Win rate", hint: "Winning trades out of decided trades — break-even excluded" },
  { id: "withdrawn", label: "Paid out", hint: "Money taken out of the account, in payouts" },
  { id: "avgR", label: "Avg R", hint: "Average result per trade in multiples of the risk taken" },
  { id: "profitFactor", label: "Profit factor", hint: "Money won for every unit lost" },
  { id: "toTarget", label: "To target", hint: "Days still needed at the current pace" },
  { id: "last", label: "Last trade", hint: "How long since the account traded" },
  { id: "symbols", label: "Symbols", hint: "How many instruments the account traded" },
  { id: "hold", label: "Hold time", hint: "Average time in market for winning trades" },
  { id: "expectancy", label: "Expectancy", hint: "Average result per trade, in money" },
];

/** Two bars, always — a card without progress reads as a static balance. */
export const BAR_SLOTS = 2;
export const MINI_SLOTS = 4;

/**
 * Defaults per account type. These are the signed-off defaults: an eval is
 * about passing, a funded account about getting paid, a personal account about
 * whether the process itself is holding up.
 */
export const DEFAULT_BARS: Record<AccountType, string[]> = {
  eval: ["target", "drawdown"],
  funded: ["dailyRoom", "drawdown"],
  live: ["dailyRoom", "drawdown"],
  personal: ["greenDays", "ddFromPeak"],
  demo: ["greenDays", "ddFromPeak"],
  unknown: ["greenDays", "ddFromPeak"],
};

export const DEFAULT_MINI: Record<AccountType, string[]> = {
  eval: ["trades", "win", "toTarget", "last"],
  funded: ["trades", "win", "withdrawn", "last"],
  live: ["trades", "win", "withdrawn", "avgR"],
  personal: ["trades", "win", "profitFactor", "avgR"],
  demo: ["trades", "win", "symbols", "last"],
  unknown: ["trades", "win", "profitFactor", "avgR"],
};

export const ALL_SLOT_IDS = new Set([...BAR_CATALOG, ...MINI_CATALOG].map((s) => s.id));

/** Keep only ids we still know how to draw, in the order they arrived. */
const known = (ids: string[] | undefined, fallback: string[], size: number): string[] => {
  const clean = (ids ?? []).filter((id) => ALL_SLOT_IDS.has(id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...clean, ...fallback]) {
    if (out.length >= size) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

export function barsFor(type: AccountType, saved?: Record<string, string[]>): string[] {
  const fallback = DEFAULT_BARS[type] ?? DEFAULT_BARS.unknown;
  return known(saved?.[type], fallback, BAR_SLOTS);
}

export function miniFor(type: AccountType, saved?: Record<string, string[]>): string[] {
  const fallback = DEFAULT_MINI[type] ?? DEFAULT_MINI.unknown;
  return known(saved?.[type], fallback, MINI_SLOTS);
}

export const barLabel = (id: string): string => BAR_CATALOG.find((s) => s.id === id)?.label ?? id;
export const miniLabel = (id: string): string => MINI_CATALOG.find((s) => s.id === id)?.label ?? id;
