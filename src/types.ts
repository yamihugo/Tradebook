export type AccountType = "demo" | "eval" | "funded" | "live" | "personal" | "unknown";

export interface FuturesSpec {
  pointValue: number; // dollar value of 1.0 point movement
  tickSize: number;
  tickValue: number;
  defaultCommission: number;
  defaultFees: number;
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
  commission: number;
  fees: number;
  grossPnl: number;
  pnl: number; // net dollars
  pnlPoints: number;
  setup: string;
  mistake: string;
  thesis: string;
  review: string;
  screenshot: string; // wikilink or empty
  /** 1-5 star rating of execution/setup quality (0 = unrated). */
  rating?: number;
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

export interface PropAccount {
  id: string;
  name: string;
  firmId: string;
  programId: string;
  size: number;
  type: AccountType;
  /** Optional rule overrides — when a prop firm changes its rules you can
   *  edit them in Settings instead of waiting for a plugin update. */
  rules?: PropAccountRuleOverrides;
  /** When an eval passes and is upgraded to a funded account, the new funded
   *  account keeps a back-reference to the eval that created it. */
  linkedEvalId?: string;
  /** The eval account remembers which funded account it was upgraded into,
   *  so archive/restore can stay bidirectional without creating duplicates. */
  linkedFundedId?: string;
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
