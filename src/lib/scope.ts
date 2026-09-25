/**
 * One place that decides what counts as money and what counts as a trade.
 *
 * Copy trading means one decision can live in several accounts at once: the
 * base trade plus one leg per copier. Both are real money in their own account,
 * but they are the SAME trade logically. So:
 *
 *   money  — every leg. Sum these for P&L; that is capital that actually moved.
 *   unique — one entry per logical trade (deduped by copyBaseKey). Use these
 *            for counts, win rate, streaks and anything "per trade".
 *
 * Views must go through this instead of deciding for themselves — that is how
 * the Home, Accounts and Trade Log stop disagreeing with each other.
 *
 * SECOND HALF OF THE CONTRACT (the shared financial foundation):
 *
 *   `summarizeFinancials` (lib/money.ts) is the single population every
 *   headline number reads: Net P&L, Closed trades, Win Rate, Net Profit Factor,
 *   Avg Net Result per Trade and the cumulative curve all come out of ONE
 *   FinancialSummary. This module supplies the two inputs that used to be
 *   re-invented per widget — the ACCOUNT SCOPE (who is in) and the DAY KEY
 *   (what a day is) — plus the two population views (logical decisions vs
 *   account legs).
 */

import type { Trade } from "../types";
import { tradeDayInZone } from "./instant";
import { uniqueTrades } from "./copy";
import type { FinancialScope, FinancialSummary } from "./money";

export interface AnalyticsScope {
  /** Every leg with a finite P&L — the real money. */
  money: Trade[];
  /** One trade per logical trade — the honest counts. */
  unique: Trade[];
  /**
   * What counts/win rate/streaks should be computed from. Normally `unique`,
   * but a user who wants copies treated as separate trades gets `money`.
   */
  counts: Trade[];
}

/**
 * `countCopies` mirrors the "Count copies as separate trades" setting. Money is
 * never affected by it: the P&L of an account is always what actually moved.
 */
export function analyticsTrades(trades: Trade[], countCopies = false): AnalyticsScope {
  const money = trades.filter((t) => Number.isFinite(t.pnl));
  const unique = uniqueTrades(money);
  return { money, unique, counts: countCopies ? money : unique };
}

// ---------------------------------------------------------------------------
// Shared account scope — who is in.

export interface AccountRecord {
  id: string;
  name?: string;
  type?: string;
}

export interface AccountResolver {
  /** Stable id for a trade's account. Unmapped labels get a stable pseudo-id. */
  accountIdOf: (trade: Trade) => string;
  /** Effective account type: the mapped account wins over the row's own label. */
  typeOf: (trade: Trade) => string | undefined;
}

export interface AccountResolverOptions {
  /** The trader's account list, so a stored label can be resolved to an id. */
  accounts?: ReadonlyArray<AccountRecord>;
  /** The plugin's account lookup by stored label, when the caller has one. */
  mappedAccount?: (label: string) => AccountRecord | null;
}

/**
 * One resolver for the whole product. A label that maps to a known account gets
 * that account's id and type; a label nobody knows gets `unmapped:<label>`, so
 * it is still counted (it is real money) but never silently merged with another
 * account — and its demo/archive policy comes from its own recorded type.
 */
export function accountResolver(options: AccountResolverOptions = {}): AccountResolver {
  const byLabel = new Map<string, AccountRecord>();
  for (const account of options.accounts ?? []) {
    const label = String(account.name ?? "").trim().toLowerCase();
    if (label && !byLabel.has(label)) byLabel.set(label, account);
  }
  const resolve = (trade: Trade): AccountRecord | null => {
    const stored = String(trade.account ?? "");
    const mapped = options.mappedAccount ? options.mappedAccount(stored) : null;
    if (mapped && mapped.id) return mapped;
    const label = stored.trim().toLowerCase();
    return (label ? byLabel.get(label) : undefined) ?? null;
  };
  return {
    accountIdOf: (trade) => resolve(trade)?.id ?? `unmapped:${String(trade.account ?? "").trim().toLowerCase() || "unassigned"}`,
    typeOf: (trade) => resolve(trade)?.type ?? trade.accountType,
  };
}

export interface AccountScopeOptions {
  resolve: AccountResolver;
  /**
   * `settings.excludeDemosFromPortfolio !== false`. Demo accounts drop from the
   * portfolio only while no specific account or account type is chosen — the
   * same rule the Accounts overview and the recorded-value widgets already use.
   * Omit it when the caller has no settings: then no demo policy is applied.
   */
  excludeDemos?: boolean;
  /** True when the trader picked an account or an account type on purpose. */
  explicitAccountScope?: boolean;
  /** A single account overrides everything else, demos included. */
  selectedAccountId?: string | null;
  /** Archived accounts are out of every financial number, always. */
  isArchived?: (trade: Trade) => boolean;
}

/**
 * The FinancialScope every headline number is summarized under. Built from the
 * trade list itself, so scope filtering happens before eligibility, grouping
 * and every aggregation — never after.
 */
export function accountScope(trades: Trade[], options: AccountScopeOptions): FinancialScope {
  const accountIdOf = (trade: Trade) => options.resolve.accountIdOf(trade);
  const selected = options.selectedAccountId ?? null;
  if (selected) {
    return { kind: "selected-account", accountIdOf, includedAccountIds: new Set([selected]), accountId: selected };
  }
  const includeDemos = options.explicitAccountScope === true || options.excludeDemos !== true;
  const includedAccountIds = new Set<string>();
  for (const trade of Array.isArray(trades) ? trades : []) {
    if (!trade || typeof trade !== "object") continue;
    if (options.isArchived?.(trade)) continue;
    const id = accountIdOf(trade);
    if (!id) continue;
    if (!includeDemos && options.resolve.typeOf(trade) === "demo") continue;
    includedAccountIds.add(id);
  }
  return { kind: "all-included-accounts", accountIdOf, includedAccountIds };
}

// ---------------------------------------------------------------------------
// Shared day convention — what a day is.

/**
 * The day a trade belongs to, in the journal's zone: the entry instant rendered
 * in that zone — or the date the note itself records, when there is no instant.
 *
 * Period filtering, day bucketing and every calendar view use this one key, so a
 * trade can never sit inside a period and outside the bucket it was counted in.
 * Nothing here rebuilds an instant from `date` + `entryTime`: the recorded pair
 * is the note's representation, not a source of time.
 */
export function journalDayKey(timeZone: string): (trade: Trade) => string {
  return (trade) => tradeDayInZone(trade, timeZone);
}
