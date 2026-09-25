/**
 * Account-level metrics.
 *
 * Everything a trader needs to answer, for ONE account:
 *  - "where do I stand vs the rules?" (risk, target, consistency)
 *  - "am I being disciplined?" (mistakes, overtrading, tilt, reviews)
 *  - "can I get paid?" (funded: qualifying days, cap, eligibility)
 *
 * Pure + deterministic: `dayKey` is injected so the timezone logic stays in one
 * place. No DOM, so it is easy to test (see the smoke suite).
 */

import { Trade } from "../types";
import { holdMinutesOf } from "./instant";
import { futuresSpec } from "../futures";
import { computeProcessSignals } from "./process";
import {
  grossWin,
  grossLoss,
  grossProfitFactor,
  avgWin,
  avgLoss,
  bestDay,
  worstDay,
  largestWin,
  largestLoss,
} from "./money";
import { netPnl } from "./fees";

export interface AccountMetricsInput {
  trades: Trade[];
  size: number;
  target?: number;
  maxLoss?: number;
  /** Where a trailing drawdown stops trailing, in dollars ABOVE the starting
   *  balance (Tradeify locks it at +$100). 0 = it locks at break-even. */
  ddLockOffset?: number;
  /** True for a drawdown that trails the high and never locks ("eod-trailing-open"):
   *  the floor keeps rising with the peak for the life of the account. */
  ddNoLock?: boolean;
  /** True for a fixed floor ("static"): the limit sits below the STARTING balance
   *  and never moves with the peak. Used by live funded accounts. */
  ddStatic?: boolean;
  /** Intraday trailing needs intraday equity/high-water marks, not just trade closes. */
  ddIntraday?: boolean;
  /** Whether the account's floor model is known from its resolved rules. */
  ddRuleKnown?: boolean;
  dailyLoss?: number;
  consistency?: number;
  /** How the consistency rule is measured: best day ÷ total profit (default) or ÷ target. */
  consistencyBasis?: "profit" | "target";
  /** How a trade's day is computed (timezone-aware). */
  dayKey: (t: Trade) => string;
  /** Today's key (for the daily-loss line). */
  todayKey?: string;
  /** Money already withdrawn from this account. */
  withdrawn?: number;
  /**
   * Cash movements, signed: payouts negative, deposits positive. They move the
   * balance (and therefore the distance to the loss limit) but never the
   * trading numbers — money leaving the account is not a loss.
   */
  cashflows?: Array<{ date: string; amount: number }>;
}

export interface AccountMetrics {
  // ---- money / performance ----
  net: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  grossWin: number;
  grossLoss: number;
  totalCommission: number;
  totalFees: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  dayWinRate: number;
  dayCount: number;
  /** Days that closed positive — the "winning days" a firm counts for a payout. */
  winDays: number;
  bestDay: number;
  worstDay: number;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  // ---- risk / rules ----
  peak: number;
  ddCurrent: number;
  /** Real balance: size + realised P&L − payouts + deposits. */
  balance: number;
  /** Dollars between the balance and the loss limit — what the firm sees. */
  ddToLimit: number;
  /** Dollars between the real balance and the loss floor — the room left. */
  ddRemaining: number;
  /** Configured drawdown floor, or null when the floor model is unknown. */
  drawdownFloor: number | null;
  /** Loss-limit room consumed under the configured floor, or null if unknown. */
  drawdownUsed: number | null;
  /** Actual balance distance above the configured floor, or null if unknown. */
  drawdownRoom: number | null;
  buffer: number;
  todayNet: number;
  dailyLossRemaining: number;
  worstDayPctOfLimit: number;
  targetPct: number;
  toTarget: number;
  daysToTarget: number | null;
  consistencyPct: number;
  impliedTarget: number;
  avgRiskMoney: number;
  avgRiskR: number;
  pctGE1R: number;
  // ---- process / discipline ----
  mistakeRate: number;
  avgRating: number;
  reviewCompletePct: number;
  stopDefinedPct: number;
  untaggedPct: number;
  fastTradesPct: number;
  afterTwoLosses: number;
  avgHoldWinMin: number;
  avgHoldLossMin: number;
  tradesPerDay: number;
  maxTradesInDay: number;
  revengeCount: number;
  revengeRate: number;
  streakCurrent: number;
  streakWinBest: number;
  streakLossWorst: number;
  // ---- funded / payout ----
  /** Money taken out of the account so far. Cash, not performance. */
  withdrawn: number;
}

// ---- Drawdown episodes ----
export interface DrawdownEpisode {
  startPeak: number;
  trough: number;
  depth: number;
  depthPct: number;
  startDate: string;
  endDate: string | null;
  durationDays: number;
  tradeCount: number;
  recovered: boolean;
}

export interface DrawdownAnalysis {
  episodes: DrawdownEpisode[];
  currentDD: DrawdownEpisode | null;
  totalEpisodes: number;
  avgRecoveryDays: number;
  pctTimeInDD: number;
}

export interface RecordedAccountMovementInput {
  trades: Trade[];
  size: number;
  dayKey: (trade: Trade) => string;
  cashflows?: Array<{ date: string; amount: number }>;
}

export interface RecordedAccountMovement {
  /** Configured capital plus recorded trading and account cash movements. */
  balance: number;
  /** Recorded balance minus configured capital. */
  change: number;
  /** Peak recorded balance change over the dated movement series. */
  peakChange: number;
  /** Dated account-value changes, including trading, payouts, deposits and adjustments. */
  days: Array<{ date: string; change: number; cumulative: number }>;
}

export interface RecordedAccountWindowSource {
  /** Configured account capital, using the same baseline as the account views. */
  capital: number;
  /** Daily movement returned by `computeRecordedAccountMovement`. */
  days: Array<{ date: string; change: number }>;
}

export interface RecordedAccountWindow {
  capital: number;
  /** Account value immediately before the selected window begins. */
  openingBalance: number;
  /** Account value after the last recorded movement in the selected window. */
  closingBalance: number;
  /** Opening point followed by each in-window daily close. */
  points: Array<{ date: string; change: number; balance: number }>;
}

/**
 * Window an existing set of recorded account movements without resetting the
 * account to zero. The opening value is configured capital plus all recorded
 * movement before `from`; no new balance formula is introduced here.
 */
export function windowRecordedAccountMovement(
  sources: RecordedAccountWindowSource[],
  from: string | null,
  to: string,
): RecordedAccountWindow {
  const capital = sources.reduce((sum, source) => sum + (Number.isFinite(source.capital) ? source.capital : 0), 0);
  const byDate = new Map<string, number>();
  for (const source of sources) {
    for (const day of source.days) {
      if (!day.date || day.date > to || !Number.isFinite(day.change)) continue;
      byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.change);
    }
  }

  const dates = [...byDate.keys()].sort();
  const openingBalance = capital + (from
    ? dates.filter((date) => date < from).reduce((sum, date) => sum + (byDate.get(date) ?? 0), 0)
    : 0);
  const windowDates = dates.filter((date) => !from || date >= from);
  const startDate = from ?? windowDates[0] ?? to;
  let balance = openingBalance;
  const points: RecordedAccountWindow["points"] = [{ date: startDate, change: 0, balance }];
  for (const date of windowDates) {
    const change = byDate.get(date) ?? 0;
    balance += change;
    points.push({ date, change, balance });
  }
  return { capital, openingBalance, closingBalance: balance, points };
}

/** Shared Accounts-page balance contract: size + Net trades + signed cashflows. */
export function computeRecordedAccountMovement(input: RecordedAccountMovementInput): RecordedAccountMovement {
  const tradeByDay = new Map<string, number>();
  for (const trade of input.trades) {
    if (!Number.isFinite(trade.pnl) || !trade.date) continue;
    const date = input.dayKey(trade);
    tradeByDay.set(date, (tradeByDay.get(date) ?? 0) + netPnl(trade));
  }
  const cashByDay = new Map<string, number>();
  for (const cashflow of input.cashflows ?? []) {
    if (!cashflow.date || !Number.isFinite(cashflow.amount)) continue;
    cashByDay.set(cashflow.date, (cashByDay.get(cashflow.date) ?? 0) + cashflow.amount);
  }
  const dates = [...new Set([...tradeByDay.keys(), ...cashByDay.keys()])].sort();
  let cumulative = 0;
  const days = dates.map((date) => {
    const change = (tradeByDay.get(date) ?? 0) + (cashByDay.get(date) ?? 0);
    cumulative += change;
    return { date, change, cumulative };
  });
  const change = cumulative;
  const peakChange = Math.max(0, ...days.map((day) => day.cumulative));
  return { balance: input.size + change, change, peakChange, days };
}

/** Compute drawdown episodes from a daily equity series (date→balance). */
export function computeDrawdownEpisodes(
  dailyBalances: Array<{ date: string; balance: number }>,
  initialBalance: number,
): DrawdownAnalysis {
  if (dailyBalances.length === 0) {
    return { episodes: [], currentDD: null, totalEpisodes: 0, avgRecoveryDays: 0, pctTimeInDD: 0 };
  }

  const episodes: DrawdownEpisode[] = [];
  let peak = initialBalance;
  let peakDate = dailyBalances[0]?.date ?? "";
  let inDD = false;
  let ddStart = "";
  let ddPeak = initialBalance;
  let ddTrough = initialBalance;
  let ddTroughDate = "";
  let ddTrades = 0;

  for (let i = 0; i < dailyBalances.length; i++) {
    const { date, balance } = dailyBalances[i];
    if (balance >= peak) {
      // Recovery or new peak
      if (inDD) {
        const depth = ddPeak - ddTrough;
        const depthPct = ddPeak > 0 ? (depth / ddPeak) * 100 : 0;
        const startIdx = dailyBalances.findIndex((d) => d.date === ddStart);
        const endIdx = i;
        const durationDays = Math.max(1, endIdx - startIdx);
        episodes.push({
          startPeak: ddPeak,
          trough: ddTrough,
          depth,
          depthPct,
          startDate: ddStart,
          endDate: date,
          durationDays,
          tradeCount: ddTrades,
          recovered: true,
        });
        inDD = false;
      }
      peak = balance;
      peakDate = date;
    } else if (!inDD) {
      // Start new drawdown
      inDD = true;
      ddStart = date;
      ddPeak = peak;
      ddTrough = balance;
      ddTroughDate = date;
      ddTrades = 0;
    } else {
      // Continuing drawdown
      if (balance < ddTrough) {
        ddTrough = balance;
        ddTroughDate = date;
      }
    }
    if (inDD) ddTrades++;
  }

  // Close open drawdown episode
  if (inDD) {
    const depth = ddPeak - ddTrough;
    const depthPct = ddPeak > 0 ? (depth / ddPeak) * 100 : 0;
    const startIdx = dailyBalances.findIndex((d) => d.date === ddStart);
    const durationDays = Math.max(1, dailyBalances.length - 1 - startIdx);
    const ep: DrawdownEpisode = {
      startPeak: ddPeak,
      trough: ddTrough,
      depth,
      depthPct,
      startDate: ddStart,
      endDate: null,
      durationDays,
      tradeCount: ddTrades,
      recovered: false,
    };
    episodes.push(ep);
  }

  const total = episodes.length;
  const currentDD = episodes.length > 0 && !episodes[episodes.length - 1].recovered ? episodes[episodes.length - 1] : null;
  const recovered = episodes.filter((e) => e.recovered);
  const totalDays = dailyBalances.length;
  const ddDays = recovered.reduce((s, e) => s + e.durationDays, 0) + (currentDD ? currentDD.durationDays : 0);

  return {
    episodes,
    currentDD,
    totalEpisodes: total,
    avgRecoveryDays: recovered.length > 0 ? recovered.reduce((s, e) => s + e.durationDays, 0) / recovered.length : 0,
    pctTimeInDD: totalDays > 0 ? Math.min(100, (ddDays / totalDays) * 100) : 0,
  };
}

const minutesOf = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t || "");
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0) : null;
};

export function computeAccountMetrics(input: AccountMetricsInput): AccountMetrics {
  const { trades, size, target = 0, maxLoss = 0, dailyLoss = 0, consistency = 0 } = input;
  const scoped = trades.filter((t) => Number.isFinite(t.pnl) && !!t.date);

  // ---- per-day buckets ----
  // Two accumulators, because the money and the trade quality are different
  // questions: balance, drawdown, target, consistency, today and the daily-loss
  // line read the NET (gross minus costs); best/worst day and the day win rate
  // read the GROSS.
  const byDay = new Map<string, { net: number; gross: number; count: number; wins: number; losses: number }>();
  for (const t of scoped) {
    const k = input.dayKey(t);
    const b = byDay.get(k) ?? { net: 0, gross: 0, count: 0, wins: 0, losses: 0 };
    b.net += netPnl(t);
    b.gross += t.pnl;
    b.count += 1;
    if (t.pnl > 0) b.wins += 1;
    if (t.pnl < 0) b.losses += 1;
    byDay.set(k, b);
  }
  const dayKeys = [...byDay.keys()].sort();
  const dayNets = dayKeys.map((k) => byDay.get(k)!.net);
  const dayGrosses = dayKeys.map((k) => byDay.get(k)!.gross);
  const grossProfitDays = dayNets.filter((v) => v > 0).reduce((a, v) => a + v, 0);
  const cashflowDays = dayNets.filter((v) => Math.abs(v) > 1e-9);

  let cum = 0;
  const cumSeries: number[] = [];
  for (const v of dayNets) {
    cum += v;
    cumSeries.push(cum);
  }
  const net = cum;
  // ---- balance timeline (trades plus cash movements) ----
  // A payout lowers the balance while the peak stays where it was, so it eats
  // the distance to the loss limit. That is the firm's view of the account, and
  // it is the only reason we record payouts at all. Trading numbers never see
  // these: money leaving is not a loss.
  const accountMovement = computeRecordedAccountMovement({
    trades: scoped,
    size,
    dayKey: input.dayKey,
    cashflows: input.cashflows,
  });
  const balance = accountMovement.balance;
  const balancePeak = accountMovement.peakChange;
  const peakBalance = Math.max(size, size + balancePeak);
  const peak = Math.max(0, ...cumSeries);
  // Floor: trailing EOD drawdown that never rises above break-even.
  // The floor trails the peak until it reaches the lock point: break-even by
  // default, or the firm's offset above the starting balance (Tradeify: +$100).
  // A firm that never locks ("eod-trailing-open") keeps trailing the peak, so
  // there the floor is simply the peak minus the limit.
  const floorBase = peakBalance;
  const floor =
    maxLoss > 0
      ? input.ddStatic
        ? size - maxLoss
        : input.ddNoLock
          ? floorBase - maxLoss
          : Math.min(size + (input.ddLockOffset ?? 0), floorBase - maxLoss)
      : 0;
  const ddCurrent = Math.max(0, peak - net);
  /** Dollars between the real balance and the loss limit — what the firm sees. */
  const ddToLimit = Math.max(0, peakBalance - balance);
  /** Dollars between the real balance and the floor — the room left before failing. */
  const ddRemaining = maxLoss > 0 ? Math.max(0, balance - floor) : 0;
  const floorKnown = maxLoss > 0 && input.ddRuleKnown !== false && !input.ddIntraday;
  const drawdownFloor = floorKnown ? floor : null;
  const drawdownRoom = floorKnown ? Math.max(0, balance - floor) : null;
  // A locked trailing floor can leave more room than the original max-loss.
  // In that state no portion of the configured limit is currently consumed.
  const drawdownUsed = drawdownRoom === null ? null : Math.max(0, maxLoss - drawdownRoom);
  let maxDrawdown = 0;
  let runPeak = 0;
  for (const v of cumSeries) {
    runPeak = Math.max(runPeak, v);
    maxDrawdown = Math.max(maxDrawdown, runPeak - v);
  }

  // ---- wins / losses ----
  const wins = scoped.filter((t) => t.pnl > 0);
  const losses = scoped.filter((t) => t.pnl < 0);
  const tradeCount = scoped.length;

  // ---- target / consistency ----
  const targetPct = target > 0 ? Math.min(100, Math.max(0, (net / target) * 100)) : 0;
  const toTarget = target > 0 ? Math.max(0, target - net) : 0;
  const avgDayNet = cashflowDays.length ? cashflowDays.reduce((a, v) => a + v, 0) / cashflowDays.length : 0;
  const daysToTarget = target > 0 && avgDayNet > 0 ? Math.ceil(toTarget / avgDayNet) : null;
  // Day quality is gross; the consistency rule and the daily-loss line are net.
  const bestNetDay = dayNets.length ? dayNets.reduce((a, v) => (v > a ? v : a), -Infinity) : 0;
  const worstNetDay = dayNets.length ? dayNets.reduce((a, v) => (v < a ? v : a), Infinity) : 0;
  const consBasis =
    consistency > 0 && (input.consistencyBasis ?? "profit") === "target" && target > 0
      ? target
      : grossProfitDays;
  const consistencyPct = consBasis > 0 ? Math.max(0, (bestNetDay / consBasis) * 100) : 0;
  const impliedTarget = consistency > 0 && bestNetDay > 0 ? Math.ceil(bestNetDay / (consistency / 100)) : 0;

  // ---- risk per trade ----
  const rMultiples: number[] = [];
  const risks: number[] = [];
  for (const t of scoped) {
    if (!t.stopLoss || !t.entryPrice) continue;
    const risk = Math.abs(t.entryPrice - t.stopLoss) * futuresSpec(t.symbol).pointValue * (t.quantity || 1);
    if (risk > 0) {
      risks.push(risk);
      rMultiples.push(t.pnl / risk);
    }
  }
  const avgRiskMoney = risks.length ? risks.reduce((a, v) => a + v, 0) / risks.length : 0;
  const avgRiskR = rMultiples.length ? rMultiples.reduce((a, v) => a + v, 0) / rMultiples.length : 0;
  const pctGE1R = rMultiples.length ? (rMultiples.filter((r) => r >= 1).length / rMultiples.length) * 100 : 0;

  // ---- process (shared, cross-account — see lib/process.ts) ----
  const {
    mistakeRate,
    avgRating,
    reviewCompletePct,
    stopDefinedPct,
    untaggedPct,
    fastTradesPct,
    afterTwoLosses,
    tradesPerDay,
    maxTradesInDay,
    revengeCount,
    revengeRate,
    streakCurrent,
    streakWinBest,
    streakLossWorst,
  } = computeProcessSignals(scoped, input.dayKey);

  // Real elapsed time from the canonical instants when the note has them;
  // the recorded clock (overnight wraps past midnight) otherwise.
  const heldMinutes = (t: Trade): number | null => holdMinutesOf(t);
  const hold = (list: Trade[]): number => {
    const mins = list
      .map((t) => heldMinutes(t))
      .filter((v): v is number => v !== null);
    return mins.length ? mins.reduce((a, v) => a + v, 0) / mins.length : 0;
  };

  // funded / payout: money taken out, kept apart from performance.
  const withdrawn = input.withdrawn ?? 0;

  return {
    net,
    tradeCount,
    winCount: wins.length,
    lossCount: losses.length,
    // Win rate excludes break-even trades from the denominator (industry standard).
    winRate: wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0,
    grossWin: grossWin(scoped),
    grossLoss: grossLoss(scoped),
    totalCommission: scoped.reduce((a, t) => a + (t.commission || 0), 0),
    totalFees: scoped.reduce((a, t) => a + (t.fees || 0), 0),
    profitFactor: grossProfitFactor(scoped),
    expectancy: tradeCount ? net / tradeCount : 0,
    avgWin: avgWin(scoped),
    avgLoss: avgLoss(scoped),
    dayWinRate:
      dayGrosses.filter((v) => v !== 0).length > 0
        ? (dayGrosses.filter((v) => v > 0).length / dayGrosses.filter((v) => v !== 0).length) * 100
        : 0,
    dayCount: dayKeys.length,
    winDays: dayGrosses.filter((v) => v > 0).length,
    bestDay: bestDay(scoped, input.dayKey),
    worstDay: worstDay(scoped, input.dayKey),
    largestWin: largestWin(scoped),
    largestLoss: largestLoss(scoped),
    maxDrawdown,
    peak,
    ddCurrent,
    balance,
    ddToLimit,
    ddRemaining,
    drawdownFloor,
    drawdownUsed,
    drawdownRoom,
    // Alias of ddRemaining: the old trade-only buffer was the last hybrid of
    // trade net and balance-derived floor. Kept as a field for compatibility.
    buffer: maxLoss > 0 ? Math.max(0, balance - floor) : 0,
    todayNet: input.todayKey ? (byDay.get(input.todayKey)?.net ?? 0) : 0,
    dailyLossRemaining: dailyLoss > 0 ? Math.max(0, Math.min(dailyLoss, dailyLoss + (input.todayKey ? byDay.get(input.todayKey)?.net ?? 0 : 0))) : 0,
    worstDayPctOfLimit: dailyLoss > 0 ? (Math.abs(Math.min(0, worstNetDay)) / dailyLoss) * 100 : 0,
    targetPct,
    toTarget,
    daysToTarget,
    consistencyPct,
    impliedTarget,
    avgRiskMoney,
    avgRiskR,
    pctGE1R,
    mistakeRate,
    avgRating,
    reviewCompletePct,
    stopDefinedPct,
    untaggedPct,
    fastTradesPct,
    afterTwoLosses,
    avgHoldWinMin: hold(wins),
    avgHoldLossMin: hold(losses),
    tradesPerDay,
    maxTradesInDay,
    revengeCount,
    revengeRate,
    streakCurrent,
    streakWinBest,
    streakLossWorst,
    withdrawn,
  };
}

if (typeof window !== "undefined") {
  (window as any).__tjAccountMetrics = { computeAccountMetrics };
}
