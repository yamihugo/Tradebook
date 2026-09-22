import { ItemView, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { renderAppShell } from "../ui";
import { fmtMoney } from "../tz";
import { toneClass } from "../lib/fills";
import { attachTip } from "../lib/tip";

export const SETUPS_VIEW_TYPE = "tradebook-setups-view";

/**
 * Strategies — registering the names you trade under. A name is enough to file
 * every trade under one strategy, and each registration also leaves a note in
 * `library/strategies/` so the rules and documentation have a home when the full
 * engine lands. Nothing typed here is thrown away later.
 */
export class SetupsView extends ItemView {
  plugin: TradebookPlugin;
  private adding = false;
  private renaming: string | null = null;

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SETUPS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Strategies";
  }

  getIcon(): string {
    return "target";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-setups");
    const main = renderAppShell(root, this.plugin, "setups");
    main.createEl("h1", { text: "Strategies", cls: "tj-view-h1" });
    main.createEl("p", {
      cls: "tj-view-intro",
      text: "Name the strategies you trade so every trade can be filed under one. Each name keeps its own note in your vault.",
    });

    // ---- Usage counts, computed from the notes ----
    const counts = new Map<string, { n: number; pnl: number }>();
    try {
      const trades = await this.plugin.loadTrades();
      for (const t of trades) {
        const name = (t.setup || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const g = counts.get(key) ?? { n: 0, pnl: 0 };
        g.n += 1;
        g.pnl += Number.isFinite(t.pnl) ? t.pnl : 0;
        counts.set(key, g);
      }
    } catch {
      /* notes unreadable — the registry still renders below */
    }

    const registered = this.plugin.settings.strategies ?? [];
    const registeredKeys = new Set(registered.map((s) => s.name.trim().toLowerCase()));
    const names = await this.plugin.knownSetups();
    const untracked = names.filter((n) => !registeredKeys.has(n.toLowerCase()));

    // ---- Your strategies card ----
    const card = main.createDiv({ cls: "tj-strat-card" });
    const head = card.createDiv({ cls: "tj-strat-card-head" });
    head.createEl("div", { cls: "tj-strat-card-title", text: "Your strategies" });
    const addBtn = head.createEl("button", { cls: "tj-btn tj-mini", text: "＋ Add strategy" });
    addBtn.addEventListener("click", () => {
      this.adding = true;
      this.renaming = null;
      void this.render();
    });

    let focusInput: HTMLInputElement | null = null;

    if (this.adding) {
      const row = card.createDiv({ cls: "tj-strat-add" });
      const input = row.createEl("input", { type: "text", cls: "tj-strat-input" });
      input.placeholder = "e.g. Reversal";
      focusInput = input;
      const submit = () => void this.addStrategy(input.value);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") {
          this.adding = false;
          void this.render();
        }
      });
      const add = row.createEl("button", { cls: "tj-btn tj-mini", text: "Add" });
      add.addEventListener("click", submit);
      const cancel = row.createEl("button", { cls: "tj-btn tj-mini", text: "Cancel" });
      cancel.addEventListener("click", () => {
        this.adding = false;
        void this.render();
      });
    }

    if (!names.length && !this.adding) {
      const empty = card.createDiv({ cls: "tj-strat-empty" });
      empty.createEl("div", { text: "No strategies named yet." });
      empty.createEl("div", {
        cls: "tj-strat-empty-sub",
        text: "Add one here, or create it straight from a trade's Strategy picker.",
      });
    } else {
      const list = card.createDiv({ cls: "tj-strat-rows" });
      for (const s of registered) this.renderRow(list, s.name, counts, false, (el) => (focusInput = el));
      for (const name of untracked) this.renderRow(list, name, counts, true, (el) => (focusInput = el));
    }

    // ---- In development — kept quiet; the card above is the page ----
    const note = main.createDiv({
      cls: "tj-strat-note" + (this.plugin.settings.animations === false ? " is-still" : ""),
    });
    const noteIco = note.createSpan({ cls: "tj-strat-note-ico" });
    setIcon(noteIco, "hammer");
    const noteTxt = note.createSpan({ cls: "tj-strat-note-txt" });
    noteTxt.createSpan({ cls: "tj-strat-note-strong", text: "In development" });
    noteTxt.createSpan({
      text: " Rules, per-strategy numbers and comparison are on the way. Everything you name now carries over.",
    });

    if (focusInput) {
      const el = focusInput as HTMLInputElement;
      window.setTimeout(() => el.focus(), 0);
    }
  }

  /** One registry or untracked row; `tracked` false while being renamed. */
  private renderRow(
    list: HTMLElement,
    name: string,
    counts: Map<string, { n: number; pnl: number }>,
    untracked: boolean,
    captureFocus: (el: HTMLInputElement) => void
  ): void {
    const g = counts.get(name.toLowerCase());
    const row = list.createDiv({ cls: "tj-strat-item" });
    const info = row.createDiv({ cls: "tj-strat-item-main" });

    if (this.renaming === name) {
      const input = info.createEl("input", { type: "text", cls: "tj-strat-input" });
      input.value = name;
      captureFocus(input);
      const save = () => void this.renameStrategy(name, input.value);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          this.renaming = null;
          void this.render();
        }
      });
      const actions = row.createDiv({ cls: "tj-strat-item-actions is-open" });
      const ok = actions.createEl("button", { cls: "tj-iconbtn" });
      setIcon(ok, "check");
      attachTip(ok, { title: "Save the rename", sub: "Every trade filed under it is updated." });
      ok.addEventListener("click", save);
      const cancel = actions.createEl("button", { cls: "tj-iconbtn" });
      setIcon(cancel, "x");
      attachTip(cancel, { title: "Cancel" });
      cancel.addEventListener("click", () => {
        this.renaming = null;
        void this.render();
      });
      return;
    }

    info.createDiv({ cls: "tj-strat-item-name", text: name });
    const meta = info.createDiv({ cls: "tj-strat-item-meta" });
    meta.createSpan({ text: g ? `${g.n} ${g.n === 1 ? "trade" : "trades"}` : "not used yet" });
    if (g && g.n > 0) {
      const pnl = meta.createSpan({ cls: "tj-strat-item-pnl " + toneClass(g.pnl) });
      pnl.setText(g.pnl === 0 ? "—" : fmtMoney(g.pnl));
    }
    if (untracked) {
      const chip = meta.createSpan({ cls: "tj-strat-untracked", text: "untracked" });
      attachTip(chip, {
        title: "Not registered",
        sub: "A trade carries this name, but it is not in your list yet.",
      });
    }

    const actions = row.createDiv({ cls: "tj-strat-item-actions" });
    if (untracked) {
      const add = actions.createEl("button", { cls: "tj-iconbtn" });
      setIcon(add, "plus");
      attachTip(add, { title: `Register "${name}"`, sub: "Adds it to the list and gives it a note." });
      add.addEventListener("click", () => void this.registerStrategy(name));
      return;
    }

    const renameBtn = actions.createEl("button", { cls: "tj-iconbtn" });
    setIcon(renameBtn, "pencil");
    attachTip(renameBtn, { title: "Rename", sub: "Every trade filed under it is updated." });
    renameBtn.addEventListener("click", () => {
      this.renaming = name;
      this.adding = false;
      void this.render();
    });
    const delBtn = actions.createEl("button", { cls: "tj-iconbtn" });
    setIcon(delBtn, "trash");
    attachTip(delBtn, { title: "Remove from the list", sub: "Trades and the strategy note stay as they are." });
    delBtn.addEventListener("click", () => void this.removeStrategy(name));
  }

  private async addStrategy(raw: string): Promise<void> {
    const name = (raw || "").trim();
    if (!name) return;
    const existing = this.plugin.findStrategy(name);
    const clean = await this.plugin.addStrategy(name);
    if (!clean) return;
    this.adding = false;
    new Notice(existing ? `Strategy "${clean}" is already registered.` : `Strategy "${clean}" added.`);
    await this.render();
  }

  private async registerStrategy(name: string): Promise<void> {
    await this.plugin.addStrategy(name);
    new Notice(`Strategy "${name}" registered.`);
    await this.render();
  }

  private async renameStrategy(oldName: string, raw: string): Promise<void> {
    const next = (raw || "").trim();
    if (!next || next.toLowerCase() === oldName.toLowerCase()) {
      this.renaming = null;
      await this.render();
      return;
    }
    const changed = await this.plugin.renameSetup(oldName, next);
    this.renaming = null;
    new Notice(`Renamed to "${next}" · ${changed} trade${changed === 1 ? "" : "s"} updated.`);
    await this.render();
  }

  private async removeStrategy(name: string): Promise<void> {
    const msg = `Remove "${name}" from the list?\n\nTrades keep their strategy and its vault note is kept — only the list entry goes away. To change the trades too, rename it instead.`;
    if (!window.confirm(msg)) return;
    await this.plugin.removeStrategy(name);
    await this.render();
  }
}
