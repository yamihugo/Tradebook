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
import { mountDropdown, type DropdownItem } from "./lib/dropdown";
import { MISTAKE_GROUPS, PSYCHOLOGY_TAGS, libraryFor, reviewOptions } from "./lib/tags";
import { CORE_INSTRUMENTS, CORE_SYMBOLS, contractLabel, futuresSpec, DEFAULT_ACCOUNT_RULES } from "./futures";
import { typeColor, typeLabel } from "./lib/accountTypes";
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

type SettingsTabId = "root" | "general" | "journal" | "appearance" | "newtrades" | "review" | "imports" | "advanced";

const SECTIONS: { id: SettingsTabId; title: string; desc: string; icon: string }[] = [
  { id: "general", title: "General", desc: "Currency, your name and how dates and times are shown.", icon: "settings" },
  { id: "journal", title: "Journal", desc: "Where the journal lives, its clock, and how views open.", icon: "notebook-text" },
  { id: "appearance", title: "Appearance", desc: "Animations, privacy mode and the calendar.", icon: "palette" },
  { id: "newtrades", title: "New trades", desc: "What the Add Trade form starts with.", icon: "plus-circle" },
  { id: "review", title: "Review", desc: "The re-entry window and which tags the review suggests.", icon: "check-circle-2" },
  { id: "imports", title: "Imports", desc: "How imported trades are interpreted and matched.", icon: "import" },
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
    const heading = new Setting(body).setName(sec?.title ?? "").setHeading();
    heading.settingEl.addClass("tj-set-head-setting");
    heading.nameEl.addClass("tj-set-head-title");
    if (sec?.desc) body.createDiv({ cls: "tj-set-head-desc", text: sec.desc });

    const content = containerEl.createDiv({ cls: "tj-set-section" });
    if (this.active === "general") this.renderGeneral(content);
    else if (this.active === "journal") this.renderJournal(content);
    else if (this.active === "appearance") this.renderAppearance(content);
    else if (this.active === "newtrades") this.renderNewTrades(content);
    else if (this.active === "review") this.renderReview(content);
    else if (this.active === "imports") this.renderImports(content);
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

  /**
   * The one selection control, mounted on a setting row.
   *
   * Obsidian's `addDropdown` renders a native `<select>`, and a system popup in
   * the middle of the app breaks the visual language: it is the only control on
   * the page that does not belong to Tradebook. This is the plugin's own
   * dropdown instead — same component as the trading groups and the import
   * mapper, so a picker looks and behaves the same everywhere, and it is
   * keyboard-complete (arrows, Home/End, Enter, Escape) with the focus staying
   * on the button.
   */
  private select(
    s: Setting,
    items: DropdownItem[],
    value: string,
    onChange: (id: string) => void | Promise<void>,
    title?: string
  ): void {
    s.controlEl.empty();
    mountDropdown(s.controlEl, items, value, (id) => void onChange(id), {
      block: true,
      align: "right",
      side: "above",
      title,
    });
  }

  private groupLabel(containerEl: HTMLElement, text: string): void {
    containerEl.createDiv({ cls: "tj-set-group", text });
  }

  // ------------------------------------------------------------- General

  renderGeneral(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "You");
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
    this.groupLabel(containerEl, "Money, dates and times");
    this.select(
      this.settingRow(containerEl, "coins", "Currency", "The symbol shown next to every amount. It changes how figures read; it never converts them."),
      ([["$", "US Dollar  $"], ["€", "Euro  €"], ["£", "Pound Sterling  £"], ["¥", "Japanese Yen  ¥"], ["R$", "Brazilian Real  R$"]] as [string, string][])
        .map(([id, label]) => ({ id, label })),
      this.plugin.settings.currency || "$",
      async (v) => {
        this.plugin.settings.currency = v;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      }
    );

    // The label is the date itself, so the choice is read at a glance; the exact
    // pattern it stands for is the small line under it, not the headline.
    this.select(
      this.settingRow(containerEl, "calendar-days", "Date format", "How dates read everywhere in Tradebook."),
      [
        { id: "YYYY-MM-DD", label: "2026-09-13", note: "ISO · year, month, day" },
        { id: "DD/MM/YYYY", label: "13/09/2026", note: "day first" },
        { id: "MM/DD/YYYY", label: "09/13/2026", note: "month first" },
        { id: "D MMM YYYY", label: "13 Sep 2026", note: "13 Sept 2026 · words" },
      ],
      this.plugin.settings.dateFormat || "YYYY-MM-DD",
      async (v) => {
        this.plugin.settings.dateFormat = v;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      },
      "This changes how dates are written and read everywhere in Tradebook. The dates themselves are never altered."
    );
    this.settingRow(containerEl, "clock", "24-hour time", "Write times as 14:30 instead of 2:30 PM, everywhere they appear.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.use24HourTime === true).onChange(async (v) => {
          this.plugin.settings.use24HourTime = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.settingRow(containerEl, "timer", "Show seconds", "Add seconds to entry and exit times.")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.showSeconds === true).onChange(async (v) => {
          this.plugin.settings.showSeconds = v;
          await this.plugin.saveSettings();
          await this.plugin.reloadAllViews();
        });
      });
    this.select(
      this.settingRow(containerEl, "calendar-range", "Week starts on", "Where 'This week' and 'Last week' begin, and how the calendar draws a week."),
      [{ id: "monday", label: "Monday" }, { id: "sunday", label: "Sunday" }],
      this.plugin.settings.weekStart ?? "monday",
      async (v) => {
        this.plugin.settings.weekStart = v as "monday" | "sunday";
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      }
    );
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
    this.select(
      this.settingRow(containerEl, "panels-top-left", "Open pages in", "Whether opening a Tradebook page replaces the tab or opens a new one."),
      [{ id: "replace", label: "This tab" }, { id: "new", label: "A new tab" }],
      this.plugin.settings.tabBehavior || "replace",
      async (v) => {
        this.plugin.settings.tabBehavior = v as "replace" | "new";
        await this.plugin.saveSettings();
      }
    );
    this.select(
      this.settingRow(containerEl, "calendar-clock", "Default period", "What Home and the Trade Log open with, before you pick another."),
      [{ id: "all", label: "All time" }, { id: "thismonth", label: "This month" }, { id: "thisweek", label: "This week" }, { id: "today", label: "Today" }],
      this.plugin.settings.defaultPeriod ?? "all",
      async (v) => {
        this.plugin.settings.defaultPeriod = v as PeriodId;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      }
    );
  }

  renderTimezone(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "One clock for the whole journal: every trade is shown and stored in the zone below, so the times you read are the times you typed — on any machine. New York (Eastern) is the default because futures trade on ET.",
      cls: "tj-set-note",
    });
    this.select(
      this.settingRow(containerEl, "clock", "Journal time zone", "Every trade is shown and stored in this zone, so times read as you wrote them. Daylight saving is handled for you; pick \u2018None\u2019 to keep times exactly as typed."),
      TIMEZONE_OPTIONS.map((opt) => ({ id: opt.zone, label: opt.label })),
      this.plugin.settings.timeZone,
      async (v) => {
        this.plugin.settings.timeZone = v;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      }
    );
    const detected = detectSystemZone();
    this.select(
      this.settingRow(containerEl, "plane", "Import time zone", `The zone your broker writes its CSV in; trades are converted to your journal zone.`),
      [{ id: "", label: `This computer (${detected})`, note: "detected" }, ...TIMEZONE_OPTIONS.filter((opt) => opt.zone).map((opt) => ({ id: opt.zone, label: opt.label }))],
      this.plugin.settings.importZone || "",
      async (v) => {
        this.plugin.settings.importZone = v;
        await this.plugin.saveSettings();
      },
      `Leave on "This computer" unless your broker's export uses another zone. Currently ${detected}.`
    );
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
    this.settingRow(containerEl, "shield", "Default risk", "Risk pre-filled on a new trade, in your currency. Type an entry price and it suggests a stop distance; type your own stop and this is ignored.")
      .addText((text) => {
        text.inputEl.type = "number";
        freeNumeric(text.inputEl);
        text.setValue(String(this.plugin.settings.defaultRisk ?? 0)).onChange(async (v) => {
          const n = Number(v);
          this.plugin.settings.defaultRisk = Number.isFinite(n) && n >= 0 ? n : 0;
          await this.plugin.saveSettings();
        });
      });

    // "Risk by symbol" is deliberately NOT here: it is an import-time gap
    // filler, not something a new trade uses, so it lives in Advanced with the
    // rest of the repair tools.
  }

  /**
   * An optional default symbol. Off by default: a toggle reveals a dropdown of
   * the contracts we know, and turning it off clears the pre-fill.
   */
  private renderDefaultSymbol(containerEl: HTMLElement): void {
    const s = this.plugin.settings;
    const contracts: string[] = [];
    for (const inst of CORE_INSTRUMENTS) for (const sym of [inst.mini, inst.micro]) contracts.push(sym);
    this.settingRow(containerEl, "tag", "Default symbol", "Pre-fill the contract on a new manual trade. You can change it per trade; turning this off clears the pre-fill.")
      .addToggle((tg) => {
        tg.setValue(!!s.defaultSymbol).onChange(async (v) => {
          s.defaultSymbol = v ? contracts[0] : "";
          await this.plugin.saveSettings();
          this.display();
        });
      });
    if (s.defaultSymbol) {
      this.select(
        this.settingRow(containerEl, "list", "Contract", "The contract every new trade starts on."),
        contracts.map((sym) => ({ id: sym, label: contractLabel(sym) })),
        s.defaultSymbol || contracts[0],
        async (v) => {
          s.defaultSymbol = v;
          await this.plugin.saveSettings();
        }
      );
    }
  }

  /**
   * A risk per contract, for the trades an import cannot show a stop for.
   *
   * One grid for the page, not a stack of blocks: a family is a quiet subhead,
   * the mini and the micro are two rows under it, and the numbers sit in two
   * columns that never move. A row with no rule is one line — there is no
   * permanent "no rule" line under every empty contract, so the weight of the
   * editor is what the trader actually wrote and nothing else.
   *
   * The mini and the micro stay two rows on purpose: ten points is not the same
   * money on an NQ and on an MNQ, so a rule that means "10 points" has to say
   * which contract it is about. Dollars are the size-blind way to write it —
   * $200 is $200 on one NQ or on ten MNQ — and the row shows what that came out
   * as in points, so nothing about the trade stays hidden.
   *
   * Nothing is applied here: these rules run on import, and only where the file
   * holds no stop of its own.
   */
  private renderDefaultRisk(containerEl: HTMLElement, onChanged: () => void): void {
    const money = this.plugin.settings.currency || "$";
    // Read through the live settings, never through a captured copy: after a
    // write the row repaints itself, and a closed-over object would keep showing
    // the rule it had when the pane opened.
    const ruleNow = (sym: string): RiskRule | undefined => this.plugin.settings.defaultRiskBySymbol?.[sym];
    // Every control this editor writes, so "clear" can empty them in place
    // instead of repainting the page (a repaint would fold the tool shut).
    const fields = new Map<string, { points: HTMLInputElement; dollars: HTMLInputElement }>();

    let summary: HTMLElement;
    let foot: HTMLElement;
    const setCountNow = (): number => CORE_SYMBOLS.filter((s) => ruleNow(s)).length;
    const paintSummary = (): void => {
      const n = setCountNow();
      // The count already sits on the closed row, and every rule states itself
      // under its own contract — so this line only has anything to add while
      // nothing is set: it says what then happens to the trade.
      summary.setText("Nothing set — a trade that arrives with no stop is recorded with no risk.");
      summary.toggleClass("is-hidden", n > 0);
      // The way back is a repair row, not a feature: it exists only once there
      // is something to undo, and it is never given a box of its own.
      foot.empty();
      foot.toggleClass("is-hidden", n === 0);
      if (!n) return;
      const clear = foot.createEl("button", { cls: "tj-set-linkbtn", text: "Clear every assumption", attr: { type: "button" } });
      const wipe = async (): Promise<void> => {
        this.plugin.settings.defaultRiskBySymbol = {};
        await this.plugin.saveSettings();
        for (const f of fields.values()) {
          f.points.value = "";
          f.dollars.value = "";
        }
        paintSummary();
        onChanged();
      };
      clear.addEventListener("click", () => {
        if (window.confirm(`Remove all ${n} assumptions? Imports without a stop go back to being recorded with no risk.`)) void wipe();
      });
    };
    // The verdict line opens the editor; the clear action is drawn under the
    // twelve rows it undoes, once both exist.
    summary = containerEl.createEl("p", { cls: "tj-set-note tj-set-summary" });

    // One legend for the whole grid: the column titles never repeat per family,
    // so a family can be a single quiet line.
    const legend = containerEl.createDiv({ cls: "tj-set-riskgrid is-legend" });
    legend.createSpan({ text: "Contract" });
    legend.createSpan({ text: "Points from entry" });
    legend.createSpan({ text: "Money per trade" });

    for (const instrument of CORE_INSTRUMENTS) {
      const family = containerEl.createDiv({ cls: "tj-set-riskfam" });
      family.createSpan({ cls: "tj-set-riskfam-name", text: instrument.label });
      family.createSpan({ cls: "tj-set-riskfam-pair", text: `${instrument.mini} / ${instrument.micro}` });
      for (const symbol of [instrument.mini, instrument.micro]) {
        const spec = futuresSpec(symbol);
        const row = containerEl.createDiv({ cls: "tj-set-riskrow" });
        const name = row.createDiv({ cls: "tj-set-riskname" });
        name.createSpan({ cls: "tj-set-risksym", text: contractLabel(symbol) });
        // The result line exists only once there is a result to state.
        const hint = name.createSpan({ cls: "tj-set-riskhint is-hidden" });
        const paint = (): void => {
          const rule = ruleNow(symbol);
          if (rule?.points) hint.setText(`${rule.points} pt from entry · ${money}${round2(rule.points * spec.pointValue)} a contract`);
          else if (rule?.dollars) hint.setText(`${money}${round2(rule.dollars)} a trade`);
          else hint.setText("");
          hint.toggleClass("is-hidden", !rule?.points && !rule?.dollars);
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
          paintSummary();
          onChanged();
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
          attr: { placeholder: `${money} per trade`, "aria-label": `Default risk in ${money} per trade for ${symbol}` },
        });
        freeNumeric(dollars);
        dollars.value = ruleNow(symbol)?.dollars ? String(ruleNow(symbol)?.dollars) : "";
        dollars.addEventListener("change", () => void write("dollars", dollars.value));
        fields.set(symbol, { points, dollars });
        paint();
      }
    }

    foot = containerEl.createDiv({ cls: "tj-set-toolfoot is-hidden" });
    paintSummary();
  }

  // ------------------------------------------------------------- Review

  renderReview(containerEl: HTMLElement): void {
    this.groupLabel(containerEl, "Psychology");
    this.select(
      this.settingRow(containerEl, "timer-reset", "Re-entry window", "A trade opened within this many minutes of a losing exit on the same symbol reads as a re-entry after a loss. A heuristic, not a rule."),
      [5, 10, 15, 30, 60].map((minutes) => ({ id: String(minutes), label: `${minutes} minutes` })),
      String(this.plugin.settings.reentryWindowMinutes ?? 15),
      async (v) => {
        this.plugin.settings.reentryWindowMinutes = Number(v);
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      }
    );
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

  // ------------------------------------------------------------- Imports

  /**
   * The import-only tools. Everything here shapes how a broker's CSV is read —
   * assumptions for a missing stop, and the account matching/repair path — and
   * nothing here is normal account configuration. A trader who never imports by
   * hand never needs to open this page.
   *
   * Closed, the page is two rows and a state: each tool says what it is for and
   * what is currently in it, so "do I need this?" is answered without opening
   * anything. Open, there is exactly ONE editor on screen — the two tools are
   * separate jobs, and showing both at once is what made this page the densest
   * and most technical in Settings.
   */
  renderImports(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      cls: "tj-set-note tj-set-lead",
      text: "Neither tool changes a trade you already have.",
    });

    const tools: { btn: HTMLElement; panel: HTMLElement }[] = [];
    /** One tool at a time: opening one closes the other, -1 closes both. */
    const show = (index: number): void => {
      tools.forEach((tool, i) => {
        const open = i === index;
        tool.panel.toggleClass("is-hidden", !open);
        tool.btn.setAttr("aria-expanded", String(open));
        tool.btn.toggleClass("is-open", open);
      });
    };
    /** The row is the whole control: pressing an open tool closes it again. */
    const toggle = (index: number): void => {
      show(tools[index].panel.hasClass("is-hidden") ? index : -1);
    };

    this.groupLabel(containerEl, "Import assumptions");
    const risk = this.toolRow(containerEl, {
      icon: "sliders-horizontal",
      title: "Risk by symbol",
      sub: "Used only when an imported trade has no stop of its own.",
    });
    tools.push(risk);
    const paintRiskState = (): void => {
      const rules = this.plugin.settings.defaultRiskBySymbol || {};
      const n = CORE_SYMBOLS.filter((sym) => rules[sym]).length;
      risk.state.setText(n ? `${n} of ${CORE_SYMBOLS.length} set` : "Not set");
      risk.state.toggleClass("is-set", n > 0);
    };
    risk.panel.createEl("p", {
      cls: "tj-set-note",
      text: "Used as an assumption only, and the trade is marked as assumed so you can always see it was not in the file. One rule per contract: points or money, never both.",
    });
    this.renderDefaultRisk(risk.panel, paintRiskState);
    paintRiskState();
    risk.btn.addEventListener("click", () => toggle(tools.indexOf(risk)));

    this.groupLabel(containerEl, "Account matching & repair");
    const match = this.toolRow(containerEl, {
      icon: "link",
      title: "Which account a name belongs to",
      sub: "Only needed when an import lands on the wrong account, or its name is unreadable.",
    });
    tools.push(match);
    const paintMatchState = (): void => {
      const n = Object.keys(this.plugin.settings.accountMappings || {}).length;
      match.state.setText(n ? `${n} ${n === 1 ? "name" : "names"} bound` : "Automatic");
      match.state.toggleClass("is-set", n > 0);
    };
    void this.renderMatchTools(match.panel, paintMatchState);
    paintMatchState();
    match.btn.addEventListener("click", () => toggle(tools.indexOf(match)));
  }

  /**
   * One import tool, folded by default: icon, name, one line of what it is for,
   * and the current state in the value slot on the right.
   *
   * The row is a normal settings row inside a card — same padding, icon column,
   * hierarchy and right-hand measure — so this page reads as part of the same
   * system as General. No badge: the row already says it is interactive, and a
   * filled capsule on each row would make this the loudest page in Settings for
   * its least-used tools.
   */
  private toolRow(
    containerEl: HTMLElement,
    o: { icon: string; title: string; sub: string }
  ): { btn: HTMLElement; panel: HTMLElement; state: HTMLElement } {
    const box = containerEl.createDiv({ cls: "tj-set-disclosure" });
    const btn = box.createEl("button", {
      cls: "tj-set-disclosure-btn",
      attr: { type: "button", "aria-expanded": "false" },
    });
    const icon = btn.createDiv({ cls: "tj-set-opt-icon" });
    setIcon(icon, o.icon);
    const left = btn.createDiv({ cls: "tj-set-disclosure-left" });
    left.createSpan({ cls: "tj-set-disclosure-title", text: o.title });
    left.createSpan({ cls: "tj-set-disclosure-sub", text: o.sub });
    const state = btn.createSpan({ cls: "tj-set-state" });
    const chev = btn.createSpan({ cls: "tj-set-disclosure-chev", attr: { "aria-hidden": "true" } });
    setIcon(chev, "chevron-down");
    const panel = box.createDiv({ cls: "tj-set-disclosure-panel is-hidden" });
    return { btn, panel, state };
  }

  /**
   * The repair editor: which account a name belongs to, then how the words in a
   * name are read. Binding comes first because it is the common repair —
   * classification is the fallback for when the name itself is misleading.
   */
  private async renderMatchTools(host: HTMLElement, onChanged: () => void): Promise<void> {
    await this.renderAccountMapping(host, onChanged);
    this.renderImportClassification(host);
  }

  /**
   * Broker account names seen in trades, each bindable to a real account.
   *
   * Two lists, because they are two different things: the names the trader bound
   * on purpose (still editable), and the names the rules already decided (facts,
   * and shown as facts). A picker on every row made a dozen resolved names look
   * like a dozen unanswered questions.
   */
  private async renderAccountMapping(host: HTMLElement, onChanged: () => void): Promise<void> {
    const s = this.plugin.settings;
    host.createDiv({ cls: "tj-set-subhead", text: "The names your imports arrive under" });
    host.createEl("p", {
      cls: "tj-set-note",
      text: "Your broker may send trades under a name that is not one of your accounts — after a rename, or when several accounts are merged into one name. Bind the name once, and its trades count under the right account.",
    });

    const trades = await this.plugin.loadTrades();
    const names = [...new Set(trades.map((t) => t.account).filter((a) => !!a))].sort();
    if (!names.length) {
      host.createDiv({ cls: "tj-hint", text: "No account names in your trades yet — import a file or add a trade first." });
      return;
    }
    const accounts = s.propAccounts;
    if (!accounts.length) {
      host.createDiv({ cls: "tj-hint", text: "No Tradebook accounts yet, so there is nothing to bind a name to. Set one up first." });
      return;
    }

    const items: DropdownItem[] = [
      { id: "", label: "Decide by the rules", note: "the name's own keywords pick" },
      ...accounts.map((acc) => ({ id: acc.id, label: acc.name, note: typeLabel(acc.type) })),
    ];
    const write = async (name: string, id: string): Promise<void> => {
      if (id) s.accountMappings[name] = id;
      else delete s.accountMappings[name];
      await this.plugin.saveSettings();
      await this.plugin.reloadAllViews();
    };
    const applyBind = async (name: string, id: string): Promise<void> => {
      if (!id) return;
      await write(name, id);
      paint();
      onChanged();
    };
    const bind = (row: HTMLElement, name: string): void => {
      mountDropdown(
        row,
        items,
        "",
        (id) => void applyBind(name, id),
        { title: "Which account this name means", align: "right", side: "above", size: "sm", block: true }
      );
    };

    // Only this list repaints, so the keyword editor below it survives a binding.
    const list = host.createDiv({ cls: "tj-set-maplist" });
    const paint = (): void => {
      list.empty();
      const mapped = (n: string): ReturnType<typeof this.plugin.mappedAccount> => this.plugin.mappedAccount(n);
      const bound = names.filter((n) => !!mapped(n));
      const auto = names.filter((n) => !mapped(n));

      const row = (name: string, isBound: boolean): void => {
        const target = mapped(name);
        const r = list.createDiv({ cls: "tj-set-maprow" });
        const nameBox = r.createDiv({ cls: "tj-set-mapname" });
        nameBox.createDiv({ cls: "tj-set-maplabel", text: name });
        const meta = nameBox.createDiv({ cls: "tj-set-mapmeta" });
        if (target) {
          meta.createSpan({ text: `Bound to ${target.name}` });
          const kind = meta.createSpan({ cls: "tj-set-maptype", text: typeLabel(target.type) });
          kind.style.color = typeColor(target.type);
        } else {
          const verdict = this.plugin.resolveAccountType(name);
          const kind = meta.createSpan({
            cls: "tj-set-maptype" + (verdict === "unknown" ? " is-unread" : ""),
            text: verdict === "unknown" ? "No keyword matched" : `Read as ${typeLabel(verdict)}`,
          });
          if (verdict !== "unknown") kind.style.color = typeColor(verdict);
        }
        if (isBound) {
          mountDropdown(r, items, target?.id ?? "", (id) => void applyBind(name, id), {
            title: "Which account this name means",
            align: "right",
            side: "above",
            size: "sm",
            block: true,
          });
          return;
        }
        // A plain action, not another filled control on a row of facts.
        const action = r.createEl("button", { cls: "tj-set-linkbtn", text: "Bind…", attr: { type: "button" } });
        action.addEventListener("click", () => {
          action.remove();
          bind(r, name);
        });
      };

      if (bound.length) {
        list.createDiv({ cls: "tj-set-microhead", text: "Bound by you" });
        for (const name of bound) row(name, true);
      }
      if (auto.length) {
        list.createDiv({ cls: "tj-set-microhead", text: "Decided by the rules" });
        for (const name of auto) row(name, false);
      }
    };
    paint();
  }

  /** Keywords that sort a broker's account name into a type. First match wins. */
  private renderImportClassification(host: HTMLElement): void {
    const s = this.plugin.settings;
    host.createDiv({ cls: "tj-set-subhead", text: "How a name's type is read" });
    host.createEl("p", {
      cls: "tj-set-note",
      text: "The words that sort a name into a type. The first match wins, so only the words your broker really uses need to be here.",
    });
    const box = host.createDiv({ cls: "tj-set-kwgroup" });
    const inputs = new Map<string, HTMLInputElement>();
    for (const rule of this.plugin.getAccountRules()) {
      const rrow = box.createDiv({ cls: "tj-set-kwrow" });
      rrow.createSpan({ cls: "tj-set-kwtype", text: typeLabel(rule.type) });
      const input = rrow.createEl("input", {
        cls: "tj-set-kwinput",
        attr: { type: "text", value: rule.keywords.join(", ") },
      });
      inputs.set(rule.type, input);
      input.addEventListener("change", async () => {
        const keywords = input.value.split(",").map((x) => x.trim()).filter(Boolean);
        if (!s.accountRules.length) {
          s.accountRules = DEFAULT_ACCOUNT_RULES.map((x) => ({ type: x.type, keywords: [...x.keywords] }));
        }
        const target = s.accountRules.find((x) => x.type === rule.type);
        if (target) target.keywords = keywords;
        await this.plugin.saveSettings();
        await this.plugin.reloadAllViews();
      });
    }
    // The way back — and an empty list already means "the defaults", so this
    // only has to hand the editor its original words.
    const foot = host.createDiv({ cls: "tj-set-toolfoot" });
    const restore = foot.createEl("button", { cls: "tj-set-linkbtn", text: "Restore the default keywords", attr: { type: "button" } });
    const resetKeywords = async (): Promise<void> => {
      s.accountRules = [];
      await this.plugin.saveSettings();
      await this.plugin.reloadAllViews();
      for (const rule of DEFAULT_ACCOUNT_RULES) {
        const input = inputs.get(rule.type);
        if (input) input.value = rule.keywords.join(", ");
      }
    };
    restore.addEventListener("click", () => void resetKeywords());
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
    this.settingRow(containerEl, "refresh-cw", "Rebuild trade index", "Re-reads every trade note from scratch. Slower on a big journal, and the fix when a note was edited outside Tradebook.").addButton((b) =>
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
    this.settingRow(containerEl, "upload", "Import a backup", "Shows what is inside the file before anything changes. Your current settings are saved as a safety copy first.").addButton((b) =>
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
    input.setCssStyles({ display: "none" });
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
