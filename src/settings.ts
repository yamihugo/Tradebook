import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type TradingJournalPlugin from "./main";
import { DEFAULT_ACCOUNT_RULES } from "./futures";
import { PROP_FIRMS, effectiveSize, getFirm, getProgram, getSize, makeAccount } from "./props";
import { SCOPE_OPTIONS, kpiCard } from "./ui";
import { TIMEZONE_OPTIONS } from "./tz";

type SettingsTabId = "main" | "timezone" | "accounts";

export class SettingsTab extends PluginSettingTab {
  plugin: TradingJournalPlugin;
  titleText: TextComponent | null = null;
  active: SettingsTabId = "main";
  /** A single editor at a time (account id) — keeps the UI clean. */
  editingRulesFor: string | null = null;

  constructor(app: App, plugin: TradingJournalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Trading Journal — Settings" });

    this.renderTabs(containerEl);

    if (this.active === "main") this.renderMain(containerEl);
    else if (this.active === "timezone") this.renderTimezone(containerEl);
    else this.renderAccounts(containerEl);
  }

  renderTabs(containerEl: HTMLElement): void {
    const tabs = containerEl.createDiv({ cls: "tj-settings-tabs" });
    const entries: { id: SettingsTabId; label: string }[] = [
      { id: "main", label: "Main" },
      { id: "timezone", label: "Time zone" },
      { id: "accounts", label: "Accounts" },
    ];
    for (const e of entries) {
      tabs
        .createEl("button", { text: e.label, cls: "tj-settings-tab" + (this.active === e.id ? " active" : "") })
        .addEventListener("click", () => {
          this.active = e.id;
          this.display();
        });
    }
  }

  // ---------------------------------------------------------------- Main
  renderMain(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Initial setup" });
    containerEl.createEl("p", {
      text: "Tell the journal who it belongs to — the dashboard is named automatically from that.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Journal name")
      .setDesc("Your name or brand, e.g. 'You Go Trading', 'Crunchy'. Used to build the dashboard title.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. You Go Trading")
          .setValue(this.plugin.settings.journalName)
          .onChange(async (v) => {
            this.plugin.settings.journalName = v.trim();
            await this.plugin.saveSettings();
            this.titleText?.setPlaceholder(`${this.plugin.settings.journalName || "Your name"} Trading Dashboard`);
          })
      );
    new Setting(containerEl)
      .setName("Dashboard title")
      .setDesc("Title shown at the top of the dashboard. Leave empty to use your journal name automatically.")
      .addText((text) => {
        this.titleText = text;
        text
          .setPlaceholder(`${this.plugin.settings.journalName || "Your name"} Trading Dashboard`)
          .setValue(this.plugin.settings.dashboardTitle)
          .onChange(async (v) => {
            this.plugin.settings.dashboardTitle = v.trim();
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Dashboard content")
      .setDesc("Open the dashboard and press 'Edit' to add, remove, resize or drag cards around. Your layout is saved automatically.")
      .addButton((btn) =>
        btn.setButtonText("Reset layout").onClick(async () => {
          this.plugin.settings.dashboardLayout = [];
          await this.plugin.saveSettings();
          new Notice("Dashboard layout reset to the default.");
        })
      );

    containerEl.createEl("h3", { text: "Storage" });
    containerEl.createEl("p", {
      text: "Where trade notes live in your vault. Changing this does not move existing notes.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Trades folder")
      .setDesc("Folder (relative to vault) where trade notes are saved.")
      .addText((text) =>
        text.setValue(this.plugin.settings.tradesFolder).onChange(async (v) => {
          this.plugin.settings.tradesFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Support" });
    containerEl.createEl("p", {
      text: "Trading Journal is an open-source project built around a real trading workflow. If it helps your trading, a coffee keeps the improvements coming.",
      cls: "tj-support-note",
    });
    new Setting(containerEl)
      .setName("Buy me a coffee")
      .setDesc("Open the buy-me-a-coffee page — your data stays in your vault.")
      .addButton((btn) =>
        btn.setButtonText("Buy me a coffee").setCta().onClick(() => {
          try {
            window.open("https://www.buymeacoffee.com/yamihugo", "_blank") ||
              new Notice("Your browser blocked the popup — open the link manually.");
          } catch {
            new Notice("Your browser blocked the popup — open the link manually.");
          }
        })
      );
  }


  // ------------------------------------------------------------ Time zone
  renderTimezone(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Market hours & time zone" });
    containerEl.createEl("p", {
      text: "Times in your trade notes are assumed to be in the time zone below. The dashboard then converts them to New York (Eastern) time for the market-hour analysis (US futures open 9:30 ET).",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Your time zone")
      .setDesc("IANA zones handle Summer/Winter (DST) automatically — you do not need to change this when the clocks shift. Choose 'None' to keep recorded times untouched.")
      .addDropdown((dd) => {
        for (const opt of TIMEZONE_OPTIONS) dd.addOption(opt.zone, opt.label);
        dd.setValue(this.plugin.settings.timeZone).onChange(async (v) => {
          this.plugin.settings.timeZone = v;
          await this.plugin.saveSettings();
        });
      });
  }

  // ------------------------------------------------------------- Accounts
  renderAccounts(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Account type classification" });
    containerEl.createEl("p", {
      text: "Automatic: order matters (first match wins). Accounts are classified as funded → eval → demo based on keywords in the account name.",
      cls: "setting-item-description",
    });
    (() => {
      containerEl.querySelectorAll(".tj-rule-group").forEach((el) => el.remove());
      const rules = this.plugin.getAccountRules();
      const group = containerEl.createDiv({ cls: "tj-rule-group" });
      for (const rule of rules) {
        const row = group.createDiv({ cls: "tj-rule-row" });
        row.createSpan({ text: rule.type, cls: "tj-rule-type" });
        row.createEl("input", {
          type: "text",
          value: rule.keywords.join(", "),
          cls: "tj-rule-input",
        }).addEventListener("change", async (ev) => {
          const keywords = (ev.target as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean);
          if (!this.plugin.settings.accountRules.length) {
            this.plugin.settings.accountRules = DEFAULT_ACCOUNT_RULES.map((r) => ({ type: r.type, keywords: [...r.keywords] }));
          }
          const target = this.plugin.settings.accountRules.find((r) => r.type === rule.type);
          if (target) target.keywords = keywords;
          await this.plugin.saveSettings();
        });
      }
    })();

    containerEl.createEl("h3", { text: "Account Configuration" });
    containerEl.createEl("p", {
      text: "Add each of your prop accounts (firm + program + size). Limits come from the firms' sites (Sep 2026) — if a firm changes its rules, tap 'Edit rules' on an account to override them. Each account gets its own dashboard automatically.",
      cls: "setting-item-description",
    });
    this.renderAccountConfig(containerEl);
  }

  renderAccountConfig(containerEl: HTMLElement): void {
    const plugin = this.plugin;

    // Primary account selector
    new Setting(containerEl)
      .setName("Primary account")
      .setDesc("The account shown by default when you open the Accounts tab or choose a linked account.")
      .addDropdown((dd) => {
        const accounts = plugin.settings.propAccounts || [];
        if (accounts.length === 0) dd.addOption("", "No accounts yet");
        for (const acc of accounts) dd.addOption(acc.id, `${acc.name || acc.id} · $${(acc.size / 1000).toFixed(0)}K`);
        dd.setValue(plugin.settings.primaryAccountId || accounts[0]?.id || "").onChange(async (v) => {
          plugin.settings.primaryAccountId = v;
          await plugin.saveSettings();
          await plugin.reloadAllViews();
        });
      });

    // Add account form
    const form = containerEl.createEl("div", { cls: "tj-account-card tj-account-form" });
    form.createEl("h4", { text: "Add account" });
    const firmSel = form.createEl("select", { cls: "dropdown" });
    for (const firm of PROP_FIRMS) firmSel.createEl("option", { value: firm.id, text: firm.name });
    const programSel = form.createEl("select", { cls: "dropdown" });
    const sizeSel = form.createEl("select", { cls: "dropdown" });
    const nameInput = form.createEl("input", { attr: { type: "text", placeholder: "Name (optional)" } });
    const scopeSel = form.createEl("select", { cls: "dropdown" });
    for (const s of SCOPE_OPTIONS) scopeSel.createEl("option", { value: s.id, text: s.label });
    const liveBox = form.createEl("label", { cls: "tj-check" });
    liveBox.createEl("input", { type: "checkbox" });
    liveBox.createSpan({ text: " Live account (personal brokerage — payout tracking, no prop rules)" });

    const fillPrograms = () => {
      const firm = getFirm(firmSel.value) ?? PROP_FIRMS[0];
      programSel.empty();
      for (const p of firm.programs) programSel.createEl("option", { value: p.id, text: p.label });
      fillSizes();
    };
    const fillSizes = () => {
      const firm = getFirm(firmSel.value) ?? PROP_FIRMS[0];
      const program = getProgram(firm, programSel.value) ?? firm.programs[0];
      sizeSel.empty();
      for (const s of program.sizes) sizeSel.createEl("option", { value: String(s.size), text: `$${(s.size / 1000).toFixed(0)}K` });
    };
    fillPrograms();
    firmSel.addEventListener("change", fillPrograms);
    programSel.addEventListener("change", fillSizes);
    form.createEl("button", { text: "+ Add account", cls: "mod-cta" }).addEventListener("click", async () => {
      const firm = getFirm(firmSel.value) ?? PROP_FIRMS[0];
      const program = getProgram(firm, programSel.value) ?? firm.programs[0];
      const size = parseInt(sizeSel.value, 10) || program.sizes[0].size;
      const acc = makeAccount(firm, program, size, nameInput.value);
      acc.scope = scopeSel.value as any;
      acc.live = liveBox.querySelector("input")?.checked ?? false;
      if (acc.live) acc.scope = "funded";
      plugin.settings.propAccounts.push(acc);
      if (!plugin.settings.primaryAccountId) plugin.settings.primaryAccountId = acc.id;
      await plugin.saveSettings();
      nameInput.value = "";
      this.display();
    });

    // Account list (edit scope / rules / remove)
    const list = containerEl.createEl("div", { cls: "tj-account-list" });
    const accounts = plugin.settings.propAccounts;
    if (accounts.length === 0) {
      list.createDiv({ cls: "tj-empty", text: "No accounts yet — add one above and it gets its own dashboard." });
    } else {
      for (const acc of accounts) {
        const firm = getFirm(acc.firmId);
        const program = getProgram(firm, acc.programId);
        const baseSize = getSize(program, acc.size);
        const size = effectiveSize(baseSize, acc.rules);
        if (!firm || !program || !size) continue;
        const card = list.createEl("div", { cls: "tj-account-card" });
        const head = card.createEl("div", { cls: "tj-account-head" });
        head.createEl("div", { cls: "tj-account-name", text: `${acc.name}  ·  $${(acc.size / 1000).toFixed(0)}K` });
        const meta = head.createEl("div", { cls: "tj-account-meta" });
        meta.createEl("span", { text: `${firm.name} — ${program.label} — ${size.posSize}` });
        const scopeChip = meta.createEl("span", { cls: `tj-acct-chip ${acc.scope}` });
        scopeChip.textContent = SCOPE_OPTIONS.find((s) => s.id === acc.scope)?.label ?? acc.scope;
        if (acc.live) meta.createEl("span", { cls: "tj-acct-chip live", text: "Live" });
        const kpis = card.createEl("div", { cls: "tj-kpis" });
        kpiCard(kpis, "Profit Target", size.target ? `$${size.target.toLocaleString()}` : "None", size.target ? "pos" : "neutral");
        kpiCard(kpis, "Max Loss (trail)", size.maxLoss ? `$${size.maxLoss.toLocaleString()}` : "None", size.maxLoss ? "neg" : "neutral");
        kpiCard(kpis, "Daily Loss", size.dailyLoss ? `$${size.dailyLoss.toLocaleString()}` : "None", size.dailyLoss ? "neg" : "neutral");
        kpiCard(kpis, "Consistency", size.consistency ? `${size.consistency}%` : "None", "neutral");
        const actions = card.createEl("div", { cls: "tj-account-actions" });
        actions.createEl("button", { text: "Open dashboard ›", cls: "tj-btn tj-add-trade" }).addEventListener("click", () => {
          void plugin.openAccountDashboard(undefined, acc.id);
        });
        actions.createEl("button", { text: "Edit rules", cls: "tj-btn tj-mini", attr: { title: "Override this account's firm rules (target, drawdown, DLL, consistency)" } }).addEventListener("click", () => {
          this.editingRulesFor = this.editingRulesFor === acc.id ? null : acc.id;
          this.display();
        });
        const scopeEdit = actions.createEl("select", { cls: "dropdown", attr: { title: "Change scope…" } });
        for (const s of SCOPE_OPTIONS) {
          const opt = scopeEdit.createEl("option", { value: s.id, text: `Scope: ${s.label}` });
          if (s.id === acc.scope) opt.setAttr("selected", "selected");
        }
        scopeEdit.value = acc.scope;
        scopeEdit.addEventListener("change", async () => {
          acc.scope = scopeEdit.value as any;
          await plugin.saveSettings();
          await plugin.reloadAllViews();
          this.display();
        });
        actions.createEl("button", { text: acc.live ? "● Live" : "○ Not live", cls: "tj-btn tj-mini" + (acc.live ? " tj-live-btn" : ""), attr: { title: "Toggle live/personal account (payout tracking)" } }).addEventListener("click", async () => {
          acc.live = !acc.live;
          if (acc.live) acc.scope = "funded";
          await plugin.saveSettings();
          await plugin.reloadAllViews();
          this.display();
        });
        actions.createEl("button", { text: "Remove", cls: "tj-mini tj-del" }).addEventListener("click", async () => {
          plugin.settings.propAccounts = plugin.settings.propAccounts.filter((a) => a.id !== acc.id);
          if (plugin.settings.primaryAccountId === acc.id) plugin.settings.primaryAccountId = "";
          // Clean orphan mappings so no bound account points to a removed account.
          for (const [name, id] of Object.entries(plugin.settings.accountMappings || {})) {
            if (id === acc.id) delete plugin.settings.accountMappings[name];
          }
          await plugin.saveSettings();
          await plugin.reloadAllViews();
          this.display();
        });

        if (this.editingRulesFor === acc.id) {
          this.renderRuleEditor(card, acc, baseSize, size);
        }
      }
    }

    void this.renderMappings(containerEl);
    this.renderAccountGroups(containerEl);

    // Archived accounts section
    const archived = plugin.settings.archivedAccounts || [];
    if (archived.length > 0) {
      containerEl.createEl("h3", { text: "Archived Accounts (Past Evals)" });
      const archList = containerEl.createEl("div", { cls: "tj-account-list" });
      for (const acc of archived) {
        const card = archList.createEl("div", { cls: "tj-account-card tj-archived-card" });
        const head = card.createEl("div", { cls: "tj-account-head" });
        head.createEl("div", { cls: "tj-account-name", text: `${acc.name}  ·  $${(acc.size / 1000).toFixed(0)}K` });
        const actions = card.createEl("div", { cls: "tj-account-actions" });
        actions.createEl("button", { text: "Restore", cls: "tj-btn tj-mini" }).addEventListener("click", async () => {
          plugin.settings.archivedAccounts = plugin.settings.archivedAccounts.filter((a) => a.id !== acc.id);
          plugin.settings.propAccounts.push(acc);
          await plugin.saveSettings();
          await plugin.reloadAllViews();
          this.display();
        });
        actions.createEl("button", { text: "Delete", cls: "tj-mini tj-del" }).addEventListener("click", async () => {
          plugin.settings.archivedAccounts = plugin.settings.archivedAccounts.filter((a) => a.id !== acc.id);
          await plugin.saveSettings();
          this.display();
        });
      }
    }
  }

  renderAccountGroups(containerEl: HTMLElement): void {
    const plugin = this.plugin;
    const box = containerEl.createEl("div", { cls: "tj-account-card tj-account-groups" });
    box.createEl("h4", { text: "Account groups (TradeSyncer style)" });
    box.createEl("p", {
      cls: "setting-item-description",
      text: "Groups let you copy one trade to several accounts at once — great for trade syncing across multiple eval accounts of the same size.",
    });

    const groups = plugin.settings.accountGroups || (plugin.settings.accountGroups = []);
    const accounts = plugin.settings.propAccounts || [];

    // Add group form
    const form = box.createEl("div", { cls: "tj-group-form" });
    const nameInput = form.createEl("input", { attr: { type: "text", placeholder: "Group name (e.g. Apex 50K #1–4)" } });
    const addBtn = form.createEl("button", { text: "Add group", cls: "tj-btn tj-mini" });
    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        new Notice("Give the group a name first.");
        return;
      }
      groups.push({ id: "grp_" + Date.now(), name, accountIds: [] });
      nameInput.value = "";
      await plugin.saveSettings();
      this.display();
    });

    if (groups.length === 0) {
      box.createDiv({ cls: "tj-hint", text: "No groups yet — create one and pick which accounts it contains." });
    }
    for (const grp of groups) {
      const card = box.createEl("div", { cls: "tj-group-card" });
      const head = card.createEl("div", { cls: "tj-group-head" });
      head.createEl("span", { cls: "tj-group-name", text: grp.name });
      const count = head.createEl("span", { cls: "tj-group-count", text: `${grp.accountIds.length} accounts` });
      count.addClass(grp.accountIds.length ? "pos" : "tj-cal-muted");
      // Account picker for this group
      const pickRow = card.createEl("div", { cls: "tj-group-accounts" });
      if (accounts.length === 0) {
        pickRow.createDiv({ cls: "tj-hint", text: "Add prop accounts first (see above)." });
      }
      for (const acc of accounts) {
        const chip = pickRow.createEl("button", {
          cls: "tj-acct-pick-chip" + (grp.accountIds.includes(acc.id) ? " active" : ""),
          text: acc.name,
        });
        chip.addEventListener("click", async () => {
          const idx = grp.accountIds.indexOf(acc.id);
          if (idx >= 0) grp.accountIds.splice(idx, 1);
          else grp.accountIds.push(acc.id);
          chip.toggleClass("active", grp.accountIds.includes(acc.id));
          await plugin.saveSettings();
          this.display();
        });
      }
      const actions = card.createEl("div", { cls: "tj-account-actions" });
      actions.createEl("button", { text: "Remove group", cls: "tj-mini tj-del" }).addEventListener("click", async () => {
        plugin.settings.accountGroups = groups.filter((g) => g.id !== grp.id);
        await plugin.saveSettings();
        this.display();
      });
    }
  }

  renderRuleEditor(card: HTMLElement, acc: any, baseSize: any, size: any): void {
    const plugin = this.plugin;
    const editor = card.createDiv({ cls: "tj-rule-editor" });
    editor.createEl("h4", { text: `Edit rules — ${acc.name}` });
    editor.createEl("p", {
      cls: "setting-item-description",
      text: "Changes apply only to this account and are saved to your vault. Empty a field to use the firm's default.",
    });

    const fields: { key: "target" | "maxLoss" | "dailyLoss" | "consistency"; label: string; base: number }[] = [
      { key: "target", label: "Profit Target ($)", base: baseSize?.target ?? 0 },
      { key: "maxLoss", label: "Max Loss ($)", base: baseSize?.maxLoss ?? 0 },
      { key: "dailyLoss", label: "Daily Loss Limit ($)", base: baseSize?.dailyLoss ?? 0 },
      { key: "consistency", label: "Consistency (%)", base: baseSize?.consistency ?? 0 },
    ];
    for (const f of fields) {
      new Setting(editor)
        .setName(f.label)
        .setDesc(`Firm default: ${f.base ? (f.key === "consistency" ? f.base + "%" : "$" + f.base.toLocaleString()) : "None"}`)
        .addText((text) => {
          const current = acc.rules?.[f.key];
          text.inputEl.type = "number";
          text.inputEl.placeholder = f.base ? String(f.base) : "0";
          if (current !== undefined) text.setValue(String(current));
          text.onChange(async (v) => {
            const num = parseFloat(v);
            const invalid = Number.isNaN(num) || num < 0 || (f.key === "consistency" && num > 100);
            if (invalid || num === f.base) {
              delete acc.rules?.[f.key];
            } else {
              acc.rules = acc.rules || {};
              acc.rules[f.key] = num;
            }
            await plugin.saveSettings();
          });
        });
    }
    new Setting(editor)
      .setName("Position size cap")
      .setDesc(`Firm default: ${baseSize?.posSize || "—"}`)
      .addText((text) => {
        if (acc.rules?.posSize) text.setValue(acc.rules.posSize);
        text.onChange(async (v) => {
          const val = v.trim();
          if (!val) delete acc.rules?.posSize;
          else {
            acc.rules = acc.rules || {};
            acc.rules.posSize = val;
          }
          await plugin.saveSettings();
        });
      });
    const foot = editor.createDiv({ cls: "tj-rule-editor-foot" });
    foot.createEl("button", { text: "Reset all to firm defaults", cls: "tj-btn" }).addEventListener("click", async () => {
      delete acc.rules;
      await plugin.saveSettings();
      await plugin.reloadAllViews();
      this.editingRulesFor = null;
      this.display();
    });
    foot.createEl("button", { text: "Done", cls: "mod-cta" }).addEventListener("click", async () => {
      await plugin.saveSettings();
      await plugin.reloadAllViews();
      this.editingRulesFor = null;
      this.display();
    });
  }

  async renderMappings(root: HTMLElement): Promise<void> {
    const box = root.createEl("div", { cls: "tj-account-card tj-account-map" });
    box.createEl("h4", { text: "Account mapping" });
    box.createEl("p", {
      cls: "setting-item-description",
      text: "Bind journal accounts to one of your configured accounts. A bound account is counted under that account's scope (demo / eval / funded) instead of the keyword rules — use this for accounts the rules leave as 'Other'.",
    });
    const trades = await this.plugin.loadTrades();
    const accounts = [...new Set(trades.map((t) => t.account).filter((a) => !!a))].sort();
    if (accounts.length === 0) {
      box.createDiv({ cls: "tj-empty", text: "No accounts found in your trades yet — import or add trades first." });
      return;
    }
    for (const name of accounts) {
      const mapped = this.plugin.mappedAccount(name);
      const row = box.createEl("div", { cls: "tj-map-row" });
      const nameBox = row.createDiv({ cls: "tj-map-name" });
      nameBox.createDiv({ cls: "tj-map-acc", text: name });
      const chip = nameBox.createDiv({ cls: mapped ? `tj-acct-chip ${mapped.scope}` : "tj-acct-chip unknown" });
      chip.textContent = mapped ? `Bound to ${mapped.name}` : `Rules say: ${this.plugin.resolveAccountType(name)}`;
      const sel = row.createEl("select", { cls: "dropdown", attr: { title: "Bind this account…" } });
      sel.createEl("option", { value: "", text: "Auto (by rules)" });
      for (const acc of this.plugin.settings.propAccounts) {
        const opt = sel.createEl("option", { value: acc.id, text: `${acc.name} · ${acc.scope}` });
        if (mapped?.id === acc.id) opt.setAttr("selected", "selected");
      }
      if (mapped) sel.value = mapped.id;
      sel.addEventListener("change", async () => {
        if (sel.value) this.plugin.settings.accountMappings[name] = sel.value;
        else delete this.plugin.settings.accountMappings[name];
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      });
    }
  }
}