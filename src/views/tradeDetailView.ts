import { ItemView, Notice, TFile, normalizePath, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { renderAppShell } from "../ui";
import { fmtMoney, fmtMoney2, fmtMoneyAbs, fmtPrice, zoneShortLabel } from "../tz";
import { legBaseKey } from "../lib/copy";
import { updateTradeFields } from "../storage";
import { PrintAnnotator } from "./printAnnotator";
import { attachTip } from "../lib/tip";
import { fillLabel, fillSet, FillSet, toneClass } from "../lib/fills";
import { futuresSpec } from "../futures";
import { sessionOf, SESSION_LABELS } from "../lib/sessions";
import { holdFmt, tradeR } from "../lib/tradeTable";
import { mountDropdown, DropdownItem } from "../lib/dropdown";

export const TRADE_DETAIL_VIEW_TYPE = "tradebook-trade-detail-view";

export class TradeDetailView extends ItemView {
  plugin: TradebookPlugin;
  trade: Trade | null = null;
  allTrades: Trade[] = [];
  index = -1;
  /** Setup names available in the picker — registry + names used by notes. */
  setupOptions: string[] = [];

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
    return { tradeId: this.trade?.id ?? null };
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    const id = state.tradeId as string | null;
    if (!id) return;
    const trades = await this.plugin.loadTrades();
    this.allTrades = trades;
    const found = trades.find((t) => t.id === id);
    if (found) await this.setTrade(found);
  }

  async setTrade(trade: Trade): Promise<void> {
    this.trade = trade;
    if (this.allTrades.length === 0) this.allTrades = await this.plugin.loadTrades();
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
      let savedId: string | undefined;
      try { savedId = (this.leaf as any).getViewState?.()?.state?.tradeId; } catch { /* */ }
      const trades = await this.plugin.loadTrades();
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
    window.removeEventListener("keydown", this.keydownHandler);
    // Clean up paste listeners from dropzone
    this.contentEl.querySelectorAll<HTMLElement>(".tj-td-dropzone").forEach((el) => {
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
    const origin = this.plugin.tradeDetailOrigin ?? { type: "tradelog" as const };
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
      tlBtn.addEventListener("click", () => void this.plugin.openTradeLog());
    }

    const prevBtn = navBtns.createEl("button", { cls: "tj-seg-btn", attr: { "aria-label": "Previous trade" } });
    setIcon(prevBtn, "chevron-left");
    prevBtn.disabled = this.index <= 0;
    prevBtn.addEventListener("click", () => void this.prev());

    navBtns.createEl("span", { cls: "tj-td-counter", text: `${this.index + 1} / ${this.allTrades.length}` });

    const nextBtn = navBtns.createEl("button", { cls: "tj-seg-btn", attr: { "aria-label": "Next trade" } });
    setIcon(nextBtn, "chevron-right");
    nextBtn.disabled = this.index < 0 || this.index >= this.allTrades.length - 1;
    nextBtn.addEventListener("click", () => void this.next());

    // ---- Review dots (4 stages — automatic indicators) ----
    const hasPrint = !!(t.screenshot && t.screenshot.trim()) || (t.screenshots?.length ?? 0) > 0;
    const hasSetup = !!(t.setup && t.setup.trim());
    const hasReview = !!(t.notes && t.notes.trim()) || !!(t.review && t.review.trim());
    const hasRating = (t.rating ?? 0) > 0;
    const reviewDots = head.createDiv({ cls: "tj-td-review-dots" });
    const dotDefs: Array<{ label: string; done: boolean }> = [
      { label: "Screenshot", done: hasPrint },
      { label: "Strategy", done: hasSetup },
      { label: "Review", done: hasReview },
      { label: "Rating", done: hasRating },
    ];
    for (const d of dotDefs) {
      const dot = reviewDots.createEl("span", {
        cls: "tj-td-review-dot" + (d.done ? " done" : ""),
        attr: { "aria-label": d.label },
      });
      attachTip(dot, { title: d.label, sub: d.done ? "Complete" : "Missing" });
    }

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
      const fresh = await this.plugin.loadTrades();
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
        await this.plugin.openTradeLog();
      }
    });

    // ---- Body ----
    const body = main.createDiv({ cls: "tj-td-body" });

    // Two-column layout
    const cols = body.createDiv({ cls: "tj-td-cols" });

    // ================================================================
    // LEFT COLUMN — Flip Card (front: all trade info, back: review)
    // ================================================================
    const leftCol = cols.createDiv({ cls: "tj-td-left" });

    // ---- Single card (no flip — all info visible) ----
    const flipCard = leftCol.createDiv({ cls: "tj-td-flip-card" });
    const front = flipCard.createDiv({ cls: "tj-td-flip-face tj-td-ffront" });

    // --- Click-to-edit helpers ---
    const spec = futuresSpec(t.symbol);
    const pointValue = spec.pointValue;

    /** Make a value span clickable → transforms into an input on click. */
    const editableRow = (
      host: HTMLElement,
      label: string,
      currentValue: string,
      onSave: (newVal: string) => Promise<void>,
      opts?: { numeric?: boolean; suffix?: string; min?: string; max?: string; step?: string }
    ) => {
      const r = host.createDiv({ cls: "tj-td-flip-row" });
      r.createEl("span", { cls: "tj-td-flip-key", text: label });
      const valSpan = r.createEl("span", { cls: "tj-td-flip-val", text: currentValue });
      valSpan.style.cursor = "pointer";
      attachTip(valSpan, { title: "Click to edit", sub: `Change ${label.toLowerCase()}` });
      valSpan.addEventListener("click", () => {
        // Replace span with input
        const input = document.createElement("input");
        input.type = opts?.numeric ? "number" : "text";
        input.className = "tj-td-flip-input";
        input.value = currentValue.replace(/[^0-9.\-]/g, "");
        if (opts?.min) input.min = opts.min;
        if (opts?.max) input.max = opts.max;
        if (opts?.step) input.step = opts.step;
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
    const row = (label: string, value: string, tone = "") => {
      const r = front.createDiv({ cls: "tj-td-flip-row" });
      r.createEl("span", { cls: "tj-td-flip-key", text: label });
      r.createEl("span", { cls: "tj-td-flip-val" + (tone ? " " + tone : ""), text: value });
    };

    // ---- Net P&L (hero, not editable — computed) ----
    const pnlTone = t.pnl >= 0 ? "pos" : "neg";
    const pnlRow = front.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-hero" });
    pnlRow.createEl("span", { cls: "tj-td-flip-key", text: "Net P&L" });
    pnlRow.createEl("span", { cls: "tj-td-flip-val " + pnlTone, text: fmtMoney2(t.pnl) });

    // ---- Points (computed, not editable) ----
    const pts = t.pnlPoints;
    const ptsStr = typeof pts === "number" && Number.isFinite(pts)
      ? `${pts >= 0 ? "+" : ""}${pts.toFixed(2)} pts`
      : "—";
    row("Points", ptsStr, (pts ?? 0) >= 0 ? "pos" : "neg");

    // ---- R-Multiple (computed, not editable) ----
    const rMultiple = tradeR(t);
    row("R-Multiple", rMultiple !== null ? `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R` : "—",
      rMultiple !== null ? (rMultiple >= 0 ? "pos" : "neg") : "");

    // ---- Hold Time (computed from entry/exit times) ----
    row("Hold Time", holdFmt(t.entryTime, t.exitTime));

    // ---- Entry Time (editable HH:MM:SS) ----
    const entryTimeRow = front.createDiv({ cls: "tj-td-flip-row" });
    entryTimeRow.createEl("span", { cls: "tj-td-flip-key", text: "Entry Time" });
    const entryTimeVal = entryTimeRow.createEl("span", { cls: "tj-td-flip-val", text: t.entryTime || "—" });
    entryTimeVal.style.cursor = "pointer";
    attachTip(entryTimeVal, { title: "Click to edit", sub: "Change entry time (HH:MM:SS)" });
    entryTimeRow.createEl("span", {
      cls: "tj-td-tz",
      text: zoneShortLabel(t.timezone || this.plugin.settings.timeZone),
    });
    entryTimeVal.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tj-td-flip-input";
      input.value = t.entryTime || "";
      input.style.width = "100%";
      input.placeholder = "HH:MM:SS";
      entryTimeVal.replaceWith(input);
      input.focus();
      input.select();
      const save = async () => {
        const raw = input.value.trim();
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
        if (match) {
          const h = match[1].padStart(2, "0");
          const m = match[2].padStart(2, "0");
          const s = (match[3] || "00").padStart(2, "0");
          this.trade!.entryTime = `${h}:${m}:${s}`;
        } else if (raw) {
          const match2 = /^(\d{1,2}):(\d{2})$/.exec(raw);
          if (match2) {
            this.trade!.entryTime = `${match2[1].padStart(2, "0")}:${match2[2].padStart(2, "0")}:00`;
          }
        }
        await this.saveFields({ entryTime: this.trade!.entryTime });
        this.render();
      };
      input.addEventListener("blur", () => void save());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = t.entryTime || ""; input.blur(); }
      });
    });

    // ---- Exit Time (editable HH:MM:SS) ----
    const exitTimeRow = front.createDiv({ cls: "tj-td-flip-row" });
    exitTimeRow.createEl("span", { cls: "tj-td-flip-key", text: "Exit Time" });
    const exitTimeVal = exitTimeRow.createEl("span", { cls: "tj-td-flip-val", text: t.exitTime || "—" });
    exitTimeVal.style.cursor = "pointer";
    attachTip(exitTimeVal, { title: "Click to edit", sub: "Change exit time (HH:MM:SS)" });
    exitTimeRow.createEl("span", {
      cls: "tj-td-tz",
      text: zoneShortLabel(t.timezone || this.plugin.settings.timeZone),
    });
    exitTimeVal.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tj-td-flip-input";
      input.value = t.exitTime || "";
      input.style.width = "100%";
      input.placeholder = "HH:MM:SS";
      exitTimeVal.replaceWith(input);
      input.focus();
      input.select();
      const save = async () => {
        const raw = input.value.trim();
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
        if (match) {
          const h = match[1].padStart(2, "0");
          const m = match[2].padStart(2, "0");
          const s = (match[3] || "00").padStart(2, "0");
          this.trade!.exitTime = `${h}:${m}:${s}`;
        } else if (raw) {
          const match2 = /^(\d{1,2}):(\d{2})$/.exec(raw);
          if (match2) {
            this.trade!.exitTime = `${match2[1].padStart(2, "0")}:${match2[2].padStart(2, "0")}:00`;
          }
        }
        await this.saveFields({ exitTime: this.trade!.exitTime });
        this.render();
      };
      input.addEventListener("blur", () => void save());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = t.exitTime || ""; input.blur(); }
      });
    });

    // ---- Entry (editable) ----
    editableRow(front, "Entry", t.entryPrice ? fmtPrice(t.entryPrice) : "—", async (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price)) {
        this.trade!.entryPrice = price;
        await this.saveFields({ entryPrice: String(price) });
        this.render();
      }
    }, { numeric: true });

    // ---- Exit (editable) ----
    editableRow(front, "Exit", t.exitPrice ? fmtPrice(t.exitPrice) : "—", async (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price)) {
        this.trade!.exitPrice = price;
        await this.saveFields({ exitPrice: String(price) });
        this.render();
      }
    }, { numeric: true });

    // ---- Contracts (editable) ----
    const contractsVal = String(t.quantity ?? 1);
    editableRow(front, "Contracts", contractsVal, async (raw) => {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) {
        this.trade!.quantity = n;
        await this.saveFields({ quantity: String(n) });
        this.render();
      }
    }, { numeric: true, min: "1", step: "1" });

    // ---- Symbol (editable) ----
    editableRow(front, "Symbol", t.symbol || "—", async (raw) => {
      if (raw.trim()) {
        this.trade!.symbol = raw.trim().toUpperCase();
        await this.saveFields({ symbol: this.trade!.symbol });
        this.render();
      }
    });

    // ---- Direction (dropdown) ----
    const dirRow = front.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
    dirRow.createEl("span", { cls: "tj-td-flip-key", text: "Direction" });
    const dirWrap = dirRow.createDiv({ cls: "tj-td-flip-strat-wrap" });
    mountDropdown(dirWrap, [
      { id: "long", label: "Long" },
      { id: "short", label: "Short" },
    ], t.direction || "long", async (id) => {
      this.trade!.direction = id as "long" | "short";
      await this.saveField("direction" as any, id);
      this.render();
    }, { placeholder: "Direction…" });

    // ---- Stop (editable — bidirectional with Risk $) ----
    const stopVal = t.stopLoss ? fmtPrice(t.stopLoss) : "—";
    editableRow(front, "Stop", stopVal, async (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price)) {
        this.trade!.stopLoss = price;
        // Recalculate Risk $
        await this.saveFields({ stopLoss: String(price) });
        this.render();
      }
    }, { numeric: true });

    // ---- Target (editable) ----
    const targetVal = t.target ? fmtPrice(t.target) : "—";
    editableRow(front, "Target", targetVal, async (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price)) {
        this.trade!.target = price;
        await this.saveFields({ target: String(price) });
        this.render();
      }
    }, { numeric: true });

    // ---- Planned R:R (computed, not editable) ----
    if (t.stopLoss && t.target && t.entryPrice) {
      const risk = Math.abs(t.entryPrice - t.stopLoss);
      const reward = Math.abs(t.target - t.entryPrice);
      row("Planned R:R", risk > 0 ? `1:${(reward / risk).toFixed(1)}` : "—");
    } else {
      row("Planned R:R", "—");
    }

    // ---- Risk $ (editable — bidirectional with Stop) ----
    const qty = t.quantity || 1;
    const riskDollar = (t.stopLoss && t.entryPrice)
      ? Math.abs(t.entryPrice - t.stopLoss) * pointValue * qty
      : null;
    const riskVal = riskDollar !== null ? `$${riskDollar.toFixed(0)}` : "—";
    editableRow(front, "Risk $", riskVal, async (raw) => {
      const dollars = parseFloat(raw.replace(/[$,]/g, ""));
      if (Number.isFinite(dollars) && t.entryPrice) {
        // Calculate stop from risk: risk = abs(entry - stop) * pointValue * qty
        // stop = entry ± (dollars / (pointValue * qty))
        const dist = dollars / (pointValue * qty);
        const newStop = t.direction === "long"
          ? t.entryPrice - dist
          : t.entryPrice + dist;
        this.trade!.stopLoss = Math.round(newStop * 100) / 100;
        await this.saveFields({ stopLoss: String(this.trade!.stopLoss) });
        this.render();
      }
    }, { numeric: true });

    // ---- Fees (editable) ----
    const totalFees = ((t.commission || 0) + (t.fees || 0));
    const feesVal = `$${totalFees.toFixed(2)}`;
    editableRow(front, "Fees", feesVal, async (raw) => {
      const val = parseFloat(raw.replace(/[$]/g, ""));
      if (Number.isFinite(val)) {
        // Split evenly or put all in fees
        await this.saveFields({ fees: String(val), commission: "0" });
        this.render();
      }
    }, { numeric: true });

    // ---- Order Type (dropdown) ----
    const otRow = front.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
    otRow.createEl("span", { cls: "tj-td-flip-key", text: "Order Type" });
    const otWrap = otRow.createDiv({ cls: "tj-td-flip-strat-wrap" });
    mountDropdown(otWrap, [
      { id: "Limit", label: "Limit" },
      { id: "Market", label: "Market" },
      { id: "Stop", label: "Stop" },
      { id: "Stop Limit", label: "Stop Limit" },
    ], t.orderType || "", async (id) => {
      this.trade!.orderType = id || undefined;
      await this.saveField("orderType" as any, id);
      this.render();
    }, { placeholder: "—" });
    const sessKey = sessionOf(t, zone);
    const sessRow = front.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
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
        await this.saveFields({ sessionOverride: id === "__auto__" ? "" : id });
        this.render();
      },
      { placeholder: "Session…" }
    );

    // ---- Max Position (computed, not editable) ----
    const fillData = fillSet(t);
    if (fillData.isMulti && fillData.positionSize && fillData.positionSize > (t.quantity || 1)) {
      row("Max Position", `${fillData.positionSize}`);
    }

    // ---- Tags (editable) ----
    const tagsStr = t.tags && t.tags.length ? t.tags.join(", ") : "—";
    editableRow(front, "Tags", tagsStr, async (raw) => {
      const tags = raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      this.trade!.tags = tags;
      await this.saveFields({ tags: JSON.stringify(tags) });
      this.render();
    });

    // ---- Reviewed (toggle — Yes when all 4 stages complete OR manually reviewed) ----
    const allStages = hasPrint && hasSetup && hasReview && hasRating;
    const isReviewed = t.reviewed || allStages;
    const reviewedRow = front.createDiv({ cls: "tj-td-flip-row" });
    reviewedRow.createEl("span", { cls: "tj-td-flip-key", text: "Reviewed" });
    const reviewedVal = reviewedRow.createEl("span", {
      cls: "tj-td-flip-val" + (isReviewed ? " pos" : ""),
      text: isReviewed ? "Yes" : "No",
    });
    reviewedVal.style.cursor = "pointer";
    reviewedVal.addEventListener("click", async (e) => {
      e.stopPropagation();
      this.trade!.reviewed = !this.trade!.reviewed;
      await this.saveField("reviewed" as any, String(this.trade!.reviewed));
      this.render();
    });

    // ---- Strategy selector (dropdown) ----
    const stratRow = front.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
    stratRow.createEl("span", { cls: "tj-td-flip-key", text: "Strategy" });
    const stratWrap = stratRow.createDiv({ cls: "tj-td-flip-strat-wrap" });
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

    // ---- Rating row (Unicode stars) ----
    const ratingRow = front.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-rating" });
    ratingRow.createEl("span", { cls: "tj-td-flip-key", text: "Rating" });
    const starsWrap = ratingRow.createDiv({ cls: "tj-td-stars tj-td-stars-inline" });
    for (let s = 1; s <= 5; s++) {
      const star = starsWrap.createEl("button", {
        cls: "tj-td-star" + ((t.rating ?? 0) >= s ? " active" : ""),
        attr: { type: "button", "aria-label": `Rate ${s} of 5` },
      });
      star.textContent = (t.rating ?? 0) >= s ? "★" : "☆";
      attachTip(star, { title: `${s}/5`, sub: "Click the same star again to clear." });
      star.addEventListener("click", async () => {
        this.trade!.rating = (t.rating ?? 0) === s ? 0 : s;
        await this.saveField("rating" as any, String(this.trade!.rating));
        this.render();
      });
    }

    // ---- Notes textarea (replaces thesis/review/mistake) ----
    const notesGroup = front.createDiv({ cls: "tj-td-field" });
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
      const len = notesArea.value.trim().length;
      notesCharCount.textContent = len > 0 ? `${len} chars` : "Optional";
    });
    notesArea.addEventListener("change", async () => {
      const val = notesArea.value.trim();
      if (val === notesVal) return;
      this.trade!.notes = val;
      await this.saveField("notes", val);
    });

    // ================================================================
    // RIGHT COLUMN — Screenshot card (mosaic) + Executions
    // ================================================================
    const rightCol = cols.createDiv({ cls: "tj-td-right" });

    // ---- Screenshot card ----
    const shotCard = rightCol.createDiv({ cls: "tj-td-dropzone-card" });
    const dzHeader = shotCard.createDiv({ cls: "tj-td-dropzone-header" });
    dzHeader.createEl("div", { cls: "tj-td-dropzone-title", text: "Screenshots" });
    const dzActions = dzHeader.createDiv({ cls: "tj-td-dropzone-actions" });

    // Build screenshots list from new array or legacy single field
    // Migrate legacy field into screenshots array if needed
    const shot = t.screenshot && t.screenshot.trim();
    if ((!t.screenshots || t.screenshots.length === 0) && shot && shot.toLowerCase() !== "added") {
      t.screenshots = [];
      for (const p of shot.split(/[,;\n]+/)) {
        const trimmed = p.trim();
        if (trimmed) t.screenshots.push({ file: trimmed });
      }
      // Sync legacy and save migration
      t.screenshot = t.screenshots[0]?.file ?? "";
      void this.saveFields({ screenshot: t.screenshot, screenshots: JSON.stringify(t.screenshots) });
    }
    const prints: Array<{ file: string; note?: string }> = [];
    if (t.screenshots && t.screenshots.length > 0) {
      for (const s of t.screenshots) {
        if (s.file) prints.push({ file: s.file, note: s.note });
      }
    }

    // Show existing prints — mosaic layout
    if (prints.length > 0) {
      // Annotate button (for first print)
      const firstFile = this.resolveImageFile(prints[0].file);
      if (firstFile) {
        const annotateBtn = dzActions.createEl("button", {
          cls: "tj-btn tj-mini", text: "✎ Annotate", attr: { type: "button" },
        });
        annotateBtn.addEventListener("click", () => this.annotate(firstFile));
      }

      const mosaic = shotCard.createDiv({ cls: "tj-td-shot-mosaic" });
      const mainWrap = mosaic.createDiv({ cls: "tj-td-shot-mosaic-main" });
      const thumbsWrap = mosaic.createDiv({ cls: "tj-td-shot-mosaic-thumbs" });

      for (let i = 0; i < prints.length; i++) {
        const p = prints[i];
        const resolved = this.resolveImage(p.file);
        const file = this.resolveImageFile(p.file);

        // First print → main area; rest → thumbnails
        const host = i === 0 ? mainWrap : thumbsWrap;
        const shotWrap = host.createDiv({ cls: "tj-td-shot-wrap" });

        if (resolved) {
          const img = shotWrap.createEl("img", { attr: { src: resolved, alt: `screenshot ${i + 1}` } });
          img.addClass("tj-td-shot-img");
          img.addEventListener("error", () => { img.style.opacity = "0.2"; });
          if (file) {
            // Annotate overlay
            const annotateOverlay = shotWrap.createDiv({ cls: "tj-td-shot-annotate" });
            annotateOverlay.setText("✎ Annotate");
            annotateOverlay.addEventListener("click", () => this.annotate(file));
            img.addEventListener("click", () => this.annotate(file));
          }
        } else {
          shotWrap.createDiv({ cls: "tj-hint", text: `Print not found: ${p.file}` });
        }

        // Per-print note (only on main)
        if (p.note && i === 0) {
          shotWrap.createEl("div", { cls: "tj-td-shot-note", text: p.note });
        }

        // Remove button
        const removeBtn = shotWrap.createEl("button", {
          cls: "tj-td-shot-remove",
          attr: { type: "button", "aria-label": "Remove screenshot" },
        });
        setIcon(removeBtn, "x");
        removeBtn.addEventListener("click", async () => {
          if (!window.confirm(`Remove screenshot ${p.file}?`)) return;
          await this.removeScreenshot(i);
        });
      }
    }

    // Dropzone to add prints (always shown)
    const addDropzone = shotCard.createDiv({ cls: "tj-td-dropzone" + (prints.length > 0 ? " compact" : "") });
    if (prints.length === 0) {
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
    } else {
      addDropzone.createEl("span", { cls: "tj-td-dropzone-add-label", text: "+ Add screenshot" });
    }

    // Hidden file input
    const fileInput = addDropzone.createEl("input", {
      attr: { type: "file", accept: "image/png,image/jpeg,image/webp" },
    });
    fileInput.style.display = "none";

    // Click → open file picker
    addDropzone.addEventListener("click", (e) => {
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
    addDropzone.addEventListener("dragenter", (e) => { stop(e); addDropzone.addClass("over"); });
    addDropzone.addEventListener("dragover", (e) => { stop(e); addDropzone.addClass("over"); });
    addDropzone.addEventListener("dragleave", () => { addDropzone.removeClass("over"); });
    addDropzone.addEventListener("drop", async (e) => {
      stop(e);
      addDropzone.removeClass("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) await this.handleScreenshotFile(file);
    });

    // Ctrl+V paste (when hovered or focused)
    let hovered = false;
    addDropzone.setAttr("tabindex", "0");
    addDropzone.addEventListener("mouseenter", () => { hovered = true; });
    addDropzone.addEventListener("mouseleave", () => { hovered = false; });
    addDropzone.addEventListener("focus", () => { hovered = true; });
    addDropzone.addEventListener("blur", () => { hovered = false; });
    const onPaste = async (e: ClipboardEvent) => {
      if (!hovered && document.activeElement !== addDropzone) return;
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
    (addDropzone as any)._cleanupPaste = () => document.removeEventListener("paste", onPaste, true);

    // ---- Accounts block (copied trades) ----
    void this.renderAccountsBlock(body, t);

    // ---- Executions (bottom — detailed, read-only) ----
    this.renderExecutions(body, t);
  }

  // ---- Accounts block ----
  private async renderAccountsBlock(host: HTMLElement, t: Trade): Promise<void> {
    const wrap = host.createDiv({ cls: "tj-td-execs tj-td-accs" });
    wrap.style.display = "none";
    let records: Trade[] = [];
    try {
      const all = await this.plugin.loadTradesExpanded();
      const key = legBaseKey(t);
      records = all.filter((x) => legBaseKey(x) === key);
    } catch {
      return;
    }
    if (records.length < 2 || !host.contains(wrap)) {
      wrap.remove();
      return;
    }
    records.sort((a, b) => Number(a.isCopiedTrade ?? false) - Number(b.isCopiedTrade ?? false));
    wrap.style.display = "";

    const head = wrap.createDiv({ cls: "tj-td-execs-head" });
    head.createEl("h3", { text: `${records.length} accounts` });
    head.createSpan({ cls: "tj-td-execs-count", text: `one trade · ${records.length} records` });

    const list = wrap.createDiv({ cls: "tj-td-accrows" });
    for (const r of records) {
      const row = list.createDiv({ cls: "tj-td-accrow" + (r.isCopiedTrade ? "" : " is-orig") });
      row.createSpan({ cls: "tj-td-accname", text: this.plugin.displayAccount(r.account) || "—" });
      if (!r.isCopiedTrade) {
        const tag = row.createSpan({ cls: "tj-td-acctag", text: "original" });
        attachTip(tag, { title: "The record you made", sub: "The copies below point at this one." });
      }
      row.createSpan({ cls: "tj-td-accpnl " + toneClass(r.pnl), text: r.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney(r.pnl) });
    }
    wrap.createDiv({ cls: "tj-td-execs-note" })
      .setText("Your trading numbers count this trade once; the money is what it made in each account.");
  }

  // ---- Executions ----
  private renderExecutions(host: HTMLElement, t: Trade): void {
    const set: FillSet = fillSet(t);
    const box = host.createDiv({ cls: "tj-td-execs" });
    const head = box.createDiv({ cls: "tj-td-execs-head" });
    head.createEl("h3", { text: "Executions" });
    head.createSpan({
      cls: "tj-td-execs-count",
      text: set.isMulti
        ? `${set.entries.length} in · ${set.exits.length} out`
        : "single fill",
    });

    const cards = box.createDiv({ cls: "tj-td-execs-cards" });
    const card = (label: string, value: string, tone = "") => {
      const c = cards.createDiv({ cls: "tj-td-execcard" });
      c.createDiv({ cls: "tj-td-execcard-k", text: label });
      c.createDiv({ cls: "tj-td-execcard-v" + (tone ? " " + tone : ""), text: value });
    };
    card("Contracts", set.openQty > 0 ? `${set.exitQty} of ${set.entryQty} closed` : String(set.entryQty), set.openQty > 0 ? "warn" : "");
    card(set.exits.length > 1 ? "Average exit" : "Exit", fmtPrice(set.avgExit || t.exitPrice));
    const exits = set.exits.filter((f) => Number.isFinite(f.pnl));
    if (exits.length > 1) {
      const best = exits.reduce((a, b) => ((b.pnl as number) > (a.pnl as number) ? b : a));
      card("Best exit", fmtMoney2(best.pnl as number), (best.pnl as number) >= 0 ? "pos" : "neg");
    }
    const fees = set.fills.reduce((s, f) => s + (f.fees || 0), 0);
    if (fees > 0) card("Fees", `$${fees.toFixed(2)}`);

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
      const points = Number.isFinite(f.pnl) && f.qty > 0 ? (f.pnl as number) / (pointValue * f.qty) : NaN;
      row.createEl("td", { cls: "r", text: Number.isFinite(points) ? `${points >= 0 ? "+" : ""}${points.toFixed(2)}` : "—" });
      const pnlCell = row.createEl("td", { cls: "r tj-tbl-pnl" });
      if (!Number.isFinite(f.pnl)) pnlCell.setText("—");
      else { pnlCell.addClass(toneClass(f.pnl as number)); pnlCell.setText(f.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney2(f.pnl as number)); }
      row.createEl("td", { cls: "r", text: f.fees ? `$${f.fees.toFixed(2)}` : "—" });
      const flat = isExit && f.pnl === 0;
      const tag = row.createEl("td", { cls: "tj-td-execs-tag" });
      tag.createSpan({ cls: "tj-tbl-fill-tag" + (flat ? " is-flat" : ""), text: fillLabel(f, set.fills.indexOf(f), set) + (flat ? " · BE" : "") });
    }

    const totals = tbody.createEl("tr", { cls: "tj-td-execrow is-total" });
    totals.createEl("td"); totals.createEl("td", { text: "Total" });
    totals.createEl("td", { cls: "r", text: String(set.entryQty) });
    totals.createEl("td", { cls: "r", text: fmtPrice(set.avgEntry) });
    totals.createEl("td", { cls: "r", text: "—" });
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

  // ---- Save ----
  async saveField(key: "setup" | "review" | "mistake" | "thesis" | "notes" | "rating" | "reviewed" | "orderType" | "direction", value: string): Promise<void> {
    try {
      if (this.trade?.id) await updateTradeFields(this.app, (this.app.vault.getAbstractFileByPath(this.trade.id) as TFile), { [key]: value });
    } catch (err) {
      console.error("[tradebook] failed to save trade field:", err);
      new Notice("Could not save — check the file still exists.");
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
    const baseName = `${t.symbol}-${t.date}-print`;
    const safeName = baseName.replace(/[\\/:*?"<>|]+/g, "-");
    const fileName = `${safeName}.${ext}`;
    const dir = normalizePath(this.plugin.getTradesFolder() + "/prints");
    if (!this.plugin.app.vault.getAbstractFileByPath(dir)) {
      await this.plugin.app.vault.createFolder(dir);
    }
    const path = normalizePath(dir + "/" + fileName);
    // Don't overwrite — add numeric suffix if exists
    let finalPath = path;
    let counter = 1;
    while (this.plugin.app.vault.getAbstractFileByPath(finalPath)) {
      finalPath = normalizePath(dir + "/" + safeName + `-${counter}.${ext}`);
      counter++;
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

    // Keep legacy field in sync with first screenshot
    if (t.screenshots.length === 1) {
      t.screenshot = linkName;
    }

    // Save both fields
    await this.saveFields({ screenshot: t.screenshot, screenshots: JSON.stringify(t.screenshots) });
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

    // Keep legacy field in sync
    t.screenshot = shots.length > 0 ? shots[0].file : "";

    await this.saveFields({ screenshot: t.screenshot, screenshots: JSON.stringify(t.screenshots) });
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
    this.annotator.open(file, () => this.render());
  }

  resolveImageFile(link: string): TFile | null {
    const raw = (link || "").trim();
    if (!raw) return null;
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const tradesFolder = this.plugin?.getTradesFolder ? this.plugin.getTradesFolder() : "Tradebook/trades";
    const candidates = [
      raw, target, tradesFolder + "/prints/" + target,
      "Tradebook/trades/prints/" + target, "Tradebook/" + target,
      "Tradebook/trades/" + target, "Tradebook/prints/" + target,
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
    const tradesFolder = this.plugin?.getTradesFolder ? this.plugin.getTradesFolder() : "Tradebook/trades";
    const candidates = [
      raw, target, tradesFolder + "/prints/" + target,
      "Tradebook/trades/prints/" + target, "Tradebook/" + target,
      "Tradebook/trades/" + target, "Tradebook/prints/" + target,
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
    const opts = { screenshot: true, stats: true, rating: true, thesis: false, review: false, mistakes: false, hidePnl: false };

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
        ],
      },
      {
        title: "Review Notes",
        items: [
          { key: "thesis", label: "Thesis", desc: "What you saw in the market" },
          { key: "review", label: "Review", desc: "What you did well or poorly" },
          { key: "mistakes", label: "Improvements", desc: "What you could have done better" },
        ],
      },
      {
        title: "Privacy",
        items: [
          { key: "hidePnl", label: "Hide P&L", desc: "Remove Net P&L and Risk from card" },
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

  private async buildExportCanvas(opts: { screenshot: boolean; stats: boolean; rating: boolean; thesis: boolean; review: boolean; mistakes: boolean; hidePnl: boolean }): Promise<HTMLCanvasElement | null> {
    const t = this.trade;
    if (!t) return null;

    const zone = this.plugin.settings.timeZone;
    const W = 1080, PAD = 48;
    const lineH = 24;

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

    // Pre-measure note sections
    const noteItems: Array<{ label: string; text: string; lines: string[] }> = [];
    if (opts.thesis && t.thesis) {
      tempCtx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      noteItems.push({ label: "Thesis", text: t.thesis, lines: wrapText(tempCtx, t.thesis, maxTextW) });
    }
    if (opts.review && t.review) {
      tempCtx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      noteItems.push({ label: "Review", text: t.review, lines: wrapText(tempCtx, t.review, maxTextW) });
    }
    if (opts.mistakes && t.mistake) {
      tempCtx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      noteItems.push({ label: "Improvements", text: t.mistake, lines: wrapText(tempCtx, t.mistake, maxTextW) });
    }

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
    totalH += 145; // header (symbol + badge + date line)
    totalH += 32;  // separator
    if (opts.screenshot) {
      if (imgScales.length > 0) {
        for (const is2 of imgScales) totalH += is2.h + 16;
      } else {
        totalH += 232; // placeholder
      }
      totalH += 32; // separator
    }
    if (opts.stats) {
      totalH += 130; // KPI row
      totalH += 74;  // details row
      totalH += 32;  // separator
    }
    if (opts.rating) {
      totalH += 70;
    }
    if (noteItems.length > 0) {
      if (opts.rating || opts.stats) totalH += 32; // separator before notes
      for (const n of noteItems) {
        totalH += 32 + n.lines.length * lineH + 18;
      }
    }
    totalH += 52; // watermark
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

    // ── Header (always) ──
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(t.symbol || "—", PAD, y);

    const symbolW = ctx.measureText(t.symbol || "—").width;
    const isLong = t.direction === "long";
    const badgeText = isLong ? "LONG" : "SHORT";
    const badgeBg = isLong ? "rgba(52,209,122,0.15)" : "rgba(255,93,72,0.15)";
    const badgeFg = isLong ? "#34d17a" : "#ff5d48";
    const badgeW = ctx.measureText(badgeText).width + 28;
    ctx.fillStyle = badgeBg;
    this.roundRect(ctx, PAD + symbolW + 16, y + 6, badgeW, 38, 19);
    ctx.fill();
    ctx.fillStyle = badgeFg;
    ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(badgeText, PAD + symbolW + 30, y + 13);

    // Review status badge (top right)
    const hasPrint = !!(t.screenshot && t.screenshot.trim()) || (t.screenshots?.length ?? 0) > 0;
    const hasSetup = !!(t.setup && t.setup.trim());
    const hasReview = !!(t.notes && t.notes.trim()) || !!(t.review && t.review.trim());
    const hasRating = (t.rating ?? 0) > 0;
    const complete = hasPrint && hasSetup && hasReview && hasRating;
    const statusText = complete ? "Review Complete" : "Review Pending";
    const statusFg = complete ? "#34d17a" : "#f59e0b";
    const statusBg2 = complete ? "rgba(52,209,122,0.12)" : "rgba(245,158,11,0.12)";
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const statusW = ctx.measureText(statusText).width + 36;
    ctx.fillStyle = statusBg2;
    this.roundRect(ctx, W - PAD - statusW, PAD, statusW, 40, 20);
    ctx.fill();
    ctx.fillStyle = statusFg;
    ctx.fillText(statusText, W - PAD - statusW + 18, PAD + 11);

    y += 80;

    // Date + Session + Strategy
    const sessKey = sessionOf(t, zone);
    const sessLabel = SESSION_LABELS[sessKey] ?? "";
    ctx.fillStyle = "#8a9099";
    ctx.font = "26px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(`${t.date}  ·  ${sessLabel}  ·  ${t.setup || "—"}`, PAD, y);
    y += 52;

    // Separator
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

    // ── Stats (conditional) ──
    if (opts.stats) {
      // KPI Row
      const pnl = typeof t.pnl === "number" && Number.isFinite(t.pnl) ? t.pnl : 0;
      const pts = typeof t.pnlPoints === "number" && Number.isFinite(t.pnlPoints) ? t.pnlPoints : 0;
      const rm = tradeR(t) ?? 0;

      const kpis = [
        ...(!opts.hidePnl ? [{ label: "Net P&L", value: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`, color: pnl >= 0 ? "#34d17a" : "#ff5d48" }] : []),
        { label: "Points", value: pts.toFixed(2), color: "#dcddde" },
        { label: "R-Multiple", value: `${rm.toFixed(2)}R`, color: "#dcddde" },
        { label: "Hold Time", value: holdFmt(t.entryTime, t.exitTime), color: "#dcddde" },
      ];
      const kpiCount = kpis.length;
      const kpiW = (W - PAD * 2 - (kpiCount - 1) * 8) / kpiCount;
      kpis.forEach((kpi, i) => {
        const kx = PAD + i * (kpiW + 8);
        ctx.fillStyle = "#181818";
        this.roundRect(ctx, kx, y, kpiW, 96, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        this.roundRect(ctx, kx, y, kpiW, 96, 8);
        ctx.stroke();
        ctx.fillStyle = "#8a9099";
        ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(kpi.label, kx + 18, y + 18);
        ctx.fillStyle = kpi.color;
        ctx.font = "bold 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(kpi.value, kx + 18, y + 48);
      });
      y += 130;

      // Details row — always show Stop, Target, Contracts; hide Risk $ when hidePnl
      const details = [
        { label: "Stop", value: t.stopLoss ? fmtPrice(t.stopLoss) : "—" },
        { label: "Target", value: t.target ? fmtPrice(t.target) : "—" },
        ...(!opts.hidePnl ? [{ label: "Risk $", value: t.stopLoss && t.entryPrice ? `$${Math.abs(t.entryPrice - t.stopLoss) * (futuresSpec(t.symbol)?.pointValue ?? 1) * t.quantity}` : "—" }] : []),
        { label: "Contracts", value: String(t.quantity) },
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

    // ── Rating (conditional) ──
    if (opts.rating) {
      const rating = t.rating ?? 0;
      ctx.fillStyle = "#8a9099";
      ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("Execution Rating", PAD, y);
      y += 32;
      for (let i = 0; i < 5; i++) {
        this.drawStarCanvas(ctx, PAD + i * 42 + 18, y + 18, 17, i < rating);
      }
      y += 38;
    }

    // ── Notes (conditional) ──
    if (noteItems.length > 0) {
      if (opts.rating || opts.stats) {
        // Separator before notes
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
        y += 32;
      }
      for (const n of noteItems) {
        ctx.fillStyle = "#8a9099";
        ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(n.label, PAD, y);
        y += 28;
        ctx.fillStyle = "#a8aeb4";
        ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        for (const line of n.lines) {
          ctx.fillText(line, PAD, y);
          y += lineH;
        }
        y += 14;
      }
    }

    // ── Watermark ──
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("Tradebook", W - PAD, totalH - 36);
    ctx.textAlign = "left";

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

  private drawStarCanvas(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, filled: boolean): void {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const method = i === 0 ? "moveTo" : "lineTo";
      ctx[method](cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = "#f59e0b";
      ctx.fill();
    } else {
      ctx.strokeStyle = "#8a9099";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
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
}
