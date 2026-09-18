import type TradebookPlugin from "../main";
import { parseTradeovateCsv } from "../csv";
import { Trade } from "../types";
import { TIMEZONE_OPTIONS, detectSystemZone, zoneShortLabel } from "../tz";

/**
 * Reusable CSV import UI (dropzone → preview → import). Shared by the Import
 * view and the "Add Trade → Import" tab so both look and behave the same.
 */
export function renderImportUI(plugin: TradebookPlugin, container: HTMLElement): void {
  container.empty();
  container.addClass("tj-import-ui");

  container.createEl("p", {
    text: "Drop the CSV exported from Tradeovate (Reports → Executions/Fills or Orders). Round-trips are paired, P&L in dollars is computed, and accounts are split automatically into demo / evals / fundeds.",
    cls: "tj-import-info",
  });

  const detected = detectSystemZone();
  const zoneRow = container.createDiv({ cls: "tj-import-zone" });
  zoneRow.createEl("span", { text: "Times in this file are in", cls: "tj-import-zone-label" });
  const zoneSel = zoneRow.createEl("select", { cls: "dropdown" });
  zoneSel.createEl("option", { value: "", text: `This computer (${detected})` });
  for (const opt of TIMEZONE_OPTIONS) if (opt.zone) zoneSel.createEl("option", { value: opt.zone, text: opt.label });
  zoneSel.value = plugin.settings.importZone || "";
  zoneSel.addEventListener("change", () => {
    plugin.settings.importZone = zoneSel.value;
    void plugin.saveSettings();
  });
  zoneRow.createEl("span", {
    text: `→ saved in ${zoneShortLabel(plugin.settings.timeZone) || "recorded"} time`,
    cls: "tj-import-zone-arrow",
  });

  const drop = container.createEl("div", { cls: "tj-dropzone" });
  drop.createEl("div", { text: "Drop your CSV here", cls: "tj-drop-text" });
  drop.createEl("div", { text: "or click to choose a file", cls: "tj-drop-sub" });
  const fileInput = drop.createEl("input", { type: "file", attr: { accept: ".csv,text/csv" } });
  fileInput.style.display = "none";
  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) void processFile(plugin, container, f);
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
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) void processFile(plugin, container, f);
  });
}

async function processFile(plugin: TradebookPlugin, container: HTMLElement, file: File): Promise<void> {
  container.createDiv({ cls: "tj-import-status" }).createDiv({
    text: `Processing "${file.name}"...`,
    cls: "tj-import-progress",
  });
  try {
    const text = await file.text();
    const sourceZone = plugin.settings.importZone || detectSystemZone();
    const result = parseTradeovateCsv(text, plugin.getAccountRules(), {
      sourceZone,
      journalZone: plugin.settings.timeZone,
    });
    container.querySelector(".tj-import-status")?.remove();
    if (result.trades.length === 0) {
      const err = container.createDiv({ cls: "tj-error" });
      err.createEl("h3", { text: "No valid trades found" });
      for (const w of result.warnings) err.createEl("p", { text: w });
      err.createDiv({
        text: `Rows skipped: ${result.skipped}. Use Reports → Executions/Fills from Tradeovate and check the columns.`,
        cls: "tj-error-detail",
      });
      return;
    }
    showPreview(plugin, container, result.trades, result.accountsSeen);
  } catch (err) {
    container.querySelector(".tj-import-status")?.remove();
    container.createDiv({ cls: "tj-error" }).createEl("p", { text: `Error reading the file: ${(err as Error).message}` });
  }
}

function showPreview(
  plugin: TradebookPlugin,
  container: HTMLElement,
  trades: Trade[],
  accountsSeen: { name: string; type: string }[]
): void {
  const preview = container.createDiv({ cls: "tj-preview" });
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
  actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => renderImportUI(plugin, container));
  importBtn.addEventListener("click", async () => {
    importBtn.setAttr("disabled", "true");
    importBtn.textContent = "Importing...";
    const count = await plugin.storeTrades(trades);
    const success = container.createDiv({ cls: "tj-success" });
    success.createDiv({ text: `${count} trades imported as markdown notes.` });
    success.createDiv({ text: `Saved to: ${plugin.getTradesFolder()}`, cls: "tj-success-sub" });
    actions.remove();
    wrap.remove();
    summary.remove();
    container.querySelector(".tj-preview-accounts")?.remove();
  });
}
