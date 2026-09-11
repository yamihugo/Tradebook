import { AccountType, PropAccount } from "./types";

export interface PropSize {
  size: number;
  price: string;
  target: number;
  maxLoss: number;
  dailyLoss: number;
  consistency: number;
  posSize: string;
  note?: string;
}

export interface PropProgram {
  id: string;
  label: string;
  tagline: string;
  sizes: PropSize[];
}

export interface PropFirm {
  id: string;
  name: string;
  programs: PropProgram[];
}

export const PROP_FIRMS: PropFirm[] = [
  {
    id: "topstep",
    name: "TopStep",
    programs: [
      {
        id: "combine",
        label: "Trading Combine",
        tagline: "Trailing max loss on end-of-day balance, 50% consistency target, min 2 winning days, 90/10 split after the first $10k.",
        sizes: [
          { size: 50000, price: "$49/mo", target: 3000, maxLoss: 2000, dailyLoss: 1000, consistency: 50, posSize: "5 mini / 50 micro" },
          { size: 100000, price: "$99/mo", target: 6000, maxLoss: 3000, dailyLoss: 2000, consistency: 50, posSize: "10 mini / 100 micro" },
          { size: 150000, price: "$149/mo", target: 9000, maxLoss: 4500, dailyLoss: 3000, consistency: 50, posSize: "15 mini / 150 micro" },
        ],
      },
      {
        id: "xfa",
        label: "Express Funded (XFA)",
        tagline: "Max loss limit that trails on closed balance; no daily loss limit on TopstepX; payout eligibility: 5 winning days of $150+ or 40% consistency.",
        sizes: [
          { size: 50000, price: "No monthly fee", target: 0, maxLoss: 2000, dailyLoss: 0, consistency: 0, posSize: "5 mini / 50 micro", note: "Payout: 5× $150+ winning days, or 40% consistency path" },
          { size: 100000, price: "No monthly fee", target: 0, maxLoss: 3000, dailyLoss: 0, consistency: 0, posSize: "10 mini / 100 micro", note: "Payout: 5× $150+ winning days, or 40% consistency path" },
          { size: 150000, price: "No monthly fee", target: 0, maxLoss: 4500, dailyLoss: 0, consistency: 0, posSize: "15 mini / 150 micro", note: "Payout: 5× $150+ winning days, or 40% consistency path" },
        ],
      },
      {
        id: "lfa",
        label: "Live Funded Account (LFA)",
        tagline: "TopStep real live CME capital: 20% initial starting balance available to trade, 80% reserve unlocked via profit milestones ($3K/$6K/$9K), Daily Loss Limit $2K/$3K/$4.5K, balance floor at $0.",
        sizes: [
          { size: 50000, price: "Live capital", target: 3000, maxLoss: 50000, dailyLoss: 2000, consistency: 0, posSize: "5 mini / 50 micro", note: "20% initial balance to trade ($10K), balance floor $0" },
          { size: 100000, price: "Live capital", target: 6000, maxLoss: 100000, dailyLoss: 3000, consistency: 0, posSize: "10 mini / 100 micro", note: "20% initial balance to trade ($20K), balance floor $0" },
          { size: 150000, price: "Live capital", target: 9000, maxLoss: 150000, dailyLoss: 4500, consistency: 0, posSize: "15 mini / 150 micro", note: "20% initial balance to trade ($30K), balance floor $0" },
        ],
      },
    ],
  },
  {
    id: "tradeify",
    name: "Tradeify",
    programs: [
      {
        id: "growth",
        label: "Growth",
        tagline: "Fastest evaluation (pass in 1 day), no eval consistency, soft daily loss limit, funded phase uses a 35% consistency rule and 5-day payouts.",
        sizes: [
          { size: 25000, price: "One-time", target: 1500, maxLoss: 1000, dailyLoss: 600, consistency: 0, posSize: "1 mini / 10 micro" },
          { size: 50000, price: "One-time", target: 3000, maxLoss: 2000, dailyLoss: 1250, consistency: 0, posSize: "4 mini / 40 micro" },
          { size: 100000, price: "One-time", target: 6000, maxLoss: 3500, dailyLoss: 2500, consistency: 0, posSize: "8 mini / 80 micro" },
          { size: 150000, price: "One-time", target: 9000, maxLoss: 5000, dailyLoss: 3750, consistency: 0, posSize: "12 mini / 120 micro" },
        ],
      },
      {
        id: "select",
        label: "Select",
        tagline: "3-day evaluation, 40% consistency target, no daily loss limit during evaluation; after funding choose Daily payouts (DLL applies) or Flex (no DLL).",
        sizes: [
          { size: 25000, price: "One-time", target: 1500, maxLoss: 1000, dailyLoss: 0, consistency: 40, posSize: "1 mini / 10 micro", note: "Select Daily DLL: $500" },
          { size: 50000, price: "One-time", target: 3000, maxLoss: 2000, dailyLoss: 0, consistency: 40, posSize: "4 mini / 40 micro", note: "Select Daily DLL: $1,000" },
          { size: 100000, price: "One-time", target: 6000, maxLoss: 3000, dailyLoss: 0, consistency: 40, posSize: "8 mini / 80 micro", note: "Select Daily DLL: $1,250" },
          { size: 150000, price: "One-time", target: 9000, maxLoss: 4500, dailyLoss: 0, consistency: 40, posSize: "12 mini / 120 micro", note: "Select Daily DLL: $1,750" },
        ],
      },
      {
        id: "growth-funded",
        label: "Growth Funded",
        tagline: "Simulated funded after passing the Growth eval — drawdown, daily loss and contract limits carry over unchanged, plus a 35% consistency rule and 5 qualifying days before every payout.",
        sizes: [
          { size: 25000, price: "One-time", target: 0, maxLoss: 1000, dailyLoss: 600, consistency: 35, posSize: "1 mini / 10 micro", note: "Payout: 5 profitable days (≥ $100/day) + 35% consistency; min balance $26,500" },
          { size: 50000, price: "One-time", target: 0, maxLoss: 2000, dailyLoss: 1250, consistency: 35, posSize: "4 mini / 40 micro", note: "Payout: 5 profitable days (≥ $150/day) + 35% consistency; min balance $53,000" },
          { size: 100000, price: "One-time", target: 0, maxLoss: 3500, dailyLoss: 2500, consistency: 35, posSize: "8 mini / 80 micro", note: "Payout: 5 profitable days (≥ $200/day) + 35% consistency; min balance $104,500" },
          { size: 150000, price: "One-time", target: 0, maxLoss: 5000, dailyLoss: 3750, consistency: 35, posSize: "12 mini / 120 micro", note: "Payout: 5 profitable days (≥ $250/day) + 35% consistency; min balance $156,500" },
        ],
      },
      {
        id: "select-flex",
        label: "Select Funded · Flex (5-Day)",
        tagline: "Funded Select with the 5-Day payout policy: no daily loss limit, wider drawdown, larger caps — 5 winning days per payout, no minimum balance.",
        sizes: [
          { size: 25000, price: "One-time", target: 0, maxLoss: 1000, dailyLoss: 0, consistency: 0, posSize: "1 mini / 10 micro", note: "Payout: 5 winning days (≥ $100/day), no min balance" },
          { size: 50000, price: "One-time", target: 0, maxLoss: 2000, dailyLoss: 0, consistency: 0, posSize: "4 mini / 40 micro", note: "Payout: 5 winning days (≥ $150/day), no min balance" },
          { size: 100000, price: "One-time", target: 0, maxLoss: 3000, dailyLoss: 0, consistency: 0, posSize: "8 mini / 80 micro", note: "Payout: 5 winning days (≥ $200/day), no min balance" },
          { size: 150000, price: "One-time", target: 0, maxLoss: 4500, dailyLoss: 0, consistency: 0, posSize: "12 mini / 120 micro", note: "Payout: 5 winning days (≥ $250/day), no min balance" },
        ],
      },
      {
        id: "select-daily",
        label: "Select Funded · Daily",
        tagline: "Funded Select with the Daily payout policy: tighter drawdown plus a daily loss limit and a protected profit buffer; drawdown locks at the buffer.",
        sizes: [
          { size: 25000, price: "One-time", target: 0, maxLoss: 1000, dailyLoss: 500, consistency: 0, posSize: "1 mini / 10 micro", note: "DLL $500 · drawdown buffer $1,100" },
          { size: 50000, price: "One-time", target: 0, maxLoss: 2000, dailyLoss: 1000, consistency: 0, posSize: "4 mini / 40 micro", note: "DLL $1,000 · drawdown buffer $2,100" },
          { size: 100000, price: "One-time", target: 0, maxLoss: 2500, dailyLoss: 1250, consistency: 0, posSize: "8 mini / 80 micro", note: "DLL $1,250 · drawdown buffer $2,600" },
          { size: 150000, price: "One-time", target: 0, maxLoss: 3500, dailyLoss: 1750, consistency: 0, posSize: "12 mini / 120 micro", note: "DLL $1,750 · drawdown buffer $3,600" },
        ],
      },
      {
        id: "lightning",
        label: "Lightning Funded",
        tagline: "Instant funding, no evaluation. End-of-day trailing drawdown, progressive consistency rule 20% → 25% → 30% across the first payouts.",
        sizes: [
          { size: 25000, price: "One-time", target: 0, maxLoss: 1500, dailyLoss: 0, consistency: 20, posSize: "1 mini / 10 micro", note: "No daily loss limit on the 25K" },
          { size: 50000, price: "One-time", target: 0, maxLoss: 2500, dailyLoss: 1250, consistency: 20, posSize: "4 mini / 40 micro" },
          { size: 100000, price: "One-time", target: 0, maxLoss: 4000, dailyLoss: 2500, consistency: 20, posSize: "8 mini / 80 micro" },
          { size: 150000, price: "One-time", target: 0, maxLoss: 5250, dailyLoss: 3000, consistency: 20, posSize: "12 mini / 120 micro" },
        ],
      },
      {
        id: "elite-live",
        label: "Tradeify Elite Live",
        tagline: "Tradeify real live CME capital after 3+ payouts: $0 starting balance (all funds are profit), 80/20 profit split, fixed EOD drawdown ($2K), daily payouts, no daily loss limit.",
        sizes: [
          { size: 25000, price: "Live CME", target: 0, maxLoss: 1000, dailyLoss: 0, consistency: 0, posSize: "1 mini / 10 micro", note: "Starts at $0 balance, 80/20 split, daily payouts" },
          { size: 50000, price: "Live CME", target: 0, maxLoss: 2000, dailyLoss: 0, consistency: 0, posSize: "4 mini / 40 micro", note: "Starts at $0 balance, 80/20 split, daily payouts" },
          { size: 100000, price: "Live CME", target: 0, maxLoss: 3000, dailyLoss: 0, consistency: 0, posSize: "8 mini / 80 micro", note: "Starts at $0 balance, 80/20 split, daily payouts" },
          { size: 150000, price: "Live CME", target: 0, maxLoss: 3500, dailyLoss: 0, consistency: 0, posSize: "12 mini / 120 micro", note: "Starts at $0 balance, 80/20 split, daily payouts" },
        ],
      },
    ],
  },
  {
    id: "tradovate",
    name: "Tradeovate",
    programs: [
      {
        id: "demo",
        label: "Demo / Simulation",
        tagline: "Free 14-day trial with $50,000 of simulated funds. Pure practice — unlimited simulated trades, no profit target, no drawdown and no consistency rules.",
        sizes: [
          { size: 50000, price: "Free 14-day", target: 0, maxLoss: 0, dailyLoss: 0, consistency: 0, posSize: "$50,000 simulated · practice only", note: "Simulated account limited to $50,000 (or less) unless your live account balance is higher. No rules — the dashboard just tracks your net performance." },
        ],
      },
    ],
  },
];

export function getFirm(id: string): PropFirm | undefined {
  return PROP_FIRMS.find((f) => f.id === id);
}

export function getProgram(firm: PropFirm | undefined, programId: string): PropProgram | undefined {
  return firm?.programs.find((p) => p.id === programId) ?? firm?.programs[0];
}

export function getSize(program: PropProgram | undefined, size: number): PropSize | undefined {
  return program?.sizes.find((s) => s.size === size) ?? program?.sizes[0];
}

/** Merge a user's per-account rule overrides on top of the firm's defaults. */
export function effectiveSize(
  base: PropSize | undefined,
  overrides?: { target?: number; maxLoss?: number; dailyLoss?: number; consistency?: number; posSize?: string }
): PropSize | undefined {
  if (!base) return undefined;
  if (!overrides) return base;
  return {
    ...base,
    ...(overrides.target !== undefined ? { target: overrides.target } : {}),
    ...(overrides.maxLoss !== undefined ? { maxLoss: overrides.maxLoss } : {}),
    ...(overrides.dailyLoss !== undefined ? { dailyLoss: overrides.dailyLoss } : {}),
    ...(overrides.consistency !== undefined ? { consistency: overrides.consistency } : {}),
    ...(overrides.posSize !== undefined && overrides.posSize.trim() ? { posSize: overrides.posSize.trim() } : {}),
  };
}

export function makeAccount(firm: PropFirm, program: PropProgram, size: number, customName?: string, accountType: AccountType = "eval"): PropAccount {
  const defaultName = `${firm.name} · ${program.label} · $${(size / 1000).toFixed(0)}K`;
  const type: AccountType = accountType || (program.id.includes("funded") || program.id === "lfa" || program.id === "elite-live" ? "funded" : "eval");
  return {
    id: "pa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: customName && customName.trim() ? customName.trim() : defaultName,
    firmId: firm.id,
    programId: program.id,
    size,
    type,
  };
}
