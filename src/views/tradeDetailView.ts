import { ItemView, Notice, TFile, normalizePath, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { renderAppShell } from "../ui";
import { fmtMoney, fmtMoney2, fmtMoneyAbs, fmtPrice } from "../tz";
import { legBaseKey } from "../lib/copy";
import { setTradeMistakeTags, updateTradeArrayFields, updateTradeFields, updateTradeScreenshots } from "../storage";
import { normalizeTags } from "../lib/tags";
import { PrintAnnotator } from "./printAnnotator";
import { attachTip } from "../lib/tip";
import { fillIndex, fillLabel, fillSet, FillSet, isBreakEven, toneClass, tradePoints } from "../lib/fills";
import { futuresSpec } from "../futures";
import { sessionLabel, sessionOf, SESSION_UNKNOWN } from "../lib/sessions";
import { formatDate } from "../lib/dates";
import { holdFmt, tradeR } from "../lib/tradeTable";
import { mountDropdown, DropdownItem } from "../lib/dropdown";
import { freeNumeric } from "../lib/numeric";
import { feeForTrade } from "../lib/fees";
import { optionalSummary, reviewStatus } from "../lib/review";

export const TRADE_DETAIL_VIEW_TYPE = "tradebook-trade-detail-view";

/**
 * Out-of-the-box tag chips. They are only *suggestions*: they sit in the review
 * card as unselected chips so a new journal already has a vocabulary to click,
 * and never write themselves onto a trade. A label the trader uses elsewhere
 * joins the same pool, and the inline input still adds anything else.
 */
const DEFAULT_MISTAKE_TAGS = ["Hesitation Entry", "Early Exit", "FOMO", "Moved Stop", "Overleveraged"];
const DEFAULT_PSYCHOLOGY_TAGS = ["Confident", "Anxious", "Impatient", "Revenge", "Disciplined"];

export class TradeDetailView extends ItemView {
  plugin: TradebookPlugin;
  trade: Trade | null = null;
  allTrades: Trade[] = [];
  index = -1;
  /** Where this review came from — an account keeps the walk inside that account. */
  private from: { type: "tradelog" | "account"; accountId?: string } | null = null;
  /** Setup names available in the picker — registry + names used by notes. */
  setupOptions: string[] = [];
  /** Pending debounced review saves, keyed by field — flushed on switch/close. */
  private _saveTimers: Record<string, { timer: number; run: () => Promise<void> }> = {};
  /** Screenshot on show in the carousel — reset whenever the trade changes. */
  private _activePrint = 0;
  /** Tear-down for an open Enlarge lightbox (removes overlay + key listener). */
  private _lightboxCleanup: (() => void) | null = null;

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRADE_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.trade ? `Trade · ${this.trade.symbol} · ${this.trade.date}` : "Trade";
  }

  getIcon(): string {
    return "lines";
  }

  getState(): Record<string, unknown> {
    return { tradeId: this.trade?.id ?? null, from: this.from ?? undefined };
  }

  /** The origin to read: the state's, or the one the plugin just set. */
  private get origin(): { type: "tradelog" | "account"; accountId?: string } {
    return this.from ?? this.plugin.tradeDetailOrigin ?? { type: "tradelog" as const };
  }

  /** The trades this review walks through: the whole journal, or one account's. */
  private async loadScope(): Promise<Trade[]> {
    const all = await this.plugin.loadTrades();
    const accountId = this.origin.type === "account" ? this.origin.accountId : "";
    if (!accountId) return all;
    const mine = all.filter((t) => this.plugin.mappedAccount(t.account)?.id === accountId);
    // A leg or an unmapped trade still has to open: never hand back an empty list.
    return mine.length ? mine : all;
  }

  /** Tag suggestions: the house defaults first, then labels already used. */
  private knownTags(key: "psychology_tags" | "mistake_tags"): string[] {
    const defaults = key === "mistake_tags" ? DEFAULT_MISTAKE_TAGS : DEFAULT_PSYCHOLOGY_TAGS;
    const seen = new Set(defaults.map((t) => t.toLowerCase()));
    const extra: string[] = [];
    for (const tr of this.allTrades) {
      for (const tag of (tr[key] ?? []) as string[]) {
        const clean = (tag || "").trim();
        if (clean && !seen.has(clean.toLowerCase())) {
          seen.add(clean.toLowerCase());
          extra.push(clean);
        }
      }
    }
    extra.sort((a, b) => a.localeCompare(b));
    return [...defaults, ...extra];
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    const id = state.tradeId as string | null;
    if (!id) return;
    const from = state.from as { type: "tradelog" | "account"; accountId?: string } | undefined;
    if (from) this.from = from;
    const trades = await this.loadScope();
    this.allTrades = trades;
    const found = trades.find((t) => t.id === id);
    if (found) await this.setTrade(found);
  }

  async setTrade(trade: Trade): Promise<void> {
    // Any pending review edit belongs to the trade we are leaving — write it
    // before the view switches, or it is lost to the debounce.
    this.flushReviewSaves();
    this._activePrint = 0;
    this.trade = trade;
    // Points are recomputed from the fills/scalars on display: a note written
    // before the fix carries the old quantity-multiplied value, and the note
    // itself is only rewritten when the user edits it.
    trade.pnlPoints = tradePoints(trade);
    if (this.allTrades.length === 0) this.allTrades = await this.loadScope();
    this.index = this.allTrades.findIndex((t) => t.id === trade.id);
    try {
      this.setupOptions = await this.plugin.knownSetups();
    } catch {
      this.setupOptions = this.plugin.settings.setups || [];
    }
    this.render();
  }

  private keydownHandler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      void this.prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      void this.next();
    }
  };

  async onOpen(): Promise<void> {
    if (!this.trade) {
      // Try to restore from view state (survives Obsidian reload)
      let saved: { tradeId?: string; from?: { type: "tradelog" | "account"; accountId?: string } } | undefined;
      try { saved = (this.leaf as any).getViewState?.()?.state; } catch { /* */ }
      if (saved?.from) this.from = saved.from;
      const savedId = saved?.tradeId;
      const trades = await this.loadScope();
      this.allTrades = trades;
      if (savedId) {
        const found = trades.find((t) => t.id === savedId);
        if (found) { await this.setTrade(found); window.addEventListener("keydown", this.keydownHandler); return; }
      }
      if (trades.length) await this.setTrade(trades[0]);
      else this.render();
    }
    window.addEventListener("keydown", this.keydownHandler);
  }

  async onClose(): Promise<void> {
    this.flushReviewSaves();
    window.removeEventListener("keydown", this.keydownHandler);
    this._lightboxCleanup?.();
    // Clean up paste listeners from dropzone / add tile
    this.contentEl.querySelectorAll<HTMLElement>(".tj-td-dropzone, .tj-td-shot-add").forEach((el) => {
      if ((el as any)._cleanupPaste) (el as any)._cleanupPaste();
    });
  }

  async prev(): Promise<void> {
    if (this.index <= 0) return;
    this.index -= 1;
    const t = this.allTrades[this.index];
    if (t) await this.setTrade(t);
  }

  async next(): Promise<void> {
    if (this.index < 0 || this.index >= this.allTrades.length - 1) return;
    this.index += 1;
    const t = this.allTrades[this.index];
    if (t) await this.setTrade(t);
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-trade-detail");
    const main = renderAppShell(root, this.plugin, "");

    const t = this.trade;
    if (!t) {
      main.createDiv({ cls: "tj-empty", text: "No trade selected — open one from the Trade Log, Calendar or Dashboard." });
      return;
    }

    const zone = this.plugin.settings.timeZone;

    // ---- Header ----
    const head = main.createDiv({ cls: "tj-td-head" });

    // Segmented nav: Back + Prev + Counter + Next
    const navBtns = head.createDiv({ cls: "tj-td-nav" });
    const origin = this.origin;
    const backToAccount = origin.type === "account" && origin.accountId;

    const backBtn = navBtns.createEl("button", {
      cls: "tj-seg-btn",
      attr: { "aria-label": backToAccount ? "Back to account" : "Back to trade log" },
    });
    setIcon(backBtn, "chevron-left");
    backBtn.addEventListener("click", () => {
      if (backToAccount) void this.plugin.openAccountDashboard(undefined, origin.accountId as string);
      else void this.plugin.openTradeLog();
    });
    if (backToAccount) {
      const tlBtn = navBtns.createEl("button", { cls: "tj-seg-btn", text: "Trade Log" });
      tlBtn.addEventListener("click", () => void this.plugin.openTradeLogForAccount(origin.accountId as string));
    }

    const prevBtn = navBtns.createEl("button", { cls: "tj-seg-btn", attr: { "aria-label": "Previous trade" } });
    setIcon(prevBtn, "chevron-left");
    prevBtn.disabled = this.index <= 0;
    prevBtn.addEventListener("click", () => void this.prev());

    navBtns.createEl("span", { cls: "tj-td-counter", text: `${this.index + 1} / ${this.allTrades.length}` });
    if (backToAccount) {
      const acc = this.plugin.settings.propAccounts.find((a) => a.id === origin.accountId);
      const scope = navBtns.createSpan({ cls: "tj-td-scope", text: acc?.name ?? "This account" });
      attachTip(scope, { title: "Scoped to this account", sub: "These arrows walk only this account's trades." });
    }

    const nextBtn = navBtns.createEl("button", { cls: "tj-seg-btn", attr: { "aria-label": "Next trade" } });
    setIcon(nextBtn, "chevron-right");
    nextBtn.disabled = this.index < 0 || this.index >= this.allTrades.length - 1;
    nextBtn.addEventListener("click", () => void this.next());

    // ---- Review dots (4 required stages — automatic indicators) ----
    const dotsState = reviewStatus(t);
    const reviewStateHost = head.createDiv({ cls: "tj-td-review-state" });
    const reviewDots = reviewStateHost.createDiv({ cls: "tj-td-review-dots" });
    for (const chk of dotsState.checks.filter((c) => c.required)) {
      const dot = reviewDots.createEl("span", { cls: "tj-td-review-dot" + (chk.done ? " done" : "") });
      dot.createSpan({ cls: "tj-sr-only", text: `${chk.label}: ${chk.done ? "complete" : "missing"}` });
      attachTip(dot, { title: chk.label, sub: chk.done ? "Complete" : "Missing" });
    }
    const optSummary = reviewStateHost.createSpan({ cls: "tj-td-hero-summary", text: dotsState.optionalSummary });
    optSummary.toggleClass("is-hidden", !dotsState.optionalSummary);

    // Multi-account badge — this trade lives in more than one account when it was
    // copied. The badge waits for the expanded records, then shows itself only if
    // there is a sibling to show (a single-account trade never gets a badge).
    const accBadgeHost = head.createDiv({ cls: "tj-td-accbadge-host" });
    void this.renderAccountBadge(accBadgeHost, t);

    // Head actions — Export + Reload + Delete (icon ghost buttons)
    const headActions = head.createDiv({ cls: "tj-td-head-actions" });
    const exportBtn = headActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button", "aria-label": "Export trade card" },
    });
    setIcon(exportBtn, "download");
    attachTip(exportBtn, { title: "Export trade card", sub: "Choose what to include and save as PNG." });
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showExportPanel();
    });
    const refresh = headActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button", "aria-label": "Reload from note" },
    });
    setIcon(refresh, "refresh-cw");
    attachTip(refresh, { title: "Reload from note", sub: "For when you edited the file by hand." });
    refresh.addEventListener("click", async () => {
      const currentId = this.trade?.id;
      if (!currentId) return;
      this.plugin.clearTradeCache();
      const fresh = await this.loadScope();
      this.allTrades = fresh;
      const found = fresh.find((x) => x.id === currentId);
      if (found) {
        this.trade = found;
        this.index = fresh.findIndex((x) => x.id === currentId);
      }
      this.render();
    });
    const delBtn = headActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button", "aria-label": "Delete trade" },
    });
    setIcon(delBtn, "trash");
    attachTip(delBtn, {
      title: "Delete trade",
      sub: "Moves the markdown note to the vault trash. If this trade was copied to other accounts, all linked copies are deleted too.",
    });
    delBtn.addEventListener("click", async () => {
      const extra = t.isCopiedTrade ? " This will also remove all linked copies." : "";
      if (window.confirm(`Delete trade ${t.symbol} (${t.date}, $${t.pnl})?${extra}`)) {
        await this.plugin.deleteTrade(t.id);
        if (backToAccount) await this.plugin.openAccountDashboard(undefined, origin.accountId as string);
        else await this.plugin.openTradeLog();
      }
    });

    // ---- Body ----
    const body = main.createDiv({ cls: "tj-td-body" });

    // ---- Hero bar — title and badges left, headline figures right ----
    const heroTone = t.pnl >= 0 ? "pos" : "neg";
    const dirLabel = t.direction === "long" ? "Long" : t.direction === "short" ? "Short" : "—";
    const reviewState = reviewStatus(t);
    const hero = body.createDiv({ cls: "tj-td-hero" });
    const heroTitle = hero.createDiv({ cls: "tj-td-hero-title-group" });
    heroTitle.createSpan({ cls: "tj-td-hero-title", text: `${t.symbol} · ${dirLabel}` });
    heroTitle.createSpan({
      cls: "tj-td-hero-when",
      text: `${t.date}${t.entryTime ? ", " + t.entryTime : ""}`,
    });
    if (t.direction === "long" || t.direction === "short") {
      heroTitle.createSpan({ cls: `tj-td-hero-badge is-${t.direction}`, text: dirLabel });
    }
    if (t.setup) heroTitle.createSpan({ cls: "tj-td-hero-badge", text: t.setup });
    const statusBadge = heroTitle.createEl("button", {
      cls:
        "tj-td-hero-badge is-status " +
        (reviewState.complete ? "is-reviewed" : "is-needs-review"),
      text: reviewState.complete ? "Reviewed" : "Needs Review",
      attr: { type: "button" },
    });
    attachTip(statusBadge, {
      title: reviewState.complete ? "Reviewed" : "Needs review",
      sub: reviewState.complete
        ? "Every review step is done. Click to open it again."
        : "Notes, a strategy, a print and a rating complete the review. Click to mark it done.",
    });
    statusBadge.addEventListener("click", async () => {
      const next = !reviewStatus(this.trade!).complete;
      this.trade!.reviewed = next;
      await this.saveField("reviewed" as any, String(next));
      this.render();
    });
    const heroMetrics = hero.createDiv({ cls: "tj-td-hero-metrics" });
    const heroMetric = (label: string, value: string, tone = "") => {
      const metric = heroMetrics.createDiv({ cls: "tj-td-hero-metric" });
      metric.createSpan({ cls: "tj-td-hero-k", text: label });
      metric.createSpan({ cls: "tj-td-hero-v" + (tone ? " " + tone : ""), text: value });
    };
    const heroPts = t.pnlPoints;
    const heroPtsStr = typeof heroPts === "number" && Number.isFinite(heroPts)
      ? `${heroPts >= 0 ? "+" : ""}${heroPts.toFixed(2)} pts`
      : "—";
    heroMetric("P&L", fmtMoney2(t.pnl), heroTone);
    heroMetric("Points", heroPtsStr, (heroPts ?? 0) >= 0 ? "pos" : "neg");
    heroMetric("Hold Time", holdFmt(t.entryTime, t.exitTime));

    // Two-column layout
    const cols = body.createDiv({ cls: "tj-td-cols" });

    // ================================================================
    // LEFT COLUMN — two cards: Execution & Risk, then Review & Psychology
    // ================================================================
    const leftCol = cols.createDiv({ cls: "tj-td-left" });

    /** A framed card with an uppercase section head — the page's surface unit. */
    const panelCard = (host: HTMLElement, title: string): HTMLElement => {
      const card = host.createDiv({ cls: "tj-td-panel" });
      const cardHead = card.createDiv({ cls: "tj-td-panel-head" });
      cardHead.createEl("div", { cls: "tj-td-panel-title", text: title });
      return card.createDiv({ cls: "tj-td-panel-body" });
    };
    const execCard = panelCard(leftCol, "Execution & Risk");
    const reviewCard = panelCard(leftCol, "Critical Review & Psychology");

    // --- Click-to-edit helpers ---
    const spec = futuresSpec(t.symbol);
    const pointValue = spec.pointValue;

    /** Make a value span clickable → transforms into an input on click. */
    const editableRow = (
      host: HTMLElement,
      label: string,
      currentValue: string,
      onSave: (newVal: string) => Promise<void>,
      opts?: { numeric?: boolean; tip?: string }
    ) => {
      const r = host.createDiv({ cls: "tj-td-flip-row" });
      r.createEl("span", { cls: "tj-td-flip-key", text: label });
      const valSpan = r.createEl("span", { cls: "tj-td-flip-val", text: currentValue });
      valSpan.style.cursor = "pointer";
      attachTip(
        valSpan,
        opts?.tip
          ? { title: "Click to edit", sub: opts.tip }
          : { title: "Click to edit", sub: `Change ${label.toLowerCase()}` }
      );
      valSpan.addEventListener("click", () => {
        // Replace span with input
        const input = document.createElement("input");
        input.type = opts?.numeric ? "number" : "text";
        input.className = "tj-td-flip-input";
        input.value = currentValue.replace(/[^0-9.\-]/g, "");
        if (opts?.numeric) freeNumeric(input);
        input.style.width = "100%";
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        const save = async () => {
          const raw = input.value.trim();
          if (raw !== currentValue.replace(/[^0-9.\-]/g, "")) {
            await onSave(raw);
          } else {
            // Revert — put span back
            const newSpan = document.createElement("span");
            newSpan.className = "tj-td-flip-val";
            newSpan.textContent = currentValue;
            input.replaceWith(newSpan);
          }
        };
        input.addEventListener("blur", () => void save());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
          if (e.key === "Escape") { input.value = currentValue.replace(/[^0-9.\-]/g, ""); input.blur(); }
        });
      });
      return valSpan;
    };

    // Static (computed) row — not editable
    const row = (host: HTMLElement, label: string, value: string, tone = "") => {
      const r = host.createDiv({ cls: "tj-td-flip-row" });
      r.createEl("span", { cls: "tj-td-flip-key", text: label });
      r.createEl("span", { cls: "tj-td-flip-val" + (tone ? " " + tone : ""), text: value });
    };

    const fillData = fillSet(t);

    // The dollars at risk are derived, never stored: a stop and an entry are
    // all the note needs, and the risk follows from the symbol's point value.
    const qty = t.quantity || 1;
    const riskDollar = (t.stopLoss && t.entryPrice)
      ? Math.abs(t.entryPrice - t.stopLoss) * pointValue * qty
      : null;

    // ---- Entry → Exit (each price edits on its own) ----
    const eeRow = execCard.createDiv({ cls: "tj-td-flip-row" });
    eeRow.createEl("span", { cls: "tj-td-flip-key", text: "Entry → Exit" });
    const eeVal = eeRow.createEl("span", { cls: "tj-td-flip-val" });
    const entryPart = eeVal.createEl("span", { cls: "tj-td-ee-part", text: t.entryPrice ? fmtPrice(t.entryPrice) : "—" });
    eeVal.createEl("span", { cls: "tj-td-ee-arrow", text: " → " });
    const exitPart = eeVal.createEl("span", { cls: "tj-td-ee-part", text: t.exitPrice ? fmtPrice(t.exitPrice) : "—" });
    const editPrice = (part: HTMLElement, current: number, onSave: (price: number) => Promise<void>) => {
      part.style.cursor = "pointer";
      attachTip(part, { title: "Click to edit", sub: "Change this price" });
      part.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "tj-td-flip-input";
        input.value = current ? String(current) : "";
        freeNumeric(input);
        input.style.width = "100%";
        part.replaceWith(input);
        input.focus();
        input.select();
        const restore = () => {
          const s = document.createElement("span");
          s.className = "tj-td-ee-part";
          s.textContent = current ? fmtPrice(current) : "—";
          input.replaceWith(s);
        };
        input.addEventListener("blur", async () => {
          const price = parseFloat(input.value.trim());
          if (Number.isFinite(price) && price !== current) await onSave(price);
          else restore();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
          if (e.key === "Escape") { e.preventDefault(); restore(); }
        });
      });
    };
    editPrice(entryPart, t.entryPrice, async (price) => {
      this.trade!.entryPrice = price;
      await this.saveFields({ entry_price: String(price) });
      this.render();
    });
    editPrice(exitPart, t.exitPrice, async (price) => {
      this.trade!.exitPrice = price;
      await this.saveFields({ exit_price: String(price) });
      this.render();
    });

    // ---- R-Multiple (pnl over the dollars at risk) ----
    const rMultiple = riskDollar && riskDollar > 0 ? t.pnl / riskDollar : null;
    const rTone = rMultiple !== null ? (rMultiple >= 0 ? "pos" : "neg") : "";
    const rRow = execCard.createDiv({ cls: "tj-td-flip-row" });
    rRow.createEl("span", { cls: "tj-td-flip-key", text: "R-Multiple" });
    rRow.createEl("span", {
      cls: "tj-td-flip-val" + (rTone ? " " + rTone : "") + (rMultiple !== null ? " is-hero" : ""),
      text: rMultiple !== null ? `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R` : "—",
    });

    // ---- Contracts (editable) ----
    const contractsVal = String(t.quantity ?? 1);
    editableRow(execCard, "Contracts", contractsVal, async (raw) => {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) {
        this.trade!.quantity = n;
        await this.saveFields({ quantity: String(n) });
        this.render();
      }
    }, { numeric: true });

    // ---- Stop / Risk and Target (one row each, one input, two formats) ----
    // A plain number is the price; a `$` amount derives it from the entry — the
    // stop sits on the losing side of the trade, the target on the winning side.
    // One parser for both rows, so they can never drift apart. The click is
    // delegated from the card so a row keeps working after its value span is
    // rebuilt — a cancel used to leave a dead span behind.
    const parsePriceOrDollars = (raw: string, towards: "stop" | "target"): number | null => {
      if (raw.startsWith("$")) {
        const dollars = parseFloat(raw.replace(/[$,]/g, ""));
        if (!Number.isFinite(dollars) || !t.entryPrice) return null;
        const dist = dollars / pointValue / qty;
        if (towards === "target") return t.direction === "long" ? t.entryPrice + dist : t.entryPrice - dist;
        return t.direction === "long" ? t.entryPrice - dist : t.entryPrice + dist;
      }
      const price = parseFloat(raw.replace(/[,$]/g, ""));
      return Number.isFinite(price) ? price : null;
    };

    const stopDisplay = t.stopLoss ? fmtPrice(t.stopLoss) : "";
    const riskDisplay = riskDollar !== null ? `$${riskDollar.toFixed(0)}` : "";
    const srText = stopDisplay
      ? riskDisplay
        ? `${stopDisplay} / ${riskDisplay}`
        : stopDisplay
      : "— / —";
    const targetDollars = t.target && t.entryPrice
      ? Math.abs(t.target - t.entryPrice) * pointValue * qty
      : null;
    const targetText = t.target
      ? `${fmtPrice(t.target)} / ${targetDollars !== null ? `$${targetDollars.toFixed(2)}` : "—"}`
      : "— / —";
    const srRow = execCard.createDiv({ cls: "tj-td-flip-row" });
    srRow.createEl("span", { cls: "tj-td-flip-key", text: "Stop / Risk" });
    const srVal = srRow.createEl("span", {
      cls: "tj-td-flip-val",
      text: srText,
      attr: { "data-field": "stopLoss" },
    });
    srVal.style.cursor = "pointer";
    attachTip(srVal, { title: "Click to edit", sub: "A price, or a $ risk." });

    const beginPriceOrDollarsEdit = (span: HTMLElement) => {
      const field: "stopLoss" | "target" = span.dataset.field === "target" ? "target" : "stopLoss";
      const towards = field === "target" ? "target" : "stop";
      const shown = field === "target" ? targetText : srText;
      const tip = field === "target"
        ? { title: "Click to edit", sub: "A price, or a $ target." }
        : { title: "Click to edit", sub: "A price, or a $ risk." };
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tj-td-flip-input";
      input.value = field === "target" ? (t.target ? String(t.target) : "") : (t.stopLoss ? String(t.stopLoss) : "");
      input.placeholder = field === "target" ? "Price or $ target" : "Price or $ risk";
      input.style.width = "100%";
      span.replaceWith(input);
      input.focus();
      input.select();
      const restore = () => {
        const s = document.createElement("span");
        s.className = "tj-td-flip-val";
        s.setAttribute("data-field", field);
        s.style.cursor = "pointer";
        s.textContent = shown;
        input.replaceWith(s);
        attachTip(s, tip);
      };
      input.addEventListener("blur", async () => {
        const price = parsePriceOrDollars(input.value.trim(), towards);
        if (price !== null) {
          const rounded = Math.round(price * 100) / 100;
          if (field === "target") {
            this.trade!.target = rounded;
            await this.saveFields({ target: String(rounded) });
          } else {
            this.trade!.stopLoss = rounded;
            await this.saveFields({ stop_loss: String(rounded) });
          }
          this.render();
        } else restore();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { e.preventDefault(); restore(); }
      });
    };
    execCard.addEventListener("click", (e) => {
      const span = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        ".tj-td-flip-val[data-field='stopLoss'], .tj-td-flip-val[data-field='target']"
      );
      if (span && execCard.contains(span)) beginPriceOrDollarsEdit(span);
    });

    // ---- Target (same two formats as Stop / Risk) ----
    const tgRow = execCard.createDiv({ cls: "tj-td-flip-row" });
    tgRow.createEl("span", { cls: "tj-td-flip-key", text: "Target" });
    const tgVal = tgRow.createEl("span", {
      cls: "tj-td-flip-val",
      text: targetText,
      attr: { "data-field": "target" },
    });
    tgVal.style.cursor = "pointer";
    attachTip(tgVal, { title: "Click to edit", sub: "A price, or a $ target." });

    const sessKey = sessionOf(t, zone);
    const sessRow = execCard.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
    sessRow.createEl("span", { cls: "tj-td-flip-key", text: "Session" });
    const sessWrap = sessRow.createDiv({ cls: "tj-td-flip-strat-wrap" });
    const sessItems: DropdownItem[] = [
      { id: "newyork", label: "New York", note: "09:30–16:00 ET" },
      { id: "london", label: "London", note: "03:00–09:30 ET" },
      { id: "asia", label: "Asia", note: "19:00–03:00 ET" },
      { id: "off", label: "Off Hours", note: "16:00–19:00 ET" },
      { id: "__auto__", label: "Auto-detect", note: "Based on entry time" },
    ];
    mountDropdown(
      sessWrap,
      sessItems,
      (t as any).sessionOverride || sessKey || "",
      async (id) => {
        if (id === "__auto__") {
          delete (t as any).sessionOverride;
        } else {
          (t as any).sessionOverride = id;
        }
        await this.saveFields({ session_override: id === "__auto__" ? "" : id });
        this.render();
      },
      { placeholder: "Session…" }
    );

    // ---- Fees (editable) ----
    // The platform's own figure, plus this trade's slice of any balance
    // correction — the same split the Correct fees modal logs. The slice is a
    // model, not a line the broker wrote, so it is shown beside the real number
    // and never folds into it; editing only ever changes the platform figure.
    const realFees = (t.commission || 0) + (t.fees || 0);
    const mapped = this.plugin.mappedAccount(t.account || "");
    const fees = mapped
      ? feeForTrade(t, this.plugin.feeAdjustmentsFor(mapped.id))
      : { real: realFees, allocated: 0, total: realFees };
    const feesSpan = editableRow(execCard, "Fees", `$${realFees.toFixed(2)}`, async (raw) => {
      const val = parseFloat(raw.replace(/[$]/g, ""));
      if (Number.isFinite(val)) {
        // Split evenly or put all in fees
        await this.saveFields({ fees: String(val), commission: "0" });
        this.render();
      }
    }, {
      numeric: true,
      tip:
        fees.allocated !== 0
          ? `$${fees.real.toFixed(2)} the platform reported, plus $${fees.allocated.toFixed(2)} this trade's share of the account's balance correction. Editing sets the platform figure.`
          : undefined,
    });
    if (fees.allocated !== 0) {
      feesSpan.setText(`$${fees.total.toFixed(2)} · $${fees.allocated.toFixed(2)} corrected`);
    }

    // ---- Order Type / Max position / Fill count (every row visible) ----
    const otRow = execCard.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
    otRow.createEl("span", { cls: "tj-td-flip-key", text: "Order Type" });
    const otWrap = otRow.createDiv({ cls: "tj-td-flip-strat-wrap" });
    mountDropdown(otWrap, [
      { id: "Limit", label: "Limit" },
      { id: "Market", label: "Market" },
      { id: "Stop", label: "Stop" },
      { id: "Stop Limit", label: "Stop Limit" },
    ], t.orderType || "", async (id) => {
      this.trade!.orderType = id || undefined;
      await this.saveField("order_type" as any, id);
      this.render();
    }, { placeholder: "—" });

    row(execCard, "Max position", String(fillData.positionSize || t.quantity || 1));
    row(execCard, "Fill count", String(fillData.fills.length));

    // ---- Strategy + Rating, side by side ----
    const twoCol = reviewCard.createDiv({ cls: "tj-td-two-col" });

    const stratField = twoCol.createDiv({ cls: "tj-td-field" });
    const stratLbl = stratField.createEl("div", { cls: "tj-td-field-label" });
    stratLbl.createEl("span", { text: "Strategy" });
    const stratWrap = stratField.createDiv({ cls: "tj-td-flip-strat-wrap" });
    const setupItems: DropdownItem[] = this.setupOptions.map((s) => ({ id: s, label: s }));
    setupItems.push({ id: "__new__", label: "＋ New strategy…", note: "Saved to Strategies" });
    const currentSetup = (t.setup || "").trim();
    if (currentSetup && !this.setupOptions.some((s) => s.toLowerCase() === currentSetup.toLowerCase())) {
      setupItems.unshift({ id: currentSetup, label: currentSetup });
    }
    mountDropdown(
      stratWrap,
      setupItems,
      currentSetup,
      async (id) => {
        if (id === "__new__") {
          const name = window.prompt("Name your strategy");
          if (!name || !name.trim()) return;
          const clean = await this.plugin.addSetup(name);
          this.setupOptions = await this.plugin.knownSetups();
          this.trade!.setup = clean;
          await this.saveField("setup", clean);
          this.render();
          return;
        }
        this.trade!.setup = id;
        await this.saveField("setup", id);
        this.render();
      },
      { placeholder: "Pick a strategy…", title: "Strategy this trade followed" }
    );

    // ---- Rating — 5 loose stars, hover lights 1..N ----
    const ratingField = twoCol.createDiv({ cls: "tj-td-field" });
    const ratingLbl = ratingField.createEl("div", { cls: "tj-td-field-label" });
    ratingLbl.createEl("span", { text: "Rating" });
    const starsWrap = ratingField.createDiv({ cls: "tj-td-stars" });
    const starEls: HTMLElement[] = [];
    const glyphEls: HTMLElement[] = [];
    const paintStars = (value: number) => {
      for (let i = 0; i < starEls.length; i++) {
        const on = value >= i + 1;
        glyphEls[i].setText(on ? "★" : "☆");
        starEls[i].toggleClass("on", on);
      }
    };
    const setStarHover = (n: number) => {
      starEls.forEach((el, i) => el.toggleClass("hover-on", n >= 0 && i < n));
    };
    for (let s = 1; s <= 5; s++) {
      const star = starsWrap.createEl("button", { cls: "tj-td-star", attr: { type: "button" } });
      glyphEls.push(star.createSpan({ cls: "tj-td-star-glyph", text: (t.rating ?? 0) >= s ? "★" : "☆" }));
      star.createSpan({ cls: "tj-sr-only", text: `Rate ${s} of 5` });
      attachTip(star, { title: `${s}/5`, sub: "Click the same star again to clear." });
      star.addEventListener("mouseenter", () => setStarHover(s));
      star.addEventListener("click", () => {
        const next = (this.trade!.rating ?? 0) === s ? 0 : s;
        this.trade!.rating = next;
        paintStars(next);
        setStarHover(-1);
        this.refreshReviewHeader();
        this.debounceReview("rating", () => this.saveField("rating" as any, String(next)), 400);
      });
      starEls.push(star);
    }
    starsWrap.addEventListener("mouseleave", () => setStarHover(-1));
    paintStars(t.rating ?? 0);

    // ---- Psychology State / Execution Mistakes (tag-chip selectors) ----
    // Compact by default: only the tags that are ON show as chips, and the full
    // picker lives in a popover behind the header's ghost "＋ Add tag". Edits
    // land in `psychology_tags` / `mistake_tags` as native YAML arrays; mistakes
    // also mirror into the legacy `mistake` scalar via `setTradeMistakeTags`.
    const tagSection = (
      key: "psychology_tags" | "mistake_tags",
      label: string,
      tip: string,
      ack: { field: "psychologyAcknowledged" | "mistakesAcknowledged"; text: string }
    ) => {
      const mistake = key === "mistake_tags";
      const field = reviewCard.createDiv({
        cls: "tj-td-field tj-td-tags" + (mistake ? " tj-td-tags--mistakes" : ""),
      });
      const lbl = field.createEl("div", { cls: "tj-td-field-label" });
      const lblText = lbl.createSpan({ text: label });
      attachTip(lblText, { title: label, sub: tip });
      const addBtn = lbl.createEl("button", { cls: "tj-td-ghostbtn", text: "＋ Add tag", attr: { type: "button" } });
      const chipsWrap = field.createDiv({ cls: "tj-td-tagchips" });

      const ackBtn = field.createEl("button", { cls: "tj-td-ack", text: ack.text, attr: { type: "button" } });
      const paintAck = () => ackBtn.toggleClass("on", this.trade?.[ack.field] === true);
      paintAck();
      ackBtn.addEventListener("click", async () => {
        const next = this.trade?.[ack.field] !== true;
        this.trade![ack.field] = next;
        await this.saveAck(ack.field, next);
        paintAck();
        this.refreshReviewHeader();
      });

      const write = (tags: string[]) => {
        const id = this.trade?.id;
        if (!id) return;
        const file = this.app.vault.getAbstractFileByPath(id) as TFile;
        if (!(file instanceof TFile)) return;
        this.debounceReview(key, async () => {
          try {
            if (mistake) await setTradeMistakeTags(this.app, file, tags);
            else await updateTradeArrayFields(this.app, file, { psychology_tags: tags });
          } catch (err) {
            console.error("[tradebook] failed to save tags:", err);
            new Notice("Could not save tags — check the file still exists.");
          }
        });
      };

      /** Logging a tag contradicts a standing "none" — the acknowledgement steps aside. */
      const clearAckIfNeeded = () => {
        if (this.trade![ack.field] === true) {
          this.trade![ack.field] = false;
          void this.saveAck(ack.field, false);
          paintAck();
        }
      };

      const paintChips = () => {
        const tags = (this.trade?.[key] ?? []) as string[];
        chipsWrap.style.display = tags.length ? "" : "none";
        chipsWrap.empty();
        for (const tag of tags) {
          const chip = chipsWrap.createEl("button", {
            cls: "tj-td-tagchip" + (tags.some((v) => v.toLowerCase() === tag.toLowerCase()) ? " on" : "") + (mistake ? " is-mistake" : ""),
            text: tag,
            attr: { type: "button" },
          });
          chip.addEventListener("click", () => toggle(tag));
        }
      };

      paintChips();

      const toggle = (tag: string) => {
        const cur = (this.trade?.[key] ?? []) as string[];
        const has = cur.some((v) => v.toLowerCase() === tag.toLowerCase());
        const next = has ? cur.filter((v) => v.toLowerCase() !== tag.toLowerCase()) : [...cur, tag];
        const clean = normalizeTags(next);
        this.trade![key] = clean;
        write(clean);
        if (!has) clearAckIfNeeded();
        paintChips();
        paintPop?.();
        this.refreshReviewHeader();
      };

      // ---- Tag popover: the whole vocabulary, a new-tag field and Done ----
      let pop: HTMLElement | null = null;
      let popCleanup: (() => void) | null = null;
      let paintPop: (() => void) | null = null;

      const closePop = () => {
        if (!pop) return;
        popCleanup?.();
        popCleanup = null;
        paintPop = null;
        pop.remove();
        pop = null;
      };

      const openPop = () => {
        closePop();
        const doc = this.contentEl.ownerDocument;
        const win = doc.defaultView ?? window;
        pop = doc.body.createDiv({ cls: "tj-td-tagpop" });

        const commitNew = (raw: string) => {
          const vals = normalizeTags(raw.split(/[,;]+/));
          if (!vals.length) return;
          const cur = (this.trade?.[key] ?? []) as string[];
          const clean = normalizeTags([...cur, ...vals]);
          this.trade![key] = clean;
          write(clean);
          clearAckIfNeeded();
          paintChips();
          this.refreshReviewHeader();
        };

        paintPop = () => {
          paintChips();
          if (!pop) return;
          const panel = pop;
          panel.empty();
          const tags = (this.trade?.[key] ?? []) as string[];
          const on = new Set(tags.map((v) => v.toLowerCase()));
          for (const tag of normalizeTags([...this.knownTags(key), ...tags])) {
            const isOn = on.has(tag.toLowerCase());
            const row = panel.createDiv({ cls: "tj-td-tagpop-row" + (isOn ? " is-on" : "") });
            row.createSpan({ cls: "tj-td-tagpop-check", text: isOn ? "✓" : "" });
            row.createSpan({ cls: "tj-td-tagpop-lbl", text: tag });
            row.addEventListener("click", (e) => {
              e.stopPropagation();
              toggle(tag);
            });
          }
          const input = panel.createEl("input", {
            cls: "tj-td-tagpop-input",
            type: "text",
            attr: { placeholder: "＋ New tag…" },
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNew(input.value);
              input.value = "";
            } else if (e.key === "Escape") {
              e.preventDefault();
              closePop();
            }
          });
          const done = panel.createEl("button", { cls: "tj-td-tagpop-done", text: "Done", attr: { type: "button" } });
          done.addEventListener("click", (e) => {
            e.stopPropagation();
            closePop();
          });
        };
        paintPop();

        // Pin under the ghost link, flipped up when there is no room below.
        const place = () => {
          if (!pop || !addBtn.isConnected) {
            closePop();
            return;
          }
          const r = addBtn.getBoundingClientRect();
          const w = pop.offsetWidth;
          const h = pop.offsetHeight;
          let left = r.right - w;
          let top = r.bottom + 6;
          if (left < 8) left = 8;
          if (left + w > win.innerWidth - 8) left = win.innerWidth - 8 - w;
          if (top + h > win.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h;
          pop.style.left = `${Math.round(left)}px`;
          pop.style.top = `${Math.round(top)}px`;
        };
        place();

        const onDoc = (e: MouseEvent) => {
          const target = e.target as Node | null;
          if (pop && target && (pop.contains(target) || addBtn.contains(target))) return;
          closePop();
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") closePop();
        };
        const observer =
          typeof MutationObserver === "undefined"
            ? null
            : new MutationObserver(() => {
                if (pop && !addBtn.isConnected) closePop();
              });
        observer?.observe(doc.body, { childList: true, subtree: true });
        doc.addEventListener("mousedown", onDoc, true);
        doc.addEventListener("keydown", onKey, true);
        win.addEventListener("resize", place);
        win.addEventListener("scroll", place, true);
        popCleanup = () => {
          observer?.disconnect();
          doc.removeEventListener("mousedown", onDoc, true);
          doc.removeEventListener("keydown", onKey, true);
          win.removeEventListener("resize", place);
          win.removeEventListener("scroll", place, true);
        };
      };

      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (pop) closePop();
        else openPop();
      });
    };
    tagSection(
      "psychology_tags",
      "Psychology State",
      "How you felt in the trade — patient, anxious, revenge. Reused across trades for review.",
      { field: "psychologyAcknowledged", text: "No psychology state to log" }
    );
    tagSection(
      "mistake_tags",
      "Execution Mistakes",
      "What went wrong on the execution — FOMO entry, early exit. Feeds the discipline review.",
      { field: "mistakesAcknowledged", text: "No mistakes this trade" }
    );

    // ---- Notes textarea (replaces thesis/review/mistake) ----
    const notesGroup = reviewCard.createDiv({ cls: "tj-td-field" });
    const notesLbl = notesGroup.createEl("div", { cls: "tj-td-field-label" });
    notesLbl.createEl("span", { text: "Notes" });
    const notesCharCount = notesLbl.createEl("span", { cls: "tj-td-char-count" });
    const notesVal = t.notes || t.thesis || t.review || t.mistake || "";
    notesCharCount.textContent = notesVal ? `${notesVal.length} chars` : "Optional";
    const notesArea = notesGroup.createEl("textarea", {
      cls: "tj-td-textarea",
      attr: { rows: "3", placeholder: "What did you see? What went well or poorly?" },
    });
    notesArea.value = notesVal;
    notesArea.addEventListener("input", () => {
      const val = notesArea.value.trim();
      notesCharCount.textContent = val.length > 0 ? `${val.length} chars` : "Optional";
      if (val === (this.trade!.notes ?? notesVal)) return;
      this.trade!.notes = val;
      this.debounceReview("notes", async () => {
        await this.saveField("notes", val);
        this.refreshReviewHeader();
      });
    });
    // Leaving the field is the one moment a half-typed word should stop waiting.
    notesArea.addEventListener("blur", () => this.flushReviewSaves());

    // ================================================================
    // RIGHT COLUMN — Screenshots & visual analysis + Executions
    // ================================================================
    const rightCol = cols.createDiv({ cls: "tj-td-right" });

    // Build the print list from the array (one-time migration from the legacy scalar).
    const shot = t.screenshot && t.screenshot.trim();
    if ((!t.screenshots || t.screenshots.length === 0) && shot && shot.toLowerCase() !== "added") {
      t.screenshots = [];
      for (const p of shot.split(/[,;\n]+/)) {
        const trimmed = p.trim();
        if (trimmed) t.screenshots.push({ file: trimmed });
      }
      void this.saveScreenshotsNow();
    }
    const prints = (t.screenshots ?? []).filter((s) => s.file);
    if (this._activePrint >= prints.length) this._activePrint = 0;

    // ---- Screenshot card ----
    const shotCard = rightCol.createDiv({ cls: "tj-td-panel tj-td-shot-card" });
    const dzHeader = shotCard.createDiv({ cls: "tj-td-panel-head tj-td-shot-head" });
    dzHeader.createEl("div", {
      cls: "tj-td-panel-title",
      text: prints.length
        ? `Screenshots & Visual Analysis (${prints.length})`
        : "Screenshots & Visual Analysis",
    });
    const dzActions = dzHeader.createDiv({ cls: "tj-td-dropzone-actions" });

    // The element that accepts a new print (add tile, or the empty dropzone).
    let addTarget: HTMLElement;

    // Show the prints — one large preview plus a thumbnail strip to switch.
    if (prints.length > 0) {
      const active = prints[this._activePrint];
      const activeFile = this.resolveImageFile(active.file);
      if (activeFile) {
        const annotateBtn = dzActions.createEl("button", {
          cls: "tj-btn tj-mini", text: "Annotate", attr: { type: "button" },
        });
        annotateBtn.addEventListener("click", () => this.annotate(activeFile));
        const enlargeBtn = dzActions.createEl("button", {
          cls: "tj-btn tj-mini", text: "Enlarge", attr: { type: "button" },
        });
        enlargeBtn.addEventListener("click", () => this.openPrintLarge(activeFile));
      }

      const carousel = shotCard.createDiv({ cls: "tj-td-shot-carousel" });
      const mainWrap = carousel.createDiv({ cls: "tj-td-shot-main" });
      mainWrap.createDiv({
        cls: "tj-td-shot-badge",
        text: `Print ${this._activePrint + 1}`,
      });
      const resolved = this.resolveImage(active.file);
      if (resolved) {
        const img = mainWrap.createEl("img", {
          attr: { src: resolved, alt: `Print ${this._activePrint + 1}` },
        });
        img.addClass("tj-td-shot-img");
        img.addEventListener("error", () => { img.style.opacity = "0.2"; });
        if (activeFile) {
          img.addEventListener("click", () => this.openPrintLarge(activeFile));
          const overlay = mainWrap.createDiv({ cls: "tj-td-shot-annotate" });
          overlay.setText("Annotate");
          overlay.addEventListener("click", () => this.annotate(activeFile));
        }
      } else {
        mainWrap.createDiv({ cls: "tj-hint", text: `Print not found: ${active.file}` });
      }

      const thumbs = carousel.createDiv({ cls: "tj-td-shot-thumbs" });
      prints.forEach((p, i) => {
        const thumb = thumbs.createDiv({
          cls: "tj-td-shot-thumb" + (i === this._activePrint ? " is-active" : ""),
        });
        const tr = this.resolveImage(p.file);
        if (tr) thumb.createEl("img", { attr: { src: tr, alt: `Print ${i + 1}` } });
        else thumb.createDiv({ cls: "tj-td-shot-thumb-missing", text: "?" });
        thumb.createSpan({ cls: "tj-td-shot-thumb-label", text: `Print ${i + 1}` });
        const x = thumb.createEl("button", { cls: "tj-td-shot-remove", attr: { type: "button" } });
        x.createSpan({ cls: "tj-sr-only", text: `Remove print ${i + 1}` });
        setIcon(x, "x");
        x.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          await this.removeScreenshot(i);
        });
        thumb.addEventListener("click", () => {
          if (i === this._activePrint) return;
          this._activePrint = i;
          this.render();
        });
        attachTip(thumb, { title: `Print ${i + 1}`, sub: "Click to show it large." });
      });

      // The add tile closes the strip — same square shape, dashed, never a bar.
      const addTile = thumbs.createDiv({ cls: "tj-td-shot-add" });
      const addPlus = addTile.createDiv({ cls: "tj-td-shot-add-plus" });
      setIcon(addPlus, "plus");
      addTile.createSpan({ cls: "tj-td-shot-add-label", text: "Add Print" });
      attachTip(addTile, { title: "Add print", sub: "Drop an image, click to browse, or Ctrl+V." });
      addTarget = addTile;
    } else {
      // Empty state: the whole card is the drop target.
      const addDropzone = shotCard.createDiv({ cls: "tj-td-dropzone" });
      const iconDiv = addDropzone.createDiv({ cls: "tj-td-dropzone-icon" });
      setIcon(iconDiv, "image");
      const textDiv = addDropzone.createDiv({ cls: "tj-td-dropzone-text" });
      textDiv.createEl("strong", { text: "Drop screenshot here" });
      textDiv.createEl("span", { text: "PNG, JPG, or WebP" });
      const hint = addDropzone.createDiv({ cls: "tj-td-dropzone-hint" });
      hint.createEl("span", { text: "or" });
      hint.createEl("kbd", { text: "Ctrl" });
      hint.createEl("span", { text: "+" });
      hint.createEl("kbd", { text: "V" });
      hint.createEl("span", { text: "to paste" });
      addTarget = addDropzone;
    }

    // Hidden file input + wiring, on whichever element accepts the print.
    const fileInput = addTarget.createEl("input", {
      attr: { type: "file", accept: "image/png,image/jpeg,image/webp" },
    });
    fileInput.style.display = "none";

    addTarget.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      if (fileInput.files && fileInput.files[0]) {
        await this.handleScreenshotFile(fileInput.files[0]);
        fileInput.value = "";
      }
    });

    // Drag & drop
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    addTarget.addEventListener("dragenter", (e) => { stop(e); addTarget.addClass("over"); });
    addTarget.addEventListener("dragover", (e) => { stop(e); addTarget.addClass("over"); });
    addTarget.addEventListener("dragleave", () => { addTarget.removeClass("over"); });
    addTarget.addEventListener("drop", async (e) => {
      stop(e);
      addTarget.removeClass("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) await this.handleScreenshotFile(file);
    });

    // Ctrl+V paste (when hovered or focused)
    let hovered = false;
    addTarget.setAttr("tabindex", "0");
    addTarget.addEventListener("mouseenter", () => { hovered = true; });
    addTarget.addEventListener("mouseleave", () => { hovered = false; });
    addTarget.addEventListener("focus", () => { hovered = true; });
    addTarget.addEventListener("blur", () => { hovered = false; });
    const onPaste = async (e: ClipboardEvent) => {
      if (!hovered && document.activeElement !== addTarget) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) { e.preventDefault(); e.stopPropagation(); await this.handleScreenshotFile(file); }
          return;
        }
      }
    };
    document.addEventListener("paste", onPaste, true);
    (addTarget as any)._cleanupPaste = () => document.removeEventListener("paste", onPaste, true);

    // ---- Accounts block (copied trades) ----
    // ---- Executions (bottom — detailed, read-only) ----
    this.renderExecutions(body, t);
  }

  // ---- Multi-account badge + popover ----
  /** The records that share this trade's identity (itself plus every copy leg). */
  private async accountGroup(t: Trade): Promise<Trade[]> {
    try {
      const all = await this.plugin.loadTradesExpanded();
      const key = legBaseKey(t);
      return all
        .filter((x) => legBaseKey(x) === key)
        .sort((a, b) => Number(a.isCopiedTrade ?? false) - Number(b.isCopiedTrade ?? false));
    } catch {
      return [];
    }
  }

  private async renderAccountBadge(host: HTMLElement, t: Trade): Promise<void> {
    const records = await this.accountGroup(t);
    if (records.length < 2 || !host.isConnected || this.trade?.id !== t.id) {
      host.remove();
      return;
    }

    const btn = host.createEl("button", { cls: "tj-td-accbadge", attr: { type: "button" } });
    const icon = btn.createSpan({ cls: "tj-td-accbadge-ico" });
    setIcon(icon, "users");
    btn.createSpan({ text: `${records.length} accounts` });
    attachTip(btn, {
      title: `One trade, ${records.length} accounts`,
      sub: "Click to see what it did in each leg. Money is real; the count is one trade.",
    });

    const pop = host.createDiv({ cls: "tj-td-accpop" });
    pop.style.display = "none";
    pop.createDiv({ cls: "tj-td-accpop-t", text: "This trade in each account" });

    const table = pop.createDiv({ cls: "tj-td-acctable" });
    const head2 = table.createDiv({ cls: "tj-td-acctable-row is-head" });
    for (const label of ["Account", "Qty", "Avg Entry", "P&L"]) head2.createSpan({ text: label });
    for (const r of records) {
      const row = table.createDiv({ cls: "tj-td-acctable-row" });
      const name = row.createSpan({ cls: "tj-td-acctable-name" });
      name.createSpan({ text: this.plugin.displayAccount(r.account) || "—" });
      if (!r.isCopiedTrade) name.createSpan({ cls: "tj-td-acctag", text: "original" });
      const set = fillSet(r);
      row.createSpan({ cls: "tj-td-acctable-num", text: String(r.quantity ?? set.entryQty ?? "—") });
      row.createSpan({ cls: "tj-td-acctable-num", text: fmtPrice(set.avgEntry || r.entryPrice) });
      row.createSpan({
        cls: "tj-td-acctable-num " + toneClass(r.pnl),
        text: r.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney(r.pnl),
      });
    }
    pop.createDiv({ cls: "tj-td-execs-note" })
      .setText("Your trading numbers count this trade once; the money is what it made in each account.");

    const close = () => { pop.style.display = "none"; document.removeEventListener("mousedown", onDoc); };
    const onDoc = (e: MouseEvent) => { if (!host.contains(e.target as Node)) close(); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = pop.style.display !== "none";
      if (open) { close(); return; }
      pop.style.display = "";
      document.addEventListener("mousedown", onDoc);
    });
  }

  // ---- Executions ----
  private renderExecutions(host: HTMLElement, t: Trade): void {
    const set: FillSet = fillSet(t);
    const box = host.createDiv({ cls: "tj-td-panel tj-td-execs" });
    const head = box.createDiv({ cls: "tj-td-panel-head tj-td-execs-head" });
    head.createEl("div", { cls: "tj-td-panel-title", text: "Executions" });
    head.createSpan({
      cls: "tj-td-execs-count",
      text: set.isMulti
        ? `${set.entries.length} in · ${set.exits.length} out`
        : "single fill",
    });

    const fees = set.fills.reduce((s, f) => s + (f.fees || 0), 0);

    const table = box.createEl("table", { cls: "tj-td-execs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const col of [
      { label: "Time", align: "" }, { label: "Side", align: "" },
      { label: "Qty", align: "r" }, { label: "Price", align: "r" },
      { label: "Points", align: "r" }, { label: "P&L", align: "r" },
      { label: "Fees", align: "r" }, { label: "Fill", align: "" },
    ]) {
      headRow.createEl("th", { cls: col.align, text: col.label });
    }

    const pointValue = futuresSpec(t.symbol).pointValue;
    const tbody = table.createEl("tbody");
    for (const f of set.fills) {
      const isExit = set.exits.includes(f);
      const row = tbody.createEl("tr", { cls: "tj-td-execrow" + (isExit ? " is-exit" : " is-entry") });
      row.createEl("td", { text: f.time || "—" });
      const sideCell = row.createEl("td");
      sideCell.createSpan({ cls: "tj-tbl-fill-side", text: f.side });
      row.createEl("td", { cls: "r", text: `${f.qty}` });
      row.createEl("td", { cls: "r", text: fmtPrice(f.price) });
      const be = isExit && set.explicit && isBreakEven(f, set.avgEntry, pointValue);
      // Points are the fill's own distance from the (weighted) entry, signed by
      // direction — quantity never multiplies them. A break-even close counts 0.
      const points = be
        ? 0
        : isExit && set.avgEntry > 0
        ? t.direction === "long" ? f.price - set.avgEntry : set.avgEntry - f.price
        : NaN;
      row.createEl("td", { cls: "r", text: Number.isFinite(points) ? `${points >= 0 ? "+" : ""}${points.toFixed(2)}` : "—" });
      const pnlCell = row.createEl("td", { cls: "r tj-tbl-pnl" });
      if (!Number.isFinite(f.pnl)) pnlCell.setText("—");
      else { pnlCell.addClass(toneClass(f.pnl as number)); pnlCell.setText(f.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney2(f.pnl as number)); }
      row.createEl("td", { cls: "r", text: f.fees ? `$${f.fees.toFixed(2)}` : "—" });
      const tag = row.createEl("td", { cls: "tj-td-execs-tag" });
      tag.createSpan({
        cls: "tj-tbl-fill-tag" + (be || (isExit && f.pnl === 0) ? " is-flat" : ""),
        text: fillLabel(f, fillIndex(f, set), set, pointValue),
      });
    }

    const totals = tbody.createEl("tr", { cls: "tj-td-execrow is-total" });
    totals.createEl("td"); totals.createEl("td", { text: "Total" });
    totals.createEl("td", { cls: "r", text: String(set.entryQty) });
    totals.createEl("td", { cls: "r", text: set.avgExit > 0 ? fmtPrice(set.avgExit) : "—" });
    const totalPts = Number.isFinite(t.pnlPoints) ? (t.pnlPoints as number) : NaN;
    totals.createEl("td", {
      cls: "r",
      text: Number.isFinite(totalPts) ? `${totalPts >= 0 ? "+" : ""}${totalPts.toFixed(2)}` : "—",
    });
    const totalPnlCell = totals.createEl("td", { cls: "r tj-tbl-pnl" });
    totalPnlCell.addClass(toneClass(t.pnl));
    totalPnlCell.setText(t.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney2(t.pnl));
    totals.createEl("td", { cls: "r", text: `$${fees.toFixed(2)}` });
    totals.createEl("td", { cls: "tj-td-execs-tag" });

    const note = box.createDiv({ cls: "tj-td-execs-note" });
    if (set.isMulti) {
      note.setText(set.exits.length > 1
        ? "Each exit kept its own price and P&L. The row in the ledger shows their weighted average, so the two always agree."
        : "A position taken in pieces reads as one trade in the ledger; the fills are the pieces it was made of.");
    } else {
      note.setText("Single fill from entry to exit. Add fills to your trade note for a detailed breakdown.");
    }
    if (set.openQty > 0) attachTip(note, { title: `${set.openQty} contracts still open`, sub: "The open part counts nowhere until it is closed." });
  }

  // ---- Debounced review save ----
  /**
   * Coalesce rapid review edits (typing in notes, clicking through stars, adding
   * tags) into one write per field. The trade object is updated immediately so
   * the UI never waits on disk; the note catches up a moment later.
   */
  private debounceReview(key: string, run: () => Promise<void>, ms = 600): void {
    const prev = this._saveTimers[key];
    if (prev) window.clearTimeout(prev.timer);
    const timer = window.setTimeout(() => {
      delete this._saveTimers[key];
      void run();
    }, ms);
    this._saveTimers[key] = { timer, run };
  }

  /** Write every pending review edit now (leaving the trade, closing the view). */
  flushReviewSaves(): void {
    for (const key of Object.keys(this._saveTimers)) {
      const pending = this._saveTimers[key];
      window.clearTimeout(pending.timer);
      delete this._saveTimers[key];
      void pending.run();
    }
  }

  /**
   * Re-paint only the review state — the header dots, the status badge and the
   * optional-step summary. Called after an edit so the header never lags the
   * card, without rebuilding the whole page.
   */
  private refreshReviewHeader(): void {
    const t = this.trade;
    if (!t) return;
    const status = reviewStatus(t);
    const root = this.contentEl;

    const required = status.checks.filter((c) => c.required);
    root.querySelectorAll<HTMLElement>(".tj-td-review-dot").forEach((dot, i) => {
      if (required[i]) dot.toggleClass("done", required[i].done);
    });

    const badge = root.querySelector<HTMLElement>(".tj-td-hero-badge.is-status");
    if (badge) {
      badge.toggleClass("is-reviewed", status.complete);
      badge.toggleClass("is-needs-review", !status.complete);
      badge.setText(status.complete ? "Reviewed" : "Needs Review");
    }

    const summary = root.querySelector<HTMLElement>(".tj-td-hero-summary");
    if (summary) {
      summary.setText(status.optionalSummary);
      summary.toggleClass("is-hidden", !status.optionalSummary);
    }
  }

  // ---- Save ----
  async saveField(key: "setup" | "review" | "mistake" | "thesis" | "notes" | "rating" | "reviewed" | "orderType" | "direction", value: string): Promise<void> {
    try {
      if (this.trade?.id) await updateTradeFields(this.app, (this.app.vault.getAbstractFileByPath(this.trade.id) as TFile), { [key]: value });
    } catch (err) {
      console.error("[tradebook] failed to save trade field:", err);
      new Notice("Could not save — check the file still exists.");
    }
  }

  /**
   * Write the whole screenshot list as a native YAML block list and keep the
   * legacy `screenshot` scalar pointing at the first one. This is the only path
   * that touches `screenshots` — the old JSON-string route destroyed the block.
   */
  async saveScreenshotsNow(): Promise<void> {
    const t = this.trade;
    if (!t?.id) return;
    const file = this.app.vault.getAbstractFileByPath(t.id) as TFile;
    if (!(file instanceof TFile)) return;
    const shots = t.screenshots ?? [];
    t.screenshot = shots[0]?.file ?? "";
    try {
      await updateTradeScreenshots(this.app, file, shots);
    } catch (err) {
      console.error("[tradebook] failed to save screenshots:", err);
      new Notice("Could not save screenshots — check the file still exists.");
    }
  }

  /** Save a dropped/pasted/selected image to the vault and link it to the trade. */
  async handleScreenshotFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      new Notice("That's not an image — drop a screenshot (PNG/JPG/WebP).");
      return;
    }
    const t = this.trade;
    if (!t?.id) return;
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const dir = this.plugin.getAttachmentsFolder(t.date);
    await this.plugin.ensureVaultFolder(dir);
    // The name is the trade's own file name, never typed by hand.
    const tradeBase = (t.id.split("/").pop() || "").replace(/\.md$/i, "");
    const safeName = tradeBase.replace(/[\\/:*?"<>|]+/g, "-").trim() || "trade";
    // First print has no number, the rest count up: "… print.png", "… print 2.png".
    let counter = 1;
    let finalPath = normalizePath(`${dir}/${safeName} print.${ext}`);
    while (this.plugin.app.vault.getAbstractFileByPath(finalPath)) {
      counter++;
      finalPath = normalizePath(`${dir}/${safeName} print ${counter}.${ext}`);
    }
    const buffer = await file.arrayBuffer();
    await this.plugin.app.vault.createBinary(finalPath, buffer);
    const linkName = finalPath.split("/").pop() as string;

    // Add to screenshots array — migrate legacy field first
    if (!t.screenshots || t.screenshots.length === 0) {
      t.screenshots = [];
      const legacy = (t.screenshot || "").trim();
      if (legacy && legacy.toLowerCase() !== "added") {
        for (const p of legacy.split(/[,;\n]+/)) {
          const trimmed = p.trim();
          if (trimmed) t.screenshots.push({ file: trimmed });
        }
      }
    }
    t.screenshots.push({ file: linkName });
    this._activePrint = t.screenshots.length - 1;

    await this.saveScreenshotsNow();
    new Notice(`Screenshot saved: ${linkName}`);
    this.render();
  }

  /** Remove a screenshot by index from the screenshots array. */
  async removeScreenshot(index: number): Promise<void> {
    const t = this.trade;
    if (!t?.id) return;
    const shots = t.screenshots ?? [];
    if (index < 0 || index >= shots.length) return;
    shots.splice(index, 1);
    t.screenshots = shots;
    if (this._activePrint >= shots.length) this._activePrint = Math.max(0, shots.length - 1);

    await this.saveScreenshotsNow();
    new Notice("Screenshot removed.");
    this.render();
  }

  /** Save multiple fields at once to the trade note. */
  async saveFields(fields: Record<string, string>): Promise<void> {
    try {
      if (this.trade?.id) {
        await updateTradeFields(this.app, (this.app.vault.getAbstractFileByPath(this.trade.id) as TFile), fields);
      }
    } catch (err) {
      console.error("[tradebook] failed to save trade fields:", err);
      new Notice("Could not save — check the file still exists.");
    }
  }

  /** Persist an optional-step acknowledgement as a bare YAML boolean. */
  async saveAck(key: "mistakesAcknowledged" | "psychologyAcknowledged", value: boolean): Promise<void> {
    const yamlKey = key === "mistakesAcknowledged" ? "mistakes_acknowledged" : "psychology_acknowledged";
    try {
      if (this.trade?.id) {
        await updateTradeFields(this.app, this.app.vault.getAbstractFileByPath(this.trade.id) as TFile, { [yamlKey]: value });
      }
    } catch (err) {
      console.error("[tradebook] failed to save acknowledgement:", err);
      new Notice("Could not save — check the file still exists.");
    }
  }

  async openNote(): Promise<void> {
    const t = this.trade;
    if (!t?.id) return;
    const file = this.app.vault.getAbstractFileByPath(t.id);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private annotator: PrintAnnotator | null = null;

  annotate(file: TFile): void {
    if (!this.annotator) this.annotator = new PrintAnnotator(this.plugin);
    this.annotator.open(file, (annotatedName) => this.pointPrintAt(file, annotatedName));
  }

  /**
   * Retarget the print entry at the composite the annotator just wrote, then
   * rewrite the note (screenshots block + legacy `screenshot`) so the Trade
   * Detail shows the annotated image from now on.
   */
  private async pointPrintAt(original: TFile, annotatedName: string): Promise<void> {
    const t = this.trade;
    const shots = t?.screenshots ?? [];
    const idx = shots.findIndex((s) => s.file === original.name || this.resolveImageFile(s.file)?.path === original.path);
    if (idx < 0) {
      this.render();
      return;
    }
    shots[idx] = { ...shots[idx], file: annotatedName };
    t!.screenshots = shots;
    await this.saveScreenshotsNow();
    this.render();
  }

  resolveImageFile(link: string): TFile | null {
    const raw = (link || "").trim();
    if (!raw) return null;
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const candidates = [
      raw,
      target,
      ...this.plugin.attachmentCandidates(target, this.trade?.date),
    ];
    for (const c of candidates) {
      try { const f = this.app.vault.getAbstractFileByPath(c); if (f instanceof TFile) return f; } catch { /* */ }
    }
    try { const f = this.app.metadataCache.getFirstLinkpathDest(target, this.trade?.id || ""); if (f instanceof TFile) return f; } catch { /* */ }
    return null;
  }

  resolveImage(link: string): string | null {
    const raw = (link || "").trim();
    if (!raw) return null;
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const candidates = [
      raw,
      target,
      ...this.plugin.attachmentCandidates(target, this.trade?.date),
    ];
    for (const c of candidates) {
      try {
        const file = this.app.vault.getAbstractFileByPath(c);
        if (file instanceof TFile && file.extension && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(file.extension.toLowerCase()))
          return this.app.vault.getResourcePath(file);
      } catch { /* */ }
    }
    try {
      const f = this.app.vault.getAbstractFileByPath(target);
      if (f instanceof TFile && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes((f.extension || "").toLowerCase()))
        return this.app.vault.getResourcePath(f);
    } catch { /* */ }
    return null;
  }

  // ---- Export Trade Card as PNG ----
  showExportPanel(): void {
    const t = this.trade;
    if (!t) return;

    // Options state
    const opts = { screenshot: true, stats: true, rating: true, notes: false, psychology: false, hidePnl: false };

    // Overlay
    const overlay = document.body.createDiv({ cls: "tj-overlay" });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    const panel = overlay.createDiv({ cls: "tj-export-panel" });
    panel.addEventListener("click", (e) => e.stopPropagation());

    // Title
    panel.createEl("div", { cls: "tj-export-title", text: "Export Trade Card" });

    // Side-by-side body: left = options, right = preview
    const body = panel.createDiv({ cls: "tj-export-body" });
    const leftCol = body.createDiv({ cls: "tj-export-left" });
    const rightCol = body.createDiv({ cls: "tj-export-right" });

    // ── Left: Toggle-all + sections ──
    const toggleAll = leftCol.createDiv({ cls: "tj-export-toggle-all" });
    toggleAll.createEl("span", { text: "Include in card", cls: "tj-export-toggle-label" });
    const toggleAllBtn = toggleAll.createEl("button", { cls: "tj-export-toggle-btn", text: "Select all" });

    // Option definitions
    type OptKey = keyof typeof opts;
    const sections: Array<{ title: string; items: Array<{ key: OptKey; label: string; desc: string }> }> = [
      { title: "Visual", items: [{ key: "screenshot", label: "Screenshot", desc: "Trade chart / print" }] },
      {
        title: "Data",
        items: [
          { key: "stats", label: "Stats", desc: "Points, R-Multiple, Hold Time, Fees, details" },
          { key: "rating", label: "Rating", desc: "Execution rating stars" },
          { key: "psychology", label: "Psychology & Mistakes", desc: "Tag chips from your review" },
        ],
      },
      {
        title: "Review Notes",
        items: [
          { key: "notes", label: "Notes", desc: "What you wrote on the trade" },
        ],
      },
      {
        title: "Privacy",
        items: [
          { key: "hidePnl", label: "Hide P&L", desc: "Remove P&L and Risk from card" },
        ],
      },
    ];

    const optionEls: HTMLElement[] = [];

    const refreshToggleAll = () => {
      const allOn = Object.values(opts).every((v) => v);
      toggleAllBtn.textContent = allOn ? "Deselect all" : "Select all";
    };

    // Redraw preview on every toggle
    let previewDebounce: ReturnType<typeof setTimeout> | null = null;
    const schedulePreview = () => {
      if (previewDebounce) clearTimeout(previewDebounce);
      previewDebounce = setTimeout(() => void drawPreview(), 150);
    };

    for (const sec of sections) {
      const secEl = leftCol.createDiv({ cls: "tj-export-section" });
      secEl.createEl("div", { cls: "tj-export-section-title", text: sec.title });
      for (const item of sec.items) {
        const row = secEl.createDiv({ cls: "tj-export-option" + (opts[item.key] ? " on" : "") });
        optionEls.push(row);
        const cb = row.createDiv({ cls: "tj-export-checkbox" });
        setIcon(cb, "check");
        const txt = row.createDiv({ cls: "tj-export-option-text" });
        txt.createEl("div", { cls: "tj-export-option-label", text: item.label });
        txt.createEl("div", { cls: "tj-export-option-desc", text: item.desc });
        row.addEventListener("click", () => {
          opts[item.key] = !opts[item.key];
          row.classList.toggle("on", opts[item.key]);
          refreshToggleAll();
          schedulePreview();
        });
      }
    }

    toggleAllBtn.addEventListener("click", () => {
      const allOn = Object.values(opts).every((v) => v);
      const newState = !allOn;
      (Object.keys(opts) as OptKey[]).forEach((k) => { opts[k] = newState; });
      optionEls.forEach((el) => el.classList.toggle("on", newState));
      refreshToggleAll();
      schedulePreview();
    });

    // Export buttons (left column, bottom)
    const btnRow = leftCol.createDiv({ cls: "tj-export-btn-row" });

    const makeBtn = (icon: string, label: string, cls: string): HTMLElement => {
      const btn = btnRow.createEl("button", { cls });
      setIcon(btn, icon);
      btn.createEl("span", { text: label });
      return btn;
    };

    const doExport = async (fmt: "png" | "jpg" | "clip") => {
      const canvas = await this.buildExportCanvas(opts);
      if (!canvas) { new Notice("Export failed"); return; }
      const t = this.trade!;
      if (fmt === "clip") {
        try {
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
          if (!blob) { new Notice("Export failed"); return; }
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          new Notice("Copied to clipboard!");
        } catch { new Notice("Clipboard not available — try download"); }
      } else {
        const mime = fmt === "jpg" ? "image/jpeg" : "image/png";
        const ext = fmt === "jpg" ? "jpg" : "png";
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, 0.92));
        if (!blob) { new Notice("Export failed"); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.download = `${(t.symbol || "unknown").toUpperCase()}-${(t.direction || "unknown").toUpperCase()}-${t.date || "unknown"}${t.setup ? "-" + t.setup.replace(/[\\/:*?"<>|]+/g, "-") : ""}.${ext}`;
        a.href = url; a.click(); URL.revokeObjectURL(url);
        new Notice(`Saved as ${ext.toUpperCase()}!`);
      }
      overlay.remove();
    };

    const pngBtn = makeBtn("image", "PNG", "tj-export-btn");
    const jpgBtn = makeBtn("image", "JPG", "tj-export-btn");
    const clipBtn = makeBtn("clipboard", "Copy", "tj-export-btn tj-export-btn--accent");
    pngBtn.addEventListener("click", () => void doExport("png"));
    jpgBtn.addEventListener("click", () => void doExport("jpg"));
    clipBtn.addEventListener("click", () => void doExport("clip"));

    leftCol.createEl("div", { cls: "tj-export-hint", text: "JPG is smaller · PNG is lossless" });

    // ── Right: Live preview ──
    const previewLabel = rightCol.createEl("div", { cls: "tj-export-preview-label" });
    previewLabel.setText("Live Preview");
    const previewWrap = rightCol.createDiv({ cls: "tj-export-preview-wrap" });
    const previewCanvas = previewWrap.createEl("canvas", { attr: { width: 1080 } }) as HTMLCanvasElement;
    previewCanvas.style.width = "100%";
    previewCanvas.style.height = "auto";
    previewCanvas.style.borderRadius = "6px";

    const drawPreview = async () => {
      const canvas = await this.buildExportCanvas(opts);
      if (!canvas) return;
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      const pctx = previewCanvas.getContext("2d");
      if (pctx) pctx.drawImage(canvas, 0, 0);
    };
    schedulePreview();
  }

  private async buildExportCanvas(opts: { screenshot: boolean; stats: boolean; rating: boolean; notes: boolean; psychology: boolean; hidePnl: boolean }): Promise<HTMLCanvasElement | null> {
    const t = this.trade;
    if (!t) return null;

    const zone = this.plugin.settings.timeZone;
    const W = 1080, PAD = 48;
    const lineH = 20;

    // Collect screenshot URLs
    const prints: string[] = [];
    if (t.screenshots && t.screenshots.length > 0) {
      for (const s of t.screenshots) {
        const url = this.resolveImage(s.file);
        if (url) prints.push(url);
      }
    } else if (t.screenshot && t.screenshot.trim() && t.screenshot.trim().toLowerCase() !== "added") {
      const url = this.resolveImage(t.screenshot);
      if (url) prints.push(url);
    }

    // Pre-load images
    const loadImg = (url: string): Promise<HTMLImageElement | null> =>
      new Promise((res) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = url;
      });

    const images = await Promise.all(prints.map(loadImg));
    const validImages = images.filter((x): x is HTMLImageElement => !!x);

    // Collect notes for text wrapping (need a temp canvas context for measureText)
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d")!;
    const maxTextW = W - PAD * 2;

    const wrapText = (ctx2: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let cur = "";
      for (const word of words) {
        const test = cur ? cur + " " + word : word;
        if (ctx2.measureText(test).width > maxW && cur) {
          lines.push(cur);
          cur = word;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    // Notes — first non-empty of the v3.3 field and its legacy predecessors.
    const notesText = [t.notes, t.review, t.thesis].map((s) => (s || "").trim()).find(Boolean) ?? "";
    const showNotes = opts.notes && !!notesText;
    const noteLines: string[] = [];
    if (showNotes) {
      tempCtx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      noteLines.push(...wrapText(tempCtx, notesText, maxTextW));
    }

    // Psychology & Mistakes chips — pre-measured so the height math matches.
    const psychTags = (t.psychology_tags ?? []).map((s) => String(s).trim()).filter(Boolean);
    let mistakeTags = (t.mistake_tags ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!mistakeTags.length) {
      // Legacy fallback: the old free-text mistake becomes a single chip.
      const legacyMistake = (t.mistake || "").trim();
      if (legacyMistake) mistakeTags = [legacyMistake];
    }
    const showPsych = opts.psychology && (psychTags.length > 0 || mistakeTags.length > 0);
    type Chip = { text: string; w: number };
    const chipRowsOf = (tags: string[]): Chip[][] => {
      tempCtx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const rows: Chip[][] = [];
      let row: Chip[] = [];
      let rowW = 0;
      for (const tag of tags) {
        const w = tempCtx.measureText(tag).width + 20; // 10px padding per side
        const gap = row.length ? 4 : 0;
        if (row.length && rowW + gap + w > maxTextW) {
          rows.push(row);
          row = [];
          rowW = 0;
        }
        row.push({ text: tag, w });
        rowW += (row.length > 1 ? 4 : 0) + w;
      }
      if (row.length) rows.push(row);
      return rows;
    };
    const psychChipRows = showPsych ? chipRowsOf(psychTags) : [];
    const mistakeChipRows = showPsych ? chipRowsOf(mistakeTags) : [];

    // Pre-measure screenshot heights
    const imgMaxW = W - PAD * 2;
    const imgMaxH = 400;
    const imgScales: Array<{ img: HTMLImageElement; w: number; h: number }> = [];
    for (const img of validImages) {
      const scale = Math.min(imgMaxW / img.width, imgMaxH / img.height);
      imgScales.push({ img, w: img.width * scale, h: img.height * scale });
    }

    // ── Compute height ──
    let totalH = PAD;
    totalH += 100; // header (title + badges row, meta line)
    totalH += 32;  // separator (hero ↔ next section)
    if (opts.screenshot) {
      if (imgScales.length > 0) {
        for (const is2 of imgScales) totalH += is2.h + 16;
      } else {
        totalH += 232; // placeholder
      }
      totalH += 32; // separator (screenshot ↔ next section)
    }
    if (opts.stats) {
      totalH += 92;  // statline
      totalH += 32;  // hairline (stats ↔ fields)
      totalH += 74;  // fields row
      totalH += 32;  // separator (fields ↔ next section)
    }
    if (opts.rating) {
      totalH += 54;
    }
    if (showPsych) {
      if (opts.rating) totalH += 32; // separator (rating ↔ psych)
      if (psychChipRows.length) totalH += 18 + 6 + psychChipRows.length * 22 + (psychChipRows.length - 1) * 6 + 16;
      if (mistakeChipRows.length) totalH += 18 + 6 + mistakeChipRows.length * 22 + (mistakeChipRows.length - 1) * 6 + 16;
    }
    if (showNotes) {
      if (showPsych || opts.rating) totalH += 32; // separator before notes
      totalH += 24 + noteLines.length * lineH + 16;
    }
    totalH += PAD; // bottom padding

    // ── Create canvas ──
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = totalH;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, W, totalH);

    // Dot pattern
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    for (let dx = 0; dx < W; dx += 20) {
      for (let dy = 0; dy < totalH; dy += 20) {
        ctx.beginPath();
        ctx.arc(dx, dy, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    let y = PAD;

    // ── Header (always) — v3.3 hero: "MES · Long" + badges, date/time below ──
    const dirLabel = t.direction === "long" ? "Long" : t.direction === "short" ? "Short" : "—";
    const titleText = `${t.symbol || "—"} · ${dirLabel}`;
    ctx.textBaseline = "top";
    ctx.letterSpacing = "-0.01em";
    ctx.font = "bold 42px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "#f0f1f2";
    ctx.fillText(titleText, PAD, y);
    const titleW = ctx.measureText(titleText).width;
    ctx.letterSpacing = "0em";

    ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const badgeH = 38;
    const badgeX = PAD + titleW + 16;

    // 1. Direction badge — LONG green / SHORT red, 12% tint.
    const isLong = t.direction === "long";
    const badgeText = isLong ? "LONG" : "SHORT";
    const badgeBg = isLong ? "rgba(52,209,122,0.12)" : "rgba(255,93,72,0.12)";
    const badgeFg = isLong ? "#34d17a" : "#ff5d48";
    const badgeW = ctx.measureText(badgeText).width + 28;
    ctx.fillStyle = badgeBg;
    this.roundRect(ctx, badgeX, y + 6, badgeW, badgeH, 19);
    ctx.fill();
    ctx.fillStyle = badgeFg;
    ctx.fillText(badgeText, badgeX + 14, y + 13);

    // 2. Strategy badge — neutral pill (hairline + 4% white), if set.
    if (t.setup) {
      const stratW = ctx.measureText(t.setup).width + 28;
      const sx = badgeX + badgeW + 10;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      this.roundRect(ctx, sx, y + 6, stratW, badgeH, 19);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      this.roundRect(ctx, sx, y + 6, stratW, badgeH, 19);
      ctx.stroke();
      ctx.fillStyle = "#8a9099"; // --tj-fg-3
      ctx.fillText(t.setup, sx + 14, y + 13);
    }

    // 3. Review status — right-aligned on the title row, same pill as LONG.
    const complete = reviewStatus(t).complete;
    const statusText = complete ? "REVIEWED" : "NEEDS REVIEW";
    const statusFg = complete ? "#34d17a" : "#d9a441"; // green / --tj-tone-mid
    const statusBg = complete ? "rgba(52,209,122,0.12)" : "rgba(217,164,65,0.12)";
    const statusW = ctx.measureText(statusText).width + 28;
    ctx.fillStyle = statusBg;
    this.roundRect(ctx, W - PAD - statusW, y + 6, statusW, badgeH, 19);
    ctx.fill();
    ctx.fillStyle = statusFg;
    ctx.fillText(statusText, W - PAD - statusW + 14, y + 13);

    y += 60;

    // Second line — date (settings.dateFormat) and entry time only.
    const dateStr = formatDate(t.date, this.plugin.settings.dateFormat);
    const whenText = t.entryTime ? `${dateStr}, ${t.entryTime}` : dateStr;
    ctx.fillStyle = "#8a9099"; // --tj-fg-3
    ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(whenText, PAD, y);
    y += 40;

    // Separator (hero ↔ next section)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    y += 32;

    // ── Screenshots (conditional) ──
    if (opts.screenshot) {
      if (imgScales.length > 0) {
        for (const { img, w, h } of imgScales) {
          const imgX = PAD + (imgMaxW - w) / 2;
          ctx.fillStyle = "#111111";
          this.roundRect(ctx, imgX - 4, y - 4, w + 8, h + 8, 8);
          ctx.fill();
          ctx.drawImage(img, imgX, y, w, h);
          y += h + 16;
        }
      } else {
        ctx.fillStyle = "#111111";
        this.roundRect(ctx, PAD, y, imgMaxW, 200, 8);
        ctx.fill();
        ctx.fillStyle = "#333";
        ctx.font = "28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No screenshot", W / 2, y + 90);
        ctx.textAlign = "left";
        y += 232;
      }

      // Separator
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      y += 32;
    }

    // ── Stats (conditional) — v3.3 statline: columns on hairlines, no boxes ──
    if (opts.stats) {
      const pnl = typeof t.pnl === "number" && Number.isFinite(t.pnl) ? t.pnl : 0;
      const pts = typeof t.pnlPoints === "number" && Number.isFinite(t.pnlPoints) ? t.pnlPoints : 0;
      const rm = tradeR(t) ?? 0;

      const kpis = [
        ...(!opts.hidePnl ? [{ label: "P&L", value: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`, color: pnl >= 0 ? "#34d17a" : "#ff5d48" }] : []),
        { label: "Points", value: pts.toFixed(2), color: "#dcddde" },
        { label: "R-Multiple", value: `${rm.toFixed(2)}R`, color: "#dcddde" },
        { label: "Hold Time", value: holdFmt(t.entryTime, t.exitTime), color: "#dcddde" },
      ];
      const kpiCount = kpis.length;
      const kpiW = (W - PAD * 2) / kpiCount;
      kpis.forEach((kpi, i) => {
        const kx = PAD + i * kpiW;
        if (i > 0) {
          ctx.strokeStyle = "rgba(255,255,255,0.08)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(kx, y);
          ctx.lineTo(kx, y + 76);
          ctx.stroke();
        }
        const tx = kx + (i > 0 ? 16 : 0);
        ctx.fillStyle = "#8a9099"; // --tj-fg-3
        ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(kpi.label.toUpperCase(), tx, y + 4);
        ctx.fillStyle = kpi.color;
        ctx.font = "bold 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(kpi.value, tx, y + 24);
      });
      y += 92;

      // Hairline between the statline and the fields row.
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      y += 32;

      // Fields row — Stop / Risk, Target, Contracts, Session (4 per row).
      const stopPrice = t.stopLoss;
      const entryPrice = t.entryPrice;
      let stopRiskValue = "— / —";
      if (stopPrice && entryPrice) {
        const riskDollars = Math.abs(entryPrice - stopPrice) * (futuresSpec(t.symbol)?.pointValue ?? 1) * (t.quantity || 1);
        // Hide P&L still hides the risk figure; the stop itself stays.
        stopRiskValue = opts.hidePnl
          ? `${fmtPrice(stopPrice)} / —`
          : `${fmtPrice(stopPrice)} / $${riskDollars.toFixed(0)}`;
      }
      const sessValue = sessionLabel(t, zone);
      const details = [
        { label: "Stop / Risk", value: stopRiskValue },
        { label: "Target", value: t.target ? fmtPrice(t.target) : "—" },
        { label: "Contracts", value: String(t.quantity) },
        { label: "Session", value: !sessValue || sessValue === SESSION_UNKNOWN ? "—" : sessValue },
      ];
      details.forEach((d, i) => {
        const dx = PAD + i * ((W - PAD * 2) / details.length);
        ctx.fillStyle = "#8a9099";
        ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(d.label, dx, y);
        ctx.fillStyle = "#dcddde";
        ctx.font = "bold 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(d.value, dx, y + 26);
      });
      y += 74;

      // Separator
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      y += 32;
    }

    // ── Rating (conditional) — loose stars, no boxes ──
    if (opts.rating) {
      const rating = t.rating ?? 0;
      ctx.fillStyle = "#8a9099"; // --tj-fg-3
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("Execution Rating".toUpperCase(), PAD, y);
      y += 24;
      // 20px stars (outer diameter), 8px gap.
      const starR = 10;
      const starStep = starR * 2 + 8;
      for (let i = 0; i < 5; i++) {
        const cx = PAD + starR + i * starStep;
        const cy = y + starR;
        ctx.beginPath();
        for (let p = 0; p < 5; p++) {
          const angle = (p * 4 * Math.PI) / 5 - Math.PI / 2;
          const px = cx + starR * Math.cos(angle);
          const py = cy + starR * Math.sin(angle);
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = i < rating ? "#f5b301" : "rgba(255,255,255,0.15)";
        ctx.fill();
      }
      y += starR * 2 + 10;
    }

    // ── Psychology & Mistakes (optional) — below rating, above notes ──
    if (showPsych) {
      if (opts.rating) {
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
        y += 32;
      }
      const accent = getComputedStyle(document.body).getPropertyValue("--interactive-accent").trim() || "#7f6df2";
      const drawChipSection = (label: string, rows: Chip[][], textColor: string) => {
        if (!rows.length) return;
        ctx.fillStyle = "#8a9099"; // --tj-fg-3
        ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(label.toUpperCase(), PAD, y);
        y += 18 + 6;
        ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        let rowY = y;
        for (const row of rows) {
          let cx = PAD;
          for (const chip of row) {
            ctx.strokeStyle = "rgba(255,255,255,0.14)";
            ctx.lineWidth = 1;
            this.roundRect(ctx, cx, rowY, chip.w, 22, 11);
            ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.fillText(chip.text, cx + 10, rowY + 5);
            cx += chip.w + 4;
          }
          rowY += 22 + 6;
        }
        y = rowY - 6 + 16;
      };
      drawChipSection("Psychology", psychChipRows, accent);
      drawChipSection("Mistakes", mistakeChipRows, "#ff5d48"); // --color-red-bright
    }

    // ── Notes (conditional) ──
    if (showNotes) {
      if (showPsych || opts.rating) {
        // Separator before notes (stats/screenshot already end on one)
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
        y += 32;
      }
      ctx.fillStyle = "#8a9099"; // --tj-fg-3
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("Notes".toUpperCase(), PAD, y);
      y += 24;
      ctx.fillStyle = "#dcddde"; // --tj-fg-1
      ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      for (const line of noteLines) {
        ctx.fillText(line, PAD, y);
        y += lineH;
      }
      y += 16;
    }

    return canvas;
  }

  // Canvas helpers
  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  async openScreenshot(link: string): Promise<void> {
    const raw = (link || "").trim();
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const file = this.app.vault.getAbstractFileByPath(target) || this.app.vault.getAbstractFileByPath("Tradebook/" + target);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("Attachment not found: " + target);
    }
  }

  /**
   * Enlarge — show a print over the whole window without leaving the review.
   * A click anywhere or Escape closes it; the previous lightbox is torn down
   * first so a second Enlarge never stacks overlays.
   */
  private openPrintLarge(file: TFile): void {
    const src = this.resolveImage(file.path);
    if (!src) {
      new Notice("Could not open the print.");
      return;
    }
    this._lightboxCleanup?.();
    const doc = this.contentEl.ownerDocument ?? document;
    const overlay = doc.body.createDiv({ cls: "tj-td-lightbox" });
    overlay.setAttr("role", "dialog");
    overlay.setAttr("aria-modal", "true");
    overlay.createEl("img", { cls: "tj-td-lightbox-img", attr: { src, alt: file.basename } });
    const close = () => {
      doc.removeEventListener("keydown", onKey, true);
      overlay.remove();
      this._lightboxCleanup = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    overlay.addEventListener("click", close);
    doc.addEventListener("keydown", onKey, true);
    this._lightboxCleanup = close;
  }
}
