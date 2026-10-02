/**
 * Actual vs reconstructed — the supersession lifecycle.
 *
 * A generated copy leg is a model of the leader's trade. When the follower's
 * own fill finally arrives, the actual is the authority: it wins the
 * representation, the fills, the prices and the costs. The model is not deleted
 * — it is marked `supersededBy` and stays as history.
 *
 * The rules here are pure and deterministic; the caller (reconcile) supplies the
 * trades and writes the notes. No heuristics, no time windows: a leg is a
 * sibling only when the existing copy linkage says so (`copyBaseKey`) and the
 * account matches.
 *
 * Pure: no DOM, no plugin, no obsidian.
 */

import type { PrintEntry, Trade } from "../types";

/** True when a note has been replaced by an actual fill and is kept as history. */
export function isSuperseded(t: Trade | undefined | null): boolean {
  return !!t && !!String(t.supersededBy ?? "").trim();
}

/**
 * The account-scoped financial population: a superseded model stays in the
 * ledger as history, but it is not money. Every account money path filters
 * through this one rule, so the headline, the balance curve, the drawdown and
 * the cards read the same trades. The note itself is never deleted, mutated or
 * hidden globally.
 */
export function excludeSuperseded(trades: Trade[]): Trade[] {
  return trades.filter((t) => !isSuperseded(t));
}

/**
 * A generated leg the engine may still rewrite or remove. An imported (actual)
 * leg is never touchable, and neither is a superseded model — it is frozen
 * history, not a live copy.
 */
export function isReplaceableLeg(t: Trade): boolean {
  return t.copyOrigin !== "imported" && !isSuperseded(t);
}

const nonEmpty = (value?: string): boolean => !!(value ?? "").trim();

function unionStrings(a?: string[], b?: string[]): string[] | undefined {
  const out = [...(a ?? [])];
  for (const x of b ?? []) if (!out.includes(x)) out.push(x);
  return out.length ? out : a ?? b;
}

function unionScreenshots(a?: PrintEntry[], b?: PrintEntry[]): PrintEntry[] | undefined {
  const out = [...(a ?? [])];
  const seen = new Set(out.map((s) => s.file));
  for (const s of b ?? []) {
    if (!seen.has(s.file)) {
      out.push(s);
      seen.add(s.file);
    }
  }
  return out.length ? out : a ?? b;
}

/**
 * Fill the actual's gaps from the reconstructed model. The actual always wins:
 * the generated leg only supplies what the actual does not have. Arrays union,
 * screenshots union, acknowledgements OR — so nothing the trader wrote is ever
 * lost, and nothing they wrote on the actual is overwritten.
 */
export function mergeGeneratedIntoActual(actual: Trade, generated: Trade): Trade {
  const merged: Trade = { ...actual };
  const src = generated as unknown as Record<string, string | undefined>;
  const dst = merged as unknown as Record<string, string | undefined>;
  for (const key of ["notes", "thesis", "review", "setup", "mistake", "sessionOverride"] as const) {
    if (!nonEmpty(dst[key]) && nonEmpty(src[key])) dst[key] = src[key];
  }
  merged.tags = unionStrings(merged.tags, generated.tags);
  merged.psychology_tags = unionStrings(merged.psychology_tags, generated.psychology_tags);
  merged.mistake_tags = unionStrings(merged.mistake_tags, generated.mistake_tags);
  merged.screenshots = unionScreenshots(merged.screenshots, generated.screenshots);
  if (!merged.screenshot) {
    merged.screenshot = merged.screenshots?.length ? merged.screenshots[0].file : generated.screenshot || "";
  }
  if (!merged.reviewed && generated.reviewed) merged.reviewed = true;
  if (!merged.psychologyAcknowledged && generated.psychologyAcknowledged) merged.psychologyAcknowledged = true;
  if (!merged.mistakesAcknowledged && generated.mistakesAcknowledged) merged.mistakesAcknowledged = true;
  if (!(merged.rating && merged.rating > 0) && generated.rating && generated.rating > 0) merged.rating = generated.rating;
  return merged;
}

/**
 * The generated models of an actual leg, found only through the existing copy
 * linkage: same `copyBaseKey`, same account, still generated, not yet
 * superseded. Deterministic and idempotent — a second run finds nothing.
 */
export function generatedSiblings(
  trades: Trade[],
  actual: Trade,
  accountKey: (name: string) => string
): Trade[] {
  const base = String(actual.copyBaseKey ?? "").trim();
  if (!base) return [];
  const actualId = String(actual.id ?? "");
  const key = accountKey(actual.account || "");
  return trades.filter(
    (t) =>
      t !== actual &&
      t.isCopiedTrade === true &&
      t.copyOrigin !== "imported" &&
      !isSuperseded(t) &&
      String(t.copyBaseKey ?? "").trim() === base &&
      accountKey(t.account || "") === key &&
      String(t.id ?? "") !== actualId
  );
}
