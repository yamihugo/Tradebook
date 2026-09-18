import { AccountType, Execution, ParsedResult, Trade, TradeFill } from "./types";
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
  qty: ["Quantity", "Qty", "Filled Qty", "filledQty", "quantity", "qty", "Order Qty", "order qty"],
  price: ["Price", "Avg Fill Price", "avgPrice", "avgFillPrice", "Filled Price", "price", "average price"],
  commission: ["Commission", "commission", "Commission/Fee", "Commissions"],
  fees: ["Fees", "fees", "Exchange Fees", "NFA Fee"],
  orderId: ["Order ID", "OrderId", "orderId", "OrderID", "_orderId", "ordStatusID"],
  orderType: ["Order Type", "OrderType", "orderType", "order_type", "Type"],
};

export interface CsvImportZones {
  /** Zone the export was written in (naive timestamps only). */
  sourceZone?: string;
  /** Zone to record the trade in — the journal's zone. */
  journalZone?: string;
}

export function parseTradeovateCsv(
  fileText: string,
  accountRules: AccountRule[],
  zones?: CsvImportZones
): ParsedResult {
  const robj = parseCsv(fileText);
  const warnings: string[] = [];
  const executions: Execution[] = [];
  let skipped = 0;

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

  for (const row of robj) {
    const timestamp = parseTimestamp(firstNonEmpty(row, EXEC_KEYS.timestamp), zones?.sourceZone);
    const account = firstNonEmpty(row, EXEC_KEYS.account);
    const symbol = firstNonEmpty(row, EXEC_KEYS.symbol);
    let sideRaw = firstNonEmpty(row, EXEC_KEYS.side).toLowerCase();
    const qtyStr = firstNonEmpty(row, EXEC_KEYS.qty);
    const priceStr = firstNonEmpty(row, EXEC_KEYS.price);

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
    const commission = parseFloatSafe(firstNonEmpty(row, EXEC_KEYS.commission));
    const fees = parseFloatSafe(firstNonEmpty(row, EXEC_KEYS.fees));
    const accountType = classifyAccount(account, accountRules);

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
    });
  }

  if (!hasExecSig && executions.length === 0) {
    warnings.push(
      "Could not recognize the CSV format. Use the Tradeovate export from Reports → Orders or Fills."
    );
  }

  const trades = pairRoundTrips(executions, accountRules, zones?.journalZone);
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

  return { trades, warnings, skipped, accountsSeen };
}

function pairRoundTrips(
  executions: Execution[],
  accountRules: AccountRule[],
  journalZone?: string
): Trade[] {
  const sorted = [...executions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const groups = new Map<string, Execution[]>();
  for (const e of sorted) {
    const key = `${e.account}|${e.symbol}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  const trades: Trade[] = [];

  for (const fills of groups.values()) {
    const lots: { sign: 1 | -1; qty: number; price: number; time: Date }[] = [];
    let pos: {
      dir: "long" | "short";
      openPrice: number;
      openTime: Date;
      qty: number;
    } | null = null;
    let realizedGross = 0;
    let tradeCosts = 0;
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
        tradeCosts += fillCost;
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
        let comm = round2(tradeCosts);
        let fee = 0;

        // Cost Engine fallback: if CSV did not provide commission/fees (e.g. Orders export), apply instrument defaults
        if (comm === 0 && fee === 0) {
          comm = round2(spec.defaultCommission * pos.qty);
          fee = round2(spec.defaultFees * pos.qty);
        }

        const totalCost = round2(comm + fee);
        const pnl = round2(gross - totalCost);
        const points = spec.pointValue ? gross / spec.pointValue : 0;
        // The scalars are the weighted averages of the fills, so a scaled trade
        // reads the same price the trader actually got, not one lucky execution.
        const avgEntry = averagePrice(entryFills) || pos.openPrice;
        const avgExit = averagePrice(exitFills) || fill.price;
        const chronological = [...entryFills, ...exitFills].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

        trades.push({
          id: `${fill.account}_${fill.symbol}_${pos.openTime.getTime()}_${pos.openPrice}`,
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

        realizedGross = 0;
        tradeCosts = 0;
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
        tradeCosts += fillCost;
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
  }

  return trades;
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
