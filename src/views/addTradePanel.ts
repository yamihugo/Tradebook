import { Notice } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import {
  CORE_SYMBOLS,
  contractLabel,
  coreInstrumentOf,
  futuresSpec,
  knownFuturesSpec,
  supportedDefaultSymbol,
} from "../futures";
import { formatDate, mountDateField } from "../lib/dates";
import { copierPresentation, effectiveCopyConfig, isActiveCopier } from "../lib/copy";
import { freeNumeric } from "../lib/numeric";
import { attachTip } from "../lib/tip";

/**
 * What the ×N on a copier means, said the same way everywhere it appears.
 * Contracts per leader contract — not the follower's account size, and not its
 * dollar rules, which is the reading almost every reader brings to it.
 */
const RATIO_TIP = {
  title: "Copy ratio",
  sub: "Contracts copied per leader contract. It sizes the copy legs \u2014 it does not change the follower's account size or its rules.",
};
import { fmtMoney2, isDateStr, todayKey, zoneShortLabel } from "../tz";
import { holdFmtOf } from "../lib/tradeTable";
import { ManualPin, pinManualInstants } from "../lib/instant";
import { netPnl, priceFromRisk } from "../lib/fees";
import { buildManualExitFills, isManualClock, type ManualExitFillInput } from "../lib/manualTradeFills";
import { sessionOf } from "../lib/sessions";
import { mountDropdown, DropdownItem } from "../lib/dropdown";
import { openAccountWizard } from "./accountWizard";

export interface AddTradePanelOptions {
  onSaveDone?: () => void;
  /** Closes the frame around the panel — the same as its ✕. */
  onCancel?: () => void;
}

interface ManualExitDraft {
  quantity: string;
  price: string;
  time: string;
}

function createDefaultManualTrade(journalZone = ""): Trade {
  return {
    id: "",
    date: todayKey(journalZone),
    entryTime: "09:30:00",
    exitTime: "09:45:00",
    // Empty until the trader picks. Nothing is assumed here: a contract the
    // journal does not support is not swapped for one it does, and the risk
    // the trader configured waits for the symbol that prices it.
    symbol: "",
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
    pnl: 0,
    pnlPoints: 0,
    setup: "",
    mistake: "",
    review: "",
    screenshot: "",
    thesis: "",
    rating: 0,
    // Provenance, stated once here so every hand-typed note carries it: this is
    // a trade the trader recorded, not a broker fill and not a model. Without it
    // the trade page had nothing to show and the note read as legacy.
    origin: "manual",
    dataSource: "manual",
    // The review flag is deliberately left unset. "Unset" means the checklist
    // decides — the trader's word closes or holds a trade, and a hand-typed one
    // is not held open by the fact that nobody typed `reviewed`.
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
  private exitDrafts = new WeakMap<Trade, ManualExitDraft[]>();
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
      .knownSetups()
      .then((names) => {
        this.knownSetups = names;
        // One registered strategy needs no decision — pre-fill it. Two or more
        // is a real choice, so it is left to the trader.
        if (this.knownSetups.length === 1) {
          for (const t of this.manualTrades) if (!(t.setup || "").trim()) t.setup = this.knownSetups[0];
        }
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
    const t = createDefaultManualTrade(this.plugin.settings.timeZone);
    const st = this.plugin.settings;
    // A configured default fills the field; one the journal does not support is
    // ignored, so the field starts empty rather than on a contract nobody chose.
    t.symbol = supportedDefaultSymbol(st.defaultSymbol);
    const acc = st.propAccounts.length ? st.propAccounts[0] : undefined;
    if (acc) {
      t.account = acc.name;
      t.accountType = acc.type;
    }
    return t;
  }

  private exitsFor(t: Trade): ManualExitDraft[] {
    const current = this.exitDrafts.get(t);
    if (current) return current;
    const drafts = [
      {
        quantity: String(t.quantity || 1),
        price: t.exitPrice > 0 ? String(t.exitPrice) : "",
        time: t.exitTime || "",
      },
    ];
    this.exitDrafts.set(t, drafts);
    return drafts;
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
    // Money per point belongs to the contract. Until the field names one that
    // can be priced there is no point value to use, so every figure that needs
    // it waits rather than borrowing another contract's — the empty field means
    // "waiting for a symbol", not NQ and not $1 a point.
    const priced = knownFuturesSpec(t.symbol || "");
    const pointValue = priced ? priced.pointValue : null;
    const tz = zoneShortLabel(t.timezone || this.plugin.settings.timeZone);
    const exitDrafts = this.exitsFor(t);

    const field = (label: string, badge?: string): HTMLElement => {
      const f = grid.createDiv({ cls: "tj-add-f" });
      const head = f.createDiv({ cls: "tj-add-f-head" });
      head.createSpan({ cls: "tj-add-f-lbl", text: label });
      if (badge) head.createSpan({ cls: "tj-add-tz", text: badge });
      return f;
    };

    // ---- Date ----
    const fDate = field("Date");
    const dateCtl = fDate.createDiv({ cls: "tj-add-ctl" });
    // The tracking boundary, said while the date is still editable. A trade
    // typed before an account's tracking date is kept as history and left out
    // of every number — that is the rule, and a trader should hear it here, not
    // discover it in a total six weeks later. Nothing is blocked.
    const boundaryNote = fDate.createDiv({ cls: "tj-add-boundary is-hidden" });
    const paintBoundary = (): void => {
      const acc = (this.plugin.settings.propAccounts || []).find((a) => a.name === t.account);
      const start = acc?.trackingStart;
      const late = !!start && !!t.date && t.date < start;
      boundaryNote.toggleClass("is-hidden", !late);
      if (!late) return;
      boundaryNote.setText(
        `${formatDate(t.date, this.plugin.settings.dateFormat)} is before ${acc.name} starts tracking (${formatDate(start, this.plugin.settings.dateFormat)}). The trade is kept as history and left out of its totals.`
      );
    };
    mountDateField(dateCtl, {
      value: t.date || todayKey(this.plugin.settings.timeZone),
      format: this.plugin.settings.dateFormat,
      zone: this.plugin.settings.timeZone,
      onChange: (v) => {
        t.date = v;
        paintBoundary();
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

    paintBoundary();

    // ---- Symbol ----
    // The field suggests the contracts the journal supports — the core twelve —
    // and nothing else. Free text always works: the journal never refuses a
    // contract, it only says when it cannot price what was typed.
    const fSym = field("Symbol");
    const symWrap = fSym.createDiv({ cls: "tj-add-ctl" });
    const listId = `tj-symbol-list-${i}`;
    const symInput = symWrap.createEl("input", {
      cls: "tj-add-input",
      type: "text",
      attr: { list: listId, spellcheck: "false", autocomplete: "off", placeholder: "Contract…" },
    });
    symInput.value = t.symbol || "";
    const dl = symWrap.createEl("datalist", { attr: { id: listId } });
    for (const sym of CORE_SYMBOLS) {
      const spec = futuresSpec(sym);
      dl.createEl("option", {
        attr: { value: sym, label: `${contractLabel(sym)} — ${spec.name ?? sym}` },
      });
    }

    let symRow: HTMLElement | null = null;
    const renderSymNote = (): void => {
      // The note exists only when there is something to say, so a field with
      // nothing to report is not left with an empty row under it.
      symRow?.remove();
      symRow = null;
      const symbol = t.symbol || "";
      // An empty field is a decision not made yet, not a wrong contract: it says
      // nothing until the trader names one.
      if (!symbol) return;
      symRow = fSym.createDiv({ cls: "tj-add-hint" });
      const symNote = symRow.createSpan();
      const instrument = coreInstrumentOf(symbol);
      const perPoint = futuresSpec(symbol).pointValue;
      if (knownFuturesSpec(symbol) === null) {
        symNote.createEl("b", { text: "Not a contract this journal prices. " });
        symNote.createSpan({
          text: "The trade is recorded either way, but money per point stays a placeholder — set the risk yourself.",
        });
        return;
      }
      if (!instrument) {
        // A priced contract that is not one of ours: there is no instrument to
        // describe, and an empty row is only a gap.
        symRow.remove();
        symRow = null;
        return;
      }
      const size =
        symbol === instrument.micro
          ? `${instrument.micro} micro of ${instrument.mini}`
          : `${instrument.mini} mini · ${instrument.micro} micro`;
      symNote.createSpan({
        text: `${instrument.label} — ${size} · $${perPoint} per point.`,
      });
    };
    renderSymNote();

    symInput.addEventListener("change", () => {
      t.symbol = symInput.value.toUpperCase().trim();
      symInput.value = t.symbol;
      renderSymNote();
      // A stop that came out of a dollar risk was priced against the contract
      // that was in the field a moment ago, so it is read again — against the
      // one just named, or dropped when nothing can be priced. A stop the trader
      // typed is theirs and stays.
      if (t.stopSource === "assumed") {
        delete t.stopLoss;
        delete t.stopSource;
      }
      deriveStopFromRisk?.(knownFuturesSpec(t.symbol)?.pointValue ?? null);
      this.renderBody();
    });

    // ---- Strategy (the form asks; the engine never imposes — §0) ----
    // "No strategy" is the default and a real answer: an unfiled trade saves,
    // and the review checklist reports the strategy as missing on its own.
    const fSetup = field("Strategy");
    const setupItems: DropdownItem[] = [
      { id: "__none__", label: "No strategy", note: "Record it without filing it under one" },
    ];
    for (const s of this.knownSetups) setupItems.push({ id: s, label: s });
    setupItems.push({ id: "__new__", label: "＋ New strategy…", note: "Saved to Strategies" });
    const currentSetup = (t.setup || "").trim();
    if (currentSetup && !this.knownSetups.some((s) => s.toLowerCase() === currentSetup.toLowerCase())) {
      setupItems.unshift({ id: currentSetup, label: currentSetup });
    }
    mountDropdown(
      fSetup.createDiv({ cls: "tj-add-ctl" }),
      setupItems,
      currentSetup || "__none__",
      (id) => void (async () => {
        if (id === "__new__") {
          const name = window.prompt("Name your strategy");
          if (!name || !name.trim()) return;
          t.setup = await this.plugin.addSetup(name);
          this.knownSetups = await this.plugin.knownSetups();
          this.renderBody();
          return;
        }
        if (id === "__none__") {
          t.setup = "";
          this.renderBody();
          return;
        }
        t.setup = id;
        this.renderBody();
      })(),
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
      if (Number.isFinite(n) && n > 0) {
        t.quantity = n;
        if (exitDrafts.length === 1) exitDrafts[0].quantity = String(n);
      }
      paint();
    });

    // ---- Entry price ----
    /** Set once the Risk $ field exists: turns the typed risk into a stop. The
     *  point value is the contract's, and a symbol chosen after this render is
     *  passed in rather than read from the closure. */
    let deriveStopFromRisk: ((pricedValue?: number | null) => void) | null = null;
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
      deriveStopFromRisk?.();
      paint();
    });

    // ---- Times (HH:MM:SS, kept n the journal's own clock) ----
    /** Re-mounts the Session dropdown in place when the entry time moves it. */
    let remountSession: (() => void) | null = null;
    const timeInput = (
      host: HTMLElement,
      value: string,
      onSet: (v: string) => void,
      ariaLabel?: string,
    ): HTMLInputElement => {
      const input = host.createEl("input", {
        cls: "tj-add-input",
        type: "text",
        attr: { placeholder: "Hh:mm:ss", inputmode: "numeric", autocomplete: "off" },
      });
      if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
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
      return input;
    };
    timeInput(field("Entry time", tz), t.entryTime || "", (v) => {
      t.entryTime = v;
      // The session follows the entry time unless the trader pinned one.
      if (!t.sessionOverride) remountSession?.();
    });
    // Each row is an actual close, not a planned target. The total position
    // size stays above; when there is more than one exit, each row must account
    // for its own whole-contract quantity.
    const exitsSection = block.createDiv({ cls: "tj-add-exits" });
    const exitsHead = exitsSection.createDiv({ cls: "tj-add-exits-head" });
    exitsHead.createSpan({ cls: "tj-add-exits-title", text: "Actual exits" });
    const addExitButton = exitsHead.createEl("button", {
      cls: "tj-actionbtn tj-add-exit-add",
      text: "+ Add exit",
      attr: { type: "button" },
    });
    const exitList = exitsSection.createDiv({ cls: "tj-add-exit-list" });
    const exitSummary = exitsSection.createDiv({ cls: "tj-add-hint", attr: { "aria-live": "polite" } });
    exitsSection.createDiv({
      cls: "tj-add-hint",
      text: "Record the prices and times that actually filled. Exit quantities must add up to the trade size. TP, SL and BE labels are calculated automatically.",
    });

    // ---- The strip: what the trade came to, updated as you type ----
    const strip = block.createDiv({ cls: "tj-add-strip" });
    const cell = (label: string) => {
      const c = strip.createDiv({ cls: "tj-add-strip-cell" });
      c.createSpan({ cls: "tj-add-strip-k", text: label });
      return c.createSpan({ cls: "tj-add-strip-v" });
    };
    const vPnl = cell("P&L");
    const vPts = cell("Realized pts/contract");
    const vHold = cell("Hold");
    strip.createDiv({ cls: "tj-add-strip-spacer" });
    const vNet = cell("Net after fees");

    /** Risk $ lives in the fold; the strip repaints it too, from the same numbers. */
    let vRisk: HTMLInputElement | null = null;

    const paint = () => {
      const qty = t.quantity || 1;
      const multiple = exitDrafts.length > 1;
      const quantities = exitDrafts.map((draft) => (multiple ? Number(draft.quantity) : qty));
      const validQuantities = quantities.every((value) => Number.isSafeInteger(value) && value > 0);
      const exitQty = quantities.reduce(
        (sum, value) => sum + (Number.isSafeInteger(value) && value > 0 ? value : 0),
        0,
      );
      const exitValues = exitDrafts.map((draft) => Number.parseFloat(draft.price));
      const validPrices = exitValues.every((value) => Number.isFinite(value) && value > 0);
      const validTimes = !multiple || (isManualClock(t.entryTime) && exitDrafts.every((draft) => isManualClock(draft.time)));
      const quantityMatches = validQuantities && exitQty === qty;
      const hasActualPrices = t.entryPrice > 0 && validPrices && validTimes && quantityMatches;
      const weightedExit = hasActualPrices
        ? exitDrafts.reduce((sum, draft, index) => sum + exitValues[index] * quantities[index], 0) / exitQty
        : 0;
      if (multiple) {
        exitSummary.setText(
          quantityMatches
            ? `Exit quantities match the trade size (${exitQty} contracts).`
            : !validQuantities
              ? `Enter a whole-contract quantity for every exit (${exitQty} / ${qty} assigned).`
              : `Exit quantities: ${exitQty} / ${qty} contracts — they must match the trade size.`,
        );
      } else {
        exitSummary.setText(`All ${qty} contract${qty === 1 ? "" : "s"} close on this exit.`);
      }
      addExitButton.disabled = qty <= exitDrafts.length;
      if (hasActualPrices) {
        t.exitPrice = weightedExit;
        if (multiple) {
          const entrySeconds = t.entryTime.split(":").map(Number).reduce((total, value, index) => total + value * [3600, 60, 1][index], 0);
          const latestExit = exitDrafts
            .map((draft) => {
              const parts = draft.time.split(":").map(Number);
              const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
              return { time: draft.time, order: seconds + (seconds < entrySeconds ? 86400 : 0) };
            })
            .sort((a, b) => a.order - b.order)[exitDrafts.length - 1];
          t.exitTime = latestExit.time;
        } else {
          t.exitTime = exitDrafts[0].time;
        }
      }
      if (hasActualPrices) {
        const pts = t.direction === "long" ? weightedExit - t.entryPrice : t.entryPrice - weightedExit;
        // pnl is the GROSS: points × pointValue × qty. Commission and fees stay
        // in their own fields; the net is derived for the strip's last cell. With
        // no priced contract there is no point value to multiply by, so the
        // money waits — the points below are price distance and stand on their own.
        t.pnl = pointValue === null ? Number.NaN : Math.round(pts * pointValue * qty * 100) / 100;
        // Points are price distance — the quantity never multiplies them.
        t.pnlPoints = Math.round(pts * 100) / 100;
      } else {
        t.pnl = Number.NaN;
        t.pnlPoints = Number.NaN;
      }
      const net = netPnl(t);
      vPnl.setText(!hasActualPrices || !Number.isFinite(t.pnl) ? "—" : fmtMoney2(t.pnl));
      vPnl.className = "tj-add-strip-v " + (!Number.isFinite(t.pnl) ? "" : t.pnl >= 0 ? "pos" : "neg");
      vPts.setText(Number.isFinite(t.pnlPoints) ? `${t.pnlPoints >= 0 ? "+" : ""}${t.pnlPoints.toFixed(2)}` : "—");
      vPts.className = "tj-add-strip-v";
      vHold.setText(holdFmtOf(t));
      vHold.className = "tj-add-strip-v";
      vNet.setText(!hasActualPrices || !Number.isFinite(net) ? "—" : fmtMoney2(net));
      vNet.className = "tj-add-strip-v " + (!Number.isFinite(net) ? "" : net >= 0 ? "pos" : "neg");
      paintExtra();
    };

    const renderExitRows = (): void => {
      exitList.empty();
      const multiple = exitDrafts.length > 1;
      exitDrafts.forEach((draft, index) => {
        const row = exitList.createDiv({ cls: "tj-add-exit-row" });
        const rowHead = row.createDiv({ cls: "tj-add-exit-head" });
        rowHead.createSpan({ cls: "tj-add-exit-title", text: `Exit ${index + 1}` });
        if (multiple) {
          const remove = rowHead.createEl("button", {
            cls: "tj-actionbtn tj-add-exit-remove",
            text: "Remove",
            attr: { type: "button", "aria-label": `Remove exit ${index + 1}` },
          });
          remove.addEventListener("click", () => {
            exitDrafts.splice(index, 1);
            if (exitDrafts.length === 1) exitDrafts[0].quantity = String(t.quantity || 1);
            renderExitRows();
            paint();
          });
        }
        const fields = row.createDiv({ cls: "tj-add-exit-fields" });
        const makeField = (label: string, id: string): HTMLElement => {
          const fieldEl = fields.createDiv({ cls: "tj-add-f" });
          fieldEl.createEl("label", { cls: "tj-add-f-lbl", text: label, attr: { for: id } });
          return fieldEl;
        };
        if (multiple) {
          const id = `tj-manual-exit-${i}-${index}-quantity`;
          const quantityInput = freeNumeric(
            makeField("Contracts", id).createEl("input", {
              cls: "tj-add-input",
              type: "number",
              attr: { min: "1", step: "1", id, "aria-label": `Exit ${index + 1} contracts` },
            }),
          );
          quantityInput.value = draft.quantity;
          quantityInput.addEventListener("input", () => {
            draft.quantity = quantityInput.value;
            paint();
          });
        }
        const priceId = `tj-manual-exit-${i}-${index}-price`;
        const priceInput = freeNumeric(
          makeField("Price", priceId).createEl("input", {
            cls: "tj-add-input",
            type: "number",
            attr: { id: priceId, "aria-label": `Exit ${index + 1} price` },
          }),
        );
        priceInput.value = draft.price;
        priceInput.addEventListener("input", () => {
          draft.price = priceInput.value;
          paint();
        });
        const timeId = `tj-manual-exit-${i}-${index}-time`;
        const timeField = fields.createDiv({ cls: "tj-add-f" });
        const timeHead = timeField.createDiv({ cls: "tj-add-f-head" });
        timeHead.createEl("label", { cls: "tj-add-f-lbl", text: "Time", attr: { for: timeId } });
        if (tz) timeHead.createSpan({ cls: "tj-add-tz", text: tz });
        const time = timeInput(
          timeField,
          draft.time,
          (value) => {
            draft.time = value;
          },
          `Exit ${index + 1} time`,
        );
        time.id = timeId;
      });
      addExitButton.disabled = (t.quantity || 1) <= exitDrafts.length;
    };
    addExitButton.addEventListener("click", () => {
      if ((t.quantity || 1) <= exitDrafts.length) return;
      exitDrafts.push({ quantity: "", price: "", time: "" });
      renderExitRows();
      paint();
    });

    // ---- More details (folded): the plan, the order, the fees, the rating ----
    const more = block.createEl("details", { cls: "tj-add-more" });
    // Named for what is inside it: stop, target and risk are not "more
    // details", they are the plan this trade was part of.
    more.createEl("summary", { cls: "tj-add-more-sum", text: "Risk, costs and session" });
    const mGrid = more.createDiv({ cls: "tj-add-grid" });
    const mField = (label: string): HTMLElement => {
      const f = mGrid.createDiv({ cls: "tj-add-f" });
      f.createSpan({ cls: "tj-add-f-lbl", text: label });
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
      if (Number.isFinite(v)) {
        t.stopLoss = v;
        delete t.stopSource;
      }
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

    // ---- Risk $ (editable: it and the Stop price derive from each other) ----
    const fRisk = mField("Risk $");
    // Risk and stop are the same number in two directions. Typing here moves
    // the stop, and the stop it writes is ASSUMED, not recorded \u2014 which is
    // what the trade page later has to say out loud.
    attachTip(fRisk.querySelector(".tj-add-f-lbl") as HTMLElement, {
      title: "Risk",
      sub: "Type it and the stop moves to match. A stop written this way is marked assumed, not recorded \u2014 the journal says so wherever it shows.",
    });
    const riskInput = freeNumeric(
      fRisk.createEl("input", {
        cls: "tj-add-input",
        type: "number",
      })
    );
    vRisk = riskInput;
    // A default dollar risk (Settings → New trades) is a starting point, not a
    // rule: it seeds the field and, once an entry price exists, derives the stop.
    const defaultRisk = this.plugin.settings.defaultRisk ?? 0;
    if (!t.stopLoss && defaultRisk > 0) riskInput.value = String(defaultRisk);
    // While the field is being typed in, paintExtra must not overwrite it with
    // the value derived from the stop — that would fight the caret.
    let editingRisk = false;
    /** Re-reads the stop from the risk the trader still has. `pricedValue` is a
     *  parameter because a contract chosen in this render has no point value yet
     *  — the caller passes the one it just resolved. */
    deriveStopFromRisk = (pricedValue: number | null = pointValue): void => {
      const risk = parseFloat(riskInput.value);
      if (!Number.isFinite(risk) || risk <= 0 || t.entryPrice <= 0) return;
      if (t.stopLoss && !editingRisk) return;
      // No priced contract, no stop distance: the risk the trader configured
      // stays in its field and the derivation waits for the symbol.
      if (pricedValue === null) return;
      const stop = priceFromRisk(t.entryPrice, t.direction, risk, pricedValue, t.quantity || 1);
      if (stop !== null) {
        const rounded = Math.round(stop * 100) / 100;
        t.stopLoss = rounded;
        t.stopSource = "assumed";
        stopInput.value = String(rounded);
      }
    };
    riskInput.addEventListener("focus", () => {
      editingRisk = true;
    });
    riskInput.addEventListener("blur", () => {
      editingRisk = false;
    });
    riskInput.addEventListener("input", () => {
      const risk = parseFloat(riskInput.value);
      const qty = t.quantity || 1;
      if (pointValue !== null && Number.isFinite(risk) && risk > 0) {
        const stop = priceFromRisk(t.entryPrice, t.direction, risk, pointValue, qty);
        if (stop !== null) {
          const rounded = Math.round(stop * 100) / 100;
          t.stopLoss = rounded;
          t.stopSource = "assumed";
          stopInput.value = String(rounded);
        }
      }
      paint();
    });

    // ---- Fees ----
    const fFees = mField("Fees");
    // The one silent rewrite left in this form: it zeroes the commission, so the
    // split between the two is gone once this box is used.
    attachTip(fFees.querySelector(".tj-add-f-lbl") as HTMLElement, {
      title: "Fees",
      sub: "Everything the trade cost apart from commission. Using this clears the commission field, so only one recorded cost line is left.",
    });
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
        { id: "Limit", label: "Limit" },
        { id: "Market", label: "Market" },
        { id: "Stop", label: "Stop" },
        { id: "Stop Limit", label: "Stop Limit" },
      ],
      t.orderType || "",
      (id) => {
        t.orderType = id;
      },
      { placeholder: "—" }
    );

    // ---- Session ----
    const fSess = mField("Session");
    // Auto-detect works in ET whatever the journal clock is set to, which is
    // not something the reader could be expected to know.
    attachTip(fSess.querySelector(".tj-add-f-lbl") as HTMLElement, {
      title: "Session",
      sub: "Auto-detect reads the session off the entry time in Eastern, the hour futures actually trade on \u2014 not in your journal's time zone.",
    });
    const sessItems: DropdownItem[] = [
      { id: "newyork", label: "New York" },
      { id: "london", label: "London" },
      { id: "asia", label: "Asia" },
      { id: "off", label: "Off hours" },
      { id: "__auto__", label: "Auto-detect", note: "From the entry time" },
    ];
    const sessHost = fSess.createDiv({ cls: "tj-add-ctl" });
    remountSession = () => {
      sessHost.empty();
      const sessVal = t.sessionOverride || sessionOf(t, this.plugin.settings?.timeZone || "") || "";
      mountDropdown(
        sessHost,
        sessItems,
        sessVal,
        (id) => {
          if (id === "__auto__") delete t.sessionOverride;
          else t.sessionOverride = id;
        },
        { placeholder: "Session…" }
      );
    };
    remountSession();

    const paintExtra = () => {
      const qty = t.quantity || 1;
      // Same rule as everywhere else here: a dollar figure needs a contract to
      // price. Without one the field keeps what is already in it — the trader's
      // own risk, or the default from Settings.
      const riskDollar =
        pointValue !== null && t.stopLoss && t.entryPrice
          ? Math.abs(t.entryPrice - t.stopLoss) * pointValue * qty
          : null;
      if (vRisk && !editingRisk) {
        // No stop yet means the risk field keeps whatever the trader put in it —
        // which is where the default from Settings lives. Blanking it here used to
        // wipe that default on the very first paint, so the setting did nothing.
        vRisk.value = riskDollar !== null ? String(Math.round(riskDollar)) : vRisk.value;
      }
    };

    // ---- Rating ----
    const ratingRow = more.createDiv({ cls: "tj-add-more-row" });
    ratingRow.createSpan({ cls: "tj-add-f-lbl", text: "Rating" });
    const stars = ratingRow.createDiv({ cls: "tj-add-stars" });
    const drawStars = () => {
      stars.empty();
      for (let s = 1; s <= 5; s++) {
        const star = stars.createEl("button", {
          cls: "tj-add-star" + ((t.rating ?? 0) >= s ? " on" : ""),
          text: (t.rating ?? 0) >= s ? "★" : "☆",
          attr: { type: "button", "aria-label": `Rate ${s} of 5` },
        });
        attachTip(star, { title: `${s}/5`, sub: "Click the same star again to clear." });
        star.addEventListener("click", () => {
          t.rating = (t.rating ?? 0) === s ? 0 : s;
          drawStars();
        });
      }
    };
    drawStars();

    renderExitRows();
    paint();
  }

  // ================================================================
  // ACCOUNTS ON THIS TRADE — the copy question, asked out loud
  // ================================================================
  private renderAccounts(parent: HTMLElement): void {
    const accounts = (this.plugin.settings.propAccounts || []).filter((a) => a.name);
    // The date the copy group is judged on: the date this trade will be saved
    // with. Copy periods are dated, so the note has to use the trade's own date
    // rather than whatever the copier's open period says today.
    const tradeDate = this.manualTrades[0]?.date || todayKey(this.plugin.settings.timeZone);
    const box = parent.createDiv({ cls: "tj-add-accounts" });
    const head = box.createDiv({ cls: "tj-add-accounts-head" });
    head.createSpan({ cls: "tj-add-accounts-lbl", text: "Accounts on this trade" });
    const link = head.createEl("a", { cls: "tj-add-accounts-add", text: "+ add an account" });
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
        const ratio = who.createSpan({ cls: "tj-ratio", text: `×${copierPresentation(acc).ratio}` });
        attachTip(ratio, RATIO_TIP);
      }
      if (acc.name === baseName) who.createSpan({ cls: "tj-role", text: "This one" });
      // Its own class: "not in a group" is a state, and it was wearing the
      // styling meant for a number.
      else if (!acc.copyRole) {
        const alone = who.createSpan({ cls: "tj-accstate", text: "not in a group" });
        attachTip(alone, {
          title: "Not in a group",
          sub: "Ticking it records the trade here one for one, at the same size. It is not a copy.",
        });
      }
    }

    if (members.length && base) {
      // The engine writes a leg only for a copier that is actually copying on the
      // trade's date, at that date's ratio. Saying anything else would promise a
      // leg the copy engine then skips.
      const onDate = members.filter((m) => isActiveCopier(m, base.id, tradeDate));
      const note = box.createDiv({ cls: "tj-add-grp" });
      note.createEl("b", { text: "Copy group recognised. " });
      if (!onDate.length) {
        note.createSpan({
          text: "No copier in this group is copying on this date, so this trade is recorded on the leader only.",
        });
      } else {
        const said = onDate
          .map((m) => `${m.name} (×${effectiveCopyConfig(m, tradeDate)?.ratio ?? copierPresentation(m).ratio})`)
          .join(" and ");
        note.createSpan({ text: `This trade is also recorded in ${said}.` });
      }
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
    save.addEventListener("click", () => void this.doSave(save));
    // A trade belongs to an account. With none, there is nowhere to put it —
    // say so on the button instead of failing after the click.
    if (!(this.plugin.settings.propAccounts || []).some((a) => a.name)) {
      save.setAttr("disabled", "true");
      attachTip(save, { title: "No account yet", sub: "Create one first — every trade is recorded in an account." });
      return;
    }
  }

  // ================================================================
  // SAVE
  // ================================================================

  /** Why a hand-written time could not be pinned, in trader's language. */
  private pinMessage(
    pin: Exclude<ManualPin, { status: "ok" } | { status: "no-zone" }>,
    exitNumber?: number,
  ): string {
    const zone = zoneShortLabel(pin.zone) || pin.zone;
    const when = `${pin.issue.date} ${pin.issue.time || ""}`.trim();
    const field = pin.field === "entry" ? "Entry" : exitNumber ? `Exit ${exitNumber}` : "Exit";
    if (pin.status === "gap") {
      return `${field} time ${when} does not exist in ${zone} — the clock jumps forward that night. Move the time and save again.`;
    }
    if (pin.status === "ambiguous") {
      return `${field} time ${when} happens twice in ${zone} — the clock goes back that night. Move it by a minute so there is one instant.`;
    }
    return `${field} time ${when} could not be read as a date and time.`;
  }

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
      if (!(Number.isSafeInteger(t.quantity) && t.quantity > 0) || !(t.entryPrice > 0)) {
        new Notice("Enter a whole-contract quantity and a valid entry price.");
        return;
      }
      const drafts = this.exitsFor(t);
      const multiple = drafts.length > 1;
      const exits: ManualExitFillInput[] = drafts.map((draft) => ({
        quantity: multiple ? Number(draft.quantity) : t.quantity,
        price: Number.parseFloat(draft.price),
        time: draft.time.trim(),
      }));
      if (exits.some((exit) => !Number.isFinite(exit.price) || exit.price <= 0)) {
        new Notice("Enter a valid price for every actual exit.");
        return;
      }
      if (multiple) {
        if (drafts.length > t.quantity) {
          new Notice("Each exit needs at least one contract; remove an exit row or increase the trade quantity.");
          return;
        }
        if (exits.some((exit) => !Number.isSafeInteger(exit.quantity) || exit.quantity <= 0)) {
          new Notice("Enter a whole-contract quantity for every actual exit.");
          return;
        }
        const exitQuantity = exits.reduce((sum, exit) => sum + exit.quantity, 0);
        if (exitQuantity !== t.quantity) {
          new Notice(`Exit quantities total ${exitQuantity}; they must equal the trade quantity of ${t.quantity}.`);
          return;
        }
        if (!isManualClock(t.entryTime) || exits.some((exit) => !isManualClock(exit.time))) {
          new Notice("Enter the entry time and a time for every actual exit so the exit order stays accurate.");
          return;
        }
      }
      // Pin each exit independently in the journal zone. A wall clock with no
      // single instant that night is refused rather than rounded into a plausible
      // UTC; this keeps partial exits in their actual chronological order.
      const timezone = this.plugin.settings.timeZone || "";
      const pins: ManualPin[] = [];
      for (let exitIndex = 0; exitIndex < exits.length; exitIndex++) {
        const pin = pinManualInstants(t.date, t.entryTime, exits[exitIndex].time, timezone);
        if (pin.status === "gap" || pin.status === "ambiguous" || pin.status === "invalid") {
          new Notice(this.pinMessage(pin, exitIndex + 1));
          return;
        }
        pins.push(pin);
      }
      if (pins[0]?.status === "ok") {
        const pin = pins[0];
        t.entryInstant = pin.entryInstant;
        t.instantSource = pin.source;
        t.sourceZone = pin.zone;
        for (let exitIndex = 0; exitIndex < exits.length; exitIndex++) {
          const exitPin = pins[exitIndex];
          if (exitPin.status === "ok") exits[exitIndex].instant = exitPin.exitInstant;
        }
      } else {
        // No journal zone: keep the trader's wall clock and record no instant.
        delete t.entryInstant;
        delete t.exitInstant;
        delete t.instantSource;
        delete t.sourceZone;
      }
      if (multiple) {
        const built = buildManualExitFills(t, exits, !multiple);
        if (!built.ok) {
          new Notice(built.error);
          return;
        }
        Object.assign(t, built.trade);
      } else {
        const exit = exits[0];
        t.exitPrice = exit.price;
        t.exitTime = exit.time;
        if (pins[0].status === "ok") t.exitInstant = pins[0].exitInstant;
        else delete t.exitInstant;
        const spec = knownFuturesSpec(t.symbol);
        const points = t.direction === "long" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
        // pnl is the GROSS; commission and fees are recorded in their own fields.
        t.pnl = spec ? Math.round(points * spec.pointValue * t.quantity * 100) / 100 : Number.NaN;
        // Points are price distance — the quantity never multiplies them.
        t.pnlPoints = Math.round(points * 100) / 100;
      }
      t.accountType = this.plugin.resolveAccountType(t.account);
    }
    // Copies for the ticked accounts — the journal records every leg it was told about.
    // An account that is itself where the trade was entered never also receives a
    // leg: that would write the same trade twice into one account. The CSV path
    // filters its bases the same way.
    const bases = new Set(
      this.manualTrades
        .map((t) => this.plugin.mappedAccount(t.account)?.id)
        .filter((id): id is string => !!id)
    );
    const broadcast = [...this.pickedAccounts].filter((id) => !bases.has(id));
    btn.setAttr("disabled", "true");
    btn.setText("Saving…");
    // A save can fail half way, and a panel that closes on "saved" while notes
    // are missing is the worst possible answer. So the write is checked, and a
    // short or failed write says exactly what happened and leaves the form open
    // with the values still in it.
    try {
      const trades = await this.plugin.applyBroadcast(this.manualTrades, broadcast);
      const count = await this.plugin.storeTrades(trades);
      if (count < trades.length) {
        btn.removeAttribute("disabled");
        btn.setText("Save trade");
        new Notice(`Saved ${count} of ${trades.length}. The rest could not be written — your entries are still here.`);
        return;
      }
      new Notice(count === 1 ? "1 trade saved." : `${count} trades saved.`);
      this.onSaveDone?.();
    } catch (err) {
      console.error("[tradebook] manual trade not saved:", err);
      btn.removeAttribute("disabled");
      btn.setText("Save trade");
      new Notice("Nothing was saved. Your entries are still here — try again.");
    }
  }
}
