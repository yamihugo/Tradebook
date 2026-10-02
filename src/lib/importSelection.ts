/**
 * Import CSV — the default tick of a Trading Group's configured copiers.
 *
 * When an imported account is mapped to a leader already configured in
 * Tradebook, that relationship was an explicit decision the trader already
 * made. The import screen offers it back as a default tick, so the trader does
 * not have to rebuild a group the journal already knows. This is a UI default
 * derived from configuration — never a copy relationship discovered in the CSV.
 *
 * The reducer is deliberately small and Import-specific. It only:
 *  - derives the default ticks for the currently mapped leaders,
 *  - remembers an explicit tick/untick for the span of one mapping,
 *  - clears those overrides the moment the mapped leader set changes, so a
 *    stale group selection can never leak into the next one.
 *
 * It reads accounts and nothing else: no trades, no files, no plugin, no DOM.
 * Selecting a copier changes no note and no configuration — the write happens
 * only when Import is pressed.
 */

import type { PropAccount } from "../types";

export interface ImportSelectionState {
  /** The trader's explicit choice per account id (true = tick, false = untick). */
  overrides: Map<string, boolean>;
  /** The mapped leader set these overrides belong to. */
  signature: string;
}

export function newImportSelection(): ImportSelectionState {
  return { overrides: new Map(), signature: "" };
}

/** A stable identity for the current set of mapped destination accounts. */
export function selectionSignature(baseIds: string[]): string {
  return [...new Set(baseIds)].sort().join("|");
}

/**
 * The configured copier accounts of the mapped leaders: the default tick.
 * Only an explicit `copyRole: "copier"` whose `copyBaseId` is one of the mapped
 * destinations counts. Pure — the accounts are never touched.
 */
export function defaultCopierIds(accounts: PropAccount[], baseIds: string[]): Set<string> {
  const bases = new Set(baseIds);
  const out = new Set<string>();
  for (const a of accounts) {
    if (a.copyRole === "copier" && !!a.copyBaseId && bases.has(a.copyBaseId)) out.add(a.id);
  }
  return out;
}

/**
 * The effective ticked accounts for the current mapping. A new leader set clears
 * the session's overrides and recomputes the defaults; within one leader set an
 * explicit choice survives every repaint (Costs, Time, Preview). A mapped
 * destination itself is never an extra target.
 */
export function effectiveSelection(
  accounts: PropAccount[],
  baseIds: string[],
  state: ImportSelectionState
): Set<string> {
  const signature = selectionSignature(baseIds);
  if (signature !== state.signature) {
    state.overrides.clear();
    state.signature = signature;
  }
  const out = new Set<string>();
  if (!baseIds.length) return out;
  const bases = new Set(baseIds);
  const defaults = defaultCopierIds(accounts, baseIds);
  for (const a of accounts) {
    if (bases.has(a.id)) continue;
    const override = state.overrides.get(a.id);
    if (override !== undefined ? override : defaults.has(a.id)) out.add(a.id);
  }
  return out;
}
