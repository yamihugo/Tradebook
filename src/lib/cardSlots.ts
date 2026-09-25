import { AccountType } from "../types";

/**
 * What a card shows, per account type.
 *
 * This file is the single source of truth: `accountsListView` renders the two
 * bars and four numbers listed here, and nothing else picks or mixes slots. A
 * slot that is not in the catalog cannot be drawn, so the two can never drift.
 */

export interface SlotDef {
  id: string;
  label: string;
  /** One line: what the number actually means. */
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
  { id: "dayWin", label: "Day win", hint: "Share of trading days that closed positive" },
  { id: "withdrawn", label: "Paid out", hint: "Money taken out of the account, in payouts" },
  { id: "avgR", label: "Avg R", hint: "Average result per trade in multiples of the risk taken" },
  { id: "profitFactor", label: "Gross PF", hint: "Gross winning results divided by gross losing results" },
  { id: "toTarget", label: "To target", hint: "Days still needed at the current pace" },
  { id: "last", label: "Last trade", hint: "How long since the account traded" },
  { id: "symbols", label: "Symbols", hint: "How many instruments the account traded" },
  { id: "hold", label: "Hold time", hint: "Average time in market for winning trades" },
  { id: "expectancy", label: "Net / trade", hint: "Average Net account result per recorded trade, including gross breakeven" },
];

/** Two bars, always — a card without progress reads as a static balance. */
export const BAR_SLOTS = 2;
export const MINI_SLOTS = 4;

/**
 * The signed-off layout per account type — one layout, not a choice.
 *
 * An eval is about passing, a funded account about getting paid and staying
 * inside the two limits that end it, a personal account about whether the
 * process itself is holding up. These follow what the firms' own dashboards and
 * the established journals put in front of a trader; they change here, in one
 * place, when the review says so.
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
  eval: ["toTarget", "win", "profitFactor", "last"],
  funded: ["trades", "win", "withdrawn", "last"],
  live: ["trades", "win", "dayWin", "avgR"],
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

export interface CardLayout {
  bars: string[];
  mini: string[];
}

/** The two bars and four numbers a card of this type draws. */
export function layoutFor(type: AccountType): CardLayout {
  const bars = DEFAULT_BARS[type] ?? DEFAULT_BARS.unknown;
  const mini = DEFAULT_MINI[type] ?? DEFAULT_MINI.unknown;
  return { bars: known(bars, bars, BAR_SLOTS), mini: known(mini, mini, MINI_SLOTS) };
}

export const barLabel = (id: string): string => BAR_CATALOG.find((s) => s.id === id)?.label ?? id;
export const miniLabel = (id: string): string => MINI_CATALOG.find((s) => s.id === id)?.label ?? id;
