import { ItemView, Notice, setIcon, TFile } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { mountDateField } from "../lib/dates";
import { renderAppShell } from "../ui";
import { fmtMoney } from "../tz";
import { reviewStatus, reviewSummary } from "../lib/review";
import { parseTradeFromMarkdown, setTradeAccount, updateTradeFields } from "../storage";
import { attachTip } from "../lib/tip";
import { renderEmptyState as renderEmptyBox } from "../lib/emptyState";
import { analyticsTrades } from "../lib/scope";
import { sessionOf } from "../lib/sessions";
import { mountDropdown } from "../lib/dropdown";
import {
  DEFAULT_TRADE_LOG_ORDER,
  TRADE_COLUMNS,
  holdMinutes,
  renderTradeTable,
  TradeSort,
  resolveOrder,
  tradeR,
} from "../lib/tradeTable";

export const TRADE_LOG_VIEW_TYPE = "tradebook-trade-log-view";

/** Every column the ledger can hold — the shared order is validated against it. */
const ALL_COLUMN_IDS = TRADE_COLUMNS.map((c) => c.id);

/** Where the old per-column switches map onto the ledger columns. */
const LEGACY_KEYS: Record<string, string> = {
  image: "image",
  account: "account",
  setup: "setup",
  review: "reviewed",
  stars: "stars",
  r: "r",
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
  if (kind === "noprint") return !t.screenshot || t.screenshot === "added";
  if (kind === "nosetup") return !(t.setup || "").trim();
  if (kind === "nostop") return !(typeof t.stopLoss === "number" && t.stopLoss > 0);
  return !(typeof t.rating === "number" && t.rating > 0);
}

export class TradeLogView extends ItemView {
  plugin: TradebookPlugin;
  trades: Trade[] = [];
  symbolFilter = "";
  /** Any of these accounts (a journal is read across accounts, not one at a time). */
  accountFilters: string[] = [];
  groupFilter = "";
  directionFilter = "all";
  /** all | win | loss | be — break-even is a state (net exactly zero), not a side. */
  resultFilter = "all";
  mistakeFilters: string[] = [];
  reviewFilter: "all" | "pending" | "complete" = "all";
  /** all | rth | overnight | none */
  sessionFilter = "all";
  /** Which gaps to look for — a trade can be missing more than one thing. */
  qualityFilters: string[] = [];
  /** What the reader typed in the account picker (kept across re-renders). */
  accQuery = "";
  /** all | 1plus | 0to1 | neg — how the trade finished in R, not in dollars. */
  rFilter = "all";
  period = "all";
  customFrom = "";
  customTo = "";
  search = "";
  setupFilters: string[] = [];
  limit = 50;
  /** Which column the list is sorted by, remembered between visits. */
  sort: TradeSort | null = null;
  /** The trade the reader was last on: we come back to it, not to the top. */
  anchor = "";
  savedScrollY = 0;
  savedLedgerY = 0;
  selected = new Set<string>();
  selectMode = false;
  filtersOpen = false;
  columnsOpen = false;
  private _restoreFocus = false;
  /** Which columns this page shows (the order itself is shared, in tradeLogColOrder). */
  colOrder: string[] = DEFAULT_TRADE_LOG_ORDER.slice();

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
        this.groupFilter = f.group ?? this.groupFilter;
        this.directionFilter = f.direction ?? this.directionFilter;
        this.resultFilter = f.result ?? this.resultFilter;
        this.mistakeFilters = f.mistakes ?? (f.mistake ? [f.mistake] : this.mistakeFilters);
        this.reviewFilter = (f.review as any) ?? this.reviewFilter;
        this.sessionFilter = f.session ?? this.sessionFilter;
        // Missing used to be a single choice; read that once and carry on with the list.
        this.qualityFilters = Array.isArray(f.quality)
          ? f.quality
          : typeof f.quality === "string" && f.quality !== "all"
            ? [f.quality]
            : this.qualityFilters;
        this.customFrom = f.customFrom ?? this.customFrom;
        this.customTo = f.customTo ?? this.customTo;
        this.search = f.search ?? this.search;
        this.setupFilters = f.setups ?? (f.setup ? [f.setup] : this.setupFilters);
        // `limit` is deliberately NOT restored: a list that grew to 150 last
        // week should not open with 150 trades. It starts at 50 again.
      }
    }
    if (this.period === "all") {
      const legacy = this.plugin.settings.tradeLogPeriod;
      this.period = legacy === "1m" ? "thismonth" : legacy || "all";
    }
    await this.refresh();
  }

  /** Persist the Trade Log view preferences (columns + active filters). */
  /**
   * Tick a row as reviewed (or put it back in the queue). Writes the note, then
   * re-reads: the count in the header has to follow, or the queue never looks any
   * shorter than when you started.
   */
  private async markReviewed(t: Trade, next: boolean): Promise<void> {
    const file = t.id ? this.app.vault.getAbstractFileByPath(t.id) : null;
    if (!(file instanceof TFile)) {
      new Notice("This row is a copy held in memory — open the original trade to review it.");
      return;
    }
    await updateTradeFields(this.app, file, { reviewed: next });
    await this.refresh();
  }

  private savePrefs(): void {
    const cur = { ...(this.plugin.settings.tradeLog || {}) };
    // The pre-ledger journal kept a per-column boolean map; it is migrated into
    // colOrder on first load and then dropped, so no dead settings survive.
    delete (cur as Record<string, unknown>).cols;
    delete (cur as Record<string, unknown>).twoCol;
    // The sort travels with the columns: both are "how this page reads", not data.
    this.plugin.settings.tradeLog = { ...cur, colOrder: this.colOrder.slice(), sort: this.sort ?? undefined };
    void this.plugin.saveSettings();
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
    const shared = resolveOrder(this.plugin.settings.tradeLogColOrder, ALL_COLUMN_IDS);
    this.colOrder = on ? shared.filter((x) => x === id || this.colOrder.includes(x)) : this.colOrder.filter((x) => x !== id);
    this.savePrefs();
    this.render();
  }

  /** Persist the active filters so a reload/close keeps the same view. */
  private _filterTimer = 0;
  private persistFilters(): void {
    if (this._filterTimer) window.clearTimeout(this._filterTimer);
    this._filterTimer = window.setTimeout(() => {
      const cur = this.plugin.settings.tradeLog || {};
      this.plugin.settings.tradeLog = {
        ...cur,
        filters: {
          symbol: this.symbolFilter,
          accounts: this.accountFilters.slice(),
          group: this.groupFilter,
          direction: this.directionFilter,
          result: this.resultFilter,
          mistakes: this.mistakeFilters.slice(),
          review: this.reviewFilter,
          session: this.sessionFilter,
          quality: this.qualityFilters.slice(),
          period: this.period,
          customFrom: this.customFrom,
          customTo: this.customTo,
          search: this.search,
          setups: this.setupFilters.slice(),

        },
      };
      void this.plugin.saveSettings();
    }, 300);
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  filterByDay(dateKey: string): void {
    this.period = "custom";
    this.customFrom = dateKey;
    this.customTo = dateKey;
    this.render();
  }

  filterBySetup(setup: string): void {
    this.setupFilters = setup ? [setup] : [];
    this.render();
  }

  filterByReview(status: "all" | "pending" | "complete"): void {
    this.reviewFilter = status;
    this.render();
  }

  filtered(): Trade[] {
    let list = this.trades.filter((t) => t && t.date && typeof t.pnl === "number");
    if (this.symbolFilter) list = list.filter((t) => (t.symbol || "").toUpperCase() === this.symbolFilter.toUpperCase());
    if (this.accountFilters.length) {
      const wanted = this.accountFilters
        .map((id) => this.plugin.settings.propAccounts.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a);
      if (!wanted.length) {
        // The picker's "None" means none. Showing the whole journal instead — which
        // is what an early return here used to do — is a lie about the filter.
        list = [];
      } else {
        list = list.filter((t) => {
          const mapped = this.plugin.mappedAccount(t.account);
          if (mapped) return wanted.some((a) => a.id === mapped.id);
          return wanted.some((a) => (a.name || "").trim().toLowerCase() === (t.account || "").trim().toLowerCase());
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
    if (this.directionFilter !== "all") list = list.filter((t) => t.direction === this.directionFilter);
    if (this.resultFilter === "win") list = list.filter((t) => t.pnl > 0);
    else if (this.resultFilter === "loss") list = list.filter((t) => t.pnl < 0);
    // Break-even is a state, not a side: net exactly zero. A trade that took TP1
    // and TP2 with a flat runner is a win, and this filter leaves it there.
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
    if (this.qualityFilters.length) {
      // "Missing" is one question with several answers: show me anything that is
      // still unfinished. Picking two asks for either, not for both — the point is
      // to find the trades that need work.
      list = list.filter((t) => this.qualityFilters.some((q) => missingFlag(t, q)));
    }
    if (this.rFilter !== "all") {
      list = list.filter((t) => {
        const r = tradeR(t);
        if (r === null) return false; // no stop, no R to judge
        if (this.rFilter === "1plus") return r >= 1;
        if (this.rFilter === "0to1") return r > 0 && r < 1;
        return r <= 0;
      });
    }
    if (this.reviewFilter !== "all") {
      list = list.filter((t) => (this.reviewFilter === "complete" ? reviewStatus(t).complete : !reviewStatus(t).complete));
    }
    const range = this.periodRange();
    if (range) list = list.filter((t) => (!range.start || t.date >= range.start) && (!range.end || t.date <= range.end));
    if (this.search) {
      const terms = this.search.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((t) => {
        const hay = [t.symbol, t.setup, t.mistake, t.review, t.account].filter(Boolean).join(" ").toLowerCase();
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
   * The date window a period means, or null for "all time". Weeks run Monday to
   * Sunday; a month is the calendar month, so the numbers match the calendar the
   * trader already looks at.
   */
  private periodRange(): { start: string; end: string } | null {
    const now = new Date();
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const monday = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() || 7) - 1));
    let start: Date | null = null;
    let end: Date | null = null;
    switch (this.period) {
      case "today":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = start;
        break;
      case "yesterday": {
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        start = y;
        end = y;
        break;
      }
      case "thisweek":
        start = monday(now);
        break;
      case "lastweek": {
        const m = monday(now);
        start = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 7);
        end = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 1);
        break;
      }
      // "1m" is what an earlier build stored for This Month; keep reading it.
      case "thismonth":
      case "1m":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "lastmonth":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case "thisquarter":
        start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        break;
      case "thisyear":
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case "custom":
        return { start: this.customFrom, end: this.customTo };
      default:
        return null;
    }
    return { start: start ? ymd(start) : "", end: end ? ymd(end) : "" };
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-tradelog");
    const main = renderAppShell(root, this.plugin, "tradelog");
    this.persistFilters();

    const all = this.filtered();
    const rows = all.slice(0, this.limit);
    // The list shows every leg (each one is a real trade in its own account), but
    // the totals count one entry per logical trade: a copy must not add a second
    // "trade" or a second win to these numbers.
    const counted = analyticsTrades(all, this.plugin.settings.includeCopiesInPortfolioAnalytics === true).counts;
    const net = all.reduce((s, t) => s + (Number.isFinite(t.pnl) ? t.pnl : 0), 0);
    const wins = counted.filter((t) => t.pnl > 0).length;
    const losses = counted.filter((t) => t.pnl < 0).length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    const rVals = counted.map((t) => tradeR(t)).filter((v): v is number => v !== null);
    const avgR = rVals.length ? rVals.reduce((s, v) => s + v, 0) / rVals.length : null;
    const rev = reviewSummary(counted);
    void rev;
    const pending = counted.filter((t) => !reviewStatus(t).complete).length;

    // Title, then the numbers that open the page. No strip of cards: this is a log,
    // so the figures should open it, not fill it.
    const head = main.createDiv({ cls: "tj-tl-head" });
    const title = head.createDiv({ cls: "tj-tl-title" });
    title.createEl("h1", { cls: "tj-view-h1", text: "Trade Log" });
    const nums = title.createDiv({ cls: "tj-tl-nums" });
    nums.createSpan({ cls: "tj-tl-net " + (net >= 0 ? "tj-pos" : "tj-neg"), text: fmtMoney(net) });
    const bits = [`${counted.length} trade${counted.length === 1 ? "" : "s"}`];
    if (wins + losses > 0) bits.push(`${winRate.toFixed(0)}% win`);
    if (avgR !== null) bits.push(`${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R`);
    // One trade, one row: a copied trade is a single decision that happened in
    // several accounts, and the row says how many. No "legs" anywhere — that was
    // our word, and nobody reading a journal should have to learn it.
    const metaEl = nums.createSpan({ cls: "tj-tl-meta", text: bits.join(" · ") });
    const records = all.length;
    if (records !== counted.length) {
      attachTip(metaEl, {
        title: `${counted.length} trades`,
        sub: `${records} records in all: a trade you also copied shows once, and its row says how many accounts it reached.`,
      });
    }

    const actions = head.createDiv({ cls: "tj-tl-actions" });

    // The review-queue alert: how many trades are still waiting for a review, and
    // one click to see only those. Silence when the journal is clean.
    if (pending > 0) {
      const reviewChip = actions.createEl("button", {
        cls: "tj-tl-reviewalert" + (this.reviewFilter === "pending" ? " is-active" : ""),
        attr: { type: "button", "aria-label": `${pending} trades need a review` },
      });
      setIcon(reviewChip.createSpan({ cls: "tj-btn-icon" }), "circle-alert");
      reviewChip.createSpan({ text: `${pending} to review` });
      attachTip(reviewChip, {
        title: `${pending} trade${pending === 1 ? "" : "s"} need a review`,
        sub: "Missing print, strategy, notes or rating. Click to show only those.",
      });
      reviewChip.addEventListener("click", () => {
        this.reviewFilter = this.reviewFilter === "pending" ? "all" : "pending";
        this.render();
      });
    }

    const fbtn = actions.createEl("button", {
      cls: "tj-filterbtn" + (this.filtersOpen ? " is-active" : ""),
      attr: { type: "button", "aria-label": "Filters" },
    });
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
      attr: { type: "button", "aria-label": this.selectMode ? "Exit selection" : "Select trades" },
    });
    attachTip(selBtn, {
      title: this.selectMode ? "Exit selection" : "Select trades",
      sub: this.selectMode ? undefined : "Then tag or edit several at once.",
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
      attr: { type: "button", "aria-label": "Columns" },
    });
    attachTip(colBtn, { title: "Columns", sub: "What the ledger shows. The order is shared with each account's table." });
    setIcon(colBtn, "columns-3");
    colBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.columnsOpen = !this.columnsOpen;
      if (this.columnsOpen) this.filtersOpen = false;
      this.render();
    });

    const activeCount = this.activeFilters().length;
    if (activeCount > 0) fbtn.createSpan({ cls: "tj-filterbtn-count", text: String(activeCount) });
    if (this.filtersOpen) this.renderFiltersPopover(head);
    if (this.columnsOpen) this.renderColumnsPopover(head);

    // Second line: the shared time bar on the left, the filters in force on the right.
    const sub = main.createDiv({ cls: "tj-tl-sub" });
    this.renderPeriodBar(sub);

    // The three things you reach for while reading the log: where you are in time,
    // what you are looking for, and what is still waiting for a review.
    const searchBox = sub.createDiv({ cls: "tj-tl-search" });
    setIcon(searchBox.createSpan({ cls: "tj-tl-search-ico" }), "search");
    const searchInput = searchBox.createEl("input", { attr: { type: "search", placeholder: "Search symbol, strategy, account…" } });
    searchInput.value = this.search;
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value.trim();
      this._restoreFocus = true;
      this.render();
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

    if (this.selectMode) this.renderBulkBar(main);

    // The ledger: rail + days + aligned columns. Same recipe as an account's table,
    // so the two can never drift (src/lib/tradeTable).
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

    const table = main.createDiv({ cls: "tj-tl-ledger" });
    renderTradeTable(table, {
      plugin: this.plugin,
      trades: rows,
      order: this.visibleOrder(),
      rail: true,
      groupByDay: true,
      selectMode: this.selectMode,
      selected: this.selected,
      onToggleSelect: (t) => {
        if (t.id) this.toggleSelect(t.id);
      },
      sort: this.sort,
      onSort: (next) => {
        this.sort = next;
        this.savePrefs();
        this.render();
      },
      onToggleReviewed: (t, next) => void this.markReviewed(t, next),
      onRowClick: (t) => {
        // Remember the row, so coming back from the trade lands on it again.
        this.anchor = t.id || "";
        void this.plugin.openTradeDetail(t);
      },
      onReorder: (next) => {
        const shared = resolveOrder(this.plugin.settings.tradeLogColOrder, ALL_COLUMN_IDS);
        const hidden = shared.filter((id) => !next.includes(id));
        this.plugin.settings.tradeLogColOrder = [...next, ...hidden];
        this.colOrder = next;
        this.savePrefs();
        this.render();
      },
    });

    if (all.length === 0) main.createDiv({ cls: "tj-empty", text: "No trades match these filters." });

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

    if (all.length > this.limit) {
      const more = main.createDiv({ cls: "tj-tl-more" });
      more
        .createEl("button", { cls: "tj-btn", text: `Load ${Math.min(50, all.length - this.limit)} more (${all.length - rows.length} left)` })
        .addEventListener("click", () => {
          // The page scrolls in .tj-app-main, not in the ledger: saving the
          // ledger's scrollTop restored nothing and the view jumped to the top.
          const scroller = this.contentEl.querySelector(".tj-app-main") as HTMLElement | null;
          const ledger = this.contentEl.querySelector(".tj-tl-ledger") as HTMLElement | null;
          this.savedScrollY = scroller?.scrollTop ?? 0;
          this.savedLedgerY = ledger?.scrollTop ?? 0;
          this.limit += 50;
          this.render();
        });
    }

    // Restore scroll position after Load More rebuilds the entire DOM. Both
    // scrollers are restored: the page one is the real one, the ledger's is
    // kept for when the table itself scrolls.
    if (this.savedScrollY || this.savedLedgerY) {
      const sy = this.savedScrollY;
      const ly = this.savedLedgerY;
      this.savedScrollY = 0;
      this.savedLedgerY = 0;
      setTimeout(() => {
        const scroller = this.contentEl.querySelector(".tj-app-main") as HTMLElement | null;
        const ledger = this.contentEl.querySelector(".tj-tl-ledger") as HTMLElement | null;
        if (scroller && sy) scroller.scrollTop = sy;
        if (ledger && ly) ledger.scrollTop = ly;
      }, 50);
    }
  }

  private toggleSelect(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.render();
  }

  private renderBulkBar(main: HTMLElement): void {
    const bar = main.createDiv({ cls: "tj-tl-bulk" });
    bar.createSpan({
      cls: "tj-tl-bulk-count",
      text: this.selected.size > 0 ? `${this.selected.size} selected` : "None selected",
    });
    const act = (label: string, icon: string, cls: string, fn: () => void, disabled = false) => {
      const b = bar.createEl("button", { cls: "tj-tl-bulkbtn " + cls, attr: { type: "button" } });
      const ic = b.createSpan({ cls: "tj-btn-icon" });
      setIcon(ic, icon);
      b.createSpan({ text: label });
      if (disabled) {
        b.setAttr("disabled", "true");
        b.addClass("is-disabled");
      } else {
        b.addEventListener("click", fn);
      }
    };
    const empty = this.selected.size === 0;
    act("Select All", "check-check", "tj-ghost", () => {
      for (const t of this.filtered()) if (t.id) this.selected.add(t.id);
      this.render();
    });
    act("Mark Reviewed", "check-circle", "", () => void this.bulkField({ reviewed: "true" }), empty);
    act("Mark Unreviewed", "circle-slash", "", () => void this.bulkField({ reviewed: "false" }), empty);
    act("Add Strategies", "flask-conical", "", () => this.bulkPrompt("Add strategy to selected", "setup"), empty);
    act("Add Mistakes", "triangle-alert", "", () => this.bulkPrompt("Add mistake to selected", "mistake"), empty);

    // Rating and account are choices from a known set, so they are pickers: no
    // typing, no wrong value, and the trade's other fields are left alone.
    const rateHost = bar.createSpan({ cls: "tj-tl-bulkpick" });
    mountDropdown(
      rateHost,
      [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: "★".repeat(n), note: `Set rating to ${n}` })),
      "",
      (id) => void this.bulkField({ rating: Number(id) }),
      { placeholder: "Set rating…", title: "Rate the selected trades", align: "left" }
    );
    if (empty) rateHost.addClass("is-disabled");

    const accHost = bar.createSpan({ cls: "tj-tl-bulkpick" });
    mountDropdown(
      accHost,
      this.plugin.settings.propAccounts.map((a) => ({ id: a.id, label: a.name, note: "Move the selected trades here" })),
      "",
      (id) => void this.bulkAccount(id),
      { placeholder: "Change account…", title: "Move the selected trades to another account", align: "left" }
    );
    if (empty) accHost.addClass("is-disabled");

    act("Duplicate", "copy", "", () => void this.bulkDuplicate(), empty);
    act("Delete", "trash-2", "tj-del", () => void this.bulkDelete(), empty);
    act("Clear", "x", "tj-ghost", () => {
      this.selected.clear();
      this.render();
    });
  }

  private async bulkDuplicate(): Promise<void> {
    let n = 0;
    for (const id of this.selected) {
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
    for (const id of this.selected) {
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

  private bulkPrompt(title: string, key: "setup" | "mistake"): void {
    const val = window.prompt(title);
    if (!val) return;
    void this.bulkField({ [key]: val });
  }

  /**
   * Tags are additive by nature — a trade is both "TMM" and "reversal". Writing
   * the union keeps the existing tags instead of replacing them.
   */
  private async bulkAccount(accountId: string): Promise<void> {
    const acc = this.plugin.settings.propAccounts.find((a) => a.id === accountId);
    if (!acc) return;
    let n = 0;
    for (const path of this.selected) {
      try {
        if (await setTradeAccount(this.app, path, acc.name)) n++;
      } catch (err) {
        console.error("[tradebook] bulk account move failed", err);
      }
    }
    new Notice(`${n} trade(s) moved to ${acc.name}.`);
    this.selected.clear();
    await this.refresh();
  }

  private async bulkDelete(): Promise<void> {
    if (!window.confirm(`Delete ${this.selected.size} trade note(s)? This cannot be undone.`)) return;
    let n = 0;
    for (const id of this.selected) {
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

  // ---------------- List (rich + inline edit) ----------------
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
    if (this.qualityFilters.length) {
      const words: Record<string, string> = { noprint: "no print", nosetup: "no strategy", nostop: "no stop", norating: "no rating" };
      const picked = this.qualityFilters.map((q) => words[q] ?? q);
      out.push({ label: `Missing: ${picked.join(" or ")}`, clear: () => (this.qualityFilters = []) });
    }
    if (this.accountFilters.length) {
      const names = this.accountFilters.map(
        (id) => this.plugin.settings.propAccounts.find((a) => a.id === id)?.name || id
      );
      out.push({ label: `Account: ${names.join(", ")}`, clear: () => (this.accountFilters = []) });
    }
    if (this.groupFilter) out.push({ label: `Group: ${this.groupFilter}`, clear: () => (this.groupFilter = "") });
    if (this.rFilter !== "all") {
      const words: Record<string, string> = { "1plus": "≥ 1R", "0to1": "0 to 1R", neg: "at or below 0R" };
      out.push({ label: `R: ${words[this.rFilter]}`, clear: () => (this.rFilter = "all") });
    }
    if (this.period !== "all") {
      out.push({ label: `Period: ${periodLabel(this.period)}`, clear: () => (this.period = "all") });
    }
    return out;
  }

  private clearFilters(): void {
    this.symbolFilter = "";
    this.accountFilters = [];
    this.groupFilter = "";
    this.directionFilter = "all";
    this.resultFilter = "all";
    this.mistakeFilters = [];
    this.reviewFilter = "all";
    this.sessionFilter = "all";
    this.qualityFilters = [];
    this.rFilter = "all";
    this.period = "all";
    this.customFrom = "";
    this.customTo = "";
    this.search = "";
    this.setupFilters = [];
    this.limit = 50;
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
        this.render();
      });
    }
    if (this.period === "custom") {
      const box = bar.createDiv({ cls: "tj-period-custom" });
      mountDateField(box, {
        value: this.customFrom,
        format: this.plugin.settings.dateFormat,
        className: "tj-input",
        onChange: (v) => {
          this.customFrom = v;
          this.render();
        },
      });
      box.createSpan({ cls: "tj-pop-label", text: "→" });
      mountDateField(box, {
        value: this.customTo,
        format: this.plugin.settings.dateFormat,
        className: "tj-input",
        onChange: (v) => {
          this.customTo = v;
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
    const tools = field.createDiv({ cls: "tj-tl-acctools" });
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
        const row = list.createDiv({ cls: "tj-tl-accrow" + (on ? " on" : "") + (a.n ? "" : " is-quiet") });
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
    const colGrid = pop.createDiv({ cls: "tj-tl-cols" });
    for (const col of TRADE_COLUMNS) {
      const wrap = colGrid.createEl("label", { cls: "tj-tl-colrow" });
      const cb = wrap.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.colOrder.includes(col.id);
      cb.addEventListener("change", () => this.toggleColumn(col.id, cb.checked));
      wrap.createSpan({ text: col.id === "image" ? "Print" : col.label || col.id });
    }
    const presets = pop.createDiv({ cls: "tj-tl-colpresets" });
    const preset = (label: string, ids: string[], hint: string) => {
      const b = presets.createEl("button", { cls: "tj-tl-presetbtn", text: label, attr: { type: "button" } });
      attachTip(b, { title: label, sub: hint });
      b.addEventListener("click", () => {
        this.colOrder = ids.slice();  /* presets set exactly these columns — resolveOrder adds missing ones back, which defeats the purpose */
        this.savePrefs();
        this.render();
      });
    };
    preset("Default", DEFAULT_TRADE_LOG_ORDER, "The full set, in the order we suggest.");
    preset("Simple", ["symbol", "side", "points", "pnl"], "What the trade was and what it did — four columns.");

    const reset = pop.createEl("button", { cls: "tj-tl-presetbtn is-quiet", text: "Reset to default", attr: { type: "button" } });
    attachTip(reset, { title: "Reset to default", sub: "Back to the layout we ship with, so you never have to remember what you moved." });
    reset.addEventListener("click", () => {
      this.colOrder = DEFAULT_TRADE_LOG_ORDER.slice();
      this.savePrefs();
      this.render();
    });
    // Side display: arrows (▲/▼) or letters (LONG/SHORT).
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
        void this.plugin.saveSettings();
        this.render();
      });
    }
    pop.createDiv({ cls: "tj-tl-colnote", text: "Drag a column header to move it. The order is shared with the ledger inside each account." });
  }

  private renderFiltersPopover(header: HTMLElement): void {
    const backdrop = header.createDiv({ cls: "tj-pop-backdrop" });
    backdrop.addEventListener("click", () => {
      this.filtersOpen = false;
      this.render();
    });
    const pop = header.createDiv({ cls: "tj-popover tj-tl-pop" });
    pop.addEventListener("click", (e) => e.stopPropagation());

    const grid = (): HTMLElement => pop.createDiv({ cls: "tj-pop-grid" });
    const sel = (
      host: HTMLElement,
      label: string,
      options: [string, string][],
      value: string,
      onPick: (v: string) => void,
      disabled = false
    ) => {
      const f = host.createDiv({ cls: "tj-pop-field" });
      f.createEl("label", { text: label, cls: "tj-pop-label" });
      const s = f.createEl("select", { cls: "dropdown" });
      for (const [v, t] of options) {
        const o = s.createEl("option", { value: v, text: t });
        if (v === value) o.setAttr("selected", "selected");
      }
      if (disabled) s.setAttr("disabled", "true");
      else s.addEventListener("change", () => onPick(s.value));
    };

    /**
     * A filter that can hold more than one value at once. Reading a journal means
     * asking "these two accounts" or "these three setups", and a single-choice
     * dropdown forces a second pass through the same list.
     */
    const multi = (
      host: HTMLElement,
      label: string,
      options: [string, string][],
      values: string[],
      onToggle: (v: string, on: boolean) => void
    ) => {
      const f = host.createDiv({ cls: "tj-pop-field tj-pop-field-wide" });
      f.createEl("label", { text: label, cls: "tj-pop-label" });
      const picks = f.createDiv({ cls: "tj-tl-picks" });
      if (!options.length) {
        picks.createSpan({ cls: "tj-tl-picknone", text: "None in this journal yet" });
        return;
      }
      for (const [v, t] of options) {
        const on = values.includes(v);
        const b = picks.createEl("button", { cls: "tj-tl-pick" + (on ? " on" : ""), text: t, attr: { type: "button" } });
        b.addEventListener("click", () => onToggle(v, !on));
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

    // Grouped by the question you are asking, not by field type: "what did I trade",
    // "how did it go", "when", "was it done properly".
    const gHead = pop.createDiv({ cls: "tj-pop-section" });
    gHead.createSpan({ text: "What I traded" });
    if (this.activeFilters().length) {
      gHead.createEl("button", { cls: "tj-tl-activeclear", text: "Clear all", attr: { type: "button" } })
        .addEventListener("click", () => { this.clearFilters(); this.render(); });
    }
    let g = grid();
    this.accountPicker(g);
    sel(g, "Ticker", syms, this.symbolFilter, (v) => { this.symbolFilter = v; this.render(); });

    pop.createDiv({ cls: "tj-pop-section", text: "How it went" });
    g = grid();
    sel(g, "Result", [["all", "All"], ["win", "Wins"], ["loss", "Losses"], ["be", "Break-even"]], this.resultFilter, (v) => { this.resultFilter = v; this.render(); });
    sel(g, "Direction", [["all", "All"], ["long", "Long"], ["short", "Short"]], this.directionFilter, (v) => { this.directionFilter = v; this.render(); });
    sel(g, "R multiple", [["all", "All"], ["1plus", "1R or better"], ["0to1", "0 to 1R"], ["neg", "At or below 0R"]], this.rFilter, (v) => { this.rFilter = v; this.render(); });

    pop.createDiv({ cls: "tj-pop-section", text: "When" });
    g = grid();
    sel(g, "Session", [["all", "All"], ["newyork", "New York"], ["london", "London"], ["asia", "Asia"], ["off", "Off Hours"], ["none", "No time"]], this.sessionFilter, (v) => { this.sessionFilter = v; this.render(); });
    pop.createDiv({ cls: "tj-pop-section", text: "Quality" });
    g = grid();
    multi(g, "Strategies", setups, this.setupFilters, (v, on) => { this.setupFilters = toggleIn(this.setupFilters, v, on); this.render(); });
    multi(g, "Mistakes", mistakes, this.mistakeFilters, (v, on) => { this.mistakeFilters = toggleIn(this.mistakeFilters, v, on); this.render(); });
    g = grid();
    multi(
      g,
      "Missing",
      [["noprint", "No print"], ["nosetup", "No strategy"], ["nostop", "No stop"], ["norating", "No rating"]],
      this.qualityFilters,
      (v, on) => { this.qualityFilters = toggleIn(this.qualityFilters, v, on); this.render(); }
    );

    const clear = pop.createEl("button", { cls: "tj-btn tj-mini tj-pop-clear", text: "Clear all" });
    clear.addEventListener("click", () => {
      this.clearFilters();
      this.render();
    });
  }

}
