/**
 * Batch import — analysing many files as one session, grouped by the broker
 * account each file's rows belong to.
 *
 * This module is pure. The importer reads and parses every file first, then
 * asks this module for one plan: the detected accounts (with their files, count
 * and date range), the global dedupe against the journal and across the whole
 * batch, and the split between what will be written and what a missing
 * confirmation leaves out. Nothing is written here.
 *
 * Dedupe reuses the Phase 2 identity system — there is no second one. The plan
 * never invents a trade: an account with no imported data simply does not
 * appear in `selected`, which is how a missing follower is left unreconstructed.
 *
 * Pure: no DOM, no plugin, no obsidian.
 */

import type { PropAccount, Trade } from "../types";
import { importIdentities, type AccountIdResolver } from "./importIdentity";
import { parseInstant } from "./instant";

export interface BatchFileTrades {
  name: string;
  trades: Trade[];
}

export interface DetectedAccount {
  /** The broker/export account label the rows carry. */
  name: string;
  type: string;
  /** Every file this account appeared in, in drop order. */
  files: string[];
  tradeCount: number;
  firstDate: string;
  lastDate: string;
}

/**
 * The accounts a batch actually contains, grouped by the label the rows carry.
 * Order follows the files, so the same drop always reads the same way.
 */
export function detectedAccounts(files: BatchFileTrades[]): DetectedAccount[] {
  const map = new Map<string, DetectedAccount>();
  for (const file of files) {
    for (const t of file.trades) {
      const name = (t.account || "").trim();
      if (!name) continue;
      let group = map.get(name);
      if (!group) {
        group = {
          name,
          type: t.accountType || "unknown",
          files: [],
          tradeCount: 0,
          firstDate: "",
          lastDate: "",
        };
        map.set(name, group);
      }
      group.tradeCount += 1;
      if (!group.files.includes(file.name)) group.files.push(file.name);
      if (t.date) {
        if (!group.firstDate || t.date < group.firstDate) group.firstDate = t.date;
        if (!group.lastDate || t.date > group.lastDate) group.lastDate = t.date;
      }
    }
  }
  return [...map.values()];
}

export interface AccountGroup extends DetectedAccount {
  /** Of this account's rows, how many are new once the whole batch is deduped. */
  importable: number;
  /** Of this account's rows, how many the journal (or an earlier file) already holds. */
  duplicates: number;
  conflicts: number;
  /** The confirmed journal account id, or "" when still unmapped. */
  mappedAccountId: string;
}

export interface BatchPlanInput {
  files: BatchFileTrades[];
  /** Every trade already in the journal, for the global dedupe. */
  existing?: Trade[];
  /** Resolves a stored label to a journal account id (for the fallback key). */
  resolveAccount?: AccountIdResolver;
  /** Confirmed mapping: detected account label → journal account id. */
  mapping: Record<string, string>;
}

export interface BatchPlan {
  groups: AccountGroup[];
  /** Every parsed row in the batch. */
  detected: number;
  /** Rows the journal or an earlier file already holds. */
  duplicates: number;
  /** Replay rows held for conflicting source facts or time interpretation. */
  conflicts: number;
  /** New rows — the pool a mapping can be chosen for. */
  importable: number;
  /** New rows with a confirmed account. These are what a commit writes. */
  assigned: number;
  /** New rows still without a confirmed account. Never written. */
  unassigned: number;
  selected: Trade[];
  skipped: Trade[];
}

/**
 * One plan for the whole batch. The numbers reconcile by construction:
 *   detected = duplicates + conflicts + importable, and importable = assigned + unassigned.
 * The dedupe runs across every file in order, so a trade that appears in two
 * overlapping files is counted once.
 *
 * Two rules keep it honest:
 *  - a reconstructed note (a generated copy leg) never blocks an incoming
 *    broker fill — actual data beats a model. A real broker note still does.
 *  - an incoming trade's identity uses only the **confirmed** mapping (or its
 *    own detected label), never a suggested journal account.
 */
export function planBatch(input: BatchPlanInput): BatchPlan {
  // Identities of real notes, and of reconstructed models, kept apart so a model
  // can be ignored when a real fill arrives.
  const actualSeen = new Set<string>();
  const modelSeen = new Set<string>();
  const replaySeen = new Map<string, Trade[]>();
  const ambiguousReplay: Trade[] = [];
  const resolveExisting = (label: string): string => {
    const key = (label || "").trim();
    const confirmed = input.mapping[key];
    if (confirmed) return confirmed;
    return input.resolveAccount ? input.resolveAccount(label) : `detected:${key.toLowerCase()}`;
  };
  // Incoming rows know only their detected label and a confirmed mapping; a
  // suggestion that was never confirmed is not part of their identity.
  const resolveIncoming = (label: string): string => {
    const key = (label || "").trim();
    return input.mapping[key] || `detected:${key.toLowerCase()}`;
  };

  for (const t of input.existing ?? []) {
    const target = isReconstructed(t) ? modelSeen : actualSeen;
    for (const id of importIdentities(t, resolveExisting)) target.add(id);
    if (!isReconstructed(t)) {
      rememberReplay(replaySeen, t, resolveExisting);
      if (t.dataSource === "replay" && !replayPotentialKey(t, resolveExisting)) ambiguousReplay.push(t);
    }
  }

  const groups = detectedAccounts(input.files).map((g) => ({
    ...g,
    importable: 0,
    duplicates: 0,
    conflicts: 0,
    mappedAccountId: input.mapping[g.name] ?? "",
  }));
  const byName = new Map(groups.map((g) => [g.name, g]));

  const selected: Trade[] = [];
  const skipped: Trade[] = [];
  let detected = 0;
  let duplicates = 0;
  let conflicts = 0;
  let importable = 0;
  let assigned = 0;
  let unassigned = 0;

  // Check the entire incoming batch before selecting anything: otherwise file
  // order silently chooses a winner when two versions disagree.
  const incomingReplay = new Map<string, Trade[]>();
  for (const file of input.files) {
    for (const trade of file.trades) rememberReplay(incomingReplay, trade, resolveIncoming);
  }
  const contested = new Set<string>();
  for (const [key, rows] of incomingReplay) {
    if (rows.some((row) => !replayExact(rows[0], row, resolveIncoming, resolveIncoming))) contested.add(key);
  }

  for (const file of input.files) {
    for (const trade of file.trades) {
      detected += 1;
      const name = (trade.account || "").trim();
      const group = byName.get(name);
      const ids = importIdentities(trade, resolveIncoming);
      const incomingModel = isReconstructed(trade);
      const replayKey = replayPotentialKey(trade, resolveIncoming);
      if (trade.dataSource === "replay" && (!replayKey || ambiguousReplay.some((previous) =>
        (!previous.account || resolveExisting(previous.account) === resolveIncoming(trade.account || "")) &&
        (!previous.symbol || !trade.symbol || previous.symbol.trim().toUpperCase() === trade.symbol.trim().toUpperCase())
      ))) {
        conflicts += 1;
        if (group) group.conflicts += 1;
        continue;
      }
      if (replayKey && contested.has(replayKey)) {
        conflicts += 1;
        if (group) group.conflicts += 1;
        continue;
      }
      const possible = replayKey ? replaySeen.get(replayKey) ?? [] : [];
      if (possible.length) {
        const exact = possible.every((previous) => replayExact(previous, trade, resolveExisting, resolveIncoming));
        if (exact) {
          duplicates += 1;
          if (group) group.duplicates += 1;
        } else {
          conflicts += 1;
          if (group) group.conflicts += 1;
        }
        continue;
      }
      // An incoming broker fill is blocked by a real note only; a reconstructed
      // model of the same leg is not evidence it is already here.
      const blocked = incomingModel
        ? ids.some((id) => actualSeen.has(id) || modelSeen.has(id))
        : ids.some((id) => actualSeen.has(id));
      if (blocked) {
        duplicates += 1;
        if (group) group.duplicates += 1;
        continue;
      }
      const target = incomingModel ? modelSeen : actualSeen;
      for (const id of ids) target.add(id);
      if (!incomingModel) rememberReplay(replaySeen, trade, resolveIncoming);
      importable += 1;
      if (group) group.importable += 1;
      if (input.mapping[name]) {
        assigned += 1;
        selected.push(trade);
      } else {
        unassigned += 1;
        skipped.push(trade);
      }
    }
  }

  return { groups, detected, duplicates, conflicts, importable, assigned, unassigned, selected, skipped };
}

// Number reuse is possible: a same-account, same-symbol candidate is held
// when its facts differ, not treated as proof that either trade is identical.
function replayPotentialKey(t: Trade, resolve: AccountIdResolver): string | null {
  if (t.dataSource !== "replay") return null;
  const id = importIdentities(t, resolve)[0];
  if (!id) return null;
  const split = id.lastIndexOf(":");
  const parts = id.slice(split + 1).split("|");
  if (parts.length !== 8 || parts.some((part) => !part)) return null;
  try {
    const decoded = parts.map((part) => decodeURIComponent(part));
    if (!decoded[0].trim() || !decoded[1].trim() || !["long", "short"].includes(decoded[2]) ||
        !Number.isFinite(Number(decoded[3])) || Number(decoded[3]) <= 0 ||
        [decoded[4], decoded[5]].some((stamp) => {
          const result = parseInstant(stamp);
          return result.status !== "ok" && !(result.status === "need-zone" && result.reason === "no-source-zone");
        }) ||
        !Number.isFinite(Number(decoded[6])) || !Number.isFinite(Number(decoded[7]))) return null;
  } catch { return null; }
  return JSON.stringify([id.slice(0, split), parts[0], parts[1]]);
}

function rememberReplay(seen: Map<string, Trade[]>, trade: Trade, resolve: AccountIdResolver): void {
  const key = replayPotentialKey(trade, resolve);
  if (key) seen.set(key, [...(seen.get(key) ?? []), trade]);
}

function replayExact(a: Trade, b: Trade, resolveA: AccountIdResolver, resolveB: AccountIdResolver): boolean {
  return importIdentities(a, resolveA)[0] === importIdentities(b, resolveB)[0]
    && [a, b].every((t) => (!t.costCoverage || (t.costCoverage.commission && t.costCoverage.fees))
      && [t.pnl, t.pnlPoints, t.commission, t.fees].every(Number.isFinite))
    && a.pnl === b.pnl && a.pnlPoints === b.pnlPoints
    && a.commission === b.commission && a.fees === b.fees
    && a.symbol === b.symbol
    && a.direction === b.direction
    && a.quantity === b.quantity
    && a.entryPrice === b.entryPrice
    && a.exitPrice === b.exitPrice
    && (a.entryInstant || "") === (b.entryInstant || "")
    && (a.exitInstant || "") === (b.exitInstant || "")
    && Boolean(a.timeUnresolved) === Boolean(b.timeUnresolved);
}

/** A note the copy engine generated — a model, never the account's own fill. */
function isReconstructed(t: Trade): boolean {
  return t.dataSource === "reconstructed" || t.copyOrigin === "generated";
}

/**
 * Copiers declared in the journal whose account has no imported data in this
 * batch. Reported as "no imported data found" — never reconstructed here.
 */
export function missingCopiers(accounts: PropAccount[], presentAccountIds: Set<string>): PropAccount[] {
  return accounts.filter(
    (a) => a.copyRole === "copier" && !!a.copyBaseId && !presentAccountIds.has(a.id)
  );
}
