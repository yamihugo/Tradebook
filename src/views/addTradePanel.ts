import { Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { futuresSpec, FUTURES_SYMBOLS } from "../futures";
import { mountDateField } from "../lib/dates";
import { freeNumeric } from "../lib/numeric";
import { attachTip } from "../lib/tip";
import { fmtMoney2, isDateStr, todayStr, zoneShortLabel } from "../tz";
import { holdFmt } from "../lib/tradeTable";
import { sessionOf } from "../lib/sessions";
import { mountDropdown, DropdownItem } from "../lib/dropdown";
import { openAccountWizard } from "./accountWizard";

export interface AddTradePanelOptions {
  onSaveDone?: () => void;
  /** Closes the frame around the panel — the same as its ✕. */
  onCancel?: () => void;
}

function createDefaultManualTrade(): Trade {
  return {
    id: "",
    date: todayStr(),
    entryTime: "09:30:00",
    exitTime: "09:45:00",
    symbol: "NQ",
    // Filled in by newManualTrade() from the real accounts — a trade never
    // carries an account the journal does not have.
    account: "",
    accountType: "unknown",
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

/**
 * The manual trade form.
 *
 * One trade is one block of fields, laid out the way it is read: what it was
 * (date, account, symbol, setup, direction), then the numbers (size, prices,
 * times), then a live strip that says what the trade came to. The accounts
 * list underneath is the copy question asked out loud — a group arrives ticked
 * and every tick can be removed, because the journal records what happened and
 * never decides it.
 */
export class AddTradePanel {
  plugin: TradebookPlugin;
  onSaveDone?: () => void;
  onCancel?: () => void;
  root: HTMLElement | null = null;
  sheet: HTMLElement | null = null;
  bodyEl: HTMLElement | null = null;
  manualTrades: Trade[] = [];
  pickedAccounts = new Set<string>();
  private prefilledBase = "";
  knownSetups: string[] = [];

  constructor(plugin: TradebookPlugin, opts: AddTradePanelOptions = {}) {
    this.plugin = plugin;
    this.onSaveDone = opts.onSaveDone;
    this.onCancel = opts.onCancel;
  }

  mount(root: HTMLElement): void {
    this.root = root;
    root.addClass("tj-addpanel");
    this.sheet = this.root.createDiv({ cls: "tj-modal-inner" });
    if (!this.manualTrades.length) this.manualTrades = [this.newManualTrade()];
    this.bodyEl = this.sheet.createDiv({ cls: "tj-add-body" });
    this.renderBody();
    void this.plugin
      .loadTrades()
      .then((trades) => {
        const set = new Set<string>();
        for (const tr of trades) if (tr.setup) set.add(tr.setup);
        this.knownSetups = [...set].sort((a, b) => a.localeCompare(b));
        if (this.bodyEl) this.renderBody();
      })
      .catch(() => {});
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
    const acc =
      st.propAccounts.find((a) => a.id === st.defaultAccountId) ||
      (st.propAccounts.length ? st.propAccounts[0] : undefined);
    if (acc) {
      t.account = acc.name;
      t.accountType = acc.type;
    }
    return t;
  }

  renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const form = this.bodyEl.createDiv({ cls: "tj-add-form" });
    this.manualTrades.forEach((t, i) => this.renderTradeBlock(form, t, i));
    this.renderAccounts(form);
    this.renderFooter(form);
  }

  // ================================================================
  // ONE TRADE — the grid, the live strip, the details behind a fold
  // ================================================================
  private renderTradeBlock(parent: HTMLElement, t: Trade, i: number): void {
    const block = parent.createDiv({ cls: "tj-add-block" });

    const grid = block.createDiv({ cls: "tj-add-grid" });
    const spec = futuresSpec(t.symbol || "NQ");
    const pointValue = spec.pointValue;
    const tz = zoneShortLabel(t.timezone || this.plugin.settings.timeZone);

    const field = (label: string, badge?: string): HTMLElement => {
      const f = grid.createDiv({ cls: "tj-add-f" });
      const head = f.createDiv({ cls: "tj-add-f-head" });
      head.createEl("span", { cls: "tj-add-f-lbl", text: label });
      if (badge) head.createSpan({ cls: "tj-add-tz", text: badge });
      return f;
    };

    // ---- Date ----
    const fDate = field("Date");
    mountDateField(fDate.createDiv({ cls: "tj-add-ctl" }), {
      value: t.date || todayStr(),
      format: this.plugin.settings.dateFormat,
      onChange: (v) => {
        t.date = v;
      },
    });

    // ---- Account ----
    const accounts = (this.plugin.settings.propAccounts || []).filter((a) => a.name);
    const roleOrder: Record<string, number> = { base: 0, copier: 1 };
    const sorted = [...accounts].sort(
      (a, b) => (roleOrder[a.copyRole ?? ""] ?? 2) - (roleOrder[b.copyRole ?? ""] ?? 2)
    );
    const fAcct = field("Account");
    const acctWrap = fAcct.createDiv({ cls: "tj-add-ctl" });
    const acctItems: DropdownItem[] = sorted.map((a) => ({
      id: a.name,
      label: a.name,
      note: a.copyRole === "base" ? "Leader" : a.copyRole === "copier" ? "Copier" : undefined,
    }));
    if (!sorted.length) acctItems.push({ id: "", label: "No account yet", disabled: true });
    mountDropdown(
      acctWrap,
      acctItems,
      t.account || acctItems[0].id,
      (id) => {
        t.account = id;
        t.accountType = this.plugin.resolveAccountType(id);
        this.renderBody();
      },
      { placeholder: "Account…" }
    );

    // ---- Symbol ----
    const fSym = field("Symbol");
    const symWrap = fSym.createDiv({ cls: "tj-add-ctl" });
    const listId = `tj-symbol-list-${i}`;
    const symInput = symWrap.createEl("input", {
      cls: "tj-add-input",
      type: "text",
      attr: { list: listId, spellcheck: "false", autocomplete: "off" },
    });
    symInput.value = t.symbol || "";
    const dl = symWrap.createEl("datalist", { attr: { id: listId } });
    for (const s of FUTURES_SYMBOLS) dl.createEl("option", { attr: { value: s } });
    symInput.addEventListener("change", () => {
      t.symbol = (symInput.value || "NQ").toUpperCase().trim();
      symInput.value = t.symbol;
      this.renderBody();
    });

    // ---- Setup ----
    const fSetup = field("Setup");
    const setupItems: DropdownItem[] = this.knownSetups.map((s) => ({ id: s, label: s }));
    setupItems.push({ id: "__new__", label: "＋ New strategy…", note: "Saved to Strategies" });
    const currentSetup = (t.setup || "").trim();
    if (currentSetup && !this.knownSetups.some((s) => s.toLowerCase() === currentSetup.toLowerCase())) {
      setupItems.unshift({ id: currentSetup, label: currentSetup });
    }
    mountDropdown(
      fSetup.createDiv({ cls: "tj-add-ctl" }),
      setupItems,
      currentSetup,
      async (id) => {
        if (id === "__new__") {
          const name = window.prompt("Name your strategy");
          if (!name || !name.trim()) return;
          t.setup = await this.plugin.addSetup(name);
          this.knownSetups = await this.plugin.knownSetups();
          this.renderBody();
          return;
        }
        t.setup = id;
      },
      { placeholder: "No strategy" }
    );

    // ---- Direction ----
    const fDir = field("Direction");
    const seg = fDir.createDiv({ cls: "tj-add-seg" });
    const longBtn = seg.createEl("button", {
      cls: "tj-add-seg-btn" + (t.direction !== "short" ? " on" : ""),
      text: "Long",
      attr: { type: "button" },
    });
    const shortBtn = seg.createEl("button", {
      cls: "tj-add-seg-btn" + (t.direction === "short" ? " on" : ""),
      text: "Short",
      attr: { type: "button" },
    });
    const setDirection = (d: "long" | "short") => {
      t.direction = d;
      longBtn.toggleClass("on", d === "long");
      shortBtn.toggleClass("on", d === "short");
      paint();
    };
    longBtn.addEventListener("click", () => setDirection("long"));
    shortBtn.addEventListener("click", () => setDirection("short"));

    // ---- Quantity ----
    const fQty = field("Quantity");
    const qtyInput = freeNumeric(
      fQty.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    qtyInput.value = String(t.quantity || 1);
    qtyInput.addEventListener("input", () => {
      const n = parseInt(qtyInput.value, 10);
      if (Number.isFinite(n) && n > 0) t.quantity = n;
      paint();
    });

    // ---- Entry price ----
    const fEntry = field("Entry price");
    const entryInput = freeNumeric(
      fEntry.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    entryInput.value = t.entryPrice ? String(t.entryPrice) : "";
    entryInput.addEventListener("input", () => {
      t.entryPrice = parseFloat(entryInput.value) || 0;
      paint();
    });

    // ---- Exit price ----
    const fExit = field("Exit price");
    const exitInput = freeNumeric(
      fExit.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    exitInput.value = t.exitPrice ? String(t.exitPrice) : "";
    exitInput.addEventListener("input", () => {
      t.exitPrice = parseFloat(exitInput.value) || 0;
      paint();
    });

    // ---- Times (HH:MM:SS, kept n the journal's own clock) ----
    const timeInput = (host: HTMLElement, value: string, onSet: (v: string) => void) => {
      const input = host.createEl("input", {
        cls: "tj-add-input",
        type: "text",
        attr: { placeholder: "HH:MM:SS", inputmode: "numeric", autocomplete: "off" },
      });
      input.value = value || "";
      input.addEventListener("change", () => {
        const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input.value.trim());
        if (m) {
          const clean = `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}:${(m[3] || "00").padStart(2, "0")}`;
          onSet(clean);
          input.value = clean;
        } else {
          input.value = value || "";
        }
        paint();
      });
    };
    timeInput(field("Entry time", tz), t.entryTime || "", (v) => {
      t.entryTime = v;
    });
    timeInput(field("Exit time", tz), t.exitTime || "", (v) => {
      t.exitTime = v;
    });

    // ---- The strip: what the trade came to, updated as you type ----
    const strip = block.createDiv({ cls: "tj-add-strip" });
    const cell = (label: string) => {
      const c = strip.createDiv({ cls: "tj-add-strip-cell" });
      c.createSpan({ cls: "tj-add-strip-k", text: label });
      return c.createSpan({ cls: "tj-add-strip-v" });
    };
    const vPnl = cell("P&L");
    const vPts = cell("Points");
    const vHold = cell("Hold");
    strip.createDiv({ cls: "tj-add-strip-spacer" });
    const vNet = cell("Net after fees");

    /** Risk $ lives in the fold; the strip repaints it too, from the same numbers. */
    let vRisk: HTMLElement | null = null;

    const paint = () => {
      const qty = t.quantity || 1;
      if (t.entryPrice > 0 && t.exitPrice > 0) {
        const pts = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
        t.pnl = Math.round(pts * pointValue * qty * 100) / 100;
        t.grossPnl = t.pnl;
        t.pnlPoints = Math.round(pts * qty * 100) / 100;
      } else {
        t.pnl = 0;
        t.grossPnl = 0;
        t.pnlPoints = 0;
      }
      vPnl.setText(fmtMoney2(t.pnl));
      vPnl.className = "tj-add-strip-v " + (t.pnl >= 0 ? "pos" : "neg");
      vPts.setText(`${t.pnlPoints >= 0 ? "+" : ""}${t.pnlPoints.toFixed(2)}`);
      vPts.className = "tj-add-strip-v";
      vHold.setText(holdFmt(t.entryTime, t.exitTime));
      vHold.className = "tj-add-strip-v";
      const net = Math.round((t.pnl - (t.commission || 0) - (t.fees || 0)) * 100) / 100;
      vNet.setText(fmtMoney2(net));
      vNet.className = "tj-add-strip-v " + (net >= 0 ? "pos" : "neg");
      paintExtra();
    };

    // ---- More details (folded): the plan, the order, the fees, the rating ----
    const more = block.createEl("details", { cls: "tj-add-more" });
    more.createEl("summary", { cls: "tj-add-more-sum", text: "More details" });
    const mGrid = more.createDiv({ cls: "tj-add-grid" });
    const mField = (label: string): HTMLElement => {
      const f = mGrid.createDiv({ cls: "tj-add-f" });
      f.createEl("span", { cls: "tj-add-f-lbl", text: label });
      return f;
    };

    // ---- Stop / Target ----
    const fStop = mField("Stop");
    const stopInput = freeNumeric(
      fStop.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    stopInput.value = t.stopLoss ? String(t.stopLoss) : "";
    stopInput.addEventListener("input", () => {
      const v = parseFloat(stopInput.value);
      if (Number.isFinite(v)) t.stopLoss = v;
      paint();
    });
    const fTarget = mField("Target");
    const targetInput = freeNumeric(
      fTarget.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    targetInput.value = t.target ? String(t.target) : "";
    targetInput.addEventListener("input", () => {
      const v = parseFloat(targetInput.value);
      if (Number.isFinite(v)) t.target = v;
      paint();
    });

    // ---- Risk $ (read-only: derived from stop, size and the point value) ----
    const fRisk = mField("Risk $");
    vRisk = fRisk.createDiv({ cls: "tj-add-ro" });

    // ---- Fees ----
    const fFees = mField("Fees");
    const feesInput = freeNumeric(
      fFees.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    feesInput.value = String((t.commission || 0) + (t.fees || 0) || "");
    feesInput.addEventListener("input", () => {
      t.commission = 0;
      t.fees = parseFloat(feesInput.value) || 0;
      paint();
    });

    // ---- Order type ----
    const fOt = mField("Order type");
    mountDropdown(
      fOt.createDiv({ cls: "tj-add-ctl" }),
      [
        { id: "limit", label: "Limit" },
        { id: "market", label: "Market" },
        { id: "stop", label: "Stop" },
        { id: "stop-limit", label: "Stop limit" },
      ],
      t.orderType || "",
      (id) => {
        t.orderType = id;
      },
      { placeholder: "—" }
    );

    // ---- Session ----
    const fSess = mField("Session");
    const sessItems: DropdownItem[] = [
      { id: "newyork", label: "New York" },
      { id: "london", label: "London" },
      { id: "asia", label: "Asia" },
      { id: "off", label: "Off hours" },
      { id: "__auto__", label: "Auto-detect", note: "From the entry time" },
    ];
    const sessVal = (t as any).sessionOverride || sessionOf(t, this.plugin.settings?.timeZone || "") || "";
    mountDropdown(
      fSess.createDiv({ cls: "tj-add-ctl" }),
      sessItems,
      sessVal,
      (id) => {
        if (id === "__auto__") delete (t as any).sessionOverride;
        else (t as any).sessionOverride = id;
      },
      { placeholder: "Session…" }
    );

    const paintExtra = () => {
      const qty = t.quantity || 1;
      const riskDollar =
        t.stopLoss && t.entryPrice ? Math.abs(t.entryPrice - t.stopLoss) * pointValue * qty : null;
      vRisk?.setText(riskDollar !== null ? `$${riskDollar.toFixed(0)}` : "—");
    };

    // ---- Rating ----
    const ratingRow = more.createDiv({ cls: "tj-add-more-row" });
    ratingRow.createEl("span", { cls: "tj-add-f-lbl", text: "Rating" });
    const stars = ratingRow.createDiv({ cls: "tj-add-stars" });
    const drawStars = () => {
      stars.empty();
      for (let s = 1; s <= 5; s++) {
        const star = stars.createEl("button", {
          cls: "tj-add-star" + ((t.rating ?? 0) >= s ? " on" : ""),
          text: (t.rating ?? 0) >= s ? "★" : "☆",
          attr: { type: "button", "aria-label": `Rate ${s} of 5` },
        });
        attachTip(star, { title: `${s}/5`, sub: "Click the same star to clear." });
        star.addEventListener("click", () => {
          t.rating = (t.rating ?? 0) === s ? 0 : s;
          drawStars();
        });
      }
    };
    drawStars();

    paint();
  }

  // ================================================================
  // ACCOUNTS ON THIS TRADE — the copy question, asked out loud
  // ================================================================
  private renderAccounts(parent: HTMLElement): void {
    const accounts = (this.plugin.settings.propAccounts || []).filter((a) => a.name);
    const box = parent.createDiv({ cls: "tj-add-accounts" });
    const head = box.createDiv({ cls: "tj-add-accounts-head" });
    head.createSpan({ cls: "tj-add-accounts-lbl", text: "Accounts on this trade" });
    const link = head.createEl("a", { cls: "tj-add-accounts-add", text: "+ Add an account" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openAccountWizard(this.plugin, { onDone: () => this.renderBody() });
    });

    if (!accounts.length) {
      box.createDiv({
        cls: "tj-add-accounts-hint",
        text: "No accounts yet. Create one and this trade is recorded there — nothing is created for you.",
      });
      return;
    }

    const baseName = this.manualTrades[0]?.account ?? "";
    const base = accounts.find((a) => a.name === baseName);
    const members =
      base && base.copyRole === "base"
        ? accounts.filter((a) => a.copyRole === "copier" && a.copyBaseId === base.id)
        : [];

    // A copy group arrives ticked — once per base account, never on every repaint.
    if (this.prefilledBase !== baseName) {
      this.prefilledBase = baseName;
      this.pickedAccounts.clear();
      if (base) this.pickedAccounts.add(base.id);
      for (const m of members) this.pickedAccounts.add(m.id);
    }

    const list = box.createDiv({ cls: "tj-add-acclist" });
    for (const acc of accounts) {
      const row = list.createEl("label", { cls: "tj-add-acc" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.pickedAccounts.has(acc.id);
      // The same green dot as the import review: the tick is the control, the
      // dot is the state, and the whole row is what you hit.
      const dot = row.createSpan({ cls: "tj-add-accdot" + (cb.checked ? " is-on" : "") });
      cb.addEventListener("change", () => {
        if (cb.checked) this.pickedAccounts.add(acc.id);
        else this.pickedAccounts.delete(acc.id);
        dot.toggleClass("is-on", cb.checked);
      });
      row.createSpan({ cls: "tj-add-acc-name", text: acc.name });
      const who = row.createDiv({ cls: "tj-add-acc-who" });
      if (acc.copyRole === "base") who.createSpan({ cls: "tj-role is-leader", text: "Leader" });
      if (acc.copyRole === "copier") {
        who.createSpan({ cls: "tj-role is-copier", text: "Copier" });
        if (Number.isFinite(acc.copyMultiplier)) {
          who.createSpan({ cls: "tj-ratio", text: `×${acc.copyMultiplier}` });
        }
      }
      if (acc.name === baseName) who.createSpan({ cls: "tj-role", text: "This one" });
      else if (!acc.copyRole) who.createSpan({ cls: "tj-ratio", text: "not in a group" });
    }

    if (members.length) {
      const note = box.createDiv({ cls: "tj-add-grp" });
      note.createEl("b", { text: "Copy group recognised. " });
      const said = members
        .map((m) => `${m.name}${Number.isFinite(m.copyMultiplier) ? ` (×${m.copyMultiplier})` : ""}`)
        .join(" and ");
      note.createSpan({ text: `This trade is also recorded in ${said}.` });
      note.createDiv({
        cls: "tj-add-grp-sub",
        text: "Untick any account you don't want — nothing is enforced; the journal only records what happened.",
      });
    }
  }

  // ================================================================
  // FOOTER
  // ================================================================
  private renderFooter(parent: HTMLElement): void {
    const foot = parent.createDiv({ cls: "tj-add-foot" });
    const cancel = foot.createEl("button", {
      cls: "tj-actionbtn",
      text: "Cancel",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.onCancel?.());
    foot.createDiv({ cls: "tj-add-foot-spacer" });
    // One trade at a time, on purpose: a single form is what can be checked
    // against the platform, and it is what a phone can hold.
    const save = foot.createEl("button", {
      cls: "tj-actionbtn is-primary",
      text: "Save trade",
      attr: { type: "button" },
    });
    save.addEventListener("click", () => this.doSave(save));
    // A trade belongs to an account. With none, there is nowhere to put it —
    // say so on the button instead of failing after the click.
    if (!(this.plugin.settings.propAccounts || []).some((a) => a.name)) {
      save.setAttr("disabled", "true");
      attachTip(save, { title: "No account yet", sub: "Create one first — every trade is recorded in an account." });
    }
  }

  // ================================================================
  // SAVE
  // ================================================================
  async doSave(btn: HTMLElement): Promise<void> {
    if (!this.manualTrades.length) {
      new Notice("Nothing to save yet.");
      return;
    }
    for (let i = 0; i < this.manualTrades.length; i++) {
      const t = this.manualTrades[i];
      if (!t.date || !isDateStr(t.date)) {
        new Notice("Pick a date.");
        return;
      }
      if (!t.account || !t.symbol) {
        new Notice("Pick an account and a symbol.");
        return;
      }
      if (!(t.entryPrice > 0) || !(t.exitPrice > 0)) {
        new Notice("Fill the entry and exit prices.");
        return;
      }
      const spec = futuresSpec(t.symbol);
      const points = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
      t.pnl = Math.round(points * spec.pointValue * t.quantity * 100) / 100;
      t.grossPnl = t.pnl;
      t.pnlPoints = Math.round(points * t.quantity * 100) / 100;
      t.accountType = this.plugin.resolveAccountType(t.account);
    }
    // Copies for the ticked accounts — the journal records every leg it was told about.
    const trades = await this.plugin.applyBroadcast(this.manualTrades, [...this.pickedAccounts]);
    btn.setAttr("disabled", "true");
    btn.setText("Saving…");
    const count = await this.plugin.storeTrades(trades);
    new Notice(count === 1 ? "1 trade saved." : `${count} trades saved.`);
    if (count > 0) {
      this.onSaveDone?.();
    } else {
      btn.removeAttribute("disabled");
      btn.setText("Save trade");
    }
  }
}
