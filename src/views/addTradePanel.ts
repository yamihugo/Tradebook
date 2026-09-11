import { Notice, normalizePath } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { parseTradeovateCsv } from "../csv";
import { futuresSpec, rootSymbol } from "../futures";
import { PrintPick } from "./printPick";
import { isDateStr, todayStr } from "../tz";

export interface AddTradePanelOptions {
  onSaveDone?: () => void;
}

interface AccountPickerHandle {
  get: () => string[];
  sync: (ids: string[]) => void;
  hasAccounts: () => boolean;
}

function renderAccountPicker(
  parent: HTMLElement,
  plugin: TradingJournalPlugin,
  onChange?: (ids: string[]) => void
): AccountPickerHandle {
  const box = parent.createDiv({ cls: "tj-acct-pick" });
  box.createDiv({ cls: "tj-form-label", text: "Copy to accounts (optional)" });
  box.createDiv({
    cls: "tj-hint",
    text: "Pick a group or tick individual prop accounts you opened the SAME trades on (trade syncer). Each gets its own copy. Leave empty to keep each trade's own account.",
  });
  const row = box.createDiv({ cls: "tj-acct-pick-row" });
  const accounts = plugin.settings.propAccounts;
  const groups = plugin.settings.accountGroups || [];
  const picked = new Set<string>();
  const chips = new Map<string, HTMLElement>();
  if (accounts.length === 0) {
    row.createDiv({ cls: "tj-hint", text: "No prop accounts configured yet — they are created under Accounts." });
  }
  // Group chips first (TradeSyncer style)
  const groupRow = box.createDiv({ cls: "tj-acct-pick-groups" });
  if (groups.length > 0) {
    for (const grp of groups) {
      const chip = groupRow.createEl("button", { cls: "tj-acct-pick-chip tj-acct-pick-group", text: grp.name });
      chip.setAttr("data-group", grp.id);
      chip.addEventListener("click", () => {
        const allIn = grp.accountIds.length > 0 && grp.accountIds.every((id) => picked.has(id));
        for (const id of grp.accountIds) {
          if (allIn) picked.delete(id);
          else picked.add(id);
        }
        for (const [id, c] of chips) c.toggleClass("active", picked.has(id));
        chip.toggleClass("active", !allIn && grp.accountIds.length > 0);
        onChange?.([...picked]);
      });
    }
  }
  for (const acc of accounts) {
    const chip = row.createEl("button", { cls: "tj-acct-pick-chip", text: acc.name });
    chips.set(acc.id, chip);
    chip.addEventListener("click", () => {
      if (picked.has(acc.id)) picked.delete(acc.id);
      else picked.add(acc.id);
      chip.toggleClass("active", picked.has(acc.id));
      for (const gc of Array.from(groupRow.querySelectorAll(".tj-acct-pick-group"))) {
        const grp = groups.find((g) => g.id === gc.getAttr("data-group"));
        if (grp) gc.toggleClass("active", grp.accountIds.every((id) => picked.has(id)));
      }
      onChange?.([...picked]);
    });
  }
  return {
    get: () => [...picked],
    sync(ids: string[]) {
      picked.clear();
      for (const id of ids) if (accounts.some((a) => a.id === id)) picked.add(id);
      for (const [id, chip] of chips) chip.toggleClass("active", picked.has(id));
      for (const gc of Array.from(groupRow.querySelectorAll(".tj-acct-pick-group"))) {
        const grp = groups.find((g) => g.id === gc.getAttr("data-group"));
        if (grp) gc.toggleClass("active", grp.accountIds.every((id) => picked.has(id)));
      }
    },
    hasAccounts: () => accounts.length > 0,
  };
}

const TABS = ["Source", "Review & Save"];

function createDefaultManualTrade(): Trade {
  return {
    id: "",
    date: todayStr(),
    entryTime: "09:30:00",
    exitTime: "09:45:00",
    symbol: "NQ",
    account: "DEMO9035758",
    accountType: "demo",
    direction: "long",
    quantity: 1,
    entryPrice: 0,
    exitPrice: 0,
    commission: 0,
    fees: 0,
    grossPnl: 0,
    pnl: 0,
    pnlPoints: 0,
    setup: "",
    mistake: "",
    review: "",
    screenshot: "",
    thesis: "",
    rating: 0,
  };
}

export class AddTradePanel {
  plugin: TradingJournalPlugin;
  onSaveDone?: () => void;
  root: HTMLElement | null = null;
  sheet: HTMLElement | null = null;
  bodyEl: HTMLElement | null = null;
  pendingImages = new Map<string, File>();
  printPicks: PrintPick[] = [];
  pasteInput: HTMLInputElement | null = null;
  pasteTarget: PrintPick | null = null;
  tab = 1;
  mode: "csv" | "manual" = "csv";
  parsed: Trade[] | null = null;
  manualTrades: Trade[] = [createDefaultManualTrade()];
  csvText = "";
  rowPicks: (PrintPick | null)[] = [];
  rowSetups: string[] = [];
  rowReviews: string[] = [];
  rowFiles: (File | null)[] = [];
  pickedAccounts = new Set<string>();
  autoAccIds: string[] = [];

  onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    let img: File | null = null;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          img = items[i].getAsFile();
          break;
        }
      }
    }
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const target =
      this.printPicks.find((p) => !p.hasFile && p.el.contains(e.target as Node)) ||
      this.printPicks.find((p) => !p.hasFile && p.el.offsetParent !== null);
    if (target) target.setFile(img);
    else new Notice("No empty print slot available right now.");
  };

  constructor(plugin: TradingJournalPlugin, opts: AddTradePanelOptions = {}) {
    this.plugin = plugin;
    this.onSaveDone = opts.onSaveDone;
  }

  mount(root: HTMLElement): void {
    this.root = root;
    this.disposePicks();
    root.addClass("tj-addpanel");
    root.addClass("tj-wizard");
    root.addEventListener("paste", this.onPaste, true);
    this.sheet = this.root.createDiv({ cls: "tj-modal-inner" });
    this.renderTabs();
  }

  dispose(): void {
    this.disposePicks();
    if (this.pasteInput) {
      this.pasteInput.remove();
      this.pasteInput = null;
    }
    this.pasteTarget = null;
    if (this.root) {
      this.root.removeEventListener("paste", this.onPaste, true);
      this.root.removeClass("tj-addpanel");
      this.root.removeClass("tj-wizard");
      this.root = null;
    }
    if (this.sheet) {
      this.sheet.empty();
      this.sheet = null;
    }
    this.bodyEl = null;
  }

  disposePicks(): void {
    this.pendingImages.clear();
    for (const p of this.printPicks) p.dispose();
    this.printPicks = [];
  }

  hasData(): boolean {
    return (this.mode === "csv" && !!this.parsed && this.parsed.length > 0) || (this.mode === "manual" && this.manualTrades.length > 0);
  }

  renderTabs(): void {
    if (!this.sheet) return;
    this.sheet.empty();
    const tabs = this.sheet.createDiv({ cls: "tj-wizard-steps" });
    TABS.forEach((label, i) => {
      const step = i + 1;
      const el = tabs.createDiv({
        cls: "tj-wizard-step" + (this.tab >= step ? " done" : "") + (this.tab === step ? " active" : ""),
      });
      el.createDiv({ cls: "tj-wizard-stepnum", text: String(step) });
      el.createDiv({ cls: "tj-wizard-steplabel", text: label });
      if (step === 1) {
        el.addEventListener("click", () => {
          this.tab = 1;
          this.renderTabs();
        });
      } else if (step === 2 && this.hasData()) {
        el.addEventListener("click", () => {
          this.tab = 2;
          this.renderTabs();
        });
      }
    });
    this.bodyEl = this.sheet.createDiv({ cls: "tj-wizard-body" });
    this.renderBody();
  }

  renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    if (this.tab === 1) this.renderSource();
    else this.renderReview();
  }

  renderSource(): void {
    const body = this.bodyEl!;
    body.empty();
    const split = body.createDiv({ cls: "tj-src-split" });

    // Left: CSV Import square with dropzone ready
    const csvCol = split.createDiv({ cls: "tj-src-col" });
    csvCol.createDiv({ cls: "tj-src-title", text: "CSV Import" });
    csvCol.createDiv({ cls: "tj-src-sub", text: "Drop your Tradeovate CSV below" });
    const drop = csvCol.createDiv({ cls: "tj-dropzone tj-csv-rect" });
    drop.createDiv({ text: "Drop your CSV here", cls: "tj-drop-text" });
    drop.createDiv({ text: "or click to choose a file", cls: "tj-drop-sub" });
    const fileInput = drop.createEl("input", { type: "file", attr: { accept: ".csv,.txt,text/csv" } });
    fileInput.style.display = "none";
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) this.processCsvFile(file);
    });
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    drop.addEventListener("dragenter", (e) => { stop(e); drop.addClass("over"); }, true);
    drop.addEventListener("dragover", (e) => { stop(e); drop.addClass("over"); }, true);
    drop.addEventListener("dragleave", (e) => { stop(e); drop.removeClass("over"); }, true);
    drop.addEventListener("drop", (e) => {
      stop(e);
      drop.removeClass("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        if (file.type.startsWith("image/")) {
          new Notice("Drop CSV files here — image prints go on review cards.");
          return;
        }
        this.processCsvFile(file);
        return;
      }
      const text = e.dataTransfer?.getData("text");
      if (text && text.trim()) this.ingestCsv(text);
    }, true);
    drop.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text");
      if (text && text.trim()) {
        e.preventDefault();
        e.stopPropagation();
        this.ingestCsv(text);
      }
    });

    // Right: Manual Trade square
    const manCol = split.createEl("button", { cls: "tj-src-col tj-src-manual-col", attr: { type: "button" } });
    manCol.createDiv({ cls: "tj-src-title", text: "Manual Trade" });
    manCol.createDiv({ cls: "tj-src-sub", text: "Fill the fields by hand" });
    manCol.createDiv({ cls: "tj-src-hint", text: "Click to open manual entry form →" });
    manCol.addEventListener("click", () => {
      this.mode = "manual";
      this.manualTrades = [createDefaultManualTrade()];
      this.rowPicks = [null];
      this.rowSetups = [""];
      this.rowReviews = [""];
      this.rowFiles = [null];
      this.tab = 2;
      this.renderTabs();
    });
  }

  renderCsvInput(area: HTMLElement): void {
    area.createEl("p", {
      text: "Drop your Tradeovate CSV below — it processes automatically and opens your review cards.",
      cls: "tj-hint",
    });
    const drop = area.createDiv({ cls: "tj-dropzone tj-csv-rect" });
    drop.createDiv({ text: "Drop your CSV here", cls: "tj-drop-text" });
    drop.createDiv({ text: "or click to choose a file", cls: "tj-drop-sub" });
    const fileInput = drop.createEl("input", { type: "file", attr: { accept: ".csv,.txt,text/csv" } });
    fileInput.style.display = "none";
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) this.processCsvFile(file);
    });
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    drop.addEventListener("dragenter", (e) => { stop(e); drop.addClass("over"); }, true);
    drop.addEventListener("dragover", (e) => { stop(e); drop.addClass("over"); }, true);
    drop.addEventListener("dragleave", (e) => { stop(e); drop.removeClass("over"); }, true);
    drop.addEventListener("drop", (e) => {
      stop(e);
      drop.removeClass("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        if (file.type.startsWith("image/")) {
          new Notice("Drop CSV files here — image prints go on review cards.");
          return;
        }
        this.processCsvFile(file);
        return;
      }
      const text = e.dataTransfer?.getData("text");
      if (text && text.trim()) this.ingestCsv(text);
    }, true);
    drop.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text");
      if (text && text.trim()) {
        e.preventDefault();
        e.stopPropagation();
        this.ingestCsv(text);
      }
    });
  }

  async processCsvFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      this.ingestCsv(text);
    } catch (err) {
      new Notice(`Could not read that file: ${(err as Error).message}`);
    }
  }

  ingestCsv(text: string): void {
    const result = parseTradeovateCsv(text, this.plugin.getAccountRules());
    if (result.trades.length === 0) {
      new Notice("No valid round-trips found in that CSV.");
      for (const w of result.warnings) new Notice(w);
      this.parsed = null;
      return;
    }
    this.parsed = result.trades;
    this.csvText = text;
    for (const p of this.printPicks) p.dispose();
    this.printPicks = [];
    this.rowPicks = result.trades.map(() => null);
    this.rowSetups = result.trades.map(() => "");
    this.rowReviews = result.trades.map(() => "");
    this.rowFiles = result.trades.map(() => null);
    this.autoAccIds = result.accountsSeen.map((a) => this.plugin.mappedAccount(a.name)?.id).filter((id): id is string => !!id);
    new Notice(`✨ ${result.trades.length} trade(s) recognized!`);
    this.tab = 2;
    this.renderTabs();
  }

  renderReview(): void {
    const body = this.bodyEl!;
    const summary = body.createDiv({ cls: "tj-preview-summary" });
    if (this.mode === "csv" && this.parsed) {
      const trades = this.parsed;
      const net = trades.reduce((s, t) => s + t.pnl, 0);
      const wins = trades.filter((t) => t.pnl > 0).length;
      summary.createDiv({
        text: `${trades.length} trades · Net $${net >= 0 ? "+" : ""}${net.toFixed(2)} · ${Math.round((wins / trades.length) * 100)}% win`,
        cls: "tj-preview-headline",
      });
    } else if (this.mode === "manual") {
      summary.createDiv({
        text: `${this.manualTrades.length} manual trade(s)`,
        cls: "tj-preview-headline",
      });
    }
    const picker = body.createDiv({ cls: "tj-review-acc-picker" });
    renderAccountPicker(picker, this.plugin, (ids) => {
      this.pickedAccounts = new Set(ids);
    }).sync(this.pickedAccounts.size ? [...this.pickedAccounts] : this.autoAccIds);

    const cards = body.createDiv({ cls: "tj-review-cards" });
    if (this.mode === "csv" && this.parsed) {
      this.parsed.forEach((t, i) => this.renderCsvCard(cards, t, i));
    } else if (this.mode === "manual") {
      this.manualTrades.forEach((t, i) => this.renderManualCard(cards, t, i));
      const addBtnRow = cards.createDiv({ cls: "tj-add-trade-row" });
      addBtnRow.createEl("button", { text: "+ Add trade", cls: "tj-btn" }).addEventListener("click", () => {
        this.manualTrades.push(createDefaultManualTrade());
        this.rowSetups.push("");
        this.rowReviews.push("");
        this.rowPicks.push(null);
        this.rowFiles.push(null);
        this.renderBody();
      });
    }

    const actions = body.createDiv({ cls: "tj-import-actions" });
    const count = this.mode === "csv" && this.parsed ? this.parsed.length : this.manualTrades.length;
    const saveBtn = actions.createEl("button", {
      text: `Save ${count} trade${count === 1 ? "" : "s"}`,
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => this.doSave(saveBtn));
  }

  renderCsvCard(parent: HTMLElement, t: Trade, i: number): void {
    const card = parent.createDiv({ cls: "tj-review-card" });
    const header = card.createDiv({ cls: "tj-review-card-header" });
    const left = header.createDiv({ cls: "tj-review-card-left" });
    const tone = t.direction === "long" ? "tj-pos" : "tj-neg";
    left.createSpan({ text: t.symbol, cls: "tj-review-card-symbol" });
    left.createSpan({ text: t.direction.toUpperCase(), cls: `tj-review-card-direction ${tone}` });
    left.createSpan({ text: `Qty ${t.quantity}`, cls: "tj-review-card-qty" });
    const right = header.createDiv({ cls: "tj-review-card-right" });
    const pnlTone = t.pnl >= 0 ? "tj-pos" : "tj-neg";
    right.createSpan({ text: `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`, cls: `tj-review-card-pnl ${pnlTone}` });
    card.createDiv({ cls: "tj-review-card-meta", text: `${t.date} @ ${t.entryTime} · ${t.account}` });
    const fields = card.createDiv({ cls: "tj-review-card-fields" });
    const setupField = fields.createDiv({ cls: "tj-review-card-field" });
    setupField.createEl("label", { text: "Setup", cls: "tj-form-label" });
    const setupInput = setupField.createEl("input", { attr: { placeholder: "e.g. TMM Reversal..." } });
    setupInput.value = this.rowSetups[i] ?? "";
    setupInput.addEventListener("input", () => {
      this.rowSetups[i] = setupInput.value;
    });
    const reviewField = fields.createDiv({ cls: "tj-review-card-field" });
    reviewField.createEl("label", { text: "Notes / Review", cls: "tj-form-label" });
    const reviewInput = reviewField.createEl("textarea", { attr: { placeholder: "How did you execute this trade?...", rows: "2" } });
    reviewInput.value = this.rowReviews[i] ?? "";
    reviewInput.addEventListener("input", () => {
      this.rowReviews[i] = reviewInput.value;
    });
    const printField = fields.createDiv({ cls: "tj-review-card-field" });
    printField.createEl("label", { text: "Screenshot / Chart Print", cls: "tj-form-label" });
    const printBox = printField.createDiv({ cls: "tj-review-card-print-container" });
    if (this.rowPicks[i]) {
      printBox.appendChild(this.rowPicks[i]!.el);
    } else {
      const pick = new PrintPick(printBox, {
        compact: true,
        tag: "csv",
        onChange: (has) => {
          if (has) {
            this.rowFiles[i] = pick.getFile();
            this.rowPicks[i] = pick;
          } else {
            this.rowFiles[i] = null;
          }
        },
      });
      this.printPicks.push(pick);
      this.rowPicks[i] = pick;
      if (this.rowFiles[i]) pick.setFile(this.rowFiles[i]!);
    }
    const pasteBtn = printBox.createEl("button", { text: "Paste Print", cls: "tj-btn" });
    pasteBtn.setAttribute("title", "Paste screenshot from clipboard directly for this specific trade.");
    pasteBtn.addEventListener("click", () => this.pasteTo(this.rowPicks[i]));
  }

  renderManualCard(parent: HTMLElement, t: Trade, i: number): void {
    const card = parent.createDiv({ cls: "tj-review-card tj-manual-card" });
    const top = card.createDiv({ cls: "tj-manual-card-top" });
    top.createEl("h4", { text: `Manual Trade #${i + 1}` });
    if (this.manualTrades.length > 1) {
      top.createEl("button", { text: "✕ Remove", cls: "tj-btn" }).addEventListener("click", () => {
        this.manualTrades.splice(i, 1);
        this.rowSetups.splice(i, 1);
        this.rowReviews.splice(i, 1);
        this.rowPicks.splice(i, 1);
        this.rowFiles.splice(i, 1);
        this.renderBody();
      });
    }

    const grid = card.createDiv({ cls: "tj-form-grid" });
    const today = todayStr();
    const fields: { key: string; label: string; val: string; ph?: string }[] = [
      { key: "date", label: "Date (YYYY-MM-DD)", val: t.date || today, ph: "YYYY-MM-DD" },
      { key: "account", label: "Account", val: t.account || "DEMO9035758", ph: "DEMO9035758" },
      { key: "symbol", label: "Symbol", val: t.symbol || "NQ", ph: "NQ, ES..." },
      { key: "qty", label: "Quantity", val: String(t.quantity || 1), ph: "1" },
      { key: "entry", label: "Entry price", val: t.entryPrice ? String(t.entryPrice) : "", ph: "29000" },
      { key: "exit", label: "Exit price", val: t.exitPrice ? String(t.exitPrice) : "", ph: "29010" },
      { key: "entryTime", label: "Entry time (HH:MM)", val: t.entryTime || "09:30:00", ph: "09:30:00" },
      { key: "exitTime", label: "Exit time (HH:MM)", val: t.exitTime || "09:45:00", ph: "09:45:00" },
    ];
    for (const f of fields) {
      const field = grid.createDiv({ cls: "tj-form-field" });
      field.createEl("label", { text: f.label, cls: "tj-form-label" });
      const input = field.createEl("input", { attr: { value: f.val, placeholder: f.ph || "" } });
      input.addEventListener("input", () => {
        if (f.key === "date") t.date = input.value.trim();
        if (f.key === "account") t.account = input.value.trim();
        if (f.key === "symbol") t.symbol = rootSymbol(input.value);
        if (f.key === "qty") t.quantity = parseFloat(input.value) || 1;
        if (f.key === "entry") t.entryPrice = parseFloat(input.value) || 0;
        if (f.key === "exit") t.exitPrice = parseFloat(input.value) || 0;
        if (f.key === "entryTime") t.entryTime = input.value.trim();
        if (f.key === "exitTime") t.exitTime = input.value.trim();
      });
    }

    const dirField = grid.createDiv({ cls: "tj-form-field" });
    dirField.createEl("label", { text: "Direction", cls: "tj-form-label" });
    const dirSel = dirField.createEl("select");
    dirSel.createEl("option", { text: "Long", value: "long", attr: t.direction === "long" ? { selected: "selected" } : {} });
    dirSel.createEl("option", { text: "Short", value: "short", attr: t.direction === "short" ? { selected: "selected" } : {} });
    dirSel.addEventListener("change", () => {
      t.direction = dirSel.value as "long" | "short";
    });

    const printField = card.createDiv({ cls: "tj-form-field tj-form-wide" });
    printField.createEl("label", { text: "Print / screenshot", cls: "tj-form-label" });
    const printBox = printField.createDiv({ cls: "tj-review-card-print-container" });
    if (this.rowPicks[i]) {
      printBox.appendChild(this.rowPicks[i]!.el);
    } else {
      const pick = new PrintPick(printBox, {
        compact: true,
        tag: "manual",
        onChange: (has) => {
          if (has) {
            this.rowFiles[i] = pick.getFile();
            this.rowPicks[i] = pick;
          } else {
            this.rowFiles[i] = null;
          }
        },
      });
      this.printPicks.push(pick);
      this.rowPicks[i] = pick;
      if (this.rowFiles[i]) pick.setFile(this.rowFiles[i]!);
    }
    const pasteBtn = printBox.createEl("button", { text: "Paste Print", cls: "tj-btn" });
    pasteBtn.addEventListener("click", () => this.pasteTo(this.rowPicks[i]));
  }

  async doSave(btn: HTMLElement): Promise<void> {
    let trades: Trade[] = [];
    if (this.mode === "csv" && this.parsed) {
      trades = this.parsed.map((t, i) => ({
        ...t,
        setup: (this.rowSetups[i] ?? "").trim(),
        screenshot: this.rowPicks[i]?.getInnerName() ?? "",
        review: (this.rowReviews[i] ?? "").trim(),
      }));
      await this.saveImages();
      trades = await this.plugin.applyBroadcast(trades, [...this.pickedAccounts]);
    } else if (this.mode === "manual") {
      for (let i = 0; i < this.manualTrades.length; i++) {
        const t = this.manualTrades[i];
        if (!t.date || !isDateStr(t.date) || !t.account || !t.symbol || isNaN(t.entryPrice) || isNaN(t.exitPrice)) {
          new Notice(`Trade #${i + 1}: Please fill date (YYYY-MM-DD), account, symbol, entry and exit prices.`);
          return;
        }
        const spec = futuresSpec(t.symbol);
        const points = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
        const pnl = points * spec.pointValue * t.quantity;
        t.pnl = Math.round(pnl * 100) / 100;
        t.grossPnl = t.pnl;
        t.pnlPoints = Math.round(points * t.quantity * 100) / 100;
        t.accountType = this.plugin.resolveAccountType(t.account);
        t.screenshot = this.rowPicks[i]?.getInnerName() ?? "";
      }
      await this.saveImages();
      trades = await this.plugin.applyBroadcast(this.manualTrades, [...this.pickedAccounts]);
    } else {
      new Notice("Nothing to save yet.");
      return;
    }
    btn.setAttr("disabled", "true");
    btn.setText("Saving...");
    const count = await this.plugin.storeTrades(trades);
    new Notice(`${count} trade(s) saved.`);
    if (count > 0) this.onSaveDone?.();
    else {
      btn.removeAttribute("disabled");
      btn.setText("Save");
    }
  }

  async pasteTo(pick: PrintPick | null): Promise<void> {
    if (!pick) {
      new Notice("No empty print slot available right now.");
      return;
    }
    try {
      const clipboard = navigator.clipboard;
      if (clipboard?.read) {
        const items = await clipboard.read();
        for (const item of items) {
          const type = (item.types || []).find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            const file = new File([blob], `print-${Date.now()}.png`, { type });
            pick.setFile(file);
            new Notice("Print pasted to the slot.");
            return;
          }
        }
        new Notice("Clipboard has no image right now — copy one first.");
        return;
      }
    } catch {
      // fall through to fallback
    }
    if (!this.pasteInput) {
      this.pasteInput = document.createElement("input");
      this.pasteInput.setAttribute("type", "text");
      this.pasteInput.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;";
      document.body.appendChild(this.pasteInput);
      this.pasteInput.addEventListener("paste", (e) => {
        const file = e.clipboardData?.files?.[0];
        if (file) {
          e.preventDefault();
          e.stopPropagation();
          this.pasteTarget?.setFile(file);
        }
      }, true);
    }
    this.pasteTarget = pick;
    this.pasteInput.focus();
    new Notice("Clipboard ready — press Ctrl+V (or ⌘V) to paste the print.");
  }

  async saveImages(): Promise<void> {
    for (const pick of this.printPicks) {
      const name = pick.getInnerName();
      const file = pick.getFile();
      if (name && file) this.pendingImages.set(name, file);
    }
    if (this.pendingImages.size === 0) return;
    const dir = normalizePath(this.plugin.getTradesFolder() + "/prints");
    if (!this.plugin.app.vault.getAbstractFileByPath(dir)) {
      await this.plugin.app.vault.createFolder(dir);
    }
    for (const [name, file] of this.pendingImages) {
      const path = normalizePath(dir + "/" + name);
      if (!this.plugin.app.vault.getAbstractFileByPath(path)) {
        const buffer = await file.arrayBuffer();
        await this.plugin.app.vault.createBinary(path, buffer);
      }
    }
    this.pendingImages.clear();
  }
}
