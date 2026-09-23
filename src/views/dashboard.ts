import { ItemView, setIcon, TFile } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { accountFilters, attachTooltip, kpiCard, renderAppShell, svgLine, svgPath } from "../ui";
import { firmLabel as catalogLabel } from "../lib/firmLogos";
import { fmtMoney2, fmtMoneyCompact, isFiniteNumber, toZoneDate, toZoneTime } from "../tz";
import { updateTradeFields } from "../storage";
import { attachTip } from "../lib/tip";
import { netPnl } from "../lib/fees";
import { renderEmptyState as renderEmptyBox } from "../lib/emptyState";
import {
  clamp as gClamp,
  collides,
  compactExcept,
  compactVertical,
  GAP,
  GRID_COLS,
  GridItem,
  gridRows,
  moveItem as gridMove,
  placeNew,
  reflow,
  resizeItem as gridResize,
  ROW_PX,
} from "../lib/grid";
import { PerformanceCalendarWidget } from "../widgets/performanceCalendarWidget";
import { METRIC_TITLES, metricById } from "../lib/metrics";
import { analyticsTrades } from "../lib/scope";
import { computeTrends, isBetter } from "../lib/trends";
import { computeScore, SCORE_BAND_TOKEN } from "../lib/score";
import { renderGauge, renderContinuousBar, renderStatusRow, renderTreemap } from "../lib/chartKit";
import { dimensionTiles } from "../lib/breakdown";
import { normalizeOrderType } from "../lib/tradeTable";
import { mountDateField } from "../lib/dates";
import { reviewSummary } from "../lib/review";
import { computeProcessSignals, streakStats, streakState } from "../lib/process";
import { sessionLabel } from "../lib/sessions";
import { openDayLogModal } from "./dayLogModal";
import { killTip, guardTips, showTip, moveTip } from "../lib/tip";
import { renderLineChart } from "../lib/lineChart";
import { formatDate } from "../lib/dates";

export const DASHBOARD_VIEW_TYPE = "tradebook-dashboard-view";

/** Shared day/month abbreviations for the heat-map. */
const MON_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/** Weekday labels indexed by JS `getDay()` (0 = Sunday). */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first order for the weekday widget. */
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "9am" / "2pm" from a 24-hour clock. */
function fmtHourLabel(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

/** Entry-time hour bucket (raw wall clock, "9".."23"), or "—" when there is no time. */
function hourBlockOf(t: Trade): string {
  const m = /^(\d{1,2}):/.exec(t.entryTime || "");
  return m ? String(parseInt(m[1], 10)) : "—";
}

/** Chronological order for raw hour keys. */
function hourOrder(label: string): number {
  const h = Number(label);
  return Number.isFinite(h) ? h : 99;
}

export type DashItem = GridItem;

export const CARD_TITLES: Record<string, string> = {
  equity: "Cumulative P&L",
  longpnl: "Long P&L",
  shortpnl: "Short P&L",
  calendar: "Performance Calendar",
  heatmap: "Last 6 Months",
  breakdown: "Breakdown",
  streaks: "Streaks",
  score: "Trading Score & Radar",
  discipline: "Discipline",
  trends: "Trends",
  payouts: "Payouts",
  // One widget per metric (the old combined "Key Stats" strip is gone).
  ...METRIC_TITLES,
};

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

/** Home — the designed eight-tile narrative. */
export const HOME_DEFAULT: GridItem[] = [
  { i: "calendar", x: 0, y: 0, w: 24, h: 6 },
  { i: "heatmap", x: 0, y: 6, w: 12, h: 6 },
  { i: "score", x: 12, y: 6, w: 12, h: 7 },
  { i: "breakdown", x: 0, y: 13, w: 12, h: 6 },
  { i: "discipline", x: 12, y: 13, w: 12, h: 5 },
  { i: "payouts", x: 0, y: 19, w: 24, h: 4 },
];

/** Metric widgets the archive seeds, in reading order. */
const DASHBOARD_METRIC_IDS = [
  "m.netpnl", "m.winrate", "m.trades", "m.maxdd", "m.profitfactor", "m.sharpe",
  "m.expectancy", "m.bestday", "m.worstday", "m.largestwin", "m.largestloss",
  "m.winstreak", "m.lossstreak", "m.wintrades", "m.losstrades", "m.avgwin",
  "m.avgloss", "m.avgrr", "m.holdtime", "m.winhold", "m.losshold",
];

/** Dashboard — the rich archive: charts, breakdowns and every metric. */
export const DASHBOARD_DEFAULT: GridItem[] = (() => {
  const tiles: GridItem[] = [
    { i: "longpnl", x: 0, y: 0, w: 8, h: 6 },
    { i: "shortpnl", x: 8, y: 0, w: 8, h: 6 },
    { i: "score", x: 16, y: 0, w: 8, h: 6 },
    { i: "heatmap", x: 0, y: 6, w: 24, h: 4 },
    { i: "breakdown", x: 0, y: 10, w: 24, h: 6 },
    { i: "streaks", x: 0, y: 16, w: 24, h: 4 },
  ];
  const perRow = 6;
  DASHBOARD_METRIC_IDS.forEach((id, idx) => {
    tiles.push({ i: id, x: (idx % perRow) * 4, y: 20 + Math.floor(idx / perRow) * 2, w: 4, h: 2 });
  });
  return tiles;
})();

const NEW_W: Record<string, number> = { equity: 12, longpnl: 8, shortpnl: 8, calendar: 12, score: 12, breakdown: 12, streaks: 12, discipline: 12, heatmap: 10, trends: 8, payouts: 6 };
const NEW_H: Record<string, number> = { equity: 6, longpnl: 6, shortpnl: 6, calendar: 6, score: 6, breakdown: 6, streaks: 4, discipline: 4, heatmap: 5, trends: 4, payouts: 3 };

/**
 * Minimum tile size per widget: the engine refuses to draw a smaller box, so
 * fixed content can never be clipped by an undersized card.
 * Canonical widths on the 24-col grid: w8 third · w12 half · w16 two-thirds · w24 full.
 */
const MIN_W: Record<string, number> = {
  equity: 12, longpnl: 8, shortpnl: 8, calendar: 12, heatmap: 8,
  breakdown: 6, streaks: 8, score: 6,
  discipline: 8, trends: 8, payouts: 12,
};
const MIN_H: Record<string, number> = {
  equity: 3, longpnl: 3, shortpnl: 3, calendar: 5, heatmap: 5,
  breakdown: 3, streaks: 2, score: 4,
  discipline: 3, trends: 3, payouts: 2,
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
 * Per-trade statistics: a copied trade reached several accounts, but it is one
 * trade — so these dedupe by copyBaseKey and never count (or average) it twice.
 * Everything else (P&L, drawdown, best/worst day) is money and sums every leg.
 */
const PER_TRADE_METRICS = new Set([
  "m.trades",
  "m.winrate",
  "m.wintrades",
  "m.losstrades",
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

/** Calm, human header lines. Rotated on a timer — never on a re-render/click. */
const GREETING_LINES = [
  "Let's take it one trade at a time.",
  "No rush — the setup will come to you.",
  "Keep the risk small and the plan simple.",
  "Focus on the process; the results follow.",
  "Protect the capital first.",
  "A clean review is worth more than a green day.",
  "Trade the plan, not the feeling.",
  "Steady hands today.",
];

// Used when the container width is unknown (e.g. jsdom harness).
const DESIGN_W = 1200;

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
  private headerTimer: number | null = null;
  private msgEl: HTMLElement | null = null;
  private msgStart = Date.now();
  private msgBase = -1;
  // Auto-adjust engine: re-render each widget body when its size changes so
  // content always fits (no scrollbars, no clipped charts).
  private bodyObserver: ResizeObserver | null = null;
  private bodyRenderers = new Map<HTMLElement, () => void>();
  private _resizeRaf = 0;
  private _pendingResize = new Set<HTMLElement>();
  /** True while a card drag/resize is in progress: the ResizeObserver must not
   *  re-draw widget bodies on every pointer move (commit re-draws once). */
  _interacting = false;
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
  private _reviewPct = -1;
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
    window.addEventListener("resize", this._onWinResize);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    // Expanded: copied trades are real money in every account they reached. The
    // per-trade widgets dedupe them again (see PER_TRADE_METRICS) so a copy is
    // never both counted twice and dropped. Archived accounts are out of every
    // Home number — their notes live in the Trade Log, not in the balance.
    const all = await this.plugin.loadTradesExpanded();
    this.trades = all.filter((t) => !this.plugin.isArchivedTrade(t));
    this.render();
  }

  /** The list per-trade widgets use: one entry per logical trade. */
  countsList(list: Trade[]): Trade[] {
    return analyticsTrades(list, this.plugin.settings.includeCopiesInPortfolioAnalytics === true).counts;
  }

  accountMatches(t: Trade, acc: { id: string; name: string }): boolean {
    const mapped = this.plugin.mappedAccount(t.account);
    if (mapped) return mapped.id === acc.id;
    return (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
  }

  /** Trades filtered by account / account-type (no date range). */
  baseTrades(): Trade[] {
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
    return list;
  }

  filteredTrades(): Trade[] {
    let list = this.baseTrades();
    const now = new Date();
    if (this.dateRange !== "all") {
      let start: Date | null = null;
      let end: Date | null = null;
      const parseDay = (s: string): Date => new Date(s + "T00:00:00");
      if (this.dateRange === "today") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = start;
      } else if (this.dateRange === "yesterday") {
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        start = y;
        end = y;
      } else if (this.dateRange === "thisweek") {
        const day = now.getDay() || 7; // Mon=1..Sun=7
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      } else if (this.dateRange === "lastweek") {
        const day = now.getDay() || 7;
        const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
        start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
        end = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
      } else if (this.dateRange === "1m") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (this.dateRange === "thisquarter") {
        start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      } else if (this.dateRange === "thisyear") {
        start = new Date(now.getFullYear(), 0, 1);
      } else if (this.dateRange === "custom") {
        if (this.customFrom) start = parseDay(this.customFrom);
        if (this.customTo) end = parseDay(this.customTo);
      }
      if (start) list = list.filter((t) => new Date(t.date + "T00:00:00") >= start);
      if (end) list = list.filter((t) => new Date(t.date + "T00:00:00") <= end);
    }
    return [...list].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Trades from the previous window of the same length (for "vs prev" deltas). */
  previousPeriodTrades(): Trade[] {
    if (this.dateRange === "all") return [];
    const cur = this.filteredTrades();
    if (!cur.length) return [];
    const dates = cur.map((t) => t.date).sort();
    const start = new Date(dates[0] + "T00:00:00");
    const end = new Date(dates[dates.length - 1] + "T00:00:00");
    const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const prevEnd = new Date(start.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - (spanDays - 1) * 86400000);
    return this.baseTrades().filter((t) => {
      const d = new Date(t.date + "T00:00:00");
      return d >= prevStart && d <= prevEnd;
    });
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
      return;
    }
    // New format: drop unknown widgets, clamp bounds, re-compact.
    // First migrate coordinates if the saved layout used an older grid width
    // (e.g. 12 columns) so nothing shrinks or overlaps on upgrade.
    // Only the Dashboard layout can be legacy — Home's layout is always written
    // at the current width — and `gridCols` is a single shared marker, so the
    // scale must run for one view only or it would double-scale the other.
    const savedCols = this.plugin.settings.gridCols || 12;
    if (savedCols !== GRID_COLS && this.viewKey() === "dashboard") {
      const factor = GRID_COLS / savedCols;
      layout.forEach((it) => {
        if (!it) return;
        if (typeof it.x === "number") it.x = Math.round(it.x * factor);
        if (typeof it.w === "number") it.w = Math.max(1, Math.round(it.w * factor));
      });
      this.plugin.settings.gridCols = GRID_COLS;
      void this.plugin.saveSettings();
    }
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
      it.w = gClamp(Math.round(it.w), MIN_W[it.i] ?? 1, GRID_COLS);
      it.h = gClamp(Math.round(it.h), MIN_H[it.i] ?? 1, 60);
      it.x = gClamp(Math.round(it.x || 0), 0, GRID_COLS - it.w);
      it.y = Math.max(0, Math.round(it.y || 0));
    }
    this.setLayout(compactVertical(filtered));
  }

  getLayout(): GridItem[] {
    this.ensureLayout();
    return this.layout() ?? this.defaultLayout();
  }

  saveLayout(): Promise<void> {
    return this.plugin.saveSettings().then(() => this.render());
  }

  addWidget(id: string): void {
    const isMetric = id.startsWith("m.");
    const w = NEW_W[id] ?? (isMetric ? 3 : 12);
    const h = NEW_H[id] ?? (isMetric ? 2 : 6);
    this.setLayout(placeNew(this.getLayout(), id, w, h));
    this.saveLayout();
  }

  removeWidget(id: string): void {
    this.setLayout(this.getLayout().filter((i) => i.i !== id));
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
    for (const it of layout) {
      const card = this.findCardEl(grid, it.i);
      if (card) this.positionCard(card, it);
    }
    grid.style.height = `${Math.max(1, gridRows(layout)) * ROW_PX + (Math.max(1, gridRows(layout)) - 1) * GAP}px`;
  }

  /** Drag preview: others shift live, dragged card fades out, placeholder shows. */
  private applyDragTrial(nx: number, ny: number, item: GridItem): void {
    const trial = gridMove(this.getLayout(), item.i, nx, ny);
    const grid = this.gridEl;
    if (!grid) return;
    for (const it of trial) {
      const card = this.findCardEl(grid, it.i);
      if (!card) continue;
      if (it.i === item.i) {
        card.addClass("tj-moving");
        this.showPlaceholder(it);
      } else {
        this.positionCard(card, it);
      }
    }
    grid.style.height = `${Math.max(1, gridRows(trial)) * ROW_PX + (Math.max(1, gridRows(trial)) - 1) * GAP}px`;
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
    const card = this.findCardEl(this.gridEl as HTMLElement, item.i);
    if (!card) {
      this.dragId = null;
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
    ghost.style.width = `${card.offsetWidth || item.w * this.colW}px`;
    ghost.style.height = `${card.offsetHeight || item.h * ROW_PX}px`;
    document.body.appendChild(ghost);
    this._dragGhost = ghost;

    const rect = card.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    ghost.style.transform = `translate(${e.clientX - offX}px, ${e.clientY - offY}px)`;

    let lastNx: number | null = null;
    let lastNy: number | null = null;

    const snapPos = (ev: PointerEvent) => {
      const gx = ev.clientX - this.gridRectLeft();
      const gy = ev.clientY - this.gridRectTop();
      const nx = gClamp(Math.round(gx / (this.colW + GAP) - (item.w - 1) / 2), 0, this.activeCols - item.w);
      const ny = Math.max(0, Math.round(gy / (ROW_PX + GAP)));
      return { nx, ny };
    };

    const onMove = (ev: PointerEvent) => {
      this.edgeAutoScroll(ev.clientY);
      ghost.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px)`;
      const { nx, ny } = snapPos(ev);
      if (nx === lastNx && ny === lastNy) return;
      lastNx = nx;
      lastNy = ny;
      this.applyDragTrial(nx, ny, item);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      ghost.remove();
      this._dragGhost = null;
      this.dragId = null;
      this._interacting = false;
      this.hidePlaceholder();
      const layout = this.getLayout();
      for (const it of layout) {
        const el = this.findCardEl(this.gridEl as HTMLElement, it.i);
        el?.removeClass("tj-moving");
      }
      const { nx, ny } = snapPos(ev);
      this.setLayout(compactVertical(gridMove(layout, item.i, nx, ny)));
      this.saveLayout();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private findCardEl(grid: HTMLElement, id: string): HTMLElement | null {
    for (const el of Array.from(grid.querySelectorAll(".tj-gridcard"))) {
      if (el.getAttribute("data-wid") === id) return el as HTMLElement;
    }
    return null;
  }

  // ---------------- Corner resize (edit mode) ----------------

  private bindResize(card: HTMLElement, item: GridItem): void {
    const handle = card.createDiv({ cls: "tj-resize-handle", attr: { "aria-label": "Drag to resize" } });
    attachTip(handle, { title: "Drag to resize", sub: "Corner only — the cards pack themselves." });
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._interacting = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const baseW = item.w;
      const baseH = item.h;
      let curW = baseW;
      let curH = baseH;
      const onMove = (ev: PointerEvent) => {
        this.edgeAutoScroll(ev.clientY);
        const dw = Math.round((ev.clientX - startX) / (this.colW + GAP));
        const dh = Math.round((ev.clientY - startY) / (ROW_PX + GAP));
        curW = gClamp(baseW + dw, MIN_W[item.i] ?? 1, this.activeCols - item.x);
        curH = gClamp(baseH + dh, MIN_H[item.i] ?? 2, 30);
        const trial = gridResize(this.getLayout(), item.i, curW, curH, minOf(item.i));
        this.applyTrialPositions(trial);
        const me = this.findCardEl(this.gridEl as HTMLElement, item.i);
        if (me) {
          this.positionCard(me, trial.find((t) => t.i === item.i) ?? { ...item, w: curW, h: curH });
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this._interacting = false;
        this.setLayout(compactVertical(gridResize(this.getLayout(), item.i, curW, curH, minOf(item.i))));
        this.saveLayout();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    const main = renderAppShell(root, this.plugin, this.viewKey());
    this.mainEl = main;
    if (this._intro) root.addClass("tj-intro-root");
    root.addClass("tj-dashboard");
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
    if (this.headerTimer !== null) {
      window.clearInterval(this.headerTimer);
      this.headerTimer = null;
    }
    if (this.bodyObserver) {
      this.bodyObserver.disconnect();
      this.bodyObserver = null;
    }
  }

  /** Time-of-day greeting, using the name from settings (journalName). */
  private greetingText(): string {
    const h = new Date().getHours();
    const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const name = (this.plugin.settings.journalName || "").trim();
    return name ? `${part}, ${name}` : part;
  }

  /** Dashboard header: rotating greeting on the left, actions on the right. */
  renderHeader(main: HTMLElement): HTMLElement {
    const header = main.createDiv({ cls: "tj-header" + (this._intro ? " tj-intro" : "") });

    const left = header.createDiv({ cls: "tj-header-greeting" });
    left.createDiv({ cls: "tj-header-greet", text: this.greetingText() });
    const sub = left.createDiv({ cls: "tj-header-sub" });
    this.msgEl = sub;

    // The line is derived from the clock, so re-renders (clicks on Edit/Filters)
    // always show the SAME line. It only advances on its own 20s timer.
    if (this.msgBase < 0) {
      const now = new Date();
      const day = Math.floor(now.getTime() / 86400000);
      this.msgBase = (day * 7 + now.getHours()) % GREETING_LINES.length;
    }
    const currentLine = () =>
      GREETING_LINES[(this.msgBase + Math.floor((Date.now() - this.msgStart) / 20000)) % GREETING_LINES.length];
    sub.setText(currentLine());
    if (this.headerTimer !== null) {
      window.clearInterval(this.headerTimer);
      this.headerTimer = null;
    }
    this.headerTimer = window.setInterval(() => {
      const el = this.msgEl;
      if (!el) return;
      el.addClass("tj-fade");
      window.setTimeout(() => {
        el.setText(currentLine());
        el.removeClass("tj-fade");
      }, 220);
    }, 20000);

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
      this.render();
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
        this.render();
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
    });

    if (this.filtersOpen) this.renderFilterPopover(header);
    if (this.widgetMenuOpen) this.renderWidgetMenu(header);
    return header;
  }

  /** Dropdown list of addable widgets — stays open for multiple adds. */
  renderWidgetMenu(header: HTMLElement): void {
    const backdrop = header.createDiv({ cls: "tj-pop-backdrop" });
    backdrop.addEventListener("click", () => {
      this.widgetMenuOpen = false;
      this.render();
    });
    const pop = header.createDiv({ cls: "tj-popover tj-widgetmenu" });
    pop.addEventListener("click", (e) => e.stopPropagation());
    pop.createDiv({ cls: "tj-pop-section", text: "Add widget" });
    const list = pop.createDiv({ cls: "tj-widgetmenu-list" });
    const present = new Set(this.getLayout().map((i) => i.i));
    for (const id of this.allowedIds()) {
      const added = present.has(id);
      const item = list.createDiv({ cls: "tj-widgetmenu-item" + (added ? " is-added" : "") });
      item.createSpan({ cls: "tj-widgetmenu-name", text: CARD_TITLES[id] });
      if (added) item.createSpan({ cls: "tj-widgetmenu-check", text: "✓" });
      else item.addEventListener("click", () => this.addWidget(id));
    }
  }

  /** Seamless period bar, embedded under the header (Journalit style). */
  renderPeriodBar(main: HTMLElement): void {
    const bar = main.createDiv({ cls: "tj-periodbar" + (this._intro ? " tj-intro" : "") });
    const ranges: [string, string][] = [
      ["today", "Today"],
      ["yesterday", "Yesterday"],
      ["thisweek", "This Week"],
      ["1m", "This Month"],
      ["thisquarter", "This Quarter"],
      ["thisyear", "This Year"],
      ["all", "All Time"],
      ["custom", "Custom"],
    ];
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
        onChange: (iso) => {
          this.customTo = iso;
          this.render();
        },
      });
    }
  }

  renderLayout(root: HTMLElement, trades: Trade[]): void {
    // Money (every leg) drives the P&L; the counted list drives win rates and
    // trade counts — so a copied trade never tips a widget twice.
    const counted = this.countsList(trades);
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
    let layout = compactVertical(this.getLayout());
    if (cols < GRID_COLS) layout = reflow(layout, cols, minOf);
    const prevTrades = this.previousPeriodTrades();

    if (layout.length === 0) {
      grid.createDiv({ cls: "tj-empty", text: "Dashboard is empty — press the pencil, then “Add widget”." });
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

    let introIdx = 0;
    for (const item of layout) {
      const card = grid.createDiv({ cls: "tj-card tj-gridcard", attr: { "data-wid": item.i } });
      // Charts blend into the dashboard background (no card box / border).
      if (
        item.i === "equity" ||
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
        item.i === "equity" || item.i === "longpnl" || item.i === "shortpnl" || item.i === "calendar" || item.i.startsWith("m.");
      if (headerless) {
        const body = card.createDiv({
          cls: "tj-gridcard-body tj-scale" + (item.i.startsWith("m.") ? " tj-metric-body" : ""),
        });
        const drawHeadless = () => {
          body.empty();
          try {
            if (item.i === "equity") this.renderEquityBody(body, trades);
            else if (item.i === "longpnl") this.renderEquityBody(body, trades, "long");
            else if (item.i === "shortpnl") this.renderEquityBody(body, trades, "short");
            else if (item.i === "calendar")
              new PerformanceCalendarWidget(body, trades, {
                timeZone: this.plugin.settings.timeZone,
                onDayClick: (dateKey) => void this.openDayInTradeLog(dateKey),
                animate: this._intro && this.plugin.settings.animations !== false,
                dateFormat: this.plugin.settings.dateFormat,
              });
            else this.renderMetricBody(body, trades, item.i, prevTrades);
          } catch (err) {
            console.error("[tradebook] card failed:", item.i, err);
            body.empty();
            body.createDiv({ cls: "tj-empty", text: `"${CARD_TITLES[item.i]}" had a problem.` });
          }
        };
        this.bodyRenderers.set(body, drawHeadless);
        drawHeadless();
        this.bodyObserver?.observe(body);
        if (this.editMode) {
          const del = card.createEl("button", { cls: "tj-card-del", text: "✕", attr: { type: "button", "aria-label": "Remove card" } });
          attachTip(del, { title: "Remove card" });
          del.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
          // Metrics are fixed-size (drag to move only); chart + calendar are resizable.
          if (item.i === "equity" || item.i === "longpnl" || item.i === "shortpnl" || item.i === "calendar")
            this.bindResize(card, item);
        }
        continue;
      }
      const header = card.createDiv({ cls: "tj-card-header" });
      header.createEl("h3", { text: CARD_TITLES[item.i] });
      if (this.editMode) {
        const controls = header.createDiv({ cls: "tj-card-controls" });
        const b = controls.createEl("button", { text: "✕", cls: "tj-mini tj-del", attr: { type: "button", "aria-label": "Remove card" } });
        attachTip(b, { title: "Remove card" });
        b.addEventListener("click", (e) => { e.stopPropagation(); this.removeWidget(item.i); });
        this.bindResize(card, item);
      }
      const body = card.createDiv({ cls: "tj-gridcard-body " + (SCROLL_WIDGETS.has(item.i) ? "tj-scroll" : "tj-scale") });
      const drawBody = () => {
        body.empty();
        try {
          switch (item.i) {
            case "equity": this.renderEquityBody(body, trades); break;
            case "breakdown": this.renderBreakdownWidget(body, trades, counted, header); break;
            case "streaks": this.renderStreaksWidget(body, counted, item.h); break;
            case "score": this.renderScoreRadar(body, counted); break;
            case "heatmap": this.renderHeatmap(body, trades, counted); break;
            case "discipline": this.renderDisciplineWidget(body, counted, item.h); break;
            case "trends": this.renderTrendsWidget(body, counted); break;
            case "payouts": this.renderPayoutsWidget(body); break;
            case "calendar":
              new PerformanceCalendarWidget(body, trades, {
                timeZone: this.plugin.settings.timeZone,
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
      drawBody();
      this.bodyObserver?.observe(body);
    }
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

  /** Cumulative P&L — chart only. Hover shows the running total. */
  renderEquityBody(body: HTMLElement, trades: Trade[], dir?: "long" | "short"): void {
    const list = dir ? trades.filter((t) => (t.direction || "").toLowerCase() === dir) : trades;
    const wrap = body.createDiv({ cls: "tj-eq" });
    const chart = wrap.createDiv({ cls: "tj-eq-chart" });
    if (list.length) this.drawEquityChart(chart, list, dir ?? "equity");
    else chart.createDiv({ cls: "tj-chart-empty", text: "No data" });
    // Tiny, unobtrusive title (Journalit style) — added after drawing so the
    // chart's container.empty() does not wipe it.
    const title = dir === "long" ? "Long P&L" : dir === "short" ? "Short P&L" : "Cumulative P&L";
    wrap.createDiv({ cls: "tj-eq-title", text: title });
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

  /** One metric per widget. */
  renderMetricBody(body: HTMLElement, trades: Trade[], id: string, prevTrades: Trade[] = []): void {
    const def = metricById(id);
    const dayKey = (t: Trade): string => toZoneDate(t.date, t.entryTime, this.plugin.settings.timeZone);
    const wrap = body.createDiv({ cls: "tj-metric" });
    const labelText = def?.label ?? CARD_TITLES[id] ?? id;
    const labelEl = wrap.createDiv({ cls: "tj-metric-label", text: labelText });
    const val = wrap.createDiv({ cls: "tj-metric-value" });
    const res = def ? def.compute(PER_TRADE_METRICS.has(id) ? this.countsList(trades) : trades, dayKey) : { value: "—", tone: "neutral" as const };
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

    // Sub-stat: delta vs the previous period (neutral — direction via arrow).
    if (COMPARE_METRICS.has(id) && prevTrades.length && parsed !== null) {
      const prevRes = def ? def.compute(PER_TRADE_METRICS.has(id) ? this.countsList(prevTrades) : prevTrades, dayKey) : null;
      const prevNum = prevRes ? parseMetricNumber(prevRes.value) : null;
      if (prevNum !== null) {
        const d = parsed - prevNum;
        const sub = wrap.createDiv({ cls: "tj-metric-sub" });
        sub.setText(`${d >= 0 ? "\u2191" : "\u2193"} ${fmtMoney2(d)} vs prev`);
      }
    }

    // Scale the value with the widget, but keep it modest (dashboard, not a TV).
    const w = Math.max(110, body.clientWidth || 200);
    const hh = Math.max(48, body.clientHeight || 70);
    val.style.fontSize = `${Math.max(14, Math.min(w * 0.1, hh * 0.4, 22)).toFixed(0)}px`;
  }

  /**
   * Minimal cumulative P&L curve that fills its container exactly.
   * Smooth (Catmull-Rom) line, accent stroke, green/red area split at zero.
   * Morphs smoothly when data changes and hides axis labels when too small.
   */
  private drawEquityChart(container: HTMLElement, trades: Trade[], key = "equity"): void {
    const sorted = [...trades].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.entryTime || "").localeCompare(b.entryTime || "")
    );
    let cum = 0;
    const values: number[] = [0];
    const dates: string[] = [sorted[0]?.date ?? ""];
    for (const t of sorted) {
      cum += netPnl(t);
      values.push(cum);
      dates.push(t.date);
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
      this.render();
    });
    const pop = header.createDiv({ cls: "tj-popover" });
    pop.addEventListener("click", (e) => e.stopPropagation());

    // ---- Trading data ----
    pop.createDiv({ cls: "tj-pop-section", text: "Trading data" });
    pop.createDiv({ cls: "tj-pop-label", text: "Account" });
    const accSel = pop.createEl("select", { cls: "dropdown tj-filt-account" });
    const allOpt = accSel.createEl("option", { value: "", text: "All accounts" });
    if (!this.accountId) allOpt.setAttr("selected", "selected");

    const accounts = this.plugin.settings.propAccounts;
    const byFirm = new Map<string, { acc: (typeof accounts)[number]; type: string; label: string; order: number }[]>();
    for (const acc of accounts) {
      const firmLabel = catalogLabel(acc.firmId) ?? "Other";
      const sizeLabel = acc.size ? `$${(acc.size / 1000).toFixed(0)}K` : "";
      const typeTag = acc.type === "eval" ? "Eval" : acc.type === "funded" ? "Funded" : acc.type === "live" ? "Live" : acc.type === "personal" ? "Personal" : acc.type === "demo" ? "Demo" : "Other";
      const label = acc.name.length > 0 && acc.name !== "Custom Account" ? acc.name : `${firmLabel} ${sizeLabel} ${typeTag}`.trim();
      const order = acc.type === "funded" ? 0 : acc.type === "live" ? 1 : acc.type === "personal" ? 2 : acc.type === "eval" ? 3 : 4;
      if (!byFirm.has(firmLabel)) byFirm.set(firmLabel, []);
      byFirm.get(firmLabel)!.push({ acc, type: acc.type, label, order });
    }
    for (const [firmLabel, list] of [...byFirm.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const group = accSel.createEl("optgroup", { attr: { label: firmLabel } });
      for (const item of [...list].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))) {
        const opt = group.createEl("option", { value: item.acc.id, text: item.label });
        if (this.accountId === item.acc.id) opt.setAttr("selected", "selected");
      }
    }
    accSel.addEventListener("change", () => {
      this.accountId = accSel.value || null;
      this.render();
    });

    // ---- Classification ----
    pop.createDiv({ cls: "tj-pop-section", text: "Classification" });
    const types = pop.createDiv({ cls: "tj-chipgroup tj-chips-inline" });
    for (const f of accountFilters()) {
      const chip = types.createEl("button", { text: f.label, cls: "tj-chip" });
      if (!this.accountId && this.filter === f.id) chip.addClass("active");
      chip.addEventListener("click", () => {
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
  /**
   * Payouts: what has actually left the accounts. Cash out, not performance — a
   * payout moves the balance and the distance to the limit, never the P&L.
   */
  renderPayoutsWidget(body: HTMLElement): void {
    const excludeDemos = this.plugin.settings.excludeDemosFromPortfolio !== false;
    const accounts = this.plugin.settings.propAccounts ?? [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const rows = (this.plugin.settings.payouts ?? [])
      .filter((p) => byId.has(p.accountId) && !(excludeDemos && byId.get(p.accountId)?.type === "demo"))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!rows.length) {
      body.createDiv({
        cls: "tj-empty",
        text: "No payouts yet. Log one on the account page on the day the money reaches you — the account value and its distance to the limit follow from it.",
      });
      return;
    }

    const total = rows.reduce((s, p) => s + p.amount, 0);
    const year = String(new Date().getFullYear());
    const yearTotal = rows.filter((p) => p.date.startsWith(year)).reduce((s, p) => s + p.amount, 0);
    const touched = new Set(rows.map((p) => p.accountId));
    const last = rows[rows.length - 1];

    const wrap = body.createDiv({ cls: "tj-pay" });
    const top = wrap.createDiv({ cls: "tj-pay-top" });
    const totalBox = top.createDiv({ cls: "tj-pay-total" });
    totalBox.createSpan({ cls: "tj-pay-k", text: "Total withdrawn" });
    const totalVal = totalBox.createEl("b", { cls: "tj-pay-v", text: fmtMoney2(total) });
    attachTip(totalVal, {
      title: "Money that left your accounts",
      sub: "Money that left your accounts.",
    });

    const facts = top.createDiv({ cls: "tj-pay-facts" });
    const fact = (label: string, value: string) => {
      const box = facts.createDiv({ cls: "tj-pay-fact" });
      box.createSpan({ cls: "tj-pay-k", text: label });
      box.createSpan({ cls: "tj-pay-f", text: value });
    };
    fact("Payouts", String(rows.length));
    fact("Accounts", String(touched.size));
    fact(`In ${year}`, fmtMoney2(yearTotal));

    // Six months of cash out, so the shape of "when did I take money" is visible.
    const now = new Date();
    const months: Array<{ key: string; amount: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, amount: 0 });
    }
    for (const p of rows) {
      const bucket = months.find((m) => m.key === p.date.slice(0, 7));
      if (bucket) bucket.amount += p.amount;
    }
    // Six months of cash out as one continuous bar — width by amount (magnitude).
    renderContinuousBar(wrap, {
      className: "tj-pay-cbar",
      showLabels: true,
      weightOf: (s) => Math.abs(s.value),
      segments: months.map((m) => ({
        key: m.key,
        label: MON_ABBR[Number(m.key.slice(5, 7)) - 1],
        value: m.amount,
        tone: m.amount > 0 ? "pos" : "neutral",
        tip: m.amount > 0 ? { title: m.key, value: fmtMoney2(m.amount) } : undefined,
      })),
    });

    const lastAcc = byId.get(last.accountId);
    wrap.createDiv({
      cls: "tj-pay-last",
      text: `Last · ${formatDate(last.date)} · ${lastAcc?.name ?? "unknown account"} · ${fmtMoney2(last.amount)}`,
    });
  }

  renderTrendsWidget(body: HTMLElement, trades: Trade[]): void {
    if (!trades.length) {
      body.createDiv({ cls: "tj-empty", text: "No trades in this period." });
      return;
    }
    const trends = computeTrends(trades);
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
    head.createDiv({ cls: "tj-trendval", text: `Previous ${trends.nBefore}` });
    head.createDiv({ cls: "tj-trendval", text: `Latest ${trends.nAfter}` });
    head.createDiv({ cls: "tj-trendval", text: "Change" });

    for (const row of trends.rows) {
      const line = body.createDiv({ cls: "tj-trendrow" });
      line.createDiv({ cls: "tj-trendname", text: row.label });
      line.createDiv({ cls: "tj-trendval", text: write(row.before, row.unit) });
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
        : `Not enough history for a trend yet \u2014 ${trades.length} trades here, and a direction needs ${trends.minSample} on each side of the split.`,
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

  renderDisciplineWidget(body: HTMLElement, trades: Trade[], h?: number): void {
    if (!trades.length) {
      body.createDiv({ cls: "tj-empty", text: "No trades in this period." });
      return;
    }
    const rev = reviewSummary(trades);
    const need = rev.total - rev.complete;
    const dayKey = (t: Trade): string => toZoneDate(t.date, t.entryTime, this.plugin.settings.timeZone);
    const process = computeProcessSignals(trades, dayKey);

    // Journaling coverage: optional psychology / mistake signals logged or
    // explicitly acknowledged. Distinct from the required-checklist review %.
    const journaled = trades.filter(
      (t) =>
        (t.psychology_tags?.length ?? 0) > 0 ||
        t.psychologyAcknowledged === true ||
        (t.mistake_tags?.length ?? 0) > 0 ||
        t.mistakesAcknowledged === true
    ).length;
    const journalPct = trades.length ? (journaled / trades.length) * 100 : 0;
    const tiltPct = process.tradeCount ? (process.afterTwoLosses / process.tradeCount) * 100 : 0;

    const wrap = body.createDiv({ cls: "tj-revieww" });
    // Compact when the card is short: measured height when the DOM has laid out,
    // otherwise the grid row count (keeps the behaviour testable in jsdom).
    const measured = body.clientHeight || 0;
    const compact = measured > 0 ? measured < 150 : (h ?? 6) <= 4;
    wrap.toggleClass("is-compact", compact);

    if (!compact) {
      const gaugewrap = wrap.createDiv({ cls: "tj-revieww-gaugewrap" });
      const color = need === 0 ? "var(--tj-tone-good)" : rev.pct >= 50 ? "var(--tj-tone-mid)" : "var(--tj-tone-bad)";
      const animationsOn = this.plugin.settings.animations !== false;
      const prevPct = this._reviewPct;
      this._reviewPct = rev.pct;
      renderGauge(gaugewrap, {
        pct: rev.pct,
        color,
        label: `${rev.pct}%`,
        sublabel: "reviewed",
        className: "tj-disc-gauge",
        animate: animationsOn && prevPct !== rev.pct,
      });
      gaugewrap.createDiv({
        cls: "tj-revieww-gauge-cap" + (need === 0 ? " is-complete" : ""),
        text: need === 0 ? "complete" : "trades need review",
      });
    }

    const foot = wrap.createDiv({ cls: "tj-revieww-foot" });
    foot.createDiv({
      cls: "tj-revieww-sub",
      text: need === 0 ? "All caught up 🎉" : `${rev.complete} of ${rev.total} complete`,
    });

    // Good signals read green when high; bad signals read green when low.
    const state = (v: number, good: boolean): "ok" | "warn" | "bad" =>
      good ? (v >= 70 ? "ok" : v >= 40 ? "warn" : "bad") : v <= 10 ? "ok" : v <= 25 ? "warn" : "bad";
    renderStatusRow(foot, {
      className: "tj-disc-process",
      items: [
        { key: "review", label: "Review", state: state(rev.pct, true),
          tip: { title: "Reviewed", value: `${rev.pct}%`, sub: `${rev.complete} of ${rev.total} complete` } },
        { key: "journal", label: "Journal", state: state(journalPct, true),
          tip: { title: "Journaling coverage", value: `${journalPct.toFixed(0)}%`, sub: "Psychology or mistakes logged or acknowledged." } },
        { key: "stops", label: "Stops", state: state(process.stopDefinedPct, true),
          tip: { title: "Stop defined", value: `${process.stopDefinedPct.toFixed(0)}%`, sub: "Trades with a protective stop." } },
        { key: "revenge", label: "Revenge", state: state(process.revengeRate, false),
          tip: { title: "Revenge trades", value: `${process.revengeRate.toFixed(0)}%`, sub: `${process.revengeCount} re-entries after a loss.` } },
        { key: "tilt", label: "Tilt", state: state(tiltPct, false),
          tip: { title: "After two losses", value: `${process.afterTwoLosses}`, sub: "Trades opened right after two consecutive losses." } },
        { key: "fast", label: "Fast", state: state(process.fastTradesPct, false),
          tip: { title: "Impulsive", value: `${process.fastTradesPct.toFixed(0)}%`, sub: "Opened and closed inside a minute." } },
      ],
    });

    // Explicit action instead of a hoverable, fully-clickable card.
    const actions = foot.createDiv({ cls: "tj-revieww-actions" });
    const openBtn = actions.createEl("button", {
      cls: "tj-revieww-open",
      text: "Open review queue →",
      attr: { type: "button" },
    });
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.openReviewQueue();
    });
  }

  /** Opens the Trade Log filtered to a single day (calendar day click). */
  private async openDayInTradeLog(dateKey: string): Promise<void> {
    await this.plugin.openTradeLog();
    const leaves = this.plugin.app.workspace.getLeavesOfType("tradebook-trade-log-view");
    const view: any = leaves.length ? leaves[0].view : null;
    if (view && typeof view.filterByDay === "function") view.filterByDay(dateKey);
  }

  /** Opens the Trade Log filtered to the trades that still need review. */
  private async openReviewQueue(): Promise<void> {
    await this.plugin.openTradeLog();
    const leaves = this.plugin.app.workspace.getLeavesOfType("tradebook-trade-log-view");
    const view: any = leaves.length ? leaves[0].view : null;
    if (view && typeof view.filterByReview === "function") view.filterByReview("pending");
  }

  /** GitHub-style P&L heat-map of the last ~6 months. */
  renderHeatmap(body: HTMLElement, trades: Trade[], counted: Trade[] = trades): void {
    killTip();
    guardTips();
    document.querySelectorAll(".tj-tip").forEach((n) => n.remove());

    const byDay = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of trades) {
      if (!t.date) continue;
      const b = byDay.get(t.date) ?? { pnl: 0, count: 0, wins: 0 };
      b.pnl += Number.isFinite(t.pnl) ? t.pnl : 0;
      byDay.set(t.date, b);
    }
    for (const t of counted) {
      if (!t.date) continue;
      const b = byDay.get(t.date) ?? { pnl: 0, count: 0, wins: 0 };
      b.count++;
      if (t.pnl > 0) b.wins++;
      byDay.set(t.date, b);
    }
    if (!byDay.size) {
      body.createDiv({ cls: "tj-empty", text: "No trades yet." });
      return;
    }
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const first = new Date(end.getFullYear(), end.getMonth() - 5, 1);
    const startMon = new Date(first);
    startMon.setDate(startMon.getDate() - ((startMon.getDay() + 6) % 7));
    const weeks: Date[] = [];
    for (const d = new Date(startMon); d <= end; d.setDate(d.getDate() + 7)) weeks.push(new Date(d));

    const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const maxAbs = Math.max(...[...byDay.values()].map((b) => Math.abs(b.pnl)), 1);
    const cell = Math.max(8, Math.min(15, Math.floor(((body.clientHeight || 160) - 46) / 7)));

    const wrap = body.createDiv({ cls: "tj-heat" });
    const monthsRow = wrap.createDiv({ cls: "tj-heat-months" });
    const main = wrap.createDiv({ cls: "tj-heat-main" });
    const days = main.createDiv({ cls: "tj-heat-days" });
    const wcol = main.createDiv({ cls: "tj-heat-weeks" });

    for (let i = 0; i < 7; i++) {
      const s = days.createDiv({ cls: "tj-heat-day" });
      s.style.height = `${cell}px`;
      if (i % 2 === 0) s.setText(DAYS[i]);
    }

    let lastMonth = -1;
    let lastLabelAt = -99;
    weeks.forEach((w, wi) => {
      const col = wcol.createDiv({ cls: "tj-heat-col" });
      const slot = monthsRow.createDiv({ cls: "tj-heat-mslot" });
      slot.style.width = `${cell}px`;
      if (w.getMonth() !== lastMonth) {
        lastMonth = w.getMonth();
        // Skip a label if it would collide with the previous one (like GitHub).
        if (wi - lastLabelAt >= 3) {
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

  private bindHeatTip(cell: HTMLElement, key: string, b: { pnl: number; count: number; wins: number }): void {
    cell.addEventListener("mouseenter", () => {
      const [y, m, d] = key.split("-");
      showTip(
        {
          title: formatDate(key, this.plugin.settings.dateFormat) || `${parseInt(d, 10)} ${MON_ABBR[parseInt(m, 10) - 1]} ${y}`,
          value: fmtMoney2(b.pnl),
          tone: b.pnl >= 0 ? "pos" : "neg",
          sub: `${b.count} trade${b.count === 1 ? "" : "s"} · ${Math.round((b.wins / b.count) * 100)}% win`,
        },
        "tj-heat-tip"
      );
    });
    cell.addEventListener("mousemove", (e) => moveTip(e));
    cell.addEventListener("mouseleave", () => killTip());
  }

  /**
   * Trading Score — Journalit-style weighted radar.
   * 6 axes: risk 25 · profitability 20 · execution 15 · consistency 15 ·
   * experience 15 · return-consistency 10. Unlocks after 4 weeks + 5 trades.
   */
  renderScoreRadar(body: HTMLElement, trades: Trade[]): void {
    if (trades.length === 0) {
      body.createDiv({ cls: "tj-empty", text: "No trades to compute score." });
      return;
    }
    const result = computeScore(trades, (t) => t.date);
    const axes = result.axes;
    const score = result.score;
    const phase = result.phase;
    const weeksActive = result.progress.weeksActive;
    const count = result.progress.tradeCount;
    const band = SCORE_BAND_TOKEN[result.band];

    const NS = "http://www.w3.org/2000/svg";
    const el = (tag: string, attrs: Record<string, string>): SVGElement => {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };
    const box = body.createDiv({ cls: "tj-chart-box tj-radar-box tj-score2" });
    box.style.setProperty("--tj-score-color", band);

    // ------------------ locked: progress ring ------------------
    if (!result.unlocked) {
      const done = Math.min(4, weeksActive);
      const pct = (done / 4) * 100;
      const msg =
        weeksActive < 4
          ? done === 0
            ? "Start trading to unlock your score"
            : done === 1
              ? "1 week down, keep going!"
              : `${4 - done} weeks to unlock`
          : `${Math.max(0, 5 - count)} trades to unlock`;
      const wrap = box.createDiv({ cls: "tj-score-lock" });
      renderGauge(wrap, {
        pct,
        color: band,
        label: String(done),
        sublabel: "of 4",
        className: "tj-score-gauge",
      });
      box.createDiv({ cls: "tj-score-msg", text: msg });
      box.createDiv({ cls: "tj-score-trades", text: `${count} trades logged` });
      return;
    }

    // ------------------ unlocked: weighted radar ------------------
    const n = axes.length;
    const cx = 200, cy = 165, r = 118;
    const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
    const pt = (i: number, dist: number) => ({ x: cx + Math.cos(angle(i)) * dist, y: cy + Math.sin(angle(i)) * dist });
    const svg = el("svg", { viewBox: "0 0 400 320", preserveAspectRatio: "xMidYMid meet", class: "tj-chart tj-radar", width: "100%", height: "100%" });
    box.appendChild(svg as unknown as Node);
    const small = (box.clientWidth > 0 && box.clientWidth < 150) || (box.clientHeight > 0 && box.clientHeight < 110);

    for (const pct of [0.25, 0.5, 0.75, 1]) {
      let d = "";
      for (let i = 0; i < n; i++) {
        const p = pt(i, r * pct);
        d += (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
      }
      svg.appendChild(el("path", { d: d + "Z", class: "tj-radar-ring" }));
    }
    for (let i = 0; i < n; i++) {
      const p = pt(i, r);
      svg.appendChild(el("line", { x1: String(cx), y1: String(cy), x2: String(p.x), y2: String(p.y), class: "tj-radar-axis" }));
    }
    if (!small) {
      for (let i = 0; i < n; i++) {
        const p = pt(i, r + 24);
        const lbl = el("text", {
          x: String(p.x), y: String(p.y), "text-anchor": "middle", "dominant-baseline": "central", class: "tj-radar-label",
        });
        lbl.textContent = axes[i].label;
        svg.appendChild(lbl);
      }
    }
    const fill = el("path", { class: "tj-radar-fill" });
    fill.setAttribute("stroke-dasharray", "4 3");
    svg.appendChild(fill);
    const shapeAt = (scale: number) => {
      let d = "";
      for (let i = 0; i < n; i++) {
        const p = pt(i, (axes[i].value / 100) * r * scale);
        d += (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
      }
      return d + "Z";
    };
    const animationsOn = this.plugin.settings.animations !== false && !this._radarAnimated;
    this._radarAnimated = true;
    fill.setAttribute("d", shapeAt(animationsOn ? 0 : 1));
    if (animationsOn) {
      const dur = 700;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        fill.setAttribute("d", shapeAt(e));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // hover targets: axis score + weight
    for (let i = 0; i < n; i++) {
      const p = pt(i, r);
      const hit = el("circle", { cx: String(p.x), cy: String(p.y), r: "22", fill: "transparent", class: "tj-tip-anchor" });
      hit.addEventListener("mouseenter", () =>
        showTip(
          {
            title: axes[i].label,
            value: String(Math.round(axes[i].value)),
            sub: `Weight: ${Math.round(axes[i].weight * 100)}%`,
          },
          "tj-score-tip"
        )
      );
      hit.addEventListener("mousemove", (e) => moveTip(e));
      hit.addEventListener("mouseleave", () => killTip());
      svg.appendChild(hit);
    }

    // footer: composite score · phase · weeks
    const foot = box.createDiv({ cls: "tj-score-foot" });
    foot.createDiv({ cls: "tj-score-big", text: String(Math.round(score)) });
    const meta = foot.createDiv({ cls: "tj-score-meta" });
    meta.createSpan({ cls: "tj-score-phase", text: phase });
    meta.createSpan({ cls: "tj-score-weeks", text: `· ${weeksActive}w` });
  }

  /**
   * Streaks — three calm lines (hero, context, state) with a W/L ribbon of the
   * recent sequence. One decision per counted trade.
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
    const icon = current >= 3 ? "flame" : current > 0 ? "trending-up" : current < 0 ? "alert-triangle" : "minus";
    const tone = current > 0 ? "is-pos" : current < 0 ? "is-warn" : "is-flat";

    const wrap = body.createDiv({ cls: "tj-streaks" });
    // Compact when the card is short: measured height, else the grid row count
    // (keeps the behaviour testable in jsdom). Hides the state line when tiny.
    const measured = body.clientHeight || 0;
    const rows = h ?? 6;
    const compact = measured > 0 ? measured < 110 : rows <= 3;
    const tiny = measured > 0 ? measured < 80 : rows <= 2;
    wrap.toggleClass("is-compact", compact || tiny);
    wrap.toggleClass("is-tiny", tiny);

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
    ctx.createSpan({ text: `best ${bestWin} · avg ${avg.toFixed(1)}` });
    attachTip(ctx, {
      title: "Streaks",
      sub: `Best win run ${bestWin} · worst loss run ${worstLoss} · ${runs} win run${runs === 1 ? "" : "s"}`,
    });

    // Line 3 — state (hidden when the card is tiny).
    if (!tiny) wrap.createDiv({ cls: "tj-streaks-state " + tone, text: streakState(current) });
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
      const d = toZoneDate(t.date, t.entryTime, zone);
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
        id: "hour", label: "Hour", key: hourBlockOf, timeline: true,
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
      const scope = {
        period: this.dateRange,
        customFrom: this.customFrom,
        customTo: this.customTo,
        accountId: this.accountId,
        accountType: this.filter,
      };
      renderTreemap(panel, {
        tiles,
        className: "tj-bd-treemap",
        maxTiles: dim.timeline ? tiles.length : undefined,
        formatMoney: fmtMoneyCompact,
        onTileClick: (tile) => {
          void this.plugin.openTradeLogForBreakdown(
            `${dim.label}: ${tile.label}`,
            // Archived trades are out of every Home number, so the lens must leave
            // them out too — otherwise the ledger shows rows the tile never counted.
            (t) => !this.plugin.isArchivedTrade(t) && (dim.key(t) || "") === tile.key,
            scope
          );
        },
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
 * Dashboard — the archive. Fully editable and rich: every widget, drag, resize,
 * add and remove. It reads and writes `settings.dashboardLayout`, seeds
 * `DASHBOARD_DEFAULT` on a brand-new journal and allows every widget id — all
 * of which are the shared engine's defaults, so it stays a thin subclass.
 */
export class DashboardView extends WidgetGridView {}
