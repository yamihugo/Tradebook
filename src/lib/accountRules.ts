/**
 * The single place an account's rules are resolved.
 *
 * The account is the source of truth: `acc.rules` holds exactly what the trader
 * entered. Accounts created before the user-driven model only carry the fields
 * they overrode, so we seed the missing ones from the firm's published preset
 * (`PROP_FIRMS`) — a compatibility path, never the backbone.
 *
 * Nothing here enforces a rule: it only answers "what are this account's
 * numbers?" so the journal can report against them.
 */

import { AccountRules, AccountType, PropAccount } from "../types";
import { PropFirm, PropProgram, PropSize, getFirm, getSize } from "../props";

export interface ResolvedRules {
  /** 0 reads as "no rule of this kind", exactly like the firm presets. */
  target: number;
  maxLoss: number;
  dailyLoss: number;
  consistency: number;
  consistencyBasis?: "profit" | "target";
  posSize?: string;
  maxLossType?: "eod-trailing" | "intraday-trailing" | "eod-trailing-open" | "static";
  ddLockOffset?: number;
  minDays?: number;
  dailyLossNote?: string;
  note?: string;
}

export interface AccountView {
  firm?: PropFirm;
  program?: PropProgram;
  /** The firm's preset, when one exists (the "Using firm default" hint). */
  firmDefault?: PropSize;
  /** What the account actually answers to, preset + overrides. */
  rules: ResolvedRules;
}

export function isPropType(t: AccountType): boolean {
  return t === "eval" || t === "funded" || t === "live";
}

const RULE_KEYS: Array<keyof ResolvedRules> = [
  "target",
  "maxLoss",
  "dailyLoss",
  "consistency",
  "consistencyBasis",
  "posSize",
  "maxLossType",
  "ddLockOffset",
  "minDays",
  "dailyLossNote",
  "note",
];

export function resolveAccountView(acc: PropAccount): AccountView {
  const firm = getFirm(acc.firmId);
  const program = firm ? resolveProgram(firm, acc.programId, acc.type) : undefined;
  const firmDefault = program ? getSize(program, acc.size) : undefined;
  return { firm, program, firmDefault, rules: mergeRules(firmDefault, acc.rules, acc.size) };
}

/**
 * Match a firm program to an account. `props.getProgram` falls back to the
 * first program of the firm, which is wrong for wizard-created accounts: they
 * store the account TYPE as the program id ("funded"), so a funded account
 * would show an eval program's defaults. Match the id exactly, then fall back
 * to the program whose phase is the account type, and otherwise admit there is
 * no preset.
 */
function resolveProgram(firm: PropFirm, programId: string, type: AccountType): PropProgram | undefined {
  const exact = firm.programs.find((p) => p.id === programId);
  if (exact) return exact;
  return firm.programs.find((p) => p.phase === type);
}

export interface DrawdownLabel {
  /** Short name of the drawdown model. */
  label: string;
  /** One line describing where the floor moves to. */
  lock: string;
}

/** Human name of an account's drawdown model, from the resolved rules. */
export function drawdownLabel(rules: Pick<ResolvedRules, "maxLossType" | "ddLockOffset">): DrawdownLabel {
  const type = rules.maxLossType ?? "eod-trailing";
  const offset = rules.ddLockOffset ?? 0;
  if (type === "static") return { label: "Static floor", lock: "The floor never moves." };
  if (type === "intraday-trailing") return { label: "Intraday trailing", lock: "Trails live, including open trades." };
  if (type === "eod-trailing-open") return { label: "EOD trailing", lock: "Trails the close and never locks." };
  if (offset > 0) return { label: "EOD trailing", lock: `Locks $${offset.toLocaleString()} above your starting balance.` };
  return { label: "EOD trailing", lock: "Locks at break-even." };
}

/** `base` (preset) → overlays (what the trader saved), with % resolved to $. */
export function mergeRules(base: PropSize | undefined, overrides: AccountRules | undefined, size: number): ResolvedRules {
  const out: Partial<ResolvedRules> = {};
  if (base) {
    for (const k of RULE_KEYS) {
      const v = (base as unknown as Record<string, unknown>)[k as string];
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k as string] = v;
    }
  }
  if (overrides) {
    for (const k of RULE_KEYS) {
      const v = overrides[k as string as keyof AccountRules];
      if (v !== undefined && v !== "") (out as unknown as Record<string, unknown>)[k as string] = v;
    }
    if (out.target === undefined && overrides.targetPct !== undefined) {
      out.target = Math.round((size * overrides.targetPct) / 100);
    }
    if (out.maxLoss === undefined && overrides.maxLossPct !== undefined) {
      out.maxLoss = Math.round((size * overrides.maxLossPct) / 100);
    }
  }
  // The four the journal always measures against default to 0 = "no rule".
  // Done last so the % resolution above still sees a truly absent value.
  return {
    ...out,
    target: out.target ?? 0,
    maxLoss: out.maxLoss ?? 0,
    dailyLoss: out.dailyLoss ?? 0,
    consistency: out.consistency ?? 0,
  };
}
