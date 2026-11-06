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
 * Mistakes are grouped by where in the trade the error happened (Entry timing,
 * Entry validity, Management & exit, Risk & size, Discipline & process); the
 * group is an index for the eye, never a tag itself.
 */
export interface TagGroup {
  id: string;
  label: string;
  tags: string[];
}

export const MISTAKE_GROUPS: TagGroup[] = [
  { id: "entry-timing", label: "Entry timing", tags: ["Entered early", "Entered late", "Chased entry"] },
  { id: "entry-validity", label: "Entry validity", tags: ["No valid setup", "Outside session"] },
  { id: "management-exit", label: "Management & exit", tags: ["Took profit early / Cut winner early", "Let loss run / Late exit", "Moved stop", "No stop", "No target"] },
  { id: "risk-size", label: "Risk & size", tags: ["Too large size", "Too small size"] },
  { id: "discipline-process", label: "Discipline & process", tags: ["Overtraded", "Revenge entry", "Broke plan / rules"] },
];

export const PSYCHOLOGY_TAGS = [
  "Calm",
  "Focused",
  "Confident",
  "Overconfident",
  "Anxious",
  "Frustrated",
  "Impatient",
  "Bored",
  "Hesitant",
  "Distracted",
  "FOMO",
  "Revenge",
];

/** Every mistake tag in the library, in reading order. */
export function allMistakeTags(): string[] {
  return MISTAKE_GROUPS.flatMap((g) => g.tags);
}

/** Both libraries, for a category key. */
export function libraryFor(key: "mistakes" | "psychology"): string[] {
  return key === "mistakes" ? allMistakeTags() : PSYCHOLOGY_TAGS.slice();
}

const LEGACY_REVIEW_OPTION_MAP: Record<string, string | undefined> = {
  "early entry": "Entered early",
  "late entry": "Entered late",
  "missed entry": undefined,
  "early exit": "Took profit early / Cut winner early",
  "late exit": "Let loss run / Late exit",
  "order error": "Broke plan / rules",
  "execution mismatch": "Broke plan / rules",
  "chased entry": "Chased entry",
  "no setup": "No valid setup",
  "revenge entry": "Revenge entry",
  "hesitated": undefined,
  "moved stop": "Moved stop",
  "no stop": "No stop",
  "cut winner early": "Took profit early / Cut winner early",
  "let loser run": "Let loss run / Late exit",
  "oversized": "Too large size",
  "undersized": "Too small size",
  "doubling down": undefined,
  "overtrading": "Overtraded",
  "off-session": "Outside session",
  "distracted": undefined,
  "rule break": "Broke plan / rules",
};

function migrateReviewOption(tag: string): string | undefined {
  return LEGACY_REVIEW_OPTION_MAP[tag.trim().toLowerCase()] ?? (libraryFor("mistakes").includes(tag) ? tag : undefined);
}

/**
 * The set the trader chose to see offered during review. Legacy saved labels
 * are migrated to the approved vocabulary so an older settings file cannot
 * silently hide newly approved options.
 */
export function reviewOptions(
  settings: { reviewOptions?: { mistakes?: string[]; psychology?: string[] } } | undefined,
  key: "mistakes" | "psychology"
): string[] {
  const chosen = settings?.reviewOptions?.[key];
  if (!chosen) return libraryFor(key);
  if (key === "psychology") {
    const allowed = new Set(libraryFor(key));
    return chosen.filter((tag) => allowed.has(tag));
  }
  return Array.from(new Set(chosen.map(migrateReviewOption).filter((tag): tag is string => Boolean(tag))));
}

/** Grouped picker data for the Trade Detail review surface. */
export function reviewTagGroups(
  settings: { reviewOptions?: { mistakes?: string[]; psychology?: string[] } } | undefined,
  key: "mistakes" | "psychology"
): TagGroup[] {
  if (key === "psychology") return [{ id: "psychology", label: "Psychology", tags: reviewOptions(settings, key) }];
  const allowed = new Set(reviewOptions(settings, key));
  return MISTAKE_GROUPS.map((group) => ({
    ...group,
    tags: group.tags.filter((tag) => allowed.has(tag)),
  }));
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
const NEGATIVE_PSYCHOLOGY_TAGS = new Set([
  "overconfident",
  "anxious",
  "impatient",
  "frustrated",
  "bored",
  "hesitant",
  "distracted",
  "fomo",
  "revenge",
]);
export function inNegativeState(t: Trade): boolean {
  return psychologyTagsOf(t).some((tag) => NEGATIVE_PSYCHOLOGY_TAGS.has(normalizeTag(tag).toLowerCase()));
}
