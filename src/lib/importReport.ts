/**
 * The import receipt, as pure data.
 *
 * The four numbers are kept apart — what the file held, what was chosen for an
 * account, what was written, and what was left out — so "imported" can never be
 * read as "everything". Keeping the maths here (and out of the modal) means the
 * counts and the write outcome can be pinned by tests.
 */

import type { Trade } from "../types";

/** Match only the newly created physical notes, one-to-one, against Replay facts. */
export function confirmReplayWrites(expected: Trade[], paths: string[], actual: Trade[]): number {
  const allowed = new Set(paths);
  const used = new Set<string>();
  let confirmed = 0;
  for (const trade of expected) {
    const match = actual.find((note) => allowed.has(note.id) && !used.has(note.id)
      && note.account === trade.account && note.dataSource === "replay"
      && note.importKey === trade.importKey && note.symbol === trade.symbol
      && note.direction === trade.direction && note.quantity === trade.quantity
      && note.entryPrice === trade.entryPrice && note.exitPrice === trade.exitPrice
      && note.pnl === trade.pnl && Number.isFinite(trade.pnlPoints) && note.pnlPoints === trade.pnlPoints
      && trade.costCoverage?.commission !== false && trade.costCoverage?.fees !== false
      && note.costCoverage?.commission === true && note.costCoverage?.fees === true
      && Number.isFinite(trade.commission) && note.commission === trade.commission
      && Number.isFinite(trade.fees) && note.fees === trade.fees
      && (note.date || "") === (trade.date || "") && (note.exitDate || "") === (trade.exitDate || "")
      && (note.entryTime || "") === (trade.entryTime || "") && (note.exitTime || "") === (trade.exitTime || "")
      && (note.entryInstant || "") === (trade.entryInstant || "")
      && (note.exitInstant || "") === (trade.exitInstant || "")
      && Boolean(note.timeUnresolved) === Boolean(trade.timeUnresolved));
    if (match) { used.add(match.id); confirmed++; }
  }
  return confirmed;
}

export interface ImportSummaryInput {
  /** Trades the parser could read and fill. */
  detected: number;
  /** Parsed trades that are not duplicates — the pool the trader can pick from. */
  importable: number;
  /** Of the pool, the ones a journal account was chosen for. */
  assigned: number;
  /** Notes actually written/confirmed on disk. */
  written: number;
  /** Copy legs generated beside the base notes. */
  copyLegs: number;
  duplicates: number;
  conflicts?: number;
  unfilled: number;
  unpaired: number;
  unreadable: number;
  unpinned: number;
}

export interface ImportSummary {
  detected: number;
  /** Chosen for these accounts — never a trade left without one. */
  selected: number;
  written: number;
  copyLegs: number;
  /** Picked trades that never got an account, so they were not written. */
  unassigned: number;
  skipped: string[];
}

/**
 * Fold the raw counts into the receipt the modal shows. `selected` is the
 * assigned subset, so it agrees with `written` (minus any write failure) and
 * never claims a trade without an account was "selected for these accounts".
 */
export function importSummary(input: ImportSummaryInput): ImportSummary {
  const unassigned = Math.max(0, input.importable - input.assigned);
  const skipped: string[] = [];
  if (input.duplicates) skipped.push(`${input.duplicates} already in the journal`);
  if (input.conflicts) skipped.push(`${input.conflicts} conflict${input.conflicts === 1 ? "" : "s"} held`);
  if (unassigned) skipped.push(`${unassigned} without an account`);
  if (input.unfilled) skipped.push(`${input.unfilled} order(s) never filled`);
  if (input.unpaired) skipped.push(`${input.unpaired} fill(s) not paired`);
  if (input.unreadable) skipped.push(`${input.unreadable} row(s) unreadable`);
  if (input.unpinned) skipped.push(`${input.unpinned} timestamp(s) not pinned`);
  return {
    detected: input.detected,
    selected: input.assigned,
    written: input.written,
    copyLegs: input.copyLegs,
    unassigned,
    skipped,
  };
}

/**
 * What a write attempt actually did, judged by the one number that cannot lie:
 * how many notes were created. `unconfirmed` is how many asked-for notes could
 * not be read back. A partial result must never be reported as "nothing".
 */
export type WriteOutcome = "none" | "partial" | "complete";

export function writeOutcome(created: number, unconfirmed: number): WriteOutcome {
  if (unconfirmed <= 0) return "complete";
  return created <= 0 ? "none" : "partial";
}
