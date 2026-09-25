/**
 * Financial helpers. Legacy API callers retain their documented account/risk
 * units; migrated portfolio consumers use the explicit Gross/Net summary below.
 * Gross and Net factors always classify and sum the same monetary basis.
 * Pure: no DOM, no plugin.
 *
 * THE PRODUCT-WIDE RESULT CONTRACT (docs/UX-GUIDELINES.md §0 contract block):
 *
 *   An unqualified win / loss / breakeven is the sign of the NET result of a
 *   logical decision, aggregated across the in-scope account legs. Win Rate,
 *   Profit Factor and every "win"/"loss" count therefore agree with Net P&L by
 *   construction; Gross remains available only under an explicit "Gross" name.
 *
 *   Classification happens ONCE, after the legs of a decision are summed — so a
 *   decision that wins on Gross but loses once fees are recorded is a loss, and
 *   a Net-breakeven decision is excluded from the Win Rate denominator.
 */

import type { Trade } from "../types";
import { netPnl } from "./fees";
import { fillSet } from "./fills";
import { isLeg, logicalDecisionKey } from "./copy";

/** What "a day" is. Injected so the timezone logic stays with the caller. */
export type DayKey = (t: Trade) => string;
const dateKey: DayKey = (t) => t.date;

/** Trades with a finite result and a date — the same scope every metric uses. */
function scoped(trades: Trade[]): Trade[] {
  return trades.filter((t) => Number.isFinite(t.pnl) && !!t.date);
}
function wins(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.pnl > 0);
}
function losses(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.pnl < 0);
}
function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

/** Net dollars made/lost across the list (gross minus costs). */
export function netTotal(trades: Trade[]): number {
  return sum(scoped(trades).map(netPnl));
}

/** Gross dollars across the list, before costs. */
export function grossTotal(trades: Trade[]): number {
  return sum(scoped(trades).map((t) => t.pnl));
}

/** Positive Net results, classified by Net sign. */
export function netWins(trades: Trade[]): number {
  return sum(scoped(trades).map(netPnl).filter((value) => value > 0));
}

/** Absolute value of negative Net results, classified by Net sign. */
export function netLosses(trades: Trade[]): number {
  return Math.abs(sum(scoped(trades).map(netPnl).filter((value) => value < 0)));
}

/** Gross dollars from winning trades — a classification sum, not a result. */
export function grossWin(trades: Trade[]): number {
  return sum(wins(scoped(trades)).map((t) => t.pnl));
}

/** Gross dollars lost by losing trades, as a positive number. */
export function grossLoss(trades: Trade[]): number {
  return Math.abs(sum(losses(scoped(trades)).map((t) => t.pnl)));
}

/** Net profit factor: classify by net sign and sum that same net population. */
export function profitFactor(trades: Trade[]): number {
  const results = scoped(trades).map(netPnl);
  const gains = sum(results.filter((value) => value > 0));
  const losses = Math.abs(sum(results.filter((value) => value < 0)));
  return losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;
}

/** Gross profit factor: classify and sum the same pre-cost results. */
export function grossProfitFactor(trades: Trade[]): number {
  const results = scoped(trades).map((trade) => trade.pnl);
  const gains = sum(results.filter((value) => value > 0));
  const losses = Math.abs(sum(results.filter((value) => value < 0)));
  return losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;
}

/** Largest single eligible account-leg result before recorded costs. */
export function largestGrossWin(trades: Trade[]): number {
  const values = trades.map((trade) => tradeMoney(trade, "gross")?.value).filter((value): value is number => value !== undefined);
  const largest = values.length ? Math.max(...values) : 0;
  return largest > 0 ? largest : 0;
}

/** Largest single eligible account-leg loss before recorded costs. */
export function largestGrossLoss(trades: Trade[]): number {
  const values = trades.map((trade) => tradeMoney(trade, "gross")?.value).filter((value): value is number => value !== undefined);
  const largest = values.length ? Math.min(...values) : 0;
  return largest < 0 ? largest : 0;
}

/** Largest single eligible account-leg result after recorded costs. */
export function largestNetWin(trades: Trade[]): number {
  const values = trades.map((trade) => tradeMoney(trade, "net")?.value).filter((value): value is number => value !== undefined);
  const largest = values.length ? Math.max(...values) : 0;
  return largest > 0 ? largest : 0;
}

/** Largest single eligible account-leg Net loss. */
export function largestNetLoss(trades: Trade[]): number {
  const values = trades.map((trade) => tradeMoney(trade, "net")?.value).filter((value): value is number => value !== undefined);
  const largest = values.length ? Math.min(...values) : 0;
  return largest < 0 ? largest : 0;
}

/** Net P&L grouped by the caller's trading-day convention. */
export function netByDay(trades: Trade[], dayKey: DayKey = dateKey): Map<string, number> {
  const days = new Map<string, number>();
  for (const t of scoped(trades)) days.set(dayKey(t), (days.get(dayKey(t)) ?? 0) + netPnl(t));
  return days;
}

/** Net dollars per recorded trade; gross-breakeven decisions remain in the denominator. */
export function expectancy(trades: Trade[]): number {
  const population = scoped(trades);
  return population.length ? netTotal(population) / population.length : 0;
}

/** Average positive Net result per trade. */
export function avgWin(trades: Trade[]): number {
  const results = scoped(trades).map(netPnl).filter((value) => value > 0);
  return results.length ? sum(results) / results.length : 0;
}

/** Average Net loss per trade, as a positive number. */
export function avgLoss(trades: Trade[]): number {
  const results = scoped(trades).map(netPnl).filter((value) => value < 0);
  return results.length ? Math.abs(sum(results)) / results.length : 0;
}

/** The single best trade by net, or 0 when nothing made money. */
export function largestWin(trades: Trade[]): number {
  const xs = scoped(trades).map(netPnl);
  const v = xs.length ? Math.max(...xs) : 0;
  return v > 0 ? v : 0;
}

/** The single worst trade by net, or 0 when nothing lost money. */
export function largestLoss(trades: Trade[]): number {
  const xs = scoped(trades).map(netPnl);
  const v = xs.length ? Math.min(...xs) : 0;
  return v < 0 ? v : 0;
}

/** Net P&L of the best day (grouped by the injected day key). */
export function bestDay(trades: Trade[], dayKey: DayKey = dateKey): number {
  const days = netByDay(trades, dayKey);
  return days.size ? Math.max(...days.values()) : 0;
}

/** Net P&L of the worst day (grouped by the injected day key). */
export function worstDay(trades: Trade[], dayKey: DayKey = dateKey): number {
  const days = netByDay(trades, dayKey);
  return days.size ? Math.min(...days.values()) : 0;
}

/** Everything at once, for widgets that need several fields. */
export interface MoneyStats {
  net: number;
  gross: number;
  netWins: number;
  netLosses: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  bestDay: number;
  worstDay: number;
}

export function moneyStats(trades: Trade[], dayKey: DayKey = dateKey): MoneyStats {
  return {
    net: netTotal(trades),
    gross: grossTotal(trades),
    netWins: netWins(trades),
    netLosses: netLosses(trades),
    grossWin: grossWin(trades),
    grossLoss: grossLoss(trades),
    profitFactor: profitFactor(trades),
    expectancy: expectancy(trades),
    avgWin: avgWin(trades),
    avgLoss: avgLoss(trades),
    largestWin: largestWin(trades),
    largestLoss: largestLoss(trades),
    bestDay: bestDay(trades, dayKey),
    worstDay: worstDay(trades, dayKey),
  };
}

// ---------------------------------------------------------------------------
// Explicit financial foundation. New/migrated consumers use these basis-bound
// primitives rather than inferring a basis from the legacy helper names.

export type MoneyBasis = "gross" | "net";

export interface FinancialScope {
  /** Scope before aggregation. Resolve stored account labels to stable account ids. */
  kind: "all-included-accounts" | "selected-account";
  accountIdOf: (trade: Trade) => string | null;
  /** Active/type/demo/archive policy, prepared by the caller. */
  includedAccountIds: ReadonlySet<string>;
  /** Required for `selected-account`; it must also be in `includedAccountIds`. */
  accountId?: string;
}

export interface CostCoverage {
  commission: boolean;
  fees: boolean;
}

export interface TradeMoney {
  basis: MoneyBasis;
  value: number;
  gross: number;
  net: number;
  costCoverage: CostCoverage;
}

export interface DecisionMoney {
  /** Null when no durable copy key or trade id was supplied. */
  key: string | null;
  gross: number;
  net: number;
  legCount: number;
  costCoverageComplete: boolean;
  /** One in-scope leg standing for the decision — the logical trade to show. */
  representative: Trade;
}

export interface BasisAggregate {
  total: number;
  /** Numerator and denominator both use the logical decisions below. */
  averagePerDecision: number | null;
  /** Separate account-leg average; never describe it as per decision. */
  averagePerAccountLeg: number | null;
  /** Profit factor over decisions classified by this same monetary basis. */
  profitFactor: number;
  /**
   * Positive ÷ decided decisions on this basis — the canonical Win Rate.
   * Net-basis value is the product contract; breakevens stay out of the
   * denominator. `null` when nothing decided (never a misleading 0%).
   */
  winRate: number | null;
  /** Average positive/negative result per decision, classified on this basis. */
  averageWinPerDecision: number | null;
  averageLossPerDecision: number | null;
  positiveDecisionCount: number;
  negativeDecisionCount: number;
  breakevenDecisionCount: number;
  positiveAccountLegCount: number;
  negativeAccountLegCount: number;
  breakevenAccountLegCount: number;
  /** Monetary results from eligible in-scope legs, by the injected day key. */
  byDay: Map<string, number>;
}

export interface FinancialSummary {
  scope: { kind: FinancialScope["kind"]; accountId?: string; includedAccountCount: number };
  eligibleLegCount: number;
  decisionCount: number;
  /** Repeated ids or a second row for the same decision/account collapsed. */
  duplicateLegCount: number;
  /** Eligible rows lacking a safe logical-decision key; kept separate, not guessed together. */
  unidentifiedLegCount: number;
  decisions: DecisionMoney[];
  /** The same decisions as rows to show — one representative per decision. */
  logicalTrades: Trade[];
  /** The eligible in-scope account legs behind the money — the capital moved. */
  eligibleLegs: Trade[];
  /** Logical-decision counts classified by NET result, by the same journal day key. */
  decisionsByDay: Map<string, { count: number; wins: number; losses: number; breakeven: number }>;
  gross: BasisAggregate;
  net: BasisAggregate;
  costCoverage: {
    completeLegs: number;
    missingCommission: number;
    missingFees: number;
    completeDecisions: number;
  };
}

interface FinancialLeg {
  trade: Trade;
  accountId: string;
  decisionGroup: string;
  stableDecisionKey: string | null;
  money: TradeMoney;
}

const finiteMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!m) return false;
  const y = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const d = new Date(0);
  d.setUTCFullYear(y, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function validClock(value: unknown): boolean {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
  if (!m) return false;
  const h = Number(m[1]), min = Number(m[2]), sec = Number(m[3] ?? "0");
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 && sec >= 0 && sec <= 59;
}

/**
 * The trade schema has no open/closed status. Scalar records need an exit price
 * or valid exit time; explicit fills need an exit and no remaining quantity.
 */
export function isEligibleFinancialLeg(trade: Trade): boolean {
  if (!trade || typeof trade !== "object" || !finiteMoney(trade.pnl) || !validIsoDate(trade.date)) return false;
  if (!String(trade.symbol ?? "").trim() || !finiteMoney(trade.quantity) || trade.quantity <= 0) return false;
  if (trade.direction !== "long" && trade.direction !== "short") return false;
  if (trade.fills !== undefined && trade.fills !== null && !Array.isArray(trade.fills)) return false;
  const rawFills = Array.isArray(trade.fills) ? trade.fills : [];
  if (rawFills.some((fill) =>
    !fill || (fill.side !== "buy" && fill.side !== "sell") ||
    !finiteMoney(fill.qty) || fill.qty <= 0 || !finiteMoney(fill.price)
  )) return false;
  const fills = fillSet(trade);
  if (fills.explicit) return fills.exits.length > 0 && fills.openQty === 0;
  return (finiteMoney(trade.exitPrice) && trade.exitPrice > 0) || validClock(trade.exitTime);
}

/**
 * Presence flags come from Markdown parsing. Without those flags, nonzero finite
 * costs are known; zero is ambiguous because defaults and the Markdown writer
 * both omit zero-valued fields. Legacy parsed notes with missing costs explicitly
 * carry `false`, rather than implying a confirmed zero.
 */
export function tradeCostCoverage(trade: Trade): CostCoverage {
  const metadata = trade.costCoverage;
  return {
    commission: metadata
      ? metadata.commission === true && finiteMoney(trade.commission)
      : finiteMoney(trade.commission) && trade.commission !== 0,
    fees: metadata
      ? metadata.fees === true && finiteMoney(trade.fees)
      : finiteMoney(trade.fees) && trade.fees !== 0,
  };
}

/** Explicit Gross/Net result for one eligible leg. FeeAdjustment is not input. */
export function tradeMoney(trade: Trade, basis: MoneyBasis): TradeMoney | null {
  if (!isEligibleFinancialLeg(trade)) return null;
  const costCoverage = tradeCostCoverage(trade);
  const costsForCalculation = {
    ...trade,
    commission: costCoverage.commission ? trade.commission : 0,
    fees: costCoverage.fees ? trade.fees : 0,
  };
  const gross = trade.pnl;
  const net = netPnl(costsForCalculation);
  return { basis, value: basis === "gross" ? gross : net, gross, net, costCoverage };
}

function decisionIdentity(trade: Trade, inputIndex: number): { group: string; stable: string | null } {
  // Do not use tradeKey's content fallback here: unrelated same-minute trades
  // can share it. With no stable decision identity, each row stays separate.
  const stable = logicalDecisionKey(trade);
  if (isLeg(trade) && !stable) {
    // The note id identifies this leg, not the base decision or its siblings.
    return { group: `unidentified-copy:${String(trade.id ?? "").trim() || inputIndex}`, stable: null };
  }
  return stable ? { group: stable, stable } : { group: `unidentified:${inputIndex}`, stable: null };
}

/** Materialized/imported rows win over virtual/generated copies of that leg. */
function duplicatePreference(trade: Trade): number {
  const virtual = (trade as Trade & { copyVirtual?: boolean }).copyVirtual === true;
  return (virtual ? 0 : 10) + (trade.copyOrigin === "imported" ? 2 : 0) + (trade.isCopiedTrade ? 0 : 1);
}

function financialPopulation(trades: Trade[], scope: FinancialScope): { legs: FinancialLeg[]; duplicates: number; unidentified: number } {
  const allowed = scope.includedAccountIds;
  const selected = scope.kind === "selected-account" ? scope.accountId : undefined;
  if (scope.kind === "selected-account" && (!selected || !allowed.has(selected))) {
    return { legs: [], duplicates: 0, unidentified: 0 };
  }

  const byDecisionAccount = new Map<string, FinancialLeg>();
  const seenIds = new Set<string>();
  const seenReferences = new WeakSet<object>();
  let duplicates = 0;
  let unidentified = 0;

  const source = Array.isArray(trades) ? trades : [];
  source.forEach((trade, inputIndex) => {
    if (!trade || typeof trade !== "object") return;
    // Scope filtering deliberately precedes eligibility and every aggregation.
    const accountId = scope.accountIdOf(trade);
    if (!accountId || !allowed.has(accountId) || (selected && accountId !== selected)) return;
    if (!isEligibleFinancialLeg(trade)) return;

    const id = String(trade.id ?? "").trim();
    if (id && seenIds.has(id)) {
      duplicates++;
      return;
    }
    if (id) seenIds.add(id);
    else {
      if (seenReferences.has(trade as object)) {
        duplicates++;
        return;
      }
      seenReferences.add(trade as object);
    }

    const identity = decisionIdentity(trade, inputIndex);
    const money = tradeMoney(trade, "gross");
    if (!money) return;
    const leg: FinancialLeg = {
      trade,
      accountId,
      decisionGroup: identity.group,
      stableDecisionKey: identity.stable,
      money,
    };
    const key = `${identity.group}\u0000${accountId}`;
    const current = byDecisionAccount.get(key);
    if (!current) {
      byDecisionAccount.set(key, leg);
    } else {
      duplicates++;
      if (duplicatePreference(trade) > duplicatePreference(current.trade)) byDecisionAccount.set(key, leg);
    }
  });

  const legs = [...byDecisionAccount.values()];
  unidentified = legs.filter((leg) => leg.stableDecisionKey === null).length;
  return { legs, duplicates, unidentified };
}

/**
 * One shared population feeds both Gross and Net, decision and leg averages,
 * and day totals. `includedAccountIds` is prepared by the caller after applying
 * active/archive/type/demo rules; `accountIdOf` resolves the stored label.
 */
export function summarizeFinancials(
  trades: Trade[],
  options: { scope: FinancialScope; dayKey: (trade: Trade) => string }
): FinancialSummary {
  const population = financialPopulation(trades, options.scope);
  const groups = new Map<string, FinancialLeg[]>();
  const byDayGross = new Map<string, number>();
  const byDayNet = new Map<string, number>();
  let grossTotal = 0;
  let netTotalValue = 0;
  let completeLegs = 0;
  let missingCommission = 0;
  let missingFees = 0;

  for (const leg of population.legs) {
    const group = groups.get(leg.decisionGroup) ?? [];
    group.push(leg);
    groups.set(leg.decisionGroup, group);
    const money = tradeMoney(leg.trade, "net")!;
    grossTotal += money.gross;
    netTotalValue += money.net;
    if (money.costCoverage.commission && money.costCoverage.fees) completeLegs++;
    if (!money.costCoverage.commission) missingCommission++;
    if (!money.costCoverage.fees) missingFees++;
    const day = options.dayKey(leg.trade);
    if (typeof day === "string" && day) {
      byDayGross.set(day, (byDayGross.get(day) ?? 0) + money.gross);
      byDayNet.set(day, (byDayNet.get(day) ?? 0) + money.net);
    }
  }

  const decisions: DecisionMoney[] = [...groups.values()].map((legs) => {
    const gross = legs.reduce((sum, leg) => sum + leg.money.gross, 0);
    const net = legs.reduce((sum, leg) => sum + tradeMoney(leg.trade, "net")!.net, 0);
    // Stand the leader's leg forward when there is one: a copied decision is
    // shown through the trade the trader actually took, not a copier's row.
    const representative = legs.reduce(
      (best, leg) => (best.trade.isCopiedTrade && !leg.trade.isCopiedTrade ? leg : best),
      legs[0]
    ).trade;
    return {
      key: legs[0].stableDecisionKey,
      gross,
      net,
      legCount: legs.length,
      costCoverageComplete: legs.every((leg) => {
        const coverage = tradeCostCoverage(leg.trade);
        return coverage.commission && coverage.fees;
      }),
      representative,
    };
  });

  // Day buckets classify the same way the headline does: NET sign of the
  // aggregated decision, not the sign of its representative's Gross.
  const decisionsByDay = new Map<string, { count: number; wins: number; losses: number; breakeven: number }>();
  for (const legs of groups.values()) {
    const day = options.dayKey(legs[0].trade);
    if (!day) continue;
    const net = legs.reduce((sum, leg) => sum + tradeMoney(leg.trade, "net")!.net, 0);
    const bucket = decisionsByDay.get(day) ?? { count: 0, wins: 0, losses: 0, breakeven: 0 };
    bucket.count++;
    if (net > 0) bucket.wins++;
    else if (net < 0) bucket.losses++;
    else bucket.breakeven++;
    decisionsByDay.set(day, bucket);
  }

  const decisionCount = decisions.length;
  const eligibleLegCount = population.legs.length;
  const aggregate = (basis: MoneyBasis): BasisAggregate => {
    const total = basis === "gross" ? grossTotal : netTotalValue;
    const decisionResults = decisions.map((decision) => basis === "gross" ? decision.gross : decision.net);
    const winningDecisions = decisionResults.filter((value) => value > 0);
    const losingDecisions = decisionResults.filter((value) => value < 0);
    const legResults = population.legs.map((leg) => basis === "gross" ? leg.money.gross : tradeMoney(leg.trade, "net")!.net);
    const gains = winningDecisions.reduce((sum, value) => sum + value, 0);
    const losses = Math.abs(losingDecisions.reduce((sum, value) => sum + value, 0));
    const decided = winningDecisions.length + losingDecisions.length;
    return {
      total,
      averagePerDecision: decisionCount ? total / decisionCount : null,
      averagePerAccountLeg: eligibleLegCount ? total / eligibleLegCount : null,
      profitFactor: losses > 0 ? gains / losses : gains > 0 ? Infinity : 0,
      winRate: decided ? winningDecisions.length / decided : null,
      averageWinPerDecision: winningDecisions.length ? gains / winningDecisions.length : null,
      averageLossPerDecision: losingDecisions.length ? losses / losingDecisions.length : null,
      positiveDecisionCount: winningDecisions.length,
      negativeDecisionCount: losingDecisions.length,
      breakevenDecisionCount: decisionResults.length - winningDecisions.length - losingDecisions.length,
      positiveAccountLegCount: legResults.filter((value) => value > 0).length,
      negativeAccountLegCount: legResults.filter((value) => value < 0).length,
      breakevenAccountLegCount: legResults.filter((value) => value === 0).length,
      byDay: basis === "gross" ? byDayGross : byDayNet,
    };
  };

  const selected = options.scope.kind === "selected-account" ? options.scope.accountId : undefined;
  const byChronology = (a: Trade, b: Trade): number =>
    String(a.date ?? "").localeCompare(String(b.date ?? "")) ||
    String(a.entryTime ?? "").localeCompare(String(b.entryTime ?? ""));
  return {
    scope: {
      kind: options.scope.kind,
      accountId: selected,
      includedAccountCount: selected ? 1 : options.scope.includedAccountIds.size,
    },
    eligibleLegCount,
    decisionCount,
    duplicateLegCount: population.duplicates,
    unidentifiedLegCount: population.unidentified,
    decisions,
    logicalTrades: decisions.map((decision) => decision.representative).sort(byChronology),
    eligibleLegs: population.legs.map((leg) => leg.trade).sort(byChronology),
    decisionsByDay,
    gross: aggregate("gross"),
    net: aggregate("net"),
    costCoverage: {
      completeLegs,
      missingCommission,
      missingFees,
      completeDecisions: decisions.filter((decision) => decision.costCoverageComplete).length,
    },
  };
}

// Test hook, same pattern as the other pure modules.
if (typeof window !== "undefined") {
  (window as any).__tjMoney = {
    netTotal, grossTotal, netWins, netLosses, grossWin, grossLoss,
    profitFactor, grossProfitFactor, largestGrossWin, largestGrossLoss, largestNetWin, largestNetLoss,
    expectancy, avgWin, avgLoss, largestWin, largestLoss,
    netByDay, bestDay, worstDay, moneyStats,
    isEligibleFinancialLeg, tradeCostCoverage, tradeMoney, summarizeFinancials,
  };
}
