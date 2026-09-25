import { ItemView, setIcon, TFile } from "obsidian";
import type TradebookPlugin from "../main";
import { PropAccount, Trade } from "../types";
import { accountFilters, attachTooltip, kpiCard, renderAppShell, svgLine, svgPath } from "../ui";
import { firmLabel as catalogLabel } from "../lib/firmLogos";
import { fmtMoney2, fmtMoneyAbs, fmtMoneyCompact, isFiniteNumber, todayKey, zoneWallParts } from "../tz";
import { updateTradeFields } from "../storage";
import { attachTip } from "../lib/tip";
import { mountDropdown, type DropdownItem } from "../lib/dropdown";
import { netPnl } from "../lib/fees";
import { renderEmptyState as renderEmptyBox } from "../lib/emptyState";
import {
  clamp as gClamp,
  collides,
  compactVertical,
  GAP,
  GRID_COLS,
  GridItem,
  gridRows,
  layoutForColumns,
  moveItem as gridMove,
  placeNew,
  resizeItem as gridResize,
  ROW_PX,
} from "../lib/grid";
import { PerformanceCalendarWidget } from "../widgets/performanceCalendarWidget";
import { renderTradingScore } from "../widgets/tradingScoreWidget";
import { METRIC_TITLES, metricById } from "../lib/metrics";
import { holdMinutesOf, tradeHourInZone } from "../lib/instant";
import { accountResolver, accountScope, analyticsTrades, journalDayKey } from "../lib/scope";
import { summarizeFinancials, FinancialScope, FinancialSummary } from "../lib/money";
import { computeTrends, isBetter } from "../lib/trends";
import { computeScore, recentScoreWindow } from "../lib/score";
import { computeRecordedAccountMovement, windowRecordedAccountMovement } from "../lib/accountMetrics";
import { typeLabel, typeRank } from "../lib/accountTypes";
import { renderTreemap } from "../lib/chartKit";
import { dimensionTiles } from "../lib/breakdown";
import { normalizeOrderType, tradeRows } from "../lib/tradeTable";
import { mountDateField, parseDateInput } from "../lib/dates";
import { hasPrint, reviewStatus } from "../lib/review";
import { streakStats, streakState } from "../lib/process";
import { sessionLabel } from "../lib/sessions";
import { openDayLogModal } from "./dayLogModal";
import { killTip, guardTips, showTip, moveTip } from "../lib/tip";
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

export const DASHBOARD_VIEW_TYPE = "tradebook-dashboard-view";

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
  equity: "Recorded Account Value",
  netpnl: "Cumulative Net Trading P&L",
  longpnl: "Long Net P&L",
  shortpnl: "Short Net P&L",
  calendar: "Calendar",
  heatmap: "Trading Activity",
  breakdown: "Breakdown",
  streaks: "Streaks",
  score: "Trading Score & Radar",
  discipline: "Review",
  focus: "Focus Areas",
  accounts: "Accounts",
  trends: "Trends",
  payouts: "Payouts",
  holdtime: "Avg Hold",
  // One widget per metric (the old combined "Key Stats" strip is gone).
  ...METRIC_TITLES,
};

/**
 * Home's curated Add widget list, in reading order: the headline numbers first,
 * then momentum, then time/activity, then accounts and cash, then the review
 * detail. Existing saved Home widgets remain valid whatever their order.
 */
const HOME_WIDGET_MENU = [
  // Headline
  "m.netpnl", "m.winrate", "m.profitfactor",
  // Momentum
  "score", "streaks", "holdtime",
  // Activity over time
  "calendar", "heatmap",
  // Accounts and cash
  "accounts", "payouts",
  // Review detail
  "focus", "breakdown",
];

/**
 * Deprecated widget ids → their canonical replacement. Rewritten on load so a
 * saved layout (or a Home seed) written before a rename keeps its tiles.
 * `review` → `discipline`; `besthours` / `timing` → `hour`; the three
 * breakdowns → `breakdown`.
 */
export const WIDGET_ID_ALIASES: Record<string, string> = {
  review: "discipline",
  besthours: "hour",
  timing: "hour",
  symbols: "breakdown",
  setup: "breakdown",
  "order-type": "breakdown",
  hour: "breakdown",
  weekday: "breakdown",
  session: "breakdown",
};

/** Home — the curated journal-home narrative. */
export const HOME_DEFAULT: GridItem[] = [
  { i: "m.netpnl", x: 0, y: 0, w: 8, h: 3 },
  { i: "m.winrate", x: 8, y: 0, w: 8, h: 3 },
  { i: "m.profitfactor", x: 16, y: 0, w: 8, h: 3 },
  { i: "focus", x: 0, y: 3, w: 12, h: 4 },
  { i: "accounts", x: 12, y: 3, w: 12, h: 4 },
  { i: "heatmap", x: 0, y: 7, w: 12, h: 5 },
  { i: "score", x: 12, y: 7, w: 12, h: 5 },
  { i: "breakdown", x: 0, y: 12, w: 24, h: 4 },
  { i: "streaks", x: 0, y: 16, w: 24, h: 4 },
];

/**
 * Analytics — a concise analysis sequence: period result, Net evolution,
 * Breakdown, then complementary views. Every other widget and metric remains
 * available from the Add widget catalogue; saved layouts are never seeded from
 * this default once the user has chosen a layout.
 */
export const DASHBOARD_DEFAULT: GridItem[] = [
  // Period result: per-decision Net, win classification, Net PF and sample size.
  { i: "m.expectancy", x: 0, y: 0, w: 6, h: 2 },
  { i: "m.winrate", x: 6, y: 0, w: 6, h: 2 },
  { i: "m.profitfactor", x: 12, y: 0, w: 6, h: 2 },
  { i: "m.trades", x: 18, y: 0, w: 6, h: 2 },

  // Net evolution and the selected period's categorical breakdown.
  { i: "equity", x: 0, y: 2, w: 24, h: 6 },
  { i: "breakdown", x: 0, y: 8, w: 24, h: 7 },

  // Deeper analysis follows the primary result and breakdown.
  { i: "trends", x: 0, y: 15, w: 12, h: 5 },
  { i: "score", x: 12, y: 15, w: 12, h: 7 },
  { i: "heatmap", x: 0, y: 22, w: 12, h: 5 },
  { i: "calendar", x: 12, y: 22, w: 12, h: 7 },
  { i: "discipline", x: 0, y: 29, w: 12, h: 4 },
  { i: "streaks", x: 12, y: 29, w: 12, h: 4 },
];

const NEW_W: Record<string, number> = { equity: 12, netpnl: 12, longpnl: 8, shortpnl: 8, calendar: 12, score: 12, breakdown: 12, streaks: 12, discipline: 12, focus: 12, accounts: 12, heatmap: 10, trends: 8, payouts: 6, holdtime: 6, "m.netpnl": 8, "m.winrate": 8, "m.profitfactor": 8 };
const NEW_H: Record<string, number> = { equity: 6, netpnl: 6, longpnl: 6, shortpnl: 6, calendar: 6, score: 6, breakdown: 4, streaks: 4, discipline: 4, focus: 4, accounts: 4, heatmap: 5, trends: 4, payouts: 3, holdtime: 3, "m.netpnl": 3, "m.winrate": 3, "m.profitfactor": 3 };

/**
 * Minimum tile size per widget: the resize floor, kept only as large as the
 * widget's content genuinely needs so a card can be taken down to a compact
 * size. Journalit's grid items carry no floor at all (minW/minH = 1) and let
 * the content adapt; these floors are the smallest *usable* box instead, so a
 * widget never has to be clipped to hit its own minimum.
 * Canonical widths on the 24-col grid: w4 sixth · w6 quarter · w8 third · w12 half · w24 full.
 */
const MIN_W: Record<string, number> = {
  equity: 4, netpnl: 4, longpnl: 4, shortpnl: 4, calendar: 6, heatmap: 6,
  breakdown: 4, streaks: 4, score: 4,
  discipline: 4, focus: 6, accounts: 6, trends: 4, payouts: 4,
};
const MIN_H: Record<string, number> = {
  equity: 3, netpnl: 3, longpnl: 3, shortpnl: 3, calendar: 4, heatmap: 3,
  breakdown: 3, streaks: 2, score: 4,
  discipline: 3, focus: 3, accounts: 3, trends: 3, payouts: 2,
};
/** Min size for a widget id (metrics and unknown ids fall back to 1×1). */
const minOf = (id: string): { w: number; h: number } => ({ w: MIN_W[id] ?? 1, h: MIN_H[id] ?? 1 });

/** Widgets whose body scrolls (tables/lists); treemaps and charts scale. */
const SCROLL_WIDGETS = new Set<string>();

/** Parse a displayed metric value to a number, or null if it is not numeric
 *  (e.g. "9am", "3m", "—", "∞"). */
function parseMetricNumber(s: string): number | null {
  const t = s.trim();
  if (!/^[+\-]?\$?[\d,]+(\.\d+)?%?$/.test(t)) return null;
  const n = parseFloat(t.replace(/[$,%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const PERCENT_DELTA_METRICS = new Set(["m.winrate"]);
const COUNT_DELTA_METRICS = new Set([
  "m.trades", "m.wintrades", "m.losstrades", "m.winstreak", "m.lossstreak",
]);
const RATIO_DELTA_METRICS = new Set(["m.profitfactor", "m.grossprofitfactor", "m.avgrr", "m.sharpe"]);
const DURATION_DELTA_METRICS = new Set(["m.holdtime", "m.winhold", "m.losshold"]);

function parseMetricDuration(value: string): number | null {
  const pattern = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let totalMinutes = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    consumed += match[0];
    const amount = Number(match[1]);
    totalMinutes += match[2] === "h" ? amount * 60 : match[2] === "s" ? amount / 60 : amount;
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
  const hours = Math.floor(seconds / 3600);
  const remainingMinutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [
    ...(hours ? [`${hours}h`] : []),
    ...(remainingMinutes ? [`${remainingMinutes}m`] : []),
    ...(!hours && !remainingMinutes || remainingSeconds ? [`${remainingSeconds}s`] : []),
  ];
  return `${minutes > 0 ? "+" : minutes < 0 ? "−" : ""}${parts.join(" ")}`;
}

function formatMetricDelta(id: string, delta: number): string {
  const arrow = delta > 0 ? "\u2191" : delta < 0 ? "\u2193" : "=";
  if (MONEY_DELTA_METRICS.has(id)) return `${arrow} ${fmtMoney2(delta)}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "\u2212" : "";
  if (PERCENT_DELTA_METRICS.has(id)) return `${arrow} ${sign}${Math.abs(delta).toFixed(1)} pp`;
  if (COUNT_DELTA_METRICS.has(id)) {
    const count = Math.round(Math.abs(delta));
    return `${arrow} ${sign}${count} ${count === 1 ? "trade" : "trades"}`;
  }
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
const COLORED_METRICS = new Set(["m.netpnl", "m.maxdd"]);

/**
 * Metrics whose `compute` still reads the trade list handed to it (streaks,
 * hold-time splits, per-trade Sharpe). The financial metrics — Net P&L, Closed
 * trades, Win Rate, PF, Avg Net Result — read the shared FinancialSummary
 * instead and never depend on the copy-count preference.
 */
const PER_TRADE_METRICS = new Set([
  "m.winstreak",
  "m.lossstreak",
  "m.avgwin",
  "m.avgloss",
  "m.expectancy",
  "m.avgrr",
  "m.holdtime",
  "m.winhold",
  "m.losshold",
  "m.sharpe",
]);
/** Metrics that show a "vs previous period" sub-stat. */
const COMPARE_METRICS = new Set([
  "m.netpnl", "m.expectancy", "m.maxdd", "m.bestday", "m.worstday",
  "m.largestwin", "m.largestloss", "m.avgwin", "m.avgloss",
]);
const MONEY_DELTA_METRICS = new Set([
  "m.netpnl", "m.expectancy", "m.maxdd", "m.bestday", "m.worstday",
  "m.largestwin", "m.largestloss", "m.avgwin", "m.avgloss",
]);

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
 * Shared grid engine behind Home and Dashboard.
 *
 * It owns the data loading, filters, drag/resize grid and every widget
 * renderer. It deliberately knows nothing about *which* layout is on screen:
 * `layout()` / `setLayout()`, `defaultLayout()`, `allowedIds()` and
 * `viewKey()` are the seams its subclasses override.
 *
 * `DashboardView` (the archive) and `HomeView` (the fixed narrative) are the
 * two thin subclasses. Both are editable; the difference is the default set
 * and the allowed set of widget ids.
 */
export class WidgetGridView extends ItemView {
  plugin: TradebookPlugin;
  trades: Trade[] = [];
  filter = "all";
  dateRange = "all";
  customFrom = "";
  customTo = "";
  accountId: string | null = null;
  editMode = false;
  filtersOpen = false;
  widgetMenuOpen = false;
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
  private _radarAnimated = false;
  private calendarMonth = "";
  private calendarManual = false;
  /** Chosen once per view instance, so the note changes on reload, not on re-render. */
  private greetingNoteText: string | null = null;
  /** Home's recorded-value widgets share one Accounts-contract calculation per render. */
  private _homeAccountMovement: HomeAccountMovement | null = null;
  /** Grid in the coordinates currently shown to the user. */
  private _visibleLayout: GridItem[] | null = null;
  private _visibleCols = GRID_COLS;
  private headerEl: HTMLElement | null = null;
  private _onWinResize = () => {
    if (this._resizeTimer) window.clearTimeout(this._resizeTimer);
    this._resizeTimer = window.setTimeout(() => {
      this._resizeTimer = 0;
      this.render();
    }, 160);
  };
  dragId: string | null = null;
  // Grid engine state (react-grid-layout style)
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

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.getDashboardTitle();
  }

  getIcon(): string {
    return "grip";
  }

  // ---------------- Overridable view hooks (what makes Home ≠ Dashboard) ----------------

  /** The persisted layout this view reads from. */
  layout(): DashItem[] | undefined {
    return this.plugin.settings.dashboardLayout;
  }

  /** Persist a new layout for this view (caller still calls saveSettings). */
  setLayout(layout: DashItem[]): void {
    this.plugin.settings.dashboardLayout = layout;
  }

  private storedGridCols(): number {
    if (this.viewKey() === "home") return this.plugin.settings.homeGridCols || GRID_COLS;
    return this.plugin.settings.dashboardGridCols || GRID_COLS;
  }

  private setStoredGridCols(cols: number): void {
    if (this.viewKey() === "home") this.plugin.settings.homeGridCols = cols;
    else this.plugin.settings.dashboardGridCols = cols;
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

  private commitLayout(layout: GridItem[]): void {
    this.setLayout(layout.map((item) => ({ ...item })));
    this.setStoredGridCols(this.activeCols);
    this.setWorkingLayout(layout);
  }

  /** The seed used only when no layout was ever saved (undefined, not []). */
  defaultLayout(): GridItem[] {
    return DASHBOARD_DEFAULT;
  }

  /** Which widget ids this view is allowed to show. */
  allowedIds(): Set<string> {
    return new Set(Object.keys(CARD_TITLES));
  }

  /** Identity handed to the app shell (nav highlight). */
  viewKey(): string {
    return "dashboard";
  }

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
    }
    window.addEventListener("resize", this._onWinResize);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    // Expanded: copied trades are real money in every account they reached.
    // Financial decision metrics group the in-scope legs separately. Archived accounts are out of every
    // Home number — their notes live in the Trade Log, not in the balance.
    const all = await this.plugin.loadTradesExpanded();
    this.trades = all.filter((t) => !this.plugin.isArchivedTrade(t));
    this.render();
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
   * headline number reads — Net P&L, Closed trades, Win Rate, Net PF, Avg Net
   * Result and the cumulative curve — so they can never disagree on scope,
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
  private accountScopeFor(list: Trade[]): FinancialScope {
    return accountScope(list, {
      resolve: accountResolver({
        accounts: this.plugin.settings.propAccounts ?? [],
        mappedAccount: (label) => this.plugin.mappedAccount(label),
      }),
      excludeDemos: this.plugin.settings.excludeDemosFromPortfolio !== false,
      // A chosen account or account type is the trader asking for that
      // population: a selected demo account stays in on purpose.
      explicitAccountScope: !!this.accountId || this.filter !== "all",
      selectedAccountId: this.accountId,
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
    this.render();
  }

  accountMatches(t: Trade, acc: { id: string; name: string }): boolean {
    const mapped = this.plugin.mappedAccount(t.account);
    if (mapped) return mapped.id === acc.id;
    return (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
  }

  /** Trades filtered by account / account-type (no date range). */
  baseTrades(): Trade[] {
    this.ensureTradeCache();
    const cacheKey = `${this.accountId ?? ""}|${this.filter}`;
    const hit = this._baseCache.get(cacheKey);
    if (hit) return hit;
    let list = this.trades.filter((t) => isFiniteNumber(t.pnl) && t.date);
    if (this.accountId) {
      const acc = this.plugin.settings.propAccounts.find((a) => a.id === this.accountId);
      if (acc) list = list.filter((t) => this.accountMatches(t, acc));
    } else if (this.filter !== "all") {
      if (this.filter === "live") {
        const liveNames = new Set(this.plugin.settings.propAccounts.filter((a) => a.type === "live" || a.type === "personal").map((a) => a.name.trim().toLowerCase()));
        list = list.filter((t) => {
          const mapped = this.plugin.mappedAccount(t.account);
          if (mapped) return mapped.type === "live" || mapped.type === "personal";
          return liveNames.has((t.account || "").trim().toLowerCase());
        });
      } else {
        const want = this.filter;
        list = list.filter((t) => {
          const mapped = this.plugin.mappedAccount(t.account);
          const at = mapped ? mapped.type : t.accountType;
          return at === want;
        });
      }
    }
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
    const cacheKey = `${this.accountId ?? ""}|${this.filter}|${this.dateRange}|${this.customFrom}|${this.customTo}|${this.plugin.settings.timeZone}`;
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
    if (this.accountId) {
      return this.plugin.settings.propAccounts.find((a) => a.id === this.accountId)?.name ?? "Selected account";
    }
    if (this.filter === "all") return "All accounts";
    return accountFilters().find((item) => item.id === this.filter)?.label ?? "All accounts";
  }

  /** Period change in the journal-recorded value of the selected accounts. */
  private remainingAccountPnl(): number {
    const accounts = this.plugin.settings.propAccounts ?? [];
    const included = accounts.filter((account) => {
      if (this.accountId) return account.id === this.accountId;
      if (this.filter === "live") return account.type === "live" || account.type === "personal";
      if (this.filter !== "all") return account.type === this.filter;
      return this.plugin.settings.excludeDemosFromPortfolio === false || account.type !== "demo";
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
    if (this.accountId) return all.filter((account) => account.id === this.accountId);
    if (this.filter === "live") return all.filter((account) => account.type === "live" || account.type === "personal");
    if (this.filter !== "all") return all.filter((account) => account.type === this.filter);
    return this.plugin.settings.excludeDemosFromPortfolio === false
      ? all
      : all.filter((account) => account.type !== "demo");
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
        return !account.createdAt || trade.date >= account.createdAt;
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
    });
    const decisions = recent.trades.length;
    const scope = isHome ? this.selectedPeriodLabel() : `through ${formatDate(recent.asOf, "D MMM YYYY")}`;
    return {
      trades: recent.trades,
      label: `${decisions} trade${decisions === 1 ? "" : "s"} · ${scope} · ${this.scoreAccountLabel()}`,
    };
  }

  /** Trades from the previous window of the same length (for "vs prev" deltas). */
  previousPeriodTrades(): Trade[] {
    const bounds = previousPeriodBounds(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
    );
    if (!bounds) return [];
    const asOf = this.asOfKey();
    const capped = { start: bounds.start, end: bounds.end && bounds.end < asOf ? bounds.end : asOf };
    // Same day-key domain as filteredTrades, so current and baseline windows
    // bucket the same way (identity when the journal zone is New York).
    const dayBounds = periodDayBounds(capped, this.plugin.settings.timeZone);
    return this.baseTrades().filter((trade) => dateWithinPeriod(this.scoreDayKey(trade), dayBounds));
  }

  /**
   * Calendar-derived Analytics comparison populations. Unlike Home's
   * legacy metric context, these bounds never depend on which trade dates happen
   * to be present in either window.
   */
  analyticsComparisonTrades(): { current: Trade[]; baseline: Trade[]; eligible: boolean } {
    const comparison = periodComparison(
      this.dateRange as PeriodId,
      dateInZone(this.plugin.settings.timeZone),
      this.customFrom,
      this.customTo,
    );
    if (!comparison.eligible || !comparison.current || !comparison.baseline) {
      return { current: [], baseline: [], eligible: false };
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

  getLayout(): GridItem[] {
    if (this._visibleLayout && this._visibleCols === this.activeCols) return this._visibleLayout.map((item) => ({ ...item }));
    return this.storedLayout();
  }

  private minSize(id: string): { w: number; h: number } {
    const base = minOf(id);
    // Home can take selected widgets one grid step narrower where their
    // responsive presentation still keeps the essential information readable.
    // The Analytics grid retains its existing resize floors.
    if (this.viewKey() === "home") {
      if (id === "m.netpnl") return { w: 4, h: 2 };
      if (id === "m.winrate") return { w: 3, h: 2 };
      if (id === "m.profitfactor") return { w: 3, h: 3 };
      const homeFloors: Record<string, { w: number; h: number }> = {
        calendar: { w: 4, h: 4 },
        heatmap: { w: 4, h: 3 },
        score: { w: 3, h: 4 },
        streaks: { w: 3, h: 2 },
        focus: { w: 4, h: 2 },
        accounts: { w: 4, h: 2 },
        payouts: { w: 3, h: 2 },
      };
      if (homeFloors[id]) return homeFloors[id];
    }
    return base;
  }

  saveLayout(): Promise<void> {
    return this.plugin.saveSettings().then(() => this.render());
  }

  /**
   * Persist a layout the DOM already reflects (drag/resize apply their trial
   * positions live), so committing does not rebuild every widget body.
   */
  private persistLayout(): Promise<void> {
    return this.plugin.saveSettings();
  }

  addWidget(id: string): void {
    const isMetric = id.startsWith("m.");
    const min = this.minSize(id);
    const w = Math.min(this.activeCols, Math.max(min.w, NEW_W[id] ?? (isMetric ? 3 : 12)));
    const h = Math.max(min.h, NEW_H[id] ?? (isMetric ? 2 : 6));
    this.commitLayout(placeNew(this.getLayout(), id, w, h, this.activeCols));
    this.saveLayout();
  }

  removeWidget(id: string): void {
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
    const acc = this.accountId ? this.plugin.settings.propAccounts.find((a) => a.id === this.accountId) : undefined;
    const hasAny = this.trades.length > 0;
    renderEmptyBox(main, {
      title: hasAny ? "No trades in this period" : "No trading data available",
      sub: hasAny
        ? "Nothing matches the selected period or filters. Try a wider range, or add/import trades."
        : "Import your previous trades to explore your performance now, or record a new trade manually.",
      note: acc ? `Filtered to “${acc.name}”.` : undefined,
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
      this.render();
      void this.plugin.saveSettings();
    });

    if (this.filtersOpen) this.renderFilterPopover(header);
    if (this.widgetMenuOpen) this.renderWidgetMenu(header);
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
      this.render();
      return;
    }
    const header = this.renderHeader(main);
    main.insertBefore(header, old);
    old.remove();
    this.headerEl = header;
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
    const list = pop.createDiv({ cls: "tj-widgetmenu-list" });
    const present = new Set(this.getLayout().map((i) => i.i));
    const ids = this.viewKey() === "home" ? HOME_WIDGET_MENU : [...this.allowedIds()];
    for (const id of ids) {
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
    }
  }

  /** Seamless period bar, embedded under the header (Journalit style). */
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
        this.render();
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
          this.render();
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
          this.render();
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
      ? this.baseTrades().filter((t) => t.date <= asOf && this.scoreDayKey(t) <= homeTradingAsOf)
      : null;
    const homeCounted = homeBase ? this.countsList(homeBase) : null;
    const comparison = isHome ? null : this.analyticsComparisonTrades();
    const grid = root.createDiv({ cls: "tj-grid tj-grid-abs" });
    grid.toggleClass("is-editing", this.editMode);
    this.gridEl = grid;
    this.cardEls.clear();

    // Responsive: keep cards at a readable minimum width by re-flowing into
    // fewer columns (grows downward) instead of shrinking everything.
    const gridW = grid.clientWidth || Math.max(240, (root.clientWidth || DESIGN_W) - 40);
    const MIN_COL = 42;
    const cols = Math.max(6, Math.min(GRID_COLS, Math.floor((gridW + GAP) / (MIN_COL + GAP))));
    this.activeCols = cols;
    this.colW = Math.max(24, (gridW - GAP * (cols - 1)) / cols);
    this._visibleLayout = null;
    const stored = this.storedLayout();
    const layout = this.layoutForViewport(stored, this.storedGridCols(), cols);
    this.setWorkingLayout(layout);
    const prevTrades = comparison ? comparison.baseline : this.previousPeriodTrades();

    if (layout.length === 0) {
      const page = this.viewKey() === "home" ? "Home" : "Analytics";
      grid.createDiv({ cls: "tj-empty", text: `${page} is empty — press the pencil, then “Add widget”.` });
      return;
    }
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
        item.i === "equity" ||
        item.i === "netpnl" ||
        item.i === "longpnl" ||
        item.i === "shortpnl" ||
        item.i === "hour" ||
        item.i === "session" ||
        item.i === "weekday" ||
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
        item.i === "equity" || item.i === "netpnl" || item.i === "longpnl" || item.i === "shortpnl" || item.i === "calendar" || item.i.startsWith("m.");
      if (headerless) {
        const body = card.createDiv({
          cls: "tj-gridcard-body tj-scale" + (item.i.startsWith("m.") ? " tj-metric-body" : ""),
        });
        const drawHeadless = () => {
          this._drawnBodies.add(body);
          body.empty();
          try {
            if (item.i === "equity") this.renderRecordedAccountValueBody(body);
            else if (item.i === "netpnl") this.renderEquityBody(body, trades, undefined, "analytics-net-pnl");
            else if (item.i === "longpnl") this.renderEquityBody(body, trades, "long");
            else if (item.i === "shortpnl") this.renderEquityBody(body, trades, "short");
            else if (item.i === "calendar")
              new PerformanceCalendarWidget(body, isHome ? (homeBase as Trade[]) : trades, {
                timeZone: this.plugin.settings.timeZone,
                initialMonth: this.calendarInitialMonth(asOf, isHome),
                todayKey: isHome ? dateInZone(this.plugin.settings.timeZone) : undefined,
                onMonthChange: isHome ? (month) => this.rememberCalendarMonth(month) : undefined,
                onDayClick: (dateKey) => void this.openDayInTradeLog(dateKey),
                animate: this._intro && this.plugin.settings.animations !== false,
                dateFormat: this.plugin.settings.dateFormat,
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
          attachTip(del, { title: "Remove card" });
          del.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
          // Home's independent metrics resize like every other Home widget;
          // Analytics retains its existing fixed-size metric behaviour.
          if (
            item.i === "equity" || item.i === "netpnl" || item.i === "longpnl" || item.i === "shortpnl" || item.i === "calendar" ||
            (isHome && item.i.startsWith("m."))
          )
            this.bindResize(card, item);
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
        attachTip(b, { title: "Remove card" });
        b.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
        this.bindResize(card, item);
      }
      const body = card.createDiv({ cls: "tj-gridcard-body " + (SCROLL_WIDGETS.has(item.i) ? "tj-scroll" : "tj-scale") });
      const drawBody = () => {
        this._drawnBodies.add(body);
        body.empty();
        try {
          switch (item.i) {
            case "equity": this.renderRecordedAccountValueBody(body); break;
            case "netpnl": this.renderEquityBody(body, trades, undefined, "analytics-net-pnl"); break;
            case "breakdown": this.renderBreakdownWidget(body, trades, counted, header); break;
            case "streaks": this.renderStreaksWidget(body, counted, item.h); break;
            case "score": this.renderScoreRadar(body, recentScore.trades, recentScore.label); break;
            case "heatmap": this.renderHeatmap(body, homeBase ?? trades, homeCounted ?? counted, isHome ? asOf : undefined); break;
            case "discipline": this.renderDisciplineWidget(body, trades); break;
            case "focus": this.renderFocusAreasWidget(body, trades, header); break;
            case "accounts": this.renderAccountsPreviewWidget(body, header); break;
            case "trends": this.renderTrendsWidget(body, trades, header); break;
            case "payouts": this.renderPayoutsWidget(body); break;
            case "holdtime": this.renderAvgHoldWidget(body, trades); break;
            case "calendar":
              new PerformanceCalendarWidget(body, isHome ? (homeBase as Trade[]) : trades, {
                timeZone: this.plugin.settings.timeZone,
                initialMonth: this.calendarInitialMonth(asOf, isHome),
                todayKey: isHome ? dateInZone(this.plugin.settings.timeZone) : undefined,
                onMonthChange: isHome ? (month) => this.rememberCalendarMonth(month) : undefined,
                onDayClick: (dateKey) => void this.openDayInTradeLog(dateKey),
                animate: this._intro && this.plugin.settings.animations !== false,
                dateFormat: this.plugin.settings.dateFormat,
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
    // Tiny, unobtrusive title (Journalit style) — added after drawing so the
    // chart's container.empty() does not wipe it.
    const title = dir === "long" ? "Long Net Trading P&L" : dir === "short" ? "Short Net Trading P&L" : "Net Trading P&L";
    const titleEl = wrap.createDiv({ cls: "tj-eq-title", text: title });
    attachTip(titleEl, {
      title,
      sub: `Trading results after fees. Payouts and adjustments do not change trade results.${this.incompleteCostNote(financials)}`,
    });
  }

  /** Recorded account value over the selected Analytics window. The account
   *  movement series comes from Home's existing shared account calculation; the
   *  opening point carries all recorded movement before the selected period. */
  private renderRecordedAccountValueBody(body: HTMLElement): void {
    const bounds = this.rangeBounds();
    const movement = this.homeAccountMovement();
    if (!bounds || !movement.accounts.length) {
      body.createDiv({ cls: "tj-chart-empty", text: "No account value available" });
      return;
    }

    const asOf = this.asOfKey();
    const end = bounds.end && bounds.end < asOf ? bounds.end : asOf;
    const series = windowRecordedAccountMovement(
      movement.accounts.map((snapshot) => ({
        capital: snapshot.account.size || 0,
        days: snapshot.days,
      })),
      bounds.start,
      end,
    );
    const points = series.points;
    const selectedTrades = this.filteredTrades();
    const financials = this.financialsFor(selectedTrades);
    const accountIds = new Set(movement.accounts.map((snapshot) => snapshot.account.id));
    const tradeNetByDay = new Map<string, number>();
    for (const trade of movement.trades) {
      const date = this.scoreDayKey(trade);
      if ((bounds.start && date < bounds.start) || date > end) continue;
      tradeNetByDay.set(date, (tradeNetByDay.get(date) ?? 0) + netPnl(trade));
    }

    type EventType = "payout" | "deposit" | "adjustment" | "cost";
    const eventNames: Record<EventType, string> = {
      payout: "Payout",
      deposit: "Deposit",
      adjustment: "Balance correction",
      cost: "Unassigned account cost",
    };
    const eventsByDay = new Map<string, Map<EventType, { amount: number; count: number }>>();
    const addEvent = (date: string, type: EventType, amount: number): void => {
      if (!date || date > end || (bounds.start && date < bounds.start) || !Number.isFinite(amount)) return;
      const byType = eventsByDay.get(date) ?? new Map<EventType, { amount: number; count: number }>();
      const current = byType.get(type) ?? { amount: 0, count: 0 };
      current.amount += amount;
      current.count += 1;
      byType.set(type, current);
      eventsByDay.set(date, byType);
    };
    for (const payout of this.plugin.settings.payouts ?? []) {
      if (accountIds.has(payout.accountId)) addEvent(payout.date, "payout", -Math.abs(payout.amount));
    }
    for (const deposit of this.plugin.settings.deposits ?? []) {
      if (accountIds.has(deposit.accountId)) addEvent(deposit.date, "deposit", Math.abs(deposit.amount));
    }
    for (const adjustment of this.plugin.settings.feeAdjustments ?? []) {
      if (accountIds.has(adjustment.accountId)) {
        addEvent(adjustment.date, adjustment.kind === "cost" ? "cost" : "adjustment", adjustment.amount);
      }
    }

    const chart = body.createDiv({ cls: "tj-eq tj-account-value" });
    const plot = chart.createDiv({ cls: "tj-eq-chart" });
    renderLineChart(plot, {
      values: points.map((point) => point.balance),
      dates: points.map((point) => point.date),
      key: "analytics-recorded-account-value",
      format: this.plugin.settings.dateFormat,
      showDates: this.plugin.settings.chartDates !== false,
      animations: this.plugin.settings.animations !== false,
      baseline: series.capital,
      baseLine: series.capital,
      fadeFloor: series.capital,
      dayDeltas: [0, ...points.slice(1).map((point) => tradeNetByDay.get(point.date) ?? 0)],
      dayCash: points.slice(1).flatMap((point, index) => {
        const events = eventsByDay.get(point.date);
        if (!events?.size) return [];
        const type = events.has("payout") ? "out" : events.has("deposit") ? "in" : "cost";
        return [{ index: index + 1, kind: type as "out" | "in" | "cost" }];
      }),
      markers: points.slice(1).flatMap((point, index) => {
        const events = eventsByDay.get(point.date);
        if (!events?.size) return [];
        return [...events.entries()].map(([type, event]) => {
          const amount = type === "adjustment" || type === "cost" ? event.amount : Math.abs(event.amount);
          return {
            index: index + 1,
            kind: type === "payout" ? "out" as const : type === "deposit" ? "in" as const : "adjustment" as const,
            title: `${eventNames[type]} · ${fmtMoney2(amount)}${event.count > 1 ? ` · ${event.count} events` : ""} · ${point.date}`,
          };
        });
      }),
      hoverLines: (index) => {
        if (index === 0) return [["Opening recorded value", fmtMoney2(series.openingBalance), ""]];
        const point = points[index];
        if (!point) return [];
        const date = point.date;
        const trading = tradeNetByDay.get(date) ?? 0;
        const rows: Array<[string, string, string]> = [
          ["Net trading", fmtMoney2(trading), trading > 0 ? "tj-pos" : trading < 0 ? "tj-neg" : ""],
        ];
        for (const [type, event] of eventsByDay.get(date) ?? []) {
          rows.push([
            event.count > 1 ? `${eventNames[type]} (${event.count})` : eventNames[type],
            fmtMoney2(event.amount),
            type === "payout" ? "tj-cash" : type === "deposit" ? "tj-pos" : "tj-cost",
          ]);
        }
        return rows;
      },
    });

    const title = chart.createDiv({
      cls: "tj-eq-title",
      text: `Recorded Account Value · ${fmtMoney2(series.closingBalance)}`,
    });
    attachTip(title, {
      title: "Recorded account value",
      value: fmtMoney2(series.closingBalance),
      sub: `${this.scoreAccountLabel()} · ${this.selectedPeriodLabel()}. Configured capital plus recorded Net trades, payouts, deposits and signed corrections. This is the journal's account record, not live broker equity.${this.incompleteCostNote(financials)}`,
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

  /** One metric per widget. */
  renderMetricBody(
    body: HTMLElement,
    trades: Trade[],
    id: string,
    prevTrades: Trade[] = [],
    comparison?: { current: Trade[]; baseline: Trade[]; eligible: boolean },
  ): void {
    if (this.viewKey() === "home" && id === "m.netpnl") {
      this.renderHomeNetPnl(body, trades);
      return;
    }
    const def = metricById(id);
    // One day convention, shared with the period filter (lib/scope.ts).
    const dayKey = (t: Trade): string => this.scoreDayKey(t);
    const wrap = body.createDiv({ cls: "tj-metric" });
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
      "m.netpnl": "Net Trading P&L for this selection: recorded results after commission and fees. Payouts, deposits and balance adjustments are account movements, not trading results.",
      "m.profitfactor": "Net trading profit factor for this selection.",
      "m.grossprofitfactor": "Gross trading profit factor before fees.",
      "m.expectancy": "Average Net Trading P&L per trade.",
      "m.bestday": "Best daily Net Trading P&L.",
      "m.worstday": "Worst daily Net Trading P&L.",
      "m.avgwin": "Average Net result of winning trades.",
      "m.avgloss": "Average Net loss of losing trades.",
      "m.avgrr": "Average Net win compared with average Net loss.",
      "m.largestwin": "Largest single-trade Net result.",
      "m.largestloss": "Largest single-trade Net loss.",
      "m.maxdd": "Largest drawdown in Net Trading P&L.",
      "m.sharpe": "Sharpe ratio using Net Trading P&L.",
      "m.besthour": "Hour with the highest Net Trading P&L.",
      "m.worsthour": "Hour with the lowest Net Trading P&L.",
      "m.winrate": "Share of decisions that ended Net positive, out of the decisions that ended positive or negative. Net-breakeven decisions are excluded; copied legs are aggregated before classification.",
      "m.winstreak": "Winning-streak classification remains Gross-sign based; breakevens pause a streak.",
      "m.lossstreak": "Losing-streak classification remains Gross-sign based; breakevens pause a streak.",
    };
    const countTips: Record<string, string> = {
      "m.trades": "Closed, eligible decisions in this selection. Copied account legs are aggregated into the decision they belong to.",
      "m.wintrades": "Decisions that ended Net positive, aggregated across the in-scope account legs.",
      "m.losstrades": "Decisions that ended Net negative, aggregated across the in-scope account legs.",
    };
    if (financialTips[id]) {
      const coverage = id === "m.grossprofitfactor" ? "" : this.incompleteCostNote(financials);
      attachTip(labelEl, { title: labelText, sub: `${financialTips[id]}${coverage}` });
    }
    else if (countTips[id]) attachTip(labelEl, { title: labelText, sub: countTips[id] });
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

    let winVisual: HTMLElement | null = null;
    let winRing: HTMLElement | null = null;
    let winCenter: HTMLElement | null = null;

    // Sub-stat: Analytics uses helper-derived calendar windows; Home retains
    // its existing comparison population. Never show a delta for an ineligible
    // period or when either period cannot produce this metric.
    if (id !== "m.netpnl" && COMPARE_METRICS.has(id) && def) {
      const currentComparisonTrades = comparison?.current ?? trades;
      const eligible = comparison ? comparison.eligible : prevTrades.length > 0;
      if (eligible) {
        const currentCounted = PER_TRADE_METRICS.has(id) ? this.countsList(currentComparisonTrades) : currentComparisonTrades;
        const previousCounted = PER_TRADE_METRICS.has(id) ? this.countsList(prevTrades) : prevTrades;
        const zone = this.plugin.settings.timeZone;
        const currentResult = def.compute(currentCounted, dayKey, this.financialsFor(currentComparisonTrades), zone);
        const previousResult = def.compute(previousCounted, dayKey, this.financialsFor(prevTrades), zone);
        const currentNumber = comparisonMetricNumber(id, currentResult.value);
        const displayedNumber = comparisonMetricNumber(id, res.value);
        const previousNumber = comparisonMetricNumber(id, previousResult.value);
        if (
          currentNumber !== null && displayedNumber !== null && previousNumber !== null &&
          Math.abs(currentNumber - displayedNumber) < 1e-9
        ) {
          const delta = currentNumber - previousNumber;
          const sub = wrap.createDiv({ cls: "tj-metric-sub" });
          sub.setText(`${this.formatMetricDelta(id, delta)} vs prev`);
        }
      }
    }

    if (this.viewKey() === "home" && id === "m.winrate") {
      // Same classification as the number: Net sign of the aggregated decision.
      const wins = financials.net.positiveDecisionCount;
      const losses = financials.net.negativeDecisionCount;
      const sample = wins + losses;
      const visual = wrap.createDiv({ cls: "tj-home-winvisual" });
      winVisual = visual;
      if (sample) {
        const ring = visual.createDiv({ cls: "tj-home-winring" });
        winRing = ring;
        const winPct = (wins / sample) * 100;
        ring.style.setProperty("--tj-home-win-pct", `${winPct}%`);
        winCenter = ring.createSpan({ cls: "tj-home-win-center", text: `${winPct.toFixed(1)}%` });
        val.addClass("tj-home-win-hidden-value");
        attachTip(ring, { title: "Wins · Losses", value: `${wins} · ${losses}` });
      } else {
        visual.createDiv({ cls: "tj-home-metric-empty", text: "No win/loss sample" });
      }
    }
    if (this.viewKey() === "home" && id === "m.profitfactor") {
      const visual = wrap.createDiv({ cls: "tj-home-pfvisual" });
      visual.toggleClass("is-compact", (body.clientHeight > 0 && body.clientHeight < 130) || (body.clientWidth > 0 && body.clientWidth < 220));
      const netWins = financials.decisions.filter((decision) => decision.net > 0).reduce((sum, decision) => sum + decision.net, 0);
      const netLosses = Math.abs(financials.decisions.filter((decision) => decision.net < 0).reduce((sum, decision) => sum + decision.net, 0));
      const movement = netWins + netLosses;
      const bar = (label: string, amount: number, tone: "profit" | "loss") => {
        const share = movement > 0 ? (amount / movement) * 100 : 0;
        const row = visual.createDiv({ cls: "tj-home-pf-row" });
        const meta = row.createDiv({ cls: "tj-home-pf-meta" });
        meta.createSpan({ cls: "tj-home-pf-label", text: label });
        meta.createSpan({ cls: "tj-home-pf-share", text: `${Math.round(share)}%` });
        const track = row.createDiv({ cls: "tj-home-pf-track" });
        const fill = track.createDiv({ cls: `tj-home-pf-fill is-${tone}` });
        fill.style.width = `${share}%`;
      };
      bar("Wins", netWins, "profit");
      bar("Losses", netLosses, "loss");
      if (factor === Infinity) visual.createDiv({ cls: "tj-home-pf-note", text: "No losses" });
      else if (!financials.decisions.length) visual.createDiv({ cls: "tj-home-pf-note", text: "No trades" });
      else if (!Number.isFinite(factor)) visual.createDiv({ cls: "tj-home-pf-note", text: "Unavailable" });
      else if (movement === 0) visual.createDiv({ cls: "tj-home-pf-note", text: "No net results" });
      if (netWins > 0 && factor >= 1) val.addClass("tj-home-pf-positive");
      else if (netLosses > 0) val.addClass("tj-home-pf-negative");
      // The bars are the door: open the trades behind this scope.
      visual.addClass("is-openable");
      visual.setAttr("role", "button");
      visual.setAttr("tabindex", "0");
      const openTrades = () => void this.plugin.openTradeLogView({ scope: this.tradeLogScope() });
      visual.addEventListener("click", openTrades);
      visual.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTrades();
        }
      });
      attachTip(visual, {
        title: "Net Profit Factor",
        sub: factor === Infinity
          ? "No Net losses, so Profit Factor is infinite. Bars show each side's share of Net movement."
          : !financials.decisions.length
            ? "No trades in this selection."
            : !Number.isFinite(factor)
              ? "Profit Factor is unavailable for the recorded amounts."
              : "Bars show each side's share of Net movement; equal shares are 1.0.",
      });
    }

    // Scale the value with the widget, but keep it modest (dashboard, not a TV).
    const w = Math.max(110, body.clientWidth || 200);
    const hh = Math.max(48, body.clientHeight || 70);
    val.style.fontSize = `${Math.max(14, Math.min(w * 0.1, hh * 0.4, 22)).toFixed(0)}px`;

    // Visuals use the space actually left below the widget heading, body inset,
    // and metric value. ResizeObserver re-renders these bodies after a grid resize.
    if (winVisual && winRing) {
      const availableHeight = winVisual.clientHeight || Math.max(0, hh - labelEl.offsetHeight - 32);
      const availableWidth = Math.max(0, (body.clientWidth || w) - 24);
      const diameter = Math.floor(Math.max(0, Math.min(160, availableHeight, availableWidth)));
      winRing.style.width = `${diameter}px`;
      winRing.style.height = `${diameter}px`;
      winRing.style.flexBasis = `${diameter}px`;
      winCenter?.toggleClass("is-compact", diameter < 112);
    }
  }

  /**
   * Home's headline P&L card. Same card as before, but the value and the curve
   * now both come from the shared Net Trading P&L population — the headline can
   * no longer disagree with the chart under it. Recorded account movement
   * (payouts, deposits, signed adjustments) stays with the Accounts overview.
   */
  private renderHomeNetPnl(body: HTMLElement, trades: Trade[]): void {
    const financials = this.financialsFor(trades);
    const change = financials.net.total;
    const period = this.selectedPeriodLabel();
    let cumulative = 0;
    const series = [...financials.net.byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, netResult]) => {
        cumulative += netResult;
        return { date, cumulative };
      });

    const wrap = body.createDiv({ cls: "tj-metric tj-home-netpnl" });
    const label = wrap.createDiv({ cls: "tj-metric-label", text: "P&L" });
    const value = wrap.createDiv({
      cls: `tj-metric-value tj-home-netpnl-value ${change >= 0 ? "tj-pos" : "tj-neg"}`,
      text: fmtMoney2(change),
    });
    value.style.fontSize = "var(--tj-fs-head)";
    const demosExcluded = this.filter === "all" && this.plugin.settings.excludeDemosFromPortfolio !== false;
    const legs = financials.eligibleLegCount;
    const decisions = financials.decisionCount;
    attachTip(label, {
      title: "Net Trading P&L",
      value: fmtMoney2(change),
      tone: change >= 0 ? "pos" : "neg",
      sub: `${this.scoreAccountLabel()} · ${period} · ${decisions} closed trade${decisions === 1 ? "" : "s"}${legs !== decisions ? ` · ${legs} account legs` : ""}${demosExcluded ? " · demos excluded" : ""}. Recorded results after commission and fees; payouts, deposits and balance adjustments are account movements, not trading results.${this.incompleteCostNote(financials)}`,
    });

    const chart = wrap.createDiv({ cls: "tj-home-pnl-chart" });
    if (series.length) {
      renderLineChart(chart, {
        values: [0, ...series.map((day) => day.cumulative)],
        dates: [series[0].date, ...series.map((day) => day.date)],
        key: `home-net-trading-pnl:${this.dateRange}:${this.accountId ?? "all"}:${this.filter}`,
        format: this.plugin.settings.dateFormat,
        showDates: false,
        compact: true,
        animations: this.plugin.settings.animations !== false,
      });
    } else {
      chart.createDiv({ cls: "tj-home-pnl-empty", text: "No closed trades in this period" });
    }
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
      showDates: this.plugin.settings.chartDates !== false,
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

    // ---- Account ----
    const accSection = pop.createDiv({ cls: "tj-pop-fields" });
    accSection.createDiv({ cls: "tj-pop-label", text: "Account" });
    const accounts = [...(this.plugin.settings.propAccounts ?? [])].sort((a, b) => {
      const order = (t: string): number => (t === "funded" ? 0 : t === "live" ? 1 : t === "personal" ? 2 : t === "eval" ? 3 : 4);
      return order(a.type) - order(b.type) || a.name.localeCompare(b.name);
    });
    const accItems: DropdownItem[] = [{ id: "", label: "All accounts", heading: "Scope" }];
    let lastFirm = "";
    for (const acc of accounts) {
      const firm = catalogLabel(acc.firmId) ?? "Other";
      const label = acc.name && acc.name !== "Custom Account"
        ? acc.name
        : `${firm}${acc.size ? ` $${(acc.size / 1000).toFixed(0)}K` : ""} ${typeLabel(acc.type)}`.trim();
      accItems.push({ id: acc.id, label, heading: firm !== lastFirm ? firm : undefined });
      lastFirm = firm;
    }
    mountDropdown(accSection, accItems, this.accountId ?? "", (id) => {
      this.accountId = id || null;
      this.render();
    }, { title: "Account", placeholder: "All accounts" });

    // ---- Account type ----
    const typeSection = pop.createDiv({ cls: "tj-pop-fields" });
    typeSection.createDiv({ cls: "tj-pop-label", text: "Account type" });
    const pills = typeSection.createDiv({ cls: "tj-pop-pills" });
    for (const f of accountFilters()) {
      const pill = pills.createEl("button", {
        cls: "tj-pop-pill" + (!this.accountId && this.filter === f.id ? " is-on" : ""),
        text: f.label,
        attr: { type: "button", "aria-pressed": String(!this.accountId && this.filter === f.id) },
      });
      pill.addEventListener("click", () => {
        this.accountId = null;
        this.filter = f.id;
        this.render();
      });
    }
  }



  /** "Needs Review" — single gauge: count inside, label below, % shown by the arc. */
  /**
   * The latest stretch of trades against the one before it. A direction, not a
   * verdict: one window, four columns and an arrow per row, so you can see the
   * last stretch went better than the one before it without the app telling you
   * what to feel about it. Counted trades only — a copy is one decision.
   */
  /** Current-scope payout total; cash out, not trading performance. */
  renderPayoutsWidget(body: HTMLElement): void {
    const excludeDemos = this.plugin.settings.excludeDemosFromPortfolio !== false;
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
      if (!acc) return false;
      if (excludeDemos && acc.type === "demo") return false;
      return inScope(acc);
    });

    const bounds = this.rangeBounds();
    const asOf = this.asOfKey();
    const rows = scoped
      .filter((p) => {
        return p.date <= asOf && dateWithinPeriod(p.date, bounds);
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const total = rows.reduce((s, p) => s + p.amount, 0);
    const money = (n: number): string => fmtMoneyAbs(n, 2);

    const compact = (body.clientHeight > 0 && body.clientHeight < 88) || (body.clientWidth > 0 && body.clientWidth < 180);
    const summary = body.createDiv({ cls: "tj-payout-summary" });
    summary.toggleClass("is-compact", compact);
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
    if (rows.length && !compact) {
      const year = dateInZone(this.plugin.settings.timeZone).slice(0, 4);
      const yearTotal = rows.filter((p) => p.date.startsWith(year)).reduce((s, p) => s + p.amount, 0);
      summary.createDiv({
        cls: "tj-payout-summary-sub",
        text: `${rows.length} payout${rows.length === 1 ? "" : "s"} · ${money(yearTotal)} in ${year}`,
      });
    }
    if (!rows.length) summary.createDiv({ cls: "tj-payout-summary-empty", text: "No payouts this period" });

  }
  renderTrendsWidget(body: HTMLElement, trades: Trade[], header?: HTMLElement): void {
    if (!trades.length) {
      body.createDiv({ cls: "tj-empty", text: "No trades in this period." });
      return;
    }
    const trends = computeTrends(trades);
    const financials = this.financialsFor(trades);
    const title = header?.querySelector<HTMLElement>("h3");
    if (title) attachTip(title, {
      title: "Trends · Net",
      sub: `Average result and Profit Factor use Net per trade. Copied legs in scope are summed before classification; Gross-sign win-rate and Gross-based R stay as defined.${this.incompleteCostNote(financials)}`,
    });
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
      // A tie is a tie: an increase of nothing is not an improvement.
      const flat = Math.abs(v) < 1e-9;
      const arrow = flat ? "=" : v > 0 ? "\u2191" : "\u2193";
      const sign = flat ? "" : v > 0 ? "+" : "-";
      const mag = Math.abs(v);
      switch (unit) {
        case "money":
          return `${arrow} ${sign}${fmtMoney2(mag).replace(/^\+/, "")}`;
        case "r":
          return `${arrow} ${sign}${mag.toFixed(2)}R`;
        case "percent":
          return `${arrow} ${sign}${mag.toFixed(1)} pt`;
        case "factor":
          return `${arrow} ${sign}${mag.toFixed(2)}`;
        default:
          return `${arrow} ${sign}${minutes(mag)}`;
      }
    };

    const head = body.createDiv({ cls: "tj-trendrow is-head" });
    head.createDiv({ cls: "tj-trendname", text: "Metric" });
    head.createDiv({ cls: "tj-trendval is-prev", text: `Previous ${trends.nBefore}` });
    head.createDiv({ cls: "tj-trendval", text: `Latest ${trends.nAfter}` });
    head.createDiv({ cls: "tj-trendval", text: "Change" });

    for (const row of trends.rows) {
      const line = body.createDiv({ cls: "tj-trendrow" });
      line.createDiv({ cls: "tj-trendname", text: row.label });
      line.createDiv({ cls: "tj-trendval is-prev", text: write(row.before, row.unit) });
      line.createDiv({ cls: "tj-trendval", text: write(row.after, row.unit) });
      const cell = line.createDiv({ cls: "tj-trenddelta" });
      if (!trends.enough || row.delta === null) {
        cell.setText("\u2014");
        attachTip(cell, { title: "Not enough history", sub: `Needs ${trends.minSample} trades on each side before a direction means anything.` });
        continue;
      }
      const text = writeDelta(row.delta, row.unit);
      cell.createSpan({ cls: "tj-trendarrow", text: text.split(" ")[0] });
      cell.createSpan({ text: text.split(" ").slice(1).join(" ") });
      const better = isBetter(row);
      const verdict = better === true ? "Better" : better === false ? "Worse" : "Unchanged";
      if (better === true) cell.addClass("is-better");
      else if (better === false) cell.addClass("is-worse");
      cell.setAttr("aria-label", verdict);
      attachTip(cell, { title: verdict, sub: text });
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
    const rows = tradeRows(trades);
    const pending = rows.filter((row) => row.legs.some((trade) => !reviewStatus(trade).complete)).length;
    const missingPrint = rows.filter((row) => row.legs.some((trade) => !hasPrint(trade))).length;
    const title = header?.querySelector<HTMLElement>("h3");
    const scopeLabel = this.homeTaskScopeLabel();
    if (title) {
      attachTip(title, {
        title: "Focus Areas",
        sub: `${scopeLabel}. Counts are trades; screenshot gaps are also included in review tasks.`,
      });
    }

    const hub = body.createDiv({ cls: "tj-focus-hub" });
    const next = rows.flatMap((row) => row.legs).find((trade) => !reviewStatus(trade).complete);
    const taskCard = (
      count: number,
      titleText: string,
      iconName: string,
      actionText: string,
      onAction: () => void,
      actionAvailable = true,
    ) => {
      const card = hub.createEl("button", {
        cls: "tj-focus-task-card",
        attr: { type: "button" },
      });
      card.disabled = !actionAvailable;
      const heading = card.createSpan({ cls: "tj-focus-review-heading" });
      const icon = heading.createSpan({ cls: "tj-focus-review-icon" });
      setIcon(icon, iconName);
      heading.createSpan({ cls: "tj-focus-review-count", text: String(count) });
      heading.createSpan({ cls: "tj-focus-review-title", text: titleText });
      if (actionAvailable) {
        const action = card.createSpan({ cls: "tj-focus-task-action" });
        action.createSpan({ text: actionText });
        const arrow = action.createSpan({ cls: "tj-focus-task-arrow" });
        setIcon(arrow, "arrow-right");
        card.addEventListener("click", onAction);
      } else {
        card.createSpan({ cls: "tj-focus-task-status", text: actionText });
      }
      return card;
    };

    taskCard(
      pending,
      "Pending reviews",
      "clipboard-check",
      "Continue reviewing",
      () => {
        if (!next) return;
        void this.plugin.openTradeDetail({
          id: next.id,
          from: { type: "tradelog", tradeIds: rows.flatMap((row) => row.legs).map((trade) => trade.id) },
        });
      },
      !!next,
    );
    taskCard(
      missingPrint,
      "Missing screenshots",
      "image",
      "Open filtered list",
      () => void this.plugin.openTradeLogView({
        scope: this.tradeLogScope(),
        quality: ["noprint"],
      }),
    );
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
    const list = body.createDiv({ cls: "tj-home-accounts-list" });
    if (accounts.length === 1) list.addClass("is-single");
    if (!accounts.length) {
      list.createDiv({ cls: "tj-home-accounts-empty", text: "No accounts in this selection." });
    } else {
      const listWidth = list.clientWidth || body.clientWidth || 180;
      const listHeight = list.clientHeight || Math.max(72, (body.clientHeight || 150) - 24);
      const columns = Math.max(1, Math.floor((listWidth + 8) / 248));
      const rows = Math.max(1, Math.floor(listHeight / 72));
      for (const snapshot of accounts.slice(0, columns * rows)) {
        const capital = snapshot.account.size || 0;
        const recordedChange = snapshot.balance - capital;
        const valueTone = recordedChange > 0 ? "is-positive" : recordedChange < 0 ? "is-negative" : "";
        const row = list.createEl("button", {
          cls: "tj-home-account-card",
          attr: { type: "button" },
        });
        row.createSpan({
          cls: "tj-sr-only",
          text: `Open ${snapshot.account.name}, ${typeLabel(snapshot.account.type)}, journal-recorded value ${fmtMoney2(snapshot.balance)}`,
        });
        const head = row.createSpan({ cls: "tj-home-account-head" });
        const info = head.createSpan({ cls: "tj-home-account-info" });
        info.createSpan({ cls: "tj-home-account-name", text: snapshot.account.name });
        info.createSpan({ cls: "tj-home-account-type", text: typeLabel(snapshot.account.type) });
        const balance = head.createSpan({ cls: `tj-home-account-balance ${valueTone}`.trim(), text: fmtMoney2(snapshot.balance) });
        attachTip(balance, { title: "Journal-recorded value", value: fmtMoney2(snapshot.balance), sub: "Calculated from configured capital, journaled trading and account cash movements; not live broker equity." });
        const chart = row.createSpan({ cls: "tj-home-account-chart" });
        if (snapshot.days.length) {
          renderLineChart(chart, {
            values: [capital, ...snapshot.days.map((day) => capital + day.cumulative)],
            dates: [snapshot.days[0].date, ...snapshot.days.map((day) => day.date)],
            baseline: capital,
            baseLine: capital,
            fadeFloor: capital,
            compact: true,
            showDates: false,
            key: `home-account-balance:${snapshot.account.id}`,
            format: this.plugin.settings.dateFormat,
            animations: this.plugin.settings.animations !== false,
          });
        } else {
          chart.createSpan({ cls: "tj-home-account-nohistory", text: "No recorded history" });
        }
        row.addEventListener("click", () => void this.plugin.openAccountDashboard(undefined, snapshot.account.id));
      }
    }
  }

  renderDisciplineWidget(body: HTMLElement, trades: Trade[]): void {
    if (!trades.length) {
      body.createDiv({ cls: "tj-empty", text: "No trades in this period." });
      return;
    }
    // One logical decision per copy group (copied legs are never a second
    // decision), and a decision is complete only when every one of its legs is
    // complete — the exact rule the Trade Log's attention queue uses.
    const rows = tradeRows(trades);
    const total = rows.length;
    const complete = rows.filter((r) => r.legs.every((l) => reviewStatus(l).complete)).length;
    const pending = total - complete;
    const pct = total ? Math.round((complete / total) * 100) : 0;
    // Colour is review completion only — never trading quality.
    const arcColor =
      pct >= 100 ? "var(--tj-tone-good)"
        : pct >= 80 ? "var(--tj-tone-mid)"
          : pct >= 50 ? "var(--color-orange, #e8944a)"
            : "var(--tj-tone-bad)";

    const bodyW = body.clientWidth || 0;
    const bodyH = body.clientHeight || 0;
    const measured = bodyW > 0 && bodyH > 0;
    // Wide cards put the dial beside the text; narrow/tall centre the dial.
    const wide = measured && bodyW > bodyH * 1.4 && bodyW >= 340;

    const wrap = body.createDiv({ cls: "tj-disc" + (wide ? " is-wide" : "") });

    // Dial first in DOM (top when tall, left when wide), then the text.
    const dial = wrap.createDiv({ cls: "tj-disc-dial" });
    dial.style.setProperty("--tj-disc-color", arcColor);
    const info = wrap.createDiv({ cls: "tj-disc-info" });
    info.createDiv({ cls: "tj-disc-line", text: `${pending} pending` });
    const link = info.createEl("button", { cls: "tj-disc-link", text: "Review queue ↗", attr: { type: "button" } });
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.openReviewQueue();
    });

    // Size the dial from the space left after the paddings, the gap and the
    // text, so it fills the widget without clipping and without a huge empty
    // area. The card body has ~24px horizontal / ~20px vertical padding.
    const textW = info.offsetWidth || 190;
    const textH = info.offsetHeight || 54;
    let size = 120;
    if (measured) {
      const availW = Math.max(0, bodyW - 24);
      const availH = Math.max(0, bodyH - 20);
      size = wide
        ? Math.min(availW - textW - 16, availH)
        : Math.min(availW, availH - textH - 12);
      size = Math.max(56, Math.floor(size));
    }
    dial.style.width = `${size}px`;
    dial.style.height = `${size}px`;

    // Open arc (270°, gap at the bottom): neutral track + completion arc.
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("class", "tj-disc-arc");
    const cx = 60, cy = 60, r = 47, start = 225, span = 270;
    const polar = (deg: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };
    const arcPath = (to: number): string => {
      const s = polar(start);
      const e = polar(to);
      return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${to - start > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
    };
    const track = document.createElementNS(NS, "path");
    track.setAttribute("d", arcPath(start + span));
    track.setAttribute("class", "tj-disc-track");
    const fill = document.createElementNS(NS, "path");
    fill.setAttribute("d", arcPath(start + span * Math.max(0.004, Math.min(1, pct / 100))));
    fill.setAttribute("class", "tj-disc-fill");
    svg.appendChild(track);
    svg.appendChild(fill);
    dial.appendChild(svg as unknown as Node);
    const pctBox = dial.createDiv({ cls: "tj-disc-pct" });
    pctBox.createSpan({ cls: "tj-disc-pct-num", text: `${pct}%` });
  }

  /** Opens the Trade Log filtered to a single day (calendar day click). */
  private async openDayInTradeLog(dateKey: string): Promise<void> {
    await this.plugin.openTradeLogForDay(dateKey);
  }

  /** Opens the Trade Log on the same scope, filtered to the trades that still
   *  need review — so its pending count matches this widget's for that scope. */
  private async openReviewQueue(): Promise<void> {
    await this.plugin.openTradeLogView({
      scope: this.tradeLogScope(),
      review: "pending",
    });
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
      accountId: this.accountId,
      accountType: this.filter,
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
  renderHeatmap(body: HTMLElement, trades: Trade[], _counted: Trade[] = trades, asOf?: string): void {
    killTip();
    guardTips();
    document.querySelectorAll(".tj-tip").forEach((n) => n.remove());

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
    cell = Math.max(4, Math.min(15, cell));

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
        const a = 0.22 + Math.min(1, Math.abs(b.pnl) / maxAbs) * 0.55;
        c.style.background =
          b.pnl > 0 ? `rgba(34,122,74,${a.toFixed(2)})` : b.pnl < 0 ? `rgba(143,43,30,${a.toFixed(2)})` : "rgba(255,255,255,.10)";
        this.bindHeatTip(c, key, b);
      }
    });

    const legend = wrap.createDiv({ cls: "tj-heat-legend" });
    legend.createSpan({ text: "Less" });
    for (const a of [0.18, 0.36, 0.62, 0.9]) {
      const sq = legend.createEl("i");
      sq.style.background = `rgba(34,122,74,${a})`;
    }
    legend.createSpan({ text: "More" });
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

  /** Trading Score v1 — rendered by the shared widget module, so Home and
   *  Analytics always show the same responsive implementation. */
  renderScoreRadar(body: HTMLElement, trades: Trade[], scopeLabel: string): void {
    if (!trades.length) {
      renderEmptyBox(body, {
        title: "No trades in this period",
        sub: "A score needs at least a few trades. Widen the period or change the account scope.",
      });
      return;
    }
    const result = computeScore(trades, (t) => this.scoreDayKey(t));
    const animate = this.plugin.settings.animations !== false && !this._radarAnimated;
    this._radarAnimated = true;
    renderTradingScore(body, result, scopeLabel, animate);
  }

  /**
   * Streaks — current run and its existing phrase, with historical run context.
   * One decision per counted trade.
   */
  renderStreaksWidget(body: HTMLElement, trades: Trade[], h?: number): void {
    if (!trades.length) {
      body.createDiv({ cls: "tj-empty", text: "No trades in this period." });
      return;
    }
    const ordered = [...trades].sort((a, b) =>
      (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || ""))
    );
    const { current, bestWin, worstLoss } = streakStats(trades);

    // Average win-run length across the whole history.
    let runs = 0;
    let winsTotal = 0;
    let run = 0;
    for (const t of ordered) {
      if (t.pnl > 0) run += 1;
      else if (t.pnl < 0 && run) {
        runs += 1;
        winsTotal += run;
        run = 0;
      }
    }
    if (run) {
      runs += 1;
      winsTotal += run;
    }
    const avg = runs ? winsTotal / runs : 0;

    // Icon by family (calm): win trending up, flame once the run is real.
    const icon = current >= 3 ? "flame" : current > 0 ? "trending-up" : current < 0 ? "trending-down" : "minus";
    const tone = current > 0 ? "is-pos" : current < 0 ? "is-warn" : "is-flat";

    const wrap = body.createDiv({ cls: "tj-streaks" });
    // Mark compact boxes so styles can scale the same current/history context.
    const measured = body.clientHeight || 0;
    const rows = h ?? 6;
    const compact = measured > 0 ? measured < 110 : rows <= 3;
    const tiny = measured > 0 ? measured < 80 : rows <= 2;
    wrap.toggleClass("is-compact", compact || tiny);
    wrap.toggleClass("is-tiny", tiny);
    // Scale the whole block with the card so it fills the space instead of
    // sitting small inside a large area. Capped so it never becomes a billboard.
    const wpx = body.clientWidth || 0;
    const scale = measured > 0 && wpx > 0
      ? Math.max(0.8, Math.min(1.9, Math.min(measured / 150, wpx / 320)))
      : 1;
    wrap.style.setProperty("--tj-streak-scale", scale.toFixed(2));

    // Line 1 — the run.
    const hero = wrap.createDiv({ cls: "tj-streaks-hero " + tone });
    const ic = hero.createSpan({ cls: "tj-streaks-icon" });
    setIcon(ic, icon);
    hero.createSpan({
      cls: "tj-streaks-count",
      text:
        current > 0 ? `${current} win${current === 1 ? "" : "s"}`
          : current < 0 ? `${Math.abs(current)} loss${current === -1 ? "" : "es"}`
            : "No active streak",
    });

    // Line 2 — context.
    const ctx = wrap.createDiv({ cls: "tj-streaks-ctx" });
    ctx.createSpan({ text: `best ${bestWin} · worst ${worstLoss} · avg ${avg.toFixed(1)}` });
    attachTip(ctx, {
      title: "Streaks",
      sub: `Best win run ${bestWin} · worst loss run ${worstLoss} · ${runs} win run${runs === 1 ? "" : "s"}`,
    });

    // Existing phrase, selected only from the current signed run.
    wrap.createDiv({ cls: "tj-streaks-state " + tone, text: streakState(current) });
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

  /** Average hold time, as one prominent figure. */
  renderAvgHoldWidget(body: HTMLElement, trades: Trade[]): void {
    const mins: number[] = [];
    for (const t of trades) {
      const m = this.holdMinutes(t);
      if (m !== null) mins.push(m);
    }
    const wrap = body.createDiv({ cls: "tj-hold" });
    if (!mins.length) {
      wrap.createDiv({ cls: "tj-empty", text: "No entry/exit times recorded." });
      return;
    }
    const avg = mins.reduce((a, v) => a + v, 0) / mins.length;
    const icon = wrap.createSpan({ cls: "tj-hold-icon" });
    setIcon(icon, "timer");
    wrap.createDiv({ cls: "tj-hold-value", text: this.fmtHold(avg) });
    wrap.createDiv({ cls: "tj-hold-label", text: "Average hold time" });
    attachTip(wrap, {
      title: "Average hold time",
      sub: `Mean of ${mins.length} trades with an entry and exit time. Per-zone detail lives in Analytics.`,
    });
  }

  /**
   * Breakdown — one widget with six tabs, all rendering the same treemap of
   * activity-sized tiles coloured by result. Categorical dimensions are ordered
   * by activity; the timelines (Weekday · Hour · Session) read chronologically
   * and show every bucket that has trades. The selected tab is persisted.
   */
  renderBreakdownWidget(body: HTMLElement, trades: Trade[], counted: Trade[] = trades, header?: HTMLElement): void {
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
    if (title) attachTip(title, {
      title: "Breakdown · Net",
      sub: `Net results sum eligible in-scope account legs. Counts and Gross-sign win rate follow the Analytics copy-count preference.${this.incompleteCostNote(this.financialsFor(trades))}`,
    });
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
      const tiles = dimensionTiles(trades, counted, dim.key, {
        labelOf: dim.labelOf,
        orderOf: dim.orderOf,
        formatMoney: fmtMoney2,
        countPopulation: this.plugin.settings.includeCopiesInPortfolioAnalytics === true ? "account leg" : "trade",
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
          row.createDiv({ cls: "tj-bd-row-win", text: `${t.count ? Math.round((t.wins / t.count) * 100) : 0}%` });
          row.createDiv({ cls: "tj-bd-row-val " + (t.net >= 0 ? "tj-pos" : "tj-neg"), text: fmtMoney2(t.net) });
          attachTip(row, { title: `${t.label} · Net`, value: fmtMoney2(t.net), sub: `${t.count} ${this.plugin.settings.includeCopiesInPortfolioAnalytics ? "account legs" : "trades"} · Gross-sign win rate` });
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


  /** Journalit-style "Long P&L" / "Short P&L" widgets: daily P&L bar chart for one direction. */





  async openTrade(t: Trade): Promise<void> {
    if (!t.id) return;
    await this.plugin.openTradeModal(t);
  }


}

/**
 * Dashboard — the Analytics archive. Fully editable and rich: every widget,
 * drag, resize, add and remove. It reads and writes `settings.dashboardLayout`,
 * seeds the curated `DASHBOARD_DEFAULT` only when no layout has been saved, and
 * allows every widget id in the shared catalogue.
 */
export class DashboardView extends WidgetGridView {}
