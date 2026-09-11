import { ItemView } from "obsidian";
import type TradingJournalPlugin from "../main";
import { PropAccount } from "../types";
import { effectiveSize, getFirm, getProgram, getSize } from "../props";
import { kpiCard, renderAppShell } from "../ui";
import { SCOPE_OPTIONS } from "../ui";

export const ACCOUNTS_LIST_VIEW_TYPE = "trading-journal-accounts-list-view";

export class AccountsListView extends ItemView {
  plugin: TradingJournalPlugin;

  constructor(leaf: any, plugin: TradingJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ACCOUNTS_LIST_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Accounts";
  }

  getIcon(): string {
    return "user";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-accounts-list");
    const main = renderAppShell(root, this.plugin, "accounts");

    main.createEl("h1", { text: "Accounts", cls: "tj-view-h1" });
    main.createEl("p", {
      cls: "tj-import-info",
      text: "Pick an account to open its dashboard. Add, edit or archive accounts in Settings.",
    });

    const actions = main.createDiv({ cls: "tj-dash-actions" });
    actions.createEl("button", { text: "Manage accounts", cls: "tj-btn tj-mini" }).addEventListener("click", () => {
      this.openPluginSettings();
    });

    const accounts = this.plugin.settings.propAccounts;
    if (accounts.length === 0) {
      const empty = main.createDiv({ cls: "tj-empty" });
      empty.createDiv({ text: "No accounts configured yet — add your first account in Settings." });
      empty.createEl("button", { text: "Open Settings", cls: "mod-cta tj-btn", attr: { type: "button" } }).addEventListener("click", () => {
        this.openPluginSettings();
      });
    } else {
      // Group by firm (non-live) and a separate "Live" group for live accounts.
      const liveAccs = accounts.filter((a) => a.live || a.scope === "live");
      const firmMap = new Map<string, { firm: any; accs: PropAccount[] }>();
      for (const acc of accounts) {
        if (acc.live || acc.scope === "live") continue;
        const firm = getFirm(acc.firmId);
        if (!firm) continue;
        if (!firmMap.has(firm.id)) firmMap.set(firm.id, { firm, accs: [] });
        firmMap.get(firm.id)!.accs.push(acc);
      }
      const firmGroups = [...firmMap.values()].sort((a, b) => a.firm.name.localeCompare(b.firm.name));

      const renderCard = (acc: PropAccount, grid: HTMLElement) => {
        const firm = getFirm(acc.firmId);
        const program = getProgram(firm, acc.programId);
        const size = effectiveSize(getSize(program, acc.size), acc.rules);
        if (!firm || !program || !size) return;
        const s = size;
        const card = grid.createDiv({ cls: "tj-account-card tj-account-card-btn" });
        const head = card.createDiv({ cls: "tj-account-head" });
        head.createEl("div", { cls: "tj-account-name", text: acc.name });
        const meta = head.createEl("div", { cls: "tj-account-meta" });
        meta.createEl("span", { text: `${program.label} · $${(acc.size / 1000).toFixed(0)}K` });
        meta.createEl("span", { cls: `tj-acct-chip ${acc.scope}` });
        const scopeLabel = SCOPE_OPTIONS.find((s) => s.id === acc.scope)?.label ?? acc.scope;
        meta.querySelector(".tj-acct-chip")!.textContent = scopeLabel;
        if (acc.live) meta.createEl("span", { cls: "tj-acct-chip live", text: "Live" });

        const kpis = card.createDiv({ cls: "tj-account-kpis" });
        kpiCard(kpis, "Target", s.target ? `$${(s.target / 1000).toFixed(0)}K` : "—", s.target ? "pos" : "neutral");
        kpiCard(kpis, "Max Loss", s.maxLoss ? `$${(s.maxLoss / 1000).toFixed(0)}K` : "—", s.maxLoss ? "neg" : "neutral");
        if (acc.scope === "funded" || acc.scope === "live" || acc.live) {
          const withdrawn = this.plugin.accountPayoutsTotal(acc.id);
          kpiCard(kpis, "Withdrawn", withdrawn ? `$${withdrawn.toLocaleString()}` : "$0", "pos");
        }

        card.addEventListener("click", () => {
          void this.plugin.openAccountDashboard(undefined, acc.id);
        });
      };

      // Live group first (if any), then each prop firm.
      if (liveAccs.length > 0) {
        const group = main.createDiv({ cls: "tj-acct-group" });
        group.createEl("h2", { text: "Live", cls: "tj-acct-group-title" });
        const grid = group.createDiv({ cls: "tj-accounts-grid" });
        for (const acc of liveAccs) renderCard(acc, grid);
      }
      for (const g of firmGroups) {
        const group = main.createDiv({ cls: "tj-acct-group" });
        group.createEl("h2", { text: g.firm.name, cls: "tj-acct-group-title" });
        const grid = group.createDiv({ cls: "tj-accounts-grid" });
        for (const acc of g.accs) renderCard(acc, grid);
      }
    }

    // Archived accounts (restore here too)
    const archived = this.plugin.settings.archivedAccounts || [];
    if (archived.length > 0) {
      const box = main.createDiv({ cls: "tj-archived-box" });
      box.createEl("h3", { text: "Archived (past evals)" });
      for (const acc of archived) {
        const row = box.createDiv({ cls: "tj-archived-row" });
        row.createEl("span", { text: `${acc.name}  ·  $${(acc.size / 1000).toFixed(0)}K` });
        row.createEl("button", { text: "Restore", cls: "tj-btn tj-mini" }).addEventListener("click", async () => {
          this.plugin.settings.propAccounts.push({ ...acc });
          this.plugin.settings.archivedAccounts = this.plugin.settings.archivedAccounts.filter((a) => a.id !== acc.id);
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
          this.render();
        });
      }
    }
  }

  openPluginSettings(): void {
    const app = this.app as any;
    try {
      if (typeof app.setting?.openTabById === "function") {
        app.setting.openTabById(this.plugin.manifest.id);
        return;
      }
    } catch (err) {
      console.error("[trading-journal] openTabById failed:", err);
    }
    try {
      if (typeof app.setting?.open === "function") {
        app.setting.open();
        const tabs = app.setting?.settingTabs ?? [];
        const tab = tabs.find((t: any) => t.id === this.plugin.manifest.id);
        if (tab && typeof tab.display === "function") tab.display();
      }
    } catch (err) {
      console.error("[trading-journal] settings open failed:", err);
    }
  }
}