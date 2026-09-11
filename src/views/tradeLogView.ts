import { ItemView } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { renderAppShell } from "../ui";
import { fmtMoney2 } from "../tz";

export const TRADE_LOG_VIEW_TYPE = "trading-journal-trade-log-view";

export class TradeLogView extends ItemView {
  plugin: TradingJournalPlugin;
  trades: Trade[] = [];
  symbolFilter = "";
  accountFilter = "";
  groupFilter = "";
  typeFilter = "all";
  dateFrom = "";
  dateTo = "";
  search = "";
  limit = 50;

  constructor(leaf: any, plugin: TradingJournalPlugin) {
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
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTrades();
    this.render();
  }

  /** Set date filters to a single day (used by Calendar day click) and rerender. */
  filterByDay(dateKey: string): void {
    this.dateFrom = dateKey;
    this.dateTo = dateKey;
    this.render();
  }

  filtered(): Trade[] {
    let list = this.trades.filter((t) => t && t.date && typeof t.pnl === "number");
    if (this.symbolFilter) list = list.filter((t) => (t.symbol || "").toUpperCase() === this.symbolFilter.toUpperCase());
    if (this.accountFilter) {
      const acc = this.plugin.settings.propAccounts.find((a) => a.id === this.accountFilter);
      if (acc) list = list.filter((t) => {
        const mapped = this.plugin.mappedAccount(t.account);
        return mapped ? mapped.id === acc.id : (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
      });
    } else if (this.groupFilter) {
      const group = this.plugin.settings.accountGroups.find((g) => g.id === this.groupFilter);
      const ids = group ? new Set(group.accountIds) : new Set<string>();
      list = list.filter((t) => {
        const mapped = this.plugin.mappedAccount(t.account);
        return mapped ? ids.has(mapped.id) : false;
      });
    }
    if (this.typeFilter !== "all") list = list.filter((t) => t.accountType === this.typeFilter);
    if (this.dateFrom) list = list.filter((t) => t.date >= this.dateFrom);
    if (this.dateTo) list = list.filter((t) => t.date <= this.dateTo);
    if (this.search) {
      const q = this.search.toLowerCase();
      list = list.filter((t) =>
        (t.symbol || "").toLowerCase().includes(q) ||
        (t.setup || "").toLowerCase().includes(q) ||
        (t.mistake || "").toLowerCase().includes(q) ||
        (t.thesis || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.entryTime || "").localeCompare(a.entryTime || ""));
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-tradelog");
    const main = renderAppShell(root, this.plugin, "tradelog");

    main.createEl("h1", { text: "Trade Log", cls: "tj-view-h1" });
    this.renderFilters(main);

    const trades = this.filtered().slice(0, this.limit);
    const totalCount = this.filtered().length;
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    const wins = trades.filter((t) => t.pnl > 0).length;

    const summary = main.createDiv({ cls: "tj-preview-summary" });
    summary.createDiv({
      text: `${totalCount} trades shown · Net $${net >= 0 ? "+" : ""}${net.toFixed(2)} · ${wins ? Math.round((wins / trades.length) * 100) : 0}% win`,
      cls: "tj-preview-headline",
    });

    const wrap = main.createDiv({ cls: "tj-tablewrap" });
    const table = wrap.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Time", "Symbol", "Dir", "Account", "Type", "Qty", "Entry", "Exit", "P&L", "Review"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const t of trades) {
      const tr = tbody.createEl("tr", { cls: "tj-clickable-row" });
      if (t.id) tr.setAttr("data-tj-note", t.id);
      tr.addEventListener("click", () => {
        if (t.id) void this.plugin.openTradeModal(t);
      });
      tr.createEl("td", { text: t.date });
      tr.createEl("td", { text: t.entryTime || "—" });
      tr.createEl("td", { text: t.symbol });
      tr.createEl("td", { text: t.direction === "long" ? "L" : "S" });
      tr.createEl("td", { text: t.account });
      tr.createEl("td", { text: t.accountType });
      tr.createEl("td", { text: String(t.quantity) });
      tr.createEl("td", { text: t.entryPrice ? String(t.entryPrice) : "—" });
      tr.createEl("td", { text: t.exitPrice ? String(t.exitPrice) : "—" });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney2(t.pnl);
      const revTd = tr.createEl("td");
      revTd.textContent = t.review && t.review.trim() ? "✓" : "✗";
      revTd.addClass("tj-rev-cell");
      revTd.addClass(t.review && t.review.trim() ? "tj-ok" : "tj-miss");
    }
    if (trades.length === 0) {
      const tr = tbody.createEl("tr");
      const td = tr.createEl("td", { attr: { colspan: "11" } });
      td.createDiv({ cls: "tj-empty", text: "No trades match these filters." });
    }
    if (totalCount > this.limit) {
      tbody.createEl("tr").createEl("td", { text: `... and ${totalCount - this.limit} more (select a tighter filter or search)`, attr: { colspan: "11" } });
    }
  }

  renderFilters(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "tj-filterbar tj-filterbar-compact" });

    bar.createSpan({ text: "Search", cls: "tj-filter-label" });
    const searchInput = bar.createEl("input", { cls: "tj-input", attr: { type: "search", placeholder: "symbol, setup, thesis…" } });
    searchInput.value = this.search;
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value.trim();
      this.render();
    });

    bar.createSpan({ text: "Symbol", cls: "tj-filter-label" });
    const symSel = bar.createEl("select", { cls: "dropdown tj-filt-symbol" });
    const symOption = symSel.createEl("option", { value: "", text: "All symbols" });
    if (!this.symbolFilter) symOption.setAttr("selected", "selected");
    const symbols = [...new Set(this.trades.map((t) => t.symbol).filter(Boolean))].sort();
    for (const s of symbols) {
      const opt = symSel.createEl("option", { value: s, text: s });
      if (this.symbolFilter === s) opt.setAttr("selected", "selected");
    }
    symSel.addEventListener("change", () => {
      this.symbolFilter = symSel.value;
      this.render();
    });

    bar.createSpan({ text: "Type", cls: "tj-filter-label" });
    const typeSel = bar.createEl("select", { cls: "dropdown" });
    const typeOpt = typeSel.createEl("option", { value: "all", text: "All types" });
    if (this.typeFilter === "all") typeOpt.setAttr("selected", "selected");
    for (const type of ["demo", "eval", "funded", "unknown"]) {
      const opt = typeSel.createEl("option", { value: type, text: type });
      if (this.typeFilter === type) opt.setAttr("selected", "selected");
    }
    typeSel.addEventListener("change", () => {
      this.typeFilter = typeSel.value;
      this.render();
    });

    bar.createSpan({ text: "Account", cls: "tj-filter-label" });
    const accSel = bar.createEl("select", { cls: "dropdown" });
    const accOpt = accSel.createEl("option", { value: "", text: "All accounts" });
    if (!this.accountFilter) accOpt.setAttr("selected", "selected");
    for (const acc of this.plugin.settings.propAccounts) {
      const opt = accSel.createEl("option", { value: acc.id, text: acc.name });
      if (this.accountFilter === acc.id) opt.setAttr("selected", "selected");
    }
    accSel.addEventListener("change", () => {
      this.accountFilter = accSel.value;
      this.groupFilter = "";
      this.render();
    });

    if (this.plugin.settings.accountGroups.length > 0) {
      bar.createSpan({ text: "Group", cls: "tj-filter-label" });
      const grpSel = bar.createEl("select", { cls: "dropdown" });
      const grpOpt = grpSel.createEl("option", { value: "", text: "All groups" });
      if (!this.groupFilter) grpOpt.setAttr("selected", "selected");
      for (const g of this.plugin.settings.accountGroups) {
        const opt = grpSel.createEl("option", { value: g.id, text: g.name });
        if (this.groupFilter === g.id) opt.setAttr("selected", "selected");
      }
      grpSel.addEventListener("change", () => {
        this.groupFilter = grpSel.value;
        this.accountFilter = "";
        this.render();
      });
    }

    bar.createSpan({ text: "From", cls: "tj-filter-label" });
    const fromInput = bar.createEl("input", { type: "date", cls: "tj-input tj-date-input" });
    fromInput.value = this.dateFrom;
    fromInput.addEventListener("change", () => {
      this.dateFrom = fromInput.value;
      this.render();
    });
    bar.createSpan({ text: "To", cls: "tj-filter-label" });
    const toInput = bar.createEl("input", { type: "date", cls: "tj-input tj-date-input" });
    toInput.value = this.dateTo;
    toInput.addEventListener("change", () => {
      this.dateTo = toInput.value;
      this.render();
    });

    const clear = bar.createEl("button", { text: "Clear all", cls: "tj-btn tj-mini" });
    clear.addEventListener("click", () => {
      this.symbolFilter = "";
      this.accountFilter = "";
      this.groupFilter = "";
      this.typeFilter = "all";
      this.dateFrom = "";
      this.dateTo = "";
      this.search = "";
      this.render();
    });
  }
}