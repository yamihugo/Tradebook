// Trade Review System — pure, dependency-free.
//
// Review evidence is authoritative. The old checklist remains descriptive for
// migration and editing, never a product completion verdict.
//
// Automatic completion requires all six agreed review signals. Strategy, rating,
// Psychology, execution tags and both reflection prompts each have a clear
// completion state; plan details, prints, and exit reason remain optional.
//
// Legacy records remain compatible: an old complete record is not silently
// reopened, while its current missing fields remain factual in the status.
// `reviewed: false` still reopens a record explicitly; new UI does not expose a
// manual completion button.
//
// All functions are pure (no DOM) so they can be unit-tested.

import type { Trade } from "../types";
import { legBaseKey } from "./copy";
import { hasSingleStrategy, hasValidRating, strategiesOf } from "./strategySelection";

export type ReviewCheckKey = "setup" | "rating" | "whatHappened" | "repeatChange" | "psychology" | "mistakes" | "print" | "review" | "exitReason";
export type ReviewState = "needs-review" | "reviewed" | "reviewed-with-missing-context" | "legacy-marked-reviewed" | "reopened";

export interface ConditionalReviewCheck {
  key: "planAdherence";
  label: string;
  done: boolean;
  required: boolean;
}

export interface ReviewCheck {
  key: ReviewCheckKey;
  label: string;
  done: boolean;
  /** Required steps decide complete/not-complete; optional steps only enrich. */
  required: boolean;
}

export interface ReviewStatus {
  /** Human evidence state: no evidence, evidence, legacy marker, or explicit reopen. */
  evidence: "none" | "exists" | "legacy-marked-reviewed" | "reopened";
  /** Canonical review status, distinct from the presence of optional evidence. */
  state: ReviewState;
  checks: ReviewCheck[];
  /** Reflection prompts done (0..2). */
  requiredDone: number;
  requiredTotal: number;
  /** Optional context checks (currently plan adherence) never gate completion. */
  conditionalChecks: ConditionalReviewCheck[];
  conditionalMissing: string[];
  /** All listed core and optional signals done. */
  done: number;
  total: number;
  /** All six required review signals are complete, independent of the override. */
  humanCoreComplete: boolean;
  /** All legacy context steps are complete. */
  legacyWrittenUp: boolean;
  /** Required steps satisfied, or the trader marked it reviewed. */
  complete: boolean;
  /** The six-signal review is complete, or an explicit reviewed marker is present. */
  writtenUp: boolean;
  /** No print attached yet. */
  needsPrint: boolean;
  /** Anything still blocking a complete review. */
  unreviewed: boolean;
  /** Labels of the required steps still missing (e.g. ["Screenshot", "Rating"]). */
  missing: string[];
  /** Short UI label for the canonical review state. */
  label: string;
  /** Optional-step one-liner: "5 psychology · 3 mistakes", "no mistakes" or "". */
  optionalSummary: string;
}

export interface PlanDifference {
  key: "entry" | "stop" | "target" | "quantity";
  label: string;
  planned: number;
  actual: number;
  difference: number;
  comparison: "actual-minus-planned";
  applicableTo: "all" | "long" | "short";
}

/** Neutral planned-vs-actual facts; absent sides remain absent. */
export function planDifferences(t: Trade): PlanDifference[] {
  const pairs: Array<[PlanDifference["key"], string, number | undefined, number | undefined, PlanDifference["applicableTo"]]> = [
    ["entry", "Entry variance", t.review_planned_entry, t.entryPrice, "all"],
    ["stop", "Stop level variance", t.review_planned_stop, t.stopLoss, t.direction === "short" ? "short" : "long"],
    ["target", "Target level variance", t.review_planned_target, t.target, t.direction === "short" ? "short" : "long"],
    ["quantity", "Quantity variance", t.review_planned_quantity, t.quantity, "all"],
  ];
  return pairs
    .filter(([, , planned, actual]) => Number.isFinite(planned) && Number.isFinite(actual) && (planned as number) > 0 && (actual as number) > 0)
    .map(([key, label, planned, actual, applicableTo]) => ({
      key, label, planned: planned as number, actual: actual as number,
      difference: (actual as number) - (planned as number),
      comparison: "actual-minus-planned" as const,
      applicableTo,
    }));
}

export type PlannedNumberField = "review_planned_entry" | "review_planned_stop" | "review_planned_target" | "review_planned_quantity";
const plannedDomains: Record<PlannedNumberField, { minExclusive: number }> = {
  review_planned_entry: { minExclusive: 0 },
  review_planned_stop: { minExclusive: 0 },
  review_planned_target: { minExclusive: 0 },
  review_planned_quantity: { minExclusive: 0 },
};

/** Parse one complete numeric token at the UI/storage boundary. */
export function parsePlannedNumber(raw: unknown, field: PlannedNumberField): number | undefined {
  if (raw === undefined || raw === null || (typeof raw !== "string" && typeof raw !== "number")) return undefined;
  if (String(raw).trim() === "") return undefined;
  const token = String(raw).trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(token)) return undefined;
  const value = Number(token);
  if (!Number.isFinite(value) || value <= plannedDomains[field].minExclusive) return undefined;
  return value;
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

export type ReviewRepresentativeRow = { key: string; rep: Trade };

/**
 * Resolve visible legs back to one canonical review decision. The full loaded
 * population is required because a copied leg is intentionally born unreviewed
 * while its base representative owns the decision verdict.
 */
export function reviewRepresentativesForVisibleTrades(
  allTrades: Trade[],
  visibleTrades: Trade[],
  rows: ReviewRepresentativeRow[],
): Trade[] {
  const loadedDecisionKeys = new Set(allTrades.map((trade) => legBaseKey(trade)));
  const visibleDecisionKeys = new Set(visibleTrades.map((trade) => legBaseKey(trade)));
  return rows
    .filter((row) => loadedDecisionKeys.has(row.key) && visibleDecisionKeys.has(row.key))
    .map((row) => row.rep);
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
  const selectedStrategies = strategiesOf(t);
  const checks: ReviewCheck[] = [
    { key: "setup", label: selectedStrategies.length > 1 ? "Choose one strategy" : "Strategy", required: true, done: hasSingleStrategy(t) },
    { key: "rating", label: "Rating", required: true, done: hasValidRating(t) },
    { key: "psychology", label: "Psychology state", required: true, done: (t.psychology_tags?.some(hasText) ?? false) || t.psychologyAcknowledged === true },
    { key: "mistakes", label: "Execution mistakes", required: true, done: (t.mistake_tags?.some(hasText) ?? false) || t.mistakesAcknowledged === true },
    { key: "whatHappened", label: "What happened", required: true, done: !!t.review_what_happened?.trim() },
    { key: "repeatChange", label: "Repeat or change", required: true, done: !!t.review_repeat_change?.trim() },
    { key: "print", label: "Screenshot", required: false, done: hasPrint(t) },
    { key: "review", label: "Earlier notes", required: false, done: hasText(t.notes) || hasText(t.review) || hasText(t.thesis) || hasText(t.mistake) },
    { key: "exitReason", label: "Exit reason", required: false, done: !!t.exit_reason },
  ];
  const requiredChecks = checks.filter((check) => check.required);
  const conditionalChecks: ConditionalReviewCheck[] = [];
  const hasPlanSnapshot = [t.review_planned_entry, t.review_planned_stop, t.review_planned_target, t.review_planned_quantity]
    .some((value) => typeof value === "number" && Number.isFinite(value));
  if (hasPlanSnapshot) {
    conditionalChecks.push({
      key: "planAdherence",
      label: "Plan adherence",
      required: false,
      done: t.review_plan_adherence === "followed" || t.review_plan_adherence === "changed" || t.review_plan_adherence === "not-recorded",
    });
  }
  const requiredDone = requiredChecks.filter((c) => c.done).length;
  const done = checks.filter((c) => c.done).length;
  const requiredTotal = requiredChecks.length;
  const total = checks.length;
  const missing = requiredChecks.filter((c) => !c.done).map((c) => c.label);
  const conditionalMissing = conditionalChecks.filter((c) => !c.done).map((c) => c.label);
  const humanCoreComplete = requiredDone === requiredTotal;
  const legacyChecks: ReviewCheck[] = [
    { key: "print", label: "Screenshot", required: false, done: hasPrint(t) },
    { key: "setup", label: "Strategy", required: false, done: hasText(t.setup) },
    { key: "review", label: "Earlier notes", required: false, done: hasText(t.notes) || hasText(t.review) || hasText(t.thesis) || hasText(t.mistake) },
    { key: "rating", label: "Rating", required: false, done: (t.rating ?? 0) > 0 },
  ];
  const legacyWrittenUp = legacyChecks.every((c) => c.done);
  const humanEvidence = t.review_context_unavailable === true || hasText(t.setup) || (t.rating ?? 0) > 0 || (t.psychology_tags?.length ?? 0) > 0 ||
    (t.mistake_tags?.length ?? 0) > 0 || t.psychologyAcknowledged === true || t.mistakesAcknowledged === true ||
    hasText(t.review_plan) || [t.review_planned_entry, t.review_planned_stop, t.review_planned_target, t.review_planned_quantity]
      .some((value) => typeof value === "number" && Number.isFinite(value)) || hasText(t.review_what_happened) || hasText(t.review_repeat_change) ||
    hasText(t.review_post_exit_observation) || typeof t.review_post_exit_points === "number" || hasText(t.notes) ||
    hasText(t.review) || hasText(t.thesis) || hasText(t.mistake) || t.review_plan_adherence !== undefined;
  const evidence: ReviewStatus["evidence"] = t.reviewed === false
    ? "reopened"
    : humanEvidence
    ? "exists"
    : t.reviewed === true && t.review_evidence_source === "human"
    ? "exists"
    : t.reviewed === true
    ? "legacy-marked-reviewed"
    : "none";
  const explicitlyReopened = t.reviewed === false;
  const complete = !explicitlyReopened && (humanCoreComplete || t.reviewed === true);
  const state: ReviewState = explicitlyReopened
    ? "reopened"
    : humanCoreComplete
    ? t.review_context_unavailable === true ? "reviewed-with-missing-context" : "reviewed"
    : t.reviewed === true
    ? "legacy-marked-reviewed"
    : "needs-review";
  const labels: Record<ReviewState, string> = {
    "needs-review": "Needs review",
    reviewed: "Reviewed",
    "reviewed-with-missing-context": "Reviewed with missing context",
    "legacy-marked-reviewed": "Explicitly marked reviewed",
    reopened: "Review reopened",
  };
  // Only the two written reflection prompts feed the Dashboard's distinct
  // "written up" metric; the six completion signals remain the review gate.
  const writtenUp = !!t.review_what_happened?.trim() && !!t.review_repeat_change?.trim();
  return {
    evidence,
    state,
    checks,
    requiredDone,
    requiredTotal,
    conditionalChecks,
    conditionalMissing,
    done,
    total,
    humanCoreComplete,
    legacyWrittenUp,
    complete,
    writtenUp,
    needsPrint: !hasPrint(t),
    unreviewed: !complete,
    missing,
    label: labels[state],
    optionalSummary: optionalSummary(t),
  };
}

export type ReviewFilter = "all" | "pending" | "complete" | "explicit";

/** Trade Log review filters use the same canonical review state as every view. */
export function matchesReviewFilter(t: Trade, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  const status = reviewStatus(t);
  if (filter === "pending") return !status.complete;
  if (filter === "explicit") return status.state === "legacy-marked-reviewed";
  return status.state === "reviewed" || status.state === "reviewed-with-missing-context";
}

/**
 * Aggregate review coverage across a trade list — the one number the coverage
 * ring shows, plus how many of those were actually written up. The written-up
 * count is not a second headline: it is only ever read by a tooltip.
 */
export function reviewSummary(trades: Trade[]): {
  total: number;
  evidence: number;
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
  let evidence = 0;
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
    if (s.evidence === "exists") evidence++;
    if (s.complete) complete++;
    if (s.writtenUp) writtenUp++;
    if (!s.needsPrint) withPrint++; else missingPrint++;
    if (s.unreviewed) unreviewed++;
    if (!done("setup")) noSetup++;
    if (!done("whatHappened") || !done("repeatChange")) noReview++;
    const ratingValid = typeof t.rating === "number" && Number.isInteger(t.rating) && t.rating >= 1 && t.rating <= 5;
    if (!ratingValid) noRating++;
  }
  return {
    total,
    evidence,
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
  window.__tjReview = { hasText, reviewStatus, reviewSummary, optionalSummary, parsePlannedNumber };
}
