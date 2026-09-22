import { Modal } from "obsidian";
import type TradebookPlugin from "../main";
import { openAccountWizard } from "./accountWizard";

/**
 * The first-run tour. A brand-new journal opens it once (see onload), and it can
 * be reopened any time from Settings → Advanced or the command palette.
 *
 * It is deliberately small and honest: four steps that end with the trader
 * journaling, not four steps that end with a configuration screen. Everything it
 * asks for is also reachable elsewhere — the tour just puts it in order.
 */

const STEPS = ["Welcome", "Folder", "Accounts", "Strategies", "First trade", "Done"];

export function openGettingStarted(plugin: TradebookPlugin): void {
  new GettingStartedModal(plugin).open();
}

class GettingStartedModal extends Modal {
  private plugin: TradebookPlugin;
  private step: number;
  private finished = false;
  /** Held locally so typing does not save a half-typed path on every keypress. */
  private folder = "";

  constructor(plugin: TradebookPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    const saved = plugin.settings.onboardingStep ?? 0;
    this.step = Math.max(0, Math.min(STEPS.length - 1, saved));
    this.folder = plugin.settings.tradesFolder;
  }

  onOpen(): void {
    // No `tj-modal` here: that class is the old overlay box (its own background,
    // border, radius, padding and shadow). Inside a real Modal it painted a second
    // surface inside the first — one modal, two frames. Obsidian's own `.modal` is
    // the surface, exactly like the account-settings modal does it.
    this.contentEl.addClass("tj-started");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    // Remember where they stopped, so reopening resumes instead of restarting.
    if (!this.finished) {
      this.plugin.settings.onboardingStep = this.step;
      void this.plugin.saveSettings();
    }
  }

  private finish(openHome: boolean): void {
    this.finished = true;
    this.plugin.settings.onboardingDone = true;
    delete this.plugin.settings.onboardingStep;
    void this.plugin.saveSettings();
    this.close();
    if (openHome) void this.plugin.openHome();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const head = contentEl.createDiv({ cls: "tj-start-head" });
    head.createEl("h2", { text: "Set up your journal" });
    const dots = head.createDiv({ cls: "tj-start-dots" });
    STEPS.forEach((label, i) => {
      const dot = dots.createDiv({ cls: "tj-start-dot" + (i === this.step ? " on" : i < this.step ? " done" : "") });
      dot.setAttr("title", label);
    });

    const body = contentEl.createDiv({ cls: "tj-start-body" });
    this.renderStep(body);

    const actions = contentEl.createDiv({ cls: "tj-start-actions" });
    const skip = actions.createEl("button", { cls: "tj-start-skip", text: "Skip for now", attr: { type: "button" } });
    skip.addEventListener("click", () => this.finish(false));

    const right = actions.createDiv({ cls: "tj-start-right" });
    if (this.step > 0) {
      const back = right.createEl("button", { cls: "tj-actionbtn", text: "Back", attr: { type: "button" } });
      back.addEventListener("click", () => {
        this.step -= 1;
        this.render();
      });
    }
    const next = right.createEl("button", {
      cls: "tj-actionbtn is-primary",
      text: this.step === STEPS.length - 1 ? "Start journaling" : "Next",
      attr: { type: "button" },
    });
    next.addEventListener("click", () => {
      if (this.step === STEPS.length - 1) {
        this.finish(true);
        return;
      }
      this.advance();
    });
  }

  /** Save whatever the step collected, then move on. */
  private advance(): void {
    if (this.step === 1) {
      const value = this.folder.trim();
      if (value && value !== this.plugin.settings.tradesFolder) {
        this.plugin.settings.tradesFolder = value;
        void this.plugin.saveSettings();
      }
    }
    this.step += 1;
    this.plugin.settings.onboardingStep = this.step;
    void this.plugin.saveSettings();
    this.render();
  }

  private renderStep(host: HTMLElement): void {
    const step = host.createDiv({ cls: "tj-start-step" });

    if (this.step === 0) {
      step.createEl("h3", { text: "Welcome to Tradebook", cls: "tj-start-title" });
      step.createEl("p", {
        cls: "tj-start-text",
        text: "This is a journal, not a prop firm. It records what you actually did and tells the truth about the numbers — it never blocks an order, a trade or a payout. The rules live with your firm; the record lives here.",
      });
      const list = step.createEl("ul", { cls: "tj-start-list" });
      for (const line of [
        "Your trades are plain Markdown notes in your vault. No account, no sync, nothing leaves your computer.",
        "Accounts, copy groups, payouts and reviews are modelled on top of those notes.",
        "Two minutes to set up: a folder, your accounts, your first trade.",
      ]) {
        list.createEl("li", { text: line });
      }
      return;
    }

    if (this.step === 1) {
      step.createEl("h3", { text: "Where your trades live", cls: "tj-start-title" });
      step.createEl("p", {
        cls: "tj-start-text",
        text: "This is your journal's root folder. Trades are filed under <year>/<month>/trades, so a year is self-contained and easy to back up. Point it anywhere in your vault.",
      });
      const input = step.createEl("input", {
        cls: "tj-wz-input tj-start-input",
        attr: { type: "text", value: this.folder, spellcheck: "false" },
      });
      input.addEventListener("input", () => (this.folder = input.value));
      step.createDiv({ cls: "tj-start-note", text: "Trade notes land in <year>/<month>/trades and screenshots in <year>/attachments, created only when you need them." });
      return;
    }

    if (this.step === 2) {
      const count = this.plugin.settings.propAccounts?.length ?? 0;
      step.createEl("h3", { text: "The accounts you trade", cls: "tj-start-title" });
      step.createEl("p", {
        cls: "tj-start-text",
        text: "One card per account you actually trade. A firm, a program and a size give you the real rules — target, max loss, daily loss, consistency — so the numbers mean something.",
      });
      if (count > 0) {
        step.createDiv({ cls: "tj-start-ok", text: `${count} account${count === 1 ? "" : "s"} configured` });
      } else {
        const add = step.createEl("button", { cls: "tj-actionbtn is-primary", text: "Add an account", attr: { type: "button" } });
        add.addEventListener("click", () => {
          openAccountWizard(this.plugin, {
            onDone: () => {
              this.render();
            },
          });
        });
      }
      step.createDiv({
        cls: "tj-start-note",
        text: "Trading several accounts? Set how many on the Review step of the wizard — it names and numbers them for you. Copy groups come later, under Manage.",
      });
      return;
    }

    if (this.step === 3) {
      const n = (this.plugin.settings.strategies ?? []).length;
      step.createEl("h3", { text: "The strategies you trade", cls: "tj-start-title" });
      step.createEl("p", {
        cls: "tj-start-text",
        text: "Name your strategies so every trade can be filed under one. It is a recommendation, not a rule — a trade can always be recorded without one, and nothing is ever blocked.",
      });
      if (n > 0) {
        step.createDiv({ cls: "tj-start-ok", text: `${n} strateg${n === 1 ? "y" : "ies"} registered` });
      }
      const row = step.createDiv({ cls: "tj-start-row" });
      const input = row.createEl("input", {
        cls: "tj-wz-input tj-start-input",
        attr: { type: "text", placeholder: "e.g. Reversal" },
      });
      const add = row.createEl("button", { cls: "tj-actionbtn is-primary", text: "Add", attr: { type: "button" } });
      const submit = async () => {
        const value = input.value.trim();
        if (!value) return;
        await this.plugin.addStrategy(value);
        this.render();
      };
      add.addEventListener("click", () => void submit());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
      step.createDiv({
        cls: "tj-start-note",
        text: "Add as many as you like, any time, on the Strategies page. Each one also gets a note of its own, ready for its rules.",
      });
      return;
    }

    if (this.step === 4) {
      step.createEl("h3", { text: "Your first trade", cls: "tj-start-title" });
      step.createEl("p", {
        cls: "tj-start-text",
        text: "Two ways in: type it in, or bring your broker's CSV. The import pairs the fills into trades and puts each one in the right account.",
      });
      const row = step.createDiv({ cls: "tj-start-row" });
      const manual = row.createEl("button", { cls: "tj-actionbtn is-primary", text: "Add a trade", attr: { type: "button" } });
      manual.addEventListener("click", () => {
        this.finish(false);
        void this.plugin.openAddPanel();
      });
      const csv = row.createEl("button", { cls: "tj-actionbtn", text: "Import a CSV", attr: { type: "button" } });
      csv.addEventListener("click", () => {
        this.finish(false);
        void this.plugin.openImport();
      });
      step.createDiv({ cls: "tj-start-note", text: "You can also skip this and add trades whenever — the ledger waits for you." });
      return;
    }

    step.createEl("h3", { text: "You are set", cls: "tj-start-title" });
    step.createEl("p", { cls: "tj-start-text", text: "Where everything lives:" });
    const list = step.createEl("ul", { cls: "tj-start-list" });
    for (const line of [
      "Home — the read on your trading: P&L, streaks, best hours and what needs reviewing.",
      "Trade Log — the ledger, with filters, bulk edits and the review state of every trade.",
      "Accounts — a card per account, the rules, and Manage for copy groups and page settings.",
      "Strategies — register the names you trade under; each one keeps its own note.",
      "Manual trade — record a trade by hand, or import a CSV from your broker.",
    ]) {
      list.createEl("li", { text: line });
    }
    step.createDiv({
      cls: "tj-start-note",
      text: "Reopen this tour any time: Settings → Advanced → Show the getting started tour (or the command palette).",
    });
  }
}
