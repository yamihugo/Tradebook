import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const built = await build({
  entryPoints: [new URL("../src/csv.ts", import.meta.url).pathname],
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
const csv = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

const header = "Trade number,Type,Date and time,Signal,Price USD,Size (qty),Net PnL USD,Commission USD";

test("csvKind recognizes only a complete TradingView Replay Trades header", () => {
  assert.equal(csv.csvKind(header), "tradingview-replay");
  assert.equal(csv.csvKind(header.replace(",Commission USD", "")), "unknown");
  assert.equal(csv.csvKind("Trade number,Type,Date and time,Price USD"), "unknown");
});
