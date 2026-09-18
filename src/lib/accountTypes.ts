import type { AccountType } from "../types";

/**
 * Account types are a closed set — the plugin classifies every trade into one of
 * these. What a journal *calls* them and the order they appear in is personal,
 * so those two things (plus the colour) are settings, applied here in one place.
 *
 * The preferences are held module-level on purpose: the helpers below are called
 * from a dozen places (sections, composition bar, tags, filters) and threading a
 * settings object through all of them would buy nothing.
 */

export const TYPE_KEYS: AccountType[] = ["funded", "live", "personal", "eval", "demo", "unknown"];

export const DEFAULT_LABELS: Record<string, string> = {
  funded: "Funded",
  live: "Live",
  personal: "Personal",
  eval: "Eval",
  demo: "Demo",
  unknown: "Other",
};

/** One colour per account type — used by the composition bar and the sections. */
/**
 * One colour per type, chosen so the meaning reads at a glance: your own money
 * is teal, live prop is blue, funded is the green of a passed challenge, an eval
 * is violet, a demo is amber and anything unknown stays grey. They can be
 * swapped for any of the palette colours in Manage → Types.
 */
export const DEFAULT_COLORS: Record<string, string> = {
  funded: "#34d17a",
  live: "#4aa8ff",
  personal: "#7de2d1",
  eval: "#a882ff",
  demo: "#d9a441",
  unknown: "#8a8a8a",
};

/**
 * The palette offered in the Manage → Types tab. Picked in a popover, never a
 * native colour picker: a fixed set keeps two types from ending up the same
 * muddy shade and keeps the page readable.
 */
export const TYPE_COLOR_CHOICES = [
  "#34d17a",
  "#7de2d1",
  "#4aa8ff",
  "#6c8cff",
  "#a882ff",
  "#d98cff",
  "#ff8fd1",
  "#ff8d6b",
  "#ff5d48",
  "#e8c547",
  "#d9a441",
  "#a3e635",
  "#4fd1c5",
  "#b8b8b8",
  "#8a8a8a",
  "#5b8def",
];

/** Section order — funded first by default, demo/other last. */
/**
 * Section order out of the box: the accounts you look at every day first —
 * personal, then live, then funded — with the challenges and sandboxes after
 * them. Anyone can drag them around in Manage → Types.
 */
export const DEFAULT_ORDER: AccountType[] = ["personal", "live", "funded", "eval", "demo", "unknown"];

export interface TypePrefs {
  order?: AccountType[];
  labels?: Record<string, string>;
  colors?: Record<string, string>;
}

let prefs: TypePrefs = {};

/** Called by the plugin whenever settings load or are saved. */
export function setTypePrefs(next: TypePrefs | undefined): void {
  prefs = next ?? {};
}

export function typeKey(t: string): AccountType {
  return (TYPE_KEYS as string[]).includes(t) ? (t as AccountType) : "unknown";
}

export function typeLabel(t: string): string {
  const k = typeKey(t);
  return prefs.labels?.[k] ?? DEFAULT_LABELS[k];
}

export function typeColor(t: string): string {
  const k = typeKey(t);
  return prefs.colors?.[k] ?? DEFAULT_COLORS[k];
}

/** The saved order, with any type the journal never touched appended at the end. */
export function typeOrder(): AccountType[] {
  const saved = (prefs.order ?? []).filter((k) => (TYPE_KEYS as string[]).includes(k));
  return [...saved, ...TYPE_KEYS.filter((k) => !saved.includes(k))];
}

export function typeRank(t: string): number {
  const order = typeOrder();
  const i = order.indexOf(typeKey(t));
  return i < 0 ? order.length : i;
}
