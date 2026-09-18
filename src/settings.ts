import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type TradebookPlugin from "./main";
import { DEFAULT_ACCOUNT_RULES } from "./futures";
import { PROP_FIRMS, effectiveSize, getFirm, getProgram, getSize, makeAccount, uniqueAccountName } from "./props";
import { SCOPE_OPTIONS, kpiCard } from "./ui";
import { TIMEZONE_OPTIONS, detectSystemZone } from "./tz";
import { attachTip } from "./lib/tip";
import { THEMES } from "./themes";
import { openAccountWizard } from "./views/accountWizard";
import { openRenamePreview } from "./views/renamePreview";
import { buildDiagnostics } from "./lib/diagnostics";
import { openBackupSummary } from "./views/backupRestore";
import { summariseBackup } from "./lib/backup";
import { mountDateField } from "./lib/dates";

type SettingsTabId = "root" | "journal" | "tradelog" | "appearance" | "timezone" | "accounts" | "advanced";

export class SettingsTab extends PluginSettingTab {
  plugin: TradebookPlugin;
  titleText: TextComponent | null = null;
  active: SettingsTabId = "root";
  /** A single editor at a time (account id) — keeps the UI clean. */
  editingRulesFor: string | null = null;

  constructor(app: App, plugin: TradebookPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tj-settings");
    containerEl.createEl("h2", { text: "Tradebook" });

    if (this.active === "root") this.renderRoot(containerEl);
    else this.renderSection(containerEl);
  }

  private renderRoot(containerEl: HTMLElement): void {
    // Super-basic, always visible
    const basics = containerEl.createDiv({ cls: "tj-set-basics" });
    new Setting(basics)
      .setName("Currency")
      .setDesc("Symbol shown next to monetary values.")
      .addDropdown((dd) => {
        for (const [v, t] of [["$", "USD ($)"], ["€", "EUR (€)"], ["£", "GBP (£)"], ["¥", "JPY (¥)"], ["R$", "BRL (R$)"]] as [string, string][]) {
          dd.addOption(v, t);
        }
        dd.setValue(this.plugin.settings.currency || "$").onChange(async (v) => {
          this.plugin.settings.currency = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    new Setting(basics)
      .setName("Your name")
      .setDesc("Used in the home greeting, e.g. 'Good morning, Alex'.")
      .addText((text) =>
        text
          .setPlaceholder("Your name")
          .setValue(this.plugin.settings.journalName)
          .onChange(async (v) => {
            this.plugin.settings.journalName = v.trim();
            await this.plugin.saveSettings();
            await this.plugin.reloadAllViews();
          })
      );
    new Setting(basics)
      .setName("Journal name")
      .setDesc("Title shown at the top of the dashboard. Leave empty to use your name.")
      .addText((text) =>
        text
          .setPlaceholder(`${this.plugin.settings.journalName || "Your"} Journal`)
          .setValue(this.plugin.settings.dashboardTitle)
          .onChange(async (v) => {
            this.plugin.settings.dashboardTitle = v.trim();
            await this.plugin.saveSettings();
            await this.plugin.reloadAllViews();
          })
      );

    // Sections (drill-down)
    const sections: { id: SettingsTabId; title: string; desc: string }[] = [
      { id: "journal", title: "Journal", desc: "Dashboard layout, behaviour, formatting and support." },
      { id: "tradelog", title: "Trade Log", desc: "Default period, columns and layout." },
      { id: "appearance", title: "Appearance", desc: "Themes, colours, animations and privacy." },
      { id: "timezone", title: "Time zone", desc: "Market hours and how days are grouped." },
      { id: "accounts", title: "Accounts", desc: "Prop accounts, rules, groups and mappings." },
      { id: "advanced", title: "Advanced", desc: "Folder, maintenance, backup, import/export and reset." },
    ];
    for (const sec of sections) {
      const row = containerEl.createDiv({ cls: "tj-set-row" });
      const left = row.createDiv({ cls: "tj-set-row-left" });
      left.createDiv({ cls: "tj-set-title", text: sec.title });
      left.createDiv({ cls: "tj-set-desc", text: sec.desc });
      row.createDiv({ cls: "tj-set-chev", text: "›" });
      row.addEventListener("click", () => {
        this.active = sec.id;
        this.display();
      });
    }
  }

  private renderSection(containerEl: HTMLElement): void {
    const titles: Record<string, string> = {
      journal: "Journal",
      tradelog: "Trade Log",
      appearance: "Appearance",
      timezone: "Time zone",
      accounts: "Accounts",
      advanced: "Advanced",
    };
    const back = containerEl.createDiv({ cls: "tj-set-back", text: `‹ ${titles[this.active] ?? ""} `.trim() + " — Back" });
    back.addEventListener("click", () => {
      this.active = "root";
      this.display();
    });
    containerEl.createEl("h3", { text: titles[this.active] ?? "" });
    const content = containerEl.createDiv({ cls: "tj-set-section" });
    if (this.active === "journal") this.renderJournal(content);
    else if (this.active === "tradelog") this.renderTradeLogSettings(content);
    else if (this.active === "appearance") this.renderAppearance(content);
    else if (this.active === "timezone") this.renderTimezone(content);
    else if (this.active === "advanced") this.renderAdvanced(content);
    else this.renderAccounts(content);
  }



  // ---------------------------------------------------------------- Main
  renderJournal(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Dashboard" });
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

    containerEl.createEl("h3", { text: "Support" });
    containerEl.createEl("p", {
      text: "Tradebook is an open-source project built around a real trading workflow. If it helps your trading, a coffee keeps the improvements coming.",
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
    containerEl.createEl("h3", { text: "Formatting" });
    new Setting(containerEl)
      .setName("Date format")
      .setDesc("How every date is shown across the plugin. Pick the pattern you read fastest — the example updates with it.")
      .addDropdown((dd) => {
        dd.addOption("YYYY-MM-DD", "2026-09-13 — YYYY-MM-DD");
        dd.addOption("DD/MM/YYYY", "13/09/2026 — DD/MM/YYYY (day first)");
        dd.addOption("MM/DD/YYYY", "09/13/2026 — MM/DD/YYYY (month first)");
        dd.addOption("D MMM YYYY", "13 Sep 2026 — D MMM YYYY");
        dd.setValue(this.plugin.settings.dateFormat || "YYYY-MM-DD").onChange(async (v) => {
          this.plugin.settings.dateFormat = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    new Setting(containerEl)
      .setName("24-hour time")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.use24HourTime === true).onChange(async (v) => {
          this.plugin.settings.use24HourTime = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    new Setting(containerEl)
      .setName("Show seconds")
      .setDesc("Seconds matter in trading — show them on entry/exit times.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.showSeconds === true).onChange(async (v) => {
          this.plugin.settings.showSeconds = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });

    containerEl.createEl("h3", { text: "Behaviour" });
    new Setting(containerEl)
      .setName("Open Home on startup")
      .setDesc("Automatically open the Home view when the plugin loads.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.openHomeOnStartup === true).onChange(async (v) => {
          this.plugin.settings.openHomeOnStartup = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Open views in")
      .setDesc("Whether sidebar items replace the current tab or open a new one.")
      .addDropdown((dd) => {
        dd.addOption("replace", "Same tab");
        dd.addOption("new", "New tab");
        dd.setValue(this.plugin.settings.tabBehavior || "replace").onChange(async (v) => {
          this.plugin.settings.tabBehavior = v as "replace" | "new";
          await this.plugin.saveSettings();
        });
      });
  }

  // ------------------------------------------------------------- Trading

  // --------------------------------------------------------------- Lists


  // ----------------------------------------------------------- Trade Log
  renderTradeLogSettings(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    containerEl.createEl("h3", { text: "Trade Log defaults" });
    new Setting(containerEl)
      .setName("Default period")
      .addDropdown((dd) => {
        const opts: [string, string][] = [
          ["today", "Today"], ["yesterday", "Yesterday"], ["thisweek", "This Week"], ["1m", "This Month"],
          ["thisquarter", "This Quarter"], ["thisyear", "This Year"], ["all", "All Time"],
        ];
        for (const [v, t] of opts) dd.addOption(v, t);
        dd.setValue(s.tradeLogPeriod || "all").onChange(async (v) => {
          s.tradeLogPeriod = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Reset view")
      .setDesc("Restore the Trade Log columns and layout to their defaults.")
      .addButton((b) => {
        b.setButtonText("Reset").onClick(async () => {
          s.tradeLog = {};
          s.tradeLogColOrder = undefined;
          await this.plugin.saveSettings();
          new Notice("Trade Log view reset.");
          await this.plugin.reloadAllViews();
        });
      });
  }

  renderTimezone(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Time zones" });
    containerEl.createEl("p", {
      text: "Tradebook keeps one clock: the journal zone below. Every trade is shown and stored in that wall-clock, so the times you read are the times you typed — whichever machine or country you open it from. New York (Eastern) is the default because futures trade on ET (9:30 open).",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Journal time zone")
      .setDesc("The clock your journal runs on. IANA zones handle Summer/Winter (DST) automatically — you never change this when the clocks shift. Choose 'None' to keep recorded times exactly as written.")
      .addDropdown((dd) => {
        for (const opt of TIMEZONE_OPTIONS) dd.addOption(opt.zone, opt.label);
        dd.setValue(this.plugin.settings.timeZone).onChange(async (v) => {
          this.plugin.settings.timeZone = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    const detected = detectSystemZone();
    new Setting(containerEl)
      .setName("Import time zone")
      .setDesc(`The zone your broker writes its CSV in. Most exports carry no time zone, so Tradebook needs to know which clock they use and converts each trade into your journal zone. Default is this computer (${detected}). Tradovate and NinjaTrader usually export in US Central; several platforms export in UTC.`)
      .addDropdown((dd) => {
        dd.addOption("", `This computer (${detected})`);
        for (const opt of TIMEZONE_OPTIONS) if (opt.zone) dd.addOption(opt.zone, opt.label);
        dd.setValue(this.plugin.settings.importZone || "").onChange(async (v) => {
          this.plugin.settings.importZone = v;
          await this.plugin.saveSettings();
        });
      });
  }

  // --------------------------------------------------------- Appearance
  renderAppearance(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Themes" });
    containerEl.createEl("p", {
      text: "Complete, built-in themes — no extra plugins. The Default theme follows your Obsidian accent colour.",
      cls: "setting-item-description",
    });
    const gallery = containerEl.createDiv({ cls: "tj-theme-gallery" });
    for (const t of THEMES) {
      const active = (this.plugin.settings.theme.preset || "default") === t.id;
      const card = gallery.createDiv({ cls: "tj-theme-card" + (active ? " active" : "") });
      const sw = card.createDiv({ cls: "tj-theme-swatch" });
      sw.style.background =
        t.pattern === "dots"
          ? `radial-gradient(circle at 5px 5px, ${t.dotColor || "#889"} 1.6px, transparent 2.4px) 0 0/11px 11px, ${t.bg || t.surface || "var(--background-secondary)"}`
          : t.pattern === "gradient"
          ? `linear-gradient(160deg, ${t.bg}, ${t.bg2})`
          : t.bg || t.surface || "var(--background-secondary)";
      const dot = sw.createSpan({ cls: "tj-theme-dot" });
      dot.style.background = t.accent || "var(--interactive-accent)";
      card.createDiv({ cls: "tj-theme-name", text: t.name });
      card.addEventListener("click", async () => {
        this.plugin.settings.theme = {
          preset: t.id,
          background: t.pattern === "dots" ? "dots" : "default",
          accent: t.accent,
          dotColor: t.dotColor,
          surface: t.surface,
          bg: t.bg,
          bg2: t.bg2,
          border: t.border,
          pattern: t.pattern,
          font: t.font,
          glow: t.glow,
        };
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
        this.display();
      });
    }

    containerEl.createEl("h3", { text: "Theme & colors" });
    containerEl.createEl("p", {
      text: "Personalize how the journal looks. Everything is applied live — your Obsidian theme is untouched outside the journal views.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Background")
      .setDesc("'Dotted notebook' gives the journal a trading-pad feel (like Journalit's dotted texture).")
      .addDropdown((dd) => {
        dd.addOption("default", "Default (Obsidian theme)");
        dd.addOption("dots", "Dotted notebook");
        dd.setValue(this.plugin.settings.theme.background).onChange(async (v) => {
          this.plugin.settings.theme.background = v as "default" | "dots";
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });

    new Setting(containerEl)
      .setName("Accent color")
      .setDesc("Buttons, charts, the drag placeholder, resize handles and highlights. Empty = Obsidian default.")
      .addColorPicker((cp) => {
        cp.setValue(this.plugin.settings.theme.accent || "#7C5CFF").onChange(async (v) => {
          this.plugin.settings.theme.preset = "custom";
          this.plugin.settings.theme.accent = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("rotate-ccw").setTooltip("Reset to Obsidian default").onClick(async () => {
          this.plugin.settings.theme.accent = "";
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Dot color")
      .setDesc("Color of the dots on the 'Dotted notebook' background. Empty = auto (matches your text color).")
      .addColorPicker((cp) => {
        cp.setValue(this.plugin.settings.theme.dotColor || "#9A9A9A").onChange(async (v) => {
          this.plugin.settings.theme.preset = "custom";
          this.plugin.settings.theme.dotColor = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("rotate-ccw").setTooltip("Reset to auto").onClick(async () => {
          this.plugin.settings.theme.dotColor = "";
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Animations")
      .setDesc("Count-up/down on metric numbers and other UI motion. Turn off for zero animation.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.animations !== false).onChange(async (v) => {
          this.plugin.settings.animations = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    new Setting(containerEl)
      .setName("Dates on charts")
      .setDesc("Show a subtle date axis under the P&L charts (cumulative, long, short).")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.chartDates !== false).onChange(async (v) => {
          this.plugin.settings.chartDates = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    // NOTE: copy-trading is configured on the page it belongs to — Accounts →
    // Manage → Copy groups. No toggles here that quietly change the numbers.
    containerEl.createEl("h3", { text: "Privacy" });
    new Setting(containerEl)
      .setName("Privacy mode")
      .setDesc("Blur monetary values (P&L, balances) — handy for screenshots and streams. Hover to reveal.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.privacyMode === true).onChange(async (v) => {
          this.plugin.settings.privacyMode = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
  }

  // ------------------------------------------------------------ Advanced
  renderAdvanced(containerEl: HTMLElement): void {
    // NOTE: the "maturity / phase" panel that lived here was parked (see lib/maturity.ts).
    // We keep a single, context-adaptive Accounts layout instead of phase-specific ones.

    containerEl.createEl("h3", { text: "Maintenance" });
    new Setting(containerEl)
      .setName("Fix file names")
      .setDesc(
        "Rename every trade note (and its prints) to the current scheme: date · symbol · direction · time. You see the full list first — nothing moves until you confirm."
      )
      .addButton((b) => {
        b.setButtonText("Review…").onClick(async () => {
          b.setDisabled(true);
          b.setButtonText("Reading…");
          try {
            await openRenamePreview(this.plugin);
          } catch (err) {
            console.error("[tradebook] rename preview failed:", err);
            new Notice("Could not read the trades folder — check the console.");
          }
          b.setButtonText("Review…");
          b.setDisabled(false);
        });
      });
    new Setting(containerEl)
      .setName("Rebuild trade index")
      .setDesc("Re-read every trade note (clears the in-memory cache).")
      .addButton((b) =>
        b.setButtonText("Rebuild").onClick(async () => {
          this.plugin.clearTradeCache();
          await this.plugin.reloadAllViews();
          new Notice("Trade index rebuilt.");
        })
      );
    containerEl.createEl("h3", { text: "Journal folder" });
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

    // Getting started: the same tour a brand-new journal opens on first load.
    containerEl.createEl("h3", { text: "Getting started" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The first-run tour walks through the trades folder, your accounts and your first trade. Handy to see exactly what a new user sees.",
    });
    new Setting(containerEl)
      .setName("Show the getting started tour")
      .setDesc("Opens the tour now. If you closed it mid-way, it resumes where you stopped.")
      .addButton((b) => b.setButtonText("Open tour").onClick(() => this.plugin.showGettingStarted()));
    new Setting(containerEl)
      .setName("Restart the tour from the beginning")
      .setDesc("Forgets where you stopped, so the next open starts at the first step.")
      .addButton((b) =>
        b.setButtonText("Restart").onClick(async () => {
          delete this.plugin.settings.onboardingStep;
          await this.plugin.saveSettings();
          new Notice("The tour will start from the beginning.");
        })
      );

    // Diagnostics: what a bug report needs, without asking three times for it.
    containerEl.createEl("h3", { text: "Diagnostics" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Versions, counts, the settings that shape the numbers, and the last error of this session. No note contents — copy it into a bug report, or attach the file.",
    });
    new Setting(containerEl)
      .setName("Copy diagnostics")
      .setDesc("Copies the snapshot to the clipboard.")
      .addButton((b) =>
        b.setButtonText("Copy").onClick(async () => {
          try {
            const text = await buildDiagnostics(this.plugin);
            if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
            await navigator.clipboard.writeText(text);
            new Notice("Diagnostics copied to the clipboard.");
          } catch (err) {
            console.error("[tradebook] diagnostics copy failed", err);
            new Notice("Could not copy — use Save diagnostics to the vault instead.");
          }
        })
      );
    new Setting(containerEl)
      .setName("Save diagnostics to the vault")
      .setDesc("Writes a small .txt next to your backups, ready to attach to a report.")
      .addButton((b) =>
        b.setButtonText("Save").onClick(async () => {
          try {
            const res = await this.plugin.writeDiagnostics();
            new Notice(`Diagnostics written: ${res.path}`);
          } catch (err) {
            console.error("[tradebook] diagnostics file failed", err);
            new Notice("Could not write the file — check the console.");
          }
        })
      );

    // Backup: the whole journal in one file — settings, accounts and the trade
    // notes. Case A of docs/BACKUP-AND-EXPORT.md.
    containerEl.createEl("h3", { text: "Backup" });
    containerEl.createEl("p", {
      text: `One file with your settings, your accounts, your payouts and your trade notes, written to ${this.plugin.getBackupFolder()}. Prints are images in the vault — copy the vault folder as well to carry those.`,
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Export everything")
      .setDesc("Writes a backup and tells you where it landed.")
      .addButton((b) =>
        b.setButtonText("Export").onClick(async () => {
          b.setDisabled(true);
          b.setButtonText("Writing…");
          try {
            const res = await this.plugin.exportEverything();
            const kb = Math.max(1, Math.round(res.bytes / 1024));
            new Notice(`Backup written: ${res.path} (${kb} KB · ${res.counts.trades} notes)`);
          } catch (err) {
            console.error("[tradebook] backup failed", err);
            new Notice("Could not write the backup — check the console.");
          }
          b.setButtonText("Export");
          b.setDisabled(false);
        })
      );
    new Setting(containerEl)
      .setName("Import a backup")
      .setDesc("Shows what is inside the file before anything changes. Your current settings are snapshotted first.")
      .addButton((b) =>
        b.setButtonText("Choose file…").onClick(() => this.pickBackupFile())
      );
    new Setting(containerEl)
      .setName("Reset all settings")
      .setDesc("Restore every setting to its default. Your trades are NOT deleted.")
      .addButton((b) =>
        b.setButtonText("Reset").setWarning().onClick(async () => {
          this.plugin.settings.dashboardLayout = [];
          this.plugin.settings.tradeLog = {};
          this.plugin.settings.tradeLogColOrder = undefined;
          this.plugin.settings.privacyMode = false;
          this.plugin.settings.openHomeOnStartup = false;
          this.plugin.settings.tabBehavior = "replace";
          this.plugin.settings.dateFormat = "YYYY-MM-DD";
          this.plugin.settings.use24HourTime = false;
          this.plugin.settings.showSeconds = false;
          this.plugin.settings.defaultSymbol = "NQ";
          this.plugin.settings.defaultQty = 1;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
          new Notice("Settings reset to defaults.");
          this.display();
        })
      );
  }

  /**
   * Read the file the user picked, say what is inside it, and only then offer to
   * put it back. Everything the plugin owns travels in that one file.
   */
  private pickBackupFile(): void {
    const input = document.body.createEl("input", { attr: { type: "file", accept: ".json,application/json" } });
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      let summary;
      try {
        summary = summariseBackup(JSON.parse(await file.text()));
      } catch (err) {
        console.error("[tradebook] could not read the backup file", err);
        new Notice("That file is not readable JSON.");
        return;
      }
      if (!summary.ok) {
        new Notice(summary.error ?? "That file is not a backup from this plugin.");
        return;
      }
      openBackupSummary(this.plugin, summary, (message) => {
        new Notice(message);
        this.display();
      });
    });
    input.click();
  }

  renderAccounts(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", { cls: "tj-rule-group-details" });
    details.createEl("summary", { text: "Advanced — account type classification rules" });
    details.createEl("p", {
      text: "Automatic: order matters (first match wins). Accounts are classified as live → funded → eval → demo based on keywords in the account name. Do not edit unless necessary.",
      cls: "setting-item-description",
    });
    (() => {
      details.querySelectorAll(".tj-rule-group").forEach((el) => el.remove());
      const rules = this.plugin.getAccountRules();
      const group = details.createDiv({ cls: "tj-rule-group" });
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

    new Setting(containerEl)
      .setName("Exclude demo accounts from portfolio totals")
      .setDesc(
        "Demo accounts stay visible on the Accounts page but are left out of the portfolio totals (capital, Net P&L, growth, withdrawals and trade counts)."
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.excludeDemosFromPortfolio !== false).onChange(async (v) => {
          this.plugin.settings.excludeDemosFromPortfolio = v;
          await this.plugin.saveSettings();
          this.plugin.reloadAllViews();
        })
      );

    // NOTE: the Accounts page view options (grouping, order, firm logo, which
    // types show) now live in the page itself: Accounts → Manage. One place
    // for them, so the two can never disagree.

    containerEl.createEl("h3", { text: "Account Configuration" });
    containerEl.createEl("p", {
      text: "Add each of your prop accounts (firm + program + size). Limits come from the firms' sites (Sep 2026) — if a firm changes its rules, tap 'Edit rules' on an account to override them. Each account gets its own dashboard automatically.",
      cls: "setting-item-description",
    });
    this.renderAccountConfig(containerEl);
  }

  renderAccountConfig(containerEl: HTMLElement): void {
    const plugin = this.plugin;

    // Guided wizard — the exact same component used by the Accounts tab + tour.
    new Setting(containerEl)
      .setName("Add account")
      .setDesc("Guided setup with firm presets, the rules disclaimer and the copy-trading options.")
      .addButton((b) =>
        b.setButtonText("Open wizard").setCta().onClick(() => {
          openAccountWizard(this.plugin, { onDone: () => this.display() });
        })
      );

    // Quick add (power users)
    const form = containerEl.createEl("div", { cls: "tj-account-card tj-account-form" });
    form.createEl("h4", { text: "Quick add" });
    const firmSel = form.createEl("select", { cls: "dropdown" });
    for (const firm of PROP_FIRMS) firmSel.createEl("option", { value: firm.id, text: firm.name });
    const programSel = form.createEl("select", { cls: "dropdown" });
    const sizeSel = form.createEl("select", { cls: "dropdown" });
    const nameInput = form.createEl("input", { attr: { type: "text", placeholder: "Name (optional)" } });
    let startedValue = new Date().toISOString().slice(0, 10);
    mountDateField(form, {
      value: startedValue,
      format: this.plugin.settings.dateFormat,
      onChange: (iso) => (startedValue = iso),
    });
    const typeSel = form.createEl("select", { cls: "dropdown" });
    const TYPE_LABELS: [string, string][] = [
      ["eval", "Eval"],
      ["funded", "Funded"],
      ["live", "Live (prop firm)"],
      ["personal", "Personal (own money)"],
      ["demo", "Demo"],
    ];
    for (const [id, label] of TYPE_LABELS) typeSel.createEl("option", { value: id, text: label });

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
      const accType = (typeSel.value as any) || "eval";
      const taken = (plugin.settings.propAccounts || []).map((a) => a.name);
      const safeName = nameInput.value.trim() ? uniqueAccountName(nameInput.value, taken) : "";
      const acc = makeAccount(firm, program, size, safeName, accType);
      acc.name = uniqueAccountName(acc.name, taken);
      if (startedValue) acc.createdAt = startedValue;
      plugin.settings.propAccounts.push(acc);
      await plugin.saveSettings();
      nameInput.value = "";
      startedValue = new Date().toISOString().slice(0, 10);
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
        const typeChip = meta.createEl("span", { cls: `tj-acct-chip ${acc.type}` });
        typeChip.textContent = acc.type;
        const kpis = card.createEl("div", { cls: "tj-kpis" });
        kpiCard(kpis, "Profit Target", size.target ? `$${size.target.toLocaleString()}` : "None", size.target ? "pos" : "neutral");
        kpiCard(kpis, "Max Loss (trail)", size.maxLoss ? `$${size.maxLoss.toLocaleString()}` : "None", size.maxLoss ? "neg" : "neutral");
        kpiCard(kpis, "Daily Loss", size.dailyLoss ? `$${size.dailyLoss.toLocaleString()}` : "None", size.dailyLoss ? "neg" : "neutral");
        kpiCard(kpis, "Consistency", size.consistency ? `${size.consistency}%` : "None", "neutral");
        const actions = card.createEl("div", { cls: "tj-account-actions" });
        actions.createEl("button", { text: "Open dashboard ›", cls: "tj-btn tj-add-trade" }).addEventListener("click", () => {
          void plugin.openAccountDashboard(undefined, acc.id);
        });
        const rulesBtn = actions.createEl("button", { text: "Edit rules", cls: "tj-btn tj-mini" });
        attachTip(rulesBtn, { title: "Edit rules", sub: "Override this account's firm rules: target, drawdown, daily loss, consistency." });
        rulesBtn.addEventListener("click", () => {
          this.editingRulesFor = this.editingRulesFor === acc.id ? null : acc.id;
          this.display();
        });
        const typeEdit = actions.createEl("select", { cls: "dropdown", attr: { "aria-label": "Change account type" } });
        attachTip(typeEdit, { title: "Account type", sub: "Which section of the Accounts page it lands in." });
        const TYPE_LABELS: [string, string][] = [
          ["eval", "Eval"],
          ["funded", "Funded"],
          ["live", "Live"],
          ["personal", "Personal"],
          ["demo", "Demo"],
          ["unknown", "Other"],
        ];
        for (const [id, label] of TYPE_LABELS) {
          const opt = typeEdit.createEl("option", { value: id, text: label });
          if (id === acc.type) opt.setAttr("selected", "selected");
        }
        typeEdit.value = acc.type;
        typeEdit.addEventListener("change", async () => {
          acc.type = typeEdit.value as any;
          await plugin.saveSettings();
          await plugin.reloadAllViews();
          this.display();
        });
        actions.createEl("button", { text: "Remove", cls: "tj-mini tj-del" }).addEventListener("click", async () => {
          plugin.settings.propAccounts = plugin.settings.propAccounts.filter((a) => a.id !== acc.id);
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
      const chip = nameBox.createDiv({ cls: mapped ? `tj-acct-chip ${mapped.type}` : "tj-acct-chip unknown" });
      chip.textContent = mapped ? `Bound to ${mapped.name}` : `Rules say: ${this.plugin.resolveAccountType(name)}`;
      const sel = row.createEl("select", { cls: "dropdown", attr: { "aria-label": "Bind this account to a prop account" } });
      attachTip(sel, { title: "Bind this account", sub: "Which prop account these broker trades belong to." });
      sel.createEl("option", { value: "", text: "Auto (by rules)" });
      for (const acc of this.plugin.settings.propAccounts) {
        const opt = sel.createEl("option", { value: acc.id, text: `${acc.name} · ${acc.type}` });
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