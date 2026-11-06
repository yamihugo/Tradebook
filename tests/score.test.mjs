import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: { score: new URL("../src/lib/score.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: "bundle",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: [
          "export const App = class {};",
          "export const TFile = class {};",
          "export const TFolder = class {};",
          "export const normalizePath = (p) => p;",
          "export const setIcon = () => {};",
        ].join("\n"),
        loader: "js",
      }));
    },
  }],
});
const { computeScore, recoveryScore } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const dayKey = (t) => t.date;
const trade = (overrides = {}) => ({
  id: "trade",
  date: "2026-09-01",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "Live One",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  stopLoss: 19999,
  pnl: 20,
  commission: 0,
  fees: 0,
  ...overrides,
});
const axis = (res, id) => res.axes.find((a) => a.id === id);

test("the score exposes five axes split into Result and Discipline, equally weighted", () => {
  const res = computeScore([], dayKey);
  assert.deepEqual(res.axes.map((a) => a.id), ["performance", "consistency", "recovery", "risk", "behaviour"]);
  assert.ok(res.axes.every((a) => a.weight === 0.2));
  assert.equal(res.axes.filter((a) => a.group === "result").length, 3);
  assert.equal(res.axes.filter((a) => a.group === "discipline").length, 2);
  assert.equal(res.score, null, "no available axis means no numeric score");
});

test("recovery maps the recovery factor to 0/50/100", () => {
  assert.equal(recoveryScore(0), 0);
  assert.equal(recoveryScore(-3), 0);
  assert.equal(recoveryScore(0.5), 25);
  assert.equal(recoveryScore(1), 50);
  assert.equal(recoveryScore(2.5), 75);
  assert.equal(recoveryScore(4), 100);
  assert.equal(recoveryScore(20), 100);
  // No drawdown is unavailable, never a silent 100.
  const flat = Array.from({ length: 12 }, (_, i) => trade({ id: `f${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}`, pnl: 20 }));
  assert.equal(axis(computeScore(flat, dayKey), "recovery").value, null);
});

test("behaviour is 100 minus the Tilt mean of four declared shares", () => {
  const clean = Array.from({ length: 20 }, (_, i) => trade({ id: `c${i}`, date: `2026-09-${String((i % 10) + 1).padStart(2, "0")}` }));
  assert.equal(axis(computeScore(clean, dayKey), "behaviour").value, 100);
  const mistakes = clean.map((t, i) => ({ ...t, id: `m${i}`, mistake_tags: ["Moved stop"] }));
  assert.equal(axis(computeScore(mistakes, dayKey), "behaviour").value, 75, "one of four shares full = tilt 25");
  assert.equal(axis(computeScore(clean.slice(0, 9), dayKey), "behaviour").value, null, "under 10 decisions is null");
});

test("the total is the mean of the available axes, pulled to neutral by coverage", () => {
  const full = Array.from({ length: 20 }, (_, i) => trade({
    id: `t${i}`,
    date: `2026-07-${String((i % 10) + 1).padStart(2, "0")}`,
    pnl: i < 3 ? -20 : 40,
  }));
  const res = computeScore(full, dayKey);
  assert.ok(res.availableAxes >= 3);
  const available = res.axes.filter((a) => a.value !== null);
  const mean = available.reduce((s, a) => s + a.value, 0) / available.length;
  const expected = 50 + (mean - 50) * (available.length / 5);
  assert.ok(Math.abs(res.score - expected) < 1e-9);
  assert.equal(res.complete, res.availableAxes === 5);
});
