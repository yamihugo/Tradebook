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
import { futuresSpec } from "../futures";
import { reviewStatus } from "./review";

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
  /** Highest end-of-day balance the account has reached. */
  balancePeak: number;
  /** Dollars between the balance and the loss limit — what the firm sees. */
  ddToLimit: number;
  buffer: number;
  bufferPct: number;
  todayNet: number;
  dailyLossRemaining: number;
  worstDayPctOfLimit: number;
  largestLossPctOfLimit: number;
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
  reviewedPct: number;
  reviewCompletePct: number;
  stopDefinedPct: number;
  untaggedPct: number;
  fastTradesPct: number;
  afterTwoLosses: number;
  avgHoldWinMin: number;
  avgHoldLossMin: number;
  bestHour: number | null;
  worstHour: number | null;
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
  avgDepth: number;
  avgDepthPct: number;
  avgRecoveryDays: number;
  worstDD: DrawdownEpisode | null;
  longestDD: DrawdownEpisode | null;
  pctTimeInDD: number;
}

/** Compute drawdown episodes from a daily equity series (date→balance). */
export function computeDrawdownEpisodes(
  dailyBalances: Array<{ date: string; balance: number }>,
  initialBalance: number,
): DrawdownAnalysis {
  if (dailyBalances.length === 0) {
    return { episodes: [], currentDD: null, totalEpisodes: 0, avgDepth: 0, avgDepthPct: 0, avgRecoveryDays: 0, worstDD: null, longestDD: null, pctTimeInDD: 0 };
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
    avgDepth: total > 0 ? episodes.reduce((s, e) => s + e.depth, 0) / total : 0,
    avgDepthPct: total > 0 ? episodes.reduce((s, e) => s + e.depthPct, 0) / total : 0,
    avgRecoveryDays: recovered.length > 0 ? recovered.reduce((s, e) => s + e.durationDays, 0) / recovered.length : 0,
    worstDD: total > 0 ? episodes.reduce((w, e) => (e.depth > (w?.depth ?? 0) ? e : w), null as DrawdownEpisode | null) : null,
    longestDD: total > 0 ? episodes.reduce((w, e) => (e.durationDays > (w?.durationDays ?? 0) ? e : w), null as DrawdownEpisode | null) : null,
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
  const byDay = new Map<string, { net: number; count: number; wins: number; losses: number }>();
  for (const t of scoped) {
    const k = input.dayKey(t);
    const b = byDay.get(k) ?? { net: 0, count: 0, wins: 0, losses: 0 };
    b.net += t.pnl;
    b.count += 1;
    if (t.pnl > 0) b.wins += 1;
    if (t.pnl < 0) b.losses += 1;
    byDay.set(k, b);
  }
  const dayKeys = [...byDay.keys()].sort();
  const dayNets = dayKeys.map((k) => byDay.get(k)!.net);
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
  const flowByDay = new Map<string, number>();
  for (const c of input.cashflows ?? []) {
    if (!c.date || !Number.isFinite(c.amount)) continue;
    flowByDay.set(c.date, (flowByDay.get(c.date) ?? 0) + c.amount);
  }
  const allDays = [...new Set([...dayKeys, ...flowByDay.keys()])].sort();
  let balanceRun = 0;
  const balanceSeries: number[] = [];
  for (const k of allDays) {
    balanceRun += (byDay.get(k)?.net ?? 0) + (flowByDay.get(k) ?? 0);
    balanceSeries.push(balanceRun);
  }
  const balanceNet = balanceRun;
  const balance = size + balanceNet;
  const balancePeak = Math.max(0, ...balanceSeries);
  const peakBalance = size + balancePeak;
  const peak = Math.max(0, ...cumSeries);
  // Floor: trailing EOD drawdown that never rises above break-even.
  // The floor trails the peak until it reaches the lock point: break-even by
  // default, or the firm's offset above the starting balance (Tradeify: +$100).
  // A firm that never locks ("eod-trailing-open") keeps trailing the peak, so
  // there the floor is simply the peak minus the limit.
  const floorBase = peakBalance;
  const floor =
    maxLoss > 0
      ? input.ddNoLock
        ? floorBase - maxLoss
        : Math.min(size + (input.ddLockOffset ?? 0), floorBase - maxLoss)
      : 0;
  const ddCurrent = Math.max(0, peak - net);
  /** Dollars between the real balance and the loss limit — what the firm sees. */
  const ddToLimit = Math.max(0, peakBalance - balance);
  let maxDrawdown = 0;
  let runPeak = 0;
  for (const v of cumSeries) {
    runPeak = Math.max(runPeak, v);
    maxDrawdown = Math.max(maxDrawdown, runPeak - v);
  }

  // ---- wins / losses ----
  const wins = scoped.filter((t) => t.pnl > 0);
  const losses = scoped.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const tradeCount = scoped.length;

  // ---- target / consistency ----
  const targetPct = target > 0 ? Math.min(100, Math.max(0, (net / target) * 100)) : 0;
  const toTarget = target > 0 ? Math.max(0, target - net) : 0;
  const avgDayNet = cashflowDays.length ? cashflowDays.reduce((a, v) => a + v, 0) / cashflowDays.length : 0;
  const daysToTarget = target > 0 && avgDayNet > 0 ? Math.ceil(toTarget / avgDayNet) : null;
  const bestDay = dayNets.length ? dayNets.reduce((a, v) => (v > a ? v : a), -Infinity) : 0;
  const worstDay = dayNets.length ? dayNets.reduce((a, v) => (v < a ? v : a), Infinity) : 0;
  const consBasis =
    consistency > 0 && (input.consistencyBasis ?? "profit") === "target" && target > 0
      ? target
      : grossProfitDays;
  const consistencyPct = consBasis > 0 ? Math.max(0, (bestDay / consBasis) * 100) : 0;
  const impliedTarget = consistency > 0 && bestDay > 0 ? Math.ceil(bestDay / (consistency / 100)) : 0;

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

  // ---- process ----
  const withMistake = scoped.filter((t) => (t.mistake || "").trim().length > 0).length;
  const mistakeRate = tradeCount ? (withMistake / tradeCount) * 100 : 0;
  const rated = scoped.filter((t) => (t.rating ?? 0) > 0);
  const avgRating = rated.length ? rated.reduce((a, t) => a + (t.rating ?? 0), 0) / rated.length : 0;
  const reviewedPct = tradeCount ? (scoped.filter((t) => t.reviewed === true).length / tradeCount) * 100 : 0;
  const reviewCompletePct = tradeCount ? (scoped.filter((t) => reviewStatus(t).complete).length / tradeCount) * 100 : 0;
  const stopDefinedPct = tradeCount ? (scoped.filter((t) => (t.stopLoss ?? 0) > 0).length / tradeCount) * 100 : 0;
  const untaggedPct = tradeCount ? (scoped.filter((t) => !(t.setup || "").trim()).length / tradeCount) * 100 : 0;

  const hold = (list: Trade[]): number => {
    const mins = list
      .map((t) => {
        const a = minutesOf(t.entryTime);
        const b = minutesOf(t.exitTime);
        if (a === null || b === null) return null;
        // Overnight trades wrap past midnight.
        return b >= a ? b - a : b + 1440 - a;
      })
      .filter((v): v is number => v !== null && v >= 0);
    return mins.length ? mins.reduce((a, v) => a + v, 0) / mins.length : 0;
  };

  const hourBuckets = new Map<number, number>();
  for (const t of scoped) {
    const m = minutesOf(t.entryTime);
    if (m === null) continue;
    const h = Math.floor(m / 60);
    hourBuckets.set(h, (hourBuckets.get(h) ?? 0) + t.pnl);
  }
  const hours = [...hourBuckets.keys()];
  const bestHour = hours.length ? hours.reduce((a, b) => (hourBuckets.get(b)! > hourBuckets.get(a)! ? b : a)) : null;
  const worstHour = hours.length ? hours.reduce((a, b) => (hourBuckets.get(b)! < hourBuckets.get(a)! ? b : a)) : null;

  const daysWithTrades = dayKeys.filter((k) => byDay.get(k)!.count > 0).length;
  const maxTradesInDay = dayKeys.length ? Math.max(...dayKeys.map((k) => byDay.get(k)!.count)) : 0;

  // revenge proxy: a trade opened within 15 min of a losing trade's exit
  const ordered = [...scoped].sort((a, b) => (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || "")));
  let revengeCount = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev.pnl >= 0 || prev.date !== cur.date) continue;
    const out = minutesOf(prev.exitTime);
    const inn = minutesOf(cur.entryTime);
    if (out !== null && inn !== null && inn >= out && inn - out <= 15) revengeCount += 1;
  }
  const revengeRate = tradeCount ? (revengeCount / tradeCount) * 100 : 0;

  // impulsive: finished within 1 minute
  const fastCount = scoped.filter((t) => {
    const a = minutesOf(t.entryTime);
    const b = minutesOf(t.exitTime);
    return a !== null && b !== null && b - a >= 0 && b - a < 1;
  }).length;
  const fastTradesPct = tradeCount ? (fastCount / tradeCount) * 100 : 0;

  // tilt: opened right after two consecutive losses
  let afterTwoLosses = 0;
  let runLosses = 0;
  for (const t of ordered) {
    if (runLosses >= 2) afterTwoLosses += 1;
    runLosses = t.pnl < 0 ? runLosses + 1 : 0;
  }

  // streaks
  let streakCurrent = 0;
  let bestWin = 0;
  let worstLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of [...scoped].sort((a, b) => (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || "")))) {
    if (t.pnl > 0) {
      curWin += 1;
      curLoss = 0;
      bestWin = Math.max(bestWin, curWin);
    } else if (t.pnl < 0) {
      curLoss += 1;
      curWin = 0;
      worstLoss = Math.max(worstLoss, curLoss);
    }
    // break-even: pause the run (do not reset) — matches common journal behaviour
  }
  const lastNonFlat = [...scoped]
    .sort((a, b) => (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || "")))
    .filter((t) => t.pnl !== 0)
    .pop();
  streakCurrent = lastNonFlat ? (lastNonFlat.pnl > 0 ? curWin : -curLoss) : 0;

  // funded / payout: money taken out, kept apart from performance.
  const withdrawn = input.withdrawn ?? 0;

  const largestWin = wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0;
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0;

  return {
    net,
    tradeCount,
    winCount: wins.length,
    lossCount: losses.length,
    // Win rate excludes break-even trades from the denominator (industry standard).
    winRate: wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0,
    grossWin,
    grossLoss,
    totalCommission: scoped.reduce((a, t) => a + (t.commission || 0), 0),
    totalFees: scoped.reduce((a, t) => a + (t.fees || 0), 0),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: wins.length + losses.length > 0 ? net / (wins.length + losses.length) : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    dayWinRate:
      dayNets.filter((v) => v !== 0).length > 0
        ? (dayNets.filter((v) => v > 0).length / dayNets.filter((v) => v !== 0).length) * 100
        : 0,
    dayCount: dayKeys.length,
    bestDay,
    worstDay,
    largestWin,
    largestLoss,
    maxDrawdown,
    peak,
    ddCurrent,
    balance,
    balancePeak: peakBalance,
    ddToLimit,
    buffer: maxLoss > 0 ? net - floor : 0,
    bufferPct: maxLoss > 0 ? Math.max(0, Math.min(100, ((net - floor) / maxLoss) * 100)) : 0,
    todayNet: input.todayKey ? (byDay.get(input.todayKey)?.net ?? 0) : 0,
    dailyLossRemaining: dailyLoss > 0 ? Math.max(0, Math.min(dailyLoss, dailyLoss + (input.todayKey ? byDay.get(input.todayKey)?.net ?? 0 : 0))) : 0,
    worstDayPctOfLimit: dailyLoss > 0 ? (Math.abs(Math.min(0, worstDay)) / dailyLoss) * 100 : 0,
    largestLossPctOfLimit: dailyLoss > 0 ? (Math.abs(largestLoss ?? 0) / dailyLoss) * 100 : 0,
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
    reviewedPct,
    reviewCompletePct,
    stopDefinedPct,
    untaggedPct,
    fastTradesPct,
    afterTwoLosses,
    avgHoldWinMin: hold(wins),
    avgHoldLossMin: hold(losses),
    bestHour,
    worstHour,
    tradesPerDay: daysWithTrades ? tradeCount / daysWithTrades : 0,
    maxTradesInDay,
    revengeCount,
    revengeRate,
    streakCurrent,
    streakWinBest: bestWin,
    streakLossWorst: worstLoss,
    withdrawn,
  };
}
