import { Modal, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { csvKind, mergeCashCosts, parseCashHistoryCsv, parseTradeovateCsv } from "../csv";
import type { CashCosts } from "../csv";
import type { ImportCosts, ParsedResult, PropAccount, TimeIssues, Trade } from "../types";
import { TIMEZONE_OPTIONS, detectSystemZone, fmtMoney2, zoneShortLabel } from "../tz";
import { copierPresentation } from "../lib/copy";
import { excludeSuperseded } from "../lib/copySupersession";
import { effectiveSelection, newImportSelection } from "../lib/importSelection";
import { primaryImportIdentity } from "../lib/importIdentity";
import {
  missingCopiers,
  planBatch,
  type BatchFileTrades,
  type BatchPlan,
} from "../lib/importBatch";
import { formatDate } from "../lib/dates";
import { computeRecordedAccountMovement } from "../lib/accountMetrics";
import { accountCashflows } from "../lib/accountCashflows";
import { tradeDayInZone } from "../lib/instant";
import { trackingStartOf } from "../lib/tracking";
import { mountDropdown } from "../lib/dropdown";
import { attachTip } from "../lib/tip";
import { netPnl } from "../lib/fees";
import { importSummary, writeOutcome } from "../lib/importReport";
import { applyAssumedRisk, type AssumedRiskResult } from "../lib/risk";
import type { DropdownItem } from "../lib/dropdown";

/**
 * "Import CSV" as a pop-up.
 *
 * The file is read, never trusted: the parser says what it recognised, the
 * reader says which account those trades belong to (a CSV name is not an
 * account id), and nothing is written until the button is pressed. Duplicates
 * are matched by fill id, so re-importing the same file never doubles a trade.
 */

interface ParsedFile {
  name: string;
  /** Every trade file in the batch, in drop order. */
  files: string[];
  trades: Trade[];
  skipped: number;
  unfilled: number;
  unpaired: number;
  /** Rows left out because their timestamp has no single instant (never guessed). */
  timeIssues?: TimeIssues;
  warnings: string[];
  /** What the default-risk rules did to this file, shown in the preview. */
  risk?: AssumedRiskResult;
  accountsSeen: { name: string; type: string }[];
  /** Present when the platform's cash history came with the trades file. */
  costs?: ImportCosts;
  /** Name of the cash history file, when one was dropped alongside. */
  costFileName?: string;
}

export function openImportCsvModal(plugin: TradebookPlugin, onChange?: () => void): void {
  new ImportCsvModal(plugin, onChange).open();
}

class ImportCsvModal extends Modal {
  private plugin: TradebookPlugin;
  private onChange?: () => void;
  private fileEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private busy = false;

  /** CSV account name → journal account id ("" = leave unassigned). */
  private mapping = new Map<string, string>();
  /** The ticked extra targets: configured copiers by default, then the trader's word. */
  private includeIds = new Set<string>();
  /** The session's explicit ticks and unticks, scoped to the mapped leader set. */
  private selection = newImportSelection();
  private parsed: ParsedFile | null = null;
  /** The batch plan: detected accounts, dedupe counts and the write split. */
  private plan: BatchPlan | null = null;
  /** The parsed trades of each dropped file, for grouping by detected account. */
  private batchFiles: BatchFileTrades[] = [];
  private importable: Trade[] = [];
  private duplicates = 0;
  /** The journal as it stands, loaded once so the balance preview can count it. */
  private existing: Trade[] = [];
  private actionsEl: HTMLElement | null = null;
  /** The one action, kept so the guard can enable or disable it without a repaint. */
  private goBtn: HTMLButtonElement | null = null;
  /** The reason the action is asleep, shown only while it is. */
  private helperEl: HTMLElement | null = null;
  /** The stage strip: Files → Review → Import. */
  private stageEl: HTMLElement | null = null;
  /** True once a write has been confirmed, so the strip can close out. */
  private imported = false;

  // The trades and the costs are two separate decisions: the files with the
  // trades, and — only if the trader wants the exact bill — the platform's own
  // cash history for the same period.
  private tradeFiles: { name: string; text: string }[] = [];
  private wantCosts = false;
  private cashName = "";
  private cashCosts: CashCosts | null = null;
  private cashEl: HTMLElement | null = null;
  private cashError = "";
  private costToggle: HTMLInputElement | null = null;
  /** The one decision: which account these trades belong to, and who else took them. */
  private pickEl: HTMLElement | null = null;
  /** Step two lives here: the timezone and the costs boxes. */
  private setupEl: HTMLElement | null = null;
  /** The one-line recommendation, replaced by a shorter note once a file is in. */
  private headSubEl: HTMLElement | null = null;
  /** "Trades" is a heading while the box is empty, and noise once it holds a file. */
  private tradesTitleEl: HTMLElement | null = null;
  /** Registered strategies, loaded once — the import's Setup field offers them. */
  private knownSetups: string[] = [];
  /** The strategy applied to every trade in the file ("" = leave them unfiled). */
  private setupPick = "";
  /** Mark the whole file reviewed, without writing it up. */
  private markAllReviewed = false;

  constructor(plugin: TradebookPlugin, onChange?: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  onOpen(): void {
    this.modalEl.addClass("tj-import-modal");
    this.render();
    void this.loadSetups();
  }

  /** Load the registry; pre-fill when there is exactly one strategy to choose. */
  private async loadSetups(): Promise<void> {
    try {
      this.knownSetups = await this.plugin.knownSetups();
    } catch {
      this.knownSetups = [];
    }
    if (!this.setupPick && this.knownSetups.length === 1) this.setupPick = this.knownSetups[0];
    if (this.parsed && this.bodyEl) await this.renderReview();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------- scaffold

  private render(): void {
    const c = this.contentEl;
    c.empty();

    const head = c.createDiv({ cls: "tj-import-head" });
    setIcon(head.createSpan({ cls: "tj-import-headico" }), "upload");
    const txt = head.createDiv({ cls: "tj-import-headtxt" });
    txt.createEl("h2", { text: "Import trades from CSV" });
    // One recommendation, one line. The longer explanation belongs to the
    // moment a file is being read, not to the moment it is being chosen.
    this.headSubEl = txt.createEl("p", {
      cls: "tj-import-sub",
      text: "Reports → Orders is recommended. Reports → Fills works too.",
    });

    // The journey, so the reader always knows where he is and what is left. It
    // is orientation, not a gate — every stage is still on one page, and each
    // section below carries the number it has here.
    this.stageEl = c.createDiv({ cls: "tj-import-stages" });
    this.renderStages();

    // Files come first and nothing else: the times and the costs are decided
    // once there is a file to decide about.
    const trades = c.createDiv({ cls: "tj-import-block" });
    this.tradesTitleEl = this.stepHead(trades, "Files");
    this.fileEl = trades.createDiv({ cls: "tj-import-file" });
    this.renderDropzone(this.fileEl);

    // Inside Review, the account comes before the times and the costs: it is the
    // decision every other number on this screen depends on, so it is asked first.
    this.pickEl = c.createDiv();

    // The Time and Costs sub-areas. They stay empty until a file is recognised.
    this.setupEl = c.createDiv({ cls: "tj-import-setup" });

    this.bodyEl = c.createDiv({ cls: "tj-import-result" });
  }

  /**
   * The platform's costs live in a file of their own, and they are a decision of
   * their own. Off by default: without the cash history the journal records no
   * cost at all, because a half-counted one would be a number nobody was billed.
   */
  private renderCosts(host: HTMLElement): void {
    this.stepHead(host, "Costs", {
      text: !this.wantCosts ? "Optional" : this.cashCosts ? "Ready" : "Needs a file",
      tone: !this.wantCosts ? "optional" : this.cashCosts ? "ready" : "warn",
      needs: this.wantCosts && !this.cashCosts,
    });
    const box = host.createDiv({ cls: "tj-import-costsbox" });
    const head = box.createDiv({ cls: "tj-import-costshead" });
    const sw = head.createEl("label", { cls: "tj-import-switch" });
    const cb = sw.createEl("input", { type: "checkbox" });
    cb.checked = this.wantCosts;
    this.costToggle = cb;
    sw.createSpan({ cls: "tj-import-switch-track" });
    head.createDiv({ cls: "tj-import-coststitle", text: "Record the platform's fees" });
    // One line: what it needs and where it comes from.
    box.createDiv({
      cls: "tj-import-costssub",
      text: "Needs the Cash History CSV for the same period.",
    });
    cb.addEventListener("change", () => {
      this.wantCosts = cb.checked;
      if (!this.wantCosts) {
        this.cashCosts = null;
        this.cashName = "";
      }
      this.renderCostsBlock();
      if (this.parsed) void this.parseTrades();
    });

    this.cashEl = box.createDiv({ cls: "tj-import-cashslot" });
    this.renderCostsBlock();
  }

  /** The slot under the toggle: the cash history, or the plain reason it matters. */
  private renderCostsBlock(): void {
    if (!this.cashEl) return;
    this.cashEl.empty();
    if (!this.wantCosts) {
      const off = this.cashEl.createDiv({ cls: "tj-import-costsoff" });
      setIcon(off.createSpan({ cls: "tj-import-costsoff-ico" }), "info");
      off.createSpan({
        text:
          "Fees not recorded — the trades keep their gross P&L.",
      });
      return;
    }

    if (this.cashCosts) {
      const ok = this.cashEl.createDiv({ cls: "tj-import-cashok" });
      setIcon(ok.createSpan({ cls: "tj-import-cashok-ico" }), "check");
      ok.createSpan({
        text: `${this.cashName} recognised — ${this.cashCosts.lines} cost lines, ${fmtMoney2(-this.cashCosts.charged)} charged over this range.`,
      });
      const swap = ok.createEl("button", { cls: "tj-import-cashswap", text: "Choose another" });
      swap.addEventListener("click", () => {
        this.cashCosts = null;
        this.cashName = "";
        this.renderCostsBlock();
        if (this.parsed) void this.parseTrades();
      });
      return;
    }

    const warn = this.cashEl.createDiv({ cls: "tj-import-cashwarn" });
    setIcon(warn.createSpan({ cls: "tj-import-cashwarn-ico" }), "alert-triangle");
    warn.createSpan({
      text:
        "Waiting for the Cash History CSV of the same period.",
    });
    if (this.cashError) {
      const err = this.cashEl.createDiv({ cls: "tj-import-casherr" });
      setIcon(err.createSpan({ cls: "tj-import-casherr-ico" }), "circle-alert");
      err.createSpan({ text: this.cashError });
    }
    const drop = this.cashEl.createDiv({ cls: "tj-dropzone is-cash" });
    drop.createDiv({ cls: "tj-drop-text", text: "Drop the Cash History CSV here" });
    drop.createDiv({ cls: "tj-drop-sub", text: "or click to choose a file" });
    const input = drop.createEl("input", { type: "file", attr: { accept: ".csv,.txt,text/csv" } });
    input.setCssStyles({ display: "none" });
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      if (f) void this.readCash(f);
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
      const f = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
      if (f) void this.readCash(f);
    });
  }

  /** A naive timestamp carries no zone, so the reader has to say where it came from. */
  private renderZone(host: HTMLElement): void {
    const detected = detectSystemZone();
    // Its own box, with a title: the zone is the one thing a reader has to get
    // right before the numbers mean anything, so it does not share a line.
    this.stepHead(host, "Time", { text: "Automatic", tone: "auto" });
    const box = host.createDiv({ cls: "tj-import-zonebox" });
    // One row: the label, the zone, and where it lands. The zone is one answer,
    // not a form, so it does not get a form's worth of space.
    setIcon(box.createSpan({ cls: "tj-import-zone-ico" }), "clock");
    box.createSpan({ text: "Time files are in", cls: "tj-import-zonetitle" });
    const row = box;
    const items: DropdownItem[] = [
      { id: "", label: `This computer (${detected})` },
      ...TIMEZONE_OPTIONS.filter((o) => !!o.zone).map((o) => ({ id: o.zone, label: o.label })),
    ];
    const dd = mountDropdown(
      row,
      items,
      this.plugin.settings.importZone || "",
      (id) => {
        this.plugin.settings.importZone = id;
        void this.plugin.saveSettings();
        // A file's times carry no zone of their own, so changing this changes
        // every timestamp in the list below. Re-read it now instead of waiting
        // for the next import.
        if (this.tradeFiles.length) void this.parseTrades();
      },
      { placeholder: "This computer", title: "The zone this file's times were written in" }
    );
    dd.addClass("tj-import-zone-dd");
    // Saved the moment it is picked, so nothing has to be confirmed twice.
    box.createDiv({
      text: `Saved in ${zoneShortLabel(this.plugin.settings.timeZone) || "recorded"} time`,
      cls: "tj-import-zonenote",
    });
  }

  private renderDropzone(host: HTMLElement): void {
    host.empty();
    const drop = host.createDiv({ cls: "tj-dropzone" });
    drop.createDiv({ text: "Drop your CSV files here", cls: "tj-drop-text" });
    const sub = drop.createDiv({ text: "One file or many — all read as one batch", cls: "tj-drop-sub" });
    attachTip(sub, {
      title: "Which report",
      sub: "Reports → Orders carries every ticket with its fill time, price, status, order type and stop. Reports → Fills is the raw executions. Either one pairs the round-trips; the Performance report cannot be read.",
    });
    const fileInput = drop.createEl("input", {
      type: "file",
      attr: { accept: ".csv,.txt,text/csv", multiple: "true" },
    });
    fileInput.setCssStyles({ display: "none" });
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const files = fileInput.files ? Array.from(fileInput.files) : [];
      if (files.length) void this.handleFiles(files);
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
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (files.length) void this.handleFiles(files);
    });
  }

  /**
   * The stage strip. A stage is done once its answer exists, and the first
   * unfinished one is "on" — so the reader's eye lands on the next move.
   */
  /**
   * One section's numbered head, matching the strip at the top of the modal.
   * Four words of orientation used to be the only structure on a page with seven
   * stages, and three of the sections had no name at all.
   */
  private stepHead(
    host: HTMLElement,
    label: string,
    status?: { text: string; tone: "ready" | "auto" | "input" | "optional" | "warn"; needs?: boolean }
  ): HTMLElement {
    const head = host.createDiv({ cls: "tj-import-step" });
    head.createSpan({ cls: "tj-import-steplabel", text: label });
    if (status) {
      head.createSpan({ cls: `tj-import-stepstatus is-${status.tone}`, text: status.text });
      if (status.needs) head.setAttr("data-needs", "true");
    }
    return head;
  }

  private renderStages(): void {
    const host = this.stageEl;
    if (!host) return;
    host.empty();
    const parsed = !!this.parsed;
    // A trader makes three real decisions, not seven: choose the files, settle
    // the review, write it. The sub-areas inside Review (account mapping, the
    // group, time, costs, preview) are answers below, never top-level steps.
    const reviewed = parsed && this.baseIds().length > 0;
    const done = [parsed, reviewed, this.imported];
    const labels = ["Files", "Review", "Import"];
    let current = done.findIndex((d) => !d);
    if (current < 0) current = labels.length - 1;
    labels.forEach((label, i) => {
      if (i) host.createSpan({ cls: "tj-import-stagesep", text: "›" });
      const step = host.createSpan({
        cls: "tj-import-stage" + (done[i] ? " is-done" : "") + (i === current ? " is-on" : ""),
      });
      step.createSpan({ cls: "tj-import-stagenum", text: String(i + 1) });
      step.createSpan({ text: label });
    });
    // The first sub-area still waiting for an answer becomes the visual focus, so
    // the eye lands on the decision that is actually next.
    for (const el of Array.from(this.contentEl.querySelectorAll(".tj-import-step.is-needs"))) el.removeClass("is-needs");
    this.contentEl.querySelector(".tj-import-step[data-needs='true']")?.addClass("is-needs");
  }

  /**
   * Drop the chosen trades file and go back to the drop zone, without closing
   * the import flow. The cash history is a separate decision and stays.
   */
  private resetTradesFile(): void {
    this.tradeFiles = [];
    this.batchFiles = [];
    this.parsed = null;
    this.plan = null;
    this.importable = [];
    this.duplicates = 0;
    this.imported = false;
    this.mapping.clear();
    this.includeIds.clear();
    this.selection = newImportSelection();
    this.markAllReviewed = false;
    this.helperEl = null;
    this.goBtn = null;
    this.actionsEl = null;
    if (this.tradesTitleEl) this.tradesTitleEl.setCssStyles({ display: "" });
    if (this.headSubEl) this.headSubEl.setText("Reports → Orders is recommended. Reports → Fills works too.");
    if (this.bodyEl) this.bodyEl.empty();
    if (this.pickEl) this.pickEl.empty();
    if (this.setupEl) this.setupEl.empty();
    if (this.fileEl) this.renderDropzone(this.fileEl);
    this.renderStages();
  }

  // ------------------------------------------------------------------ parse

  /**
   * One drop, many files. Every Orders/Fills file is read as part of one batch;
   * the cash history (one or more) is merged into the costs side. Nothing is
   * written here.
   */
  private async handleFiles(files: File[]): Promise<void> {
    if (this.busy || !this.fileEl || !this.bodyEl) return;
    this.busy = true;
    const body = this.bodyEl;
    body.empty();
    body.createDiv({
      cls: "tj-import-progress",
      text: files.length > 1 ? `Recognising ${files.length} files…` : `Recognising "${files[0].name}"…`,
    });
    try {
      const texts: { name: string; text: string }[] = [];
      for (const f of files) texts.push({ name: f.name, text: await f.text() });

      const cashTexts = texts.filter((t) => csvKind(t.text) === "cash");
      const execTexts = texts.filter((t) => {
        const k = csvKind(t.text);
        return k === "orders" || k === "fills";
      });
      if (!execTexts.length) {
        body.empty();
        const err = body.createDiv({ cls: "tj-error" });
        const stray = texts.find((t) => csvKind(t.text) === "unknown");
        if (cashTexts.length && !stray) {
          // The one file is the money ledger: it belongs in the costs slot, and
          // without the Orders/Fills export there are no trades to reconstruct.
          err.createEl("h3", { text: "That is the cash history" });
          err.createDiv({
            text: "The cash history is the money ledger, not the trades. It goes in its own slot below, together with the Orders or Fills export of the same period.",
            cls: "tj-error-detail",
          });
        } else {
          err.createEl("h3", { text: "No trades export recognised" });
          if (stray) {
            err.createDiv({
              text: `"${stray.name}" is not an Orders or Fills report — its header carries neither an order id nor a fill id.`,
              cls: "tj-error-detail",
            });
          }
        }
        err.createDiv({
          text: "Export from Tradovate → Reports → Orders (recommended) or Fills.",
          cls: "tj-error-detail",
        });
        this.busy = false;
        return;
      }

      if (cashTexts.length) {
        this.wantCosts = true;
        this.cashName = cashTexts.map((c) => c.name).join(", ");
        this.cashError = "";
        this.cashCosts = mergeCashCosts(cashTexts.map((c) => parseCashHistoryCsv(c.text)));
        if (this.costToggle) this.costToggle.checked = true;
        this.renderCostsBlock();
      }

      // A new batch is a new decision. Nothing is pre-picked: a name in the CSV
      // matching an account in the journal is a coincidence of text, not an
      // instruction, and guessing it here is how trades land in the wrong place
      // while the screen says everything went fine.
      this.mapping.clear();
      this.selection = newImportSelection();

      this.tradeFiles = execTexts;
      await this.parseTrades();
      this.busy = false;
    } catch (err) {
      body.empty();
      body.createDiv({ cls: "tj-error" }).createEl("p", { text: `Error reading the file: ${(err as Error).message}` });
      this.busy = false;
    }
  }

  /** The costs file, dropped in its own slot. */
  private async readCash(file: File): Promise<void> {
    const text = await file.text();
    if (csvKind(text) !== "cash") {
      this.cashCosts = null;
      this.cashName = "";
      this.cashError = `"${file.name}" is not a cash history. Export it from Reports → Cash History as CSV.`;
      this.renderCostsBlock();
      return;
    }
    this.cashError = "";
    this.cashName = file.name;
    this.cashCosts = parseCashHistoryCsv(text);
    this.renderCostsBlock();
    if (this.tradeFiles.length) await this.parseTrades();
  }

  /** Fold the parsed results of every file into one batch view. */
  private combineParsed(
    results: { name: string; result: ParsedResult }[],
    names: string[]
  ): Omit<ParsedFile, "risk" | "costFileName"> {
    const trades: Trade[] = [];
    const warnings: string[] = [];
    const accountsSeen: { name: string; type: string }[] = [];
    const seenAccounts = new Set<string>();
    const timeIssues: TimeIssues = { gap: 0, ambiguous: 0, noZone: 0 };
    let skipped = 0;
    let unfilled = 0;
    let unpaired = 0;
    const costList: ImportCosts[] = [];
    for (const { result } of results) {
      trades.push(...result.trades);
      for (const w of result.warnings) if (!warnings.includes(w)) warnings.push(w);
      for (const a of result.accountsSeen) {
        if (seenAccounts.has(a.name)) continue;
        seenAccounts.add(a.name);
        accountsSeen.push({ name: a.name, type: String(a.type) });
      }
      skipped += result.skipped;
      unfilled += result.unfilled;
      unpaired += result.unpaired;
      if (result.timeIssues) {
        timeIssues.gap += result.timeIssues.gap;
        timeIssues.ambiguous += result.timeIssues.ambiguous;
        timeIssues.noZone += result.timeIssues.noZone;
      }
      if (result.costs) costList.push(result.costs);
    }
    const totalIssues = timeIssues.gap + timeIssues.ambiguous + timeIssues.noZone;
    const costs = costList.length ? this.mergeImportCosts(costList) : undefined;
    return {
      name: names.length === 1 ? names[0] : `${names.length} files`,
      files: names,
      trades,
      warnings,
      accountsSeen,
      skipped,
      unfilled,
      unpaired,
      ...(totalIssues ? { timeIssues } : {}),
      costs,
    };
  }

  /** Combine the per-file cost summaries; `charged` is the merged cash, once. */
  private mergeImportCosts(list: ImportCosts[]): ImportCosts {
    let charged = 0;
    let recorded = 0;
    let finalBalance: number | undefined;
    const orphans: ImportCosts["orphans"] = [];
    const seenOrphans = new Set<string>();
    for (const c of list) {
      charged = Math.max(charged, c.charged);
      recorded += c.recorded;
      if (Number.isFinite(c.finalBalance)) finalBalance = c.finalBalance;
      for (const o of c.orphans) {
        const key = `${o.date}|${o.contract}|${o.amount}`;
        if (seenOrphans.has(key)) continue;
        seenOrphans.add(key);
        orphans.push(o);
      }
    }
    return {
      charged: this.round2(charged),
      recorded: this.round2(recorded),
      ...(finalBalance !== undefined ? { finalBalance } : {}),
      orphans,
    };
  }

  /**
   * Read every trades file — with the platform's costs when we have them — as
   * one batch, and show the review. Nothing is written: this only says what was
   * recognised.
   */
  private async parseTrades(): Promise<void> {
    if (!this.bodyEl || !this.tradeFiles.length) return;
    const body = this.bodyEl;
    const importZone = this.plugin.settings.importZone;
    const zones = {
      sourceZone: importZone || detectSystemZone(),
      // "This computer" (the default) is the reader's answer, not the file's:
      // the note must not later read it as a zone the export declared.
      systemSource: !importZone,
      journalZone: this.plugin.settings.timeZone,
    };
    const rules = this.plugin.getAccountRules();
    const results: { name: string; result: ParsedResult }[] = [];
    const batchFiles: BatchFileTrades[] = [];
    for (const f of this.tradeFiles) {
      const result = parseTradeovateCsv(f.text, rules, zones, this.cashCosts ?? undefined);
      results.push({ name: f.name, result });
      batchFiles.push({ name: f.name, trades: result.trades });
    }
    this.batchFiles = batchFiles;
    body.empty();

    const combined = this.combineParsed(results, this.tradeFiles.map((f) => f.name));
    if (!combined.trades.length) {
      const err = body.createDiv({ cls: "tj-error" });
      err.createEl("h3", { text: "No trades recognised" });
      for (const w of combined.warnings) err.createEl("p", { text: w });
      err.createDiv({
        text: [
          combined.skipped ? `${combined.skipped} row(s) could not be read` : "",
          combined.unfilled ? `${combined.unfilled} order(s) never filled` : "",
          combined.unpaired ? `${combined.unpaired} fill(s) still open` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "The files have no executions this journal can pair.",
        cls: "tj-error-detail",
      });
      err.createDiv({
        text: "Export from Tradovate → Reports → Orders (recommended) or Fills and check the columns. The Performance report cannot be read — it is a screen, not a ledger.",
        cls: "tj-error-detail",
      });
      return;
    }

    // A rule the trader set for the contract fills in only what the files do
    // not say, and says so on the trade itself. It runs here, on the parsed
    // trades, so the preview below and the notes written later read the same
    // numbers.
    const risk = applyAssumedRisk(combined.trades, this.plugin.settings.defaultRiskBySymbol);
    this.parsed = { ...combined, risk, costFileName: this.cashName || undefined };
    // Re-reading is not a new decision: only a name that no longer exists in the
    // batch is dropped, so nothing dead is kept.
    const names = new Set(this.parsed.accountsSeen.map((a) => a.name));
    for (const key of [...this.mapping.keys()]) {
      if (!names.has(key)) this.mapping.delete(key);
    }
    await this.refreshAll();
  }

  /**
   * What Tradovate report this is, read from its header — never from its name.
   *
   * Asked of `csvKind`, the very gate that admitted the file, rather than of a
   * second reading of the same header: a chip that called an accepted Orders
   * export "CSV" would be the one place where the screen disagreed with the
   * reader about what the reader had in hand.
   */
  private fileKind(text: string): string {
    const kind = csvKind(text);
    if (kind === "orders") return "Orders export";
    if (kind === "fills") return "Fills export";
    return "CSV";
  }

  /** The kind of a whole batch: one name when they agree, "CSV" when they mix. */
  private batchKind(): string {
    const kinds = new Set(this.tradeFiles.map((f) => this.fileKind(f.text)));
    return kinds.size === 1 ? [...kinds][0] : "CSV";
  }

  private accounts(): PropAccount[] {
    return (this.plugin.settings.propAccounts ?? []).filter((a) => !!a && !!a.id);
  }

  /**
   * Where these trades can actually land: a CSV name mapped to a journal
   * account, or an account ticked under "also record these trades in". Nothing
   * else counts, because nothing else writes a trade anywhere.
   */
  private activeTargets(): Set<string> {
    const ids = new Set<string>();
    for (const id of this.mapping.values()) if (id) ids.add(id);
    for (const id of this.includeIds) if (id) ids.add(id);
    return ids;
  }

  /** The chosen journal accounts, in list order — the file's own answer. */
  private baseIds(): string[] {
    const out: string[] = [];
    for (const id of this.mapping.values()) if (id && !out.includes(id)) out.push(id);
    return out;
  }

  /** The one action wakes the moment there is somewhere for the trades to go. */
  private updateGo(): void {
    if (!this.goBtn) return;
    const ready = !!this.parsed && this.importable.length > 0 && this.activeTargets().size > 0;
    this.goBtn.disabled = !ready;
    if (this.helperEl) this.helperEl.style.display = this.activeTargets().size === 0 ? "" : "none";
  }

  /** How many of this batch's new trades land in a journal account. */
  private importedForAccount(accountId: string): number {
    return this.plan?.groups.find((g) => g.mappedAccountId === accountId)?.importable ?? 0;
  }

  /**
   * The accounts, sorted into what they are: the ones that lead a group, the
   * ones that follow one, and the ones that answer to nobody. A flat list of
   * similar names is exactly how the wrong account gets picked — and once a
   * leader is chosen the button keeps saying so, so the reader never has to
   * reopen the list to remember what he picked.
   */
  private accountItems(accounts: PropAccount[]): DropdownItem[] {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const leads = (a: PropAccount) => a.copyRole === "base";
    const follows = (a: PropAccount) => a.copyRole === "copier" && !!a.copyBaseId && byId.has(a.copyBaseId);
    const items: DropdownItem[] = [];

    const add = (a: PropAccount, heading?: string) => {
      if (leads(a)) {
        const n = accounts.filter((m) => follows(m) && m.copyBaseId === a.id).length;
        items.push({
          id: a.id,
          label: a.name,
          heading,
          tag: "Leader",
          tagTone: "leader",
          note: n ? `Leads ${n} account${n === 1 ? "" : "s"}` : "Leads nothing yet",
        });
        return;
      }
      if (follows(a)) {
        const base = byId.get(a.copyBaseId as string);
        items.push({
          id: a.id,
          label: a.name,
          heading,
          tag: `Copier ×${a.copyMultiplier ?? 1}`,
          tagTone: "copier",
          note: `Copies ${base?.name ?? "another account"}`,
        });
        return;
      }
      items.push({ id: a.id, label: a.name, heading, note: "On its own" });
    };

    const leaders = accounts.filter(leads);
    const copiers = accounts.filter(follows);
    const standalone = accounts.filter((a) => !leads(a) && !follows(a));
    leaders.forEach((a, i) => add(a, i === 0 ? "Leaders" : undefined));
    copiers.forEach((a, i) => add(a, i === 0 ? "Copiers" : undefined));
    standalone.forEach((a, i) => add(a, i === 0 ? "Standalone" : undefined));
    // The escape hatch goes last: it is not one of the three answers above.
    items.push({ id: "", label: "Leave unassigned", note: "These trades are not written" });
    return items;
  }

  /**
   * Where the batch's trades go. One row per **detected account** — not per
   * file — so fifty accounts are fifty answers, once. A previously mapped
   * broker account is offered as a suggestion and only applied when confirmed.
   */
  private renderPick(): void {
    if (!this.pickEl) return;
    const host = this.pickEl;
    host.empty();
    if (!this.parsed || !this.plan) return;
    const accounts = this.accounts();
    if (!accounts.length) return;

    const groups = this.plan.groups;
    const chosen = this.baseIds();
    // The step head sits OUTSIDE the box: once the box de-accents itself
    // (answered) it must not take the stage number with it, or the page loses
    // its structure exactly when the trader starts reading the rest.
    this.stepHead(
      host,
      "Account mapping",
      chosen.length
        ? { text: "Ready", tone: "ready" }
        : { text: "Needs your choice", tone: "input", needs: true }
    );
    const box = host.createDiv({ cls: "tj-import-pick" + (chosen.length ? " is-set" : "") });
    const head = box.createDiv({ cls: "tj-import-pickhead" });
    setIcon(head.createSpan({ cls: "tj-import-pickico" }), "crosshair");
    head.createSpan({ cls: "tj-import-picktitle", text: "Where these trades go" });
    head.createSpan({
      cls: "tj-import-pickstate" + (chosen.length ? " is-set" : " is-empty"),
      text: chosen.length
        ? `${chosen.length} of ${groups.length} account${groups.length === 1 ? "" : "s"} chosen`
        : "Nothing chosen yet",
    });

    for (const group of groups) {
      const row = box.createDiv({ cls: "tj-import-maprow" });
      const assigned = !!this.mapping.get(group.name);
      row.createSpan({ cls: "tj-import-mapdot" + (assigned ? " is-on" : "") });
      const name = row.createDiv({ cls: "tj-import-mapname" });
      // The detected account is the key the mapping is filed under, and the one
      // thing that tells fifty similar rows apart — so the batch shows it.
      name.createDiv({ cls: "tj-import-maplabel", text: group.name });
      const range = group.firstDate
        ? group.firstDate === group.lastDate
          ? formatDate(group.firstDate, "D MMM YYYY")
          : `${formatDate(group.firstDate, "D MMM YYYY")} → ${formatDate(group.lastDate, "D MMM YYYY")}`
        : "no day yet";
      name.createDiv({
        cls: "tj-import-mapcount",
        text: `${group.tradeCount} trade${group.tradeCount === 1 ? "" : "s"} · ${range} · ${group.files.length} file${
          group.files.length === 1 ? "" : "s"
        }`,
      });
      attachTip(name, { title: group.name, sub: group.files.join(", ") });
      // A remembered mapping is a suggestion, never an instruction: it is shown
      // and only written when the trader confirms it.
      const suggested = assigned ? null : this.plugin.mappedAccount(group.name);
      if (suggested) {
        const sug = name.createDiv({ cls: "tj-import-mapcount" });
        sug.createSpan({ text: `Suggested account: ${suggested.name}` });
        const use = sug.createEl("button", { cls: "tj-import-chipswap", text: "Use", attr: { type: "button" } });
        use.addEventListener("click", () => {
          this.mapping.set(group.name, suggested.id);
          void this.refreshAll();
        });
      }
      const dd = mountDropdown(
        row,
        this.accountItems(accounts),
        this.mapping.get(group.name) ?? "",
        (id) => {
          this.mapping.set(group.name, id);
          void this.refreshAll();
        },
        { placeholder: "Choose an account", title: "Where these trades are recorded" }
      );
      dd.addClass("tj-import-mapdd");
    }

    const leftOut = this.plan.unassigned;
    if (!chosen.length) {
      box.createDiv({
        cls: "tj-import-pickhint",
        text: `${leftOut} trade${leftOut === 1 ? "" : "s"} waiting for an account. Nothing is written until you pick one.`,
      });
    } else if (leftOut > 0) {
      box.createDiv({
        cls: "tj-import-pickhint is-warn",
        text: `${leftOut} trade${leftOut === 1 ? "" : "s"} still without an account — those will not be written.`,
      });
    }

    // Everything below is a question about an answer that does not exist yet.
    if (!chosen.length) return;
    this.renderExtraTargets(host, accounts);
  }

  /**
   * Who else took these trades. A configured copier of a mapped leader is
   * listed with what the batch actually holds for it and arrives ticked: the
   * relationship is the journal's own configuration, offered back — never a
   * copy link read out of the CSV. A follower with no imported data is still
   * reported, and its history is generated only if the tick stands at Import.
   */
  private renderExtraTargets(host: HTMLElement, accounts: PropAccount[]): void {
    const baseIds = new Set(this.baseIds());
    // The mapping says where the batch's trades live; the ticks say where they
    // are copied to. `effectiveSelection` already keeps a mapped destination out
    // of the tick list — writing it there would double the same trade.
    const others = accounts.filter((a) => !baseIds.has(a.id));

    const groupAccs = others.filter((a) => a.copyRole === "copier" && !!a.copyBaseId && baseIds.has(a.copyBaseId));
    const freeAccs = others.filter((a) => !groupAccs.includes(a));
    const leaders = accounts.filter((a) => baseIds.has(a.id)).map((a) => a.name);

    if (groupAccs.length) {
      // The leader first, in its own line, then the copiers it leads: the point
      // of this box is that these accounts are a group, not four loose checkboxes.
      const undecided = groupAccs.some((a) => this.importedForAccount(a.id) === 0 && !this.includeIds.has(a.id));
      this.stepHead(host, "Trading Group", {
        text: undecided ? "Needs your choice" : "Ready",
        tone: undecided ? "input" : "ready",
        needs: undecided,
      });
      const groupBox = host.createDiv({ cls: "tj-import-group" });
      const groupHead = groupBox.createDiv({ cls: "tj-import-grouphead" });
      setIcon(groupHead.createSpan({ cls: "tj-import-groupico" }), "users");
      groupHead.createSpan({ text: "Trading Group detected" });
      const leadLine = groupBox.createDiv({ cls: "tj-import-grouplead" });
      leadLine.createSpan({ cls: "tj-role is-leader", text: "Leader" });
      leadLine.createSpan({ cls: "tj-import-leadername", text: leaders.join(", ") });
      // The ticks come from the Trading Group's own configuration, so the line
      // says where they came from and what pressing Import will do — never that
      // the CSV revealed a relationship. Unticked, nothing is written for it.
      groupBox.createDiv({
        cls: "tj-import-groupsub",
        text: "Copiers are ticked from your Trading Group settings. Import reconstructs the leader's missing history for each ticked account — nothing is generated until you press Import.",
      });
      this.renderAccountRows(groupBox, groupAccs);
    }

    if (freeAccs.length) {
      const accBox = host.createDiv({ cls: "tj-import-accs" });
      // Named for what it does, not what it is: ticking a plain account records
      // the trade there one for one at the same size. That is not a copy, and a
      // reader who assumed otherwise would misread their own ledger.
      const mapHead = accBox.createDiv({
        cls: "tj-import-maphead",
        text: "Also record these trades in, one for one",
      });
      attachTip(mapHead, {
        title: "Not a copy",
        sub: "A tick here records the trade in that account at the same size. Only accounts that follow a leader produce generated copy legs.",
      });
      this.renderAccountRows(accBox, freeAccs);
    }
  }

  /** One tickable row per account. The row is the target; the dot is the state. */
  private renderAccountRows(host: HTMLElement, list: PropAccount[]): void {
    for (const a of list) {
      const row = host.createEl("label", { cls: "tj-import-acc" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = this.includeIds.has(a.id);
      // A green dot says "this one is in" at a glance. The tick is still the
      // control; the dot is the state, and it is the same green everywhere.
      const dot = row.createSpan({ cls: "tj-import-accdot" + (box.checked ? " is-on" : "") });
      box.addEventListener("change", () => {
        // The explicit choice is remembered for the span of this mapping, so a
        // later repaint keeps it instead of re-ticking the configured default.
        this.selection.overrides.set(a.id, box.checked);
        if (box.checked) this.includeIds.add(a.id);
        else this.includeIds.delete(a.id);
        dot.toggleClass("is-on", box.checked);
        this.updateGo();
      });
      row.createSpan({ cls: "tj-import-accname", text: a.name });
      const who = row.createDiv({ cls: "tj-import-accwho" });
      if (a.copyRole === "base") who.createSpan({ cls: "tj-role is-leader", text: "Leader" });
      if (a.copyRole === "copier") {
        who.createSpan({ cls: "tj-role is-copier", text: "Copier" });
        const ratioChip = who.createSpan({ cls: "tj-ratio", text: `×${copierPresentation(a).ratio}` });
        attachTip(ratioChip, {
          title: `Ratio \u00d7${copierPresentation(a).ratio}`,
          sub: "Contracts copied per leader contract. It sizes the copy legs this account would receive.",
        });
      }
      // What the batch holds for this account, so a missing follower reads as a
      // fact rather than a silent omission.
      const imported = this.importedForAccount(a.id);
      if (imported > 0) {
        who.createSpan({ cls: "tj-import-window", text: `${imported} imported` });
        // Each copier has its own start, and the generated history can only
        // begin there. Showing the ratio without it described a leg the engine
        // would refuse to write.
        if (a.copyRole === "copier") {
          const cp = copierPresentation(a);
          who.createSpan({
            cls: "tj-import-since",
            text: cp.sinceIsBeginning ? "copies from the beginning" : cp.since ? `copies from ${formatDate(cp.since, this.plugin.settings.dateFormat)}` : "start not recorded",
          });
        }
      } else if (a.copyRole === "copier") {
        // Expected while a configured copier is preselected: the follower's own
        // export is simply not in this batch. It only reads as a warning once the
        // account has been left unticked and its history will not be generated.
        const selected = this.includeIds.has(a.id);
        const chip = who.createSpan({ cls: "tj-import-window" + (selected ? "" : " is-warn"), text: "No imported data found" });
        attachTip(chip, {
          title: selected ? "No imported data" : "No imported data — left out",
          sub: selected
            ? "This account has no files in the batch. Its history is reconstructed from the leader's trades."
            : "This account has no files in the batch, and it is not ticked, so its history is not generated.",
        });
      }
    }
  }

  /**
   * Everything the file in hand depends on, repainted together.
   *
   * The zone moves every timestamp and the cash history moves every cost, so a
   * change in one of them changes the rest. Repainting them apart is what left
   * the modal showing yesterday's numbers after a click.
   */
  private async refreshAll(): Promise<void> {
    if (this.setupEl) {
      this.setupEl.empty();
      this.renderZone(this.setupEl);
      this.renderCosts(this.setupEl);
    }
    await this.renderReview();
  }

  // ----------------------------------------------------------------- review

  private async renderReview(): Promise<void> {
    if (!this.parsed || !this.bodyEl || !this.fileEl) return;
    const body = this.bodyEl;
    body.empty();

    // The file chip replaces the drop zone — the file is already in hand, and it
    // has a name: Orders, Fills, and the cash history when it came along.
    this.fileEl.empty();
    const chip = this.fileEl.createDiv({ cls: "tj-import-chip" });
    setIcon(chip.createSpan({ cls: "tj-import-chipico" }), "file-text");
    chip.createSpan({ cls: "tj-import-chipkind", text: this.batchKind() });
    chip.createSpan({ text: this.parsed.name, cls: "tj-import-chipname" });
    if (this.parsed.files.length > 1) {
      attachTip(chip, { title: `${this.parsed.files.length} files`, sub: this.parsed.files.join(", ") });
    }
    if (this.parsed.costFileName) {
      chip.createSpan({ cls: "tj-import-chipmore", text: "+" });
      chip.createSpan({ cls: "tj-import-chipkind", text: "Cash History" });
      chip.createSpan({ text: this.parsed.costFileName, cls: "tj-import-chipname" });
    }
    // The wrong file should not mean closing the flow. Dropping it and picking
    // another is the same decision, revisited — and it keeps everything else
    // (the costs file, the chosen strategy) in place.
    const swapFile = chip.createEl("button", { cls: "tj-import-chipswap", text: "Change file", attr: { type: "button" } });
    swapFile.addEventListener("click", () => this.resetTradesFile());

    // Step two. The file is in hand, so the reader gets what belongs to it:
    // where its times were written, and whether the platform's bill is coming
    // with it. The recommendation has done its job and shrinks to one line.
    if (this.headSubEl) this.headSubEl.setText("Nothing is written until you press the button.");
    if (this.tradesTitleEl) this.tradesTitleEl.setCssStyles({ display: "" });
    if (this.setupEl && !this.setupEl.childElementCount) {
      this.renderZone(this.setupEl);
      this.renderCosts(this.setupEl);
    }

    const accounts = this.accounts();
    if (!accounts.length) {
      if (this.pickEl) this.pickEl.empty();
      const warn = body.createDiv({ cls: "tj-import-note" });
      warn.createDiv({ text: "You have no accounts yet — create one first, then import." });
      const btn = warn.createEl("button", { cls: "tj-actionbtn is-primary", text: "Create an account" });
      btn.addEventListener("click", () => {
        this.close();
        void this.plugin.openAccounts();
      });
      this.renderStages();
      return;
    }

    // Duplicates are matched by fill id, never by guesswork — and they are
    // worked out first, because the copy window below counts real trades.
    await this.splitDuplicates();

    // What the platform's own ledger added. When it is here the costs are the
    // bill, line by line; when it is not, say what is missing rather than
    // filling the gap with a plausible number.
    const costs = this.parsed.costs;
    const orphanCount = costs ? costs.orphans.length : 0;
    const costLine = body.createDiv({ cls: "tj-import-costs" + (orphanCount > 0 ? " is-warn" : "") });
    setIcon(costLine.createSpan({ cls: "tj-import-costs-ico" }), "receipt");
    if (!costs) {
      costLine.createSpan({
        text: "Costs are not recorded: the export carries commission but not the exchange, clearing and NFA lines, and half a cost would be a wrong number.",
      });
    } else {
      const inAccount = this.round2(Math.max(0, costs.charged - costs.recorded));
      costLine.createSpan({
        text:
          `The platform charged ${fmtMoney2(-costs.charged)}; ${fmtMoney2(-costs.recorded)} tied to these trades` +
          (inAccount > 0.005
            ? ` and ${fmtMoney2(-inAccount)} logged in the account, on their own day — ${orphanCount} line${
                orphanCount === 1 ? "" : "s"
              } with no matching fill.`
            : "."),
      });
      const check = this.balanceCheck(costs);
      if (check) {
        const ok = Math.abs(check.journal - check.platform) <= 0.01;
        const line = costLine.createDiv({ cls: "tj-import-balance " + (ok ? "is-ok" : "is-warn") });
        setIcon(line.createSpan({ cls: "tj-import-balanceico" }), ok ? "check" : "alert-triangle");
        line.createSpan({
          text: `The account lands at ${fmtMoney2(check.journal)}; the platform's own ledger ends at ${fmtMoney2(
            check.platform
          )}.`,
        });
      }
    }

    // What the default-risk rules did, said before the button rather than after.
    // The rules are the trader's own, and their only power here is to fill a
    // stop the file does not carry — and to be labelled as a stand-in.
    const risk = this.parsed.risk;
    if (risk && (risk.applied || risk.withoutRuleCount)) {
      const line = body.createDiv({ cls: "tj-import-costs" });
      setIcon(line.createSpan({ cls: "tj-import-costs-ico" }), "shield");
      const said: string[] = [];
      if (risk.applied) {
        said.push(
          `${risk.applied} trade(s) had no stop in the file and took the default risk you set for their contract — written as assumed, never as recorded`
        );
      }
      if (risk.withoutRuleCount) {
        said.push(
          `${risk.withoutRuleCount} trade(s) stay without a stop: no default risk set for ${risk.withoutRule.join(", ")}`
        );
      }
      line.createSpan({ text: `${said.join(". ")}. Set or clear them in Settings → Journal & setup.` });
    }

    // ---- where these trades go --------------------------------------------
    // One question, asked before the times and the costs, because every other
    // number on this screen depends on the answer. Until it is answered the
    // group and the extra accounts are not even drawn: a question that has not
    // been asked cannot be answered wrongly.
    // A configured copier of a mapped leader comes ticked: the relationship was
    // an explicit decision already, and the tick only says "use it". The trade's
    // own copy window still decides which legs it actually gets. A tick hangs
    // off a chosen account: with nothing mapped, no default and no leftover
    // lights the button. An explicit untick survives every repaint — until the
    // mapped leader set changes, when the defaults are recomputed afresh.
    this.includeIds = effectiveSelection(accounts, this.baseIds(), this.selection);
    this.renderPick();

    const t = this.importable;
    const plan = this.plan;
    // The financial preview reads only what a confirmed mapping will write:
    // an unassigned row must not move the shown Net.
    const writable = plan?.selected ?? t;
    const net = writable.reduce((s, x) => s + (Number.isFinite(x.pnl) ? netPnl(x) : 0), 0);

    this.stepHead(body, "Preview", { text: "Ready", tone: "ready" });
    const box = body.createDiv({ cls: "tj-import-review" });
    const top = box.createDiv({ cls: "tj-import-reviewtop" });
    const detected = plan?.detected ?? t.length;
    top.createSpan({
      cls: "tj-import-reviewcount",
      text: `${detected} trade${detected === 1 ? "" : "s"} across ${this.parsed.files.length} file${
        this.parsed.files.length === 1 ? "" : "s"
      }`,
    });
    // The reconciliation summary: what was found, what is already here, what a
    // mapping will import and what it will leave out. It adds up by design.
    if (plan && plan.duplicates) {
      top.createSpan({ cls: "tj-import-pill", text: `${plan.duplicates} already in the journal` });
    }
    if (plan && plan.assigned) {
      top.createSpan({ cls: "tj-import-pill", text: `${plan.assigned} ready to import` });
    }
    if (plan && plan.unassigned) {
      top.createSpan({ cls: "tj-import-pill is-warn", text: `${plan.unassigned} without an account` });
    }
    // Honest arithmetic: an order with no fill and a fill with no close are two
    // different facts, and neither of them is a malformed row.
    if (this.parsed.unfilled) {
      const pill = top.createSpan({
        cls: "tj-import-pill",
        text: `${this.parsed.unfilled} order${this.parsed.unfilled === 1 ? "" : "s"} never filled`,
      });
      attachTip(pill, {
        title: "Orders with no fill",
        sub: "A ticket you placed and pulled. Nothing was executed for it.",
      });
    }
    if (this.parsed.unpaired) {
      const pill = top.createSpan({
        cls: "tj-import-pill is-warn",
        text: `${this.parsed.unpaired} fill${this.parsed.unpaired === 1 ? "" : "s"} not paired`,
      });
      attachTip(pill, {
        title: "Fills not paired",
        sub: "A position that is still open, or whose other side is in another file.",
      });
    }
    if (this.parsed.skipped) {
      const pill = top.createSpan({
        cls: "tj-import-pill is-warn",
        text: `${this.parsed.skipped} row${this.parsed.skipped === 1 ? "" : "s"} unreadable`,
      });
      attachTip(pill, {
        title: "Rows unreadable",
        sub: "A row missing a column. Nothing was written from it.",
      });
    }
    // A row whose wall clock has no single instant is a different fact from an
    // unreadable one: it was read, and refused. Say which hour refused it.
    const issues = this.parsed.timeIssues;
    const timeCount = issues ? issues.gap + issues.ambiguous + issues.noZone : 0;
    if (issues && timeCount) {
      const pill = top.createSpan({
        cls: "tj-import-pill is-warn",
        text: `${timeCount} timestamp${timeCount === 1 ? "" : "s"} not pinned`,
      });
      const parts: string[] = [];
      if (issues.gap) parts.push(`${issues.gap} in a DST gap`);
      if (issues.ambiguous) parts.push(`${issues.ambiguous} in a repeated hour`);
      if (issues.noZone) parts.push(`${issues.noZone} with no zone chosen`);
      attachTip(pill, {
        title: "Timestamps left out",
        sub: `These rows read fine but have no single instant (${parts.join(
          ", "
        )}), so nothing was written. Check "Time files are in" if the times are naive.`,
      });
    }

    if (t.length) {
      // A CSV cannot carry a strategy, so this is one answer for the whole file —
      // and it can be left empty when the trades are not all the same. The ones
      // left without a home are surfaced after the write, never guessed.
      const setupRow = box.createDiv({ cls: "tj-import-setuprow" });
      setupRow.createSpan({ cls: "tj-import-setuplbl", text: "Strategy" });
      const setupItems: DropdownItem[] = [{ id: "__none__", label: "No strategy", note: "Leave them unfiled" }];
      for (const s of this.knownSetups) setupItems.push({ id: s, label: s });
      setupItems.push({ id: "__new__", label: "＋ New strategy…", note: "Saved to Strategies" });
      mountDropdown(
        setupRow.createDiv({ cls: "tj-import-setupctl" }),
        setupItems,
        this.setupPick || "__none__",
        (id) => void (async () => {
          if (id === "__new__") {
            const name = window.prompt("Name your strategy");
            if (!name || !name.trim()) return;
            this.setupPick = await this.plugin.addStrategy(name);
            this.knownSetups = await this.plugin.knownSetups();
          } else {
            this.setupPick = id === "__none__" ? "" : id;
          }
          await this.renderReview();
        })(),
        { title: "Applied to every trade in this file", align: "left" }
      );
      if (this.knownSetups.length !== 1) {
        setupRow.createSpan({
          cls: "tj-import-setupnote",
          text: this.knownSetups.length
            ? "Apply to all — leave empty if they are not all the same."
            : "No strategy registered yet — add one, or import them unfiled.",
        });
      }

      // The other answer this file can carry in one line. A history imported
      // years after the fact arrives with no journal attached to it — no
      // screenshots, no notes — so marking the whole file reviewed clears the
      // queue in one click instead of leaving thousands of rows to click
      // through. It is the trader's word, and the checklist stays factual.
      const markRow = box.createDiv({ cls: "tj-import-setuprow" });
      markRow.createSpan({ cls: "tj-import-setuplbl", text: "Review" });
      const markNote = markRow.createSpan({ cls: "tj-import-setupnote" });
      const markBtn = markRow.createEl("button", {
        cls: "tj-actionbtn",
        text: this.markAllReviewed ? "All reviewed" : "Mark all as reviewed",
        attr: { type: "button" },
      });
      markBtn.addEventListener("click", () => void (async () => {
        this.markAllReviewed = !this.markAllReviewed;
        markBtn.setText(this.markAllReviewed ? "All reviewed" : "Mark all as reviewed");
        markBtn.toggleClass("is-on", this.markAllReviewed);
        markNote.setText(
          this.markAllReviewed
            ? `All ${t.length} trades in this file will be marked reviewed — out of the queue. The checklist still shows what each note holds.`
            : ""
        );
        await this.renderReview();
      })());
      if (this.markAllReviewed) {
        markNote.setText(
          `All ${t.length} trades in this file will be marked reviewed — out of the queue. The checklist still shows what each note holds.`
        );
        markBtn.addClass("is-on");
      } else if (!markNote.textContent) {
        // A cold start: a broker's export cannot carry a screenshot, so most of
        // this file can never look "written up". Say the way out before it bites.
        markNote.setText(
          "Imported trades rarely carry screenshots or notes. Mark them reviewed to clear the queue, and write up only the ones worth it."
        );
      }

      const tbl = box.createEl("table", { cls: "tj-import-tbl" });
      const thead = tbl.createEl("thead");
      const hr = thead.createEl("tr");
      for (const [label, cls] of [
        ["Date", ""],
        ["Symbol", ""],
        ["Side", ""],
        ["Qty", "num"],
        ["Entry → Exit", "num"],
        ["P&L", "num"],
        ["", ""],
      ] as [string, string][]) {
        hr.createEl("th", { text: label, cls });
      }
      const tbody = tbl.createEl("tbody");
      for (const trade of t.slice(0, 8)) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: trade.date });
        tr.createEl("td", { text: trade.symbol });
        tr.createEl("td").createSpan({
          cls: "tj-import-side " + (trade.direction === "short" ? "is-short" : "is-long"),
          text: trade.direction === "short" ? "Short" : "Long",
        });
        tr.createEl("td", { cls: "num", text: String(trade.quantity) });
        tr.createEl("td", { cls: "num", text: `${trade.entryPrice} → ${trade.exitPrice}` });
        const pnl = Number.isFinite(trade.pnl) ? trade.pnl : 0;
        tr.createEl("td", { cls: "num " + (pnl >= 0 ? "pos" : "neg"), text: fmtMoney2(pnl) });
        // The list mixed rows that will be written with rows that will not, with
        // nothing on screen saying which was which \u2014 and the Net below counts
        // only the writable ones. Each row now carries its own fate.
        const chosen = !!this.mapping.get(trade.account || "");
        const state = tr.createEl("td", { cls: "state" });
        const chip = state.createSpan({
          cls: "tj-import-rowstate" + (chosen ? " is-in" : " is-out"),
          text: chosen ? "Will import" : "No account yet",
        });
        if (!chosen) {
          attachTip(chip, {
            title: "Not written",
            sub: "This row has no confirmed account, so it is not part of this import \u2014 and it is not in the Net below.",
          });
        }
      }
      if (t.length > 8) {
        const more = tbody.createEl("tr", { cls: "is-more" });
        more.createEl("td", { attr: { colspan: "7" }, text: `… ${t.length - 8} more` });
      }

      const foot = box.createDiv({ cls: "tj-import-reviewfoot" });
      foot.createSpan({ text: "Net" });
      foot.createSpan({ cls: "tj-import-net " + (net >= 0 ? "pos" : "neg"), text: fmtMoney2(net) });
      foot.createSpan({ cls: "tj-import-dot", text: "·" });
      foot.createSpan({ text: `${new Set(t.map((x) => x.symbol)).size} symbol${new Set(t.map((x) => x.symbol)).size === 1 ? "" : "s"}` });
      foot.createSpan({ cls: "tj-import-dot", text: "·" });
      foot.createSpan({ text: `${t[t.length - 1]?.date} → ${t[0]?.date}` });
    } else {
      box.createDiv({ cls: "tj-import-emptyline", text: "Everything in this file is already in your journal." });
    }

    // ---- the one action ---------------------------------------------------
    const foot = body.createDiv({ cls: "tj-import-actions" });
    this.actionsEl = foot;
    const cancel = foot.createEl("button", { cls: "tj-actionbtn", text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    foot.createDiv({ cls: "tj-import-spacer" });
    const toWrite = plan?.assigned ?? t.length;
    const go = foot.createEl("button", {
      cls: "tj-actionbtn is-primary",
      text: `Import ${toWrite} trade${toWrite === 1 ? "" : "s"}`,
    });
    this.goBtn = go;
    go.addEventListener("click", () => void this.commit(go));

    // The trades need a home before the button means anything. The reason is
    // said out loud, and it goes away the moment an account is chosen.
    this.helperEl = body.createDiv({
      cls: "tj-import-helper",
      text: "Select at least one target account to proceed.",
    });

    // The one sentence that has to survive, outside the row and below it.
    body.createDiv({ cls: "tj-import-footnote", text: "Nothing is written until you press the button." });
    this.updateGo();
    this.renderStages();
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * The journal's own arithmetic against the platform's closing figure. It is
   * only honest when the file lands in exactly one account and the cash history
   * carried a running Amount — otherwise there is nothing to compare, and no
   * comparison is shown rather than a made-up one.
   */
  private balanceCheck(costs: ImportCosts): { journal: number; platform: number } | null {
    const ids = this.baseIds();
    if (ids.length !== 1 || !Number.isFinite(costs.finalBalance)) return null;
    const id = ids[0];
    const acc = this.accounts().find((a) => a.id === id);
    if (!acc) return null;
    const zone = this.plugin.settings.timeZone;
    const legs: Trade[] = [];
    for (const t of excludeSuperseded(this.existing)) {
      const mapped = this.plugin.mappedAccount(t.account || "");
      if (mapped && mapped.id === id && Number.isFinite(t.pnl) && t.date) legs.push(t);
    }
    // Only the trades a confirmed mapping will actually write affect the
    // balance preview; an unassigned row never lands in this account.
    const writable = this.plan?.selected ?? this.importable;
    for (const t of writable) {
      if (Number.isFinite(t.pnl) && t.date) legs.push(t);
    }
    const inAccount = this.round2(Math.max(0, costs.charged - costs.recorded));
    // The ONE balance formula, on the account's own value anchor — the same call
    // the account page and the Accounts overview make. A hand-rolled sum from the
    // configured size would report a false mismatch on any account that started
    // being tracked from halfway, and would double-count the history that is
    // already inside its opening balance.
    const movement = computeRecordedAccountMovement({
      trades: legs,
      size: this.plugin.openingCapitalOf(id),
      dayKey: (t) => tradeDayInZone(t, zone),
      trackingStart: trackingStartOf(acc),
      cashflows: accountCashflows(
        this.plugin.payoutsFor(id),
        this.plugin.depositsFor(id),
        this.plugin.feeAdjustmentsFor(id)
      ),
    });
    // Platform costs no trade could claim are money that left with no date of
    // their own; they stay a plain deduction from the recorded balance.
    return { journal: this.round2(movement.balance - inAccount), platform: costs.finalBalance as number };
  }

  /**
   * The whole batch, deduped globally against the journal and across every file
   * in order — through the Phase 2 identity system, the only one there is. The
   * plan also groups the rows by detected account for the mapping UI.
   */
  private async splitDuplicates(): Promise<void> {
    if (!this.parsed) return;
    const existing = await this.plugin.loadTradesExpanded();
    this.existing = existing;
    const mapping: Record<string, string> = {};
    for (const [key, id] of this.mapping) mapping[key] = id;
    const plan = planBatch({
      files: this.batchFiles,
      existing,
      resolveAccount: (label) => this.resolveImportAccount(label),
      mapping,
    });
    this.plan = plan;
    // `importable` stays the whole non-duplicate pool (mapped or not): the
    // preview table and the balance check read it, while the plan carries the
    // assigned/unassigned split.
    this.importable = [...plan.selected, ...plan.skipped];
    this.duplicates = plan.duplicates;
  }

  /** The journal account id a stored/parsed label resolves to. */
  private resolveImportAccount(label: string): string {
    const mapped = this.plugin.mappedAccount(label || "");
    return mapped ? mapped.id : `unmapped:${(label || "").trim().toLowerCase()}`;
  }

  // ----------------------------------------------------------------- commit

  private async commit(btn: HTMLButtonElement): Promise<void> {
    if (!this.parsed || this.busy) return;

    // The hard guard: no target, no write. The button is already asleep, but a
    // rule that lives only in a disabled attribute is not a rule.
    const accounts = this.accounts();
    const assigned: Trade[] = [];
    for (const t of this.importable) {
      const id = this.mapping.get(t.account);
      const acc = id ? accounts.find((a) => a.id === id) : undefined;
      if (!acc) continue;
      const assignedTrade: Trade = {
        ...t,
        account: acc.name,
        accountType: acc.type,
        setup: this.setupPick || t.setup || "",
        // One answer for the whole file: reviewed, and the checklist stays as
        // the notes are.
        ...(this.markAllReviewed ? { reviewed: true as const } : {}),
      };
      // Record the identity the note is deduped by, so the next import of the
      // same trade recognises it even without a broker id.
      const importKey = primaryImportIdentity(assignedTrade, () => acc.id) ?? t.importKey;
      if (importKey) assignedTrade.importKey = importKey;
      assigned.push(assignedTrade);
    }
    if (!assigned.length || this.activeTargets().size === 0) {
      new Notice("Select at least one target account before importing.");
      this.updateGo();
      return;
    }

    this.busy = true;
    btn.disabled = true;
    btn.setText("Importing…");
    try {
      // An account that is itself a target never also receives a leg: the same
      // trade would be written twice into the same account.
      const bases = new Set(this.baseIds());
      const broadcast = [...this.includeIds].filter((id) => !bases.has(id));
      const withLegs = await this.plugin.applyBroadcast(assigned, broadcast);
      const count = await this.plugin.storeTrades(withLegs);

      // The write is not done until it can be read back. storeTrades counts what
      // it was asked to save; this proves the notes actually landed, so "Done"
      // can never report a file that never arrived.
      const expected = new Set(assigned.map((t) => this.noteKey(t)));
      const byKey = new Map<string, string>();
      const after = await this.plugin.loadTradesExpanded();
      for (const t of after) {
        const mapped = this.plugin.mappedAccount(t.account || "");
        if (mapped && this.activeTargets().has(mapped.id)) {
          const k = this.noteKey(t);
          byKey.set(k, t.id);
          expected.delete(k);
        }
      }
      const outcome = writeOutcome(count, expected.size);
      if (outcome !== "complete") {
        // Honesty first: `count` is what the write created. Zero means nothing
        // landed, and a plain retry is safe. Above zero the notes are on disk
        // even when a read-back could not confirm some of them — so never claim
        // "nothing was written", and never offer a blind retry that would write
        // every trade again as a "_2" note. Re-reading the file lets the
        // journal's own duplicate check see what already landed and skip it.
        if (outcome === "none") {
          new Notice("Nothing was written — no note could be confirmed on disk. Try again.");
          btn.disabled = false;
          btn.setText("Retry");
          this.busy = false;
          return;
        }
        new Notice(
          `${count} note${count === 1 ? "" : "s"} written, but ${expected.size} could not be confirmed. The written notes are kept; re-importing will skip them.`
        );
        this.busy = false;
        await this.parseTrades();
        return;
      }

      // Cost lines the Orders file could not carry: they belong to the account,
      // dated on their own day, so the balance and the drawdown stay true. Only
      // when the file lands in one account — a shared cost split across base
      // accounts would be a guess.
      const costIds = this.baseIds();
      if (this.parsed.costs && costIds.length === 1) {
        const accountId = costIds[0];
        for (const o of this.parsed.costs.orphans) {
          if (o.date && Number.isFinite(o.amount) && o.amount > 0) {
            await this.plugin.registerAccountCost(accountId, o.date, -o.amount, `Platform cost · ${o.contract}`);
          }
        }
      }

      new Notice(`${count} trade${count === 1 ? "" : "s"} imported.`);
      this.onChange?.();

      // A quiet receipt instead of a new surface: the review stays where it is
      // and the button row becomes the confirmation, so the modal keeps looking
      // like itself between the before and the after. The four numbers are kept
      // apart — what the file held, what was chosen, what was written, and what
      // was left out — so "imported" can never be read as "everything".
      const legs = withLegs.length - assigned.length;
      const noStrategyIds = assigned
        .filter((t) => !(t.setup || "").trim())
        .map((t) => byKey.get(this.noteKey(t)))
        .filter((x): x is string => !!x);
      const issues = this.parsed.timeIssues;
      const timeCount = issues ? issues.gap + issues.ambiguous + issues.noZone : 0;
      const receipt = importSummary({
        detected: this.plan?.detected ?? this.parsed.trades.length,
        importable: this.plan?.importable ?? this.importable.length,
        assigned: assigned.length,
        written: assigned.length,
        copyLegs: legs,
        duplicates: this.duplicates,
        unfilled: this.parsed.unfilled,
        unpaired: this.parsed.unpaired,
        unreadable: this.parsed.skipped,
        unpinned: timeCount,
      });
      this.imported = true;
      const foot = this.actionsEl;
      if (foot) {
        foot.empty();
        const summary = foot.createDiv({ cls: "tj-import-summary" });
        const head = summary.createDiv({ cls: "tj-import-done" });
        setIcon(head.createSpan({ cls: "tj-import-doneico" }), "check");
        head.createSpan({ text: "Import complete" });
        const row = (label: string, value: string, tone = "") => {
          const r = summary.createDiv({ cls: "tj-import-summaryrow" });
          r.createSpan({ cls: "tj-import-summaryk", text: label });
          r.createSpan({ cls: "tj-import-summaryv" + (tone ? " " + tone : ""), text: value });
        };
        row("Detected", `${receipt.detected} trade${receipt.detected === 1 ? "" : "s"} in the batch`);
        // "Selected" means chosen for an account, so it agrees with what was
        // written; a picked trade left without one is reported under Skipped.
        row("Selected", `${receipt.selected} for these accounts`);
        row(
          "Imported",
          `${receipt.written} written${receipt.copyLegs > 0 ? ` · +${receipt.copyLegs} copy leg${receipt.copyLegs === 1 ? "" : "s"}` : ""}`,
          "pos"
        );
        row("Skipped", receipt.skipped.length ? receipt.skipped.join(" · ") : "none", receipt.skipped.length ? "is-warn" : "");
        // A configured follower with no imported data is named, never quietly
        // reconstructed — UNLESS the trader ticked it, in which case its
        // generated history was just written. Reporting a ticked copier as
        // "not generated" contradicted the import that had already happened.
        const missing = missingCopiers(
          accounts,
          new Set(this.mapping.values())
        ).filter((a) => !this.includeIds.has(a.id));
        if (missing.length) {
          const warn = summary.createDiv({ cls: "tj-import-nostrategy" });
          warn.createSpan({
            text: `No imported data for ${missing.map((a) => a.name).join(", ")} — their history was not generated. Tick them above if you want it.`,
          });
        }
        // The trades the file could not file: one click to give them a strategy,
        // in the ledger itself, where the picker already lives.
        if (noStrategyIds.length) {
          const warn = summary.createDiv({ cls: "tj-import-nostrategy" });
          warn.createSpan({
            text: `${noStrategyIds.length} trade${noStrategyIds.length === 1 ? "" : "s"} without a strategy.`,
          });
          const assign = warn.createEl("button", { cls: "tj-actionbtn", text: "Assign strategies" });
          assign.addEventListener("click", () => {
            this.close();
            void this.plugin.openTradeLogForIds(noStrategyIds);
          });
        }
        // One batch, one import: the way out is forward, not back.
        const doneBtn = foot.createEl("button", { cls: "tj-actionbtn", text: "Done" });
        doneBtn.addEventListener("click", () => this.close());
      }
      this.renderStages();
    } catch (err) {
      new Notice(`Import failed: ${(err as Error).message}`);
      btn.disabled = false;
      btn.setText("Retry");
    }
    this.busy = false;
  }

  /** The identity a written note is read back by. */
  private noteKey(t: Trade): string {
    if (t.fillId) return `id:${t.fillId}`;
    return `k:${t.account}|${t.date}|${t.symbol}|${t.direction}|${t.entryTime ?? ""}`;
  }
}
