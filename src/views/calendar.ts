import { ItemView } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { ACCOUNT_FILTERS, kpiCard, renderAppShell } from "../ui";
import { fmtMoney, isFiniteNumber, toZoneDate } from "../tz";

export const CALENDAR_VIEW_TYPE = "trading-journal-calendar-view";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export class CalendarView extends ItemView {
  plugin: TradingJournalPlugin;
  trades: Trade[] = [];
  acct = "all";
  year: number;
  month: number;
  labelEl!: HTMLElement;
  kpiEl!: HTMLElement;
  gridEl!: HTMLElement;

  constructor(leaf: any, plugin: TradingJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  }

  getViewType(): string {
    return CALENDAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Performance Calendar";
  }

  getIcon(): string {
    return "calendar";
  }

  async onOpen(): Promise<void> {
    this.trades = await this.plugin.loadTrades();
    this.render();
  }

  async onClose(): Promise<void> {}

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTrades();
    if (this.contentEl.childElementCount > 0) this.draw();
    else this.render();
  }

  dayKey(t: Trade): string {
    return toZoneDate(t.date, t.entryTime, this.plugin.settings.timeZone);
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    const main = renderAppShell(root, this.plugin, "calendar");
    // root.addClass("tj-calendar");
    main.addClass("tj-cal-main");
    main.addClass("tj-calendar");

    const bar = main.createDiv({ cls: "tj-filterbar" });
    bar.createSpan({ text: "Account:", cls: "tj-filter-label" });
    const chips = bar.createDiv({ cls: "tj-chipgroup" });
    for (const f of ACCOUNT_FILTERS) {
      const chip = chips.createEl("button", { text: f.label, cls: "tj-chip" });
      if (this.acct === f.id) chip.addClass("active");
      chip.addEventListener("click", () => {
        this.acct = f.id;
        this.render();
      });
    }

    const nav = main.createDiv({ cls: "tj-cal-nav" });
    nav.createEl("button", { text: "‹", cls: "tj-btn", attr: { title: "Previous month" } }).addEventListener("click", () => this.shiftMonth(-1));
    this.labelEl = nav.createEl("span", { cls: "tj-cal-label" });
    nav.createEl("button", { text: "›", cls: "tj-btn", attr: { title: "Next month" } }).addEventListener("click", () => this.shiftMonth(1));
    nav.createEl("button", { text: "Today", cls: "tj-chip" }).addEventListener("click", () => {
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth();
      this.draw();
    });
    this.kpiEl = main.createDiv({ cls: "tj-kpis" });
    this.gridEl = main.createDiv({ cls: "tj-cal-grid" });
    this.draw();
  }

  shiftMonth(delta: number): void {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.draw();
  }

  filtered(): Trade[] {
    return this.trades.filter((t) => isFiniteNumber(t.pnl) && t.date && (this.acct === "all" || t.accountType === this.acct));
  }

  draw(): void {
    const trades = this.filtered();
    const byDay = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of trades) {
      const key = this.dayKey(t);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { pnl: 0, count: 0, wins: 0 };
        byDay.set(key, bucket);
      }
      bucket.pnl += t.pnl;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    const prefix = `${this.year}-${String(this.month + 1).padStart(2, "0")}`;
    let net = 0;
    let count = 0;
    let wins = 0;
    let days = 0;
    let winDays = 0;
    for (const [key, b] of byDay) {
      if (key.startsWith(prefix)) {
        net += b.pnl;
        count += b.count;
        wins += b.wins;
        days += 1;
        if (b.pnl > 0) winDays += 1;
      }
    }
    const kpis = this.kpiEl;
    kpis.empty();
    kpiCard(kpis, "Net P&L", `${net >= 0 ? "+" : ""}$${net.toFixed(2)}`, net >= 0 ? "pos" : "neg");
    kpiCard(kpis, "Trades", `${count}`, "neutral");
    kpiCard(kpis, "Win Rate", count ? `${Math.round((wins / count) * 100)}%` : "—", "neutral");
    kpiCard(kpis, "Day Win Rate", days ? `${Math.round((winDays / days) * 100)}%` : "—", "neutral");
    kpiCard(kpis, "Days", `${days}`, "neutral");
    kpiCard(kpis, "Avg / Day", days ? `${net >= 0 ? "+" : ""}$${(net / days).toFixed(2)}` : "—", net >= 0 ? "pos" : "neg");
    this.labelEl.setText(new Date(this.year, this.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }));

    const grid = this.gridEl;
    grid.empty();
    for (const wd of WEEKDAYS) grid.createEl("div", { text: wd, cls: "tj-cal-wd" });
    grid.createEl("div", { cls: "tj-cal-wd tj-cal-wtotal-head", text: "Wk" });

    const lead = (new Date(this.year, this.month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth();
    const td = today.getDate();
    const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;
    const start = new Date(this.year, this.month, 1 - lead);
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const inMonth = d.getMonth() === this.month;
      const col = i % 7;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const bucket = byDay.get(key);
      const dayTone = inMonth && bucket ? (bucket.pnl > 0 ? " pos" : bucket.pnl < 0 ? " neg" : " be") : "";
      const cell = grid.createEl("div", {
        cls: "tj-cal-cell tj-clickable-cell" + (col < 5 ? " td" : " we") + (inMonth ? dayTone : " tj-cal-dim"),
      });
      cell.addEventListener("click", () => {
        // Small pop-up with the day summary + trades (TradeZella style).
        this.openDayLog(key);
      });
      if (inMonth && ty === d.getFullYear() && tm === d.getMonth() && td === d.getDate()) cell.addClass("today");
      cell.createDiv({ cls: "tj-cal-num" + (bucket || !inMonth ? "" : " tj-cal-muted"), text: String(d.getDate()) });
      if (bucket) {
        const pnl = cell.createDiv({ cls: "tj-cal-pnl" });
        pnl.addClass(bucket.pnl > 0 ? "tj-pos" : bucket.pnl < 0 ? "tj-neg" : "tj-be");
        pnl.textContent = `${bucket.pnl >= 0 ? "+" : ""}$${bucket.pnl.toFixed(0)}`;
        cell.createDiv({ cls: "tj-cal-trades", text: `${bucket.count} tr · ${Math.round((bucket.wins / bucket.count) * 100)}%` });
        cell.setAttr("title", `${key} — ${bucket.count} trades, ${bucket.wins} wins, ${bucket.pnl >= 0 ? "+" : ""}$${bucket.pnl.toFixed(2)}`);
      }
      if (i % 7 === 6) {
        const weekNum = Math.floor(i / 7) + 1;
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - 6);
        let wPnl = 0;
        let wCount = 0;
        let wWins = 0;
        for (let u = 0; u < 7; u++) {
          const dd = new Date(weekStart);
          dd.setDate(dd.getDate() + u);
          const wk = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
          const wb = byDay.get(wk);
          if (wb) {
            wPnl += wb.pnl;
            wCount += wb.count;
            wWins += wb.wins;
          }
        }
        const wcell = grid.createEl("div", { cls: "tj-cal-wtotal" + (wCount > 0 ? (wPnl >= 0 ? " pos" : " neg") : "") });
        wcell.createDiv({ cls: "tj-cal-wknum", text: `Week ${weekNum}` });
        if (wCount > 0) {
          wcell.createDiv({ cls: "tj-cal-wrate", text: `${Math.round((wWins / wCount) * 100)}%` });
          wcell.createDiv({ cls: "tj-cal-wpnl", text: `${wPnl >= 0 ? "+" : ""}$${wPnl.toFixed(0)}` });
          wcell.createDiv({ cls: "tj-cal-wtrades", text: `${wCount} tr` });
          wcell.setAttr("title", `Week ${weekNum} — ${wCount} trades, ${wWins} wins, ${wPnl >= 0 ? "+" : ""}$${wPnl.toFixed(2)}`);
        } else {
          wcell.createDiv({ cls: "tj-cal-wrate tj-cal-muted", text: "—" });
        }
      }
    }
  }

  openDayLog(dateKey: string): void {
    const allTradesForDay = this.trades.filter((t) => isFiniteNumber(t.pnl) && t.date && this.dayKey(t) === dateKey);
    const overlay = document.body.createDiv({ cls: "tj-modal-overlay" });
    const modal = overlay.createDiv({ cls: "tj-modal tj-day-log-modal" });

    const head = modal.createDiv({ cls: "tj-modal-head" });
    head.createEl("h2", { text: `Trading Log — ${dateKey}` });
    const closeBtn = head.createEl("button", { text: "✕", cls: "tj-btn tj-mini" });
    closeBtn.addEventListener("click", () => overlay.remove());

    // Day summary strip (TradeZella style): Net P&L, trades, win rate.
    const dayNet = allTradesForDay.reduce((s, t) => s + t.pnl, 0);
    const wins = allTradesForDay.filter((t) => t.pnl > 0).length;
    const summary = modal.createDiv({ cls: "tj-kpis tj-day-log-summary" });
    kpiCard(summary, "Net P&L", `${dayNet >= 0 ? "+" : ""}$${dayNet.toFixed(2)}`, dayNet > 0 ? "pos" : dayNet < 0 ? "neg" : "neutral");
    kpiCard(summary, "Trades", `${allTradesForDay.length}`, "neutral");
    kpiCard(summary, "Win Rate", allTradesForDay.length ? `${Math.round((wins / allTradesForDay.length) * 100)}%` : "—", "neutral");
    kpiCard(summary, "Result", allTradesForDay.length === 0 ? "No trades" : dayNet > 0 ? "Winning day" : dayNet < 0 ? "Losing day" : "Break-even", dayNet > 0 ? "pos" : dayNet < 0 ? "neg" : "neutral");

    const filterBar = modal.createDiv({ cls: "tj-filterbar" });
    filterBar.createSpan({ text: "Filter:", cls: "tj-filter-label" });
    let currentFilter = "all";
    const chips = filterBar.createDiv({ cls: "tj-chipgroup" });
    const contentBox = modal.createDiv({ cls: "tj-day-log-content" });

    const renderList = (filterScope: string) => {
      contentBox.empty();
      const filtered = allTradesForDay.filter((t) => filterScope === "all" || t.accountType === filterScope);
      if (filtered.length === 0) {
        contentBox.createDiv({ cls: "tj-empty", text: "No trades found for this filter on this day." });
        return;
      }
      const table = contentBox.createEl("table", { cls: "tj-table tj-trades-table" });
      const thead = table.createEl("thead").createEl("tr");
      ["Symbol", "Scope", "Dir", "Qty", "Entry", "Exit", "P&L"].forEach((h) => thead.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      for (const t of filtered) {
        const tr = tbody.createEl("tr", { cls: "tj-clickable-row" });
        tr.createEl("td", { text: t.symbol });
        tr.createEl("td", { text: t.accountType });
        tr.createEl("td", { text: t.direction === "long" ? "Long" : "Short" });
        tr.createEl("td", { text: String(t.quantity) });
        tr.createEl("td", { text: t.entryPrice ? String(t.entryPrice) : "—" });
        tr.createEl("td", { text: t.exitPrice ? String(t.exitPrice) : "—" });
        const pnlTd = tr.createEl("td");
        pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
        pnlTd.textContent = fmtMoney(t.pnl);
        tr.addEventListener("click", async () => {
          if (!t.id) return;
          overlay.remove();
          await this.plugin.openTradeDetail(t);
        });
      }
    };

    for (const f of ACCOUNT_FILTERS) {
      const chip = chips.createEl("button", { text: f.label, cls: "tj-chip" + (currentFilter === f.id ? " active" : "") });
      chip.addEventListener("click", () => {
        currentFilter = f.id;
        chips.querySelectorAll(".tj-chip").forEach((c) => c.removeClass("active"));
        chip.addClass("active");
        renderList(currentFilter);
      });
    }

    renderList("all");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
}
