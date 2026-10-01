/**
 * Tag helpers for the review UI. Pure functions, no Obsidian dependency.
 *
 * Tags are stored as plain strings in the trade note's frontmatter. We normalise
 * on save so the same label can never appear twice with different spacing or
 * casing — the analytics layer counts by string, so "fomo" and "FOMO " would
 * otherwise read as two different mistakes.
 */

import type { Trade } from "../types";

/**
 * The review vocabulary. A small, closed, flat list — a journal that offers
 * forty labels, or free-typed names, gets inconsistent tagging. The trader
 * trims it in Settings; a tag is picked from the list, never invented on a
 * trade. Nothing is applied automatically, because a journal records what the
 * trader declares, it does not infer a motive from a P&L.
 *
 * Mistakes are grouped by where in the trade the error happened (Entry, Exit,
 * Sizing & risk, Discipline); the group is an index for the eye, never a tag
 * itself. The list follows the published guidance (TradeReveal: four error
 * families; TradeMedic: doubling down is the costliest, overtrading the most
 * common).
 */
export interface TagGroup {
  id: string;
  label: string;
  tags: string[];
}

export const MISTAKE_GROUPS: TagGroup[] = [
  { id: "entry", label: "Entry", tags: ["Chased entry", "Early entry", "No setup", "Revenge entry", "Hesitated"] },
  { id: "exit", label: "Exit", tags: ["Moved stop", "No stop", "Cut winner early", "Let loser run"] },
  { id: "risk", label: "Sizing & risk", tags: ["Oversized", "Undersized", "Doubling down"] },
  { id: "discipline", label: "Discipline", tags: ["Overtrading", "Off-session", "Distracted", "Rule break"] },
];

export const PSYCHOLOGY_TAGS = ["Confident", "Calm", "Anxious", "Impatient", "Frustrated", "FOMO", "Revenge", "Bored"];

/** Every mistake tag in the library, in reading order. */
export function allMistakeTags(): string[] {
  return MISTAKE_GROUPS.flatMap((g) => g.tags);
}

/** Both libraries, for a category key. */
export function libraryFor(key: "mistakes" | "psychology"): string[] {
  return key === "mistakes" ? allMistakeTags() : PSYCHOLOGY_TAGS.slice();
}

/**
 * The set the trader chose to see offered during review. Absent = the whole
 * library; an explicit empty list = no suggestions (only the trader's own tags
 * from notes and whatever they type). Values no longer in the library are
 * dropped, so a renamed tag never lingers.
 */
export function reviewOptions(
  settings: { reviewOptions?: { mistakes?: string[]; psychology?: string[] } } | undefined,
  key: "mistakes" | "psychology"
): string[] {
  const chosen = settings?.reviewOptions?.[key];
  if (!chosen) return libraryFor(key);
  const allowed = new Set(libraryFor(key));
  return chosen.filter((t) => allowed.has(t));
}

/** Trim and collapse internal whitespace: "  FOMO   Entry " -> "FOMO Entry". */
export function normalizeTag(raw: string): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Normalise a list: trim each entry, drop empties, and dedupe case-insensitively
 * keeping the first spelling seen (so the trader's own casing wins).
 */
export function normalizeTags(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list ?? []) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * The execution-mistake labels a trade carries: the curated `mistake_tags`
 * when the note has any, the legacy single `mistake` otherwise. This is the
 * one reader the analytics should use — `process.ts`/`trends.ts` used to read
 * `t.mistake` only and so never saw a trade tagged through the review UI.
 */
export function mistakeTagsOf(t: Trade): string[] {
  if (t.mistake_tags && t.mistake_tags.length) return t.mistake_tags;
  return t.mistake ? [t.mistake] : [];
}

/** The psychology-state labels a trade carries: `psychology_tags`, legacy `tags` fallback. */
export function psychologyTagsOf(t: Trade): string[] {
  if (t.psychology_tags && t.psychology_tags.length) return t.psychology_tags;
  return t.tags ?? [];
}

/**
 * A trade the trader explicitly declared as revenge-driven: the mistake tag
 * "Revenge entry" or the psychology state "Revenge". This is the trader's own
 * declaration, never a motive we inferred from a timestamp, a P&L or a
 * sequence (docs/UX-GUIDELINES.md §0).
 */
const DECLARED_REVENGE = new Set(["revenge entry", "revenge"]);
export function isDeclaredRevenge(t: Trade): boolean {
  for (const tag of [...mistakeTagsOf(t), ...psychologyTagsOf(t)]) {
    if (DECLARED_REVENGE.has(normalizeTag(tag).toLowerCase())) return true;
  }
  return false;
}

/**
 * The declared states that read as adverse: the trader's own word, never a
 * motive we inferred. `Confident` and `Calm` are deliberately left out — a
 * state is not an error, and only the adverse ones feed the Tilt attribution.
 */
const NEGATIVE_PSYCHOLOGY_TAGS = new Set(["anxious", "impatient", "frustrated", "fomo", "revenge", "bored"]);
export function inNegativeState(t: Trade): boolean {
  return psychologyTagsOf(t).some((tag) => NEGATIVE_PSYCHOLOGY_TAGS.has(normalizeTag(tag).toLowerCase()));
}
