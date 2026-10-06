// Trade Review System — pure, dependency-free.
//
// Every trade gets an automatic "review completeness" state so the journal can
// tell, without any manual bookkeeping, which trades are fully processed and
// which still need attention. Two tiers, one rule: only the required steps
// decide complete/not-complete, and the optional ones never block anything.
//
// Required checklist (complete/not-complete):
//   Screenshot -> a chart screenshot / print is attached
//   Strategy   -> the strategy is named
//   Review     -> post-trade reflection (the live `notes` field)
//   Rating     -> 1-5 execution rating
//
// Optional steps (enrich the summary, never block):
//   Psychology State   -> at least one psychology tag, or an explicit "none"
//   Execution Mistakes -> at least one mistake tag, or an explicit "none"
//
// A trade with neither psychology nor mistakes, and no acknowledgement, is
// still complete: the journal reports, it never imposes.
//
// ONE WAY TO CLOSE A DECISION: the trader's word. A decision is reviewed when
// the four required steps are written, OR when the trader marks it reviewed —
// an explicit override that closes the queue even for a trade nobody wrote up.
// That override is what makes an imported history usable: a broker's export
// cannot carry a screenshot, so a cold import would otherwise sit forever at 0%.
//
// The override lives in the *verdict*, never in the detail: `missing` still
// names what the note does not hold, because the journal must not pretend a
// print exists. `reviewed: false` reopens; nothing here blocks a trade.
//
// All functions are pure (no DOM) so they can be unit-tested.

import type { Trade } from "../types";

export type ReviewCheckKey = "print" | "setup" | "review" | "rating" | "psychology" | "mistakes";

export interface ReviewCheck {
  key: ReviewCheckKey;
  label: string;
  done: boolean;
  /** Required steps decide complete/not-complete; optional steps only enrich. */
  required: boolean;
}

export interface ReviewStatus {
  checks: ReviewCheck[];
  /** Required steps done (0..4). */
  requiredDone: number;
  requiredTotal: number;
  /** All steps done, optional included (0..6). */
  done: number;
  total: number;
  /** Required steps satisfied, or the trader marked it reviewed. */
  complete: boolean;
  /** The four required steps are written — the decision was written up in full. */
  writtenUp: boolean;
  /** No print attached yet. */
  needsPrint: boolean;
  /** Anything still blocking a complete review. */
  unreviewed: boolean;
  /** Labels of the required steps still missing (e.g. ["Screenshot", "Rating"]). */
  missing: string[];
  /** Short UI label: "Reviewed" or "Needs review". */
  label: string;
  /** Optional-step one-liner: "5 psychology · 3 mistakes", "no mistakes" or "". */
  optionalSummary: string;
}

// Values that look filled-in but carry no information.
const EMPTY_TOKENS = new Set(["", "-", "—", "n/a", "na", "none", "null", "todo", "tbd"]);

/** True when a text field holds real content (not blank/placeholder). */
export function hasText(value?: string): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v.length > 0 && !EMPTY_TOKENS.has(v);
}

/**
 * Does this trade have a print? Presence, not renderability: the legacy "added"
 * sentinel counts as present (the trader did attach something), and the vault
 * file is never checked here — that stays a display concern (see shotUrl).
 */
export function hasPrint(t: Trade): boolean {
  if ((t.screenshots ?? []).some((s) => (s.file ?? "").trim() !== "")) return true;
  return hasText(t.screenshot);
}

/**
 * The optional tier as one line: what the trader logged, or said they did not.
 * Empty when neither group has tags and neither was acknowledged.
 */
export function optionalSummary(t: Trade): string {
  const psychology = t.psychology_tags?.length ?? 0;
  const mistakes = t.mistake_tags?.length ?? 0;
  const parts: string[] = [];
  if (psychology > 0) parts.push(`${psychology} psychology`);
  else if (t.psychologyAcknowledged === true) parts.push("no psychology");
  if (mistakes > 0) parts.push(`${mistakes} mistake${mistakes === 1 ? "" : "s"}`);
  else if (t.mistakesAcknowledged === true) parts.push("no mistakes");
  return parts.join(" · ");
}

/** Full review status for a trade. */
export function reviewStatus(t: Trade): ReviewStatus {
  const requiredChecks: ReviewCheck[] = [
    { key: "print", label: "Screenshot", required: true, done: hasPrint(t) },
    { key: "setup", label: "Strategy", required: true, done: hasText(t.setup) },
    // The live field is `notes` (the old `review` is read for journals written
    // before the merge, so an old note is never reported as unreviewed).
    { key: "review", label: "Review", required: true, done: hasText(t.notes) || hasText(t.review) },
    { key: "rating", label: "Rating", required: true, done: (t.rating ?? 0) > 0 },
  ];
  const optionalChecks: ReviewCheck[] = [
    {
      key: "psychology",
      label: "Psychology State",
      required: false,
      done: (t.psychology_tags?.length ?? 0) > 0 || t.psychologyAcknowledged === true,
    },
    {
      key: "mistakes",
      label: "Execution Mistakes",
      required: false,
      done: (t.mistake_tags?.length ?? 0) > 0 || t.mistakesAcknowledged === true,
    },
  ];
  const checks = [...requiredChecks, ...optionalChecks];
  const requiredDone = requiredChecks.filter((c) => c.done).length;
  const done = checks.filter((c) => c.done).length;
  const requiredTotal = requiredChecks.length;
  const total = checks.length;
  const missing = requiredChecks.filter((c) => !c.done).map((c) => c.label);
  // Automatic by default, with the trader's word able to close or hold a trade:
  // `reviewed: true` completes it (the override), `reviewed: false` forces it
  // open. The checklist itself stays factual — `missing` still names what is not
  // there, even when the override is what made the trade complete.
  const writtenUp = requiredDone === requiredTotal;
  const complete = t.reviewed === false ? false : t.reviewed === true || writtenUp;
  return {
    checks,
    requiredDone,
    requiredTotal,
    done,
    total,
    complete,
    writtenUp,
    needsPrint: !requiredChecks[0].done,
    unreviewed: !complete,
    missing,
    label: complete ? "Reviewed" : "Needs review",
    optionalSummary: optionalSummary(t),
  };
}

/**
 * Aggregate review coverage across a trade list — the one number the coverage
 * ring shows, plus how many of those were actually written up. The written-up
 * count is not a second headline: it is only ever read by a tooltip.
 */
export function reviewSummary(trades: Trade[]): {
  total: number;
  complete: number;
  writtenUp: number;
  withPrint: number;
  unreviewed: number;
  missingPrint: number;
  noSetup: number;
  noReview: number;
  noRating: number;
  pct: number;
} {
  const total = trades.length;
  let complete = 0;
  let writtenUp = 0;
  let withPrint = 0;
  let unreviewed = 0;
  let missingPrint = 0;
  let noSetup = 0;
  let noReview = 0;
  let noRating = 0;
  for (const t of trades) {
    const s = reviewStatus(t);
    const done = (key: ReviewCheckKey) => s.checks.find((c) => c.key === key)?.done ?? false;
    if (s.complete) complete++;
    if (s.writtenUp) writtenUp++;
    if (!s.needsPrint) withPrint++; else missingPrint++;
    if (s.unreviewed) unreviewed++;
    if (!done("setup")) noSetup++;
    if (!done("review")) noReview++;
    if (!done("rating")) noRating++;
  }
  return {
    total,
    complete,
    writtenUp,
    withPrint,
    unreviewed,
    missingPrint,
    noSetup,
    noReview,
    noRating,
    pct: total ? Math.round((complete / total) * 100) : 0,
  };
}

// Test hook for the smoke harness (jsdom): the pure engine is easy to verify.
if (typeof window !== "undefined") {
  window.__tjReview = { hasText, reviewStatus, reviewSummary, optionalSummary };
}
