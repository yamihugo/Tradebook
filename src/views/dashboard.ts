import { ItemView, Notice, setIcon, TFile } from "obsidian";
import type TradebookPlugin from "../main";
import { PropAccount, Trade } from "../types";
import { accountFilters, kpiCard, renderAppShell, svgPath } from "../ui";
import { firmLabel as catalogLabel } from "../lib/firmLogos";
import { fmtMoney2, fmtMoneyAbs, fmtMoneyCompact, isFiniteNumber, todayKey, zoneWallParts } from "../tz";
import { updateTradeFields } from "../storage";
import { attachTip } from "../lib/tip";

import { netPnl } from "../lib/fees";
import { renderEmptyState as renderEmptyBox } from "../lib/emptyState";
import {
  clamp as gClamp,
  collides,
  columnCount,
  compactVertical,
  GAP,
  GRID_COLS,
  GridItem,
  gridRows,
  layoutForColumns,
  moveBandOrder,
  moveItem as gridMove,
  placeNew,
  resizeItem as gridResize,
  ROW_PX,
} from "../lib/grid";
import { PerformanceCalendarWidget } from "../widgets/performanceCalendarWidget";
import { renderTradingScore } from "../widgets/tradingScoreWidget";
import { knownFuturesSpec } from "../futures";
import { METRIC_TITLES, metricById } from "../lib/metrics";
import { holdMinutesOf, tradeHourInZone } from "../lib/instant";
import { accountResolver, accountScope, analyticsTrades, journalDayKey } from "../lib/scope";
import { summarizeFinancials, FinancialScope, FinancialSummary } from "../lib/money";
import { computeTrends, rankTrendMoves, isBetter } from "../lib/trends";
import { computeScore, recentScoreWindow } from "../lib/score";
import { computeDrawdownEpisodes, computeRecordedAccountMovement } from "../lib/accountMetrics";
import { typeLabel, typeRank } from "../lib/accountTypes";
import { resolveAccountView } from "../lib/accountRules";
import { renderTreemap } from "../lib/chartKit";
import { dimensionTiles } from "../lib/breakdown";
import { normalizeOrderType, tradeRows, tradeR, type TradeRow } from "../lib/tradeTable";
import { mountDateField, parseDateInput } from "../lib/dates";
import { inNegativeState, normalizeTags, reviewOptions } from "../lib/tags";
import { hasPrint, hasText, reviewStatus, reviewSummary } from "../lib/review";
import { DEFAULT_REENTRY_WINDOW_MINUTES, netOutcomes, reentrySignals, computeProcessSignals } from "../lib/process";
import { sessionLabel } from "../lib/sessions";
import { killTip, showTip, moveTip } from "../lib/tip";
import { renderLineChart } from "../lib/lineChart";
import { formatDate } from "../lib/dates";
import {
  dateInZone,
  dateWithinPeriod,
  isValidIsoDate,
  PeriodBounds,
  PeriodId,
  periodAsOf,
  periodDataBounds,
  periodDayBounds,
  previousPeriodBounds,
  tradingDayAtJournalDateEnd,
} from "../lib/periods";
import { dateInComparison, periodComparison } from "../lib/periodComparisons";

/** Shared day/month abbreviations for the heat-map. */
const MON_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/** Weekday labels indexed by JS `getDay()` (0 = Sunday). */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first order for the weekday widget. */
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCORE_PERIOD_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisweek: "This Week",
  lastweek: "Last Week",
  "1m": "This Month",
  lastmonth: "Last Month",
  thisquarter: "This Quarter",
  lastquarter: "Last Quarter",
  thisyear: "This Year",
  lastyear: "Last Year",
  all: "All Time",
  custom: "Custom",
};
const BRIEFING_SHORTCUTS: Array<[PeriodId, string]> = [
  ["thisweek", "This Week"],
  ["lastweek", "Last Week"],
  ["1m", "This Month"],
  ["thisquarter", "This Quarter"],
  ["thisyear", "This Year"],
  ["all", "All Time"],
];
const BRIEFING_MORE_PERIODS: Array<[PeriodId, string]> = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["lastmonth", "Last Month"],
  ["lastquarter", "Last Quarter"],
  ["lastyear", "Last Year"],
];

/** "9am" / "2pm" from a 24-hour clock. */
function fmtHourLabel(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

/** Entry hour ("0".."23") in the Journal Timezone, read from the canonical
 *  instant — or "—" when the entry has no readable hour. */
function hourBlockOf(t: Trade, zone: string): string {
  const h = tradeHourInZone(t, zone);
  return h === null ? "—" : String(h);
}

/** Chronological order for raw hour keys. */
function hourOrder(label: string): number {
  const h = Number(label);
  return Number.isFinite(h) ? h : 99;
}

export type DashItem = GridItem;

export const CARD_TITLES: Record<string, string> = {
  netpnl: "Cumulative Net Trading P&L",
  longpnl: "Long Net P&L",
  shortpnl: "Short Net P&L",
  calendar: "Calendar",
  heatmap: "Trading Activity",
  breakdown: "Breakdown",
  rmultiples: "R-Multiples",
  score: "Trading Score & Radar",
  focus: "Focus Areas",
  accounts: "Accounts",
  trends: "Trends",
  payouts: "Payouts",
  costs: "Costs",
  drawdown: "Drawdown",
  size: "Position Size",
  revenge: "Revenge Trading",
  tilt: "Tilt Meter",
  tags: "Behavioral Tags",
  // One widget per metric (the old combined "Key Stats" strip is gone).
  ...METRIC_TITLES,
};

/**
 * The metric catalogue, ordered by question: the result first, then the trade
 * shapes, streaks, risk, timing, days and the explicit Gross comparison. These
 * groups are also the sub-headings of the Add-widget "Metrics" section, so the
 * list reads as a table of contents instead of one long alphabet.
 */
const HOME_METRIC_MENU_GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: "Result", ids: ["m.netpnl", "m.trades", "m.winrate", "m.profitfactor", "m.expectancy", "m.maxdd", "m.sharpe", "m.bestday", "m.worstday"] },
  { title: "Trades", ids: ["m.avgwin", "m.avgloss", "m.wintrades", "m.losstrades", "m.largestwin", "m.largestloss"] },
  { title: "Streaks", ids: ["m.winstreak", "m.lossstreak", "m.currentstreak"] },
  { title: "Risk", ids: ["m.recoveryfactor", "m.timeindd", "m.longestdd", "m.ddepisodes", "m.avgrecovery"] },
  { title: "Timing", ids: ["m.expr", "m.avgdailypl", "m.tradesperday", "m.holdtime", "m.winhold", "m.losshold", "m.besthour", "m.worsthour"] },
  { title: "Days", ids: ["m.greendays", "m.reddays", "m.pctgreendays", "m.runnerrate"] },
  { title: "Gross", ids: ["m.grossprofitfactor"] },
];
const HOME_METRICS = HOME_METRIC_MENU_GROUPS.flatMap((group) => group.ids);

/**
 * Home's curated Add widget list, in reading order: the performance widgets
 * first, then time/process, then accounts and cash, then the whole metric
 * catalogue. Existing saved Home widgets remain valid whatever their order.
 */
const HOME_WIDGET_MENU = [
  // Performance — evolution curves
  "netpnl", "longpnl", "shortpnl", "costs", "drawdown", "size",
  // Origin — where the money came from
  "breakdown", "rmultiples", "trends",
  // Process / Time — when and how
  "calendar", "heatmap", "score", "focus", "tags", "tilt", "revenge",
  // Accounts & cash
  "accounts", "payouts",
  // Metrics — the full per-card catalogue, in Result → Trades → Streaks → Risk → Timing → Days order
  ...HOME_METRICS,
];

/**
 * Deprecated widget ids → their canonical replacement. Rewritten on load so a
 * saved layout (or a Home seed) written before a rename keeps its tiles.
 * `review` → `focus` (the Focus Areas absorbed the review queue); `besthours` /
 * `timing` → `hour`; the three breakdowns → `breakdown`.
 */
export const WIDGET_ID_ALIASES: Record<string, string> = {
  review: "focus",
  besthours: "hour",
  timing: "hour",
  symbols: "breakdown",
  setup: "breakdown",
  "order-type": "breakdown",
  hour: "breakdown",
  weekday: "breakdown",
  session: "breakdown",
};

/**
 * Home — the default the trader actually chose and applied in his own vault,
 * copied here card for card (24 columns × 32 rows of 54px).
 *
 * It is deliberately short. Three bands answer the three questions that open a
 * journal — where the money came from, what needs attention, how the process
 * reads — and below them the numbers sit one per line, so the rest of the
 * widgets and metrics stay undiscovered: a trader meets them by adding the one
 * they were missing, instead of being handed the whole catalogue at once.
 */
export const HOME_DEFAULT: GridItem[] = [
  // The built-in Home default: calendar, the review queue and the score
  // across the first fold; the curve and where the money came from; then the
  // stacked metrics column. No long/short split and no accounts card.
  { i: "calendar",        x: 0,  y: 0,  w: 11, h: 7 },
  { i: "focus",           x: 11, y: 0,  w: 6,  h: 7 },
  { i: "score",           x: 17, y: 0,  w: 7,  h: 7 },
  { i: "netpnl",          x: 0,  y: 7,  w: 10, h: 4 },
  { i: "breakdown",       x: 10, y: 7,  w: 14, h: 4 },
  { i: "m.netpnl",        x: 0,  y: 11, w: 3,  h: 2 },
  { i: "m.winrate",       x: 0,  y: 13, w: 3,  h: 2 },
  { i: "m.pctgreendays",  x: 0,  y: 15, w: 3,  h: 2 },
  { i: "m.trades",        x: 0,  y: 17, w: 3,  h: 2 },
  { i: "m.tradesperday",  x: 0,  y: 19, w: 3,  h: 2 },
  { i: "m.bestday",       x: 0,  y: 21, w: 3,  h: 2 },
  { i: "m.worstday",      x: 0,  y: 23, w: 3,  h: 2 },
  { i: "m.holdtime",      x: 0,  y: 25, w: 3,  h: 2 },
];

const NEW_W: Record<string, number> = { netpnl: 12, longpnl: 8, shortpnl: 8, calendar: 12, score: 12, breakdown: 12, rmultiples: 12, focus: 12, accounts: 12, heatmap: 10, trends: 8, payouts: 6, tags: 6, "m.netpnl": 3, "m.trades": 3, "m.winrate": 3, "m.profitfactor": 3, "m.expectancy": 3, "m.maxdd": 3 };
const NEW_H: Record<string, number> = { netpnl: 6, longpnl: 6, shortpnl: 6, calendar: 6, score: 6, breakdown: 4, rmultiples: 4, focus: 4, accounts: 4, heatmap: 5, trends: 4, payouts: 3, tags: 3, "m.netpnl": 2, "m.trades": 2, "m.winrate": 2, "m.profitfactor": 2, "m.expectancy": 2, "m.maxdd": 2 };

/**
 * Minimum tile size per widget: the resize floor, kept only as large as the
 * widget's content genuinely needs so a card can be taken down to a compact
 * size. the classic grid items carry no floor (minW/minH = 1) and let
 * the content adapt; these floors are the smallest *usable* box instead, so a
 * widget never has to be clipped to hit its own minimum.
 * Canonical widths on the 24-col grid: w4 sixth · w6 quarter · w8 third · w12 half · w24 full.
 */
const MIN_W: Record<string, number> = {
  netpnl: 4, longpnl: 4, shortpnl: 4, calendar: 6, heatmap: 6,
  breakdown: 4, score: 4,
  focus: 6, accounts: 6, trends: 8, payouts: 4, tags: 4, costs: 4, drawdown: 4, size: 4, revenge: 4, tilt: 4, rmultiples: 4,
};
const MIN_H: Record<string, number> = {
  netpnl: 3, longpnl: 3, shortpnl: 3, calendar: 4, heatmap: 3,
  breakdown: 3, score: 4,
  focus: 3, accounts: 3, trends: 5, payouts: 2, tags: 3, costs: 3, drawdown: 3, size: 3, revenge: 3, tilt: 2, rmultiples: 3,
};
/** Min size for a widget id (metrics and unknown ids fall back to 1×1). */
const minOf = (id: string): { w: number; h: number } => ({ w: MIN_W[id] ?? 1, h: MIN_H[id] ?? 1 });

/** Widgets whose body scrolls (tables/lists); treemaps and charts scale. */
const SCROLL_WIDGETS = new Set<string>();

/** Parse a displayed metric value to a number, or null if it is not numeric
 *  (e.g. "9am", "3m", "—", "∞"). A trailing "R" is a unit, like "$" and "%". */
function parseMetricNumber(s: string): number | null {
  const t = s.trim();
  if (!/^[+-]?\$?[\d,]+(\.\d+)?%?R?$/.test(t)) return null;
  const n = parseFloat(t.replace(/[$,%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const PERCENT_DELTA_METRICS = new Set([
  "m.winrate", "m.timeindd", "m.runnerrate", "m.pctgreendays",
]);
const COUNT_DELTA_METRICS = new Set([
  "m.trades", "m.wintrades", "m.losstrades", "m.winstreak", "m.lossstreak",
  "m.ddepisodes", "m.tradesperday",
]);
/** Day counts read "day(s)", not "trade(s)". */
const DAYS_DELTA_METRICS = new Set(["m.greendays", "m.reddays"]);
/** A streak is a bare signed number — no unit. */
const STREAK_DELTA_METRICS = new Set(["m.currentstreak"]);
const RATIO_DELTA_METRICS = new Set([
  "m.profitfactor", "m.grossprofitfactor", "m.sharpe",
  "m.recoveryfactor", "m.expr",
]);
const DURATION_DELTA_METRICS = new Set([
  "m.holdtime", "m.winhold", "m.losshold", "m.longestdd", "m.avgrecovery",
]);

function parseMetricDuration(value: string): number | null {
  const pattern = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/g;
  let totalMinutes = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    consumed += match[0];
    const amount = Number(match[1]);
    totalMinutes +=
      match[2] === "d" ? amount * 1440 :
      match[2] === "h" ? amount * 60 :
      match[2] === "s" ? amount / 60 : amount;
  }
  return consumed && value.replace(/\s/g, "") === consumed.replace(/\s/g, "") && Number.isFinite(totalMinutes)
    ? totalMinutes
    : null;
}

function comparisonMetricNumber(id: string, value: string): number | null {
  return DURATION_DELTA_METRICS.has(id) ? parseMetricDuration(value) : parseMetricNumber(value);
}

function formatDurationDelta(minutes: number): string {
  const seconds = Math.round(Math.abs(minutes) * 60);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const remainingMinutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [
    ...(days ? [`${days}d`] : []),
    ...(hours ? [`${hours}h`] : []),
    ...(remainingMinutes ? [`${remainingMinutes}m`] : []),
    ...(!days && !hours && !remainingMinutes || remainingSeconds ? [`${remainingSeconds}s`] : []),
  ];
  return `${minutes > 0 ? "+" : minutes < 0 ? "−" : ""}${parts.join(" ")}`;
}

function formatMetricDelta(id: string, delta: number): string {
  const arrow = delta > 0 ? "\u2191" : delta < 0 ? "\u2193" : "=";
  // `fmtMoney` signs its own output with an ASCII hyphen; the other branches
  // below use the typographic minus (−), so match them here only — `fmtMoney`
  // itself stays exactly as it is for its 96 call sites.
  if (MONEY_DELTA_METRICS.has(id)) return `${arrow} ${fmtMoney2(delta).replace(/^-/, "\u2212")}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "\u2212" : "";
  if (PERCENT_DELTA_METRICS.has(id)) return `${arrow} ${sign}${Math.abs(delta).toFixed(1)} pp`;
  if (COUNT_DELTA_METRICS.has(id)) {
    const count = Math.round(Math.abs(delta));
    return `${arrow} ${sign}${count} ${count === 1 ? "trade" : "trades"}`;
  }
  if (DAYS_DELTA_METRICS.has(id)) {
    const days = Math.round(Math.abs(delta));
    return `${arrow} ${sign}${days} ${days === 1 ? "day" : "days"}`;
  }
  if (STREAK_DELTA_METRICS.has(id)) return `${arrow} ${sign}${Math.round(Math.abs(delta))}`;
  if (RATIO_DELTA_METRICS.has(id)) return `${arrow} ${sign}${Math.abs(delta).toFixed(2)}`;
  if (DURATION_DELTA_METRICS.has(id)) return `${arrow} ${formatDurationDelta(delta)}`;
  return `${arrow} ${sign}${Math.abs(delta).toFixed(2)}`;
}

/** Build a formatter that mirrors the target string's style. */
function metricFormatter(target: string): (v: number) => string {
  if (target.includes("$")) {
    return (v) =>
      `${v >= 0 ? "+$" : "-$"}${Math.abs(v).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
  }
  if (target.includes("%")) return (v) => `${v.toFixed(1)}%`;
  if (target.endsWith("R")) return (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
  const dot = target.indexOf(".");
  if (dot >= 0) {
    const dec = Math.min(4, target.length - dot - 1);
    return (v) => v.toFixed(dec);
  }
  return (v) => `${Math.round(v)}`;
}

/** "Nice" axis ticks within a range (1/2/5 * 10^n steps). */
/** Smooth Catmull-Rom path through the points (a gentle wave, not sharp elbows). */
/** Resample a previous series to a new length so two series can be morphed. */
/**
 * Colour is used only where it carries real meaning (a money outcome), as the
 * accessibility guidance recommends. Everything else stays neutral and relies
 * on the value itself (+/- signs, labels) rather than colour alone.
 */
const COLORED_METRICS = new Set(["m.netpnl", "m.expectancy", "m.bestday", "m.worstday", "m.maxdd"]);

/**
 * Which direction of travel is an improvement, per metric — colour on the
 * "vs prev" sub-stat follows this, never the raw sign (a falling drawdown is
 * good). `null`/absent means the move has no good or bad direction and the
 * delta stays neutral. The arrow and the sign always carry the direction too,
 * so colour is never the only signal (WCAG 2.2 SC 1.4.1).
 */
const BETTER_WHEN: Record<string, "up" | "down"> = {
  "m.netpnl": "up",
  "m.winrate": "up",
  "m.profitfactor": "up",
  "m.expectancy": "up",
  "m.sharpe": "up",
  "m.bestday": "up",
  "m.avgwin": "up",
  "m.recoveryfactor": "up",
  "m.expr": "up",
  "m.runnerrate": "up",
  "m.greendays": "up",
  "m.pctgreendays": "up",
  "m.maxdd": "down",
  "m.avgloss": "down",
  "m.timeindd": "down",
  "m.longestdd": "down",
  "m.avgrecovery": "down",
  "m.reddays": "down",
};

/** -1 worse · 0 neutral/no direction · 1 better, for colouring a metric delta. */
function metricDeltaTone(id: string, delta: number): -1 | 0 | 1 {
  const betterWhen = BETTER_WHEN[id];
  if (!betterWhen || Math.abs(delta) < 1e-9) return 0;
  const improving = betterWhen === "up" ? delta > 0 : delta < 0;
  return improving ? 1 : -1;
}

/**
 * Metrics whose `compute` still reads the trade list handed to it (streaks,
 * hold-time splits, per-trade Sharpe). The financial metrics — Net P&L, Total
 * trades, Win Rate, PF, Expectancy — read the shared FinancialSummary
 * instead and never depend on the copy-count preference.
 */
const PER_TRADE_METRICS = new Set([
  "m.winstreak",
  "m.lossstreak",
  "m.avgwin",
  "m.avgloss",
  "m.expectancy",
  "m.holdtime",
  "m.winhold",
  "m.losshold",
  "m.sharpe",
]);
/** Metrics that show a "vs previous period" sub-stat. The eight Home headline
 *  metrics all carry one, plus the trend metrics whose sample is large enough
 *  for a comparison to mean anything — a single outlier day is not a trend. */
const COMPARE_METRICS = new Set([
  "m.netpnl", "m.trades", "m.winrate", "m.profitfactor", "m.expectancy", "m.maxdd",
  "m.sharpe", "m.bestday", "m.avgwin", "m.avgloss",
  "m.recoveryfactor", "m.expr", "m.runnerrate",
  "m.timeindd", "m.longestdd", "m.avgrecovery",
  "m.greendays", "m.reddays", "m.pctgreendays",
]);
const MONEY_DELTA_METRICS = new Set([
  "m.netpnl", "m.expectancy", "m.maxdd", "m.bestday", "m.worstday",
  "m.largestwin", "m.largestloss", "m.avgwin", "m.avgloss",
  "m.avgdailypl",
]);

/**
 * Band entries carry no meaningful geometry (their order is the list order),
 * but they are kept in the same persisted array for backward compatibility.
 * Parking them far below the grid keeps them out of the grid engine's
 * collision/compaction entirely.
 */
const BAND_Y = 9999;
const BAND_W = 3;
const BAND_H = 2;

// Used when the container width is unknown (e.g. jsdom harness).
const DESIGN_W = 1200;

interface HomeAccountSnapshot {
  account: PropAccount;
  balance: number;
  days: Array<{ date: string; change: number; cumulative: number }>;
}

interface HomeAccountMovement {
  accounts: HomeAccountSnapshot[];
  trades: Trade[];
  capital: number;
  change: number;
  days: Array<{ date: string; change: number; cumulative: number }>;
}

/**
 * Shared grid engine behind Home.
 *
 * It owns the data loading, filters, drag/resize grid and every widget
 * renderer. It deliberately knows nothing about *which* layout is on screen:
 * `getViewType()`, `layout()` / `setLayout()`, `defaultLayout()` and
 * `viewKey()` are the seams the concrete view defines. `HomeView` is that view;
 * `allowedIds()` still exposes the whole widget catalogue, so the trader can
 * add any widget.
 */
export abstract class WidgetGridView extends ItemView {
  plugin: TradebookPlugin;
  trades: Trade[] = [];
  /** Home filter: which account types are in. Empty = all (OR within). */
  private _accountTypes: string[] = [];
  /** Home filter: which accounts are in. Empty = all (OR within). */
  private _accountIds: string[] = [];
  dateRange = "all";
  customFrom = "";
  customTo = "";
  /** Legacy single-value mirrors: the harness and the parked Analytics branch
   *  still read `accountId`/`filter`. The multi arrays are the truth. */
  get accountId(): string | null {
    return this._accountIds.length === 1 ? this._accountIds[0] : null;
  }
  set accountId(v: string | null) {
    this._accountIds = v ? [v] : [];
  }
  get filter(): string {
    return this._accountTypes.length === 1 ? this._accountTypes[0] : "all";
  }
  set filter(v: string) {
    this._accountTypes = v && v !== "all" ? [v] : [];
  }
  get accountIds(): string[] {
    return this._accountIds;
  }
  set accountIds(v: string[]) {
    this._accountIds = [...v];
  }
  get accountTypes(): string[] {
    return this._accountTypes;
  }
  set accountTypes(v: string[]) {
    this._accountTypes = [...v];
  }
  editMode = false;
  filtersOpen = false;
  widgetMenuOpen = false;
  /** Home only: the named-layouts manager is open. In memory only. */
  layoutsOpen = false;
  /** Home only: which layout row is being renamed inline. In memory only. */
  private editingLayout: string | null = null;
  /** Section title → true when the Add-widget section is collapsed. In memory
   *  only (the menu is rebuilt on every open), default open. */
  private widgetMenuCollapsed: Record<string, boolean> = {};
  periodMenuOpen = false;
  customPickerOpen = false;
  customDraftFrom = "";
  customDraftTo = "";
  periodValidation = "";
  // Auto-adjust engine: re-render each widget body when its size changes so
  // content always fits (no scrollbars, no clipped charts).
  private bodyObserver: ResizeObserver | null = null;
  private bodyRenderers = new Map<HTMLElement, () => void>();
  private _resizeRaf = 0;
  private _pendingResize = new Set<HTMLElement>();
  /** Bodies whose first draw already ran (so a resize may redraw them). */
  private _drawnBodies = new WeakSet<HTMLElement>();
  /** Off-screen widget draws, filled in on idle instead of blocking the frame. */
  private _idleQueue: Array<() => void> = [];
  private _idleScheduled = false;
  /** True while a card drag/resize is in progress. The ResizeObserver still
   *  toggles the CSS size classes live, but JS-driven body re-draws are settled
   *  by `scheduleBodyRedraw` for the card being resized. */
  _interacting = false;
  /** rAF handle + last size for the live re-draw of the resized widget body. */
  private _bodyRedrawRaf = 0;
  private _lastBodyDims = new WeakMap<HTMLElement, string>();
  // Re-render the whole grid when the pane/window width changes (keeps columns
  // and card sizes in sync instead of drifting until you enter Edit).
  private _resizeTimer = 0;
  // Last displayed value per metric (updated during the count) + target value.
  private metricDisplay = new Map<string, number>();
  /** In-flight count-up animations, keyed by metric id (so a re-render cancels the old one). */
  private _tweens = new Map<string, number>();
  private metricTarget = new Map<string, number>();
  // Previous cumulative series, so the chart can morph when data changes.
  private _radarError = "";
  /** True only for the first render — drives the intro animations. */
  private _intro = true;
  private mainEl: HTMLElement | null = null;
  /** Suppresses observer redraws while the intro animations play. */
  private _introUntil = 0;
  private _scoreAnimated = false;
  private calendarMonth = "";
  private calendarManual = false;
  /** Chosen once per view instance, so the note changes on reload, not on re-render. */
  private greetingNoteText: string | null = null;
  /** Home's recorded-value widgets share one Accounts-contract calculation per render. */
  private _homeAccountMovement: HomeAccountMovement | null = null;
  /** The account shown in the Accounts widget's hero; not persisted. */
  private _homeAccountsSelectedId: string | null = null;
  /** Grid in the coordinates currently shown to the user. */
  private _visibleLayout: GridItem[] | null = null;
  private _visibleCols = GRID_COLS;
  /**
   * The last layout actually painted, at the columns and column width it was
   * painted with. Unlike `_visibleLayout`, this survives a render — it is what a
   * hidden leaf re-uses, because a leaf with no width has nothing to measure and
   * must not reflow into a grid the user never chose.
   */
  private _lastPainted: { layout: GridItem[]; cols: number; colW: number } | null = null;
  private headerEl: HTMLElement | null = null;
  /** The metric band and its polite live region, for keyboard reordering. */
  private _bandEl: HTMLElement | null = null;
  private _bandLive: HTMLElement | null = null;
  private _onWinResize = () => {
    if (this._resizeTimer) window.clearTimeout(this._resizeTimer);
    this._resizeTimer = window.setTimeout(() => {
      this._resizeTimer = 0;
      this.renderPreservingScroll();
    }, 160);
  };
  dragId: string | null = null;
  // Grid engine state
  gridEl: HTMLElement | null = null;
  placeholderEl: HTMLElement | null = null;
  colW = 80;
  /** Columns actually used for the current width (may be < GRID_COLS). */
  private activeCols = GRID_COLS;
  cardEls = new Map<string, HTMLElement>();
  checked = new Set<string>();
  checking = false;
  checkboxEls = new Map<string, HTMLInputElement>();

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  abstract getViewType(): string;

  getDisplayText(): string {
    return "Tradebook";
  }

  getIcon(): string {
    return "grip";
  }

  // ---------------- View seams the subclass defines ----------------

  /** The persisted layout this view reads from. */
  abstract layout(): DashItem[] | undefined;

  /** Persist a new layout for this view (caller still calls saveSettings). */
  abstract setLayout(layout: DashItem[]): void;

  private storedGridCols(): number {
    if (this.viewKey() === "home") return this.plugin.settings.homeGridCols || GRID_COLS;
    return this.plugin.settings.dashboardGridCols || GRID_COLS;
  }

  private setStoredGridCols(cols: number): void {
    if (this.viewKey() === "home") this.plugin.settings.homeGridCols = cols;
    else this.plugin.settings.dashboardGridCols = cols;
  }

  /**
   * A leaf coming back from a hidden tab (or a layout change) reports a real
   * width that the last render may not have seen. Re-render only when the column
   * count actually differs — a plain reveal with the same width costs nothing,
   * and the saved positions are re-applied from the stored layout.
   */
  onResize(): void {
    if (this._interacting || !this.gridEl) return;
    const grid = this.gridEl;
    const measured = Math.max(grid.clientWidth, this.contentEl.clientWidth);
    if (measured <= 0) return;
    const gridW = grid.clientWidth || Math.max(240, measured - 40);
    if (columnCount(gridW) === this.activeCols) return;
    this.renderPreservingScroll();
  }

  private storedLayout(): GridItem[] {
    this.ensureLayout();
    return (this.layout() ?? this.defaultLayout()).map((item) => ({ ...item }));
  }

  private layoutForViewport(layout: GridItem[], fromCols: number, toCols: number): GridItem[] {
    return layoutForColumns(layout, fromCols, toCols, (id) => this.minSize(id));
  }

  private setWorkingLayout(layout: GridItem[]): void {
    this._visibleLayout = layout.map((item) => ({ ...item }));
    this._visibleCols = this.activeCols;
  }

  /**
   * Persist a grid layout, keeping Home's band entries exactly where they are:
   * the grid engine only ever sees the grid half, but storage stays one array
   * (no schema change) with the band parked below it.
   */
  private commitLayout(layout: GridItem[]): void {
    const band = this.layoutBand(this.bandEntries(this.storedLayout()));
    this.setLayout([...band, ...layout.map((item) => ({ ...item }))]);
    this.setStoredGridCols(this.activeCols);
    this.setWorkingLayout(layout);
    // The committed arrangement is now what is on screen, so it is what a later
    // hidden render must preserve.
    this._lastPainted = { layout: layout.map((item) => ({ ...item })), cols: this.activeCols, colW: this.colW };
    // Sync the DOM to the committed layout. A drag hides the floating card
    // (`.tj-moving`) and only the placeholder follows the pointer, so the card
    // itself is never repositioned by the trial — without this the drop leaves
    // it where it started, overlapping whatever moved into the freed cell. The
    // resize trial already positions every card, so this is a no-op there.
    const grid = this.gridEl;
    if (grid) {
      for (const item of layout) {
        const card = this.cardEls.get(item.i);
        if (card) this.positionCard(card, item);
      }
      const rows = Math.max(1, gridRows(layout));
      grid.style.height = `${rows * ROW_PX + (rows - 1) * GAP}px`;
    }
  }

  /** The seed used only when no layout was ever saved (undefined, not []). */
  abstract defaultLayout(): GridItem[];

  /** Which widget ids this view is allowed to show. */
  allowedIds(): Set<string> {
    return new Set(Object.keys(CARD_TITLES));
  }

  /** Identity handed to the app shell (nav highlight). */
  abstract viewKey(): string;

  async onOpen(): Promise<void> {
    if (this.viewKey() === "home") {
      const state = this.plugin.briefingPeriodState;
      this.dateRange = state.period === "custom" && (!isValidIsoDate(state.customFrom) || !isValidIsoDate(state.customTo) || state.customFrom > state.customTo)
        ? "all"
        : state.period || "all";
      this.customFrom = state.customFrom || "";
      this.customTo = state.customTo || "";
      this.calendarMonth = state.calendarMonth || "";
      this.calendarManual = state.calendarManual === true;
      const hf = this.plugin.settings.homeFilters;
      this._accountIds = Array.isArray(hf?.accountIds) ? [...hf.accountIds] : [];
      this._accountTypes = Array.isArray(hf?.accountTypes) ? [...hf.accountTypes] : [];
    }
    window.addEventListener("resize", this._onWinResize);
    await this.refresh();
  }

  /** Home's account/type filters survive a reload (their own defaults). */
  private persistHomeFilters(): void {
    if (this.viewKey() !== "home") return;
    this.plugin.settings.homeFilters = {
      accountIds: [...this._accountIds],
      accountTypes: [...this._accountTypes],
    };
    void this.plugin.saveSettings();
  }

  async refresh(): Promise<void> {
    // Expanded: copied trades are real money in every account they reached.
    // Financial decision metrics group the in-scope legs separately. Archived accounts are out of every
    // Home number — their notes live in the Trade Log, not in the balance.
    const all = await this.plugin.loadTradesExpanded();
    this.trades = all.filter((t) => !this.plugin.isArchivedTrade(t));
    this.renderPreservingScroll();
  }

  /**
   * Memo tables. `base`/`filtered` are keyed on the filter signature and tied
   * to the current `trades` array, so they can never serve a stale list even
   * when the state changes without a full render. The `WeakMap`s are keyed by
   * the list reference and reset on every render.
   */
  private _cacheTrades: Trade[] | null = null;
  private _baseCache = new Map<string, Trade[]>();
  private _filteredCache = new Map<string, Trade[]>();
  private _countCache = new WeakMap<Trade[], Trade[]>();
  private _finCache = new WeakMap<Trade[], FinancialSummary>();

  private ensureTradeCache(): void {
    if (this._cacheTrades === this.trades) return;
    this._cacheTrades = this.trades;
    this._baseCache.clear();
    this._filteredCache.clear();
  }

  /** The list per-trade widgets use: one entry per logical trade. */
  countsList(list: Trade[]): Trade[] {
    const cached = this._countCache.get(list);
    if (cached) return cached;
    const counts = analyticsTrades(list, this.plugin.settings.includeCopiesInPortfolioAnalytics === true).counts;
    this._countCache.set(list, counts);
    return counts;
  }

  /**
   * The explicit scoped financial population. This is the ONE source every
   * headline number reads — Net P&L, Total trades, Win Rate, Net PF,
   * Expectancy and the cumulative curve — so they can never disagree on scope,
   * eligibility or classification. Monetary aggregation ignores the copy-count
   * preference: legs are summed into decisions, then classified by Net sign.
   */
  private financialsFor(list: Trade[], dayKey?: (trade: Trade) => string): FinancialSummary {
    // The default day key (journal zone) is by far the common case, and the
    // same list is summarized by several widgets in one render — memoize it.
    if (!dayKey) {
      const cached = this._finCache.get(list);
      if (cached) return cached;
    }
    const summary = summarizeFinancials(list, {
      scope: this.accountScopeFor(list),
      dayKey: dayKey ?? ((trade: Trade) => this.scoreDayKey(trade)),
    });
    if (!dayKey) this._finCache.set(list, summary);
    return summary;
  }

  /**
   * Who is in: one resolver (mapped id, else name match, else a stable
   * unmapped key), the portfolio demo rule, and archived accounts out — the
   * same population the Accounts overview and the recorded-value widgets use.
   */
  /** True when the trade's account and type are both in the chosen sets. */
  private matchesHomeScope(t: Trade): boolean {
    const ids = this._accountIds;
    const types = this._accountTypes;
    if (ids.length) {
      const mapped = this.plugin.mappedAccount(t.account);
      const matched = mapped
        ? ids.includes(mapped.id)
        : ids.some((id) => {
            const acc = this.plugin.settings.propAccounts.find((a) => a.id === id);
            return acc ? this.accountMatches(t, acc) : false;
          });
      if (!matched) return false;
    }
    if (types.length) {
      const mapped = this.plugin.mappedAccount(t.account);
      const at = mapped ? mapped.type : t.accountType;
      const liveOk = types.includes("live") && (at === "live" || at === "personal");
      if (!liveOk && !types.includes(at)) return false;
    }
    return true;
  }

  /** Apply Home's account/type filters, then the portfolio demo rule when no
   *  explicit scope is chosen (a chosen account/type is the reader asking for
   *  that population, demos included). */
  private filterByHomeScope(list: Trade[]): Trade[] {
    if (!this._accountIds.length && !this._accountTypes.length) {
      if (this.plugin.settings.excludeDemosFromPortfolio === false) return list;
      return list.filter((t) => this.plugin.resolveAccountType(t.account) !== "demo");
    }
    return list.filter((t) => this.matchesHomeScope(t));
  }

  private accountScopeFor(list: Trade[]): FinancialScope {
    const explicit = this._accountIds.length > 0 || this._accountTypes.length > 0;
    return accountScope(explicit ? this.filterByHomeScope(list) : list, {
      resolve: accountResolver({
        accounts: this.plugin.settings.propAccounts ?? [],
        mappedAccount: (label) => this.plugin.mappedAccount(label),
      }),
      excludeDemos: this.plugin.settings.excludeDemosFromPortfolio !== false,
      // A chosen account or account type is the trader asking for that
      // population: a selected demo account stays in on purpose.
      explicitAccountScope: explicit,
      isArchived: (trade) => this.plugin.isArchivedTrade(trade),
    });
  }

  private persistBriefingPeriod(): void {
    if (this.viewKey() !== "home") return;
    this.plugin.briefingPeriodState = {
      period: this.dateRange as PeriodId,
      customFrom: this.customFrom,
      customTo: this.customTo,
      calendarMonth: this.calendarMonth,
      calendarManual: this.calendarManual,
    };
  }

  private selectBriefingPeriod(period: PeriodId, from = this.customFrom, to = this.customTo): void {
    const changed = this.dateRange !== period || (period === "custom" && (from !== this.customFrom || to !== this.customTo));
    this.dateRange = period;
    if (period === "custom") {
      this.customFrom = from;
      this.customTo = to;
    }
    if (changed) {
      // A period change is relevant to Calendar's reference month. Other
      // refreshes/resizes preserve the trader's manual month navigation.
      this.calendarManual = false;
      this.calendarMonth = "";
    }
    this.periodMenuOpen = false;
    this.customPickerOpen = false;
    this.periodValidation = "";
    this.persistBriefingPeriod();
    this.renderPreservingScroll();
  }

  accountMatches(t: Trade, acc: { id: string; name: string }): boolean {
    const mapped = this.plugin.mappedAccount(t.account);
    if (mapped) return mapped.id === acc.id;
    return (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
  }

  /** Trades filtered by account / account-type (no date range). */
  baseTrades(): Trade[] {
    this.ensureTradeCache();
    const cacheKey = `${this._accountIds.join(",")}|${this._accountTypes.join(",")}`;
    const hit = this._baseCache.get(cacheKey);
    if (hit) return hit;
    const list = this.filterByHomeScope(this.trades.filter((t) => isFiniteNumber(t.pnl) && t.date));
    this._baseCache.set(cacheKey, list);
    return list;
  }

  /** Shared inclusive journal-date bounds for period-filtered historical data. */
  private rangeBounds() {
    return periodDataBounds(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
      this.plugin.settings.weekStart ?? "monday",
    );
  }

  /** Home and Analytics use identical period bounds. */
  private briefingBounds() {
    return this.rangeBounds();
  }

  /** Journal-date reference for independent windows. All Time means today. */
  private briefingAsOf(): string {
    return periodAsOf(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
    );
  }

  /** The same journal-date boundary expressed as the Calendar/Score trading day. */
  private briefingTradingAsOf(): string {
    return tradingDayAtJournalDateEnd(this.briefingAsOf(), this.plugin.settings.timeZone);
  }

  filteredTrades(): Trade[] {
    this.ensureTradeCache();
    const cacheKey = `${this._accountIds.join(",")}|${this._accountTypes.join(",")}|${this.dateRange}|${this.customFrom}|${this.customTo}|${this.plugin.settings.timeZone}`;
    const hit = this._filteredCache.get(cacheKey);
    if (hit) return hit;
    const bounds = this.rangeBounds();
    if (!bounds) {
      this._filteredCache.set(cacheKey, []);
      return [];
    }
    // Period membership is judged on the SAME day key the buckets use, so a
    // trade can never be counted inside a period and plotted on another day.
    const dayBounds = periodDayBounds(bounds, this.plugin.settings.timeZone);
    const list = this.baseTrades()
      .filter((trade) => dateWithinPeriod(this.scoreDayKey(trade), dayBounds))
      .sort((a, b) => a.date.localeCompare(b.date));
    this._filteredCache.set(cacheKey, list);
    return list;
  }

  /** The selected journal-calendar window's as-of date, capped at today. */
  private asOfKey(): string {
    return periodAsOf(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
    );
  }

  /** Cached `journalDayKey` for the journal's zone — one day convention. */
  private _dayKeyZone: string | null = null;
  private _dayKey: (trade: Trade) => string = journalDayKey("");

  /** What a day is, shared with period filtering (lib/scope.ts). */
  private scoreDayKey(t: Trade): string {
    const zone = this.plugin.settings.timeZone;
    if (zone !== this._dayKeyZone) {
      this._dayKeyZone = zone;
      this._dayKey = journalDayKey(zone);
    }
    return this._dayKey(t);
  }

  private scoreAccountLabel(): string {
    if (this._accountIds.length) {
      const names = this._accountIds.map(
        (id) => this.plugin.settings.propAccounts.find((a) => a.id === id)?.name ?? "Selected account"
      );
      return names.length === 1 ? names[0] : `${names.length} accounts`;
    }
    if (this._accountTypes.length) {
      return this._accountTypes
        .map((id) => accountFilters().find((item) => item.id === id)?.label ?? id)
        .join(" + ");
    }
    return "All accounts";
  }

  /** Period change in the journal-recorded value of the selected accounts. */
  private remainingAccountPnl(): number {
    const accounts = this.plugin.settings.propAccounts ?? [];
    const included = accounts.filter((account) => {
      const noScope = !this._accountIds.length && !this._accountTypes.length;
      if (noScope) return this.plugin.settings.excludeDemosFromPortfolio === false || account.type !== "demo";
      if (this._accountIds.length && !this._accountIds.includes(account.id)) return false;
      if (this._accountTypes.length) {
        const liveOk = this._accountTypes.includes("live") && (account.type === "live" || account.type === "personal");
        if (!liveOk && !this._accountTypes.includes(account.type)) return false;
      }
      return true;
    });
    const bounds = this.rangeBounds();
    const asOf = this.asOfKey();
    const inPeriod = (date: string): boolean =>
      !!date && !!bounds && dateWithinPeriod(date, bounds) && date <= asOf;

    let remaining = 0;
    const accountIds = new Set(included.map((account) => account.id));
    for (const account of included) {
      for (const trade of this.trades) {
        if (!this.accountMatches(trade, account)) continue;
        if (account.createdAt && trade.date < account.createdAt) continue;
        if (inPeriod(trade.date)) remaining += netPnl(trade);
      }
    }
    for (const payout of this.plugin.settings.payouts ?? []) {
      if (accountIds.has(payout.accountId) && inPeriod(payout.date)) remaining -= Math.abs(payout.amount);
    }
    for (const deposit of this.plugin.settings.deposits ?? []) {
      if (accountIds.has(deposit.accountId) && inPeriod(deposit.date)) remaining += Math.abs(deposit.amount);
    }
    for (const adjustment of this.plugin.settings.feeAdjustments ?? []) {
      if (accountIds.has(adjustment.accountId) && inPeriod(adjustment.date) && Number.isFinite(adjustment.amount)) {
        remaining += adjustment.amount;
      }
    }
    return remaining;
  }

  private selectedPeriodLabel(): string {
    if (this.dateRange === "all") return "All Time";
    if (this.dateRange === "custom" && this.customFrom && this.customTo) {
      return `${formatDate(this.customFrom, this.plugin.settings.dateFormat)}–${formatDate(this.customTo, this.plugin.settings.dateFormat)}`;
    }
    return SCORE_PERIOD_LABELS[this.dateRange] ?? "Selected period";
  }

  /** Accounts overview population for Home's recorded-value widgets. */
  private homeAccounts(): PropAccount[] {
    const all = this.plugin.settings.propAccounts ?? [];
    const noScope = !this._accountIds.length && !this._accountTypes.length;
    if (noScope) {
      return this.plugin.settings.excludeDemosFromPortfolio === false
        ? all
        : all.filter((account) => account.type !== "demo");
    }
    return all.filter((account) => {
      if (this._accountIds.length && !this._accountIds.includes(account.id)) return false;
      if (this._accountTypes.length) {
        const liveOk = this._accountTypes.includes("live") && (account.type === "live" || account.type === "personal");
        if (!liveOk && !this._accountTypes.includes(account.type)) return false;
      }
      return true;
    });
  }

  /**
   * The Accounts overview's contract: recorded balance less configured capital.
   * This is all-time, and includes Net trades, payouts, deposits and signed
   * account adjustments. Keep its daily series from the same shared calculation
   * so the Home sparkline ends at the displayed value.
   */
  private homeAccountMovement(): HomeAccountMovement {
    if (this._homeAccountMovement) return this._homeAccountMovement;
    const accountTrades: Trade[] = [];
    const snapshots: HomeAccountSnapshot[] = [];
    const movementByDay = new Map<string, number>();
    let capital = 0;

    for (const account of this.homeAccounts()) {
      const trades = this.trades.filter((trade) => {
        if (!this.accountMatches(trade, account)) return false;
        // Membership on the journal day — the very key the movement below
        // buckets by, so a trade can never be counted in a day it was filtered
        // out of (or the reverse).
        return !account.createdAt || this.scoreDayKey(trade) >= account.createdAt;
      });
      const movement = computeRecordedAccountMovement({
        trades,
        size: account.size || 0,
        dayKey: (trade) => this.scoreDayKey(trade),
        cashflows: [
          ...this.plugin.payoutsFor(account.id).map((payout) => ({ date: payout.date, amount: -Math.abs(payout.amount) })),
          ...this.plugin.depositsFor(account.id).map((deposit) => ({ date: deposit.date, amount: Math.abs(deposit.amount) })),
          ...this.plugin.feeAdjustmentsFor(account.id).map((adjustment) => ({ date: adjustment.date, amount: adjustment.amount })),
        ],
      });
      capital += account.size || 0;
      accountTrades.push(...trades);
      snapshots.push({ account, balance: movement.balance, days: movement.days });
      for (const day of movement.days) {
        movementByDay.set(day.date, (movementByDay.get(day.date) ?? 0) + day.change);
      }
    }

    let cumulative = 0;
    const days = [...movementByDay.keys()].sort().map((date) => {
      const change = movementByDay.get(date) ?? 0;
      cumulative += change;
      return { date, change, cumulative };
    });
    this._homeAccountMovement = {
      accounts: snapshots,
      trades: accountTrades,
      capital,
      change: cumulative,
      days,
    };
    return this._homeAccountMovement;
  }

  private calendarInitialMonth(asOf: string, isHome: boolean): string | undefined {
    if (!isHome) return undefined;
    if (this.calendarManual && this.calendarMonth) return this.calendarMonth;
    const tradingDate = this.briefingTradingAsOf() || asOf;
    return `${tradingDate.slice(0, 7)}-01`;
  }

  private rememberCalendarMonth(monthKey: string): void {
    if (this.viewKey() !== "home") return;
    this.calendarMonth = monthKey;
    this.calendarManual = true;
    this.persistBriefingPeriod();
  }

  /**
   * The Trading Score sample: the latest 30 decisions up to the as-of date.
   * Used on BOTH pages, so the score is the same rolling metric everywhere
   * instead of being the period on one page and the recent window on the other.
   */
  private recentScoreInput(): { trades: Trade[]; label: string } {
    const isHome = this.viewKey() === "home";
    const today = todayKey(this.plugin.settings.timeZone);
    // Home follows the selected period and account scope; Analytics keeps the
    // selected period too. Both cap the sample at the latest 30 decisions.
    const source = isHome ? this.filteredTrades() : this.baseTrades();
    const recent = recentScoreWindow(source, {
      period: this.viewKey() === "home" ? "custom" : this.dateRange,
      customTo: this.customTo,
      today,
      asOf: isHome ? this.briefingTradingAsOf() : undefined,
      dayKey: (t) => this.scoreDayKey(t),
      weekStart: this.plugin.settings.weekStart,
    });
    const decisions = recent.trades.length;
    const scope = isHome ? this.selectedPeriodLabel() : `through ${formatDate(recent.asOf, "D MMM YYYY")}`;
    return {
      trades: recent.trades,
      label: `${decisions} trade${decisions === 1 ? "" : "s"} · ${scope} · ${this.scoreAccountLabel()}`,
    };
  }

  /** The previous window's inclusive bounds, capped at the as-of date — the
   *  same window `previousPeriodTrades` reads, for metrics sized by period. */
  private previousWindowBounds(): PeriodBounds | null {
    const bounds = previousPeriodBounds(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
      this.plugin.settings.weekStart ?? "monday",
    );
    if (!bounds) return null;
    const asOf = this.asOfKey();
    return { start: bounds.start, end: bounds.end && bounds.end < asOf ? bounds.end : asOf };
  }

  /** Trades from the previous window of the same length (for "vs prev" deltas). */
  previousPeriodTrades(): Trade[] {
    const bounds = this.previousWindowBounds();
    if (!bounds) return [];
    // Same day-key domain as filteredTrades, so current and baseline windows
    // bucket the same way (identity when the journal zone is New York).
    const dayBounds = periodDayBounds(bounds, this.plugin.settings.timeZone);
    return this.baseTrades().filter((trade) => dateWithinPeriod(this.scoreDayKey(trade), dayBounds));
  }

  /**
   * Calendar-derived Analytics comparison populations. Unlike Home's
   * legacy metric context, these bounds never depend on which trade dates happen
   * to be present in either window. The baseline bounds travel with the trades
   * so a period-sized metric measures both windows at their own length.
   */
  analyticsComparisonTrades(): {
    current: Trade[];
    baseline: Trade[];
    eligible: boolean;
    currentBounds: PeriodBounds | null;
    baselineBounds: PeriodBounds | null;
  } {
    const comparison = periodComparison(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
      this.plugin.settings.weekStart ?? "monday",
    );
    if (!comparison.eligible || !comparison.current || !comparison.baseline) {
      return {
        current: [],
        baseline: [],
        eligible: false,
        currentBounds: comparison.current ?? null,
        baselineBounds: comparison.baseline ?? null,
      };
    }
    const population = this.baseTrades();
    // Comparison bounds are journal-calendar dates; membership is judged on the
    // same trading-day key filteredTrades uses (identity in the default zone).
    const zone = this.plugin.settings.timeZone;
    const dayIn = (trade: Trade, window: PeriodBounds | null): boolean =>
      dateInComparison(this.scoreDayKey(trade), periodDayBounds(window, zone));
    return {
      current: population.filter((trade) => dayIn(trade, comparison.current)),
      baseline: population.filter((trade) => dayIn(trade, comparison.baseline)),
      eligible: true,
      currentBounds: comparison.current,
      baselineBounds: comparison.baseline,
    };
  }

  private formatMetricDelta(id: string, delta: number): string {
    return formatMetricDelta(id, delta);
  }

  ensureLayout(): void {
    const raw = this.layout() as any[] | undefined;
    if (!raw) {
      this.setLayout(this.defaultLayout());
      return;
    }
    if (raw.length === 0) {
      // User's explicit choice: an empty dashboard stays empty (add via Edit).
      this.setLayout([]);
      return;
    }
    const layout = raw;
    // (Migration removed: user has full manual control over layout)
    // Migration from the old flow format: {id, size, rows} -> {i, x, y, w, h}
    const isOld = layout.some((it) => it.id !== undefined || it.size !== undefined);
    if (isOld) {
      const conv = layout.map((it) => ({
        i: it.id,
        w: gClamp((it.size ?? 2) * 6, 1, GRID_COLS), // 1->6, 2->12, 3->18, 4->24
        h: it.rows === 2 ? 8 : it.id === "kpi" ? 2 : 4,
      }));
      // First-fit pack (left-to-right, top-to-bottom) then compact.
      const packed: GridItem[] = [];
      for (const c of conv) {
        let y = 0;
        outer: for (;;) {
          for (let x = 0; x + c.w <= GRID_COLS; x++) {
            if (!packed.some((p) => collides({ ...c, x, y } as GridItem, p))) {
              packed.push({ i: c.i, x, y, w: c.w, h: c.h });
              break outer;
            }
          }
          y++;
        }
      }
      this.setLayout(compactVertical(packed));
      this.setStoredGridCols(GRID_COLS);
      return;
    }
    // Migrate the old Analytics-only grid marker once. New edits store a column
    // count alongside each page's layout so narrow-window edits round-trip.
    if (this.viewKey() === "dashboard" && this.plugin.settings.dashboardGridCols === undefined && this.plugin.settings.gridCols !== GRID_COLS) {
      const oldCols = this.plugin.settings.gridCols || 12;
      const factor = GRID_COLS / oldCols;
      layout.forEach((it) => {
        if (!it) return;
        if (typeof it.x === "number") it.x = Math.round(it.x * factor);
        if (typeof it.w === "number") it.w = Math.max(1, Math.round(it.w * factor));
      });
      this.plugin.settings.gridCols = GRID_COLS;
      this.plugin.settings.dashboardGridCols = GRID_COLS;
      void this.plugin.saveSettings();
    }
    const savedCols = this.storedGridCols();
    // Deprecated ids are rewritten to their canonical replacement, so a saved
    // layout written before the rename keeps its tiles instead of losing them.
    layout.forEach((it) => {
      if (it && WIDGET_ID_ALIASES[it.i]) it.i = WIDGET_ID_ALIASES[it.i];
    });
    // Aliases can collapse several old ids onto one, so dedupe by id — keeping
    // the largest tile (the one the user likely resized), else the first seen.
    const byId = new Map<string, GridItem>();
    const areaOf = (it: GridItem): number => (it.w || 0) * (it.h || 0);
    for (const it of layout) {
      if (!it || !it.i) continue;
      const prev = byId.get(it.i);
      if (!prev || areaOf(it) > areaOf(prev)) byId.set(it.i, it);
    }
    const valid = this.allowedIds();
    const filtered = [...byId.values()].filter((it) => it && it.i && valid.has(it.i) && it.w && it.h);
    for (const it of filtered) {
      const min = this.minSize(it.i);
      it.w = gClamp(Math.round(it.w), Math.min(min.w, savedCols), savedCols);
      it.h = gClamp(Math.round(it.h), min.h, 60);
      it.x = gClamp(Math.round(it.x || 0), 0, savedCols - it.w);
      it.y = Math.max(0, Math.round(it.y || 0));
    }
    const hasCollisions = filtered.some((item, index) => filtered.slice(index + 1).some((other) => collides(item, other)));
    // Repair only invalid legacy geometry. Valid saved positions (including
    // intentional whitespace) are not repacked merely by opening the page.
    this.setLayout(hasCollisions ? compactVertical(filtered) : filtered);
  }

  /** Every metric (`m.*`) on Home belongs to the flex band, not the grid. */
  private isBandMetric(id: string): boolean {
    return this.viewKey() === "home" && id.startsWith("m.");
  }

  /** The band half of a stored layout, in reading order. */
  private bandEntries(layout: GridItem[]): GridItem[] {
    return layout.filter((it) => this.isBandMetric(it.i)).sort((a, b) => a.y - b.y || a.x - b.x);
  }

  /** The grid half of a stored layout — everything the grid engine owns. */
  private gridEntries(layout: GridItem[]): GridItem[] {
    return layout.filter((it) => !this.isBandMetric(it.i));
  }

  /**
   * Park band entries below the grid so they never enter collision/compaction.
   * `x` stays 0 and `y` steps per entry: band ids can be numerous, and distinct
   * `y` values keep them collision-free without relying on the 24-col span.
   */
  private layoutBand(band: GridItem[]): GridItem[] {
    return band.map((it, idx) => ({ ...it, x: 0, y: BAND_Y + idx, w: BAND_W, h: BAND_H }));
  }

  getLayout(): GridItem[] {
    if (this._visibleLayout && this._visibleCols === this.activeCols) return this._visibleLayout.map((item) => ({ ...item }));
    return this.gridEntries(this.storedLayout());
  }

  private minSize(id: string): { w: number; h: number } {
    const base = minOf(id);
    // Selected widgets can be taken one grid step narrower where their
    // responsive presentation still keeps the essential information readable.
    if (this.viewKey() === "home") {
      // Metrics: always compact — every metric card carries a 3×2 floor, the
      // size it is placed at (NEW_W/NEW_H), so a resize never clips one.
      if (id.startsWith("m.")) return { w: 3, h: 2 };
      const homeFloors: Record<string, { w: number; h: number }> = {
        calendar: { w: 4, h: 4 },
        heatmap: { w: 4, h: 3 },
        score: { w: 3, h: 4 },
        focus: { w: 4, h: 2 },
        accounts: { w: 4, h: 2 },
        payouts: { w: 3, h: 2 },
      };
      if (homeFloors[id]) return homeFloors[id];
    }
    return base;
  }

  saveLayout(): Promise<void> {
    return this.plugin.saveSettings().then(() => this.renderPreservingScroll());
  }

  /**
   * Persist a layout the DOM already reflects (drag/resize apply their trial
   * positions live), so committing does not rebuild every widget body.
   */
  private persistLayout(): Promise<void> {
    return this.plugin.saveSettings();
  }

  addWidget(id: string): void {
    // A fixed headline metric joins Home's band (appended, order-only); every
    // other widget goes through the grid engine.
    if (this.isBandMetric(id)) {
      const full = this.storedLayout();
      if (!full.some((it) => it.i === id)) {
        const band = this.layoutBand([...this.bandEntries(full), { i: id, x: 0, y: BAND_Y, w: BAND_W, h: BAND_H }]);
        this.setLayout([...this.gridEntries(full), ...band]);
      }
      this.saveLayout();
      return;
    }
    const isMetric = id.startsWith("m.");
    const min = this.minSize(id);
    const w = Math.min(this.activeCols, Math.max(min.w, NEW_W[id] ?? (isMetric ? 3 : 12)));
    const h = Math.max(min.h, NEW_H[id] ?? (isMetric ? 2 : 6));
    this.commitLayout(placeNew(this.getLayout(), id, w, h, this.activeCols));
    this.saveLayout();
  }

  removeWidget(id: string): void {
    if (this.isBandMetric(id)) {
      this.setLayout(this.storedLayout().filter((item) => item.i !== id));
      this.saveLayout();
      return;
    }
    this.commitLayout(compactVertical(this.getLayout().filter((item) => item.i !== id)));
    this.saveLayout();
  }

  // ---------------- Grid engine: pure layout helpers (lib/grid.ts) ----------------

  /** Scroll the dashboard when a drag/resize pointer nears the top/bottom edge. */
  private edgeAutoScroll(clientY: number): void {
    const main = this.mainEl;
    if (!main) return;
    const r = main.getBoundingClientRect();
    if (clientY > r.bottom - 70) main.scrollTop += 16;
    else if (clientY < r.top + 70) main.scrollTop -= 16;
  }

  private positionCard(card: HTMLElement, item: GridItem): void {
    card.style.left = `${item.x * (this.colW + GAP)}px`;
    card.style.top = `${item.y * (ROW_PX + GAP)}px`;
    card.style.width = `${item.w * this.colW + (item.w - 1) * GAP}px`;
    card.style.height = `${item.h * ROW_PX + (item.h - 1) * GAP}px`;
  }

  private showPlaceholder(item: GridItem): void {
    const p = this.placeholderEl;
    if (!p) return;
    p.style.display = "block";
    p.style.left = `${item.x * (this.colW + GAP)}px`;
    p.style.top = `${item.y * (ROW_PX + GAP)}px`;
    p.style.width = `${item.w * this.colW + (item.w - 1) * GAP}px`;
    p.style.height = `${item.h * ROW_PX + (item.h - 1) * GAP}px`;
  }

  private hidePlaceholder(): void {
    if (this.placeholderEl) this.placeholderEl.style.display = "none";
  }

  private gridRectLeft(): number {
    const r = this.gridEl?.getBoundingClientRect();
    return r ? r.left : 0;
  }

  private gridRectTop(): number {
    const r = this.gridEl?.getBoundingClientRect();
    return r ? r.top : 0;
  }

  /** Apply a trial layout to the DOM without re-rendering card content. */
  private applyTrialPositions(layout: GridItem[]): void {
    const grid = this.gridEl;
    if (!grid) return;
    this.setWorkingLayout(layout);
    for (const it of layout) {
      const card = this.cardEls.get(it.i);
      if (card) this.positionCard(card, it);
    }
    const rows = Math.max(1, gridRows(layout));
    grid.style.height = `${rows * ROW_PX + (rows - 1) * GAP}px`;
  }

  /**
   * Re-draw one widget body as its card changes size, so the JS-measured
   * compact/normal/expanded arrangement follows the resize live (CSS container
   * queries already adapt on their own). rAF-throttled and skipped when the size
   * is unchanged, so a drag frame never does redundant work.
   */
  private scheduleBodyRedraw(body: HTMLElement): void {
    const fn = this.bodyRenderers.get(body);
    if (!fn) return;
    const dims = `${body.clientWidth}x${body.clientHeight}`;
    if (this._lastBodyDims.get(body) === dims) return;
    this._lastBodyDims.set(body, dims);
    if (this._bodyRedrawRaf) cancelAnimationFrame(this._bodyRedrawRaf);
    this._bodyRedrawRaf = requestAnimationFrame(() => {
      this._bodyRedrawRaf = 0;
      fn();
    });
  }

  /** Drag preview and drop use the same collision resolution and compaction. */
  private applyDragTrial(nx: number, ny: number, item: GridItem, baseLayout: GridItem[]): GridItem[] {
    const trial = gridMove(baseLayout, item.i, nx, ny, true, this.activeCols);
    const grid = this.gridEl;
    if (!grid) return trial;
    for (const it of trial) {
      const card = this.cardEls.get(it.i);
      if (!card) continue;
      if (it.i === item.i) {
        card.addClass("tj-moving");
        this.showPlaceholder(it);
      } else {
        this.positionCard(card, it);
      }
    }
    const rows = Math.max(1, gridRows(trial));
    grid.style.height = `${rows * ROW_PX + (rows - 1) * GAP}px`;
    this.setWorkingLayout(trial);
    return trial;
  }

  // ---------------- Interactive drag (pointer based, iOS/Android widget style) ----------------

  private _dragGhost: HTMLElement | null = null;

  private bindCard(card: HTMLElement, item: GridItem): void {
    if (!this.editMode || item.static) return;
    card.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.button !== 0) return;
      this.startGridDrag(e, item);
    });
  }

  private startGridDrag(e: PointerEvent, item: GridItem): void {
    e.preventDefault();
    this._interacting = true;
    if (this._dragGhost) this._dragGhost.remove();
    this.dragId = item.i;
    const baseLayout = this.getLayout();
    const dragItem = baseLayout.find((candidate) => candidate.i === item.i);
    const card = this.findCardEl(this.gridEl as HTMLElement, item.i);
    if (!card || !dragItem) {
      this.dragId = null;
      this._interacting = false;
      return;
    }

    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add("tj-drag-ghost");
    ghost.removeAttribute("draggable");
    // The clone keeps the card's inline left/top (its absolute grid position).
    // Those inline styles beat the .tj-drag-ghost CSS, so the ghost stacked two
    // offsets and flew off. Reset them and position purely via transform.
    ghost.style.position = "fixed";
    ghost.style.left = "0";
    ghost.style.top = "0";
    ghost.style.margin = "0";
    ghost.style.width = `${card.offsetWidth || dragItem.w * this.colW}px`;
    ghost.style.height = `${card.offsetHeight || dragItem.h * ROW_PX}px`;
    document.body.appendChild(ghost);
    this._dragGhost = ghost;

    const rect = card.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    ghost.style.transform = `translate(${e.clientX - offX}px, ${e.clientY - offY}px)`;

    const snapPos = (clientX: number, clientY: number) => {
      // Align to the ghost's own top-left (the grab offset is preserved), so the
      // placeholder sits exactly under the floating card instead of centring the
      // card on the cursor (which made the two visibly disagree).
      const gx = clientX - offX - this.gridRectLeft();
      const gy = clientY - offY - this.gridRectTop();
      const nx = gClamp(Math.round(gx / (this.colW + GAP)), 0, this.activeCols - dragItem.w);
      const ny = Math.max(0, Math.round(gy / (ROW_PX + GAP)));
      return { nx, ny };
    };

    let latest = { x: e.clientX, y: e.clientY };
    let moveRaf = 0;
    let lastNx: number | null = null;
    let lastNy: number | null = null;
    const updateAt = (x: number, y: number, allowAutoScroll = true) => {
      if (allowAutoScroll) this.edgeAutoScroll(y);
      ghost.style.transform = `translate(${x - offX}px, ${y - offY}px)`;
      const { nx, ny } = snapPos(x, y);
      if (nx === lastNx && ny === lastNy) return;
      lastNx = nx;
      lastNy = ny;
      this.applyDragTrial(nx, ny, dragItem, baseLayout);
    };
    const onMove = (ev: PointerEvent) => {
      latest = { x: ev.clientX, y: ev.clientY };
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        updateAt(latest.x, latest.y);
      });
    };
    const finish = (x: number, y: number) => {
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
      }
      updateAt(x, y, false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      ghost.remove();
      this._dragGhost = null;
      this.dragId = null;
      this._interacting = false;
      this.hidePlaceholder();
      for (const current of baseLayout) this.cardEls.get(current.i)?.removeClass("tj-moving");
      const { nx, ny } = snapPos(x, y);
      const committed = gridMove(baseLayout, dragItem.i, nx, ny, true, this.activeCols);
      this.commitLayout(committed);
      void this.persistLayout();
    };
    const onUp = (ev: PointerEvent) => finish(ev.clientX, ev.clientY);
    const onCancel = () => finish(latest.x, latest.y);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  private findCardEl(grid: HTMLElement, id: string): HTMLElement | null {
    const cached = this.cardEls.get(id);
    if (cached) return cached;
    return Array.from(grid.querySelectorAll<HTMLElement>(".tj-gridcard")).find((el) => el.dataset.wid === id) ?? null;
  }

  // ---------------- Corner resize (edit mode) ----------------

  private bindResize(card: HTMLElement, item: GridItem): void {
    const handle = card.createDiv({ cls: "tj-resize-handle", attr: { "aria-label": "Drag to resize" } });
    attachTip(handle, { title: "Drag to resize", sub: "Corner only — the cards pack themselves." });
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._interacting = true;
      const baseLayout = this.getLayout();
      const resizeItem = baseLayout.find((candidate) => candidate.i === item.i);
      if (!resizeItem) {
        this._interacting = false;
        return;
      }
      const startX = e.clientX;
      const startY = e.clientY;
      const baseW = resizeItem.w;
      const baseH = resizeItem.h;
      const min = this.minSize(item.i);
      let curW = baseW;
      let curH = baseH;
      let latest = { x: startX, y: startY };
      let moveRaf = 0;
      let trial = baseLayout;
      let lastSize = `${baseW}x${baseH}`;
      const updateAt = (x: number, y: number, allowAutoScroll = true) => {
        if (allowAutoScroll) this.edgeAutoScroll(y);
        const dw = Math.round((x - startX) / (this.colW + GAP));
        const dh = Math.round((y - startY) / (ROW_PX + GAP));
        curW = gClamp(baseW + dw, min.w, this.activeCols - resizeItem.x);
        curH = gClamp(baseH + dh, min.h, 30);
        const size = `${curW}x${curH}`;
        if (size === lastSize) return;
        lastSize = size;
        trial = gridResize(baseLayout, item.i, curW, curH, min, true, this.activeCols);
        this.applyTrialPositions(trial);
        const me = this.cardEls.get(item.i);
        if (me) {
          // Keep the resized widget's own content in step with its new size.
          const body = me.querySelector(".tj-gridcard-body") as HTMLElement | null;
          if (body) this.scheduleBodyRedraw(body);
        }
      };
      const onMove = (ev: PointerEvent) => {
        latest = { x: ev.clientX, y: ev.clientY };
        if (moveRaf) return;
        moveRaf = requestAnimationFrame(() => {
          moveRaf = 0;
          updateAt(latest.x, latest.y);
        });
      };
      const finish = (x: number, y: number) => {
        if (moveRaf) {
          cancelAnimationFrame(moveRaf);
          moveRaf = 0;
        }
        updateAt(x, y, false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        this._interacting = false;
        if (this._bodyRedrawRaf) {
          cancelAnimationFrame(this._bodyRedrawRaf);
          this._bodyRedrawRaf = 0;
        }
        this.commitLayout(trial);
        void this.persistLayout();
      };
      const onUp = (ev: PointerEvent) => finish(ev.clientX, ev.clientY);
      const onCancel = () => finish(latest.x, latest.y);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    this._homeAccountMovement = null;
    this._visibleLayout = null;
    // Per-render memo tables; the trade list and its summaries are computed
    // once and read by every widget instead of once per widget.
    this._cacheTrades = null;
    this._countCache = new WeakMap();
    this._finCache = new WeakMap();
    this._drawnBodies = new WeakSet();
    this._idleQueue = [];
    this._idleScheduled = false;
    const main = renderAppShell(root, this.plugin, this.viewKey());
    this.mainEl = main;
    if (this._intro) root.addClass("tj-intro-root");
    root.addClass("tj-dashboard");
    root.addClass(this.viewKey() === "home" ? "tj-briefing" : "tj-analytics");
    root.toggleClass("tj-editing", this.editMode);
    main.addClass("tj-dash-main");

    const headerEl = this.renderHeader(main);
    this.headerEl = headerEl;
    // Smooth, decisive collapse: past a small scroll the header becomes a slim
    // bar (greeting hidden). Hysteresis prevents flicker/oscillation.
    let collapsed = false;
    let scrollRaf = 0;
    const applyScroll = () => {
      if (!this.headerEl) return;
      const top = main.scrollTop || 0;
      const next = collapsed ? top > 10 : top > 48;
      if (next !== collapsed) {
        collapsed = next;
        this.headerEl.toggleClass("tj-collapsed", collapsed);
      }
    };
    main.addEventListener(
      "scroll",
      () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          applyScroll();
        });
      },
      { passive: true }
    );
    applyScroll();

    const trades = this.filteredTrades();
    if (trades.length === 0) {
      // Home's independent widgets (Calendar, Last 6 Months, Trading Score
      // and Discipline) keep their own historical windows, so an empty selected
      // period still renders the grid — Breakdown, Payouts and the period
      // metrics simply show their own empty state. Analytics keeps its
      // page-level empty state.
      if (this.viewKey() === "home" && this.baseTrades().length > 0) {
        this.renderLayout(main, trades);
        return;
      }
      // Friendly empty state instead of a grid of zeros/dashes.
      this.renderEmptyState(main);
      if (this.editMode) this.renderLayout(main, trades);
      return;
    }
    this.renderLayout(main, trades);
  }

  /** Centered, friendly empty state with the two main calls to action. */
  renderEmptyState(main: HTMLElement): void {
    const acc = this._accountIds.length === 1
      ? this.plugin.settings.propAccounts.find((a) => a.id === this._accountIds[0])
      : undefined;
    const hasAny = this.trades.length > 0;
    const filterNote = acc
      ? `Filtered to “${acc.name}”.`
      : this._accountIds.length > 1
        ? `Filtered to ${this._accountIds.length} accounts.`
        : this._accountTypes.length
          ? `Filtered to ${this.scoreAccountLabel()}.`
          : undefined;
    renderEmptyBox(main, {
      title: hasAny ? "No trades in this period" : "No trading data available",
      sub: hasAny
        ? "Nothing matches the selected period or filters. Try a wider range, or add/import trades."
        : "Import your previous trades to explore your performance now, or record a new trade manually.",
      note: filterNote,
      primaryText: "Import existing trades",
      primaryIcon: "download",
      onPrimary: () => this.plugin.openImport(),
      secondaryText: "Add a trade manually",
      secondaryIcon: "plus",
      onSecondary: () => this.plugin.openAddPanel(),
    });
  }

  async onClose(): Promise<void> {
    window.removeEventListener("resize", this._onWinResize);
    if (this._resizeTimer) {
      window.clearTimeout(this._resizeTimer);
      this._resizeTimer = 0;
    }
    if (this.bodyObserver) {
      this.bodyObserver.disconnect();
      this.bodyObserver = null;
    }
  }

  /** The current hour in the Journal Timezone — the greeting speaks from the
   *  trader's zone, not this machine's. An unset zone means "as recorded", and
   *  then the host clock is the only clock the journal has. */
  private journalHour(): number {
    const zone = this.plugin.settings.timeZone;
    if (!zone) return new Date().getHours();
    const time = zoneWallParts(new Date(), zone).time;
    const hour = Number(time.slice(0, 2));
    return Number.isFinite(hour) ? hour : 0;
  }

  /** Time-of-day greeting (the journal's clock), using the name from settings. */
  private greetingText(): string {
    const h = this.journalHour();
    const part = h < 6 || h >= 22 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const name = (this.plugin.settings.journalName || "").trim();
    return name ? `${part}, ${name}` : part;
  }

  /**
   * A short line under the greeting. Calm and factual, never motivational
   * filler; drawn from a small pool per time of day so it changes day to day
   * but stays stable within a day (no flicker on re-render).
   */
  private greetingNote(): string {
    if (this.greetingNoteText) return this.greetingNoteText;
    const h = this.journalHour();
    const slot = h < 6 || h >= 22 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    const pools: Record<string, string[]> = {
      morning: [
        "A clean page for the session ahead.",
        "Quiet before the open.",
        "The day hasn't written itself yet.",
        "Everything starts on today's page.",
        "A good hour to set the day up.",
        "Fresh session, fresh notes.",
        "The pre-market is for thinking.",
        "Mark the levels before the bell.",
      ],
      afternoon: [
        "The session is in motion.",
        "Half the day is on the books.",
        "Midday, and the page is filling.",
        "The afternoon has its own rhythm.",
        "A good moment to check the plan.",
        "Keep the entries honest.",
        "Plenty of session left.",
        "The middle hours count too.",
      ],
      evening: [
        "The session is behind you.",
        "A good moment to review.",
        "What the day left on the page.",
        "The bell has rung — time to look back.",
        "Evening, and the notes are still fresh.",
        "The day is done; the record stays.",
        "A quiet close to the session.",
        "The page has the day on it now.",
      ],
      night: [
        "The market is closed.",
        "A quiet hour to look back.",
        "Rest soon — the journal can wait.",
        "Nothing is moving now; the day is on the page.",
        "Late hours. Keep it calm.",
        "The book is closed for the night.",
        "The tape is quiet; the record is not.",
        "A calm end to the day.",
      ],
    };
    const pool = pools[slot];
    this.greetingNoteText = pool[Math.floor(Math.random() * pool.length)];
    return this.greetingNoteText;
  }

  /** Home retains its greeting; both views surface the selected account result. */
  renderHeader(main: HTMLElement): HTMLElement {
    const header = main.createDiv({ cls: "tj-header" + (this._intro ? " tj-intro" : "") });

    const left = header.createDiv({ cls: "tj-header-greeting" });
    if (this.viewKey() === "home") {
      left.createDiv({ cls: "tj-header-greet", text: this.greetingText() });
      left.createDiv({ cls: "tj-header-sub", text: this.greetingNote() });
    } else {
      const pnl = this.remainingAccountPnl();
      const amount = left.createDiv({ cls: "tj-header-sub" });
      amount.setText(`Remaining P&L ${fmtMoney2(pnl)} · ${this.selectedPeriodLabel()} · ${this.scoreAccountLabel()}`);
      attachTip(amount, {
        title: "Remaining Account P&L",
        value: fmtMoney2(pnl),
        sub: "Recorded result remaining in the selected accounts after trading, fees, payouts and adjustments.",
      });
    }

    const actions = header.createDiv({ cls: "tj-header-actions" });

    // Time ranges — inline in the header, to the left of Filters, seamless.
    this.renderPeriodBar(actions);

    // Filters — plain icon, blends in with the rest of the UI.
    const fbtn = actions.createEl("button", {
      cls: "tj-filterbtn" + (this.filtersOpen ? " is-active" : ""),
      attr: { type: "button", "aria-label": "Filters" },
    });
    attachTip(fbtn, { title: "Filters", sub: "Accounts, direction, strategies and more." });
    setIcon(fbtn, "sliders-horizontal");
    fbtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.filtersOpen = !this.filtersOpen;
      this.widgetMenuOpen = false;
      this.periodMenuOpen = false;
      this.rerenderHeaderOnly();
    });

    // In edit mode, a labelled "Add widget" opens a dropdown that stays open,
    // so several widgets can be added in one go.
    if (this.editMode) {
      const abtn = actions.createEl("button", {
        cls: "tj-addwidget" + (this.widgetMenuOpen ? " is-active" : ""),
        attr: { type: "button", "aria-label": "Add widget" },
      });
      const aic = abtn.createSpan({ cls: "tj-btn-icon" });
      setIcon(aic, "plus");
      abtn.createSpan({ text: "Add widget" });
      abtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.widgetMenuOpen = !this.widgetMenuOpen;
        this.filtersOpen = false;
        this.periodMenuOpen = false;
        this.rerenderHeaderOnly();
      });
      attachTip(abtn, { title: "Add widget", sub: "Stays open — add as many as you like." });
      if (this.viewKey() === "home") {
        const lbtn = actions.createEl("button", {
          cls: "tj-addwidget" + (this.layoutsOpen ? " is-active" : ""),
          attr: { type: "button", "aria-label": "Layouts" },
        });
        const lic = lbtn.createSpan({ cls: "tj-btn-icon" });
        setIcon(lic, "layout-panel-left");
        lbtn.createSpan({ text: "Layouts" });
        lbtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.layoutsOpen = !this.layoutsOpen;
          this.widgetMenuOpen = false;
          this.filtersOpen = false;
          this.periodMenuOpen = false;
          this.rerenderHeaderOnly();
        });
        attachTip(lbtn, { title: "Layouts", sub: "Switch, copy, rename or reset your Home layouts." });
      }
    }

    // Edit layout toggle
    const ebtn = actions.createEl("button", {
      cls: "tj-iconbtn" + (this.editMode ? " is-active" : ""),
      attr: { type: "button", "aria-label": this.editMode ? "Done" : "Edit layout" },
    });
    setIcon(ebtn, this.editMode ? "check" : "pencil");
    attachTip(ebtn, {
      title: this.editMode ? "Done" : "Edit layout",
      sub: this.editMode ? "Leave edit mode." : "Move, resize and remove cards.",
    });
    ebtn.addEventListener("click", () => {
      this.editMode = !this.editMode;
      this.renderPreservingScroll();
      void this.plugin.saveSettings();
    });

    if (this.filtersOpen) this.renderFilterPopover(header);
    if (this.widgetMenuOpen) this.renderWidgetMenu(header);
    if (this.layoutsOpen && this.viewKey() === "home") this.renderLayoutsPopover(header);
    return header;
  }

  /**
   * Rebuild only the header (and its popovers) without touching the grid or its
   * widget bodies. Opening/closing a menu used to re-render every chart on the
   * page; this keeps the cost to the header alone.
   */
  private rerenderHeaderOnly(): void {
    const main = this.mainEl;
    const old = this.headerEl;
    if (!main || !old) {
      this.renderPreservingScroll();
      return;
    }
    const header = this.renderHeader(main);
    main.insertBefore(header, old);
    old.remove();
    this.headerEl = header;
  }

  /**
   * Re-render without throwing the reader back to the top.
   *
   * `render()` rebuilds the whole shell, so the page scroller (`.tj-app-main`,
   * held in `mainEl`) and the Add-widget popover scroller
   * (`.tj-widgetmenu-sections`) come back as new elements at scrollTop 0 — a
   * period change or a filter click would otherwise snap Home/Analytics to the
   * top. Both offsets are read before the rebuild and written back after;
   * content that got shorter simply clamps. Mirrors `renderPreservingDrawerScroll`
   * in `tradeLogView`.
   */
  private renderPreservingScroll(): void {
    const page = this.mainEl?.scrollTop ?? 0;
    const menu = this.contentEl.querySelector<HTMLElement>(".tj-widgetmenu-sections");
    const menuScroll = menu ? menu.scrollTop : null;
    this.render();
    if (this.mainEl) this.mainEl.scrollTop = page;
    const menuAfter = this.contentEl.querySelector<HTMLElement>(".tj-widgetmenu-sections");
    if (menuScroll !== null && menuAfter) menuAfter.scrollTop = menuScroll;
  }

  /** Dropdown list of addable widgets — stays open for multiple adds. */
  renderWidgetMenu(header: HTMLElement): void {
    const backdrop = header.createDiv({ cls: "tj-pop-backdrop" });
    backdrop.addEventListener("click", () => {
      this.widgetMenuOpen = false;
      this.rerenderHeaderOnly();
    });
    const pop = header.createDiv({ cls: "tj-popover tj-widgetmenu" });
    pop.addEventListener("click", (e) => e.stopPropagation());
    pop.createDiv({ cls: "tj-pop-section", text: "Add widget" });
    // A fixed headline metric lives in Home's band, so "already added" must
    // look at the whole stored layout, not the grid half of it.
    const present = new Set(this.storedLayout().map((i) => i.i));
    const ids = this.viewKey() === "home" ? HOME_WIDGET_MENU : [...this.allowedIds()];
    // Two sections only: every visual/process widget is a Chart, every `m.*` a
    // Metric. The Metrics section is grouped by question (see HOME_METRIC_MENU_GROUPS).
    const sections: Array<{ title: string; ids: string[] }> = [
      { title: "Charts", ids: [] },
      { title: "Metrics", ids: [] },
    ];
    for (const id of ids) sections[id.startsWith("m.") ? 1 : 0].ids.push(id);
    const emit = (list: HTMLElement, id: string): void => {
      const added = present.has(id);
      const item = list.createDiv({ cls: "tj-widgetmenu-item" + (added ? " is-added" : "") });
      const name = this.viewKey() === "home" && id === "m.netpnl"
        ? "P&L"
        : this.viewKey() === "home" && id === "score"
          ? "Score"
          : CARD_TITLES[id];
      item.createSpan({ cls: "tj-widgetmenu-name", text: name });
      if (added) item.createSpan({ cls: "tj-widgetmenu-check", text: "✓" });
      else item.addEventListener("click", () => this.addWidget(id));
    };
    const body = pop.createDiv({ cls: "tj-widgetmenu-sections" });
    for (const section of sections) {
      if (!section.ids.length) continue;
      const wrap = body.createDiv({ cls: "tj-widgetmenu-section" });
      const collapsed = this.widgetMenuCollapsed[section.title] === true;
      // The title is the collapse control: click to fold the whole section.
      const title = wrap.createEl("button", {
        cls: "tj-widgetmenu-section-title" + (collapsed ? " is-collapsed" : ""),
        attr: { type: "button", "aria-expanded": String(!collapsed) },
      });
      title.createSpan({ text: section.title });
      const caret = title.createSpan({ cls: "tj-widgetmenu-caret", attr: { "aria-hidden": "true" } });
      setIcon(caret, "chevron-down");
      title.addEventListener("click", () => {
        this.widgetMenuCollapsed[section.title] = !collapsed;
        this.rerenderHeaderOnly();
      });
      const sectionBody = wrap.createDiv({
        cls: "tj-widgetmenu-section-body" + (collapsed ? " is-collapsed" : ""),
      });
      if (this.viewKey() === "home" && section.title === "Metrics") {
        // Metrics read as a table of contents: Result → Trades → Streaks →
        // Risk → Timing → Days → Gross, each group under its own heading.
        for (const group of HOME_METRIC_MENU_GROUPS) {
          if (!group.ids.length) continue;
          sectionBody.createDiv({ cls: "tj-widgetmenu-subsection-title", text: group.title });
          const list = sectionBody.createDiv({ cls: "tj-widgetmenu-list" });
          for (const id of group.ids) emit(list, id);
        }
      } else {
        const list = sectionBody.createDiv({ cls: "tj-widgetmenu-list" });
        for (const id of section.ids) emit(list, id);
      }
    }
  }

  /** Home only: named layouts manager — switch, copy, rename, delete, restore. */
  renderLayoutsPopover(header: HTMLElement): void {
    const plugin = this.plugin;
    const backdrop = header.createDiv({ cls: "tj-pop-backdrop" });
    backdrop.addEventListener("click", () => {
      this.layoutsOpen = false;
      this.rerenderHeaderOnly();
    });
    const pop = header.createDiv({ cls: "tj-popover tj-layouts" });
    pop.addEventListener("click", (e) => e.stopPropagation());
    pop.createDiv({ cls: "tj-pop-section", text: "Home layouts" });

    const active = plugin.activeHomeLayoutName();
    const list = pop.createDiv({ cls: "tj-layouts-list" });
    for (const name of plugin.homeLayoutNames()) {
      const row = list.createDiv({ cls: "tj-layouts-row" + (name === active ? " is-active" : "") });
      if (this.editingLayout === name) {
        const input = row.createEl("input", {
          cls: "tj-layouts-rename",
          attr: { type: "text", value: name, "aria-label": `Rename ${name}` },
        });
        const commit = () => {
          const to = input.value.trim();
          if (to && to !== name) plugin.renameHomeLayout(name, to);
          this.editingLayout = null;
          void plugin.saveSettings();
          this.renderPreservingScroll();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            this.editingLayout = null;
            this.rerenderHeaderOnly();
          }
        });
        input.addEventListener("blur", commit);
        window.setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
        continue;
      }
      const check = row.createSpan({ cls: "tj-layouts-check", attr: { "aria-hidden": "true" } });
      check.setText(name === active ? "✓" : "");
      const pick = row.createEl("button", {
        cls: "tj-layouts-name",
        text: name,
        attr: { type: "button", "aria-pressed": String(name === active), "aria-label": `Show layout ${name}` },
      });
      pick.addEventListener("click", () => {
        if (plugin.setActiveHomeLayout(name)) {
          void plugin.saveSettings();
          this.layoutsOpen = false;
          this.renderPreservingScroll();
        }
      });
      const ren = row.createEl("button", {
        cls: "tj-layouts-act",
        attr: { type: "button", "aria-label": `Rename ${name}` },
      });
      setIcon(ren, "pencil");
      ren.addEventListener("click", () => {
        this.editingLayout = name;
        this.rerenderHeaderOnly();
      });
      const del = row.createEl("button", {
        cls: "tj-layouts-act is-danger",
        attr: { type: "button", "aria-label": `Delete ${name}` },
      });
      setIcon(del, "trash-2");
      del.addEventListener("click", () => {
        if (plugin.deleteHomeLayout(name)) {
          void plugin.saveSettings();
          this.renderPreservingScroll();
        }
      });
    }

    const form = pop.createDiv({ cls: "tj-layouts-form" });
    const input = form.createEl("input", {
      attr: { type: "text", placeholder: "New layout name", "aria-label": "New layout name" },
    });
    const add = form.createEl("button", {
      cls: "tj-actionbtn is-primary",
      text: "Save",
      attr: { type: "button", "aria-label": "Save the current layout under a new name" },
    });
    add.addEventListener("click", () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      if (plugin.duplicateHomeLayout(plugin.activeHomeLayoutName(), name)) {
        void plugin.saveSettings();
        this.renderPreservingScroll();
      } else {
        new Notice("That layout name already exists.");
        input.focus();
      }
    });

    const restore = pop.createEl("button", {
      cls: "tj-layouts-restore",
      text: "Restore foundation",
      attr: { type: "button" },
    });
    restore.addEventListener("click", () => {
      plugin.restoreHomeFoundation();
      void plugin.saveSettings();
      this.renderPreservingScroll();
    });
  }

  /** Seamless period bar, embedded under the header. */
  renderPeriodBar(main: HTMLElement): void {
    const bar = main.createDiv({ cls: "tj-periodbar" + (this._intro ? " tj-intro" : "") });
    if (this.viewKey() === "home") {
      for (const [id, label] of BRIEFING_SHORTCUTS) {
        const button = bar.createEl("button", {
          cls: "tj-pbtn" + (this.dateRange === id ? " active" : ""),
          text: label,
          attr: { type: "button", "aria-pressed": String(this.dateRange === id) },
        });
        button.addEventListener("click", () => this.selectBriefingPeriod(id));
      }
      const selectedMore = BRIEFING_MORE_PERIODS.find(([id]) => id === this.dateRange);
      const trigger = bar.createEl("button", {
        cls: "tj-pbtn tj-period-more-trigger" + (selectedMore || this.dateRange === "custom" ? " active" : ""),
        attr: {
          type: "button",
          "aria-expanded": String(this.periodMenuOpen),
          "aria-label": this.dateRange === "custom" && this.customFrom && this.customTo
            ? `More periods. Custom range ${formatDate(this.customFrom, this.plugin.settings.dateFormat)} to ${formatDate(this.customTo, this.plugin.settings.dateFormat)}`
            : selectedMore ? `More periods. Selected ${selectedMore[1]}` : "More periods",
        },
      });
      trigger.createSpan({ text: selectedMore?.[1] ?? (this.dateRange === "custom" ? "Custom" : "More periods") });
      if (this.dateRange === "custom" && this.customFrom && this.customTo) {
        trigger.createSpan({
          cls: "tj-period-more-range",
          text: this.customRangeSummary(),
        });
      }
      trigger.createSpan({ cls: "tj-period-more-chevron", text: "⌄", attr: { "aria-hidden": "true" } });
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        this.periodMenuOpen = !this.periodMenuOpen;
        this.customPickerOpen = false;
        this.periodValidation = "";
        this.filtersOpen = false;
        this.widgetMenuOpen = false;
        this.rerenderHeaderOnly();
      });
      if (this.periodMenuOpen) this.renderMorePeriodMenu(main);
      return;
    }

    // Analytics keeps its existing controls and independent view state.
    const ranges: [string, string][] = ["today", "yesterday", "thisweek", "1m", "thisquarter", "thisyear", "all", "custom"]
      .map((id) => [id, SCORE_PERIOD_LABELS[id]] as [string, string]);
    for (const [id, label] of ranges) {
      const b = bar.createEl("button", {
        cls: "tj-pbtn" + (this.dateRange === id ? " active" : ""),
        text: label,
        attr: { type: "button" },
      });
      b.addEventListener("click", () => {
        this.dateRange = id;
        if (id !== "custom") {
          this.customFrom = "";
          this.customTo = "";
        }
        this.renderPreservingScroll();
      });
    }
    if (this.dateRange === "custom") {
      const box = bar.createDiv({ cls: "tj-period-custom" });
      // The plugin's own date field, so the custom range follows the Date format
      // from Settings like every other date on screen.
      mountDateField(box, {
        value: this.customFrom,
        format: this.plugin.settings.dateFormat,
        className: "tj-period-date",
        zone: this.plugin.settings.timeZone,
        onChange: (iso) => {
          this.customFrom = iso;
          this.renderPreservingScroll();
        },
      });
      box.createSpan({ cls: "tj-pop-label", text: "→" });
      mountDateField(box, {
        value: this.customTo,
        format: this.plugin.settings.dateFormat,
        className: "tj-period-date",
        zone: this.plugin.settings.timeZone,
        onChange: (iso) => {
          this.customTo = iso;
          this.renderPreservingScroll();
        },
      });
    }
  }

  private renderMorePeriodMenu(host: HTMLElement): void {
    const backdrop = host.createDiv({ cls: "tj-pop-backdrop tj-period-more-backdrop" });
    backdrop.addEventListener("click", () => {
      this.periodMenuOpen = false;
      this.customPickerOpen = false;
      this.periodValidation = "";
      this.rerenderHeaderOnly();
    });
    const pop = host.createDiv({ cls: "tj-popover tj-period-more-menu" });
    pop.addEventListener("click", (event) => event.stopPropagation());
    pop.createDiv({ cls: "tj-pop-section", text: this.customPickerOpen ? "Custom range" : "More periods" });

    if (!this.customPickerOpen) {
      for (const [id, label] of BRIEFING_MORE_PERIODS) {
        const option = pop.createEl("button", {
          cls: "tj-period-more-option" + (this.dateRange === id ? " is-active" : ""),
          text: label,
          attr: { type: "button", "aria-pressed": String(this.dateRange === id) },
        });
        option.addEventListener("click", () => this.selectBriefingPeriod(id));
      }
      const custom = pop.createEl("button", {
        cls: "tj-period-more-option" + (this.dateRange === "custom" ? " is-active" : ""),
        text: this.dateRange === "custom" && this.customFrom && this.customTo
          ? `Custom · ${formatDate(this.customFrom, this.plugin.settings.dateFormat)} → ${formatDate(this.customTo, this.plugin.settings.dateFormat)}`
          : "Custom range…",
        attr: { type: "button", "aria-pressed": String(this.dateRange === "custom") },
      });
      custom.addEventListener("click", () => {
        this.customDraftFrom = this.customFrom;
        this.customDraftTo = this.customTo;
        this.customPickerOpen = true;
        this.periodValidation = "";
        this.rerenderHeaderOnly();
      });
      return;
    }

    const field = (label: string, value: string, update: (iso: string) => void): void => {
      const row = pop.createDiv({ cls: "tj-period-custom-row" });
      row.createEl("label", { cls: "tj-pop-label", text: label });
      const input = mountDateField(row, {
        value,
        format: this.plugin.settings.dateFormat,
        zone: this.plugin.settings.timeZone,
        calendarZIndex: 3200,
        onChange: update,
      });
      input.setAttr("aria-label", label);
      input.addEventListener("input", () => update(parseDateInput(input.value, this.plugin.settings.dateFormat)));
    };
    field("From", this.customDraftFrom, (iso) => { this.customDraftFrom = iso; });
    field("To", this.customDraftTo, (iso) => { this.customDraftTo = iso; });
    if (this.periodValidation) pop.createDiv({ cls: "tj-period-validation", text: this.periodValidation });
    const actions = pop.createDiv({ cls: "tj-period-custom-actions" });
    const cancel = actions.createEl("button", { cls: "tj-actionbtn", text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => {
      this.periodMenuOpen = false;
      this.customPickerOpen = false;
      this.periodValidation = "";
      this.rerenderHeaderOnly();
    });
    const apply = actions.createEl("button", { cls: "tj-actionbtn is-primary", text: "Apply", attr: { type: "button" } });
    apply.addEventListener("click", () => {
      if (!this.customDraftFrom || !this.customDraftTo) {
        this.periodValidation = "Choose both dates to apply this range.";
        this.rerenderHeaderOnly();
        return;
      }
      if (!isValidIsoDate(this.customDraftFrom) || !isValidIsoDate(this.customDraftTo) || this.customDraftFrom > this.customDraftTo) {
        this.periodValidation = "Enter a valid range with From on or before To.";
        this.rerenderHeaderOnly();
        return;
      }
      this.selectBriefingPeriod("custom", this.customDraftFrom, this.customDraftTo);
    });
  }

  private customRangeSummary(): string {
    const from = formatDate(this.customFrom, "D MMM YYYY");
    const to = formatDate(this.customTo, "D MMM YYYY");
    if (this.customFrom.slice(0, 4) !== this.customTo.slice(0, 4)) return `${from}–${to}`;
    const shortFrom = from.replace(/ \d{4}$/, "");
    return `${shortFrom}–${to}`;
  }

  renderLayout(root: HTMLElement, trades: Trade[]): void {
    // Money (every leg) drives the P&L; the counted list drives win rates and
    // trade counts — so a copied trade never tips a widget twice.
    const counted = this.countsList(trades);
    // The Trading Score always uses the recent-30 window, on both pages, so the
    // number is identical in Home and Analytics.
    const recentScore = this.recentScoreInput();
    // Home widgets with their own windows. The global date filter sets the
    // as-of boundary, not the start: the Calendar and Last 6 Months keep their
    // own look-back, independent of the selected range. Discipline follows the
    // selected range (like Breakdown and Payouts).
    const isHome = this.viewKey() === "home";
    const asOf = this.asOfKey();
    const homeTradingAsOf = isHome ? this.briefingTradingAsOf() : asOf;
    const homeBase = isHome
      ? this.baseTrades().filter((t) => {
          // Both bounds are journal days (`asOfKey`/`briefingTradingAsOf`), so
          // membership has to be judged on that same key.
          const day = this.scoreDayKey(t);
          return day <= asOf && day <= homeTradingAsOf;
        })
      : null;
    const homeCounted = homeBase ? this.countsList(homeBase) : null;
    const comparison = isHome ? null : this.analyticsComparisonTrades();

    // Home splits its layout the classic way: the fixed headline metrics
    // render in a CSS flex band above the grid, everything else in the grid.
    // Storage stays a single array (no schema change); the band is derived here.
    const stored = this.storedLayout();
    const bandItems = this.bandEntries(stored);
    const storedGrid = compactVertical(this.gridEntries(stored));
    const prevTrades = comparison ? comparison.baseline : this.previousPeriodTrades();

    // The band sits above the grid in the DOM, so build it first.
    if (bandItems.length) {
      this.renderMetricsBand(root, bandItems, trades, prevTrades, comparison ?? undefined);
    }

    const grid = root.createDiv({ cls: "tj-grid tj-grid-abs" });
    grid.toggleClass("is-editing", this.editMode);
    this.gridEl = grid;
    this.cardEls.clear();

    // Responsive: keep cards at a readable minimum width by re-flowing into
    // fewer columns (grows downward) instead of shrinking everything.
    //
    // A leaf that is not on screen reports zero width; guessing one here (the old
    // DESIGN_W fallback) reflowed the grid into an arrangement the user never
    // chose and painted it in absolute pixels until the next measurable render.
    // With nothing to measure, the column count and card width already on screen
    // are kept; the saved layout is still converted to those columns (an identity
    // when the saved columns match), so a layout edited while hidden still shows.
    // A real width arrives through onResize once the leaf is shown again.
    const measuredW = Math.max(grid.clientWidth, root.clientWidth);
    if (measuredW > 0) {
      const gridW = grid.clientWidth || Math.max(240, measuredW - 40);
      const cols = columnCount(gridW);
      this.activeCols = cols;
      this.colW = Math.max(24, (gridW - GAP * (cols - 1)) / cols);
    } else {
      this.activeCols = this._lastPainted?.cols ?? this.storedGridCols();
      const fallbackW = Math.max(240, DESIGN_W - 40);
      this.colW =
        this._lastPainted?.colW ?? Math.max(24, (fallbackW - GAP * (this.activeCols - 1)) / this.activeCols);
    }
    this.setWorkingLayout(this.layoutForViewport(storedGrid, this.storedGridCols(), this.activeCols));
    if (this._visibleLayout) {
      this._lastPainted = {
        layout: this._visibleLayout.map((item) => ({ ...item })),
        cols: this.activeCols,
        colW: this.colW,
      };
    }
    const layout = this.getLayout();

    if (bandItems.length === 0 && layout.length === 0) {
      const page = this.viewKey() === "home" ? "Home" : "Analytics";
      grid.createDiv({ cls: "tj-empty", text: `${page} is empty — press the pencil, then “Add widget”.` });
      return;
    }
    // A band-only Home (every grid widget removed) leaves no empty grid well.
    if (layout.length === 0) grid.addClass("is-empty");
    const rows = Math.max(1, gridRows(layout));
    grid.style.height = `${rows * ROW_PX + (rows - 1) * GAP}px`;

    if (this.editMode) {
      this.placeholderEl = grid.createDiv({ cls: "tj-grid-placeholder" });
      this.placeholderEl.style.display = "none";
    }

    // Reset the auto-adjust engine for this render.
    if (this.bodyObserver) this.bodyObserver.disconnect();
    this.bodyRenderers.clear();
    this._pendingResize.clear();
    if (typeof ResizeObserver !== "undefined") {
      this.bodyObserver = new ResizeObserver((entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          // Generic size classes: every widget can adapt its content in CSS.
          const h = el.clientHeight;
          el.toggleClass("is-short", h > 0 && h < 150);
          el.toggleClass("is-tiny", h > 0 && h < 90);
          // Suppress content re-draws while a drag/resize is in progress — the
          // pointerup commit re-renders once instead of on every move.
          if (this._interacting) continue;
          // Ignore the first layout pass — it would cancel the intro animations.
          if (Date.now() < this._introUntil) continue;
          // A body that has not drawn yet is handled by the idle queue.
          if (!this._drawnBodies.has(el)) continue;
          this._pendingResize.add(el);
        }
        if (this._interacting) return;
        if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
        this._resizeRaf = requestAnimationFrame(() => {
          this._resizeRaf = 0;
          const targets = [...this._pendingResize];
          this._pendingResize.clear();
          for (const el of targets) {
            const fn = this.bodyRenderers.get(el);
            if (fn) fn();
          }
        });
      });
    }

    const pendingDraws: Array<{ card: HTMLElement; draw: () => void }> = [];
    let introIdx = 0;
    for (const item of layout) {
      const card = grid.createDiv({ cls: "tj-card tj-gridcard", attr: { "data-wid": item.i } });
      // Charts blend into the dashboard background (no card box / border).
      if (
        item.i === "netpnl" ||
        item.i === "longpnl" ||
        item.i === "shortpnl" ||
        item.i === "calendar"
      ) {
        card.addClass("tj-blend");
      }
      if (this._intro) {
        card.addClass("tj-intro");
        card.style.animationDelay = `${introIdx * 30}ms`;
      }
      introIdx++;
      this.cardEls.set(item.i, card);
      this.positionCard(card, item);
      if (item.static) card.addClass("tj-static");
      this.bindCard(card, item);
      // Headerless widgets (the chart + individual metrics): content fills the card.
      const headerless =
        item.i === "netpnl" || item.i === "longpnl" || item.i === "shortpnl" || item.i === "calendar" || item.i.startsWith("m.");
      if (headerless) {
        const body = card.createDiv({
          cls: "tj-gridcard-body tj-scale" + (item.i.startsWith("m.") ? " tj-metric-body" : ""),
        });
        const drawHeadless = () => {
          this._drawnBodies.add(body);
          body.empty();
          try {
            if (item.i === "netpnl") this.renderEquityBody(body, trades, undefined, "analytics-net-pnl");
            else if (item.i === "longpnl") this.renderEquityBody(body, trades, "long");
            else if (item.i === "shortpnl") this.renderEquityBody(body, trades, "short");
            else if (item.i === "calendar")
              new PerformanceCalendarWidget(body, isHome ? (homeBase as Trade[]) : trades, {
                summarize: (list) => this.financialsFor(list),
                initialMonth: this.calendarInitialMonth(asOf, isHome),
                todayKey: isHome ? dateInZone(this.plugin.settings.timeZone) : undefined,
                onMonthChange: isHome ? (month) => this.rememberCalendarMonth(month) : undefined,
                onDayClick: (dateKey) => void this.openDayInTradeLog(dateKey),
                animate: this._intro && this.plugin.settings.animations !== false,
                dateFormat: this.plugin.settings.dateFormat,
                showWeekends: this.plugin.settings.showWeekends === true,
                weekStart: this.plugin.settings.weekStart,
              });
            else this.renderMetricBody(body, trades, item.i, prevTrades, comparison ?? undefined);
          } catch (err) {
            console.error("[tradebook] card failed:", item.i, err);
            body.empty();
            body.createDiv({ cls: "tj-empty", text: `"${CARD_TITLES[item.i]}" had a problem.` });
          }
        };
        this.bodyRenderers.set(body, drawHeadless);
        pendingDraws.push({ card, draw: drawHeadless });
        this.bodyObserver?.observe(body);
        if (this.editMode) {
          const del = card.createEl("button", { cls: "tj-card-del", text: "✕", attr: { type: "button", "aria-label": "Remove card" } });
          del.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
          // Metrics are never resizable (band items never reach the grid; the
          // guard also covers the Analytics path). Charts keep their handle.
          if (!item.i.startsWith("m.")) this.bindResize(card, item);
        }
        continue;
      }
      const header = card.createDiv({ cls: "tj-card-header" });
      header.createEl("h3", {
        text: isHome && item.i === "score" ? "Score" : CARD_TITLES[item.i],
      });
      if (this.editMode) {
        const controls = header.createDiv({ cls: "tj-card-controls" });
        const b = controls.createEl("button", { text: "✕", cls: "tj-mini tj-del", attr: { type: "button", "aria-label": "Remove card" } });
        b.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
        // Metrics are never resizable; every other grid widget is.
        if (!item.i.startsWith("m.")) this.bindResize(card, item);
      }
      const body = card.createDiv({ cls: "tj-gridcard-body " + (SCROLL_WIDGETS.has(item.i) ? "tj-scroll" : "tj-scale") });
      const drawBody = () => {
        this._drawnBodies.add(body);
        body.empty();
        try {
          switch (item.i) {
            case "netpnl": this.renderEquityBody(body, trades, undefined, "analytics-net-pnl"); break;
            case "breakdown": this.renderBreakdownWidget(body, trades, header); break;
            case "rmultiples": this.renderRMultiplesWidget(body, trades, header); break;
            case "score": this.renderScoreWidget(body, recentScore.trades, recentScore.label, header); break;
            case "heatmap": this.renderHeatmap(body, homeBase ?? trades, homeCounted ?? counted, isHome ? asOf : undefined, header); break;
            case "focus": this.renderFocusAreasWidget(body, trades, header); break;
            case "accounts": this.renderAccountsPreviewWidget(body, header); break;
            case "trends": this.renderTrendsWidget(body, trades, header, item.h); break;
            case "payouts": this.renderPayoutsWidget(body); break;
            case "costs": this.renderCostsWidget(body, trades, prevTrades); break;
            case "drawdown": this.renderDrawdownWidget(body); break;
            case "size": this.renderPositionSizeWidget(body, trades); break;
            case "revenge": this.renderRevengeWidget(body, trades); break;
            case "tilt": this.renderTiltWidget(body, trades, prevTrades, counted); break;
            case "tags": this.renderBehavioralTagsWidget(body, trades, header); break;
            case "calendar":
              new PerformanceCalendarWidget(body, isHome ? (homeBase as Trade[]) : trades, {
                summarize: (list) => this.financialsFor(list),
                initialMonth: this.calendarInitialMonth(asOf, isHome),
                todayKey: isHome ? dateInZone(this.plugin.settings.timeZone) : undefined,
                onMonthChange: isHome ? (month) => this.rememberCalendarMonth(month) : undefined,
                onDayClick: (dateKey) => void this.openDayInTradeLog(dateKey),
                animate: this._intro && this.plugin.settings.animations !== false,
                dateFormat: this.plugin.settings.dateFormat,
                showWeekends: this.plugin.settings.showWeekends === true,
              });
              break;
          }
        } catch (err) {
          console.error("[tradebook] card failed:", item.i, err);
          body.empty();
          body.createDiv({ cls: "tj-empty", text: `"${CARD_TITLES[item.i]}" had a problem — tap Edit to remove it.` });
        }
      };
      this.bodyRenderers.set(body, drawBody);
      pendingDraws.push({ card, draw: drawBody });
      this.bodyObserver?.observe(body);
    }
    this.flushBodyDraws(pendingDraws);
    if (this._intro) {
      this._intro = false;
      this._introUntil = Date.now() + 1000;
      // After the intro, re-draw once so any widget that was measured before
      // the layout settled gets the correct size (animations won't replay).
      window.setTimeout(() => {
        for (const fn of this.bodyRenderers.values()) fn();
      }, 1100);
    }
  }

  /**
   * Draw the widgets on screen now, and the rest on idle. A dashboard with many
   * widgets used to render every body in one synchronous block; this keeps the
   * first paint immediate and lets the off-screen ones fill in within a frame.
   */
  private flushBodyDraws(draws: Array<{ card: HTMLElement; draw: () => void }>): void {
    if (!draws.length) return;
    const vh = this.mainEl?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 800);
    const idle: Array<() => void> = [];
    for (const entry of draws) {
      const rect = entry.card.getBoundingClientRect();
      if (rect.bottom > -240 && rect.top < vh + 240) entry.draw();
      else idle.push(entry.draw);
    }
    if (!idle.length) return;
    this._idleQueue.push(...idle);
    if (this._idleScheduled) return;
    this._idleScheduled = true;
    const run = (deadline?: { timeRemaining?: () => number } | null) => {
      const started = Date.now();
      while (this._idleQueue.length) {
        if (deadline && typeof deadline.timeRemaining === "function") {
          if (deadline.timeRemaining() <= 4) break;
        } else if (Date.now() - started > 8) break;
        const fn = this._idleQueue.shift();
        if (fn) fn();
      }
      if (this._idleQueue.length) {
        const ric = (window as any).requestIdleCallback;
        if (typeof ric === "function") ric(run);
        else window.setTimeout(() => run(null), 0);
      } else {
        this._idleScheduled = false;
      }
    };
    const ric = (typeof window !== "undefined") && (window as any).requestIdleCallback;
    if (typeof ric === "function") ric(run);
    else window.setTimeout(() => run(null), 0);
  }

  /** Cumulative P&L — chart only. Hover shows the running total. */
  renderEquityBody(body: HTMLElement, trades: Trade[], dir?: "long" | "short", chartKey?: string): void {
    const list = dir ? trades.filter((t) => (t.direction || "").toLowerCase() === dir) : trades;
    const wrap = body.createDiv({ cls: "tj-eq" });
    const chart = wrap.createDiv({ cls: "tj-eq-chart" });
    const financials = this.financialsFor(list);
    if (list.length) this.drawEquityChart(chart, list, chartKey ?? dir ?? "equity", financials);
    else chart.createDiv({ cls: "tj-chart-empty", text: "No data" });
    // Tiny, unobtrusive title — added after drawing so the
    // chart's container.empty() does not wipe it.
    const title = dir === "long" ? "Long Net Trading P&L" : dir === "short" ? "Short Net Trading P&L" : "Net Trading P&L";
    const titleEl = wrap.createDiv({ cls: "tj-eq-title", text: title });
    attachTip(titleEl, {
      title,
      sub: `Trading results after fees. Payouts and adjustments do not change trade results.${this.incompleteCostNote(financials)}`,
    });
  }

  /** Lightweight count up/down when a metric value changes. */
  private animateNumber(el: HTMLElement, id: string, from: number, to: number, target: string): void {
    const reduced =
      this.plugin.settings.animations === false ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const fmt = metricFormatter(target);
    if (reduced || Math.abs(to - from) < 1e-9) {
      el.textContent = target;
      this.metricDisplay.set(id, to);
      return;
    }
    const prevRaf = this._tweens.get(id);
    if (prevRaf) cancelAnimationFrame(prevRaf);
    const dur = 850;
    const steps = 22;
    const start = performance.now();
    let last = -1;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      const value = from + (to - from) * e;
      const step = Math.floor(e * steps);
      if (step !== last || t >= 1) {
        last = step;
        el.textContent = fmt(value);
        this.metricDisplay.set(id, value);
      }
      if (t < 1) this._tweens.set(id, requestAnimationFrame(tick));
      else {
        el.textContent = target;
        this.metricDisplay.set(id, to);
        this._tweens.delete(id);
      }
    };
    this._tweens.set(id, requestAnimationFrame(tick));
  }

  private costCoverageWarning(financials: FinancialSummary): string {
    const { missingCommission, missingFees } = financials.costCoverage;
    if (!financials.eligibleLegCount || (!missingCommission && !missingFees)) return "";
    return " Some trade cost data is missing.";
  }

  private incompleteCostNote(financials: FinancialSummary): string {
    if (!financials.eligibleLegCount) return " No closed trades in this selection.";
    return this.costCoverageWarning(financials);
  }

  /**
   * Home's headline band: the fixed-text metrics as flex slots, not grid cards.
   * The slot keeps `data-wid` and a `tj-gridcard-body tj-metric-body` so the
   * metric CSS, tooltips and tests that address a widget by `data-wid` all keep
   * working. In edit mode a slot can be dragged (the whole card is the handle)
   * and reordered from the keyboard (WCAG 2.2 SC 2.5.7) — never resized.
   */
  renderMetricsBand(
    root: HTMLElement,
    bandItems: GridItem[],
    trades: Trade[],
    prevTrades: Trade[],
    comparison?: { current: Trade[]; baseline: Trade[]; eligible: boolean; baselineBounds?: PeriodBounds | null },
  ): void {
    const band = root.createDiv({
      cls: "tj-metrics-band" + (this.editMode ? " is-editing" : ""),
      attr: { role: "list" },
    });
    this._bandEl = band;
    // Polite announcer for keyboard reordering (focus has no visual movement).
    this._bandLive = band.createDiv({ cls: "tj-sr-only", attr: { "aria-live": "polite" } });
    for (const item of bandItems) {
      const label = METRIC_TITLES[item.i] ?? CARD_TITLES[item.i] ?? item.i;
      const slot = band.createDiv({
        cls: "tj-metric-slot",
        attr: { "data-wid": item.i, role: "listitem", "aria-label": label },
      });
      const body = slot.createDiv({ cls: "tj-gridcard-body tj-metric-body" });
      try {
        this.renderMetricBody(body, trades, item.i, prevTrades, comparison);
      } catch (err) {
        console.error("[tradebook] metric failed:", item.i, err);
        body.empty();
        body.createDiv({ cls: "tj-empty", text: `"${CARD_TITLES[item.i]}" had a problem.` });
      }
      if (this.editMode) {
        slot.tabIndex = 0;
        this.bindBandDrag(slot, band);
        slot.addEventListener("keydown", (e) => {
          const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
          const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
          if (!back && !forward) return;
          e.preventDefault();
          this.moveBandItem(item.i, back ? -1 : 1);
        });
        const del = slot.createEl("button", { cls: "tj-card-del", text: "✕", attr: { type: "button", "aria-label": "Remove metric" } });
        del.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
      }
    }
  }

  /** Drag the whole band card to reorder it (edit mode). Pointer only; the
   *  keyboard path is `moveBandItem`, so the drag always has a non-drag twin. */
  private bindBandDrag(slot: HTMLElement, band: HTMLElement): void {
    slot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const slots = Array.from(band.querySelectorAll<HTMLElement>(".tj-metric-slot"));
      slot.addClass("is-dragging");
      const onMove = (ev: PointerEvent) => {
        const target = slots.find((el) => {
          const r = el.getBoundingClientRect();
          return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        });
        if (!target || target === slot) return;
        const current = Array.from(band.querySelectorAll<HTMLElement>(".tj-metric-slot"));
        const from = current.indexOf(slot);
        const to = current.indexOf(target);
        if (from < 0 || to < 0 || from === to) return;
        if (to > from) band.insertBefore(slot, target.nextSibling);
        else band.insertBefore(slot, target);
      };
      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        slot.removeClass("is-dragging");
        const ids = Array.from(band.querySelectorAll<HTMLElement>(".tj-metric-slot")).map((el) => el.dataset.wid || "");
        this.applyBandOrder(ids);
        void this.plugin.saveSettings();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    });
  }

  /** Move a band card one slot left/right from the keyboard, keeping focus. */
  private moveBandItem(id: string, delta: number): void {
    const band = this._bandEl;
    if (!band) return;
    const slots = Array.from(band.querySelectorAll<HTMLElement>(".tj-metric-slot"));
    const from = slots.findIndex((el) => el.dataset.wid === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(slots.length - 1, from + delta));
    if (to === from) return;
    const slot = slots[from];
    const target = slots[to];
    if (to > from) band.insertBefore(slot, target.nextSibling);
    else band.insertBefore(slot, target);
    const ids = Array.from(band.querySelectorAll<HTMLElement>(".tj-metric-slot")).map((el) => el.dataset.wid || "");
    this.applyBandOrder(ids);
    void this.plugin.saveSettings();
    slot.focus();
    if (this._bandLive) this._bandLive.setText(`Moved ${METRIC_TITLES[id] ?? id} to position ${to + 1} of ${slots.length}`);
  }

  /** Persist a band reading order into the single stored layout array. */
  private applyBandOrder(orderedIds: string[]): void {
    const stored = this.storedLayout();
    const band = this.bandEntries(stored);
    const byId = new Map(band.map((it) => [it.i, it]));
    const ordered: GridItem[] = [];
    for (const id of orderedIds) {
      const it = byId.get(id);
      if (it) {
        ordered.push(it);
        byId.delete(id);
      }
    }
    for (const it of byId.values()) ordered.push(it);
    this.setLayout([...this.gridEntries(stored), ...this.layoutBand(ordered)]);
  }

  /** One metric per widget. */
  renderMetricBody(
    body: HTMLElement,
    trades: Trade[],
    id: string,
    prevTrades: Trade[] = [],
    comparison?: { current: Trade[]; baseline: Trade[]; eligible: boolean; baselineBounds?: PeriodBounds | null },
  ): void {
    const def = metricById(id);
    // One day convention, shared with the period filter (lib/scope.ts).
    const dayKey = (t: Trade): string => this.scoreDayKey(t);
    // Every Home metric is band text-only: CSS owns the type and spacing. Home is
    // the only view left, so every `m.*` reaches the band — the fixed-text class
    // is unconditional.
    const wrap = body.createDiv({ cls: "tj-metric is-fixed-text" });
    const labelText = def?.label ?? CARD_TITLES[id] ?? id;
    const labelEl = wrap.createDiv({ cls: "tj-metric-label", text: labelText });
    const val = wrap.createDiv({ cls: "tj-metric-value" });
    const financials = this.financialsFor(trades);
    const counted = PER_TRADE_METRICS.has(id) ? this.countsList(trades) : trades;
    const calculated = def
      ? def.compute(counted, dayKey, financials, this.plugin.settings.timeZone)
      : { value: "—", tone: "neutral" as const };
    const factor = financials.net.profitFactor;
    const missingFactor = id === "m.profitfactor" && this.viewKey() === "home" &&
      (!financials.decisions.length || (!Number.isFinite(factor) && factor !== Infinity));
    const res = missingFactor ? { value: "—", tone: "neutral" as const } : calculated;
    const financialTips: Record<string, string> = {
      "m.netpnl": "Trading result after commission and fees. Payouts and deposits are not trading results.",
      "m.profitfactor": "Net trading profit factor for this selection.",
      "m.grossprofitfactor": "Gross trading profit factor before fees.",
      "m.expectancy": "Average Net Trading P&L per trade.",
      "m.bestday": "Best daily Net Trading P&L.",
      "m.worstday": "Worst daily Net Trading P&L.",
      "m.avgwin": "Average Net result of winning trades.",
      "m.avgloss": "Average Net loss of losing trades.",
      "m.winhold": "Average hold time of winning decisions (after costs).",
      "m.losshold": "Average hold time of losing decisions (after costs).",
      "m.largestwin": "Largest Net result of a single account leg.",
      "m.largestloss": "Largest Net loss of a single account leg.",
      "m.maxdd": "Largest drawdown in Net Trading P&L.",
      "m.sharpe": "Sharpe ratio using Net Trading P&L.",
      "m.besthour": "Hour with the highest Net Trading P&L.",
      "m.worsthour": "Hour with the lowest Net Trading P&L.",
      "m.winrate": "Share of decided trades that ended Net positive; breakevens excluded.",
      "m.winstreak": "Longest run of Net-positive decisions; breakevens pause, never break.",
      "m.lossstreak": "Longest run of Net-negative decisions; breakevens pause, never break.",
    };
    // The rest of the catalogue: every metric a reader can add gets a one-line
    // definition, so a label alone is never the only explanation (§4).
    const moreTips: Record<string, string> = {
      "m.trades": "Closed eligible decisions; copied legs aggregated.",
      "m.wintrades": "Decisions that ended Net positive, aggregated across the in-scope account legs.",
      "m.losstrades": "Decisions that ended Net negative, aggregated across the in-scope account legs.",
      "m.holdtime": "Average time in a trade across decisions with a recorded entry and exit.",
      "m.timeindd": "Share of journaled days spent below a prior peak.",
      "m.longestdd": "Longest run of journaled days below a prior peak.",
      "m.ddepisodes": "Number of separate drawdown episodes in the daily Net curve.",
      "m.avgrecovery": "Average days to recover to a prior peak.",
      "m.recoveryfactor": "Net Trading P&L divided by the largest drawdown.",
      "m.expr": "Average R per decision — profit ÷ risk, before costs.",
      "m.avgdailypl": "Average Net Trading P&L per journaled day.",
      "m.tradesperday": "Average closed decisions per journaled day.",
      "m.greendays": "Journaled days that ended Net positive.",
      "m.reddays": "Journaled days that ended Net negative.",
      "m.pctgreendays": "Green days as a share of decided days (green + red).",
      "m.currentstreak": "Signed run of consecutive Net-positive or Net-negative decisions.",
      "m.runnerrate": "Share of decisions that reached at least 2R.",
    };
    const tipText = financialTips[id] ?? moreTips[id];
    if (tipText) {
      const coverage = financialTips[id] && id !== "m.grossprofitfactor" ? this.incompleteCostNote(financials) : "";
      // Win Rate used to show the sample as a ring; with the headline text-only
      // the counts live here, plus an honest note when the sample is too small
      // to carry a percentage (a "reliability" cue).
      let sample = "";
      if (id === "m.winrate") {
        const wins = financials.net.positiveDecisionCount;
        const losses = financials.net.negativeDecisionCount;
        const be = financials.net.breakevenDecisionCount;
        const n = wins + losses + be;
        sample = n === 0
          ? " No decided trades in this period."
          : ` ${wins} wins · ${losses} losses · ${be} breakeven (n=${n}).` +
            (n < 10 ? " Small sample (<10 decisions) — interpret with caution." : "");
      }
      attachTip(labelEl, { title: labelText, sub: `${tipText}${sample}${coverage}` });
    }
    // Restrained colour: only metrics where colour carries real meaning.
    const tone = COLORED_METRICS.has(id) ? res.tone : "neutral";
    if (tone === "pos") val.addClass("tj-pos");
    else if (tone === "neg") val.addClass("tj-neg");

    // Count up/down when the number changes (e.g. switching timeframe).
    const parsed = parseMetricNumber(res.value);
    const prev = this.metricDisplay.get(id);
    const animationsOn = this.plugin.settings.animations !== false;
    if (parsed !== null && (prev === undefined || Math.abs(prev - parsed) > 1e-9) && animationsOn) {
      const from = prev === undefined ? 0 : prev;
      val.textContent = metricFormatter(res.value)(from);
      this.metricTarget.set(id, parsed);
      this.animateNumber(val, id, from, parsed, res.value);
    } else {
      val.textContent = res.value;
      if (parsed !== null) this.metricDisplay.set(id, parsed);
    }

    // Sub-stat: uses helper-derived calendar windows. Never show a delta for an
    // ineligible period or when either period cannot produce this metric.
    if (COMPARE_METRICS.has(id) && def) {
      const currentComparisonTrades = comparison?.current ?? trades;
      const eligible = comparison ? comparison.eligible : prevTrades.length > 0;
      if (eligible) {
        const currentCounted = PER_TRADE_METRICS.has(id) ? this.countsList(currentComparisonTrades) : currentComparisonTrades;
        const previousCounted = PER_TRADE_METRICS.has(id) ? this.countsList(prevTrades) : prevTrades;
        const zone = this.plugin.settings.timeZone;
        const currentSummary = this.financialsFor(currentComparisonTrades);
        const previousSummary = this.financialsFor(prevTrades);
        const currentResult = def.compute(currentCounted, dayKey, currentSummary, zone);
        const previousResult = def.compute(previousCounted, dayKey, previousSummary, zone);
        const currentNumber = comparisonMetricNumber(id, currentResult.value);
        const displayedNumber = comparisonMetricNumber(id, res.value);
        const previousNumber = comparisonMetricNumber(id, previousResult.value);
        if (
          currentNumber !== null && displayedNumber !== null && previousNumber !== null &&
          Math.abs(currentNumber - displayedNumber) < 1e-9
        ) {
          const delta = currentNumber - previousNumber;
          const sub = wrap.createDiv({ cls: "tj-metric-sub" });
          const deltaTone = metricDeltaTone(id, delta);
          if (deltaTone > 0) sub.addClass("tj-pos");
          else if (deltaTone < 0) sub.addClass("tj-neg");
          sub.setText(`${this.formatMetricDelta(id, delta)} vs prev`);
        }
      }
    }

    // The value's size is CSS-only (`.tj-metric.is-fixed-text` +
    // `var(--tj-fs-display)`): there is no widget-driven font-size to sync.
  }

  /**
   * Minimal cumulative P&L curve that fills its container exactly.
   * Smooth (Catmull-Rom) line, accent stroke, green/red area split at zero.
   * Morphs smoothly when data changes and hides axis labels when too small.
   */
  private drawEquityChart(container: HTMLElement, trades: Trade[], key = "equity", financials = this.financialsFor(trades)): void {
    const days = [...financials.net.byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    let cum = 0;
    const values: number[] = [0];
    const dates: string[] = [days[0]?.[0] ?? ""];
    for (const [date, netResult] of days) {
      cum += netResult;
      values.push(cum);
      dates.push(date);
    }
    renderLineChart(container, {
      values,
      dates,
      key,
      format: this.plugin.settings.dateFormat,
      animations: this.plugin.settings.animations !== false,
    });
  }



  renderFilterPopover(header: HTMLElement): void {
    const backdrop = header.createDiv({ cls: "tj-pop-backdrop" });
    backdrop.addEventListener("click", () => {
      this.filtersOpen = false;
      this.rerenderHeaderOnly();
    });
    const pop = header.createDiv({ cls: "tj-popover" });
    pop.addEventListener("click", (e) => e.stopPropagation());

    // ---- Account (multi: OR within, AND with type) ----
    const accSection = pop.createDiv({ cls: "tj-pop-fields" });
    const accHead = accSection.createDiv({ cls: "tj-pop-label-row" });
    accHead.createDiv({ cls: "tj-pop-label", text: "Account" });
    if (this._accountIds.length) {
      accHead
        .createEl("button", { cls: "tj-pop-clear", text: "Clear", attr: { type: "button" } })
        .addEventListener("click", () => {
          this._accountIds = [];
          this.persistHomeFilters();
          this.renderPreservingScroll();
        });
    }
    const accounts = [...(this.plugin.settings.propAccounts ?? [])].sort((a, b) => {
      const order = (t: string): number => (t === "funded" ? 0 : t === "live" ? 1 : t === "personal" ? 2 : t === "eval" ? 3 : 4);
      return order(a.type) - order(b.type) || a.name.localeCompare(b.name);
    });
    const accList = accSection.createDiv({ cls: "tj-pop-accs" });
    for (const acc of accounts) {
      const firm = catalogLabel(acc.firmId) ?? "Other";
      const label = acc.name && acc.name !== "Custom Account"
        ? acc.name
        : `${firm}${acc.size ? ` $${(acc.size / 1000).toFixed(0)}K` : ""} ${typeLabel(acc.type)}`.trim();
      const on = this._accountIds.includes(acc.id);
      const row = accList.createEl("button", {
        cls: "tj-pop-acc" + (on ? " is-on" : ""),
        attr: { type: "button", "aria-pressed": String(on), "aria-label": label },
      });
      row.createSpan({ cls: "tj-pop-acc-check", text: on ? "✓" : "", attr: { "aria-hidden": "true" } });
      row.createSpan({ cls: "tj-pop-acc-name", text: label });
      row.createSpan({ cls: "tj-pop-acc-firm", text: firm });
      row.addEventListener("click", () => {
        this._accountIds = on ? this._accountIds.filter((x) => x !== acc.id) : [...this._accountIds, acc.id];
        this.persistHomeFilters();
        this.renderPreservingScroll();
      });
    }
    if (!accounts.length) accList.createSpan({ cls: "tj-pop-empty", text: "No accounts yet" });

    // ---- Account type (multi) ----
    const typeSection = pop.createDiv({ cls: "tj-pop-fields" });
    const typeHead = typeSection.createDiv({ cls: "tj-pop-label-row" });
    typeHead.createDiv({ cls: "tj-pop-label", text: "Account type" });
    if (this._accountTypes.length) {
      typeHead
        .createEl("button", { cls: "tj-pop-clear", text: "Clear", attr: { type: "button" } })
        .addEventListener("click", () => {
          this._accountTypes = [];
          this.persistHomeFilters();
          this.renderPreservingScroll();
        });
    }
    const pills = typeSection.createDiv({ cls: "tj-pop-pills" });
    for (const f of accountFilters()) {
      const on = this._accountTypes.includes(f.id);
      const pill = pills.createEl("button", {
        cls: "tj-pop-pill" + (on ? " is-on" : ""),
        text: f.label,
        attr: { type: "button", "aria-pressed": String(on) },
      });
      pill.addEventListener("click", () => {
        this._accountTypes = on ? this._accountTypes.filter((x) => x !== f.id) : [...this._accountTypes, f.id];
        this.persistHomeFilters();
        this.renderPreservingScroll();
      });
    }
  }



  /** Current-scope payout total; cash out, not trading performance. */
  renderPayoutsWidget(body: HTMLElement): void {
    const accounts = this.plugin.settings.propAccounts ?? [];
    const byId = new Map(accounts.map((a) => [a.id, a]));

    // Account scope: the selected account, else the account-type filter, else all
    // — the same filter every other widget answers to.
    const inScope = (acc: { id: string; type: string }): boolean => {
      if (this.accountId) return acc.id === this.accountId;
      if (this.filter === "all") return true;
      if (this.filter === "live") return acc.type === "live" || acc.type === "personal";
      return acc.type === this.filter;
    };

    const scoped = (this.plugin.settings.payouts ?? []).filter((p) => {
      const acc = byId.get(p.accountId);
      return !!acc && inScope(acc);
    });

    // Portfolio demo rule — the same one baseTrades() and accountScopeFor()
    // apply: demos drop only while no account or account type was picked on
    // purpose. An explicit demo selection keeps its payouts, and it is checked
    // AFTER the scope above so the two rules never fight over the same row.
    const explicitScope = !!this.accountId || this.filter !== "all";
    const excludeDemos = this.plugin.settings.excludeDemosFromPortfolio !== false && !explicitScope;
    const payouts = excludeDemos ? scoped.filter((p) => byId.get(p.accountId)?.type !== "demo") : scoped;

    const bounds = this.rangeBounds();
    const asOf = this.asOfKey();
    const rows = payouts
      .filter((p) => {
        return p.date <= asOf && dateWithinPeriod(p.date, bounds);
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // A payout row is money: only a recorded finite amount counts, the same
    // guard the Costs widget applies to commission and fees — one bad row must
    // never poison the headline, nor the account movement the drawdown reads.
    const payoutsOf = (list: typeof rows): number =>
      list.reduce((s, p) => s + (isFiniteNumber(p.amount) ? p.amount : 0), 0);

    const total = payoutsOf(rows);
    const money = (n: number): string => fmtMoneyAbs(n, 2);

    const summary = body.createDiv({ cls: "tj-payout-summary" });
    const head = summary.createDiv({ cls: "tj-payout-summary-head" });
    const icon = head.createSpan({ cls: "tj-payout-summary-icon" });
    setIcon(icon, "wallet");
    const amount = head.createDiv({ cls: "tj-payout-summary-value", text: money(total) });
    attachTip(amount, {
      title: "Total payouts",
      value: money(total),
      sub: rows.length
        ? "Cash paid out in the selected period and account scope; not P&L."
        : "No payouts in this period and account scope.",
    });
    let sub: HTMLElement | null = null;
    if (rows.length) {
      const year = dateInZone(this.plugin.settings.timeZone).slice(0, 4);
      const yearTotal = payoutsOf(rows.filter((p) => p.date.startsWith(year)));
      sub = summary.createDiv({
        cls: "tj-payout-summary-sub",
        text: `${rows.length} payout${rows.length === 1 ? "" : "s"} · ${money(yearTotal)} in ${year}`,
      });
    }
    if (!rows.length) summary.createDiv({ cls: "tj-payout-summary-empty", text: "No payouts this period" });

    if (body.clientHeight > 0 && body.scrollHeight > body.clientHeight && sub) sub.style.display = "none";

  }

  /**
   * Costs — what the recorded trades cost in commission and fees, plus how
   * much of a profitable period those costs ate. It reports the rule and the
   * room left; it never blocks, limits or enforces anything. Gross and Net are
   * deliberately absent: they belong to the charts that already carry them.
   */
  renderCostsWidget(body: HTMLElement, trades: Trade[], prevTrades: Trade[] = []): void {
    const financials = this.financialsFor(trades);
    const wrap = body.createDiv({ cls: "tj-costs-wrap" });
    if (!financials.eligibleLegCount) {
      wrap.createDiv({ cls: "tj-costs-empty", text: "No trades recorded yet." });
      return;
    }

    // Costs are money: every recorded leg counts, copied or not — the same
    // population the headline metrics read.
    const costsOf = (list: Trade[]): number => {
      let total = 0;
      for (const t of list) {
        if (isFiniteNumber(t.commission)) total += t.commission;
        if (isFiniteNumber(t.fees)) total += t.fees;
      }
      return total;
    };
    let commissionTotal = 0;
    let feesTotal = 0;
    for (const t of trades) {
      if (isFiniteNumber(t.commission)) commissionTotal += t.commission;
      if (isFiniteNumber(t.fees)) feesTotal += t.fees;
    }
    const costsTotal = commissionTotal + feesTotal;
    if (costsTotal === 0) {
      wrap.createDiv({ cls: "tj-costs-empty", text: "No commissions or fees recorded." });
      return;
    }

    const grossTotal = financials.gross.total;

    const main = wrap.createDiv({ cls: "tj-costs-main" });
    const value = main.createDiv({ cls: "tj-costs-value", text: fmtMoneyAbs(costsTotal, 2) });
    attachTip(value, {
      title: "Costs",
      sub: "Total commission and fees paid on the recorded trades in this period.",
    });
    // Average per recorded leg, and the move against the previous window, share
    // the label line: the card has a fixed height and the picture is what pays
    // for it, so the text never grows with the box.
    const perTrade = trades.length ? costsTotal / trades.length : 0;
    const subrow = main.createDiv({ cls: "tj-costs-subrow" });
    subrow.createDiv({
      cls: "tj-costs-sub",
      text: `commission & fees · ${fmtMoneyAbs(perTrade, 2)} / trade`,
    });

    // Travel against the previous window of the same length. Costs falling is
    // the improvement, so the tone is the inverse of a P&L move — the arrow and
    // the sign already carry the direction, colour only follows it.
    if (prevTrades.length) {
      const previous = costsOf(prevTrades);
      const delta = costsTotal - previous;
      const arrow = delta > 0 ? "\u2191" : delta < 0 ? "\u2193" : "=";
      const sign = delta > 0 ? "+" : delta < 0 ? "\u2212" : "";
      const line = subrow.createDiv({
        cls: "tj-costs-delta",
        text: `${arrow} ${sign}${fmtMoneyAbs(delta, 2)} vs prev`,
      });
      if (delta > 0) line.addClass("is-neg");
      else if (delta < 0) line.addClass("is-pos");
      attachTip(line, {
        title: "Costs vs previous period",
        sub: `${fmtMoneyAbs(previous, 2)} in the previous window.`,
      });
    }

    const row = (host: HTMLElement, label: string, text: string, key = ""): void => {
      const r = host.createDiv({ cls: "tj-costs-row" });
      r.createDiv({ cls: ("tj-costs-row-label " + key).trim(), text: label });
      r.createDiv({ cls: "tj-costs-row-value", text });
    };

    // This card reports what the trades cost and nothing else: Gross and Net
    // belong to the charts that already carry them. The ring splits what was
    // paid and the rows beside it print that split as numbers — both draw
    // whatever the period did (the old waterfall only drew when Gross was
    // positive, which left the card bare and lost the footer).
    const viz = wrap.createDiv({ cls: "tj-costs-viz" });
    const donut = viz.createDiv({ cls: "tj-costs-donut" });
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 72 72");
    // The legend beside it prints both figures in words — the drawing itself
    // carries no text, so it is noise for a screen reader.
    svg.setAttribute("aria-hidden", "true");
    // Two arcs, not a masked gradient: a CSS mask paints a hard edge and the
    // ring reads pixelated at card scale; the renderer antialiases an arc.
    const arcOf = (stroke: string): SVGElement => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", "36"); c.setAttribute("cy", "36"); c.setAttribute("r", "30");
      c.setAttribute("fill", "none"); c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", "12");
      return c;
    };
    const base = arcOf("var(--tj-costs-comm)");
    const feesArc = arcOf("var(--tj-costs-fees)");
    const feesShare = Math.max(0, Math.min(100, (feesTotal / costsTotal) * 100));
    feesArc.setAttribute("pathLength", "100");
    feesArc.setAttribute("stroke-dasharray", `${feesShare.toFixed(1)} 100`);
    feesArc.setAttribute("transform", "rotate(-90 36 36)");
    svg.appendChild(base);
    svg.appendChild(feesArc);
    donut.appendChild(svg as unknown as Node);

    const legend = viz.createDiv({ cls: "tj-costs-rows" });
    // The share rides on the label: the ring is only ever a picture, so the
    // split has to exist as a number next to the word it belongs to (§6).
    const share = (v: number): string => ((v / costsTotal) * 100).toFixed(1);
    row(legend, `Commission · ${share(commissionTotal)}%`, fmtMoneyAbs(commissionTotal, 2), "is-comm");
    row(legend, `Fees · ${share(feesTotal)}%`, fmtMoneyAbs(feesTotal, 2), "is-fees");

    if (grossTotal > 0) {
      wrap.createDiv({ cls: "tj-costs-footer", text: `${((costsTotal / grossTotal) * 100).toFixed(1)}% of Gross P&L` });
    }

    // Fit by measurement, not by a breakpoint: the drawing is the only block
    // that can give height back, and this card has a floor it must survive
    // (MIN_H = 3 rows, and it can be a sixth of the width too). Take the ring
    // down while the body clips; if even the floor will not fit, the numbers
    // stand alone — the legend prints every figure, so no reading is lost — and
    // in the smallest box the headline keeps the share line and drops both.
    if (body.clientHeight > 0) {
      const clips = (): boolean => body.scrollHeight > body.clientHeight;
      let ringPx = 84;
      while (ringPx > 48 && clips()) {
        ringPx -= 4;
        donut.style.width = `${ringPx}px`;
        donut.style.height = `${ringPx}px`;
      }
      if (clips()) {
        donut.style.display = "none";
        if (clips()) viz.style.display = "none";
      }
    }
  }

  /**
   * Drawdown — the recorded balance's peak-to-trough episodes, read off the
   * same shared account-movement series Home already uses. Depth, recovery and
   * time under water are reported as they are; nothing here limits or blocks.
   */
  renderDrawdownWidget(body: HTMLElement): void {
    const movement = this.homeAccountMovement();
    const wrap = body.createDiv({ cls: "tj-dd-wrap" });
    const empty = (text: string): void => {
      wrap.createDiv({ cls: "tj-dd-empty", text });
    };
    if (!movement.trades.length) return empty("No trades recorded yet.");

    // The Home period scopes the series; All Time (no bounds) keeps the lot.
    // The baseline is the window's first balance, so the drawdown is the one
    // inside the selected period — never a peak carried in from before it.
    const bounds = this.rangeBounds();
    const dayRows = bounds ? movement.days.filter((d) => dateWithinPeriod(d.date, bounds)) : movement.days;
    const dailyBalances = dayRows.map((d) => ({ date: d.date, balance: movement.capital + d.cumulative }));
    if (!dailyBalances.length) return empty("No account history yet.");

    const baseline = dailyBalances[0].balance;
    const result = computeDrawdownEpisodes(dailyBalances, baseline);
    if (!result.episodes.length) return empty("No drawdown in this period.");

    const maxDepth = result.episodes.reduce((max, episode) => Math.max(max, episode.depth), 0);
    const maxDepthPct = result.episodes.find((episode) => episode.depth === maxDepth)?.depthPct ?? 0;
    const current = result.currentDD;
    const hasOpenDD = current !== null;

    // Running peak over the window: a day is under water by how far it sits
    // below the best balance seen up to that day in the selected period.
    let peak = baseline;
    const underwater = dailyBalances.map((point) => {
      if (point.balance > peak) peak = point.balance;
      const signed = peak > 0 ? ((point.balance - peak) / peak) * 100 : 0;
      return { date: point.date, depth: Math.max(0, -signed) };
    });
    const scale = underwater.reduce((max, point) => Math.max(max, point.depth), maxDepthPct) || 1e-9;

    const header = wrap.createDiv({ cls: "tj-dd-header" });
    const value = header.createDiv({ cls: "tj-dd-value", text: fmtMoney2(-maxDepth) });
    attachTip(value, {
      title: "Max drawdown",
      sub: "Largest peak-to-trough fall of the recorded account value within the selected period, at that episode's peak.",
    });
    header.createDiv({
      cls: "tj-dd-sub",
      text: `Peak-to-trough · ${maxDepthPct.toFixed(1)}% · ${hasOpenDD ? "in drawdown" : "recovered ✓"}`,
    });

    const facts: Array<{ label: string; value: string }> = [
      { label: "Episodes", value: String(result.totalEpisodes) },
    ];
    if (result.avgRecoveryDays > 0) {
      facts.push({ label: "Avg recovery", value: `${result.avgRecoveryDays.toFixed(0)} days` });
    }
    facts.push({ label: "Time in drawdown", value: `${result.pctTimeInDD.toFixed(0)}%` });
    const inline = wrap.createDiv({ cls: "tj-dd-rows-inline" });
    facts.forEach((fact, index) => {
      if (index) inline.createSpan({ text: "·" });
      inline.createSpan({ text: `${fact.label} ${fact.value}` });
    });

    // The curve fills whatever the header and facts leave — the headline already
    // carries the value, so there is no "current" footer to duplicate it.
    const chart = wrap.createDiv({ cls: "tj-dd-chart" });
    for (const point of underwater.slice(-60)) {
      const bar = chart.createDiv({ cls: "tj-dd-bar" });
      const fill = bar.createDiv({ cls: "tj-dd-bar-fill" });
      const share = point.depth / scale;
      fill.style.height = `${Math.round(share * 100)}%`;
      fill.style.opacity = point.depth > 0 ? (0.5 + 0.4 * share).toFixed(2) : "0";
      attachTip(bar, { title: point.date, sub: `${point.depth.toFixed(1)}% underwater` });
    }

    // Fit by measurement: the curve gives height back first, then the facts
    // wrap under the headline — which always stays.
    if (body.clientHeight > 0) {
      const clips = (): boolean => body.scrollHeight > body.clientHeight;
      if (clips()) chart.style.display = "none";
      if (clips()) inline.style.display = "none";
    }
  }

  /**
   * Position Size — how many contracts per trade, and whether the size moves
   * with the result. It reads what the journal recorded; it never prescribes a
   * size, warns off a trade or limits anything.
   */
  renderPositionSizeWidget(body: HTMLElement, trades: Trade[]): void {
    const wrap = body.createDiv({ cls: "tj-size-wrap" });
    const empty = (text: string): void => {
      wrap.createDiv({ cls: "tj-size-empty", text });
    };
    if (!trades.length) return empty("No trades recorded yet.");

    // Size is read in micro-equivalents, so a mini and its micro counterpart
    // compare: 1 NQ = 10 MNQ, 1 GC = 10 MGC (from the contract point values).
    // An instrument with no micro counterpart counts as its own contracts.
    const microUnits = (t: Trade): number => {
      const qty = Number(t.quantity);
      if (!isFiniteNumber(qty) || qty <= 0) return 0;
      const spec = knownFuturesSpec(t.symbol || "");
      if (spec?.micro && spec.pointValue > 0) {
        const micro = knownFuturesSpec(spec.micro);
        if (micro && micro.pointValue > 0) return qty * (spec.pointValue / micro.pointValue);
      }
      return qty;
    };
    const sized = trades.filter((t) => microUnits(t) > 0);
    if (!sized.length) return empty("No position sizes recorded.");

    const sizes = sized.map(microUnits);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    const avgSize = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
    const mean = (list: number[]): number | null =>
      list.length ? list.reduce((sum, size) => sum + size, 0) / list.length : null;
    // What each row decided — the Net of its decision (legs summed, costs
    // applied), the same answer every unqualified win/loss in the product reads.
    const outcomes = netOutcomes(trades, this.financialsFor(trades));
    const decided = (t: Trade): number => outcomes.get(t) ?? netPnl(t);
    const avgWin = mean(sized.filter((t) => decided(t) > 0).map(microUnits));
    const avgLoss = mean(sized.filter((t) => decided(t) < 0).map(microUnits));

    // Sizing that leans either way by 5% or more is a direction; anything
    // closer than that is not a signal, and the footer says so plainly.
    let verdictTone = "is-neutral";
    let verdictText = "Consistent sizing";
    if (avgWin !== null && avgLoss !== null) {
      if (avgWin >= avgLoss * 1.05) {
        verdictTone = "is-good";
        verdictText = "Sizing up on winners";
      } else if (avgLoss >= avgWin * 1.05) {
        verdictTone = "is-bad";
        verdictText = "Sizing up on losers";
      }
    }

    // Whole-contract data gets one bin per contract (a 1–5 book has no use for
    // fractional buckets); everything else falls on 6–8 bins over the range.
    const span = maxSize - minSize;
    const allIntegers = sizes.every((size) => Number.isInteger(size));
    const integerBins = span > 0 && allIntegers && span <= 7;
    const binCount = span === 0
      ? 1
      : integerBins
        ? Math.round(span) + 1
        : Math.min(8, Math.max(6, Math.round(span)));
    const width = span === 0 || integerBins ? 1 : span / binCount;
    const bins = new Array<number>(binCount).fill(0);
    for (const size of sizes) {
      const index = binCount === 1
        ? 0
        : integerBins
          ? Math.round(size - minSize)
          : Math.floor((size - minSize) / width);
      bins[Math.min(binCount - 1, Math.max(0, index))] += 1;
    }
    const sizeLabel = (n: number): string =>
      Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
    const binEdge = (index: number, end: boolean): number => {
      if (binCount === 1) return end ? maxSize : minSize;
      if (integerBins) return minSize + index;
      return minSize + width * (index + (end ? 1 : 0));
    };

    const header = wrap.createDiv({ cls: "tj-size-header" });
    const value = header.createDiv({ cls: "tj-size-value", text: avgSize.toFixed(1) });
    attachTip(value, {
      title: "Average position size",
      sub: `Average micros of ${sized.length} sized trades (1 mini = 10 micros, so a mini and its micro compare; instruments without a micro count as 1 contract) — winners ${avgWin === null ? "—" : avgWin.toFixed(1)}, losers ${avgLoss === null ? "—" : avgLoss.toFixed(1)}.`,
    });
    header.createDiv({ cls: "tj-size-sub", text: "avg micros" });

    const range = `${sizeLabel(minSize)} – ${sizeLabel(maxSize)}`;
    const winners = avgWin === null ? "—" : avgWin.toFixed(1);
    const losers = avgLoss === null ? "—" : avgLoss.toFixed(1);
    const inline = wrap.createDiv({ cls: "tj-size-rows-inline" });
    [`Range ${range}`, `Winners ${winners}`, `Losers ${losers}`].forEach((fact, index) => {
      if (index) inline.createSpan({ text: "·" });
      inline.createSpan({ text: fact });
    });

    // Facts sit right under the headline and the histogram fills whatever is
    // left — no orphan text stranded at the bottom of a tall card.
    const histogram = wrap.createDiv({ cls: "tj-size-histogram" });
    const maxCount = Math.max(...bins, 1);
    bins.forEach((count, index) => {
      const from = binEdge(index, false);
      const to = binEdge(index, true);
      const bin = histogram.createDiv({ cls: "tj-size-bin" });
      const fill = bin.createDiv({ cls: "tj-size-bin-fill" });
      fill.style.height = `${Math.round((count / maxCount) * 100)}%`;
      attachTip(bin, {
        title: `${sizeLabel(from)}${from === to ? "" : ` – ${sizeLabel(to)}`} micros`,
        sub: `${count} trade${count === 1 ? "" : "s"} in this range`,
      });
    });

    wrap.createDiv({ cls: `tj-size-footer ${verdictTone}`, text: verdictText });

    // Fit by measurement: the histogram gives height back first, then the facts
    // wrap under it; the headline and the verdict always survive.
    if (body.clientHeight > 0) {
      const clips = (): boolean => body.scrollHeight > body.clientHeight;
      if (clips()) histogram.style.display = "none";
      if (clips()) inline.style.display = "none";
    }
  }

  /**
   * Revenge Trading — one cohort, digested.
   *
   * The cohort merges the automatic read (a trade opened within the configured
   * window of a losing exit, same symbol, same day) with the tags that mean
   * revenge by definition ("Revenge entry" / "Revenge"). The card reports the
   * share and what the cohort did, in plain figures — the journal shows the
   * pattern, the motive is the trader's (docs/UX-GUIDELINES.md §0). One
   * decision, one reading: counts are per logical trade, money per decision.
   */
  renderRevengeWidget(body: HTMLElement, trades: Trade[]): void {
    const wrap = body.createDiv({ cls: "tj-rv-wrap" });
    if (!trades.length) {
      wrap.createDiv({ cls: "tj-rv-empty", text: "No trades recorded yet." });
      return;
    }

    const windowMinutes = this.plugin.settings.reentryWindowMinutes ?? DEFAULT_REENTRY_WINDOW_MINUTES;
    const financials = this.financialsFor(trades);
    const signals = reentrySignals(trades, (t) => this.scoreDayKey(t), financials, windowMinutes);
    const outcomes = netOutcomes(trades, financials);

    const rows = tradeRows(trades);
    const rowObserved = (row: TradeRow): boolean => row.legs.some((l) => signals.observed.has(l));
    const rowDeclared = (row: TradeRow): boolean => row.legs.some((l) => signals.declared.has(l));
    const rowEscalated = (row: TradeRow): boolean => row.legs.some((l) => signals.escalated.has(l));
    const rowRevenge = (row: TradeRow): boolean => rowObserved(row) || rowDeclared(row);
    const revengeRows = rows.filter(rowRevenge);
    const regularRows = rows.filter((r) => !rowRevenge(r));
    const observedCount = rows.filter(rowObserved).length;
    const declaredCount = rows.filter(rowDeclared).length;
    const bothCount = rows.filter((r) => rowObserved(r) && rowDeclared(r)).length;
    const escalatedCount = revengeRows.filter(rowEscalated).length;

    const netOf = (list: TradeRow[]): number =>
      list.reduce((sum, row) => sum + (outcomes.get(row.rep) ?? netPnl(row.rep)), 0);
    const winRate = (list: TradeRow[]): number | null => {
      let wins = 0;
      let losses = 0;
      for (const row of list) {
        const net = outcomes.get(row.rep) ?? netPnl(row.rep);
        if (net > 0) wins++;
        else if (net < 0) losses++;
      }
      return wins + losses ? (wins / (wins + losses)) * 100 : null;
    };
    const avgR = (list: TradeRow[]): number | null => {
      const rs = list.map((row) => tradeR(row.rep)).filter((r): r is number => r !== null);
      return rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;
    };
    const avgHold = (list: TradeRow[]): number | null => {
      const mins = list.map((row) => this.holdMinutes(row.rep)).filter((m): m is number => m !== null);
      return mins.length ? mins.reduce((s, m) => s + m, 0) / mins.length : null;
    };

    const netRevenge = netOf(revengeRows);
    const netRegular = netOf(regularRows);
    const share = (revengeRows.length / rows.length) * 100;
    const toneOf = (n: number | null): string => (n === null || n === 0 ? "" : n > 0 ? "is-pos" : "is-neg");
    const money = (n: number | null): string => (n === null ? "—" : fmtMoney2(n));
    const pct = (n: number | null): string => (n === null ? "—" : `${n.toFixed(0)}%`);
    const rText = (n: number | null): string => (n === null ? "—" : `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(2)}R`);
    const holdText = (n: number | null): string => (n === null ? "—" : this.fmtHold(n));

    // The state names the impact, never endorses it: green only when there is
    // no revenge pattern at all. A cluster that happened to pay is still a
    // flag — "paid this period", not a result to repeat.
    let verdictTone = "is-neutral";
    let verdictText = "No significant impact";
    let stateWord = "Watch";
    let stateTone = "is-warn";
    if (revengeRows.length === 0) {
      verdictTone = "is-good";
      verdictText = "No revenge pattern detected";
      stateWord = "Clear";
      stateTone = "is-good";
    } else if (netRevenge < 0 && netRegular > 0) {
      verdictTone = "is-bad";
      verdictText = "⚠ Revenge trades lose money while the rest earns";
      stateWord = "Leak";
      stateTone = "is-bad";
    } else if (netRevenge > 0) {
      verdictTone = "is-warn";
      verdictText = "Revenge trades paid this period — a pattern, not an edge";
      stateWord = "Watch";
      stateTone = "is-warn";
    }

    const header = wrap.createDiv({ cls: "tj-rv-header" });
    const value = header.createDiv({ cls: "tj-rv-value", text: `${share.toFixed(0)}%` });
    attachTip(value, {
      title: "Revenge Trading",
      sub: `Automatic: opened within ${windowMinutes} min of a loss on the same symbol. Tagged: Revenge entry / Revenge. A pattern, not a motive — the meaning is yours.`,
    });
    const stateChip = header.createDiv({ cls: `tj-state ${stateTone}`, text: stateWord });
    attachTip(stateChip, {
      title: "Revenge state",
      sub: "Clear = no pattern. Watch = a pattern is present, even when it paid. Leak = it loses while the rest earns.",
    });
    header.createDiv({ cls: "tj-rv-sub", text: `${revengeRows.length} of ${rows.length} trades` });

    const detail = wrap.createDiv({ cls: "tj-rv-body" });

    // Share as a thin part-to-whole: revenge vs the rest, figures printed below.
    const bar = detail.createDiv({ cls: "tj-rv-bar" });
    bar.createDiv({ cls: "tj-rv-bar-fill is-revenge" }).style.width = `${share}%`;
    attachTip(bar, {
      title: "Revenge share",
      sub: `${revengeRows.length} of ${rows.length} decisions this period.`,
    });

    const compose = detail.createDiv({ cls: "tj-rv-compose" });
    compose.createSpan({
      cls: "tj-rv-compose-main",
      text: `${observedCount} by timing (≤${windowMinutes} min after a loss) · ${declaredCount} you tagged`,
    });
    if (bothCount) compose.createSpan({ cls: "tj-rv-compose-note", text: `(${bothCount} both)` });

    const impact = detail.createDiv({ cls: "tj-rv-impact" });
    const lead = impact.createDiv({ cls: "tj-rv-impact-lead" });
    lead.createSpan({ text: `These ${revengeRows.length} revenge decisions netted ` });
    lead.createSpan({ cls: `tj-rv-impact-net ${netRevenge < 0 ? "is-neg" : ""}`.trim(), text: money(netRevenge) });
    const meta = impact.createDiv({ cls: "tj-rv-impact-meta" });
    let first = true;
    const item = (text: string): void => {
      if (!first) meta.createSpan({ cls: "tj-rv-impact-sep", text: "·" });
      first = false;
      meta.createSpan({ cls: "tj-rv-impact-item", text });
    };
    item(`Win rate ${pct(winRate(revengeRows))} vs ${pct(winRate(regularRows))} on the rest`);
    item(`Avg R ${rText(avgR(revengeRows))} vs ${rText(avgR(regularRows))}`);
    item(`Held ${holdText(avgHold(revengeRows))} vs ${holdText(avgHold(regularRows))}`);
    if (revengeRows.length) {
      const esc = detail.createDiv({ cls: "tj-rv-esc" });
      esc.createSpan({ cls: "tj-rv-esc-label", text: "Sized above the loss they followed" });
      esc.createSpan({ cls: "tj-rv-esc-value", text: `${escalatedCount} of ${revengeRows.length}` });
    }

    wrap.createDiv({ cls: `tj-rv-footer ${verdictTone}`, text: verdictText });
  }

  /**
   * R-Multiples — the shape of the edge: how each trade's Net result compares
   * with the risk it took (|entry − stop| × point value × quantity). Trades
   * without a recorded stop are left out: R cannot be read without a risk.
   */
  renderRMultiplesWidget(body: HTMLElement, trades: Trade[], header?: HTMLElement): void {
    const title = header?.querySelector<HTMLElement>("h3");
    if (title && !title.dataset.tipAttached) {
      attachTip(title, {
        title: "R-Multiples",
        sub: "One bar per decision (copies count once). R = profit ÷ risk, before costs.",
      });
      title.dataset.tipAttached = "1";
    }
    const wrap = body.createDiv({ cls: "tj-rm-wrap" });
    if (!trades.length) {
      wrap.createDiv({ cls: "tj-empty", text: "No trades recorded yet." });
      return;
    }

    // One R per decision (the leader's note), never one per copy leg: R measures
    // the decision's execution, and a proportional copy carries the same R.
    const rs: number[] = [];
    for (const row of tradeRows(trades)) {
      const r = tradeR(row.rep);
      if (r !== null && Number.isFinite(r)) rs.push(r);
    }
    if (!rs.length) {
      wrap.createDiv({ cls: "tj-empty", text: "No trades with stop loss — R needs risk." });
      return;
    }

    const avg = rs.reduce((sum, r) => sum + r, 0) / rs.length;
    const fmtR = (v: number): string => `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}R`;

    const count = new Array<number>(8).fill(0);
    for (const r of rs) {
      const index = r < -3 ? 0 : r < -2 ? 1 : r < -1 ? 2 : r < 0 ? 3 : r < 1 ? 4 : r < 2 ? 5 : r < 3 ? 6 : 7;
      count[index] += 1;
    }
    const max = Math.max(...count, 1);
    const labels = ["-3", "-2", "-1", "0", "+1", "+2", "+3", "≥+3"];
    const kindOf = (index: number): string => (index < 4 ? "is-neg" : index === 4 ? "is-zero" : "is-pos");

    // The average reads as a chip on the title line, never as a footer: the
    // card body is all chart. The count and the pre-cost note travel in its tip.
    if (header) {
      header.querySelectorAll(".tj-rm-avgchip").forEach((el) => el.remove());
      const chip = header.createSpan({ cls: "tj-rm-avgchip" });
      chip.createSpan({ text: "Avg " });
      chip.createSpan({ cls: "tj-rm-avgchip-v", text: fmtR(avg) });
      attachTip(chip, {
        title: "Average R",
        value: fmtR(avg),
        sub: `${rs.length} decision${rs.length === 1 ? "" : "s"} with a stop · R is profit ÷ risk, before costs.`,
      });
      const controls = header.querySelector(".tj-card-controls");
      if (controls) header.insertBefore(chip, controls);
      else header.appendChild(chip);
    }

    const histogram = wrap.createDiv({ cls: "tj-rm-histogram" });
    count.forEach((n, index) => {
      const bin = histogram.createDiv({ cls: "tj-rm-bin" });
      const fill = bin.createDiv({ cls: `tj-rm-bin-fill ${kindOf(index)}` });
      fill.style.height = `${Math.round((n / max) * 100)}%`;
      fill.style.minHeight = n > 0 ? "4px" : "0";
      attachTip(bin, {
        title: `${n} decision${n === 1 ? "" : "s"}`,
        sub: `${labels[index]}R bucket · ${Math.round((n / rs.length) * 100)}% of the decisions`,
      });
    });

    // Where the average sits on the distribution — a reading, not a target.
    const avgIndex = avg < -3 ? 0 : avg < -2 ? 1 : avg < -1 ? 2 : avg < 0 ? 3 : avg < 1 ? 4 : avg < 2 ? 5 : avg < 3 ? 6 : 7;
    const marker = histogram.createDiv({ cls: "tj-rm-avg" });
    marker.style.left = `${((avgIndex + 0.5) / labels.length) * 100}%`;

    const labelRow = wrap.createDiv({ cls: "tj-rm-labels" });
    labels.forEach((label, index) => labelRow.createSpan({ cls: kindOf(index), text: label }));

    // Fit by measurement, never by a guessed breakpoint: the axis goes first,
    // then the histogram. The average is a reading on the title line already,
    // so a short card loses the shape but never the number (§6, one message).
    if (body.clientHeight > 0) {
      const clips = (): boolean => body.scrollHeight > body.clientHeight;
      if (clips()) labelRow.style.display = "none";
      if (clips()) histogram.style.display = "none";
    }
  }

  /**
   * Tilt Meter — the period's behavioural state, with the formula on the card.
   *
   * Four shares of the decisions in scope (one entry per logical trade, copy
   * legs counted once unless the trader opts in): opened right after two
   * consecutive losses, opened and closed inside a minute, carrying a recorded
   * execution mistake, or taken while declared in an adverse psychology state.
   * The score is their mean (0–100, higher is worse) and is printed with its
   * formula, so the number is never a mystery. It also prices the declared
   * adverse state — what those decisions made against the rest. A report, never
   * a scold. The re-entry window does not enter here; that is Revenge Trading.
   */
  renderTiltWidget(body: HTMLElement, trades: Trade[], prevTrades: Trade[] = [], counted: Trade[] = trades): void {
    const wrap = body.createDiv({ cls: "tj-tilt-wrap" });
    if (!trades.length) {
      wrap.createDiv({ cls: "tj-tilt-empty", text: "No trades recorded yet." });
      return;
    }
    if (trades.length < 10) {
      wrap.createDiv({ cls: "tj-tilt-empty", text: "Not enough trades to read tilt." });
      return;
    }

    const dayKey = (t: Trade): string => this.scoreDayKey(t);
    // `list` is the counted population (decisions); `financeSource` is the full
    // scope, so the Net that classifies a decision is its legs summed.
    const sharesOf = (list: Trade[], financeSource: Trade[]): { afterTwo: number; fast: number; mistake: number; state: number; score: number } => {
      const signals = computeProcessSignals(list, dayKey, this.financialsFor(financeSource));
      const afterTwo = (signals.afterTwoLosses / list.length) * 100;
      const fast = signals.fastTradesPct;
      const mistake = signals.mistakeRate;
      const state = (list.filter(inNegativeState).length / list.length) * 100;
      const score = Math.max(0, Math.min(100, Math.round((afterTwo + fast + mistake + state) / 4)));
      return { afterTwo, fast, mistake, state, score };
    };
    const cur = sharesOf(counted, trades);
    const score = cur.score;

    const band = score <= 15 ? "calm" : score <= 35 ? "mild" : score <= 55 ? "elevated" : score <= 75 ? "high" : "severe";
    const bandLabel: Record<string, string> = { calm: "Calm", mild: "Mild", elevated: "Elevated", high: "High", severe: "Severe" };
    const bandFooter: Record<string, string> = {
      calm: "Behaviour in check.",
      mild: "Some tilt showing.",
      elevated: "Tilt detected — review your process.",
      high: "Significant tilt. Consider a break.",
      severe: "Severe tilt. Step away from the screen.",
    };

    const header = wrap.createDiv({ cls: "tj-tilt-header" });
    const value = header.createDiv({ cls: "tj-tilt-value", text: String(score) });
    attachTip(value, {
      title: "Tilt Meter",
      value: String(score),
      sub: `Mean of four shares of the decisions in scope (one per trade; copy legs count once): after 2 losses ${cur.afterTwo.toFixed(0)}% · fast ${cur.fast.toFixed(0)}% · mistakes ${cur.mistake.toFixed(0)}% · adverse state ${cur.state.toFixed(0)}%. Higher is worse.`,
    });
    const tone = band === "calm" ? "is-good" : band === "mild" ? "is-mild" : band === "elevated" ? "is-warn" : band === "high" ? "is-bad" : "is-severe";
    header.createDiv({ cls: `tj-state ${tone}`, text: bandLabel[band] });

    const detail = wrap.createDiv({ cls: "tj-tilt-body" });
    const rows = detail.createDiv({ cls: "tj-tilt-rows" });
    const row = (label: string, pct: number, sub: string): void => {
      const labelEl = rows.createDiv({ cls: "tj-tilt-row-label", text: label });
      rows.createDiv({ cls: "tj-tilt-row-value", text: `${pct.toFixed(0)}%` });
      attachTip(labelEl, { title: label, sub });
    };
    row("After 2 losses", cur.afterTwo, "Share of trades opened right after two consecutive losing decisions.");
    row("Fast trades", cur.fast, "Share of trades opened and closed inside one minute.");
    row("Mistake rate", cur.mistake, "Share of trades carrying a recorded execution mistake.");
    row("Negative state", cur.state, "Share of trades tagged with an adverse psychology state (Anxious · Impatient · Frustrated · FOMO · Revenge · Bored).");

    const formula = detail.createDiv({ cls: "tj-tilt-formula" });
    formula.createSpan({ cls: "tj-tilt-formula-text", text: "Score = mean of the four shares above." });
    if (prevTrades.length >= 10) {
      const prevScore = sharesOf(this.countsList(prevTrades), prevTrades).score;
      const delta = score - prevScore;
      const deltaEl = formula.createSpan({
        cls: `tj-tilt-delta ${delta > 0 ? "is-bad" : delta < 0 ? "is-good" : ""}`.trim(),
        text: `${delta > 0 ? "↑" : delta < 0 ? "↓" : "="} ${Math.abs(delta)} vs prev`,
      });
      attachTip(deltaEl, {
        title: "Tilt vs the previous period",
        sub: `Score ${prevScore} then, ${score} now. Lower is calmer.`,
      });
    }

    // Price the declared adverse state: what it made against the rest. One
    // decision, one reading — the same fold the Revenge card uses.
    const financials = this.financialsFor(trades);
    const outcomes = netOutcomes(trades, financials);
    const decisionRows = tradeRows(trades);
    const adverseRows = decisionRows.filter((r) => r.legs.some(inNegativeState));
    const calmRows = decisionRows.filter((r) => !r.legs.some(inNegativeState));
    if (adverseRows.length) {
      const netOf = (list: TradeRow[]): number =>
        list.reduce((sum, r) => sum + (outcomes.get(r.rep) ?? netPnl(r.rep)), 0);
      const winRate = (list: TradeRow[]): number | null => {
        let wins = 0;
        let losses = 0;
        for (const r of list) {
          const net = outcomes.get(r.rep) ?? netPnl(r.rep);
          if (net > 0) wins++;
          else if (net < 0) losses++;
        }
        return wins + losses ? (wins / (wins + losses)) * 100 : null;
      };
      const rValues = (list: TradeRow[]): number[] =>
        list.map((r) => tradeR(r.rep)).filter((r): r is number => r !== null);
      const netAdverse = netOf(adverseRows);
      const pctText = (n: number | null): string => (n === null ? "—" : `${n.toFixed(0)}%`);
      const rText = (n: number | null): string => (n === null ? "—" : `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(2)}R`);
      const impact = detail.createDiv({ cls: "tj-tilt-impact" });
      const lead = impact.createDiv({ cls: "tj-tilt-impact-lead" });
      lead.createSpan({ text: "In an adverse state: " });
      lead.createSpan({
        cls: `tj-tilt-impact-net ${netAdverse < 0 ? "is-neg" : ""}`.trim(),
        text: fmtMoney2(netAdverse),
      });
      lead.createSpan({ text: ` over ${adverseRows.length} decision${adverseRows.length === 1 ? "" : "s"}` });
      const meta = impact.createDiv({ cls: "tj-tilt-impact-meta" });
      meta.createSpan({ text: `Win ${pctText(winRate(adverseRows))} vs ${pctText(winRate(calmRows))} rest` });
      // Only price the R when both sides have a real sample — three or more.
      const rAdverse = rValues(adverseRows);
      const rCalm = rValues(calmRows);
      if (rAdverse.length >= 3 && rCalm.length >= 3) {
        const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
        meta.createSpan({ cls: "tj-tilt-impact-sep", text: "·" });
        meta.createSpan({ text: `Avg R ${rText(mean(rAdverse))} vs ${rText(mean(rCalm))}` });
      }
    } else {
      detail.createDiv({ cls: "tj-tilt-impact-empty", text: "No adverse-state decisions tagged." });
    }

    wrap.createDiv({ cls: `tj-tilt-footer is-${band}`, text: bandFooter[band] });
  }

  renderTrendsWidget(body: HTMLElement, trades: Trade[], header?: HTMLElement, h?: number): void {
    if (!trades.length) {
      renderEmptyBox(body, {
        title: "No trades in this period",
        sub: "Change the period or the account scope to see a trend.",
      });
      return;
    }
    const trends = computeTrends(trades, {
      dayKey: (t) => this.scoreDayKey(t),
      reentryWindowMinutes: this.plugin.settings.reentryWindowMinutes ?? DEFAULT_REENTRY_WINDOW_MINUTES,
    });
    const financials = this.financialsFor(trades);
    const title = header?.querySelector<HTMLElement>("h3");
    // The heading lives in the card header, which outlives every body redraw:
    // attach once, or each resize stacks another listener on the same h3.
    if (title && !title.dataset.tipAttached) {
      attachTip(title, {
        title: "Trends · Net",
        sub: `Averages, win rate and PF use Net; average R is pre-cost.${this.incompleteCostNote(financials)}`,
      });
      title.dataset.tipAttached = "1";
    }
    const minutes = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
    const write = (v: number | null, unit: string): string => {
      if (v === null || !Number.isFinite(v)) return unit === "factor" ? "\u221e" : "\u2014";
      switch (unit) {
        case "money":
          return fmtMoney2(v);
        case "r":
          return `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
        case "percent":
          return `${v.toFixed(1)}%`;
        case "factor":
          return v.toFixed(2);
        default:
          return minutes(v);
      }
    };
    const writeDelta = (v: number | null, unit: string): string => {
      if (v === null || !Number.isFinite(v)) return "\u2014";
      // A tie is a tie: judge flatness at the precision the row is written, so a
      // delta that rounds to 0 never reads as a move (no more "↓ −0m").
      const flat =
        unit === "minutes"
          ? Math.round(Math.abs(v)) === 0
          : unit === "percent"
            ? Number(Math.abs(v).toFixed(1)) === 0
            : Number(Math.abs(v).toFixed(2)) === 0;
      const arrow = flat ? "=" : v > 0 ? "\u2191" : "\u2193";
      const sign = flat ? "" : v > 0 ? "+" : "\u2212";
      const mag = Math.abs(v);
      switch (unit) {
        case "money":
          return `${arrow} ${sign}${fmtMoney2(mag).replace(/^\+/, "")}`;
        case "r":
          return `${arrow} ${sign}${mag.toFixed(2)}R`;
        case "percent":
          return `${arrow} ${sign}${mag.toFixed(1)} pp`;
        case "factor":
          return `${arrow} ${sign}${mag.toFixed(2)}`;
        default:
          return `${arrow} ${sign}${minutes(mag)}`;
      }
    };

    // The analyst line: the moves that stand out from chance, one per family,
    // never padded with noise. Each is named with its own value. Only once
    // there are enough candidates and enough history for the ranking to mean.
    const candidatesWithData = trends.moves.filter((move) => move.before !== null && move.after !== null).length;
    const gated = trends.enough && candidatesWithData >= 8;
    const ranked = gated ? rankTrendMoves(trends.moves) : { gains: [], declines: [] };
    if (gated) {
      const strip = body.createDiv({ cls: "tj-trendsummary" });
      const line = strip.createDiv({ cls: "tj-trendsummary-line" });
      const show = (cls: string, key: string, rows: typeof ranked.gains): void => {
        if (!rows.length) return;
        line.createSpan({ cls: `tj-trendsummary-k ${cls}`, text: key });
        line.createSpan({ text: rows.map((move) => `${move.label} ${writeDelta(move.delta, move.unit)}`).join("  \u00b7  ") });
      };
      show("is-gain", "Improved", ranked.gains);
      show("is-decline", "Declined", ranked.declines);
      if (!ranked.gains.length && !ranked.declines.length) {
        line.addClass("is-quiet");
        // Say which of the two truths it is: directions moved but none is
        // distinguishable from chance, or literally nothing moved.
        const moved = trends.rows.some((row) => isBetter(row) !== null);
        line.setText(
          moved
            ? "The direction moved, but nothing stands out from chance yet."
            : "Every move is within what chance would produce.",
        );
      }
    }

    const table = body.createDiv({ cls: "tj-trendtable", attr: { role: "table" } });
    const head = table.createDiv({ cls: "tj-trendrow is-head", attr: { role: "row" } });
    head.createDiv({ cls: "tj-trendname", text: "Metric", attr: { role: "columnheader" } });
    head.createDiv({ cls: "tj-trendval is-prev", text: `Previous ${trends.nBefore}`, attr: { role: "columnheader" } });
    head.createDiv({ cls: "tj-trendval", text: `Latest ${trends.nAfter}`, attr: { role: "columnheader" } });
    head.createDiv({ cls: "tj-trendval is-change", text: "Change", attr: { role: "columnheader" } });

    // Group the table by verdict, so better and worse never sit mixed: the eye
    // reads "what improved" and "what declined" as two blocks, not as arrows.
    // Tall cards also pull in the standout candidates that are not among the
    // seven core metrics, so the analyst line only ever names a visible row.
    const rank = (a: typeof trends.rows[number], b: typeof trends.rows[number]): number =>
      (a.p ?? 1) - (b.p ?? 1) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
    // A chip row is ~26px tall; only pull in as many standout candidates as the
    // card actually has room for, so a short card never clips the footer.
    const maxExtras = typeof h !== "number" || h < 6 ? 0 : h >= 7 ? 3 : 1;
    const extras = maxExtras
      ? [...ranked.gains, ...ranked.declines].filter((move) => !move.core).slice(0, maxExtras)
      : [];
    type Entry = { group?: { label: string; cls: string }; row?: typeof trends.rows[number] };
    const entries: Entry[] = [];
    if (trends.enough) {
      const pool = [...trends.rows, ...extras];
      const better = pool.filter((r) => isBetter(r) === true).sort(rank);
      const worse = pool.filter((r) => isBetter(r) === false).sort(rank);
      const neutral = trends.rows.filter((r) => isBetter(r) === null);
      for (const [label, cls, list] of [
        ["Better", "is-better", better],
        ["Worse", "is-worse", worse],
        ["No direction", "is-flat", neutral],
      ] as const) {
        if (!list.length) continue;
        entries.push({ group: { label, cls } });
        for (const row of list) entries.push({ row });
      }
    } else {
      for (const row of trends.rows) entries.push({ row });
    }

    for (const entry of entries) {
      if (entry.group) {
        const g = table.createDiv({ cls: `tj-trendgroup ${entry.group.cls}`, attr: { role: "row" } });
        g.createDiv({ cls: "tj-trendgroup-cell", text: entry.group.label, attr: { role: "cell" } });
        continue;
      }
      const row = entry.row!;
      const line = table.createDiv({ cls: "tj-trendrow", attr: { role: "row" } });
      const nameCell = line.createDiv({ cls: "tj-trendname", attr: { role: "cell" } });
      nameCell.createSpan({ text: row.label });
      // A candidate that is not one of the core seven says so on hover, so the
      // extra rows never look like they belong to the fixed table.
      if (!row.core) {
        attachTip(nameCell, {
          title: row.label,
          sub: "Not one of the core metrics \u2014 shown because it is one of the moves that stands out in this window.",
        });
      }
      line.createDiv({ cls: "tj-trendval is-prev", text: write(row.before, row.unit), attr: { role: "cell" } });
      line.createDiv({ cls: "tj-trendval", text: write(row.after, row.unit), attr: { role: "cell" } });
      const cell = line.createDiv({ cls: "tj-trenddelta", attr: { role: "cell" } });
      if (!trends.enough) {
        cell.setText("\u2014");
        attachTip(cell, { title: "Not enough history", sub: `Needs ${trends.minSample} trades on each side before a direction means anything.` });
        continue;
      }
      if (row.delta === null) {
        // History is enough, but one side has no finite figure to compare —
        // e.g. a profit factor with no losing decision. Not the same problem
        // as a thin sample, so it gets its own honest note.
        cell.setText("\u2014");
        attachTip(cell, { title: "No comparable figure", sub: "One side has no finite value to compare here (for example, a profit factor with no losing decision)." });
        continue;
      }
      const text = writeDelta(row.delta, row.unit);
      const better = isBetter(row);
      const verdict = better === true ? "Better" : better === false ? "Worse" : "Unchanged";
      // The chip carries the verdict: green when the metric improved, red when
      // it declined — independent of whether the number went up or down.
      const chip = cell.createSpan({ cls: `tj-trendchip is-${better === true ? "better" : better === false ? "worse" : "flat"}` });
      chip.createSpan({ cls: "tj-trendarrow", text: text.split(" ")[0] });
      chip.createSpan({ text: text.split(" ").slice(1).join(" ") });
      // The previous value travels with the delta, so a narrow card never shows
      // a direction without its baseline (the PREVIOUS column drops at ≤320px).
      if (row.before !== null && Number.isFinite(row.before)) {
        cell.createSpan({ cls: "tj-trendwas", text: `was ${write(row.before, row.unit)}` });
      }
      // Is the move distinguishable from chance? A reading, not an instruction.
      // Shown only when it is not noise, so the calm rows stay calm; the state
      // always travels in the tooltip and the accessible label.
      const relText =
        row.reliability === "real" ? "Likely real" : row.reliability === "unclear" ? "Unclear" : row.reliability === "noise" ? "Likely noise" : "";
      const relPart = relText ? ` \u00b7 ${relText}` : "";
      if (row.reliability === "real" || row.reliability === "unclear") {
        cell.createSpan({ cls: "tj-trendconf", text: relText.toLowerCase() });
      }
      const base =
        row.before !== null && row.after !== null && Number.isFinite(row.before) && Number.isFinite(row.after)
          ? ` \u00b7 from ${write(row.before, row.unit)} to ${write(row.after, row.unit)}`
          : "";
      // Never aria-label a tip anchor — Obsidian would draw its own tooltip on
      // top of ours (lib/tip.ts). The verdict belongs in a visually-hidden span.
      cell.createSpan({ cls: "tj-sr-only", text: `${verdict}${relPart}${base}` });
      attachTip(cell, { title: verdict, sub: `${text}${relPart}${base}` });
    }

    body.createDiv({
      cls: "tj-trendnote",
      text: trends.enough
        ? `Latest ${trends.nAfter} trades against the ${trends.nBefore} before them \u2014 a direction, not a prediction.`
        : `Not enough history for a trend yet \u2014 ${trends.nAfter + trends.nBefore} trades here, and a direction needs ${trends.minSample} on each side of the split.`,
    });
    // A row that can never fill is a dead end unless we say what is missing.
    for (const c of trends.coverage) {
      const row = trends.rows.find((r) => r.id === c.metric);
      if (!row || !c.total) continue;
      if (row.before !== null || row.after !== null) continue;
      const text =
        c.have > 0
          ? `${row.label} is empty in this window \u2014 only ${c.have} of the ${c.total} trades here record ${c.needs}.`
          : `${row.label} needs ${c.needs} \u2014 none of the ${c.total} trades here have it yet.`;
      body.createDiv({ cls: "tj-trendnote", text });
    }
  }

  private homeTaskScopeLabel(): string {
    const period = this.dateRange === "custom"
      ? this.customRangeSummary()
      : SCORE_PERIOD_LABELS[this.dateRange] ?? "Selected period";
    return `${period} · ${this.scoreAccountLabel()}`;
  }

  renderFocusAreasWidget(body: HTMLElement, trades: Trade[], header?: HTMLElement): void {
    if (!trades.length) {
      body.createDiv({ cls: "tj-empty", text: "No trades in this period." });
      return;
    }
    // One decision per row, read from the original note: a copy is born
    // incomplete (`reviewed: false`) and must not be a second decision.
    const reps = tradeRows(trades).map((row) => row.rep);
    const hasRating = (t: Trade) => (t.rating ?? 0) > 0;
    const hasStop = (t: Trade) => typeof t.stopLoss === "number" && t.stopLoss > 0;
    // One row per gap, counted on that same original note, and only for gaps
    // the Trade Log can filter. "Unreviewed" takes trades that carry every
    // field, so no trade is ever counted by two rows. The count and the door's
    // lens are the same predicate — they cannot drift apart.
    const unreviewed = (t: Trade) =>
      hasText(t.setup) && hasPrint(t) && hasRating(t) && hasStop(t) && !reviewStatus(t).complete;
    // A reviewed decision is closed: it leaves the queue, so it is out of every
    // gap row — otherwise reviewing would never empty the queue. The rows still
    // measure facts; "Without stop" counts a rule's assumed risk as defined,
    // because the risk is, even when no stop was filed.
    const open = reps.filter((t) => !reviewStatus(t).complete);
    const openTotal = open.length;
    const rows: {
      label: string;
      icon: string;
      n: number;
      quality?: string;
      hint?: string;
      lens?: { label: string; test: (t: Trade) => boolean };
    }[] = [
      { label: "Without strategy", icon: "list", quality: "nosetup", n: open.filter((t) => !hasText(t.setup)).length },
      { label: "Without screenshot", icon: "image", quality: "noprint", n: open.filter((t) => !hasPrint(t)).length },
      { label: "Without rating", icon: "star", quality: "norating", n: open.filter((t) => !hasRating(t)).length },
      {
        label: "Without stop",
        icon: "alert-triangle",
        quality: "nostop",
        hint: "A default risk set for the symbol counts as defined — such a trade is not in this row.",
        n: open.filter((t) => !hasStop(t)).length,
      },
      { label: "Unreviewed", icon: "clipboard-check", lens: { label: "Unreviewed", test: unreviewed }, n: open.filter(unreviewed).length },
    ]
      .filter((row) => row.n > 0)
      .sort((a, b) => b.n - a.n);

    const title = header?.querySelector<HTMLElement>("h3");
    const scopeLabel = this.homeTaskScopeLabel();
    // The heading lives in the card header, which outlives every body redraw:
    // attach once, or each resize stacks another five listeners on the same h3.
    if (title && !title.dataset.tipAttached) {
      attachTip(title, {
        title: "Focus Areas",
        sub: `${scopeLabel}. Counts are decisions (copies never double-count). Each line opens the Trade Log.`,
      });
      title.dataset.tipAttached = "1";
    }

    // The coverage leads the body, centred: a ring whose arc is the reviewed
    // share and whose colour rides that same share (red → amber → green), then
    // the gaps below as clean one-line chips, ranked by size.
    const total = reps.length;
    // One number: how much of the journal is reviewed. How many of those were
    // actually written up is a detail, and only ever read by the tooltip.
    const review = reviewSummary(reps);
    const reviewed = review.complete;
    const writtenUp = review.writtenUp;
    const pct = total ? Math.round((reviewed / total) * 100) : 100;
    const hero = body.createDiv({ cls: "tj-focus-hero" });
    const ring = hero.createDiv({ cls: "tj-focus-ring" });
    // The ramp is a CSS colour-mix over the tone tokens, so it follows the
    // theme; the widget only says how far along the ramp it is. Two stops of
    // mix: bad → mid over the first half, mid → good over the second, so the
    // middle lands on amber instead of the mud a red→green mix makes there.
    ring.style.setProperty("--tj-focus-lo", `${Math.min(pct, 50) * 2}%`);
    ring.style.setProperty("--tj-focus-hi", `${Math.max(pct - 50, 0) * 2}%`);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 72 72");
    // The ring is only a picture: the figure is printed in the middle and the
    // caption under it, so a screen reader loses nothing.
    svg.setAttribute("aria-hidden", "true");
    const ringTrack = document.createElementNS(NS, "circle");
    ringTrack.setAttribute("class", "tj-focus-ring-track");
    ringTrack.setAttribute("cx", "36"); ringTrack.setAttribute("cy", "36"); ringTrack.setAttribute("r", "30");
    ringTrack.setAttribute("fill", "none"); ringTrack.setAttribute("stroke-width", "8");
    const ringArc = document.createElementNS(NS, "circle");
    ringArc.setAttribute("class", "tj-focus-ring-arc");
    ringArc.setAttribute("cx", "36"); ringArc.setAttribute("cy", "36"); ringArc.setAttribute("r", "30");
    ringArc.setAttribute("fill", "none"); ringArc.setAttribute("stroke-width", "8");
    ringArc.setAttribute("stroke-linecap", "round");
    ringArc.setAttribute("pathLength", "100");
    ringArc.setAttribute("stroke-dasharray", `${Math.max(0, Math.min(100, pct))} 100`);
    ringArc.setAttribute("transform", "rotate(-90 36 36)");
    svg.appendChild(ringTrack);
    svg.appendChild(ringArc);
    ring.appendChild(svg as unknown as Node);
    const ringNum = ring.createDiv({ cls: "tj-focus-ring-num", text: `${pct}%` });
    attachTip(ring, {
      title: "Review coverage",
      value: `${pct}%`,
      sub: `${reviewed} of ${total} decisions reviewed in this scope; ${writtenUp} of them hold the full checklist.`,
    });
    const legend = hero.createDiv({ cls: "tj-focus-legend" });
    legend.createDiv({ cls: "tj-focus-legend-value", text: `${reviewed} of ${total} decisions reviewed` });

    const list = body.createDiv({ cls: "tj-focus-list" });
    if (!rows.length) {
      const clear = list.createDiv({ cls: "tj-focus-clear" });
      const icon = clear.createSpan({ cls: "tj-focus-clear-icon" });
      setIcon(icon, "check-circle");
      clear.createSpan({ cls: "tj-focus-clear-text", text: "All caught up" });
      clear.createSpan({ cls: "tj-focus-clear-sub", text: "Every decision is settled." });
      return;
    }

    // Each gap: a clean one-line chip — icon, label, a bar of its share of the
    // decisions, count — with no surface of its own, like the Behavioral Tags.
    const chips: HTMLElement[] = [];
    for (const row of rows) {
      const attr: Record<string, string> = { type: "button" };
      if (row.quality) attr["data-flag"] = row.quality;
      else attr["data-lens"] = "unreviewed";
      const btn = list.createEl("button", { cls: "tj-focus-chip", attr });
      const icon = btn.createSpan({ cls: "tj-focus-chip-icon" });
      setIcon(icon, row.icon);
      btn.createSpan({ cls: "tj-focus-chip-label", text: row.label });
      const share = openTotal ? Math.round((row.n / openTotal) * 100) : 0;
      btn.createSpan({ cls: "tj-focus-chip-count", text: String(row.n) });
      // The label truncates on a two-column card, so the chip says it all.
      attachTip(btn, {
        title: row.label,
        value: `${row.n} of ${openTotal} decisions still open`,
        sub: `Opens the Trade Log filtered to this gap (${share}% of the decisions still open).${row.hint ? " " + row.hint : ""}`,
      });
      btn.addEventListener("click", () =>
        void this.plugin.openTradeLogView(
          row.quality
            ? { scope: this.tradeLogScope(), quality: [row.quality] }
            : { scope: this.tradeLogScope(), lens: row.lens },
        ),
      );
      chips.push(btn);
    }

    // Fit-driven: show every chip the card truly has room for; a quiet note says
    // how many are behind. The band always sits on top, so it pays out of the
    // chips' height — it gives way by degrees (compact, then hidden) until at
    // least one chip shows, and with what is left over the ring grows.
    let note: HTMLElement | null = null;
    const overflows = (): boolean => list.clientHeight > 0 && list.scrollHeight > list.clientHeight;
    const shown = (): number => chips.filter((el) => el.isConnected).length;
    // Trim chips under a reserved note row, so adding the note never evicts the
    // last chip that fit — the count hidden stays honest and one chip survives.
    const fit = (): void => {
      note?.remove();
      note = null;
      for (const el of chips) if (!el.isConnected) list.appendChild(el);
      if (!overflows()) return;
      note = list.createDiv({ cls: "tj-focus-note" });
      let rendered = chips.length;
      while (rendered > 0 && overflows()) {
        rendered--;
        chips[rendered].remove();
      }
      note.setText(`+${chips.length - rendered} more gap${chips.length - rendered === 1 ? "" : "s"}`);
    };
    // Whatever the chips do not need goes to the hero, which is the figure the
    // card is about — never to the rows, whose height must not drift on resize.
    // scrollHeight is clamped to the box, so the free space is measured between
    // the first and the last row.
    const RING_MAX = 120;
    const freeSpace = (): number => {
      const first = list.firstElementChild;
      const last = list.lastElementChild;
      if (!first || !last) return 0;
      const box = list.getBoundingClientRect();
      return box.height - (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top);
    };
    const growHero = (): boolean => {
      const slack = freeSpace();
      if (slack < 16) return false;
      const size = Math.min(RING_MAX, ring.offsetWidth + Math.floor(slack / 2));
      if (size <= ring.offsetWidth) return false;
      ring.style.width = `${size}px`;
      ring.style.height = `${size}px`;
      ringNum.style.fontSize = `${Math.round(size * 0.24)}px`;
      return true;
    };
    if (body.clientHeight > 0) {
      fit();
      if (!shown()) {
        hero.classList.add("is-compact");
        fit();
        if (!shown()) {
          hero.style.display = "none";
          fit();
        }
      }
      // The ring grows only at full size: the compact band exists precisely
      // because there is no room to spare. Two passes — the first sizes the ring
      // to the free space, the second re-trims if the taller hero cost a row.
      if (shown() && !hero.classList.contains("is-compact")) {
        for (let pass = 0; pass < 2 && growHero(); pass++) fit();
      }
    }
  }

  renderAccountsPreviewWidget(body: HTMLElement, header?: HTMLElement): void {
    const movement = this.homeAccountMovement();
    const accounts = [...movement.accounts].sort((a, b) =>
      typeRank(a.account.type) - typeRank(b.account.type) ||
      (a.account.copyRole === "base" ? -1 : 0) - (b.account.copyRole === "base" ? -1 : 0) ||
      a.account.name.localeCompare(b.account.name),
    );
    header?.querySelector(".tj-home-accounts-link")?.remove();
    const all = (header ?? body).createEl("button", {
      cls: "tj-home-accounts-link",
      text: `View all · ${accounts.length}`,
      attr: { type: "button" },
    });
    all.addEventListener("click", () => void this.plugin.openAccounts());
    if (!accounts.length) {
      body.createDiv({ cls: "tj-empty", text: "No accounts in this selection." });
      return;
    }

    // The hero shows one account; the list selects it. Selection lives in memory
    // for the life of the view, so re-renders keep the account the trader picked.
    const selectedId = accounts.some((a) => a.account.id === this._homeAccountsSelectedId)
      ? (this._homeAccountsSelectedId as string)
      : accounts[0].account.id;
    this._homeAccountsSelectedId = selectedId;
    const selected = accounts.find((a) => a.account.id === selectedId) ?? accounts[0];
    const roleLabel = (role?: string): string => (role === "base" ? "Leader" : role === "copier" ? "Copier" : "");
    const subOf = (a: typeof accounts[number]): string =>
      [typeLabel(a.account.type), roleLabel(a.account.copyRole)].filter(Boolean).join(" · ");

    const wrap = body.createDiv({ cls: "tj-ha" + (accounts.length === 1 ? " is-single" : "") });
    const hero = wrap.createDiv({ cls: "tj-ha-hero" });

    const head = hero.createDiv({ cls: "tj-ha-hero-head" });
    const info = head.createDiv({ cls: "tj-ha-hero-info" });
    info.createDiv({ cls: "tj-ha-hero-name", text: selected.account.name });
    info.createDiv({ cls: "tj-ha-hero-type", text: subOf(selected) });
    const balance = head.createDiv({ cls: "tj-ha-hero-bal", text: fmtMoneyAbs(selected.balance, 2) });
    attachTip(balance, {
      title: "Journal-recorded value",
      value: fmtMoneyAbs(selected.balance, 2),
      sub: "Recorded balance from configured capital and logged movements — not live broker equity.",
    });
    const open = head.createEl("button", { cls: "tj-ha-open", text: "Open ↗", attr: { type: "button" } });
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.plugin.openAccountDashboard(undefined, selected.account.id);
    });

    // The chart container is created here (DOM order: head, chart, facts) but
    // drawn after the facts and list are in the DOM, so it measures its final
    // height — `preserveAspectRatio="none"` stretches the axis text otherwise.
    const chart = hero.createDiv({ cls: "tj-ha-chart" });

    const netTrading = movement.trades
      .filter((t) => this.accountMatches(t, selected.account))
      .reduce((sum, t) => sum + netPnl(t), 0);
    const capital = selected.account.size || 0;
    const payouts = this.plugin.payoutsFor(selected.account.id).reduce((sum, p) => sum + Math.abs(p.amount), 0);
    const changeVsSize = selected.balance - capital;
    const type = selected.account.type;
    // Payouts exist only for the accounts the account page offers them on
    // (funded / live / personal); an eval reports progress toward its target.
    const payoutType = type === "funded" || type === "live" || type === "personal";
    const target = resolveAccountView(selected.account).rules.target;
    const targetPct = type === "eval" && target > 0 ? (netTrading / target) * 100 : null;

    const facts = hero.createDiv({ cls: "tj-ha-facts" });
    const fact = (label: string, text: string, tone = ""): void => {
      const cell = facts.createDiv({ cls: "tj-ha-fact" });
      cell.createDiv({ cls: "tj-ha-fact-k", text: label });
      cell.createDiv({ cls: ("tj-ha-fact-v " + tone).trim(), text });
    };
    const toneOf = (n: number): string => (n > 0 ? "tj-pos" : n < 0 ? "tj-neg" : "");
    fact("Net trading", fmtMoney2(netTrading), toneOf(netTrading));
    if (payoutType) fact("Payouts", fmtMoneyAbs(payouts, 2));
    else if (type === "eval") {
      fact(
        "Target progress",
        targetPct === null ? "—" : `${targetPct.toFixed(0)}%`,
        targetPct !== null && targetPct >= 100 ? "tj-pos" : "",
      );
    }
    fact("Capital", fmtMoneyAbs(capital, 2));
    fact("Change vs size", fmtMoney2(changeVsSize), toneOf(changeVsSize));

    if (accounts.length > 1) {
      const list = wrap.createDiv({ cls: "tj-ha-list" });
      for (const snapshot of accounts) {
        const on = snapshot.account.id === selectedId;
        const row = list.createEl("button", {
          cls: "tj-ha-row" + (on ? " is-on" : ""),
          attr: {
            type: "button",
            "aria-pressed": String(on),
            "aria-label": `${snapshot.account.name}, ${subOf(snapshot)}, journal-recorded value ${fmtMoneyAbs(snapshot.balance, 2)}`,
          },
        });
        row.createSpan({ cls: "tj-ha-row-name", text: snapshot.account.name });
        const meta = row.createSpan({ cls: "tj-ha-row-meta" });
        meta.createSpan({ cls: "tj-ha-row-sub", text: subOf(snapshot) });
        meta.createSpan({ cls: "tj-ha-row-bal", text: fmtMoneyAbs(snapshot.balance, 2) });
        row.addEventListener("click", () => {
          if (snapshot.account.id === this._homeAccountsSelectedId) return;
          this._homeAccountsSelectedId = snapshot.account.id;
          // Redraw only this widget, not the whole page: a full render rebuilds
          // every card and the scroll restore drifts a little on each click.
          const host = row.closest<HTMLElement>(".tj-gridcard-body");
          const redraw = host ? this.bodyRenderers.get(host) : undefined;
          if (redraw) redraw();
        });
      }
    }

    // Draw last: the hero has its final height, so the SVG viewBox matches and
    // the axis labels are not stretched. One frame later, redraw only if the
    // box still settled (fonts / grid), so a stale measurement cannot survive.
    const drawChart = (): void => {
      chart.empty();
      if (selected.days.length) {
        renderLineChart(chart, {
          values: [capital, ...selected.days.map((day) => capital + day.cumulative)],
          dates: [selected.days[0].date, ...selected.days.map((day) => day.date)],
          baseline: capital,
          baseLine: capital,
          fadeFloor: capital,
          key: `home-account-balance:${selected.account.id}`,
          format: this.plugin.settings.dateFormat,
          animations: this.plugin.settings.animations !== false,
        });
      } else {
        chart.createDiv({ cls: "tj-ha-nohistory", text: "No recorded history" });
      }
    };
    drawChart();
    const chartW = chart.clientWidth;
    const chartH = chart.clientHeight;
    requestAnimationFrame(() => {
      if (!chart.isConnected) return;
      if (Math.abs(chart.clientWidth - chartW) > 1 || Math.abs(chart.clientHeight - chartH) > 1) drawChart();
    });
  }

  /** Opens the Trade Log filtered to a single day (calendar day click). */
  private async openDayInTradeLog(dateKey: string): Promise<void> {
    await this.plugin.openTradeLogForDay(dateKey);
  }

  /** Preserve Home's exact journal-zone bounds when handing a scope to the
   * Trade Log, whose own visible presets remain unchanged. */
  private tradeLogScope(): {
    period: string;
    customFrom: string;
    customTo: string;
    dateBounds?: { start: string; end: string; label: string };
    accountId: string | null;
    accountType: string;
  } {
    const scope = {
      period: this.dateRange,
      customFrom: this.customFrom,
      customTo: this.customTo,
      // The Trade Log still takes one account/type; pass it only when Home has
      // exactly one of each, otherwise open wide rather than pick arbitrarily.
      accountId: this._accountIds.length === 1 ? this._accountIds[0] : null,
      accountType: this._accountTypes.length === 1 ? this._accountTypes[0] : "all",
    };
    if (this.viewKey() === "home" && this.dateRange !== "all") {
      const bounds = this.briefingBounds();
      if (bounds?.start && bounds.end) {
        scope.customFrom = bounds.start;
        scope.customTo = bounds.end;
        return {
          ...scope,
          dateBounds: {
            start: bounds.start,
            end: bounds.end,
            label: SCORE_PERIOD_LABELS[this.dateRange] ?? "Custom",
          },
        };
      }
    }
    return scope;
  }

  /** Trading Activity heatmap over the existing six-month window. */
  renderHeatmap(body: HTMLElement, trades: Trade[], _counted: Trade[] = trades, asOf?: string, header?: HTMLElement): void {
    const title = header?.querySelector<HTMLElement>("h3");
    if (title && !title.dataset.tipAttached) {
      attachTip(title, {
        title: "Trading Activity",
        sub: "Daily Net P&L over the last six months. Green = positive day, red = negative.",
      });
      title.dataset.tipAttached = "1";
    }
    // Only this widget's own hover card is cleared — the blanket `.tj-tip`
    // sweep used to remove every other widget's tooltip on each redraw.
    document.querySelectorAll(".tj-heat-tip").forEach((n) => n.remove());

    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // The window ends at the Home's historical as-of date when one is given,
    // so a past period never reaches forward into later data.
    const endRef = asOf ? new Date(asOf + "T00:00:00") : new Date();
    const end = new Date(endRef.getFullYear(), endRef.getMonth(), endRef.getDate());
    const endIso = iso(end);
    const first = new Date(end.getFullYear(), end.getMonth() - 5, 1);
    const firstIso = iso(first);

    const source = trades.filter((t) => {
      const day = this.scoreDayKey(t);
      return !!day && day >= firstIso && day <= endIso;
    });
    const financials = this.financialsFor(source, (trade) => this.scoreDayKey(trade));
    const byDay = new Map<string, { pnl: number; count: number; wins: number; losses: number; coverage: string }>();
    for (const [day, pnl] of financials.net.byDay) {
      const decisions = financials.decisionsByDay.get(day);
      byDay.set(day, {
        pnl,
        count: decisions?.count ?? 0,
        wins: decisions?.wins ?? 0,
        losses: decisions?.losses ?? 0,
        coverage: this.costCoverageWarning(financials),
      });
    }
    if (!byDay.size) {
      body.createDiv({ cls: "tj-empty", text: "No trades yet." });
      return;
    }
    const startMon = new Date(first);
    startMon.setDate(startMon.getDate() - ((startMon.getDay() + 6) % 7));
    const weeks: Date[] = [];
    for (const d = new Date(startMon); d <= end; d.setDate(d.getDate() + 7)) weeks.push(new Date(d));

    const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const maxAbs = Math.max(...[...byDay.values()].map((b) => Math.abs(b.pnl)), 1);
    // Size the cells to fit BOTH dimensions: the height sets the natural cell,
    // then the width caps it so the six-month grid never runs off the card.
    const bodyW = body.clientWidth || 0;
    const bodyH = body.clientHeight || 0;
    let cell = bodyH > 0 ? Math.floor((bodyH - 46) / 7) : 12;
    if (bodyW > 0 && weeks.length) {
      const labelInset = bodyW > 384 ? 26 : 0;
      const avail = bodyW - 24 - labelInset - (weeks.length - 1) * 3;
      cell = Math.min(cell, Math.floor(avail / weeks.length));
    }
    // Grow the cell with the card (up to a ceiling) so a large card is not a sea
    // of empty space; the width cap still keeps the six-month grid on the card.
    cell = Math.max(4, Math.min(20, cell));

    const wrap = body.createDiv({ cls: "tj-heat" });
    const scroll = wrap.createDiv({ cls: "tj-heat-scroll" });
    const monthsRow = scroll.createDiv({ cls: "tj-heat-months" });
    const main = scroll.createDiv({ cls: "tj-heat-main" });
    const days = main.createDiv({ cls: "tj-heat-days" });
    const wcol = main.createDiv({ cls: "tj-heat-weeks" });

    for (let i = 0; i < 7; i++) {
      const s = days.createDiv({ cls: "tj-heat-day" });
      s.style.height = `${cell}px`;
      if (i % 2 === 0) s.setText(DAYS[i]);
    }

    let lastMonth = -1;
    let lastLabelAt = -99;
    const monthLabelGap = cell <= 5 ? 4 : 3;
    weeks.forEach((w, wi) => {
      const col = wcol.createDiv({ cls: "tj-heat-col" });
      const slot = monthsRow.createDiv({ cls: "tj-heat-mslot" });
      slot.style.width = `${cell}px`;
      if (w.getMonth() !== lastMonth) {
        lastMonth = w.getMonth();
        // Skip a label if it would collide with the previous one (like GitHub).
        if (wi - lastLabelAt >= monthLabelGap) {
          lastLabelAt = wi;
          slot.setText(MON_ABBR[lastMonth]);
        }
      }
      for (let i = 0; i < 7; i++) {
        const d = new Date(w);
        d.setDate(d.getDate() + i);
        const c = col.createDiv({ cls: "tj-heat-cell tj-tip-anchor" });
        c.style.width = `${cell}px`;
        c.style.height = `${cell}px`;
        if (d < first || d > end) {
          c.addClass("is-empty");
          continue;
        }
        const key = iso(d);
        const b = byDay.get(key);
        if (!b) continue;
        // The colour is composed by CSS from the tone tokens; only the intensity
        // travels inline, the same pattern the treemap uses.
        const strength = 0.22 + Math.min(1, Math.abs(b.pnl) / maxAbs) * 0.55;
        c.addClass(b.pnl > 0 ? "pos" : b.pnl < 0 ? "neg" : "flat");
        c.style.setProperty("--tj-heat-strength", strength.toFixed(2));
        this.bindHeatTip(c, key, b);
      }
    });

    const legend = wrap.createDiv({ cls: "tj-heat-legend" });
    const scale = (label: string, tone: "pos" | "neg"): void => {
      const group = legend.createDiv({ cls: "tj-heat-scale" });
      group.createSpan({ cls: "tj-heat-scale-k", text: label });
      group.createSpan({ cls: "tj-heat-scale-end", text: "Less" });
      for (const s of [0.18, 0.4, 0.65, 0.9]) {
        const sq = group.createEl("i");
        sq.addClass(tone);
        sq.style.setProperty("--tj-heat-strength", s.toFixed(2));
      }
      group.createSpan({ cls: "tj-heat-scale-end", text: "More" });
    };
    scale("Profit", "pos");
    scale("Loss", "neg");
  }

  private bindHeatTip(cell: HTMLElement, key: string, b: { pnl: number; count: number; wins: number; losses: number; coverage: string }): void {
    cell.addEventListener("mouseenter", () => {
      const [y, m, d] = key.split("-");
      const decided = b.wins + b.losses;
      const rate = decided ? `${Math.round((b.wins / decided) * 100)}%` : "—";
      showTip(
        {
          title: formatDate(key, this.plugin.settings.dateFormat) || `${parseInt(d, 10)} ${MON_ABBR[parseInt(m, 10) - 1]} ${y}`,
          value: fmtMoney2(b.pnl),
          tone: b.pnl >= 0 ? "pos" : "neg",
          sub: `${b.count} trade${b.count === 1 ? "" : "s"} · ${rate} Net win rate · Net P&L${b.coverage}`,
        },
        "tj-heat-tip"
      );
    });
    cell.addEventListener("mousemove", (e) => moveTip(e));
    cell.addEventListener("mouseleave", () => killTip());
  }

  /** Trading Score — rendered by the shared widget module, so Home and
   *  Analytics always show the same responsive implementation. */
  renderScoreWidget(body: HTMLElement, trades: Trade[], scopeLabel: string, header?: HTMLElement): void {
    if (!trades.length) {
      renderEmptyBox(body, {
        title: "No trades in this period",
        sub: "A score needs at least a few trades. Widen the period or change the account scope.",
      });
      return;
    }
    const result = computeScore(trades, (t) => this.scoreDayKey(t));
    const animate = this.plugin.settings.animations !== false && !this._scoreAnimated;
    this._scoreAnimated = true;
    renderTradingScore(body, result, scopeLabel, animate, header);
  }

  /** Whole minutes held, or null when there is nothing to measure: the real
   *  elapsed time between the two instants when the note has them, the recorded
   *  clock (with its midnight wrap) otherwise. */
  private holdMinutes(t: Trade): number | null {
    return holdMinutesOf(t);
  }

  /** "1h 24m" / "18m" / "45s" from minutes. */
  private fmtHold(mins: number): string {
    const total = Math.round(mins * 60);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }


  /**
   * Breakdown — one widget with six tabs, all rendering the same treemap of
   * activity-sized tiles coloured by result. Categorical dimensions are ordered
   * by activity; the timelines (Weekday · Hour · Session) read chronologically
   * and show every bucket that has trades. The selected tab is persisted.
   */
  renderBreakdownWidget(body: HTMLElement, trades: Trade[], header?: HTMLElement): void {
    const zone = this.plugin.settings.timeZone;
    const weekdayOf = (t: Trade): string => {
      const d = this.scoreDayKey(t);
      const [y, m, day] = d.split("-").map(Number);
      return WEEKDAYS[new Date(y, m - 1, day).getDay()] ?? "—";
    };
    const sessionOrder = (label: string): number => {
      // Clock order: London opens, then New York, then the afternoon gap, then Asia.
      if (label === "London") return 0;
      if (label === "New York") return 1;
      if (label === "Off Hours") return 2;
      if (label === "Asia") return 3;
      return 4;
    };
    interface Dim {
      id: string;
      label: string;
      key: (t: Trade) => string;
      labelOf?: (k: string) => string;
      orderOf?: (k: string) => number;
      /** Timeline dimensions show every bucket that has trades, never "Other". */
      timeline?: boolean;
    }
    const dims: Dim[] = [
      { id: "symbol", label: "Symbol", key: (t) => t.symbol || "—" },
      { id: "setup", label: "Setup", key: (t) => t.setup || "No strategy" },
      { id: "order-type", label: "Type", key: (t) => normalizeOrderType(t.orderType) || "—" },
      {
        id: "weekday", label: "Day", key: weekdayOf, timeline: true,
        orderOf: (k) => {
          const i = WEEKDAY_ORDER.indexOf(k);
          return i < 0 ? 99 : i;
        },
      },
      {
        id: "hour", label: "Hour", key: (t) => hourBlockOf(t, zone), timeline: true,
        labelOf: (k) => (k === "—" ? "—" : fmtHourLabel(Number(k))),
        orderOf: hourOrder,
      },
      {
        id: "session", label: "Session", key: (t) => sessionLabel(t, zone), timeline: true,
        orderOf: sessionOrder,
      },
    ];
    let current = this.plugin.settings.dashboardBreakdownTab ?? "symbol";
    if (!dims.some((d) => d.id === current)) current = "symbol";

    const wrap = body.createDiv({ cls: "tj-bd" });
    const title = header?.querySelector<HTMLElement>("h3");
    if (title && !title.dataset.tipAttached) {
      attachTip(title, {
        title: "Breakdown · Net",
        sub: `Sums eligible in-scope legs; copy-count follows the portfolio rule.${this.incompleteCostNote(this.financialsFor(trades))}`,
      });
      title.dataset.tipAttached = "1";
    }
    // Tabs sit on the card's title line, top-right (like the account page), so the
    // body is all chart and there is no empty band under the tabs. Re-draws clear
    // the previous set first, or resizing would stack them.
    let tabs: HTMLElement;
    if (header) {
      header.querySelectorAll(".tj-bd-tabs").forEach((el) => el.remove());
      tabs = header.createDiv({ cls: "tj-bd-tabs tj-bd-tabs-head" });
      header.insertBefore(tabs, header.querySelector(".tj-card-controls"));
    } else {
      tabs = wrap.createDiv({ cls: "tj-bd-tabs" });
    }
    const panel = wrap.createDiv({ cls: "tj-bd-body" });
    const buttons = new Map<string, HTMLElement>();

    const draw = () => {
      panel.empty();
      const dim = dims.find((d) => d.id === current) ?? dims[0];
      const tiles = dimensionTiles(trades, dim.key, {
        labelOf: dim.labelOf,
        orderOf: dim.orderOf,
        formatMoney: fmtMoney2,
        countPopulation: this.plugin.settings.includeCopiesInPortfolioAnalytics === true ? "account leg" : "trade",
        dayKey: (t) => this.scoreDayKey(t),
      });
      if (!tiles.length) {
        panel.createDiv({ cls: "tj-empty", text: "No trades in this period." });
        return;
      }
      // Timeline tabs keep every bucket: hours only exist where trades exist, and
      // a seven-day week must not lose Sunday to an "Other" tile. Tile value is
      // compact so it never ellipsises to a meaningless fragment; the full figure
      // and win% live in the tooltip.
      // Carry the grid's own scope into the Trade Log, so a click means "these
      // trades, as I was looking at them" — period, dates, account and class.
      const scope = this.tradeLogScope();
      const openTile = (tile: { key: string; label: string }): void => {
        void this.plugin.openTradeLogForBreakdown(
          `${dim.label}: ${tile.label}`,
          // Archived trades are out of every Home number, so the lens must leave
          // them out too — otherwise the ledger shows rows the tile never counted.
          (t) => !this.plugin.isArchivedTrade(t) && (dim.key(t) || "") === tile.key,
          scope
        );
      };
      // When the tiles would be too narrow for readable names and values, switch
      // to a list: category names and their main figure stay visible with no
      // hover. The treemap merges the tail into "Other"; the list shows every
      // bucket, so nothing is hidden from the reader.
      const panelW = panel.clientWidth || body.clientWidth || 0;
      const shown = dim.timeline ? tiles.length : Math.min(tiles.length, 6);
      const perTile = shown > 0 ? (panelW - (shown - 1) * 6) / shown : 0;
      if (panelW > 0 && (panelW < 260 || perTile < 72)) {
        const list = panel.createDiv({ cls: "tj-bd-list" });
        for (const t of tiles) {
          const row = list.createDiv({ cls: "tj-bd-row" });
          row.createDiv({ cls: "tj-bd-row-name", text: t.label });
          row.createDiv({ cls: "tj-bd-row-win", text: t.decided ? `${Math.round((t.wins / t.decided) * 100)}%` : "—" });
          row.createDiv({ cls: "tj-bd-row-val " + (t.net >= 0 ? "tj-pos" : "tj-neg"), text: fmtMoney2(t.net) });
          attachTip(row, { title: `${t.label} · Net`, value: fmtMoney2(t.net), sub: `${t.count} ${this.plugin.settings.includeCopiesInPortfolioAnalytics ? "account legs" : "trades"} · Net win rate` });
          row.addEventListener("click", () => openTile(t));
        }
        return;
      }
      renderTreemap(panel, {
        tiles,
        className: "tj-bd-treemap",
        maxTiles: dim.timeline ? tiles.length : undefined,
        formatMoney: fmtMoneyCompact,
        onTileClick: openTile,
      });
    };

    for (const dim of dims) {
      const b = tabs.createEl("button", {
        cls: "tj-bd-tab" + (current === dim.id ? " on" : ""),
        text: dim.label,
        attr: { type: "button" },
      });
      buttons.set(dim.id, b);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (current === dim.id) return;
        current = dim.id;
        this.plugin.settings.dashboardBreakdownTab = dim.id;
        void this.plugin.saveSettings();
        for (const [key, btn] of buttons) btn.toggleClass("on", key === dim.id);
        draw();
      });
    }
    draw();
  }

  /**
   * Behavioral Tags — how often each Mistake / Psychology tag was logged in the
   * selection, bar-ranked by frequency, with the footer splitting Net between the
   * trades that carry a tag and the ones that do not. The tab is persisted; a bar
   * opens the Trade Log on that tag.
   */
  renderBehavioralTagsWidget(body: HTMLElement, trades: Trade[], header?: HTMLElement): void {
    let current: "mistakes" | "psychology" =
      this.plugin.settings.dashboardTagsTab === "psychology" ? "psychology" : "mistakes";
    // Legacy notes carry one free-text mistake instead of the tag list.
    const tagsOf = (t: Trade): string[] =>
      normalizeTags(
        current === "mistakes"
          ? t.mistake_tags?.length
            ? t.mistake_tags
            : t.mistake
              ? [t.mistake]
              : []
          : t.psychology_tags ?? [],
      );

    // A subset's summary, on the basis the Breakdown tiles use: every account
    // present in the subset is in scope, copied legs summed into decisions.
    const subsetSummary = (rows: Trade[]): FinancialSummary | null => {
      if (!rows.length) return null;
      const accountKey = (t: Trade): string =>
        String(t.account ?? "").trim().toLocaleLowerCase() || "unassigned";
      return summarizeFinancials(rows, {
        scope: {
          kind: "all-included-accounts",
          accountIdOf: accountKey,
          includedAccountIds: new Set(rows.map(accountKey)),
        },
        dayKey: (t) => this.scoreDayKey(t),
      });
    };
    const netOf = (rows: Trade[]): number => subsetSummary(rows)?.net.total ?? 0;

    const wrap = body.createDiv({ cls: "tj-tags-wrap" });
    const title = header?.querySelector<HTMLElement>("h3");
    if (title && !title.dataset.tipAttached) {
      attachTip(title, {
        title: "Behavioral Tags",
        sub: `How often each tag was logged and its Net win rate; footer splits Net by tagged vs clean.${this.incompleteCostNote(this.financialsFor(trades))}`,
      });
      title.dataset.tipAttached = "1";
    }

    // Tabs sit on the card's title line, top-right — the Breakdown pattern, so
    // the body is all bars. Re-draws clear the previous set first, or resizing
    // would stack them.
    let tabs: HTMLElement;
    if (header) {
      header.querySelectorAll(".tj-tags-tabs").forEach((el) => el.remove());
      tabs = header.createDiv({ cls: "tj-tags-tabs tj-tags-tabs-head" });
      header.insertBefore(tabs, header.querySelector(".tj-card-controls"));
    } else {
      tabs = wrap.createDiv({ cls: "tj-tags-tabs" });
    }
    const bars = wrap.createDiv({ cls: "tj-tags-bars" });
    let footer: HTMLElement | null = null;

    const draw = () => {
      bars.empty();
      footer?.remove();
      footer = null;
      if (!trades.length) {
        bars.createDiv({ cls: "tj-empty", text: "No trades recorded yet." });
        return;
      }
      // Counted list: a copied leg never tips the tally twice.
      const counts = new Map<string, number>();
      let occurrences = 0;
      for (const t of this.countsList(trades)) {
        for (const tag of tagsOf(t)) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
          occurrences++;
        }
      }
      if (!counts.size) {
        bars.createDiv({ cls: "tj-empty", text: "No tags logged yet." });
        return;
      }
      // Frequency first, then the suggested-label order, then alphabetical —
      // custom tags still show, they just never jump the queue on a tie.
      const defaults = reviewOptions(this.plugin.settings, current);
      const rank = (tag: string): number => {
        const i = defaults.findIndex((d) => d.toLowerCase() === tag.toLowerCase());
        return i < 0 ? defaults.length : i;
      };
      const ranked = [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
      );
      const max = ranked[0][1];
      // The footer takes its slice of the card first, so the bar area is only
      // measured once its own height is final. Always present: growing the card
      // can then only reveal more rows, never trade a row for the footer.
      const tagged: Trade[] = [];
      const clean: Trade[] = [];
      for (const t of trades) (tagsOf(t).length ? tagged : clean).push(t);
      const money = (rows: Trade[]): string => (rows.length ? fmtMoney2(netOf(rows)) : "—");
      footer = wrap.createDiv({
        cls: "tj-tags-footer",
        text: `${occurrences} occurrence${occurrences === 1 ? "" : "s"} · net ${money(tagged)} vs ${money(clean)}`,
      });
      attachTip(footer, {
        title: "Tagged vs clean",
        sub: `Net of ${tagged.length} ${current === "mistakes" ? "execution-mistake" : "psychology"}-tagged trades vs ${clean.length} clean.`,
      });
      // Every tag starts as a row with its count; the win rate is deferred to
      // the survivors, so a hidden tag never costs a full summary.
      const rows: HTMLElement[] = [];
      const wins: HTMLElement[] = [];
      for (const [tag, count] of ranked) {
        const row = bars.createDiv({ cls: "tj-tags-row" });
        row.createDiv({ cls: "tj-tags-label", text: tag });
        const track = row.createDiv({ cls: "tj-tags-track" });
        const fill = track.createDiv({ cls: "tj-tags-fill" });
        fill.style.width = `${Math.max(1, Math.round((count / max) * 100))}%`;
        const meta = row.createDiv({ cls: "tj-tags-meta" });
        meta.createSpan({ cls: "tj-tags-count", text: String(count) });
        wins.push(meta.createSpan({ cls: "tj-tags-win", text: "" }));
        rows.push(row);
      }
      // Fit-driven, both ways: the card shows as many rows as it truly has room
      // for, so resizing it larger reveals tags the smaller card hid.
      const overflows = (): boolean =>
        bars.clientHeight > 0 && bars.scrollHeight > bars.clientHeight;
      let rendered = rows.length;
      while (rendered > 0 && overflows()) {
        rendered--;
        rows[rendered].remove();
      }
      // Only a genuinely non-fitting tail earns the note. It is measured after
      // the rows, so it can never steal a row that would otherwise fit.
      let note: HTMLElement | null = null;
      if (rendered < ranked.length) {
        note = bars.createDiv({ cls: "tj-tags-more" });
        while (rendered > 0 && overflows()) {
          rendered--;
          rows[rendered].remove();
        }
      }
      // In front: the tag's Net win rate — how the decisions carrying it decided.
      // The Net travels in the tooltip; both read the same Breakdown base.
      for (let i = 0; i < rendered; i++) {
        const [tag, count] = ranked[i];
        const row = rows[i];
        const summary = subsetSummary(
          trades.filter((t) => tagsOf(t).some((x) => x.toLowerCase() === tag.toLowerCase())),
        );
        const winRate = summary?.net.winRate ?? null;
        const net = summary?.net.total ?? 0;
        const winText = winRate === null ? "—" : `${Math.round(winRate * 100)}%`;
        wins[i].setText(winText);
        attachTip(row, {
          title: tag,
          value: `${winText} Net win rate`,
          sub: `${count} occurrence${count === 1 ? "" : "s"} · Net ${fmtMoney2(net)}. Opens the Trade Log filtered to it.`,
        });
        row.addEventListener("click", () => {
          void this.plugin.openTradeLogView({
            scope: this.tradeLogScope(),
            ...(current === "mistakes" ? { mistakeTags: [tag] } : { psychologyTags: [tag] }),
          });
        });
      }
      // A tag that did not fit is named, never silently dropped.
      const more = ranked.length - rendered;
      if (note && more > 0) {
        note.setText(`+${more} more tag${more === 1 ? "" : "s"}`);
        attachTip(note, {
          title: `${more} more`,
          sub: ranked.slice(rendered).map(([tag]) => tag).join(", "),
        });
      }
    };

    const buttons = new Map<string, HTMLElement>();
    for (const [id, label] of [
      ["mistakes", "Mistakes"],
      ["psychology", "Psychology"],
    ] as const) {
      const b = tabs.createEl("button", {
        cls: "tj-tags-tab" + (current === id ? " on" : ""),
        text: label,
        attr: { type: "button" },
      });
      buttons.set(id, b);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (current === id) return;
        current = id;
        this.plugin.settings.dashboardTagsTab = id;
        void this.plugin.saveSettings();
        for (const [key, btn] of buttons) btn.toggleClass("on", key === id);
        draw();
      });
    }
    draw();
  }

  async openTrade(t: Trade): Promise<void> {
    if (!t.id) return;
    await this.plugin.openTradeModal(t);
  }
}
