import { ItemView, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type TradebookPlugin from "../main";
import { AccountRules, AccountType, PropAccount, Trade } from "../types";
import type { ResolvedRules } from "../lib/accountRules";
import { openPayoutsModal } from "./payoutModal";
import { openFeeAdjustModal } from "./feeAdjustModal";
import { openAccountWizard } from "./accountWizard";
import { uniqueAccountName } from "../props";
import { resolveAccountView, drawdownLabel, isPropType } from "../lib/accountRules";
import { freeNumeric } from "../lib/numeric";
import { mountDropdown } from "../lib/dropdown";
import { ACCOUNT_SIZES, TYPE_CATALOG, typeLabel } from "../lib/accountTypes";
import { firmLabel } from "../lib/firmLogos";
import { renderAppShell } from "../ui";
import { fmtMoney, fmtMoneyCompact, isFiniteNumber, todayKey } from "../tz";
import { tradeDayInZone } from "../lib/instant";
import { renderLineChart } from "../lib/lineChart";
import { formatDate, mountDateField } from "../lib/dates";
import { copierPresentation } from "../lib/copy";
import { excludeSuperseded } from "../lib/copySupersession";
import { reportedHistorySummary } from "../lib/reportedHistory";
import { accountValueSeries, computeAccountMetrics, computeRecordedAccountMovement } from "../lib/accountMetrics";
import { accountCashflows } from "../lib/accountCashflows";
import { netPnl } from "../lib/fees";
import { tradeCostCoverage } from "../lib/money";
import { isTrackedTrade, trackingStartOf, historyAvailability, trackedReading, trackedNote, openingPeakOf, openingCapital, hasOpeningBalance, missingOpeningBalance, accountBoundary, OPENING_BALANCE_REQUIRED_NOTE, NO_TRACKED_DATA_NOTE } from "../lib/tracking";
import { sessionLabel, sessionRank } from "../lib/sessions";
import { renderTradeTable, resolveOrder, DEFAULT_ACCOUNT_ORDER } from "../lib/tradeTable";
import type { TradeSort } from "../lib/tradeTable";
import { attachTip } from "../lib/tip";
import { killTip, moveTip, showTip } from "../lib/tip";

export const ACCOUNT_DASH_VIEW_TYPE = "tradebook-account-dash-view";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export class AccountDashboardView extends ItemView {
  plugin: TradebookPlugin;
  accountId: string | null = null;
  trades: Trade[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ACCOUNT_DASH_VIEW_TYPE;
  }

  getDisplayText(): string {
    const acc = this.account();
    return acc ? `Accounts — ${acc.name}` : "Accounts";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): Record<string, unknown> {
    return { accountId: this.accountId };
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    this.accountId = typeof state?.accountId === "string" ? state.accountId : null;
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  async onClose(): Promise<void> {}

  account() {
    const accounts = this.plugin.settings.propAccounts || [];
    // When an explicit account is requested, never silently show a different one.
    if (this.accountId) return accounts.find((a) => a.id === this.accountId);
    return accounts.find((a) => a.id === this.plugin.getPrimaryAccount()?.id) ?? accounts[0];
  }

  scoped(): Trade[] {
    const acc = this.account();
    if (!acc) return [];
    return excludeSuperseded(
      this.trades.filter((t) => {
        if (!isFiniteNumber(t.pnl) || !t.date) return false;
        const mapped = this.plugin.mappedAccount(t.account);
        const matches = mapped ? mapped.id === acc.id : (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
        if (!matches) return false;
        // The tracked boundary wins when the trader declared one; an account
        // without it keeps the old "started on" rule. One name for that rule.
        const boundary = accountBoundary(acc);
        if (boundary && !isTrackedTrade(t, boundary)) return false;
        return true;
      })
    ).sort((a, b) => {
        const ka = this.dayKey(a);
        const kb = this.dayKey(b);
        return ka.localeCompare(kb) || (a.id || "").localeCompare(b.id || "");
      });
  }

  dayKey(t: Trade): string {
    return tradeDayInZone(t, this.plugin.settings.timeZone);
  }

  todayKey(): string {
    return todayKey(this.plugin.settings.timeZone);
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  /**
   * The account's copy link, on one line under the title: who it mirrors (or
   * who mirrors it) and at what ratio. The stretches it went through stay in
   * the data (they are why changing a leader never rewrites older trades) but
   * they are not worth a line on the page.
   */
  private renderCopyBar(host: HTMLElement, acc: PropAccount): void {
    const accounts = this.plugin.settings.propAccounts ?? [];
    const copiers = accounts.filter((a) => a.id !== acc.id && a.copyBaseId === acc.id);
    if (!acc.copyRole && !copiers.length) return;

    const bar = host.createDiv({ cls: "tj-acc-copybar" });
    bar.createDiv({ cls: "tj-acc-k", text: "Trading group" });
    const chip = bar.createDiv({ cls: "tj-acc-copychip" });
    if (acc.copyRole === "copier") {
      chip.addClass("is-copier");
      // One source for the ratio and the start, so this chip and the account
      // card never disagree — see `copierPresentation`.
      const cp = copierPresentation(acc, (id) => accounts.find((a) => a.id === id)?.name ?? id);
      chip.createSpan({ cls: "tj-acc-copychip-t", text: `Copier ×${cp.ratio}` });
      const since = cp.since
        ? cp.sinceIsBeginning
          ? "the beginning"
          : formatDate(cp.since, this.plugin.settings.dateFormat)
        : "";
      attachTip(chip, {
        title: "Copier",
        sub: `Copies ${cp.baseName ?? "an unknown account"}${since ? ` · since ${since}` : ""}`,
      });
    } else {
      chip.addClass("is-leader");
      const crown = chip.createSpan({ cls: "tj-acc-copychip-ico" });
      setIcon(crown, "crown");
      chip.createSpan({ cls: "tj-acc-copychip-t", text: "Leader" });
      if (copiers.length) {
        chip.createSpan({
          cls: "tj-acc-copychip-sub",
          text: `${copiers.length} copier${copiers.length === 1 ? "" : "s"}`,
        });
        attachTip(chip, { title: "Leader", sub: `mirrored by ${copiers.map((c) => c.name).join(", ")}` });
      }
    }
  }

  openEditAccountModal(acc: PropAccount, size: ResolvedRules, net: number): void {
    const view = resolveAccountView(acc);
    const firmName = firmLabel(acc.firmId) ?? "";
    const autoName = (sz: number, t: string) => `${firmName} · ${typeLabel(t)} · $${(sz / 1000).toFixed(0)}K`;
    const initials = (n: string) =>
      (n || "?")
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("") || "?";

    const overlay = document.body.createDiv({ cls: "tj-modal-overlay" });
    const modal = overlay.createDiv({ cls: "tj-modal tj-acc-settings" });

    // ---- Header ----
    const head = modal.createDiv({ cls: "tj-as-head" });
    const avatar = head.createDiv({ cls: "tj-as-avatar" });
    const logoUrl = this.plugin.firmLogoUrl(acc.firmId);
    if (logoUrl) {
      const img = avatar.createEl("img", { cls: "tj-as-avatar-img", attr: { alt: firmName } });
      img.src = logoUrl;
      img.addEventListener("error", () => { img.remove(); avatar.setText(initials(acc.name)); });
    } else {
      avatar.setText(initials(acc.name));
    }
    const headText = head.createDiv({ cls: "tj-as-headtext" });
    const headTitle = headText.createEl("h3", { text: acc.name });
    headText.createDiv({ cls: "tj-as-meta", text: [firmName, typeLabel(acc.type)].filter(Boolean).join(" · ") });
    const closeAs = head.createEl("button", { cls: "tj-as-close", text: "\u2715", attr: { type: "button", "aria-label": "Close" } });
    closeAs.addEventListener("click", () => overlay.remove());

    // ---- Tabs ----
    const tabs = modal.createDiv({ cls: "tj-as-tabs" });
    const panes = modal.createDiv({ cls: "tj-as-panes" });
    const tabDefs: Array<{ id: string; label: string; dng?: boolean }> = [
      { id: "general", label: "General" },
      { id: "information", label: "Information" },
      { id: "rules", label: "Rules" },
      { id: "danger", label: "Deletion", dng: true },
    ];
    const paneEls: Record<string, HTMLElement> = {};
    const showTab = (id: string) => {
      for (const p of tabDefs) {
        paneEls[p.id].style.display = p.id === id ? "" : "none";
        tabBtns[p.id].toggleClass("is-active", p.id === id);
      }
      modal.toggleClass("is-danger-tab", id === "danger");
    };
    const tabBtns: Record<string, HTMLElement> = {};
    for (const t of tabDefs) {
      const b = tabs.createEl("button", { cls: "tj-as-tab" + (t.dng ? " tj-as-tab-dng" : ""), text: t.label, attr: { type: "button" } });
      b.addEventListener("click", () => showTab(t.id));
      tabBtns[t.id] = b;
      paneEls[t.id] = panes.createDiv({ cls: "tj-as-pane" });
    }
    // The General and Rules panes reuse the wizard's fields — carry the wizard
    // scope so inputs, affixes, toggles and type tiles read the same as on the
    // creation screen.
    paneEls.general.addClass("tj-account-wizard");
    paneEls.rules.addClass("tj-account-wizard");

    // ======== Rows (shared across all tabs) ========
    const mkRow = (host: HTMLElement, label: string): HTMLElement => {
      const row = host.createDiv({ cls: "tj-as-row" });
      row.createSpan({ cls: "tj-as-rowlabel", text: label });
      return row.createSpan({ cls: "tj-as-rowval" });
    };

    // ======== GENERAL — identity and setup only ========
    const gen = paneEls.general;
    const info = paneEls.information;
    const nameInput = mkRow(gen, "Account name").createEl("input", { type: "text", cls: "tj-as-nameinput" });
    nameInput.value = acc.name;

    const startedVal = mkRow(gen, "Started on");
    // Same date field as everywhere else, so this one follows the Date format
    // chosen in Settings too (a native input shows the operating system's).
    let startedValue = acc.createdAt ?? "";
    mountDateField(startedVal, {
      value: startedValue,
      format: this.plugin.settings.dateFormat,
      className: "tj-as-nameinput",
      zone: this.plugin.settings.timeZone,
      onChange: (iso) => (startedValue = iso),
    });

    // "Start Tracking From Here". `createdAt` above is identity; this is the
    // analytics boundary. Trades before it stay in the journal but are out of
    // the tracked population. `size` stays the rule anchor; the opening balance
    // is the value anchor.
    // ---- Tracking: the minimum valid setup, then what is optional ----
    //
    // Two dates that are easy to confuse, so each says what it is in one line:
    // "Account started" is when the account existed; "Tracking from" is when
    // Tradebook began measuring it. Below them the account's value on that date,
    // and then a collapsed group for the history you know but Tradebook does not.
    // A visible (i) beside the label, not a tooltip hidden on the words: nobody
    // hovers a label they do not yet know holds help.
    const infoLabel = (row: HTMLElement, label: string, tip: string): HTMLElement => {
      const l = row.createSpan({ cls: "tj-as-rowlabel" });
      l.createSpan({ text: label });
      const dot = l.createSpan({ cls: "tj-as-infoico", attr: { tabindex: "0" } });
      const glyph = dot.createSpan({ attr: { "aria-hidden": "true" } });
      setIcon(glyph, "info");
      dot.createSpan({ cls: "tj-sr-only", text: `About ${label}` });
      attachTip(dot, { title: label, sub: tip });
      return row.createSpan({ cls: "tj-as-rowval" });
    };

    const trackSection = info.createDiv({ cls: "tj-as-section", text: "Tracking" });
    trackSection.createDiv({
      cls: "tj-as-hint",
      text: "Set this once. Tradebook measures this account from the tracking date onwards; earlier trades stay in the journal as history.",
    });

    let trackingValue = acc.trackingStart ?? "";
    const trackRow = trackSection.createDiv({ cls: "tj-as-row" });
    const trackField = infoLabel(
      trackRow,
      "Tracking from",
      "The date Tradebook starts calculating this account's performance. It doesn't have to be the date the account started."
    );
    mountDateField(trackField, {
      value: trackingValue,
      format: this.plugin.settings.dateFormat,
      className: "tj-as-nameinput",
      zone: this.plugin.settings.timeZone,
      onChange: (iso) => {
        trackingValue = iso;
        syncTracking();
      },
    });

    const openRow = trackSection.createDiv({ cls: "tj-as-row" });
    const openField = infoLabel(
      openRow,
      "Opening balance",
      "What was this account worth on the tracking date? Your firm's rules still come from the account size — this is the money it actually held."
    );
    const openingInput = openField.createEl("input", { type: "number", cls: "tj-as-nameinput" });
    freeNumeric(openingInput);
    openingInput.placeholder = "Value on that date";
    // When the account's declared value IS its configured size (the trader chose
    // the box last time, or typed it), the number is left in the field and the box
    // reflects it — the two never disagree on screen.
    const anchorIsSize = hasOpeningBalance(acc) && openingCapital(acc) === acc.size;
    openingInput.value = hasOpeningBalance(acc) && !anchorIsSize ? String(acc.openingBalance as number) : "";

    // A boundary without a declared value would quietly make the balance the
    // configured size — the one number the trader checks against the platform.
    // So the choice is explicit: their own number, or the account size on record.
    const useSizeRow = trackSection.createDiv({ cls: "tj-as-row" });
    const useSizeField = infoLabel(
      useSizeRow,
      "Use the account size",
      "Use this only if the account was worth exactly its configured size when tracking started."
    );
    const useSizeInput = useSizeField.createEl("input", { type: "checkbox" });
    useSizeInput.checked = anchorIsSize;
    const useSizeNote = trackSection.createDiv({ cls: "tj-as-hint" });
    useSizeNote.setText("Tick the box above when the account was worth its configured size on that date.");

    // The pre-tracking high-water mark. Only asked for where the account's own
    // loss-floor rule can actually need it, and never inferred.
    let peakInput: HTMLInputElement | null = null;
    let peakHint: HTMLElement | null = null;
    const peakRow = trackSection.createDiv({ cls: "tj-as-row is-hidden" });
    const peakField = infoLabel(
      peakRow,
      "Highest value before",
      "If this account was already trading before tracking started, enter the highest balance it had reached. Some drawdown rules need this to calculate the correct floor. Tradebook won't guess it."
    );
    peakInput = peakField.createEl("input", { type: "number", cls: "tj-as-nameinput" });
    freeNumeric(peakInput);
    peakInput.placeholder = "Only if it was already running";
    peakInput.value = typeof acc.openingPeak === "number" && Number.isFinite(acc.openingPeak) ? String(acc.openingPeak) : "";
    peakHint = trackSection.createDiv({ cls: "tj-as-hint is-hidden" });
    peakHint.setText("Leave this empty if the account started on the tracking date — the floor then comes from your opening balance.");

    // ---- Reported history: optional, and behind a disclosure ----
    //
    // A trader with fifty accounts sets a date and moves on. A trader with two
    // may want the history written down. Both are supported: the second one opens
    // it, the first one never has to.
    const histSection = info.createDiv({ cls: "tj-as-section", text: "Reported history" });
    histSection.createDiv({
      cls: "tj-as-hint",
      text: "Optional context from before tracking started. It's shown as history and never mixed into Tradebook's calculated performance.",
    });
    // What is already on file reads back here as plain context — reported
    // history is not a form you fill once and never see again. Display only:
    // it is never counted in any figure below. Absent values are omitted.
    const reported = reportedHistorySummary(acc.historicalContext);
    if (reported.hasAny) {
      const summary = info.createDiv();
      if (reported.segments.length) {
        const row = summary.createDiv({ cls: "tj-as-row" });
        row.createSpan({ cls: "tj-as-rowlabel", text: "Reported before tracking" });
        row.createSpan({ cls: "tj-as-rowval", text: reported.segments.join(" \u00b7 ") });
      }
      if (reported.note) {
        const row = summary.createDiv({ cls: "tj-as-row" });
        row.createSpan({ cls: "tj-as-rowlabel", text: "Reported note" });
        row.createSpan({ cls: "tj-as-rowval", text: reported.note });
      }
      summary.createDiv({
        cls: "tj-as-hint",
        text: "Self-reported \u00b7 context only, never counted in any Tradebook figure.",
      });
    }
    const prevCountInput = info.createEl("input", { type: "number", cls: "tj-as-nameinput" });
    const prevWinRateInput = info.createEl("input", { type: "number", cls: "tj-as-nameinput" });
    const noteInput = info.createEl("input", { type: "text", cls: "tj-as-nameinput" });
    prevCountInput.value = Number.isFinite(acc.historicalContext?.previousTradeCount)
      ? String(acc.historicalContext?.previousTradeCount)
      : "";
    prevWinRateInput.value = Number.isFinite(acc.historicalContext?.previousWinRate)
      ? String(acc.historicalContext?.previousWinRate)
      : "";
    noteInput.value = acc.historicalContext?.note ?? "";
    const ctxBox = info.createDiv({ cls: "tj-as-disclosure" });
    const ctxToggle = ctxBox.createEl("button", {
      cls: "tj-as-disclosure-btn",
      text: "Add what happened before tracking",
      attr: { type: "button", "aria-expanded": "false" },
    });
    const ctxPanel = ctxBox.createDiv({ cls: "tj-as-disclosure-panel is-hidden" });
    const ctxRow = (label: string, control: HTMLElement, tip: string) => {
      const r = ctxPanel.createDiv({ cls: "tj-as-row" });
      const l = r.createSpan({ cls: "tj-as-rowlabel", text: label });
      r.createSpan({ cls: "tj-as-rowval" }).appendChild(control);
      attachTip(l, { title: label, sub: tip });
    };
    ctxRow("Trades before", prevCountInput, "How many trades you had already taken. Context only.");
    ctxRow("Win rate before %", prevWinRateInput, "As you remember it. Tradebook does not recompute or use it.");
    ctxRow("Note", noteInput, "Anything else worth remembering — the account's history, in your words.");
    const hasReportedNow =
      Number.isFinite(acc.historicalContext?.previousTradeCount) || Number.isFinite(acc.historicalContext?.previousWinRate) || !!acc.historicalContext?.note;
    ctxToggle.addEventListener("click", () => {
      const open = ctxPanel.hasClass("is-hidden");
      ctxPanel.toggleClass("is-hidden", !open);
      ctxToggle.setAttr("aria-expanded", String(open));
      ctxToggle.toggleClass("is-open", open);
    });
    if (hasReportedNow) {
      ctxPanel.removeClass("is-hidden");
      ctxToggle.addClass("is-open");
      ctxToggle.setAttr("aria-expanded", "true");
    }

    /**
     * Show the trailing-floor field only where the account's own rule can need
     * it: a trailing or open-trailing floor, and only once there is a tracking
     * date. A static floor needs no history at all.
     */
    const syncTracking = (): void => {
      const rules = resolveAccountView(acc).rules;
      const trailing = !!rules.maxLoss && !!rules.maxLossType && rules.maxLossType !== "static" && rules.maxLossType !== "intraday-trailing";
      const showPeak = !!trackingValue && (trailing || acc.openingPeak !== undefined);
      peakRow.toggleClass("is-hidden", !showPeak);
      peakHint?.toggleClass("is-hidden", !showPeak);
    };
    syncTracking();

    // ---- Account size: the same five sizes the wizard offers, plus Custom… ----
    let selectedSize = acc.size;
    let sizeCustom = !ACCOUNT_SIZES.includes(selectedSize);
    let renderRules: () => void = () => {};
    const sizeRow = mkRow(gen, "Account size");
    let customWrap!: HTMLElement;
    let customInput!: HTMLInputElement;
    const syncAutoName = () => {
      if (!nameIsAuto) return;
      nameInput.value = autoName(selectedSize, selectedType);
      headTitle.setText(autoName(selectedSize, selectedType));
    };
    mountDropdown(
      sizeRow,
      [
        ...ACCOUNT_SIZES.map((sz) => ({ id: String(sz), label: `$${(sz / 1000).toFixed(0)}K` })),
        { id: "custom", label: "Custom…" },
      ],
      sizeCustom ? "custom" : String(selectedSize),
      (id) => {
        if (id === "custom") {
          sizeCustom = true;
          customWrap.removeClass("is-hidden");
          customInput.focus();
          return;
        }
        sizeCustom = false;
        selectedSize = parseInt(id, 10);
        customWrap.addClass("is-hidden");
        syncAutoName();
      },
      {
        title: "Account size",
        sub: "The size your firm's rules are written against. It is not the money in the account: the recorded value is what this account actually held, and it sits above or below this number.",
      }
    );
    customWrap = sizeRow.createDiv({ cls: "tj-wz-affix" + (sizeCustom ? "" : " is-hidden") });
    customWrap.createSpan({ cls: "tj-wz-affix-pre", text: "$" });
    customInput = freeNumeric(
      customWrap.createEl("input", {
        cls: "tj-wz-input",
        attr: { type: "number", placeholder: "Account size", value: sizeCustom ? String(selectedSize) : "" },
      })
    );
    customInput.addEventListener("input", () => {
      selectedSize = parseFloat(customInput.value) || 0;
      syncAutoName();
    });

    // ---- Account type: the wizard's tiles, the chosen one in the accent ----
    let selectedType: string = acc.type;
    const typeField = gen.createDiv({ cls: "tj-wz-field" });
    typeField.createEl("label", { text: "Account type", cls: "tj-wz-label" });
    const typeGrid = typeField.createDiv({ cls: "tj-wz-types" });
    const renderTypes = () => {
      typeGrid.empty();
      for (const t of TYPE_CATALOG) {
        const card = typeGrid.createDiv({ cls: "tj-wz-type" + (selectedType === t.id ? " on" : "") });
        const ico = card.createDiv({ cls: "tj-wz-type-ico", attr: { "aria-hidden": "true" } });
        setIcon(ico, t.icon);
        card.createDiv({ cls: "tj-wz-type-l", text: t.label });
        card.createDiv({ cls: "tj-wz-type-d", text: t.desc });
        card.addEventListener("click", () => {
          if (selectedType !== t.id) {
            for (const key of Object.keys(ruleState) as Array<keyof AccountRules>) delete ruleState[key];
          }
          selectedType = t.id;
          renderTypes();
          syncAutoName();
          renderRules();
        });
      }
    };
    // Rebuilt when the type changes, so the rules pane always speaks the right
    // language (an eval has a target, a live account does not).
    renderTypes();

    const genHint = gen.createDiv({ cls: "tj-as-hint", text: "" });
    const setHint = () => genHint.setText(nameIsAuto ? "Name is auto-generated \u2014 edit it to set a custom name." : "Custom name \u2014 size changes won't overwrite it.");

    // Name auto-follow logic
    const wasAuto = acc.name === autoName(acc.size, acc.type) || !acc.name;
    if (wasAuto) nameInput.value = autoName(acc.size, acc.type);
    let nameIsAuto = wasAuto;
    setHint();
    nameInput.addEventListener("input", () => {
      nameIsAuto = false;
      setHint();
      headTitle.setText(nameInput.value || acc.name);
    });

    // ======== RULES ========
    // Same fields, labels and per-type reading as the Add account wizard, so a
    // rule set at creation is edited here in the same language.
    const rulesPane = paneEls.rules;
    const DD_TYPES: Array<{ id: string; label: string }> = [
      { id: "eod-trailing", label: "End-of-day trailing" },
      { id: "intraday-trailing", label: "Intraday trailing" },
      { id: "eod-trailing-open", label: "End-of-day trailing, never locks" },
      { id: "static", label: "Static" },
    ];
    // Draft rules: every control writes here, so a type change can rebuild the
    // pane without losing what was typed.
    const ruleState: AccountRules = { ...(acc.rules ?? {}) };
    if (ruleState.maxLossType === undefined) ruleState.maxLossType = acc.type === "personal" ? "static" : "eod-trailing";

    const ruleAffix = (
      label: string,
      unit: { prefix?: string; suffix?: string },
      value: number | undefined,
      onChange: (v: number | undefined) => void
    ) => {
      const f = rulesPane.createDiv({ cls: "tj-wz-field" });
      f.createEl("label", { text: label, cls: "tj-wz-label" });
      const wrap = f.createDiv({ cls: "tj-wz-affix" });
      if (unit.prefix) wrap.createSpan({ cls: "tj-wz-affix-pre", text: unit.prefix });
      const input = freeNumeric(
        wrap.createEl("input", { cls: "tj-wz-input", attr: { type: "number", value: value ? String(value) : "" } })
      );
      if (unit.suffix) wrap.createSpan({ cls: "tj-wz-affix-suf", text: unit.suffix });
      input.addEventListener("input", () => onChange(parseFloat(input.value) || undefined));
    };

    const ruleAmount = (label: string, key: "target" | "maxLoss") => {
      const pctKey: "targetPct" | "maxLossPct" = key === "target" ? "targetPct" : "maxLossPct";
      const f = rulesPane.createDiv({ cls: "tj-wz-field" });
      const head = f.createDiv({ cls: "tj-wz-affixhead" });
      head.createEl("label", { text: label, cls: "tj-wz-label" });
      const toggle = head.createDiv({ cls: "tj-wz-untoggle" });
      let mode: "$" | "%" = ruleState[pctKey] !== undefined ? "%" : "$";
      const wrap = f.createDiv({ cls: "tj-wz-affix" });
      const pre = wrap.createSpan({ cls: "tj-wz-affix-pre", text: mode });
      const input = freeNumeric(
        wrap.createEl("input", {
          cls: "tj-wz-input",
          attr: { type: "number", value: String((mode === "%" ? ruleState[pctKey] : ruleState[key]) ?? "") },
        })
      );
      const push = () => {
        const v = parseFloat(input.value) || 0;
        if (mode === "%") {
          ruleState[pctKey] = v || undefined;
          delete ruleState[key];
        } else {
          ruleState[key] = v || undefined;
          delete ruleState[pctKey];
        }
      };
      for (const m of ["$", "%"] as const) {
        const b = toggle.createEl("button", {
          cls: "tj-wz-unbtn" + (m === mode ? " on" : ""),
          text: m,
          attr: { type: "button", "aria-label": m === "$" ? "Amount in dollars" : "Amount in percent", "aria-pressed": String(m === mode) },
        });
        b.addEventListener("click", () => {
          if (mode === m) return;
          mode = m;
          pre.setText(mode);
          toggle.querySelectorAll(".tj-wz-unbtn").forEach((n) => n.classList.remove("on"));
          b.classList.add("on");
          push();
        });
      }
      input.addEventListener("input", push);
    };

    renderRules = () => {
      rulesPane.empty();
      const t = selectedType;
      rulesPane.createDiv({ cls: "tj-as-section", text: "Rules" });
      if (t === "demo") {
        rulesPane.createDiv({
          cls: "tj-as-hint",
          text: "Demo accounts have no configured account limits by default.",
        });
        return;
      }
      if (t === "personal") {
        rulesPane.createDiv({ cls: "tj-as-hint", text: "Set a personal loss limit or floor if you want the journal to track one." });
        ruleAmount("Personal loss limit", "maxLoss");
        const ddF = rulesPane.createDiv({ cls: "tj-wz-field" });
        ddF.createEl("label", { text: "Loss-floor type", cls: "tj-wz-label" });
        mountDropdown(ddF, DD_TYPES.map((d) => ({ id: d.id, label: d.label })), ruleState.maxLossType ?? "static", (id) => {
          ruleState.maxLossType = id as AccountRules["maxLossType"];
          renderRules();
        });
        if (ruleState.maxLossType !== "static" && ruleState.maxLossType !== "eod-trailing-open") {
          ruleAffix("Locks above balance (optional)", { prefix: "$" }, ruleState.ddLockOffset, (v) => (ruleState.ddLockOffset = v));
        }
        return;
      }
      rulesPane.createDiv({
        cls: "tj-as-hint",
        text:
          t === "eval"
            ? "The numbers your firm needs to pass. Leave a field empty if the rule does not exist."
            : t === "funded"
              ? "The numbers your firm applies to payouts. Leave a field empty if the rule does not exist."
              : "The limits your account runs under. Leave a field empty if the rule does not exist.",
      });
      ruleAmount("Profit target", "target");
      ruleAmount("Max loss", "maxLoss");
      ruleAffix("Daily loss limit (optional)", { prefix: "$" }, ruleState.dailyLoss, (v) => (ruleState.dailyLoss = v));
      ruleAffix("Consistency % (optional)", { suffix: "%" }, ruleState.consistency, (v) => (ruleState.consistency = v));

      const ddF = rulesPane.createDiv({ cls: "tj-wz-field" });
      ddF.createEl("label", { text: "Drawdown type", cls: "tj-wz-label" });
      mountDropdown(
        ddF,
        DD_TYPES.map((d) => ({ id: d.id, label: d.label })),
        ruleState.maxLossType ?? "eod-trailing",
        (id) => {
          ruleState.maxLossType = id as AccountRules["maxLossType"];
          renderRules();
        }
      );

      if (ruleState.maxLossType !== "static" && ruleState.maxLossType !== "eod-trailing-open") {
        ruleAffix("Locks above balance (optional)", { prefix: "$" }, ruleState.ddLockOffset, (v) => (ruleState.ddLockOffset = v));
      }

      const posF = rulesPane.createDiv({ cls: "tj-wz-field" });
      posF.createEl("label", { text: "Position size (optional)", cls: "tj-wz-label" });
      const posInput = posF.createEl("input", {
        cls: "tj-wz-input",
        attr: { type: "text", placeholder: "e.g. 5 mini / 50 micro", value: ruleState.posSize ?? "" },
      });
      posInput.addEventListener("input", () => (ruleState.posSize = posInput.value.trim() || undefined));

      ruleAffix(
        t === "funded" ? "Payout winning days (optional)" : "Minimum trading days (optional)",
        { suffix: "days" },
        ruleState.minDays,
        (v) => (ruleState.minDays = v)
      );

      const disc = rulesPane.createDiv({ cls: "tj-wz-disclaimer" });
      const discIco = disc.createSpan({ cls: "tj-wz-disclaimer-ico", attr: { "aria-hidden": "true" } });
      setIcon(discIco, "alert-triangle");
      disc.createSpan({
        text: "Prop firms change their rules often — double-check the numbers before saving. Nothing here is enforced; the journal only reports against them.",
      });
    };
    renderRules();
    // A change of loss-floor type can make the pre-tracking peak relevant (or not),
    // so the field is re-read whenever the rules pane redraws itself.
    const rulesRefresh = renderRules;
    renderRules = () => {
      rulesRefresh();
      syncTracking();
    };

    // ======== DANGER ZONE ========
    const dng = paneEls.danger;
    const archCard = dng.createDiv({ cls: "tj-as-dngcard" });
    const archRow = archCard.createDiv({ cls: "tj-as-dngrow" });
    const archInfo = archRow.createDiv();
    archInfo.createDiv({ cls: "tj-as-dngt", text: "Archive account" });
    archInfo.createDiv({ cls: "tj-as-dngd", text: "Hide from all views, metrics and dashboards. Data is preserved \u2014 restore anytime." });
    const archBtn = archRow.createEl("button", { cls: "tj-as-btn", attr: { type: "button" } });
    setIcon(archBtn.createSpan({ cls: "tj-as-btn-ico" }), "archive");
    archBtn.createSpan({ text: "Archive" });
    archBtn.addEventListener("click", () => {
      void (async () => {
        // An eval still in progress is not a finished thing: say so before hiding it.
        const inProgress =
          acc.type === "eval" && !acc.passedAt && !acc.passKept && !acc.linkedFundedId;
        const doIt = async () => {
          await this.plugin.archiveAccount(acc.id);
          overlay.remove();
          void this.plugin.openAccounts();
        };
        if (inProgress) this.showArchiveConfirm(archCard, acc, doIt);
        else await doIt();
      })();
    });
    const delCard = dng.createDiv({ cls: "tj-as-dngcard" });
    const delRow = delCard.createDiv({ cls: "tj-as-dngrow" });
    const delInfo = delRow.createDiv();
    delInfo.createDiv({ cls: "tj-as-dngt", text: "Delete account" });
    delInfo.createDiv({ cls: "tj-as-dngd", text: "Permanent \u2014 the account, its records and its trade notes leave the vault." });
    const delBtn = delRow.createEl("button", { cls: "tj-as-btn tj-as-btn-del", attr: { type: "button" } });
    setIcon(delBtn.createSpan({ cls: "tj-as-btn-ico" }), "trash-2");
    delBtn.createSpan({ text: "Delete" });
    delBtn.addEventListener("click", () => {
      const confOverlay = document.body.createDiv({ cls: "tj-modal-overlay" });
      void this.showDeleteConfirm(confOverlay, acc, 1, () => {
        void (async () => {
          confOverlay.remove();
          await this.plugin.removeAccount(acc.id);
          overlay.remove();
          void this.plugin.openAccounts();
        })();
      });
    });

    // ---- Footer ----
    const foot = modal.createDiv({ cls: "tj-as-foot" });
    foot.createEl("button", { text: "Cancel", cls: "tj-as-btn", attr: { type: "button" } }).addEventListener("click", () => overlay.remove());
    foot.createEl("button", { text: "Save changes", cls: "tj-as-btn tj-as-btn-cta", attr: { type: "button" } }).addEventListener("click", () => {
      void (async () => {
        const nextSize = selectedSize || acc.size;
        // The value anchor is required before a boundary goes on file: a tracking
        // start with no declared value would silently balance from the configured
        // size. The trader either typed their own number or ticked the box.
        const typedOpening = parseFloat(openingInput.value);
        const openingBalance = Number.isFinite(typedOpening) && typedOpening > 0 ? typedOpening : null;
        const openingPeak = parseFloat(peakInput?.value ?? "");
        if (missingOpeningBalance({ trackingStart: trackingValue, openingBalance: openingBalance ?? undefined }) && !useSizeInput.checked) {
          useSizeNote.setText(OPENING_BALANCE_REQUIRED_NOTE);
          useSizeNote.addClass("tj-as-hint-warn");
          new Notice("Opening balance needed before tracking can start.");
          (useSizeInput.checked ? openingInput : useSizeInput).focus();
          return;
        }
        useSizeNote.setText("");
        useSizeNote.removeClass("tj-as-hint-warn");
        // Keep names unique so two accounts never share trades/data.
        const taken = (this.plugin.settings.propAccounts || []).filter((a) => a.id !== acc.id).map((a) => a.name);
        const desired = uniqueAccountName(nameInput.value.trim() || acc.name, taken);
        if (desired !== acc.name) {
          // Rename + re-index every trade of this account so nothing is lost.
          await this.plugin.renameAccount(acc.id, desired);
        }
        if (startedValue) acc.createdAt = startedValue;
        else delete acc.createdAt;
        acc.size = nextSize;

        // Tracking boundary + the account's own opening state + reported context.
        // The opening value and the pre-tracking peak belong to a boundary: with
        // none, they would measure the balance from a moment that no longer exists
        // and double-count the history it was meant to replace. So clearing the
        // boundary clears them, out loud — never a silent conversion.
        const hadOpeningState = hasOpeningBalance(acc) || openingPeakOf(acc) !== null;
        if (trackingValue) acc.trackingStart = trackingValue;
        else delete acc.trackingStart;
        if (openingBalance !== null) acc.openingBalance = openingBalance;
        else if (useSizeInput.checked && trackingValue) acc.openingBalance = nextSize;
        else delete acc.openingBalance;
        // The pre-tracking high-water mark, declared for a trailing floor. Recorded
        // as a number or not at all — never inferred from the opening balance.
        if (Number.isFinite(openingPeak) && openingPeak > 0) acc.openingPeak = openingPeak;
        else delete acc.openingPeak;
        if (!trackingValue && hadOpeningState) {
          new Notice("Tracking start cleared — the opening balance and pre-tracking peak were cleared with it.");
        }
        // Context is display-only: it never becomes trades or calculated metrics.
        const prevCount = parseInt(prevCountInput.value, 10);
        const prevWinRate = parseFloat(prevWinRateInput.value);
        const note = noteInput.value.trim();
        const ctx = { ...(acc.historicalContext ?? {}) };
        if (Number.isFinite(prevCount)) ctx.previousTradeCount = prevCount;
        else delete ctx.previousTradeCount;
        if (Number.isFinite(prevWinRate)) ctx.previousWinRate = prevWinRate;
        else delete ctx.previousWinRate;
        if (note) ctx.note = note;
        else delete ctx.note;
        if (Object.keys(ctx).length) acc.historicalContext = ctx;
        else delete acc.historicalContext;
        acc.type = selectedType as AccountType;
        // A funded account must not keep the evaluation's rules: when the type
        // changes, snap the program to one of the right phase (Select eval →
        // Select Funded, Growth → Growth Funded, and so on).
        const firmObj = view.firm;
        const currentProgram = view.program;
        if (firmObj && currentProgram && selectedType !== "unknown" && currentProgram.phase && currentProgram.phase !== selectedType) {
          const match = firmObj.programs.find((pr) => pr.phase === selectedType);
          if (match) acc.programId = match.id;
        }
        // Rules — the draft the pane edited. Only prop accounts carry them; a
        // personal/demo account saves none, so switching type clears the old ones.
        if (isPropType(selectedType as AccountType) || selectedType === "personal") {
          const rules: AccountRules = {};
          if (selectedType !== "personal" && ruleState.target) rules.target = ruleState.target;
          if (selectedType !== "personal" && ruleState.targetPct) rules.targetPct = ruleState.targetPct;
          if (ruleState.maxLoss) rules.maxLoss = ruleState.maxLoss;
          if (ruleState.maxLossPct) rules.maxLossPct = ruleState.maxLossPct;
          if (selectedType !== "personal" && ruleState.dailyLoss) rules.dailyLoss = ruleState.dailyLoss;
          if (selectedType !== "personal" && ruleState.consistency) rules.consistency = ruleState.consistency;
          if (ruleState.consistencyBasis) rules.consistencyBasis = ruleState.consistencyBasis;
          if (ruleState.maxLossType) rules.maxLossType = ruleState.maxLossType;
          if (ruleState.ddLockOffset) rules.ddLockOffset = ruleState.ddLockOffset;
          if (ruleState.posSize) rules.posSize = ruleState.posSize;
          if (selectedType !== "personal" && ruleState.minDays) rules.minDays = ruleState.minDays;
          if (selectedType !== "personal" && ruleState.dailyLossNote) rules.dailyLossNote = ruleState.dailyLossNote;
          acc.rules = Object.keys(rules).length ? rules : undefined;
        } else {
          acc.rules = undefined;
        }
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
        overlay.remove();
        this.render();
      })();
    });

    showTab("general");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-account-dash");
    const main = renderAppShell(root, this.plugin, "accounts");

    const acc = this.account();
    if (!acc) {
      // Point at the flow that actually creates an account — the Accounts page
      // wizard — not Settings, and let a missing/archived account be found where
      // it can be restored.
      const empty = main.createDiv({ cls: "tj-empty" });
      if (this.accountId) {
        empty.createDiv({ text: "This account no longer exists — it may have been deleted or archived." });
        empty
          .createEl("button", { text: "Open Accounts", cls: "mod-cta tj-btn", attr: { type: "button" } })
          .addEventListener("click", () => void this.plugin.openAccounts());
      } else {
        empty.createDiv({ text: "No accounts yet — create your first account to see its dashboard here." });
        empty
          .createEl("button", { text: "Create an account", cls: "mod-cta tj-btn", attr: { type: "button" } })
          .addEventListener("click", () => openAccountWizard(this.plugin, { onDone: () => void this.plugin.openAccounts() }));
      }
      return;
    }
    const view = resolveAccountView(acc);
    const size = view.rules;
    const header = main.createDiv({ cls: "tj-acc-header" });
    const titleWrap = header.createDiv({ cls: "tj-acc-titlewrap" });
    const backBtn = titleWrap.createEl("button", {
      cls: "tj-acc-back",
      text: "←",
      attr: { type: "button", "aria-label": "Back to Accounts" },
    });
    backBtn.addEventListener("click", () => void this.plugin.openAccounts());
    const title = titleWrap.createDiv();
    title.createEl("h1", { text: acc.name });
    const headerActions = header.createDiv({ cls: "tj-acc-actions" });

    // What is out of the account sits with the doors that open it: the gold
    // badge reads first, then the two squares (payouts, settings).
    this.renderPayoutLine(headerActions, acc);

    // Two squares, side by side: payouts, then settings. Both use the same
    // icon-button recipe so they line up as a pair instead of drifting. The
    // payouts square is the tinted one: it is the door money walks out of.
    if (acc.type === "funded" || acc.type === "live" || acc.type === "personal") {
      const payBtn = headerActions.createEl("button", {
        cls: "tj-iconbtn tj-iconbtn-payout",
        attr: { type: "button" },
      });
      setIcon(payBtn, "wallet");
      payBtn.createSpan({ cls: "tj-sr-only", text: "Payouts" });
      attachTip(payBtn, {
        title: "Payouts",
        sub: "Log what you took out — the account value and its distance to the limit follow.",
      });
      payBtn.addEventListener("click", () => openPayoutsModal(this.plugin, acc.id, () => this.render()));
    }

    // The correction square comes before the settings one: it fixes a number
    // and belongs with the account's own doors; settings is the way in, so it
    // sits last. The balance is computed further down, so the button reads it
    // when it is pressed, not when the header is drawn.
    let balanceNow = 0;
    const feesBtn = headerActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button" },
    });
    setIcon(feesBtn, "receipt");
    feesBtn.createSpan({ cls: "tj-sr-only", text: "Correct fees" });
    attachTip(feesBtn, {
      title: "Correct fees",
      sub: "Log the gap between this balance and the one the account really holds, as a dated adjustment.",
    });
    feesBtn.addEventListener("click", () => openFeeAdjustModal(this.plugin, acc.id, balanceNow, () => this.render()));

    const gearBtn = headerActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button" },
    });
    setIcon(gearBtn, "sliders-horizontal");
    gearBtn.createSpan({ cls: "tj-sr-only", text: "Account settings" });
    attachTip(gearBtn, { title: "Account settings", sub: "Rules, name, dates, size and type." });
    gearBtn.addEventListener("click", () => this.openEditAccountModal(acc, size, net));

    // The account's copy memory, on a line of its own under the title.
    this.renderCopyBar(main, acc);

    const scoped = this.scoped();
    const trackedAvailability = historyAvailability(acc, scoped.length);
    // No tracked trades means there is no performance to report: every
    // performance figure on this page reads "—" and says why, instead of a zero
    // that would read as bad trading. A tracked trade that closed flat is a real
    // zero and still shows, because then the data exists.
    const tracked = trackedAvailability === "tracked";
    const na = (value: string): string => trackedReading(acc, scoped.length, value);
    const naInfo = (info: string): string => trackedNote(acc, scoped.length, info);

    // The tracking boundary and any reported history are metadata about the
    // numbers, not the numbers themselves, so the page does not carry a
    // permanent banner about them. They are set and read in
    // Account settings → Information, which is the one place the trader audits
    // why their metrics begin where they do. The data is untouched here.

    const missingCostLegs = scoped.filter((trade) => {
      const coverage = tradeCostCoverage(trade);
      return !coverage.commission || !coverage.fees;
    }).length;
    const netCoverageNote = !scoped.length
      ? " No trades are recorded in this account history."
      : missingCostLegs
      ? ` Cost fields are incomplete on ${missingCostLegs} trade leg${missingCostLegs === 1 ? "" : "s"}; Net uses recorded cost amounts only, so missing costs are not confirmed zero.`
      : " Recorded commission and fee fields are present.";
    const byDay = new Map<string, { net: number; gross: number; count: number; wins: number }>();
    for (const t of scoped) {
      const key = this.dayKey(t);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { net: 0, gross: 0, count: 0, wins: 0 };
        byDay.set(key, bucket);
      }
      // net drives the balance/equity; gross drives the day-quality dots.
      bucket.net += netPnl(t);
      bucket.gross += t.pnl;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    // Cash that left or entered the account, per day. It is not trading: it only
    // moves the balance, and with it the distance to the loss limit. A payout
    // lowers the curve while the peak stays where it was, which is exactly what
    // the firm sees.
    const flowByDay = new Map<string, number>();
    for (const p of this.plugin.payoutsFor(acc.id)) flowByDay.set(p.date, (flowByDay.get(p.date) ?? 0) - Math.abs(p.amount));
    for (const d of this.plugin.depositsFor(acc.id)) flowByDay.set(d.date, (flowByDay.get(d.date) ?? 0) + Math.abs(d.amount));
    // Balance corrections move the account the same way, but they are not
    // payouts — they are kept apart so the tooltip can call them what they are.
    const adjustByDay = new Map<string, number>();
    for (const a of this.plugin.feeAdjustmentsFor(acc.id)) {
      adjustByDay.set(a.date, (adjustByDay.get(a.date) ?? 0) + a.amount);
      flowByDay.set(a.date, (flowByDay.get(a.date) ?? 0) + a.amount);
    }
    // One canonical balance: the shared movement engine (opening value + Net +
    // signed cashflows) is the only place the formula lives. The chart reuses
    // its dated series — the daily trading Net is read back from `byDay`, exactly
    // as the curve used to build it by hand.
    //
    // `capital` is the account's VALUE anchor: the declared balance at the
    // tracking boundary, or the configured size when there is none. `acc.size`
    // stays the RULE anchor and is only ever used for rule lines (target, floor
    // lock). The two must never be quietly swapped.
    const capital = this.plugin.openingCapitalOf(acc.id);
    const movement = computeRecordedAccountMovement({
      trades: scoped,
      size: capital,
      dayKey: (t) => this.dayKey(t),
      trackingStart: trackingStartOf(acc),
      cashflows: accountCashflows(
        this.plugin.payoutsFor(acc.id),
        this.plugin.depositsFor(acc.id),
        this.plugin.feeAdjustmentsFor(acc.id)
      ),
    });
    const series = movement.days.map((d) => ({ date: d.date, net: byDay.get(d.date)?.net ?? 0, cum: d.cumulative }));
    // The curve's own points, built by the shared helper: the opening value
    // first, then each recorded day's close — so the last point is exactly the
    // balance printed above it.
    const valueCurve = accountValueSeries(movement.days, capital);
    // Trading performance (target, consistency, win rate) ignores cash flows;
    // the balance does not.
    const net = [...byDay.values()].reduce((s, b) => s + b.net, 0);
    const balance = movement.balance;
    // The header's correction square reads this when it is pressed.
    balanceNow = balance;
    const targetApplies = acc.type === "eval";
    const targetReached = targetApplies && size.target > 0 ? net >= size.target : false;
    const targetPct = targetApplies && size.target > 0 ? Math.min(100, (net / size.target) * 100) : 0;

    // Eval passed. Two states, and the difference matters: the celebration is
    // shown ONCE; the quiet band is the memory of it, so an eval that comes back
    // from the archive is never congratulated a second time.
    const passedState = acc.type === "eval" && !!(acc.passedAt || acc.passKept || acc.linkedFundedId);
    if (acc.type === "eval" && targetReached && !passedState) {
      const banner = main.createDiv({ cls: "tj-acc-passed-banner" });
      const bannerBody = banner.createDiv({ cls: "tj-acc-passed-body" });
      const ring = bannerBody.createDiv({ cls: "tj-acc-passed-ring" });
      ring.createDiv({ cls: "tj-acc-passed-ring-inner", text: "\u2713" });
      const bannerText = bannerBody.createDiv({ cls: "tj-acc-passed-text" });
      bannerText.createEl("h4", { text: "You passed the evaluation" });
      bannerText.createDiv({ cls: "tj-acc-passed-detail", text: `${fmtMoney(net)} net P\u0026L \u00b7 target of $${size.target.toLocaleString()} reached` });
      // The funded account is a new account with a new value, and Tradebook
      // never carries money state across on its own. One line, here, where the
      // promotion happens — not a new step, and not silence.
      bannerText.createDiv({
        cls: "tj-acc-passed-detail",
        text: "The funded account starts fresh: you set its tracking date and opening balance yourself, so its numbers are yours from day one.",
      });
      const doUpgrade = async (action: "keep" | "archive" | "delete") => {
        const newId = await this.plugin.upgradeAccountToFunded(acc.id, action);
        if (newId) await this.plugin.openAccountDashboard(this.leaf, newId);
      };
      const btns = banner.createDiv({ cls: "tj-acc-passed-btns" });
      const goArchive = btns.createEl("button", { text: "Upgrade & archive", cls: "mod-cta tj-btn", attr: { type: "button" } });
      attachTip(goArchive, { title: "Upgrade & archive", sub: "Files this eval away for good; its trades stay in the vault." });
      goArchive.addEventListener("click", () => void doUpgrade("archive"));
      const goDelete = btns.createEl("button", { text: "Upgrade & delete", cls: "tj-btn tj-del", attr: { type: "button" } });
      attachTip(goDelete, { title: "Upgrade & delete", sub: "Removes this eval for good after creating the funded account. Asks twice." });
      goDelete.addEventListener("click", () => {
        void (async () => {
          void this.showDeleteConfirm(banner, acc, 1, () => { void doUpgrade("delete"); });
        })();
      });
      const goKeep = btns.createEl("button", { text: "Keep for now", cls: "tj-btn", attr: { type: "button" } });
      attachTip(goKeep, { title: "Keep for now", sub: "Keeps this eval here until you archive it." });
      goKeep.addEventListener("click", () => void doUpgrade("keep"));
    } else if (passedState) {
      // The memory: quiet, factual, and the archive is always the first offer.
      const band = main.createDiv({ cls: "tj-acc-passed-band" });
      const bandBody = band.createDiv({ cls: "tj-acc-passed-body" });
      bandBody.createDiv({ cls: "tj-acc-passed-ring" }).createDiv({ cls: "tj-acc-passed-ring-inner", text: "\u2713" });
      const bandText = bandBody.createDiv({ cls: "tj-acc-passed-text" });
      bandText.createEl("h4", {
        text: acc.passedAt ? `Passed on ${formatDate(acc.passedAt, this.plugin.settings.dateFormat)}` : "Passed",
      });
      const props = (this.plugin.settings.propAccounts ?? []);
      const linked = acc.linkedFundedId ? props.find((a) => a.id === acc.linkedFundedId) : undefined;
      // No link? Look for the funded this eval most likely produced before
      // offering to create one: same firm, program and size, and not already
      // claimed by another eval. With five fundeds around, "create" must be the
      // last resort, never the first button.
      const candidate =
        !linked
          ? props.find(
              (a) =>
                a.type === "funded" &&
                a.id !== acc.id &&
                a.firmId === acc.firmId &&
                a.programId === acc.programId &&
                a.size === acc.size &&
                (!a.linkedEvalId || a.linkedEvalId === acc.id),
            )
          : undefined;
      bandText.createDiv({
        cls: "tj-acc-passed-detail",
        text: linked
          ? `This eval is done — it went on to ${linked.name}. Everything below is its history.`
          : candidate
            ? `This eval is done. ${candidate.name} looks like the account it produced — you can link the two.`
            : "This eval is done. No funded account is linked to it.",
      });
      // A funded account is its own lifecycle with its own value: the tracking
      // date and the opening balance are set there, never carried over from the
      // eval. Said once, here, where the promotion is offered.
      if (!linked) {
        bandText.createDiv({
          cls: "tj-acc-passed-detail",
          text: "The funded account starts with its own tracking date and opening balance — you set both there, so none of this eval's money carries over.",
        });
      }
      const bandBtns = band.createDiv({ cls: "tj-acc-passed-btns" });
      if (linked) {
        // Named, and it only opens: no button here can create a second funded.
        const openFunded = bandBtns.createEl("button", { text: `Open ${linked.name}`, cls: "mod-cta tj-btn", attr: { type: "button" } });
        attachTip(openFunded, { title: `Open ${linked.name}`, sub: "Opens the funded account this eval is linked to. Nothing is created." });
        openFunded.addEventListener("click", () => void this.plugin.openAccountDashboard(this.leaf, linked.id));
        const relink = bandBtns.createEl("button", { text: "Not this one?", cls: "tj-btn", attr: { type: "button" } });
        attachTip(relink, { title: "Not this one?", sub: "Point this eval at a different funded account, or at none at all." });
        relink.addEventListener("click", () => this.showRelinkFunded(band, acc, props));
      } else if (candidate) {
        const linkBtn = bandBtns.createEl("button", { text: `Link to ${candidate.name}`, cls: "mod-cta tj-btn", attr: { type: "button" } });
        attachTip(linkBtn, { title: `Link to ${candidate.name}`, sub: "Links the two accounts; no account is created and no trade is touched." });
        linkBtn.addEventListener("click", () => void this.plugin.linkEvalToFunded(acc.id, candidate.id));
        const fresh = bandBtns.createEl("button", { text: "Create a new one", cls: "tj-btn", attr: { type: "button" } });
        attachTip(fresh, { title: "Create a new funded account", sub: "Only if that account is not the one this eval produced." });
        fresh.addEventListener("click", () => {
          this.showFundedCreateConfirm(band, acc, () => this.plugin.upgradeAccountToFunded(acc.id, "keep"));
        });
      } else {
        const create = bandBtns.createEl("button", { text: "Create the funded account", cls: "mod-cta tj-btn", attr: { type: "button" } });
        attachTip(create, { title: "Create the funded account", sub: "No funded account is linked to this eval — this makes one and links the two." });
        create.addEventListener("click", () => {
          this.showFundedCreateConfirm(band, acc, () => this.plugin.upgradeAccountToFunded(acc.id, "keep"));
        });
      }
      const bandArchive = bandBtns.createEl("button", { text: "Archive", cls: "tj-btn", attr: { type: "button" } });
      attachTip(bandArchive, { title: "Archive", sub: "Files it away for good: out of every view, still restorable from the Accounts page." });
      bandArchive.addEventListener("click", () => {
        void (async () => {
          await this.plugin.archiveAccount(acc.id);
          void this.plugin.openAccounts();
        })();
      });
      const bandDelete = bandBtns.createEl("button", { text: "Delete", cls: "tj-btn tj-del", attr: { type: "button" } });
      attachTip(bandDelete, { title: "Delete", sub: "Removes the account, its records and its trade notes for good." });
      bandDelete.addEventListener("click", () => {
        void this.showDeleteConfirm(band, acc, 1, () => {
          void (async () => {
            await this.plugin.removeAccount(acc.id);
            void this.plugin.openAccounts();
          })();
        });
      });
    }

    // ================= HERO: equity (0 = account value) + Risk ↔ Target =================
    // A funded account can offer more than one payout route, each with its own
    // rulebook (TopStep XFA: 5 winning days of $150+, or 3 days at 40%). The
    // route the trader picked wins over the firm's headline numbers.
    const M = computeAccountMetrics({
      trades: scoped,
      size: acc.size,
      capital,
      trackingStart: trackingStartOf(acc),
      openingPeak: openingPeakOf(acc) ?? undefined,
      target: size.target,
      maxLoss: size.maxLoss,
      ddLockOffset: size.ddLockOffset,
      ddNoLock: size.maxLossType === "eod-trailing-open",
      ddStatic: size.maxLossType === "static",
      ddRuleKnown: !!size.maxLossType,
      ddIntraday: size.maxLossType === "intraday-trailing",
      dailyLoss: size.dailyLoss,
      consistency: size.consistency,
      consistencyBasis: size.consistencyBasis,
      reentryWindowMinutes: this.plugin.settings.reentryWindowMinutes,
      dayKey: (t) => this.dayKey(t),
      todayKey: this.todayKey(),
      withdrawn: this.plugin.accountPayoutsTotal(acc.id),
      cashflows: accountCashflows(
        this.plugin.payoutsFor(acc.id),
        this.plugin.depositsFor(acc.id),
        this.plugin.feeAdjustmentsFor(acc.id)
      ),
    });

    // ---------- Discipline (shown on the back of the hero card) ----------
    const renderDisciplineCard = (host: HTMLElement) => {
      const top = host.createDiv({ cls: "tj-acc-disc-top" });
      const gauge = (label: string, pct: number, invert: boolean) => {
        const box = top.createDiv({ cls: "tj-acc-disc-gauge" });
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 72 72");
        const r = document.createElementNS(NS, "circle");
        r.setAttribute("cx", "36"); r.setAttribute("cy", "36"); r.setAttribute("r", "30");
        r.setAttribute("fill", "none"); r.setAttribute("stroke", "rgba(255,255,255,.07)"); r.setAttribute("stroke-width", "7");
        svg.appendChild(r);
        // Nothing tracked means nothing to grade: the ring keeps its place in the
        // card and stays empty, rather than painting a full or empty arc at zero.
        if (tracked) {
          const a = document.createElementNS(NS, "circle");
          a.setAttribute("cx", "36"); a.setAttribute("cy", "36"); a.setAttribute("r", "30");
          a.setAttribute("fill", "none");
          const good = invert ? pct <= 10 : pct >= 80;
          const mid = invert ? pct <= 30 : pct >= 40;
          a.setAttribute("stroke", good ? "var(--tj-tone-good)" : mid ? "var(--tj-tone-mid)" : "var(--tj-tone-bad)");
          a.setAttribute("stroke-width", "7"); a.setAttribute("stroke-linecap", "round");
          a.setAttribute("pathLength", "100");
          a.setAttribute("stroke-dasharray", `${Math.max(1, Math.min(100, pct))} 100`);
          a.setAttribute("transform", "rotate(-90 36 36)");
          svg.appendChild(a);
        }
        box.appendChild(svg);
        box.createDiv({ cls: "tj-acc-disc-num" + (tracked ? "" : " is-na"), text: na(`${pct.toFixed(0)}%`) });
        box.createDiv({ cls: "tj-acc-disc-lbl", text: label });
      };
      gauge("Clean trades", Math.max(0, 100 - M.mistakeRate), false);
      gauge("Reviewed", M.reviewedPct, false);

      // Discipline score: a bar with the same visual language as Risk ↔ Target.
      // A model, not a verdict — it never blocks anything.
      const score = Math.round(
        0.25 * Math.max(0, 100 - M.mistakeRate) +
          0.35 * M.reviewedPct +
          0.15 * M.stopDefinedPct +
          0.15 * Math.max(0, 100 - M.untaggedPct) +
          0.1 * ((M.avgRating / 5) * 100)
      );
      const band = score >= 70 ? "var(--tj-tone-good)" : score >= 45 ? "var(--tj-tone-mid)" : "var(--tj-tone-bad)";
      const scoreRow = top.createDiv({ cls: "tj-acc-dscore" });
      const scoreLeft = scoreRow.createDiv();
      scoreLeft.createDiv({ cls: "tj-acc-k", text: "Discipline score" });
      const scoreTrack = scoreRow.createDiv({ cls: "tj-acc-risktrack" + (tracked ? "" : " is-unavailable") });
      if (tracked) {
        const scoreFill = scoreTrack.createDiv({ cls: "tj-acc-dscore-fill" });
        scoreFill.style.width = `${Math.max(2, Math.min(100, score))}%`;
        scoreFill.style.background = band;
      }
      scoreRow.createDiv({ cls: "tj-acc-dscore-num" + (tracked ? "" : " is-na"), text: na(String(score)) });
      attachTip(scoreTrack, {
        title: "Discipline score",
        sub: naInfo("Model of recorded process fields; informational, not a trading verdict."),
      });
      const cols = host.createDiv({ cls: "tj-acc-mcols" });
      const habits = cols.createDiv({ cls: "tj-acc-mcol" });
      const behaviour = cols.createDiv({ cls: "tj-acc-mcol" });
      const dRow = (col: HTMLElement, label: string, value: string, tone: string, info: string) => {
        const row = col.createDiv({ cls: "tj-acc-mrow" });
        const k = row.createDiv({ cls: "tj-acc-mlabel" });
        k.createSpan({ text: label });
        const dot = k.createSpan({ cls: "tj-info-dot tj-tip-anchor" });
        setIcon(dot, "info");
        row.createEl("b", { cls: `tj-acc-mvalue ${tracked ? tone : "is-na"}`.trim(), text: na(value) });
        dot.addEventListener("mouseenter", () => showTip({ title: label, sub: naInfo(info) }, "tj-acc-facttip"));
        dot.addEventListener("mousemove", (e) => moveTip(e));
        dot.addEventListener("mouseleave", () => killTip());
      };
      habits.createDiv({ cls: "tj-acc-mgroup", text: "Habits" });
      dRow(habits, "Journal complete", `${M.reviewedPct.toFixed(0)}%`, M.reviewedPct >= 80 ? "tj-pos" : "tj-warn", "Trades reviewed: the full checklist (print, strategy, review, rating) or the trader's mark. Marking reviewed closes a decision without inventing fields.");
      dRow(habits, "Stop defined", `${M.stopDefinedPct.toFixed(0)}%`, M.stopDefinedPct >= 90 ? "tj-pos" : "tj-warn", "Trades where a risk is defined: the platform's own stop, or a default-risk rule you set (marked assumed).");
      dRow(habits, "Strategy tagged", `${(100 - M.untaggedPct).toFixed(0)}%`, M.untaggedPct > 30 ? "tj-warn" : "tj-pos", "Trades with a strategy tag.");
      dRow(habits, "Rating avg", M.avgRating ? M.avgRating.toFixed(1) : "—", M.avgRating >= 4 ? "tj-pos" : "", "Average execution/quality rating you gave yourself.");

      behaviour.createDiv({ cls: "tj-acc-mgroup", text: "Behaviour" });
      dRow(behaviour, "Trades / day", M.tradesPerDay ? M.tradesPerDay.toFixed(1) : "—", "", "Average trades per active day.");
      dRow(behaviour, "Max / day", String(M.maxTradesInDay), "", "Most trades taken in a single day.");
      const reentryMins = this.plugin.settings.reentryWindowMinutes ?? 15;
      dRow(behaviour, "Revenge trades", `${M.revengeCount} (${M.revengeRate.toFixed(0)}%)`, M.revengeCount > 0 ? "tj-warn" : "", `Entered within ${reentryMins} minutes of a same-symbol loss, or flagged as a mistake after a loss.`);
      dRow(behaviour, "After two losses (tilt)", String(M.afterTwoLosses), M.afterTwoLosses > 0 ? "tj-warn" : "", "Trades opened after two consecutive losses.");
      dRow(behaviour, "Trades < 1 min", `${M.fastTradesPct.toFixed(0)}%`, M.fastTradesPct > 20 ? "tj-warn" : "", "Trades held for under a minute.");
      dRow(behaviour, "Streak now", M.streakCurrent === 0 ? "—" : `${Math.abs(M.streakCurrent)} ${M.streakCurrent > 0 ? "wins" : "losses"}`, M.streakCurrent < 0 ? "tj-neg" : M.streakCurrent > 0 ? "tj-pos" : "", "Current win/loss streak.");
      dRow(behaviour, "Best / worst streak", `${M.streakWinBest}W / ${M.streakLossWorst}L`, "", "Longest winning and losing runs.");
    };

    const mkDonut = (host: HTMLElement, label: string, pct: number, sub: string) => {
      const box = host.createDiv({ cls: "tj-acc-dial" });
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 104 104");
      svg.setAttribute("class", "tj-acc-donut");
      const ring = document.createElementNS(NS, "circle");
      ring.setAttribute("cx", "52"); ring.setAttribute("cy", "52"); ring.setAttribute("r", "44");
      ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "rgba(255,255,255,.07)"); ring.setAttribute("stroke-width", "9");
      const arc = document.createElementNS(NS, "circle");
      arc.setAttribute("cx", "52"); arc.setAttribute("cy", "52"); arc.setAttribute("r", "44");
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", pct >= 50 ? "var(--tj-tone-good)" : pct >= 40 ? "var(--tj-tone-mid)" : "var(--tj-tone-bad)");
      arc.setAttribute("stroke-width", "9"); arc.setAttribute("stroke-linecap", "round");
      arc.setAttribute("pathLength", "100");
      arc.setAttribute("stroke-dasharray", `${Math.max(0, Math.min(100, pct))} 100`);
      arc.setAttribute("transform", "rotate(-90 52 52)");
      svg.appendChild(ring);
      // No tracked trades: the dial keeps its place and reads "—". An arc at 0%
      // would be a performance verdict nobody has earned yet.
      if (tracked) svg.appendChild(arc);
      box.appendChild(svg);
      box.createDiv({ cls: "tj-acc-dial-num" + (tracked ? "" : " is-na"), text: na(`${pct.toFixed(0)}%`) });
      box.createDiv({ cls: "tj-acc-dial-lbl", text: label });
      box.createDiv({ cls: "tj-acc-dial-sub", text: sub });
      if (!tracked) attachTip(box, { title: label, sub: NO_TRACKED_DATA_NOTE });
    };
    const hero = main.createDiv({ cls: "tj-acc-hero" });
    const heroLeft = hero.createDiv({ cls: "tj-acc-heroleft" });

    const eqCard = heroLeft.createDiv({ cls: "tj-acc-eqcard" });
    const eqHead = eqCard.createDiv({ cls: "tj-acc-eqhead" });
    const eqTitleRow = eqHead.createDiv({ cls: "tj-acc-eqtitlerow" });
    const eqTitle = eqTitleRow.createDiv({ cls: "tj-acc-k", text: "Account Balance" });
    attachTip(eqTitle, {
      title: "Recorded account balance",
      sub: `This account's value when tracking started (${fmtMoney(capital)}), plus every recorded trading result, payout, deposit and correction since — not live broker equity.${netCoverageNote}`,
    });
    // Streak dots (last 20 trading days) — top right, same line as title
    if (byDay.size > 0) {
      const eqRight = eqTitleRow.createDiv({ cls: "tj-acc-eqright" });
      const streakRow = eqRight.createDiv({ cls: "tj-acc-streakrow" });
      const last20 = [...byDay.keys()].sort().slice(-20);
      for (const d of last20) {
        const b = byDay.get(d)!;
        const dot = streakRow.createDiv({
          cls: "tj-acc-streakdot " + (b.gross > 0 ? "tj-acc-streak-win" : b.gross < 0 ? "tj-acc-streak-loss" : "tj-acc-streak-be"),
          attr: { "aria-label": `${d}: ${fmtMoney(b.gross)} (${b.count} trades)` },
        });
        attachTip(dot, { title: d, value: fmtMoney(b.gross), tone: b.gross >= 0 ? "pos" : "neg", sub: `${b.count} trades` });
      }
    }
    const eqVal = eqHead.createDiv({ cls: "tj-acc-eqval" });
    // To the cent, always: this is the number every other one has to reconcile
    // against, and a rounded balance cannot be checked against the platform.
    eqVal.createSpan({
      cls: "tj-acc-big",
      text: `$${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    });
    const eqChart = eqCard.createDiv({ cls: "tj-acc-eqchart" });
    if (series.length) {
      const balances = valueCurve;
      const ddLevels: number[] = [];
      if (size.maxLoss) {
        // Rule lines stay on `acc.size`: the floor lock point is defined by the
        // account's rules, not by where the account happens to be worth now.
        // Drawn against the value curve, the gap between the two lines is the
        // room to the floor, which is what the reader is being told.
        let runPeak = capital;
        for (const bal of balances) {
          runPeak = Math.max(runPeak, bal);
          // Trails the running peak, then locks at the firm's point (Tradeify
          // +$100 above the starting balance; TopStep locks at break-even).
          // A firm that never locks keeps the floor on the peak instead.
          const level =
            size.maxLossType === "static"
              ? acc.size - size.maxLoss
              : size.maxLossType === "eod-trailing-open"
                ? runPeak - size.maxLoss
                : Math.min(acc.size + (size.ddLockOffset ?? 0), runPeak - size.maxLoss);
          ddLevels.push(Math.round(level));
        }
      }
      renderLineChart(eqChart, {
        values: balances,
        dates: [series[0]?.date ?? "", ...series.map((s2) => s2.date)],
        baseline: capital,
        baseLine: capital,
        fadeFloor: capital,
        targetLine: targetApplies && size.target ? acc.size + size.target : undefined,
        ddLine: ddLevels.length === balances.length ? ddLevels : undefined,
        dayDeltas: [0, ...series.map((s2) => s2.net)],
        // A cash day is marked by what it was: a payout (gold), a deposit (green)
        // or a fee correction (a cost — never the payout gold).
        dayCash: series.flatMap((s2, k) => {
          const flow = (flowByDay.get(s2.date) ?? 0) - (adjustByDay.get(s2.date) ?? 0);
          const adj = adjustByDay.get(s2.date) ?? 0;
          const kind = flow < 0 ? ("out" as const) : flow > 0 ? ("in" as const) : adj !== 0 ? ("cost" as const) : null;
          return kind ? [{ index: k + 1, kind }] : [];
        }),
        hoverLines: (i) => {
          const s2 = i > 0 ? series[i - 1] : undefined;
          const rows2: Array<[string, string, string]> = [
            ["Trades", s2 ? String(byDay.get(s2.date)?.count ?? 0) : "0", ""],
            ["Day Net", s2 ? fmtMoney(s2.net) : "—", s2 && s2.net < 0 ? "tj-neg" : s2 && s2.net > 0 ? "tj-pos" : ""],
          ];
          const flow = (s2 ? flowByDay.get(s2.date) ?? 0 : 0) - (s2 ? adjustByDay.get(s2.date) ?? 0 : 0);
          if (flow < 0) rows2.push(["Payout", fmtMoney(Math.abs(flow)), "tj-cash"]);
          if (flow > 0) rows2.push(["Deposit", fmtMoney(flow), "tj-pos"]);
          const adj = s2 ? adjustByDay.get(s2.date) ?? 0 : 0;
          if (adj !== 0) rows2.push(["Balance adjustment", fmtMoney(adj), "tj-cost"]);
          if (ddLevels.length) rows2.push(["Drawdown level", fmtMoney(ddLevels[i] ?? 0), ""]);
          if (size.target) rows2.push(["Target", fmtMoney(acc.size + size.target), "tj-pos"]);
          return rows2;
        },
        key: `account:${acc.id}`,
        format: this.plugin.settings.dateFormat,
        animations: this.plugin.settings.animations !== false,
      });
    } else {
      eqChart.createDiv({ cls: "tj-empty", text: "No trades yet — import your history or add a trade to see the curve." });
    }

    const heroBreak = heroLeft.createDiv({ cls: "tj-acc-herobreak" });
    const riskCard = hero.createDiv({ cls: "tj-acc-riskcard tj-acc-flipcard" });
    let flipped = false;
    const flipBtn = riskCard.createEl("button", { cls: "tj-acc-flipbtn", attr: { type: "button" } });
    setIcon(flipBtn, "arrow-left-right");
    flipBtn.createSpan({ cls: "tj-sr-only", text: "Flip card" });
    attachTip(flipBtn, { title: "Flip card", sub: "Limits on one side, discipline on the other." });
    const front = riskCard.createDiv({ cls: "tj-acc-flipface tj-acc-ffront" });
    const back = riskCard.createDiv({ cls: "tj-acc-flipface tj-acc-fback" });
    back.addClass("is-hidden");
    const backHead = back.createDiv({ cls: "tj-acc-riskhead" });
    backHead.createDiv({ cls: "tj-acc-k", text: "Discipline · habits & behaviour" });
    const riskHead = front.createDiv({ cls: "tj-acc-riskhead" });
    const targetRange = acc.type === "eval" && size.target > 0;
    riskHead.createDiv({ cls: "tj-acc-k", text: targetRange ? "Risk and target" : "Account risk" });
    const riskChart = front.createDiv({ cls: "tj-acc-riskchart" });
    const riskDials = riskChart.createDiv({ cls: "tj-acc-riskdials" });
    mkDonut(riskDials, "Win rate", M.winRate, "");
    mkDonut(riskDials, "Day win rate", M.dayWinRate, "");
    const barCol = riskChart.createDiv({ cls: "tj-acc-riskbarcol" });
    if (size.maxLoss > 0) {
      const summary = barCol.createDiv({ cls: "tj-acc-risk-summary" });
      const riskStat = (label: string, value: string, tone = "") => {
        const stat = summary.createDiv({ cls: "tj-acc-risk-stat" });
        stat.createSpan({ cls: "tj-acc-risk-stat-k", text: label });
        stat.createSpan({ cls: `tj-acc-risk-stat-v ${tone}`.trim(), text: value });
      };
      const riskApplies = acc.type === "funded" || acc.type === "live" || acc.type === "personal";
      riskStat(riskApplies ? "Loss allowance" : "Evaluation loss limit", `−${fmtMoney(size.maxLoss)}`);
      riskStat("Current floor", M.drawdownFloor === null ? "Unavailable" : fmtMoney(M.drawdownFloor));
      riskStat("Used", M.drawdownUsed === null ? "Unavailable" : fmtMoney(M.drawdownUsed), M.drawdownUsed === null ? "" : M.drawdownUsed > 0 ? "tj-neg" : "tj-pos");
      riskStat("Room to floor", M.drawdownRoom === null ? "Unavailable" : fmtMoney(M.drawdownRoom));
      if (targetRange) riskStat("Profit target", `+${fmtMoney(size.target)}`, "tj-pos");

      const ddKnown = M.drawdownFloor !== null && M.drawdownUsed !== null && M.drawdownRoom !== null;
      // Why it is unknown, when it is: a trailing floor needs the account's
      // pre-tracking peak, which only the trader can supply.
      const trackStart = trackingStartOf(acc);
      const missingPeak =
        !!size.maxLossType &&
        size.maxLossType !== "static" &&
        size.maxLossType !== "intraday-trailing" &&
        !ddKnown;
      const ddPct = ddKnown ? Math.max(0, (M.drawdownUsed! / size.maxLoss) * 100) : 0;
      const roomPct = ddKnown ? Math.max(0, (M.drawdownRoom! / size.maxLoss) * 100) : 0;
      const ddStatus = !ddKnown ? "unknown" : M.drawdownRoom! <= 0 ? "breached" : ddPct >= 75 ? "critical" : ddPct >= 50 ? "warning" : "safe";
      const ddHead = barCol.createDiv({ cls: "tj-acc-ddhead" });
      ddHead.createSpan({ cls: "tj-acc-k", text: riskApplies ? "Room to loss floor" : "Evaluation drawdown used" });
      const badge = ddHead.createSpan({ cls: `tj-acc-ddbadge tj-acc-ddbadge-${ddStatus}` });
      badge.setText(ddStatus === "unknown" ? "UNAVAILABLE" : ddStatus === "breached" ? "BREACHED" : ddStatus === "critical" ? "CRITICAL" : ddStatus === "warning" ? "WARNING" : "WITHIN LIMIT");
      const ddl = drawdownLabel(size);
      const ddTip = ddHead.createSpan({ cls: "tj-info-dot" });
      setIcon(ddTip, "info");
      attachTip(ddTip, {
        title: ddKnown ? ddl.label : "Drawdown model unavailable",
        sub: ddKnown
          ? `${ddl.lock} Floor movement follows this account's configured rule, drawn from its size of ${fmtMoney(acc.size)}; its recorded value is ${fmtMoney(M.balance)}. Neither is live broker equity.`
          : size.maxLossType === "intraday-trailing"
            ? "Intraday trailing needs intraday equity history, which this journal does not record."
            : missingPeak
              ? `A trailing floor follows the account's highest balance, and this account started being tracked on ${formatDate(trackStart || "", this.plugin.settings.dateFormat)} — the peak before that date is not in the journal. Add "Highest value before tracking" in account Settings, and the floor, used amount and room are calculated from it.`
              : "Set a drawdown type in account Rules to calculate the floor, used amount and room accurately.",
      });
      const track = barCol.createDiv({ cls: `tj-acc-risktrack${ddKnown ? "" : " is-unavailable"}${ddKnown && M.drawdownRoom! <= 0 ? " is-reached" : ""}` });
      if (riskApplies && ddKnown) {
        attachTip(track, {
          title: `${fmtMoney(M.drawdownRoom!)} room to floor`,
          sub: `Balance ${fmtMoney(M.balance)} · floor ${fmtMoney(M.drawdownFloor!)}; bar vs the ${fmtMoney(size.maxLoss)} allowance. Journal record, not a verified liquidation threshold.`,
        });
      }
      if (ddKnown && acc.type === "eval") {
        // Two anchors, both named: the ends of the scale are the account's RULES
        // (floor and target, defined from the configured size), while the zero
        // the marker moves from is the account's VALUE at the tracking boundary.
        // Anchoring the zero on the value is what stops a tracked-in-halfway
        // account from looking like it started full.
        const floor = acc.size - size.maxLoss;
        const ceiling = acc.size + size.target;
        const span = Math.max(1, ceiling - floor);
        const zeroPct = ((capital - floor) / span) * 100;
        const balancePct = Math.max(0, Math.min(100, ((M.balance - floor) / span) * 100));
        track.addClass("is-evaluation");
        const evalTrack = track;
        const positive = evalTrack.createDiv({ cls: "tj-acc-eval-positive" });
        positive.style.left = `${zeroPct}%`;
        positive.style.width = `${Math.max(0, 100 - zeroPct)}%`;
        const negative = evalTrack.createDiv({ cls: "tj-acc-eval-negative" });
        negative.setCssStyles({ left: "0" });
        negative.style.width = `${zeroPct}%`;
        const zero = evalTrack.createDiv({ cls: "tj-acc-eval-zero" });
        zero.style.left = `${zeroPct}%`;
        const progress = evalTrack.createDiv({ cls: "tj-acc-eval-progress" });
        progress.style.left = `${balancePct}%`;
        attachTip(progress, {
          title: `Recorded balance ${fmtMoney(M.balance)}`,
          sub: `Zero is this account's value at the tracking start (${fmtMoney(capital)}). Scale: rule floor ${fmtMoney(floor)} → rule target ${fmtMoney(ceiling)}, from the configured size ${fmtMoney(acc.size)}. Tracked Net toward the target is in Limits.`,
        });
      } else if (ddKnown) {
        const visualPct = riskApplies ? roomPct : ddPct;
        const fill = track.createDiv({ cls: `tj-acc-risk-used${visualPct === 0 ? " is-zero" : ""}` });
        fill.style.width = `${Math.min(100, visualPct)}%`;
        fill.style.background = M.drawdownRoom! <= 0 ? "var(--tj-tone-bad)" : riskApplies ? roomPct <= 25 ? "var(--tj-tone-bad)" : roomPct <= 50 ? "var(--tj-tone-mid)" : "var(--tj-tone-good)" : ddPct >= 75 ? "var(--tj-tone-bad)" : ddPct >= 50 ? "var(--tj-tone-mid)" : "var(--tj-tone-good)";
      } else {
        track.createSpan({ cls: "tj-acc-risk-empty", text: "Drawdown calculation unavailable" });
      }
      const riskAxis = barCol.createDiv({ cls: "tj-acc-riskaxis" });
      // An unknown floor is not a $0 floor. The axis says so instead of printing
      // a number nobody can act on.
      if (ddKnown) {
        riskAxis.createSpan({ text: `${fmtMoney(M.drawdownRoom!)} room to floor` });
        riskAxis.createSpan({ text: `Floor ${fmtMoney(M.drawdownFloor!)}` });
      } else {
        riskAxis.createSpan({ text: "Drawdown state unavailable" });
      }
    } else {
      const unavailable = barCol.createDiv({ cls: "tj-acc-risk-summary" });
      unavailable.createDiv({ cls: "tj-acc-risk-empty", text: "No maximum-loss limit configured" });
      if (targetRange) {
        const targetStat = unavailable.createDiv({ cls: "tj-acc-risk-stat" });
        targetStat.createSpan({ cls: "tj-acc-risk-stat-k", text: "Evaluation target" });
        targetStat.createSpan({ cls: "tj-acc-risk-stat-v tj-pos", text: `+${fmtMoney(size.target)}` });
      }
    }

    const metricCols = front.createDiv({ cls: "tj-acc-mcols" });
    const limitsCol = metricCols.createDiv({ cls: "tj-acc-mcol" });
    const perfCol = metricCols.createDiv({ cls: "tj-acc-mcol" });

    const mRow = (col: HTMLElement, label: string, value: string, tone: string, info: string) => {
      const row = col.createDiv({ cls: "tj-acc-mrow" });
      const k = row.createDiv({ cls: "tj-acc-mlabel" });
      k.createSpan({ text: label });
      const dot = k.createSpan({ cls: "tj-info-dot tj-tip-anchor" });
      setIcon(dot, "info");
      row.createEl("b", { cls: `tj-acc-mvalue ${tone}`.trim(), text: value });
      dot.addEventListener("mouseenter", () => showTip({ title: label, sub: info }, "tj-acc-facttip"));
      dot.addEventListener("mousemove", (e) => moveTip(e));
      dot.addEventListener("mouseleave", () => killTip());
    };

    limitsCol.createDiv({ cls: "tj-acc-mgroup", text: "Limits" });
    const todayTrades = scoped.filter((t) => this.dayKey(t) === this.todayKey()).length;
    // Two kinds of row live in this column, and they fall silent differently:
    //  - a RULE (the target, the daily limit, the required days) is configured
    //    and stays true with no trades at all — it is never blanked;
    //  - RECORDED USAGE or a performance measure needs a sample, so with no
    //    tracked trades it reads "—" (or "0 tracked days" when the sample size
    //    is the point) instead of a zero that would read as a failed rule.
    const usageRow = (label: string, value: string, tone: string, info: string) =>
      mRow(limitsCol, label, tracked ? value : "—", tracked ? tone : "is-na", naInfo(info));
    mRow(limitsCol, "Today", todayTrades ? `${fmtMoney(M.todayNet)} · ${todayTrades}` : "—", M.todayNet < 0 ? "tj-neg" : M.todayNet > 0 ? "tj-pos" : "", `Today's Net trading result.${netCoverageNote}`);
    if (targetApplies && size.target) usageRow("Target progress", `${targetPct.toFixed(0)}%`, "", "Net trading result toward the evaluation target.");
    if (targetApplies && size.target && M.daysToTarget !== null) mRow(limitsCol, "Days to target", `~${M.daysToTarget}`, "", "Estimate from current average Net pace.");
    if (size.dailyLoss && (acc.type === "eval" || acc.type === "funded" || acc.type === "live")) mRow(limitsCol, "Daily room", fmtMoney(M.dailyLossRemaining), M.dailyLossRemaining > 0 ? "" : "tj-neg", "Daily loss limit minus today's Net losses. The rule is configured; this is today's remaining room.");
    if (size.dailyLoss && (acc.type === "eval" || acc.type === "funded" || acc.type === "live")) usageRow("Worst day vs limit", `${M.worstDayPctOfLimit.toFixed(0)}%`, M.worstDayPctOfLimit > 80 ? "tj-neg" : "", "Worst recorded Net loss day ÷ daily limit.");
    if (size.consistency > 0 && (acc.type === "eval" || acc.type === "funded")) {
      // The rule stays on screen: with no tracked days the value is unmeasured,
      // and saying how many days were measured is the honest alternative.
      mRow(
        limitsCol,
        "Consistency",
        tracked ? `${M.consistencyPct.toFixed(0)}% / ${size.consistency}%` : `— · rule ${size.consistency}%`,
        tracked ? (M.consistencyPct <= size.consistency ? "tj-pos" : "tj-neg") : "is-na",
        naInfo(M.impliedTarget > size.target ? `Biggest day needs ${fmtMoney(M.impliedTarget)} total profit to satisfy the rule.` : "Best day stays within the limit."),
      );
    }
    const minDays = size.minDays ?? 0;
    if (minDays > 0 && (acc.type === "eval" || acc.type === "funded")) {
      const daysLeft = Math.max(0, minDays - M.winDays);
      mRow(
        limitsCol,
        acc.type === "funded" ? "Payout winning days" : "Passing days",
        tracked ? `${M.winDays} of ${minDays} days` : `— · needs ${minDays} days`,
        tracked ? (M.winDays >= minDays ? "tj-pos" : "") : "is-na",
        naInfo(
          `Model: days that closed positive. ${
            daysLeft > 0 ? `${daysLeft} to go.` : "Requirement met."
          }`,
        ),
      );
    }
    if (size.maxLoss && (acc.type === "eval" || acc.type === "funded" || acc.type === "live")) usageRow("Max trading drawdown", fmtMoney(-M.maxDrawdown), "tj-neg", "Largest peak-to-trough Net trading decline. The loss allowance itself is in Account risk.");
    if (M.avgRiskMoney) mRow(limitsCol, "Avg risk / trade", `${fmtMoney(M.avgRiskMoney)} · ${M.avgRiskR.toFixed(2)}R`, "", "Average risk per trade.");

    perfCol.createDiv({ cls: "tj-acc-mgroup", text: "Performance" });
    // Every row in this column is a performance reading, so they all fall silent
    // together when the tracked population is empty — one rule, one gate.
    const perfRow = (label: string, value: string, tone: string, info: string) =>
      mRow(perfCol, label, na(value), tracked ? tone : "is-na", naInfo(info));
    // The account's own Net P&L, named for its scope: this page reads one
    // account, so it can never be mistaken for the portfolio or a decision.
    perfRow("Account Net P&L", fmtMoney(M.net), M.net >= 0 ? "tj-pos" : "tj-neg", "Net result of this account's recorded trades, after recorded costs. Payouts and deposits move the balance, not this number.");
    perfRow("Gross profit factor", Number.isFinite(M.grossProfitFactor) ? M.grossProfitFactor.toFixed(2) : M.grossProfitFactor > 0 ? "∞" : "—", "", "Gross winning results divided by gross losing results, before recorded costs.");
    perfRow("Net result per trade", fmtMoney(M.expectancy), M.expectancy >= 0 ? "tj-pos" : "tj-neg", "Average Net result per recorded trade.");
    perfRow("Avg win / loss", M.avgLoss ? `${fmtMoney(M.avgWin)} / ${fmtMoney(-M.avgLoss)}` : fmtMoney(M.avgWin), "", "Average positive and negative Net trade results.");
    perfRow("Reached 1R", M.pctGE1R ? `${M.pctGE1R.toFixed(0)}%` : "—", "", "How often a trade reached at least 1R.");
    perfRow("Best Net day", fmtMoney(M.bestDay), "tj-pos", "Highest daily Net trading result.");
    perfRow("Worst Net day", fmtMoney(M.worstDay), "tj-neg", "Lowest daily Net trading result.");
    perfRow("Biggest win", M.largestWin ? fmtMoney(M.largestWin) : "—", "tj-pos", "Largest single winning trade.");
    perfRow("Biggest loss", M.largestLoss ? fmtMoney(M.largestLoss) : "—", "tj-neg", "Largest single losing trade.");

    renderDisciplineCard(back);
    flipBtn.addEventListener("click", () => {
      flipped = !flipped;
      front.toggleClass("is-hidden", flipped);
      back.toggleClass("is-hidden", !flipped);
      const show = flipped ? back : front;
      show.addClass("tj-acc-flipin");
      window.setTimeout(() => show.removeClass("tj-acc-flipin"), 320);
    });

    // Every figure the page shows is read straight off `M` (one metrics engine);
    // there is no second aggregation here to keep in sync.

    // active breakdown filter (drives the trades widget below — seamless transition)
    let bdFilter: { label: string; test: (t: Trade) => boolean } | null = null;
    let refreshTrades: () => void = () => {};

    const groupBy = (keyFn: (t: Trade) => string): Array<[string, { net: number; count: number; wins: number }]> => {
      const map = new Map<string, { net: number; count: number; wins: number }>();
      for (const t of scoped) {
        const k = keyFn(t) || "—";
        const b = map.get(k) ?? { net: 0, count: 0, wins: 0 };
        b.net += netPnl(t); b.count += 1; if (t.pnl > 0) b.wins += 1;
        map.set(k, b);
      }
      return [...map.entries()].sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net));
    };
    const groupByAll = (keyFn: (t: Trade) => string): Array<[string, { net: number; count: number; wins: number }]> => {
      const map = new Map<string, { net: number; count: number; wins: number }>();
      for (const t of scoped) {
        const k = keyFn(t) || "—";
        const b = map.get(k) ?? { net: 0, count: 0, wins: 0 };
        b.net += netPnl(t); b.count += 1; if (t.pnl > 0) b.wins += 1;
        map.set(k, b);
      }
      return [...map.entries()];
    };

    const renderBars = (
      host: HTMLElement,
      rows: Array<[string, { net: number; count: number; wins: number }]>,
      keyFn?: (t: Trade) => string
    ) => {
      if (!rows.length) {
        host.createDiv({ cls: "tj-empty", text: "No data yet — this account has no trades in the current selection." });
        return;
      }
      const totalTrades = rows.reduce((a, [, b]) => a + b.count, 0) || 1;
      const maxAbs = Math.max(...rows.map(([, b]) => Math.abs(b.net)), 1);

      // compact treemap: tile width ∝ trades, colour ∝ result
      const MAXT = 6;
      let tiles = rows;
      if (rows.length > MAXT) {
        const head6 = rows.slice(0, MAXT);
        const rest = rows.slice(MAXT);
        const merged = rest.reduce(
          (a, [, b]) => ({ net: a.net + b.net, count: a.count + b.count, wins: a.wins + b.wins }),
          { net: 0, count: 0, wins: 0 }
        );
        tiles = [...head6, ["Other", merged]] as Array<[string, { net: number; count: number; wins: number }]>;
      }
      const moneyShort = (v: number) => {
        const a = Math.abs(v);
        const body = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : a.toFixed(0);
        return `${v < 0 ? "-" : "+"}$${body}`;
      };
      const map = host.createDiv({ cls: "tj-acc-treemap" });
      for (const [name, b] of tiles) {
        const tile = map.createDiv({ cls: "tj-acc-tile" });
        tile.style.flex = `${Math.max(1, b.count)} 1 0`;
        const win = winOf(b);
        const good = b.net >= 0;
        const strength = 0.14 + (Math.abs(b.net) / maxAbs) * 0.34;
        const tone = good ? "var(--tj-chart-good)" : "var(--tj-chart-bad)";
        tile.style.background = `linear-gradient(160deg, color-mix(in srgb, ${tone} ${Math.round(strength * 100)}%, transparent), color-mix(in srgb, ${tone} ${Math.round(strength * 50)}%, transparent))`;
        tile.createDiv({ cls: "tj-acc-tile-t", text: name });
        tile.createDiv({ cls: `tj-acc-tile-v ${good ? "tj-pos" : "tj-neg"}`, text: moneyShort(b.net) });
        tile.createDiv({ cls: "tj-acc-tile-w", text: `${Math.round(win)}% win` });
        // rich hover card (same language as the rest of the plugin)
        tile.addClass("tj-tip-anchor");
        const share = (b.count / totalTrades) * 100;
        tile.addEventListener("mouseenter", () =>
          showTip(
            {
              title: name,
              value: fmtMoney(b.net),
              tone: b.net >= 0 ? "pos" : "neg",
              sub: `${b.count} trades (${share.toFixed(0)}% of activity) · ${Math.round(win)}% win · avg ${moneyShort(b.count ? b.net / b.count : 0)}/trade`,
            },
            "tj-acc-tiletip"
          )
        );
        tile.addEventListener("mousemove", (e) => moveTip(e));
        tile.addEventListener("mouseleave", () => killTip());
        if (keyFn && !(name === "Other" && rows.length > MAXT)) {
          tile.addClass("tj-acc-tile-click");
          if (bdFilter?.label === name) tile.addClass("is-active");
          attachTip(tile, { title: name, sub: `Click to show only "${name}" in the trades below.` }, "tj-acc-tiletip");
          tile.addEventListener("click", () => {
            bdFilter = { label: name, test: (t) => (keyFn(t) || "—") === name };
            host.querySelectorAll(".tj-acc-tile").forEach((n) => n.removeClass("is-active"));
            tile.addClass("is-active");
            refreshTrades();
          });
        }
      }
      // auto-fit: tiny tiles shrink values
      window.requestAnimationFrame(() => {
        for (const child of Array.from(map.children) as HTMLElement[]) {
          const w = child.clientWidth;
          if (w < 62) child.addClass("is-tiny");
          else if (w < 96) child.addClass("is-narrow");
          else if (w < 120) child.addClass("is-compact");
        }
      });
    };

    // ---- Breakdowns (fixed under the equity chart; filters the trades below) ----
    const bdHead = heroBreak.createDiv({ cls: "tj-acc-bdhead" });
    bdHead.createDiv({ cls: "tj-acc-k", text: "Breakdowns" });
    const bdTabs = bdHead.createDiv({ cls: "tj-acc-btabs" });
    const bdBody = heroBreak.createDiv({ cls: "tj-acc-bbody" });
    const WD_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const hourOrder = (label: string) => {
      const m = /^(\d{1,2})(am|pm)$/.exec(label);
      if (!m) return 99;
      const h = parseInt(m[1], 10) % 12;
      return m[2] === "pm" ? h + 12 : h;
    };
    const bdDims: Array<[string, string, (t: Trade) => string, (label: string) => number]> = [
      ["direction", "Direction", (t) => (t.direction === "long" ? "Long" : "Short"), () => 0],
      ["symbol", "Symbol", (t) => t.symbol, () => 0],
      ["setup", "Strategy", (t) => t.setup, () => 0],
      ["weekday", "Weekday", (t) => this.weekdayOf(t), (l) => (WD_ORDER.indexOf(l) < 0 ? 99 : WD_ORDER.indexOf(l))],
      ["hour", "Hour", (t) => this.hourBlockOf(t), hourOrder],
      // Regular session vs overnight: the split that says whether the hours
      // outside the cash session are paying for themselves.
      ["session", "Session", (t) => sessionLabel(t, this.plugin.settings.timeZone), sessionRank],
    ];
    const bdButtons = new Map<string, HTMLElement>();
    const winOf = (b: { count: number; wins: number }) => (b.count ? (b.wins / b.count) * 100 : 0);
    const bdSelect = (id: string) => {
      for (const [key, btn] of bdButtons) btn.toggleClass("on", key === id);
      bdBody.empty();
      const dim = bdDims.find((d) => d[0] === id) ?? bdDims[0];
      let rows = groupBy(dim[2]);
      if (id === "weekday" || id === "hour" || id === "session") {
        // chronological order instead of by size
        rows = groupByAll(dim[2]).sort((a, b) => dim[3](a[0]) - dim[3](b[0]));
      }
      renderBars(bdBody, rows, dim[2]);
    };
    for (const [id, label] of bdDims) {
      const b = bdTabs.createEl("button", {
        cls: "tj-acc-btab" + ((this.plugin.settings.accountBreakdownTab ?? "symbol") === id ? " on" : ""),
        text: label,
        attr: { type: "button" },
      });
      bdButtons.set(id, b);
      b.addEventListener("click", () => {
        this.plugin.settings.accountBreakdownTab = id;
        void this.plugin.saveSettings();
        bdSelect(id);
      });
    }
    bdSelect(this.plugin.settings.accountBreakdownTab ?? "symbol");

    // ---- header for the treemap (groups + total) ----
    const renderTradesWidget = (host: HTMLElement) => {
      const list = () => (bdFilter ? scoped.filter((t) => bdFilter!.test(t)) : scoped);
      // The ledger wears the same panel the Trade Log page uses: one card, the
      // section header Accounts taught us (dot, label, count, hairline), then the
      // table. The account page is the same surface, just scoped to one account.
      const panel = host.createDiv({ cls: "tj-panel" });
      const head = panel.createDiv({ cls: "tj-acct-h1" });
      head.createSpan({ cls: "tj-acct-h1-t", text: "Trades" });
      const count = head.createSpan({ cls: "tj-acct-h1-c" });
      head.createSpan({ cls: "tj-acct-h1-line" });
      const chip = head.createDiv({ cls: "tj-acc-tchip" });
      const body = panel.createDiv({ cls: "tj-acc-tradesbody" });
      const drawChip = () => {
        chip.empty();
        if (!bdFilter) return;
        chip.createSpan({ text: `Filter: ${bdFilter.label}` });
        chip
          .createEl("button", { text: "\u2715", cls: "tj-acc-tchipx", attr: { type: "button", "aria-label": "Clear filter" } })
          .addEventListener("click", () => {
            bdFilter = null;
            drawChip();
            paint();
          });
      };
      // The same ledger the Trade Log page uses (src/lib/tradeTable): same columns,
      // same saved order, same drag. This one shows only the columns that fit a
      // single account — account, review state and prints belong to the big page.
      let sortState: TradeSort | null = null;
      const paint = () => {
        count.setText(String(list().length));
        renderTradeTable(body, {
          plugin: this.plugin,
          trades: list(),
          sort: sortState,
          onSort: (next) => { sortState = next; paint(); },
          stickyHeader: false,
          order: resolveOrder(this.plugin.settings.tradeLogColOrder, DEFAULT_ACCOUNT_ORDER),
          onRowClick: (t) => void this.plugin.openTradeDetail({ id: t.id, from: { type: "account", accountId: acc.id } }),
          onReorder: (next) => {
            this.plugin.settings.tradeLogColOrder = next;
            void this.plugin.saveSettings();
            paint();
          },
        });
      };
      refreshTrades = () => {
        drawChip();
        paint();
      };
      drawChip();
      paint();
    };

    // ---------- widget registry ----------
    type Widget = { id: string; title: string; span: number; available?: () => boolean; render: (host: HTMLElement) => void };
    const WIDGETS: Widget[] = [
      { id: "trades", title: "Trades in this account", span: 12, render: (host) => renderTradesWidget(host) },
    ];


    // ---------- layout ----------
    // The registry is the whole layout. There is no per-user hide/reorder yet,
    // so the settings key that used to promise it was removed.
    const widgetsWrap = main.createDiv({ cls: "tj-acc-widgets" });
    const grid = widgetsWrap.createDiv({ cls: "tj-acc-wgrid" });

    const renderWidgets = () => {
      grid.empty();
      for (const w of WIDGETS) {
        if (w.available && !w.available()) continue;
        const isTradesWidget = w.id === "trades";
        const card = grid.createDiv({ cls: isTradesWidget ? "tj-acc-widget-trades" : "tj-acc-widget" });
        card.style.gridColumn = `span ${w.span}`;
        if (!isTradesWidget) {
          const head = card.createDiv({ cls: "tj-acc-wh" });
          head.createDiv({ cls: "tj-acc-k", text: w.title });
        }
        w.render(card);
      }
    };
    renderWidgets();

    // Deposits — only for personal accounts (own money)
    if (acc.type === "personal") this.renderDepositTracker(main, acc);
  }

  /** Double-warning themed delete confirmation — works inline (banner) or as an overlay. */
  /** Ask before making a funded: with several around, this must never be a slip. */
  private showFundedCreateConfirm(host: HTMLElement, acc: PropAccount, onConfirm: () => Promise<string | void> | string | void): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    card.createDiv({ cls: "tj-delete-icon", text: "\uD83C\uDFC1" });
    card.createEl("h3", { text: "Create a funded account?" });
    card.createEl("p", { cls: "tj-delete-desc", text: `No funded account is linked to "${acc.name}" yet.` });
    card.createEl("p", { cls: "tj-delete-desc", text: "This creates one with the same firm, program and size, and links the two. If you already have that funded account, cancel instead — the band can link it." });
    const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
    btns.createEl("button", { text: "Cancel", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => card.remove());
    btns.createEl("button", { text: "Yes, create it", cls: "tj-btn mod-cta", attr: { type: "button" } }).addEventListener("click", () => {
      void (async () => {
        card.remove();
        const id = await onConfirm();
        if (typeof id === "string" && id) void this.plugin.openAccountDashboard(this.leaf, id);
      })();
    });
  }

  /** Point an eval at a different funded (or at none), without creating anything. */
  private showRelinkFunded(host: HTMLElement, acc: PropAccount, props: PropAccount[]): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    card.createEl("h3", { text: "Link this eval to…" });
    card.createEl("p", { cls: "tj-delete-desc", text: "Nothing is created here — you are only choosing which funded account this eval points at." });
    const list = card.createDiv({ cls: "tj-relink-list" });
    for (const f of props.filter((a) => a.type === "funded" && a.id !== acc.id)) {
      const rowBtn = list.createEl("button", { cls: "tj-relink-row", attr: { type: "button" } });
      rowBtn.createSpan({ cls: "tj-relink-name", text: f.name });
      rowBtn.createSpan({
        cls: "tj-relink-sub",
        text: f.linkedEvalId && f.linkedEvalId !== acc.id ? "already linked to another eval" : "free",
      });
      attachTip(rowBtn, { title: f.name, sub: "Links this eval to it. No account is created, no trade is touched." });
      rowBtn.addEventListener("click", () => {
        void (async () => {
          card.remove();
          await this.plugin.linkEvalToFunded(acc.id, f.id);
        })();
      });
    }
    const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
    btns.createEl("button", { text: "Cancel", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => card.remove());
    const none = btns.createEl("button", { text: "No funded account", cls: "tj-btn", attr: { type: "button" } });
    attachTip(none, { title: "Unlink", sub: "Forgets the link. The funded account itself is never deleted." });
    none.addEventListener("click", () => {
      void (async () => {
        card.remove();
        const funded = props.find((a) => a.id === acc.linkedFundedId);
        if (funded) delete funded.linkedEvalId;
        delete acc.linkedFundedId;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      })();
    });
  }

  /** One calm question before an eval in progress disappears from the views. */
  private showArchiveConfirm(host: HTMLElement, acc: PropAccount, onConfirm: () => void | Promise<void>): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    card.createDiv({ cls: "tj-delete-icon", text: "\uD83D\uDCE6" });
    card.createEl("h3", { text: "Archive this eval?" });
    card.createEl("p", { cls: "tj-delete-desc", text: `"${acc.name}" has not reached its target yet.` });
    card.createEl("p", { cls: "tj-delete-desc", text: "Archiving keeps every trade and hides the account from the views and totals. You can restore it any time from the Accounts page." });
    const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
    btns.createEl("button", { text: "Cancel", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => card.remove());
    btns.createEl("button", { text: "Yes, archive", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => {
      void (async () => {
        card.remove();
        await onConfirm();
      })();
    });
  }

  private async showDeleteConfirm(host: HTMLElement, acc: PropAccount, step: number, onConfirm?: () => void): Promise<void> {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    const close = () => {
      if (host.classList.contains("tj-modal-overlay")) host.remove();
      else card.remove();
    };

    if (step === 1) {
      card.createDiv({ cls: "tj-delete-icon", text: "\u26A0\uFE0F" });
      card.createEl("h3", { text: "Delete this account?" });
      card.createEl("p", { cls: "tj-delete-desc", text: `Everything attached to "${acc.name}" goes with it:` });

      const summary = await this.plugin.accountDeletionSummary(acc.id);
      const list = card.createDiv({ cls: "tj-delete-list" });
      const fact = (n: number, one: string, many: string) => {
        if (!n) return;
        list.createDiv({
          cls: "tj-delete-fact",
          text: `${n} ${n === 1 ? one : many}`,
        });
      };
      fact(summary.trades, "trade note — moved to Obsidian's trash", "trade notes — moved to Obsidian's trash");
      fact(summary.payouts, "payout record", "payout records");
      fact(summary.deposits, "deposit record", "deposit records");
      fact(summary.corrections, "balance correction or logged cost", "balance corrections and logged costs");
      fact(summary.copyLinks, "copy-trading link", "copy-trading links");
      if (!summary.trades && !summary.payouts && !summary.deposits && !summary.corrections && !summary.copyLinks) {
        list.createDiv({ cls: "tj-delete-fact", text: "No records — the account is already empty." });
      }

      card.createEl("p", {
        cls: "tj-delete-desc tj-del",
        text: "The trade notes leave your vault. This cannot be undone from here — recover them from Obsidian's trash before it is emptied.",
      });
      card.createEl("p", { cls: "tj-delete-hint", text: "If you want to keep the data but hide it, use Archive instead." });
      const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
      btns.createEl("button", { text: "Cancel", cls: "tj-btn" }).addEventListener("click", close);
      btns.createEl("button", { text: "Yes, delete", cls: "tj-btn tj-del" }).addEventListener("click", () => {
        void this.showDeleteConfirm(host, acc, 2, onConfirm);
      });
    } else {
      card.createDiv({ cls: "tj-delete-icon", text: "\uD83D\uDEA8" });
      card.createEl("h3", { text: "Final confirmation" });
      card.createEl("p", { cls: "tj-delete-desc", text: `Are you absolutely sure you want to delete "${acc.name}"?` });
      card.createEl("p", { cls: "tj-delete-desc tj-del", text: "This action CANNOT be undone. There is no way to recover this account after deletion." });
      const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
      btns.createEl("button", { text: "Cancel", cls: "tj-btn" }).addEventListener("click", close);
      btns.createEl("button", { text: "I understand, delete permanently", cls: "tj-btn tj-del" }).addEventListener("click", () => {
        void (async () => {
          if (onConfirm) { onConfirm(); }
          else {
            await this.plugin.removeAccount(acc.id);
            void this.plugin.openAccounts();
          }
        })();
      });
    }
  }

  /**
   * The payout badge: what this account has paid out, as a gold pill in the
   * header, left of the two squares. It is a number, not a door — the payouts
   * square opens the register, so the badge never competes with it.
   *
   * The count is deliberately not printed on it (a badge is one number); it lives
   * in the hover, where there is room to explain.
   */
  renderPayoutLine(host: HTMLElement, acc: PropAccount): void {
    if (acc.type !== "funded" && acc.type !== "live" && acc.type !== "personal") return;
    const payouts = this.plugin.payoutsFor(acc.id);
    if (!payouts.length) return; // Nothing out yet: the header square is the way in.

    const line = host.createDiv({ cls: "tj-acc-cashline" });
    const total = payouts.reduce((s, p) => s + p.amount, 0);
    const badge = line.createSpan({
      cls: "tj-acc-cashbadge" + (this.plugin.settings.animations === false ? " is-still" : ""),
    });
    setIcon(badge.createSpan({ cls: "tj-acc-cashbadge-ico" }), "wallet");
    badge.createSpan({ cls: "tj-acc-cashbadge-k", text: "Paid out" });
    badge.createSpan({ cls: "tj-acc-cashbadge-v", text: fmtMoneyCompact(total) });
    attachTip(badge, {
      title: `${fmtMoney(total)} paid out`,
      sub: `${payouts.length === 1 ? "1 payout" : `${payouts.length} payouts`} · last ${payouts[payouts.length - 1].date}`,
    });
  }

  renderDepositTracker(box: HTMLElement, acc: PropAccount): void {
    const deposits = this.plugin.depositsFor(acc.id);
    const totalDeposited = deposits.reduce((s, d) => s + d.amount, 0);
    const section = box.createDiv({ cls: "tj-payout-box" });
    const head = section.createDiv({ cls: "tj-payout-head" });
    head.createEl("h3", { text: `Deposits \u2014 total deposited $${totalDeposited.toLocaleString()}` });
    const addBtn = head.createEl("button", { text: "+ Add deposit", cls: "tj-btn tj-mini" });
    addBtn.addEventListener("click", () => this.showDepositForm(section, acc));

    const table = section.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Amount", "Note", ""].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    if (deposits.length === 0) {
      const tr = tbody.createEl("tr");
      const td = tr.createEl("td", { attr: { colspan: "4" } });
      td.createDiv({ cls: "tj-empty", text: "No deposits recorded yet." });
    }
    for (const d of deposits) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: d.date });
      const amt = tr.createEl("td");
      amt.addClass("tj-pos");
      amt.textContent = `$${d.amount.toLocaleString()}`;
      tr.createEl("td", { text: d.note || "\u2014" });
      const delCell = tr.createEl("td");
      const paintDel = (armed: boolean): void => {
        delCell.empty();
        if (!armed) {
          const del = delCell.createEl("button", { text: "\u2715", cls: "tj-mini tj-del", attr: { type: "button", "aria-label": "Remove deposit" } });
          del.addEventListener("click", () => paintDel(true));
          return;
        }
        const yes = delCell.createEl("button", { text: "Remove?", cls: "tj-mini tj-del", attr: { type: "button", "aria-label": "Confirm remove deposit" } });
        const no = delCell.createEl("button", { text: "Cancel", cls: "tj-mini", attr: { type: "button" } });
        yes.addEventListener("click", () => {
          void (async () => {
            await this.plugin.removeDeposit(d.id);
            new Notice("Deposit removed.");
            this.render();
          })();
        });
        no.addEventListener("click", () => paintDel(false));
      };
      paintDel(false);
    }
  }

  showDepositForm(section: HTMLElement, acc: PropAccount): void {
    const form = section.createDiv({ cls: "tj-payout-form" });
    const row = form.createDiv({ cls: "tj-form-row" });
    row.createEl("label", { text: "Date" });
    let depositDate = this.todayKey();
    mountDateField(row, {
      value: depositDate,
      format: this.plugin.settings.dateFormat,
      className: "tj-input",
      zone: this.plugin.settings.timeZone,
      onChange: (iso) => (depositDate = iso),
    });
    row.createEl("label", { text: "Amount ($)" });
    const amountInput = freeNumeric(row.createEl("input", { type: "number", cls: "tj-input", attr: { placeholder: "5000" } }));
    row.createEl("label", { text: "Note (optional)" });
    const noteInput = row.createEl("input", { type: "text", cls: "tj-input", attr: { placeholder: "e.g. Initial deposit" } });
    const save = row.createEl("button", { text: "Save deposit", cls: "mod-cta tj-btn" });
    save.addEventListener("click", () => {
      void (async () => {
        const parsed = parseFloat(amountInput.value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        const amount = Math.round(parsed);
        const date = depositDate || this.todayKey();
        await this.plugin.registerDeposit(acc.id, date, amount, noteInput.value.trim() || undefined);
        form.remove();
        this.render();
      })();
    });
    const cancel = row.createEl("button", { text: "Cancel", cls: "tj-btn tj-mini" });
    cancel.addEventListener("click", () => form.remove());
  }

  /** Hour label like "9am" / "2pm" (used by the discipline card). */
  private hourLabel(h: number): string {
    const suffix = h < 12 ? "am" : "pm";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${suffix}`;
  }

  /** Hour bucket label for a trade (used by the "By hour" widget). */
  private hourBlockOf(t: Trade): string {
    const m = /^(\d{1,2}):/.exec(t.entryTime || "");
    return m ? this.hourLabel(parseInt(m[1], 10)) : "—";
  }

  /** Weekday label for a trade (used by the breakdown bars). */
  private weekdayOf(t: Trade): string {
    const d = this.dayKey(t);
    const [y, m, day] = d.split("-").map(Number);
    return WEEKDAYS[new Date(y, m - 1, day).getDay()] ?? "—";
  }
}
