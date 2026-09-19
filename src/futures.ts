import { AccountType, FuturesSpec } from "./types";

export interface AccountRule {
  type: AccountType;
  keywords: string[];
}

/**
 * The contracts we can price.
 *
 * Point value, tick size and tick value are the exchange's and never change;
 * the money per trade in this journal is derived from them (R multiples, risk
 * per trade, P&L from prices). Every root also carries its usual counterpart
 * (mini ↔ micro) so a copy trade can cross the two.
 *
 * Nothing here prices a trade: what a fill actually cost comes from the
 * platform's own cash history, line by line (see parseCashHistoryCsv).
 */
const FUTURES_SPECS: Record<string, FuturesSpec> = {
  // ---- CME equity index ----
  NQ: { name: "E-mini Nasdaq 100", exchange: "CME", group: "equity", kind: "mini", micro: "MNQ", pointValue: 20, tickSize: 0.25, tickValue: 5 },
  MNQ: { name: "Micro E-mini Nasdaq 100", exchange: "CME", group: "equity", kind: "micro", mini: "NQ", pointValue: 2, tickSize: 0.25, tickValue: 0.5 },
  ES: { name: "E-mini S&P 500", exchange: "CME", group: "equity", kind: "mini", micro: "MES", pointValue: 50, tickSize: 0.25, tickValue: 12.5 },
  MES: { name: "Micro E-mini S&P 500", exchange: "CME", group: "equity", kind: "micro", mini: "ES", pointValue: 5, tickSize: 0.25, tickValue: 1.25 },
  RTY: { name: "E-mini Russell 2000", exchange: "CME", group: "equity", kind: "mini", micro: "M2K", pointValue: 50, tickSize: 0.1, tickValue: 5 },
  M2K: { name: "Micro E-mini Russell 2000", exchange: "CME", group: "equity", kind: "micro", mini: "RTY", pointValue: 5, tickSize: 0.1, tickValue: 0.5 },
  YM: { name: "Mini-Dow", exchange: "CBOT", group: "equity", kind: "mini", micro: "MYM", pointValue: 5, tickSize: 1, tickValue: 5 },
  MYM: { name: "Micro Mini-Dow", exchange: "CBOT", group: "equity", kind: "micro", mini: "YM", pointValue: 0.5, tickSize: 1, tickValue: 0.5 },
  NKD: { name: "Nikkei 225 (USD)", exchange: "CME", group: "equity", kind: "other", pointValue: 5, tickSize: 5, tickValue: 25 },

  // ---- energy ----
  CL: { name: "Crude Oil", exchange: "NYMEX", group: "energy", kind: "mini", micro: "MCL", pointValue: 1000, tickSize: 0.01, tickValue: 10 },
  MCL: { name: "Micro Crude Oil", exchange: "NYMEX", group: "energy", kind: "micro", mini: "CL", pointValue: 100, tickSize: 0.01, tickValue: 1 },
  QM: { name: "E-mini Crude Oil", exchange: "NYMEX", group: "energy", kind: "other", pointValue: 500, tickSize: 0.025, tickValue: 12.5 },
  NG: { name: "Natural Gas", exchange: "NYMEX", group: "energy", kind: "mini", micro: "MNG", pointValue: 10000, tickSize: 0.001, tickValue: 10 },
  MNG: { name: "Micro Henry Hub Natural Gas", exchange: "NYMEX", group: "energy", kind: "micro", mini: "NG", pointValue: 2500, tickSize: 0.001, tickValue: 2.5 },
  QG: { name: "E-mini Natural Gas", exchange: "NYMEX", group: "energy", kind: "other", pointValue: 2500, tickSize: 0.005, tickValue: 12.5 },
  RB: { name: "RBOB Gasoline", exchange: "NYMEX", group: "energy", kind: "other", pointValue: 42000, tickSize: 0.0001, tickValue: 4.2 },
  HO: { name: "Heating Oil", exchange: "NYMEX", group: "energy", kind: "other", pointValue: 42000, tickSize: 0.0001, tickValue: 4.2 },

  // ---- metals ----
  GC: { name: "Gold", exchange: "COMEX", group: "metal", kind: "mini", micro: "MGC", pointValue: 100, tickSize: 0.1, tickValue: 10 },
  MGC: { name: "Micro Gold", exchange: "COMEX", group: "metal", kind: "micro", mini: "GC", pointValue: 10, tickSize: 0.1, tickValue: 1 },
  SI: { name: "Silver", exchange: "COMEX", group: "metal", kind: "mini", micro: "SIL", pointValue: 5000, tickSize: 0.005, tickValue: 25 },
  SIL: { name: "Micro Silver", exchange: "COMEX", group: "metal", kind: "micro", mini: "SI", pointValue: 1000, tickSize: 0.005, tickValue: 5 },
  HG: { name: "Copper", exchange: "COMEX", group: "metal", kind: "mini", micro: "MHG", pointValue: 25000, tickSize: 0.0005, tickValue: 12.5 },
  MHG: { name: "Micro Copper", exchange: "COMEX", group: "metal", kind: "micro", mini: "HG", pointValue: 2500, tickSize: 0.0005, tickValue: 1.25 },
  PL: { name: "Platinum", exchange: "NYMEX", group: "metal", kind: "other", pointValue: 50, tickSize: 0.1, tickValue: 5 },

  // ---- interest rates ----
  ZT: { name: "2-Year Note", exchange: "CBOT", group: "rate", kind: "other", pointValue: 2000, tickSize: 0.0078125, tickValue: 15.625 },
  ZF: { name: "5-Year Note", exchange: "CBOT", group: "rate", kind: "other", pointValue: 1000, tickSize: 0.0078125, tickValue: 7.8125 },
  ZN: { name: "10-Year Note", exchange: "CBOT", group: "rate", kind: "other", pointValue: 1000, tickSize: 0.015625, tickValue: 15.625 },
  TN: { name: "Ultra 10-Year Note", exchange: "CBOT", group: "rate", kind: "other", pointValue: 1000, tickSize: 0.015625, tickValue: 15.625 },
  ZB: { name: "30-Year Bond", exchange: "CBOT", group: "rate", kind: "other", pointValue: 1000, tickSize: 0.03125, tickValue: 31.25 },
  UB: { name: "Ultra Bond", exchange: "CBOT", group: "rate", kind: "other", pointValue: 1000, tickSize: 0.03125, tickValue: 31.25 },

  // ---- currencies ----
  "6E": { name: "Euro FX", exchange: "CME", group: "fx", kind: "mini", micro: "M6E", pointValue: 125000, tickSize: 0.00005, tickValue: 6.25 },
  M6E: { name: "Micro EUR/USD", exchange: "CME", group: "fx", kind: "micro", mini: "6E", pointValue: 12500, tickSize: 0.0001, tickValue: 1.25 },
  "6B": { name: "British Pound", exchange: "CME", group: "fx", kind: "mini", micro: "M6B", pointValue: 62500, tickSize: 0.0001, tickValue: 6.25 },
  M6B: { name: "Micro GBP/USD", exchange: "CME", group: "fx", kind: "micro", mini: "6B", pointValue: 6250, tickSize: 0.0001, tickValue: 0.625 },
  "6J": { name: "Japanese Yen", exchange: "CME", group: "fx", kind: "other", pointValue: 12500000, tickSize: 0.0000005, tickValue: 6.25 },
  "6A": { name: "Australian Dollar", exchange: "CME", group: "fx", kind: "mini", micro: "M6A", pointValue: 100000, tickSize: 0.00005, tickValue: 5 },
  M6A: { name: "Micro AUD/USD", exchange: "CME", group: "fx", kind: "micro", mini: "6A", pointValue: 10000, tickSize: 0.0001, tickValue: 1 },
  "6C": { name: "Canadian Dollar", exchange: "CME", group: "fx", kind: "other", pointValue: 100000, tickSize: 0.00005, tickValue: 5 },
  "6S": { name: "Swiss Franc", exchange: "CME", group: "fx", kind: "other", pointValue: 125000, tickSize: 0.0001, tickValue: 12.5 },
  "6M": { name: "Mexican Peso", exchange: "CME", group: "fx", kind: "other", pointValue: 500000, tickSize: 0.00001, tickValue: 5 },
  "6N": { name: "New Zealand Dollar", exchange: "CME", group: "fx", kind: "other", pointValue: 100000, tickSize: 0.00005, tickValue: 5 },
  E7: { name: "E-mini Euro FX", exchange: "CME", group: "fx", kind: "other", pointValue: 62500, tickSize: 0.0001, tickValue: 6.25 },

  // ---- agriculture ----
  HE: { name: "Lean Hogs", exchange: "CME", group: "ag", kind: "other", pointValue: 400, tickSize: 0.025, tickValue: 10 },
  LE: { name: "Live Cattle", exchange: "CME", group: "ag", kind: "other", pointValue: 400, tickSize: 0.025, tickValue: 10 },
  ZC: { name: "Corn", exchange: "CBOT", group: "ag", kind: "other", pointValue: 50, tickSize: 0.25, tickValue: 12.5 },
  ZW: { name: "Wheat", exchange: "CBOT", group: "ag", kind: "other", pointValue: 50, tickSize: 0.25, tickValue: 12.5 },
  ZS: { name: "Soybean", exchange: "CBOT", group: "ag", kind: "other", pointValue: 50, tickSize: 0.25, tickValue: 12.5 },
  ZM: { name: "Soybean Meal", exchange: "CBOT", group: "ag", kind: "other", pointValue: 100, tickSize: 0.1, tickValue: 10 },
  ZL: { name: "Soybean Oil", exchange: "CBOT", group: "ag", kind: "other", pointValue: 600, tickSize: 0.01, tickValue: 6 },

  // ---- crypto (micros only — that is what the exchanges list) ----
  MBT: { name: "Micro Bitcoin", exchange: "CME", group: "crypto", kind: "micro", pointValue: 0.1, tickSize: 5, tickValue: 0.5 },
  MET: { name: "Micro Ether", exchange: "CME", group: "crypto", kind: "micro", pointValue: 0.1, tickSize: 0.5, tickValue: 0.05 },
};

const UNKNOWN_SPEC: FuturesSpec = { pointValue: 1, tickSize: 0, tickValue: 0 };

/** Instruments available in the Add Trade symbol selector — the common ones
 *  first, then the rest, so nothing is missing but nothing gets in the way. */
const ORDER = ["NQ", "MNQ", "ES", "MES", "RTY", "M2K", "YM", "MYM", "GC", "MGC", "CL", "MCL", "NG", "MNG", "SI", "SIL", "HG", "MHG"];
export const FUTURES_SYMBOLS: string[] = [
  ...ORDER,
  ...Object.keys(FUTURES_SPECS).filter((s) => !ORDER.includes(s)),
];

/** The contracts, by market — for a grouped picker or a symbol breakdown. */
export const FUTURES_GROUPS: Record<string, string[]> = Object.keys(FUTURES_SPECS).reduce(
  (acc, sym) => {
    const g = FUTURES_SPECS[sym].group ?? "other";
    (acc[g] ||= []).push(sym);
    return acc;
  },
  {} as Record<string, string[]>
);

// Longest root first: NKD has to win over N, MGC over M… whatever the symbol.
const ROOTS: string[] = Object.keys(FUTURES_SPECS).sort((a, b) => b.length - a.length);

export function rootSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  for (const root of ROOTS) {
    if (s.startsWith(root)) return root;
  }
  let letters = "";
  for (const ch of s) {
    if (ch >= "A" && ch <= "Z") letters += ch;
    else break;
  }
  return letters;
}

export function futuresSpec(symbol: string): FuturesSpec {
  return FUTURES_SPECS[rootSymbol(symbol)] ?? UNKNOWN_SPEC;
}

/** The micro version of a mini, when one exists (NQ → MNQ). */
export function microOf(symbol: string): string | undefined {
  return futuresSpec(symbol).micro;
}

/** And back (MNQ → NQ). */
export function miniOf(symbol: string): string | undefined {
  return futuresSpec(symbol).mini;
}

export const DEFAULT_ACCOUNT_RULES: AccountRule[] = [
  { type: "funded", keywords: ["FUNDED", "FUND", "REAL", "PAID", "PASSED", "CERTIFIED", "LIVE"] },
  { type: "eval", keywords: ["EVAL", "EVALUATION", "COMBINE", "FUNDING", "CHALLENGE", "PROP", "TOPSTEP", "TOPSSTEP", "TOSTEP", "TDF", "AXIO", "KWR", "T4C", "APEX", "TAKEPRO"] },
  { type: "demo", keywords: ["DEMO", "SIM", "SIMU", "SIMULATED", "PAPER", "TRAINING", "PRACTICE"] },
];

export function classifyAccount(account: string, rules?: AccountRule[]): AccountType {
  const name = account.toUpperCase().trim();
  if (!name) return "unknown";
  if (!rules || rules.length === 0) rules = DEFAULT_ACCOUNT_RULES;
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (name.includes(kw.toUpperCase())) return rule.type;
    }
  }
  return /^\d+$/.test(name) ? "demo" : "unknown";
}
