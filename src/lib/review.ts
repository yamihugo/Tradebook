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
// still complete: the journal reports, it never imposes. The explicit
// `reviewed: true` flag is no longer an absolute override — if a required
// field is cleared the trade goes back to incomplete, and `reviewed: false`
// still forces incomplete. The trader keeps the last word in both directions.
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
  /** Required steps satisfied and not explicitly dismissed. */
  complete: boolean;
  /** No print attached yet. */
  needsPrint: boolean;
  /** Anything still blocking a complete review. */
  unreviewed: boolean;
  /** Labels of the required steps still missing (e.g. ["Screenshot", "Rating"]). */
  missing: string[];
  /** Short UI label: "Complete" or "3/4". */
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

/** Number of checklist items done for a trade (required + optional). */
export function reviewScore(t: Trade): number {
  return reviewStatus(t).done;
}

/** Is the trade fully reviewed? */
export function isReviewed(t: Trade): boolean {
  return reviewStatus(t).complete;
}

/** Full review status for a trade. */
export function reviewStatus(t: Trade): ReviewStatus {
  const requiredChecks: ReviewCheck[] = [
    { key: "print", label: "Screenshot", required: true, done: hasText(t.screenshot) || (t.screenshots?.length ?? 0) > 0 },
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
  // Automatic by default, with the trader's explicit word only able to keep a
  // trade open: `reviewed: false` forces incomplete, `reviewed: true` never
  // papers over a required field that was cleared.
  const complete = requiredDone === requiredTotal && t.reviewed !== false;
  return {
    checks,
    requiredDone,
    requiredTotal,
    done,
    total,
    complete,
    needsPrint: !requiredChecks[0].done,
    unreviewed: !complete,
    missing,
    label: complete ? "Complete" : `${requiredDone}/${requiredTotal}`,
    optionalSummary: optionalSummary(t),
  };
}

/** Aggregate review coverage across a trade list. */
export function reviewSummary(trades: Trade[]): {
  total: number;
  complete: number;
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
    if (!s.needsPrint) withPrint++; else missingPrint++;
    if (s.unreviewed) unreviewed++;
    if (!done("setup")) noSetup++;
    if (!done("review")) noReview++;
    if (!done("rating")) noRating++;
  }
  return {
    total,
    complete,
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
  (window as any).__tjReview = { hasText, reviewScore, isReviewed, reviewStatus, reviewSummary, optionalSummary };
}
