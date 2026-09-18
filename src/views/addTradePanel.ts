import { Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { parseTradeovateCsv } from "../csv";
import { futuresSpec, FUTURES_SYMBOLS } from "../futures";
import { mountDateField } from "../lib/dates";
import { attachTip } from "../lib/tip";
import { isDateStr, todayStr, fmtPrice, detectSystemZone, zoneShortLabel } from "../tz";
import { holdFmt, tradeR } from "../lib/tradeTable";
import { sessionOf } from "../lib/sessions";
import { mountDropdown, DropdownItem } from "../lib/dropdown";

export interface AddTradePanelOptions {
  onSaveDone?: () => void;
  onClose?: () => void;
  startTab?: "manual" | "import";
}

interface AccountPickerHandle {
  get: () => string[];
  sync: (ids: string[]) => void;
  hasAccounts: () => boolean;
}

export function renderAccountPicker(
  parent: HTMLElement,
  plugin: TradebookPlugin,
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

function createDefaultManualTrade(): Trade {
  return {
    id: "",
    date: todayStr(),
    entryTime: "09:30:00",
    exitTime: "09:45:00",
    symbol: "NQ",
    account: "DEMO1234567",
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
  plugin: TradebookPlugin;
  onSaveDone?: () => void;
  root: HTMLElement | null = null;
  sheet: HTMLElement | null = null;
  bodyEl: HTMLElement | null = null;
  manualTrades: Trade[] = [];
  rowSetups: string[] = [];
  rowReviews: string[] = [];
  pickedAccounts = new Set<string>();
  autoAccIds: string[] = [];
  knownSetups: string[] = [];
  startTab: "manual" | "import" = "manual";
  mode: "csv" | "manual" = "csv";
  parsed: Trade[] | null = null;

  constructor(plugin: TradebookPlugin, opts: AddTradePanelOptions = {}) {
    this.plugin = plugin;
    this.onSaveDone = opts.onSaveDone;
    this.startTab = opts.startTab ?? "manual";
  }

  mount(root: HTMLElement): void {
    this.root = root;
    root.addClass("tj-addpanel");
    this.sheet = this.root.createDiv({ cls: "tj-modal-inner" });
    this.mode = "manual";
    if (!this.manualTrades.length) this.manualTrades = [this.newManualTrade()];
    if (!this.rowSetups.length) this.rowSetups = [""];
    if (!this.rowReviews.length) this.rowReviews = [""];
    this.bodyEl = this.sheet.createDiv({ cls: "tj-wizard-body" });
    if (this.startTab === "import") this.renderImportStart();
    else this.renderBody();
    void this.plugin
      .loadTrades()
      .then((trades) => {
        const set = new Set<string>();
        for (const tr of trades) if (tr.setup) set.add(tr.setup);
        this.knownSetups = [...set].sort((a, b) => a.localeCompare(b));
        if (this.bodyEl && this.startTab !== "import") this.renderBody();
      })
      .catch(() => {});
  }

  renderImportStart(): void {
    const body = this.bodyEl!;
    body.empty();
    const wrap = body.createDiv({ cls: "tj-import-ui" });
    wrap.createEl("p", {
      text: "Drop the CSV exported from Tradeovate (Reports → Executions/Fills or Orders). The trades are spread into editable cards so you can review and adjust before saving.",
      cls: "tj-import-info",
    });
    const drop = wrap.createEl("div", { cls: "tj-dropzone" });
    drop.createDiv({ text: "Drop your CSV here", cls: "tj-drop-text" });
    drop.createDiv({ text: "or click to choose a file", cls: "tj-drop-sub" });
    const fileInput = drop.createEl("input", { type: "file", attr: { accept: ".csv,.txt,text/csv" } });
    fileInput.style.display = "none";
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) void this.ingestCsvFile(f);
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
      if (f) void this.ingestCsvFile(f);
      else {
        const text = e.dataTransfer && e.dataTransfer.getData("text");
        if (text && text.trim()) this.ingestCsv(text);
      }
    });
  }

  async ingestCsvFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      this.ingestCsv(text);
    } catch (err) {
      new Notice(`Could not read that file: ${(err as Error).message}`);
    }
  }

  dispose(): void {
    if (this.root) {
      this.root.removeClass("tj-addpanel");
      this.root = null;
    }
    if (this.sheet) {
      this.sheet.empty();
      this.sheet = null;
    }
    this.bodyEl = null;
  }

  private newManualTrade(): Trade {
    const t = createDefaultManualTrade();
    const st = this.plugin.settings;
    if (st.defaultSymbol) t.symbol = st.defaultSymbol;
    if (st.defaultQty) t.quantity = st.defaultQty;
    const acc = st.propAccounts.find((a) => a.id === st.defaultAccountId);
    if (acc) {
      t.account = acc.name;
      t.accountType = acc.type;
    }
    return t;
  }

  hasData(): boolean {
    return (this.mode === "csv" && !!this.parsed && this.parsed.length > 0) || (this.mode === "manual" && this.manualTrades.length > 0);
  }

  renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    if (this.startTab === "import" && !this.hasData()) this.renderImportStart();
    else this.renderReview();
  }

  ingestCsv(text: string): void {
    const sourceZone = this.plugin.settings.importZone || detectSystemZone();
    const result = parseTradeovateCsv(text, this.plugin.getAccountRules(), {
      sourceZone,
      journalZone: this.plugin.settings.timeZone,
    });
    if (result.trades.length === 0) {
      new Notice("No valid round-trips found in that CSV.");
      for (const w of result.warnings) new Notice(w);
      this.parsed = null;
      return;
    }
    this.mode = "manual";
    this.manualTrades = result.trades;
    this.rowSetups = result.trades.map(() => "");
    this.rowReviews = result.trades.map(() => "");
    this.autoAccIds = result.accountsSeen.map((a) => this.plugin.mappedAccount(a.name)?.id).filter((id): id is string => !!id);
    new Notice(`✨ ${result.trades.length} trade(s) imported — review and save.`);
    this.renderBody();
  }

  renderReview(): void {
    const body = this.bodyEl!;
    const cards = body.createDiv({ cls: "tj-add-cards" });
    this.manualTrades.forEach((t, i) => this.renderTradeCard(cards, t, i));

    // Add trade button
    const addBtnRow = cards.createDiv({ cls: "tj-add-trade-row" });
    addBtnRow.createEl("button", { text: "+ Add trade", cls: "tj-btn" }).addEventListener("click", () => {
      this.manualTrades.push(this.newManualTrade());
      this.rowSetups.push("");
      this.rowReviews.push("");
      this.renderBody();
    });

    // Save button
    const actions = body.createDiv({ cls: "tj-import-actions" });
    const count = this.manualTrades.length;
    const saveBtn = actions.createEl("button", {
      text: `Save ${count} trade${count === 1 ? "" : "s"}`,
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => this.doSave(saveBtn));
  }

  // ================================================================
  // TRADE CARD — single card (no flip, no prints)
  // ================================================================
  renderTradeCard(parent: HTMLElement, t: Trade, i: number): void {
    const card = parent.createDiv({ cls: "tj-add-card" });
    card.dataset.idx = String(i);

    // ---- Remove button ----
    if (this.manualTrades.length > 1) {
      const rmBtn = card.createEl("button", { cls: "tj-add-card-rm", attr: { type: "button", "aria-label": "Remove trade" } });
      setIcon(rmBtn, "x");
      attachTip(rmBtn, { title: "Remove trade", sub: "This trade won't be saved." });
      rmBtn.addEventListener("click", () => {
        this.manualTrades.splice(i, 1);
        this.rowSetups.splice(i, 1);
        this.rowReviews.splice(i, 1);
        this.renderBody();
      });
    }

    // ---- Single card (no flip) ----
    const cardBody = card.createDiv({ cls: "tj-add-flipcard" });
    const front = cardBody.createDiv({ cls: "tj-add-flip-face tj-add-ffront" });
    const spec = futuresSpec(t.symbol || "NQ");
    const pointValue = spec.pointValue;

    // Store refs for computed value spans so we can update them in-place
    const refs: Record<string, HTMLElement> = {};

    // Recompute P&L from entry/exit
    const computePnl = () => {
      if (t.entryPrice > 0 && t.exitPrice > 0) {
        const pts = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
        t.pnl = Math.round(pts * pointValue * t.quantity * 100) / 100;
        t.grossPnl = t.pnl;
        t.pnlPoints = Math.round(pts * t.quantity * 100) / 100;
      } else {
        t.pnl = 0;
        t.grossPnl = 0;
        t.pnlPoints = 0;
      }
    };

    /** Update all computed spans in-place — no full re-render. */
    const refreshComputed = () => {
      computePnl();
      // Net P&L
      const pnlEl = refs.pnl;
      if (pnlEl) {
        const tone = t.pnl >= 0 ? "pos" : "neg";
        pnlEl.textContent = t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`;
        pnlEl.className = "tj-add-flip-val " + tone;
      }
      // Points
      const ptsEl = refs.points;
      if (ptsEl) {
        const pts = t.pnlPoints;
        const tone = pts >= 0 ? "pos" : "neg";
        ptsEl.textContent = pts ? `${pts >= 0 ? "+" : ""}${pts.toFixed(2)} pts` : "—";
        ptsEl.className = "tj-add-flip-val " + (pts ? tone : "");
      }
      // R-Multiple
      const rEl = refs.rMultiple;
      if (rEl) {
        const rMul = tradeR(t);
        rEl.textContent = rMul !== null ? `${rMul >= 0 ? "+" : ""}${rMul.toFixed(2)}R` : "—";
        rEl.className = "tj-add-flip-val " + (rMul !== null ? (rMul >= 0 ? "pos" : "neg") : "");
      }
      // Hold Time
      const htEl = refs.holdTime;
      if (htEl) {
        htEl.textContent = holdFmt(t.entryTime, t.exitTime);
      }
      // Risk $
      const riskEl = refs.riskDollar;
      if (riskEl) {
        const qty = t.quantity || 1;
        const rd = (t.stopLoss && t.entryPrice) ? Math.abs(t.entryPrice - t.stopLoss) * pointValue * qty : null;
        riskEl.textContent = rd !== null ? `$${rd.toFixed(0)}` : "—";
      }
      // Planned R:R
      const rrEl = refs.plannedRR;
      if (rrEl) {
        if (t.stopLoss && t.target && t.entryPrice) {
          const risk = Math.abs(t.entryPrice - t.stopLoss);
          const reward = Math.abs(t.target - t.entryPrice);
          rrEl.textContent = risk > 0 ? `1 : ${(reward / risk).toFixed(1)}` : "—";
        } else {
          rrEl.textContent = "—";
        }
      }
    };

    // --- Click-to-edit helper (NO re-render — updates computed values in-place) ---
    const editableRow = (
      host: HTMLElement,
      label: string,
      currentValue: string,
      onSave: (newVal: string) => void,
      opts?: { numeric?: boolean }
    ) => {
      const r = host.createDiv({ cls: "tj-add-flip-row" });
      r.createEl("span", { cls: "tj-add-flip-key", text: label });
      const valSpan = r.createEl("span", { cls: "tj-add-flip-val", text: currentValue });
      valSpan.style.cursor = "pointer";
      attachTip(valSpan, { title: "Click to edit", sub: `Change ${label.toLowerCase()}` });
      valSpan.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = opts?.numeric ? "number" : "text";
        input.className = "tj-add-flip-input";
        input.value = currentValue.replace(/[^0-9.\-]/g, "");
        input.style.width = "100%";
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        const save = () => {
          const raw = input.value.trim();
          if (raw !== currentValue.replace(/[^0-9.\-]/g, "")) {
            onSave(raw);
          }
          // Always replace input with span (new value or reverted)
          const newSpan = document.createElement("span");
          newSpan.className = "tj-add-flip-val";
          newSpan.textContent = raw || currentValue;
          input.replaceWith(newSpan);
        };
        input.addEventListener("blur", save);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
          if (e.key === "Escape") { input.value = currentValue.replace(/[^0-9.\-]/g, ""); input.blur(); }
        });
      });
      return valSpan;
    };

    // Static computed row with ref
    const computedRow = (key: string, label: string, value: string, tone = "") => {
      const r = front.createDiv({ cls: "tj-add-flip-row" });
      r.createEl("span", { cls: "tj-add-flip-key", text: label });
      refs[key] = r.createEl("span", { cls: "tj-add-flip-val" + (tone ? " " + tone : ""), text: value });
    };

    // ---- Net P&L (hero, computed) ----
    computePnl();
    const pnlTone = t.pnl >= 0 ? "pos" : "neg";
    const pnlRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-hero" });
    pnlRow.createEl("span", { cls: "tj-add-flip-key", text: "Net P&L" });
    refs.pnl = pnlRow.createEl("span", {
      cls: "tj-add-flip-val " + pnlTone,
      text: t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`,
    });

    // ---- Points (computed, also editable as fallback) ----
    const ptsStr = t.pnlPoints ? `${t.pnlPoints >= 0 ? "+" : ""}${t.pnlPoints.toFixed(2)} pts` : "—";
    const ptsTone = t.pnlPoints >= 0 ? "pos" : "neg";
    editableRow(front, "Points", ptsStr, (raw) => {
      const pts = parseFloat(raw) || 0;
      t.pnlPoints = pts;
      // Back-calculate exit from points if entry is set
      if (t.entryPrice) {
        const pointsPerContract = pts / (t.quantity || 1);
        t.exitPrice = t.direction === "long"
          ? Math.round((t.entryPrice + pointsPerContract) * 100) / 100
          : Math.round((t.entryPrice - pointsPerContract) * 100) / 100;
      }
      refreshComputed();
    }, { numeric: true });

    // ---- R-Multiple (computed) ----
    const rMultiple = tradeR(t);
    computedRow("rMultiple", "R-Multiple", rMultiple !== null ? `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R` : "—",
      rMultiple !== null ? (rMultiple >= 0 ? "pos" : "neg") : "");

    // ---- Hold Time (computed from entry/exit times) ----
    computedRow("holdTime", "Hold Time", holdFmt(t.entryTime, t.exitTime));

    // ---- Date (editable — structural change, needs re-render) ----
    const dateRow = front.createDiv({ cls: "tj-add-flip-row" });
    dateRow.createEl("span", { cls: "tj-add-flip-key", text: "Date" });
    const dateWrap = dateRow.createDiv({ cls: "tj-add-flip-date-wrap" });
    mountDateField(dateWrap, {
      value: t.date || todayStr(),
      format: this.plugin.settings.dateFormat,
      onChange: (v) => { t.date = v; this.renderBody(); },
    });

    // ---- Entry Time (editable HH:MM:SS) ----
    const entryTimeRow = front.createDiv({ cls: "tj-add-flip-row" });
    entryTimeRow.createEl("span", { cls: "tj-add-flip-key", text: "Entry Time" });
    const entryTimeVal = entryTimeRow.createEl("span", { cls: "tj-add-flip-val", text: t.entryTime || "09:30:00" });
    entryTimeVal.style.cursor = "pointer";
    attachTip(entryTimeVal, { title: "Click to edit", sub: "Change entry time (HH:MM:SS)" });
    entryTimeRow.createEl("span", {
      cls: "tj-add-tz",
      text: zoneShortLabel(t.timezone || this.plugin.settings.timeZone),
    });
    entryTimeVal.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tj-add-flip-input";
      input.value = t.entryTime || "09:30:00";
      input.style.width = "100%";
      input.placeholder = "HH:MM:SS";
      entryTimeVal.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        const raw = input.value.trim();
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
        if (match) {
          const h = match[1].padStart(2, "0");
          const m = match[2].padStart(2, "0");
          const s = (match[3] || "00").padStart(2, "0");
          t.entryTime = `${h}:${m}:${s}`;
        } else if (raw) {
          // Try HH:MM
          const match2 = /^(\d{1,2}):(\d{2})$/.exec(raw);
          if (match2) {
            t.entryTime = `${match2[1].padStart(2, "0")}:${match2[2].padStart(2, "0")}:00`;
          }
        }
        const newSpan = document.createElement("span");
        newSpan.className = "tj-add-flip-val";
        newSpan.textContent = t.entryTime || "09:30:00";
        input.replaceWith(newSpan);
        refreshComputed();
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = t.entryTime || "09:30:00"; input.blur(); }
      });
    });

    // ---- Exit Time (editable HH:MM:SS) ----
    const exitTimeRow = front.createDiv({ cls: "tj-add-flip-row" });
    exitTimeRow.createEl("span", { cls: "tj-add-flip-key", text: "Exit Time" });
    const exitTimeVal = exitTimeRow.createEl("span", { cls: "tj-add-flip-val", text: t.exitTime || "09:45:00" });
    exitTimeVal.style.cursor = "pointer";
    attachTip(exitTimeVal, { title: "Click to edit", sub: "Change exit time (HH:MM:SS)" });
    exitTimeRow.createEl("span", {
      cls: "tj-add-tz",
      text: zoneShortLabel(t.timezone || this.plugin.settings.timeZone),
    });
    exitTimeVal.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tj-add-flip-input";
      input.value = t.exitTime || "09:45:00";
      input.style.width = "100%";
      input.placeholder = "HH:MM:SS";
      exitTimeVal.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        const raw = input.value.trim();
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
        if (match) {
          const h = match[1].padStart(2, "0");
          const m = match[2].padStart(2, "0");
          const s = (match[3] || "00").padStart(2, "0");
          t.exitTime = `${h}:${m}:${s}`;
        } else if (raw) {
          const match2 = /^(\d{1,2}):(\d{2})$/.exec(raw);
          if (match2) {
            t.exitTime = `${match2[1].padStart(2, "0")}:${match2[2].padStart(2, "0")}:00`;
          }
        }
        const newSpan = document.createElement("span");
        newSpan.className = "tj-add-flip-val";
        newSpan.textContent = t.exitTime || "09:45:00";
        input.replaceWith(newSpan);
        refreshComputed();
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = t.exitTime || "09:45:00"; input.blur(); }
      });
    });

    // ---- Account (dropdown — structural change) ----
    const propAccounts = this.plugin.settings.propAccounts || [];
    const roleOrder: Record<string, number> = { base: 0, copier: 1 };
    const sortedAccounts = [...propAccounts]
      .filter((a) => a.name)
      .sort((a, b) => (roleOrder[a.copyRole ?? ""] ?? 2) - (roleOrder[b.copyRole ?? ""] ?? 2));
    const accountOptions = sortedAccounts.length ? sortedAccounts.map((a) => a.name) : ["DEMO1234567"];
    const acctRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-strat" });
    acctRow.createEl("span", { cls: "tj-add-flip-key", text: "Account" });
    const acctWrap = acctRow.createDiv({ cls: "tj-add-flip-strat-wrap" });
    const acctItems: DropdownItem[] = sortedAccounts.map((a) => ({
      id: a.name,
      label: a.name,
      note: a.copyRole === "base" ? "Leader" : a.copyRole === "copier" ? "Copier" : undefined,
    }));
    if (!sortedAccounts.length) acctItems.push({ id: "DEMO1234567", label: "DEMO1234567" });
    mountDropdown(acctWrap, acctItems, t.account || accountOptions[0], (id) => {
      t.account = id;
      this.renderBody();
    }, { placeholder: "Account…" });

    // ---- Entry (editable) ----
    editableRow(front, "Entry", t.entryPrice ? String(t.entryPrice) : "—", (raw) => {
      t.entryPrice = parseFloat(raw) || 0;
      refreshComputed();
    }, { numeric: true });

    // ---- Exit (editable) ----
    editableRow(front, "Exit", t.exitPrice ? String(t.exitPrice) : "—", (raw) => {
      t.exitPrice = parseFloat(raw) || 0;
      refreshComputed();
    }, { numeric: true });

    // ---- Contracts (editable) ----
    editableRow(front, "Contracts", String(t.quantity ?? 1), (raw) => {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) { t.quantity = n; refreshComputed(); }
    }, { numeric: true });

    // ================================================================
    // SECTION 2: CONTEXT — Symbol, Direction, Account, Session, Strategy
    // ================================================================

    // ---- Symbol (editable) ----
    editableRow(front, "Symbol", t.symbol || "NQ", (raw) => {
      t.symbol = (raw || "NQ").toUpperCase().trim();
      refreshComputed();
    });

    // ---- Direction (dropdown) ----
    const dirRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-strat" });
    dirRow.createEl("span", { cls: "tj-add-flip-key", text: "Direction" });
    const dirWrap = dirRow.createDiv({ cls: "tj-add-flip-strat-wrap" });
    mountDropdown(dirWrap, [
      { id: "long", label: "Long" },
      { id: "short", label: "Short" },
    ], t.direction || "long", (id) => {
      t.direction = id as "long" | "short";
      refreshComputed();
    });

    // ---- Stop (editable) ----
    editableRow(front, "Stop", t.stopLoss ? fmtPrice(t.stopLoss) : "—", (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price)) { t.stopLoss = price; refreshComputed(); }
    }, { numeric: true });

    // ---- Target (editable) ----
    editableRow(front, "Target", t.target ? fmtPrice(t.target) : "—", (raw) => {
      const price = parseFloat(raw);
      if (Number.isFinite(price)) { t.target = price; refreshComputed(); }
    }, { numeric: true });

    // ---- Risk $ (editable, bidirectional with Stop) ----
    const qty = t.quantity || 1;
    const riskDollar = (t.stopLoss && t.entryPrice)
      ? Math.abs(t.entryPrice - t.stopLoss) * pointValue * qty
      : null;
    editableRow(front, "Risk $", riskDollar !== null ? `$${riskDollar.toFixed(0)}` : "—", (raw) => {
      const dollars = parseFloat(raw.replace(/[$,]/g, ""));
      if (Number.isFinite(dollars) && t.entryPrice) {
        const dist = dollars / (pointValue * qty);
        t.stopLoss = t.direction === "long"
          ? Math.round((t.entryPrice - dist) * 100) / 100
          : Math.round((t.entryPrice + dist) * 100) / 100;
      }
      refreshComputed();
    }, { numeric: true });

    // ---- Planned R:R (computed) ----
    if (t.stopLoss && t.target && t.entryPrice) {
      const risk = Math.abs(t.entryPrice - t.stopLoss);
      const reward = Math.abs(t.target - t.entryPrice);
      computedRow("plannedRR", "Planned R:R", risk > 0 ? `1 : ${(reward / risk).toFixed(1)}` : "—");
    } else {
      computedRow("plannedRR", "Planned R:R", "—");
    }

    // ---- Fees (editable) ----
    const totalFees = (t.commission || 0) + (t.fees || 0);
    editableRow(front, "Fees", `$${totalFees.toFixed(2)}`, (raw) => {
      const val = parseFloat(raw.replace(/[$]/g, ""));
      if (Number.isFinite(val)) { t.fees = val; t.commission = 0; }
    }, { numeric: true });

    // ---- Order Type (dropdown) ----
    const otRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-strat" });
    otRow.createEl("span", { cls: "tj-add-flip-key", text: "Order Type" });
    const otWrap = otRow.createDiv({ cls: "tj-add-flip-strat-wrap" });
    mountDropdown(otWrap, [
      { id: "limit", label: "Limit" },
      { id: "market", label: "Market" },
      { id: "stop", label: "Stop" },
      { id: "stop-limit", label: "Stop Limit" },
    ], t.orderType || "", (id) => { t.orderType = id; }, { placeholder: "—" });

    // ---- Session (dropdown — override computed session) ----
    const sessKey = sessionOf(t, this.plugin.settings?.timeZone || "");
    const sessItems: DropdownItem[] = [
      { id: "newyork", label: "New York" },
      { id: "london", label: "London" },
      { id: "asia", label: "Asia" },
      { id: "off", label: "Off Hours" },
      { id: "__auto__", label: "Auto-detect", note: "Based on entry time" },
    ];
    const sessRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-strat" });
    sessRow.createEl("span", { cls: "tj-add-flip-key", text: "Session" });
    const sessWrap = sessRow.createDiv({ cls: "tj-add-flip-strat-wrap" });
    // Use manual override if set, else computed
    const sessVal = (t as any).sessionOverride || sessKey || "";
    mountDropdown(sessWrap, sessItems, sessVal, (id) => {
      if (id === "__auto__") {
        delete (t as any).sessionOverride;
      } else {
        (t as any).sessionOverride = id;
      }
      this.renderBody();
    }, { placeholder: "Session…" });

    // ---- Strategy (dropdown — structural change) ----
    const stratRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-strat" });
    stratRow.createEl("span", { cls: "tj-add-flip-key", text: "Strategy" });
    const stratWrap = stratRow.createDiv({ cls: "tj-add-flip-strat-wrap" });
    const setupItems: DropdownItem[] = this.knownSetups.map((s) => ({ id: s, label: s }));
    setupItems.push({ id: "__new__", label: "＋ New strategy…", note: "Saved to Strategies" });
    const currentSetup = (t.setup || "").trim();
    if (currentSetup && !this.knownSetups.some((s) => s.toLowerCase() === currentSetup.toLowerCase())) {
      setupItems.unshift({ id: currentSetup, label: currentSetup });
    }
    mountDropdown(stratWrap, setupItems, currentSetup, async (id) => {
      if (id === "__new__") {
        const name = window.prompt("Name your strategy");
        if (!name || !name.trim()) return;
        const clean = await this.plugin.addSetup(name);
        this.knownSetups = await this.plugin.knownSetups();
        t.setup = clean;
        this.renderBody();
        return;
      }
      t.setup = id;
      this.renderBody();
    }, { placeholder: "Pick a strategy…" });

    // ================================================================
    // SECTION 4: REVIEW — Rating + Notes
    // ================================================================

    // ---- Rating (stars) ----
    const ratingRow = front.createDiv({ cls: "tj-add-flip-row tj-add-flip-row-rating" });
    ratingRow.createEl("span", { cls: "tj-add-flip-key", text: "Rating" });
    const starsWrap = ratingRow.createDiv({ cls: "tj-add-stars" });
    for (let s = 1; s <= 5; s++) {
      const star = starsWrap.createEl("button", {
        cls: "tj-add-star" + ((t.rating ?? 0) >= s ? " active" : ""),
        attr: { type: "button", "aria-label": `Rate ${s} of 5` },
      });
      star.textContent = (t.rating ?? 0) >= s ? "★" : "☆";
      attachTip(star, { title: `${s}/5`, sub: "Click the same star again to clear." });
      star.addEventListener("click", () => {
        t.rating = (t.rating ?? 0) === s ? 0 : s;
        const allStars = starsWrap.querySelectorAll(".tj-add-star");
        allStars.forEach((el, idx) => {
          el.textContent = (t.rating ?? 0) >= idx + 1 ? "★" : "☆";
          el.toggleClass("active", (t.rating ?? 0) >= idx + 1);
        });
      });
    }

    // ---- Notes (single textarea) ----
    const notesGroup = front.createDiv({ cls: "tj-add-field" });
    const notesLabel = notesGroup.createEl("div", { cls: "tj-add-field-label" });
    notesLabel.createEl("span", { text: "Notes" });
    const notesCharCount = notesLabel.createEl("span", { cls: "tj-add-char-count" });
    const notesVal = t.notes || t.thesis || t.review || t.mistake || "";
    notesCharCount.textContent = notesVal ? `${notesVal.length} chars` : "Optional";
    const notesArea = notesGroup.createEl("textarea", {
      cls: "tj-add-textarea",
      attr: { rows: "3", placeholder: "What did you see? What went well or poorly?" },
    });
    notesArea.value = notesVal;
    notesArea.addEventListener("input", () => {
      const len = notesArea.value.trim().length;
      notesCharCount.textContent = len > 0 ? `${len} chars` : "Optional";
    });
    notesArea.addEventListener("change", () => {
      t.notes = notesArea.value.trim();
    });
  }

  // ================================================================
  // SAVE
  // ================================================================
  async doSave(btn: HTMLElement): Promise<void> {
    let trades: Trade[] = [];
    if (this.mode === "csv" && this.parsed) {
      trades = this.parsed.map((t, i) => ({
        ...t,
        setup: (this.rowSetups[i] ?? "").trim(),
        review: (this.rowReviews[i] ?? "").trim(),
      }));
    } else if (this.mode === "manual") {
      for (let i = 0; i < this.manualTrades.length; i++) {
        const t = this.manualTrades[i];
        if (!t.date || !isDateStr(t.date) || !t.account || !t.symbol || isNaN(t.entryPrice) || isNaN(t.exitPrice)) {
          new Notice(`Trade #${i + 1}: Please fill date (YYYY-MM-DD), account, symbol, entry and exit prices.`);
          return;
        }
        const spec = futuresSpec(t.symbol);
        if (t.entryPrice > 0 && t.exitPrice > 0) {
          const points = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
          t.pnl = Math.round(points * spec.pointValue * t.quantity * 100) / 100;
          t.grossPnl = t.pnl;
          t.pnlPoints = Math.round(points * t.quantity * 100) / 100;
        }
        t.accountType = this.plugin.resolveAccountType(t.account);
      }
      trades = this.manualTrades;
    } else {
      new Notice("Nothing to save yet.");
      return;
    }
    // Apply broadcast (copy trades to selected accounts)
    trades = await this.plugin.applyBroadcast(trades, [...this.pickedAccounts]);
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
}
