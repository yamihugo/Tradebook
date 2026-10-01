import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type TradebookPlugin from "./main";
import { TIMEZONE_OPTIONS, detectSystemZone } from "./tz";
import type { PeriodId } from "./lib/periods";
import { appendBrandMark, BRAND_MARKS } from "./lib/brandIcons";
import { openRenamePreview } from "./views/renamePreview";
import { buildDiagnostics } from "./lib/diagnostics";
import { openBackupSummary } from "./views/backupRestore";
import { openSettingsRestore } from "./views/settingsRestore";
import { summariseBackup } from "./lib/backup";
import { freeNumeric } from "./lib/numeric";
import { MISTAKE_GROUPS, PSYCHOLOGY_TAGS, libraryFor, reviewOptions } from "./lib/tags";
import { CORE_INSTRUMENTS, contractLabel, futuresSpec } from "./futures";
import type { RiskRule } from "./lib/risk";
import wordmarkUrl from "../assets/brand/TradebookWordmark.png";

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** External links shown on the settings home. */
const LINKS = {
  coffee: "https://www.buymeacoffee.com/yamihugo",
  kofi: "https://ko-fi.com/yamihugo",
  github: "https://github.com/yamihugo/Tradebook",
  discord: "https://discord.com/app",
};
const DISCORD_HANDLE = "@yamihugo29";

type SettingsTabId = "root" | "general" | "journal" | "appearance" | "newtrades" | "review" | "advanced";

const SECTIONS: { id: SettingsTabId; title: string; desc: string; icon: string }[] = [
  { id: "general", title: "General", desc: "Currency, your name and how dates and times are shown.", icon: "settings" },
  { id: "journal", title: "Journal", desc: "Where the journal lives, its clock, and how views open.", icon: "notebook-text" },
  { id: "appearance", title: "Appearance", desc: "Animations, privacy mode and the calendar.", icon: "palette" },
  { id: "newtrades", title: "New trades", desc: "What the Add Trade form starts with, including default risk.", icon: "plus-circle" },
  { id: "review", title: "Review", desc: "The re-entry window and which tags the review suggests.", icon: "check-circle-2" },
  { id: "advanced", title: "Advanced", desc: "Maintenance, diagnostics and backup.", icon: "wrench" },
];

export class SettingsTab extends PluginSettingTab {
  plugin: TradebookPlugin;
  active: SettingsTabId = "root";

  constructor(app: App, plugin: TradebookPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tj-settings");
    containerEl.toggleClass("is-root", this.active === "root");
    if (this.active === "root") {
      this.renderRoot(containerEl);
    } else {
      this.renderSection(containerEl);
    }
  }

  // ---------------------------------------------------------------- Root

  private renderRoot(containerEl: HTMLElement): void {
    const logo = containerEl.createEl("img", { cls: "tj-set-logo", attr: { src: wordmarkUrl, alt: "Tradebook" } });
    logo.draggable = false;
    containerEl.createEl("p", { cls: "tj-set-intro", text: "Made for my own trading. Hope it helps yours too." });
    containerEl.createEl("p", {
      cls: "tj-set-intro-sub",
      text: "Tradebook keeps your trades in your vault. Local, private, yours.",
    });

    const list = containerEl.createDiv({ cls: "tj-set-list" });
    for (const sec of SECTIONS) {
      const row = list.createDiv({ cls: "tj-set-item" });
      const icon = row.createDiv({ cls: "tj-set-item-icon" });
      setIcon(icon, sec.icon);
      const left = row.createDiv({ cls: "tj-set-item-left" });
      left.createDiv({ cls: "tj-set-title", text: sec.title });
      left.createDiv({ cls: "tj-set-desc", text: sec.desc });
      const chev = row.createDiv({ cls: "tj-set-chev" });
      setIcon(chev, "chevron-right");
      row.addEventListener("click", () => {
        this.active = sec.id;
        this.display();
      });
    }
    this.renderAbout(containerEl);
  }

  /**
   * The house signature: who builds this and how to reach me. Kept on the
   * settings home so it is always one glance away, never a drill-down.
   */
  private renderAbout(containerEl: HTMLElement): void {
    const wrap = containerEl.createDiv({ cls: "tj-set-support" });
    this.groupLabel(wrap, "Support");
    const about = wrap.createDiv({ cls: "tj-set-about" });
    const title = about.createDiv({ cls: "tj-set-about-title" });
    title.createSpan({ cls: "tj-set-about-name", text: "Tradebook" });
    title.createSpan({ cls: "tj-set-about-ver", text: `v${this.plugin.manifest.version}` });
    about.createEl("p", { cls: "tj-set-about-msg", text: "Found a bug, or need a hand? Just send me a message." });
    about.createEl("p", { cls: "tj-set-about-sub", text: "And if it's useful to you, a coffee goes a long way." });

    const sup = about.createDiv({ cls: "tj-set-sup" });
    this.supBtn(sup, "github", "GitHub", () => this.openLink(LINKS.github));
    this.supBtn(sup, "discord", "Discord", () => {
      this.openLink(LINKS.discord);
      new Notice(`DM me on Discord: ${DISCORD_HANDLE}`);
    });
    this.supBtn(sup, "coffee", "Buy me a coffee", () => this.openLink(LINKS.coffee));
    this.supBtn(sup, "kofi", "Ko-fi", () => this.openLink(LINKS.kofi));
  }

  private supBtn(parent: HTMLElement, brand: keyof typeof BRAND_MARKS, label: string, onClick: () => void): void {
    const b = parent.createEl("button", { cls: "tj-set-sup-btn", attr: { type: "button" } });
    const ic = b.createSpan({ cls: "tj-set-sup-btn-icon" });
    appendBrandMark(ic, brand, 18);
    b.createSpan({ text: label });
    b.addEventListener("click", onClick);
  }

  private openLink(url: string): void {
    try {
      window.open(url, "_blank") || new Notice("Your browser blocked the popup — open the link manually.");
    } catch {
      new Notice("Your browser blocked the popup — open the link manually.");
    }
  }

  private renderSection(containerEl: HTMLElement): void {
    const sec = SECTIONS.find((s) => s.id === this.active);
    const back = containerEl.createEl("button", {
      cls: "tj-set-back",
      attr: { type: "button", "aria-label": "Back to settings" },
    });
    setIcon(back, "chevron-left");
    back.createSpan({ text: "Settings" });
    back.addEventListener("click", () => {
      this.active = "root";
      this.display();
    });

    const head = containerEl.createDiv({ cls: "tj-set-head" });
    const icon = head.createDiv({ cls: "tj-set-head-icon" });
    setIcon(icon, sec?.icon ?? "settings");
    const body = head.createDiv({ cls: "tj-set-head-body" });
    body.createEl("h2", { cls: "tj-set-head-title", text: sec?.title ?? "" });
    if (sec?.desc) body.createDiv({ cls: "tj-set-head-desc", text: sec.desc });

    const content = containerEl.createDiv({ cls: "tj-set-section" });
    if (this.active === "general") this.renderGeneral(content);
    else if (this.active === "journal") this.renderJournal(content);
    else if (this.active === "appearance") this.renderAppearance(content);
    else if (this.active === "newtrades") this.renderNewTrades(content);
    else if (this.active === "review") this.renderReview(content);
    else this.renderAdvanced(content);
  }

  /** One option row: icon + name + description, with its native control. */
  private settingRow(containerEl: HTMLElement, icon: string, name: string, desc?: string): Setting {
    const s = new Setting(containerEl).setName(name);
    if (desc) s.setDesc(desc);
    s.settingEl.addClass("tj-set-opt");
    const ic = s.settingEl.createDiv({ cls: "tj-set-opt-icon" });
    setIcon(ic, icon);
    s.settingEl.insertBefore(ic, s.settingEl.firstChild);
    return s;
  }

  private groupLabel(containerEl: HTMLElement, text: string): void {
    containerEl.createDiv({ cls: "tj-set-group", text });
  }

  // ------------------------------------------------------------- General

  renderGeneral(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Identity");
    this.settingRow(containerEl, "user-round", "Your name", "Used in the Home greeting, e.g. 'Good morning, Alex'.")
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
    this.settingRow(containerEl, "coins", "Currency", "Symbol shown next to monetary values.")
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

    this.groupLabel(containerEl, "Dates and times");
    this.settingRow(containerEl, "calendar-days", "Date format", "How dates are shown across the plugin.")
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
    this.settingRow(containerEl, "clock", "24-hour time")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.use24HourTime === true).onChange(async (v) => {
          this.plugin.settings.use24HourTime = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.settingRow(containerEl, "timer", "Show seconds", "Show seconds on entry and exit times.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.showSeconds === true).onChange(async (v) => {
          this.plugin.settings.showSeconds = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.settingRow(containerEl, "calendar-range", "Week starts on", "The first day of the week, for 'This week', 'Last week' and the calendar.")
      .addDropdown((dd) => {
        dd.addOption("monday", "Monday");
        dd.addOption("sunday", "Sunday");
        dd.setValue(this.plugin.settings.weekStart ?? "monday").onChange(async (v) => {
          this.plugin.settings.weekStart = v as "monday" | "sunday";
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
  }

  // ------------------------------------------------------------- Journal

  renderJournal(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Location");
    this.settingRow(containerEl, "folder", "Journal folder", "Where trades and prints are filed. Changing it does not move existing notes.")
      .addText((text) =>
        text.setValue(this.plugin.settings.tradesFolder).onChange(async (v) => {
          this.plugin.settings.tradesFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    this.groupLabel(containerEl, "Time");
    this.renderTimezone(containerEl);

    this.groupLabel(containerEl, "Behaviour");
    this.settingRow(containerEl, "play", "Open Home on startup", "Automatically open Home when the plugin loads.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.openHomeOnStartup === true).onChange(async (v) => {
          this.plugin.settings.openHomeOnStartup = v;
          await this.plugin.saveSettings();
        });
      });
    this.settingRow(containerEl, "app-window", "Open views in", "Whether sidebar items replace the current tab or open a new one.")
      .addDropdown((dd) => {
        dd.addOption("replace", "Same tab");
        dd.addOption("new", "New tab");
        dd.setValue(this.plugin.settings.tabBehavior || "replace").onChange(async (v) => {
          this.plugin.settings.tabBehavior = v as "replace" | "new";
          await this.plugin.saveSettings();
        });
      });
    this.settingRow(containerEl, "calendar-clock", "Default period", "What Home and the Trade Log open with, before you pick another.")
      .addDropdown((dd) => {
        for (const [v, t] of [["all", "All time"], ["thismonth", "This month"], ["thisweek", "This week"], ["today", "Today"]] as [string, string][]) {
          dd.addOption(v, t);
        }
        dd.setValue(this.plugin.settings.defaultPeriod ?? "all").onChange(async (v) => {
          this.plugin.settings.defaultPeriod = v as PeriodId;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
  }

  renderTimezone(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "One clock for the whole journal: every trade is shown and stored in the zone below, so the times you read are the times you typed — on any machine. New York (Eastern) is the default because futures trade on ET.",
      cls: "tj-set-note",
    });
    this.settingRow(containerEl, "globe", "Journal time zone", "Your journal's clock. Zones handle daylight saving automatically. Pick 'None' to keep times exactly as written.")
      .addDropdown((dd) => {
        for (const opt of TIMEZONE_OPTIONS) dd.addOption(opt.zone, opt.label);
        dd.setValue(this.plugin.settings.timeZone).onChange(async (v) => {
          this.plugin.settings.timeZone = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    const detected = detectSystemZone();
    this.settingRow(containerEl, "plane", "Import time zone", `The zone your broker writes its CSV in; trades are converted to your journal zone. Default is this computer (${detected}).`)
      .addDropdown((dd) => {
        dd.addOption("", `This computer (${detected})`);
        for (const opt of TIMEZONE_OPTIONS) if (opt.zone) dd.addOption(opt.zone, opt.label);
        dd.setValue(this.plugin.settings.importZone || "").onChange(async (v) => {
          this.plugin.settings.importZone = v;
          await this.plugin.saveSettings();
        });
      });
  }

  // ---------------------------------------------------------- Appearance

  renderAppearance(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Visuals");
    this.settingRow(containerEl, "sparkles", "Animations", "Count-ups, transitions and chart fades. Turn off on slower machines.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.animations !== false).onChange(async (v) => {
          this.plugin.settings.animations = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.settingRow(containerEl, "eye-off", "Privacy mode", "Blur monetary values for screenshots and streams. Hover to reveal.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.privacyMode === true).onChange(async (v) => {
          this.plugin.settings.privacyMode = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.groupLabel(containerEl, "Calendar");
    this.settingRow(containerEl, "calendar", "Show weekends", "Off keeps Monday–Friday. On adds Saturday and Sunday to the calendar.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.showWeekends === true).onChange(async (v) => {
          this.plugin.settings.showWeekends = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });

    this.groupLabel(containerEl, "Reset");
    this.settingRow(
      containerEl,
      "rotate-ccw",
      "Reset view & appearance",
      "Restores only your view and appearance preferences — Home layout, columns, formatting, sidebar, animations, privacy and new-trade defaults. Your trades, accounts, time zone, import zone and journal folder are left untouched."
    ).addButton((b) =>
      b.setButtonText("Reset").setWarning().onClick(async () => {
        this.plugin.restoreHomeFoundation();
        this.plugin.settings.homeGridCols = 24;
        this.plugin.settings.tradeLog = {};
        this.plugin.settings.tradeLogColOrder = undefined;
        this.plugin.settings.sidebar = {};
        this.plugin.settings.animations = true;
        this.plugin.settings.privacyMode = false;
        this.plugin.settings.showWeekends = false;
        this.plugin.settings.openHomeOnStartup = false;
        this.plugin.settings.tabBehavior = "replace";
        this.plugin.settings.dateFormat = "YYYY-MM-DD";
        this.plugin.settings.weekStart = "monday";
        this.plugin.settings.use24HourTime = true;
        this.plugin.settings.showSeconds = true;
        this.plugin.settings.defaultSymbol = "";
        this.plugin.settings.defaultRisk = 200;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
        new Notice("View and appearance preferences reset.");
        this.display();
      })
    );
  }

  // ---------------------------------------------------------- New trades

  renderNewTrades(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Defaults");
    this.renderDefaultSymbol(containerEl);
    this.settingRow(containerEl, "shield", "Default risk", "Dollars of risk pre-filled on a new trade. Once you type an entry price it derives the stop; your own stop overrides it.")
      .addText((text) => {
        text.inputEl.type = "number";
        freeNumeric(text.inputEl);
        text.setValue(String(this.plugin.settings.defaultRisk ?? 0)).onChange(async (v) => {
          const n = Number(v);
          this.plugin.settings.defaultRisk = Number.isFinite(n) && n >= 0 ? n : 0;
          await this.plugin.saveSettings();
        });
      });

    this.groupLabel(containerEl, "Risk by symbol");
    containerEl.createEl("p", {
      text: "Used only on import, and only where the file holds no stop. The rule fills the gap and the trade is marked as assumed, never as recorded.",
      cls: "tj-set-note",
    });
    this.renderDefaultRisk(containerEl);
  }

  /**
   * An optional default symbol. Off by default: a toggle reveals a dropdown of
   * the contracts we know, and turning it off clears the pre-fill.
   */
  private renderDefaultSymbol(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    const contracts: string[] = [];
    for (const inst of CORE_INSTRUMENTS) for (const sym of [inst.mini, inst.micro]) contracts.push(sym);
    this.settingRow(containerEl, "tag", "Default symbol", "Pre-fill the symbol on a new manual trade.")
      .addToggle((tg) => {
        tg.setValue(!!s.defaultSymbol).onChange(async (v) => {
          s.defaultSymbol = v ? contracts[0] : "";
          await this.plugin.saveSettings();
          this.display();
        });
      });
    if (s.defaultSymbol) {
      this.settingRow(containerEl, "list", "Symbol", "The symbol pre-filled on a new trade.")
        .addDropdown((dd) => {
          for (const sym of contracts) dd.addOption(sym, contractLabel(sym));
          dd.setValue(s.defaultSymbol || contracts[0]).onChange(async (v) => {
            s.defaultSymbol = v;
            await this.plugin.saveSettings();
          });
        });
    }
  }

  /**
   * A risk per contract, for the trades an import cannot show a stop for.
   *
   * The mini and the micro are two rows on purpose: ten points is not the same
   * money on an NQ and on an MNQ, so a rule that means "10 points" has to say
   * which contract it is about. Dollars are the size-blind way to write it —
   * $200 is $200 on one NQ or on ten MNQ — and the row shows what that came out
   * as in points, so nothing about the trade stays hidden.
   *
   * Nothing is applied here: these rules run on import, and only where the file
   * holds no stop of its own.
   */
  renderDefaultRisk(containerEl: HTMLElement): void {
    // Read through the live settings, never through a captured copy: after a
    // write the row repaints itself, and a closed-over object would keep showing
    // the rule it had when the pane opened.
    const ruleNow = (sym: string): RiskRule | undefined => this.plugin.settings.defaultRiskBySymbol?.[sym];
    for (const instrument of CORE_INSTRUMENTS) {
      const block = containerEl.createDiv({ cls: "tj-set-riskblock" });
      const head = block.createDiv({ cls: "tj-set-riskblock-head" });
      head.createSpan({ cls: "tj-set-riskblock-name", text: instrument.label });
      head.createSpan({ cls: "tj-set-riskblock-pair", text: `${instrument.mini} / ${instrument.micro}` });
      for (const symbol of [instrument.mini, instrument.micro]) {
        const spec = futuresSpec(symbol);
        const row = block.createDiv({ cls: "tj-set-riskrow" });
        const name = row.createDiv({ cls: "tj-set-riskname" });
        name.createSpan({ cls: "tj-set-risksym", text: contractLabel(symbol) });
        const hint = name.createSpan({ cls: "tj-set-riskhint" });
        const paint = (): void => {
          const rule = ruleNow(symbol);
          hint.setText(
            rule?.points
              ? `${rule.points} pt from entry · $${round2(rule.points * spec.pointValue)} a contract`
              : rule?.dollars
              ? `$${round2(rule.dollars)} a trade`
              : "no rule"
          );
        };
        const write = async (field: "points" | "dollars", raw: string): Promise<void> => {
          const n = Number(raw);
          const next = { ...(this.plugin.settings.defaultRiskBySymbol || {}) };
          if (!Number.isFinite(n) || n <= 0) delete next[symbol];
          else next[symbol] = { [field]: n } as RiskRule;
          this.plugin.settings.defaultRiskBySymbol = next;
          await this.plugin.saveSettings();
          // One rule per contract, so the field that was not used is cleared to
          // match what is stored: the row never shows two values while holding one.
          const now = ruleNow(symbol);
          points.value = now?.points ? String(now.points) : "";
          dollars.value = now?.dollars ? String(now.dollars) : "";
          paint();
        };
        const points = row.createEl("input", {
          cls: "tj-set-riskinput",
          type: "number",
          attr: { placeholder: "points", "aria-label": `Default risk in points for ${symbol}` },
        });
        freeNumeric(points);
        points.value = ruleNow(symbol)?.points ? String(ruleNow(symbol)?.points) : "";
        points.addEventListener("change", () => void write("points", points.value));
        const dollars = row.createEl("input", {
          cls: "tj-set-riskinput",
          type: "number",
          attr: { placeholder: "$ per trade", "aria-label": `Default risk in dollars for ${symbol}` },
        });
        freeNumeric(dollars);
        dollars.value = ruleNow(symbol)?.dollars ? String(ruleNow(symbol)?.dollars) : "";
        dollars.addEventListener("change", () => void write("dollars", dollars.value));
        paint();
      }
    }
  }

  // ------------------------------------------------------------- Review

  renderReview(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Psychology");
    this.settingRow(containerEl, "timer-reset", "Re-entry window", "A trade opened within this many minutes of a losing exit on the same symbol reads as a re-entry after a loss. A heuristic, not a rule.")
      .addDropdown((dd) => {
        for (const minutes of [5, 10, 15, 30, 60]) dd.addOption(String(minutes), `${minutes} minutes`);
        dd.setValue(String(this.plugin.settings.reentryWindowMinutes ?? 15));
        dd.onChange(async (v) => {
          this.plugin.settings.reentryWindowMinutes = Number(v);
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.groupLabel(containerEl, "Tags");
    containerEl.createEl("p", {
      text: "Your own words for what happened. This list only changes which tags are suggested when you review — a tag already on a trade always stays.",
      cls: "tj-set-note",
    });
    this.renderTags(containerEl);
  }

  renderTags(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    const shown = (key: "mistakes" | "psychology") => new Set(reviewOptions(s, key));
    const persist = async (key: "mistakes" | "psychology", tag: string, on: boolean): Promise<void> => {
      const set = shown(key);
      if (on) set.add(tag);
      else set.delete(tag);
      const rr = (s.reviewOptions = s.reviewOptions || {});
      rr[key] = libraryFor(key).filter((t) => set.has(t));
      await this.plugin.saveSettings();
      await this.plugin.reloadAllViews();
    };
    const chip = (parent: HTMLElement, key: "mistakes" | "psychology", tag: string, on: boolean): void => {
      const el = parent.createEl("button", {
        cls: "tj-set-chip" + (on ? " is-on" : ""),
        attr: { type: "button", "aria-pressed": String(on) },
      });
      const ic = el.createSpan({ cls: "tj-set-chip-check" });
      setIcon(ic, "check");
      el.createSpan({ text: tag });
      el.addEventListener("click", async () => {
        const next = !el.hasClass("is-on");
        el.toggleClass("is-on", next);
        el.setAttribute("aria-pressed", String(next));
        await persist(key, tag, next);
      });
    };

    containerEl.createDiv({ cls: "tj-set-chiptitle", text: "Execution mistakes" });
    const mistakes = shown("mistakes");
    for (const group of MISTAKE_GROUPS) {
      const wrap = containerEl.createDiv({ cls: "tj-set-chips" });
      wrap.createSpan({ cls: "tj-set-chips-label", text: group.label });
      for (const tag of group.tags) chip(wrap, "mistakes", tag, mistakes.has(tag));
    }

    containerEl.createDiv({ cls: "tj-set-chiptitle", text: "Psychology state" });
    const psychology = shown("psychology");
    const wrap = containerEl.createDiv({ cls: "tj-set-chips" });
    for (const tag of PSYCHOLOGY_TAGS) chip(wrap, "psychology", tag, psychology.has(tag));

    this.settingRow(containerEl, "rotate-ccw", "Show the full library", "Restores every suggestion above; your own tags on trades are never touched.")
      .addButton((b) =>
        b.setButtonText("Restore all").onClick(async () => {
          delete s.reviewOptions;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
          this.display();
        })
      );
  }

  // ------------------------------------------------------------ Advanced

  renderAdvanced(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Maintenance");
    this.settingRow(
      containerEl,
      "file-pen",
      "Fix file names",
      "Rename every trade note (and its prints) to the current scheme: date · symbol · direction · time. You see the full list first — nothing moves until you confirm."
    ).addButton((b) => {
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
    this.settingRow(containerEl, "refresh-cw", "Rebuild trade index", "Re-read every trade note (clears the in-memory cache).").addButton((b) =>
      b.setButtonText("Rebuild").onClick(async () => {
        this.plugin.clearTradeCache();
        await this.plugin.reloadAllViews();
        new Notice("Trade index rebuilt.");
      })
    );

    this.groupLabel(containerEl, "Backup");
    containerEl.createEl("p", {
      text: `One file with your settings, your accounts, your payouts and your journal notes (trades, strategies…), written to ${this.plugin.getBackupFolder()}. Prints are images in the vault — copy the vault folder as well to carry those.`,
      cls: "tj-set-note",
    });
    this.settingRow(containerEl, "download", "Export everything", "Writes a backup and tells you where it landed.").addButton((b) =>
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
    this.settingRow(containerEl, "upload", "Import a backup", "Shows what is inside the file before anything changes. Your current settings are snapshotted first.").addButton((b) =>
      b.setButtonText("Choose file…").onClick(() => this.pickBackupFile())
    );
    this.settingRow(
      containerEl,
      "history",
      "Restore previous settings",
      "Puts back the settings (accounts, payouts, layouts, preferences) saved just before an import. Trade notes are left in the vault."
    ).addButton((b) => b.setButtonText("Restore…").onClick(() => void openSettingsRestore(this.plugin)));

    this.groupLabel(containerEl, "Diagnostics");
    containerEl.createEl("p", {
      cls: "tj-set-note",
      text: "Versions, counts, the settings that shape the numbers, and the last error of this session. No note contents — copy it into a bug report, or attach the file.",
    });
    this.settingRow(containerEl, "clipboard", "Copy or save diagnostics", "The same snapshot, two destinations: the clipboard to paste, or a .txt beside your backups to attach.").addButton((b) =>
      b.setButtonText("Copy").onClick(async () => {
        try {
          const text = await buildDiagnostics(this.plugin);
          if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
          await navigator.clipboard.writeText(text);
          new Notice("Diagnostics copied to the clipboard.");
        } catch (err) {
          console.error("[tradebook] diagnostics copy failed", err);
          new Notice("Could not copy — try Save to vault instead.");
        }
      })
    ).addButton((b) =>
      b.setButtonText("Save to vault").onClick(async () => {
        try {
          const res = await this.plugin.writeDiagnostics();
          new Notice(`Diagnostics written: ${res.path}`);
        } catch (err) {
          console.error("[tradebook] diagnostics file failed", err);
          new Notice("Could not write the file — check the console.");
        }
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
}
