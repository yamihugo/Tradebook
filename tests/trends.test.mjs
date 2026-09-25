import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/lib/trends.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: "export const App = class {}; export const TFile = class {}; export const normalizePath = (p) => p; export const setIcon = () => {};",
        loader: "js",
      }));
    },
  }],
});
const trends = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const trade = (overrides = {}) => ({
  id: "trade",
  date: "2026-09-01",
  entryTime: "09:00",
  exitTime: "09:30",
  symbol: "NQ",
  account: "Leader",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  stopLoss: 19990,
  pnl: 200,
  commission: 0,
  fees: 0,
  ...overrides,
});

const row = (result, id) => result.rows.find((item) => item.id === id);

test("copied decision counts once while all account legs contribute net finance", () => {
  const input = [
    trade({ id: "older", date: "2026-08-31", pnl: -10 }),
    trade({ id: "base", pnl: 200, copyBaseKey: undefined }),
    trade({ id: "leg", account: "Copier", isCopiedTrade: true, copyBaseKey: "base", pnl: 100, commission: 5, fees: 5 }),
  ];
  const result = trends.computeTrends(input, { window: 1, minSample: 1 });
  assert.equal(result.nAfter, 1);
  assert.equal(row(result, "expectancy").after, 290);
  assert.equal(row(result, "profitFactor").after, Infinity);
});

test("expectancy and profit factor use net decision results; win sign remains gross", () => {
  const result = trends.computeTrends([
    trade({ id: "old-a", date: "2026-09-01", pnl: 100 }),
    trade({ id: "old-b", date: "2026-09-02", pnl: -100 }),
    trade({ id: "a", date: "2026-09-03", pnl: -50 }),
    trade({ id: "b", date: "2026-09-04", pnl: 200, commission: 125 }),
  ], { window: 2, minSample: 1 });
  assert.equal(row(result, "expectancy").after, 12.5);
  assert.equal(row(result, "profitFactor").after, 1.5);
  assert.equal(row(result, "winRate").after, 50);
});

test("R remains Gross P&L divided by registered dollar risk and excludes incomplete risk data", () => {
  const complete = trade({ id: "a", pnl: 200 });
  const noQty = trade({ id: "b", date: "2026-09-02", quantity: undefined });
  const wrongSideStop = trade({ id: "c", date: "2026-09-03", stopLoss: 20001 });
  const latest = trade({ id: "d", date: "2026-09-04", pnl: 100 });
  const result = trends.computeTrends([complete, noQty, wrongSideStop, latest], { window: 2, minSample: 1 });
  assert.equal(result.coverage.find((item) => item.metric === "r").have, 2);
  assert.equal(row(result, "r").after, 0.5);
});

test("missing and malformed times are not treated as midnight or valid holds", () => {
  const result = trends.computeTrends([
    trade({ id: "a", entryTime: "bad", exitTime: "10:00" }),
    trade({ id: "b", date: "2026-09-02", entryTime: "23:50", exitTime: "00:10" }),
  ], { window: 1, minSample: 1 });
  assert.equal(result.coverage.find((item) => item.metric === "hold").have, 1);
  assert.equal(row(result, "hold").after, 20);
});

test("quick re-entry is reported as a signal, including overnight, and missing times do not signal", () => {
  const afterLoss = trade({ id: "loss", date: "2026-09-01", entryTime: "23:30", exitTime: "23:50", pnl: -100 });
  const reentry = trade({ id: "next", date: "2026-09-02", entryTime: "00:00", exitTime: "00:10", pnl: 20 });
  const result = trends.computeTrends([
    trade({ id: "old1", date: "2026-08-30" }),
    trade({ id: "old2", date: "2026-08-31" }),
    afterLoss,
    reentry,
  ], { window: 2, minSample: 1 });
  assert.equal(row(result, "revengeRate").after, 50);
  assert.equal(row(result, "revengeRate").label, "Quick re-entry after loss");
  const missing = trends.computeTrends([
    trade({ id: "old1", date: "2026-08-30" }),
    trade({ id: "old2", date: "2026-08-31" }),
    afterLoss,
    trade({ id: "missing", date: "2026-09-02", entryTime: "", exitTime: "", pnl: 10 }),
  ], { window: 2, minSample: 1 });
  assert.equal(row(missing, "revengeRate").after, 0);
});

test("comparison sides contain equal decision counts and honor minimum sample", () => {
  const trades = [
    ...Array.from({ length: 5 }, (_, index) => trade({ id: `t${index}`, date: `2026-09-0${index + 1}`, pnl: index + 1 })),
    trade({ id: "open-or-invalid", date: "2026-09-06", quantity: 0 }),
  ];
  const result = trends.computeTrends(trades, { window: 2, minSample: 2 });
  assert.equal(result.nBefore, 2);
  assert.equal(result.nAfter, 2);
  assert.equal(result.enough, true);
  assert.equal(result.coverage.find((item) => item.metric === "r").total, 5);
});
