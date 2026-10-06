import { App, Notice, Plugin, PluginManifest, type TAbstractFile, TFile, addIcon, normalizePath, type WorkspaceLeaf } from "obsidian";
import { AccountRule, DEFAULT_ACCOUNT_RULES, classifyAccount, futuresSpec } from "./futures";
import { PropAccount, Trade, Payout, Deposit, FeeAdjustment, AccountType, StrategyRecord } from "./types";
import { saveTrade, parseTradeFromMarkdown, deleteTradeFile, tradeFilename, tradeMonthPath, setTradeAccount, setTradeFields, updateTradeFields, updateTradeArrayFields, updateTradeScreenshots } from "./storage";
import { tradePoints } from "./lib/fills";
import { computeAccountMetrics } from "./lib/accountMetrics";
import { PROP_FIRMS, makeAccount, uniqueAccountName } from "./props";
import { resolveAccountView } from "./lib/accountRules";
import { firmLogoUrl } from "./lib/firmLogos";
import {
  buildLeg,
  crossSymbol,
  detachFollowers,
  effectiveCopyConfig,
  expandVirtualLegs,
  healDanglingCopiers,
  isActiveCopier,
  isLeg,
  isVirtualLeg,
  legBaseKey,
  membersForBase as copyMembersForBase,
  normalizeCopyPeriods,
  todayIso,
  uniqueTrades,
  unlinkCopier,
} from "./lib/copy";
import { generatedSiblings, mergeGeneratedIntoActual } from "./lib/copySupersession";
import { CopierMatchProposal, linkFollower, proposeMatchesForAccount, sameDecision } from "./lib/copyReconcile";
import { analyticsTrades, AnalyticsScope } from "./lib/scope";
import { accountBoundary, isTrackedTrade as isTrackedTradeOn, openingCapital, trackingStartOf } from "./lib/tracking";
import {
  BackupNote,
  BackupPayload,
  backupFilename,
  buildBackup,
} from "./lib/backup";
import { setTypePrefs } from "./lib/accountTypes";
import { setCurrencySymbol } from "./tz";
import { computeMaturity, MaturityInput, MaturityScore, Phase } from "./lib/maturity";
import { SettingsTab } from "./settings";
import { HOME_DEFAULT, WIDGET_ID_ALIASES } from "./views/dashboard";
import type { DashItem } from "./views/dashboard";
import { AccountDashboardView, ACCOUNT_DASH_VIEW_TYPE } from "./views/accountDashboard";
import { openAddTradeModal } from "./views/addTradeModal";
import { openImportCsvModal } from "./views/importUi";
import { openCopyMatchModal } from "./views/copyMatchModal";
import { TradeLogView, TRADE_LOG_VIEW_TYPE, type TradeLogNav } from "./views/tradeLogView";
import { AccountsListView, ACCOUNTS_LIST_VIEW_TYPE } from "./views/accountsListView";
import { TradeDetailView, TRADE_DETAIL_VIEW_TYPE } from "./views/tradeDetailView";
import { TradebookSidebarView, TRADEBOOK_SIDEBAR_VIEW_TYPE } from "./views/sidebarView";
import { HomeView, HOME_VIEW_TYPE } from "./views/homeView";
import { SetupsView, SETUPS_VIEW_TYPE } from "./views/setupsView";
import { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./views/printQueueView";
import { openTradeModal } from "./views/tradeModal";
import { buildDiagnostics, diagnosticsFilename } from "./lib/diagnostics";
import { allocatedKeys, netPnl } from "./lib/fees";
import { byEntryInstant } from "./lib/instant";
import { reviewStatus } from "./lib/review";
import type { RiskRules } from "./lib/risk";
import { BRAND_ICON_ID, BRAND_ICON_SVG } from "./lib/brand";
import { dateInZone, type PeriodId } from "./lib/periods";

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
  /** Schema version of `data.json`, for numbered idempotent migrations. */
  settingsVersion?: number;
  journalName: string;
  /** Home's named layouts. Each is a full grid; the active one is rendered.
   *  The migration seeds `Default` from HOME_DEFAULT (or the legacy single
   *  layout). An explicit `[]` means the user emptied that layout on purpose. */
  homeLayouts?: Record<string, DashItem[]>;
  /** Name of the Home layout currently rendered. */
  homeLayoutActive?: string;
  /** Legacy single Home layout (pre named layouts). Read once by the 5 → 6
   *  migration, then deleted. An explicit `[]` was a deliberate empty Home. */
  homeLayout?: DashItem[];
  /** Grid resolution the saved layout coordinates were written for. */
  gridCols: number;
  /** Column domains are stored per page so edits at narrow widths round-trip. */
  homeGridCols?: number;
  dashboardGridCols?: number;
  /** Master switch for UI animations (count-ups, transitions). */
  animations: boolean;
  /** Trade Log view preferences (persisted so they survive reloads). */
  /** Which breakdown tab the account page last used. */
  accountBreakdownTab?: string;
  /** Which tab the Home/Dashboard "Breakdown" widget last used (symbol/setup/order-type). */
  dashboardBreakdownTab?: string;
  /** Which tab the "Behavioral Tags" widget last used (Mistakes/Psychology). */
  dashboardTagsTab?: "mistakes" | "psychology";
  /** Home's account filters (multi). Empty = all. Persisted between reloads. */
  homeFilters?: { accountIds?: string[]; accountTypes?: string[] };
  /** Review tag suggestions the trader kept. Absent = the whole library. */
  reviewOptions?: { mistakes?: string[]; psychology?: string[] };
  /** Re-entry window, in minutes after a losing exit, that the process signals
   *  read (Home → Re-entry Behaviour, Tilt, Trends, account page). Tier B —
   *  changes the meaning of the numbers. Absent = the 15-minute default. */
  reentryWindowMinutes?: number;
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
      /** Read the picked accounts as "leave these out" instead of "only these". */
      accountExclude?: boolean;
      direction?: string;
      result?: string;
      /** Older builds stored one mistake/setup; read it once, then write the arrays. */
      mistake?: string;
      mistakes?: string[];
      /** Behavioral tags picked in the ledger's "Behavioral tags" section. */
      psychologies?: string[];
      review?: string;
      session?: string;
      accountType?: string;
      quality?: string | string[];
      period?: string;
      customFrom?: string;
      customTo?: string;
      search?: string;
      setup?: string;
      setups?: string[];
      /** Leave demo-account trades out of the ledger and its counts (Trade Log only). */
      excludeDemos?: boolean;
      /** Filter-state schema. 2 = demo accounts hidden by default. */
      version?: number;
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
  /** How sidebar items open views. */
  tabBehavior?: "replace" | "new";
  /** Show Saturday/Sunday columns in the Calendar widget (off by default). */
  showWeekends?: boolean;
  /** Sidebar layout the user shaped in "Customize": which pages they hid,
   *  which optional pages they pinned, and the order they dragged them into. */
  sidebar?: {
    hidden?: string[];
    pinned?: string[];
    order?: string[];
  };
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
  /** Accounts page: how accounts are grouped. Remembered between sessions. */
  accountsGroupBy?: "type" | "firm" | "firm-type" | "copy";
  // ---- Maturity / phase (stage 1: measure only, nothing hidden) ----
  /** "auto" (default) or a manual override that always wins. */
  maturityPhaseOverride?: Phase | "auto";
  /** Last computed snapshot, cached so the settings UI stays synchronous. */
  maturity?: MaturityScore;
  // ---- Formatting ----
  /** First day of the week for periods and the calendar. Default: Monday. */
  weekStart?: "monday" | "sunday";
  dateFormat?: string;
  use24HourTime?: boolean;
  showSeconds?: boolean;
  // ---- Trading defaults ----
  defaultSymbol?: string;
  defaultRisk?: number;
  /** Risk per contract for the symbols whose import holds no stop of its own.
   *  Written as a stand-in and labelled `stopSource: "assumed"` — the journal
   *  reports the rule and the trade, it does not pretend the rule is a stop.
   *  See `lib/risk.ts`. */
  defaultRiskBySymbol?: RiskRules;
  // ---- Editable lists ----
  /** Legacy strategy registry (bare names). Read for compatibility; the
   *  source of truth is now `strategies` (records with stable ids). */
  setups?: string[];
  /** Registered strategies — a stable id plus the human name. */
  strategies?: StrategyRecord[];
  /** Period the Home and Trade Log open with, before you pick another. */
  defaultPeriod?: PeriodId;
  accountRules: AccountRule[];
  /** The journal's zone: the wall-clock every trade is shown in (default NY ET). */
  timeZone: string;
  /** Source zone for naive CSV exports. Empty = auto-detect/ask at import. */
  importZone?: string;
  propAccounts: PropAccount[];
  archivedAccounts: PropAccount[];
  payouts: Payout[];
  deposits: Deposit[];
  /** Balance corrections: the platform's figure against the journal's, dated. */
  feeAdjustments: FeeAdjustment[];
  accountMappings: Record<string, string>;
  /** One-off migration flag: legacy notes that carried a broker/export account
   *  name were rewritten to the account's friendly name. */
  accountNamesNormalized?: boolean;
  /** One-off migration flag: broker-only accounts present in the vault were
   *  adopted as real accounts and accountMappings keys became aliases. */
  brokerAccountsAdopted?: boolean;
  theme: ThemeSettings;
}

/** Current `data.json` schema version. Bump when adding a numbered migration. */
const SETTINGS_VERSION = 7;

/** A strategy name reduced to a safe vault filename. The name itself is kept
 *  verbatim on the record; this is only the file it is filed under. */
function sanitizeFilename(name: string): string {
  return (name || "")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "strategy";
}

/** `value?.stack`, but only when the host actually left a string there. The
 *  DOM types `ErrorEvent.error` / `PromiseRejectionEvent.reason` as `any`, so
 *  the value is whatever was thrown — read it, never trust it. */
function stackOf(value: unknown): string | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  return "stack" in value && typeof value.stack === "string" ? value.stack : undefined;
}

/** `value?.message`, under the same rule as {@link stackOf}. */
function messageOf(value: unknown): string | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  return "message" in value && typeof value.message === "string" ? value.message : undefined;
}

/** `String(value)` for a value the host handed us whole — a DOM event, a
 *  rejection reason. Whatever it stringifies to is what the report carries. */
function textOf(value: unknown): string {
  return String(value);
}

/** A leaf's view, as the plugin calls it. Not every view in this plugin draws
 *  itself the same way, so the shape is checked, never assumed. */
interface Refreshable {
  refresh: () => Promise<void> | void;
}

/** The fallback drawing every view here also answers to. */
interface Renderable {
  render: () => void;
}

/** What a caller hands over: the id, and where the user came from. The trade
 *  itself is re-read from disk — and when it is not there, this stub is what
 *  the detail page opens with, exactly as before. */
type TradeRef = { id: string; from?: { type: "tradelog" | "account"; accountId?: string; tradeIds?: string[] } };

/** The Trade Detail's own entry point, called after the leaf is revealed. It
 *  takes the ref too: a trade whose note is gone still opens the page. */
interface TradeSetter {
  setTrade: (trade: Trade | TradeRef) => Promise<void> | void;
}

/** True for a view that can refresh itself. */
function isRefreshable(v: unknown): v is Refreshable {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  return "refresh" in v && typeof v.refresh === "function";
}

/** True for a view that can draw itself. */
function isRenderable(v: unknown): v is Renderable {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  return "render" in v && typeof v.render === "function";
}

/** True for a view that takes a trade to show. */
function isSettable(v: unknown): v is TradeSetter {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  return "setTrade" in v && typeof v.setTrade === "function";
}

/** The Trade Log's navigation surface — how this plugin drives that view.
 *  `filterByTradeIds` is the one method that tells a mounted Trade Log from
 *  the placeholder Obsidian hands back first; the rest are that same view's,
 *  reached only through it. */
type TradeLogLens = Pick<TradeLogView, "filterByDay" | "filterByAccount" | "filterByTradeIds" | "scopeFromBreakdown" | "navigate">;

/** True for a mounted Trade Log view. */
function isTradeLogLens(v: unknown): v is TradeLogLens {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  return "filterByTradeIds" in v && typeof v.filterByTradeIds === "function";
}

/** True for a lens that can also take a breakdown tile's scope. */
function isBreakdownScopeable(v: unknown): v is Pick<TradeLogView, "scopeFromBreakdown"> {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  return "scopeFromBreakdown" in v && typeof v.scopeFromBreakdown === "function";
}

/** True for a lens that can take a widget's navigation. */
function isNavigable(v: unknown): v is Pick<TradeLogView, "navigate"> {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  return "navigate" in v && typeof v.navigate === "function";
}

/** A leaf as this plugin touches it: Obsidian's `WorkspaceLeaf`, plus the two
 *  fields the harness leaves on its leaves — `detached` and `contentEl` — which
 *  are read defensively because a host may not carry them. */
type JournalLeaf = WorkspaceLeaf & { detached?: boolean; contentEl?: unknown };

/** A plain object — not null, not an array, not a primitive. The shape a JSON
 *  file must have before any of its keys are read back. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An account as a pre-`type` file wrote it: `scope` and `live` are the legacy
 *  keys the load-time migration folds in, and `type` is whatever string the
 *  file carried — normally an `AccountType`, but the migration copies `scope`
 *  across without checking what it is. */
type LegacyAccount = Omit<PropAccount, "type"> & { type?: string; scope?: string; live?: boolean };

/** Settings as a pre-7 file wrote them. `tradeLogPeriod` and the dropped keys
 *  are no longer on `TradebookSettings`; folding the first and deleting the
 *  rest is the whole job of the migration that reads this. `defaultPeriod` is
 *  the `PeriodId` the plugin understands, widened to whatever string the old
 *  file held — that value is carried across as it is, never re-checked. */
type LegacySettings = Omit<TradebookSettings, "defaultPeriod"> & { defaultPeriod?: string; tradeLogPeriod?: string };

const DEFAULT_SETTINGS: TradebookSettings = {
  tradesFolder: "Tradebook",
  journalName: "",
  gridCols: 12,
  homeGridCols: 24,
  homeLayouts: {},
  homeLayoutActive: "Default",
  animations: true,
  tradeLog: {},
  currency: "$",
  openHomeOnStartup: false,
  tabBehavior: "replace",
  showWeekends: false,
  reentryWindowMinutes: 15,
  sidebar: {},
  privacyMode: false,
  includeCopiesInPortfolioAnalytics: false,
  accountsSort: "name",
  accountsShowLogo: true,
  accountsShowArchived: true,
  accountsChartPeriod: "all",
  accountTypeLabels: {},
  accountTypeColors: {},
  accountTypeOrder: ["personal", "live", "funded", "eval", "demo", "unknown"],
  excludeDemosFromPortfolio: true,
  accountsGroupBy: "type",
  maturityPhaseOverride: "auto",
  dateFormat: "YYYY-MM-DD",
  use24HourTime: true,
  showSeconds: true,
  defaultSymbol: "",
  defaultRisk: 200,
  setups: [],
  strategies: [],
  copyGroups: [],
  weekStart: "monday",
  defaultPeriod: "all",
  accountRules: [],
  timeZone: "America/New_York",
  importZone: "",
  propAccounts: [],
  archivedAccounts: [],
  payouts: [],
  deposits: [],
  feeAdjustments: [],
  accountMappings: {},
  theme: { preset: "default", background: "default", accent: "", dotColor: "", surface: "", bg: "", bg2: "", border: "", pattern: "none", font: "sans", glow: false },
};

const ALL_VIEW_TYPES = [
  HOME_VIEW_TYPE,
  ACCOUNT_DASH_VIEW_TYPE,
  ACCOUNTS_LIST_VIEW_TYPE,
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

/** Firm logos are packaged in `lib/firmLogos.ts`, embedded as data URIs at build
 *  time so BRAT and community-store installs (which only download `main.js`,
 *  `manifest.json` and `styles.css`) still get them. */

export default class TradebookPlugin extends Plugin {
  settings: TradebookSettings;
  /** Home period is session-only; it deliberately never enters data.json. */
  briefingPeriodState: { period: PeriodId; customFrom: string; customTo: string; calendarMonth: string; calendarManual: boolean } = {
    period: "all",
    customFrom: "",
    customTo: "",
    calendarMonth: "",
    calendarManual: false,
  };

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    // Never restore the Home period from plugin settings/workspace state.
    // Reinitializing here also covers a host that reloads this instance.
    this.briefingPeriodState = {
      period: "all",
      customFrom: "",
      customTo: "",
      calendarMonth: "",
      calendarManual: false,
    };
    await this.loadSettings();
    addIcon(BRAND_ICON_ID, BRAND_ICON_SVG);

    // Keep the last uncaught error so a bug report can carry it:
    // Settings → Advanced → Diagnostics.
    this.registerDomEvent(window, "error", (ev) => {
      this._lastError = stackOf(ev.error) || ev.message || textOf(ev);
    });
    this.registerDomEvent(window, "unhandledrejection", (ev) => {
      const reason: unknown = ev.reason;
      this._lastError = stackOf(reason) || messageOf(reason) || String(reason);
    });

    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));
    this.registerView(SETUPS_VIEW_TYPE, (leaf) => new SetupsView(leaf, this));
    this.registerView(PRINT_QUEUE_VIEW_TYPE, (leaf) => new PrintQueueView(leaf, this));
    this.registerView(ACCOUNT_DASH_VIEW_TYPE, (leaf) => new AccountDashboardView(leaf, this));
    this.registerView(TRADE_LOG_VIEW_TYPE, (leaf) => new TradeLogView(leaf, this));
    this.registerView(ACCOUNTS_LIST_VIEW_TYPE, (leaf) => new AccountsListView(leaf, this));
    this.registerView(TRADE_DETAIL_VIEW_TYPE, (leaf) => new TradeDetailView(leaf, this));
    this.registerView(TRADEBOOK_SIDEBAR_VIEW_TYPE, (leaf) => new TradebookSidebarView(leaf, this));

    this.addRibbonIcon("grip", "Tradebook — home", () => {
      void this.openHome();
    });
    this.addRibbonIcon("wallet", "Tradebook — accounts", () => {
      void this.openAccounts();
    });
    this.addRibbonIcon("list", "Tradebook — trade log", () => {
      void this.openTradeLog();
    });
    this.addRibbonIcon("plus", "Tradebook — manual trade", () => {
      this.openAddPanel();
    });

    this.addCommand({
      id: "open-home",
      name: "Open home",
      callback: () => this.openHome(),
    });
    this.addCommand({
      id: "open-accounts",
      name: "Open accounts",
      callback: () => this.openAccounts(),
    });
    this.addCommand({
      id: "open-trade-log",
      name: "Open trade log",
      callback: () => this.openTradeLog(),
    });
    this.addCommand({
      id: "add-trade",
      name: "Manual trade",
      callback: () => this.openAddPanel(),
    });
    this.addCommand({
      id: "import-csv",
      name: "Import trades from CSV",
      callback: () => this.openImport(),
    });
    this.addCommand({
      id: "review-copy-matches",
      name: "Review real fills for copy matches",
      callback: () => this.openCopyMatches(),
    });

    this.addCommand({
      id: "open-sidebar-menu",
      name: "Open menu (left sidebar)",
      callback: () => this.openSidebarView(),
    });

    this.addCommand({
      id: "open-print-queue",
      name: "Open print queue (right sidebar)",
      callback: () => this.ensurePrintQueueLeaf(),
    });

    this.addSettingTab(new SettingsTab(this.app, this));

    // Keep the parsed-trade index in step with edits made outside the plugin.
    const vault = this.app.vault;
    if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function") {
      const invalidate = (file: TAbstractFile): void => {
        if (file?.path && this.isTradeNotePath(file.path)) {
          this._tradeCache.delete(file.path);
          this.scheduleReloadAllViews();
        }
      };
      this.registerEvent(vault.on("modify", invalidate));
      this.registerEvent(vault.on("create", invalidate));
      this.registerEvent(vault.on("delete", invalidate));
      this.registerEvent(vault.on("rename", (file, oldPath: string) => {
        if (oldPath) this._tradeCache.delete(oldPath);
        invalidate(file);
      }));
    }

    // Workspace APIs are optional — some mock/host environments may lack them.
    if (typeof this.app.workspace.onLayoutReady === "function") {
      this.app.workspace.onLayoutReady(async () => {
        try {
          await this.runMigrations();
        } catch (err) {
          console.error("[tradebook] settings migration failed:", err);
        }
        try {
          await this.loadTradeCache();
        } catch (err) {
          console.warn("[tradebook] trade index load failed:", err);
        }
        try {
          await this.runAccountMaintenance();
        } catch (err) {
          console.error("[tradebook] account maintenance failed:", err);
        }
        await this.ensureSidebarLeaf();
        await this.ensurePrintQueueLeaf();
        await this.cleanupLegacyCache();
        // The journal's default period seeds Home's session period on load.
        this.briefingPeriodState.period = this.settings.defaultPeriod ?? "all";
        if (this.settings.openHomeOnStartup) await this.openHome();
      });
    }
  }

  onunload(): void {
    // Drop pending timers so a disabled or reloaded plugin leaves nothing running.
    if (this._cacheSaveTimer) window.clearTimeout(this._cacheSaveTimer);
    if (this._reloadTimer) window.clearTimeout(this._reloadTimer);
  }

  private _journalLeaf: JournalLeaf | null = null;
  private _celebrationDismissed = new Set<string>();
  /** Last uncaught error this session (window error / unhandled rejection). */
  private _lastError = "";

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
    const adapter = this.app.vault.adapter;
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
  getJournalLeaf(): JournalLeaf {
    // "New tab" behaviour: always hand back a fresh main-area tab.
    if (this.settings.tabBehavior === "new") {
      const fresh = this.app.workspace.getLeaf("tab");
      if (fresh) return fresh;
    }
    const inMainArea = (leaf: JournalLeaf | null): boolean => {
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

  /**
   * Open/reveal a page in its own main-area tab, reusing the tab if that page
   * is already open, so a view is never torn down and rebuilt needlessly.
   */
  private async openViewTab(viewType: string): Promise<void> {
    const inMainArea = (leaf: JournalLeaf | null): boolean => {
      try {
        if (!leaf) return false;
        if (typeof leaf.getRoot === "function") return leaf.getRoot() === this.app.workspace.rootSplit;
        return !!leaf.contentEl;
      } catch {
        return false;
      }
    };
    const existing = this.app.workspace.getLeavesOfType(viewType).filter(inMainArea);
    if (existing.length) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: viewType, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openHome(leaf?: JournalLeaf) {
    if (leaf) {
      await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
      return;
    }
    // Same leaf the other pages use, so "Open views in: New tab" applies here too.
    const target = this.getJournalLeaf();
    await target.setViewState({ type: HOME_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openSetups(leaf?: JournalLeaf) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: SETUPS_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openAccounts(leaf?: JournalLeaf) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: ACCOUNTS_LIST_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openTradeLog(leaf?: JournalLeaf): Promise<JournalLeaf> {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: TRADE_LOG_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(target);
    return target;
  }

  /** Opens the Add Trade form in a modal, from whatever page you are on. */
  openAddPanel() {
    openAddTradeModal(this, () => void this.reloadAllViews());
  }

  /** Opens the CSV import in a modal; it reports what it recognised and saves. */
  openImport() {
    openImportCsvModal(this, () => void this.reloadAllViews());
  }

  /** Opens the Trade Log pre-filtered to a single day (used by Calendar). */
  async openTradeLogForDay(dateKey: string) {
    const view = await this.scopedTradeLogView();
    if (view) view.filterByDay(dateKey);
  }

  /** Opens the Trade Log filtered to one account (used from an account page). */
  async openTradeLogForAccount(accountId: string) {
    const view = await this.scopedTradeLogView();
    if (view) view.filterByAccount(accountId);
  }

  /** Opens the Trade Log holding exactly these trades (used after an import). */
  async openTradeLogForIds(ids: string[]) {
    const view = await this.scopedTradeLogView();
    if (view) view.filterByTradeIds(ids);
  }

  /**
   * Opens the Trade Log as a lens from a Home/Dashboard breakdown tile: the tile
   * predicate plus the scope the grid was read in (period, dates, account class).
   */
  async openTradeLogForBreakdown(
    label: string,
    test: (t: Trade) => boolean,
    scope: {
      period?: string;
      customFrom?: string;
      customTo?: string;
      dateBounds?: { start: string; end: string; label: string };
      accountId?: string | null;
      accountType?: string;
    }
  ) {
    const view = await this.scopedTradeLogView();
    if (isBreakdownScopeable(view)) view.scopeFromBreakdown(label, test, scope);
  }

  /**
   * Explicit, widget-driven navigation into the Trade Log: reset stale filters,
   * apply the source scope (period/account/class) and the action filter. Manual
   * `openTradeLog()` keeps the user's previous Trade Log untouched.
   */
  async openTradeLogView(nav: TradeLogNav) {
    const view = await this.scopedTradeLogView();
    if (isNavigable(view)) view.navigate(nav);
  }

  /**
   * The Trade Log view, once it is really there. Obsidian may hand back a
   * DeferredView until the leaf is visible, and a scoped open against it fails
   * silently — so reveal first, then wait for the real view.
   */
  private async scopedTradeLogView(): Promise<TradeLogLens | null> {
    // Filter the view that was just revealed, never "the first Trade Log leaf":
    // with more than one Trade Log tab open, [0] can be a different one and the
    // day/account filter would land on a view the user is not looking at.
    const leaf = await this.openTradeLog();
    for (let i = 0; i < 10; i++) {
      const candidate: unknown = leaf?.view;
      if (isTradeLogLens(candidate)) return candidate;
      await new Promise((r) => window.setTimeout(r, 20));
    }
    // Last resort: any Trade Log leaf, in case the revealed one never mounted.
    const leaves = this.app.workspace.getLeavesOfType(TRADE_LOG_VIEW_TYPE);
    const view: unknown = leaves.length ? leaves[0].view : null;
    return isTradeLogLens(view) ? view : null;
  }

  async openAccountDashboard(leaf: JournalLeaf | undefined, accountId: string) {
    const target = leaf ?? this.getJournalLeaf();
    await target.setViewState({ type: ACCOUNT_DASH_VIEW_TYPE, state: { accountId }, active: true });
    await this.app.workspace.revealLeaf(target);
  }

  async openTradeModal(trade: Trade) {
    const trades = await this.loadTrades();
    const full = trades.find((t) => t.id === trade.id) ?? trade;
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
      const leftLeaf = this.app.workspace.getLeftLeaf?.(true);
      if (!leftLeaf) return false;
      await leftLeaf.setViewState({ type: TRADEBOOK_SIDEBAR_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leftLeaf);
      return true;
    };
    if (await tryOnce()) return true;
    await new Promise((r) => window.setTimeout(r, 800));
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
      const rightLeaf = this.app.workspace.getRightLeaf?.(true);
      if (!rightLeaf) return false;
      await rightLeaf.setViewState({ type: PRINT_QUEUE_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(rightLeaf);
      return true;
    };
    if (await tryOnce()) return true;
    await new Promise((r) => window.setTimeout(r, 800));
    return await tryOnce();
  }

  /** Where the trade detail was opened from (so "Back" returns there). */
  tradeDetailOrigin: { type: "tradelog" | "account"; accountId?: string; tradeIds?: string[] } = { type: "tradelog" };

  async openTradeDetail(trade: TradeRef) {
    this.tradeDetailOrigin = trade.from ?? { type: "tradelog" };
    const trades = await this.loadTradesExpanded();
    let full = trades.find((t) => t.id === trade.id);
    // Virtual legs have no file — open their base trade instead.
    if (full && isVirtualLeg(full)) {
      const base = trades.find((t) => !isLeg(t) && legBaseKey(t) === legBaseKey(full!));
      if (base) {
        full = base;
        if (this.tradeDetailOrigin.type === "tradelog" && this.tradeDetailOrigin.tradeIds) {
          this.tradeDetailOrigin.tradeIds = this.tradeDetailOrigin.tradeIds.map((id) => id === trade.id ? base.id : id);
        }
      }
    }
    const resolved: Trade | TradeRef = full ?? trade;
    const target = this.getJournalLeaf();
    await target.setViewState({
      type: TRADE_DETAIL_VIEW_TYPE,
      // The origin travels in the state so a reload keeps the review scoped.
      state: { tradeId: resolved.id, from: this.tradeDetailOrigin },
      active: true,
    });
    await this.app.workspace.revealLeaf(target);
    const leaves = this.app.workspace.getLeavesOfType(TRADE_DETAIL_VIEW_TYPE);
    const view = leaves.length ? leaves[0].view : null;
    if (isSettable(view)) {
      await view.setTrade(resolved);
    }
  }

  getTradesFolder(): string {
    return normalizePath(this.settings.tradesFolder || "Tradebook");
  }

  /** `<root>/<year>/attachments` — where a trade's screenshots live. */
  getAttachmentsFolder(date?: string): string {
    const m = /^(\d{4})-/.exec(date || "");
    // Fall back to the journal's own year, never the host clock.
    const year = m ? m[1] : dateInZone(this.settings.timeZone).slice(0, 4);
    return normalizePath(`${this.getTradesFolder()}/${year}/attachments`);
  }

  /**
   * Candidate vault paths for an image linked from a trade note. New notes store
   * a bare filename resolved against the trade's own year; the legacy shapes
   * stay so screenshots attached before the folder change keep showing.
   */
  attachmentCandidates(target: string, date?: string): string[] {
    const root = this.getTradesFolder();
    const year = /^(\d{4})-/.exec(date || "")?.[1];
    const out: string[] = [`${this.getAttachmentsFolder(date)}/${target}`, `${root}/${target}`];
    if (year) out.push(`${root}/${year}/attachments/${target}`);
    out.push(
      `${root}/prints/${target}`,
      `Tradebook/trades/prints/${target}`,
      `Tradebook/trades/${target}`,
      `Tradebook/prints/${target}`,
      `Tradebook/${target}`
    );
    return out;
  }

  /** Create a folder and any missing parents (Obsidian's createFolder needs them). */
  async ensureVaultFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch {
          // Raced with another writer — the folder is there either way.
        }
      }
    }
  }

  /**
   * Every strategy name in use — the registry (settings.strategies, plus the
   * legacy settings.setups names) merged with the names the notes already carry.
   * The registry lets a strategy exist before its first trade; the notes make
   * sure nothing in the vault is ever orphaned. Compared case-insensitively,
   * first spelling wins.
   */
  async knownSetups(): Promise<string[]> {
    const seen = new Map<string, string>();
    const push = (raw?: string) => {
      const clean = (raw || "").trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    };
    for (const s of this.settings.strategies || []) push(s.name);
    for (const s of this.settings.setups || []) push(s);
    try {
      const trades = await this.loadTrades();
      for (const t of trades) push(t.setup);
    } catch {
      /* notes unreadable mid-startup — the registry is still returned */
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  /** The registry record for a name, if one exists (case-insensitive). */
  findStrategy(name: string): StrategyRecord | undefined {
    const key = (name || "").trim().toLowerCase();
    return (this.settings.strategies || []).find((s) => s.name.trim().toLowerCase() === key);
  }

  /**
   * Register a strategy: a record with a stable id, and a note in the vault
   * (`<root>/library/strategies/<name>.md`) so its future rules and docs live in
   * a file the trader owns. Trade notes keep the plain name in `setup`.
   */
  async addStrategy(name: string): Promise<string> {
    const clean = (name || "").trim();
    if (!clean) return "";
    const list = (this.settings.strategies ??= []);
    const existing = list.find((s) => s.name.trim().toLowerCase() === clean.toLowerCase());
    if (existing) return existing.name;
    const rec: StrategyRecord = {
      id: "st_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: clean,
      createdAt: new Date().toISOString(),
    };
    list.push(rec);
    list.sort((a, b) => a.name.localeCompare(b.name));
    await this.saveSettings();
    await this.writeStrategyNote(rec);
    return clean;
  }

  /** Back-compat alias — every registration point behaves the same. */
  async addSetup(name: string): Promise<string> {
    return this.addStrategy(name);
  }

  /**
   * Remove a strategy from the registry. The vault note is deliberately kept —
   * we never destroy content — and so is every trade's `setup` value. The UI
   * advises a rename when the trades should follow; a name still carried by
   * notes simply shows up as untracked.
   */
  async removeStrategy(name: string): Promise<void> {
    const key = (name || "").trim().toLowerCase();
    let dirty = false;
    const list = this.settings.strategies || [];
    const next = list.filter((s) => s.name.trim().toLowerCase() !== key);
    if (next.length !== list.length) {
      this.settings.strategies = next;
      dirty = true;
    }
    const legacy = this.settings.setups || [];
    const legacyNext = legacy.filter((s) => (s || "").trim().toLowerCase() !== key);
    if (legacyNext.length !== legacy.length) {
      this.settings.setups = legacyNext;
      dirty = true;
    }
    if (dirty) await this.saveSettings();
  }

  /** Back-compat alias. */
  async removeSetup(name: string): Promise<void> {
    return this.removeStrategy(name);
  }

  /**
   * Rename a strategy everywhere: the registry record (its id never changes),
   * the legacy registry, the vault note, and every trade note that carries the
   * old name (copy legs included). This is why a rename has to be a first-class
   * action — the notes are the source of truth, so the name lives in many files.
   */
  async renameSetup(oldName: string, newName: string): Promise<number> {
    const from = (oldName || "").trim();
    const to = (newName || "").trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return 0;

    let touched = false;
    const rec = this.findStrategy(from);
    if (rec) {
      rec.name = to;
    } else {
      // The name was never registered — register it under the new spelling.
      (this.settings.strategies ??= []).push({
        id: "st_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: to,
        createdAt: new Date().toISOString(),
      });
    }
    (this.settings.strategies ??= []).sort((a, b) => a.name.localeCompare(b.name));

    const legacy = this.settings.setups || [];
    for (let i = 0; i < legacy.length; i++) {
      if ((legacy[i] || "").trim().toLowerCase() === from.toLowerCase()) {
        legacy[i] = to;
        touched = true;
      }
    }
    if (!legacy.some((s) => (s || "").trim().toLowerCase() === to.toLowerCase())) {
      legacy.push(to);
      touched = true;
    }
    legacy.sort((a, b) => a.localeCompare(b));
    if (touched) await this.saveSettings();

    await this.renameStrategyNote(from, to);

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

  // ------------------------------------------------------------- strategies --

  private strategyNoteDir(): string {
    return normalizePath(`${this.getTradesFolder()}/library/strategies`);
  }

  private strategyNotePath(name: string): string {
    return normalizePath(`${this.strategyNoteDir()}/${sanitizeFilename(name)}.md`);
  }

  /** Write the vault note for a freshly registered strategy. Never overwrites. */
  private async writeStrategyNote(rec: StrategyRecord): Promise<void> {
    const dir = this.strategyNoteDir();
    await this.ensureVaultFolder(dir);
    const path = this.strategyNotePath(rec.name);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const body =
      `---\ntype: strategy\nid: ${rec.id}\nname: "${rec.name.replace(/"/g, '\\"')}"\ncreatedAt: ${rec.createdAt}\n---\n\n` +
      `# ${rec.name}\n\n` +
      `> The rules, notes and readiness for this strategy live in this note. ` +
      `Trades reference it by name; everything here is yours to fill in.\n`;
    try {
      await this.app.vault.create(path, body);
    } catch (err) {
      console.error("[tradebook] could not create the strategy note", path, err);
    }
  }

  /** Follow a rename into the note's filename (Obsidian updates the links). */
  private async renameStrategyNote(from: string, to: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.strategyNotePath(from));
    if (!(file instanceof TFile)) return;
    const target = this.strategyNotePath(to);
    if (this.app.vault.getAbstractFileByPath(target)) return;
    try {
      const fm = this.app.fileManager;
      if (fm && typeof fm.renameFile === "function") await fm.renameFile(file, target);
      else await this.app.vault.rename(file, target);
    } catch (err) {
      console.error("[tradebook] strategy note rename failed", from, err);
    }
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

  /** The tracking boundary for a stored account label ("" = no boundary). */
  trackingStartOfLabel(label: string): string {
    return trackingStartOf(this.mappedAccount(label || ""));
  }

  /**
   * True when a trade is inside its account's tracked population. A trade before
   * its account's "Start Tracking From Here" boundary is real history, but it is
   * not counted in analytics. No boundary means every trade is tracked, exactly
   * as before.
   */
  isTrackedTrade(t: Trade): boolean {
    return isTrackedTradeOn(t, this.trackingStartOfLabel(t.account || ""));
  }

  /** The account value at the tracking boundary — the value anchor. */
  openingCapitalOf(accountId: string): number {
    const all = [...(this.settings.propAccounts || []), ...(this.settings.archivedAccounts || [])];
    return openingCapital(all.find((a) => a.id === accountId));
  }

  /** The accounts still in play. The archive is a shelf, not a balance. */
  activeAccounts(): PropAccount[] {
    return this.settings.propAccounts;
  }

  /**
   * The Trade Log's selection, and whether selection mode is on. Both live here,
   * not on the view: a multi-select is a piece of work in progress, and letting it
   * die because a leaf rebuilt — or because the reader opened a trade to check
   * something — is the fastest way to make nobody use it.
   */
  tradeLogSelection: Set<string> = new Set<string>();
  tradeLogSelectMode = false;

  /**
   * True when a trade belongs to an account the trader has archived. An
   * archived account is out of every total, metric and balance — but its notes
   * stay in the vault and stay listed in the Trade Log and Strategies.
   */
  isArchivedTrade(t: Trade): boolean {
    const archived = this.settings.archivedAccounts || [];
    if (!archived.length) return false;
    const name = (t.account || "").trim();
    if (!name) return false;
    const lower = name.toLowerCase();
    const maps = this.settings.accountMappings || {};
    let id: string | undefined = maps[name];
    if (!id) {
      for (const [k, v] of Object.entries(maps)) {
        if (k.trim().toLowerCase() === lower) {
          id = v;
          break;
        }
      }
    }
    if (id && archived.some((a) => a.id === id)) return true;
    return archived.some(
      (a) =>
        (a.name || "").trim().toLowerCase() === lower ||
        (a.aliases || []).some((al) => (al || "").trim().toLowerCase() === lower)
    );
  }

  /** The first configured account. */
  getPrimaryAccount(): PropAccount | undefined {
    const accounts = this.settings.propAccounts || [];
    return accounts.length > 0 ? accounts[0] : undefined;
  }

  /** Data-URI for a packaged firm/broker logo (see `lib/firmLogos.ts`).
   *  Returns null for names without a file (caller falls back to initials). */
  firmLogoUrl(firmId: string): string | null {
    return firmLogoUrl(firmId);
  }

  /** Load all trade notes from the configured folder into Trade objects. */
  private _tradeCache = new Map<string, { mtime: number; trade: Trade }>();
  private _cacheSaveTimer = 0;
  private _reloadTimer = 0;

  /** Where the persisted parsed-trade index lives (a cache, safe to delete).
   *  It lives with the plugin, not in the vault: it is derived data, not the
   *  journal, so the vault only ever shows the journal and its backups. */
  private tradeCachePath(): string {
    return normalizePath(`${this.pluginDataDir()}/cache/trades.json`);
  }

  private isTradeNotePath(path: string): boolean {
    const folder = this.getTradesFolder();
    if (!path.endsWith(".md")) return false;
    if (!path.startsWith(folder + "/")) return false;
    if (path.startsWith(`${folder}/_tradebook/`) || path.startsWith(`${folder}/library/`)) return false;
    return true;
  }

  /**
   * Load the on-disk index so opening a dashboard does not have to read and
   * parse every trade note. Entries carry the file mtime; anything changed on
   * disk is re-read on the next `loadTrades()`.
   */
  async loadTradeCache(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.tradeCachePath();
    try {
      if (typeof adapter?.exists !== "function" || !(await adapter.exists(path))) return;
      const raw = await adapter.read(path);
      // The index is data we wrote, read back from disk: `unknown` until the
      // shape is checked. `entry.trade` is the one place the JSON is taken on
      // faith, as a Trade — it was written by `saveTradeCache` from a Trade.
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) return;
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (isRecord(entry) && typeof entry.mtime === "number" && entry.trade && this.isTradeNotePath(key)) {
          this._tradeCache.set(key, { mtime: entry.mtime, trade: entry.trade as Trade });
        }
      }
    } catch (err) {
      console.warn("[tradebook] trade index load failed:", err);
    }
  }

  private scheduleSaveTradeCache(): void {
    if (this._cacheSaveTimer) return;
    this._cacheSaveTimer = window.setTimeout(() => {
      this._cacheSaveTimer = 0;
      void this.saveTradeCache();
    }, 1500);
  }

  private async saveTradeCache(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.tradeCachePath();
    const dir = normalizePath(`${this.pluginDataDir()}/cache`);
    try {
      if (!adapter || typeof adapter.write !== "function") return;
      if (typeof adapter.mkdir === "function" && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      const entries: Record<string, { mtime: number; trade: Trade }> = {};
      for (const [key, value] of this._tradeCache) entries[key] = value;
      await adapter.write(path, JSON.stringify({ version: 1, entries }));
    } catch (err) {
      console.warn("[tradebook] trade index save failed:", err);
    }
  }

  /** Coalesce vault-write reactions into one refresh a moment later. */
  scheduleReloadAllViews(): void {
    if (typeof window === "undefined") return;
    if (this._reloadTimer) window.clearTimeout(this._reloadTimer);
    this._reloadTimer = window.setTimeout(() => {
      this._reloadTimer = 0;
      void this.reloadAllViews();
    }, 250);
  }


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
          const printsDir = this.getAttachmentsFolder(p.date);
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

  /**
   * Explicit reconciliation — PROPOSE. Reads the journal and returns the real
   * follower fills whose leader trade is known. Pure: it writes nothing. The
   * trader confirms each one before `applyCopierMatch` touches a note.
   */
  async proposeCopierMatches(): Promise<CopierMatchProposal[]> {
    const accounts = this.settings.propAccounts || [];
    if (!accounts.length) return [];
    const trades = await this.loadTrades();
    const out: CopierMatchProposal[] = [];
    for (const acc of accounts) {
      if (acc.copyRole !== "copier" || !acc.copyBaseId) continue;
      const base = accounts.find((a) => a.id === acc.copyBaseId);
      if (!base) continue;
      const baseTrades = trades.filter((t) => !isLeg(t) && this.mappedAccount(t.account)?.id === base.id);
      const followerTrades = trades.filter((t) => !isLeg(t) && this.mappedAccount(t.account)?.id === acc.id);
      if (!baseTrades.length || !followerTrades.length) continue;
      out.push(...proposeMatchesForAccount(accounts, acc.id, baseTrades, followerTrades));
    }
    return out;
  }

  /** Open the confirmation surface. */
  openCopyMatches(): void {
    openCopyMatchModal(this, () => void this.reloadAllViews());
  }

  /**
   * Explicit reconciliation — APPLY. Reloads the journal, re-finds both notes by
   * their stable ids and re-validates the match before writing. Writes one
   * confirmed link: gives the base a stable key if it has none, marks the
   * follower as an imported leg, and lets an actual supersede any generated
   * model of the same leg (Phase 3).
   *
   * It **never touches temporal copy configuration** (`copyPeriods` /
   * `copyConfigHistory`) and never deletes a note. Safe failures:
   *  - a note deleted after proposal → `"missing"`, nothing written;
   *  - a note edited so it no longer matches → `"changed"`, nothing written;
   *  - an already-linked follower → `"already"`, nothing written.
   */
  async applyCopierMatch(
    proposal: CopierMatchProposal
  ): Promise<"applied" | "already" | "missing" | "changed"> {
    const trades = await this.loadTrades();
    const follower = trades.find((t) => t.id === proposal.followerId);
    const base = trades.find((t) => t.id === proposal.baseId);
    if (!follower || !base) return "missing";
    if (follower.isCopiedTrade) return "already";
    if (isLeg(base) || !sameDecision(base, follower)) return "changed";

    let baseKey = String(base.copyBaseKey ?? "").trim();
    if (!baseKey) {
      baseKey = "ck_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await setTradeFields(this.app, base.id, { copy_base_key: baseKey });
      base.copyBaseKey = baseKey;
    }

    const linked = linkFollower(follower, proposal, baseKey);
    await setTradeFields(this.app, linked.id, {
      is_copied_trade: true,
      copied_from_account: proposal.baseName,
      copy_base_key: baseKey,
      copy_origin: "imported",
      copy_multiplier: proposal.ratio,
      data_source: "broker",
    });

    // The actual fill is now the authority for this leg: any generated model of
    // the same account is merged (user data kept) and marked superseded.
    const fresh = await this.loadTrades();
    const models = generatedSiblings(fresh, linked, (name) =>
      this.mappedAccount(name)?.id ?? (name || "").trim().toLowerCase()
    );
    for (const model of models) await this.supersedeGeneratedLeg(linked, model);

    this.clearTradeCache();
    return "applied";
  }

  /**
   * Phase 3 — an actual fill supersedes the generated model of the same leg.
   * The model is not deleted: the trader's words (notes, review, tags, prints)
   * are merged into the actual where the actual lacks them, then the model is
   * stamped `superseded_by`. Idempotent: a model already superseded by this
   * actual is left alone.
   */
  private async supersedeGeneratedLeg(actual: Trade, generated: Trade): Promise<void> {
    if (String(generated.supersededBy ?? "") === String(actual.id)) return;
    const merged = mergeGeneratedIntoActual(actual, generated);

    const fields: Record<string, string | number | boolean> = {};
    const scalars: Array<[keyof Trade, string]> = [
      ["notes", "notes"],
      ["thesis", "thesis"],
      ["review", "review"],
      ["setup", "setup"],
      ["mistake", "mistake"],
      ["sessionOverride", "session_override"],
    ];
    const mergedRec = merged as unknown as Record<string, string | undefined>;
    const actualRec = actual as unknown as Record<string, string | undefined>;
    for (const [prop, key] of scalars) {
      const value = mergedRec[prop];
      if (typeof value === "string" && value.trim() && !(actualRec[prop] ?? "").trim()) fields[key] = value;
    }
    if (merged.reviewed && !actual.reviewed) fields.reviewed = true;
    if (merged.psychologyAcknowledged && !actual.psychologyAcknowledged) fields.psychology_acknowledged = true;
    if (merged.mistakesAcknowledged && !actual.mistakesAcknowledged) fields.mistakes_acknowledged = true;
    if (merged.rating && merged.rating > 0 && !(actual.rating && actual.rating > 0)) fields.rating = merged.rating;
    if (Object.keys(fields).length) await setTradeFields(this.app, actual.id, fields);

    const arrays: Record<string, string[]> = {};
    for (const key of ["tags", "psychology_tags", "mistake_tags"] as const) {
      const before = actual[key] ?? [];
      const after = merged[key] ?? [];
      if (after.length !== before.length) arrays[key] = after;
    }
    const actualFile = this.app.vault.getAbstractFileByPath(actual.id);
    if (actualFile instanceof TFile) {
      if (Object.keys(arrays).length) await updateTradeArrayFields(this.app, actualFile, arrays);
      if ((merged.screenshots?.length ?? 0) !== (actual.screenshots?.length ?? 0)) {
        await updateTradeScreenshots(this.app, actualFile, merged.screenshots ?? []);
      }
    }

    await setTradeFields(this.app, generated.id, {
      superseded_by: String(actual.id),
      superseded_at: todayIso(this.settings.timeZone),
    });
  }

  /**
   * One-time backfill for accounts that only exist in the vault as raw broker
   * export names (e.g., Tradovate's "DEMO1234567"): adopt them as real accounts so
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
      if (reviewStatus(t).complete) reviewN++;
      if (t.rating && t.rating > 0) ratingN++;
      const acc = this.mappedAccount(t.account);
      if (!acc) continue;
      const arr = byAccount.get(acc.id) ?? [];
      arr.push(t);
      byAccount.set(acc.id, arr);
    }

    let breachCount = 0;
    for (const acc of accounts) {
      const size = resolveAccountView(acc).rules;
      const mine = byAccount.get(acc.id);
      if (!size.maxLoss || size.maxLoss <= 0 || !mine || !mine.length) continue;

      let cum = 0, peak = 0, dd = 0;
      // The walk is order-sensitive: the shared chronology, not the clock alone.
      const ordered = mine.slice().sort(byEntryInstant);
      for (const t of ordered) {
        cum += netPnl(t);
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
    // Journal age in calendar days: earliest recorded day to today in the
    // Journal Timezone, both as civil days — no host-zone midnight in between.
    const today = dateInZone(this.settings.timeZone);
    const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
    const journalAgeDays =
      first && Number.isFinite(dayMs(first)) && Number.isFinite(dayMs(today))
        ? Math.max(0, Math.round((dayMs(today) - dayMs(first)) / 86400000))
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

    // Real fills are no longer linked to copies on load. Matching is explicit:
    // the trader reviews proposals (Accounts → Copy groups → Review real fills)
    // and only a confirmation writes a link.

    // Every load: heal any copy timeline the writers left invalid (open overlaps,
    // start > end, stray stretches). Idempotent — only saves when it changed.
    for (const acc of this.settings.propAccounts) {
      if (!(acc.copyPeriods || []).length) continue;
      if (normalizeCopyPeriods(acc).changed) settingsDirty = true;
    }

    // Every load: unlink copiers whose leader no longer exists among the active
    // accounts — a deleted account, or one moved to the archive. Conservative:
    // only a base id that does not resolve is touched. Idempotent.
    const activeIds = new Set(this.settings.propAccounts.map((a) => a.id));
    if (healDanglingCopiers(this.settings.propAccounts, activeIds, this.settings.timeZone)) settingsDirty = true;

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
      const size = resolveAccountView(a).rules;
      const funded = (this.settings.propAccounts ?? []).find((f) => f.id === a.linkedFundedId);
      a.passedAt =
        (await this.passedDateOf(a.id, size.target ?? 0)) ||
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

  /** Where a backup lands by default: the journal's own `_tradebook/backups`. */
  getBackupFolder(): string {
    return normalizePath(`${this.getTradesFolder()}/_tradebook/backups`);
  }

  /** Every markdown file under the journal root, minus the reserved folders. */
  private journalNoteFiles(): TFile[] {
    const folder = this.getTradesFolder();
    return this.app.vault.getFiles().filter((f) => {
      if (f.extension !== "md") return false;
      if (!f.path.startsWith(folder + "/")) return false;
      if (f.path.startsWith(`${folder}/_tradebook/`) || f.path.startsWith(`${folder}/library/`)) return false;
      return true;
    });
  }

  /**
   * Every markdown note the journal owns, minus the system folder. This is the
   * backup's population: trades, strategy notes, reviews — everything a person
   * wrote under the root. `_tradebook/` (backups, cache) is the only thing left
   * out, so a restore reproduces the journal rather than just the trades.
   */
  private journalMarkdownFiles(): TFile[] {
    const folder = this.getTradesFolder();
    return this.app.vault.getFiles().filter((f) => {
      if (f.extension !== "md") return false;
      if (!f.path.startsWith(folder + "/")) return false;
      if (f.path.startsWith(`${folder}/_tradebook/`)) return false;
      return true;
    });
  }

  private async collectJournalNotes(): Promise<BackupNote[]> {
    const files = this.journalMarkdownFiles();
    const notes: BackupNote[] = [];
    for (const f of files) {
      try {
        const content = await this.app.vault.cachedRead(f);
        notes.push({ path: f.path, content });
      } catch (err) {
        console.error("[tradebook] could not read a note for backup:", f.path, err);
      }
    }
    return notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Write the whole journal to one JSON file and say where it went. */
  async exportEverything(): Promise<{ path: string; bytes: number; counts: BackupPayload["counts"] }> {
    const payload = buildBackup({
      settings: this.settings,
      pluginVersion: this.manifest.version,
      notes: await this.collectJournalNotes(),
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
    const configDir = this.app.vault.configDir;
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

  /** The plugin's own folder, where `data.json` and the snapshots live. */
  private pluginDataDir(): string {
    const configDir = this.app.vault.configDir;
    return this.manifest.dir ?? `${configDir}/plugins/${this.manifest.id}`;
  }

  /** The pre-import snapshots, newest first, so a restore can be undone too. */
  async listSettingsSnapshots(): Promise<Array<{ path: string; name: string; mtime: number }>> {
    const adapter = this.app.vault.adapter;
    try {
      if (typeof adapter?.list !== "function") return [];
      const listing = await adapter.list(this.pluginDataDir());
      return (listing?.files ?? [])
        .filter((p) => /data\.pre-import-\d+\.json$/.test(p))
        .map((p) => {
          const m = /data\.pre-import-(\d+)\.json$/.exec(p);
          return { path: p, name: p.split("/").pop() as string, mtime: m ? Number(m[1]) : 0 };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (err) {
      console.error("[tradebook] could not list settings snapshots", err);
      return [];
    }
  }

  /**
   * Put the settings back to a snapshot taken before an import. Snapshots hold
   * `data.json` — accounts, payouts, layouts and preferences — never trade notes,
   * so a trade written after the snapshot is left exactly where it is.
   */
  async restoreSettingsSnapshot(path: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const raw = await adapter.read(path);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("that file is not a settings snapshot");
    }
    // Snapshot the current settings first, so this restore is undoable too.
    try {
      await adapter.write(
        normalizePath(`${this.pluginDataDir()}/data.pre-import-${Date.now()}.json`),
        JSON.stringify(this.settings, null, 2)
      );
    } catch (err) {
      console.error("[tradebook] could not snapshot before a settings restore", err);
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(parsed as Partial<TradebookSettings>) };
    this.applyTypePrefs();
    await this.saveSettings();
    this.clearTradeCache();
    await this.reloadAllViews();
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
        t.pnlPoints = tradePoints(t);
        trades.push({ ...t, id: base.path });
      }
      return trades;
    }

    const files = this.journalNoteFiles();
    let changed = false;

    for (const f of files) {
      const mtime = f.stat ? f.stat.mtime : 0;
      const cached = this._tradeCache.get(f.path);
      let t: Trade | null = null;
      if (cached && cached.mtime === mtime) {
        // Unchanged file: reuse the parsed trade instead of re-reading/parsing.
        t = { ...cached.trade };
      } else {
        changed = true;
        const content = await this.app.vault.cachedRead(f);
        const partial = parseTradeFromMarkdown(content);
        // Discovery is by frontmatter `type`, not by folder. Notes written
        // before the type key existed still count while they sit in a
        // `trades/` folder (the migration moves them, this keeps them readable
        // in the meantime).
        const isTrade =
          partial.type === "trade" ||
          (!partial.type && f.path.includes("/trades/") && !!partial.date && !!partial.symbol && typeof partial.pnl === "number");
        if (isTrade && partial.date && partial.symbol && typeof partial.pnl === "number") {
          t = { ...(partial as Trade), id: f.path };
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
        // Old notes carry the pre-fix quantity-multiplied points; the value is
        // recomputed for display — the note itself is only rewritten on edit.
        t.pnlPoints = tradePoints(t);
        trades.push(t);
      }
    }

    // Prune entries for files that no longer exist.
    const live = new Set(files.map((f) => f.path));
    for (const key of [...this._tradeCache.keys()]) {
      if (!live.has(key)) {
        this._tradeCache.delete(key);
        changed = true;
      }
    }
    // Persist only when something actually changed, and coalesce bursts.
    if (changed) this.scheduleSaveTradeCache();

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
      // Give the broadcast trade a stable, unique group key so copies can be
      // deduped. A saved note keys by its path; a freshly parsed trade has no
      // id yet, and the content fallback in legBaseKey can collide two
      // same-minute decisions — so mint a random key for it instead.
      const baseKey =
        t.copyBaseKey || (t.id ? String(t.id) : "ck_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      t.copyBaseKey = baseKey;
      out.push(t);
      const baseAccount = this.mappedAccount(t.account);
      for (const id of accountIds) {
        // The account the trade was entered in is the trade itself, never a
        // mirror of it. Guarded here so no caller — whatever id resolver it
        // used — can write the same trade twice into one account.
        if (baseAccount && id === baseAccount.id) continue;
        const acc = this.settings.propAccounts.find((a) => a.id === id);
        if (!acc) continue;
        // A copier only mirrors a trade it was actually following that day. An
        // account that started copying on 6 September never received the 1
        // September trade, and writing a leg anyway would put a copy in the
        // vault that never happened — a note the account's own numbers then
        // silently ignore, which is exactly how a wrong number is born.
        const follows =
          !!baseAccount && acc.copyRole === "copier" && (!acc.copyBaseId || acc.copyBaseId === baseAccount.id);
        if (follows) {
          if (!baseAccount || !isActiveCopier(acc, baseAccount.id, t.date)) continue;
        }
        // A real active copier mirrors with the config effective on the trade's
        // date. Any other tick is the user stating a fact — "this trade happened
        // in this account too" — so it mirrors 1:1: a freed ex-copier must not
        // inherit a stale ratio from a link that no longer exists.
        const cfg: import("./types").CopyConfigEntry = follows
          ? effectiveCopyConfig(acc, t.date) ?? { from: t.date, ratio: acc.copyMultiplier ?? 1 }
          : { from: t.date, ratio: 1 };
        const copy = buildLeg(t, acc, cfg);
        // Same guard `generateLegs` and `synthesizeLegs` already apply: a leg of
        // zero contracts is not a trade. A ratio below one mini on a symbol with
        // no micro (or a fixed size of zero) would otherwise write a note that
        // carries P&L with no size.
        if (!copy.symbol || copy.quantity <= 0) continue;
        copy.copyBaseKey = baseKey;
        copy.copiedFromAccount = t.account;
        copy.copyOrigin = "generated";
        out.push(copy);
      }
    }
    return out;
  }

  async reloadAllViews() {
    for (const type of ALL_VIEW_TYPES) {
      const leaves = this.app.workspace.getLeavesOfType(type);
      for (const leaf of leaves) {
        const view: unknown = leaf.view;
        try {
          if (isRefreshable(view)) await view.refresh();
          else if (isRenderable(view)) view.render();
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

  // ---- Balance corrections (the platform's figure against the journal's) ----
  // A signed, dated difference. It never touches a trade note: it is a cash-flow
  // on its own day, exactly like a payout or a deposit.
  feeAdjustmentsFor(accountId: string): FeeAdjustment[] {
    return (this.settings.feeAdjustments || [])
      .filter((a) => a.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  accountFeeAdjustmentsTotal(accountId: string): number {
    return this.feeAdjustmentsFor(accountId).reduce((s, a) => s + a.amount, 0);
  }

  /** Every trade key of this account that already carries a slice of a correction. */
  allocatedKeysFor(accountId: string): Set<string> {
    return allocatedKeys(this.feeAdjustmentsFor(accountId));
  }

  async registerFeeAdjustment(
    accountId: string,
    date: string,
    amount: number,
    note?: string,
    period?: { from: string; to: string },
    allocations?: { key: string; date: string; amount: number }[],
    remainderCents?: number
  ): Promise<void> {
    this.settings.feeAdjustments = this.settings.feeAdjustments || [];
    this.settings.feeAdjustments.push({
      id: "adj_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      accountId,
      date,
      amount,
      note,
      period,
      trades: allocations ? allocations.length : undefined,
      allocations,
      remainderCents,
    });
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async removeFeeAdjustment(adjustmentId: string): Promise<void> {
    this.settings.feeAdjustments = (this.settings.feeAdjustments || []).filter((a) => a.id !== adjustmentId);
    await this.saveSettings();
    await this.reloadAllViews();
  }

  /**
   * A cost the platform charged that no trade could claim — the Orders export
   * aggregated several executions into one row. It is a dated cash-flow like a
   * correction, but it is the platform's own bill, not a hand-written
   * difference, so it stays out of the Correct-fees list. Re-importing the same
   * file must not double it: an identical cost on the same day is left alone.
   */
  async registerAccountCost(accountId: string, date: string, amount: number, note?: string): Promise<void> {
    this.settings.feeAdjustments = this.settings.feeAdjustments || [];
    const value = Math.round(amount * 100) / 100;
    if (!Number.isFinite(value) || value === 0) return;
    const day = date || new Date().toISOString().slice(0, 10);
    const already = this.settings.feeAdjustments.some(
      (a) => a.kind === "cost" && a.accountId === accountId && a.date === day && Math.abs(a.amount - value) < 0.005
    );
    if (already) return;
    this.settings.feeAdjustments.push({
      id: "cost_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      accountId,
      date: day,
      amount: value,
      note,
      kind: "cost",
    });
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async deleteTrade(tradeId: string): Promise<boolean> {
    const trades = await this.loadTrades();
    const t = trades.find((x) => x.id === tradeId);
    const success = await deleteTradeFile(this.app, tradeId);
    if (success) {
      // A base note carries its copies: deleting it deletes the generated legs
      // it produced, so the journal does not keep orphans. Imported legs are
      // real fills and are never touched. Done after the base is gone, so a
      // failed base delete never costs the legs.
      if (t && !isLeg(t)) {
        const { deleteLegs } = await import("./lib/copy");
        await deleteLegs(this, legBaseKey(t));
      }
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
      const size = resolveAccountView(evalAcc).rules;
      evalAcc.passedAt =
        (await this.passedDateOf(evalAccountId, size.target ?? 0)) || new Date().toISOString().slice(0, 10);
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
      this.settings.propAccounts = this.settings.propAccounts.filter((a) => a.id !== evalAccountId);
    }
    if (action === "delete") {
      // The promoted funded account is a new home; the eval's own notes leave
      // the vault, exactly as a plain delete would.
      await this.purgeAccountData(evalAccountId);
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
        // The tracked boundary when there is one, so a pre-tracking trade can
        // never put a date on a lifecycle conclusion that did not happen while
        // Tradebook was watching. No boundary = the account's start, as before.
        const floor = accountBoundary(acc);
        if (floor && t.date < floor) return false;
        const mapped = this.mappedAccount(t.account);
        if (mapped) return mapped.id === accountId;
        return (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
      })
      .sort(byEntryInstant);
    let cum = 0;
    for (const t of trades) {
      cum += netPnl(t);
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
      const size = resolveAccountView(evalAcc).rules;
      evalAcc.passedAt =
        (await this.passedDateOf(evalAccountId, size.target ?? 0)) || funded.createdAt || new Date().toISOString().slice(0, 10);
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

  /**
   * Every note that belongs to an account, resolved the same way the rest of
   * the plugin resolves a trade's account: mapping first, then name, then the
   * account's stored aliases. An archived account is searched too, because it
   * can still be deleted from the archive list.
   */
  private async accountTrades(accountId: string): Promise<Trade[]> {
    const acc =
      this.settings.propAccounts.find((a) => a.id === accountId) ||
      (this.settings.archivedAccounts || []).find((a) => a.id === accountId);
    const names = new Set<string>();
    if (acc) {
      names.add(acc.name);
      for (const al of acc.aliases || []) names.add(al);
    }
    for (const [key, id] of Object.entries(this.settings.accountMappings || {})) {
      if (id === accountId) names.add(key);
    }
    const lower = new Set([...names].map((n) => (n || "").trim().toLowerCase()));
    const trades = await this.loadTrades();
    return trades.filter((t) => {
      const mapped = this.mappedAccount(t.account);
      if (mapped) return mapped.id === accountId;
      return lower.has((t.account || "").trim().toLowerCase());
    });
  }

  /** How many copy relationships an account takes down with it. */
  private copyLinksFor(accountId: string): number {
    const all = [...this.settings.propAccounts, ...(this.settings.archivedAccounts || [])];
    const groupsLed = (this.settings.copyGroups || []).filter((g) => g.baseAccountId === accountId).length;
    const followers = all.filter((a) => a.copyBaseId === accountId).length;
    const me = all.find((a) => a.id === accountId);
    return groupsLed + followers + (me?.copyBaseId ? 1 : 0);
  }

  /** What the delete confirmation lists, so nothing is a surprise. */
  async accountDeletionSummary(accountId: string): Promise<{
    trades: number;
    payouts: number;
    deposits: number;
    corrections: number;
    copyLinks: number;
  }> {
    const trades = await this.accountTrades(accountId);
    return {
      trades: trades.length,
      payouts: (this.settings.payouts || []).filter((p) => p.accountId === accountId).length,
      deposits: (this.settings.deposits || []).filter((d) => d.accountId === accountId).length,
      corrections: (this.settings.feeAdjustments || []).filter((a) => a.accountId === accountId).length,
      copyLinks: this.copyLinksFor(accountId),
    };
  }

  /**
   * The destructive half of a delete: the notes leave the vault (Obsidian's own
   * trash) and every record that pointed at the account is dropped. It does not
   * save or repaint — the callers decide when the world is told.
   */
  private async purgeAccountData(accountId: string): Promise<void> {
    // The notes go first, to Obsidian's own trash, so an interrupted delete
    // never leaves trade notes without the account that explains them.
    const trades = await this.accountTrades(accountId);
    for (const t of trades) {
      if (t.id) await deleteTradeFile(this.app, t.id);
    }
    this.settings.propAccounts = this.settings.propAccounts.filter((a) => a.id !== accountId);
    this.settings.archivedAccounts = (this.settings.archivedAccounts || []).filter((a) => a.id !== accountId);
    this.settings.payouts = (this.settings.payouts || []).filter((p) => p.accountId !== accountId);
    this.settings.deposits = (this.settings.deposits || []).filter((d) => d.accountId !== accountId);
    this.settings.feeAdjustments = (this.settings.feeAdjustments || []).filter((a) => a.accountId !== accountId);
    // Mappings point at an id that no longer exists.
    for (const [key, id] of Object.entries(this.settings.accountMappings || {})) {
      if (id === accountId) delete this.settings.accountMappings[key];
    }
    // Copy: the group this account led goes entirely; as a member it is simply
    // gone with the account.
    this.settings.copyGroups = (this.settings.copyGroups || []).filter((g) => g.baseAccountId !== accountId);
    // Anyone who followed it loses the link rather than keeping a dead base id:
    // the stretch is closed and the role cleared exactly as a manual remove.
    const zone = this.settings.timeZone;
    detachFollowers(this.settings.propAccounts, accountId, zone);
    detachFollowers(this.settings.archivedAccounts || [], accountId, zone);
    this.clearTradeCache();
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.purgeAccountData(accountId);
    await this.saveSettings();
    await this.reloadAllViews();
  }

  async archiveAccount(accountId: string): Promise<void> {
    const acc = this.settings.propAccounts.find((a) => a.id === accountId);
    if (!acc) return;
    // An archived account is out of the journal: a leader cannot keep followers
    // pointing at it, and a copier cannot keep a live link that would silently
    // resume on unarchive. Both are unlinked; unarchiving does not rebuild them.
    const zone = this.settings.timeZone;
    detachFollowers(this.settings.propAccounts, accountId, zone);
    if (acc.copyRole === "copier") unlinkCopier(acc, zone);
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
    const saved: unknown = await this.loadData();
    // `data.json` is this plugin's own file, read back: `unknown` until it is
    // known to be an object, so a string or an array cannot spill index keys
    // into the settings that get written out again.
    this.settings = Object.assign({}, DEFAULT_SETTINGS, isRecord(saved) ? saved : {});
    setCurrencySymbol(this.settings.currency || "$");
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
    const migrateAcc = (acc: LegacyAccount): void => {
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
    Reflect.deleteProperty(this.settings, "primaryAccountId");
  }

  /**
   * Numbered, idempotent migrations. Only a journal below the current version
   * migrates, and running one twice is the same as running it once.
   */
  /**
   * 6 → 7. Drop fields nothing reads any more (legacy Analytics grid, declared
   *  maturity answers, the old per-save flags) and fold the legacy trade-log
   *  default into `defaultPeriod`, so `data.json` stops carrying dead keys.
   */
  private migrateSettingsCleanup(): void {
    const s: LegacySettings = this.settings;
    if (s.defaultPeriod === undefined && typeof s.tradeLogPeriod === "string") {
      s.defaultPeriod = s.tradeLogPeriod === "1m" ? "thismonth" : s.tradeLogPeriod;
    }
    for (const key of [
      "accountGroups",
      "accountWidgets",
      "chartDates",
      "defaultAccountId",
      "defaultQty",
      "onboardingDone",
      "onboardingStep",
      "recentLimit",
      "stops",
      "tags",
      "dashboardLayout",
      "tradeLogPeriod",
      "maturityExp",
      "maturityJournaling",
      "maturityActiveAccounts",
      "maturityGroupTrading",
    ]) {
      Reflect.deleteProperty(s, key);
    }
  }

  /** Best-effort: the parsed-trade cache used to live in the vault; remove the
   *  leftover so the vault only shows the journal and its backups. */
  private async cleanupLegacyCache(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const oldFile = normalizePath(`${this.getTradesFolder()}/_tradebook/cache/trades.json`);
    const oldDir = normalizePath(`${this.getTradesFolder()}/_tradebook/cache`);
    try {
      if (typeof adapter?.exists === "function" && (await adapter.exists(oldFile))) {
        await adapter.remove(oldFile);
      }
      if (typeof adapter?.rmdir === "function" && (await adapter.exists(oldDir))) {
        await adapter.rmdir(oldDir, false);
      }
    } catch {
      /* the old cache is harmless if it stays */
    }
  }

  private async runMigrations(): Promise<void> {
    const current = this.settings.settingsVersion ?? 0;
    if (current >= SETTINGS_VERSION) return;
    if (current < 1) await this.migrateFolderStructure();
    if (current < 2) await this.migrateStrategies();
    if (current < 3) await this.migrateHomeLayout();
    if (current < 4) await this.migrateWidgetIds();
    if (current < 6) await this.migrateHomeLayouts();
    if (current < 7) this.migrateSettingsCleanup();
    this.settings.settingsVersion = SETTINGS_VERSION;
    await this.saveSettings();
  }

  /**
   * 3 → 4. The Home/Dashboard split renamed widgets (`review` → `discipline`,
   * `besthours` → `timing`). Rewrite the deprecated ids in the saved Home
   * layout so no tile is lost. `ensureLayout` repeats this as a safety net for
   * layouts written by an older build.
   */
  private async migrateWidgetIds(): Promise<void> {
    const rewrite = (list?: DashItem[]): DashItem[] | undefined => {
      if (!Array.isArray(list)) return list;
      for (const it of list) {
        if (it && WIDGET_ID_ALIASES[it.i]) it.i = WIDGET_ID_ALIASES[it.i];
      }
      // Aliases can collapse several old ids onto one; keep the largest tile
      // (the one the user likely resized), else the first seen.
      const byId = new Map<string, DashItem>();
      const areaOf = (it: DashItem): number => (it.w || 0) * (it.h || 0);
      for (const it of list) {
        if (!it || !it.i) continue;
        const prev = byId.get(it.i);
        if (!prev || areaOf(it) > areaOf(prev)) byId.set(it.i, it);
      }
      return [...byId.values()];
    };
    this.settings.homeLayout = rewrite(this.settings.homeLayout);
    if (this.settings.homeLayouts) {
      for (const name of Object.keys(this.settings.homeLayouts)) {
        this.settings.homeLayouts[name] = rewrite(this.settings.homeLayouts[name]) ?? [];
      }
    }
  }

  /**
   * 5 → 6. One Home layout becomes a named set. The old single layout is kept
   * verbatim as `Default` (an explicit `[]` stays empty), and becomes active.
   */
  private async migrateHomeLayouts(): Promise<void> {
    const existing = this.settings.homeLayouts || {};
    if (Object.keys(existing).length > 0) return;
    const source = this.settings.homeLayout;
    const items = (source === undefined ? HOME_DEFAULT : source).map((t) => ({ ...t }));
    this.settings.homeLayouts = { Default: items };
    this.settings.homeLayoutActive = "Default";
    delete this.settings.homeLayout;
  }

  /**
   * 2 → 3. Home and Dashboard split into two layouts. Only seed Home when it
   * has never been written (`undefined`); an explicit `[]` is the user's choice
   * and is respected, and `dashboardLayout` is never used as a source.
   */
  private async migrateHomeLayout(): Promise<void> {
    if (this.settings.homeLayout === undefined) {
      this.settings.homeLayout = HOME_DEFAULT.map((t) => ({ ...t }));
    }
  }

  /**
   * 1 → 2. Seed the strategy registry (records with stable ids) from the legacy
   * bare-name list and from the names already in the vault, then give every
   * registered strategy its note. Idempotent: a name already present is kept,
   * and a note that already exists is never overwritten.
   */
  private async migrateStrategies(): Promise<void> {
    const list = (this.settings.strategies ??= []);
    const seen = new Set(list.map((s) => s.name.trim().toLowerCase()));
    const names: string[] = [];
    for (const s of this.settings.setups || []) {
      const clean = (s || "").trim();
      if (clean) names.push(clean);
    }
    try {
      for (const t of await this.loadTrades()) {
        const clean = (t.setup || "").trim();
        if (clean) names.push(clean);
      }
    } catch {
      /* notes unreadable — the legacy list still seeds the registry */
    }
    let added = 0;
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: "st_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        createdAt: new Date().toISOString(),
      });
      added++;
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    if (added) await this.saveSettings();
    for (const rec of list) await this.writeStrategyNote(rec);
  }

  /**
   * 1.0 → year/month folders. `tradesFolder` becomes the journal ROOT; every
   * trade note moves to `<root>/<year>/<month>/trades/` and gains `type: trade`.
   * Moves go through fileManager.renameFile so links follow; nothing is ever
   * overwritten or deleted, and a failure leaves the note (and its date) intact.
   */
  private async migrateFolderStructure(): Promise<void> {
    let root = this.getTradesFolder();
    // The old default was `<root>/trades`; the new root is its parent.
    if (root.endsWith("/trades")) root = root.slice(0, -"/trades".length);
    if (!root) root = "Tradebook";
    this.settings.tradesFolder = root;

    const fm = this.app.fileManager;
    const move = async (file: TFile, to: string) => {
      if (fm && typeof fm.renameFile === "function") await fm.renameFile(file, to);
      else await this.app.vault.rename(file, to);
    };

    const files = this.app.vault.getFiles().filter((f) => {
      if (f.extension !== "md") return false;
      if (!f.path.startsWith(root + "/")) return false;
      if (f.path.startsWith(`${root}/_tradebook/`) || f.path.startsWith(`${root}/library/`)) return false;
      return true;
    });

    for (const f of files) {
      try {
        const content = await this.app.vault.cachedRead(f);
        const p = parseTradeFromMarkdown(content);
        if (!p.date || !p.symbol || typeof p.pnl !== "number") continue;
        if (p.type !== "trade" && !f.path.includes("/trades/")) continue;
        if (p.type !== "trade") await updateTradeFields(this.app, f, { type: "trade" });
        const targetDir = tradeMonthPath(root, p.date);
        if (f.parent && f.parent.path === targetDir) continue;
        await this.ensureVaultFolder(targetDir);
        const to = normalizePath(`${targetDir}/${f.name}`);
        if (this.app.vault.getAbstractFileByPath(to)) continue; // never overwrite
        await move(f, to);
      } catch (err) {
        console.error("[tradebook] folder migration skipped a note:", f.path, err);
      }
    }
  }

  /** Keep lib/accountTypes in step with the saved preferences. */
  applyTypePrefs(): void {
    setTypePrefs({
      order: this.settings.accountTypeOrder,
      labels: this.settings.accountTypeLabels,
      colors: this.settings.accountTypeColors,
    });
  }

  // ---- Home layouts (named layouts, active one rendered) ----

  /** Names of every saved Home layout, in insertion order. */
  homeLayoutNames(): string[] {
    return Object.keys(this.settings.homeLayouts || {});
  }

  /** The layout name to render; falls back to the first saved, then "Default". */
  activeHomeLayoutName(): string {
    const names = this.homeLayoutNames();
    const active = this.settings.homeLayoutActive || "";
    if (active && names.includes(active)) return active;
    return names[0] || "Default";
  }

  /** A copy of one layout's items (the Home foundation when none is saved). */
  readHomeLayout(name?: string): DashItem[] {
    // Compatibility: until the 5 → 6 migration moves it, a legacy single layout
    // is still the truth (the test harness and a pre-migration load rely on it).
    if (name === undefined && this.settings.homeLayout !== undefined) {
      return this.settings.homeLayout.map((t) => ({ ...t }));
    }
    const layouts = this.settings.homeLayouts || (this.settings.homeLayouts = {});
    const key = name || this.activeHomeLayoutName();
    const items = layouts[key];
    return (items ?? HOME_DEFAULT).map((t) => ({ ...t }));
  }

  /** The live array the grid engine mutates in place (legacy layout wins while
   *  it still exists). Undefined only before any layout has ever been saved. */
  currentHomeLayoutRef(): DashItem[] | undefined {
    if (this.settings.homeLayout !== undefined) return this.settings.homeLayout;
    const layouts = this.settings.homeLayouts || (this.settings.homeLayouts = {});
    return layouts[this.activeHomeLayoutName()];
  }

  /** Replace a layout's items and make it the active one. */
  writeHomeLayout(name: string, items: DashItem[]): void {
    // Until the 5 → 6 migration, the legacy single layout is still the store.
    if (this.settings.homeLayout !== undefined) {
      this.settings.homeLayout = items.map((t) => ({ ...t }));
      return;
    }
    const layouts = this.settings.homeLayouts || (this.settings.homeLayouts = {});
    layouts[name] = items.map((t) => ({ ...t }));
    this.settings.homeLayoutActive = name;
  }

  setActiveHomeLayout(name: string): boolean {
    if (!this.homeLayoutNames().includes(name)) return false;
    this.settings.homeLayoutActive = name;
    return true;
  }

  /** Save the current items under a new name. Fails on an empty/duplicate name. */
  duplicateHomeLayout(fromName: string, newName: string): boolean {
    const clean = newName.trim();
    const layouts = this.settings.homeLayouts || (this.settings.homeLayouts = {});
    if (!clean || clean in layouts) return false;
    const src = layouts[fromName] ?? this.readHomeLayout(fromName);
    layouts[clean] = src.map((t) => ({ ...t }));
    this.settings.homeLayoutActive = clean;
    return true;
  }

  renameHomeLayout(from: string, to: string): boolean {
    const clean = to.trim();
    const layouts = this.settings.homeLayouts || (this.settings.homeLayouts = {});
    if (!clean || from === clean || !(from in layouts) || clean in layouts) return false;
    layouts[clean] = layouts[from];
    delete layouts[from];
    if (this.settings.homeLayoutActive === from) this.settings.homeLayoutActive = clean;
    return true;
  }

  /** Remove a layout. The last remaining one is never removable. */
  deleteHomeLayout(name: string): boolean {
    const layouts = this.settings.homeLayouts || {};
    if (!(name in layouts) || this.homeLayoutNames().length <= 1) return false;
    delete layouts[name];
    if (this.settings.homeLayoutActive === name) {
      this.settings.homeLayoutActive = this.homeLayoutNames()[0] || "Default";
    }
    return true;
  }

  /** Put the built-in foundation back into a layout. */
  restoreHomeFoundation(name?: string): void {
    this.writeHomeLayout(name || this.activeHomeLayoutName(), HOME_DEFAULT.map((t) => ({ ...t })));
  }

  async saveSettings() {
    setCurrencySymbol(this.settings.currency || "$");
    this.applyTypePrefs();
    await this.saveData(this.settings);
  }
}
