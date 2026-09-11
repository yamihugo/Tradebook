import { AccountType, FuturesSpec } from "./types";

export interface AccountRule {
  type: AccountType;
  keywords: string[];
}

const FUTURES_SPECS: Record<string, FuturesSpec> = {
  NQ: { pointValue: 20, tickSize: 0.25, tickValue: 5, defaultCommission: 2.58, defaultFees: 3.18 },
  ES: { pointValue: 50, tickSize: 0.25, tickValue: 12.5, defaultCommission: 2.58, defaultFees: 1.94 },
  MNQ: { pointValue: 2, tickSize: 0.25, tickValue: 0.5, defaultCommission: 0.52, defaultFees: 0.68 },
  MES: { pointValue: 5, tickSize: 0.25, tickValue: 1.25, defaultCommission: 0.52, defaultFees: 0.50 },
};

const UNKNOWN_SPEC: FuturesSpec = { pointValue: 1, tickSize: 0, tickValue: 0, defaultCommission: 2.58, defaultFees: 2.00 };

export function rootSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  for (const root of ["MNQ", "MES", "MGC", "MCL", "NQ", "ES", "GC", "CL", "YM", "RTY", "SI", "NG"]) {
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

export const DEFAULT_ACCOUNT_RULES: AccountRule[] = [
  { type: "funded", keywords: ["FUNDED", "FUND", "LIVE", "REAL", "PAID", "PASSED", "CERTIFIED"] },
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
