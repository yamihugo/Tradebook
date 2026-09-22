/**
 * Tag helpers for the review UI. Pure functions, no Obsidian dependency.
 *
 * Tags are stored as plain strings in the trade note's frontmatter. We normalise
 * on save so the same label can never appear twice with different spacing or
 * casing — the analytics layer counts by string, so "fomo" and "FOMO " would
 * otherwise read as two different mistakes.
 */

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
