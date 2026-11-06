import { ItemView, Notice, TFile, normalizePath, setIcon, type WorkspaceLeaf } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { renderAppShell } from "../ui";
import { fmtMoney, fmtMoney2, fmtMoneyAbs, fmtPrice } from "../tz";
import { formatDate } from "../lib/dates";
import { legBaseKey } from "../lib/copy";
import { setTradeMistakeTags, updateTradeArrayFields, updateTradeFields, updateTradeScreenshots, setTradeStrategy } from "../storage";
import { normalizeTags, reviewOptions, reviewTagGroups } from "../lib/tags";

/**
 * Whether this trade carries a complete cost record.
 *
 * Commission without fees is the ordinary shape of an imported broker fill: the
 * export carries the commission and not the exchange, clearing and NFA lines.
 * The numbers are still computed from what is recorded \u2014 but they are a
 * floor, and the page has to say so rather than let a partial cost look final.
 */
function hasRecordedCosts(t: Trade): boolean {
  return Number.isFinite(t.commission) && Number.isFinite(t.fees);
}

function isScreenshotEntry(entry: { file?: unknown } | null | undefined): boolean {
  return typeof entry?.file === "string" && entry.file.trim().length > 0;
}

import { reviewHtmlToMarkdown, reviewMarkdownToHtml } from "../lib/reviewRichText";

import { PrintAnnotator } from "./printAnnotator";
import {
  attachGroupToTrade,
  listPendingAttachGroups,
  parsePrintGroupDragPayload,
  PRINT_GROUP_MIME,
  type AttachGroupOutcome,
} from "../lib/printGroupAttach";
import { type PrintGroup } from "../lib/printGroup";
import { attachTip } from "../lib/tip";
import { fillIndex, fillLabel, fillSet, FillSet, isBreakEven, toneClass, tradePoints } from "../lib/fills";
import { knownFuturesSpec } from "../futures";
import { sessionOf } from "../lib/sessions";
import { holdFmtOf } from "../lib/tradeTable";
import { recordedRisk } from "../lib/risk";
import { mountDropdown, mountMultiDropdown, DropdownItem, MultiDropdown } from "../lib/dropdown";
import { freeNumeric } from "../lib/numeric";
import { strategiesOf } from "../lib/strategySelection";
import { feeForTrade, netPnl, round2, splitFeeTotal } from "../lib/fees";
import { parsePlannedNumber, reviewStatus, planDifferences, type ReviewCheckKey, type ReviewState } from "../lib/review";

export const TRADE_DETAIL_VIEW_TYPE = "tradebook-trade-detail-view";

import { renderTradeCard, type ExportOptions, type ExportOrientation, type ExportTheme, type TradeCardResult } from "../lib/tradeCard";

function reviewStateHint(state: ReviewState): string {
  switch (state) {
    case "reviewed": return "All six review signals are complete.";
    case "reviewed-with-missing-context": return "All six signals are complete; relevant context was explicitly marked unavailable.";
    case "legacy-marked-reviewed": return "This record was explicitly marked reviewed outside the six-signal check.";
    case "reopened": return "This review was explicitly reopened.";
    default: return "Complete all six review signals to mark this trade reviewed.";
  }
}

/**
 * Out-of-the-box tag chips. They are only *suggestions*: they sit in the review
 * card as unselected chips so a new journal already has a vocabulary to click,
 * and never write themselves onto a trade. A label the trader uses elsewhere
 * joins the same pool, and the inline input still adds anything else.
 */
export class TradeDetailView extends ItemView {
  plugin: TradebookPlugin;
  trade: Trade | null = null;
  allTrades: Trade[] = [];
  index = -1;
  /** Where this review came from — an account keeps the walk inside that account. */
  private from: { type: "tradelog" | "account"; accountId?: string; tradeIds?: string[] } | null = null;
  /** Setup names available in the picker — registry + names used by notes. */
  setupOptions: string[] = [];
  /** Pending debounced review saves, keyed by field — flushed on switch/close. */
  private _saveTimers: Record<string, { timer: number; run: () => Promise<void> }> = {};
  /** Last local write; the global vault invalidation should not redraw this view immediately. */
  private _lastLocalWriteAt = 0;
  private _refreshRetry: number | null = null;
  /** Screenshot on show in the carousel — reset whenever the trade changes. */
  private _activePrint = 0;
  /** Prevent editor/viewport state from crossing a trade switch during render. */
  private _renderedTradeId: string | null = null;
  /** Optional-depth disclosure choice is retained only for the current trade. */
  private _optionalOpen: { tradeId: string; open: boolean } | null = null;
  /** Tear-down for an open Enlarge lightbox (removes overlay + key listener). */
  private _lightboxCleanup: (() => void) | null = null;
  /** This view's active body-mounted tag picker, scoped to its trade and group. */
  private _ownedTagPopover: { panel: HTMLElement; tradeId: string; group: string; close: () => void } | null = null;
  /** Cleanups for document-level listeners added on render (e.g. paste). */
  private _pasteCleanups: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, plugin: TradebookPlugin) {
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
  private get origin(): { type: "tradelog" | "account"; accountId?: string; tradeIds?: string[] } {
    return this.from ?? this.plugin.tradeDetailOrigin ?? { type: "tradelog" as const };
  }

  /** The review walks the exact Trade Log result, in its existing order. */
  private async loadScope(): Promise<Trade[]> {
    const tradeIds = this.origin.type === "tradelog" ? this.origin.tradeIds : undefined;
    if (tradeIds) {
      const expanded = await this.plugin.loadTradesExpanded();
      const byId = new Map(expanded.map((trade) => [trade.id, trade]));
      return tradeIds.map((id) => byId.get(id)).filter((trade): trade is Trade => !!trade);
    }
    const all = await this.plugin.loadTrades();
    const accountId = this.origin.type === "account" ? this.origin.accountId : "";
    if (!accountId) return all;
    const mine = all.filter((t) => this.plugin.mappedAccount(t.account)?.id === accountId);
    // A leg or an unmapped trade still has to open: never hand back an empty list.
    return mine.length ? mine : all;
  }

  /** Tag suggestions: the house defaults first, then labels already used. */
  private knownTags(key: "psychology_tags" | "mistake_tags"): string[] {
    const defaults = reviewOptions(this.plugin.settings, key === "mistake_tags" ? "mistakes" : "psychology");
    const seen = new Set(defaults.map((t) => t.toLowerCase()));
    const extra: string[] = [];
    for (const tr of this.allTrades) {
      for (const tag of (tr[key] ?? [])) {
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
      const from = state.from as { type: "tradelog" | "account"; accountId?: string; tradeIds?: string[] } | undefined;
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
    // Recompute the derived realized-points value from actual fills/scalars;
    // legacy stored values may use an older definition and are not trusted.
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
      let saved: { tradeId?: string; from?: { type: "tradelog" | "account"; accountId?: string; tradeIds?: string[] } } | undefined;
      try { saved = this.leaf.getViewState?.()?.state; } catch { /* */ }
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
    if (this._refreshRetry !== null) window.clearTimeout(this._refreshRetry);
    this._refreshRetry = null;
    window.removeEventListener("keydown", this.keydownHandler);
    this._lightboxCleanup?.();
    // Clean up the document-level paste listener(s).
    this._pasteCleanups.forEach((fn) => fn());
    this._pasteCleanups = [];
  }

  /**
   * Vault writes invalidate every TradeBook view. Keep this view's local edit
   * surface stable while its own write is propagating; the next external reload
   * still renders normally.
   */
  async refresh(): Promise<void> {
    const id = this.trade?.id;
    if (!id) return;
    const active = this.contentEl.ownerDocument.activeElement;
    const editing = active instanceof HTMLElement && this.contentEl.contains(active) &&
      (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (editing || Object.keys(this._saveTimers).length || Date.now() - this._lastLocalWriteAt < 1500) {
      if (this._refreshRetry !== null) window.clearTimeout(this._refreshRetry);
      this._refreshRetry = window.setTimeout(() => { this._refreshRetry = null; if (this.trade?.id === id) void this.refresh(); }, 1600);
      return;
    }
    const writeAt = this._lastLocalWriteAt;
    const scope = await this.loadScope();
    if (this.trade?.id !== id || this._lastLocalWriteAt !== writeAt || Object.keys(this._saveTimers).length) return;
    const focused = this.contentEl.ownerDocument.activeElement;
    if (focused instanceof HTMLElement && this.contentEl.contains(focused) && (focused.isContentEditable || focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")) return;
    const latest = scope.find((trade) => trade.id === id);
    if (latest) { this.trade = latest; this.allTrades = scope; this.index = scope.indexOf(latest); }
    this.render();
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
    const scrollHost = root.closest<HTMLElement>(".view-content") ?? root.parentElement;
    const preservedScroll = root.childElementCount > 0 && scrollHost && this._renderedTradeId === this.trade?.id
      ? { top: scrollHost.scrollTop, left: scrollHost.scrollLeft }
      : null;
    // The review rail and app shell are rebuilt below; the host viewport alone
    // does not describe where the reader is. Keep each scroll surface separately.
    const preservedRegions: Array<{ selector?: string; element?: HTMLElement; top: number; left: number }> = [];
    if (preservedScroll) {
      for (const selector of [".tj-app-main", ".tj-td-left"]) {
        const element = root.querySelector<HTMLElement>(selector);
        if (element) preservedRegions.push({ selector, top: element.scrollTop, left: element.scrollLeft });
      }
      for (let element = root.parentElement; element && element !== root.ownerDocument.body; element = element.parentElement) {
        preservedRegions.push({ element, top: element.scrollTop, left: element.scrollLeft });
      }
    }
    const retainedFocus = this._renderedTradeId === this.trade?.id
      ? (() => {
          const active = root.ownerDocument.activeElement as HTMLElement | null;
          const owned = this._ownedTagPopover;
          const inOwnedPicker = !!owned && owned.tradeId === this.trade?.id && owned.panel.contains(active);
          const captured = active && (root.contains(active) || inOwnedPicker) && active.dataset.reviewControl
            ? inOwnedPicker
              ? { key: "tags", group: owned!.group }
              : { key: active.dataset.reviewControl, group: active.dataset.reviewGroup ?? null }
            : null;
          // The body-mounted picker cannot survive root.empty(); close only this
          // view's same-trade picker, then restore to its group's Add-tag trigger.
          if (inOwnedPicker) owned!.close();
          return captured;
        })()
      : null;
    const editorStates = this._renderedTradeId === this.trade?.id
      ? Array.from(root.querySelectorAll<HTMLTextAreaElement>(".tj-td-textarea"))
      .map((area) => ({
        area,
        key: area.getAttribute("data-review-field"),
        active: document.activeElement === area,
      }))
      .filter(({ key, active }) => !!key && (active || !!this._saveTimers[key as string]))
      .map(({ area, key, active }) => ({
        key: key as string,
        value: area.value,
        selectionStart: area.selectionStart,
        selectionEnd: area.selectionEnd,
        scrollTop: area.scrollTop,
        scrollLeft: area.scrollLeft,
        active,
      }))
      : [];
    root.empty();
    root.addClass("tj-trade-detail");
    const main = renderAppShell(root, this.plugin, "");

    const t = this.trade;
    const sameTradeRender = !!t && this._renderedTradeId === t.id;
    if (!sameTradeRender) this._optionalOpen = null;
    if (!t) {
      main.createDiv({ cls: "tj-empty", text: "No trade selected — open one from the Trade Log, Calendar or Dashboard." });
      this._renderedTradeId = null;
      return;
    }
    this._renderedTradeId = t.id;

    const zone = this.plugin.settings.timeZone;

    // ---- Header ----
    const top = main.createDiv({ cls: "tj-td-top" });
    const head = top.createDiv({ cls: "tj-td-head" });

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
      const tlBtn = navBtns.createEl("button", { cls: "tj-seg-btn", text: "Trade log" });
      tlBtn.addEventListener("click", () => void this.plugin.openTradeLogForAccount(origin.accountId as string));
    }

    const prevBtn = navBtns.createEl("button", { cls: "tj-seg-btn", attr: { "aria-label": "Previous trade" } });
    setIcon(prevBtn, "chevron-left");
    prevBtn.disabled = this.index <= 0;
    prevBtn.addEventListener("click", () => void this.prev());

    navBtns.createSpan({ cls: "tj-td-counter", text: `${this.index + 1} / ${this.allTrades.length}` });
    if (backToAccount) {
      const acc = this.plugin.settings.propAccounts.find((a) => a.id === origin.accountId);
      const scope = navBtns.createSpan({ cls: "tj-td-scope", text: acc?.name ?? "This account" });
      attachTip(scope, { title: "Scoped to this account", sub: "These arrows walk only this account's trades." });
    }

    const nextBtn = navBtns.createEl("button", { cls: "tj-seg-btn", attr: { "aria-label": "Next trade" } });
    setIcon(nextBtn, "chevron-right");
    nextBtn.disabled = this.index < 0 || this.index >= this.allTrades.length - 1;
    nextBtn.addEventListener("click", () => void this.next());

    // ---- Review signals: matching bubbles with concise hover labels ----
    const dotsState = reviewStatus(t);
    const reviewWrap = head.createDiv({ cls: "tj-td-review-wrap" });
    const reviewDots = reviewWrap.createDiv({ cls: "tj-td-review-dots", attr: { role: "group" } });
    const bubbleKeys: ReviewCheckKey[] = ["setup", "rating", "psychology", "mistakes", "whatHappened", "repeatChange"];
    for (const key of bubbleKeys) {
      const check = dotsState.checks.find((item) => item.key === key);
      if (!check) continue;
      const dot = reviewDots.createSpan({ cls: "tj-td-review-dot" + (check.required ? " is-core" : "") + (check.done ? " done" : "") });
      dot.dataset.reviewKey = check.key;
      dot.setAttr("role", "img");
      dot.setAttr("tabindex", "0");
      dot.createSpan({ cls: "tj-sr-only", text: check.label });
      attachTip(dot, { title: check.label });
    }
    // Review completion remains automatic; the bubbles only identify review fields.

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
    refresh.addEventListener("click", () => void (async () => {
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
    })());
    const delBtn = headActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button", "aria-label": "Delete trade" },
    });
    setIcon(delBtn, "trash");
    // The warning says what the engine actually does: a base note takes its
    // generated copies with it; a copy note is only itself (its siblings stay).
    const isCopied = t.isCopiedTrade === true;
    attachTip(delBtn, {
      title: "Delete trade",
      sub: isCopied
        ? "Moves this copy's note to the vault trash. The original and its other copies stay."
        : "Moves the note to the vault trash, along with the copies generated from it. Real imported copies stay.",
    });
    delBtn.addEventListener("click", () => void (async () => {
      const extra = isCopied
        ? " Only this copy will be removed."
        : " Its generated copies will be removed too.";
      if (window.confirm(`Delete trade ${t.symbol} (${t.date}, $${t.pnl})?${extra}`)) {
        await this.plugin.deleteTrade(t.id);
        if (backToAccount) await this.plugin.openAccountDashboard(undefined, origin.accountId as string);
        else await this.plugin.openTradeLog();
      }
    })());

    // ---- Body ----
    const body = main.createDiv({ cls: "tj-td-body" });

    // ---- Hero bar — title and badges left, headline figures right ----
    const dirLabel = t.direction === "long" ? "Long" : t.direction === "short" ? "Short" : "—";
    const reviewState = reviewStatus(t);
    const hero = top.createDiv({ cls: "tj-td-hero" });
    const heroTitle = hero.createDiv({ cls: "tj-td-hero-title-group" });
    heroTitle.createSpan({ cls: "tj-td-hero-title", text: `${t.symbol} · ${dirLabel}` });
    heroTitle.createSpan({
      cls: "tj-td-hero-when",
      text: `${formatDate(t.date, this.plugin.settings.dateFormat)}${t.entryTime ? ", " + t.entryTime : ""}`,
    });
    // Where the trade came from, when the note knows. Quiet — an icon and a
    // tooltip — because it is provenance, not a headline. `dataSource` is the
    // explicit statement; `origin` is the legacy fallback for notes written
    // before it existed. A reconstructed copy is the one that must never read
    // as a broker fill.
    const source = t.dataSource ?? (t.origin === "broker" ? "broker" : t.origin === "manual" ? "manual" : undefined);
    if (source) {
      const origin = heroTitle.createSpan({
        cls: "tj-td-origin" + (source === "reconstructed" ? " is-reconstructed" : ""),
      });
      setIcon(origin, source === "broker" ? "download" : source === "reconstructed" ? "sparkles" : "pencil");
      attachTip(origin, {
        title:
          source === "broker"
            ? "Written by an import"
            : source === "reconstructed"
            ? "Reconstructed copy"
            : "Recorded by hand",
        sub:
          source === "broker"
            ? "This trade came in from the platform's own CSV export."
            : source === "reconstructed"
            ? "Generated by the copy engine from the configuration — a model of the leader's trade, not the follower's own fill."
            : "This trade was typed into the journal.",
      });
    }
    if (t.direction === "long" || t.direction === "short") {
      heroTitle.createSpan({ cls: `tj-td-hero-badge is-${t.direction}`, text: dirLabel });
    }
    if (t.setup) heroTitle.createSpan({ cls: "tj-td-hero-badge", text: t.setup });
    const statusCls = `tj-td-hero-badge is-status is-${reviewState.state}`;

    // Completion is a read-only automatic state. The human core is what makes a
    // new review complete; older records may remain closed for compatibility, but
    // the user never has to press a second confirmation button.
    const statusBadge = heroTitle.createSpan({ cls: statusCls, text: reviewState.label });
    statusBadge.setAttr("aria-label", reviewState.label);
    statusBadge.setAttr("title", reviewStateHint(reviewState.state));
    const heroMetrics = hero.createDiv({ cls: "tj-td-hero-metrics" });
    const heroMetric = (label: string, value: string, tone = "") => {
      const metric = heroMetrics.createDiv({ cls: "tj-td-hero-metric" });
      metric.createSpan({ cls: "tj-td-hero-k", text: label });
      metric.createSpan({ cls: "tj-td-hero-v" + (tone ? " " + tone : ""), text: value });
      return metric;
    };
    const heroPts = t.pnlPoints;
    const heroPtsStr = typeof heroPts === "number" && Number.isFinite(heroPts)
      ? `${heroPts >= 0 ? "+" : ""}${heroPts.toFixed(2)} pts`
      : "—";
    // Net is the headline — what the trade actually made after recorded costs.
    // Gross and the costs stay as the secondary line, never hidden.
    const heroGross = t.pnl;
    const heroCosts = round2((t.commission || 0) + (t.fees || 0));
    const heroNet = netPnl(t);
    const hasHeroNet = Number.isFinite(heroNet);
    const netMetric = heroMetric(
      "Net P&L",
      hasHeroNet ? fmtMoney2(heroNet) : "—",
      hasHeroNet ? (heroNet >= 0 ? "pos" : "neg") : "",
    );
    attachTip(netMetric, {
      title: "Net P&L",
      sub: !hasHeroNet
        ? "P&L is unavailable from the recorded actuals; no estimate was substituted."
        : !hasRecordedCosts(t)
          ? `Gross ${Number.isFinite(heroGross) ? fmtMoney2(heroGross) : "—"}, less whatever costs this trade recorded — commission alone is common when an import carries no fee lines, so this figure is a floor, not a final result.`
          : `After recorded commission and fees. Gross ${Number.isFinite(heroGross) ? fmtMoney2(heroGross) : "—"}; recorded costs ${fmtMoneyAbs(heroCosts)}. Payouts and deposits are not trading results.`,
    });
    if (!hasHeroNet) {
      heroMetrics.createDiv({
        cls: "tj-td-hero-warn",
        text: "P&L unavailable from the recorded actuals — no estimate was substituted.",
      });
    } else if (!hasRecordedCosts(t)) {
      heroMetrics.createDiv({
        cls: "tj-td-hero-warn",
        text: "Costs on this trade are incomplete — commission is recorded, fees are not. Net is a floor.",
      });
    }
    const pointsMetric = heroMetric(
      "Points",
      heroPtsStr,
      Number.isFinite(heroPts) ? (heroPts >= 0 ? "pos" : "neg") : "",
    );
    pointsMetric.addClass("tj-td-hero-points");
    heroMetric("Hold Time", holdFmtOf(t));

    // Two-column layout
    const cols = body.createDiv({ cls: "tj-td-cols" });

    // ================================================================
    // LEFT COLUMN — the visible Execution & Risk card, then Review
    // ================================================================
    const leftCol = cols.createDiv({ cls: "tj-td-left" });
    const reviewWorkspace = leftCol.createDiv({ cls: "tj-td-review-workspace" });
    const pageScroll = leftCol.closest<HTMLElement>(".tj-app-main");
    leftCol.addEventListener("wheel", (event) => {
      if (!pageScroll || Math.abs(event.deltaY) < 1) return;
      const maxLeftScroll = Math.max(0, leftCol.scrollHeight - leftCol.clientHeight);
      const atTop = leftCol.scrollTop <= 0 && event.deltaY < 0;
      const atBottom = leftCol.scrollTop >= maxLeftScroll - 1 && event.deltaY > 0;
      if (maxLeftScroll === 0 || atTop || atBottom) {
        pageScroll.scrollTop += event.deltaY;
        event.preventDefault();
      }
    }, { passive: false });
    cols.addEventListener("wheel", (event) => {
      if (!pageScroll || event.defaultPrevented || Math.abs(event.deltaY) < 1) return;
      if (event.target instanceof Node && leftCol.contains(event.target)) return;
      const maxLeftScroll = Math.max(0, leftCol.scrollHeight - leftCol.clientHeight);
      const atTop = leftCol.scrollTop <= 0 && event.deltaY < 0;
      const atBottom = leftCol.scrollTop >= maxLeftScroll - 1 && event.deltaY > 0;
      if (maxLeftScroll > 0 && !atTop && !atBottom) {
        leftCol.scrollTop += event.deltaY;
      } else {
        pageScroll.scrollTop += event.deltaY;
      }
      event.preventDefault();
    }, { passive: false });

    /** A framed card with an uppercase section head — the page's surface unit. */
    const panelCard = (host: HTMLElement, title: string): HTMLElement => {
      const card = host.createDiv({ cls: "tj-td-panel" });
      const cardHead = card.createDiv({ cls: "tj-td-panel-head" });
      cardHead.createDiv({ cls: "tj-td-panel-title", text: title });
      return card.createDiv({ cls: "tj-td-panel-body" });
    };
    const execCard = panelCard(reviewWorkspace, "Execution & Risk");
    const reviewCard = panelCard(reviewWorkspace, "Review");

    const execGrid = execCard.createDiv({ cls: "tj-td-exec-grid" });
    const execFacts = execGrid.createDiv({ cls: "tj-td-exec-group" });
    const execRisk = execGrid.createDiv({ cls: "tj-td-exec-group" });
    const execExtra = execGrid.createDiv({ cls: "tj-td-exec-group tj-td-exec-extra" });
    // --- Click-to-edit helpers ---

    /** Make a value span clickable → transforms into an input on click. */
    const editableRow = (
      host: HTMLElement,
      label: string,
      currentValue: string,
      onSave: (newVal: string) => Promise<void>,
      opts?: { numeric?: boolean; tip?: string }
    ) => {
      const r = host.createDiv({ cls: "tj-td-flip-row" });
      r.dataset.execLabel = label;
      r.createSpan({ cls: "tj-td-flip-key", text: label });
      const valSpan = r.createSpan({ cls: "tj-td-flip-val", text: currentValue });
      valSpan.setCssStyles({ cursor: "pointer" });
      attachTip(
        valSpan,
        opts?.tip
          ? { title: "Click to edit", sub: opts.tip }
          : { title: "Click to edit", sub: `Change ${label.toLowerCase()}` }
      );
      valSpan.addEventListener("click", () => {
        // Replace span with input
        const input = createEl("input");
        input.type = opts?.numeric ? "number" : "text";
        input.className = "tj-td-flip-input";
        input.value = currentValue.replace(/[^0-9.-]/g, "");
        if (opts?.numeric) freeNumeric(input);
        input.setCssStyles({ width: "100%" });
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        const save = async () => {
          const raw = input.value.trim();
          if (raw !== currentValue.replace(/[^0-9.-]/g, "")) {
            await onSave(raw);
          } else {
            // Revert — put the original span back, so its text (which may carry
            // a "· corrected" suffix) and its click-to-edit both survive.
            input.replaceWith(valSpan);
          }
        };
        input.addEventListener("blur", () => void save());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
          if (e.key === "Escape") { input.value = currentValue.replace(/[^0-9.-]/g, ""); input.blur(); }
        });
      });
      return valSpan;
    };

    // Static (computed) row — not editable
    const row = (host: HTMLElement, label: string, value: string, tone = "") => {
      const r = host.createDiv({ cls: "tj-td-flip-row" });
      r.dataset.execLabel = label;
      r.createSpan({ cls: "tj-td-flip-key", text: label });
      r.createSpan({ cls: "tj-td-flip-val" + (tone ? " " + tone : ""), text: value });
      return r;
    };

    // The dollars at risk are derived, never stored: a stop and an entry are
    // all the note needs, and the risk follows from the symbol's point value.
    const riskDollar = recordedRisk(t);

    // ---- Entry → Exit (derived from authoritative executions) ----
    const eeRow = execFacts.createDiv({ cls: "tj-td-flip-row tj-td-exec-wide" });
    eeRow.dataset.execLabel = "Entry → Exit";
    eeRow.createSpan({ cls: "tj-td-flip-key", text: "Entry → Exit" });
    const eeVal = eeRow.createSpan({ cls: "tj-td-flip-val" });
    eeVal.createSpan({ cls: "tj-td-ee-part", text: t.entryPrice ? fmtPrice(t.entryPrice) : "—" });
    eeVal.createSpan({ cls: "tj-td-ee-arrow", text: " → " });
    eeVal.createSpan({ cls: "tj-td-ee-part", text: t.exitPrice ? fmtPrice(t.exitPrice) : "—" });
    attachTip(eeVal, { title: "Recorded executions", sub: "These prices come from the executions. Correct original manual executions below; imported executions remain authoritative." });

    // ---- Gross result and R (gross P&L over the recorded risk basis) ----
    const rMultiple = Number.isFinite(t.pnl) && riskDollar !== null && riskDollar > 0 ? t.pnl / riskDollar : null;
    const rTone = rMultiple !== null ? (rMultiple >= 0 ? "pos" : "neg") : "";
    row(execRisk, "Gross P&L", Number.isFinite(t.pnl) ? fmtMoney2(t.pnl) : "—", Number.isFinite(t.pnl) ? (t.pnl >= 0 ? "pos" : "neg") : "");
    const rRow = execRisk.createDiv({ cls: "tj-td-flip-row" });
    rRow.dataset.execLabel = "R";
    rRow.createSpan({ cls: "tj-td-flip-key", text: "R" });
    rRow.createSpan({
      cls: "tj-td-flip-val" + (rTone ? " " + rTone : "") + (rMultiple !== null ? " is-hero" : ""),
      text: rMultiple !== null ? `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R` : "—",
    });
    execRisk.createDiv({ cls: "tj-td-exec-subseparator" });

    // ---- Contracts (derived) ----
    const contractsVal = String(t.quantity ?? 1);
    row(execFacts, "Contracts", contractsVal);

    // The initial stop defines the original risk denominator. A later recorded
    // stop is shown separately and never rewrites that history.
    editableRow(execRisk, "Stop", t.stopLoss ? fmtPrice(t.stopLoss) : "—", async (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price) && price > 0) {
        this.trade!.stopLoss = price;
        await this.saveFields({ stop_loss: String(price) });
        this.render();
      }
    }, { numeric: true });
    editableRow(execRisk, "Risk", riskDollar !== null && riskDollar > 0 ? `$${riskDollar.toFixed(2)}` : "—", async (raw) => {
      const dollars = parseFloat(raw.replace(/[$,]/g, ""));
      const spec = knownFuturesSpec(t.symbol || "");
      const quantity = Number(t.quantity);
      const entry = Number(t.entryPrice);
      if (!spec || !Number.isFinite(dollars) || dollars <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(entry) || entry <= 0) return;
      const points = dollars / (spec.pointValue * quantity);
      const stop = t.direction === "short" ? entry + points : entry - points;
      if (!Number.isFinite(stop) || stop <= 0) return;
      this.trade!.stopLoss = stop;
      await this.saveFields({ stop_loss: String(stop) });
      this.render();
    }, { numeric: true });

    const sessKey = sessionOf(t, zone);
    const sessRow = execExtra.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat" });
    sessRow.dataset.execLabel = "Session";
    sessRow.createSpan({ cls: "tj-td-flip-key", text: "Session" });
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
      t.sessionOverride || sessKey || "",
      (id) => void (async () => {
        if (id === "__auto__") {
          delete t.sessionOverride;
        } else {
          t.sessionOverride = id;
        }
        await this.saveFields({ session_override: id === "__auto__" ? "" : id });
        this.render();
      })(),
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
    const feesSpan = editableRow(execExtra, "Fees", `$${realFees.toFixed(2)}`, async (raw) => {
      const val = parseFloat(raw.replace(/[$]/g, ""));
      if (Number.isFinite(val)) {
        // The edited number is the platform's total. Keep the recorded
        // commission and put the rest in fees, so the split survives the edit
        // and the total stays exactly what was typed.
        const split = splitFeeTotal(val, t.commission || 0);
        try {
          await this.saveFields({ fees: String(split.fees), commission: String(split.commission) });
          t.fees = split.fees;
          t.commission = split.commission;
          if (this.trade?.id === t.id) this.render();
        } catch { /* saveFields already reports the failure; keep the displayed record. */ }
      }
    }, {
      numeric: true,
      tip:
        fees.allocated !== 0
          ? `$${fees.real.toFixed(2)} the platform reported, plus $${fees.allocated.toFixed(2)} this trade's share of the account's balance correction. Editing sets the platform total; the recorded commission is kept.`
          : undefined,
    });
    if (fees.allocated !== 0) {
      feesSpan.setText(`$${fees.total.toFixed(2)} · $${fees.allocated.toFixed(2)} corrected`);
    }

    // ---- Order Type / Max position / Fill count (every row visible) ----
    const otRow = execExtra.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat tj-td-order-type-row tj-td-source-detail" });
    otRow.createSpan({ cls: "tj-td-flip-key", text: "Order Type" });
    const otWrap = otRow.createDiv({ cls: "tj-td-flip-strat-wrap" });
    mountDropdown(otWrap, [
      { id: "Limit", label: "Limit" },
      { id: "Market", label: "Market" },
      { id: "Stop", label: "Stop" },
      { id: "Stop Limit", label: "Stop Limit" },
    ], t.orderType || "", (id) => void (async () => {
      this.trade!.orderType = id || undefined;
      await this.saveField("orderType", id);
      this.render();
    })(), { placeholder: "—" });


    // ---- Strategy belongs with the objective execution/risk facts ----
    const stratField = execExtra.createDiv({ cls: "tj-td-flip-row tj-td-flip-row-strat tj-td-strategy-field" });
    stratField.dataset.execLabel = "Strategy";
    stratField.createSpan({ cls: "tj-td-flip-key", text: "Strategy" });
    const stratWrap = stratField.createDiv({ cls: "tj-td-flip-strat-wrap tj-td-strategy-multi" });
    const currentSetups = strategiesOf(t);
    const strategyItems: DropdownItem[] = this.setupOptions.map((name) => ({ id: name, label: name }));
    for (const current of currentSetups) {
      if (!strategyItems.some((item) => item.id.toLowerCase() === current.toLowerCase())) strategyItems.unshift({ id: current, label: current });
    }
    strategyItems.push({ id: "__none__", label: "No strategy" });
    strategyItems.push({ id: "__new__", label: "＋ New strategy…" });
    if (currentSetups.length > 1) stratWrap.createDiv({ cls: "tj-td-execs-note", text: `Existing assignments: ${currentSetups.join(" · ")}. Choose one strategy to resolve them; nothing is removed until you choose.` });
    const strategyDropdown = mountDropdown(stratWrap, strategyItems, currentSetups.length === 1 ? currentSetups[0] : "",
      (id) => void (async () => {
        if (id === "__new__") { await this.plugin.openSetupsForCreation(); return; }
        const choice = id === "__none__" ? "" : id;
        try {
          const file = this.app.vault.getAbstractFileByPath(t.id);
          if (!(file instanceof TFile)) throw new Error("Trade note not found.");
          this._lastLocalWriteAt = Date.now();
          await setTradeStrategy(this.app, file, choice);
          t.setup = choice; t.setups = choice ? [choice] : [];
          if (this.trade?.id === t.id) { this.trade = t; this.render(); }
        } catch { new Notice("Could not save the strategy. Existing assignments were kept."); }
      })(), { placeholder: currentSetups.length > 1 ? "Choose one strategy…" : "Choose strategy…" });
    strategyDropdown.querySelector<HTMLElement>(".tj-mg-dd-btn")!.dataset.reviewControl = "strategy";

    // ---- Rating — 5 loose stars, immediately after reflection ----
    const ratingField = reviewCard.createDiv({ cls: "tj-td-field tj-td-process-rating" });
    const ratingLbl = ratingField.createDiv({ cls: "tj-td-field-label" });
    ratingLbl.createSpan({ text: "Self-rating" });
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
    const ratingTradeId = t.id;
    for (let s = 1; s <= 5; s++) {
      const star = starsWrap.createEl("button", { cls: "tj-td-star", attr: { type: "button", "data-review-control": `rating:${s}` } });
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
        this.debounceReview("rating", () => this.saveField("rating", String(next), ratingTradeId), 400);
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
      host: HTMLElement,
      key: "psychology_tags" | "mistake_tags",
      label: string,
      tip: string,
      ack: { field: "psychologyAcknowledged" | "mistakesAcknowledged"; text: string }
    ) => {
      const mistake = key === "mistake_tags";
      const field = host.createDiv({
        cls: "tj-td-field tj-td-tags" + (mistake ? " tj-td-tags--mistakes" : ""),
      });
      const lbl = field.createDiv({ cls: "tj-td-field-label" });
      const lblText = lbl.createSpan({ text: label });
      attachTip(lblText, { title: label, sub: tip });
      const controls = field.createDiv({ cls: "tj-td-tag-controls" });
      const selectorHost = controls.createDiv({ cls: "tj-td-selector-host" });
      const ackBtn = controls.createEl("button", {
        cls: "tj-td-ack" + (mistake ? " is-mistake" : " is-psychology"),
        text: ack.text,
        attr: { type: "button", "aria-pressed": "false" },
      });
      ackBtn.dataset.reviewControl = "ack";
      ackBtn.dataset.reviewGroup = key;
      const chipsWrap = field.createDiv({ cls: "tj-td-tagchips" });

      const paintAck = () => {
        const declared = this.trade?.[ack.field] === true;
        const hasTags = (this.trade?.[key]?.length ?? 0) > 0;
        const active = declared && !hasTags;
        ackBtn.toggleClass("on", active);
        ackBtn.toggleClass("is-selected", active);
        ackBtn.disabled = false;
        ackBtn.setText(ack.text);
        ackBtn.setAttr("aria-pressed", String(active));
        ackBtn.setAttr("title", hasTags ? "Clear the selected tags and record that there was nothing to record." : "Choose this when there is nothing to record.");
      };
      paintAck();

      const write = (tags: string[], immediate = false): Promise<void> => {
        const id = this.trade?.id;
        if (!id) return Promise.resolve();
        const file = this.app.vault.getAbstractFileByPath(id);
        if (!(file instanceof TFile)) return Promise.resolve();
        const run = async () => {
          try {
            this._lastLocalWriteAt = Date.now();
            if (mistake) await setTradeMistakeTags(this.app, file, tags);
            else await updateTradeArrayFields(this.app, file, { psychology_tags: tags });
          } catch (err) {
            console.error("[tradebook] failed to save tags:", err);
            new Notice("Could not save tags — check the file still exists.");
          }
        };
        if (immediate) {
          const pending = this._saveTimers[key];
          if (pending) window.clearTimeout(pending.timer);
          delete this._saveTimers[key];
          return run();
        }
        this.debounceReview(key, run);
        return Promise.resolve();
      };

      let picker: MultiDropdown | null = null;

      ackBtn.addEventListener("click", () => void (async () => {
        const hasTags = (this.trade?.[key]?.length ?? 0) > 0;
        if (hasTags) {
          this.trade![key] = [];
          picker?.setValues([]);
          paintChips();
        }
        const next = hasTags ? true : this.trade?.[ack.field] !== true;
        this.trade![ack.field] = next;
        paintAck();
        this.refreshReviewHeader();
        if (hasTags) await write([], true);
        await this.saveAck(ack.field, next);
      })());

      /** Logging a tag contradicts a standing "none" — the acknowledgement steps aside. */
      const clearAckIfNeeded = () => {
        if (this.trade![ack.field] === true) {
          this.trade![ack.field] = false;
          void this.saveAck(ack.field, false);
          paintAck();
        }
      };

      const paintChips = () => {
        const tags = (this.trade?.[key] ?? []);
        chipsWrap.style.display = tags.length ? "" : "none";
        chipsWrap.empty();
        for (const tag of tags) {
          const chip = chipsWrap.createEl("button", {
            cls: "tj-td-tagchip" + (tags.some((v) => v.toLowerCase() === tag.toLowerCase()) ? " on" : "") + (mistake ? " is-mistake" : ""),
            text: tag,
            attr: { type: "button" },
          });
          chip.dataset.reviewControl = "tag_chip";
          chip.dataset.reviewGroup = key;
          chip.addEventListener("click", () => toggle(tag));
        }
      };

      paintChips();

      const toggle = (tag: string) => {
        const cur = (this.trade?.[key] ?? []);
        const has = cur.some((v) => v.toLowerCase() === tag.toLowerCase());
        const next = has ? cur.filter((v) => v.toLowerCase() !== tag.toLowerCase()) : [...cur, tag];
        const clean = normalizeTags(next);
        this.trade![key] = clean;
        picker?.setValues(clean);
        void write(clean);
        if (!has) clearAckIfNeeded();
        paintAck();
        paintChips();
        this.refreshReviewHeader();
      };

      const grouped = reviewTagGroups(this.plugin.settings, mistake ? "mistakes" : "psychology");
      const listed = new Set(grouped.flatMap((group) => group.tags.map((tag) => tag.toLowerCase())));
      const items: DropdownItem[] = grouped.flatMap((group) => group.tags.map((tag, index) => ({
        id: tag,
        label: tag,
        heading: index === 0 ? group.label : undefined,
      })));
      for (const tag of normalizeTags([...this.knownTags(key), ...(this.trade?.[key] ?? [])])) {
        if (!listed.has(tag.toLowerCase())) items.push({ id: tag, label: tag });
      }
      picker = mountMultiDropdown(
        selectorHost,
        items,
        this.trade?.[key] ?? [],
        (values) => {
          const clean = normalizeTags(values);
          this.trade![key] = clean;
          picker?.setValues(clean);
          void write(clean);
          if (clean.length) clearAckIfNeeded();
          paintAck();
          paintChips();
          this.refreshReviewHeader();
        },
        { placeholder: mistake ? "Add issue…" : "Add state…", summary: false },
      );
      picker.querySelector<HTMLElement>(".tj-mg-dd-btn")!.dataset.reviewControl = "tags";
      picker.querySelector<HTMLElement>(".tj-mg-dd-btn")!.dataset.reviewGroup = key;
    };
    // Market context/news stays independent from Psychology and Mistakes.
    const marketContext = reviewCard.createDiv({ cls: "tj-td-field tj-td-market-context" });
    const marketContextLabel = marketContext.createDiv({ cls: "tj-td-field-label" });
    marketContextLabel.createSpan({ text: "Market context / news" });
    marketContextLabel.createSpan({ cls: "tj-td-char-count", text: "Optional · external conditions only" });
    const marketContextGrid = marketContext.createDiv({ cls: "tj-td-two-col tj-td-two-col--equal tj-td-market-context-grid" });
    const marketPicker = (
      host: HTMLElement,
      label: string,
      items: DropdownItem[],
      key: "market_context_timing" | "market_context_effect",
      placeholder: string,
    ) => {
      const field = host.createDiv({ cls: "tj-td-field tj-td-market-picker" });
      field.createDiv({ cls: "tj-td-field-label", text: label });
      const current = Array.from(new Set((t[key] ?? []).map((value) => value.trim()).filter(Boolean)));
      const picker = mountMultiDropdown(
        field,
        items,
        current,
        (values) => void (async () => {
          const clean = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
          this.trade![key] = clean;
          const file = this.app.vault.getAbstractFileByPath(this.trade!.id);
          if (file instanceof TFile) await updateTradeArrayFields(this.app, file, { [key]: clean });
          this.refreshReviewHeader();
        })(),
        { placeholder },
      );
      picker.querySelector<HTMLElement>(".tj-mg-dd-btn")!.dataset.reviewControl = key;
    };
    marketPicker(
      marketContextGrid,
      "When was it relevant?",
      [
        { id: "event-approaching-before-entry", label: "Approaching before entry" },
        { id: "event-approaching-in-trade", label: "Approaching while in trade" },
        { id: "event-released-in-trade", label: "Released while in trade" },
        { id: "event-after-exit", label: "After exit" },
      ],
      "market_context_timing",
      "Select event timing…",
    );
    marketPicker(
      marketContextGrid,
      "What did it affect?",
      [
        { id: "no-observed-effect", label: "No observed effect" },
        { id: "volatility-or-liquidity-changed", label: "Volatility / liquidity" },
        { id: "management-changed", label: "Management" },
        { id: "exit-changed", label: "Exit" },
        { id: "impact-uncertain", label: "Impact uncertain" },
      ],
      "market_context_effect",
      "Select observed effect…",
    );

    // Pair both explicit declarations with the tags they qualify.
    const psychologyExecution = reviewCard.createDiv({ cls: "tj-td-two-col tj-td-two-col--equal tj-td-review-patterns" });
    tagSection(
      psychologyExecution,
      "psychology_tags",
      "Psychology",
      "How you felt in the trade — patient, anxious, revenge. Reused across trades for review.",
      { field: "psychologyAcknowledged", text: "No psychology state" }
    );
    tagSection(
      psychologyExecution,
      "mistake_tags",
      "Execution / Mistakes",
      "Declare a mechanical, entry, exit, sizing, or discipline issue. Nothing is inferred from results.",
      { field: "mistakesAcknowledged", text: "No execution issue" }
    );
    if ([t.review_planned_entry, t.review_planned_stop, t.review_planned_target, t.review_planned_quantity].some((value) => typeof value === "number" && Number.isFinite(value))) {
      const adherenceField = reviewCard.createDiv({ cls: "tj-td-field tj-td-plan-adherence tj-td-review-adherence" });
      const adherenceLabel = adherenceField.createDiv({ cls: "tj-td-field-label" });
      adherenceLabel.createSpan({ text: "Plan adherence" });
      adherenceLabel.createSpan({ cls: "tj-td-char-count", text: "Optional · manual plan recorded" });
      const adherenceChoices = adherenceField.createDiv({ cls: "tj-td-choice-row" });
      const choices: Array<[NonNullable<Trade["review_plan_adherence"]>, string]> = [
        ["followed", "Followed plan"],
        ["changed", "Changed plan"],
        ["not-recorded", "Not recorded"],
      ];
      const paintAdherence = () => {
        adherenceChoices.querySelectorAll<HTMLElement>("button").forEach((button) => {
          button.toggleClass("is-active", button.dataset.value === t.review_plan_adherence);
        });
      };
      for (const [value, label] of choices) {
        const button = adherenceChoices.createEl("button", {
          cls: "tj-td-choice",
          text: label,
          attr: { type: "button", "data-value": value, "data-review-control": `adherence:${value}` },
        });
        button.addEventListener("click", () => {
          t.review_plan_adherence = value;
          paintAdherence();
          void this.saveField("review_plan_adherence", value);
          this.refreshReviewHeader();
        });
      }
      paintAdherence();
    }


    if (planDifferences(t).length) {
      const diffField = reviewCard.createDiv({ cls: "tj-td-field tj-td-plan-differences tj-td-review-differences" });
      const diffLabel = diffField.createDiv({ cls: "tj-td-field-label" });
      diffLabel.createSpan({ text: "Planned vs actual differences" });
      diffLabel.createSpan({ cls: "tj-td-char-count", text: "Neutral comparison" });
      for (const diff of planDifferences(t)) {
        diffField.createDiv({ cls: "tj-td-review-difference", text: `${diff.label}: planned ${diff.planned}, actual ${diff.actual}, difference ${diff.difference}` });
      }
    }

    // Exit reason — manual declaration, never auto-classified
    {
      const exitReasonField = reviewCard.createDiv({ cls: "tj-td-field tj-td-review-exit" });
      exitReasonField.createDiv({ cls: "tj-td-field-label", text: "Why did I close?" });
      const reasonChoices: DropdownItem[] = [
        { id: "stop/invalidation reached", label: "Stop / invalidation reached" },
        { id: "target/planned objective reached", label: "Target / planned objective reached" },
        { id: "breakeven/scratch exit", label: "Breakeven / scratch exit" },
        { id: "trailing/managed stop", label: "Trailing / managed stop" },
        { id: "thesis/setup no longer valid", label: "Thesis / setup no longer valid" },
        { id: "time/session ended", label: "Time / session ended" },
        { id: "market/news context changed", label: "Market / news context changed" },
        { id: "risk/comfort changed", label: "Risk / comfort changed" },
        { id: "forced/external close", label: "Forced / external close" },
        { id: "mixed/multiple reasons", label: "Mixed / multiple reasons" },
        { id: "other", label: "Other" },
      ];
      const legacyExitLabels: Record<string, string> = {
        "planned stop": "Planned stop",
        "target hit": "Target hit",
        "early exit": "Early exit",
        "trailing stop": "Trailing stop",
        discretionary: "Discretionary",
        error: "Error",
      };
      const currentExitReason = t.exit_reason || "";
      if (currentExitReason && legacyExitLabels[currentExitReason]) {
        reasonChoices.unshift({ id: currentExitReason, label: `${legacyExitLabels[currentExitReason]} (legacy)` });
      }
      const exitReasonWrap = exitReasonField.createDiv({ cls: "tj-td-flip-strat-wrap" });
      const exitReasonDropdown = mountDropdown(
        exitReasonWrap,
        reasonChoices,
        t.exit_reason || "",
        (id) => void (async () => {
          this.trade!.exit_reason = id as Trade["exit_reason"] || undefined;
          await this.saveField("exit_reason", id || "");
          this.refreshReviewHeader();
        })(),
        { placeholder: "Select exit reason…" }
      );
      exitReasonDropdown.querySelector<HTMLElement>(".tj-mg-dd-btn")!.dataset.reviewControl = "exit_reason";
    }

    const reviewGroup = reviewCard.createDiv({ cls: "tj-td-review-prompts" });
    const coreReviewGroup = reviewGroup.createDiv({ cls: "tj-td-review-core" });
    const contextChoice = coreReviewGroup.createDiv({ cls: "tj-td-context-choice" });
    const contextLabel = contextChoice.createEl("label", { cls: "tj-td-context-label" });
    const contextInput = contextLabel.createEl("input", { attr: { type: "checkbox", "data-review-control": "context" } });
    contextInput.checked = t.review_context_unavailable === true;
    contextLabel.createSpan({ text: "Relevant context unavailable" });
    contextChoice.createSpan({
      cls: "tj-td-context-help",
      text: "Optional. Select only when relevant context was genuinely unavailable.",
    });
    contextInput.addEventListener("change", () => {
      t.review_context_unavailable = contextInput.checked;
      void this.saveField("review_context_unavailable", contextInput.checked);
      this.refreshReviewHeader();
    });
    const optionalDetails = reviewGroup.createEl("details", { cls: "tj-td-review-more" });
    optionalDetails.open = this._optionalOpen?.tradeId === t.id
      ? this._optionalOpen.open
      : false;
    optionalDetails.addEventListener("toggle", () => {
      this._optionalOpen = { tradeId: t.id, open: optionalDetails.open };
    });
    const optionalSummary = optionalDetails.createEl("summary", { cls: "tj-td-review-more-summary", attr: { "data-review-control": "optional" } });
    optionalSummary.createSpan({ text: "Optional review details" });
    optionalSummary.createSpan({ cls: "tj-td-char-count", text: "Plan · order context · post-exit · older notes" });
    const optionalReviewGroup = optionalDetails.createDiv({ cls: "tj-td-review-more-body" });

    const reviewTextField = (
      key: "review_plan" | "review_what_happened" | "review_repeat_change" | "review_post_exit_observation",
      label: string,
      placeholder: string,
      optional: boolean,
      onInput?: (value: string) => void,
    ): void => {
      const host = optional ? optionalReviewGroup : coreReviewGroup;
      const tradeId = t.id;
      const group = host.createDiv({ cls: `tj-td-field tj-td-review-field-${key}` });
      const fieldLabel = group.createDiv({ cls: "tj-td-field-label" });
      fieldLabel.createSpan({ text: label });
      if (optional) fieldLabel.createSpan({ cls: "tj-td-char-count", text: "Optional" });
      const toolbar = group.createDiv({ cls: "tj-td-markdown-toolbar", attr: { "aria-label": "Formatting" } });
      const area = group.createDiv({
        cls: "tj-td-rich-editor",
        attr: {
          contenteditable: "true",
          role: "textbox",
          "aria-multiline": "true",
          "data-review-field": key,
          "data-placeholder": placeholder,
        },
      });
      const parsedReview = new DOMParser().parseFromString(reviewMarkdownToHtml(this.trade?.[key] ?? ""), "text/html");
      area.replaceChildren(...Array.from(parsedReview.body.childNodes).map((node) => document.importNode(node, true)));
      const runCommand = (command: string, value?: string) => {
        area.focus();
        document.execCommand(command, false, value);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const shortcut = (labelText: string, title: string, command: string, value?: string) => {
        const button = toolbar.createEl("button", { cls: "tj-td-markdown-button", text: labelText, attr: { type: "button", title } });
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => runCommand(command, value));
      };
      shortcut("B", "Bold", "bold");
      shortcut("I", "Italic", "italic");
      shortcut("H", "Heading", "formatBlock", "<h2>");
      shortcut("•", "Bullet list", "insertUnorderedList");
      area.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); runCommand("bold"); }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") { event.preventDefault(); runCommand("italic"); }
      });
      area.addEventListener("input", () => {
        const val = reviewHtmlToMarkdown(area);
        this.trade![key] = val;
        onInput?.(val);
        this.debounceReview(key, async () => {
          await this.saveField(key, val, tradeId);
          this.refreshReviewHeader();
        });
      });
      area.addEventListener("blur", () => this.flushReviewSaves());
    };
    reviewTextField("review_plan", "Plan / context", "What did you intend before or during the trade?", true);
    const manualPlan = optionalReviewGroup.createDiv({ cls: "tj-td-field tj-td-manual-plan" });
    const timingLabel = manualPlan.createDiv({ cls: "tj-td-field-label" });
    timingLabel.createSpan({ text: "Plan timing" });
    timingLabel.createSpan({ cls: "tj-td-char-count", text: "Explicit or unknown" });
    const timing = manualPlan.createEl("select", { cls: "tj-td-input", attr: { "aria-label": "Plan timing", "data-review-control": "plan_timing" } });
    for (const option of [["unknown", "Timing not recorded"], ["before-entry", "Before entry"], ["during-trade", "During trade"], ["after-exit", "After exit"]] as const) {
      timing.createEl("option", { value: option[0], text: option[1] });
    }
    timing.value = t.review_plan_timing ?? "unknown";
    timing.addEventListener("change", () => {
      t.review_plan_timing = timing.value as Trade["review_plan_timing"];
      void this.saveField("review_plan_timing", timing.value);
    });
    const planInputs: Array<["review_planned_entry" | "review_planned_stop" | "review_planned_target" | "review_planned_quantity", string]> = [
      ["review_planned_entry", "Planned entry"], ["review_planned_stop", "Planned stop"], ["review_planned_target", "Planned target"], ["review_planned_quantity", "Planned quantity"],
    ];
    for (const [key, label] of planInputs) {
      const fieldLabel = manualPlan.createDiv({ cls: "tj-td-field-label" });
      fieldLabel.createSpan({ text: label });
      fieldLabel.createSpan({ cls: "tj-td-char-count", text: "Manual plan" });
      const input = manualPlan.createEl("input", { cls: "tj-td-input", attr: { type: "number", step: "any", placeholder: label, "data-review-control": key } });
      input.value = typeof t[key] === "number" ? String(t[key]) : "";
      input.addEventListener("change", () => {
        const value = input.value.trim();
        const parsed = parsePlannedNumber(value, key);
        (t as unknown as Record<string, unknown>)[key] = parsed;
        void this.saveField(key, parsed === undefined ? "" : String(parsed));
        if (value && !t.review_plan_provenance) {
          t.review_plan_provenance = "manual";
          void this.saveField("review_plan_provenance", "manual");
        }
        this.refreshReviewHeader();
      });
    }
    if (!t.recordedOrderFacts?.length && typeof t.target === "number" && Number.isFinite(t.target) && t.target > 0) {
      const recordedTarget = optionalReviewGroup.createDiv({ cls: "tj-td-field tj-td-recorded-order-context" });
      const targetLabel = recordedTarget.createDiv({ cls: "tj-td-field-label" });
      targetLabel.createSpan({ text: "Recorded target price" });
      targetLabel.createSpan({ cls: "tj-td-char-count", text: "Not an exit fill · legacy source/status unavailable" });
      const targetInput = recordedTarget.createEl("input", {
        cls: "tj-td-input",
        attr: { type: "number", step: "any", "aria-label": "Recorded target price, not an exit fill" },
      });
      targetInput.value = String(t.target);
      targetInput.addEventListener("change", () => {
        const raw = targetInput.value.trim();
        const parsed = raw ? Number(raw) : 0;
        if (raw && (!Number.isFinite(parsed) || parsed <= 0)) return;
        t.target = parsed;
        void this.saveFields({ target: String(parsed) });
      });
    }
    const recordedOrderFacts = t.recordedOrderFacts ?? [];
    if (recordedOrderFacts.length) {
      const orderContext = optionalReviewGroup.createDiv({ cls: "tj-td-field tj-td-recorded-order-context" });
      const orderContextLabel = orderContext.createDiv({ cls: "tj-td-field-label" });
      orderContextLabel.createSpan({ text: "Recorded order facts" });
      orderContextLabel.createSpan({ cls: "tj-td-char-count", text: "Order records · not execution fills" });
      const orderContextRows = orderContext.createDiv({ cls: "tj-td-order-fact-list" });
      const sourceLabel = (source: string) => source === "tradesea" ? "TradeSea export"
        : source === "orders" ? "Orders export"
          : source === "fills" ? "Fills export"
            : "Unknown export";
      for (const fact of recordedOrderFacts) {
        const parts = [
          fact.stopPrice !== undefined ? `Stop ${fmtPrice(fact.stopPrice)}` : "",
          fact.limitPrice !== undefined ? `Limit ${fmtPrice(fact.limitPrice)}` : "",
          fact.quantity !== undefined ? `Order qty ${fact.quantity}` : "",
          fact.orderType || "",
          `Status ${fact.status || "unavailable"}`,
          Number.isFinite(Date.parse(fact.recordedAt)) ? `Recorded ${fact.recordedAt}` : "Time unavailable",
          sourceLabel(fact.source),
        ].filter(Boolean);
        orderContextRows.createDiv({ cls: "tj-td-order-fact", text: parts.join(" · ") });
      }
    }
    reviewTextField("review_what_happened", "What happened", "Record one concise observation.", false);
    reviewTextField("review_repeat_change", "What would you repeat or change?", "What would you repeat or change next time?", false);
    const postExitTradeId = t.id;
    reviewTextField(
      "review_post_exit_observation",
      "Post-exit observation",
      "Optional: what happened after you were out? Keep this as an observation, not an inferred calculation.",
      true,
      (value) => {
        t.review_post_exit_source = value.trim() || typeof t.review_post_exit_points === "number" ? "manual" : undefined;
        this.debounceReview("review_post_exit_source", () => this.saveField("review_post_exit_source", t.review_post_exit_source ?? "", postExitTradeId), 400);
      },
    );

    const postExitPoints = optionalReviewGroup.createDiv({ cls: "tj-td-field tj-td-future-observation" });
    const postExitLabel = postExitPoints.createDiv({ cls: "tj-td-field-label" });
    postExitLabel.createSpan({ text: "Known post-exit points" });
    postExitLabel.createSpan({ cls: "tj-td-char-count", text: "Manual only · optional" });
    const postExitInput = postExitPoints.createEl("input", {
      cls: "tj-td-input",
      attr: { type: "number", step: "0.01", placeholder: "Only enter a known/manual observation" },
    });
    postExitInput.value = typeof t.review_post_exit_points === "number" ? String(t.review_post_exit_points) : "";
    postExitInput.addEventListener("change", () => {
      const value = postExitInput.value.trim();
      t.review_post_exit_points = value === "" ? undefined : Number(value);
      t.review_post_exit_source = value === "" ? undefined : "manual";
      void this.saveField("review_post_exit_points", value);
      void this.saveField("review_post_exit_source", t.review_post_exit_source ?? "");
    });

    // Preserve legacy free-form content as read-only compatibility text; the two
    // core prompts remain the only editable reflection fields and completion gate.
    const legacyReviewFields = [
      ["Legacy notes", t.notes],
      ["Legacy review", t.review],
      ["Legacy thesis", t.thesis],
      ["Legacy mistake", t.mistake],
    ].filter(([, value]) => String(value ?? "").trim());
    if (legacyReviewFields.length) {
      const legacy = optionalReviewGroup.createDiv({ cls: "tj-td-legacy-review" });
      legacy.createDiv({ cls: "tj-td-field-label", text: "Older saved review text" });
      for (const [label, value] of legacyReviewFields) {
        const item = legacy.createDiv({ cls: "tj-td-legacy-review-item" });
        item.createDiv({ cls: "tj-td-legacy-review-label", text: label });
        item.createDiv({ cls: "tj-td-legacy-review-value", text: String(value).trim() });
      }
    }

    // ================================================================
    // RIGHT COLUMN — Screenshots & visual analysis + Executions
    // ================================================================
    const rightCol = cols.createDiv({ cls: "tj-td-right" });

    // Resolve a display-only fallback for legacy scalar references; rendering never migrates note data.
    const prints = this.resolveScreenshotEntries(t);
    if (this._activePrint < 0 || this._activePrint >= prints.length) this._activePrint = 0;
    // ---- Screenshot card ----
    const shotCard = rightCol.createDiv({ cls: "tj-td-panel tj-td-shot-card" });
    const dzHeader = shotCard.createDiv({ cls: "tj-td-panel-head tj-td-shot-head" });
    dzHeader.createDiv({
      cls: "tj-td-panel-title",
      text: "Visual analysis",
    });
    const dzActions = dzHeader.createDiv({ cls: "tj-td-dropzone-actions" });

    // The element that accepts a new print (add tile, or the empty dropzone).
    let addTarget: HTMLElement;

    // Show the prints — one large preview plus a thumbnail strip to switch.
    if (prints.length > 0) {
      const active = prints[this._activePrint]?.entry;
      const activeFile = this.resolveImageFile(active.file);
      if (activeFile) {
        const annotateBtn = dzActions.createEl("button", {
          cls: "tj-btn tj-mini tj-td-media-action", text: "Mark up", attr: { type: "button", "aria-label": "Mark up selected screenshot" },
        });
        annotateBtn.addEventListener("click", () => this.annotate(activeFile));
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
        const syncStageRatio = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            mainWrap.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
          }
        };
        img.addEventListener("load", syncStageRatio);
        syncStageRatio();
        img.addEventListener("error", () => { img.setCssStyles({ opacity: "0.2" }); });
        if (activeFile) {
          img.addEventListener("click", () => this.openPrintLarge(activeFile));
        }
      } else {
        mainWrap.createDiv({ cls: "tj-hint", text: `Print not found: ${active.file}` });
      }

      const thumbs = carousel.createDiv({ cls: "tj-td-shot-thumbs" });
      prints.forEach(({ entry: p, sourceIndex }, i) => {
        const thumb = thumbs.createDiv({
          cls: "tj-td-shot-thumb" + (i === this._activePrint ? " is-active" : ""),
          attr: { draggable: "true" },
        });
        const showButton = thumb.createEl("button", {
          cls: "tj-td-shot-show",
          attr: { type: "button", "aria-pressed": i === this._activePrint ? "true" : "false" },
        });
        showButton.createSpan({ cls: "tj-sr-only", text: `Show print ${i + 1}` });
        const tr = this.resolveImage(p.file);
        if (tr) showButton.createEl("img", { attr: { src: tr, alt: "" } });
        else showButton.createDiv({ cls: "tj-td-shot-thumb-missing", text: "?" });
        showButton.createSpan({ cls: "tj-td-shot-thumb-label", text: `Print ${i + 1}` });
        const x = thumb.createEl("button", { cls: "tj-td-shot-remove", attr: { type: "button", "aria-label": `Remove print ${i + 1}` } });
        x.createSpan({ cls: "tj-sr-only", text: `Remove print ${i + 1}` });
        x.createSpan({ cls: "tj-td-shot-remove-icon", text: "×" });
        x.addEventListener("click", (ev) => void (async () => {
          ev.stopPropagation();
          if (sourceIndex >= 0) await this.removeScreenshot(sourceIndex);
        })());
        thumb.addEventListener("dragstart", (ev) => {
          if (sourceIndex < 0) { ev.preventDefault(); return; }
          ev.stopPropagation();
          ev.dataTransfer?.setData("application/x-tradebook-screenshot-index", String(sourceIndex));
          ev.dataTransfer?.setData("text/plain", `tradebook-screenshot:${sourceIndex}`);
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
          thumb.addClass("is-dragging");
        });
        thumb.addEventListener("dragend", () => {
          thumb.removeClass("is-dragging");
          thumbs.querySelectorAll(".is-drop-target").forEach((target) => target.removeClass("is-drop-target"));
        });
        thumb.addEventListener("dragenter", (ev) => {
          const types = ev.dataTransfer?.types ?? [];
          if (!Array.from(types).includes("application/x-tradebook-screenshot-index") && !Array.from(types).includes("text/plain")) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
          thumb.addClass("is-drop-target");
        });
        thumb.addEventListener("dragover", (ev) => {
          const types = ev.dataTransfer?.types ?? [];
          if (!Array.from(types).includes("application/x-tradebook-screenshot-index") && !Array.from(types).includes("text/plain")) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
          thumb.addClass("is-drop-target");
        });
        thumb.addEventListener("dragleave", () => thumb.removeClass("is-drop-target"));
        thumb.addEventListener("drop", (ev) => void (async () => {
          const dt = ev.dataTransfer;
          thumb.removeClass("is-drop-target");
          if (!dt || (!Array.from(dt.types).includes("application/x-tradebook-screenshot-index") && !Array.from(dt.types).includes("text/plain")) || dt.files.length) return;
          ev.preventDefault();
          ev.stopPropagation();
          const raw = dt.getData("application/x-tradebook-screenshot-index") || (dt.getData("text/plain").match(/^tradebook-screenshot:(\d+)$/)?.[1] ?? "");
          if (!/^(0|[1-9]\d*)$/.test(raw)) return;
          const from = Number(raw);
          if (this.trade?.id !== t.id) return;
          const resolved = this.resolveScreenshotEntries(t);
          const length = resolved.reduce((end, shot) => Math.max(end, shot.sourceIndex + 1), t.screenshots?.length ?? 0);
          const validOrigin = resolved.some((shot) => shot.sourceIndex === from);
          const validTarget = resolved.some((shot) => shot.sourceIndex === sourceIndex);
          if (Number.isSafeInteger(from) && validOrigin && validTarget && from !== sourceIndex) {
            const rect = thumb.getBoundingClientRect();
            const after = ev.clientX >= rect.left + rect.width / 2;
            const insertion = sourceIndex + (after ? 1 : 0);
            const to = Math.max(0, Math.min(length - 1, insertion - (from < insertion ? 1 : 0)));
            await this.reorderScreenshots(from, to);
          }
        })());
        showButton.addEventListener("click", () => {
          if (i === this._activePrint) return;
          this._activePrint = i;
          this.render();
        });
        attachTip(showButton, { title: `Print ${i + 1}`, sub: "Show this screenshot." });
      });

      // The add tile closes the strip — same square shape, dashed, never a bar.
      const addTile = thumbs.createDiv({ cls: "tj-td-shot-add", attr: { role: "button", tabindex: "0" } });
      addTile.createSpan({ cls: "tj-sr-only", text: "Add screenshot" });
      const addPlus = addTile.createDiv({ cls: "tj-td-shot-add-plus" });
      setIcon(addPlus, "plus");
      addTile.createSpan({ cls: "tj-td-shot-add-label", text: "Add Print" });
      attachTip(addTile, { title: "Add print", sub: "Drop an image, click to browse, or Ctrl+V." });
      addTarget = addTile;
    } else {
      // Empty state: the whole card is the drop target.
      const addDropzone = shotCard.createDiv({ cls: "tj-td-dropzone", attr: { role: "button", "aria-label": "Add screenshot" } });
      const iconDiv = addDropzone.createDiv({ cls: "tj-td-dropzone-icon" });
      setIcon(iconDiv, "image");
      const textDiv = addDropzone.createDiv({ cls: "tj-td-dropzone-text" });
      textDiv.createEl("strong", { text: "Drop screenshot here" });
      textDiv.createSpan({ text: "PNG, JPG, or WebP" });
      const hint = addDropzone.createDiv({ cls: "tj-td-dropzone-hint" });
      hint.createSpan({ text: "or" });
      hint.createEl("kbd", { text: "Ctrl" });
      hint.createSpan({ text: "+" });
      hint.createEl("kbd", { text: "V" });
      hint.createSpan({ text: "to paste" });
      addTarget = addDropzone;
    }

    // Hidden file input + wiring, on whichever element accepts the print.
    const fileInput = addTarget.createEl("input", {
      attr: { type: "file", accept: "image/png,image/jpeg,image/webp" },
    });
    fileInput.setCssStyles({ display: "none" });

    addTarget.setAttr("tabindex", "0");
    addTarget.addEventListener("keydown", (e) => {
      if (e.target !== addTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      fileInput.click();
    });
    addTarget.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      fileInput.click();
    });
    fileInput.addEventListener("change", () => void (async () => {
      if (fileInput.files && fileInput.files[0]) {
        await this.handleScreenshotFile(fileInput.files[0]);
        fileInput.value = "";
      }
    })());

    // Drag & drop — accept only the supported image/group payloads so unrelated
    // drags retain their normal destination behavior.
    const isAcceptedDrop = (dt: DataTransfer | null) => !!dt &&
      (Array.from(dt.types).includes(PRINT_GROUP_MIME) || dt.files.length > 0);
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    addTarget.addEventListener("dragenter", (e) => {
      if (!isAcceptedDrop((e as DragEvent).dataTransfer)) return;
      stop(e); addTarget.addClass("over");
    });
    addTarget.addEventListener("dragover", (e) => {
      if (!isAcceptedDrop((e as DragEvent).dataTransfer)) return;
      stop(e); addTarget.addClass("over");
    });
    addTarget.addEventListener("dragleave", () => { addTarget.removeClass("over"); });
    addTarget.addEventListener("drop", (e) => void (async () => {
      const dt = (e as DragEvent).dataTransfer;
      if (!isAcceptedDrop(dt)) return;
      stop(e);
      addTarget.removeClass("over");
      if (!dt) return;
      // A Print Group drag carries the private MIME; an image drop carries
      // files. The private MIME wins so a group dropped over the dropzone is
      // filed, not treated as a missing image.
      const groupRaw = dt.getData(PRINT_GROUP_MIME);
      if (groupRaw) {
        await this.handlePrintGroupDrop(groupRaw);
        return;
      }
      const file = dt.files?.[0];
      if (file) await this.handleScreenshotFile(file);
    })());

    // Ctrl+V paste (when hovered or focused)
    let hovered = false;
    addTarget.setAttr("tabindex", "0");
    addTarget.addEventListener("mouseenter", () => { hovered = true; });
    addTarget.addEventListener("mouseleave", () => { hovered = false; });
    addTarget.addEventListener("focus", () => { hovered = true; });
    addTarget.addEventListener("blur", () => { hovered = false; });
    const onPasteAsync = async (e: ClipboardEvent) => {
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
    // One document listener at a time: a re-render clears the previous one, so
    // they cannot pile up on the document as the reader moves between trades.
    this._pasteCleanups.forEach((fn) => fn());
    const onPaste = (e: ClipboardEvent) => void onPasteAsync(e);
    this._pasteCleanups = [() => document.removeEventListener("paste", onPaste, true)];
    document.addEventListener("paste", onPaste, true);

    // ---- Accounts block (copied trades) ----
    // ---- Executions (bottom — detailed, read-only) ----
    this.renderExecutions(body, t);

    for (const editorState of editorStates) {
      const nextEditor = Array.from(root.querySelectorAll<HTMLTextAreaElement>(".tj-td-textarea"))
        .find((area) => area.getAttribute("data-review-field") === editorState.key);
      if (!nextEditor) continue;
      nextEditor.value = editorState.value;
      nextEditor.setSelectionRange(editorState.selectionStart, editorState.selectionEnd);
      nextEditor.scrollTop = editorState.scrollTop;
      nextEditor.scrollLeft = editorState.scrollLeft;
      if (editorState.active) nextEditor.focus({ preventScroll: true });
    }
    // Retained focus for the non-textarea review controls. The captured control
    // may have been rebuilt or removed for another trade, so only restore when
    // the element still exists in this render. No values are replayed.
    if (retainedFocus?.key) {
      const restored = Array.from(root.querySelectorAll<HTMLElement>("[data-review-control]"))
        .find((el) => el.dataset.reviewControl === retainedFocus.key && (retainedFocus.group === null || el.dataset.reviewGroup === retainedFocus.group));
      const isFocusableControl = (el: HTMLElement) => {
        const tag = el.tagName.toLowerCase();
        const naturallyFocusable = tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary";
        return naturallyFocusable && el.isConnected && !("disabled" in el && (el as HTMLButtonElement).disabled);
      };
      if (restored && isFocusableControl(restored)) {
        try { restored.focus({ preventScroll: true }); } catch { /* The host may be tearing down this view. */ }
      }
    }
    const restoreViewport = () => {
      // An earlier render's animation-frame callbacks must not move a newer view.
      if (!preservedScroll || !scrollHost || !main.isConnected) return;
      for (const region of preservedRegions) {
        const element = region.selector ? root.querySelector<HTMLElement>(region.selector) : region.element;
        if (element?.isConnected) {
          element.scrollTop = region.top;
          element.scrollLeft = region.left;
        }
      }
      scrollHost.scrollTop = preservedScroll.top;
      scrollHost.scrollLeft = preservedScroll.left;
    };
    restoreViewport();
    if (preservedScroll && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        restoreViewport();
        window.requestAnimationFrame(restoreViewport);
      });
    }
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
    // Same word as the Trade Log chip, so the two surfaces read as one idea.
    btn.createSpan({ text: `${records.length} accounts` });
    attachTip(btn, {
      title: `This trade in ${records.length} accounts`,
      sub: "Money is what it made in each account; the ledger counts the decision once.",
    });

    const pop = host.createDiv({ cls: "tj-td-accpop" });
    pop.setCssStyles({ display: "none" });
    pop.createDiv({ cls: "tj-td-accpop-t", text: "Linked accounts" });

    const table = pop.createDiv({ cls: "tj-td-acctable" });
    const head2 = table.createDiv({ cls: "tj-td-acctable-row is-head" });
    for (const label of ["Account", "Qty", "Avg Entry", "P&L"]) head2.createSpan({ text: label });
    for (const r of records) {
      const row = table.createDiv({ cls: "tj-td-acctable-row" });
      const name = row.createSpan({ cls: "tj-td-acctable-name" });
      name.createSpan({ text: this.plugin.displayAccount(r.account) || "—" });
      // Original → copies, with each leg's frozen ratio, exactly as the ledger
      // shows it. The figures below are the detail this page can afford.
      if (!r.isCopiedTrade) {
        name.createSpan({ cls: "tj-td-acctag", text: "Original" });
      } else {
        name.createSpan({ cls: "tj-td-acctag", text: "Copied" });
        if (Number.isFinite(r.copyMultiplier)) {
          name.createSpan({ cls: "tj-td-accratio", text: `×${r.copyMultiplier}` });
        }
      }
      const set = fillSet(r);
      row.createSpan({ cls: "tj-td-acctable-num", text: String(r.quantity ?? set.entryQty ?? "—") });
      row.createSpan({ cls: "tj-td-acctable-num", text: fmtPrice(set.avgEntry || r.entryPrice) });
      row.createSpan({
        cls: "tj-td-acctable-num " + toneClass(r.pnl),
        text: r.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney(r.pnl),
      });
    }
    pop.createDiv({ cls: "tj-td-execs-note" })
      .setText("One decision, separate account results.");

    const close = () => { pop.setCssStyles({ display: "none" }); document.removeEventListener("mousedown", onDoc); };
    const onDoc = (e: MouseEvent) => { if (!host.contains(e.target as Node)) close(); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = pop.style.display !== "none";
      if (open) { close(); return; }
      pop.setCssStyles({ display: "" });
      document.addEventListener("mousedown", onDoc);
    });
  }

  // ---- Executions ----
  private renderExecutions(host: HTMLElement, t: Trade): void {
    const set: FillSet = fillSet(t);
    const box = host.createDiv({ cls: "tj-td-panel tj-td-execs" });
    const head = box.createDiv({ cls: "tj-td-panel-head tj-td-execs-head" });
    head.createDiv({ cls: "tj-td-panel-title", text: "Executions" });
    head.createSpan({
      cls: "tj-td-execs-count",
      text: set.isMulti
        ? `${set.entries.length} in · ${set.exits.length} out`
        : "single fill",
    });

    const fillCosts = set.fills.reduce((s, f) => s + (f.fees || 0), 0);

    const table = box.createEl("table", { cls: "tj-td-execs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const col of [
      { label: "Time", align: "" }, { label: "Side", align: "" },
      { label: "Qty", align: "r" }, { label: "Price", align: "r" },
      { label: "Points/contract", align: "r" }, { label: "P&L", align: "r" },
      { label: "Fees", align: "r" }, { label: "Fill", align: "" },
    ]) {
      headRow.createEl("th", { cls: col.align, text: col.label });
    }

    const pointValue = knownFuturesSpec(t.symbol)?.pointValue ?? 0;
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
      // Exit points use that fill's matched-lot gross P&L, divided by its own
      // contracts and point value. This keeps scale-ins and break-even exits
      // from being replaced by a best-price estimate or an averaged entry.
      const points = be
        ? 0
        : isExit && Number.isFinite(f.pnl) && pointValue > 0 && f.qty > 0
        ? (f.pnl as number) / (pointValue * f.qty)
        : !set.explicit && isExit && set.avgEntry > 0
        ? t.direction === "long" ? f.price - set.avgEntry : set.avgEntry - f.price
        : NaN;
      row.createEl("td", { cls: "r", text: Number.isFinite(points) ? `${points >= 0 ? "+" : ""}${points.toFixed(2)}` : "—" });
      const pnlCell = row.createEl("td", { cls: "r tj-tbl-pnl" });
      if (!Number.isFinite(f.pnl)) pnlCell.setText("—");
      else { pnlCell.addClass(toneClass(f.pnl)); pnlCell.setText(f.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney2(f.pnl as number)); }
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
    const totalPts = Number.isFinite(t.pnlPoints) ? (t.pnlPoints) : NaN;
    totals.createEl("td", {
      cls: "r",
      text: Number.isFinite(totalPts) ? `${totalPts >= 0 ? "+" : ""}${totalPts.toFixed(2)}` : "—",
    });
    const totalPnlCell = totals.createEl("td", { cls: "r tj-tbl-pnl" });
    if (Number.isFinite(t.pnl)) {
      totalPnlCell.addClass(toneClass(t.pnl));
      totalPnlCell.setText(t.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney2(t.pnl));
    } else {
      totalPnlCell.setText("—");
    }
    totals.createEl("td", { cls: "r", text: `$${((t.commission || 0) + (t.fees || 0)).toFixed(2)}` });
    totals.createEl("td", { cls: "tj-td-execs-tag" });

    if (set.explicit && Math.abs(fillCosts - ((t.commission || 0) + (t.fees || 0))) > 0.005) {
      box.createDiv({ cls: "tj-td-execs-note", text: "The total shows recorded trade costs. Costs are not fully allocated to individual fills; no split has been inferred." });
    }
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

  /** Re-paint the automatic review state after a structured field edit. */
  private refreshReviewHeader(): void {
    const t = this.trade;
    if (!t) return;
    const status = reviewStatus(t);
    const root = this.contentEl;

    const checks = new Map(status.checks.map((check) => [check.key, check]));
    root.querySelectorAll<HTMLElement>(".tj-td-review-dot").forEach((dot) => {
      const check = checks.get(dot.dataset.reviewKey as ReviewCheckKey);
      if (!check) return;
      dot.toggleClass("done", check.done);
      dot.toggleClass("is-core", check.required);
    });
    const badge = root.querySelector<HTMLElement>(".tj-td-hero-badge.is-status");
    if (badge) {
      const states: ReviewState[] = ["needs-review", "reviewed", "reviewed-with-missing-context", "legacy-marked-reviewed", "reopened"];
      for (const state of states) badge.toggleClass(`is-${state}`, status.state === state);
      badge.setText(status.label);
      badge.setAttr("aria-label", status.label);
      badge.setAttr("title", reviewStateHint(status.state));
    }

  }

  // ---- Save ----
  async saveField(key: "setup" | "review" | "mistake" | "thesis" | "notes" | "review_plan" | "review_planned_entry" | "review_planned_stop" | "review_planned_target" | "review_planned_quantity" | "review_plan_timing" | "review_plan_provenance" | "review_plan_adherence" | "review_what_happened" | "review_repeat_change" | "review_post_exit_observation" | "review_post_exit_points" | "review_post_exit_source" | "review_evidence_source" | "review_context_unavailable" | "rating" | "reviewed" | "orderType" | "direction" | "exit_reason", value: string | number | boolean, targetId = this.trade?.id): Promise<void> {
    try {
      if (targetId) {
        const f = this.app.vault.getAbstractFileByPath(targetId);
        if (f instanceof TFile) {
          this._lastLocalWriteAt = Date.now();
          await updateTradeFields(this.app, f, { [key]: value });
        }
      }
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
  async saveScreenshotsNow(t: Trade | null = this.trade): Promise<boolean> {
    if (!t?.id) return false;
    const file = this.app.vault.getAbstractFileByPath(t.id);
    if (!(file instanceof TFile)) return false;
    const shots = t.screenshots ?? [];
    try {
      this._lastLocalWriteAt = Date.now();
      await updateTradeScreenshots(this.app, file, shots);
      if (this.trade?.id === t.id) t.screenshot = shots.find(isScreenshotEntry)?.file ?? "";
      return true;
    } catch (err) {
      console.error("[tradebook] failed to save screenshots:", err);
      if (this.trade?.id === t.id) new Notice("Could not save screenshots — check the file still exists.");
      return false;
    }
  }

  /** Resolve valid structured entries, or legacy scalar references, without mutating the trade. */
  private resolveScreenshotEntries(t: Trade): Array<{ entry: NonNullable<Trade['screenshots']>[number]; sourceIndex: number }> {
    const shots = t.screenshots ?? [];
    const resolved = shots.map((entry, sourceIndex) => ({ entry, sourceIndex }))
      .filter(({ entry }) => isScreenshotEntry(entry));
    if (resolved.length) return resolved;
    const legacy = (t.screenshot || "").trim();
    if (!legacy || legacy.toLowerCase() === "added") return [];
    return legacy.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean)
      .map((file, offset) => ({ entry: { file }, sourceIndex: shots.length + offset }));
  }

  /** Materialize only the valid legacy fallback, after an explicit screenshot edit. */
  private materializeScreenshotEntries(t: Trade): NonNullable<Trade['screenshots']> {
    const shots = t.screenshots ?? [];
    const resolved = this.resolveScreenshotEntries(t);
    if (resolved.length && resolved[0].sourceIndex >= shots.length) {
      const legacy = resolved.map(({ entry }) => ({ ...entry }));
      t.screenshots = [...shots, ...legacy];
      return t.screenshots;
    }
    if (!t.screenshots) t.screenshots = [];
    return t.screenshots;
  }

  /** Save a dropped/pasted/selected image to the vault and link it to the trade. */
  async handleScreenshotFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      new Notice("That's not an image — drop a screenshot (PNG/JPG/webp).");
      return;
    }
    const t = this.trade;
    if (!t?.id) return;
    const tradeId = t.id;
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const dir = this.plugin.getAttachmentsFolder(t.date);
    await this.plugin.ensureVaultFolder(dir);
    if (this.trade?.id !== tradeId) return;
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
    if (this.trade?.id !== tradeId) return;
    await this.plugin.app.vault.createBinary(finalPath, buffer);
    if (this.trade?.id !== tradeId) return;
    const linkName = finalPath.split("/").pop() as string;

    const shots = this.materializeScreenshotEntries(t);
    shots.push({ file: linkName });
    this._activePrint = this.resolveScreenshotEntries(t).length - 1;

    const saved = await this.saveScreenshotsNow(t);
    if (this.trade?.id !== tradeId || !saved) return;
    new Notice(`Screenshot saved: ${linkName}`);
    this.render();
  }

  /** Reorder screenshots inside Trade Detail without touching Print Queue history. */
  async reorderScreenshots(from: number, to: number): Promise<void> {
    const t = this.trade;
    if (!t?.id) return;
    const tradeId = t.id;
    const entries = this.resolveScreenshotEntries(t);
    const rawLength = (t.screenshots ?? []).length + (entries.length && entries[0].sourceIndex >= (t.screenshots ?? []).length ? entries.length : 0);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < 0 || from >= rawLength || to >= rawLength || from === to) return;
    if (!entries.some(({ sourceIndex }) => sourceIndex === from)) return;
    const shots = this.materializeScreenshotEntries(t);
    if (!isScreenshotEntry(shots[from])) return;
    const visibleBefore = shots.filter((shot) => isScreenshotEntry(shot));
    const activeEntry = visibleBefore[this._activePrint];
    const [moved] = shots.splice(from, 1);
    shots.splice(to, 0, moved);
    const visibleAfter = shots.filter((shot) => isScreenshotEntry(shot));
    const activeAfter = activeEntry ? visibleAfter.indexOf(activeEntry) : -1;
    if (activeAfter >= 0) this._activePrint = activeAfter;
    if (!await this.saveScreenshotsNow(t) || this.trade?.id !== tradeId) return;
    this.render();
    this.contentEl.querySelector<HTMLElement>(".tj-td-shot-thumb.is-active .tj-td-shot-show")?.focus({ preventScroll: true });
  }

  /** Remove a screenshot by index from the screenshots array. */
  async removeScreenshot(index: number): Promise<void> {
    const t = this.trade;
    if (!t?.id) return;
    const tradeId = t.id;
    const entries = this.resolveScreenshotEntries(t);
    const rawLength = (t.screenshots ?? []).length + (entries.length && entries[0].sourceIndex >= (t.screenshots ?? []).length ? entries.length : 0);
    if (!Number.isSafeInteger(index) || index < 0 || index >= rawLength) return;
    if (!entries.some(({ sourceIndex }) => sourceIndex === index)) return;
    const shots = this.materializeScreenshotEntries(t);
    if (!isScreenshotEntry(shots[index])) return;
    const activeEntry = shots.filter((shot) => isScreenshotEntry(shot))[this._activePrint];
    shots.splice(index, 1);
    t.screenshots = shots;
    const visibleAfter = shots.filter((shot) => isScreenshotEntry(shot));
    const retainedActive = activeEntry ? visibleAfter.indexOf(activeEntry) : -1;
    this._activePrint = retainedActive >= 0 ? retainedActive : Math.min(this._activePrint, Math.max(0, visibleAfter.length - 1));

    if (!await this.saveScreenshotsNow(t) || this.trade?.id !== tradeId) return;
    new Notice("Screenshot removed.");
    this.render();
    this.contentEl.querySelector<HTMLElement>(".tj-td-shot-thumb.is-active .tj-td-shot-show")?.focus({ preventScroll: true });
  }

  /**
   * Phase E: the single attach seam. Both the Print Group drop and the
   * secondary attach action route through here, so filing behaviour can never
   * drift between the two entry points.
   */
  async attachPrintGroup(groupId: string): Promise<AttachGroupOutcome> {
    const t = this.trade;
    if (!t?.id) return { ok: false, error: "No trade selected", rolledBack: false };
    const outcome = await attachGroupToTrade(this.app, t, t.id, groupId, "", this.plugin.getTradesFolder());
    if (outcome.ok) {
      const notice = outcome.idempotent
        ? "Print group already attached."
        : outcome.screenshotCount === 0
          ? "Print group attached; its screenshots were already on this trade."
          : `Attached ${outcome.screenshotCount} print${outcome.screenshotCount === 1 ? "" : "s"}.`;
      new Notice(notice);
      this.render();
    } else {
      new Notice(outcome.error || "Could not attach the print group.");
    }
    return outcome;
  }

  /**
   * Phase E: handle a Print Group drag payload dropped onto the screenshot
   * area. The payload is private and carries the group id only; the trade link
   * and the group are validated before anything is written.
   */
  private async handlePrintGroupDrop(raw: string): Promise<void> {
    const payload = parsePrintGroupDragPayload(raw);
    if (!payload) {
      new Notice("That is not a print group.");
      return;
    }
    await this.attachPrintGroup(payload.groupId);
  }

  /**
   * Phase E: secondary attach action. Lists every pending group; picking one
   * files it into this trade through the same seam as a drop.
   */
  private async openAttachPicker(anchor: HTMLElement): Promise<void> {
    const doc = this.contentEl.ownerDocument;
    const win = doc.defaultView ?? window;
    const t = this.trade;
    if (!t?.id) return;

    let groups: PrintGroup[] = [];
    try {
      groups = await listPendingAttachGroups(this.plugin.app, "");
    } catch {
      groups = [];
    }
    if (!groups.length) {
      new Notice("No pending print groups to attach.");
      return;
    }

    const pop = doc.body.createDiv({ cls: "tj-td-tagpop" });
    pop.createDiv({ cls: "tj-td-tagpop-t", text: "Attach a print group" });

    const list = pop.createDiv({ cls: "tj-td-tagpop-list" });
    for (const g of groups) {
      const row = list.createDiv({ cls: "tj-td-tagpop-row" });
      row.createSpan({ cls: "tj-td-tagpop-lbl", text: g.name });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
        void this.attachPrintGroup(g.id);
      });
    }

    const done = pop.createEl("button", { cls: "tj-td-tagpop-done", text: "Done", attr: { type: "button" } });
    done.addEventListener("click", (e) => { e.stopPropagation(); close(); });

    const close = () => {
      pop.remove();
      doc.removeEventListener("mousedown", onDoc, true);
      doc.removeEventListener("keydown", onKey, true);
      win.removeEventListener("resize", place);
      win.removeEventListener("scroll", place, true);
    };
    const onDoc = (e: MouseEvent) => {
      if (pop.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    doc.addEventListener("mousedown", onDoc, true);
    doc.addEventListener("keydown", onKey, true);

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = pop.offsetWidth || 240;
      const h = pop.offsetHeight || 120;
      let left = r.left;
      let top = r.bottom + 6;
      if (left + w > win.innerWidth - 8) left = win.innerWidth - 8 - w;
      if (left < 8) left = 8;
      if (top + h > win.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h;
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    };
    place();
    win.addEventListener("resize", place);
    win.addEventListener("scroll", place, true);
  }

  /** Save multiple fields at once to the trade note. */
  async saveFields(fields: Record<string, string>): Promise<void> {
    try {
      if (this.trade?.id) {
        const f = this.app.vault.getAbstractFileByPath(this.trade.id);
        if (f instanceof TFile) {
          this._lastLocalWriteAt = Date.now();
          await updateTradeFields(this.app, f, fields);
          return;
        }
      }
      throw new Error("Trade note not found.");
    } catch (err) {
      console.error("[tradebook] failed to save trade fields:", err);
      new Notice("Could not save — check the file still exists.");
      throw err;
    }
  }

  /** Persist an optional-step acknowledgement as a bare YAML boolean. */
  async saveAck(key: "mistakesAcknowledged" | "psychologyAcknowledged", value: boolean): Promise<void> {
    const yamlKey = key === "mistakesAcknowledged" ? "mistakes_acknowledged" : "psychology_acknowledged";
    try {
      if (this.trade?.id) {
        const f = this.app.vault.getAbstractFileByPath(this.trade.id);
        if (f instanceof TFile) {
          this._lastLocalWriteAt = Date.now();
          await updateTradeFields(this.app, f, { [yamlKey]: value });
        }
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
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  private annotator: PrintAnnotator | null = null;

  annotate(file: TFile): void {
    if (!this.annotator) this.annotator = new PrintAnnotator(this.plugin);
    this.annotator.open(file, (annotatedName) => void this.pointPrintAt(file, annotatedName));
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
    const file = this.resolveImageFile(link);
    if (!file) return null;
    const extension = (file.extension || "").toLowerCase();
    if (!["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return null;
    try { return this.app.vault.getResourcePath(file); } catch { return null; }
  }

  // ---- Export Trade Card as PNG ----
  showExportPanel(): void {
    const t = this.trade;
    if (!t) return;

    // Options state
    const printEntries = this.resolveScreenshotEntries(t);
    const opts: ExportOptions = { orientation: "vertical", theme: "dark", screenshot: true, stats: true, rating: true, notes: false, repeatChange: false, exitReason: false, psychology: true, hidePnl: false, primaryPrint: 0 };

    // Overlay
    const overlay = document.body.createDiv({ cls: "tj-overlay" });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    const panel = overlay.createDiv({ cls: "tj-export-panel" });
    panel.addEventListener("click", (e) => e.stopPropagation());

    const header = panel.createDiv({ cls: "tj-export-header" });
    header.createDiv({ cls: "tj-export-title", text: "Export Trade Card" });
    const appearance = header.createDiv({ cls: "tj-export-config" });
    const orientationRow = appearance.createDiv({ cls: "tj-export-preset-row", attr: { role: "group", "aria-label": "Orientation" } });
    orientationRow.createSpan({ cls: "tj-export-control-label", text: "Orientation" });
    const verticalPreset = orientationRow.createEl("button", { cls: "tj-wz-seg-opt tj-export-preset is-active", text: "Vertical", attr: { type: "button", "aria-pressed": "true" } });
    const horizontalPreset = orientationRow.createEl("button", { cls: "tj-wz-seg-opt tj-export-preset", text: "Horizontal", attr: { type: "button", "aria-pressed": "false" } });
    const themeRow = appearance.createDiv({ cls: "tj-export-preset-row", attr: { role: "group", "aria-label": "Theme" } });
    themeRow.createSpan({ cls: "tj-export-control-label", text: "Theme" });
    const darkTheme = themeRow.createEl("button", { cls: "tj-wz-seg-opt tj-export-preset is-active", text: "Dark", attr: { type: "button", "aria-pressed": "true" } });
    const lightTheme = themeRow.createEl("button", { cls: "tj-wz-seg-opt tj-export-preset", text: "Light", attr: { type: "button", "aria-pressed": "false" } });
    const setTheme = (theme: ExportTheme): void => {
      opts.theme = theme;
      darkTheme.toggleClass("is-active", theme === "dark"); lightTheme.toggleClass("is-active", theme === "light");
      darkTheme.setAttribute("aria-pressed", String(theme === "dark")); lightTheme.setAttribute("aria-pressed", String(theme === "light"));
      schedulePreview();
    };
    darkTheme.addEventListener("click", () => setTheme("dark"));
    lightTheme.addEventListener("click", () => setTheme("light"));

    const body = panel.createDiv({ cls: "tj-export-body" });
    const leftCol = body.createDiv({ cls: "tj-export-left" });
    const rightCol = body.createDiv({ cls: "tj-export-right" });

    const printSection = leftCol.createDiv({ cls: "tj-export-print-section", attr: { role: "radiogroup", "aria-label": "Main screenshot" } });
    printSection.createDiv({ cls: "tj-export-section-title", text: "Main screenshot" });
    printSection.createDiv({ cls: "tj-export-print-help", text: printEntries.length ? "Choose one print." : "No screenshots." });
    const printRows: Array<{ index: number; row: HTMLButtonElement }> = [];
    printEntries.forEach((_, index) => {
      const row = printSection.createEl("button", { cls: "tj-export-print-row", attr: { type: "button", role: "radio", "aria-checked": index === 0 ? "true" : "false" } });
      row.createSpan({ cls: "tj-export-radio", attr: { "aria-hidden": "true" } });
      row.createSpan({ cls: "tj-export-print-name", text: `Print ${index + 1}` });
      printRows.push({ index, row });
      const choose = (): void => {
        opts.primaryPrint = index;
        refreshPrintRows();
        schedulePreview();
      };
      row.addEventListener("click", choose);
      row.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
        event.preventDefault();
        const next = (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + printRows.length) % printRows.length;
        printRows[next].row.click();
        printRows[next].row.focus();
      });
    });
    const refreshPrintRows = (): void => {
      for (const item of printRows) {
        const selected = opts.primaryPrint === item.index;
        item.row.toggleClass("on", selected);
        item.row.setAttribute("aria-checked", String(selected));
        item.row.tabIndex = selected ? 0 : -1;
      }
    };
    refreshPrintRows();

    // ── Left: Toggle-all + sections ──
    const toggleAll = leftCol.createDiv({ cls: "tj-export-toggle-all" });
    toggleAll.createSpan({ text: "Include", cls: "tj-export-toggle-label" });
    const toggleAllBtn = toggleAll.createEl("button", { cls: "tj-export-toggle-btn", text: "Select all", attr: { type: "button", "aria-label": "Select all sections" } });

    // Option definitions
    type OptKey = Exclude<keyof typeof opts, "orientation" | "theme" | "imageFit" | "primaryPrint">;
    const optionKeys: OptKey[] = ["screenshot", "stats", "rating", "notes", "repeatChange", "exitReason", "psychology", "hidePnl"];
    const sections: Array<{ title: string; items: Array<{ key: OptKey; label: string; desc: string }> }> = [
      { title: "", items: [
        { key: "screenshot", label: "Screenshot", desc: "" },
        { key: "stats", label: "Stats", desc: "P&L, fees, points, R and hold time" },
        { key: "rating", label: "Self-rating", desc: "" },
        { key: "psychology", label: "Tags", desc: "Psychology and mistakes" },
      ] },
      { title: "Review", items: [
        { key: "notes", label: "What happened?", desc: "" },
        { key: "repeatChange", label: "Repeat or change", desc: "" },
        { key: "exitReason", label: "Why did I close?", desc: "" },
      ] },
      { title: "Privacy", items: [
        { key: "hidePnl", label: "Hide money", desc: "Does not change screenshots." },
      ] },
    ];

    const optionEls: Array<{ key: OptKey; row: HTMLElement }> = [];
    const contentKeys = optionKeys.filter((key) => key !== "hidePnl");

    const refreshToggleAll = () => {
      const allOn = contentKeys.every((key) => opts[key]);
      toggleAllBtn.textContent = allOn ? "Clear" : "Select all";
      toggleAllBtn.setAttribute("aria-label", allOn ? "Clear included sections" : "Select all sections");
    };

    // Redraw preview on every toggle
    let previewDebounce: number | null = null;
    const schedulePreview = () => {
      if (previewDebounce) window.clearTimeout(previewDebounce);
      [pngBtn, jpgBtn, clipBtn].forEach((button) => { button.disabled = true; });
      previewCanvas.getContext("2d")?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewStatus.setText("Updating preview…");
      previewDebounce = window.setTimeout(() => void drawPreview(), 100);
    };

    const setOrientation = (orientation: ExportOrientation): void => {
      opts.orientation = orientation;
      verticalPreset.toggleClass("is-active", orientation === "vertical");
      horizontalPreset.toggleClass("is-active", orientation === "horizontal");
      verticalPreset.setAttribute("aria-pressed", String(orientation === "vertical"));
      horizontalPreset.setAttribute("aria-pressed", String(orientation === "horizontal"));
      schedulePreview();
    };
    verticalPreset.addEventListener("click", () => setOrientation("vertical"));
    horizontalPreset.addEventListener("click", () => setOrientation("horizontal"));

    for (const sec of sections) {
      const secEl = leftCol.createDiv({ cls: "tj-export-section" });
      if (sec.title) secEl.createDiv({ cls: "tj-export-section-title", text: sec.title });
      for (const item of sec.items) {
        const row = secEl.createDiv({ cls: "tj-export-option" + (opts[item.key] ? " on" : ""), attr: { role: "checkbox", "aria-checked": String(opts[item.key]), tabindex: "0", "aria-label": item.label } });
        optionEls.push({ key: item.key, row });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); row.click(); }
        });
        const cb = row.createDiv({ cls: "tj-export-checkbox" });
        setIcon(cb, "check");
        const txt = row.createDiv({ cls: "tj-export-option-text" });
        txt.createDiv({ cls: "tj-export-option-label", text: item.label });
        if (item.desc) txt.createDiv({ cls: "tj-export-option-desc", text: item.desc });
        row.addEventListener("click", () => {
          opts[item.key] = !opts[item.key];
          row.classList.toggle("on", opts[item.key]);
          row.setAttribute("aria-checked", String(opts[item.key]));
          refreshToggleAll();
          schedulePreview();
        });
      }
    }

    toggleAllBtn.addEventListener("click", () => {
      const allOn = contentKeys.every((key) => opts[key]);
      const newState = !allOn;
      contentKeys.forEach((k) => { opts[k] = newState; });
      optionEls.forEach(({ key, row }) => { row.classList.toggle("on", opts[key]); row.setAttribute("aria-checked", String(opts[key])); });
      refreshToggleAll();
      schedulePreview();
    });

    const framing = leftCol.createDiv({ cls: "tj-export-section" });
    framing.createDiv({ cls: "tj-export-section-title", text: "Image fit" });
    const framingRow = framing.createDiv({ cls: "tj-export-preset-row" });
    const fitPrints = framingRow.createEl("button", { cls: "tj-wz-seg-opt tj-export-preset is-active", text: "Fit", attr: { type: "button", "aria-pressed": "true" } });
    const fillPrints = framingRow.createEl("button", { cls: "tj-wz-seg-opt tj-export-preset", text: "Fill", attr: { type: "button", "aria-pressed": "false" } });
    const framingHelp = framing.createDiv({ cls: "tj-export-print-help", text: "Keep the whole image." });
    const setFraming = (fit: "contain" | "cover"): void => {
      opts.imageFit = fit;
      fitPrints.toggleClass("is-active", fit === "contain");
      fillPrints.toggleClass("is-active", fit === "cover");
      fitPrints.setAttribute("aria-pressed", String(fit === "contain")); fillPrints.setAttribute("aria-pressed", String(fit === "cover"));
      framingHelp.setText(fit === "cover" ? "Crop edges to fill." : "Keep the whole image.");
      schedulePreview();
    };
    fitPrints.addEventListener("click", () => setFraming("contain"));
    fillPrints.addEventListener("click", () => setFraming("cover"));

    // Export buttons (left column, bottom)
    const btnRow = leftCol.createDiv({ cls: "tj-export-btn-row" });

    const makeBtn = (icon: string, label: string, cls: string): HTMLButtonElement => {
      const btn = btnRow.createEl("button", { cls, attr: { type: "button", "aria-label": label === "Copy" ? "Copy image" : `Download ${label}` } });
      setIcon(btn, icon);
      btn.createSpan({ text: label });
      return btn;
    };

    const doExport = async (fmt: "png" | "jpg" | "clip") => {
      let result: TradeCardResult | null;
      try { result = await getOutput(); }
      catch (error) { new Notice(error instanceof Error ? error.message : "Export failed"); return; }
      if (!result) { new Notice("Export failed"); return; }
      const canvas = result.canvas;
      const canvases = [canvas];
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
        for (const [index, page] of canvases.entries()) {
          const blob = await new Promise<Blob | null>((r) => page.toBlob(r, mime, 0.92));
          if (!blob) { new Notice("Export failed"); return; }
          const url = URL.createObjectURL(blob);
          const a = createEl("a");
          const suffix = canvases.length > 1 ? `-page-${index + 1}` : "";
          a.download = `${(t.symbol || "unknown").toUpperCase()}-${(t.direction || "unknown").toUpperCase()}-${t.date || "unknown"}${t.setup ? "-" + t.setup.replace(/[\\/:*?"<>|]+/g, "-") : ""}${suffix}.${ext}`;
          a.href = url; a.click(); URL.revokeObjectURL(url);
        }
        new Notice(canvases.length > 1 ? `Saved ${canvases.length} ${ext.toUpperCase()} pages!` : `Saved as ${ext.toUpperCase()}!`);
      }
      overlay.remove();
    };

    const pngBtn = makeBtn("image", "PNG", "tj-export-btn");
    const jpgBtn = makeBtn("image", "JPG", "tj-export-btn");
    const clipBtn = makeBtn("clipboard", "Copy", "tj-export-btn tj-export-btn--accent");
    pngBtn.addEventListener("click", () => void doExport("png"));
    jpgBtn.addEventListener("click", () => void doExport("jpg"));
    clipBtn.addEventListener("click", () => void doExport("clip"));

    leftCol.createDiv({ cls: "tj-export-hint", text: "Height adjusts to include all text." });

    // ── Right: Live preview ──
    const previewLabel = rightCol.createDiv({ cls: "tj-export-preview-label" });
    previewLabel.setText("Preview");
    const previewWrap = rightCol.createDiv({ cls: "tj-export-preview-wrap" });
    const previewCanvas = previewWrap.createEl("canvas", { attr: { width: 1080 } });
    previewCanvas.setCssStyles({ width: "100%" });
    previewCanvas.setCssStyles({ height: "auto" });
    previewCanvas.setCssStyles({ borderRadius: "6px" });

    const previewStatus = leftCol.createDiv({ cls: "tj-export-status", attr: { role: "status", "aria-live": "polite" } });
    let job: { key: string; promise: Promise<TradeCardResult | null> } | null = null;
    const selectionKey = (): string => JSON.stringify(opts);
    const getOutput = (): Promise<TradeCardResult | null> => {
      if (this.trade !== t) return Promise.reject(new Error("The active trade changed. Close and reopen Export Trade Card."));
      const key = selectionKey();
      if (!job || job.key !== key) job = { key, promise: this.buildExportCanvas({ ...opts }) };
      return job.promise;
    };
    const drawPreview = async () => {
      const key = selectionKey();
      previewWrap.dataset.theme = opts.theme;
      try {
        const result = await getOutput();
        if (!overlay.isConnected || key !== selectionKey() || !result) return;
        const canvas = result.canvas;
        previewCanvas.width = canvas.width;
        previewCanvas.height = canvas.height;
        const expanded = canvas.height > (opts.orientation === "vertical" ? 1350 : 1080);
        previewWrap.dataset.expanded = String(expanded);
        previewCanvas.setCssStyles({ width: expanded || canvas.width > canvas.height ? "100%" : "auto", height: expanded || canvas.width > canvas.height ? "auto" : "100%", maxWidth: "100%", maxHeight: expanded ? "none" : "100%" });
        previewCanvas.getContext("2d")?.drawImage(canvas, 0, 0);
        previewStatus.setText(result.warnings.join(" "));
        [pngBtn, jpgBtn, clipBtn].forEach((button) => { button.disabled = false; });
      } catch (error) {
        if (key !== selectionKey() || !overlay.isConnected) return;
        previewCanvas.getContext("2d")?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewStatus.setText(error instanceof Error ? error.message : "Export could not be rendered.");
      }
    };
    schedulePreview();
  }

  private async buildExportCanvas(opts: ExportOptions): Promise<TradeCardResult | null> {
    const t = this.trade;
    if (!t) return null;
    const entries = this.resolveScreenshotEntries(t);
    return renderTradeCard(t, opts, this.plugin.settings.timeZone, (index) => {
      const entry = entries[index];
      return entry ? this.resolveImage(entry.entry.file) : null;
    });
  }

  async openScreenshot(link: string): Promise<void> {
    const raw = (link || "").trim();
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const file = this.app.vault.getAbstractFileByPath(target) || this.app.vault.getAbstractFileByPath("Tradebook/" + target);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("Attachment not found: " + target);
    }
  }

  /** Open the selected print on click; wheel zooms around the pointer and
   * dragging pans the image while zoomed. */
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
    overlay.setAttr("aria-label", `Expanded print ${file.basename}`);
    const img = overlay.createEl("img", { cls: "tj-td-lightbox-img", attr: { src, alt: file.basename } });
    const hint = overlay.createDiv({ cls: "tj-td-lightbox-hint", text: "Scroll to zoom · drag to pan · Esc to close" });
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startOffsetX = 0;
    let startOffsetY = 0;
    const paint = () => {
      img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      img.style.cursor = scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in";
      hint.toggleClass("is-hidden", scale > 1.01);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = img.getBoundingClientRect();
      const pointerX = e.clientX - (rect.left + rect.width / 2);
      const pointerY = e.clientY - (rect.top + rect.height / 2);
      const next = Math.max(1, Math.min(8, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
      const ratio = next / scale;
      offsetX = e.clientX - (rect.left + rect.width / 2) - pointerX * ratio;
      offsetY = e.clientY - (rect.top + rect.height / 2) - pointerY * ratio;
      scale = next;
      if (scale <= 1.01) { scale = 1; offsetX = 0; offsetY = 0; }
      paint();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (scale <= 1.01 || e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startOffsetX = offsetX;
      startOffsetY = offsetY;
      img.setPointerCapture(e.pointerId);
      paint();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      offsetX = startOffsetX + e.clientX - startX;
      offsetY = startOffsetY + e.clientY - startY;
      paint();
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      try { img.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      paint();
    };
    const close = () => {
      doc.removeEventListener("keydown", onKey, true);
      img.removeEventListener("wheel", onWheel);
      img.removeEventListener("pointerdown", onPointerDown);
      img.removeEventListener("pointermove", onPointerMove);
      img.removeEventListener("pointerup", onPointerUp);
      overlay.remove();
      this._lightboxCleanup = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      if (e.key === "0") {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        paint();
      }
    };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    img.addEventListener("wheel", onWheel, { passive: false });
    img.addEventListener("pointerdown", onPointerDown);
    img.addEventListener("pointermove", onPointerMove);
    img.addEventListener("pointerup", onPointerUp);
    doc.addEventListener("keydown", onKey, true);
    this._lightboxCleanup = close;
    paint();
  }
}
