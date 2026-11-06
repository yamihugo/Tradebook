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

test("expectancy, profit factor and win rate all classify by Net decision results", () => {
  const result = trends.computeTrends([
    trade({ id: "old-a", date: "2026-09-01", pnl: 100 }),
    trade({ id: "old-b", date: "2026-09-02", pnl: -100 }),
    trade({ id: "a", date: "2026-09-03", pnl: -50 }),
    trade({ id: "b", date: "2026-09-04", pnl: 200, commission: 125 }),
  ], { window: 2, minSample: 1 });
  assert.equal(row(result, "expectancy").after, 12.5);
  assert.equal(row(result, "profitFactor").after, 1.5);
  assert.equal(row(result, "winRate").after, 50, "200 - 125 = 75 Net: still a win");
});

test("win rate counts a Gross win that loses after costs as a loss", () => {
  const result = trends.computeTrends([
    trade({ id: "old-a", date: "2026-09-01", pnl: 100 }),
    trade({ id: "old-b", date: "2026-09-02", pnl: -100 }),
    trade({ id: "a", date: "2026-09-03", pnl: -50 }),
    trade({ id: "b", date: "2026-09-04", pnl: 1, commission: 5 }),
  ], { window: 2, minSample: 1 });
  // The Gross sign would read 50% (one win of two); Net reads 0%.
  assert.equal(row(result, "winRate").after, 0);
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

test("reliability is deterministic and flags a strong signal as real, a flat split as noise", () => {
  const losing = Array.from({ length: 20 }, (_, i) => trade({ id: `l${i}`, date: `2026-08-${String(i + 1).padStart(2, "0")}`, pnl: -100 }));
  const winning = Array.from({ length: 20 }, (_, i) => trade({ id: `w${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}`, pnl: 100 }));
  const strong = trends.computeTrends([...losing, ...winning], { window: 20, minSample: 10 });
  const winRate = row(strong, "winRate");
  assert.equal(winRate.reliability, "real", "0% -> 100% win rate cannot be chance");
  assert.ok(winRate.p !== null && winRate.p <= 0.05);

  // Same call twice: seeded, so the p-value never flickers between renders.
  const again = trends.computeTrends([...losing, ...winning], { window: 20, minSample: 10 });
  assert.equal(row(again, "winRate").p, winRate.p);

  const flat = trends.computeTrends(
    Array.from({ length: 40 }, (_, i) => trade({ id: `f${i}`, date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`, pnl: i % 2 === 0 ? 100 : -100 })),
    { window: 20, minSample: 10 },
  );
  assert.equal(row(flat, "winRate").reliability, "noise", "an alternating book is chance");
});

test("reliability is null when a metric has no finite delta", () => {
  const input = [
    ...Array.from({ length: 20 }, (_, i) => trade({ id: `x${i}`, date: `2026-08-${String(i + 1).padStart(2, "0")}`, pnl: 100 })),
    ...Array.from({ length: 20 }, (_, i) => trade({ id: `y${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}`, pnl: 50 })),
  ];
  // No losing decision on either side -> profit factor is Infinity -> null delta.
  assert.equal(row(trends.computeTrends(input, { window: 20, minSample: 10 }), "profitFactor").reliability, null);
});

test("the engine keeps 7 core rows and measures the wider candidate set", () => {
  const input = [
    ...Array.from({ length: 20 }, (_, i) => trade({ id: `l${i}`, date: `2026-08-${String(i + 1).padStart(2, "0")}`, pnl: -100 })),
    ...Array.from({ length: 20 }, (_, i) => trade({ id: `w${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}`, pnl: i % 3 === 0 ? 50 : 300 })),
  ];
  const out = trends.computeTrends(input, { window: 20, minSample: 10 });
  assert.equal(out.rows.length, 7, "the table stays the seven core metrics");
  assert.equal(out.moves.length, 11, "the candidate set has eleven metrics");
  for (const id of ["avgWin", "avgLoss", "runnerRate", "greenDays"]) {
    assert.ok(out.moves.some((m) => m.id === id), `candidate ${id} is measured`);
  }
  const win = out.moves.find((m) => m.id === "winRate");
  assert.ok(win.before !== null && win.after !== null);
});

test("rankTrendMoves: one per family, noise excluded, direction respected", () => {
  const mover = (over = {}) => ({
    id: "x", label: "X", unit: "percent", betterWhen: "up", family: "payoff", core: false,
    before: 0, after: 1, delta: 1, p: 0.01, reliability: "real", ...over,
  });
  const { gains, declines } = trends.rankTrendMoves([
    mover({ id: "pf", family: "payoff", p: 0.01 }),
    mover({ id: "runner", family: "payoff", p: 0.02 }),          // same family -> dropped
    mover({ id: "risk", family: "risk", p: 0.03 }),
    mover({ id: "noise", family: "hit", p: 0.5, reliability: "noise" }), // never listed
    mover({ id: "flat", family: "timing", betterWhen: null, reliability: null }),
    mover({ id: "loss", family: "process", betterWhen: "down", delta: -2, before: 2, after: 0, p: 0.04 }),
    mover({ id: "decl", family: "consistency", betterWhen: "up", delta: -1, before: 1, after: 0, p: 0.05, reliability: "unclear" }),
  ]);
  assert.deepEqual(gains.map((r) => r.id), ["pf", "risk", "loss"]);
  assert.deepEqual(declines.map((r) => r.id), ["decl"]);
});
