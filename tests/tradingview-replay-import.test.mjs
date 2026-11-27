import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build, buildSync } from "esbuild";
import * as XLSX from "xlsx";

const repo = path.resolve(import.meta.dirname, "..");
const scratch = process.env.TMPDIR || path.join(os.homedir(), ".hermes", "cache", "scratch");
const dir = fs.mkdtempSync(path.join(scratch, "tradebook-replay-test-"));
const bundlePath = path.join(dir, "replay-import.cjs");
const bundle = buildSync({
  entryPoints: [path.join(repo, "src/lib/tradingViewReplay.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundlePath,
});
assert.equal(bundle.errors.length, 0);
const { parseTradingViewReplayCsv, isTradingViewReplayCsv } = createRequire(bundlePath)(bundlePath);
const identityBundlePath = path.join(dir, "import-identity.cjs");
buildSync({
  entryPoints: [path.join(repo, "src/lib/importIdentity.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: identityBundlePath,
});
const { importIdentities } = createRequire(identityBundlePath)(identityBundlePath);
const storageBundlePath = path.join(dir, "storage.cjs");
await build({
  entryPoints: [path.join(repo, "src/storage.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: storageBundlePath,
  plugins: [{ name: "obsidian-storage-types", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({
      contents: "export class App {} export class TFile {} export const normalizePath = value => value; export const setIcon = () => {};",
    }));
  } }],
});
const { tradeToMarkdown, parseTradeFromMarkdown } = createRequire(storageBundlePath)(storageBundlePath);

const headers = [
  "Trade number",
  "Type",
  "Date and time",
  "Signal",
  "Price USD",
  "Size (qty)",
  "Net PnL USD",
  "Commission USD",
];

function row(tradeNo, type, time, price, qty, netPnl, commission = "0") {
  return [tradeNo, type, time, type, price, qty, netPnl, commission];
}

function csv(rows) {
  return [headers, ...rows].map((cells) => cells.map((cell) => {
    const text = String(cell ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\n");
}

const sourceName = "Replay_Trading_CME_MINI_ES1!_2026-11-12_d3cea.csv";
const zones = { sourceZone: "America/Chicago", journalZone: "UTC" };

test("recognizes the Replay dialect and imports one complete trade with provenance", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);

  assert.equal(isTradingViewReplayCsv(text), true);
  const parsed = parseTradingViewReplayCsv(text, sourceName, zones);
  assert.equal(parsed.trades.length, 1);
  const [trade] = parsed.trades;
  assert.equal(trade.symbol, "ES");
  assert.equal(trade.direction, "long");
  assert.equal(trade.quantity, 1);
  assert.equal(trade.entryPrice, 5000);
  assert.equal(trade.exitPrice, 5001);
  assert.equal(trade.pnl, 50);
  assert.equal(trade.pnlPoints, 1);
  assert.equal(trade.account, "TradingView Replay");
  assert.equal(trade.accountType, "demo");
  assert.equal(trade.origin, "replay");
  assert.equal(trade.dataSource, "replay");
  assert.equal(trade.commission, 0);
  assert.equal(trade.fees, 0);
  assert.equal(trade.fills, undefined);
  assert.equal(trade.sourceZone, zones.sourceZone);
  assert.equal(trade.timezone, zones.journalZone);
  assert.equal(trade.entryTime, "15:30:00");
  assert.equal(trade.entryInstant, "2026-11-12T15:30:00.000Z");
  assert.equal(parsed.heldForReview, 0);
});

test("parses case-insensitive Replay ledger headers after recognition", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);
  const [header, ...records] = text.split("\n");
  const lowerCaseText = [header.toLowerCase(), ...records].join("\n");

  assert.equal(isTradingViewReplayCsv(lowerCaseText), true);
  const parsed = parseTradingViewReplayCsv(lowerCaseText, sourceName, zones);
  assert.equal(parsed.trades.length, 1);
  assert.equal(parsed.skipped, 0);
});

test("holds nonzero-commission groups and counts unsupported entry/exit shapes", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
    row(2, "Entry short", "2026-11-12 09:32:00", "5002", "1", "0"),
    row(2, "Exit short", "2026-11-12 09:33:00", "5001", "1", "50", "2.50"),
    row(3, "Entry long", "2026-11-12 09:34:00", "5000", "1", "0"),
    row(4, "Entry short", "2026-11-12 09:35:00", "5001", "1", "0"),
    row(4, "Entry short", "2026-11-12 09:35:30", "5001.25", "1", "0"),
    row(4, "Exit short", "2026-11-12 09:36:00", "5000", "2", "100"),
  ]);

  const parsed = parseTradingViewReplayCsv(text, sourceName, zones);
  assert.equal(parsed.trades.length, 1);
  assert.equal(parsed.heldForReview, 1);
  assert.equal(parsed.unsupportedPatterns, 2);
  assert.ok(parsed.warnings.some((warning) => /commission/i.test(warning)));
});

test("interprets Replay wall clocks in the journal timezone when the file has no timezone", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);

  const parsed = parseTradingViewReplayCsv(text, sourceName, { sourceZone: "", journalZone: "America/New_York" });
  assert.equal(parsed.trades.length, 1);
  const [trade] = parsed.trades;
  assert.equal(trade.timeUnresolved, undefined);
  assert.equal(trade.date, "2026-11-12");
  assert.equal(trade.entryTime, "09:30:00");
  assert.equal(trade.exitTime, "09:31:00");
  assert.equal(trade.entryInstant, "2026-11-12T14:30:00.000Z");
  assert.equal(trade.exitInstant, "2026-11-12T14:31:00.000Z");
  assert.equal(trade.timezone, "America/New_York");
  assert.equal(trade.instantSource, "journal-zone");
  assert.equal(trade.sourceZone, undefined);
  assert.equal(trade.pnl, 50);
  assert.equal(parsed.timeIssues?.noZone ?? 0, 0);
});

test("retains Replay wall clocks unresolved only when neither source nor journal timezone exists", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);

  const parsed = parseTradingViewReplayCsv(text, sourceName, { sourceZone: "", journalZone: "" });
  const [trade] = parsed.trades;
  assert.equal(trade.timeUnresolved, true);
  assert.equal(trade.date, "2026-11-12");
  assert.equal(trade.entryTime, "09:30:00");
  assert.equal(trade.exitTime, "09:31:00");
  assert.equal(trade.entryInstant, undefined);
  assert.equal(trade.exitInstant, undefined);
  assert.equal(trade.timezone, undefined);
  assert.equal(trade.sourceZone, undefined);
  assert.equal(parsed.timeIssues.noZone, 2);
});

test("rejects Replay-looking files without the required ledger headers", () => {
  assert.equal(isTradingViewReplayCsv("Trade number,Type,Date and time\n1,Entry long,2026-11-12 09:30:00"), false);
});

test("reads only the Trades worksheet and converts Excel date serials", () => {
  const headers = [
    "Trade number", "Type", "Date and time", "Signal", "Price USD", "Size (qty)", "Net PnL USD", "Commission USD",
  ];
  const serial = (Date.UTC(2026, 10, 12, 9, 30) - Date.UTC(1899, 11, 31)) / 86_400_000 + 1;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["summary data must not be imported"], ["not a ledger"]]), "Performance");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    headers,
    [1, "Entry long", serial, "entry", 5000, 1, 0, 0],
    [1, "Exit long", serial + 60 / 86_400, "exit", 5001, 1, 50, 0],
  ]), "Trades");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const parsed = createRequire(bundlePath)(bundlePath).parseTradingViewReplayWorkbook(bytes, sourceName.replace(/\.csv$/, ".xlsx"), zones);
  assert.equal(parsed.trades.length, 1);
  assert.equal(parsed.trades[0].entryInstant, "2026-11-12T15:30:00.000Z");
  assert.equal(parsed.trades[0].exitInstant, "2026-11-12T15:31:00.000Z");
  assert.equal(parsed.trades[0].importKey, parseTradingViewReplayCsv(csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]), sourceName, zones).trades[0].importKey);
});

test("does not fall back to a summary sheet when Trades is absent", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, row(1, "Entry long", "2026-11-12 09:30:00", 5000, 1, 0)]), "Performance");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = createRequire(bundlePath)(bundlePath).parseTradingViewReplayWorkbook(bytes, sourceName.replace(/\.csv$/, ".xlsx"), zones);
  assert.equal(parsed.trades.length, 0);
  assert.match(parsed.warnings.join(" "), /no Trades sheet/i);
});

test("namespaces Replay dedup by source and mapped account", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);
  const replay = parseTradingViewReplayCsv(text, sourceName, zones).trades[0];
  const broker = { ...replay, origin: "broker", dataSource: "broker", importKey: "broker:fill-1" };
  const replayIds = importIdentities(replay, () => "demo-account-a");
  const storedReplayIds = importIdentities({ ...replay, importKey: replayIds[0] }, () => "demo-account-a");
  const brokerIds = importIdentities(broker, () => "demo-account-a");
  const otherAccountIds = importIdentities(replay, () => "demo-account-b");

  assert.equal(replayIds.length, 1);
  assert.deepEqual(storedReplayIds, replayIds);
  assert.equal(replayIds.some((id) => brokerIds.includes(id)), false);
  assert.equal(replayIds.some((id) => otherAccountIds.includes(id)), false);
});

test("persists Replay provenance and demo classification through trade-note serialization", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);
  const trade = parseTradingViewReplayCsv(text, sourceName, zones).trades[0];
  const roundTrip = parseTradeFromMarkdown(tradeToMarkdown(trade));

  assert.equal(roundTrip.origin, "replay");
  assert.equal(roundTrip.dataSource, "replay");
  assert.equal(roundTrip.accountType, "demo");
  assert.equal(roundTrip.importKey, trade.importKey);
});

test("persists journal-zone resolution for timezone-less Replay trades", () => {
  const text = csv([
    row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"),
    row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50"),
  ]);
  const trade = parseTradingViewReplayCsv(text, sourceName, { sourceZone: "", journalZone: "America/New_York" }).trades[0];
  const markdown = tradeToMarkdown(trade);
  const roundTrip = parseTradeFromMarkdown(markdown);

  assert.doesNotMatch(markdown, /^time_unresolved: true$/m);
  assert.match(markdown, /^timezone: "America\/New_York"$/m);
  assert.match(markdown, /^instant_source: "journal-zone"$/m);
  assert.equal(roundTrip.timeUnresolved, undefined);
  assert.equal(roundTrip.date, "2026-11-12");
  assert.equal(roundTrip.entryTime, "09:30:00");
  assert.equal(roundTrip.exitTime, "09:31:00");
  assert.equal(roundTrip.entryInstant, "2026-11-12T14:30:00.000Z");
  assert.equal(roundTrip.exitInstant, "2026-11-12T14:31:00.000Z");
  assert.equal(roundTrip.timezone, "America/New_York");
  assert.equal(roundTrip.instantSource, "journal-zone");
  assert.equal(roundTrip.pnl, 50);
});


test("actual serialized Replay note passes exact path and facts confirmation", () => {
  const reportPath = path.join(dir, "report.cjs");
  buildSync({entryPoints:[path.join(repo,"src/lib/importReport.ts")],bundle:true,platform:"node",format:"cjs",outfile:reportPath});
  const { confirmReplayWrites } = createRequire(reportPath)(reportPath);
  const text = csv([row(1, "Entry long", "2026-11-12 09:30:00", "5000", "1", "0"), row(1, "Exit long", "2026-11-12 09:31:00", "5001", "1", "50")]);
  const trade = parseTradingViewReplayCsv(text, sourceName, zones).trades[0];
  const parsed = {...parseTradeFromMarkdown(tradeToMarkdown(trade)), id:"new.md"};
  assert.equal(confirmReplayWrites([trade],["new.md"],[parsed]),1);
});
