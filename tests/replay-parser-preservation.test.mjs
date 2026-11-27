import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const built = await build({
  entryPoints: [new URL("../src/lib/tradingViewReplay.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{ name: "isolated-obsidian-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({
      contents: "export class App{}; export class TFile{}; export class TFolder{}; export const normalizePath=x=>x; export const setIcon=()=>{}; export const moment=()=>{};",
    }));
  } }],
});
const replay = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

const fileName = "Replay_Trading_CME_MINI_ES1!_2026-11-06_abc123.csv";
const header = "Trade number,Type,Date and time,Signal,Price USD,Size (qty),Net PnL USD,Commission USD";
const validCsv = [
  header,
  "1,Entry long,2026-11-06 09:30:00,Entry long,5000,1,0,0",
  "1,Exit long,2026-11-06 09:31:00,Exit long,5001,1,50,0",
].join("\n");

test("Replay CSV produces a provenance-tagged trade from a supported continuous contract", () => {
  const result = replay.parseTradingViewReplayCsv(validCsv, fileName, { sourceZone: "UTC", journalZone: "UTC" });

  assert.equal(result.trades.length, 1);
  assert.equal(result.accountsSeen[0]?.name, "TradingView Replay");
  const [trade] = result.trades;
  assert.equal(trade.symbol, "ES");
  assert.equal(trade.direction, "long");
  assert.equal(trade.entryPrice, 5000);
  assert.equal(trade.exitPrice, 5001);
  assert.equal(trade.pnl, 50);
  assert.equal(trade.pnlPoints, 1);
  assert.equal(trade.origin, "replay");
  assert.equal(trade.dataSource, "replay");
  assert.equal(trade.timeUnresolved, undefined);
  assert.ok(Number.isFinite(Date.parse(trade.entryInstant ?? "")));
});

test("Replay CSV keeps timezone-less wall time unresolved and holds mismatched net P&L", () => {
  const unresolved = replay.parseTradingViewReplayCsv(validCsv, fileName, { sourceZone: "", journalZone: "" });
  assert.equal(unresolved.trades.length, 1);
  assert.equal(unresolved.trades[0]?.timeUnresolved, true);
  assert.equal(unresolved.trades[0]?.entryInstant, undefined);
  assert.equal(unresolved.trades[0]?.entryTime, "09:30:00");

  const mismatchCsv = validCsv.replace("5001,1,50,0", "5001,1,49,0");
  const mismatch = replay.parseTradingViewReplayCsv(mismatchCsv, fileName, { sourceZone: "UTC", journalZone: "UTC" });
  assert.equal(mismatch.heldForReview, 1);
  assert.equal(mismatch.trades.length, 0);
});

test("Replay CSV uses the configured Journal timezone when no source zone is selected", () => {
  const result = replay.parseTradingViewReplayCsv(validCsv, fileName, { sourceZone: "", journalZone: "UTC" });
  const [trade] = result.trades;

  assert.equal(result.trades.length, 1);
  assert.equal(trade?.timeUnresolved, undefined);
  assert.equal(trade?.timezone, "UTC");
  assert.equal(trade?.instantSource, "journal-zone");
  assert.equal(trade?.entryInstant, "2026-11-06T09:30:00.000Z");
});
