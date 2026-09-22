import { AccountType, PropAccount } from "./types";

export interface PropSize {
  /** How the consistency rule is computed:
   *  - "profit" (default): best day ÷ total profit ≤ consistency %
   *  - "target": best day ÷ profit target ≤ consistency %
   *  TopStep and Tradeify both define it on total profit.
   */
  consistencyBasis?: "profit" | "target";
  /** Drawdown behaviour — drives the floor calculation.
   *  - "eod-trailing": trails the highest end-of-day balance, then locks.
   *  - "eod-trailing-open": trails the highest end-of-day balance and never
   *    locks — the floor keeps rising with the peak for the life of the account.
   *  - "intraday-trailing": same, but measured on the running high, not the close.
   *  - "static": never moves.
   */
  maxLossType?: "eod-trailing" | "intraday-trailing" | "eod-trailing-open" | "static";
  /** Where a trailing drawdown stops trailing, in dollars above the starting
   *  balance (Tradeify locks it at +$100). 0/undefined = locks at break-even.
   *  Ignored by "eod-trailing-open", which never locks. */
  ddLockOffset?: number;
  /** Minimum trading days before a pass / payout (informational). */
  minDays?: number;
  /** Anything the trader must know about the daily loss limit that the number
   *  alone does not say (TopStep: it only applies off TopstepX). */
  dailyLossNote?: string;
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
  /** Which account type this program is for — lets the wizard show only the
   *  programs that match the chosen type (eval ≠ funded ≠ live). */
  phase?: "eval" | "funded" | "live" | "demo" | "personal";
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
        phase: "eval",
        label: "Trading Combine",
        tagline: "One Rule: the max loss limit trails your end-of-day balance high and locks at the starting balance. 55% consistency target, 2 winning days minimum, and the daily loss limit is a soft safety net.",
        sizes: [
          {
            size: 50000, price: "$49/mo · no-act: $85",
            target: 3000, maxLoss: 2000, dailyLoss: 1000, consistency: 55, posSize: "5 mini / 50 micro",
            consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 2,
            note: "Consistency: best day ≤ 55% of total profit. Daily loss limit is part of Responsible Trading Advantage — soft: it pauses the session, it never fails the account. Reset fee $49 (one free reset credit per rebill). Express Funded activation $149, or free on the no-activation-fee path.",
          },
          {
            size: 100000, price: "$99/mo · no-act: $129",
            target: 6000, maxLoss: 3000, dailyLoss: 2000, consistency: 55, posSize: "10 mini / 100 micro",
            consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 2,
            note: "Consistency: best day ≤ 55% of total profit. Daily loss limit is part of Responsible Trading Advantage — soft. Reset fee $99. Express Funded activation $149, or free on the no-activation-fee path.",
          },
          {
            size: 150000, price: "$199/mo",
            target: 9000, maxLoss: 4500, dailyLoss: 3000, consistency: 55, posSize: "15 mini / 150 micro",
            consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 2,
            note: "Consistency: best day ≤ 55% of total profit. Daily loss limit is part of Responsible Trading Advantage — soft. Reset fee $199. Express Funded activation $149, or free on the no-activation-fee path.",
          },
        ],
      },
      {
        id: "xfa",
        phase: "funded",
        label: "Express Funded (XFA)",
        tagline: "Funded after the Combine. The max loss limit starts at −$2,000 and trails the highest end-of-day balance until it locks at $0 — from there only profit is at risk. Two payout routes: Standard (5 winning days of $150+) or Consistency (40% over 3 days).",
        sizes: [
          {
            size: 50000, price: "Activation $149 · free without it",
            target: 0, maxLoss: 2000, dailyLoss: 1000, consistency: 40, posSize: "Scaling plan by balance",
            consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, ddLockOffset: 0,
            dailyLossNote: "Only applies when you trade off TopstepX — accounts on TopstepX have no daily loss limit.",
            note: "Max loss limit $2,000, trailing the highest end-of-day balance and locking at $0. Touching it closes the account permanently. Up to 5 active XFAs at a time. All positions must be closed by 3:10 PM CT.",
          },
          {
            size: 100000, price: "Activation $149 · free without it",
            target: 0, maxLoss: 3000, dailyLoss: 2000, consistency: 40, posSize: "Scaling plan by balance",
            consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, ddLockOffset: 0,
            dailyLossNote: "Only applies when you trade off TopstepX — accounts on TopstepX have no daily loss limit.",
            note: "Same route to a payout as the 50K: 5 winning days of $150+, or the 40% consistency route over 3 days. Drawdown locks at $0.",
          },
          {
            size: 150000, price: "Activation $149 · free without it",
            target: 0, maxLoss: 4500, dailyLoss: 3000, consistency: 40, posSize: "Scaling plan by balance",
            consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, ddLockOffset: 0,
            dailyLossNote: "Only applies when you trade off TopstepX — accounts on TopstepX have no daily loss limit.",
            note: "Same route to a payout as the 50K: 5 winning days of $150+, or the 40% consistency route over 3 days. Drawdown locks at $0.",
          },
        ],
      },
      {
        id: "lfa",
        phase: "live",
        label: "Live Funded Account (LFA)",
        tagline: "Topstep real live CME capital. 20% of the balance is available to trade, the reserve unlocks in profit milestones, and there is no trailing drawdown — the account simply closes if the balance falls below $1,000.",
        sizes: [
          { size: 50000, price: "Live capital · data fees", target: 3000, maxLoss: 49000, dailyLoss: 2000, consistency: 0, posSize: "5 mini / 50 micro", maxLossType: "static", note: "20% available to trade ($10K). Reserve unlocks at $3K/$6K/$9K profit. The daily loss limit is automatic here, and the account closes below $1,000 of balance." },
          { size: 100000, price: "Live capital · data fees", target: 6000, maxLoss: 99000, dailyLoss: 3000, consistency: 0, posSize: "10 mini / 100 micro", maxLossType: "static", note: "20% available to trade ($20K). Reserve unlocks at $3K/$6K/$9K profit. Account closes below $1,000 of balance." },
          { size: 150000, price: "Live capital · data fees", target: 9000, maxLoss: 149000, dailyLoss: 4500, consistency: 0, posSize: "15 mini / 150 micro", maxLossType: "static", note: "20% available to trade ($30K). Reserve unlocks at $3K/$6K/$9K profit. Account closes below $1,000 of balance." },
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
        phase: "eval",
        label: "Growth",
        tagline: "Fastest evaluation — pass in a single day if the target is hit. No consistency in the evaluation, and the daily loss limit is soft.",
        sizes: [
          { size: 25000, price: "$99 · reset $60", target: 1500, maxLoss: 1000, dailyLoss: 600, consistency: 0, posSize: "1 mini / 10 micro", maxLossType: "eod-trailing", minDays: 1, note: "Soft daily loss limit. Reset fees: 25K $60 · 50K $95 · 100K $155 · 150K $215." },
          { size: 50000, price: "$145 · reset $95", target: 3000, maxLoss: 2000, dailyLoss: 1250, consistency: 0, posSize: "4 mini / 40 micro", maxLossType: "eod-trailing", minDays: 1, note: "Soft daily loss limit." },
          { size: 100000, price: "$255 · reset $155", target: 6000, maxLoss: 3500, dailyLoss: 2500, consistency: 0, posSize: "8 mini / 80 micro", maxLossType: "eod-trailing", minDays: 1, note: "Soft daily loss limit." },
          { size: 150000, price: "$369 · reset $215", target: 9000, maxLoss: 5000, dailyLoss: 3750, consistency: 0, posSize: "12 mini / 120 micro", maxLossType: "eod-trailing", minDays: 1, note: "Soft daily loss limit." },
        ],
      },
      {
        id: "select",
        phase: "eval",
        label: "Select",
        tagline: "Three-day evaluation with a 40% consistency target and no daily loss limit at all. A 50% consistency add-on is available: it costs more but drops the minimum to two trading days.",
        sizes: [
          { size: 25000, price: "$109 · 50%: $135", target: 1500, maxLoss: 1000, dailyLoss: 0, consistency: 40, posSize: "1 mini / 10 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, note: "Consistency: largest day ÷ total profit. No daily loss limit. After passing you pick the payout policy: Flex (5-Day) or Daily." },
          { size: 50000, price: "$165 · 50%: $205", target: 3000, maxLoss: 2000, dailyLoss: 0, consistency: 40, posSize: "4 mini / 40 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, note: "Consistency: largest day ÷ total profit. No daily loss limit." },
          { size: 100000, price: "$265 · 50%: $329", target: 6000, maxLoss: 3000, dailyLoss: 0, consistency: 40, posSize: "8 mini / 80 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, note: "Consistency: largest day ÷ total profit. No daily loss limit." },
          { size: 150000, price: "$369 · 50%: $459", target: 9000, maxLoss: 4500, dailyLoss: 0, consistency: 40, posSize: "12 mini / 120 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", minDays: 3, note: "Consistency: largest day ÷ total profit. No daily loss limit." },
        ],
      },
      {
        id: "growth-funded",
        phase: "funded",
        label: "Growth Funded",
        tagline: "Funded after the Growth evaluation. Drawdown, daily loss and contract limits carry over, plus a 35% consistency rule and 5 profitable days before every payout.",
        sizes: [
          { size: 25000, price: "Included", target: 0, maxLoss: 1000, dailyLoss: 600, consistency: 35, posSize: "1 mini / 10 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 profitable days (≥ $100/day) and 35% consistency; minimum balance $26,500. Drawdown locks $100 above the starting balance." },
          { size: 50000, price: "Included", target: 0, maxLoss: 2000, dailyLoss: 1250, consistency: 35, posSize: "4 mini / 40 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 profitable days (≥ $150/day) and 35% consistency; minimum balance $53,000. Drawdown locks $100 above the starting balance." },
          { size: 100000, price: "Included", target: 0, maxLoss: 3500, dailyLoss: 2500, consistency: 35, posSize: "8 mini / 80 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 profitable days (≥ $200/day) and 35% consistency; minimum balance $104,500. Drawdown locks $100 above the starting balance." },
          { size: 150000, price: "Included", target: 0, maxLoss: 5000, dailyLoss: 3750, consistency: 35, posSize: "12 mini / 120 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 profitable days (≥ $250/day) and 35% consistency; minimum balance $156,500. Drawdown locks $100 above the starting balance." },
        ],
      },
      {
        id: "select-flex",
        phase: "funded",
        label: "Select Funded · Flex (5-Day)",
        tagline: "Funded Select on the 5-Day policy: no daily loss limit, no consistency, and 5 winning days per payout with no minimum balance.",
        sizes: [
          { size: 25000, price: "Included", target: 0, maxLoss: 1000, dailyLoss: 0, consistency: 0, posSize: "2 mini / 20 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 winning days (≥ $100/day), no minimum balance, up to 50% of total profit. Drawdown locks $100 above the starting balance." },
          { size: 50000, price: "Included", target: 0, maxLoss: 2000, dailyLoss: 0, consistency: 0, posSize: "4 mini / 40 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 winning days (≥ $150/day), no minimum balance, up to 50% of total profit. Drawdown locks $100 above the starting balance." },
          { size: 100000, price: "Included", target: 0, maxLoss: 3000, dailyLoss: 0, consistency: 0, posSize: "8 mini / 80 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 winning days (≥ $200/day), no minimum balance, up to 50% of total profit. Drawdown locks $100 above the starting balance." },
          { size: 150000, price: "Included", target: 0, maxLoss: 4500, dailyLoss: 0, consistency: 0, posSize: "12 mini / 120 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout: 5 winning days (≥ $250/day), no minimum balance, up to 50% of total profit. Drawdown locks $100 above the starting balance." },
        ],
      },
      {
        id: "select-daily",
        phase: "funded",
        label: "Select Funded · Daily",
        tagline: "Funded Select on the Daily policy: tighter drawdown plus a daily loss limit and a protected profit buffer — the drawdown locks in at the buffer.",
        sizes: [
          { size: 25000, price: "Included", target: 0, maxLoss: 1000, dailyLoss: 500, consistency: 0, posSize: "2 mini / 20 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "DLL $500 (soft) · drawdown buffer $1,100. Minimum payout $250." },
          { size: 50000, price: "Included", target: 0, maxLoss: 2000, dailyLoss: 1000, consistency: 0, posSize: "4 mini / 40 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "DLL $1,000 (soft) · drawdown buffer $2,100. Minimum payout $250." },
          { size: 100000, price: "Included", target: 0, maxLoss: 2500, dailyLoss: 1250, consistency: 0, posSize: "8 mini / 80 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "DLL $1,250 (soft) · drawdown buffer $2,600. Minimum payout $250." },
          { size: 150000, price: "Included", target: 0, maxLoss: 3500, dailyLoss: 1750, consistency: 0, posSize: "12 mini / 120 micro", maxLossType: "eod-trailing", ddLockOffset: 100, note: "DLL $1,750 (soft) · drawdown buffer $3,600. Minimum payout $250." },
        ],
      },
      {
        id: "lightning",
        phase: "funded",
        label: "Lightning Funded",
        tagline: "Instant funding, no evaluation. The consistency rule tightens with each payout: 20% → 25% → 30%. Drawdown trails end-of-day and locks $100 above the starting balance.",
        sizes: [
          { size: 25000, price: "$345 one-time", target: 1500, maxLoss: 1000, dailyLoss: 0, consistency: 20, posSize: "1 mini / 10 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout 1 goal $1,500 (later payouts $1,000). Consistency 20% → 25% → 30% across the first three payouts. No daily loss limit on the 25K. Minimum payout $1,000." },
          { size: 50000, price: "$492 one-time", target: 3000, maxLoss: 2000, dailyLoss: 1250, consistency: 20, posSize: "4 mini / 40 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout 1 goal $3,000 (later payouts $2,000). Consistency 20% → 25% → 30%. Minimum payout $1,000." },
          { size: 100000, price: "$660 one-time", target: 6000, maxLoss: 4000, dailyLoss: 2500, consistency: 20, posSize: "8 mini / 80 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout 1 goal $6,000 (later payouts $3,500). Consistency 20% → 25% → 30%. Minimum payout $1,000." },
          { size: 150000, price: "$796 one-time", target: 9000, maxLoss: 5250, dailyLoss: 3000, consistency: 20, posSize: "12 mini / 120 micro", consistencyBasis: "profit", maxLossType: "eod-trailing", ddLockOffset: 100, note: "Payout 1 goal $9,000 (later payouts $4,500). Consistency 20% → 25% → 30%. Minimum payout $1,000." },
        ],
      },
      {
        id: "elite-live",
        phase: "live",
        label: "Tradeify Elite Live",
        tagline: "Tradeify real live CME capital, reached after three or more payouts. You start at $0 — everything on the account is profit — with an 80/20 split, daily payouts, no daily loss limit and a fixed end-of-day drawdown.",
        sizes: [
          { size: 25000, price: "Live CME transition", target: 0, maxLoss: 1500, dailyLoss: 0, consistency: 0, posSize: "1 mini / 10 micro → 2 / 20", maxLossType: "static", note: "Starts at $0: all profit. 80/20 split, daily payouts. Fixed end-of-day drawdown — it does not trail." },
          { size: 50000, price: "Live CME transition", target: 0, maxLoss: 2000, dailyLoss: 0, consistency: 0, posSize: "2 mini / 20 micro → 4 / 40", maxLossType: "static", note: "Starts at $0: all profit. 80/20 split, daily payouts. Fixed end-of-day drawdown." },
          { size: 100000, price: "Live CME transition", target: 0, maxLoss: 3000, dailyLoss: 0, consistency: 0, posSize: "4 mini / 40 micro → 8 / 80", maxLossType: "static", note: "Starts at $0: all profit. 80/20 split, daily payouts. Fixed end-of-day drawdown." },
          { size: 150000, price: "Live CME transition", target: 0, maxLoss: 4500, dailyLoss: 0, consistency: 0, posSize: "6 mini / 40 micro → 12 / 120", maxLossType: "static", note: "Starts at $0: all profit. 80/20 split, daily payouts. Fixed end-of-day drawdown. (Tradeify's own page lists the 150K starting size as 6 mini / 40 micro.)" },
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
        phase: "demo",
        label: "Demo / Simulation",
        tagline: "Free 14-day trial with $50,000 of simulated funds. Pure practice — unlimited simulated trades, no profit target, no drawdown and no consistency rules.",
        sizes: [
          { size: 50000, price: "Free 14-day", target: 0, maxLoss: 0, dailyLoss: 0, consistency: 0, posSize: "$50,000 simulated · practice only", note: "Simulated account limited to $50,000 (or less) unless your live account balance is higher. No rules — the dashboard just tracks your net performance." },
        ],
      },
    ],
  },
  {
    id: "own",
    name: "Own / Practice",
    programs: [
      {
        id: "personal",
        phase: "personal",
        label: "Personal (own money)",
        tagline: "Your own capital. No prop rules — the journal just tracks performance on top of your starting balance.",
        sizes: [
          { size: 10000, price: "—", target: 0, maxLoss: 0, dailyLoss: 0, consistency: 0, posSize: "—", note: "Starting balance is set per account." },
        ],
      },
      {
        id: "demo",
        phase: "demo",
        label: "Demo / Sim",
        tagline: "Simulated money. No rules, unlimited practice — useful to test a strategy before risking capital.",
        sizes: [
          { size: 50000, price: "Free", target: 0, maxLoss: 0, dailyLoss: 0, consistency: 0, posSize: "—" },
        ],
      },
    ],
  },
];

export function getFirm(id: string): PropFirm | undefined {
  return PROP_FIRMS.find((f) => f.id === id);
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

/** Make a base name unique against the names already in use. */
export function uniqueAccountName(base: string, taken: string[]): string {
  const set = new Set((taken || []).map((n) => (n || "").toLowerCase()));
  const clean = (base || "Account").trim() || "Account";
  if (!set.has(clean.toLowerCase())) return clean;
  for (let n = 2; n < 999; n++) {
    const candidate = `${clean} #${n}`;
    if (!set.has(candidate.toLowerCase())) return candidate;
  }
  return `${clean} #${Date.now().toString(36).slice(-3)}`;
}

export function makeAccount(firm: PropFirm, program: PropProgram, size: number, customName?: string, accountType: AccountType = "eval"): PropAccount {
  const type: AccountType = accountType || (program.id.includes("funded") || program.id === "lfa" || program.id === "elite-live" ? "funded" : "eval");
  const typeName = type.charAt(0).toUpperCase() + type.slice(1);
  const defaultName = `${firm.name} · ${typeName} · $${(size / 1000).toFixed(0)}K`;
  return {
    id: "pa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: customName && customName.trim() ? customName.trim() : defaultName,
    firmId: firm.id,
    programId: program.id,
    size,
    type,
    createdAt: new Date().toISOString().slice(0, 10),
  };
}
