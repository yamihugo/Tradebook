/**
 * Maturity / phase engine.
 *
 * The app adapts to the trader — it never locks features away. This module only
 * MEASURES, producing a 0–100 score and a phase (starter / intermediate /
 * established). Layouts, defaults and guidance read this; nothing is hidden.
 *
 * Principle — declared + evidence:
 *   Early on we trust what the user told us (three onboarding questions).
 *   As data accumulates we trust what they actually do — but the declared
 *   answers never lose all their weight, so they still move the score on a
 *   full journal.
 *
 *     evidenceWeight = 0.20 + 0.50 × min(1, trades / 100)   → 0.20 … 0.70
 *     score = evidence × evidenceWeight + declared × (1 − evidenceWeight)
 *
 * Why not a simple "N accounts OR M trades" rule: accounts are a consequence of
 * capital strategy, not of skill — ten fresh evals is a beginner signal, not a
 * pro one. So accounts/firms only feed a LOW-weighted "operational complexity"
 * dimension, and every signal is saturated (10 accounts never counts for more
 * than 6).
 */

export type Phase = "starter" | "intermediate" | "established";
export type Experience = "lt6m" | "6to24m" | "2to5y" | "gt5y";
export type Journaling = "starting" | "consistent" | "advanced";
export type ActiveAccounts = "one" | "few" | "many";

export interface MaturityInput {
  // Volume — how much history exists.
  trades: number;
  activeDays: number;
  journalAgeDays: number;
  // Operational complexity (deliberately the lowest weight).
  accounts: number;
  firms: number;
  copyGroups: number;
  copyAccounts: number;
  payouts: number;
  // Process maturity — is the journal actually used?
  stopPct: number; // % of trades with a stop defined
  setupPct: number; // % with a setup tag
  reviewPct: number; // % with the review complete
  ratingPct: number; // % with an execution rating
  // Risk discipline.
  breachCount: number; // accounts that hit their max drawdown
  avgRiskPct: number; // avg risk per trade as % of the account max loss
  // Declared (three optional onboarding answers).
  exp?: Experience;
  journaling?: Journaling;
  activeAccounts?: ActiveAccounts;
  groupTrading?: boolean;
}

export interface MaturityParts {
  volume: number;
  process: number;
  risk: number;
  complexity: number;
  declared: number;
}

export interface MaturityScore {
  score: number; // 0–100
  phase: Phase;
  evidenceWeight: number; // 0–1
  parts: MaturityParts;
  flags: string[];
  computedAt: string; // ISO date
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const sat = (v: number, max: number) => clamp01((Number.isFinite(v) ? v : 0) / max);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const EXPERIENCE_SCORE: Record<Experience, number> = { lt6m: 0.15, "6to24m": 0.45, "2to5y": 0.75, gt5y: 1 };
const JOURNALING_SCORE: Record<Journaling, number> = { starting: 0.2, consistent: 0.5, advanced: 0.85 };

/** Weights of the four evidence dimensions (sum = 1). */
export const DIMENSION_WEIGHTS = { volume: 0.25, process: 0.35, risk: 0.25, complexity: 0.15 };

export const PHASE_BANDS: { starter: number; intermediate: number } = { starter: 33, intermediate: 66 };

/**
 * How much concrete behaviour counts vs. the declared answers.
 *   0 trades   → 20% behaviour (the answers dominate)
 *   100+ trades → 70% behaviour (the answers still carry 30%)
 * The declared share never drops below 30%, so the onboarding answers keep
 * moving the score even on a mature journal.
 */
export const EVIDENCE_MIN = 0.2;
export const EVIDENCE_MAX = 0.7;

export const PHASE_INFO: Record<Phase, { label: string; layout: string; emphasis: string; guidance: string }> = {
  starter: {
    label: "Starter",
    layout: "Health ring + checklist first, then compact cards",
    emphasis: "Safety and the basics — P&L, win rate, rules",
    guidance: "One new concept at a time",
  },
  intermediate: {
    label: "Intermediate",
    layout: "Account cards (square), group sections",
    emphasis: "Process and consistency — drawdown, expectancy, reviews",
    guidance: "Nudges when a habit slips",
  },
  established: {
    label: "Established",
    layout: "Compact rows as the landing view, deck for big groups",
    emphasis: "Risk-adjusted performance — R-multiples, DD episodes, copy groups",
    guidance: "Alerts, not tutorials",
  },
};

function declaredScore(s: MaturityInput): number {
  const exp = s.exp ? EXPERIENCE_SCORE[s.exp] : 0.35;
  const jrn = s.journaling ? JOURNALING_SCORE[s.journaling] : 0.35;
  const grp = s.groupTrading ? 1 : 0.5;
  return avg([exp, jrn]) * 0.85 + grp * 0.15;
}

function phaseFor(score: number): Phase {
  if (score < PHASE_BANDS.starter) return "starter";
  if (score < PHASE_BANDS.intermediate) return "intermediate";
  return "established";
}

export function computeMaturity(s: MaturityInput): MaturityScore {
  const volume = avg([sat(s.trades, 300), sat(s.activeDays, 60), sat(s.journalAgeDays, 180)]);

  const process = avg([
    clamp01(s.stopPct / 100),
    sat(s.setupPct, 70),
    clamp01(s.reviewPct / 100),
    sat(s.ratingPct, 70),
  ]);

  const risk = avg([
    1 - sat(s.breachCount, Math.max(1, s.accounts)),
    1 - sat(s.avgRiskPct, 2),
  ]);

  const complexity = avg([
    sat(s.accounts, 10),
    sat(s.firms, 4),
    sat(s.copyGroups, 2),
    sat(s.payouts, 3),
  ]);

  const evidence = volume * DIMENSION_WEIGHTS.volume
    + process * DIMENSION_WEIGHTS.process
    + risk * DIMENSION_WEIGHTS.risk
    + complexity * DIMENSION_WEIGHTS.complexity;

  const declared = declaredScore(s);
  const evidenceWeight = EVIDENCE_MIN + (EVIDENCE_MAX - EVIDENCE_MIN) * sat(s.trades, 100);
  const score = Math.round((evidence * evidenceWeight + declared * (1 - evidenceWeight)) * 100);

  const flags: string[] = [];
  if (s.accounts >= 6 && (s.trades < 60 || s.exp === "lt6m")) flags.push("over-leveraged");
  if (s.trades >= 20 && s.stopPct < 50) flags.push("no-stops");
  if (s.trades >= 30 && s.reviewPct < 25) flags.push("no-reviews");
  if (s.breachCount > 0) flags.push("dd-breached");
  const experienced = s.exp === "6to24m" || s.exp === "2to5y" || s.exp === "gt5y";
  if (experienced && s.trades >= 20 && process < 0.4) flags.push("process-lagging");

  return {
    score,
    phase: phaseFor(score),
    evidenceWeight: Math.round(evidenceWeight * 100) / 100,
    parts: { volume, process, risk, complexity, declared },
    flags,
    computedAt: new Date().toISOString().slice(0, 10),
  };
}
