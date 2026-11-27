import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const built = await build({
  entryPoints: [new URL("../src/storage.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{ name: "isolated-obsidian-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({
      contents: "export class App{}; export class TFile { constructor(path, content) { this.path = path; this.content = content; } }; globalThis.__TradeBookTestTFile = TFile; export class TFolder{}; export const normalizePath=x=>x; export const setIcon=()=>{}; export const moment=()=>{};",
    }));
  } }],
});
const storage = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

const trade = {
  id: "synthetic-replay-1",
  type: "trade",
  origin: "replay",
  dataSource: "replay",
  importKey: "replay:synthetic-1",
  date: "2026-11-06",
  entryTime: "09:30:00",
  exitTime: "09:31:00",
  symbol: "ES",
  account: "Synthetic Replay",
  accountType: "demo",
  direction: "long",
  quantity: 1,
  entryPrice: 5000,
  exitPrice: 5001,
  pnl: 50,
  pnlPoints: 1,
  commission: 0,
  fees: 0,
  costCoverage: { commission: true, fees: true },
  setup: "",
  mistake: "",
  thesis: "",
  review: "",
  screenshot: "Prints/synthetic-entry.png",
  screenshots: [{ file: "Prints/synthetic-entry.png", note: "Synthetic image remains linked" }],
};

function appFor(mode = "success") {
  const files = new Map();
  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const image = { path: "Prints/synthetic-entry.png", content: imageBytes };
  files.set(image.path, image);
  const app = {
    vault: {
      getAbstractFileByPath(path) { return files.get(path) ?? null; },
      async createFolder(path) { files.set(path, { path, folder: true }); },
      async create(path, content) {
        if (mode === "reject-before-write") throw new Error("synthetic create rejection before persistence");
        const file = new globalThis.__TradeBookTestTFile(path, content);
        files.set(path, file);
        if (mode === "write-then-reject") throw new Error("synthetic create rejection after persistence");
        return file;
      },
      async read(file) { return file.content; },
    },
  };
  return { app, files, imageBytes };
}

test("saveTrade reports the exact path only after the note is persisted", async () => {
  const { app, files, imageBytes } = appFor();
  const paths = [];
  const expectedPath = `${storage.tradeMonthPath("Trades", trade.date)}/${storage.tradeFilename(trade)}.md`;

  const saved = await storage.saveTrade(app, "Trades", trade, undefined, (path) => paths.push(path));

  assert.equal(saved, true);
  assert.deepEqual(paths, [expectedPath]);
  const written = storage.parseTradeFromMarkdown(files.get(expectedPath).content);
  assert.equal(written.importKey, trade.importKey);
  assert.deepEqual(written.screenshots, trade.screenshots);
  assert.deepEqual(files.get("Prints/synthetic-entry.png").content, imageBytes);
});

test("saveTrade confirms a note when create rejects after persisting its exact content", async () => {
  const { app, files, imageBytes } = appFor("write-then-reject");
  const paths = [];
  const expectedPath = `${storage.tradeMonthPath("Trades", trade.date)}/${storage.tradeFilename(trade)}.md`;

  const saved = await storage.saveTrade(app, "Trades", trade, undefined, (path) => paths.push(path));

  assert.equal(saved, true);
  assert.deepEqual(paths, [expectedPath]);
  const written = storage.parseTradeFromMarkdown(files.get(expectedPath).content);
  assert.equal(written.importKey, trade.importKey);
  assert.deepEqual(written.screenshots, trade.screenshots);
  assert.deepEqual(files.get("Prints/synthetic-entry.png").content, imageBytes);
});
