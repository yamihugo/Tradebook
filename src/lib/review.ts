// Trade Review System — pure, dependency-free.
//
// Every trade gets an automatic "review completeness" state so the journal can
// tell, without any manual bookkeeping, which trades are fully processed
// (print + notes filled in) and which still need attention.
//
// Required checklist:
//   Print    -> a chart screenshot / print is attached
//   Setup    -> the setup is named
//   Review   -> post-trade reflection
//   Rating   -> 1-5 execution rating
//
// "Mistake" is optional (a winning trade may simply have no mistake) so it is
// stored on the trade but does NOT count against completeness.
//
// All functions are pure (no DOM) so they can be unit-tested.

import type { Trade } from "../types";

export interface ReviewCheck {
  key: "print" | "setup" | "review" | "rating";
  label: string;
  done: boolean;
}

export interface ReviewStatus {
  checks: ReviewCheck[];
  done: number;
  total: number;
  /** All checks satisfied. */
  complete: boolean;
  /** No print attached yet. */
  needsPrint: boolean;
  /** The Review notes are still empty. */
  unreviewed: boolean;
  /** Labels of the checks still missing (e.g. ["Print", "Thesis"]). */
  missing: string[];
  /** Short UI label: "Complete" or "3/6". */
  label: string;
}

// Values that look filled-in but carry no information.
const EMPTY_TOKENS = new Set(["", "-", "—", "n/a", "na", "none", "null", "todo", "tbd"]);

/** True when a text field holds real content (not blank/placeholder). */
export function hasText(value?: string): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v.length > 0 && !EMPTY_TOKENS.has(v);
}

/** Number of checklist items done for a trade. */
export function reviewScore(t: Trade): number {
  return reviewStatus(t).done;
}

/** Is the trade fully reviewed? */
export function isReviewed(t: Trade): boolean {
  return reviewStatus(t).complete;
}

/** Full review status for a trade. */
export function reviewStatus(t: Trade): ReviewStatus {
  const checks: ReviewCheck[] = [
    { key: "print", label: "Print", done: hasText(t.screenshot) || (t.screenshots?.length ?? 0) > 0 },
    { key: "setup", label: "Strategy", done: hasText(t.setup) },
    { key: "review", label: "Review", done: hasText(t.review) },
    { key: "rating", label: "Rating", done: (t.rating ?? 0) > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  const total = checks.length;
  const missing = checks.filter((c) => !c.done).map((c) => c.label);
  const complete = done === total || t.reviewed === true;
  return {
    checks,
    done,
    total,
    complete,
    needsPrint: !checks[0].done,
    unreviewed: !checks[2].done,
    missing,
    label: complete ? "Complete" : `${done}/${total}`,
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
    if (s.complete) complete++;
    if (!s.needsPrint) withPrint++; else missingPrint++;
    if (s.unreviewed) unreviewed++;
    if (!s.checks[1].done) noSetup++;
    if (!s.checks[2].done) noReview++;
    if (!s.checks[3].done) noRating++;
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
  (window as any).__tjReview = { hasText, reviewScore, isReviewed, reviewStatus, reviewSummary };
}
