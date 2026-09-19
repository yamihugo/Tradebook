import { Modal, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { mountDateField } from "../lib/dates";
import { freeNumeric } from "../lib/numeric";
import { attachTip } from "../lib/tip";
import { fmtMoney, todayStr } from "../tz";
import { allocateProportional, tradeFeeKeys } from "../lib/fees";
import type { Trade } from "../types";

/**
 * "Correct fees": the account's figure against the journal's, on one screen.
 *
 * When an export does not carry the platform's cash history the journal records
 * no cost at all — a half-counted fee would be a number nobody was billed. The
 * difference has to go somewhere, so this modal takes the balance the account
 * really holds and logs the gap as one dated adjustment.
 *
 * It is deliberately not called a fee: we know the difference between two
 * numbers, not which line the broker wrote. Nothing here rewrites a trade — the
 * adjustment is a cash-flow on its own day, exactly like a payout or a deposit,
 * and it can be repeated as often as the trader wants.
 */
export function openFeeAdjustModal(
  plugin: TradebookPlugin,
  accountId: string,
  journalBalance: number,
  onChange?: () => void
): void {
  new FeeAdjustModal(plugin, accountId, journalBalance, onChange).open();
}

/** The next calendar day, in the journal's own date format. */
function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

class FeeAdjustModal extends Modal {
  private plugin: TradebookPlugin;
  private accountId: string;
  private journalBalance: number;
  private onChange?: () => void;
  private error = "";
  private allTrades: Trade[] = [];
  private from = "";
  private to = "";
  private ready = false;

  constructor(plugin: TradebookPlugin, accountId: string, journalBalance: number, onChange?: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.accountId = accountId;
    this.journalBalance = journalBalance;
    this.onChange = onChange;
  }

  private accountName(): string {
    const acc = (this.plugin.settings.propAccounts ?? []).find((a) => a.id === this.accountId);
    return acc?.name ?? "this account";
  }

  onOpen(): void {
    // Reuses the payout modal's surface rules: the date field, the rows and the
    // list have one recipe in this plugin, and a second frame would show.
    this.contentEl.addClass("tj-payout-modal");
    this.contentEl.addClass("tj-fees-modal");
    this.from = this.defaultFrom();
    this.to = this.defaultTo();
    this.render();
    // The balance field is the whole point of the screen: hand it the cursor on
    // open. `render()` restores it after each repaint as long as it was there.
    window.setTimeout(() => {
      (this.contentEl.querySelector("input.tj-payout-input") as HTMLInputElement | null)?.focus();
    }, 0);
    // The trades arrive after the first paint; the window is worked out again
    // once they are here, so the counts and the preview are never guessed.
    void this.plugin.loadTradesExpanded().then((trades) => {
      this.allTrades = trades;
      if (!this.ready) {
        this.from = this.defaultFrom();
        this.to = this.defaultTo();
        this.ready = true;
      }
      this.render();
    });
  }

  /** The day after the last correction's window, or where the account began. */
  private defaultFrom(): string {
    const last = this.plugin.feeAdjustmentsFor(this.accountId).filter((a) => a.kind !== "cost").slice(-1)[0];
    if (last?.period?.to) return dayAfter(last.period.to);
    const acc = (this.plugin.settings.propAccounts ?? []).find((a) => a.id === this.accountId);
    if (acc?.createdAt) return acc.createdAt;
    const first = this.accountTrades()
      .map((t) => t.date)
      .sort()[0];
    return first ?? todayStr();
  }

  /**
   * The last day this account traded. A correction covers what the account has
   * done, so the window ends where the history ends — the reader can move it,
   * but never has to guess it out of a hundred rows.
   */
  private defaultTo(): string {
    const last = this.accountTrades()
      .map((t) => t.date)
      .sort()
      .slice(-1)[0];
    return last ?? todayStr();
  }

  /** This account's trades, resolved by id so a renamed account never slips out. */
  private accountTrades(): Trade[] {
    return this.allTrades.filter((t) => this.plugin.mappedAccount(t.account || "")?.id === this.accountId);
  }

  /** The account's own trades inside the window, oldest first. */
  private windowTrades(): Trade[] {
    const acc = (this.plugin.settings.propAccounts ?? []).find((a) => a.id === this.accountId);
    if (!acc) return [];
    return this.accountTrades()
      .filter((t) => t.date >= this.from && t.date <= this.to)
      .filter((t) => !(acc.createdAt && t.date < acc.createdAt))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private refresh(): void {
    this.onChange?.();
    this.render();
  }

  /** Label left, control right — the same row recipe as Management. */
  private row(host: HTMLElement, label: string): HTMLElement {
    const r = host.createDiv({ cls: "tj-mg-row" });
    const lbl = r.createDiv({ cls: "tj-mg-rowlbl" });
    lbl.createDiv({ cls: "tj-mg-rowlabel", text: label });
    return r.createDiv({ cls: "tj-mg-rowval" });
  }

  private render(): void {
    const { contentEl } = this;
    // Was the balance field holding the cursor? A repaint destroys it, so the
    // answer has to be taken before `empty()` and re-applied after the rebuild.
    const prev = this.contentEl.ownerDocument.activeElement;
    const hadFocus = prev instanceof HTMLInputElement && prev.classList.contains("tj-payout-input");
    contentEl.empty();

    // Correct fees is about the difference the trader writes by hand. A platform
    // cost logged by an import is a different animal: it moves the balance, but
    // it is not a correction, so it stays out of this list and its total.
    const adjustments = this.plugin.feeAdjustmentsFor(this.accountId).filter((a) => a.kind !== "cost");
    const total = adjustments.reduce((s, a) => s + a.amount, 0);

    // Who is still owed a slice. A trade that already carries one is never
    // counted twice, even if it was imported long after its window closed.
    const done = this.plugin.allocatedKeysFor(this.accountId);
    const matchable = new Set(this.accountTrades().flatMap((t) => tradeFeeKeys(t)));
    const orphanSlices = [...done].filter((k) => !matchable.has(k)).length;
    const inWindow = this.windowTrades();
    const pending = inWindow.filter((t) => !tradeFeeKeys(t).some((k) => done.has(k)));

    const titleRow = contentEl.createDiv({ cls: "tj-payout-head" });
    setIcon(titleRow.createSpan({ cls: "tj-payout-headico" }), "receipt");
    const headTxt = titleRow.createDiv({ cls: "tj-payout-headtxt" });
    headTxt.createEl("h2", { text: "Correct fees" });
    headTxt.createDiv({ cls: "tj-payout-sub", text: this.accountName() });

    contentEl.createDiv({
      cls: "tj-fees-note",
      text:
        "Write the balance the account really holds. The difference is logged as one dated adjustment — " +
        "no trade is touched, and it can be corrected again whenever the numbers drift apart.",
    });

    const form = contentEl.createDiv({ cls: "tj-payout-fields" });

    const journalVal = this.row(form, "Journal says");
    journalVal.createEl("b", { cls: "tj-fees-ro", text: fmtMoney(this.journalBalance) });

    const haveVal = this.row(form, "What I have");
    const haveInput = freeNumeric(
      haveVal.createEl("input", {
        type: "number",
        cls: "tj-payout-input",
        attr: { placeholder: this.journalBalance.toFixed(2) },
      })
    );
    // Clicking anywhere on the row is clicking the field: the box is only as
    // wide as its number, and a reader who aims at the label should not miss.
    // `mousedown` is used so the focus lands before the click resolves, and the
    // input itself is left alone so the caret can be placed where it was aimed.
    const haveRow = haveVal.parentElement ?? haveVal;
    haveRow.addEventListener("mousedown", (e) => {
      if (e.target === haveInput) return;
      e.preventDefault();
      haveInput.focus();
    });

    const diffVal = this.row(form, "Difference");
    const diffOut = diffVal.createEl("b", { cls: "tj-fees-diff", text: "—" });
    const diffHint = diffVal.createDiv({ cls: "tj-fees-diffsub" });

    const paint = () => {
      const raw = haveInput.value.trim();
      const parsed = raw === "" ? NaN : parseFloat(raw);
      if (!Number.isFinite(parsed)) {
        diffOut.setText("—");
        diffOut.className = "tj-fees-diff";
        diffHint.setText("Waiting for the balance you have.");
        return;
      }
      // What the account really holds, minus what the journal says. Negative
      // means the journal is too high — the usual case, fees it never saw.
      const diff = Math.round((parsed - this.journalBalance) * 100) / 100;
      diffOut.setText(diff === 0 ? fmtMoney(0) : fmtMoney(diff));
      diffOut.className = "tj-fees-diff " + (diff < 0 ? "tj-neg" : diff > 0 ? "tj-pos" : "");
      diffHint.setText(
        diff === 0
          ? "The journal already matches."
          : pending.length
          ? `Recorded as ${fmtMoney(diff)} on the date below — spread over ${pending.length} trade${
              pending.length === 1 ? "" : "s"
            } in proportion to size.`
          : `Recorded as ${fmtMoney(diff)} on the date below. No trades in the window take a slice.`
      );
    };
    haveInput.addEventListener("input", paint);
    haveInput.addEventListener("change", paint);
    paint();
    if (hadFocus) window.setTimeout(() => haveInput.focus(), 0);

    let when = todayStr();
    const dateVal = this.row(form, "Date");
    mountDateField(dateVal, {
      value: when,
      format: this.plugin.settings.dateFormat,
      onChange: (iso) => (when = iso),
    });

    const noteVal = this.row(form, "Note");
    const noteInput = noteVal.createEl("input", {
      type: "text",
      cls: "tj-payout-input",
      attr: { placeholder: "Optional — e.g. Tradeify fees" },
    });

    const windowVal = this.row(form, "Spread over");
    const windowLabel = windowVal.parentElement?.querySelector(".tj-mg-rowlabel");
    if (windowLabel) {
      attachTip(windowLabel, {
        title: "Spread over",
        sub: "The trades that share this correction, in proportion to size. Trades already corrected are skipped.",
      });
    }
    const windowBox = windowVal.createDiv({ cls: "tj-fees-window" });
    mountDateField(windowBox, {
      value: this.from,
      format: this.plugin.settings.dateFormat,
      onChange: (iso) => {
        this.from = iso;
        this.render();
      },
    });
    windowBox.createSpan({ cls: "tj-fees-warrow", text: "→" });
    mountDateField(windowBox, {
      value: this.to,
      format: this.plugin.settings.dateFormat,
      onChange: (iso) => {
        this.to = iso;
        this.render();
      },
    });
    windowVal.createDiv({
      cls: "tj-fees-windowhint",
      text:
        "The difference is split across the trades in this window, in proportion to size — " +
        "ten contracts take ten times one. Trades already corrected are skipped.",
    });

    const spread = contentEl.createDiv({ cls: "tj-fees-spread" });
    spread.createDiv({
      cls: "tj-fees-spreadline",
      text:
        `${inWindow.length} trade${inWindow.length === 1 ? "" : "s"} in the window · ` +
        `${inWindow.length - pending.length} already sliced · ${pending.length} to slice now`,
    });
    if (pending.length) {
      spread.createDiv({
        cls: "tj-fees-spreadsub",
        text: "Each one takes a share in proportion to its size — ten contracts take ten times one.",
      });
      const preview = spread.createDiv({ cls: "tj-fees-preview" });
      for (const t of pending.slice(0, 5)) {
        const r = preview.createDiv({ cls: "tj-fees-prow" });
        r.createSpan({ text: t.date });
        r.createSpan({ text: t.symbol });
        r.createSpan({ text: t.direction === "short" ? "Short" : "Long" });
        r.createSpan({ text: String(t.quantity) });
      }
      if (pending.length > 5) {
        preview.createDiv({ cls: "tj-fees-prow", text: `… ${pending.length - 5} more` });
      }
    } else if (inWindow.length) {
      spread.createDiv({
        cls: "tj-fees-spreadsub",
        text: "Every trade in this window already carries a slice. Move the window forward to correct the next stretch.",
      });
    }

    // A slice is stored against the trade's identity. If those notes are
    // re-imported with new ids the slice survives but no longer points at
    // anything — it still moves the balance, so say it rather than hide it.
    if (orphanSlices) {
      const warn = contentEl.createDiv({ cls: "tj-fees-orphan" });
      setIcon(warn.createSpan({ cls: "tj-fees-orphan-ico" }), "circle-alert");
      warn.createSpan({
        text:
          `${orphanSlices} saved slice${orphanSlices === 1 ? "" : "s"} no longer match a trade — ` +
          "the notes were probably re-imported. They still count towards the balance; remove the correction to clear them.",
      });
    }

    if (this.error) {
      const err = contentEl.createDiv({ cls: "tj-payout-error" });
      setIcon(err.createSpan({ cls: "tj-payout-error-ico" }), "circle-alert");
      err.createSpan({ text: this.error });
    }

    const actions = contentEl.createDiv({ cls: "tj-payout-actions" });
    const save = actions.createEl("button", { cls: "tj-actionbtn", attr: { type: "button" } });
    setIcon(save.createSpan({ cls: "tj-btn-icon" }), "check");
    save.createSpan({ text: "Log adjustment" });
    save.addEventListener("click", async () => {
      const raw = haveInput.value.trim();
      const parsed = raw === "" ? NaN : parseFloat(raw);
      if (!Number.isFinite(parsed)) {
        this.error = "Enter the balance you have first — for example 49,263.66.";
        this.render();
        (this.contentEl.querySelector("input.tj-payout-input") as HTMLInputElement | null)?.focus();
        return;
      }
      const diff = Math.round((parsed - this.journalBalance) * 100) / 100;
      if (diff === 0) {
        this.error = "The journal already matches that balance. Nothing to log.";
        this.render();
        return;
      }
      this.error = "";
      const slices = allocateProportional(pending, diff);
      const remainder =
        Math.round(diff * 100) - slices.reduce((s, x) => s + Math.round(x.amount * 100), 0);
      await this.plugin.registerFeeAdjustment(
        this.accountId,
        when || todayStr(),
        diff,
        noteInput.value.trim() || undefined,
        slices.length ? { from: this.from, to: this.to } : undefined,
        slices.length ? slices : undefined,
        slices.length ? remainder : undefined
      );
      new Notice(
        slices.length
          ? `Logged ${fmtMoney(diff)} on ${this.accountName()} — spread over ${slices.length} trade${slices.length === 1 ? "" : "s"}.`
          : `Logged ${fmtMoney(diff)} on ${this.accountName()}.`
      );
      this.refresh();
    });

    if (!adjustments.length) {
      const empty = contentEl.createDiv({ cls: "tj-payout-empty" });
      setIcon(empty.createSpan({ cls: "tj-payout-empty-ico" }), "receipt");
      empty.createSpan({ text: "No corrections logged yet." });
      return;
    }

    const list = contentEl.createDiv({ cls: "tj-payout-list" });
    const head = list.createDiv({ cls: "tj-payout-lrow is-head" });
    head.createSpan({ cls: "tj-payout-d", text: "Date" });
    head.createSpan({ cls: "tj-payout-a", text: "Difference" });
    head.createSpan({ cls: "tj-payout-n", text: "Note" });
    head.createSpan({ cls: "tj-payout-x" });
    for (const a of adjustments) {
      const row = list.createDiv({ cls: "tj-payout-lrow" });
      row.createSpan({ cls: "tj-payout-d", text: a.date });
      // Signed, unlike a payout: the journal can be too high or too low.
      row.createSpan({ cls: "tj-payout-a " + (a.amount < 0 ? "tj-neg" : "tj-pos"), text: fmtMoney(a.amount) });
      row.createSpan({
        cls: "tj-payout-n",
        text: a.trades
          ? `${a.note ? `${a.note} · ` : ""}spread over ${a.trades} trade${a.trades === 1 ? "" : "s"}`
          : a.note ?? "",
      });
      const del = row.createSpan({ cls: "tj-payout-x" }).createEl("button", {
        cls: "tj-mini tj-del",
        attr: { type: "button", "aria-label": "Remove correction" },
      });
      setIcon(del, "x");
      attachTip(del, { title: "Remove correction" });
      del.addEventListener("click", async () => {
        await this.plugin.removeFeeAdjustment(a.id);
        this.refresh();
      });
    }

    const foot = contentEl.createDiv({ cls: "tj-fees-total" });
    foot.createSpan({ cls: "tj-pay-k", text: "Corrected in total" });
    foot.createEl("b", { cls: "tj-fees-ro", text: fmtMoney(total) });
  }
}
