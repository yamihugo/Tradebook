import { ItemView, TFile } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { ACCOUNT_FILTERS, attachTooltip, clamp, kpiCard, renderAppShell, svgLine, svgPath } from "../ui";
import { effectiveSize, getFirm, getProgram, getSize } from "../props";
import { fmtMoney2, isFiniteNumber, toZoneDate, toZoneTime } from "../tz";
import { updateTradeFields } from "../storage";

export const DASHBOARD_VIEW_TYPE = "trading-journal-dashboard-view";

export const CARD_TITLES: Record<string, string> = {
  kpi: "Key Stats",
  equity: "Cumulative P&L",
  symbols: "Symbol Breakdown",
  needsreview: "Needs Review",
  recent: "Recent Trades",
  hourly: "Hourly Performance",
  daily: "Day Performance",
};

const DEFAULT_LAYOUT = ["kpi", "equity", "symbols", "needsreview", "daily", "hourly"];
const WIDE_CARDS = ["kpi", "equity", "recent", "hourly", "daily", "needsreview"];

function defaultLayout(): { id: string; size: number }[] {
  return DEFAULT_LAYOUT.map((id) => ({ id, size: WIDE_CARDS.includes(id) ? 4 : 2 }));
}

export class DashboardView extends ItemView {
  plugin: TradingJournalPlugin;
  trades: Trade[] = [];
  filter = "all";
  dateRange = "all";
  customFrom = "";
  customTo = "";
  accountId: string | null = null;
  editMode = false;
  dragId: string | null = null;
  dropTarget: { id: string; before: boolean } | null = null;
  checked = new Set<string>();
  checking = false;
  checkboxEls = new Map<string, HTMLInputElement>();

  constructor(leaf: any, plugin: TradingJournalPlugin) {
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

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTrades();
    this.render();
  }

  accountMatches(t: Trade, acc: { id: string; name: string }): boolean {
    const mapped = this.plugin.mappedAccount(t.account);
    if (mapped) return mapped.id === acc.id;
    return (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
  }

  filteredTrades(): Trade[] {
    let list = this.trades.filter((t) => isFiniteNumber(t.pnl) && t.date);
    if (this.accountId) {
      const acc = this.plugin.settings.propAccounts.find((a) => a.id === this.accountId);
      if (acc) list = list.filter((t) => this.accountMatches(t, acc));
    } else if (this.filter !== "all") {
      if (this.filter === "live") {
        // Live = trades whose mapped account is marked live/personal, or a direct name match.
        const liveNames = new Set(this.plugin.settings.propAccounts.filter((a) => a.type === "live" || a.type === "personal").map((a) => a.name.trim().toLowerCase()));
        list = list.filter((t) => {
          const mapped = this.plugin.mappedAccount(t.account);
          if (mapped) return mapped.type === "live" || mapped.type === "personal";
          return liveNames.has((t.account || "").trim().toLowerCase());
        });
      } else {
        list = list.filter((t) => t.accountType === this.filter);
      }
    }
    const now = new Date();
    if (this.dateRange !== "all") {
      let start: Date | null = null;
      let end: Date | null = null;
      const parseDay = (s: string): Date => new Date(s + "T00:00:00");
      if (this.dateRange === "thisweek") {
        const day = now.getDay() || 7; // Mon=1..Sun=7
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      } else if (this.dateRange === "lastweek") {
        const day = now.getDay() || 7;
        const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
        start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
        end = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
      } else if (this.dateRange === "1m") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (this.dateRange === "custom") {
        if (this.customFrom) start = parseDay(this.customFrom);
        if (this.customTo) end = parseDay(this.customTo);
      }
      if (start) list = list.filter((t) => new Date(t.date + "T00:00:00") >= start);
      if (end) list = list.filter((t) => new Date(t.date + "T00:00:00") <= end);
    }
    return [...list].sort((a, b) => a.date.localeCompare(b.date));
  }

  ensureLayout(): void {
    if (this.plugin.settings.dashboardLayout.length === 0) {
      this.plugin.settings.dashboardLayout = defaultLayout();
    } else if (this.plugin.settings.dashboardLayout.some((i) => i.size === undefined)) {
      this.plugin.settings.dashboardLayout = this.plugin.settings.dashboardLayout.map((i) => ({
        id: i.id,
        size: i.size ?? (i as any).wide ? 4 : 2,
        rows: i.rows ?? 1,
      }));
    }
    const valid = new Set(Object.keys(CARD_TITLES));
    const filtered = this.plugin.settings.dashboardLayout.filter((i) => valid.has(i.id));
    if (filtered.length !== this.plugin.settings.dashboardLayout.length) {
      this.plugin.settings.dashboardLayout = filtered;
    }
  }

  getLayout(): { id: string; size: number; rows?: number }[] {
    this.ensureLayout();
    return this.plugin.settings.dashboardLayout;
  }

  saveLayout(): Promise<void> {
    return this.plugin.saveSettings().then(() => this.render());
  }

  addWidget(id: string): void {
    this.getLayout().push({ id, size: 2, rows: 1 });
    this.saveLayout();
  }

  removeWidget(id: string): void {
    const layout = this.getLayout();
    const idx = layout.findIndex((i) => i.id === id);
    if (idx >= 0) layout.splice(idx, 1);
    this.saveLayout();
  }

  // Move a card one slot left/right in the flow order (the grid fills row-major).
  moveItem(id: string, dir: -1 | 1): void {
    const layout = this.getLayout();
    const from = layout.findIndex((i) => i.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= layout.length) return;
    [layout[from], layout[to]] = [layout[to], layout[from]];
    this.saveLayout();
  }

  // Resize a card horizontally (size = grid columns 1..4) or vertically (rows = 1..2).
  resizeItem(id: string, axis: "w" | "h", delta: number): void {
    const layout = this.getLayout();
    const item = layout.find((i) => i.id === id);
    if (!item) return;
    if (axis === "w") {
      item.size = clamp((item.size ?? 2) + delta, 1, 4);
    } else {
      item.rows = clamp((item.rows ?? 1) + delta, 1, 2);
    }
    this.saveLayout();
  }

  applyMove(id: string, target: { id: string; before: boolean } | null): void {
    if (!target || id === target.id) return;
    const layout = this.getLayout();
    const from = layout.findIndex((i) => i.id === id);
    if (from < 0) return;
    const item = layout.splice(from, 1)[0];
    const to = layout.findIndex((i) => i.id === target.id);
    if (to < 0) return;
    layout.splice(target.before ? to : to + 1, 0, item);
    this.saveLayout();
  }

  bindDrag(card: HTMLElement, id: string): void {
    if (!this.editMode) {
      card.removeAttribute("draggable");
      return;
    }
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => {
      this.dragId = id;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      card.classList.add("tj-dragging");
    });
    card.addEventListener("dragover", (e) => {
      if (!this.dragId || this.dragId === id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      card.classList.toggle("tj-drop-before", before);
      card.classList.toggle("tj-drop-after", !before);
      this.dropTarget = { id, before };
    });
    card.addEventListener("dragleave", () => card.classList.remove("tj-drop-before", "tj-drop-after"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (this.dragId) this.applyMove(this.dragId, this.dropTarget);
    });
    card.addEventListener("dragend", () => {
      this.dragId = null;
      this.dropTarget = null;
      card.classList.remove("tj-dragging", "tj-drop-before", "tj-drop-after");
    });
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    const main = renderAppShell(root, this.plugin, "dashboard");
    root.addClass("tj-dashboard");
    root.toggleClass("tj-editing", this.editMode);
    main.addClass("tj-dash-main");

    const title = main.createDiv({ cls: "tj-dash-title" });
    title.createDiv().createEl("h1", { text: this.plugin.getDashboardTitle() });
    const titleSub = title.createDiv({ cls: "tj-dash-sub" });
    titleSub.createSpan({ cls: "tj-version-badge", text: `v${this.plugin.manifest.version}` });
    const actions = title.createDiv({ cls: "tj-dash-actions" });
    actions.createEl("button", { text: this.editMode ? "Done" : "Edit", cls: this.editMode ? "mod-cta" : "tj-btn" }).addEventListener("click", () => {
      this.editMode = !this.editMode;
      this.render();
    });
    this.renderFilters(main);

    const trades = this.filteredTrades();
    if (this.editMode) this.renderPalette(main);
    if (trades.length === 0) {
      const acc = this.accountId ? this.plugin.settings.propAccounts.find((a) => a.id === this.accountId) : undefined;
      main.createDiv({
        cls: "tj-empty",
        text: acc
          ? `No trades for "${acc.name}" in this period. Import a Tradeovate CSV or add a trade to get started.`
          : `No trades${this.filter !== "all" ? " for this account type" : ""} in this period. Import a Tradeovate CSV or add a trade to get started.`,
      });
    }
    this.renderLayout(main, trades);
  }

  renderPalette(root: HTMLElement): void {
    const layout = this.getLayout();
    const pallet = root.createDiv({ cls: "tj-pallet" });
    const titleRow = pallet.createDiv({ cls: "tj-pallet-header" });
    titleRow.createEl("strong", { text: "Edit mode — tap a card to add it to your dashboard" });
    titleRow.createEl("span", { text: "Use each card's buttons to resize (W/H) or move it (◀ ▶). Cards can also be dragged. Tap Done when finished.", cls: "tj-pallet-hint" });
    const row = pallet.createDiv({ cls: "tj-pallet-row" });
    const present = new Set(layout.map((i) => i.id));
    let added = 0;
    for (const id of Object.keys(CARD_TITLES)) {
      if (present.has(id)) continue;
      added++;
      row.createEl("button", { cls: "tj-pallet-chip", text: `+ ${CARD_TITLES[id]}` }).addEventListener("click", () => this.addWidget(id));
    }
    if (added === 0) {
      row.createSpan({ cls: "tj-pallet-hint", text: "All cards are on the dashboard already." });
    }
  }

  renderLayout(root: HTMLElement, trades: Trade[]): void {
    const grid = root.createDiv({ cls: "tj-grid" });
    const layout = this.getLayout();
    if (layout.length === 0) {
      grid.createDiv({ cls: "tj-empty", text: "Dashboard is empty — press Edit to add cards." });
      return;
    }
    for (const item of layout) {
      const size = item.size ?? 2;
      const rows = item.rows ?? 1;
      const card = grid.createDiv({ cls: `tj-card tj-gridcard tj-g${size} tj-r${rows}`, attr: { "data-wid": item.id } });
      this.bindDrag(card, item.id);
      const header = card.createDiv({ cls: "tj-card-header" });
      header.createEl("h3", { text: CARD_TITLES[item.id] });
      if (this.editMode) {
        // Explicit controls: move (left/right), width −/+, height −/+, remove.
        // Drag-and-drop still works too, but these buttons are the reliable way.
        const controls = header.createDiv({ cls: "tj-card-controls" });
        const mk = (text: string, title: string, fn: () => void, extra = "") => {
          const b = controls.createEl("button", { text, cls: "tj-mini" + (extra ? " " + extra : ""), attr: { type: "button", title } });
          b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
          return b;
        };
        mk("◀", "Move left", () => this.moveItem(item.id, -1));
        mk("▶", "Move right", () => this.moveItem(item.id, 1));
        mk("W−", `Decrease width (currently ${size} col)`, () => this.resizeItem(item.id, "w", -1));
        mk("W＋", `Increase width (currently ${size} col)`, () => this.resizeItem(item.id, "w", 1));
        mk("H−", `Decrease height (currently ${rows} row)`, () => this.resizeItem(item.id, "h", -1));
        mk("H＋", `Increase height (currently ${rows} row)`, () => this.resizeItem(item.id, "h", 1));
        mk("✕", "Remove card", () => this.removeWidget(item.id), "tj-del");
      }
      const body = card.createDiv({ cls: "tj-gridcard-body" });
      try {
        switch (item.id) {
          case "kpi": this.renderKpiBody(body, trades); break;
          case "equity": {
            const total = trades.reduce((s, t) => s + t.pnl, 0);
            const label = body.createDiv({ cls: "tj-equity-label", text: "Total P&L" });
            label.title = "Net P&L for the selected period & account filter";
            const value = body.createDiv({ cls: "tj-equity-total" });
            value.addClass(total >= 0 ? "tj-pos" : "tj-neg");
            value.textContent = fmtMoney2(total);
            if (trades.length) this.renderLineChart(body, trades);
            else body.createDiv({ cls: "tj-chart-empty", text: "No data" });
            break;
          }
          case "symbols": this.renderSymbolTable(body, trades); break;
          case "needsreview": this.renderNeedsReviewBody(body, trades); break;
          case "recent": this.renderTradesTable(body, trades); break;
          case "hourly": this.renderHourlyBody(body, trades); break;
          case "daily": this.renderDailyBody(body, trades); break;
        }
      } catch (err) {
        console.error("[trading-journal] card failed:", item.id, err);
        body.empty();
        body.createDiv({ cls: "tj-empty", text: `"${CARD_TITLES[item.id]}" had a problem — tap Edit to remove it.` });
      }
    }
  }

  renderKpiBody(body: HTMLElement, trades: Trade[]): void {
    const kpis = body.createDiv({ cls: "tj-kpis" });
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    let sub = "";
    if (trades.length) {
      const lastDate = trades[trades.length - 1].date;
      const lastDay = trades.filter((t) => t.date === lastDate).reduce((s, t) => s + t.pnl, 0);
      if (lastDay !== net) sub = `— ${lastDay >= 0 ? "+" : ""}$${lastDay.toFixed(2)}`;
    }
    const wins = trades.filter((t) => t.pnl > 0);
    const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgWin = wins.length ? grossWin / wins.length : 0;
    const losses = trades.filter((t) => t.pnl < 0);
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const avg = trades.length ? net / trades.length : 0;
    const best = trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0;
    const worst = trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0;
    kpiCard(kpis, "Net P&L", fmtMoney2(net), net >= 0 ? "pos" : "neg", sub);
    kpiCard(kpis, "Win Rate", `${winRate.toFixed(1)}%`, "neutral");
    kpiCard(kpis, "Trades", `${trades.length}`, "neutral");
    kpiCard(kpis, "Profit Factor", `${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}`, profitFactor >= 1 ? "pos" : "neg");
    kpiCard(kpis, "Expectancy", fmtMoney2(avg), avg >= 0 ? "pos" : "neg");
    kpiCard(kpis, "Avg Win", fmtMoney2(avgWin), avgWin > 0 ? "pos" : "neg");
    kpiCard(kpis, "Avg Loss", `-$${avgLoss.toFixed(2)}`, avgLoss > 0 ? "neg" : "neutral");
    kpiCard(kpis, "Best / Worst", `${best >= 0 ? "+$" : "-$${Math.abs(best).toFixed(0)}"} / ${worst <= 0 ? "-$" : "+$"}${Math.abs(worst).toFixed(0)}`, "neutral");
  }

  renderNeedsReviewBody(body: HTMLElement, trades: Trade[]): void {
    const missing = trades.filter((t) => !(t.review && t.review.trim()) || !(t.screenshot && t.screenshot.trim()));
    if (missing.length === 0) {
      body.createDiv({ cls: "tj-empty", text: "All reviewed — nice work!" });
      return;
    }
    this.renderMissingTable(body, missing);
  }

  renderFilters(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "tj-filterbar tj-filterbar-compact" });

    // Account dropdown — grouped by prop firm + program + size
    bar.createSpan({ text: "Account", cls: "tj-filter-label" });
    const accSel = bar.createEl("select", { cls: "dropdown tj-filt-account" });
    const allOpt = accSel.createEl("option", { value: "", text: "All accounts" });
    if (!this.accountId) allOpt.setAttr("selected", "selected");

    const accounts = this.plugin.settings.propAccounts;
    const byFirm = new Map<string, { acc: (typeof accounts)[number]; type: string; label: string; order: number }[]>();
    for (const acc of accounts) {
      const firm = getFirm(acc.firmId);
      const program = getProgram(firm, acc.programId);
      const size = effectiveSize(getSize(program, acc.size), acc.rules);
      const firmLabel = firm?.name ?? "Other";
      const sizeLabel = size ? `$${(acc.size / 1000).toFixed(0)}K` : "";
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

    // Type chips (All / Demo / Evals / Fundeds / Other) — only when no account chosen
    const types = bar.createDiv({ cls: "tj-chipgroup tj-chips-inline" });
    for (const f of ACCOUNT_FILTERS) {
      const chip = types.createEl("button", { text: f.label, cls: "tj-chip" });
      if (!this.accountId && this.filter === f.id) chip.addClass("active");
      chip.addEventListener("click", () => {
        this.accountId = null;
        this.filter = f.id;
        this.render();
      });
    }

    // Period dropdown (compact) — week-based ranges + custom date pickers
    bar.createSpan({ text: "Period", cls: "tj-filter-label" });
    const periodSel = bar.createEl("select", { cls: "dropdown tj-filt-period" });
    const ranges: [string, string][] = [
      ["thisweek", "This week"],
      ["lastweek", "Last week"],
      ["1m", "This month"],
      ["all", "All time"],
      ["custom", "Custom…"],
    ];
    for (const [id, label] of ranges) {
      const opt = periodSel.createEl("option", { value: id, text: label });
      if (this.dateRange === id) opt.setAttr("selected", "selected");
    }
    periodSel.addEventListener("change", () => {
      this.dateRange = periodSel.value;
      if (this.dateRange !== "custom") {
        this.customFrom = "";
        this.customTo = "";
      }
      this.render();
    });

    // Custom date range inputs (From / To), shown only when custom selected
    if (this.dateRange === "custom") {
      const customBox = bar.createDiv({ cls: "tj-filter-custom" });
      customBox.createSpan({ text: "From", cls: "tj-filter-label" });
      const fromInput = customBox.createEl("input", { type: "date", cls: "tj-input tj-date-input" });
      fromInput.value = this.customFrom;
      fromInput.addEventListener("change", () => {
        this.customFrom = fromInput.value;
        this.render();
      });
      customBox.createSpan({ text: "To", cls: "tj-filter-label" });
      const toInput = customBox.createEl("input", { type: "date", cls: "tj-input tj-date-input" });
      toInput.value = this.customTo;
      toInput.addEventListener("change", () => {
        this.customTo = toInput.value;
        this.render();
      });
    }
  }

  renderLineChart(body: HTMLElement, trades: Trade[]): void {
    const box = body.createDiv({ cls: "tj-chart-box" });
    const svg = box.createSvg("svg", { cls: "tj-chart" });
    svg.setAttribute("viewBox", "0 0 600 200");
    svg.setAttribute("preserveAspectRatio", "none");
    const w = 600, h = 200, pad = 24;
    if (trades.length === 0) {
      box.createDiv({ text: "No data", cls: "tj-chart-empty" });
      return;
    }
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    const values: number[] = [];
    let cum = 0;
    for (const t of sorted) {
      cum += t.pnl;
      values.push(cum);
    }
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const range = max - min || 1;
    const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);

    // zero line
    const zy = y(0);
    svgLine(svg, pad, zy, w - pad, zy, "tj-chart-grid");

    let d = "";
    values.forEach((v, i) => {
      d += (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(v).toFixed(1) + " ";
    });
    // Gradient area: split above/below zero with soft translucent fills
    const id = "tjgrad" + Math.random().toString(36).slice(2, 7);
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = svg.createSvg("defs", {});
      svg.prepend(defs);
    }
    const gradUp = defs.createSvg("linearGradient", { attr: { id: id + "up", x1: "0", y1: "0", x2: "0", y2: "1" } });
    gradUp.createSvg("stop", { attr: { offset: "0%", "stop-color": "#10b981", "stop-opacity": "0.35" } });
    gradUp.createSvg("stop", { attr: { offset: "100%", "stop-color": "#10b981", "stop-opacity": "0.02" } });
    const gradDn = defs.createSvg("linearGradient", { attr: { id: id + "dn", x1: "0", y1: "0", x2: "0", y2: "1" } });
    gradDn.createSvg("stop", { attr: { offset: "0%", "stop-color": "#ef4444", "stop-opacity": "0.02" } });
    gradDn.createSvg("stop", { attr: { offset: "100%", "stop-color": "#ef4444", "stop-opacity": "0.35" } });
    const clipUp = defs.createSvg("clipPath", { attr: { id: id + "clip" } }).createSvg("rect", { attr: { x: "0", y: "0", width: String(w), height: String(zy) } });
    void clipUp;

    const areaD = `${d} L${x(values.length - 1).toFixed(1)},${zy.toFixed(1)} L${x(0).toFixed(1)},${zy.toFixed(1)} Z`;
    const areaTop = svgPath(svg, areaD, "tj-chart-area-grad");
    areaTop.setAttribute("fill", `url(#${id}up)`);
    areaTop.setAttribute("clip-path", `url(#${id}clip)`);
    const areaBottom = svgPath(svg, areaD, "tj-chart-area-grad");
    areaBottom.setAttribute("fill", `url(#${id}dn)`);
    const clipDn = defs.createSvg("clipPath", { attr: { id: id + "clipdn" } }).createSvg("rect", { attr: { x: "0", y: String(zy), width: String(w), height: String(h - zy) } });
    void clipDn;
    areaBottom.setAttribute("clip-path", `url(#${id}clipdn)`);

    // line
    svgPath(svg, d, "tj-chart-line");

    // Hover tooltip: P&L acumulado na posição do rato
    const { show, hide } = attachTooltip(box);
    const guide = svg.createSvg("line", { cls: "tj-chart-guide" });
    guide.setAttribute("y1", String(pad));
    guide.setAttribute("y2", String(h - pad));
    guide.style.display = "none";
    svg.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const xView = ((ev.clientX - rect.left) / rect.width) * w;
      const idx = clamp(Math.round(((xView - pad) / (w - pad * 2)) * (values.length - 1)), 0, values.length - 1);
      const v = values[idx];
      guide.setAttribute("x1", String(x(idx)));
      guide.setAttribute("x2", String(x(idx)));
      guide.style.display = "block";
      show(ev.clientX, ev.clientY, `${sorted[idx].date}  •  ${v >= 0 ? "+" : ""}$${v.toFixed(2)}`);
    });
    svg.addEventListener("mouseleave", () => {
      guide.style.display = "none";
      hide();
    });
  }

  renderSymbolTable(body: HTMLElement, trades: Trade[]): void {
    const groups = new Map<string, Trade[]>();
    for (const t of trades) {
      if (!groups.has(t.symbol)) groups.set(t.symbol, []);
      groups.get(t.symbol)!.push(t);
    }
    const table = body.createEl("table", { cls: "tj-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Symbol", "Trades", "Net P&L", "Win Rate"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    const entries = [...groups.entries()].sort((a, b) => {
      const pa = a[1].reduce((s, t) => s + t.pnl, 0);
      const pb = b[1].reduce((s, t) => s + t.pnl, 0);
      return pb - pa;
    });
    for (const [sym, list] of entries) {
      const pnl = list.reduce((s, t) => s + t.pnl, 0);
      const wins = list.filter((t) => t.pnl > 0).length;
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: sym });
      tr.createEl("td", { text: String(list.length) });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney2(pnl);
      tr.createEl("td", { text: `${((wins / list.length) * 100).toFixed(0)}%` });
    }
  }

  renderTradesTable(body: HTMLElement, trades: Trade[]): void {
    if (trades.length === 0) {
      body.createDiv({ cls: "tj-empty", text: "No trades for this period." });
      return;
    }
    const limit = this.plugin.settings.recentLimit;
    const rows = [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.entryTime.localeCompare(a.entryTime)).slice(0, limit > 0 ? limit : undefined);
    const bar = body.createDiv({ cls: "tj-recent-bar" });
    bar.createSpan({ text: "Show", cls: "tj-filter-label" });
    const sel = bar.createEl("select", { cls: "dropdown", attr: { title: "How many recent trades to list" } });
    const options: [number, string][] = [[5, "Last 5"], [10, "Last 10"], [20, "Last 20"], [50, "Last 50"], [0, "All"]];
    for (const [val, label] of options) {
      const opt = sel.createEl("option", { value: String(val), text: label });
      if (limit === val) opt.setAttr("selected", "selected");
    }
    if (!options.some(([val]) => val === limit)) sel.value = "0";
    sel.addEventListener("change", async () => {
      this.plugin.settings.recentLimit = parseInt(sel.value, 10) || 20;
      await this.plugin.saveSettings();
      this.render();
    });
    const table = body.createDiv({ cls: "tj-tablewrap" }).createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Symbol", "Dir", "Acct Type", "Qty", "Entry", "Exit", "P&L"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const t of rows) {
      const tr = tbody.createEl("tr");
      tr.addClass("tj-clickable");
      tr.addEventListener("click", () => this.openTrade(t));
      tr.createEl("td", { text: t.date });
      tr.createEl("td", { text: t.symbol });
      tr.createEl("td", { text: t.direction === "long" ? "L" : "S" });
      tr.createEl("td", { text: t.accountType });
      tr.createEl("td", { text: String(t.quantity) });
      tr.createEl("td", { text: String(t.entryPrice) });
      tr.createEl("td", { text: String(t.exitPrice) });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney2(t.pnl);
    }
  }

  renderMissingTable(body: HTMLElement, trades: Trade[]): void {
    const rows = [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.entryTime.localeCompare(a.entryTime)).slice(0, 30);
    const bar = body.createDiv({ cls: "tj-miss-bar" });
    const selectAll = bar.createDiv({ cls: "tj-selectall" });
    const allBox = selectAll.createEl("input", { type: "checkbox", attr: { id: "tj-select-all" } });
    selectAll.createEl("label", { text: "Select all", attr: { for: "tj-select-all" } });
    allBox.addEventListener("change", () => {
      this.checking = true;
      if (allBox.checked) for (const t of rows) this.checked.add(t.id);
      else for (const t of rows) this.checked.delete(t.id);
      this.checking = false;
      for (const [id, box] of this.checkboxEls.entries()) {
        if (rows.some((t) => t.id === id)) box.checked = this.checked.has(id);
      }
      this.updateMissButtons(bar);
    });
    const markBtn = bar.createEl("button", { text: "Mark reviewed", cls: "mod-cta" });
    const printBtn = bar.createEl("button", { text: "📷 Mark print added", cls: "mod-cta" });
    const openBtn = bar.createEl("button", { text: "Open note", cls: "tj-btn" });
    this.updateMissButtons(bar);
    markBtn.addEventListener("click", () => this.bulkMark("review", "reviewed"));
    printBtn.addEventListener("click", () => this.bulkMark("screenshot", "added"));
    openBtn.addEventListener("click", () => this.bulkOpen());
    const table = body.createDiv({ cls: "tj-tablewrap" }).createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    const cbTh = thead.createEl("th", { text: "" });
    cbTh.style.width = "26px";
    ["Date", "Symbol", "P&L", "Missing"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    this.checkboxEls = new Map();
    for (const t of rows) {
      const tr = tbody.createEl("tr");
      tr.addClass("tj-clickable");
      tr.addEventListener("click", () => this.openTrade(t));
      const box = tr.createEl("td").createEl("input", { type: "checkbox" });
      box.checked = this.checked.has(t.id);
      this.checkboxEls.set(t.id, box);
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", () => {
        if (this.checking) return;
        if (box.checked) this.checked.add(t.id);
        else this.checked.delete(t.id);
        this.updateMissButtons(bar);
        const all = rows.every((r) => this.checked.has(r.id));
        allBox.checked = all;
        allBox.indeterminate = this.checked.size > 0 && !all;
      });
      tr.createEl("td", { text: t.date });
      tr.createEl("td", { text: t.symbol });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney2(t.pnl);
      const missTd = tr.createEl("td");
      if (!(t.review && t.review.trim())) missTd.createEl("span", { text: "review", cls: "tj-badge miss" });
      if (!(t.screenshot && t.screenshot.trim())) missTd.createEl("span", { text: "print", cls: "tj-badge miss" });
    }
  }

  updateMissButtons(bar: HTMLElement): void {
    const count = this.checked.size;
    for (const btn of Array.from(bar.querySelectorAll("button"))) btn.disabled = count === 0;
  }

  async bulkMark(field: string, value: string): Promise<void> {
    const ids = [...this.checked];
    if (ids.length === 0) return;
    const files = ids.map((id) => this.app.vault.getAbstractFileByPath(id)).filter((f): f is TFile => f instanceof TFile);
    for (const file of files) await updateTradeFields(this.app, file, { [field]: value });
    this.checked.clear();
    await this.refresh();
  }

  async bulkOpen(): Promise<void> {
    const id = [...this.checked][0];
    const trade = id ? this.trades.find((t) => t.id === id) : undefined;
    if (trade) await this.openTrade(trade);
  }

  async openTrade(t: Trade): Promise<void> {
    if (!t.id) return;
    await this.plugin.openTradeModal(t);
  }

  renderHourlyBody(body: HTMLElement, trades: Trade[]): void {
    if (trades.length === 0) {
      body.createDiv({ cls: "tj-empty", text: "No trades for this period." });
      return;
    }
    const zone = this.plugin.settings.timeZone;
    const byHour = new Map<number, { pnl: number; points: number; count: number; wins: number }>();
    for (const t of trades) {
      const nyTime = toZoneTime(t.date, t.entryTime, zone);
      const hour = parseInt((nyTime || "00:00").split(":")[0] || "0", 10);
      let bucket = byHour.get(hour);
      if (!bucket) {
        bucket = { pnl: 0, points: 0, count: 0, wins: 0 };
        byHour.set(hour, bucket);
      }
      bucket.pnl += t.pnl;
      bucket.points += t.pnlPoints || 0;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    const hours = [...byHour.keys()].sort((a, b) => a - b);
    let best = -1;
    let worst = -1;
    let bestPnl = -Infinity;
    let worstPnl = Infinity;
    for (const h of hours) {
      const pnl = byHour.get(h)!.pnl;
      if (pnl > bestPnl) { bestPnl = pnl; best = h; }
      if (pnl < worstPnl) { worstPnl = pnl; worst = h; }
    }
    const kpis = body.createDiv({ cls: "tj-kpis" });
    kpiCard(kpis, "Best Hour", best >= 0 ? `${String(best).padStart(2, "0")}:00` : "—", "pos");
    kpiCard(kpis, "Worst Hour", worst >= 0 ? `${String(worst).padStart(2, "0")}:00` : "—", "neg");
    kpiCard(kpis, "Hours", `${hours.length}`, "neutral");
    const table = body.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Hour", "Trades", "Wins", "Losses", "Points", "Net P&L", "Win Rate"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const h of hours) {
      const b = byHour.get(h)!;
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: `${String(h).padStart(2, "0")}:00 – ${String(h).padStart(2, "0")}:59` });
      tr.createEl("td", { text: String(b.count) });
      tr.createEl("td", { text: String(b.wins) });
      tr.createEl("td", { text: String(b.count - b.wins) });
      const ptsTd = tr.createEl("td");
      ptsTd.addClass(b.points >= 0 ? "tj-pos" : "tj-neg");
      ptsTd.textContent = `${b.points >= 0 ? "+" : ""}${b.points.toFixed(1)}`;
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(b.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney2(b.pnl);
      tr.createEl("td", { text: `${((b.wins / b.count) * 100).toFixed(0)}%` });
    }
  }

  renderDailyBody(body: HTMLElement, trades: Trade[]): void {
    if (trades.length === 0) {
      body.createDiv({ cls: "tj-empty", text: "No trades for this period." });
      return;
    }
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const zone = this.plugin.settings.timeZone;
    const weekday = (dateStr: string) => new Date(dateStr + "T00:00:00").getDay();
    const byDay = new Map<number, { pnl: number; points: number; count: number; wins: number }>();
    const days = new Set<string>();
    for (const t of trades) {
      const nyDate = toZoneDate(t.date, t.entryTime, zone);
      days.add(nyDate);
      const wd = weekday(nyDate);
      let bucket = byDay.get(wd);
      if (!bucket) {
        bucket = { pnl: 0, points: 0, count: 0, wins: 0 };
        byDay.set(wd, bucket);
      }
      bucket.pnl += t.pnl;
      bucket.points += t.pnlPoints || 0;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    const order = [...byDay.keys()].sort((a, b) => (a + 6) % 7 - (b + 6) % 7);
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    let best = -1;
    let worst = -1;
    let bestPnl = -Infinity;
    let worstPnl = Infinity;
    let winDays = 0;
    for (const d of order) {
      const pnl = byDay.get(d)!.pnl;
      if (pnl > bestPnl) { bestPnl = pnl; best = d; }
      if (pnl < worstPnl) { worstPnl = pnl; worst = d; }
      if (pnl > 0) winDays += 1;
    }
    const kpis = body.createDiv({ cls: "tj-kpis" });
    kpiCard(kpis, "Days", `${days.size}`, "neutral");
    kpiCard(kpis, "Net P&L", fmtMoney2(net), net >= 0 ? "pos" : "neg");
    kpiCard(kpis, "Avg / Day", fmtMoney2(net / Math.max(1, days.size)), net >= 0 ? "pos" : "neg");
    kpiCard(kpis, "Win Days", `${((winDays / Math.max(1, days.size)) * 100).toFixed(0)}%`, "neutral");
    kpiCard(kpis, "Best Day", best >= 0 ? dayNames[best] : "—", "pos");
    kpiCard(kpis, "Worst Day", worst >= 0 ? dayNames[worst] : "—", worst >= 0 && byDay.get(worst)!.pnl < 0 ? "neg" : "pos");
    const table = body.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Weekday", "Trades", "Wins", "Losses", "Points", "Net P&L", "Win Rate"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const d of order) {
      const b = byDay.get(d)!;
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: dayNames[d] });
      tr.createEl("td", { text: String(b.count) });
      tr.createEl("td", { text: String(b.wins) });
      tr.createEl("td", { text: String(b.count - b.wins) });
      const ptsTd = tr.createEl("td");
      ptsTd.addClass(b.points >= 0 ? "tj-pos" : "tj-neg");
      ptsTd.textContent = `${b.points >= 0 ? "+" : ""}${b.points.toFixed(1)}`;
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(b.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney2(b.pnl);
      tr.createEl("td", { text: `${((b.wins / b.count) * 100).toFixed(0)}%` });
    }
  }
}
