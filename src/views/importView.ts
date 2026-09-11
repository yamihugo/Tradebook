import { ItemView, Notice } from "obsidian";
import type TradingJournalPlugin from "../main";
import { parseTradeovateCsv } from "../csv";
import { renderAppShell } from "../ui";
import { Trade } from "../types";

export const IMPORT_VIEW_TYPE = "trading-journal-import-view";

export class ImportView extends ItemView {
  plugin: TradingJournalPlugin;
  main!: HTMLElement;

  constructor(leaf: any, plugin: TradingJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return IMPORT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Import Tradeovate CSV";
  }

  getIcon(): string {
    return "import";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  getRules() {
    return this.plugin.getAccountRules();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-import");
    this.main = renderAppShell(root, this.plugin, "tradelog");
    this.main.createEl("h1", { text: "Import Tradeovate CSV" });
    this.main.createEl("p", {
      text: "Drop the CSV exported from Tradeovate (Reports → Executions/Fills or Orders) here. Trades are paired round-trips, P&L in dollars is computed, and accounts are split automatically into demo / evals / fundeds.",
      cls: "tj-import-info",
    });

    const drop = this.main.createEl("div", { cls: "tj-dropzone" });
    drop.createEl("div", { text: "Drop your CSV here", cls: "tj-drop-text" });
    drop.createEl("div", { text: "or click to choose a file", cls: "tj-drop-sub" });
    const fileInput = drop.createEl("input", { type: "file", attr: { accept: ".csv,text/csv" } });
    fileInput.style.display = "none";
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) this.processFile(fileInput.files[0]);
    });
    ["dragover", "dragenter"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.addClass("over");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.removeClass("over");
      })
    );
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files;
      if (file && file[0]) this.processFile(file[0]);
    });
  }

  async processFile(file: File): Promise<void> {
    const root = this.main ?? this.contentEl;
    root.createDiv({ cls: "tj-import-status" }).createDiv({
      text: `Processing "${file.name}"...`,
      cls: "tj-import-progress",
    });
    try {
      const text = await file.text();
      const result = parseTradeovateCsv(text, this.getRules());
      root.querySelector(".tj-import-status")?.remove();
      if (result.trades.length === 0) {
        const err = root.createDiv({ cls: "tj-error" });
        err.createEl("h3", { text: "No valid trades found" });
        for (const w of result.warnings) err.createEl("p", { text: w });
        err.createDiv({
          text: `Rows skipped: ${result.skipped}. Use Reports → Executions/Fills from Tradeovate and check the columns.`,
          cls: "tj-error-detail",
        });
        return;
      }
      this.showPreview(root, result.trades, result.accountsSeen);
    } catch (err) {
      root.querySelector(".tj-import-status")?.remove();
      root.createDiv({ cls: "tj-error" }).createEl("p", { text: `Error reading the file: ${(err as Error).message}` });
    }
  }

  showPreview(root: HTMLElement, trades: Trade[], accountsSeen: { name: string; type: string }[]): void {
    const preview = root.createDiv({ cls: "tj-preview" });
    const net = trades.reduce((sum, t) => sum + t.pnl, 0);
    const wins = trades.filter((t) => t.pnl > 0).length;
    const summary = preview.createDiv({ cls: "tj-preview-summary" });
    summary.createDiv({
      text: `${trades.length} trades · Net $${net >= 0 ? "+" : ""}${net.toFixed(2)} · ${((wins / trades.length) * 100).toFixed(0)}% win`,
      cls: "tj-preview-headline",
    });
    if (accountsSeen.length) {
      const accBox = preview.createDiv({ cls: "tj-preview-accounts" });
      accBox.createEl("span", { text: "Accounts detected: ", cls: "tj-filter-label" });
      const groups = new Map<string, string[]>();
      for (const a of accountsSeen) {
        if (!groups.has(a.type)) groups.set(a.type, []);
        groups.get(a.type)!.push(a.name);
      }
      for (const type of ["demo", "eval", "funded", "unknown"]) {
        const names = groups.get(type);
        if (names) {
          const chip = accBox.createEl("span", { cls: `tj-acct-chip ${type}` });
          chip.textContent = `${type}: ${names.join(", ")}`;
        }
      }
    }
    const wrap = preview.createDiv({ cls: "tj-tablewrap" });
    const table = wrap.createEl("table", { cls: "tj-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Symbol", "Dir", "Acct", "Type", "Qty", "P&L"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    const rows = [...trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
    for (const t of rows) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: t.date });
      tr.createEl("td", { text: t.symbol });
      tr.createEl("td", { text: t.direction === "long" ? "L" : "S" });
      tr.createEl("td", { text: t.account });
      tr.createEl("td", { text: t.accountType });
      tr.createEl("td", { text: String(t.quantity) });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`;
    }
    if (trades.length > 25) {
      tbody.createEl("tr").createEl("td", { text: `... and ${trades.length - 25} more`, attr: { colspan: "7" } });
    }
    const actions = preview.createDiv({ cls: "tj-preview-actions" });
    const importBtn = actions.createEl("button", { cls: "mod-cta", text: "Import all trades" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.render());
    importBtn.addEventListener("click", async () => {
      importBtn.setAttr("disabled", "true");
      importBtn.textContent = "Importing...";
      const count = await this.plugin.storeTrades(trades);
      const success = root.createDiv({ cls: "tj-success" });
      success.createDiv({ text: `${count} trades imported as markdown notes.` });
      success.createDiv({ text: `Saved to: ${this.plugin.getTradesFolder()}`, cls: "tj-success-sub" });
      actions.remove();
      wrap.remove();
      summary.remove();
      root.querySelector(".tj-preview-accounts")?.remove();
    });
  }
}
