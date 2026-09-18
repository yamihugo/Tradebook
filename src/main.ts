import { App, Notice, Plugin, PluginManifest, TFile, normalizePath } from "obsidian";
import { AccountRule, DEFAULT_ACCOUNT_RULES, classifyAccount, futuresSpec } from "./futures";
import { PropAccount, AccountGroup, Trade, Payout, Deposit, AccountType } from "./types";
import { saveTrade, parseTradeFromMarkdown, deleteTradeFile, tradeFilename, setTradeAccount, setTradeFields, updateTradeFields } from "./storage";
import { computeAccountMetrics, computeDrawdownEpisodes } from "./lib/accountMetrics";
import { PROP_FIRMS, effectiveSize, getFirm, getProgram, getSize, makeAccount, uniqueAccountName } from "./props";
import {
  buildLeg,
  crossSymbol,
  effectiveCopyConfig,
  expandVirtualLegs,
  isActiveCopier,
  isLeg,
  isVirtualLeg,
  legBaseKey,
  membersForBase as copyMembersForBase,
  uniqueTrades,
} from "./lib/copy";
import { analyticsTrades, AnalyticsScope } from "./lib/scope";
import {
  BackupNote,
  BackupPayload,
  backupFilename,
  buildBackup,
} from "./lib/backup";
import { setTypePrefs } from "./lib/accountTypes";
import {
  ActiveAccounts,
  computeMaturity,
  Experience,
  Journaling,
  MaturityInput,
  MaturityScore,
  Phase,
} from "./lib/maturity";
import { SettingsTab } from "./settings";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./views/dashboard";
import type { DashItem } from "./views/dashboard";
import { AccountDashboardView, ACCOUNT_DASH_VIEW_TYPE } from "./views/accountDashboard";
import { AddTradeView, ADD_TRADE_VIEW_TYPE } from "./views/addTradeView";
import { TradeLogView, TRADE_LOG_VIEW_TYPE } from "./views/tradeLogView";
import { AccountsListView, ACCOUNTS_LIST_VIEW_TYPE } from "./views/accountsListView";
import { TradeDetailView, TRADE_DETAIL_VIEW_TYPE } from "./views/tradeDetailView";
import { TradebookSidebarView, TRADEBOOK_SIDEBAR_VIEW_TYPE } from "./views/sidebarView";
import { HomeView, HOME_VIEW_TYPE } from "./views/homeView";
import { SetupsView, SETUPS_VIEW_TYPE } from "./views/setupsView";
import { PrintQueueView, PRINT_QUEUE_VIEW_TYPE, QueuedPrint } from "./views/printQueueView";
import { openTradeModal } from "./views/tradeModal";
import { openGettingStarted } from "./views/gettingStarted";
import { buildDiagnostics, diagnosticsFilename } from "./lib/diagnostics";

export interface ThemeSettings {
  /** Chosen preset id (see themes.ts). */
  preset?: string;
  /** "default" = follow Obsidian theme; "dots" = dotted notebook background */
  background: "default" | "dots";
  /** Hex accent color ("" = Obsidian default) */
  accent: string;
  /** Hex dot color for the dotted background ("" = auto) */
  dotColor: string;
  /** Optional surface tint for our cards/panels ("" = theme default) */
  surface?: string;
  /** Optional journal background tint ("" = Obsidian background) */
  bg?: string;
  /** Second background colour (gradient pattern). */
  bg2?: string;
  /** Optional border tint for our cards ("" = theme default) */
  border?: string;
  /** Background pattern. */
  pattern?: "none" | "dots" | "grid" | "scanlines" | "stars" | "aurora" | "gradient";
  /** Typeface for the journal views. */
  font?: "sans" | "mono" | "serif";
  /** Neon glow on accent elements. */
  glow?: boolean;
}

export interface TradebookSettings {
  tradesFolder: string;
  journalName: string;
  dashboardTitle: string;
  dashboardLayout: DashItem[];
  /** Grid resolution the saved layout coordinates were written for. */
  gridCols: number;
  /** Master switch for UI animations (count-ups, transitions). */
  animations: boolean;
  /** Show the date axis under the P&L charts. */
  chartDates?: boolean;
  /** Trade Log view preferences (persisted so they survive reloads). */
  /** Breakdown metric: show P&L or win rate in the treemap. */
  accountBreakdownMetric?: "pnl" | "winrate";
  /** Which breakdown tab the account page last used. */
  accountBreakdownTab?: string;
  /** Which widgets the account page shows, in order (the Hero is always fixed). */
  accountWidgets?: string[];
  /** Copy-trading groups (base account + its copiers). */
  copyGroups?: import("./types").CopyGroup[];
  tradeLog?: {
    /**
     * Which columns the Trade Log shows. The order itself lives in
     * `tradeLogColOrder` and is shared with the trades table on an account page,
     * so the two ledgers can never drift apart.
     */
    colOrder?: string[];
    /**
     * Which column the ledger is sorted by. Null/absent means the plain list
     * (newest first) — a sort is a lens, not a setting you are stuck with.
     */
    sort?: { id: string; dir: "asc" | "desc" } | null;
    /** Active filters, persisted so a reload keeps the same view. */
    filters?: {
      symbol?: string;
      /** Older builds stored one account; read it once, then write the array. */
      account?: string;
      accounts?: string[];
      group?: string;
      type?: string;
      direction?: string;
      result?: string;
      /** Older builds stored one mistake/setup/tag; read it once, then write the arrays. */
      mistake?: string;
      mistakes?: string[];
      review?: string;
      session?: string;
      duration?: string;
      quality?: string | string[];
      period?: string;
      customFrom?: string;
      customTo?: string;
      search?: string;
      setup?: string;
      setups?: string[];
      tag?: string;
      tags?: string[];
      limit?: number;
    };
    /** How the Side column renders: arrows (▲/▼) or letters (LONG/SHORT). */
    sideDisplay?: "arrows" | "letters";
  };
  /** Ledger column order — shared by the Trade Log and an account's trades table. */
  tradeLogColOrder?: string[];
  /** Currency symbol shown next to monetary values. */
  currency?: string;
  /** Open the Home view automatically when the plugin loads. */
  openHomeOnStartup?: boolean;
  /** First-run tour: set once it is finished or skipped. */
  onboardingDone?: boolean;
  /** Where the tour was left, so reopening resumes instead of restarting. */
  onboardingStep?: number;
  /** How sidebar items open views. */
  tabBehavior?: "replace" | "new";
  /** Blur monetary values for screenshots/streams. */
  privacyMode?: boolean;
  /** Copy trading: count copy legs into "all accounts" analytics.
   *  false (default) = money sums all legs but counts/win-rate dedupe by trade. */
  includeCopiesInPortfolioAnalytics?: boolean;
  /** Portfolio totals (capital, P&L, growth, trades) ignore demo accounts.
   *  Demos stay visible and clickable — they just don't pollute the numbers. */
  excludeDemosFromPortfolio?: boolean;
  /** Accounts page: order of the cards inside each section. */
  accountsSort?: "name" | "balance" | "net" | "dd";
  /** Accounts page: which account types the list shows at all. */
  accountsVisibleTypes?: AccountType[];
  /** Accounts page: show the prop-firm logo in the corner of each card. */
  accountsShowLogo?: boolean;
  /** Accounts page: show the Archived box at the bottom (past evals). */
  accountsShowArchived?: boolean;
  /** Accounts page: the window the portfolio chart shows, remembered per page. */
  accountsChartPeriod?: "all" | "1y" | "6m" | "3m" | "1m";
  /** Accounts page: what each account type is called (Manage → Types). */
  accountTypeLabels?: Record<string, string>;
  /** Accounts page: the colour of each account type. */
  accountTypeColors?: Record<string, string>;
  /** Accounts page: the order the type sections appear in. */
  accountTypeOrder?: AccountType[];
  /** Accounts page: which two bars each account type shows (Manage → Cards). */
  accountCardBars?: Record<string, string[]>;
  /** Accounts page: which four mini-stats each account type shows (Manage → Cards). */
  accountCardMini?: Record<string, string[]>;
  /** Accounts page: how accounts are grouped. Remembered between sessions. */
  accountsGroupBy?: "type" | "firm" | "firm-type" | "copy";
  // ---- Maturity / phase (stage 1: measure only, nothing hidden) ----
  /** Declared onboarding answers — most useful while data is scarce. */
  maturityExp?: Experience;
  maturityJournaling?: Journaling;
  maturityActiveAccounts?: ActiveAccounts;
  maturityGroupTrading?: boolean;
  /** "auto" (default) or a manual override that always wins. */
  maturityPhaseOverride?: Phase | "auto";
  /** Last computed snapshot, cached so the settings UI stays synchronous. */
  maturity?: MaturityScore;
  // ---- Formatting ----
  dateFormat?: string;
  use24HourTime?: boolean;
  showSeconds?: boolean;
  // ---- Trading defaults ----
  defaultAccountId?: string;
  defaultSymbol?: string;
  defaultQty?: number;
  defaultRisk?: number;
  /** Default stop distance in points, per instrument. */
  stops?: Record<string, number>;
  // ---- Editable lists ----
  setups?: string[];
  mistakes?: string[];
  tags?: string[];
  /** Default period for the Trade Log. */
  tradeLogPeriod?: string;
  accountRules: AccountRule[];
  /** The journal's zone: the wall-clock every trade is shown in (default NY ET). */
  timeZone: string;
  /** Source zone for naive CSV exports. Empty = auto-detect/ask at import. */
  importZone?: string;
  propAccounts: PropAccount[];
  accountGroups: AccountGroup[];
  archivedAccounts: PropAccount[];
  payouts: Payout[];
  deposits: Deposit[];
  accountMappings: Record<string, string>;
  /** One-off migration flag: legacy notes that carried a broker/export account
   *  name were rewritten to the account's friendly name. */
  accountNamesNormalized?: boolean;
  /** One-off migration flag: broker-only accounts present in the vault were
   *  adopted as real accounts and accountMappings keys became aliases. */
  brokerAccountsAdopted?: boolean;
  recentLimit: number;
  theme: ThemeSettings;
}

const DEFAULT_SETTINGS: TradebookSettings = {
  tradesFolder: "Tradebook/trades",
  journalName: "",
  dashboardTitle: "",
  dashboardLayout: [],
  gridCols: 12,
  animations: true,
  chartDates: true,
  tradeLog: {},
  currency: "$",
  openHomeOnStartup: false,
  onboardingDone: false,
  tabBehavior: "replace",
  privacyMode: false,
  includeCopiesInPortfolioAnalytics: false,
  accountsSort: "name",
  accountsShowLogo: true,
  accountsShowArchived: true,
  accountsChartPeriod: "all",
  accountTypeLabels: {},
  accountTypeColors: {},
  accountTypeOrder: ["personal", "live", "funded", "eval", "demo", "unknown"],
  // Empty by design: the defaults live in lib/cardSlots.ts next to the builders,
  // so a type with nothing saved always has something sensible to draw.
  accountCardBars: {},
  accountCardMini: {},
  excludeDemosFromPortfolio: true,
  accountsGroupBy: "type",
  maturityPhaseOverride: "auto",
  dateFormat: "YYYY-MM-DD",
  use24HourTime: false,
  showSeconds: false,
  defaultAccountId: "",
  defaultSymbol: "NQ",
  defaultQty: 1,
  defaultRisk: 200,
  stops: { NQ: 10, ES: 4, MNQ: 4, MES: 4 },
  setups: [],
  mistakes: [],
  tags: [],
  accountWidgets: ["trades", "payout"],
  copyGroups: [],
  tradeLogPeriod: "all",
  accountRules: [],
  timeZone: "America/New_York",
  importZone: "",
  propAccounts: [],
  accountGroups: [],
  archivedAccounts: [],
  payouts: [],
  deposits: [],
  accountMappings: {},
  recentLimit: 20,
  theme: { preset: "default", background: "default", accent: "", dotColor: "", surface: "", bg: "", bg2: "", border: "", pattern: "none", font: "sans", glow: false },
};

const ALL_VIEW_TYPES = [
  HOME_VIEW_TYPE,
  DASHBOARD_VIEW_TYPE,
  ACCOUNT_DASH_VIEW_TYPE,
  ACCOUNTS_LIST_VIEW_TYPE,
  ADD_TRADE_VIEW_TYPE,
  TRADE_LOG_VIEW_TYPE,
  TRADE_DETAIL_VIEW_TYPE,
  TRADEBOOK_SIDEBAR_VIEW_TYPE,
  SETUPS_VIEW_TYPE,
];

/** One note a rename pass would move, plus the prints that follow it. */
export interface RenamePlanItem {
  from: string;
  to: string;
  newName: string;
  oldBase: string;
  screenshot: string;
  printMoves: Array<{ from: string; to: string }>;
}

/** What a rename pass would do — computed before anything is touched. */
export interface RenamePlan {
  items: RenamePlanItem[];
  skipped: number;
}

export default class TradebookPlugin extends Plugin {
  settings: TradebookSettings;
  /** In-memory print queue for the Add Trade workflow. Not persisted. */
  printQueue: QueuedPrint[] = [];
  printQueueVersion = 0;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    await this.loadSettings();

    // Keep the last uncaught error so a bug report can carry it:
    // Settings → Advanced → Diagnostics.
    this.registerDomEvent(window, "error", (ev: any) => {
      this._lastError = ev?.error?.stack || ev?.message || String(ev);
    });
    this.registerDomEvent(window, "unhandledrejection", (ev: any) => {
      const reason = ev?.reason;
      this._lastError = reason?.stack || reason?.message || String(reason);
    });

    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));
    this.registerView(SETUPS_VIEW_TYPE, (leaf) => new SetupsView(leaf, this));
    this.registerView(PRINT_QUEUE_VIEW_TYPE, (leaf) => new PrintQueueView(leaf, this));
    this.registerView(ACCOUNT_DASH_VIEW_TYPE, (leaf) => new AccountDashboardView(leaf, this));
    this.registerView(ADD_TRADE_VIEW_TYPE, (leaf) => new AddTradeView(leaf, this));
    this.registerView(TRADE_LOG_VIEW_TYPE, (leaf) => new TradeLogView(leaf, this));
    this.registerView(ACCOUNTS_LIST_VIEW_TYPE, (leaf) => new AccountsListView(leaf, this));
    this.registerView(TRADE_DETAIL_VIEW_TYPE, (leaf) => new TradeDetailView(leaf, this));
    this.registerView(TRADEBOOK_SIDEBAR_VIEW_TYPE, (leaf) => new TradebookSidebarView(leaf, this));

    this.addRibbonIcon("grip", "Tradebook — Home", () => {
      this.openDashboard();
    });
    this.addRibbonIcon("wallet", "Tradebook — Accounts", () => {
      this.openAccounts();
    });
    this.addRibbonIcon("list", "Tradebook — Trade Log", () => {
      this.openTradeLog();
    });
    this.addRibbonIcon("plus", "Tradebook — Add Trade", () => {
      this.openAddPanel();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open Trading Dashboard",
      callback: () => this.openDashboard(),
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
      name: "Open Tradebook Menu (left sidebar)",
      callback: () => this.openSidebarView(),
    });

    this.addCommand({
      id: "show-getting-started",
      name: "Show the getting started tour",
      callback: () => this.showGettingStarted(),
    });

    this.addCommand({
      id: "open-print-queue",
      name: "Open Print Queue (right sidebar)",
      callback: () => this.ensurePrintQueueLeaf(),
    });

    this.addSettingTab(new SettingsTab(this.app, this));
    // Workspace APIs are optional — some mock/host environments may lack them.
    if (typeof (this.app.workspace as any).onLayoutReady === "function") {
      (this.app.workspace as any).onLayoutReady(async () => {
        try {
          await this.runAccountMaintenance();
        } catch (err) {
          console.error("[tradebook] account maintenance failed:", err);
        }
        await this.ensureSidebarLeaf();
        // A brand-new journal gets the tour once. It can be reopened from
        // Settings → Advanced or the command palette at any time.
        if (this.settings.onboardingDone !== true && (this.settings.propAccounts?.length ?? 0) === 0) {
          this.showGettingStarted();
        }
        if (this.settings.openHomeOnStartup) await this.openHome();
      });
    }
  }

  onunload() {}

  private _journalLeaf: any = null;
  private _celebrationDismissed = new Set<string>();
  /** Last uncaught error this session (window error / unhandled rejection). */
  private _lastError = "";

  /** Opens the first-run tour. Also exposed as a command, so it can be redone. */
  showGettingStarted(): void {
    openGettingStarted(this);
  }

  /** Last uncaught error of this session, or an empty string. */
  lastError(): string {
    return this._lastError;
  }

  /**
   * Text snapshot for a bug report — versions, counts, settings and the last
   * error. Never contains note contents; the user chooses to share the file.
   */
  async writeDiagnostics(): Promise<{ path: string; text: string }> {
    const text = await buildDiagnostics(this);
    const dir = this.getBackupFolder();
    const adapter: any = this.app.vault.adapter;
    try {
      if (typeof adapter.mkdir === "function" && !(await adapter.exists(dir))) await adapter.mkdir(dir);
    } catch {
      /* folder may already exist, or the adapter may not support mkdir */
    }
    const path = normalizePath(`${dir}/${diagnosticsFilename()}`);
    await adapter.write(path, text);
    return { path, text };
  }

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
    // "New tab" behaviour: always hand back a fresh main-area tab.
    if (this.settings.tabBehavior === "new") {
      const fresh = this.app.workspace.getLeaf("tab");
      if (fresh) return fresh;
    }
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
    await this.app.workspace.revealLeaf(leaf);
  }

  async openDashboard(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openHome(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: HOME_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openSetups(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: SETUPS_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openAccounts(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: ACCOUNTS_LIST_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openTradeLog(leaf?: any) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: TRADE_LOG_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  /** Opens the unified Add Trade page (Manual or Import tab). */
  async openAddTrade(tab: "manual" | "import" = "manual") {
    const target = this.getJournalLeaf();
    await target.setViewState({ type: ADD_TRADE_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
    const leaves = this.app.workspace.getLeavesOfType(ADD_TRADE_VIEW_TYPE);
    const view: any = leaves.length ? leaves[0].view : null;
    if (view && typeof view.setTab === "function") view.setTab(tab);
  }

  async openImport() {
    await this.openAddTrade("import");
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
    await this.app.workspace.revealLeaf(target);
  }

  async openTradeModal(trade: { id: string }) {
    const trades = await this.loadTrades();
    const full = trades.find((t) => t.id === trade.id) ?? (trade as any);
    openTradeModal(this, full);
  }

  /** Opens/reveals the Tradebook menu in Obsidian's LEFT sidebar.
   *  It appears as a tab in the sidebar top bar (like Files/Search/Bookmarks),
   *  so the user can switch between the file tree and our menu natively. */
  async openSidebarView(): Promise<void> {
    await this.ensureSidebarLeaf();
  }

  /** Try to put the sidebar view in Obsidian's left sidebar. Falls back to
   *  creating a new left leaf when none is available, and retries once briefly
   *  (the sidebar may not expose a leaf yet on first layout). */
  async ensureSidebarLeaf(): Promise<boolean> {
    const tryOnce = async (): Promise<boolean> => {
      const existing = this.app.workspace.getLeavesOfType(TRADEBOOK_SIDEBAR_VIEW_TYPE);
      if (existing.length > 0) {
        await this.app.workspace.revealLeaf(existing[0]);
        return true;
      }
      const leftLeaf = (this.app.workspace as any).getLeftLeaf?.(false) ?? (this.app.workspace as any).getLeftLeaf?.(true);
      if (!leftLeaf) return false;
      await leftLeaf.setViewState({ type: TRADEBOOK_SIDEBAR_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leftLeaf);
      return true;
    };
    if (await tryOnce()) return true;
    await new Promise((r) => setTimeout(r, 800));
    return await tryOnce();
  }

  /** Open / reveal the Print Queue in Obsidian's RIGHT sidebar. */
  async ensurePrintQueueLeaf(): Promise<boolean> {
    const tryOnce = async (): Promise<boolean> => {
      const existing = this.app.workspace.getLeavesOfType(PRINT_QUEUE_VIEW_TYPE);
      if (existing.length > 0) {
        await this.app.workspace.revealLeaf(existing[0]);
        return true;
      }
      const rightLeaf = (this.app.workspace as any).getRightLeaf?.(false) ?? (this.app.workspace as any).getRightLeaf?.(true);
      if (!rightLeaf) return false;
      await rightLeaf.setViewState({ type: PRINT_QUEUE_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(rightLeaf);
      return true;
    };
    if (await tryOnce()) return true;
    await new Promise((r) => setTimeout(r, 800));
    return await tryOnce();
  }

  /** Where the trade detail was opened from (so "Back" returns there). */
  tradeDetailOrigin: { type: "tradelog" | "account"; accountId?: string } = { type: "tradelog" };

  async openTradeDetail(trade: { id: string; from?: { type: "tradelog" | "account"; accountId?: string } }) {
    this.tradeDetailOrigin = trade.from ?? { type: "tradelog" };
    const trades = await this.loadTradesExpanded();
    let full = trades.find((t) => t.id === trade.id);
    // Virtual legs have no file — open their base trade instead.
    if (full && isVirtualLeg(full)) {
      const base = trades.find((t) => !isLeg(t) && legBaseKey(t) === legBaseKey(full!));
      if (base) full = base;
    }
    const resolved = full ?? (trade as any);
    const target = this.getJournalLeaf();
    await target.setViewState({ type: TRADE_DETAIL_VIEW_TYPE, state: { tradeId: resolved.id }, active: true });
    await this.app.workspace.revealLeaf(target);
    const leaves = this.app.workspace.getLeavesOfType(TRADE_DETAIL_VIEW_TYPE);
    const view = leaves.length ? leaves[0].view : null;
    if (view && typeof (view as any).setTrade === "function") {
      await (view as any).setTrade(resolved);
    }
  }

  async openAddPanel() {
    await this.openAddTrade("manual");
  }

  getTradesFolder(): string {
    return normalizePath(this.settings.tradesFolder || "Tradebook/trades");
  }

  /**
   * Every setup name in use — the registry (settings.setups) merged with the
   * names the notes already carry. The registry lets a setup exist before its
   * first trade; the notes make sure nothing in the vault is ever orphaned.
   * Compared case-insensitively, first spelling wins.
   */
  async knownSetups(): Promise<string[]> {
    const seen = new Map<string, string>();
    for (const s of this.settings.setups || []) {
      const clean = (s || "").trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    }
    try {
      const trades = await this.loadTrades();
      for (const t of trades) {
        const clean = (t.setup || "").trim();
        if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
      }
    } catch {
      /* notes unreadable mid-startup — the registry is still returned */
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  /** Register a setup name so it shows in pickers even before its first trade. */
  async addSetup(name: string): Promise<string> {
    const clean = (name || "").trim();
    if (!clean) return "";
    const list = (this.settings.setups ??= []);
    if (!list.some((s) => (s || "").trim().toLowerCase() === clean.toLowerCase())) {
      list.push(clean);
      list.sort((a, b) => a.localeCompare(b));
      await this.saveSettings();
    }
    return clean;
  }

  /**
   * Remove a setup from the registry. Trade notes keep their `setup` value on
   * purpose — the list is an index, not the history. Clearing the field from
   * notes is a separate, explicit action so nobody loses data by tidying up.
   */
  async removeSetup(name: string): Promise<void> {
    const key = (name || "").trim().toLowerCase();
    const list = this.settings.setups || [];
    const next = list.filter((s) => (s || "").trim().toLowerCase() !== key);
    if (next.length !== list.length) {
      this.settings.setups = next;
      await this.saveSettings();
    }
  }

  /**
   * Rename a setup everywhere: the registry AND every trade note that carries
   * the old name (copy legs included). This is the whole reason a rename has to
   * be a first-class action instead of editing a label — the notes are the
   * source of truth, so the name lives in many files at once.
   */
  async renameSetup(oldName: string, newName: string): Promise<number> {
    const from = (oldName || "").trim();
    const to = (newName || "").trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return 0;

    const list = (this.settings.setups ??= []);
    let touchedRegistry = false;
    for (let i = 0; i < list.length; i++) {
      if ((list[i] || "").trim().toLowerCase() === from.toLowerCase()) {
        list[i] = to;
        touchedRegistry = true;
      }
    }
    if (!list.some((s) => (s || "").trim().toLowerCase() === to.toLowerCase())) {
      list.push(to);
      touchedRegistry = true;
    }
    list.sort((a, b) => a.localeCompare(b));
    if (touchedRegistry) await this.saveSettings();

    let changed = 0;
    try {
      const trades = await this.loadTradesExpanded();
      for (const t of trades) {
        if ((t.setup || "").trim().toLowerCase() !== from.toLowerCase()) continue;
        const file = this.app.vault.getAbstractFileByPath(t.id);
        if (file instanceof TFile) {
          try {
            await updateTradeFields(this.app, file, { setup: to });
            changed++;
          } catch (err) {
            console.error("[tradebook] setup rename: note failed", t.id, err);
          }
        }
      }
    } catch (err) {
      console.error("[tradebook] setup rename failed", err);
    }
    if (changed) this.clearTradeCache();
    return changed;
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
    // Prefer the mapped account's real type; fall back to the keyword guess.
    const mapped = this.mappedAccount(account);
    return mapped ? mapped.type : classifyAccount(account, this.getAccountRules());
  }

  mappedAccount(name: string): PropAccount | null {
    const key = (name || "").trim();
    if (!key) return null;
    const maps = this.settings.accountMappings || {};
    const lower = key.toLowerCase();
    // 1. explicit mapping (case/whitespace-insensitive)
    let id: string | undefined = maps[key];
    if (!id) {
      for (const [k, v] of Object.entries(maps)) {
        if (k.trim().toLowerCase() === lower) {
          id = v;
          break;
        }
      }
    }
    if (id) {
      const byId = this.settings.propAccounts.find((a) => a.id === id);
      if (byId) return byId;
    }
    // 2. fall back to a (case-insensitive) name match
    const byName = this.settings.propAccounts.find((a) => (a.name || "").trim().toLowerCase() === lower);
    if (byName) return byName;
    // 3. fall back to the account's stored broker/export aliases
    return (
      this.settings.propAccounts.find((a) =>
        (a.aliases || []).some((al) => (al || "").trim().toLowerCase() === lower)
      ) ?? null
    );
  }

  /** What the user should SEE for an account name — never a broker export id.
   *  Every view that prints an account name must go through this. */
  displayAccount(name: string): string {
    const mapped = this.mappedAccount(name);
    return mapped ? mapped.name : (name || "").trim();
  }

  /** The first configured account. */
  getPrimaryAccount(): PropAccount | undefined {
    const accounts = this.settings.propAccounts || [];
    return accounts.length > 0 ? accounts[0] : undefined;
  }

  /** Resource URL for a firm logo bundled in the plugin (assets/firm-logos/<id>.png).
   *  Returns null when the file/folder isn't available (caller falls back to initials). */
  firmLogoUrl(firmId: string): string | null {
    if (!firmId) return null;
    try {
      const dir = (this.manifest as any)?.dir;
      const adapter: any = (this.app as any)?.vault?.adapter;
      if (!dir || !adapter?.getResourcePath) return null;
      return adapter.getResourcePath(`${dir}/assets/firm-logos/${firmId}.png`);
    } catch {
      return null;
    }
  }

  /** Load all trade notes from the configured folder into Trade objects. */
  private _tradeCache = new Map<string, { mtime: number; trade: Trade }>();


  /**
   * Rename every trade note (and its prints) to the current naming scheme:
   *   <date in the user format> SYMBOL DIRECTION HHMM   (no account)
   * Safe + idempotent: skips notes that already match, never overwrites.
   */
  /**
   * Read-only pass over the trades folder: what would change if every note — and
   * the prints that belong to it — were renamed to the current scheme. Nothing
   * moves here, so the user gets to look before anything is touched.
   */
  async planFileRename(): Promise<RenamePlan> {
    const folder = this.getTradesFolder();
    const files = this.app.vault
      .getFiles()
      .filter((f) => f.extension === "md" && f.path.startsWith(folder + "/"))
      .sort((a, b) => a.path.localeCompare(b.path));
    const printsDir = normalizePath(folder + "/prints");
    const items: RenamePlanItem[] = [];
    const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
    let skipped = 0;

    for (const f of files) {
      try {
        const content = await this.app.vault.cachedRead(f);
        const p = parseTradeFromMarkdown(content);
        if (!p || !p.date || !p.symbol) {
          skipped++;
          continue;
        }
        const t = p as unknown as Trade;
        const desired = `${tradeFilename(t, this.settings.dateFormat)}.md`;
        const dir = f.parent ? f.parent.path : folder;
        const oldBase = f.name.replace(/\.md$/, "");
        const newBase = desired.replace(/\.md$/, "");
        let target = f.path;
        if (f.name !== desired) {
          target = normalizePath(`${dir}/${desired}`);
          // Its own slot is not a competitor: a note already sitting at the
          // collision name (`…_2`) must not be bumped to `…_3` on every pass.
          taken.delete(f.path);
          let n = 2;
          while (taken.has(target)) {
            target = normalizePath(`${dir}/${newBase}_${n}.md`);
            n++;
          }
          taken.add(target);
        }

        // Prints that belong to this note: same base name, " print…" suffix.
        // They follow the note's FINAL base (which may carry a `_2` collision
        // suffix), so the pair never drifts apart.
        const finalBase = target.split("/").pop()!.replace(/\.md$/, "");
        const printMoves: Array<{ from: string; to: string }> = [];
        if (finalBase !== oldBase) {
          for (const pf of this.app.vault.getFiles().filter((x) => x.path.startsWith(printsDir + "/"))) {
            if (!pf.name.startsWith(`${oldBase} print`)) continue;
            const suffix = pf.name.slice(oldBase.length);
            const np = normalizePath(`${printsDir}/${finalBase}${suffix}`);
            if (taken.has(np)) continue;
            taken.add(np);
            printMoves.push({ from: pf.path, to: np });
          }
        }

        if (target !== f.path || printMoves.length) {
          items.push({
            from: f.path,
            to: target,
            newName: newBase,
            oldBase,
            screenshot: p.screenshot ?? "",
            printMoves,
          });
        }
      } catch (err) {
        console.error("[tradebook] rename planning failed:", f.path, err);
        skipped++;
      }
    }
    return { items, skipped };
  }

  /**
   * Apply a plan produced by planFileRename(). Renames go through
   * fileManager.renameFile so Obsidian updates every [[link]] and embed that
   * pointed at the old name; vault.rename is only the fallback.
   */
  async applyFileRename(plan: RenamePlan): Promise<{ renamed: number; prints: number; skipped: number }> {
    const fm = this.app.fileManager;
    const move = async (file: TFile, to: string) => {
      if (fm && typeof fm.renameFile === "function") await fm.renameFile(file, to);
      else await this.app.vault.rename(file, to);
    };
    let renamed = 0;
    let prints = 0;
    let skipped = 0;

    for (const item of plan.items) {
      try {
        const file = this.app.vault.getAbstractFileByPath(item.from);
        if (!(file instanceof TFile)) {
          skipped++;
          continue;
        }
        let notePath = item.from;
        if (item.to !== item.from) {
          await move(file, item.to);
          notePath = item.to;
          renamed++;
        }
        for (const mv of item.printMoves) {
          const pf = this.app.vault.getAbstractFileByPath(mv.from);
          if (!(pf instanceof TFile)) {
            skipped++;
            continue;
          }
          if (this.app.vault.getAbstractFileByPath(mv.to)) continue;
          await move(pf, mv.to);
          prints++;
          const oldName = mv.from.split("/").pop() as string;
          const note = this.app.vault.getAbstractFileByPath(notePath);
          if (fm && note instanceof TFile && item.screenshot && item.screenshot.includes(oldName)) {
            await fm.processFrontMatter(note, (data: Record<string, unknown>) => {
              data.screenshot = String(data.screenshot).replace(oldName, mv.to.split("/").pop() as string);
            });
          }
        }
      } catch (err) {
        console.error("[tradebook] rename failed:", item.from, err);
        skipped++;
      }
    }
    this.clearTradeCache();
    await this.reloadAllViews();
    return { renamed, prints, skipped };
  }

  /** Plan + apply without a preview (kept for callers that want it in one step). */
  async migrateFileNames(): Promise<{ renamed: number; prints: number; skipped: number }> {
    const plan = await this.planFileRename();
    return this.applyFileRename(plan);
  }

  /** Create/refresh the copy legs of a base trade (idempotent). */
  async generateCopies(base: Trade, accountIds?: string[]): Promise<import("./lib/copy").GenerateResult> {
    const { generateLegs } = await import("./lib/copy");
    const res = await generateLegs(this, base, accountIds);
    await this.reloadAllViews();
    return res;
  }

  /** Remove the generated legs of a base trade (imported ones are kept). */
  async deleteCopies(baseKey: string): Promise<number> {
    const { deleteLegs } = await import("./lib/copy");
    const removed = await deleteLegs(this, baseKey);
    await this.reloadAllViews();
    return removed;
  }

  /** Accounts that would receive a copy of this trade (for the checklist UI). */
  copyMembersFor(base: Trade): import("./types").PropAccount[] {
    return copyMembersForBase(this, base);
  }

  /** Parse "HH:MM" (or "HH:MM:SS") into minutes-from-midnight. NaN when empty. */
  private _minutesOf(t: string): number {
    const m = /^(\d{1,2}):(\d{2})/.exec((t || "").trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }

  /** Normalise a symbol to its mini root so NQ ↔ MNQ compare equal. */
  private _miniRoot(symbol: string): string {
    return crossSymbol((symbol || "").trim().toUpperCase(), false);
  }

  /**
   * ROLE-DRIVEN reconciliation. When an account is a `copier`, the real notes
   * that landed in it (broker imports, manual entry) are matched to the leader's
   * trades and marked as legs — so they are never double-counted with the
   * virtual legs the engine would otherwise synthesize.
   *
   * Matching: same date + direction + symbol family, entry time within ±2 min.
   * Idempotent: already-marked notes are left alone; imported legs always win.
   */
  async reconcileCopierTrades(accountId: string): Promise<{ matched: number; unmatched: number }> {
    const acc = (this.settings.propAccounts || []).find((a) => a.id === accountId);
    if (!acc || acc.copyRole !== "copier" || !acc.copyBaseId) return { matched: 0, unmatched: 0 };
    const base = (this.settings.propAccounts || []).find((a) => a.id === acc.copyBaseId);
    if (!base) return { matched: 0, unmatched: 0 };

    const trades = await this.loadTrades();
    const baseTrades = trades.filter((t) => !isLeg(t) && this.mappedAccount(t.account)?.id === base.id);
    const copyTrades = trades.filter((t) => !isLeg(t) && this.mappedAccount(t.account)?.id === acc.id);
    if (!baseTrades.length || !copyTrades.length) return { matched: 0, unmatched: 0 };

    let matched = 0;
    let unmatched = 0;
    let earliest = "";
    const used = new Set<string>();

    for (const copy of copyTrades) {
      const ct = this._minutesOf(copy.entryTime);
      const hit = baseTrades.find((b) => {
        if (used.has(b.id)) return false;
        if (b.date !== copy.date) return false;
        if ((b.direction || "") !== (copy.direction || "")) return false;
        if (this._miniRoot(b.symbol) !== this._miniRoot(copy.symbol)) return false;
        const bt = this._minutesOf(b.entryTime);
        if (Number.isNaN(ct) || Number.isNaN(bt)) return true;
        return Math.abs(ct - bt) <= 2;
      });
      if (!hit) {
        unmatched++;
        continue;
      }
      used.add(hit.id);
      if (!hit.copyBaseKey) {
        hit.copyBaseKey = "ck_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await setTradeFields(this.app, hit.id, { copy_base_key: hit.copyBaseKey });
      }
      const cfg = effectiveCopyConfig(acc, copy.date);
      await setTradeFields(this.app, copy.id, {
        is_copied_trade: true,
        copied_from_account: base.name,
        copy_base_key: hit.copyBaseKey,
        copy_origin: "imported",
        copy_multiplier: cfg?.ratio ?? acc.copyMultiplier ?? 1,
      });
      if (!earliest || copy.date < earliest) earliest = copy.date;
      matched++;
    }
    if (matched) {
      this.clearTradeCache();
      // Heal the copy window from the evidence: the first real copy marks when
      // copying began. An account cannot have copied a trade before it existed.
      let cfgDirty = false;
      if (!(acc.copyPeriods || []).length && earliest) {
        acc.copyPeriods = [{ start: earliest }];
        cfgDirty = true;
      }
      if (earliest && acc.createdAt && acc.createdAt > earliest) {
        acc.createdAt = earliest;
        cfgDirty = true;
      }
      if (cfgDirty) await this.saveSettings();
    }
    return { matched, unmatched };
  }

  /**
   * One-time backfill for accounts that only exist in the vault as raw broker
   * export names (e.g. Tradovate's "DEMO1234567"): adopt them as real accounts so
   * their notes stop being orphans — and promote every accountMappings key into
   * the owning account's `aliases`, so old/broker names resolve forever without
   * ever being displayed.
   */
  async adoptBrokerAccounts(): Promise<boolean> {
    let dirty = false;
    // 1. every mapping key becomes an alias of its account
    for (const [key, id] of Object.entries(this.settings.accountMappings || {})) {
      const acc = (this.settings.propAccounts || []).find((a) => a.id === id);
      if (!acc) continue;
      const k = (key || "").trim();
      if (!k || k.toLowerCase() === (acc.name || "").trim().toLowerCase()) continue;
      acc.aliases = acc.aliases || [];
      if (!acc.aliases.some((al) => al.trim().toLowerCase() === k.toLowerCase())) {
        acc.aliases.push(k);
        dirty = true;
      }
    }
    // 2. adopt orphan broker export accounts (Tradovate demo pattern)
    const trades = await this.loadTrades();
    const demoPattern = /^DEMO\d{5,}$/i;
    const orphans = new Set<string>();
    for (const t of trades) {
      const raw = (t.account || "").trim();
      if (!raw || this.mappedAccount(raw)) continue;
      if (demoPattern.test(raw)) orphans.add(raw);
    }
    const names = [...orphans].sort();
    if (names.length) {
      let acc = (this.settings.propAccounts || []).find((a) =>
        (a.aliases || []).some((al) => names.some((n) => n.toLowerCase() === (al || "").trim().toLowerCase()))
      );
      if (!acc) {
        const dates = trades
          .filter((t) => names.includes((t.account || "").trim()))
          .map((t) => t.date)
          .filter(Boolean)
          .sort();
        acc = {
          id: "pa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: uniqueAccountName("Demo", (this.settings.propAccounts || []).map((a) => a.name)),
          firmId: "tradovate",
          programId: "demo",
          size: 50000,
          type: "demo",
          createdAt: dates[0],
          aliases: names,
        };
        this.settings.propAccounts.push(acc);
      } else {
        acc.aliases = acc.aliases || [];
        for (const n of names) {
          if (!acc.aliases.some((al) => al.trim().toLowerCase() === n.toLowerCase())) acc.aliases.push(n);
        }
      }
      this.settings.accountMappings = this.settings.accountMappings || {};
      for (const n of names) this.settings.accountMappings[n] = acc.id;
      this.settings.accountMappings[acc.name] = acc.id;
      dirty = true;
    }
    if (dirty) {
      this.clearTradeCache();
      await this.saveSettings();
    }
    return dirty;
  }

  /**
   * Rewrite `account:` on any note that still carries a broker/export name (or a
   * stale account name) so every note shows the friendly account name. The broker
   * id stays in the account's `aliases` — known, resolvable, never displayed.
   */
  async normalizeAccountNames(): Promise<number> {
    const trades = await this.loadTrades();
    let changed = 0;
    for (const t of trades) {
      const raw = (t.account || "").trim();
      if (!raw) continue;
      const mapped = this.mappedAccount(raw);
      if (!mapped || mapped.name === raw) continue;
      if (await setTradeAccount(this.app, t.id, mapped.name)) changed++;
    }
    if (changed) this.clearTradeCache();
    return changed;
  }

  /** Housekeeping on startup: hide broker names (once) + mark copier notes. */
  /** The phase currently in effect (manual override always wins). */
  maturityPhase(): Phase {
    const override = this.settings.maturityPhaseOverride;
    if (override && override !== "auto") return override;
    return this.settings.maturity?.phase ?? "starter";
  }

  /**
   * Maturity — STAGE 1: measure, never gate.
   *
   * Recomputes the snapshot and caches it in settings so the UI can render
   * synchronously. Nothing switches layout yet; this exists to calibrate the
   * weights against a real journal before we wire it to any view.
   */
  async refreshMaturity(): Promise<MaturityScore> {
    const trades = (await this.loadTrades()).filter((t) => Number.isFinite(t.pnl));
    const accounts = this.settings.propAccounts ?? [];

    const days = new Set<string>();
    let stopN = 0, setupN = 0, reviewN = 0, ratingN = 0;
    let riskSum = 0, riskN = 0;
    const byAccount = new Map<string, Trade[]>();

    for (const t of trades) {
      if (t.date) days.add(t.date);
      if (t.stopLoss && t.stopLoss > 0) stopN++;
      if (t.setup && String(t.setup).trim()) setupN++;
      if (t.reviewed) reviewN++;
      if (t.rating && t.rating > 0) ratingN++;
      const acc = this.mappedAccount(t.account);
      if (!acc) continue;
      const arr = byAccount.get(acc.id) ?? [];
      arr.push(t);
      byAccount.set(acc.id, arr);
    }

    let breachCount = 0;
    for (const acc of accounts) {
      const size = effectiveSize(getSize(getProgram(getFirm(acc.firmId), acc.programId), acc.size), acc.rules);
      const mine = byAccount.get(acc.id);
      if (!size || size.maxLoss <= 0 || !mine || !mine.length) continue;

      let cum = 0, peak = 0, dd = 0;
      const ordered = mine
        .slice()
        .sort((a, b) => (a.date + (a.entryTime || "")).localeCompare(b.date + (b.entryTime || "")));
      for (const t of ordered) {
        cum += t.pnl;
        if (cum > peak) peak = cum;
        if (peak - cum > dd) dd = peak - cum;
      }
      if (dd >= size.maxLoss) breachCount++;

      for (const t of ordered) {
        if (!t.stopLoss || !t.entryPrice) continue;
        const spec = futuresSpec(t.symbol);
        const qty = t.quantity && t.quantity > 0 ? t.quantity : 1;
        const risk = Math.abs(t.entryPrice - t.stopLoss) * spec.pointValue * qty;
        if (risk > 0) {
          riskSum += (risk / size.maxLoss) * 100;
          riskN++;
        }
      }
    }

    const first = [...days].sort()[0];
    const journalAgeDays = first
      ? Math.max(0, Math.round((Date.now() - new Date(first + "T00:00:00").getTime()) / 86400000))
      : 0;
    const n = trades.length || 1;
    const copyAccounts = accounts.filter((a) => a.copyRole === "copier" || a.copyRole === "base").length;

    const input: MaturityInput = {
      trades: trades.length,
      activeDays: days.size,
      journalAgeDays,
      accounts: accounts.length,
      firms: new Set(accounts.map((a) => a.firmId)).size,
      copyGroups: (this.settings.copyGroups ?? []).length,
      copyAccounts,
      payouts: (this.settings.payouts ?? []).length,
      stopPct: (stopN / n) * 100,
      setupPct: (setupN / n) * 100,
      reviewPct: (reviewN / n) * 100,
      ratingPct: (ratingN / n) * 100,
      breachCount,
      avgRiskPct: riskN ? riskSum / riskN : 0,
      exp: this.settings.maturityExp,
      journaling: this.settings.maturityJournaling,
      activeAccounts: this.settings.maturityActiveAccounts,
      groupTrading: this.settings.maturityGroupTrading,
    };

    const score = computeMaturity(input);
    this.settings.maturity = score;
    await this.saveSettings();
    return score;
  }

  async runAccountMaintenance(): Promise<void> {
    if (!(this.settings.propAccounts || []).length) return;
    let settingsDirty = false;

    // One-time: adopt broker-only accounts + promote mapping keys to aliases.
    if (!this.settings.brokerAccountsAdopted) {
      const trades = await this.loadTrades();
      if (trades.length) {
        await this.adoptBrokerAccounts();
        this.settings.brokerAccountsAdopted = true;
        settingsDirty = true;
      }
    }

    // One-time: rewrite notes that still carry a broker/old account name.
    if (!this.settings.accountNamesNormalized) {
      await this.normalizeAccountNames();
      this.settings.accountNamesNormalized = true;
      settingsDirty = true;
    }

    // Every load: mark real copier notes as legs (role-driven, idempotent).
    for (const acc of this.settings.propAccounts) {
      if (acc.copyRole !== "copier" || !acc.copyBaseId) continue;
      await this.reconcileCopierTrades(acc.id);
    }

    // Repair a one-sided link: a funded that remembers its eval, where the eval
    // forgot (or never recorded) its funded. Nothing is created — only linked.
    for (const funded of this.settings.propAccounts) {
      if (funded.type !== "funded" || !funded.linkedEvalId) continue;
      const evalAcc = this.settings.propAccounts.find((a) => a.id === funded.linkedEvalId);
      if (!evalAcc || evalAcc.linkedFundedId === funded.id) continue;
      if (evalAcc.linkedFundedId) continue; // points somewhere else on purpose
      evalAcc.linkedFundedId = funded.id;
      settingsDirty = true;
    }

    // Evals that were upgraded before this memory existed: stamp the date now,
    // so their celebration never fires again either.
    for (const a of this.settings.propAccounts) {
      if (a.type !== "eval" || a.passedAt) continue;
      if (!a.linkedFundedId && !a.passKept) continue;
      const program = getProgram(getFirm(a.firmId), a.programId);
      const size = program ? effectiveSize(getSize(program, a.size), a.rules) : null;
      const funded = (this.settings.propAccounts ?? []).find((f) => f.id === a.linkedFundedId);
      a.passedAt =
        (await this.passedDateOf(a.id, size?.target ?? 0)) ||
        funded?.createdAt ||
        new Date().toISOString().slice(0, 10);
      settingsDirty = true;
    }

    if (settingsDirty) await this.saveSettings();

    // Maturity snapshot (stage 1: measurement only — no layout changes yet).
    await this.refreshMaturity();
  }

  /** Account page: edit mode for the widget layout. */
  private _accountEdit = false;
  isAccountEditMode(): boolean { return this._accountEdit; }
  setAccountEditMode(v: boolean): void { this._accountEdit = v; }

  /** Account metrics (also used by the smoke tests). */
  accountMetrics = computeAccountMetrics;
  /** Shared helpers (also used by the smoke test). */
  newAccountName = uniqueAccountName;
  copyUniqueTrades = uniqueTrades;
  copyBuildLeg = buildLeg;
  propFirms = PROP_FIRMS;
  buildAccount = makeAccount;

  /** Copy-trading helpers (also used by the smoke tests). */
  copy = {
    effectiveCopyConfig,
    isActiveCopier,
    buildLeg,
    uniqueTrades,
    legBaseKey,
    isLeg,
    crossSymbol,
    membersForBase: (base: Trade) => copyMembersForBase(this, base),
  };

  /** Drop the parsed-trade cache so the next load re-reads every note. */
  clearTradeCache(): void {
    this._tradeCache.clear();
  }

  // --------------------------------------------------------------- backup ----
  // One file that puts the journal back the way it was: settings, accounts and the
  // trade notes. Case A of docs/BACKUP-AND-EXPORT.md. Prints are images in the
  // vault and stay in the vault — the UI says so, the tutorial says to copy the
  // folder for those.

  /** Where a backup lands by default: a `backups` folder beside the journal. */
  getBackupFolder(): string {
    const folder = this.getTradesFolder();
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
    return normalizePath(`${parent ? parent + "/" : ""}backups`);
  }

  private async collectTradeNotes(): Promise<BackupNote[]> {
    const folder = this.getTradesFolder();
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder + "/") && f.extension === "md");
    const notes: BackupNote[] = [];
    for (const f of files) {
      try {
        notes.push({ path: f.path, content: await this.app.vault.cachedRead(f) });
      } catch (err) {
        console.error("[tradebook] could not read a trade note for backup:", f.path, err);
      }
    }
    return notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Write the whole journal to one JSON file and say where it went. */
  async exportEverything(): Promise<{ path: string; bytes: number; counts: BackupPayload["counts"] }> {
    const payload = buildBackup({
      settings: this.settings,
      pluginVersion: this.manifest.version,
      notes: await this.collectTradeNotes(),
    });
    const folder = this.getBackupFolder();
    if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.adapter.mkdir(folder);
    const path = normalizePath(`${folder}/${backupFilename()}`);
    const json = JSON.stringify(payload);
    await this.app.vault.adapter.write(path, json);
    return { path, bytes: json.length, counts: payload.counts };
  }

  /**
   * Put a backup back. The current settings file is snapshotted first, so a
   * restore can always be undone; trade notes are only created when they are
   * missing, never overwritten.
   */
  async applyBackup(
    payload: BackupPayload,
    opts: { restoreNotes: boolean }
  ): Promise<{ accounts: number; notesRestored: number; notesKept: number; snapshot: string }> {
    const configDir = this.app.vault.configDir || ".obsidian";
    const dir = this.manifest.dir ?? `${configDir}/plugins/${this.manifest.id}`;
    const snapshot = normalizePath(`${dir}/data.pre-import-${Date.now()}.json`);
    try {
      await this.app.vault.adapter.write(snapshot, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      console.error("[tradebook] could not write the pre-import snapshot", err);
    }

    // Replace, do not merge: a restore means "this is what my journal was".
    this.settings = { ...DEFAULT_SETTINGS, ...payload.settings };
    this.applyTypePrefs();
    await this.saveSettings();

    let notesRestored = 0;
    let notesKept = 0;
    if (opts.restoreNotes) {
      for (const note of payload.notes) {
        const path = normalizePath(note.path);
        // A note is only written when the vault does not already have it: a
        // restore fills gaps, it never overwrites what you have since written.
        const already = this.app.vault.getAbstractFileByPath(path) ?? (await this.app.vault.adapter.exists(path));
        if (already) {
          notesKept++;
          continue;
        }
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (parent && !(await this.app.vault.adapter.exists(parent))) await this.app.vault.adapter.mkdir(parent);
        try {
          await this.app.vault.create(path, note.content);
          notesRestored++;
        } catch (err) {
          console.error("[tradebook] could not restore a trade note:", path, err);
        }
      }
    } else {
      notesKept = payload.notes.length;
    }

    this.clearTradeCache();
    await this.reloadAllViews();
    return { accounts: (this.settings.propAccounts ?? []).length, notesRestored, notesKept, snapshot };
  }

  async loadTrades(): Promise<Trade[]> {
    const folder = this.getTradesFolder();
    const base = this.app.vault.getAbstractFileByPath(folder);
    const trades: Trade[] = [];
    if (base instanceof TFile) {
      const content = await this.app.vault.cachedRead(base);
      const partial = parseTradeFromMarkdown(content);
      if (partial.date && partial.symbol) {
        const t = partial as Trade;
        const _m = this.mappedAccount(t.account);
        // Prefer the mapped account's real type; fall back to the keyword guess.
        t.accountType = _m ? _m.type : classifyAccount(t.account, this.getAccountRules());
        trades.push({ ...t, id: base.path });
      }
      return trades;
    }

    const files = this.app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(folder + "/") && f.extension === "md");

    for (const f of files) {
      const mtime = f.stat ? f.stat.mtime : 0;
      const cached = this._tradeCache.get(f.path);
      let t: Trade | null = null;
      if (cached && cached.mtime === mtime) {
        // Unchanged file: reuse the parsed trade instead of re-reading/parsing.
        t = { ...cached.trade };
      } else {
        const content = await this.app.vault.cachedRead(f);
        const partial = parseTradeFromMarkdown(content);
        if (partial.date && partial.symbol && typeof partial.pnl === "number") {
          t = { ...(partial as Trade), id: f.path } as Trade;
          this._tradeCache.set(f.path, { mtime, trade: { ...t } });
        } else {
          this._tradeCache.delete(f.path);
        }
      }
      if (t) {
        t.id = f.path;
        // Always re-classify so stored labels stay in sync with account rules.
        const _m = this.mappedAccount(t.account);
        // Prefer the mapped account's real type; fall back to the keyword guess.
        t.accountType = _m ? _m.type : classifyAccount(t.account, this.getAccountRules());
        trades.push(t);
      }
    }

    // Prune entries for files that no longer exist.
    const live = new Set(files.map((f) => f.path));
    for (const key of [...this._tradeCache.keys()]) if (!live.has(key)) this._tradeCache.delete(key);

    return trades;
  }

  /** Physical trades + VIRTUAL copy legs (space-saving default — no extra files). */
  async loadTradesExpanded(): Promise<Trade[]> {
    const physical = await this.loadTrades();
    return expandVirtualLegs(this, physical);
  }

  /**
   * The analytics view of the journal — the single source of truth for numbers.
   *
   * A copied trade is real money in every account it reached, but it is one
   * trade logically. So views take `money` for sums and `counts` for counts and
   * win rates, instead of each one deciding for itself (which is how the Home
   * and the Trade Log started disagreeing).
   */
  async loadTradesScoped(): Promise<AnalyticsScope> {
    const trades = await this.loadTradesExpanded();
    return analyticsTrades(trades, this.settings.includeCopiesInPortfolioAnalytics === true);
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
      const saved = await saveTrade(this.app, this.getTradesFolder(), t, this.settings.dateFormat);
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
      // Give the broadcast trade a stable group key so copies can be deduped.
      const baseKey = t.copyBaseKey || legBaseKey(t);
      t.copyBaseKey = baseKey;
      out.push(t);
      for (const id of accountIds) {
        const acc = this.settings.propAccounts.find((a) => a.id === id);
        if (!acc) continue;
        const copy: Trade = {
          ...t,
          id: "",
          account: acc.name,
          accountType: acc.type,
          isCopiedTrade: true,
          copiedFromAccount: t.account,
          copyBaseKey: baseKey,
          copyMultiplier: 1,
          copyOrigin: "generated",
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
          console.error(`[tradebook] refresh ${type} failed:`, err);
        }
      }
    }
  }

  payoutsFor(accountId: string): Payout[] {
    return (this.settings.payouts || []).filter((p) => p.accountId === accountId).sort((a, b) => a.date.localeCompare(b.date));
  }

  accountPayoutsTotal(accountId: string): number {
    return this.payoutsFor(accountId).reduce((s, p) => s + p.amount, 0);
  }

  async registerPayout(accountId: string, date: string, amount: number, note?: string): Promise<void> {
    this.settings.payouts = this.settings.payouts || [];
    this.settings.payouts.push({
      id: "pay_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      accountId,
      date,
      amount,
      status: "paid",
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

  // ---- Deposits (personal accounts — own money) ----
  depositsFor(accountId: string): Deposit[] {
    return (this.settings.deposits || []).filter((d) => d.accountId === accountId).sort((a, b) => a.date.localeCompare(b.date));
  }

  accountDepositsTotal(accountId: string): number {
    return this.depositsFor(accountId).reduce((s, d) => s + d.amount, 0);
  }

  async registerDeposit(accountId: string, date: string, amount: number, note?: string): Promise<void> {
    this.settings.deposits = this.settings.deposits || [];
    this.settings.deposits.push({
      id: "dep_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      accountId,
      date,
      amount,
      note,
    });
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async removeDeposit(depositId: string): Promise<void> {
    this.settings.deposits = (this.settings.deposits || []).filter((d) => d.id !== depositId);
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
    // The pass is remembered before anything is moved: this date is what stops
    // the celebration from firing again if the eval comes back from the archive.
    if (!evalAcc.passedAt) {
      const program = getProgram(getFirm(evalAcc.firmId), evalAcc.programId);
      const size = program ? effectiveSize(getSize(program, evalAcc.size), evalAcc.rules) : null;
      evalAcc.passedAt =
        (await this.passedDateOf(evalAccountId, size?.target ?? 0)) || new Date().toISOString().slice(0, 10);
    }
    if (action === "keep") evalAcc.passKept = true;
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
    // Unique, so a second eval of the same firm/size never produces two
    // accounts with the same name sharing one another's trades.
    const fundedName = uniqueAccountName(
      evalAcc.name.replace(/eval|evaluation/gi, "").trim() + " Funded",
      (this.settings.propAccounts || []).map((a) => a.name),
    );
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
      createdAt: new Date().toISOString().slice(0, 10),
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

  /**
   * The day the eval actually crossed its target — the date the trader wants to
   * see ("passed on the 14th"), not the day they got round to archiving it.
   * Walks the account's own trades in order and returns "" if it cannot tell.
   */
  private async passedDateOf(accountId: string, target: number): Promise<string> {
    if (!(target > 0)) return "";
    const acc = this.settings.propAccounts.find((a) => a.id === accountId);
    if (!acc) return "";
    const trades = (await this.loadTrades())
      .filter((t) => {
        if (!Number.isFinite(t.pnl) || !t.date) return false;
        if (acc.createdAt && t.date < acc.createdAt) return false;
        const mapped = this.mappedAccount(t.account);
        if (mapped) return mapped.id === accountId;
        return (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
      })
      .sort((a, b) => (a.date + (a.entryTime ?? "")).localeCompare(b.date + (b.entryTime ?? "")));
    let cum = 0;
    for (const t of trades) {
      cum += t.pnl;
      if (cum >= target) return t.date;
    }
    return "";
  }

  /**
   * Connect an eval to a funded account that already exists — no account is
   * created, the two just remember each other. Used when the link was lost but
   * the funded is clearly there (same firm, program and size).
   */
  async linkEvalToFunded(evalAccountId: string, fundedAccountId: string): Promise<boolean> {
    const evalAcc = this.settings.propAccounts.find((a) => a.id === evalAccountId);
    const funded = this.settings.propAccounts.find((a) => a.id === fundedAccountId);
    if (!evalAcc || !funded || funded.id === evalAcc.id) return false;
    evalAcc.linkedFundedId = funded.id;
    funded.linkedEvalId = evalAcc.id;
    // The pass date is still worth keeping, even when the funded was created by hand.
    if (!evalAcc.passedAt) {
      const program = getProgram(getFirm(evalAcc.firmId), evalAcc.programId);
      const size = program ? effectiveSize(getSize(program, evalAcc.size), evalAcc.rules) : null;
      evalAcc.passedAt =
        (await this.passedDateOf(evalAccountId, size?.target ?? 0)) || funded.createdAt || new Date().toISOString().slice(0, 10);
    }
    await this.saveSettings();
    await this.reloadAllViews();
    return true;
  }

  /** Rename an account and re-index all its trades so nothing is lost. */
  async renameAccount(accountId: string, newName: string): Promise<number> {
    const acc = this.settings.propAccounts.find((a) => a.id === accountId);
    if (!acc) return 0;
    const oldName = acc.name;
    const clean = (newName || "").trim();
    if (!clean || clean === oldName) return 0;

    // Remember the old name so any note we couldn't rewrite still resolves here.
    this.settings.accountMappings = this.settings.accountMappings || {};
    this.settings.accountMappings[oldName] = accountId;
    // Keep the old name as an alias so older notes still resolve to this account.
    acc.aliases = acc.aliases || [];
    if (!acc.aliases.some((a) => a.trim().toLowerCase() === oldName.trim().toLowerCase())) {
      acc.aliases.push(oldName);
    }

    // Rewrite the `account` field on every trade that belongs to this account.
    let renamed = 0;
    const trades = await this.loadTrades();
    for (const t of trades) {
      const mapped = this.mappedAccount(t.account);
      const matches = mapped ? mapped.id === accountId : (t.account || "").trim().toLowerCase() === oldName.trim().toLowerCase();
      if (!matches) continue;
      if (await setTradeAccount(this.app, t.id, clean)) renamed++;
    }
    acc.name = clean;
    this.clearTradeCache();
    await this.saveSettings();
    await this.reloadAllViews();
    return renamed;
  }

  async removeAccount(accountId: string): Promise<void> {
    this.settings.propAccounts = this.settings.propAccounts.filter((a) => a.id !== accountId);
    // Also remove from archived
    this.settings.archivedAccounts = (this.settings.archivedAccounts || []).filter((a) => a.id !== accountId);
    // Remove related payouts and deposits
    this.settings.payouts = (this.settings.payouts || []).filter((p) => p.accountId !== accountId);
    this.settings.deposits = (this.settings.deposits || []).filter((d) => d.accountId !== accountId);
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async archiveAccount(accountId: string): Promise<void> {
    const acc = this.settings.propAccounts.find((a) => a.id === accountId);
    if (!acc) return;
    this.settings.archivedAccounts = this.settings.archivedAccounts || [];
    this.settings.archivedAccounts.push({ ...acc });
    this.settings.propAccounts = this.settings.propAccounts.filter((a) => a.id !== accountId);
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async unarchiveAccount(accountId: string): Promise<void> {
    const acc = (this.settings.archivedAccounts || []).find((a) => a.id === accountId);
    if (!acc) return;
    // Avoid id/name collisions with an account created since archiving.
    if (this.settings.propAccounts.some((a) => a.id === acc.id)) return;
    const restored = { ...acc };
    const taken = [
      ...this.settings.propAccounts.map((a) => a.name),
      ...(this.settings.archivedAccounts || []).filter((a) => a.id !== accountId).map((a) => a.name),
    ];
    restored.name = uniqueAccountName(restored.name, taken);
    this.settings.propAccounts.push(restored);
    this.settings.archivedAccounts = (this.settings.archivedAccounts || []).filter((a) => a.id !== accountId);
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // The first default order was Funded → … → Personal. Accounts that never
    // touched the Types tab still carry it, so they move to the new default
    // (personal first) on their own instead of needing a click.
    const legacyTypeOrder = ["funded", "live", "personal", "eval", "demo", "unknown"];
    if (
      Array.isArray(this.settings.accountTypeOrder) &&
      this.settings.accountTypeOrder.join(",") === legacyTypeOrder.join(",")
    ) {
      delete this.settings.accountTypeOrder;
    }
    // Same idea for the ledger's columns: the first default order put Time and
    // Print first, which read as noise next to the money. Only an untouched
    // order is replaced — anyone who moved a column keeps their layout (and the
    // Columns panel has a Reset to default for the rest).
    const legacyCols = ["image", "date", "symbol", "side", "qty", "entryexit", "hold", "r", "pnl", "setup", "review"];
    if (Array.isArray(this.settings.tradeLogColOrder) && this.settings.tradeLogColOrder.join(",") === legacyCols.join(",")) {
      delete this.settings.tradeLogColOrder;
    }
    this.applyTypePrefs();
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

  /** Keep lib/accountTypes in step with the saved preferences. */
  applyTypePrefs(): void {
    setTypePrefs({
      order: this.settings.accountTypeOrder,
      labels: this.settings.accountTypeLabels,
      colors: this.settings.accountTypeColors,
    });
  }

  async saveSettings() {
    this.applyTypePrefs();
    await this.saveData(this.settings);
  }
}
