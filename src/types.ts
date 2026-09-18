export type AccountType = "demo" | "eval" | "funded" | "live" | "personal" | "unknown";

export interface FuturesSpec {
  pointValue: number; // dollar value of 1.0 point movement
  tickSize: number;
  tickValue: number;
  defaultCommission: number;
  defaultFees: number;
  /** What the contract is called — for the picker and for tooltips. */
  name?: string;
  exchange?: string;
  /** Which market it belongs to, so a picker with 40+ symbols stays readable. */
  group?: "equity" | "energy" | "metal" | "rate" | "fx" | "ag" | "crypto";
  /** Mini or micro, with the counterpart root, so a copy can cross the two. */
  kind?: "mini" | "micro" | "other";
  micro?: string;
  mini?: string;
  /** Exchange fee per ROUND TURN (USD). Set by the exchange, so it is the same
   *  at every broker; the commission and the NFA fee come from the cost
   *  profile. Source: TopstepX commissions & fees. */
  rtExchange?: number;
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
  grossPnl: number;
  pnl: number; // net dollars
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
  /** Free-form labels. Per project decision these are for psychology/context
   *  (e.g. "revenge trade", "FOMO", "news day") — NOT strategies/setups. */
  tags?: string[];

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
  skipped: number;
  accountsSeen: { name: string; type: AccountType }[];
}

export interface PropAccountRuleOverrides {
  target?: number;
  maxLoss?: number;
  dailyLoss?: number;
  consistency?: number;
  posSize?: string;
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
  /** Optional rule overrides — when a prop firm changes its rules you can
   *  edit them in Settings instead of waiting for a plugin update. */
  rules?: PropAccountRuleOverrides;
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
  copyCrossOrder?: boolean;
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
