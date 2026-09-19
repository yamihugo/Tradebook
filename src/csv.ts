import { AccountType, Execution, ImportCosts, OrphanCost, ParsedResult, Trade, TradeFill } from "./types";
import { AccountRule, classifyAccount, futuresSpec, rootSymbol } from "./futures";
import { localToUtc, zoneWallParts } from "./tz";

function parseFloatSafe(v: string | undefined | null): number {
  if (v === undefined || v === null) return 0;
  const clean = String(v).replace(/[$,]/g, "").trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function firstNonEmpty(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseTimestamp(s: string, sourceZone?: string): Date | null {
  if (!s) return null;
  const clean = String(s).split(".")[0].trim();
  const m = clean.match(
    /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(.*)$/
  );
  if (!m) return null;
  let [, a, b, c, hh, mm, ss, suffix] = m;
  let year: number, month: number, day: number;
  const aNum = parseInt(a, 10);
  const cNum = parseInt(c, 10);
  if (aNum > 1000) {
    year = aNum;
    month = parseInt(b, 10);
    day = parseInt(c, 10);
  } else {
    year = cNum < 100 ? 2000 + cNum : cNum;
    month = aNum;
    day = parseInt(b, 10);
  }

  // 12-hour clock: "2:30 PM" is 14:30, not 02:30.
  let hour = parseInt(hh, 10);
  if (/pm/i.test(suffix || "") && hour < 12) hour += 12;
  if (/am/i.test(suffix || "") && hour === 12) hour = 0;

  // A timestamp that names its own zone (Z or ±HH:MM) is a true instant —
  // trust it rather than guessing a source zone.
  if (suffix && /(z|[+-]\d{1,2}:?\d{2})\s*$/i.test(suffix.trim())) {
    const d = new Date(clean.replace(" ", "T"));
    if (!isNaN(d.getTime())) return d;
  }

  // Naive timestamp (the common case): interpret it in the source zone when we
  // know it, so the instant is pinned regardless of the machine's own zone.
  if (sourceZone) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const timeStr = `${String(hour).padStart(2, "0")}:${String(parseInt(mm, 10)).padStart(2, "0")}:${String(
      ss ? parseInt(ss, 10) : 0
    ).padStart(2, "0")}`;
    const d = localToUtc(dateStr, timeStr, sourceZone);
    return isNaN(d.getTime()) ? null : d;
  }

  const date = new Date(year, month - 1, day, hour, parseInt(mm, 10), ss ? parseInt(ss, 10) : 0, 0);
  return isNaN(date.getTime()) ? null : date;
}

export function countRows(csvText: string): number {
  if (!csvText.trim()) return 0;
  return csvText.trim().split(/\r?\n/).length - 1;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return rows;

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const header = splitLine(lines[0]).map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const vals = splitLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h] = vals[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

const EXEC_KEYS = {
  timestamp: ["Fill Time", "fill time", "FillTime", "Timestamp", "timestamp", "Date/Time", "date/time", "Create Time", "create time"],
  account: ["Account", "account", "Account/AccountId", "Account ID", "_accountId", "AccountName", "Account Name"],
  symbol: ["Symbol", "Product", "Contract", "symbol", "product", "contract"],
  side: ["Side", "B/S", "Buy/Sell", "Action", "side", "b/s"],
  // A fill's size is the FILLED quantity, not what the ticket asked for: on an
  // Orders export a partly-filled order would otherwise be imported at its
  // order size. "Quantity" is the fallback for a plain Fills export.
  qty: ["Filled Qty", "filledQty", "Quantity", "Qty", "quantity", "qty", "Order Qty", "order qty"],
  // Same reasoning for the price: the average fill price is what was traded.
  price: ["Avg Fill Price", "avgFillPrice", "avgPrice", "Filled Price", "Price", "price", "average price"],
  // No commission/fees keys on purpose: those columns are the broker's line
  // only, and a half-counted cost is worse than none. The cash history is read
  // separately (parseCashHistoryCsv).
  orderId: ["Order ID", "OrderId", "orderId", "OrderID", "_orderId", "ordStatusID"],
  orderType: ["Order Type", "OrderType", "orderType", "order_type", "Type"],
};

/**
 * Columns that only a *filled* row carries. A Tradovate Orders export has both
 * "Quantity" (what the ticket asked for) and "Filled Qty" (what it got), so a
 * cancelled ticket looks like a complete row until you read the fill columns.
 */
const FILL_KEYS = {
  qty: ["Filled Qty", "filledQty"],
  price: ["Avg Fill Price", "avgFillPrice", "avgPrice", "Filled Price"],
};

export interface CsvImportZones {
  /** Zone the export was written in (naive timestamps only). */
  sourceZone?: string;
  /** Zone to record the trade in — the journal's zone. */
  journalZone?: string;
}

/** One fill's real cost, as the platform broke it down in its cash history. */
export interface FillCosts {
  exchange: number;
  clearing: number;
  nfa: number;
  commission: number;
}

export interface CashCosts {
  /** Cost per fill, keyed by timestamp + contract (the platform's own identity). */
  byFill: Map<string, FillCosts>;
  /** How many cost lines the file holds (four per fill). */
  lines: number;
  /** Everything the platform took in costs over this range. */
  charged: number;
  /** The platform's own account balance — the last running `Amount` it wrote. */
  finalBalance?: number;
}

const CASH_CONTRACT_KEYS = ["Contract", "contract"];
const CASH_STAMP_KEYS = ["Timestamp", "timestamp", "Date/Time", "date/time"];

/** `08/19/2026 14:46:08` → `2026-08-19 14:46:08`, so any report's stamp matches. */
function normStamp(raw: string): string {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(raw || "");
  if (!m) return (raw || "").replace(/\s+/g, " ").trim();
  const [, mo, d, y, h, mi, s] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${mi}:${s}`;
}

function cashKey(stamp: string, contract: string): string {
  return `${normStamp(stamp)}|${(contract || "").trim().toUpperCase()}`;
}

/** The cash history is the one file whose header says what it is. */
export function isCashHistoryCsv(text: string): boolean {
  const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
  return head.includes("cash change type") || (head.includes("delta") && head.includes("amount"));
}

/**
 * What report a dropped file is, read from its header and never its name — a
 * user renames an export and the name lies. `cash` is the platform's money
 * ledger, never trades; `orders` carries every ticket, `fills` every execution.
 * Anything else is not something this journal can read, and says so.
 */
export function csvKind(text: string): "cash" | "orders" | "fills" | "unknown" {
  if (isCashHistoryCsv(text)) return "cash";
  const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
  if (head.includes("fill id")) return "fills";
  if (head.includes("status") && head.includes("order id")) return "orders";
  return "unknown";
}

/**
 * What the platform actually took out of the account.
 *
 * Only four lines are costs — exchange, clearing, NFA and commission — and
 * every one of them carries the same timestamp and contract as the fill it
 * belongs to, which is how a fill finds its real cost. The `Trade Paired` rows
 * are the same money as the fill prices (never a cost), and `Fund Transaction`
 * is a deposit or withdrawal.
 */
export function parseCashHistoryCsv(text: string): CashCosts {
  const byFill = new Map<string, FillCosts>();
  let lines = 0;
  let charged = 0;
  let finalBalance: number | undefined;

  for (const row of parseCsv(text)) {
    // The running `Amount` column is the platform's own balance. The last line
    // that carries one is what the account really holds, and it is the number
    // the import checks the journal's arithmetic against.
    const amountRaw = firstNonEmpty(row, ["Amount", "amount"]);
    if (amountRaw) {
      const amountVal = parseFloatSafe(amountRaw);
      if (Number.isFinite(amountVal)) finalBalance = amountVal;
    }
    const kind = firstNonEmpty(row, ["Cash Change Type", "Cash Change"]).trim().toLowerCase();
    const delta = parseFloatSafe(firstNonEmpty(row, ["Delta"]));
    if (kind === "trade paired") continue;
    if (kind === "fund transaction") continue;
    const isCost =
      kind === "exchange fee" || kind === "clearing fee" || kind === "nfa fee" || kind === "commission";
    if (!isCost) continue;

    lines++;
    // The cash history writes every cost as a negative delta. The journal keeps
    // costs as positive amounts and subtracts them, the way the fills file and
    // every broker statement write them.
    const amount = Math.abs(delta);
    charged += amount;
    const key = cashKey(firstNonEmpty(row, CASH_STAMP_KEYS), firstNonEmpty(row, CASH_CONTRACT_KEYS));
    const entry = byFill.get(key) ?? { exchange: 0, clearing: 0, nfa: 0, commission: 0 };
    if (kind === "exchange fee") entry.exchange += amount;
    else if (kind === "clearing fee") entry.clearing += amount;
    else if (kind === "nfa fee") entry.nfa += amount;
    else entry.commission += amount;
    byFill.set(key, entry);
  }

  return { byFill, lines, charged: round2(charged), finalBalance };
}

export function parseTradeovateCsv(
  fileText: string,
  accountRules: AccountRule[],
  zones?: CsvImportZones,
  costs?: CashCosts
): ParsedResult {
  const robj = parseCsv(fileText);
  const warnings: string[] = [];
  const executions: Execution[] = [];
  let skipped = 0;
  let unfilled = 0;
  // Only ever what the platform charged. Without its cash history there is
  // nothing to charge, and a plausible-looking fee nobody was billed for is
  // exactly the kind of number this journal refuses to print.
  let recordedCost = 0;
  const costKeysUsed = new Set<string>();

  const headerKeys = Object.keys(robj[0] ?? {}).map((h) => h.toLowerCase());
  const hasExecSig =
    (headerKeys.some((h) => h.includes("timestamp")) ||
      headerKeys.some((h) => h.includes("fill time")) ||
      headerKeys.some((h) => h.includes("create time"))) &&
    headerKeys.some((h) => h.includes("account")) &&
    (headerKeys.some((h) => h.includes("symbol")) ||
      headerKeys.some((h) => h.includes("product")) ||
      headerKeys.some((h) => h.includes("contract"))) &&
    (headerKeys.some((h) => h.includes("side")) ||
      headerKeys.some((h) => h.includes("b/s")) ||
      headerKeys.some((h) => h.includes("action"))) &&
    (headerKeys.some((h) => h.includes("qty")) ||
      headerKeys.some((h) => h.includes("quantity")));

  // Does the file spell out the fill separately from the order? If it does, a
  // row with empty fill columns is an order that never traded.
  const hasFillCols =
    headerKeys.some((h) => h.includes("filled qty")) ||
    headerKeys.some((h) => h.includes("filledqty")) ||
    headerKeys.some((h) => h.includes("avg fill price")) ||
    headerKeys.some((h) => h.includes("avgfillprice")) ||
    headerKeys.some((h) => h.includes("avgprice"));

  for (const row of robj) {
    const timestamp = parseTimestamp(firstNonEmpty(row, EXEC_KEYS.timestamp), zones?.sourceZone);
    const account = firstNonEmpty(row, EXEC_KEYS.account);
    const symbol = firstNonEmpty(row, EXEC_KEYS.symbol);
    let sideRaw = firstNonEmpty(row, EXEC_KEYS.side).toLowerCase();
    const qtyStr = firstNonEmpty(row, EXEC_KEYS.qty);
    const priceStr = firstNonEmpty(row, EXEC_KEYS.price);
    const fillQtyStr = firstNonEmpty(row, FILL_KEYS.qty);
    const fillPriceStr = firstNonEmpty(row, FILL_KEYS.price);

    // An order ticket that never traded: the export spells out the fill columns
    // and this row left them empty. That is not a malformed row — it is an order
    // that was cancelled or is still working — and calling it one told the
    // reader their export was broken when it was not.
    if (hasFillCols && !fillQtyStr && !fillPriceStr && account && symbol && timestamp) {
      unfilled++;
      continue;
    }

    if (!timestamp || !account || !symbol || !sideRaw || !qtyStr || !priceStr) {
      skipped++;
      continue;
    }

    if (sideRaw.includes("buy") || sideRaw === "b" || sideRaw === "l" || sideRaw === "long") {
      sideRaw = "buy";
    } else if (sideRaw.includes("sell") || sideRaw === "s" || sideRaw === "short") {
      sideRaw = "sell";
    } else {
      skipped++;
      continue;
    }

    const qty = Math.abs(parseFloatSafe(qtyStr));
    if (qty <= 0) {
      skipped++;
      continue;
    }

    const price = parseFloatSafe(priceStr);
    // Costs never come from the trades file. It carries the broker's own
    // commission and nothing else — no exchange, clearing or NFA — and a
    // partial cost reads as a full one, so the journal would print a net P&L
    // that nobody was ever billed. The platform's cash history is the only
    // source (see parseCashHistoryCsv); without it a trade has no cost line,
    // and the import says so out loud.
    const commission = 0;
    const fees = 0;
    const accountType = classifyAccount(account, accountRules);

    // The platform's own identity for this fill — its timestamp and contract as
    // written. The cash history stamps its cost lines with the same pair, which
    // is how a fill finds the money it was actually charged.
    const costKey = cashKey(firstNonEmpty(row, EXEC_KEYS.timestamp), firstNonEmpty(row, CASH_CONTRACT_KEYS));

    executions.push({
      timestamp,
      account,
      accountType,
      symbol: rootSymbol(symbol),
      side: sideRaw as "buy" | "sell",
      quantity: qty,
      price,
      commission,
      fees,
      orderId: firstNonEmpty(row, EXEC_KEYS.orderId),
      orderType: firstNonEmpty(row, EXEC_KEYS.orderType),
      costKey,
    });
  }

  // The cash history spells out all four cost lines — exchange, clearing, NFA
  // and commission — and each one is stamped with the fill it belongs to. When
  // two fills share a stamp and a contract their lines cannot be told apart, so
  // the group is split by size: the money is exact even when the split is a
  // judgement call.
  if (costs) {
    const sizePerKey = new Map<string, number>();
    for (const e of executions) {
      if (e.costKey && costs.byFill.has(e.costKey)) sizePerKey.set(e.costKey, (sizePerKey.get(e.costKey) ?? 0) + e.quantity);
    }
    for (const e of executions) {
      const key = e.costKey;
      const found = key ? costs.byFill.get(key) : undefined;
      if (!key || !found) continue;
      const total = sizePerKey.get(key) ?? 0;
      const frac = total > 0 ? e.quantity / total : 1;
      e.commission = found.commission * frac;
      e.fees = (found.exchange + found.clearing + found.nfa) * frac;
      if (!costKeysUsed.has(key)) {
        costKeysUsed.add(key);
        recordedCost += found.commission + found.exchange + found.clearing + found.nfa;
      }
    }
  }

  if (!hasExecSig && executions.length === 0) {
    warnings.push(
      "Could not recognize the CSV format. Use the Tradeovate export from Reports → Orders or Fills."
    );
  }

  const { trades, openFills, windows } = pairRoundTrips(executions, accountRules, zones?.journalZone);

  // The Orders export folds several executions into one row, so a handful of the
  // cash history's cost lines carry a stamp no trade holds. The money is real, so
  // it is not dropped: a line is glued to the one trade it obviously belongs to
  // (same contract, and the stamp inside the trade's own entry→exit window plus
  // two minutes), and anything that stays ambiguous becomes a dated cost on the
  // account instead of a guess.
  const orphanCosts: OrphanCost[] = [];
  if (costs && costs.byFill.size > costKeysUsed.size) {
    const bySymbol = new Map<string, Trade[]>();
    for (const t of trades) {
      const arr = bySymbol.get(t.symbol);
      if (arr) arr.push(t);
      else bySymbol.set(t.symbol, [t]);
    }
    for (const [key, found] of costs.byFill) {
      if (costKeysUsed.has(key)) continue;
      const sep = key.lastIndexOf("|");
      const stamp = sep >= 0 ? key.slice(0, sep) : key;
      const contract = sep >= 0 ? key.slice(sep + 1) : "";
      const ms = parseTimestamp(stamp, zones?.sourceZone)?.getTime() ?? NaN;
      const root = rootSymbol(contract);
      let target: Trade | null = null;
      if (Number.isFinite(ms)) {
        const candidates = (bySymbol.get(root) ?? []).filter((t) => {
          const w = windows.get(t.id);
          return w ? ms >= w.openMs - 120000 && ms <= w.closeMs + 120000 : false;
        });
        // Only obvious when exactly one trade claims it — two candidates would
        // make this a coin flip, and a coin flip is not a cost.
        if (candidates.length === 1) target = candidates[0];
      }
      const total = found.commission + found.exchange + found.clearing + found.nfa;
      if (target) {
        target.commission = round2(target.commission + found.commission);
        target.fees = round2(target.fees + (found.exchange + found.clearing + found.nfa));
        target.pnl = round2(target.grossPnl - target.commission - target.fees);
        costKeysUsed.add(key);
        recordedCost += total;
      } else {
        orphanCosts.push({
          date: Number.isFinite(ms) ? formatDate(new Date(ms), zones?.journalZone) : "",
          amount: round2(total),
          contract: contract || root,
        });
      }
    }
  }

  const accountsSeen: { name: string; type: AccountType }[] = [];
  const seenSet = new Set<string>();
  for (const e of executions) {
    if (!seenSet.has(e.account)) {
      seenSet.add(e.account);
      accountsSeen.push({ name: e.account, type: e.accountType });
    }
  }

  if (executions.length > 0 && trades.length === 0) {
    warnings.push(
      "Found executions but could not pair complete round-trips (there may be open orders or partial scale)."
    );
  }

  const costSummary: ImportCosts | undefined = costs
    ? {
        charged: costs.charged,
        recorded: round2(recordedCost),
        finalBalance: costs.finalBalance,
        orphans: orphanCosts,
      }
    : undefined;

  if (costSummary && costSummary.orphans.length > 0) {
    warnings.push(
      `${costSummary.orphans.length} cost line(s) could not be tied to a trade — logged against the account on their own date.`
    );
  }

  return { trades, warnings, skipped, unfilled, unpaired: openFills, accountsSeen, costs: costSummary };
}

function pairRoundTrips(
  executions: Execution[],
  accountRules: AccountRule[],
  journalZone?: string
): { trades: Trade[]; openFills: number; windows: Map<string, { openMs: number; closeMs: number }> } {
  const sorted = [...executions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const groups = new Map<string, Execution[]>();
  for (const e of sorted) {
    const key = `${e.account}|${e.symbol}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  const trades: Trade[] = [];
  // The real time span of each round trip, so a cost line with no matching fill
  // can still find the trade it was charged for (see parseTradeovateCsv).
  const windows = new Map<string, { openMs: number; closeMs: number }>();
  // Fills that never found a closing fill: an open or partial position. They are
  // reported instead of vanishing, so the file's arithmetic always adds up.
  let openFills = 0;

  for (const fills of groups.values()) {
    const lots: { sign: 1 | -1; qty: number; price: number; time: Date }[] = [];
    let pos: {
      dir: "long" | "short";
      openPrice: number;
      openTime: Date;
      qty: number;
    } | null = null;
    let realizedGross = 0;
    // Commission and fees are tracked apart: the platform bills them on
    // separate lines, and a journal that adds them together cannot show you
    // which one grew.
    let tradeCommission = 0;
    let tradeFees = 0;
    // The executions behind this round trip. Kept so the note can carry them:
    // a scaled position must not lose the prices it was actually traded at.
    let entryFills: TradeFill[] = [];
    let exitFills: TradeFill[] = [];
    let maxOpen = 0;

    for (const fill of fills) {
      const sign: 1 | -1 = fill.side === "buy" ? 1 : -1;
      const spec = futuresSpec(fill.symbol);
      let remaining = fill.quantity;
      const fillCost = fill.commission + fill.fees;

      let closedQty = 0;
      let fillGross = 0;
      while (remaining > 0 && lots.length > 0 && lots[0].sign === (-sign as 1 | -1)) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.qty);
        const gross = take * (fill.price - lot.price) * lot.sign * spec.pointValue;
        realizedGross += gross;
        fillGross += gross;
        closedQty += take;
        remaining -= take;
        lot.qty -= take;
        if (lot.qty === 0) lots.shift();
      }

      if (closedQty > 0) {
        const share = fill.quantity > 0 ? closedQty / fill.quantity : 1;
        tradeCommission += fill.commission;
        tradeFees += fill.fees;
        exitFills.push({
          side: fill.side,
          time: formatTime(fill.timestamp, journalZone),
          qty: closedQty,
          price: fill.price,
          pnl: round2(fillGross),
          fees: round2(fillCost * share),
          orderType: fill.orderType || undefined,
          fillId: fill.orderId || undefined,
        });
      }

      if (closedQty > 0 && lots.length === 0 && pos) {
        const gross = round2(realizedGross);
        // Costs are only ever what the platform charged. An Orders or Fills
        // export on its own does not carry them all, and a modelled fee would
        // put a number in the journal that no broker ever billed.
        const comm = round2(tradeCommission);
        const fee = round2(tradeFees);
        const totalCost = round2(comm + fee);
        const pnl = round2(gross - totalCost);
        const points = spec.pointValue ? gross / spec.pointValue : 0;
        // The scalars are the weighted averages of the fills, so a scaled trade
        // reads the same price the trader actually got, not one lucky execution.
        const avgEntry = averagePrice(entryFills) || pos.openPrice;
        const avgExit = averagePrice(exitFills) || fill.price;
        const chronological = [...entryFills, ...exitFills].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
        const tradeId = `${fill.account}_${fill.symbol}_${pos.openTime.getTime()}_${pos.openPrice}`;

        trades.push({
          id: tradeId,
          date: formatDate(pos.openTime, journalZone),
          entryTime: formatTime(pos.openTime, journalZone),
          exitTime: formatTime(fill.timestamp, journalZone),
          symbol: fill.symbol,
          account: fill.account,
          accountType: fill.accountType,
          direction: pos.dir,
          quantity: maxOpen || pos.qty,
          entryPrice: round2(avgEntry),
          exitPrice: round2(avgExit),
          commission: comm,
          fees: fee,
          grossPnl: gross,
          pnl,
          pnlPoints: round2(points),
          // Only stored when the position was actually scaled: one entry and one
          // exit is already fully described by the scalar fields above.
          fills: entryFills.length > 1 || exitFills.length > 1 ? chronological : undefined,
          setup: "",
          mistake: "",
          thesis: "",
          review: "",
          screenshot: "",
          rating: 0,
          orderType: entryFills[0]?.orderType || undefined,
          fillId: entryFills[0]?.fillId || undefined,
          timezone: journalZone || undefined,
        });
        windows.set(tradeId, { openMs: pos.openTime.getTime(), closeMs: fill.timestamp.getTime() });

        realizedGross = 0;
        tradeCommission = 0;
        tradeFees = 0;
        pos = null;
        entryFills = [];
        exitFills = [];
        maxOpen = 0;
      }

      if (remaining > 0) {
        if (!pos && lots.length === 0) {
          pos = {
            dir: fill.side === "buy" ? "long" : "short",
            openPrice: fill.price,
            openTime: fill.timestamp,
            qty: remaining,
          };
        }
        const share = fill.quantity > 0 ? remaining / fill.quantity : 1;
        tradeCommission += fill.commission;
        tradeFees += fill.fees;
        entryFills.push({
          side: fill.side,
          time: formatTime(fill.timestamp, journalZone),
          qty: remaining,
          price: fill.price,
          fees: round2(fillCost * share),
          orderType: fill.orderType || undefined,
          fillId: fill.orderId || undefined,
        });
        lots.push({ sign, qty: remaining, price: fill.price, time: fill.timestamp });
      }

      const open = lots.reduce((s, l) => s + l.qty, 0);
      if (open > maxOpen) maxOpen = open;
    }

    // Whatever is still open at the end of this account+symbol group never
    // closed, so it is a fill the journal cannot pair into a trade.
    openFills += lots.length;
  }

  return { trades, openFills, windows };
}

/** Weighted average price of a run of fills. 0 when there is nothing to average. */
function averagePrice(fills: TradeFill[]): number {
  let qty = 0;
  let sum = 0;
  for (const f of fills) {
    if (!(f.qty > 0) || !Number.isFinite(f.price)) continue;
    qty += f.qty;
    sum += f.qty * f.price;
  }
  return qty > 0 ? sum / qty : 0;
}

function formatDate(d: Date, zone?: string): string {
  if (zone) return zoneWallParts(d, zone).date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date, zone?: string): string {
  if (zone) return zoneWallParts(d, zone).time;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Test hook (see lib/fills.ts): lets the harness feed a CSV and inspect the fills.
if (typeof window !== "undefined") {
  (window as any).__tjCsv = { parseTradeovateCsv };
}
