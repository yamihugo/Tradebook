import { Modal, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { mountDateField } from "../lib/dates";
import { attachTip } from "../lib/tip";
import { fmtMoney, fmtMoneyCompact } from "../tz";

/**
 * The payout page, as a modal: what you have taken out of this account, and the
 * register to add or remove one.
 *
 * Deliberately one screen with no tabs and no flip: the total and the form are
 * both visible at once, because they answer the same question ("how much is out,
 * and what did I take?"). Nothing here judges eligibility — the firm does that;
 * we only keep the account value and the distance to the limit honest.
 *
 * Layout follows the house modals (`tj-mg-row`: label left, ghost control right),
 * and saving always answers: a payout that did not register must say so instead
 * of looking like a broken app.
 */
export function openPayoutsModal(plugin: TradebookPlugin, accountId: string, onChange?: () => void): void {
  new PayoutsModal(plugin, accountId, onChange).open();
}

class PayoutsModal extends Modal {
  private plugin: TradebookPlugin;
  private accountId: string;
  private onChange?: () => void;
  private error = "";

  constructor(plugin: TradebookPlugin, accountId: string, onChange?: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.accountId = accountId;
    this.onChange = onChange;
  }

  private accountName(): string {
    const acc = (this.plugin.settings.propAccounts ?? []).find((a) => a.id === this.accountId);
    return acc?.name ?? "this account";
  }

  onOpen(): void {
    // No `tj-modal` here: that class is the old overlay box (its own background,
    // border, radius, padding and shadow). Inside a real Modal it painted a second
    // surface inside the first — one modal, two frames. Obsidian's own `.modal` is
    // the surface, exactly like the account-settings modal does it.
    this.contentEl.addClass("tj-payout-modal");
    this.render();
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
    contentEl.empty();

    const payouts = this.plugin.payoutsFor(this.accountId);
    const total = payouts.reduce((s, p) => s + p.amount, 0);
    const last = payouts.length ? payouts[payouts.length - 1] : null;

    // Gold coin to the left of the title: the modal is about money, and a plain
    // h2 with nothing around it reads as a dead screen.
    const titleRow = contentEl.createDiv({ cls: "tj-payout-head" });
    setIcon(titleRow.createSpan({ cls: "tj-payout-headico" }), "banknote");
    const headTxt = titleRow.createDiv({ cls: "tj-payout-headtxt" });
    headTxt.createEl("h2", { text: "Payouts" });
    headTxt.createDiv({ cls: "tj-payout-sub", text: this.accountName() });

    const top = contentEl.createDiv({ cls: "tj-pay-top" });
    const totalBox = top.createDiv({ cls: "tj-pay-total" });
    totalBox.createSpan({ cls: "tj-pay-k", text: "Total paid out" });
    totalBox.createEl("b", { cls: "tj-pay-v", text: fmtMoney(total) });

    const facts = top.createDiv({ cls: "tj-pay-facts" });
    const fact = (label: string, value: string) => {
      const f = facts.createDiv({ cls: "tj-pay-fact" });
      f.createSpan({ cls: "tj-pay-k", text: label });
      f.createEl("b", { cls: "tj-pay-f", text: value });
    };
    fact("Payouts", String(payouts.length));
    fact("Last", last ? last.date : "—");

    // ---- register -------------------------------------------------------
    // `tj-payout-fields`, not `tj-payout-form`: that name belongs to the framed
    // box the old inline deposit form still uses, and a modal should sit on one
    // surface — a box inside a box is what made this look unfinished.
    const form = contentEl.createDiv({ cls: "tj-payout-fields" });

    let when = this.todayKey();
    const dateVal = this.row(form, "Date");
    // No `tj-payout-input` here: that width is for the plain inputs, and on the
    // date field it squeezed the value out of sight. The date keeps its own
    // recipe (`.tj-payout-modal .tj-datefield*` in the stylesheet).
    mountDateField(dateVal, {
      value: when,
      format: this.plugin.settings.dateFormat,
      onChange: (iso) => (when = iso),
    });

    const amountVal = this.row(form, "Amount ($)");
    const amountInput = amountVal.createEl("input", {
      type: "number",
      cls: "tj-payout-input",
      attr: { min: "1", step: "1", placeholder: "1,000" },
    });

    const noteVal = this.row(form, "Note");
    const noteInput = noteVal.createEl("input", {
      type: "text",
      cls: "tj-payout-input",
      attr: { placeholder: "Optional" },
    });

    if (this.error) {
      const err = contentEl.createDiv({ cls: "tj-payout-error" });
      setIcon(err.createSpan({ cls: "tj-payout-error-ico" }), "circle-alert");
      err.createSpan({ text: this.error });
    }
    const actions = contentEl.createDiv({ cls: "tj-payout-actions" });
    // Ghost, like every other secondary action in the plugin: the register is
    // not a call to action, and a filled accent button shouts like one.
    const save = actions.createEl("button", { cls: "tj-actionbtn", attr: { type: "button" } });
    setIcon(save.createSpan({ cls: "tj-btn-icon" }), "check");
    save.createSpan({ text: "Log payout" });
    save.addEventListener("click", async () => {
      const parsed = parseFloat(amountInput.value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        // Silence here is what made a missing payout look like a broken app.
        this.error = "Enter an amount first — for example 1,000.";
        amountInput.focus();
        this.render();
        return;
      }
      this.error = "";
      const amount = Math.round(parsed);
      await this.plugin.registerPayout(this.accountId, when || this.todayKey(), amount, noteInput.value.trim() || undefined);
      new Notice(`Logged ${fmtMoney(amount)} paid out of ${this.accountName()}.`);
      this.refresh();
    });

    // ---- what is already out -------------------------------------------
    if (!payouts.length) {
      const empty = contentEl.createDiv({ cls: "tj-payout-empty" });
      setIcon(empty.createSpan({ cls: "tj-payout-empty-ico" }), "coins");
      empty.createSpan({ text: "Nothing logged yet." });
      return;
    }

    const list = contentEl.createDiv({ cls: "tj-payout-list" });
    const head = list.createDiv({ cls: "tj-payout-lrow is-head" });
    head.createSpan({ cls: "tj-payout-d", text: "Date" });
    head.createSpan({ cls: "tj-payout-a", text: "Amount" });
    head.createSpan({ cls: "tj-payout-n", text: "Note" });
    head.createSpan({ cls: "tj-payout-x" });
    for (const p of payouts) {
      const row = list.createDiv({ cls: "tj-payout-lrow" });
      row.createSpan({ cls: "tj-payout-d", text: p.date });
      // Short, and without a plus: a payout is money taken out, not a gain.
      row.createSpan({ cls: "tj-payout-a", text: fmtMoneyCompact(p.amount) });
      row.createSpan({ cls: "tj-payout-n", text: p.note ?? "" });
      const del = row.createSpan({ cls: "tj-payout-x" }).createEl("button", {
        cls: "tj-mini tj-del",
        attr: { type: "button", "aria-label": "Remove payout" },
      });
      setIcon(del, "x");
      attachTip(del, { title: "Remove payout" });
      del.addEventListener("click", async () => {
        await this.plugin.removePayout(p.id);
        this.refresh();
      });
    }
  }

  private todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}
