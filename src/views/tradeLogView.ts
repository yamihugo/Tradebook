import { ItemView, Modal, Notice, setIcon, TFile } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { mountDateField } from "../lib/dates";
import { dateInZone } from "../lib/periods";
import { renderAppShell, accountFilters } from "../ui";
import { reviewStatus, hasPrint, hasText } from "../lib/review";
import { setTradeMistakeTags, updateTradeArrayFields, updateTradeFields } from "../storage";
import { attachTip } from "../lib/tip";
import { renderEmptyState as renderEmptyBox } from "../lib/emptyState";
import { analyticsTrades } from "../lib/scope";
import { sessionOf } from "../lib/sessions";
import { eligibleTradeIds, tradeSelectionScopeKey } from "../lib/tradeSelection";
import { mountDropdown } from "../lib/dropdown";
import type { DropdownItem } from "../lib/dropdown";
import { DEFAULT_MISTAKE_TAGS, DEFAULT_PSYCHOLOGY_TAGS, normalizeTags } from "../lib/tags";
import {
  DEFAULT_TRADE_LOG_ORDER,
  TRADE_COLUMNS,
  renderTradeTable,
  tradeR,
  tradeRows,
  orderedTradeRows,
  TradeSort,
  resolveOrder,
} from "../lib/tradeTable";

export const TRADE_LOG_VIEW_TYPE = "tradebook-trade-log-view";

/** Every column the ledger can hold — the shared order is validated against it. */
const ALL_COLUMN_IDS = TRADE_COLUMNS.map((c) => c.id);

/** Where the old per-column switches map onto the ledger columns. */
const LEGACY_KEYS: Record<string, string> = {
  stars: "stars",
};

/**
 * The windows a journal is actually read in. A trade log has to answer "today",
 * "yesterday" and "last week" before it answers "this year" — so the short
 * windows come first and none of them is missing.
 */
const PERIODS: Array<[string, string]> = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["thisweek", "This Week"],
  ["lastweek", "Last Week"],
  ["thismonth", "This Month"],
  ["lastmonth", "Last Month"],
  ["thisquarter", "This Quarter"],
  ["thisyear", "This Year"],
  ["all", "All Time"],
  ["custom", "Custom"],
];

/** The label for a stored period id; also the one used on the filter chip. */
function periodLabel(id: string): string {
  return PERIODS.find(([pid]) => pid === id)?.[1] ?? id;
}

/** What "None" means in the account picker: a filter that can match nothing. */
const NO_ACCOUNT = "__none__";

/** Is this trade missing one of the things a finished journal entry has? */
function missingFlag(t: Trade, kind: string): boolean {
  if (kind === "noprint") return !hasPrint(t);
  if (kind === "nosetup") return !hasText(t.setup);
  if (kind === "nostop") return !(typeof t.stopLoss === "number" && t.stopLoss > 0);
  return !((t.rating ?? 0) > 0);
}

/**
 * Everything the page derives from the filtered list, computed once per filter
 * set. The list is only recomputed when a filter actually changes — not when a
 * row is selected or when fifty more rows are revealed.
 */
interface TradeLogStats {
  list: Trade[];
  /** One entry per logical trade (copies collapsed) — what the figures count. */
  counted: Trade[];
  tradeCount: number;
  pending: number;
  missingSetup: number;
  missingPrint: number;
}

/**
 * An explicit, widget-driven navigation into the Trade Log. It carries the scope
 * the source was reading in (period, account/class) and the action's own filter,
 * so the destination shows the SAME data the user clicked. Ordinary navigation
 * (`openTradeLog`) does not use this and keeps the user's previous Trade Log.
 */
export interface TradeLogNav {
  scope?: {
    /** Grid period id ("1m" is mapped to "thismonth"). */
    period?: string;
    customFrom?: string;
    customTo?: string;
    /** Exact source-view bounds for presets the ledger does not expose directly. */
    dateBounds?: { start: string; end: string; label: string };
    accountId?: string | null;
    accountType?: string;
  };
  review?: "all" | "pending" | "complete";
  quality?: string[];
  lens?: { label: string; test: (t: Trade) => boolean };
  ids?: string[];
}

export class TradeLogView extends ItemView {
  plugin: TradebookPlugin;
  trades: Trade[] = [];
  symbolFilter = "";
  /** Any of these accounts (a journal is read across accounts, not one at a time). */
  accountFilters: string[] = [];
  /** Include the picked accounts, or treat them as the ones to leave out. */
  accountExclude = false;
  /** Exact trade ids — a transient lens (e.g. "the ones the import just wrote"). */
  idFilter: string[] = [];
  groupFilter = "";
  directionFilter = "all";
  /** all | win | loss | be — break-even is a state (net exactly zero), not a side. */
  resultFilter = "all";
  mistakeFilters: string[] = [];
  reviewFilter: "all" | "pending" | "complete" = "all";
  /** all | rth | overnight | none */
  sessionFilter = "all";
  /** all | demo | eval | funded | live | personal | unknown — the account class. */
  accountTypeFilter = "all";
  /**
   * A one-shot lens handed over by a Home/Dashboard breakdown tile: a label for
   * the chip and the exact predicate that made the tile. It is a view, not a
   * preference — it never persists and clears with the other filters.
   */
  lens: { label: string; test: (t: Trade) => boolean } | null = null;
  /** Which gaps to look for — a trade can be missing more than one thing. */
  qualityFilters: string[] = [];
  /** Leave demo-account trades out of the ledger and every count (Trade Log only). */
  excludeDemos = false;
  /** What the reader typed in the account picker (kept across re-renders). */
  accQuery = "";
  /** all | 1plus | 0to1 | neg — how the trade finished in R, not in dollars. */
  rFilter = "all";
  period = "all";
  customFrom = "";
  customTo = "";
  /** Transient label/bounds for a contextual period not in the ledger shortcuts. */
  private scopedPeriodLabel = "";
  private scopedPeriodBounds: { start: string; end: string } | null = null;
  search = "";
  setupFilters: string[] = [];
  limit = 50;
  /** Which column the list is sorted by, remembered between visits. */
  sort: TradeSort | null = null;
  /** The trade the reader was last on: we come back to it, not to the top. */
  anchor = "";
  savedScrollY = 0;
  selected = new Set<string>();
  selectMode = false;
  filtersOpen = false;
  columnsOpen = false;
  private _restoreFocus = false;
  /** Which columns this page shows (the order itself is shared, in tradeLogColOrder). */
  colOrder: string[] = DEFAULT_TRADE_LOG_ORDER.slice();
  /** Bumped every time the notes are re-read, so cached stats know they are stale. */
  private _dataVersion = 0;
  /** Filtered list + every figure the page derives from it, memoised per filter set. */
  private _stats: { key: string; value: TradeLogStats } | null = null;
  private _searchTimer = 0;
  private _ledgerHost: HTMLElement | null = null;
  private _bulkHost: HTMLElement | null = null;
  /** Shift-click needs to know where the last click landed and in what order. */
  private _lastPicked: string | null = null;
  private _renderedIds: string[] = [];
  /** Filter population the current selection belongs to (sort/page size excluded). */
  private _selectionScope = "";
  private _drawerKeyCleanup: (() => void) | null = null;
  /** A tag menu is body-level; keep its global listeners scoped to the view. */
  private _bulkTagCleanup: (() => void) | null = null;
  /** Drag listeners live on the document; hold their remover so a mid-drag close cannot leak. */
  private _dragCleanup: (() => void) | null = null;
  private _focusTimer = 0;

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRADE_LOG_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Trade Log";
  }
  getIcon(): string {
    return "list";
  }

  async onOpen(): Promise<void> {
    const prefs = this.plugin.settings.tradeLog;
    if (prefs) {
      if (prefs.sort) this.sort = { id: String(prefs.sort.id), dir: prefs.sort.dir === "asc" ? "asc" : "desc" };
      const legacyCols = (prefs as Record<string, unknown>).cols as Record<string, boolean> | undefined;
      // Use the saved order directly: resolveOrder would add back columns
      // the user deliberately removed (e.g. hold, entryexit).
      this.colOrder = prefs.colOrder ? prefs.colOrder.slice() : this.legacyVisible(legacyCols);
      const f = prefs.filters;
      if (f) {
        // This Month used to be stored as "1m"; read the old value once and keep
        // going with the clear id.
        this.period = f.period === "1m" ? "thismonth" : (f.period ?? this.period);
        this.symbolFilter = f.symbol ?? this.symbolFilter;
        // Each of these used to hold a single value; read that once and keep going
        // with the list, so an old view opens with exactly the same trades in it.
        this.accountFilters = f.accounts ?? (f.account ? [f.account] : this.accountFilters);
        this.accountExclude = f.accountExclude === true;
        this.groupFilter = f.group ?? this.groupFilter;
        this.directionFilter = f.direction ?? this.directionFilter;
        this.resultFilter = f.result ?? this.resultFilter;
        this.mistakeFilters = f.mistakes ?? (f.mistake ? [f.mistake] : this.mistakeFilters);
        this.reviewFilter = (f.review as any) ?? this.reviewFilter;
        this.sessionFilter = f.session ?? this.sessionFilter;
        this.accountTypeFilter = f.accountType ?? this.accountTypeFilter;
        // Missing used to be a single choice; read that once and carry on with the list.
        this.qualityFilters = Array.isArray(f.quality)
          ? f.quality
          : typeof f.quality === "string" && f.quality !== "all"
            ? [f.quality]
            : this.qualityFilters;
        this.excludeDemos = f.excludeDemos === true;
        this.customFrom = f.customFrom ?? this.customFrom;
        this.customTo = f.customTo ?? this.customTo;
        this.search = f.search ?? this.search;
        this.setupFilters = f.setups ?? (f.setup ? [f.setup] : this.setupFilters);
        // The page size is deliberately not persisted: a list that grew to 150
        // last week should not open with 150 trades. It always starts at 50 again.
      }
    }
    if (this.period === "all") {
      const legacy = this.plugin.settings.tradeLogPeriod;
      this.period = legacy === "1m" ? "thismonth" : legacy || "all";
    }
    await this.refresh();

    // Ctrl/Cmd+A selects the whole filtered list while selection is on — the
    // keyboard way to do what "Select all" does with the mouse.
    this.registerDomEvent(document, "keydown", (e) => {
      if (!this.selectMode) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "a") return;
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      // Exactly what "Select all" selects: the filtered list, never trades the
      // filters are hiding.
      for (const t of this.filtered()) if (t.id) this.selected.add(t.id);
      this.syncSelection();
    });
  }

  /** Persist the Trade Log view preferences (columns + active filters). */
  private savePrefs(): void {
    const cur = { ...(this.plugin.settings.tradeLog || {}) };
    delete (cur as Record<string, unknown>).cols;
    delete (cur as Record<string, unknown>).twoCol;
    this.plugin.settings.tradeLog = { ...cur, colOrder: this.colOrder.slice(), sort: this.sort ?? undefined };
    void this.plugin.saveSettings();
  }

  /** Write the column order to the shared setting so the account page stays in sync. */
  private syncSharedOrder(): void {
    this.plugin.settings.tradeLogColOrder = this.colOrder.slice();
  }

  /**
   * The journal used to switch columns on and off with a boolean map. Honour it
   * once — a reader who had "Account" on must still have it on after the swap to
   * a ledger — and never ask again.
   */
  private legacyVisible(cols?: Record<string, boolean>): string[] {
    const order = DEFAULT_TRADE_LOG_ORDER.slice();
    for (const id of ["account", "stars"]) if (cols?.[LEGACY_KEYS[id]]) order.push(id);
    if (!cols) return order;
    return order.filter((id) => cols[LEGACY_KEYS[id]] !== false);
  }

  /** The visible columns, arranged by the order shared with an account's ledger. */
  private visibleOrder(): string[] {
    return resolveOrder(this.plugin.settings.tradeLogColOrder, ALL_COLUMN_IDS).filter((id) =>
      this.colOrder.includes(id)
    );
  }

  /** Turn a column on or off, keeping the shared arrangement as the source of truth. */
  private toggleColumn(id: string, on: boolean): void {
    this.colOrder = on
      ? (this.colOrder.includes(id) ? this.colOrder : [...this.colOrder, id])
      : this.colOrder.filter((x) => x !== id);
    this.savePrefs();
    this.render();
  }

  /** Persist the active filters so a reload/close keeps the same view. */
  private _filterTimer = 0;
  /** A scoped open (one account, one day, an import) is a lens, not a preference. */
  private _skipPersist = false;
  private _lastPersist = "";
  private persistFilters(): void {
    const filters = {
      symbol: this.symbolFilter,
      accounts: this.accountFilters.slice(),
      accountExclude: this.accountExclude,
      group: this.groupFilter,
      direction: this.directionFilter,
      result: this.resultFilter,
      mistakes: this.mistakeFilters.slice(),
      review: this.reviewFilter,
      session: this.sessionFilter,
      accountType: this.accountTypeFilter,
      quality: this.qualityFilters.slice(),
      period: this.period,
      customFrom: this.customFrom,
      customTo: this.customTo,
      search: this.search,
      setups: this.setupFilters.slice(),
      excludeDemos: this.excludeDemos,
    };
    // Writing the same thing every render was a save storm; only a real change
    // touches data.json. A scoped open records its signature without saving, so
    // it stays a lens until the reader actually changes a filter.
    const payload = JSON.stringify(filters);
    if (this._skipPersist) {
      this._skipPersist = false;
      this._lastPersist = payload;
      if (this._filterTimer) window.clearTimeout(this._filterTimer);
      return;
    }
    if (payload === this._lastPersist) return;
    if (this._filterTimer) window.clearTimeout(this._filterTimer);
    this._filterTimer = window.setTimeout(() => {
      this._lastPersist = payload;
      const cur = this.plugin.settings.tradeLog || {};
      this.plugin.settings.tradeLog = { ...cur, filters };
      void this.plugin.saveSettings();
    }, 300);
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this._dataVersion++;
    this.render();
  }

  /**
   * The one explicit navigation into the ledger from another view. It DROPS
   * every stale destination filter first (search text, quality/review chips,
   * direction, …), then applies the source scope and the action filter — so the
   * destination always represents the same data the user clicked, never a
   * leftover from a previous visit. Scoped navigations are not persisted as the
   * user's manual Trade Log preferences.
   */
  navigate(nav: TradeLogNav): void {
    this.clearFilters();
    const scope = nav.scope ?? {};
    // "1m" is the grid's id for the current month; the ledger calls it thismonth.
    const periodMap: Record<string, string> = { "1m": "thismonth" };
    this.scopedPeriodLabel = scope.dateBounds?.label ?? "";
    this.scopedPeriodBounds = scope.dateBounds ? { start: scope.dateBounds.start, end: scope.dateBounds.end } : null;
    this.period = periodMap[scope.period ?? ""] ?? scope.period ?? "all";
    if (this.period === "custom") {
      this.customFrom = this.scopedPeriodBounds?.start ?? scope.customFrom ?? "";
      this.customTo = this.scopedPeriodBounds?.end ?? scope.customTo ?? "";
    } else if (this.scopedPeriodBounds) {
      this.customFrom = this.scopedPeriodBounds.start;
      this.customTo = this.scopedPeriodBounds.end;
    }
    if (scope.accountId) this.accountFilters = [scope.accountId];
    if (scope.accountType && scope.accountType !== "all") this.accountTypeFilter = scope.accountType;
    if (nav.review) this.reviewFilter = nav.review;
    if (nav.quality && nav.quality.length) this.qualityFilters = [...nav.quality];
    if (nav.lens) this.lens = { label: nav.lens.label, test: nav.lens.test };
    if (nav.ids && nav.ids.length) {
      this.idFilter = [...nav.ids];
      this.period = "all";
      this.customFrom = "";
      this.customTo = "";
      this.scopedPeriodLabel = "";
      this.scopedPeriodBounds = null;
    }
    this._skipPersist = true;
    this.render();
  }

  /** Scoped open: a single day (used by the Calendar). */
  filterByDay(dateKey: string): void {
    this.navigate({ scope: { period: "custom", customFrom: dateKey, customTo: dateKey } });
  }

  /** Scoped open: show one account's trades (used from an account page / trade). */
  filterByAccount(accountId: string): void {
    this.navigate({ scope: { accountId } });
  }

  /** Scoped open: exactly these trades (used right after an import). */
  filterByTradeIds(ids: string[]): void {
    this.navigate({ ids });
  }

  /**
   * Scoped open from a Home/Dashboard breakdown tile: the tile's own predicate
   * (label + test) plus the scope the grid was read in — period, dates, account
   * and account class. So "NQ in This Month" arrives as NQ *and* This Month, and
   * "NQ in All Time" arrives as just NQ.
   */
  scopeFromBreakdown(
    label: string,
    test: (t: Trade) => boolean,
    scope: {
      period?: string;
      customFrom?: string;
      customTo?: string;
      dateBounds?: { start: string; end: string; label: string };
      accountId?: string | null;
      accountType?: string;
    }
  ): void {
    this.navigate({ scope, lens: { label, test } });
  }

  filtered(opts?: { skipAttention?: boolean }): Trade[] {
    let list = this.trades.filter((t) => t && t.date && typeof t.pnl === "number");
    if (this.idFilter.length) {
      const ids = new Set(this.idFilter);
      list = list.filter((t) => ids.has(t.id));
    }
    if (this.lens) list = list.filter((t) => this.lens!.test(t));
    if (this.symbolFilter) list = list.filter((t) => (t.symbol || "").toUpperCase() === this.symbolFilter.toUpperCase());
    if (this.accountFilters.length) {
      const wanted = this.accountFilters
        .map((id) => this.plugin.settings.propAccounts.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a);
      if (!wanted.length) {
        list = [];
      } else {
        list = list.filter((t) => {
          const mapped = this.plugin.mappedAccount(t.account);
          const inList = mapped
            ? wanted.some((a) => a.id === mapped.id)
            : wanted.some((a) => (a.name || "").trim().toLowerCase() === (t.account || "").trim().toLowerCase());
          return this.accountExclude ? !inList : inList;
        });
      }
    } else if (this.groupFilter) {
      const group = this.plugin.settings.accountGroups.find((g) => g.id === this.groupFilter);
      const ids = group ? new Set(group.accountIds) : new Set<string>();
      list = list.filter((t) => {
        const mapped = this.plugin.mappedAccount(t.account);
        return mapped ? ids.has(mapped.id) : false;
      });
    }
    if (this.accountTypeFilter !== "all") {
      const want = this.accountTypeFilter;
      list = list.filter((t) => {
        const at = this.plugin.mappedAccount(t.account)?.type ?? t.accountType;
        // "Live" is the trader's own money, and personal accounts are the same
        // question — the dashboard's Classification filter treats them together.
        if (want === "live") return at === "live" || at === "personal";
        return at === want;
      });
    }
    if (this.directionFilter !== "all") list = list.filter((t) => t.direction === this.directionFilter);
    if (this.resultFilter === "win") list = list.filter((t) => t.pnl > 0);
    else if (this.resultFilter === "loss") list = list.filter((t) => t.pnl < 0);
    else if (this.resultFilter === "be") list = list.filter((t) => t.pnl === 0);
    if (this.mistakeFilters.length) {
      const wanted = this.mistakeFilters.map((m) => m.toLowerCase());
      list = list.filter((t) => {
        const have = (t.mistake || "").toLowerCase();
        return wanted.some((m) => have.includes(m));
      });
    }
    if (this.sessionFilter !== "all") {
      const zone = this.plugin.settings.timeZone;
      list = list.filter((t) => {
        const s = sessionOf(t, zone);
        return this.sessionFilter === "none" ? s === "" : s === this.sessionFilter;
      });
    }
    // Demo accounts count by default — the trader is testing on them. The
    // explicit "Exclude demo accounts" toggle (a global list filter, not an
    // attention filter) drops them from the ledger AND from every count below.
    if (this.excludeDemos) {
      list = list.filter((t) => (this.plugin.mappedAccount(t.account)?.type ?? t.accountType) !== "demo");
    }
    // qualityFilters and reviewFilter are skipped when computing the attention
    // queue — the chips must always show the GLOBAL count regardless of which
    // filter is active, to avoid the circular-dependency bug where clicking a
    // chip changes its own count.
    if (!opts?.skipAttention && this.qualityFilters.length) {
      list = list.filter((t) => this.qualityFilters.some((q) => missingFlag(t, q)));
    }
    if (this.rFilter !== "all") {
      list = list.filter((t) => {
        const r = tradeR(t);
        if (r === null) return false;
        if (this.rFilter === "1plus") return r >= 1;
        if (this.rFilter === "0to1") return r > 0 && r < 1;
        return r <= 0;
      });
    }
    if (!opts?.skipAttention && this.reviewFilter !== "all") {
      list = list.filter((t) => (this.reviewFilter === "complete" ? reviewStatus(t).complete : !reviewStatus(t).complete));
    }
    const range = this.periodRange();
    if (range) list = list.filter((t) => (!range.start || t.date >= range.start) && (!range.end || t.date <= range.end));
    if (this.search) {
      const terms = this.search.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((t) => {
        const hay = [t.symbol, t.setup, t.mistake, t.notes, t.review, t.account, (t.tags || []).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return terms.every((q) => hay.includes(q));
      });
    }
    if (this.setupFilters.length) {
      const wanted = this.setupFilters.map((s) => s.toLowerCase());
      list = list.filter((t) => wanted.includes((t.setup || "").toLowerCase()));
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.entryTime || "").localeCompare(a.entryTime || ""));
  }

  /**
   * The filtered list plus every figure derived from it, computed once and reused
   * until a filter (or the data) changes. Selection and "load more" reuse it.
   */
  private stats(): TradeLogStats {
    const key = [
      this.search,
      this.symbolFilter,
      this.period,
      this.customFrom,
      this.customTo,
      this.directionFilter,
      this.resultFilter,
      this.sessionFilter,
      this.rFilter,
      this.reviewFilter,
      this.groupFilter,
      this.accountFilters.join(","),
      String(this.accountExclude),
      this.mistakeFilters.join(","),
      this.setupFilters.join(","),
      this.qualityFilters.join(","),
      this.idFilter.join(","),
      String(this.plugin.settings.includeCopiesInPortfolioAnalytics === true),
      this.plugin.settings.timeZone,
      this.trades.length,
      this._dataVersion,
    ].join("|");
    if (this._stats && this._stats.key === key) return this._stats.value;

    const list = this.filtered();
    // The list shows every leg (each one is a real trade in its own account), but
    // the totals count one entry per logical trade: a copy must not add a second
    // "trade" or a second win to these numbers.
    const counted = analyticsTrades(list, this.plugin.settings.includeCopiesInPortfolioAnalytics === true).counts;
    // The attention chips must (a) never change number when their own filter is
    // active, and (b) match exactly the rows a click shows. The table folds copy
    // legs into one row per logical trade (tradeRows), so the chips count the
    // same way: one count per logical trade whose legs include a match.
    const attentionList = this.filtered({ skipAttention: true });
    const attentionRows = tradeRows(attentionList);

    const value: TradeLogStats = {
      list,
      counted,
      tradeCount: counted.length,
      pending: attentionRows.filter((r) => r.legs.some((l) => !reviewStatus(l).complete)).length,
      missingSetup: attentionRows.filter((r) => r.legs.some((l) => missingFlag(l, "nosetup"))).length,
      missingPrint: attentionRows.filter((r) => r.legs.some((l) => missingFlag(l, "noprint"))).length,
    };
    this._stats = { key, value };
    return value;
  }

  /**
   * The date window a period means, or null for "all time". Weeks run Monday to
   * Sunday; a month is the calendar month, so the numbers match the calendar the
   * trader already looks at.
   *
   * The window is anchored on **today in the Journal Timezone** and computed on
   * a UTC calendar — never on the host zone's date, so Today/Yesterday/This week
   * read the same on any machine and follow the journal's zone.
   */
  private periodRange(): { start: string; end: string } | null {
    if (this.scopedPeriodBounds) return this.scopedPeriodBounds;
    const [y, m, d] = dateInZone(this.plugin.settings.timeZone).split("-").map(Number);
    if (!y || !m || !d) return null;
    const now = Date.UTC(y, m - 1, d);
    const dayMs = 86400000;
    const ymd = (t: number): string => new Date(t).toISOString().slice(0, 10);
    const weekday = new Date(now).getUTCDay(); // 0 = Sunday
    const monday = now - ((weekday + 6) % 7) * dayMs;
    const monthStart = Date.UTC(y, m - 1, 1);
    const quarterStart = Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1);
    let start: number | null = null;
    let end: number | null = null;
    switch (this.period) {
      case "today":
        start = now;
        end = now;
        break;
      case "yesterday":
        start = now - dayMs;
        end = now - dayMs;
        break;
      case "thisweek":
        start = monday;
        end = now;
        break;
      case "lastweek":
        start = monday - 7 * dayMs;
        end = monday - dayMs;
        break;
      // "1m" is what an earlier build stored for This Month; keep reading it.
      case "thismonth":
      case "1m":
        start = monthStart;
        end = now;
        break;
      case "lastmonth":
        start = Date.UTC(y, m - 2, 1);
        end = Date.UTC(y, m - 1, 0); // day 0 of month m = last day of m-1
        break;
      case "thisquarter":
        start = quarterStart;
        end = now;
        break;
      case "thisyear":
        start = Date.UTC(y, 0, 1);
        end = now;
        break;
      case "custom":
        return { start: this.customFrom, end: this.customTo };
      default:
        return null;
    }
    return { start: start === null ? "" : ymd(start), end: end === null ? "" : ymd(end) };
  }

  render(): void {
    const root = this.contentEl;
    const selectionScope = this.selectionScopeKey();
    if (this._selectionScope && this._selectionScope !== selectionScope) {
      this.selected.clear();
      this._lastPicked = null;
    }
    this._selectionScope = selectionScope;
    this.closeBulkTagMenu();
    root.empty();
    root.addClass("tj-tradelog");
    // If the drawer is not being drawn, its Escape listener must not survive this render.
    if (!this.filtersOpen && this._drawerKeyCleanup) {
      this._drawerKeyCleanup();
      this._drawerKeyCleanup = null;
    }
    const main = renderAppShell(root, this.plugin, "tradelog");
    this.persistFilters();

    const s = this.stats();

    // Nothing in the journal at all — say it the same way Home does.
    if (this.trades.length === 0) {
      renderEmptyBox(main, {
        title: "No trading data available",
        sub: "Import your previous trades to explore your performance now, or record a new trade manually.",
        primaryText: "Import existing trades",
        primaryIcon: "download",
        onPrimary: () => this.plugin.openImport(),
        secondaryText: "Add a trade manually",
        secondaryIcon: "plus",
        onSecondary: () => this.plugin.openAddPanel(),
      });
      return;
    }

    // Title, then the doors. The figures open the page below it. Same header as
    // Accounts: one title, a sentence, and the actions in the same corner.
    const head = main.createDiv({ cls: "tj-acct-header" });
    const title = head.createDiv();
    title.createEl("h1", { cls: "tj-view-h1", text: "Trade Log" });
    title.createEl("p", { cls: "tj-import-info", text: "Every trade you recorded, one row each." });

    const actions = head.createDiv({ cls: "tj-acct-header-actions" });

    const activeCount = this.activeFilters().length;
    const fbtn = actions.createEl("button", {
      cls: "tj-filterbtn" + (this.filtersOpen || activeCount > 0 ? " is-active" : ""),
      attr: { type: "button" },
    });
    fbtn.createSpan({ cls: "tj-sr-only", text: "Filters" });
    attachTip(fbtn, { title: "Filters", sub: "Date, account, strategies, results and review state." });
    setIcon(fbtn, "sliders-horizontal");
    fbtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.filtersOpen = !this.filtersOpen;
      if (this.filtersOpen) this.columnsOpen = false;
      this.render();
    });

    const selBtn = actions.createEl("button", {
      cls: "tj-iconbtn" + (this.selectMode ? " is-active" : ""),
      attr: { type: "button" },
    });
    selBtn.createSpan({
      cls: "tj-sr-only",
      text: this.selectMode ? "Exit selection" : "Select trades",
    });
    attachTip(selBtn, {
      title: this.selectMode ? "Exit selection" : "Select trades",
      sub: this.selectMode ? undefined : "Then tag or edit several at once. Shift-click selects a range.",
    });
    setIcon(selBtn, "square-check-big");
    if (!selBtn.querySelector("svg")) selBtn.setText("\u2611");
    selBtn.addEventListener("click", () => {
      this.selectMode = !this.selectMode;
      if (!this.selectMode) this.selected.clear();
      this.render();
    });

    // Columns earns its own door: choosing what the ledger shows is not filtering,
    // and tucked at the bottom of the filters panel nobody found it.
    const colBtn = actions.createEl("button", {
      cls: "tj-filterbtn" + (this.columnsOpen ? " is-active" : ""),
      attr: { type: "button" },
    });
    colBtn.createSpan({ cls: "tj-sr-only", text: "Columns" });
    attachTip(colBtn, { title: "Columns", sub: "What the ledger shows. The order is shared with each account's table." });
    setIcon(colBtn, "columns-3");
    colBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.columnsOpen = !this.columnsOpen;
      if (this.columnsOpen) this.filtersOpen = false;
      this.render();
    });

    if (activeCount > 0) fbtn.createSpan({ cls: "tj-filterbtn-count", text: String(activeCount) });
    if (this.columnsOpen) this.renderColumnsPopover(head);

    // The attention queue — the gaps that usually cause it.
    this.renderAttention(main, s);

    // Second line: the shared time bar on the left, the search in the middle,
    // the filters in force on the right.
    const sub = main.createDiv({ cls: "tj-tl-sub" });
    this.renderPeriodBar(sub);

    const searchBox = sub.createDiv({ cls: "tj-tl-search" });
    setIcon(searchBox.createSpan({ cls: "tj-tl-search-ico" }), "search");
    const searchInput = searchBox.createEl("input", { attr: { type: "search", placeholder: "Search symbol, strategy, account\u2026" } });
    searchInput.value = this.search;
    // Typing only re-renders once the keystrokes settle: re-reading and rebuilding
    // the whole page on every character is what made a long journal feel stuck.
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value.trim();
      this._restoreFocus = true;
      window.clearTimeout(this._searchTimer);
      this._searchTimer = window.setTimeout(() => this.render(), 160);
    });

    if (activeCount > 0) {
      const chips = sub.createDiv({ cls: "tj-tl-active" });
      for (const f of this.activeFilters()) {
        const c = chips.createSpan({ cls: "tj-tl-activechip" });
        c.createSpan({ text: f.label });
        const x = c.createSpan({ cls: "tj-tl-activechip-x", text: "\u2715" });
        x.addEventListener("click", () => {
          f.clear();
          this.render();
        });
      }
      chips
        .createEl("button", { cls: "tj-tl-activeclear", text: "Clear all", attr: { type: "button" } })
        .addEventListener("click", () => {
          this.clearFilters();
          this.render();
        });
    }

    // The ledger and, when opened, the filters drawer as an overlay on top.
    const shell = main.createDiv({ cls: "tj-tl-shell" });
    const col = shell.createDiv({ cls: "tj-tl-col" });
    this._bulkHost = col.createDiv({ cls: "tj-tl-bulkhost" });
    if (this.selectMode) this.renderBulkBar(this._bulkHost);
    this._ledgerHost = col.createDiv();
    if (this.filtersOpen) this.renderFiltersDrawer(shell);

    this.renderLedger();

    // Put the search cursor back where the reader left it.
    if (this._restoreFocus) {
      this._restoreFocus = false;
      const el = this.contentEl.querySelector('input[type="search"]') as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }

    // Put the reader back on the row they left from. The element only exists when
    // that trade is still inside the visible window, so this never fights a filter.
    if (this.anchor) {
      const el = this.contentEl.querySelector(`[data-trade="${CSS.escape(this.anchor)}"]`);
      if (el) (el as HTMLElement).scrollIntoView({ block: "center" });
    }
  }

  /**
   * The ledger body only: the card, the rows and "load more". Rebuilt on its own
   * when the list changes, so the figures and the chrome above it are not redrawn.
   */
  private renderLedger(): void {
    const host = this._ledgerHost;
    if (!host) return;
    host.empty();
    const s = this.stats();
    const rows = s.list.slice(0, this.limit);
    this._renderedIds = rows.map((t) => t.id || "").filter(Boolean);

    const card = host.createDiv({ cls: "tj-panel" });
    renderTradeTable(card, {
      plugin: this.plugin,
      trades: rows,
      order: this.visibleOrder(),
      rail: true,
      groupByDay: true,
      showDayHeaders: false,
      compactDate: true,
      selectMode: this.selectMode,
      selected: this.selected,
      onToggleSelect: (t, shift) => {
        if (t.id) this.toggleSelect(t.id, shift === true);
      },
      sort: this.sort,
      onSort: (next) => {
        this.sort = next;
        this.savePrefs();
        this.render();
      },
      onRowClick: (t) => {
        // Remember the row, so coming back from the trade lands on it again.
        this.anchor = t.id || "";
        void this.plugin.openTradeDetail({
          id: t.id || "",
          from: {
            type: "tradelog",
            tradeIds: orderedTradeRows(s.list, this.sort, this.plugin, true)
              .map((row) => row.rep)
              .map((trade) => trade.id)
              .filter(Boolean),
          },
        });
      },
      onReorder: (next) => {
        // next = visible columns in new order. Rebuild the full shared order
        // with hidden columns at their last known positions.
        const full = resolveOrder(this.plugin.settings.tradeLogColOrder, ALL_COLUMN_IDS);
        const hidden = full.filter((id) => !next.includes(id));
        this.plugin.settings.tradeLogColOrder = [...next, ...hidden];
        this.colOrder = next.slice();
        this.savePrefs();
        this.render();
      },
    });

    if (s.list.length === 0) card.createDiv({ cls: "tj-empty", text: "No trades match these filters." });

    if (s.list.length > this.limit) {
      const left = s.list.length - rows.length;
      const more = host.createDiv({ cls: "tj-tl-more" });
      more
        .createEl("button", {
          cls: "tj-actionbtn",
          text: `Load 50 more · ${left} record${left === 1 ? "" : "s"} left`,
          attr: { type: "button" },
        })
        .addEventListener("click", () => {
          // The page scrolls in .tj-app-main, not in the ledger: only the ledger is
          // rebuilt, so the reader's place is restored in the same frame.
          const scroller = this.contentEl.querySelector(".tj-app-main") as HTMLElement | null;
          this.savedScrollY = scroller?.scrollTop ?? 0;
          this.limit += 50;
          this.renderLedger();
          const y = this.savedScrollY;
          this.savedScrollY = 0;
          requestAnimationFrame(() => {
            const sc = this.contentEl.querySelector(".tj-app-main") as HTMLElement | null;
            if (sc && y) sc.scrollTop = y;
          });
        });
    }
  }

  /**
   * The attention row: the review queue and the two gaps that usually cause it.
   * Each chip is a filter — closing the gap is one click away, and nothing is
   * imposed (a missing field is reported, never blocked).
   */
  private renderAttention(main: HTMLElement, s: TradeLogStats): void {
    const row = main.createDiv({ cls: "tj-attention" });
    let any = false;
    const label = row.createSpan({ cls: "tj-attn-label", text: "Needs attention" });
    const chip = (count: number, meaning: string, active: boolean, tip: string, onClick: () => void) => {
      any = true;
      const b = row.createEl("button", {
        cls: "tj-attn-shortcut" + (active ? " is-on" : ""),
        attr: { type: "button" },
      });
      b.setAttr("aria-pressed", String(active));
      b.createSpan({ cls: "tj-attn-count", text: String(count) });
      b.createSpan({ cls: "tj-attn-copy", text: meaning });
      attachTip(b, { title: `${count} ${meaning}`, sub: tip });
      b.addEventListener("click", () => {
        onClick();
        this.render();
      });
    };
    if (s.pending > 0) {
      chip(
        s.pending,
        "to review",
        this.reviewFilter === "pending",
        "Missing screenshot, strategy, review or rating. Click to show only those.",
        () => (this.reviewFilter = this.reviewFilter === "pending" ? "all" : "pending")
      );
    }
    if (s.missingSetup > 0) {
      chip(
        s.missingSetup,
        "missing strategy",
        this.qualityFilters.includes("nosetup"),
        "Trades you have not filed under a strategy yet. Click to show only those.",
        () => this.toggleQuality("nosetup")
      );
    }
    if (s.missingPrint > 0) {
      chip(
        s.missingPrint,
        "missing screenshot",
        this.qualityFilters.includes("noprint"),
        "Trades with no chart attached yet. Click to show only those.",
        () => this.toggleQuality("noprint")
      );
    }
    if (!any) {
      row.addClass("is-clear");
      row.createSpan({ cls: "tj-attn-none", text: "Nothing waiting \u2014 every trade is reviewed and filed." });
    }
  }

  /** Add or remove one "missing" quality flag. */
  private toggleQuality(flag: string): void {
    this.qualityFilters = this.qualityFilters.includes(flag)
      ? this.qualityFilters.filter((q) => q !== flag)
      : [...this.qualityFilters, flag];
  }

  /**
   * Update the selection without redrawing the table: the checkbox already flipped
   * itself. Only the toolbar and the range of rows shift-click touched are repainted.
   */
  private toggleSelect(id: string, shift = false): void {
    if (shift && this._lastPicked && this._lastPicked !== id) {
      const a = this._renderedIds.indexOf(this._lastPicked);
      const b = this._renderedIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        for (let i = from; i <= to; i++) this.selected.add(this._renderedIds[i]);
      }
    } else if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this._lastPicked = id;
    this.syncSelection();
  }

  private syncSelection(): void {
    if (this._bulkHost) {
      this._bulkHost.empty();
      this.closeBulkTagMenu();
      if (this.selectMode) this.renderBulkBar(this._bulkHost);
    }
    for (const id of this._renderedIds) {
      const row = this.contentEl.querySelector(`[data-trade="${CSS.escape(id)}"]`);
      const box = row?.querySelector<HTMLInputElement>("input.tj-tbl-check");
      if (box) box.checked = this.selected.has(id);
    }
  }

  /**
   * The floating bulk bar. It appears only when selection is on, and it carries
   * exactly what a batch needs: file it, rate it, move it, close it — then the
   * rest behind "More". Every action says how many trades it touched.
   */
  private renderBulkBar(host: HTMLElement): void {
    const bar = host.createDiv({ cls: "tj-tl-bulk" });
    const eligible = this.eligibleSelectedIds();
    const empty = eligible.size === 0;
    bar.createSpan({
      cls: "tj-tl-bulk-count",
      text: eligible.size > 0 ? `${eligible.size} selected` : "None selected",
    });

    const act = (parent: HTMLElement, label: string, cls: string, fn: () => void, disabled = false) => {
      const b = parent.createEl("button", { cls: "tj-tl-bulkbtn " + cls, text: label, attr: { type: "button" } });
      if (disabled) {
        b.setAttr("disabled", "true");
        b.addClass("is-disabled");
      } else {
        b.addEventListener("click", fn);
      }
    };
    const selectionGroup = bar.createDiv({ cls: "tj-tl-bulkgroup" });
    act(selectionGroup, "Select all", "tj-ghost", () => {
      for (const t of this.filtered()) if (t.id) this.selected.add(t.id);
      this.syncSelection();
    });
    act(selectionGroup, "Clear", "tj-ghost", () => {
      this.selected.clear();
      this.syncSelection();
    });

    // Strategy and rating are choices from a known set: a picker, never
    // a free-text prompt, so a bulk edit can never invent a wrong value.
    const setupSet = new Map<string, string>();
    for (const s of this.plugin.settings.strategies || []) {
      const n = (s.name || "").trim();
      if (n) setupSet.set(n.toLowerCase(), n);
    }
    for (const t of this.trades) {
      const n = (t.setup || "").trim();
      if (n) setupSet.set(n.toLowerCase(), n);
    }
    const setupItems: DropdownItem[] = [...setupSet.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((n) => ({ id: n, label: n }));
    setupItems.push({ id: "__none__", label: "No strategy", note: "Clear the strategy on the selected trades" });
    setupItems.push({ id: "__new__", label: "＋ New strategy…", note: "Saved to Strategies" });
    const editGroup = bar.createDiv({ cls: "tj-tl-bulkgroup is-separated" });
    const setupHost = editGroup.createSpan({ cls: "tj-tl-bulkpick" });
    mountDropdown(
      setupHost,
      setupItems,
      "",
      async (id) => {
        if (id === "__new__") {
          this.inlineInput(bar, "New strategy name", async (name) => {
            const clean = await this.plugin.addStrategy(name);
            if (clean) await this.bulkField({ setup: clean });
          });
          return;
        }
        if (id === "__none__") {
          await this.bulkField({ setup: "" });
          return;
        }
        await this.bulkField({ setup: id });
      },
      { placeholder: "Strategy…", title: "File the selected trades under a strategy", align: "left" }
    );
    if (empty) setupHost.addClass("is-disabled");

    const rateHost = editGroup.createSpan({ cls: "tj-tl-bulkpick" });
    mountDropdown(
      rateHost,
      [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: "★".repeat(n), note: `Set rating to ${n}` })),
      "",
      (id) => void this.bulkField({ rating: Number(id) }),
      { placeholder: "Rating…", title: "Rate the selected trades", align: "left" }
    );
    if (empty) rateHost.addClass("is-disabled");

    const tagPicker = (
      parent: HTMLElement,
      key: "psychology_tags" | "mistake_tags",
      placeholder: string,
      defaults: string[],
    ) => {
      const seen = new Set(defaults.map((label) => label.toLowerCase()));
      const extras: string[] = [];
      for (const trade of this.trades) {
        for (const label of trade[key] ?? []) {
          const clean = (label || "").trim();
          if (clean && !seen.has(clean.toLowerCase())) {
            seen.add(clean.toLowerCase());
            extras.push(clean);
          }
        }
      }
      const picker = parent.createSpan({ cls: "tj-tl-bulkpick" });
      this.renderBulkTagPicker(picker, key, placeholder, [...defaults, ...extras.sort((a, b) => a.localeCompare(b))]);
      if (empty) picker.addClass("is-disabled");
    };

    tagPicker(editGroup, "psychology_tags", "Psychology…", DEFAULT_PSYCHOLOGY_TAGS);
    tagPicker(editGroup, "mistake_tags", "Execution…", DEFAULT_MISTAKE_TAGS);

    const actionsGroup = bar.createDiv({ cls: "tj-tl-bulkgroup is-separated" });
    act(actionsGroup, "Mark reviewed", "", () => void this.bulkField({ reviewed: true }), empty);
    act(actionsGroup, "Duplicate", "", () => void this.bulkDuplicate(), empty);
    const destructiveGroup = bar.createDiv({ cls: "tj-tl-bulkgroup is-separated is-destructive" });
    act(destructiveGroup, "Delete", "tj-del", () => this.confirmBulkDelete(), empty);
  }

  /** Render a staged multi-select tag menu. Opening it never changes a trade. */
  private renderBulkTagPicker(
    host: HTMLElement,
    key: "psychology_tags" | "mistake_tags",
    placeholder: string,
    options: string[],
  ): void {
    const trigger = host.createEl("button", {
      cls: "tj-mg-dd-btn tj-tl-bulk-tag-trigger",
      attr: { type: "button", "aria-expanded": "false" },
    });
    trigger.createSpan({ cls: "tj-mg-dd-val is-placeholder", text: placeholder });
    trigger.createSpan({ cls: "tj-mg-dd-chev", text: "▾" });
    attachTip(trigger, { title: placeholder.replace(/…$/, ""), sub: "Choose tags, then explicitly add or remove them on the selected trades." });
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this._bulkTagCleanup) this.closeBulkTagMenu();
      else this.openBulkTagMenu(trigger, key, placeholder, options);
    });
  }

  private closeBulkTagMenu(): void {
    this._bulkTagCleanup?.();
    this._bulkTagCleanup = null;
  }

  private openBulkTagMenu(
    trigger: HTMLElement,
    key: "psychology_tags" | "mistake_tags",
    title: string,
    options: string[],
  ): void {
    this.closeBulkTagMenu();
    const doc = trigger.ownerDocument;
    const win = doc.defaultView ?? window;
    const menu = doc.body.createDiv({ cls: "tj-mg-dd-list is-portal tj-tl-bulk-tags" });
    const header = menu.createDiv({ cls: "tj-tl-bulk-tags-head" });
    header.createSpan({ cls: "tj-tl-bulk-tags-title", text: key === "psychology_tags" ? "Psychology state" : "Execution mistakes" });
    const count = header.createSpan({ cls: "tj-tl-bulk-tags-count", text: "0 selected" });
    menu.createDiv({ cls: "tj-tl-bulk-tags-note", text: "Other tags on these trades will be kept." });

    const picked = new Set<string>();
    const list = menu.createDiv({ cls: "tj-tl-bulk-tags-list" });
    const paintCount = () => {
      count.setText(`${picked.size} selected`);
      add.disabled = picked.size === 0 || this.eligibleSelectedIds().size === 0;
      remove.disabled = picked.size === 0 || this.eligibleSelectedIds().size === 0;
      add.toggleClass("is-disabled", add.disabled);
      remove.toggleClass("is-disabled", remove.disabled);
    };
    for (const tag of options) {
      const row = list.createEl("label", { cls: "tj-tl-bulk-tag-option" });
      const checkbox = row.createEl("input", { type: "checkbox", attr: { "aria-label": tag } });
      row.createSpan({ cls: "tj-tl-bulk-tag-label", text: tag });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) picked.add(tag);
        else picked.delete(tag);
        paintCount();
      });
    }
    const actions = menu.createDiv({ cls: "tj-tl-bulk-tags-actions" });
    const add = actions.createEl("button", { cls: "tj-tl-bulk-tags-apply", text: "Add selected", attr: { type: "button" } });
    const remove = actions.createEl("button", { cls: "tj-tl-bulk-tags-remove", text: "Remove selected", attr: { type: "button" } });
    paintCount();
    add.addEventListener("click", () => {
      const values = [...picked];
      if (!values.length || !this.eligibleSelectedIds().size) return;
      this.closeBulkTagMenu();
      void this.bulkChangeTags(key, values, "add");
    });
    remove.addEventListener("click", () => {
      const values = [...picked];
      if (!values.length || !this.eligibleSelectedIds().size) return;
      this.closeBulkTagMenu();
      void this.bulkChangeTags(key, values, "remove");
    });

    const place = () => {
      if (!trigger.isConnected) {
        this.closeBulkTagMenu();
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(300, win.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, win.innerWidth - width - 8));
      const height = menu.offsetHeight || 300;
      const top = rect.bottom + height + 8 <= win.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    };
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (menu.contains(target) || trigger.contains(target))) return;
      this.closeBulkTagMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeBulkTagMenu();
        trigger.focus();
      }
    };
    menu.addEventListener("mousedown", (event) => event.stopPropagation());
    menu.addEventListener("click", (event) => event.stopPropagation());
    doc.body.appendChild(menu);
    trigger.setAttr("aria-expanded", "true");
    doc.addEventListener("mousedown", onOutside, true);
    doc.addEventListener("keydown", onKey, true);
    win.addEventListener("resize", place);
    win.addEventListener("scroll", place, true);
    place();
    this._bulkTagCleanup = () => {
      doc.removeEventListener("mousedown", onOutside, true);
      doc.removeEventListener("keydown", onKey, true);
      win.removeEventListener("resize", place);
      win.removeEventListener("scroll", place, true);
      trigger.setAttr("aria-expanded", "false");
      menu.remove();
    };
  }

  /** Add or intentionally remove chosen review tags on selected trades only. */
  private async bulkChangeTags(
    key: "psychology_tags" | "mistake_tags",
    labels: string[],
    action: "add" | "remove",
  ): Promise<void> {
    let n = 0;
    const eligible = this.eligibleSelectedIds();
    const wanted = new Set(labels.map((label) => label.toLowerCase()));
    for (const id of eligible) {
      const trade = this.trades.find((item) => item.id === id);
      const file = this.app.vault.getAbstractFileByPath(id);
      if (!trade || !(file instanceof TFile)) continue;
      const current = normalizeTags(trade[key] ?? []);
      const next = action === "add"
        ? normalizeTags([...current, ...labels])
        : current.filter((item) => !wanted.has(item.toLowerCase()));
      if (next.length === current.length && next.every((item, index) => item === current[index])) continue;
      try {
        if (key === "mistake_tags") {
          await setTradeMistakeTags(this.app, file, next);
          if (action === "add" && trade.mistakesAcknowledged) await updateTradeFields(this.app, file, { mistakes_acknowledged: false });
        } else {
          await updateTradeArrayFields(this.app, file, { psychology_tags: next });
          if (action === "add" && trade.psychologyAcknowledged) await updateTradeFields(this.app, file, { psychology_acknowledged: false });
        }
        n++;
      } catch (err) {
        console.error("[tradebook] bulk tag update failed", err);
      }
    }
    new Notice(`${n} trade(s) updated.`);
    this.selected.clear();
    await this.refresh();
  }

  /** A one-line input in the bulk bar — never a browser prompt. */
  private inlineInput(bar: HTMLElement, placeholder: string, commit: (value: string) => void): void {
    bar.querySelector(".tj-tl-bulkinline")?.remove();
    const row = bar.createDiv({ cls: "tj-tl-bulkinline" });
    const input = row.createEl("input", { cls: "tj-tl-bulkinput", attr: { type: "text", placeholder } });
    const go = row.createEl("button", { cls: "tj-tl-bulkbtn", text: "Add", attr: { type: "button" } });
    const fire = () => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        return;
      }
      row.remove();
      commit(v);
    };
    go.addEventListener("click", fire);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        fire();
      } else if (e.key === "Escape") {
        row.remove();
      }
    });
    if (this._focusTimer) window.clearTimeout(this._focusTimer);
    this._focusTimer = window.setTimeout(() => input.focus(), 0);
  }

  private async bulkDuplicate(): Promise<void> {
    let n = 0;
    const eligible = this.eligibleSelectedIds();
    for (const id of eligible) {
      const file = this.app.vault.getAbstractFileByPath(id);
      if (file instanceof TFile) {
        try {
          const content = await this.app.vault.read(file);
          const dot = file.path.lastIndexOf(".");
          const newPath = `${file.path.slice(0, dot)}-copy${Date.now().toString().slice(-4)}${file.path.slice(dot)}`;
          await this.app.vault.create(newPath, content);
          n++;
        } catch (err) {
          console.error("[tradebook] duplicate failed", err);
        }
      }
    }
    new Notice(`${n} trade(s) duplicated.`);
    this.selected.clear();
    await this.refresh();
  }

  private async bulkField(fields: Record<string, string | number | boolean>): Promise<void> {
    let n = 0;
    const eligible = this.eligibleSelectedIds();
    for (const id of eligible) {
      const file = this.app.vault.getAbstractFileByPath(id);
      if (file instanceof TFile) {
        try {
          await updateTradeFields(this.app, file, fields);
          n++;
        } catch (err) {
          console.error("[tradebook] bulk update failed", err);
        }
      }
    }
    new Notice(`${n} trade(s) updated.`);
    this.selected.clear();
    await this.refresh();
  }

  /**
   * Tags are additive by nature — a trade is both "TMM" and "reversal". Writing
   * the union keeps the existing tags instead of replacing them.
   */
  /** Delete asks in our own dialog — a browser confirm is not our surface. */
  private confirmBulkDelete(): void {
    const count = this.eligibleSelectedIds().size;
    if (!count) return;
    new ConfirmModal(this.app, {
      title: "Delete these trades?",
      body: `${count} note${count === 1 ? "" : "s"} will be removed from the vault. Obsidian moves them to its trash when "Files & Links → Deleted files" is set to trash; otherwise the delete is permanent.`,
      cta: "Delete",
      onConfirm: () => void this.bulkDelete(),
    }).open();
  }

  private async bulkDelete(): Promise<void> {
    let n = 0;
    const eligible = this.eligibleSelectedIds();
    for (const id of eligible) {
      const file = this.app.vault.getAbstractFileByPath(id);
      if (file instanceof TFile) {
        try {
          await this.app.vault.delete(file);
          n++;
        } catch (err) {
          console.error("[tradebook] delete failed", err);
        }
      }
    }
    new Notice(`${n} trade(s) deleted.`);
    this.selected.clear();
    await this.refresh();
  }

  /** Filters currently narrowing the list (for the chips + count badge). */
  private activeFilters(): { label: string; clear: () => void }[] {
    const out: { label: string; clear: () => void }[] = [];
    if (this.symbolFilter) out.push({ label: `Ticker: ${this.symbolFilter}`, clear: () => (this.symbolFilter = "") });
    if (this.setupFilters.length) {
      out.push({ label: `Strategy: ${this.setupFilters.join(", ")}`, clear: () => (this.setupFilters = []) });
    }
    if (this.directionFilter !== "all") out.push({ label: `Direction: ${this.directionFilter}`, clear: () => (this.directionFilter = "all") });
    if (this.resultFilter !== "all") {
      const word = this.resultFilter === "be" ? "Break-even" : this.resultFilter;
      out.push({ label: `Result: ${word}`, clear: () => (this.resultFilter = "all") });
    }
    if (this.mistakeFilters.length) {
      out.push({ label: `Mistake: ${this.mistakeFilters.join(", ")}`, clear: () => (this.mistakeFilters = []) });
    }
    if (this.sessionFilter !== "all") {
      const sessionNames: Record<string, string> = { newyork: "New York", london: "London", asia: "Asia", off: "Off Hours", none: "no time", rth: "New York", overnight: "Off Hours" };
      out.push({ label: `Session: ${sessionNames[this.sessionFilter] ?? this.sessionFilter}`, clear: () => (this.sessionFilter = "all") });
    }
    if (this.lens) {
      out.push({ label: this.lens.label, clear: () => (this.lens = null) });
    }
    if (this.accountTypeFilter !== "all") {
      const typeName = accountFilters().find((x) => x.id === this.accountTypeFilter)?.label ?? this.accountTypeFilter;
      out.push({ label: `Account type: ${typeName}`, clear: () => (this.accountTypeFilter = "all") });
    }
    if (this.qualityFilters.length) {
      const words: Record<string, string> = { noprint: "no print", nosetup: "no strategy", nostop: "no stop", norating: "no rating" };
      const picked = this.qualityFilters.map((q) => words[q] ?? q);
      out.push({ label: `Missing: ${picked.join(" or ")}`, clear: () => (this.qualityFilters = []) });
    }
    if (this.accountFilters.length) {
      const names = this.accountFilters.map((id) =>
        id === NO_ACCOUNT ? "None" : this.plugin.settings.propAccounts.find((a) => a.id === id)?.name || "Unknown account"
      );
      const word = this.accountExclude ? "Account excluded" : "Account";
      out.push({
        label: `${word}: ${names.join(", ")}`,
        clear: () => {
          this.accountFilters = [];
          this.accountExclude = false;
        },
      });
    }
    if (this.groupFilter) {
      const group = this.plugin.settings.accountGroups.find((g) => g.id === this.groupFilter);
      out.push({ label: `Group: ${group?.name || "Unknown group"}`, clear: () => (this.groupFilter = "") });
    }
    if (this.excludeDemos) {
      out.push({ label: "Demo accounts excluded", clear: () => (this.excludeDemos = false) });
    }
    if (this.idFilter.length) {
      // A scoped open (the trades an import just wrote) must be visible and
      // removable here, or the ledger looks broken with no way back.
      out.push({
        label: `Selected: ${this.idFilter.length} trade${this.idFilter.length === 1 ? "" : "s"}`,
        clear: () => {
          this.idFilter = [];
          this.limit = 50;
        },
      });
    }
    if (this.rFilter !== "all") {
      const words: Record<string, string> = { "1plus": "≥ 1R", "0to1": "0 to 1R", neg: "at or below 0R" };
      out.push({ label: `R: ${words[this.rFilter]}`, clear: () => (this.rFilter = "all") });
    }
    if (this.period !== "all") {
      out.push({
        label: `Period: ${this.scopedPeriodLabel || periodLabel(this.period)}`,
        clear: () => {
          this.period = "all";
          this.scopedPeriodLabel = "";
          this.scopedPeriodBounds = null;
        },
      });
    }
    return out;
  }

  private clearFilters(): void {
    this.symbolFilter = "";
    this.accountFilters = [];
    this.accountExclude = false;
    this.groupFilter = "";
    this.idFilter = [];
    this.accQuery = "";
    this.directionFilter = "all";
    this.resultFilter = "all";
    this.mistakeFilters = [];
    this.reviewFilter = "all";
    this.sessionFilter = "all";
    this.accountTypeFilter = "all";
    this.lens = null;
    this.qualityFilters = [];
    this.rFilter = "all";
    this.period = "all";
    this.customFrom = "";
    this.customTo = "";
    this.scopedPeriodLabel = "";
    this.scopedPeriodBounds = null;
    this.search = "";
    this.setupFilters = [];
    this.excludeDemos = false;
    this.limit = 50;
  }

  /** A selection survives visual renders, sorting and pagination, not a new population. */
  private selectionScopeKey(): string {
    return tradeSelectionScopeKey({
      symbol: this.symbolFilter,
      accounts: this.accountFilters,
      accountExclude: this.accountExclude,
      group: this.groupFilter,
      ids: this.idFilter,
      direction: this.directionFilter,
      result: this.resultFilter,
      mistakes: this.mistakeFilters,
      review: this.reviewFilter,
      session: this.sessionFilter,
      accountType: this.accountTypeFilter,
      lens: this.lens?.label ?? "",
      quality: this.qualityFilters,
      r: this.rFilter,
      period: this.period,
      customFrom: this.customFrom,
      customTo: this.customTo,
      search: this.search,
      setups: this.setupFilters,
      excludeDemos: this.excludeDemos,
    });
  }

  /** Resolve selected rows against the full current filtered population. */
  private eligibleSelectedIds(): Set<string> {
    return eligibleTradeIds(this.filtered(), this.selected);
  }

  renderPeriodBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "tj-periodbar tj-tl-periodbar" });
    for (const [id, label] of PERIODS) {
      const b = bar.createEl("button", {
        cls: "tj-pbtn" + (this.period === id ? " active" : ""),
        text: label,
        attr: { type: "button" },
      });
      b.addEventListener("click", () => {
        this.period = id;
        this.scopedPeriodLabel = "";
        this.scopedPeriodBounds = null;
        this.render();
      });
    }
    if (this.period === "custom") {
      const box = bar.createDiv({ cls: "tj-period-custom" });
      mountDateField(box, {
        value: this.customFrom,
        format: this.plugin.settings.dateFormat,
        className: "tj-input",
        zone: this.plugin.settings.timeZone,
        onChange: (v) => {
          this.customFrom = v;
          this.scopedPeriodLabel = "";
          this.scopedPeriodBounds = null;
          this.render();
        },
      });
      box.createSpan({ cls: "tj-pop-label", text: "→" });
      mountDateField(box, {
        value: this.customTo,
        format: this.plugin.settings.dateFormat,
        className: "tj-input",
        zone: this.plugin.settings.timeZone,
        onChange: (v) => {
          this.customTo = v;
          this.scopedPeriodLabel = "";
          this.scopedPeriodBounds = null;
          this.render();
        },
      });
    }
  }

  /** What the ledger shows, in its own small panel. */
  /**
   * Accounts are their own question, and a journal has fifty of them. Scrolling
   * through fifty names is not an answer, so this is a searchable list showing how
   * many trades each account has *in the period you are looking at* — plus the three
   * shortcuts that settle most questions before you type anything.
   */
  private accountPicker(host: HTMLElement): void {
    const range = this.periodRange();
    const counts = new Map<string, number>();
    for (const t of this.trades) {
      if (range && ((range.start && t.date < range.start) || (range.end && t.date > range.end))) continue;
      const id = this.plugin.mappedAccount(t.account)?.id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const field = host.createDiv({ cls: "tj-pop-field tj-pop-field-wide tj-tl-accpick" });
    field.createEl("label", { text: "Accounts", cls: "tj-pop-label" });
    const top = field.createDiv({ cls: "tj-tl-acctop" });
    const info = top.createSpan({ cls: "tj-tl-accinfo" });
    const input = top.createEl("input", { cls: "tj-tl-accsearch", attr: { type: "search", placeholder: "Find an account…" } });
    input.value = this.accQuery;
    const toolsWrap = field.createDiv({ cls: "tj-tl-acctools-wrap" });
    toolsWrap.createDiv({ cls: "tj-tl-acc-section-label", text: "Account-wide actions" });
    const tools = toolsWrap.createDiv({ cls: "tj-tl-acctools" });
    field.createDiv({ cls: "tj-tl-acc-section-label tj-tl-acc-list-label", text: "Individual accounts" });
    const list = field.createDiv({ cls: "tj-tl-acclist" });
    const all = this.plugin.settings.propAccounts;

    const paint = () => {
      const q = this.accQuery.trim().toLowerCase();
      const rows = all
        .map((a) => ({ id: a.id, name: a.name, n: counts.get(a.id) ?? 0 }))
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      const picked = this.accountFilters.filter((id) => id !== NO_ACCOUNT);
      info.setText(
        this.accountFilters.includes(NO_ACCOUNT)
          ? "None selected"
          : picked.length
            ? `${picked.length} of ${all.length} selected`
            : "Every account",
      );
      list.empty();
      if (!rows.length) {
        list.createSpan({ cls: "tj-tl-picknone", text: "No account matches that." });
        return;
      }
      for (const a of rows) {
        const on = picked.includes(a.id);
        const row = list.createEl("button", {
          cls: "tj-tl-accrow" + (on ? " on" : "") + (a.n ? "" : " is-quiet"),
          attr: { type: "button", "aria-pressed": String(on) },
        });
        row.createSpan({ cls: "tj-tl-accbox", text: on ? "\u2713" : "" });
        row.createSpan({ cls: "tj-tl-accname", text: a.name });
        row.createSpan({ cls: "tj-tl-accn", text: a.n ? String(a.n) : "\u2014" });
        attachTip(row, {
          title: a.name,
          sub: a.n ? `${a.n} trade${a.n === 1 ? "" : "s"} in this period` : "No trades in this period",
        });
        row.addEventListener("click", () => {
          const now = this.accountFilters.filter((id) => id !== NO_ACCOUNT);
          this.accountFilters = now.includes(a.id) ? now.filter((x) => x !== a.id) : [...now, a.id];
          this.groupFilter = "";
          this.render();
        });
      }
    };

    const tool = (label: string, hint: string, fn: () => void) => {
      const b = tools.createEl("button", { cls: "tj-tl-accbtn", text: label, attr: { type: "button" } });
      attachTip(b, { title: label, sub: hint });
      b.addEventListener("click", () => {
        fn();
        this.render();
      });
    };
    tool("All", "Every account in the journal.", () => {
      this.accountFilters = [];
      this.groupFilter = "";
    });
    tool("Only with trades here", "The accounts that actually traded in the period you are looking at.", () => {
      this.accountFilters = [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id);
      this.groupFilter = "";
    });
    tool("None", "Show nothing until you pick one.", () => {
      this.accountFilters = [NO_ACCOUNT];
      this.groupFilter = "";
    });

    // Typing only narrows this list, so it does not re-render the ledger: the
    // cursor stays where it is.
    input.addEventListener("input", () => {
      this.accQuery = input.value;
      paint();
    });
    paint();
  }

  private renderColumnsPopover(header: HTMLElement): void {
    const backdrop = header.createDiv({ cls: "tj-pop-backdrop" });
    backdrop.addEventListener("click", () => {
      this.columnsOpen = false;
      this.render();
    });
    const pop = header.createDiv({ cls: "tj-popover tj-tl-pop tj-tl-colpop" });
    pop.addEventListener("click", (e) => e.stopPropagation());
    pop.createDiv({ cls: "tj-pop-section", text: "Columns" });

    /* ── Vertical list with drag handles + checkboxes ── */
    const colList = pop.createDiv({ cls: "tj-tl-collist" });
    let dragId: string | null = null;
    let dragOverId: string | null = null;
    const commitDrag = () => {
      if (!dragId || !dragOverId || dragId === dragOverId) { dragId = dragOverId = null; return; }
      const o = this.colOrder.slice();
      const fi = o.indexOf(dragId), ti = o.indexOf(dragOverId);
      if (fi < 0 || ti < 0) { dragId = dragOverId = null; return; }
      o.splice(fi, 1); o.splice(ti, 0, dragId);
      this.colOrder = o; dragId = dragOverId = null;
      this.syncSharedOrder(); this.savePrefs(); this.render();
    };
    const clearDragHighlights = () => {
      colList.querySelectorAll(".tj-tl-colitem").forEach(el => el.classList.remove("drag-over", "dragging"));
    };

    // Build the merged list: all columns in shared order. Visible ones have
    // drag handles; hidden ones are unchecked and listed at their position.
    const fullOrder = resolveOrder(this.plugin.settings.tradeLogColOrder, ALL_COLUMN_IDS);

    for (const id of fullOrder) {
      const col = TRADE_COLUMNS.find((c) => c.id === id);
      if (!col) continue;
      const visible = this.colOrder.includes(col.id);
      const row = colList.createDiv({ cls: "tj-tl-colitem" + (visible ? "" : " is-hidden") });
      row.dataset.colId = col.id;

      if (visible) {
        const handle = row.createSpan({ cls: "tj-tl-colhandle" });
        handle.createSpan({ cls: "tj-sr-only", text: `Drag to reorder ${col.label || col.id}` });
        setIcon(handle, "grip-vertical");
        handle.addEventListener("mousedown", (e) => {
          e.preventDefault(); e.stopPropagation();
          dragId = col.id;
          row.classList.add("dragging");
          const onMove = (ev: MouseEvent) => {
            clearDragHighlights();
            const el = (ev.target as HTMLElement).closest(".tj-tl-colitem") as HTMLElement | null;
            if (el && el.dataset.colId && el.dataset.colId !== dragId) {
              dragOverId = el.dataset.colId;
              el.classList.add("drag-over");
            }
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            window.removeEventListener("blur", onUp);
            this._dragCleanup = null;
            commitDrag(); clearDragHighlights();
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          // Releasing outside the window never reaches the document — blur is the fallback.
          window.addEventListener("blur", onUp);
          this._dragCleanup = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            window.removeEventListener("blur", onUp);
          };
        });
      }

      const cb = row.createEl("input", { cls: "tj-tl-colcheck", attr: { type: "checkbox" } });
      cb.checked = visible;
      cb.addEventListener("change", () => this.toggleColumn(col.id, cb.checked));

      row.createSpan({ cls: "tj-tl-collabel", text: col.id === "image" ? "Print" : col.label || col.id });
    }

    /* ── Presets ── */
    const presets = pop.createDiv({ cls: "tj-tl-colpresets" });
    const preset = (label: string, ids: string[], hint: string) => {
      const b = presets.createEl("button", { cls: "tj-tl-presetbtn", text: label, attr: { type: "button" } });
      attachTip(b, { title: label, sub: hint });
      b.addEventListener("click", () => {
        this.colOrder = ids.slice();
        this.syncSharedOrder(); this.savePrefs(); this.render();
      });
    };
    preset("Default", DEFAULT_TRADE_LOG_ORDER, "Full journal workflow — time, execution, results, strategy, print.");
    preset("Simple", ["date", "symbol", "side", "qty", "entryexit", "points", "pnl"], "Core execution columns only — what the trade was and what it did.");

    const reset = pop.createEl("button", { cls: "tj-tl-presetbtn is-quiet", text: "Reset to default", attr: { type: "button" } });
    attachTip(reset, { title: "Reset to default", sub: "Back to the layout we ship with, so you never have to remember what you moved." });
    reset.addEventListener("click", () => {
      this.colOrder = DEFAULT_TRADE_LOG_ORDER.slice();
      this.syncSharedOrder(); this.savePrefs(); this.render();
    });

    /* ── Side display toggle ── */
    const sideRow = pop.createDiv({ cls: "tj-tl-colside" });
    sideRow.createSpan({ cls: "tj-tl-colside-lbl", text: "Side" });
    const sideSeg = sideRow.createDiv({ cls: "tj-wz-seg" });
    const curSide = (this.plugin.settings.tradeLog ?? {}).sideDisplay ?? "arrows";
    for (const [id, label] of [["arrows", "▲ ▼"], ["letters", "LONG SHORT"]] as const) {
      const b = sideSeg.createEl("button", {
        cls: "tj-wz-seg-opt" + (curSide === id ? " on" : ""),
        text: label,
        attr: { type: "button" },
      });
      b.addEventListener("click", () => {
        (this.plugin.settings.tradeLog ??= {}).sideDisplay = id;
        void this.plugin.saveSettings(); this.render();
      });
    }

    pop.createDiv({ cls: "tj-tl-colnote", text: "Drag the ⋮⋮ handle to reorder. The order is shared with the ledger inside each account." });
  }

  /**
   * The filters, in a drawer beside the ledger. One door, grouped by the question
   * you are asking, ending in the one number that tells you whether to close it:
   * how many trades are left.
   */
  private renderFiltersDrawer(shell: HTMLElement): void {
    // Backdrop: clicking it closes the drawer, just like the X button.
    const backdrop = shell.createDiv({ cls: "tj-tl-drawer-backdrop" });
    backdrop.addEventListener("click", () => {
      this.filtersOpen = false;
      this.render();
    });
    // Escape key closes the drawer without a full re-render first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.filtersOpen = false;
        this.render();
      }
    };
    document.addEventListener("keydown", onKey);
    // Clean up when the view re-renders or closes.
    this._drawerKeyCleanup?.();
    this._drawerKeyCleanup = () => document.removeEventListener("keydown", onKey);

    const drawer = shell.createEl("aside", { cls: "tj-tl-drawer", attr: { "aria-label": "Trade filters" } });

    const head = drawer.createDiv({ cls: "tj-tl-drawerhead" });
    head.createSpan({ cls: "tj-tl-drawer-title", text: "Filters" });
    const activeCount = this.activeFilters().length;
    head.createSpan({ cls: "tj-tl-drawer-count", text: activeCount ? `${activeCount} active` : "No filters" });
    const close = head.createEl("button", { cls: "tj-tl-drawer-x", attr: { type: "button" } });
    close.createSpan({ cls: "tj-sr-only", text: "Close filters" });
    setIcon(close, "x");
    attachTip(close, { title: "Close filters" });
    close.addEventListener("click", () => {
      this.filtersOpen = false;
      this.render();
    });

    const body = drawer.createDiv({ cls: "tj-tl-drawerbody" });
    // Pill rows, not dropdowns: every value is visible at once and nothing opens
    // over the page. This is the mock the trader approved, kept literally — the
    // row reads like the list it filters.
    const section = (title: string): HTMLElement => {
      const sec = body.createDiv({ cls: "tj-tl-dsec" });
      sec.createDiv({ cls: "tj-tl-dsec-t", text: title });
      return sec;
    };
    const pills = (
      host: HTMLElement,
      options: [string, string][],
      values: string[],
      onPick: (v: string, on: boolean) => void,
      none?: string
    ) => {
      const row = host.createDiv({ cls: "tj-tl-opts" });
      if (!options.length) {
        row.createSpan({ cls: "tj-tl-optnone", text: none ?? "None in this journal yet" });
        return;
      }
      for (const [v, t] of options) {
        const on = values.includes(v);
        const b = row.createEl("button", {
          cls: "tj-tl-opt" + (on ? " on" : ""),
          text: t,
          attr: { type: "button", "aria-pressed": String(on) },
        });
        b.addEventListener("click", () => onPick(v, on));
      }
    };

    const syms: [string, string][] = [["", "All"], ...[...new Set(this.trades.map((t) => t.symbol).filter(Boolean))].sort().map((x) => [x, x] as [string, string])];
    const setups: [string, string][] = [...new Set(this.trades.map((t) => t.setup).filter(Boolean))]
      .sort()
      .map((x) => [x as string, x as string] as [string, string]);
    const mistakes: [string, string][] = [...new Set(this.trades.map((t) => t.mistake).filter(Boolean))]
      .sort()
      .map((x) => [x as string, x as string] as [string, string]);
    const toggleIn = (list: string[], v: string, on: boolean): string[] => (on ? [...list, v] : list.filter((x) => x !== v));

    // "What I traded" — the accounts first (the biggest question), then ticker.
    let g = section("What I traded");
    this.accountPicker(g);
    const mode = g.createDiv({ cls: "tj-tl-mode" });
    mode.createSpan({ cls: "tj-tl-acc-section-label", text: "Selection mode" });
    const seg = mode.createDiv({ cls: "tj-tl-incl" });
    for (const [id, label] of [["include", "Include"], ["exclude", "Exclude"]] as const) {
      const on = (id === "exclude") === this.accountExclude;
      const b = seg.createEl("button", { cls: on ? "on" : "", text: label, attr: { type: "button" } });
      b.addEventListener("click", () => {
        this.accountExclude = id === "exclude";
        this.render();
      });
    }
    pills(g, syms, [this.symbolFilter], (v) => { this.symbolFilter = v; this.render(); });
    const demoRow = g.createDiv({ cls: "tj-tl-opts" });
    const demoBtn = demoRow.createEl("button", {
      cls: "tj-tl-opt" + (this.excludeDemos ? " on" : ""),
      text: "Exclude demo accounts",
      attr: { type: "button", "aria-pressed": String(this.excludeDemos) },
    });
    demoBtn.addEventListener("click", () => {
      this.excludeDemos = !this.excludeDemos;
      this.render();
    });
    pills(
      g,
      accountFilters().map((f) => [f.id, f.label] as [string, string]),
      [this.accountTypeFilter],
      (v) => {
        this.accountTypeFilter = v;
        this.render();
      }
    );

    g = section("How it went");
    pills(g, [["all", "All"], ["win", "Wins"], ["loss", "Losses"], ["be", "Break-even"]], [this.resultFilter], (v) => { this.resultFilter = v; this.render(); });
    pills(g, [["all", "All"], ["long", "Long"], ["short", "Short"]], [this.directionFilter], (v) => { this.directionFilter = v; this.render(); });
    pills(g, [["all", "All"], ["1plus", "≥1R"], ["0to1", "0–1R"], ["neg", "Negative"]], [this.rFilter], (v) => { this.rFilter = v; this.render(); });

    g = section("When");
    pills(g, [["all", "All"], ["rth", "RTH"], ["off", "Overnight"], ["newyork", "New York"], ["london", "London"], ["asia", "Asia"], ["none", "No time"]], [this.sessionFilter], (v) => { this.sessionFilter = v; this.render(); });

    g = section("Was it done properly");
    pills(g, setups, this.setupFilters, (v, on) => { this.setupFilters = toggleIn(this.setupFilters, v, !on); this.render(); }, "No strategy named yet");
    pills(g, mistakes, this.mistakeFilters, (v, on) => { this.mistakeFilters = toggleIn(this.mistakeFilters, v, !on); this.render(); }, "No mistakes logged yet");
    pills(
      g,
      [["noprint", "No screenshot"], ["nosetup", "No strategy"], ["nostop", "No stop"], ["norating", "No rating"]],
      this.qualityFilters,
      (v, on) => { this.qualityFilters = toggleIn(this.qualityFilters, v, !on); this.render(); }
    );

    const foot = drawer.createDiv({ cls: "tj-tl-drawerfoot" });
    const show = foot.createEl("button", { cls: "tj-tl-drawer-show", attr: { type: "button" } });
    const n = this.stats().tradeCount;
    show.setText(n === 1 ? "Show 1 trade" : `Show ${n} trades`);
    show.addEventListener("click", () => {
      this.filtersOpen = false;
      this.render();
    });
    foot
      .createEl("button", { cls: "tj-tl-drawer-clear", text: "Clear all", attr: { type: "button" } })
      .addEventListener("click", () => {
        this.clearFilters();
        this.render();
      });
  }

  async onClose(): Promise<void> {
    // A pending search render or filter save must not fire on a detached view.
    if (this._searchTimer) window.clearTimeout(this._searchTimer);
    if (this._filterTimer) window.clearTimeout(this._filterTimer);
    if (this._focusTimer) window.clearTimeout(this._focusTimer);
    this._drawerKeyCleanup?.();
    this._drawerKeyCleanup = null;
    this.closeBulkTagMenu();
    // A drag in flight holds document listeners; drop them with the view.
    this._dragCleanup?.();
    this._dragCleanup = null;
    // Release the last render's DOM and its data snapshot.
    this._stats = null;
    this._bulkHost = null;
    this._ledgerHost = null;
    this.contentEl.empty();
  }
}

/** A small yes/no dialog in our own surface, for actions that destroy things. */
class ConfirmModal extends Modal {
  constructor(
    app: any,
    private opts: { title: string; body: string; cta: string; onConfirm: () => void }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { cls: "tj-confirm-title", text: this.opts.title });
    contentEl.createEl("p", { cls: "tj-confirm-body", text: this.opts.body });
    const row = contentEl.createDiv({ cls: "tj-confirm-actions" });
    row
      .createEl("button", { cls: "tj-actionbtn", text: "Cancel", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    row
      .createEl("button", { cls: "tj-btn tj-btn-del", text: this.opts.cta, attr: { type: "button" } })
      .addEventListener("click", () => {
        this.close();
        this.opts.onConfirm();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
