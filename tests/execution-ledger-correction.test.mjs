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
      contents: "export class App{}; export class TFile{}; export class TFolder{}; export const normalizePath=x=>x; export const setIcon=()=>{}; export const moment=()=>{};",
    }));
  } }],
});
const storage = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const file = { path: "Synthetic/Replay trade.md" };
const original = {
  id: file.path,
  type: "trade",
  date: "2026-11-06",
  exitDate: "2026-11-06",
  entryTime: "10:00:00",
  exitTime: "10:02:00",
  symbol: "MES",
  account: "Synthetic Replay",
  accountType: "demo",
  direction: "long",
  quantity: 4,
  entryPrice: 100,
  exitPrice: 101.5,
  pnl: 30,
  pnlPoints: 1.5,
  commission: 2,
  fees: 1,
  setup: "",
  mistake: "",
  review: "",
  thesis: "",
  screenshot: "",
  rating: 0,
  origin: "replay",
  dataSource: "replay",
  importKey: "replay:synthetic-stable-key",
  fills: [
    { side: "buy", date: "2026-11-06", time: "10:00:00", qty: 4, price: 100, orderType: "Limit", fillId: "entry-1" },
    { side: "sell", date: "2026-11-06", time: "10:01:00", qty: 2, price: 101, fees: 0.5, orderType: "Market", fillId: "exit-1" },
    { side: "sell", date: "2026-11-06", time: "10:02:00", qty: 2, price: 102, fees: 0.5, orderType: "Market", fillId: "exit-2" },
  ],
};

function appFor(content) {
  return {
    vault: {
      process: async (_file, transform) => { content.value = transform(content.value); },
    },
  };
}

test("execution fill metadata round-trips quotes and backslashes without changing values", () => {
  const orderType = 'Limit "resting" \\ staged';
  const fillId = 'synthetic "fill" \\ id';
  const text = storage.tradeToMarkdown({
    ...original,
    fills: [{ ...original.fills[0], orderType, fillId }],
  });
  const reopened = storage.parseTradeFromMarkdown(text);
  assert.equal(reopened.fills[0].orderType, orderType);
  assert.equal(reopened.fills[0].fillId, fillId);
});

test("execution fill civil dates round-trip through TradeBook notes", () => {
  const date = "2026-11-07";
  const text = storage.tradeToMarkdown({
    ...original,
    fills: [{ ...original.fills[0], date }],
  });
  const reopened = storage.parseTradeFromMarkdown(text);
  assert.equal(reopened.fills[0].date, date);
});

test("trade exit civil date round-trips through TradeBook notes", () => {
  const date = "2026-11-08";
  const text = storage.tradeToMarkdown({ ...original, exitDate: date });
  const reopened = storage.parseTradeFromMarkdown(text);
  assert.equal(reopened.exitDate, date);
});

test("execution edits round-trip per-fill civil dates, partial exits, aggregates, identity, provenance and note body", async () => {
  const content = { value: `${storage.tradeToMarkdown(original)}\nSynthetic note body stays intact.\n` };
  const updated = await storage.updateTradeExecutions(appFor(content), file, original, [
    { ...original.fills[0], date: "2026-11-07", time: "23:58:00", qty: 4, price: 100 },
    { ...original.fills[1], date: "2026-11-07", time: "23:59:00", qty: 1, price: 101 },
    { ...original.fills[2], date: "2026-11-08", time: "00:03:00", qty: 3, price: 102 },
  ]);
  const reopened = storage.parseTradeFromMarkdown(content.value);

  assert.equal(updated.fills.length, 3);
  assert.equal(reopened.fills.length, 3);
  assert.equal(reopened.quantity, 4);
  assert.equal(reopened.date, "2026-11-07");
  assert.equal(reopened.entryTime, "23:58:00");
  assert.equal(reopened.exitPrice, 101.75);
  assert.equal(reopened.exitTime, "00:03:00");
  assert.equal(reopened.exitDate, "2026-11-08");
  assert.equal(reopened.pnl, 35);
  assert.equal(reopened.pnlPoints, 1.75);
  assert.equal(reopened.commission, 2);
  assert.equal(reopened.fees, 1);
  assert.equal(reopened.importKey, original.importKey);
  assert.equal(reopened.origin, "replay");
  assert.equal(reopened.dataSource, "replay");
  assert.equal(reopened.fills[0].fillId, "entry-1");
  assert.equal(reopened.fills[1].fillId, "exit-1");
  assert.equal(reopened.fills[1].fees, 0.5);
  assert.equal(reopened.fills[1].orderType, "Market");
  assert.equal(reopened.fills[2].instant, undefined, "unknown timezone must not create an absolute instant");
  assert.equal(reopened.executionCorrection.original.fills.length, 3);
  assert.equal(reopened.executionCorrection.original.fills[2].qty, 2);
  assert.ok(reopened.executionCorrection.correctedAt);
  assert.match(content.value, /Synthetic note body stays intact\./);
});

test("correcting unresolved Replay executions pins them in the selected Journal timezone", async () => {
  const unresolved = {
    ...original,
    timezone: undefined,
    sourceZone: undefined,
    instantSource: undefined,
    timeUnresolved: true,
    entryInstant: undefined,
    exitInstant: undefined,
    fills: original.fills.map(({ instant: _instant, ...fill }) => fill),
  };
  const content = { value: `${storage.tradeToMarkdown(unresolved)}\nSynthetic note body stays intact.\n` };
  const updated = await storage.updateTradeExecutions(appFor(content), file, unresolved, [
    { ...unresolved.fills[0], date: "2026-11-06", time: "11:00:00", qty: 4, price: 100 },
    { ...unresolved.fills[1], date: "2026-11-06", time: "11:01:00", qty: 2, price: 101 },
    { ...unresolved.fills[2], date: "2026-11-06", time: "11:02:00", qty: 2, price: 102 },
  ], "America/New_York");
  const reopened = storage.parseTradeFromMarkdown(content.value);

  assert.equal(updated.timeUnresolved, undefined);
  assert.equal(reopened.timeUnresolved, undefined);
  assert.equal(reopened.timezone, "America/New_York");
  assert.equal(reopened.instantSource, "journal-zone");
  assert.equal(reopened.entryInstant, "2026-11-06T16:00:00.000Z");
  assert.equal(reopened.exitInstant, "2026-11-06T16:02:00.000Z");
  assert.equal(reopened.fills.every((fill) => !!fill.instant), true);
  assert.match(content.value, /Synthetic note body stays intact\./);
});

test("execution edits preserve unresolved wall clocks and allow an actual partial close", async () => {
  const open = {
    ...original,
    dataSource: "broker",
    origin: "broker",
    exitDate: undefined,
    exitTime: "",
    exitPrice: 0,
    pnl: Number.NaN,
    pnlPoints: Number.NaN,
    importKey: "broker:stable",
    fills: [{ ...original.fills[0], fillId: "entry-broker" }],
  };
  const content = { value: storage.tradeToMarkdown(open) };
  const updated = await storage.updateTradeExecutions(appFor(content), file, open, [
    { ...open.fills[0], date: "2026-11-06", time: "10:00:00", qty: 4, price: 100 },
    { side: "sell", date: "2026-11-06", time: "10:01:00", qty: 2, price: 101 },
  ]);
  const reopened = storage.parseTradeFromMarkdown(content.value);
  assert.equal(updated.quantity, 4);
  assert.equal(reopened.fills.length, 2);
  assert.equal(reopened.exitPrice, 101);
  assert.equal(reopened.openQty, undefined);
  assert.equal(reopened.pnl, 10);
  assert.equal(reopened.importKey, "broker:stable");
  assert.equal(reopened.fills[1].instant, undefined);
});

test("stale edits and reconstructed model legs reject without changing the note", async () => {
  const latest = {
    ...original,
    entryPrice: 100.25,
    fills: original.fills.map((fill, index) => index === 0 ? { ...fill, price: 100.25 } : fill),
  };
  const content = { value: storage.tradeToMarkdown(latest) };
  const before = content.value;
  await assert.rejects(
    () => storage.updateTradeExecutions(appFor(content), file, original, original.fills),
    /changed|reopen/i,
  );
  assert.equal(content.value, before);

  const reconstructed = { ...original, dataSource: "reconstructed", origin: undefined, importKey: undefined };
  content.value = storage.tradeToMarkdown(reconstructed);
  const modelBefore = content.value;
  await assert.rejects(
    () => storage.updateTradeExecutions(appFor(content), file, reconstructed, reconstructed.fills),
    /reconstructed|actual/i,
  );
  assert.equal(content.value, modelBefore);
});

test("zone-less timestamp reorder recomputes per-exit FIFO realized P&L", async () => {
  const fifoTrade = {
    ...original,
    quantity: 2,
    entryPrice: 105,
    exitPrice: 112.5,
    pnl: 75,
    pnlPoints: 7.5,
    exitDate: "2026-11-06",
    fills: [
      { side: "buy", date: "2026-11-06", time: "10:00:00", qty: 1, price: 100, fillId: "entry-low" },
      { side: "buy", date: "2026-11-06", time: "10:01:00", qty: 1, price: 110, fillId: "entry-high" },
      { side: "sell", date: "2026-11-06", time: "10:02:00", qty: 1, price: 105, pnl: 25, fillId: "exit-low" },
      { side: "sell", date: "2026-11-06", time: "10:03:00", qty: 1, price: 120, pnl: 50, fillId: "exit-high" },
    ],
  };
  const content = { value: storage.tradeToMarkdown(fifoTrade) };
  await storage.updateTradeExecutions(appFor(content), file, fifoTrade, fifoTrade.fills.map((fill) => ({
    ...fill,
    time: fill.fillId === "exit-low" ? "10:04:00" : fill.fillId === "exit-high" ? "10:03:00" : fill.time,
  })));
  const reopened = storage.parseTradeFromMarkdown(content.value);
  const byId = new Map(reopened.fills.map((fill) => [fill.fillId, fill]));

  assert.equal(byId.get("exit-high").pnl, 100, "the earlier exit closes the first FIFO entry");
  assert.equal(byId.get("exit-low").pnl, -25, "the later exit closes the remaining FIFO entry");
  assert.equal(reopened.pnl, 75, "total gross P&L remains reconciled");
});

test("correcting imported execution sides preserves source identity and recomputes trade direction and P&L", async () => {
  const content = { value: `${storage.tradeToMarkdown(original)}\nSynthetic note body stays intact.\n` };
  const proposed = original.fills.map((fill, originalIndex) => ({
    originalIndex,
    fill: { ...fill, side: fill.side === "buy" ? "sell" : "buy" },
  }));
  const updated = await storage.updateTradeExecutions(appFor(content), file, original, proposed);
  const reopened = storage.parseTradeFromMarkdown(content.value);

  assert.equal(reopened.direction, "short");
  assert.equal(reopened.pnl, -30);
  assert.deepEqual(reopened.fills.map((fill) => fill.fillId), ["entry-1", "exit-1", "exit-2"]);
  assert.equal(reopened.fills[1].pnl, -10);
  assert.equal(reopened.fills[2].pnl, -20);
  assert.equal(reopened.executionCorrection.original.direction, "long");
  assert.equal(updated.executionCorrection.original.fills[0].side, "buy");
  assert.match(content.value, /Synthetic note body stays intact\./);
});
