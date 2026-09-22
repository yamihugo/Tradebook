import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { accountFilters, kpiCard } from "../ui";
import { fmtMoney, isFiniteNumber, toZoneDate } from "../tz";

/**
 * Reusable day-log modal (TradeZella style). Used by the Calendar view and the
 * dashboard's Performance Calendar widget.
 */
export function openDayLogModal(plugin: TradebookPlugin, allTrades: Trade[], dateKey: string, timeZone: string): void {
  const dayKey = (t: Trade) => toZoneDate(t.date, t.entryTime, timeZone);
  const allTradesForDay = allTrades.filter((t) => isFiniteNumber(t.pnl) && t.date && dayKey(t) === dateKey);
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
  kpiCard(summary, "P&L", `${dayNet >= 0 ? "+" : ""}$${dayNet.toFixed(2)}`, dayNet > 0 ? "pos" : dayNet < 0 ? "neg" : "neutral");
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
    const filtered = allTradesForDay.filter((t) => filterScope === "all" || (plugin.mappedAccount(t.account)?.type ?? t.accountType) === filterScope);
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
      tr.createEl("td", { text: (plugin.mappedAccount(t.account)?.type ?? t.accountType) || "—" });
      tr.createEl("td", { text: t.direction === "long" ? "Long" : "Short" });
      tr.createEl("td", { text: String(t.quantity) });
      tr.createEl("td", { text: t.entryPrice ? String(t.entryPrice) : "—" });
      tr.createEl("td", { text: t.exitPrice ? String(t.exitPrice) : "—" });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney(t.pnl);
      tr.addEventListener("click", async () => {
        if (!t.id) return;
        // Open the trade pop-up ON TOP of the day log — closing it returns to the calendar.
        await plugin.openTradeModal(t);
      });
    }
  };

  for (const f of accountFilters()) {
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
