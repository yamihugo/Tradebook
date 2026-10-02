/**
 * Import identity — the stable key that lets a reimport, an overlapping file or
 * an Orders export paired with a Fills export recognise a trade the journal
 * already holds, without guessing.
 *
 * Priority, strongest first:
 *   A · the broker's execution/fill id (`fill_id`)
 *   B · the broker's order id (carried on `fill_id` when no fill id exists)
 *   C · a conservative deterministic fallback built from the trade itself.
 *
 * The fallback is deliberately exact: every component must match, and it needs
 * an `entryInstant`. There is no time window and no copy heuristic — two
 * legitimate trades in the same minute differ by their instant, so they never
 * collapse. Two accounts stay apart because the account id is part of the key.
 *
 * Pure: no DOM, no plugin, no obsidian.
 */

export type AccountIdResolver = (label: string) => string;

export interface ImportIdentityTrade {
  account?: string;
  fillId?: string;
  importKey?: string;
  symbol?: string;
  direction?: "long" | "short";
  quantity?: number;
  entryInstant?: string;
  entryPrice?: number;
}

const defaultAccount = (label: string): string => (label || "").trim().toLowerCase();

const finiteString = (value: number | undefined, positiveOnly = false): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (positiveOnly && value <= 0) return null;
  return String(value);
};

/** A single broker id, taken from the fill id the note/row carries. */
export function brokerIdentity(t: ImportIdentityTrade): string | null {
  const id = (t.fillId || "").trim();
  return id ? `broker:${id}` : null;
}

/**
 * The deterministic fallback. Returns null when any component is missing — an
 * incomplete trade has no identity rather than a loose one.
 */
export function fallbackIdentity(t: ImportIdentityTrade, resolveAccount?: AccountIdResolver): string | null {
  const account = resolveAccount ? resolveAccount(t.account || "") : defaultAccount(t.account || "");
  const symbol = (t.symbol || "").trim().toUpperCase();
  const direction = t.direction;
  const qty = finiteString(t.quantity, true);
  const instant = (t.entryInstant || "").trim();
  const price = finiteString(t.entryPrice);
  if (
    !account ||
    !symbol ||
    (direction !== "long" && direction !== "short") ||
    !qty ||
    !instant ||
    price === null
  ) {
    return null;
  }
  return `fallback:${account}|${symbol}|${direction}|${qty}|${instant}|${price}`;
}

/**
 * Every identity a trade can answer to. A note keeps the key it was written
 * with, its broker id, and the recomputable fallback — so an Orders note and a
 * Fills note of the same trade meet on the fallback even though their broker
 * ids live in different namespaces.
 */
export function importIdentities(t: ImportIdentityTrade, resolveAccount?: AccountIdResolver): string[] {
  const out: string[] = [];
  const explicit = (t.importKey || "").trim();
  if (explicit) out.push(explicit.includes(":") ? explicit : `key:${explicit}`);
  const broker = brokerIdentity(t);
  if (broker) out.push(broker);
  const fallback = fallbackIdentity(t, resolveAccount);
  if (fallback) out.push(fallback);
  return [...new Set(out)];
}

/** The one identity a note should be written with: broker id, else fallback. */
export function primaryImportIdentity(t: ImportIdentityTrade, resolveAccount?: AccountIdResolver): string | null {
  const explicit = (t.importKey || "").trim();
  return brokerIdentity(t) ?? (explicit || null) ?? fallbackIdentity(t, resolveAccount);
}
