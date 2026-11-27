import { read, utils } from "xlsx";
import { csvKind, parseCsv } from "../csv";
import { knownFuturesSpec } from "../futures";
import { parseInstant } from "./instant";
import { zoneWallParts } from "../tz";
import type { ParsedResult, TimeIssues, Trade } from "../types";

export const TRADINGVIEW_REPLAY_ACCOUNT = "TradingView Replay";

export interface TradingViewReplayZones {
  /** Explicitly selected source timezone, when known. */
  sourceZone: string;
  /** Journal display timezone and fallback for timezone-less Replay stamps. */
  journalZone?: string;
}

export interface TradingViewReplayParseResult extends ParsedResult {
  /** Complete trades excluded until commission/P&L treatment is checked. */
  heldForReview: number;
  /** Trade-number groups outside the supported one-entry/one-exit shape. */
  unsupportedPatterns: number;
}

type ReplayRecord = Record<string, unknown>;
type ParsedLeg = { row: ReplayRecord; phase: "entry" | "exit"; direction: "long" | "short" };

const REPLAY_HEADERS = [
  "trade number",
  "type",
  "date and time",
  "signal",
  "price usd",
  "size (qty)",
  "net pnl usd",
  "commission usd",
] as const;

const REPLAY_FIELD_NAMES = new Map<string, string>([
  ["trade number", "Trade number"],
  ["type", "Type"],
  ["date and time", "Date and time"],
  ["signal", "Signal"],
  ["price usd", "Price USD"],
  ["size (qty)", "Size (qty)"],
  ["net pnl usd", "Net PnL USD"],
  ["commission usd", "Commission USD"],
]);

const EMPTY_ISSUES = (): TimeIssues => ({ gap: 0, ambiguous: 0, noZone: 0, unknownZone: 0 });
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
function cellText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}
const normalizedHeader = (value: unknown): string => cellText(value).trim().toLowerCase();

function emptyResult(warning?: string): TradingViewReplayParseResult {
  return {
    trades: [],
    warnings: warning ? [warning] : [],
    skipped: 0,
    unfilled: 0,
    unpaired: 0,
    accountsSeen: [],
    heldForReview: 0,
    unsupportedPatterns: 0,
  };
}

function numberCell(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).trim();
  if (!text) return null;
  const normalized = text.replace(/[$\s]/g, "");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function replaySymbol(fileName: string): string | null {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = base.replace(/\.(?:csv|xlsx)$/i, "");
  const prefix = /^Replay_Trading_(.+)$/i.exec(stem);
  if (!prefix) return null;
  let chartSymbol = prefix[1];
  chartSymbol = chartSymbol.replace(/_\d{4}-\d{2}-\d{2}_[a-f0-9]{5,}$/i, "");
  const ticker = chartSymbol.split("_").pop() ?? "";
  const continuous = /^([A-Z]{1,5})1!$/i.exec(ticker);
  if (!continuous) return null;
  const symbol = continuous[1].toUpperCase();
  return knownFuturesSpec(symbol) ? symbol : null;
}

function parseLeg(row: ReplayRecord): ParsedLeg | null {
  const type = normalizedHeader(row.Type).replace(/\s+/g, " ");
  const match = /^(entry|exit) (long|short)$/.exec(type);
  if (!match) return null;
  return { row, phase: match[1] as "entry" | "exit", direction: match[2] as "long" | "short" };
}

function parseIssues(result: TradingViewReplayParseResult, status: string, reason?: string): void {
  const issues = result.timeIssues ?? EMPTY_ISSUES();
  if (status === "gap") issues.gap += 1;
  else if (status === "ambiguous") issues.ambiguous += 1;
  else if (status === "need-zone" && reason === "unknown-abbreviation") issues.unknownZone += 1;
  else if (status === "need-zone") issues.noZone += 1;
  result.timeIssues = issues;
}

function excelSerialToStamp(value: number, date1904: boolean): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const wholeDays = Math.floor(value);
  if (!date1904 && wholeDays === 60) return null; // Excel's fictitious 1900-02-29.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const correctedDays = !date1904 && wholeDays > 60 ? wholeDays - 1 : wholeDays;
  const instant = new Date(epoch + correctedDays * 86_400_000 + Math.round((value - wholeDays) * 86_400_000));
  if (!Number.isFinite(instant.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())} ${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())}:${pad(instant.getUTCSeconds())}`;
}

function recordsFromMatrix(matrix: unknown[][], date1904: boolean): { headers: string[]; rows: ReplayRecord[] } {
  const headers = (matrix[0] ?? []).map((value) => cellText(value).trim());
  const timeIndex = headers.findIndex((header) => normalizedHeader(header) === "date and time");
  const rows = matrix.slice(1).map((cells) => {
    const record: ReplayRecord = {};
    headers.forEach((header, index) => {
      let value = cells[index] ?? "";
      if (index === timeIndex && typeof value === "number") value = excelSerialToStamp(value, date1904) ?? "";
      record[header] = value;
    });
    return record;
  });
  return { headers, rows };
}

function parseReplayRecords(
  headers: readonly string[],
  rows: ReplayRecord[],
  fileName: string,
  zones: TradingViewReplayZones,
): TradingViewReplayParseResult {
  const headerSet = new Set(headers.map(normalizedHeader));
  const seenReplayHeaders = new Set<string>();
  for (const header of headers) {
    const normalized = normalizedHeader(header);
    if (!REPLAY_FIELD_NAMES.has(normalized)) continue;
    if (seenReplayHeaders.has(normalized)) {
      return emptyResult("This Replay ledger has duplicate required columns; no rows were imported.");
    }
    seenReplayHeaders.add(normalized);
  }
  if (!REPLAY_HEADERS.every((header) => headerSet.has(header))) {
    return emptyResult("This is not a supported TradingView Replay Trades ledger; required ledger columns are missing.");
  }
  const canonicalRows = rows.map((row) => {
    const canonical: ReplayRecord = {};
    for (const [header, value] of Object.entries(row)) {
      const field = REPLAY_FIELD_NAMES.get(normalizedHeader(header));
      if (field) canonical[field] = value;
    }
    return canonical;
  });
  const symbol = replaySymbol(fileName);
  const spec = symbol ? knownFuturesSpec(symbol) : null;
  if (!symbol || !spec) {
    return emptyResult("The Replay filename does not identify a supported continuous futures contract, so no symbol was guessed.");
  }

  const result = emptyResult();
  result.accountsSeen = [{ name: TRADINGVIEW_REPLAY_ACCOUNT, type: "demo" }];
  const groups = new Map<string, ReplayRecord[]>();
  for (const row of canonicalRows) {
    const tradeNumber = cellText(row["Trade number"]).trim();
    if (!tradeNumber) {
      result.skipped += 1;
      continue;
    }
    const group = groups.get(tradeNumber) ?? [];
    group.push(row);
    groups.set(tradeNumber, group);
  }

  const warnings = new Set<string>();
  for (const [tradeNumber, group] of groups) {
    if (group.length !== 2) {
      result.unsupportedPatterns += 1;
      continue;
    }
    const legs = group.map(parseLeg);
    if (legs.some((leg) => leg === null)) {
      result.unsupportedPatterns += 1;
      continue;
    }
    const [first, second] = legs as [ParsedLeg, ParsedLeg];
    const entry = first.phase === "entry" ? first : second.phase === "entry" ? second : null;
    const exit = first.phase === "exit" ? first : second.phase === "exit" ? second : null;
    if (!entry || !exit || entry.direction !== exit.direction) {
      result.unsupportedPatterns += 1;
      continue;
    }

    const entryPrice = numberCell(entry.row["Price USD"]);
    const exitPrice = numberCell(exit.row["Price USD"]);
    const entryQty = numberCell(entry.row["Size (qty)"]);
    const exitQty = numberCell(exit.row["Size (qty)"]);
    const quantity = entryQty === null ? null : Math.abs(entryQty);
    const exitQuantity = exitQty === null ? null : Math.abs(exitQty);
    if (entryPrice === null || exitPrice === null || quantity === null || exitQuantity === null || quantity <= 0 || Math.abs(quantity - exitQuantity) > 1e-9) {
      result.unsupportedPatterns += 1;
      continue;
    }

    const entryCommission = numberCell(entry.row["Commission USD"]);
    const exitCommission = numberCell(exit.row["Commission USD"]);
    if (entryCommission === null || exitCommission === null || entryCommission !== 0 || exitCommission !== 0) {
      result.heldForReview += 1;
      warnings.add("Replay trades with nonzero or unreadable commission are held out until their P&L treatment is verified.");
      continue;
    }

    const entryStamp = cellText(entry.row["Date and time"]).trim();
    const exitStamp = cellText(exit.row["Date and time"]).trim();
    const entryTime = parseInstant(entryStamp, { sourceZone: zones.sourceZone, journalZone: zones.journalZone });
    const exitTime = parseInstant(exitStamp, { sourceZone: zones.sourceZone, journalZone: zones.journalZone });
    for (const stamp of [entryTime, exitTime]) {
      if (stamp.status === "gap" || stamp.status === "ambiguous" || stamp.status === "need-zone") {
        parseIssues(result, stamp.status, stamp.status === "need-zone" ? stamp.reason : undefined);
      }
    }
    const unresolved = [entryTime, exitTime].some((stamp) => stamp.status === "need-zone" && stamp.reason === "no-source-zone");
    const canRetainWallClock = (stamp: typeof entryTime): boolean =>
      stamp.status === "ok" || (stamp.status === "need-zone" && stamp.reason === "no-source-zone");
    if (!canRetainWallClock(entryTime) || !canRetainWallClock(exitTime)) {
      if (entryTime.status === "invalid" || exitTime.status === "invalid") result.skipped += 1;
      continue;
    }
    if (!unresolved && entryTime.status === "ok" && exitTime.status === "ok" && exitTime.instant.getTime() <= entryTime.instant.getTime()) {
      result.unsupportedPatterns += 1;
      continue;
    }

    const direction = entry.direction;
    const sign = direction === "long" ? 1 : -1;
    const points = (exitPrice - entryPrice) * sign;
    const grossPnl = round2(points * spec.pointValue * quantity);
    const reportedNet = numberCell(exit.row["Net PnL USD"]);
    if (reportedNet === null || round2(reportedNet) !== grossPnl) {
      result.heldForReview += 1;
      warnings.add("Replay trades whose reported Net P&L does not match the journal's gross calculation are held for review.");
      continue;
    }

    const journalZone = zones.journalZone || zones.sourceZone;
    const entryCivil = unresolved
      ? { date: entryTime.date, time: entryTime.time }
      : zoneWallParts((entryTime as Extract<typeof entryTime, { status: "ok" }>).instant, journalZone);
    const exitCivil = unresolved
      ? { date: exitTime.date, time: exitTime.time }
      : zoneWallParts((exitTime as Extract<typeof exitTime, { status: "ok" }>).instant, journalZone);
    const identityParts = [symbol, tradeNumber, direction, quantity, entryStamp, exitStamp, entryPrice, exitPrice];
    const importKey = `replay:${identityParts.map((part) => encodeURIComponent(String(part))).join("|")}`;
    const idSuffix = tradeNumber.replace(/[^A-Za-z0-9_-]/g, "_");
    const idClock = `${entryTime.date}${entryTime.time}`.replace(/\D/g, "");
    const trade: Trade = {
      id: `replay_${symbol}_${idClock}_${idSuffix}`,
      type: "trade",
      origin: "replay",
      dataSource: "replay",
      date: entryCivil.date,
      ...(exitCivil.date !== entryCivil.date ? { exitDate: exitCivil.date } : {}),
      entryTime: entryCivil.time,
      exitTime: exitCivil.time,
      ...(entryTime.status === "ok" ? { entryInstant: entryTime.iso } : {}),
      ...(exitTime.status === "ok" ? { exitInstant: exitTime.iso } : {}),
      ...(!unresolved && entryTime.status === "ok" && exitTime.status === "ok"
        ? { instantSource: entryTime.source === exitTime.source ? entryTime.source : "mixed" }
        : {}),
      ...(!unresolved && zones.sourceZone ? { sourceZone: zones.sourceZone } : {}),
      ...(!unresolved && journalZone ? { timezone: journalZone } : {}),
      ...(unresolved ? { timeUnresolved: true } : {}),
      symbol,
      account: TRADINGVIEW_REPLAY_ACCOUNT,
      accountType: "demo",
      direction,
      quantity,
      entryPrice,
      exitPrice,
      commission: 0,
      fees: 0,
      pnl: grossPnl,
      pnlPoints: points,
      setup: "",
      mistake: "",
      thesis: "",
      review: "",
      screenshot: "",
      rating: 0,
      importKey,
    };
    result.trades.push(trade);
  }

  if (result.unsupportedPatterns) {
    warnings.add("Replay only imports complete one-entry/one-exit trades with matching direction and quantity; other trade groups were not guessed.");
  }
  if (result.skipped) warnings.add("Replay rows with missing trade numbers or invalid timestamps were left out.");
  if (result.heldForReview) warnings.add(`${result.heldForReview} Replay trade${result.heldForReview === 1 ? " was" : "s were"} held for review and will not be imported.`);
  result.warnings = [...warnings];
  return result;
}

export function isTradingViewReplayCsv(text: string): boolean {
  return csvKind(text) === "tradingview-replay";
}

export function parseTradingViewReplayCsv(
  text: string,
  fileName: string,
  zones: TradingViewReplayZones,
): TradingViewReplayParseResult {
  if (!isTradingViewReplayCsv(text)) {
    return emptyResult("This CSV does not have the supported TradingView Replay Trades ledger headers.");
  }
  const rows = parseCsv(text);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return parseReplayRecords(headers, rows, fileName, zones);
}

export function parseTradingViewReplayWorkbook(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  zones: TradingViewReplayZones,
): TradingViewReplayParseResult {
  try {
    const workbook = read(data, { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === "trades");
    if (!sheetName) return emptyResult("The workbook has no Trades sheet; summary sheets are ignored.");
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return emptyResult("The workbook Trades sheet could not be read.");
    const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    if (!matrix.length) return emptyResult("The workbook Trades sheet is empty.");
    const { headers, rows } = recordsFromMatrix(matrix, Boolean(workbook.Workbook?.WBProps?.date1904));
    return parseReplayRecords(headers, rows, fileName, zones);
  } catch {
    return emptyResult("The workbook could not be read as a supported TradingView Replay export.");
  }
}
