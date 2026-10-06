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
import { recordedRisk } from "./risk";
import { computeProcessSignals, netOutcomes } from "./process";
import {
  grossWin,
  grossLoss,
  grossProfitFactor,
  profitFactor,
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
  /** The account value at the tracking boundary (the value anchor). Falls back
   *  to `size` when the account has no opening balance. `size` remains the
   *  prop-rule anchor for target and floor. */
  capital?: number;
  /**
   * The tracking boundary (ISO). Trades and cashflows before it are already
   * represented by the opening state, so they are excluded here: no double
   * count. Absent = no boundary. Compared on the **journal day** (`dayKey`), the
   * one clock the rest of the engine buckets on, so a note can never enter Net
   * and stay out of the balance.
   */
  trackingStart?: string;
  /**
   * The account's highest value before `trackingStart`, declared by the trader.
   * A trailing floor follows that peak and Tradebook has no record of it, so it
   * is supplied, never inferred. Absent = a floor that needs it is unavailable.
   */
  openingPeak?: number;
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
  /** Re-entry window (minutes after a losing exit) the process signals read. */
  reentryWindowMinutes?: number;
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
  /** Rows of Net-positive / Net-negative decisions (legs summed in this account). */
  winCount: number;
  lossCount: number;
  /** Win rate on Net: positive ÷ (positive + negative), break-evens out. */
  winRate: number;
  grossWin: number;
  grossLoss: number;
  totalCommission: number;
  totalFees: number;
  /** The unqualified one, like everywhere else: Net gains ÷ Net losses. */
  profitFactor: number;
  /** Declared before-cost reference. */
  grossProfitFactor: number;
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
  reviewedPct: number;
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

/** One coherent read of an account's drawdown, from the floor model only. */
export interface DrawdownUsage {
  /** Dollars of the limit consumed under the configured floor. */
  used: number;
  /** Dollars left between the balance and the floor. */
  room: number;
  /** Share of the configured limit consumed, in percent (can exceed 100). */
  pct: number;
}

/**
 * The single source a card may read for "how much of the limit is used": the
 * floor model (`drawdownUsed`/`drawdownRoom`), the same numbers the account
 * dashboard shows. The peak-to-balance `ddToLimit` answers a different question
 * and, after a locked trailing floor, says an account is spent when it is not —
 * so it must never drive an edge, an alert or a bar. Returns null when the floor
 * model is unavailable (intraday trailing, unknown rule).
 */
export function drawdownUsage(
  m: Pick<AccountMetrics, "drawdownUsed" | "drawdownRoom">,
  maxLoss: number
): DrawdownUsage | null {
  if (!(maxLoss > 0) || m.drawdownUsed === null || m.drawdownRoom === null) return null;
  const used = Math.max(0, m.drawdownUsed);
  const room = Math.max(0, m.drawdownRoom);
  return { used, room, pct: (used / maxLoss) * 100 };
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
  /**
   * The base the balance is built from — the account's VALUE anchor
   * (`openingCapital(account)`: its declared opening balance, else its size). It
   * is not the rule anchor: pass the value, never `account.size` by habit. The
   * name is historical and kept, so callers pair it with `openingCapitalOf`.
   */
  size: number;
  dayKey: (trade: Trade) => string;
  cashflows?: Array<{ date: string; amount: number }>;
  /** Boundary: trades and cashflows before it are already the opening state. */
  trackingStart?: string;
}

export interface RecordedAccountMovement {
  /** The base value plus recorded trading and account cash movements. */
  balance: number;
  /** Recorded balance minus that base value. */
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

/** The one balance contract: value anchor + Net trades + signed cashflows. */
export function computeRecordedAccountMovement(input: RecordedAccountMovementInput): RecordedAccountMovement {
  const start = input.trackingStart && /^\d{4}-\d{2}-\d{2}$/.test(input.trackingStart) ? input.trackingStart : "";
  const tradeByDay = new Map<string, number>();
  for (const trade of input.trades) {
    if (!Number.isFinite(trade.pnl) || !trade.date) continue;
    const date = input.dayKey(trade);
    if (start && date < start) continue;
    tradeByDay.set(date, (tradeByDay.get(date) ?? 0) + netPnl(trade));
  }
  const cashByDay = new Map<string, number>();
  for (const cashflow of input.cashflows ?? []) {
    if (!cashflow.date || !Number.isFinite(cashflow.amount)) continue;
    // A pre-boundary payout/deposit/fee is already inside the opening balance.
    if (start && cashflow.date < start) continue;
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

/**
 * The account-value points for an equity curve: the opening value, then each
 * recorded day's close.
 *
 * Both curves (the account page and Home's Accounts widget) build their series
 * here, from the same movement the balance headline reads. The contract this
 * makes impossible to break: the last point of the curve is the number printed
 * above it, and the first is the account's declared opening value — never the
 * configured size, which is the rule anchor, not the value.
 */
export function accountValueSeries(
  days: ReadonlyArray<{ cumulative: number }>,
  capital: number
): number[] {
  return [capital, ...days.map((day) => capital + day.cumulative)];
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
  let inDD = false;
  let ddStart = "";
  let ddPeak = initialBalance;
  let ddTrough = initialBalance;
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
    } else if (!inDD) {
      // Start new drawdown
      inDD = true;
      ddStart = date;
      ddPeak = peak;
      ddTrough = balance;
      ddTrades = 0;
    } else {
      // Continuing drawdown
      if (balance < ddTrough) {
        ddTrough = balance;
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

export function computeAccountMetrics(input: AccountMetricsInput): AccountMetrics {
  const { trades, size, target = 0, maxLoss = 0, dailyLoss = 0, consistency = 0 } = input;
  // The value anchor: the opening balance when the account declared one, else
  // the configured size (today's behaviour). Rules keep reading `size`.
  const capital = typeof input.capital === "number" && Number.isFinite(input.capital) ? input.capital : size;
  const trackingStart =
    input.trackingStart && /^\d{4}-\d{2}-\d{2}$/.test(input.trackingStart) ? input.trackingStart : "";
  // One clock for the boundary: the same journal day every bucket, period and
  // calendar uses. A note whose recorded date and journal day straddle the
  // boundary must land on the same side of it everywhere, or it could count
  // toward Net and win rate while its money never reached the balance.
  const scoped = trades.filter(
    (t) => Number.isFinite(t.pnl) && !!t.date && (!trackingStart || input.dayKey(t) >= trackingStart)
  );

  // ---- per-day buckets ----
  // One accumulator: balance, drawdown, target, consistency, today, the daily
  // loss line and the day win rate are all answers about the same Net day.
  const byDay = new Map<string, { net: number }>();
  for (const t of scoped) {
    const k = input.dayKey(t);
    const b = byDay.get(k) ?? { net: 0 };
    b.net += netPnl(t);
    byDay.set(k, b);
  }
  const dayKeys = [...byDay.keys()].sort();
  const dayNets = dayKeys.map((k) => byDay.get(k)!.net);
  // A day that closed at exactly zero is neither: it stays out of the rate,
  // the same way a Net-breakeven decision stays out of the win rate.
  const decidedDays = dayNets.filter((v) => v !== 0);
  const positiveNetDays = dayNets.filter((v) => v > 0);
  const positiveNetDaySum = positiveNetDays.reduce((a, v) => a + v, 0);
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
    size: capital,
    dayKey: input.dayKey,
    cashflows: input.cashflows,
    trackingStart,
  });
  const balance = accountMovement.balance;
  const balancePeak = accountMovement.peakChange;
  // ---- The loss floor: a rule, read against a value it may not fully know ----
  //
  // `size` defines the rule (the lock point, the static floor). `capital` is
  // the value. A *trailing* floor additionally follows the account's high-water
  // mark, and with a tracking boundary the peak reached before that date is
  // history Tradebook does not have. So:
  //
  //  A. exactly calculable — `static` (the rule is the rule), and a trailing
  //     rule that locks once `capital - maxLoss` reaches the lock point: from
  //     there the lock dominates and no unknown peak can lower it.
  //  B. needs the high-water mark — an open trailing rule (it never locks), or a
  //     locked one still trailing. With no boundary the journal knows the peak.
  //     With one, only the trader's declared `openingPeak` does.
  //
  // When B has no declared peak the floor is reported as unavailable. It is
  // never guessed: an account whose real floor sits far below would otherwise
  // read as healthy while the firm had already failed it.
  const declaredPeak =
    typeof input.openingPeak === "number" && Number.isFinite(input.openingPeak) ? input.openingPeak : null;
  const peakFromTrackedHistory = capital + balancePeak;
  const lockPoint = size + (input.ddLockOffset ?? 0);
  const lockDominates = capital - maxLoss >= lockPoint;
  const peakBalance =
    !trackingStart || declaredPeak !== null
      ? Math.max(capital, declaredPeak ?? Number.NEGATIVE_INFINITY, peakFromTrackedHistory)
      : null;
  const floorKnown =
    maxLoss > 0 &&
    input.ddRuleKnown !== false &&
    !input.ddIntraday &&
    (input.ddStatic || (input.ddNoLock ? false : lockDominates) || peakBalance !== null);
  const floor =
    maxLoss <= 0 || !floorKnown
      ? 0
      : input.ddStatic
        ? size - maxLoss
        : input.ddNoLock
          ? (peakBalance as number) - maxLoss
          : // A trailing floor with a lock: once the lock dominates, the peak is
            // irrelevant and the answer is the lock itself — no history needed.
            lockDominates
            ? lockPoint
            : Math.min(lockPoint, (peakBalance as number) - maxLoss);
  const peak = Math.max(0, ...cumSeries);
  const ddCurrent = Math.max(0, peak - net);
  /** Dollars between the real balance and the loss limit — what the firm sees. */
  const ddToLimit = peakBalance === null ? 0 : Math.max(0, peakBalance - balance);
  /** Dollars between the real balance and the floor — the room left before failing. */
  const ddRemaining = maxLoss > 0 && floorKnown ? Math.max(0, balance - floor) : 0;
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
  // Classified by the Net sign of the decision (legs in this account summed),
  // never the Gross sign of a row: recorded costs decide which side a trade
  // lands on, here as everywhere else.
  const outcomes = netOutcomes(scoped);
  const decidedNet = (t: Trade): number => outcomes.get(t) ?? netPnl(t);
  const wins = scoped.filter((t) => decidedNet(t) > 0);
  const losses = scoped.filter((t) => decidedNet(t) < 0);
  const tradeCount = scoped.length;

  // ---- target / consistency ----
  const targetPct = target > 0 ? Math.min(100, Math.max(0, (net / target) * 100)) : 0;
  const toTarget = target > 0 ? Math.max(0, target - net) : 0;
  const avgDayNet = cashflowDays.length ? cashflowDays.reduce((a, v) => a + v, 0) / cashflowDays.length : 0;
  const daysToTarget = target > 0 && avgDayNet > 0 ? Math.ceil(toTarget / avgDayNet) : null;
  const bestNetDay = dayNets.length ? dayNets.reduce((a, v) => (v > a ? v : a), -Infinity) : 0;
  const worstNetDay = dayNets.length ? dayNets.reduce((a, v) => (v < a ? v : a), Infinity) : 0;
  const consBasis =
    consistency > 0 && (input.consistencyBasis ?? "profit") === "target" && target > 0
      ? target
      : positiveNetDaySum;
  const consistencyPct = consBasis > 0 ? Math.max(0, (bestNetDay / consBasis) * 100) : 0;
  const impliedTarget = consistency > 0 && bestNetDay > 0 ? Math.ceil(bestNetDay / (consistency / 100)) : 0;

  // ---- risk per trade ----
  const rMultiples: number[] = [];
  const risks: number[] = [];
  for (const t of scoped) {
    const risk = recordedRisk(t);
    if (risk) {
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
    reviewedPct,
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
  } = computeProcessSignals(scoped, input.dayKey, undefined, input.reentryWindowMinutes);

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
    // Net-breakeven decisions are out of the denominator, like everywhere else.
    winRate: wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0,
    grossWin: grossWin(scoped),
    grossLoss: grossLoss(scoped),
    totalCommission: scoped.reduce((a, t) => a + (t.commission || 0), 0),
    totalFees: scoped.reduce((a, t) => a + (t.fees || 0), 0),
    profitFactor: profitFactor(scoped),
    grossProfitFactor: grossProfitFactor(scoped),
    expectancy: tradeCount ? net / tradeCount : 0,
    avgWin: avgWin(scoped),
    avgLoss: avgLoss(scoped),
    dayWinRate: decidedDays.length ? (positiveNetDays.length / decidedDays.length) * 100 : 0,
    dayCount: dayKeys.length,
    winDays: positiveNetDays.length,
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
    buffer: maxLoss > 0 && floorKnown ? Math.max(0, balance - floor) : 0,
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
    reviewedPct,
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
  (window as unknown as { __tjAccountMetrics: { computeAccountMetrics: unknown } }).__tjAccountMetrics = { computeAccountMetrics };
}
