/**
 * Trading Score — the weighted radar, as a pure function.
 *
 * The maths used to live inline in the dashboard view, re-deriving risk,
 * profitability and review numbers that already existed elsewhere. It now
 * consumes the shared libraries (lib/process.ts, lib/money.ts) so the score can
 * never drift from the account page or the widgets.
 *
 * Classification is by the gross sign of `t.pnl`; the money basis is fixed in
 * Build 2 (see docs/ARCHITECTURE.md). The colour band is returned as a semantic
 * key, not a hex value — the view maps it to a tone token.
 */

import type { Trade } from "../types";
import { futuresSpec } from "../futures";
import { computeProcessSignals } from "./process";
import { moneyStats } from "./money";

export interface ScoreAxis {
  id: string;
  label: string;
  weight: number;
  value: number;
}

export type ScoreBand = "bad" | "low" | "mid" | "good" | "top";

/**
 * Band → tone token. Five semantic levels collapse onto the three tokens the
 * design system ships: bad/low → bad, mid → mid, good/top → good.
 */
export const SCORE_BAND_TOKEN: Record<ScoreBand, string> = {
  bad: "var(--tj-tone-bad)",
  low: "var(--tj-tone-bad)",
  mid: "var(--tj-tone-mid)",
  good: "var(--tj-tone-good)",
  top: "var(--tj-tone-good)",
};

export interface ScoreResult {
  axes: ScoreAxis[];
  /** Weighted composite, 0..100. */
  score: number;
  band: ScoreBand;
  phase: "Developing" | "Established";
  /** False until there is enough history; the view draws the progress ring. */
  unlocked: boolean;
  progress: {
    weeksActive: number;
    weeksNeeded: number;
    tradeCount: number;
    tradesNeeded: number;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** ISO week key for a `YYYY-MM-DD` date, so "weeks active" is stable. */
function weekKey(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  const date = new Date(Date.UTC(y || 2020, (m || 1) - 1, d || 1));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((date.getTime() - ys.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${wn}`;
}

/** Daily P&L (gross), grouped by the caller's day key. */
function dayStats(
  trades: Trade[],
  dayKey: (t: Trade) => string
): { dayCount: number; posDays: number; cv: number } {
  const map = new Map<string, number>();
  for (const t of trades) map.set(dayKey(t), (map.get(dayKey(t)) ?? 0) + t.pnl);
  const values = [...map.values()];
  const posDays = values.filter((v) => v > 0).length;
  const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1));
  const cv = Math.abs(mean) > 1e-9 ? sd / Math.abs(mean) : 2;
  return { dayCount: map.size, posDays, cv };
}

/** Average R of losing trades (loss size over the risk that was taken). */
function avgLossR(trades: Trade[]): number {
  let lossR = 0;
  let lossRn = 0;
  for (const t of trades) {
    if (t.pnl >= 0) continue;
    if ((t.stopLoss ?? 0) > 0 && t.entryPrice) {
      const spec = futuresSpec(t.symbol || "NQ");
      const riskMoney = Math.abs(t.entryPrice - (t.stopLoss as number)) * spec.pointValue * (t.quantity || 1);
      if (riskMoney > 0) {
        lossR += Math.abs(t.pnl) / riskMoney;
        lossRn++;
      }
    }
  }
  return lossRn ? lossR / lossRn : 0;
}

export function computeScore(trades: Trade[], dayKey: (t: Trade) => string): ScoreResult {
  const count = trades.length;
  const process = computeProcessSignals(trades, dayKey);
  const money = moneyStats(trades, dayKey);
  // Build 1 preserves the current gross profitability factor; Build 2 flips it.
  const pf = money.grossLoss > 0 ? money.grossWin / money.grossLoss : money.grossWin > 0 ? 5 : 0;

  const weeksActive = new Set(trades.map((t) => weekKey(t.date))).size;
  const days = dayStats(trades, dayKey);

  const stopDefined = process.stopDefinedPct / 100;
  const mistakeRate = process.mistakeRate / 100;
  const reviewedRate = process.reviewCompletePct / 100;
  const lossR = avgLossR(trades);

  const axes: ScoreAxis[] = [
    {
      id: "risk",
      label: "Risk Management",
      weight: 0.25,
      value: clamp(100 * (0.5 * stopDefined + 0.5 * (1 - Math.min(1, lossR / 2.5))), 0, 100),
    },
    { id: "profitability", label: "Profitability", weight: 0.2, value: clamp(((pf - 1) / 2) * 100, 0, 100) },
    {
      id: "execution",
      label: "Execution",
      weight: 0.15,
      value: clamp(100 * (0.6 * (1 - mistakeRate) + 0.4 * reviewedRate), 0, 100),
    },
    { id: "return-consistency", label: "Return Consistency", weight: 0.1, value: clamp(100 - days.cv * 100, 0, 100) },
    { id: "consistency", label: "Consistency", weight: 0.15, value: clamp((days.posDays / (days.dayCount || 1)) * 100, 0, 100) },
    { id: "experience", label: "Experience", weight: 0.15, value: clamp(weeksActive * 8 + count * 0.4, 0, 100) },
  ];

  const score = axes.reduce((s, a) => s + a.value * a.weight, 0);
  const band: ScoreBand =
    score < 30 ? "bad" : score < 50 ? "low" : score < 70 ? "mid" : score < 90 ? "good" : "top";

  return {
    axes,
    score,
    band,
    phase: weeksActive < 8 ? "Developing" : "Established",
    unlocked: !(weeksActive < 4 || count < 5),
    progress: { weeksActive, weeksNeeded: 4, tradeCount: count, tradesNeeded: 5 },
  };
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  (window as any).__tjScore = { computeScore };
}
