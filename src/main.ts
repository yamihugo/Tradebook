import { App, Notice, Plugin, PluginManifest, TFile, normalizePath } from "obsidian";
import { AccountRule, DEFAULT_ACCOUNT_RULES, classifyAccount } from "./futures";
import { PropAccount, AccountGroup, Trade, Payout } from "./types";
import { saveTrade, parseTradeFromMarkdown, deleteTradeFile } from "./storage";
import { SettingsTab } from "./settings";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./views/dashboard";
import type { DashItem } from "./views/dashboard";
import { CalendarView, CALENDAR_VIEW_TYPE } from "./views/calendar";
import { AccountDashboardView, ACCOUNT_DASH_VIEW_TYPE } from "./views/accountDashboard";
import { AddTradeView, ADD_TRADE_VIEW_TYPE } from "./views/addTradeView";
import { ImportView, IMPORT_VIEW_TYPE } from "./views/importView";
import { TradeLogView, TRADE_LOG_VIEW_TYPE } from "./views/tradeLogView";
import { AccountsListView, ACCOUNTS_LIST_VIEW_TYPE } from "./views/accountsListView";
import { TradeDetailView, TRADE_DETAIL_VIEW_TYPE } from "./views/tradeDetailView";
import { TradingJournalSidebarView, TRADING_JOURNAL_SIDEBAR_VIEW_TYPE } from "./views/sidebarView";
import { AddTradesModal } from "./addTradeModal";
import { openTradeModal } from "./views/tradeModal";

export interface TradingJournalSettings {
  tradesFolder: string;
  journalName: string;
  dashboardTitle: string;
  dashboardLayout: DashItem[];
  accountRules: AccountRule[];
  timeZone: string;
  propAccounts: PropAccount[];
  accountGroups: AccountGroup[];
  archivedAccounts: PropAccount[];
  payouts: Payout[];
  accountMappings: Record<string, string>;
  recentLimit: number;
}

const DEFAULT_SETTINGS: TradingJournalSettings = {
  tradesFolder: "Trading Journal/trades",
  journalName: "",
  dashboardTitle: "",
  dashboardLayout: [],
  accountRules: [],
  timeZone: "Europe/Lisbon",
  propAccounts: [],
  accountGroups: [],
  archivedAccounts: [],
  payouts: [],
  accountMappings: {},
  recentLimit: 20,
};

const ALL_VIEW_TYPES = [
  DASHBOARD_VIEW_TYPE,
  CALENDAR_VIEW_TYPE,
  ACCOUNT_DASH_VIEW_TYPE,
  ACCOUNTS_LIST_VIEW_TYPE,
  ADD_TRADE_VIEW_TYPE,
  IMPORT_VIEW_TYPE,
  TRADE_LOG_VIEW_TYPE,
  TRADE_DETAIL_VIEW_TYPE,
  TRADING_JOURNAL_SIDEBAR_VIEW_TYPE,
];

export default class TradingJournalPlugin extends Plugin {
  settings: TradingJournalSettings;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    await this.loadSettings();

    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.registerView(CALENDAR_VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.registerView(ACCOUNT_DASH_VIEW_TYPE, (leaf) => new AccountDashboardView(leaf, this));
    this.registerView(ADD_TRADE_VIEW_TYPE, (leaf) => new AddTradeView(leaf, this));
    this.registerView(IMPORT_VIEW_TYPE, (leaf) => new ImportView(leaf, this));
    this.registerView(TRADE_LOG_VIEW_TYPE, (leaf) => new TradeLogView(leaf, this));
    this.registerView(ACCOUNTS_LIST_VIEW_TYPE, (leaf) => new AccountsListView(leaf, this));
    this.registerView(TRADE_DETAIL_VIEW_TYPE, (leaf) => new TradeDetailView(leaf, this));
    this.registerView(TRADING_JOURNAL_SIDEBAR_VIEW_TYPE, (leaf) => new TradingJournalSidebarView(leaf, this));

    this.addRibbonIcon("grip", "Trading Journal — Home", () => {
      this.openDashboard();
    });
    this.addRibbonIcon("calendar-days", "Trading Journal — Calendar", () => {
      this.openCalendar();
    });
    this.addRibbonIcon("wallet", "Trading Journal — Accounts", () => {
      this.openAccounts();
    });
    this.addRibbonIcon("list", "Trading Journal — Trade Log", () => {
      this.openTradeLog();
    });
    this.addRibbonIcon("plus", "Trading Journal — Add Trade", () => {
      this.openAddPanel();
    });
    this.addRibbonIcon("upload", "Trading Journal — Import CSV", () => {
      this.openImport();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open Trading Dashboard",
      callback: () => this.openDashboard(),
    });
    this.addCommand({
      id: "open-calendar",
      name: "Open Trading Calendar",
      callback: () => this.openCalendar(),
    });
    this.addCommand({
      id: "open-accounts",
      name: "Open Accounts",
      callback: () => this.openAccounts(),
    });
    this.addCommand({
      id: "open-trade-log",
      name: "Open Trade Log",
      callback: () => this.openTradeLog(),
    });
    this.addCommand({
      id: "add-trade",
      name: "Add Trade",
      callback: () => this.openAddPanel(),
    });

    this.addCommand({
      id: "open-sidebar-menu",
      name: "Open Trading Journal Menu (left sidebar)",
      callback: () => this.openSidebarView(),
    });

    this.addSettingTab(new SettingsTab(this.app, this));
    // Workspace APIs are optional — some mock/host environments may lack them.
    if (typeof (this.app.workspace as any).onLayoutReady === "function") {
      (this.app.workspace as any).onLayoutReady(async () => {
        if (this.app.workspace.getLeavesOfType(TRADING_JOURNAL_SIDEBAR_VIEW_TYPE).length === 0) {
          const leftLeaf = (this.app.workspace as any).getLeftLeaf?.(false);
          if (leftLeaf) {
            await leftLeaf.setViewState({ type: TRADING_JOURNAL_SIDEBAR_VIEW_TYPE, active: true });
          }
        }
      });
    }
  }

  onunload() {}

  private _journalLeaf: any = null;
  private _celebrationDismissed = new Set<string>();

  /** Marks an eval account's "passed" celebration as dismissed for this session. */
  markCelebrationDismissed(accountId: string): void {
    this._celebrationDismissed.add(accountId);
  }

  isCelebrationDismissed(accountId: string): boolean {
    return this._celebrationDismissed.has(accountId);
  }

  /** Same central page: keeps all journal views in the SAME leaf in the MAIN
   *  workspace (never the right/left side panels), so nothing opens beside it
   *  or in an Obsidian dock. Falls back to the current main leaf only if the
   *  remembered one is gone. */
  getJournalLeaf(): any {
    const inMainArea = (leaf: any): boolean => {
      try {
        if (!leaf) return false;
        if (typeof leaf.getRoot === "function") {
          const root = leaf.getRoot();
          const main = this.app.workspace.rootSplit;
          return !!root && !!main && root === main;
        }
        // Fallback for mocks: assume a leaf with a contentEl is ok.
        return !!leaf.contentEl;
      } catch {
        return false;
      }
    };
    if (this._journalLeaf && !this._journalLeaf.detached && inMainArea(this._journalLeaf)) return this._journalLeaf;
    // Prefer an existing journal leaf in the main workspace.
    for (const vt of ALL_VIEW_TYPES) {
      const leaves = this.app.workspace.getLeavesOfType(vt).filter(inMainArea);
      if (leaves.length) {
        this._journalLeaf = leaves[0];
        return leaves[0];
      }
    }
    const active = this.app.workspace.getLeaf(false);
    if (inMainArea(active)) {
      this._journalLeaf = active;
      return active;
    }
    // The active leaf is a side panel — create a fresh leaf in the main split.
    const mainLeaf = this.app.workspace.getLeaf(true);
    this._journalLeaf = mainLeaf;
    return mainLeaf;
  }

  async activateView(viewType: string) {
    const leaf = this.getJournalLeaf();
    await leaf.setViewState({ type: viewType, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openDashboard(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(target);
  }

  async openCalendar(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(target);
  }

  async openAccounts(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: ACCOUNTS_LIST_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(target);
  }

  async openTradeLog(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: TRADE_LOG_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(target);
  }

  async openImport(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: IMPORT_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(target);
  }

  /** Opens the Trade Log pre-filtered to a single day (used by Calendar). */
  async openTradeLogForDay(dateKey: string) {
    await this.openTradeLog();
    const leaves = this.app.workspace.getLeavesOfType(TRADE_LOG_VIEW_TYPE);
    const view = leaves.length ? leaves[0].view : null;
    if (view && typeof (view as any).filterByDay === "function") {
      (view as any).filterByDay(dateKey);
    }
  }

  async openAccountDashboard(leaf: any, accountId: string) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: ACCOUNT_DASH_VIEW_TYPE, state: { accountId }, active: true });
    this.app.workspace.revealLeaf(target);
  }

  async openTradeModal(trade: { id: string }) {
    const trades = await this.loadTrades();
    const full = trades.find((t) => t.id === trade.id) ?? (trade as any);
    openTradeModal(this, full);
  }

  /** Opens/reveals the Trading Journal menu in Obsidian's LEFT sidebar.
   *  It appears as a tab in the sidebar top bar (like Files/Search/Bookmarks),
   *  so the user can switch between the file tree and our menu natively. */
  async openSidebarView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(TRADING_JOURNAL_SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leftLeaf = (this.app.workspace as any).getLeftLeaf?.(false);
    if (!leftLeaf) return;
    await leftLeaf.setViewState({ type: TRADING_JOURNAL_SIDEBAR_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leftLeaf);
  }

  async openTradeDetail(trade: { id: string }) {
    const trades = await this.loadTrades();
    const full = trades.find((t) => t.id === trade.id) ?? (trade as any);
    const target = this.getJournalLeaf();
    await target.setViewState({ type: TRADE_DETAIL_VIEW_TYPE, state: { tradeId: full.id }, active: true });
    this.app.workspace.revealLeaf(target);
    const leaves = this.app.workspace.getLeavesOfType(TRADE_DETAIL_VIEW_TYPE);
    const view = leaves.length ? leaves[0].view : null;
    if (view && typeof (view as any).setTrade === "function") {
      await (view as any).setTrade(full);
    }
  }

  async openAddPanel() {
    const modal = new AddTradesModal(this.app, this);
    modal.open();
  }

  getTradesFolder(): string {
    return normalizePath(this.settings.tradesFolder || "Trading Journal/trades");
  }

  getDashboardTitle(): string {
    return (
      this.settings.dashboardTitle ||
      `${this.settings.journalName || "Your name"} Trading Dashboard`
    );
  }

  getAccountRules(): AccountRule[] {
    return this.settings.accountRules.length
      ? this.settings.accountRules
      : DEFAULT_ACCOUNT_RULES.map((r) => ({ type: r.type, keywords: [...r.keywords] }));
  }

  resolveAccountType(account: string): Trade["accountType"] {
    return classifyAccount(account, this.getAccountRules());
  }

  mappedAccount(name: string): PropAccount | null {
    const id = this.settings.accountMappings?.[name];
    if (!id) return null;
    return this.settings.propAccounts.find((a) => a.id === id) ?? null;
  }

  /** The first configured account. */
  getPrimaryAccount(): PropAccount | undefined {
    const accounts = this.settings.propAccounts || [];
    return accounts.length > 0 ? accounts[0] : undefined;
  }

  /** Load all trade notes from the configured folder into Trade objects. */
  async loadTrades(): Promise<Trade[]> {
    const folder = this.getTradesFolder();
    const base = this.app.vault.getAbstractFileByPath(folder);
    const trades: Trade[] = [];
    if (base instanceof TFile) {
      const content = await this.app.vault.cachedRead(base);
      const partial = parseTradeFromMarkdown(content);
      if (partial.date && partial.symbol) {
        const t = partial as Trade;
        t.accountType = classifyAccount(t.account, this.getAccountRules());
        trades.push({ ...t, id: base.path });
      }
      return trades;
    }

    const files = this.app.vault.getFiles().filter(
      (f) => f.path.startsWith(folder + "/") && f.extension === "md"
    );
    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      const partial = parseTradeFromMarkdown(content);
      if (partial.date && partial.symbol && typeof partial.pnl === "number") {
        const t = partial as Trade;
        // Always re-classify on read so stored labels stay in sync with the
        // (possibly edited) account rules in settings.
        t.accountType = classifyAccount(t.account, this.getAccountRules());
        trades.push({ ...t, id: f.path } as Trade);
      }
    }
    return trades;
  }

  async ensureFolder(): Promise<void> {
    const folder = this.getTradesFolder();
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(normalizePath(folder));
    }
  }

  async storeTrades(trades: Trade[]): Promise<number> {
    await this.ensureFolder();
    let created = 0;
    for (const t of trades) {
      const saved = await saveTrade(this.app, this.getTradesFolder(), t);
      if (saved) created++;
    }
    await this.reloadAllViews();
    return created;
  }

  /** Copy trades onto the given prop accounts (broadcast). Returns the full list to save. */
  async applyBroadcast(trades: Trade[], accountIds: string[]): Promise<Trade[]> {
    if (!accountIds || accountIds.length === 0) return trades;
    const out: Trade[] = [];
    for (const t of trades) {
      out.push(t);
      for (const id of accountIds) {
        const acc = this.settings.propAccounts.find((a) => a.id === id);
        if (!acc) continue;
        const copy: Trade = {
          ...t,
          id: "",
          account: acc.name,
          accountType: acc.type,
        };
        out.push(copy);
      }
    }
    return out;
  }

  async reloadAllViews() {
    for (const type of ALL_VIEW_TYPES) {
      const leaves = this.app.workspace.getLeavesOfType(type);
      for (const leaf of leaves) {
        const view = leaf.view as any;
        try {
          if (typeof view.refresh === "function") await view.refresh();
          else if (typeof view.render === "function") view.render();
        } catch (err) {
          console.error(`[trading-journal] refresh ${type} failed:`, err);
        }
      }
    }
  }

  payoutsFor(accountId: string): Payout[] {
    return (this.settings.payouts || []).filter((p) => p.accountId === accountId).sort((a, b) => a.date.localeCompare(b.date));
  }

  accountPayoutsTotal(accountId: string): number {
    return this.payoutsFor(accountId).filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  }

  async registerPayout(accountId: string, date: string, amount: number, status: "requested" | "paid" = "paid", note?: string): Promise<void> {
    this.settings.payouts = this.settings.payouts || [];
    this.settings.payouts.push({
      id: "pay_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      accountId,
      date,
      amount,
      status,
      note,
    });
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async removePayout(payoutId: string): Promise<void> {
    this.settings.payouts = (this.settings.payouts || []).filter((p) => p.id !== payoutId);
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async deleteTrade(tradeId: string): Promise<boolean> {
    const success = await deleteTradeFile(this.app, tradeId);
    if (success) {
      new Notice("Trade note deleted.");
      await this.reloadAllViews();
    } else {
      new Notice("Could not delete trade note.");
    }
    return success;
  }

  async upgradeAccountToFunded(evalAccountId: string, action: "archive" | "delete" | "keep"): Promise<string> {
    const evalAcc = this.settings.propAccounts.find((a) => a.id === evalAccountId);
    if (!evalAcc) return "";
    // If this eval already produced a funded account, reuse it instead of duplicating.
    if (evalAcc.linkedFundedId) {
      const existing = this.settings.propAccounts.find((a) => a.id === evalAcc.linkedFundedId);
      if (existing) {
        if (action === "archive") {
          this.settings.archivedAccounts = this.settings.archivedAccounts || [];
          if (!this.settings.archivedAccounts.some((a) => a.id === evalAcc.id)) {
            this.settings.archivedAccounts.push({ ...evalAcc, linkedFundedId: existing.id });
          }
          this.settings.propAccounts = this.settings.propAccounts.filter((a) => a.id !== evalAccountId);
        }
        await this.saveSettings();
        await this.reloadAllViews();
        return existing.id;
      }
    }

    const newId = "pa_" + Date.now();
    const fundedName = evalAcc.name.replace(/eval|evaluation/gi, "").trim() + " Funded";
    // Bidirectional link: eval remembers its funded counterpart, funded remembers its origin eval.
    evalAcc.linkedFundedId = newId;
    const fundedAcc: PropAccount = {
      id: newId,
      name: fundedName || "Funded Account",
      firmId: evalAcc.firmId,
      programId: evalAcc.programId,
      size: evalAcc.size,
      type: "funded",
      linkedEvalId: evalAcc.id,
    };
    if (action === "archive") {
      this.settings.archivedAccounts = this.settings.archivedAccounts || [];
      this.settings.archivedAccounts.push(evalAcc);
    }
    if (action !== "keep") {
      this.settings.propAccounts = this.settings.propAccounts.filter((a) => a.id !== evalAccountId);
    }
    this.settings.propAccounts.push(fundedAcc);
    await this.saveSettings();
    await this.reloadAllViews();
    return newId;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const migrateAcc = (acc: any) => {
      if (!acc.type) {
        if (acc.live) acc.type = "personal";
        else if (acc.scope && acc.scope !== "all") acc.type = acc.scope;
        else acc.type = "eval";
      }
      delete acc.scope;
      delete acc.live;
    };
    for (const acc of this.settings.propAccounts || []) migrateAcc(acc);
    for (const acc of this.settings.archivedAccounts || []) migrateAcc(acc);
    delete (this.settings as any).primaryAccountId;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
