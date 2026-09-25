export type AccountType = "demo" | "eval" | "funded" | "live" | "personal" | "unknown";

/**
 * How a canonical instant was pinned — the provenance written next to it.
 *
 * - `offset`: the source stamp named its own zone (`Z` / `±HH:MM`); no
 *   interpretation was applied.
 * - `source-zone`: a naive stamp read in `sourceZone`, after a DST check, where
 *   that zone was **said to be the file's** — either declared by the export or
 *   chosen as a named zone by the reader.
 * - `system-zone`: a naive stamp read in *this computer's* zone (the "This
 *   computer" import option). The instant is pinned and reproducible, but the
 *   zone is a **choice of the reader**, not something the source told us — so it
 *   is never written as if the platform had declared it.
 * - `journal-zone`: a time the trader typed, read in the journal's zone.
 */
export type InstantSource = "offset" | "source-zone" | "system-zone" | "journal-zone";

export interface FuturesSpec {
  pointValue: number; // dollar value of 1.0 point movement
  tickSize: number;
  tickValue: number;
  /** What the contract is called — for the picker and for tooltips. */
  name?: string;
  exchange?: string;
  /** Which market it belongs to, so a picker with 40+ symbols stays readable. */
  group?: "equity" | "energy" | "metal" | "rate" | "fx" | "ag" | "crypto";
  /** Mini or micro, with the counterpart root, so a copy can cross the two. */
  kind?: "mini" | "micro" | "other";
  micro?: string;
  mini?: string;
}

export interface Execution {
  timestamp: Date;
  account: string;
  accountType: AccountType;
  symbol: string; // e.g. NQ, ES, MNQ, MES (root)
  side: "buy" | "sell";
  quantity: number;
  price: number;
  commission: number;
  fees: number;
  orderId: string;
  /** Order type: Limit, Market, Stop, StopLimit, etc. */
  orderType?: string;
  /**
   * Identity of this fill in the platform's own reports: its timestamp and the
   * contract exactly as written. The cash history uses the same pair, which is
   * how a fill finds its real exchange, clearing, NFA and commission lines.
   */
  costKey?: string;
  /** How this row's timestamp was pinned (see `InstantSource`). */
  timestampSource?: InstantSource;
}

/**
 * One execution of a trade. A trade entered and exited once stores no fills at
 * all — the scalar fields are the whole truth. Fills exist only when a position
 * was scaled in or out, and then the scalars become their weighted averages, so
 * everything that already reads them keeps working.
 */
export interface TradeFill {
  /** The broker's side, not "entry/exit": which one it is comes from the trade's direction. */
  side: "buy" | "sell";
  /** Wall clock, as reported: `HH:MM:SS`. */
  time: string;
  /** Canonical UTC instant of this fill, `…Z`. Present only when it was pinned. */
  instant?: string;
  qty: number;
  price: number;
  /** Realised P&L of this exit, matched FIFO against the entries (gross, before fees). */
  pnl?: number;
  /** Commission + fees charged on this fill. */
  fees?: number;
  /** Order type (Limit, Market, etc.) — carried from CSV for entry fills. */
  orderType?: string;
  /** Broker fill ID — for import dedup. */
  fillId?: string;
}

/** One screenshot attached to a trade. Labels are optional — the trader decides
 *  how many prints to add and whether to annotate them. */
export interface PrintEntry {
  /** Filename (relative to prints/ folder). */
  file: string;
  /** Optional free-form note for this screenshot. */
  note?: string;
}

export interface Trade {
  id: string;
  /** Frontmatter `type` — `trade` for a normal trade (reserved: `missed`,
   *  `backtest`). The plugin discovers notes by this key, not by folder. */
  type?: string;
  date: string; // YYYY-MM-DD (entry date)
  entryTime: string;
  exitTime: string;
  symbol: string;
  account: string;
  accountType: AccountType;
  direction: "long" | "short";
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  /** Protective stop price (used for risk / R-multiples). 0 = not set. */
  stopLoss?: number;
  /** Optional profit target price. Informational only — never used in P&L,
   *  win-rate or R calculations (targets are often adjusted live). */
  target?: number;
  commission: number;
  fees: number;
  /** Parsed frontmatter presence for fees. Runtime metadata only; never written. */
  costCoverage?: { commission: boolean; fees: boolean };
  /** Gross result (points × pointValue × qty), before commission and fees.
   *  The net is derived, never stored: `pnl - commission - fees` (see `netPnl`). */
  pnl: number;
  pnlPoints: number;
  /** Order type at entry (Limit, Market, Stop, etc.). Informational — for discipline review. */
  orderType?: string;
  /** Broker fill ID — used for import dedup, not shown in the UI. */
  fillId?: string;
  /** Free-form notes (replaces thesis/review/mistake). */
  notes?: string;
  /** IANA zone the recorded times are wall-clock in (frozen at import/entry).
   *  Older notes have none and fall back to the journal's zone. */
  timezone?: string;
  // ---- canonical instants (see `lib/instant.ts`) ----
  /** Canonical UTC instant of the entry, `YYYY-MM-DDTHH:MM:SS.sssZ`. Absent when
   *  the note predates the contract or its wall clock could not be pinned. */
  entryInstant?: string;
  /** Canonical UTC instant of the exit, same form. */
  exitInstant?: string;
  /** Zone the *source* timestamps were written in — provenance, not a reader. */
  sourceZone?: string;
  /** How the instants above were pinned (`InstantSource`). */
  instantSource?: InstantSource;
  /** Manual session classification (newyork|london|asia|off). Absent/empty = auto-detect from entry time. */
  sessionOverride?: string;
  setup: string;
  mistake: string;
  thesis: string;
  review: string;
  screenshot: string; // wikilink or empty (kept for backward compat)
  /** Multiple screenshots with optional notes. When present, `screenshot` is
   *  kept in sync with the first entry for backward compat with copy legs,
   *  the trade log print column, and external tools. */
  screenshots?: PrintEntry[];
  /** 1-5 star rating of execution/setup quality (0 = unrated). */
  rating?: number;
  /** Manually marked as reviewed (batch action), independent of the checklist. */
  reviewed?: boolean;
  /** Free-form labels. Legacy field: still written for backward compat, but the
   *  review UI reads/writes `psychology_tags` and falls back to this when absent. */
  tags?: string[];
  /** Psychology / emotional-state labels (e.g. "Anxious", "Patient"). */
  psychology_tags?: string[];
  /** Execution-mistake labels (e.g. "FOMO Entry", "Early Exit"). */
  mistake_tags?: string[];
  /** The trader confirmed there was nothing to log in Psychology State. */
  psychologyAcknowledged?: boolean;
  /** The trader confirmed there were no execution mistakes. */
  mistakesAcknowledged?: boolean;

  /**
   * The executions behind this trade, present only when the position was scaled
   * in or out. `quantity`, `entryPrice`, `exitPrice`, `entryTime` and `exitTime`
   * stay the weighted averages of these, so the ledger, the metrics and the copy
   * engine need no special case — the fills are the detail underneath.
   */
  fills?: TradeFill[];

  // ---- copy trading (this note is a "leg" when isCopiedTrade is true) ----
  isCopiedTrade?: boolean;
  copiedFromAccount?: string;
  /** Identity of the base trade — groups every sibling leg together. */
  copyBaseKey?: string;
  /** Path/link of the base note. */
  copyBaseFile?: string;
  /** Ratio used for THIS leg (frozen at creation). */
  copyMultiplier?: number;
  /** e.g. "NQ → MNQ" */
  copySymbolMap?: string;
  copyOrigin?: "generated" | "imported";
  copyPnlAdjustment?: number;
}

export interface ParsedResult {
  trades: Trade[];
  warnings: string[];
  /** Rows that could not be read as an execution at all. */
  skipped: number;
  /** Order rows that carried no fill (working, cancelled, rejected tickets). */
  unfilled: number;
  /** Fills recorded but never closed — an open or partial position. */
  unpaired: number;
  /** Rows left out because their timestamp has no single instant (never guessed). */
  timeIssues?: TimeIssues;
  accountsSeen: { name: string; type: AccountType }[];
  /** Present when the platform's cash history came with the file. */
  costs?: ImportCosts;
}

/** Counts of timestamps the reader refused to invent an instant for. */
export interface TimeIssues {
  /** The wall clock does not exist in the source zone (spring-forward gap). */
  gap: number;
  /** The wall clock exists twice in the source zone (fall-back replay). */
  ambiguous: number;
  /** Naive stamp with no source zone declared. */
  noZone: number;
}

/**
 * What the platform charged, next to what this import recorded. The journal
 * never simulates a fee: either the cash history says what was charged, or the
 * costs are zero and the review says so.
 */
export interface ImportCosts {
  /** Total cost lines in the cash history (exchange + clearing + NFA + commission). */
  charged: number;
  /** What the trades in this file picked up from it. */
  recorded: number;
  /** The account balance the platform itself reports (its last running Amount). */
  finalBalance?: number;
  /** Cost lines that would not glue to any trade — logged as an account cost. */
  orphans: OrphanCost[];
}

/**
 * A cost the platform charged that could not be tied to a single trade: the
 * Orders export aggregates several executions into one row, so a few cost lines
 * carry a stamp no trade holds. The money is real, so it is logged against the
 * account on its own day instead of being dropped.
 */
export interface OrphanCost {
  /** YYYY-MM-DD, in the journal's zone. */
  date: string;
  /** Positive amount, the way every other cost is kept. */
  amount: number;
  /** The contract the platform stamped on the line, for the note. */
  contract: string;
}

/**
 * A registered strategy. The human-readable name lives in the trade notes
 * (`setup`); this record gives it a stable id so rules, documentation and
 * readiness can attach to it without ever depending on the spelling.
 */
export interface StrategyRecord {
  id: string;
  name: string;
  /** ISO timestamp of registration. */
  createdAt: string;
}

/** The rules an account answers to. Everything is optional: the account is the
 *  source of truth, and a missing field simply means the account has no such
 *  rule (or, for accounts created before this model, that we fall back to the
 *  firm's published seed — see `lib/accountRules.ts`). */
export interface AccountRules {
  target?: number;
  maxLoss?: number;
  dailyLoss?: number;
  consistency?: number;
  consistencyBasis?: "profit" | "target";
  posSize?: string;
  /** Drawdown behaviour — drives the floor calculation. */
  maxLossType?: "eod-trailing" | "intraday-trailing" | "eod-trailing-open" | "static";
  /** Where a trailing drawdown stops trailing, in dollars above the starting balance. */
  ddLockOffset?: number;
  /** Minimum trading days before a pass / payout (informational). */
  minDays?: number;
  /** Anything the daily loss limit needs the number to say. */
  dailyLossNote?: string;
  /** Target / max loss entered as a percentage of the size — resolved to dollars on the way out. */
  targetPct?: number;
  maxLossPct?: number;
}

/** Kept as an alias so older imports keep working. */
export type PropAccountRuleOverrides = AccountRules;

/** How the account's avatar is drawn. No URLs, no paths outside the vault. */
export interface AccountBranding {
  kind: "packaged" | "initials";
  /** Id in the packaged logo catalog, e.g. "topstep". */
  id?: string;
  /** The two letters drawn when `kind` is "initials". */
  initials?: string;
}

export interface CopyConfigEntry {
  /** ISO date from which this configuration applies. */
  from: string;
  ratio: number;
  crossOrder?: boolean;
  /** "exposure" (1 mini = 10 micros) or "contract" (TradeSyncer 1:1 mapping). */
  crossMode?: "exposure" | "contract";
  sizing?: "ratio" | "fixed" | "mirror";
  fixedQty?: number;
  round?: "down" | "nearest" | "up";
  minQty?: number;
}

export interface CopyGroup {
  id: string;
  name: string;
  baseAccountId: string;
  createdAt?: string;
}

/** One stretch of time during which a copier followed a specific leader.
 *  Recording the leader here is what makes changing leaders safe: legs already
 *  generated belong to the period that created them, and a new period never
 *  reaches back into the old one. */
export interface CopyPeriod {
  /** First day the link is active (inclusive). Empty = from the beginning. */
  start?: string;
  /** Last day the link is active (inclusive). Empty = still active. */
  end?: string;
  /** Which account was being copied during this period. */
  baseId?: string;
  /** Multiplier in effect during this period. */
  multiplier?: number;
}

export interface PropAccount {
  id: string;
  name: string;
  firmId: string;
  programId: string;
  size: number;
  type: AccountType;
  /** Creation (start) date — ISO YYYY-MM-DD. Anchors the equity curve and copy periods. */
  createdAt?: string;
  /** Broker/export names that belong to this account (e.g. "DEMO1234567",
   *  "PROP-1234"). The system resolves them for imports, but NEVER shows them
   *  in the UI and never writes them to trade notes — your friendly name wins. */
  aliases?: string[];
  /** The rules this account answers to — entered by the trader, not read from a
   *  hardcoded preset. Accounts created before this model keep only their
   *  overrides here and fall back to the firm seed on read. */
  rules?: AccountRules;
  /** How the account's logo/initials are drawn. */
  branding?: AccountBranding;
  /** Which payout route this funded account is working towards, when the firm
   *  offers more than one (TopStep XFA: "standard" | "consistency"). The system
   *  has to know which rulebook applies before it can say what is still missing.
   *  Informational: it changes what we tell the trader, never a number they earned. */
  /** When an eval passes and is upgraded to a funded account, the new funded
   *  account keeps a back-reference to the eval that created it. */
  linkedEvalId?: string;
  /** The eval account remembers which funded account it was upgraded into,
   *  so archive/restore can stay bidirectional without creating duplicates. */
  linkedFundedId?: string;
  /** The day this evaluation reached its target. Written the moment the trader
   *  acts on the pass, and the memory that keeps the celebration from firing a
   *  second time after an archive → restore. */
  passedAt?: string;
  /** "Keep for now" after passing: the eval stays in the list, there is no more
   *  celebration, and the quiet band keeps offering the archive. */
  passKept?: boolean;
  /** Time-stamped copy configuration — a ratio/scale change only applies from
   *  its date; existing legs are never recalculated. */
  copyConfigHistory?: CopyConfigEntry[];
  /** Copy-trading role (set in the copy-trading setup tab, later). */
  copyRole?: "base" | "copier";
  /** A friendly name for the trading group this account leads (e.g. "Apex
   *  scalping book"). Purely cosmetic: it only renames the group in the
   *  Accounts list, so a group feels like yours instead of "Trading group — X". */
  copyGroupName?: string;
  /** A colour for the trading group, so two groups never look alike in the
   *  Accounts list. Cosmetic, like the name above. */
  copyGroupColor?: string;
  /** Ratio applied to the base account's P&L for a copier (1 = same size). */
  copyMultiplier?: number;
  /** For a copier: the account it follows. */
  copyBaseId?: string;
  /** For a copier: periods during which it was copying (so history stays right). */
  copyPeriods?: CopyPeriod[];
  /** Legacy single-value copy settings (before copyConfigHistory existed). */
  copySizing?: "ratio" | "fixed" | "mirror";
  copyFixedQty?: number;
  copyRound?: "down" | "nearest" | "up";
  copyMinQty?: number;
}

export interface DashboardLayoutItem {
  id: string;
  size: number;
}

export interface AccountGroup {
  id: string;
  name: string;
  accountIds: string[];
}

export interface Payout {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number; // dollars actually withdrawn
  status: "requested" | "paid";
  note?: string;
}

export interface Deposit {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number; // dollars deposited (positive)
  note?: string;
}

/**
 * A balance correction, logged when the platform's own figure and the journal's
 * disagree — most often fees the journal never saw.
 *
 * It is deliberately not called a fee: the journal knows the *difference*
 * between two numbers, not which line the broker wrote. It carries that
 * difference as a dated cash-flow, so the balance matches the platform without
 * rewriting a single trade. `amount` is signed: negative when the account holds
 * less than the journal says (fees were charged), positive when it holds more.
 */
export interface FeeAdjustment {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number; // signed difference: what the account really holds, minus the journal
  note?: string;
  /**
   * "cost" marks a cost the platform charged that no trade could claim (an
   * Orders export aggregated the executions). It flows through the balance like
   * any other dated cash-flow, but it is not a hand-written correction.
   */
  kind?: "cost";
  /** The window this correction was spread over, when it carries a split. */
  period?: { from: string; to: string };
  /** How many trades took a slice of it. */
  trades?: number;
  /** The slice each trade carries, a cent at a time. Empty until it is spread. */
  allocations?: { key: string; date: string; amount: number }[];
  /** The cents that could not be divided evenly, kept so the audit closes. */
  remainderCents?: number;
}
