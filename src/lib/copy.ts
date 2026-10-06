/**
 * Copy-trading engine.
 *
 * Rules that keep the numbers honest:
 *  - A "leg" is a normal trade note belonging to a copier account, marked
 *    `isCopiedTrade` and linked to the base trade through `copyBaseKey`.
 *  - Legs are FROZEN at creation. Changing a ratio never rewrites history.
 *  - Configuration is time-stamped (`copyConfigHistory`); the effective config
 *    for a trade is the last entry with `from <= trade.date`.
 *  - Generation is idempotent: re-running replaces generated legs only, and
 *    never touches `copyOrigin: "imported"` (real fills win).
 */

import type TradebookPlugin from "../main";
import { CopyConfigEntry, CopyPeriod, PropAccount, Trade, TradeFill } from "../types";
import { futuresSpec, knownFuturesSpec } from "../futures";
import { deleteTradeFile, saveTrade, setTradeFields, tradeKey } from "../storage";
import { todayKey } from "../tz";
import { fillSet, tradePoints } from "./fills";
import { isReplaceableLeg } from "./copySupersession";

// mini ↔ micro, read from the futures registry rather than kept in a second list
// here — a contract priced there is crossable here with nothing to forget. The
// size ratio comes from the point values too, because it is not always ten:
// NQ:MNQ is 10:1, but silver's standard contract is 5,000 oz and its micro
// 1,000 oz, so SI:SIL is 5:1.
function microOf(symbol: string): string | undefined {
  return knownFuturesSpec((symbol || "").trim().toUpperCase())?.micro;
}

function miniOf(symbol: string): string | undefined {
  return knownFuturesSpec((symbol || "").trim().toUpperCase())?.mini;
}

/** How many micros one mini of this instrument is worth. */
function microRatio(symbol: string): number {
  const spec = knownFuturesSpec((symbol || "").trim().toUpperCase());
  const micro = spec?.micro ? knownFuturesSpec(spec.micro) : null;
  if (!spec || !micro || spec.pointValue <= 0 || micro.pointValue <= 0) return 1;
  return spec.pointValue / micro.pointValue;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function crossSymbol(symbol: string, toMicro: boolean): string {
  const s = (symbol || "").trim().toUpperCase();
  return (toMicro ? microOf(s) : miniOf(s)) ?? s;
}

export function isLeg(t: Trade | undefined | null): boolean {
  return !!t && t.isCopiedTrade === true;
}

/** Identity used to group a base trade with all its legs. */
export function legBaseKey(t: Trade): string {
  // Only a real copy link groups two records. The content key (date, symbol,
  // direction, minute, entry price) was a stand-in for that, and it is a good
  // guess but a bad identity: two trades entered in the same minute at the same
  // price are two decisions, not one. Every loaded trade carries its file path
  // as `id`, which is the identity we actually have; a copy carries `copyBaseKey`
  // and still collapses with the trade it mirrors.
  return t.copyBaseKey || t.id || tradeKey(t);
}

/**
 * Identity safe for financial grouping. Unlike `legBaseKey`, this deliberately
 * omits the content-based legacy fallback: without a copyBaseKey or a base-note
 * id, two same-minute decisions cannot safely be assumed to be one decision.
 * An unlinked copy leg is identifiable as a note, but not as its base decision.
 */
export function logicalDecisionKey(t: Trade): string | null {
  const copyKey = String(t.copyBaseKey ?? "").trim();
  if (copyKey) return copyKey;
  if (isLeg(t)) return null;
  const id = String(t.id ?? "").trim();
  return id || null;
}

/** The copy configuration in effect for a given date (never looks ahead). */
export function effectiveCopyConfig(account: PropAccount | undefined, date: string): CopyConfigEntry | null {
  if (!account) return null;
  const history = (account.copyConfigHistory ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
  let found: CopyConfigEntry | null = null;
  for (const entry of history) {
    if (entry.from <= date) found = entry;
  }
  if (found) return found;
  if (!history.length) {
    // Legacy accounts (single multiplier, no history yet). The window opens on
    // the day the account was created: an account opened today must never
    // inherit the leader's whole history as if it had traded it.
    const from = account.createdAt || "0000-01-01";
    if (from > date) return null; // it did not exist yet
    return {
      from,
      ratio: account.copyMultiplier ?? 1,
      // Cross-order is a decision of the engine, not of the trader: mirror the
      // exposure in micros only when the ratio leaves less than one mini.
      crossOrder: true,
      crossMode: "exposure",
      sizing: account.copySizing ?? "ratio",
      fixedQty: account.copyFixedQty,
      round: account.copyRound ?? "down",
      minQty: account.copyMinQty ?? 0,
    };
  }
  return null; // configured, but only from a later date → not copying yet
}

/** Is `account` copying `baseAccountId` on `date` (role + base + period + config)? */
export function isActiveCopier(account: PropAccount, baseAccountId: string, date: string): boolean {
  if (account.copyRole !== "copier") return false;
  if (account.copyBaseId && account.copyBaseId !== baseAccountId) return false;
  const periods = account.copyPeriods ?? [];
  if (periods.length) {
    // Each period remembers the leader it followed, so changing leaders never
    // rewrites the past: an old stretch only answers for its own leader.
    const hit = periods.some(
      (p) =>
        (!p.start || p.start <= date) &&
        (!p.end || date <= p.end) &&
        (!p.baseId || p.baseId === baseAccountId)
    );
    if (!hit) return false;
  } else if (account.createdAt && date < account.createdAt) {
    return false; // no explicit period → the account's own start is the boundary
  }
  return effectiveCopyConfig(account, date) !== null;
}

/** The floor of recorded time: "copy everything the leader ever did". */
export const COPY_ALL_START = "0000-01-01";

/** How a copier reads on any surface: one ratio, one start, one leader. */
export interface CopierPresentation {
  ratio: number;
  /** ISO start date, or "" when nothing records one. */
  since: string;
  /** True when `since` is the floor of time ("the whole history"). */
  sinceIsBeginning: boolean;
  baseId?: string;
  baseName?: string;
}

/**
 * The single place a copier's ratio and start are resolved, so every surface
 * shows the same number and the same date. Priority:
 *   active (open) copy period → latest config-history entry → legacy scalar.
 * The engine already reads the same order; this only says it out loud.
 */
export function copierPresentation(
  account: PropAccount,
  resolveBaseName?: (id: string) => string
): CopierPresentation {
  const open = (account.copyPeriods ?? []).find((p) => !p.end);
  const history = [...(account.copyConfigHistory ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  const last = history.length ? history[history.length - 1] : undefined;

  let ratio: number;
  let since: string;
  if (open) {
    ratio = open.multiplier ?? last?.ratio ?? account.copyMultiplier ?? 1;
    since = open.start ?? last?.from ?? account.createdAt ?? "";
  } else if (last) {
    ratio = last.ratio ?? account.copyMultiplier ?? 1;
    since = last.from;
  } else {
    ratio = account.copyMultiplier ?? 1;
    since = account.createdAt ?? "";
  }

  const baseId = account.copyBaseId;
  return {
    ratio,
    since,
    sinceIsBeginning: since === COPY_ALL_START,
    baseId,
    baseName: baseId && resolveBaseName ? resolveBaseName(baseId) : undefined,
  };
}

/** Today as YYYY-MM-DD. `zone` is the Journal Timezone: today *there*, so copy
 *  periods open and close on the journal's calendar and never on this
 *  machine's. An empty zone means "as recorded" and falls back to the host date. */
export function todayIso(zone = ""): string {
  return todayKey(zone);
}

/** The day before an ISO date — used to close a period without overlapping. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** One correction `normalizeCopyPeriods` had to make. Debug only — no UI. */
export interface NormalizeReason {
  kind: "deduped" | "removed-invalid" | "truncated-overlap" | "closed-open" | "history-added";
  start?: string;
  detail?: string;
}

export interface NormalizeResult {
  changed: boolean;
  reasons: NormalizeReason[];
  counts: { removed: number; truncated: number; closed: number; deduped: number; historyAdded: number };
}

/**
 * A copier's periods are written by several callers, each appending. That can
 * leave a timeline no engine can read honestly: two open stretches, overlaps, a
 * period that ends before it begins. This folds the bag back into an ordered,
 * non-overlapping timeline with at most one open stretch (the last one), and
 * makes sure every stretch has a matching config-history entry — add-if-missing,
 * never overwriting a ratio the trader set. Idempotent: a second run changes
 * nothing and reports `changed: false`.
 */
export function normalizeCopyPeriods(account: PropAccount): NormalizeResult {
  const input = account.copyPeriods ?? [];
  const reasons: NormalizeReason[] = [];
  const counts = { removed: 0, truncated: 0, closed: 0, deduped: 0, historyAdded: 0 };

  // 1 · an entry without a start cannot be placed on a timeline.
  const keyed: Array<{ p: CopyPeriod; i: number }> = [];
  input.forEach((p, i) => {
    if (!(p.start ?? "").trim()) {
      counts.removed++;
      reasons.push({ kind: "removed-invalid", detail: "missing start" });
      return;
    }
    keyed.push({ p, i });
  });

  // 2 · order by start, keeping the original order for equal starts (stable).
  keyed.sort((a, b) => (a.p.start as string).localeCompare(b.p.start as string) || a.i - b.i);

  // 3 · the same start twice is one decision: the last occurrence wins.
  const deduped: CopyPeriod[] = [];
  for (const { p } of keyed) {
    const last = deduped[deduped.length - 1];
    if (last && last.start === p.start) {
      deduped[deduped.length - 1] = p;
      counts.deduped++;
      reasons.push({ kind: "deduped", start: p.start });
    } else {
      deduped.push(p);
    }
  }

  // 4/5/6 · close overlaps, keep only the last stretch open, drop impossible ones.
  const out: CopyPeriod[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const p = deduped[i];
    const next = deduped[i + 1];
    let end = p.end;
    if (next) {
      const boundary = dayBefore(next.start as string);
      if (!end || end > boundary) {
        if (!end) {
          counts.closed++;
          reasons.push({ kind: "closed-open", start: p.start });
        } else {
          counts.truncated++;
          reasons.push({ kind: "truncated-overlap", start: p.start, detail: `end ${p.end} → ${boundary}` });
        }
        end = boundary;
      }
    }
    if (end && (p.start as string) > end) {
      counts.removed++;
      reasons.push({ kind: "removed-invalid", start: p.start, detail: `start > end (${p.start} > ${end})` });
      continue;
    }
    out.push({ ...p, end });
  }

  const samePeriods =
    input.length === out.length &&
    input.every((p, i) => {
      const q = out[i];
      return p.start === q.start && p.end === q.end && p.baseId === q.baseId && p.multiplier === q.multiplier;
    });
  account.copyPeriods = out;

  // 7 · a stretch with no history entry would be read by the engine with an old
  // ratio. Add the missing one; never overwrite what is already recorded.
  const history = account.copyConfigHistory ?? [];
  const known = new Set(history.map((h) => h.from));
  const added: CopyConfigEntry[] = [];
  for (const p of out) {
    const start = p.start as string;
    if (known.has(start)) continue;
    known.add(start);
    added.push({
      from: start,
      // A legacy stretch carries no multiplier of its own; the account's
      // configured ratio is the one the engine read for it before this history
      // entry existed, so it must survive the backfill. Never let the fold turn
      // a configured ratio into 1×.
      ratio: p.multiplier ?? account.copyMultiplier ?? 1,
      crossOrder: true,
      crossMode: "exposure",
      sizing: account.copySizing ?? "ratio",
      fixedQty: account.copyFixedQty,
      round: account.copyRound ?? "down",
      minQty: account.copyMinQty ?? 0,
    });
    counts.historyAdded++;
    reasons.push({ kind: "history-added", start });
  }
  if (added.length) {
    account.copyConfigHistory = [...history, ...added].sort((a, b) => a.from.localeCompare(b.from));
  }

  return { changed: !samePeriods || added.length > 0, reasons, counts };
}

/**
 * Start following a leader: any open period is closed the day before, and a new
 * one opens on `start`. Legs already generated belong to the period that made
 * them, so the past is never rewritten — only trades from `start` are mirrored.
 */
export function openCopyPeriod(
  account: PropAccount,
  baseId: string,
  multiplier: number,
  start: string,
  zone = ""
): void {
  // A stretch that begins after the new link is a plan the new link supersedes:
  // keeping it would let an old, later period (and its ratio) shadow the one the
  // trader just chose. Drop it, then manage what remains.
  const periods = (account.copyPeriods ?? []).filter((p) => !p.start || p.start <= start);

  // Editing the ratio of the stretch already open (same leader, same start)
  // updates it in place: no duplicate, and it is never closed before it began.
  const openIdx = periods.findIndex(
    (p) => !p.end && p.start === start && (!p.baseId || p.baseId === baseId)
  );
  if (openIdx >= 0) {
    account.copyPeriods = periods.map((p, i) => (i === openIdx ? { ...p, baseId, multiplier } : p));
    return;
  }

  // Close whatever is open the day before the new period starts — never before
  // its own start, which would leave an impossible start > end stretch.
  account.copyPeriods = periods.map((p) => {
    if (p.end) return p;
    const end = dayBefore(start);
    return p.start && end < p.start ? p : { ...p, end };
  });
  account.copyPeriods.push({ start, end: undefined, baseId, multiplier });
  normalizeCopyPeriods(account);
}

/** Stop copying: close whatever is open. Existing legs stay exactly as they are. */
export function closeCopyPeriods(account: PropAccount, zone = ""): void {
  const today = todayIso(zone);
  const periods = account.copyPeriods ?? [];
  if (!periods.length) return;
  account.copyPeriods = periods.map((p) => (p.end ? p : { ...p, end: dayBefore(today) }));
  normalizeCopyPeriods(account);
}

/**
 * Cut an account's copy link and touch no note.
 *
 * The stretch it copied closes the day before today, so the record of when it
 * followed stays in the periods. The live settings are reset so the next link
 * starts clean instead of inheriting the last group's ratio or symbol rule —
 * an account that left a 0.5x micro group must not seed its next one with 0.5.
 * Legs already generated are written and stay.
 */
export function unlinkCopier(account: PropAccount, zone = ""): void {
  closeCopyPeriods(account, zone);
  account.copyRole = undefined;
  account.copyBaseId = undefined;
  account.copyMultiplier = undefined;
  account.copySizing = undefined;
  account.copyFixedQty = undefined;
  account.copyRound = undefined;
  account.copyMinQty = undefined;
}

/**
 * A leader that is gone (deleted or archived) must not leave its followers
 * pointing at a dead account. Each follower is unlinked exactly as a manual
 * remove would (stretch closed, role cleared); the caller decides what to do
 * with the leader itself. Pure and idempotent.
 */
export function detachFollowers(accounts: PropAccount[], baseId: string, zone = ""): number {
  let changed = 0;
  for (const a of accounts) {
    if (a.copyBaseId !== baseId) continue;
    unlinkCopier(a, zone);
    changed++;
  }
  return changed;
}

/**
 * Copiers whose leader is not among the active accounts — a deleted account or
 * one moved to the archive. Only a copier with a base id that does not resolve
 * counts: an account with no base id is not treated as broken here.
 */
export function findDanglingCopiers(accounts: PropAccount[], activeIds: Set<string>): PropAccount[] {
  return accounts.filter((a) => a.copyRole === "copier" && !!a.copyBaseId && !activeIds.has(a.copyBaseId));
}

/** Unlink every copier whose leader no longer exists among the active accounts. */
export function healDanglingCopiers(accounts: PropAccount[], activeIds: Set<string>, zone = ""): number {
  let changed = 0;
  for (const a of findDanglingCopiers(accounts, activeIds)) {
    unlinkCopier(a, zone);
    changed++;
  }
  return changed;
}

/**
 * Legs whose base note no longer exists in the journal. A frozen copy of a base
 * that was deleted is still an honest record, so this only reports; nothing is
 * removed. Used by diagnostics to tell whether the links are intact.
 */
export function findOrphanLegs(trades: Trade[]): Trade[] {
  const baseKeys = new Set<string>();
  for (const t of trades) if (!isLeg(t)) baseKeys.add(legBaseKey(t));
  return trades.filter((t) => isLeg(t) && !baseKeys.has(legBaseKey(t)));
}

/**
 * Begin copying a leader from a chosen date — the "Copy from" choice in the
 * group manager (today / the account's own start / a date you pick / the
 * leader's whole history).
 *
 * Both the period and the configuration open on that same date. Writing only
 * the period is not enough: an account created on 6 September would still be
 * refused for a trade on 1 September, because the legacy configuration window
 * opens on the day the account was created.
 */
export function startCopying(
  account: PropAccount,
  baseId: string,
  multiplier: number,
  from: string,
  zone = ""
): void {
  openCopyPeriod(account, baseId, multiplier, from, zone);
  const entry: CopyConfigEntry = {
    from,
    ratio: multiplier,
    // Automatic cross-order: recorded on the link so re-generating a trade of
    // this stretch uses the same rule. The engine applies it per trade — micros
    // only when the ratio would leave less than one mini.
    crossOrder: true,
    crossMode: "exposure",
    sizing: account.copySizing ?? "ratio",
    fixedQty: account.copyFixedQty,
    round: account.copyRound ?? "down",
    minQty: account.copyMinQty ?? 0,
  };
  // Keep only the stretches that began before this link. A later entry belongs
  // to a superseded plan; leaving it in would shadow the ratio just chosen for
  // every trade from its date on (the bug this fixes).
  const history = (account.copyConfigHistory ?? []).filter((h) => h.from < from);
  account.copyConfigHistory = [...history, entry].sort((a, b) => a.from.localeCompare(b.from));
  // Keep the timeline and its history in step after the write.
  normalizeCopyPeriods(account);
}

/** Accounts that should receive a copy of this base trade. */
export function membersForBase(plugin: TradebookPlugin, base: Trade): PropAccount[] {
  const baseAccount = plugin.mappedAccount(base.account);
  if (!baseAccount) return [];
  return (plugin.settings.propAccounts || []).filter((a) => isActiveCopier(a, baseAccount.id, base.date));
}

/** Dedupe so each logical trade is counted once (for counts / win rate). */
export function uniqueTrades(trades: Trade[]): Trade[] {
  const seen = new Map<string, Trade>();
  for (const t of trades) {
    const key = legBaseKey(t);
    const current = seen.get(key);
    if (!current || (isLeg(current) && !isLeg(t))) seen.set(key, t);
  }
  return [...seen.values()];
}

export function legsOf(trades: Trade[], baseKey: string): Trade[] {
  return trades.filter((t) => isLeg(t) && legBaseKey(t) === baseKey);
}

/** A virtual leg is synthesized in memory and has no file on disk. */
export function isVirtualLeg(t: Trade | undefined | null): boolean {
  return !!t && (t as Trade & { copyVirtual?: boolean }).copyVirtual === true;
}

/**
 * Synthesize the copy legs of a base trade IN MEMORY — no file is written.
 * This is the default (space-saving) mode; a leg is only materialized into a
 * real note when it needs per-account data (print, imported fill, manual edit).
 */
export function synthesizeLegs(plugin: TradebookPlugin, base: Trade): Trade[] {
  const baseAccount = plugin.mappedAccount(base.account);
  if (!baseAccount || isLeg(base)) return [];
  const out: Trade[] = [];
  for (const acc of membersForBase(plugin, base)) {
    const cfg = effectiveCopyConfig(acc, base.date);
    if (!cfg) continue;
    const leg = buildLeg(base, acc, cfg);
    if (!leg.symbol || leg.quantity <= 0) continue;
    (leg as Trade & { copyVirtual?: boolean }).copyVirtual = true;
    leg.id = `${legBaseKey(base)}::copy::${acc.id}`;
    out.push(leg);
  }
  return out;
}

/**
 * Physical trades + virtual copy legs for every base trade that doesn't already
 * have a MATERIALIZED leg for that account. Materialized legs always win.
 */
export function expandVirtualLegs(plugin: TradebookPlugin, physical: Trade[]): Trade[] {
  const bases = physical.filter((t) => !isLeg(t));
  if (!bases.length) return physical;
  // baseKey → set of account ids that already have a real leg note
  const materialized = new Map<string, Set<string>>();
  for (const t of physical) {
    if (!isLeg(t)) continue;
    const bk = legBaseKey(t);
    let set = materialized.get(bk);
    if (!set) {
      set = new Set<string>();
      materialized.set(bk, set);
    }
    const aid = plugin.mappedAccount(t.account)?.id;
    if (aid) set.add(aid);
  }
  const out = [...physical];
  for (const base of bases) {
    const have = materialized.get(legBaseKey(base));
    for (const leg of synthesizeLegs(plugin, base)) {
      const aid = plugin.mappedAccount(leg.account)?.id;
      if (aid && have?.has(aid)) continue; // a real leg note already exists
      out.push(leg);
    }
  }
  return out;
}

/**
 * A copy mirrors every execution, scaled — if the leader takes half off, the
 * copier takes half off too. Without this the copier's note would claim a single
 * exit while the leader has two, and the two accounts would tell different
 * stories about the same decision.
 */
function legFills(base: Trade, legSymbol: string, legQty: number, legCost: number): TradeFill[] | undefined {
  if (!base.fills?.length || legQty <= 0) return undefined;
  const set = fillSet(base);
  if (!set.isMulti) return undefined;
  const factor = legQty / (set.positionSize || set.entryQty || legQty);
  const baseSpec = futuresSpec(base.symbol);
  const spec = futuresSpec(legSymbol);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const out: TradeFill[] = [];

  // Scale each side, then pin the biggest fill so the quantities add up exactly:
  // rounding four halves must still total the leg's real size.
  for (const side of [set.entries, set.exits]) {
    if (!side.length) continue;
    const scaled = side.map((f) => Math.max(1, Math.round(f.qty * factor)));
    const target = Math.round(side.reduce((s, f) => s + f.qty, 0) * factor);
    const drift = target - scaled.reduce((s, q) => s + q, 0);
    if (drift !== 0) {
      let bi = 0;
      scaled.forEach((q, i) => {
        if (q > scaled[bi]) bi = i;
      });
      scaled[bi] = Math.max(1, scaled[bi] + drift);
    }
    side.forEach((f, i) => {
      const qty = scaled[i];
      const fees = legCost > 0 ? round2((legCost * qty) / legQty) : undefined;
      // The fill's own P&L comes from its own points, priced at the leg's contract
      // (a cross-order leg is priced differently from the leader).
      const points =
        Number.isFinite(f.pnl) && f.qty > 0 && baseSpec.pointValue ? (f.pnl as number) / (baseSpec.pointValue * f.qty) : NaN;
      const pnl = Number.isFinite(points) ? round2(points * spec.pointValue * qty) : undefined;
      out.push({ side: f.side, time: f.time, instant: f.instant, qty, price: f.price, pnl, fees });
    });
  }
  return out.length ? out : undefined;
}

/** Build the leg (a full Trade) for one account from a base trade. */
export function buildLeg(base: Trade, account: PropAccount, cfg: CopyConfigEntry): Trade {
  // The engine picks the contract, never the trader. A ratio that leaves less
  // than one mini (0.5× of 1 NQ) would round to zero and the leg would simply
  // vanish; when that happens and the symbol has a micro, the same exposure is
  // mirrored in micros (one mini's worth, at that instrument's ratio).
  // Anything else keeps the leader's
  // own symbol. Legs already written are frozen — only new ones are built here.
  const ratio = cfg.ratio || 1;
  const baseQty = base.quantity || 0;
  const isRatioSizing = !cfg.sizing || cfg.sizing === "ratio";
  const contractMode = cfg.crossMode === "contract";
  const micro = microOf(base.symbol || "");
  const fractional = isRatioSizing && baseQty > 0 && baseQty * ratio < 1;
  const cross = cfg.crossOrder === true && !!micro && (contractMode || fractional);
  const symbol = cross ? crossSymbol(base.symbol, true) : base.symbol;
  const spec = futuresSpec(symbol);

  let rawQty: number;
  if (cfg.sizing === "fixed") rawQty = cfg.fixedQty ?? 0;
  else if (cfg.sizing === "mirror") rawQty = baseQty;
  else if (cross) rawQty = baseQty * (contractMode ? 1 : microRatio(base.symbol)) * ratio;
  else rawQty = baseQty * ratio;

  const mode = cfg.round ?? "down";
  let qty = mode === "nearest" ? Math.round(rawQty) : mode === "up" ? Math.ceil(rawQty) : Math.floor(rawQty);
  if (cfg.minQty && qty < cfg.minQty) qty = cfg.minQty;

  // Points come from the base's own fills/scalars under the shared rule (the
  // stored value may predate it); the branch itself still follows the note.
  const basePoints = tradePoints(base);
  const hasPoints = Number.isFinite(base.pnlPoints) && !(base.pnlPoints === 0 && (base.pnl ?? 0) !== 0);
  // A leg never invents a cost: only the platform that charged it can say what
  // it was, and a copy is a different account's trade. Its P&L is gross, like
  // the leader's — points priced at the leg's contract, or the base scaled.
  const commission = 0;
  const fees = 0;
  const pnl = hasPoints
    ? round2(basePoints * spec.pointValue * qty)
    : round2((base.pnl ?? 0) * ratio);

  return {
    id: "",
    date: base.date,
    entryTime: base.entryTime,
    exitTime: base.exitTime,
    // The leg happened at the same wall-clock instant as its leader, so it
    // carries the same zone — otherwise a copy would read in the wrong clock.
    timezone: base.timezone,
    // …and the same canonical instants: the executions are the leader's own,
    // only the account differs. Without them a leg would be the one note in the
    // group with no timeline to speak of.
    entryInstant: base.entryInstant,
    exitInstant: base.exitInstant,
    sourceZone: base.sourceZone,
    instantSource: base.instantSource,
    symbol,
    account: account.name,
    accountType: account.type,
    direction: base.direction,
    quantity: qty,
    entryPrice: base.entryPrice,
    exitPrice: base.exitPrice,
    stopLoss: base.stopLoss ?? 0,
    target: base.target ?? 0,
    // The stop's provenance travels with the copy: a risk the leader's file
    // called *assumed* must not surface on the leg as if the broker had filed
    // it. The levels move too, so a moved stop still reads as a move.
    // `origin` is deliberately not copied — a leg is generated here, not typed
    // by the trader nor written by a CSV, and it should not claim either.
    stopSource: base.stopSource,
    stopLevels: base.stopLevels ? [...base.stopLevels] : undefined,
    commission,
    fees,
    // Generated copy legs are a model and carry no broker-confirmed costs.
    costCoverage: { commission: false, fees: false },
    pnl,
    pnlPoints: hasPoints ? round2(basePoints) : 0,
    setup: base.setup,
    mistake: base.mistake,
    thesis: base.thesis,
    review: "",
    screenshot: base.screenshot,
    screenshots: base.screenshots?.map((s) => ({ ...s })) ?? (base.screenshot ? [{ file: base.screenshot }] : []),
    rating: 0,
    reviewed: false,
    tags: base.tags ? [...base.tags] : [],
    psychology_tags: base.psychology_tags ? [...base.psychology_tags] : [],
    mistake_tags: base.mistake_tags ? [...base.mistake_tags] : [],
    fills: legFills(base, symbol, qty, commission + fees),
    isCopiedTrade: true,
    copiedFromAccount: base.account,
    copyBaseKey: legBaseKey(base),
    copyBaseFile: "",
    copyMultiplier: ratio,
    copySymbolMap: cross ? `${base.symbol} → ${symbol}` : "",
    copyOrigin: "generated",
    // A generated leg is a model of the leader's trade, never the follower's own
    // fill. `copyOrigin` keeps its existing meaning; this states the same fact in
    // the provenance field every surface can read.
    dataSource: "reconstructed",
    copyPnlAdjustment: round2(pnl - round2(base.pnl * ratio)),
  };
}

export interface GenerateResult {
  created: number;
  replaced: number;
  skipped: number;
}

/**
 * Create (or refresh) the legs of a base trade. Safe to run repeatedly.
 * `accountIds` limits the selection (the per-trade checklist); when omitted,
 * every active member gets a leg.
 */
export async function generateLegs(
  plugin: TradebookPlugin,
  base: Trade,
  accountIds?: string[]
): Promise<GenerateResult> {
  const result: GenerateResult = { created: 0, replaced: 0, skipped: 0 };
  const baseAccount = plugin.mappedAccount(base.account);
  if (!baseAccount) return result;

  // Give the base a stable group key so legs survive edits/renames.
  if (!base.copyBaseKey) {
    base.copyBaseKey = "ck_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await setTradeFields(plugin.app, base.id, { copy_base_key: base.copyBaseKey });
  }
  const baseKey = legBaseKey(base);
  const trades = await plugin.loadTrades();
  const existing = legsOf(trades, baseKey).filter(
    (t) => !accountIds || accountIds.some((id) => (plugin.mappedAccount(t.account)?.id ?? "") === id)
  );

  const members = membersForBase(plugin, base).filter((a) => !accountIds || accountIds.includes(a.id));

  for (const acc of members) {
    const cfg = effectiveCopyConfig(acc, base.date);
    if (!cfg) {
      result.skipped++;
      continue;
    }
    const leg = buildLeg(base, acc, cfg);
    if (!leg.symbol || leg.quantity <= 0) {
      result.skipped++;
      continue;
    }
    const prev = existing.find((e) => (e.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase());
    if (prev) {
      if (!isReplaceableLeg(prev)) {
        // A real fill is never overwritten; a superseded model is frozen
        // history and is never resurrected by a regeneration.
        result.skipped++;
        continue;
      }
      await deleteTradeFile(plugin.app, prev.id);
      result.replaced++;
    }
    await saveTrade(plugin.app, plugin.getTradesFolder(), leg, plugin.settings.dateFormat);
    result.created++;
  }
  plugin.clearTradeCache();
  return result;
}

/** Remove every generated leg of a base trade (imported legs are kept). */
export async function deleteLegs(plugin: TradebookPlugin, baseKey: string): Promise<number> {
  const trades = await plugin.loadTrades();
  let removed = 0;
  for (const t of legsOf(trades, baseKey)) {
    if (t.copyOrigin === "imported") continue;
    await deleteTradeFile(plugin.app, t.id);
    removed++;
  }
  if (removed) plugin.clearTradeCache();
  return removed;
}

/**
 * Turn a VIRTUAL leg into a real note. Called when the leg needs per-account
 * data (its own print, an imported fill, or a manual edit) — otherwise the leg
 * stays virtual and takes no space on disk.
 */
export async function materializeLeg(plugin: TradebookPlugin, leg: Trade): Promise<string> {
  const copy: Trade = { ...leg };
  delete (copy as Trade & { copyVirtual?: boolean }).copyVirtual;
  copy.id = "";
  await saveTrade(plugin.app, plugin.getTradesFolder(), copy, plugin.settings.dateFormat);
  plugin.clearTradeCache();
  const fresh = await plugin.loadTrades();
  const saved = fresh.find(
    (t) => isLeg(t) && legBaseKey(t) === legBaseKey(leg) && (t.account || "").trim().toLowerCase() === (copy.account || "").trim().toLowerCase()
  );
  return saved?.id ?? "";
}
