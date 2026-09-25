import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/lib/metrics.ts", import.meta.url).pathname],
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
const metrics = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const hold = (entryTime, exitTime) => metrics.metricById("m.holdtime").compute([
  { date: "2026-09-24", entryTime, exitTime, pnl: 1 },
]).value;

test("hold time handles an exit crossing midnight", () => {
  assert.equal(hold("23:50", "00:10"), "20m");
  assert.equal(hold("23:59:30", "00:00:30"), "1m");
});

test("hold time preserves valid same-day durations", () => {
  assert.equal(hold("09:15", "10:45"), "1h 30m");
  assert.equal(hold("09:15:30", "09:15:30"), "0s");
});

test("missing, malformed, and out-of-range times add no invented duration", () => {
  assert.equal(hold(undefined, "10:00"), "—");
  assert.equal(hold("09:00", ""), "—");
  assert.equal(hold("25:00", "26:00"), "—");
  assert.equal(hold("09:00 trailing", "10:00"), "—");
});

test("invalid-time trades are excluded from the average, not counted as zero", () => {
  const value = metrics.metricById("m.holdtime").compute([
    { date: "2026-09-24", entryTime: "09:00", exitTime: "10:00", pnl: 1 },
    { date: "2026-09-24", entryTime: "invalid", exitTime: "10:00", pnl: 1 },
  ]).value;
  assert.equal(value, "1h");
});
