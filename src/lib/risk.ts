import { Trade } from "../types";
import { knownFuturesSpec } from "../futures";

/**
 * A risk the trader sets once for a contract, used when the file does not say.
 *
 * The journal reports; it never invents. This is the one place where a number
 * that nobody filed can stand in for a missing one, and it says so: the stop it
 * produces is written with `stopSource: "assumed"`, the Detail calls it *Risk
 * assumed*, and it is only ever applied where the import found no initial risk
 * to work from.
 */
export interface RiskRule {
  /** Distance from the entry, in the contract's own points. */
  points?: number;
  /** Money at risk on the trade, whatever the size — $200 is $200 on an NQ or
   *  on ten MNQ. Converted to points through the contract's point value. */
  dollars?: number;
}

/** By contract root: `NQ`, `MNQ`, `ES`… The mini and the micro are separate
 *  rules, because ten points is not the same risk on either. */
export type RiskRules = Record<string, RiskRule>;

/**
 * The money a trade actually risked, from its own entry and stop — or null when
 * there is nothing honest to measure: a stop the journal does not hold, a
 * contract it cannot price, or a stop on the wrong side of the entry. One rule
 * for every R (the ledger, Avg R, the score), so a made-up $1-a-point fallback
 * can never leak into a ratio that is shown as a fact.
 */
export function recordedRisk(trade: Trade): number | null {
  if (trade.direction !== "long" && trade.direction !== "short") return null;
  const spec = knownFuturesSpec(trade.symbol || "");
  const entry = Number(trade.entryPrice);
  const stop = Number(trade.stopLoss);
  const qty = Number(trade.quantity);
  if (!spec || !Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(stop) || stop <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (trade.direction === "long" ? stop >= entry : stop <= entry) return null;
  const risk = Math.abs(entry - stop) * spec.pointValue * qty;
  return risk > 0 ? risk : null;
}

/**
 * The stop this rule implies for a trade, or null when it implies nothing.
 *
 * Refuses in three cases, and each refusal is a real one:
 * - the trade already carries an initial risk — a rule never overwrites a fact;
 * - there is no entry price to measure the risk from;
 * - the rule is empty or non-positive, or the contract is one the journal does
 *   not price (a $1-a-point fallback would be a made-up number).
 */
export function assumedStop(trade: Trade, rules: RiskRules | undefined): number | null {
  const rule = rules?.[(trade.symbol || "").trim().toUpperCase()];
  if (!rule) return null;
  // A stop the platform filed is a fact about the trade, and a rule is a
  // stand-in: a stand-in does not get to overwrite a fact. Note this is about
  // the *risk* being recorded, not about where it came from — a trade whose
  // only level in the file sits at break-even has a broker stop and no risk at
  // all, and that is the gap a rule is allowed to fill.
  if (trade.stopLoss && trade.stopLoss > 0) return null;
  const entry = trade.entryPrice;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  // A contract the journal cannot price has no honest dollar conversion, and a
  // stand-in stop built on a made-up $1 a point would be the same wrong number
  // the import warns about.
  const spec = knownFuturesSpec(trade.symbol || "");
  if (!spec) return null;
  let points = 0;
  if (Number.isFinite(rule.points) && (rule.points as number) > 0) {
    points = rule.points as number;
  } else if (Number.isFinite(rule.dollars) && (rule.dollars as number) > 0) {
    const qty = Number.isFinite(trade.quantity) && trade.quantity > 0 ? trade.quantity : 1;
    if (spec.pointValue <= 0) return null;
    points = (rule.dollars as number) / (spec.pointValue * qty);
  }
  if (!Number.isFinite(points) || points <= 0) return null;

  const stop = trade.direction === "short" ? entry + points : entry - points;
  return Number.isFinite(stop) && stop > 0 ? stop : null;
}

export interface AssumedRiskResult {
  /** Trades that now carry a rule's stop. */
  applied: number;
  /** Trades the rule left alone because a real stop was already there. */
  keptRecorded: number;
  /** Contracts in the file with no rule set. */
  withoutRule: string[];
  /** Trades left without any risk, because their contract has no rule. */
  withoutRuleCount: number;
}

/**
 * Applies the rules to the trades about to be written. Mutates in place — the
 * caller holds the parsed trades and writes them right after — and returns what
 * it did, so the reader can be told rather than left to notice an R appearing.
 */
export function applyAssumedRisk(trades: Trade[], rules: RiskRules | undefined): AssumedRiskResult {
  const withoutRule = new Set<string>();
  let applied = 0;
  let keptRecorded = 0;
  let withoutRuleCount = 0;
  for (const trade of trades) {
    const stop = assumedStop(trade, rules);
    if (stop !== null) {
      trade.stopLoss = stop;
      // The levels the broker filed stay untouched: the stop this rule produced
      // is beside them, not instead of them.
      trade.stopSource = "assumed";
      applied++;
      continue;
    }
    const symbol = (trade.symbol || "").trim().toUpperCase();
    if (trade.stopLoss && trade.stopLoss > 0) keptRecorded++;
    else if (!rules?.[symbol]) {
      withoutRule.add(symbol);
      withoutRuleCount++;
    }
  }
  return { applied, keptRecorded, withoutRule: [...withoutRule], withoutRuleCount };
}
