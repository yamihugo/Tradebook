/**
 * Explicit reconciliation — proposing a link between a real follower fill and
 * the leader trade it mirrors, and nothing more.
 *
 * A proposal stores **stable identifiers and a display snapshot only** — never
 * the trade objects themselves. The trade can be edited or deleted between the
 * moment it is proposed and the moment it is confirmed, so `apply` reloads the
 * journal and re-validates before writing anything.
 *
 * Pure: no DOM, no plugin, no obsidian.
 */

import type { PropAccount, Trade } from "../types";
import { crossSymbol, effectiveCopyConfig } from "./copy";

export interface CopierMatchProposal {
  accountId: string;
  copierName: string;
  baseAccountId: string;
  baseName: string;
  /** Stable note path of the leader trade. */
  baseId: string;
  /** Stable note path of the real follower note. */
  followerId: string;
  /** Display snapshot of the follower, refreshed from the note on apply. */
  date: string;
  symbol: string;
  direction: "long" | "short";
  entryTime: string;
  /** The ratio that was in effect for this follower on the trade's day. */
  ratio: number;
  /** Why the pair is proposed, in the trader's words. */
  reason: string;
}

const minutesOf = (t: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec((t || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Normalise a symbol to its mini root so NQ ↔ MNQ compare equal. */
const miniRoot = (symbol: string): string => crossSymbol((symbol || "").trim().toUpperCase(), false);

/**
 * The one deterministic match rule: same day, direction, symbol family and an
 * entry time within ±2 minutes. Used both to propose and to re-validate on
 * apply — so a trade edited after it was proposed can never be linked on stale
 * evidence.
 */
export function sameDecision(base: Trade, follower: Trade): boolean {
  if (!base || !follower) return false;
  if (base.date !== follower.date) return false;
  if ((base.direction || "") !== (follower.direction || "")) return false;
  if (miniRoot(base.symbol) !== miniRoot(follower.symbol)) return false;
  const bt = minutesOf(base.entryTime);
  const ft = minutesOf(follower.entryTime);
  // Both missing: date + direction + symbol decides. Only one missing: the
  // times cannot agree, so it is not the same fill.
  if (Number.isNaN(ft) && Number.isNaN(bt)) return true;
  if (Number.isNaN(ft) || Number.isNaN(bt)) return false;
  return Math.abs(ft - bt) <= 2;
}

/**
 * Candidates for one copier account. `baseTrades` and `followerTrades` are the
 * caller's non-leg notes of each account (already resolved). The function does
 * not mutate either list, and returns nothing for an unlinked or non-copier
 * account.
 */
export function proposeMatchesForAccount(
  accounts: PropAccount[],
  copierId: string,
  baseTrades: Trade[],
  followerTrades: Trade[]
): CopierMatchProposal[] {
  const copier = accounts.find((a) => a.id === copierId);
  if (!copier || copier.copyRole !== "copier" || !copier.copyBaseId) return [];
  const base = accounts.find((a) => a.id === copier.copyBaseId);
  if (!base) return [];

  const used = new Set<string>();
  const out: CopierMatchProposal[] = [];
  for (const follower of followerTrades) {
    // A note already linked is no longer a candidate — that is what makes the
    // next start (or a second review) write nothing.
    if (follower.isCopiedTrade) continue;
    const hit = baseTrades.find((b) => !used.has(b.id) && sameDecision(b, follower));
    if (!hit) continue;
    used.add(hit.id);
    const ratio = effectiveCopyConfig(copier, follower.date)?.ratio ?? copier.copyMultiplier ?? 1;
    const time = (follower.entryTime || "").trim() || "no time";
    out.push({
      accountId: copier.id,
      copierName: copier.name,
      baseAccountId: base.id,
      baseName: base.name,
      baseId: hit.id,
      followerId: follower.id,
      date: follower.date,
      symbol: follower.symbol,
      direction: follower.direction,
      entryTime: follower.entryTime,
      ratio,
      reason: `${follower.date} · ${follower.symbol} ${follower.direction} · ${time} — matches ${base.name}'s ${hit.symbol} ${hit.direction}`,
    });
  }
  return out;
}

/**
 * The follower note as a confirmed leg. Pure: it takes the *current* follower
 * (reloaded by the caller) and returns a copy carrying the link fields, never
 * touching temporal configuration. The caller writes this only after confirm.
 */
export function linkFollower(follower: Trade, proposal: CopierMatchProposal, baseKey: string): Trade {
  return {
    ...follower,
    isCopiedTrade: true,
    copiedFromAccount: proposal.baseName,
    copyBaseKey: baseKey,
    copyOrigin: "imported",
    copyMultiplier: proposal.ratio,
    dataSource: "broker",
  };
}
