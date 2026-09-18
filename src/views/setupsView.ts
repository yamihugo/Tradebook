import { ItemView, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { renderAppShell } from "../ui";
import { fmtMoney } from "../tz";
import { toneClass } from "../lib/fills";

export const SETUPS_VIEW_TYPE = "tradebook-setups-view";

/**
 * Strategies — the full rule-set engine is still being built. What ships now is
 * the part that makes the rest possible: naming your setups. A name is enough to
 * file every trade under one strategy, and when the rules land they will attach
 * to the names people already chose. Nothing typed here is thrown away later.
 */
export class SetupsView extends ItemView {
  plugin: TradebookPlugin;

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
      text: "Name the strategies you trade so every trade can be filed under one. The full strategy system — rules, per-strategy numbers, comparison — is on its way.",
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

    const names = await this.plugin.knownSetups();

    // ---- Your setups card ----
    const card = main.createDiv({ cls: "tj-strat-card" });
    const head = card.createDiv({ cls: "tj-strat-card-head" });
    head.createEl("div", { cls: "tj-strat-card-title", text: "Your strategies" });
    const addBtn = head.createEl("button", { cls: "tj-btn tj-mini", text: "＋ Add strategy" });
    addBtn.addEventListener("click", () => void this.addSetup());

    if (!names.length) {
      const empty = card.createDiv({ cls: "tj-strat-empty" });
      empty.createEl("div", { text: "No strategies named yet." });
      empty.createEl("div", {
        cls: "tj-strat-empty-sub",
        text: "Add one here, or create it straight from a trade's Strategy picker.",
      });
    } else {
      const list = card.createDiv({ cls: "tj-strat-rows" });
      for (const name of names) {
        const g = counts.get(name.toLowerCase());
        const row = list.createDiv({ cls: "tj-strat-item" });
        const info = row.createDiv({ cls: "tj-strat-item-main" });
        info.createDiv({ cls: "tj-strat-item-name", text: name });
        const meta = info.createDiv({ cls: "tj-strat-item-meta" });
        meta.createSpan({ text: g ? `${g.n} ${g.n === 1 ? "trade" : "trades"}` : "not used yet" });
        if (g && g.n > 0) {
          const pnl = meta.createSpan({ cls: "tj-strat-item-pnl " + toneClass(g.pnl) });
          pnl.setText(g.pnl === 0 ? "—" : fmtMoney(g.pnl));
        }
        const actions = row.createDiv({ cls: "tj-strat-item-actions" });
        const renameBtn = actions.createEl("button", {
          cls: "tj-iconbtn",
          attr: { "aria-label": `Rename ${name}`, title: "Rename — updates every trade filed under it" },
        });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => void this.renameSetup(name));
        const delBtn = actions.createEl("button", {
          cls: "tj-iconbtn",
          attr: { "aria-label": `Remove ${name}`, title: "Remove from the list (trades keep their strategy)" },
        });
        setIcon(delBtn, "trash");
        delBtn.addEventListener("click", () => void this.removeSetup(name, g?.n ?? 0));
      }
    }

    // ---- What's coming ----
    const box = main.createDiv({ cls: "tj-emptystate tj-strat" + (this.plugin.settings.animations === false ? " is-still" : "") });
    const icon = box.createDiv({ cls: "tj-emptystate-icon tj-strat-hammer" });
    setIcon(icon, "hammer");
    box.createDiv({ cls: "tj-emptystate-title tj-strat-title", text: "More is coming" });
    box.createDiv({
      cls: "tj-emptystate-sub",
      text: "A strategy will be the rule set behind a trade — and your trades will be measured against it.",
    });
    const list = box.createDiv({ cls: "tj-strat-list" });
    const rows: Array<[string, string]> = [
      ["The rule set", "Where it enters, where it stops, where it takes profit, how big it trades."],
      ["Trades measured against it", "Which trades followed the rules, and what happened when they did not."],
      ["Its own numbers", "Win rate, expectancy and drawdown per strategy — not for the journal as a whole."],
      ["One trade, one row", "A trade copied into five accounts is one decision here, however it reached them."],
    ];
    for (const [k, v] of rows) {
      const row = list.createDiv({ cls: "tj-strat-row" });
      row.createDiv({ cls: "tj-strat-k", text: k });
      row.createDiv({ cls: "tj-strat-v", text: v });
    }
  }

  private async addSetup(): Promise<void> {
    const name = window.prompt("Name your strategy");
    if (!name || !name.trim()) return;
    const clean = await this.plugin.addSetup(name);
    new Notice(`Strategy "${clean}" added.`);
    await this.render();
  }

  private async renameSetup(oldName: string): Promise<void> {
    const next = window.prompt(
      `Rename "${oldName}" to — every trade filed under it is updated:`,
      oldName
    );
    if (next === null) return;
    const clean = next.trim();
    if (!clean || clean.toLowerCase() === oldName.toLowerCase()) return;
    const changed = await this.plugin.renameSetup(oldName, clean);
    new Notice(`Renamed to "${clean}" · ${changed} trade${changed === 1 ? "" : "s"} updated.`);
    await this.render();
  }

  private async removeSetup(name: string, used: number): Promise<void> {
    const msg = used > 0
      ? `Remove "${name}" from the list?\n\n${used} trade${used === 1 ? "" : "s"} keep their strategy — only the picker entry goes away.`
      : `Remove "${name}" from the list?`;
    if (!window.confirm(msg)) return;
    await this.plugin.removeSetup(name);
    await this.render();
  }
}
