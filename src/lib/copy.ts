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
import { CopyConfigEntry, PropAccount, Trade, TradeFill } from "../types";
import { futuresSpec } from "../futures";
import { deleteTradeFile, saveTrade, setTradeFields, tradeKey } from "../storage";
import { fillSet } from "./fills";

/** mini ↔ micro mapping used by "cross order". */
const MICRO_OF: Record<string, string> = {
  NQ: "MNQ",
  ES: "MES",
  YM: "MYM",
  RTY: "M2K",
  GC: "MGC",
  CL: "MCL",
  SI: "SIL",
  NG: "MNG",
};
const MINI_OF: Record<string, string> = Object.fromEntries(Object.entries(MICRO_OF).map(([mini, micro]) => [micro, mini]));
const MINI_TO_MICRO = 10;

const round2 = (v: number) => Math.round(v * 100) / 100;

export function crossSymbol(symbol: string, toMicro: boolean): string {
  const s = (symbol || "").trim().toUpperCase();
  return toMicro ? MICRO_OF[s] ?? s : MINI_OF[s] ?? s;
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

/** Today as YYYY-MM-DD in the machine's own calendar. */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The day before an ISO date — used to close a period without overlapping. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  start: string
): void {
  const today = todayIso();
  const periods = account.copyPeriods ?? [];
  account.copyPeriods = periods.map((p) => (p.end ? p : { ...p, end: dayBefore(today) }));
  account.copyPeriods.push({ start, end: undefined, baseId, multiplier });
}

/** Stop copying: close whatever is open. Existing legs stay exactly as they are. */
export function closeCopyPeriods(account: PropAccount): void {
  const today = todayIso();
  const periods = account.copyPeriods ?? [];
  if (!periods.length) return;
  account.copyPeriods = periods.map((p) => (p.end ? p : { ...p, end: dayBefore(today) }));
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
export function unlinkCopier(account: PropAccount): void {
  closeCopyPeriods(account);
  account.copyRole = undefined;
  account.copyBaseId = undefined;
  account.copyMultiplier = undefined;
  account.copySizing = undefined;
  account.copyFixedQty = undefined;
  account.copyRound = undefined;
  account.copyMinQty = undefined;
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
export function startCopying(account: PropAccount, baseId: string, multiplier: number, from: string): void {
  openCopyPeriod(account, baseId, multiplier, from);
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
  const history = (account.copyConfigHistory ?? []).filter((h) => h.from !== from);
  account.copyConfigHistory = [...history, entry].sort((a, b) => a.from.localeCompare(b.from));
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
  return !!t && (t as any).copyVirtual === true;
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
    (leg as any).copyVirtual = true;
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
      out.push({ side: f.side, time: f.time, qty, price: f.price, pnl, fees });
    });
  }
  return out.length ? out : undefined;
}

/** Build the leg (a full Trade) for one account from a base trade. */
export function buildLeg(base: Trade, account: PropAccount, cfg: CopyConfigEntry): Trade {
  // The engine picks the contract, never the trader. A ratio that leaves less
  // than one mini (0.5× of 1 NQ) would round to zero and the leg would simply
  // vanish; when that happens and the symbol has a micro, the same exposure is
  // mirrored in micros (1 mini = 10 micros). Anything else keeps the leader's
  // own symbol. Legs already written are frozen — only new ones are built here.
  const ratio = cfg.ratio || 1;
  const baseQty = base.quantity || 0;
  const isRatioSizing = !cfg.sizing || cfg.sizing === "ratio";
  const contractMode = cfg.crossMode === "contract";
  const micro = MICRO_OF[(base.symbol || "").trim().toUpperCase()];
  const fractional = isRatioSizing && baseQty > 0 && baseQty * ratio < 1;
  const cross = cfg.crossOrder === true && !!micro && (contractMode || fractional);
  const symbol = cross ? crossSymbol(base.symbol, true) : base.symbol;
  const spec = futuresSpec(symbol);

  let rawQty: number;
  if (cfg.sizing === "fixed") rawQty = cfg.fixedQty ?? 0;
  else if (cfg.sizing === "mirror") rawQty = baseQty;
  else if (cross) rawQty = baseQty * (contractMode ? 1 : MINI_TO_MICRO) * ratio;
  else rawQty = baseQty * ratio;

  const mode = cfg.round ?? "down";
  let qty = mode === "nearest" ? Math.round(rawQty) : mode === "up" ? Math.ceil(rawQty) : Math.floor(rawQty);
  if (cfg.minQty && qty < cfg.minQty) qty = cfg.minQty;

  const hasPoints = Number.isFinite(base.pnlPoints) && !(base.pnlPoints === 0 && (base.pnl ?? 0) !== 0);
  let grossPnl: number;
  let commission: number;
  let fees: number;
  let pnl: number;
  if (hasPoints) {
    grossPnl = round2((base.pnlPoints as number) * spec.pointValue * qty);
    // A leg never invents a cost: only the platform that charged it can say
    // what it was, and a copy is a different account's trade.
    commission = 0;
    fees = 0;
    pnl = round2(grossPnl - commission - fees);
  } else {
    // No point data (e.g. imported fills): scale the base NET P&L and skip
    // double-charging commission (the base net already had it).
    grossPnl = round2((base.pnl ?? 0) * ratio);
    commission = 0;
    fees = 0;
    pnl = grossPnl;
  }

  return {
    id: "",
    date: base.date,
    entryTime: base.entryTime,
    exitTime: base.exitTime,
    // The leg happened at the same wall-clock instant as its leader, so it
    // carries the same zone — otherwise a copy would read in the wrong clock.
    timezone: base.timezone,
    symbol,
    account: account.name,
    accountType: account.type,
    direction: base.direction,
    quantity: qty,
    entryPrice: base.entryPrice,
    exitPrice: base.exitPrice,
    stopLoss: base.stopLoss ?? 0,
    target: base.target ?? 0,
    commission,
    fees,
    grossPnl,
    pnl,
    pnlPoints: hasPoints ? (base.pnlPoints as number) : 0,
    setup: base.setup,
    mistake: base.mistake,
    thesis: base.thesis,
    review: "",
    screenshot: base.screenshot,
    screenshots: base.screenshots?.map((s) => ({ ...s })) ?? (base.screenshot ? [{ file: base.screenshot }] : []),
    rating: 0,
    reviewed: false,
    tags: base.tags ? [...base.tags] : [],
    fills: legFills(base, symbol, qty, commission + fees),
    isCopiedTrade: true,
    copiedFromAccount: base.account,
    copyBaseKey: legBaseKey(base),
    copyBaseFile: "",
    copyMultiplier: ratio,
    copySymbolMap: cross ? `${base.symbol} → ${symbol}` : "",
    copyOrigin: "generated",
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
      if (prev.copyOrigin === "imported") {
        result.skipped++; // real fills are never overwritten
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
  delete (copy as any).copyVirtual;
  copy.id = "";
  await saveTrade(plugin.app, plugin.getTradesFolder(), copy, plugin.settings.dateFormat);
  plugin.clearTradeCache();
  const fresh = await plugin.loadTrades();
  const saved = fresh.find(
    (t) => isLeg(t) && legBaseKey(t) === legBaseKey(leg) && (t.account || "").trim().toLowerCase() === (copy.account || "").trim().toLowerCase()
  );
  return saved?.id ?? "";
}
