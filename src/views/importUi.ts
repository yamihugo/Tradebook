import { Modal, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { csvKind, parseCashHistoryCsv, parseTradeovateCsv } from "../csv";
import type { CashCosts } from "../csv";
import type { ImportCosts, PropAccount, Trade } from "../types";
import { TIMEZONE_OPTIONS, detectSystemZone, fmtMoney2, zoneShortLabel } from "../tz";
import { isActiveCopier } from "../lib/copy";
import { formatDate } from "../lib/dates";
import { mountDropdown } from "../lib/dropdown";
import { attachTip } from "../lib/tip";
import { netPnl } from "../lib/fees";
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
  trades: Trade[];
  skipped: number;
  unfilled: number;
  unpaired: number;
  warnings: string[];
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
  /** Accounts that also took these trades (copy members arrive pre-ticked). */
  private includeIds = new Set<string>();
  /** Which base set we already pre-ticked, so an untick is never undone. */
  private groupSeeded = "";
  private parsed: ParsedFile | null = null;
  private importable: Trade[] = [];
  private duplicates = 0;
  /** The journal as it stands, loaded once so the balance preview can count it. */
  private existing: Trade[] = [];
  private actionsEl: HTMLElement | null = null;
  /** The one action, kept so the guard can enable or disable it without a repaint. */
  private goBtn: HTMLButtonElement | null = null;
  /** The reason the action is asleep, shown only while it is. */
  private helperEl: HTMLElement | null = null;

  // The trades and the costs are two separate decisions: the file with the
  // trades, and — only if the trader wants the exact bill — the platform's own
  // cash history for the same period.
  private tradesText = "";
  private tradesName = "";
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

    // Step one is the file and nothing else: the times and the costs are
    // decided once there is a file to decide about.
    const trades = c.createDiv({ cls: "tj-import-block" });
    this.tradesTitleEl = trades.createDiv({ cls: "tj-import-blocktitle", text: "Trades" });
    this.fileEl = trades.createDiv({ cls: "tj-import-file" });
    this.renderDropzone(this.fileEl);

    // The account comes before the times and the costs: it is the decision
    // every other number on this screen depends on, so it gets asked first.
    this.pickEl = c.createDiv();

    // Step two's home. It stays empty until a file is recognised.
    this.setupEl = c.createDiv({ cls: "tj-import-setup" });

    this.bodyEl = c.createDiv({ cls: "tj-import-result" });
  }

  /**
   * The platform's costs live in a file of their own, and they are a decision of
   * their own. Off by default: without the cash history the journal records no
   * cost at all, because a half-counted one would be a number nobody was billed.
   */
  private renderCosts(host: HTMLElement): void {
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
    const drop = this.cashEl.createEl("div", { cls: "tj-dropzone is-cash" });
    drop.createDiv({ cls: "tj-drop-text", text: "Drop the Cash History CSV here" });
    drop.createDiv({ cls: "tj-drop-sub", text: "or click to choose a file" });
    const input = drop.createEl("input", { type: "file", attr: { accept: ".csv,.txt,text/csv" } });
    input.style.display = "none";
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
    const box = host.createDiv({ cls: "tj-import-zonebox" });
    // One row: the label, the zone, and where it lands. The zone is one answer,
    // not a form, so it does not get a form's worth of space.
    setIcon(box.createSpan({ cls: "tj-import-zone-ico" }), "clock");
    box.createSpan({ text: "Time files are in", cls: "tj-import-zonetitle" });
    const row = box;
    const items: DropdownItem[] = [
      { id: "", label: `This computer (${detected})` },
      ...TIMEZONE_OPTIONS.filter((o) => !!o.zone).map((o) => ({ id: o.zone as string, label: o.label })),
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
        if (this.tradesText) void this.parseTrades();
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
    const drop = host.createEl("div", { cls: "tj-dropzone" });
    drop.createDiv({ text: "Drop your CSV here", cls: "tj-drop-text" });
    drop.createDiv({ text: "Orders or Fills — one file is enough", cls: "tj-drop-sub" });
    drop.createDiv({
      cls: "tj-drop-hint",
      text: "Reports → Orders carries every ticket with its fill time, price, status, order type and stop. Reports → Fills is the raw executions. Either one pairs the round-trips; the Performance report cannot be read.",
    });
    const fileInput = drop.createEl("input", {
      type: "file",
      attr: { accept: ".csv,.txt,text/csv", multiple: "true" },
    });
    fileInput.style.display = "none";
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

  // ------------------------------------------------------------------ parse

  /**
   * One drop, and normally one file: the trades. If the cash history happens to
   * arrive in the same drop it is taken as the costs file, so dropping both at
   * once still works. They are told apart by their header, never by their name.
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

      const cash = texts.find((t) => csvKind(t.text) === "cash");
      const exec = texts.find((t) => {
        const k = csvKind(t.text);
        return k === "orders" || k === "fills";
      });
      if (!exec) {
        body.empty();
        const err = body.createDiv({ cls: "tj-error" });
        const stray = texts.find((t) => t !== cash);
        if (cash && !stray) {
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

      if (cash) {
        this.wantCosts = true;
        this.cashName = cash.name;
        this.cashError = "";
        this.cashCosts = parseCashHistoryCsv(cash.text);
        if (this.costToggle) this.costToggle.checked = true;
        this.renderCostsBlock();
      }

      // A new trades file is a new decision. Nothing is pre-picked: a name in
      // the CSV matching an account in the journal is a coincidence of text, not
      // an instruction, and guessing it here is how trades land in the wrong
      // place while the screen says everything went fine.
      this.mapping.clear();
      this.groupSeeded = "";

      this.tradesName = exec.name;
      this.tradesText = exec.text;
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
    if (this.tradesText) await this.parseTrades();
  }

  /**
   * Read the trades file — with the platform's costs when we have them — and
   * show the review. Nothing is written: this only says what was recognised.
   */
  private async parseTrades(): Promise<void> {
    if (!this.bodyEl || !this.tradesText) return;
    const body = this.bodyEl;
    const sourceZone = this.plugin.settings.importZone || detectSystemZone();
    const result = parseTradeovateCsv(
      this.tradesText,
      this.plugin.getAccountRules(),
      {
        sourceZone,
        journalZone: this.plugin.settings.timeZone,
      },
      this.cashCosts ?? undefined
    );
    body.empty();

    if (result.trades.length === 0) {
      const err = body.createDiv({ cls: "tj-error" });
      err.createEl("h3", { text: "No trades recognised" });
      for (const w of result.warnings) err.createEl("p", { text: w });
      err.createDiv({
        text: [
          result.skipped ? `${result.skipped} row(s) could not be read` : "",
          result.unfilled ? `${result.unfilled} order(s) never filled` : "",
          result.unpaired ? `${result.unpaired} fill(s) still open` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "The file has no executions this journal can pair.",
        cls: "tj-error-detail",
      });
      err.createDiv({
        text: "Export from Tradovate → Reports → Orders (recommended) or Fills and check the columns. The Performance report cannot be read — it is a screen, not a ledger.",
        cls: "tj-error-detail",
      });
      return;
    }

    this.parsed = {
      name: this.tradesName,
      trades: result.trades,
      skipped: result.skipped,
      unfilled: result.unfilled,
      unpaired: result.unpaired,
      warnings: result.warnings,
      accountsSeen: result.accountsSeen.map((a) => ({ name: a.name, type: String(a.type) })),
      costs: result.costs,
      costFileName: this.cashName || undefined,
    };
    // Re-reading the same file is not a new decision: the zone, the costs and
    // the cash history all land here, and each of them used to wipe the account
    // that had just been picked. Only a name that no longer exists in the file
    // is dropped, so nothing dead is kept.
    const names = new Set(this.parsed.accountsSeen.map((a) => a.name));
    for (const key of [...this.mapping.keys()]) {
      if (!names.has(key)) this.mapping.delete(key);
    }
    await this.refreshAll();
  }

  /** What Tradovate report this is, read from its header — never from its name. */
  private fileKind(text: string): string {
    const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
    if (head.includes("status") && head.includes("order id")) return "Orders export";
    if (head.includes("fill id")) return "Fills export";
    return "CSV";
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

  /** Accounts that follow a leader, used to pre-tick a recognised copy group. */
  private membersOf(baseIds: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const base of this.accounts()) {
      if (!baseIds.has(base.id)) continue;
      for (const copier of this.accounts()) {
        if (copier.copyRole === "copier" && copier.copyBaseId === base.id) out.add(copier.id);
      }
    }
    return out;
  }

  /**
   * How many of this file's trades a copier would actually mirror. A copier
   * that started on 6 September never received the 1 September trades — better
   * to say so here than to let the reader find out from a wrong number later.
   * Returns null for an account that is not a copier of a base in this file.
   */
  private copyWindow(acc: PropAccount, baseIds: Set<string>): { inWindow: number; total: number } | null {
    if (acc.copyRole !== "copier" || !acc.copyBaseId || !baseIds.has(acc.copyBaseId)) return null;
    const total = this.importable.length;
    let inWindow = 0;
    for (const t of this.importable) if (isActiveCopier(acc, acc.copyBaseId, t.date)) inWindow++;
    return { inWindow, total };
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

  /** The days this file covers, short: "19 Aug → 14 Sep 2026". */
  private spanLabel(trades: Trade[]): string {
    const days = trades.map((t) => t.date).filter(Boolean).sort();
    if (!days.length) return "no day yet";
    const lo = days[0];
    const hi = days[days.length - 1];
    if (lo === hi) return formatDate(hi, "D MMM YYYY");
    const a = formatDate(lo, "D MMM YYYY");
    const b = formatDate(hi, "D MMM YYYY");
    // One year is enough to say once.
    return lo.slice(0, 4) === hi.slice(0, 4) ? `${a.replace(` ${lo.slice(0, 4)}`, "")} → ${b}` : `${a} → ${b}`;
  }

  /**
   * Where the file's trades go, and — only once that is answered — who else
   * took them. This half of the modal is a single question at a time on purpose:
   * the reader was clicking copiers thinking he was choosing a leader, and no
   * amount of labelling fixes a screen that asks two things at once.
   */
  private renderPick(): void {
    if (!this.pickEl) return;
    const host = this.pickEl;
    host.empty();
    if (!this.parsed) return;
    const accounts = this.accounts();
    if (!accounts.length) return;

    const chosen = this.baseIds();
    const box = host.createDiv({ cls: "tj-import-pick" + (chosen.length ? " is-set" : "") });
    const head = box.createDiv({ cls: "tj-import-pickhead" });
    setIcon(head.createSpan({ cls: "tj-import-pickico" }), "crosshair");
    head.createSpan({ cls: "tj-import-picktitle", text: "Where these trades go" });
    head.createSpan({
      cls: "tj-import-pickstate" + (chosen.length ? " is-set" : " is-empty"),
      text: chosen.length ? `${chosen.length} of ${this.parsed.accountsSeen.length} chosen` : "Nothing chosen yet",
    });

    const several = this.parsed.accountsSeen.length > 1;
    for (const [index, seen] of this.parsed.accountsSeen.entries()) {
      const trades = this.importable.filter((t) => t.account === seen.name);
      const row = box.createDiv({ cls: "tj-import-maprow" });
      const assigned = !!this.mapping.get(seen.name);
      row.createSpan({ cls: "tj-import-mapdot" + (assigned ? " is-on" : "") });
      const name = row.createDiv({ cls: "tj-import-mapname" + (several ? "" : " is-plain") });
      // The broker's own account number never reaches the screen: it is the key
      // we file the answer under, not something a trader reads. With a single
      // name there is nothing to tell apart, so the row carries only the facts;
      // with more than one, they are numbered in the order the file lists them.
      if (several) name.createDiv({ cls: "tj-import-maplabel", text: `Account ${index + 1}` });
      name.createDiv({
        cls: "tj-import-mapcount",
        text: `${trades.length} trade${trades.length === 1 ? "" : "s"} · ${this.spanLabel(trades)}`,
      });
      const dd = mountDropdown(
        row,
        this.accountItems(accounts),
        this.mapping.get(seen.name) ?? "",
        (id) => {
          this.mapping.set(seen.name, id);
          void this.refreshAll();
        },
        { placeholder: "Choose an account", title: "Where these trades are recorded" }
      );
      dd.addClass("tj-import-mapdd");
    }

    const leftOut = this.importable.filter((t) => !this.mapping.get(t.account)).length;
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

  /** Who else took these trades — only reachable once a target exists. */
  private renderExtraTargets(host: HTMLElement, accounts: PropAccount[]): void {
    const baseIds = new Set(this.baseIds());
    const members = this.membersOf(baseIds);
    const others = accounts.filter((a) => !baseIds.has(a.id));

    // The mapping says where the file's trades live; the ticks say where they are
    // copied to. An account that became a base stops being a tick — keeping the
    // id here would write the same trade twice into the same account.
    for (const id of baseIds) this.includeIds.delete(id);

    // A recognised copy group arrives ticked (once per group, so unticking a leg
    // survives the next repaint).
    if (members.size) {
      const seedKey = [...baseIds].sort().join("|");
      if (this.groupSeeded !== seedKey) {
        this.groupSeeded = seedKey;
        for (const id of members) this.includeIds.add(id);
      }
    }

    // Two containers, because two different questions are being answered: the
    // accounts that were following this base on the day, and the accounts that
    // are simply also in the file. Ten ticked rows in one list hides that.
    const groupAccs = others.filter((a) => !!a.copyBaseId && baseIds.has(a.copyBaseId));
    const freeAccs = others.filter((a) => !groupAccs.includes(a));
    const leaders = accounts.filter((a) => baseIds.has(a.id)).map((a) => a.name);

    if (members.size) {
      const copiers = accounts.filter((a) => members.has(a.id)).map((a) => a.name);
      const groupBox = host.createDiv({ cls: "tj-import-group" });
      const groupHead = groupBox.createDiv({ cls: "tj-import-grouphead" });
      setIcon(groupHead.createSpan({ cls: "tj-import-groupico" }), "users");
      groupHead.createSpan({ text: "This Trading Group" });
      groupBox.createDiv({
        cls: "tj-import-groupsub",
        text: `These trades land in ${leaders.join(", ")} and are copied to ${copiers.join(
          ", "
        )}. Untick any you don't want — nothing is enforced.`,
      });
      this.renderAccountRows(groupBox, groupAccs, baseIds);
    }

    if (freeAccs.length) {
      const accBox = host.createDiv({ cls: "tj-import-accs" });
      accBox.createDiv({
        cls: "tj-import-maphead",
        text: members.size ? "Other accounts" : "Also record these trades in",
      });
      this.renderAccountRows(accBox, freeAccs, baseIds);
    }
  }

  /** One tickable row per account. The row is the target; the dot is the state. */
  private renderAccountRows(host: HTMLElement, list: PropAccount[], baseIds: Set<string>): void {
    for (const a of list) {
      const row = host.createEl("label", { cls: "tj-import-acc" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = this.includeIds.has(a.id);
      // A green dot says "this one is in" at a glance. The tick is still the
      // control; the dot is the state, and it is the same green everywhere.
      const dot = row.createSpan({ cls: "tj-import-accdot" + (box.checked ? " is-on" : "") });
      box.addEventListener("change", () => {
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
        if (Number.isFinite(a.copyMultiplier)) who.createSpan({ cls: "tj-ratio", text: `×${a.copyMultiplier}` });
      }
      // A copier only mirrors the part of the file it was actually following.
      // Saying so now is the difference between "it worked" and "it silently
      // did nothing".
      const win = this.copyWindow(a, baseIds);
      if (win) {
        who.createSpan({
          cls: "tj-import-window" + (win.inWindow === 0 ? " is-warn" : ""),
          text: `copies ${win.inWindow} of ${win.total}`,
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
    chip.createSpan({ cls: "tj-import-chipkind", text: this.fileKind(this.tradesText) });
    chip.createSpan({ text: this.parsed.name, cls: "tj-import-chipname" });
    if (this.parsed.costFileName) {
      chip.createSpan({ cls: "tj-import-chipmore", text: "+" });
      chip.createSpan({ cls: "tj-import-chipkind", text: "Cash History" });
      chip.createSpan({ text: this.parsed.costFileName, cls: "tj-import-chipname" });
    }

    // Step two. The file is in hand, so the reader gets what belongs to it:
    // where its times were written, and whether the platform's bill is coming
    // with it. The recommendation has done its job and shrinks to one line.
    if (this.headSubEl) this.headSubEl.setText("Nothing is written until you press the button.");
    if (this.tradesTitleEl) this.tradesTitleEl.style.display = "none";
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
        this.plugin.openAccounts();
      });
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
        text: "Costs are not recorded: an Orders or Fills export carries the commission but not the exchange, clearing and NFA lines, and half a cost would be a wrong number. Drop the Cash History report with it and the whole bill is recorded exactly.",
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

    // ---- where these trades go --------------------------------------------
    // One question, asked before the times and the costs, because every other
    // number on this screen depends on the answer. Until it is answered the
    // group and the extra accounts are not even drawn: a question that has not
    // been asked cannot be answered wrongly.
    if (!this.baseIds().length) {
      // A tick hangs off a chosen account. With nothing chosen it is a leftover
      // from an earlier pick, and a leftover must never light the button.
      this.includeIds.clear();
      this.groupSeeded = "";
    }
    this.renderPick();

    const t = this.importable;
    const net = t.reduce((s, x) => s + (Number.isFinite(x.pnl) ? netPnl(x) : 0), 0);

    const box = body.createDiv({ cls: "tj-import-review" });
    const top = box.createDiv({ cls: "tj-import-reviewtop" });
    top.createSpan({ cls: "tj-import-reviewcount", text: `${t.length} trade${t.length === 1 ? "" : "s"} recognised` });
    if (this.duplicates) {
      top.createSpan({ cls: "tj-import-pill", text: `${this.duplicates} already in the journal` });
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
        async (id) => {
          if (id === "__new__") {
            const name = window.prompt("Name your strategy");
            if (!name || !name.trim()) return;
            this.setupPick = await this.plugin.addStrategy(name);
            this.knownSetups = await this.plugin.knownSetups();
          } else {
            this.setupPick = id === "__none__" ? "" : id;
          }
          await this.renderReview();
        },
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
      }
      if (t.length > 8) {
        const more = tbody.createEl("tr", { cls: "is-more" });
        more.createEl("td", { attr: { colspan: "6" }, text: `… ${t.length - 8} more` });
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
    const go = foot.createEl("button", { cls: "tj-actionbtn is-primary", text: `Import ${t.length} trade${t.length === 1 ? "" : "s"}` });
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
    let net = 0;
    for (const t of this.existing) {
      const mapped = this.plugin.mappedAccount(t.account || "");
      if (mapped && mapped.id === id && Number.isFinite(t.pnl)) net += netPnl(t);
    }
    for (const t of this.importable) {
      if (Number.isFinite(t.pnl)) net += netPnl(t);
    }
    const inAccount = this.round2(Math.max(0, costs.charged - costs.recorded));
    const journal =
      (acc.size || 0) +
      net -
      this.plugin.accountPayoutsTotal(id) +
      this.plugin.accountDepositsTotal(id) +
      this.plugin.accountFeeAdjustmentsTotal(id) -
      inAccount;
    return { journal: this.round2(journal), platform: costs.finalBalance as number };
  }

  private async splitDuplicates(): Promise<void> {
    if (!this.parsed) return;
    const existing = await this.plugin.loadTradesExpanded();
    this.existing = existing;
    const seen = new Set<string>();
    for (const t of existing) {
      const key = this.dedupeKey(t);
      if (key) seen.add(key);
    }
    this.importable = [];
    this.duplicates = 0;
    for (const t of this.parsed.trades) {
      const key = this.dedupeKey(t);
      if (key && seen.has(key)) {
        this.duplicates += 1;
        continue;
      }
      if (key) seen.add(key);
      this.importable.push(t);
    }
  }

  /** A trade is the same trade when it carries the same fill id. */
  private dedupeKey(t: Trade): string {
    return t.fillId ? `${t.fillId}` : "";
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
      assigned.push({ ...t, account: acc.name, accountType: acc.type, setup: this.setupPick || t.setup || "" });
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
      if (count === 0 || expected.size > 0) {
        new Notice(
          `Nothing was written — ${expected.size || "no"} trade${
            expected.size === 1 ? "" : "s"
          } could not be confirmed on disk. Try again.`
        );
        btn.disabled = false;
        btn.setText("Retry");
        this.busy = false;
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
      // like itself between the before and the after.
      const legs = withLegs.length - assigned.length;
      const noStrategyIds = assigned
        .filter((t) => !(t.setup || "").trim())
        .map((t) => byKey.get(this.noteKey(t)))
        .filter((x): x is string => !!x);
      const foot = this.actionsEl;
      if (foot) {
        foot.empty();
        const done = foot.createDiv({ cls: "tj-import-done" });
        setIcon(done.createSpan({ cls: "tj-import-doneico" }), "check");
        done.createSpan({
          text: [
            `${assigned.length} trade${assigned.length === 1 ? "" : "s"} imported`,
            legs > 0 ? `+${legs} copy leg${legs === 1 ? "" : "s"}` : "",
            this.duplicates ? `${this.duplicates} duplicate${this.duplicates === 1 ? "" : "s"} skipped` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        });
        // The trades the file could not file: one click to give them a strategy,
        // in the ledger itself, where the picker already lives.
        if (noStrategyIds.length) {
          const warn = foot.createDiv({ cls: "tj-import-nostrategy" });
          warn.createSpan({
            text: `${noStrategyIds.length} trade${noStrategyIds.length === 1 ? "" : "s"} without a strategy.`,
          });
          const assign = warn.createEl("button", { cls: "tj-actionbtn", text: "Assign strategies" });
          assign.addEventListener("click", () => {
            this.close();
            void this.plugin.openTradeLogForIds(noStrategyIds);
          });
        }
        // One file, one import: the way out is forward, not back.
        const doneBtn = foot.createEl("button", { cls: "tj-actionbtn", text: "Done" });
        doneBtn.addEventListener("click", () => this.close());
      }
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
