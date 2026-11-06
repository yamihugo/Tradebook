import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/lib/periodComparisons.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const comparisons = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const periodResult = await build({
  entryPoints: [new URL("../src/lib/periods.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const periods = await import(`data:text/javascript;base64,${Buffer.from(periodResult.outputFiles[0].text).toString("base64")}`);

test("completed week, month, quarter, and year use the preceding calendar period", () => {
  assert.deepEqual(comparisons.periodComparison("lastweek", "2026-04-15").baseline, { start: "2026-03-30", end: "2026-04-05" });
  assert.deepEqual(comparisons.periodComparison("lastmonth", "2026-04-15").baseline, { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(comparisons.periodComparison("lastquarter", "2026-07-15").baseline, { start: "2026-01-01", end: "2026-03-31" });
  assert.deepEqual(comparisons.periodComparison("lastyear", "2026-06-01").baseline, { start: "2024-01-01", end: "2024-12-31" });
});

test("in-progress periods compare equally elapsed journal-calendar dates", () => {
  assert.deepEqual(comparisons.periodComparison("thisweek", "2026-06-03").current, { start: "2026-06-01", end: "2026-06-03" });
  assert.deepEqual(comparisons.periodComparison("thisweek", "2026-06-03").baseline, { start: "2026-05-29", end: "2026-05-31" });
  assert.deepEqual(comparisons.periodComparison("1m", "2026-05-12").baseline, { start: "2026-04-19", end: "2026-04-30" });
  assert.deepEqual(comparisons.periodComparison("thisquarter", "2026-05-12").baseline, { start: "2026-02-18", end: "2026-03-31" });
  assert.deepEqual(comparisons.periodComparison("thisyear", "2026-01-03").baseline, { start: "2025-12-29", end: "2025-12-31" });
});

test("custom windows use the selected endpoints and their exact elapsed span", () => {
  const result = comparisons.periodComparison("custom", "2026-04-30", "2026-04-10", "2026-04-19");
  assert.deepEqual(result.current, { start: "2026-04-10", end: "2026-04-19" });
  assert.deepEqual(result.baseline, { start: "2026-03-31", end: "2026-04-09" });
  assert.equal(result.eligible, true);
});

test("future Custom end is capped at the as-of date; future-only or invalid ranges are unavailable", () => {
  const capped = comparisons.periodComparison("custom", "2026-04-15", "2026-04-10", "2026-04-30");
  assert.deepEqual(capped.current, { start: "2026-04-10", end: "2026-04-15" });
  assert.deepEqual(capped.baseline, { start: "2026-04-04", end: "2026-04-09" });
  assert.equal(comparisons.periodComparison("custom", "2026-04-15", "2026-04-16", "2026-04-30").unavailableReason, "future-period");
  assert.equal(comparisons.periodComparison("custom", "2026-04-15", "2026-04-20", "2026-04-10").unavailableReason, "invalid-custom-range");
  assert.equal(comparisons.periodComparison("all", "2026-04-15").eligible, false);
});

test("sparse and empty trade populations do not move calendar bounds", () => {
  const result = comparisons.periodComparison("1m", "2026-05-12");
  const sparseDates = ["2026-05-02", "2026-04-20", "2026-01-01"];
  assert.deepEqual(result.current, { start: "2026-05-01", end: "2026-05-12" });
  assert.deepEqual(result.baseline, { start: "2026-04-19", end: "2026-04-30" });
  assert.deepEqual(sparseDates.filter((date) => comparisons.dateInComparison(date, result.current)), ["2026-05-02"]);
  assert.deepEqual([].filter((date) => comparisons.dateInComparison(date, result.baseline)), []);
  assert.equal(result.eligible, true);
});

test("historical as-of date anchors preset windows rather than today's date", () => {
  const result = comparisons.periodComparison("lastweek", "2024-03-06");
  assert.deepEqual(result.current, { start: "2024-02-26", end: "2024-03-03" });
  assert.deepEqual(result.baseline, { start: "2024-02-19", end: "2024-02-25" });
});

test("journal-zone dates across DST retain calendar-date membership", async () => {
  const beforeLocalMidnight = periods.dateInZone("America/New_York", new Date("2026-03-08T04:59:00Z"));
  const atLocalMidnight = periods.dateInZone("America/New_York", new Date("2026-03-08T05:00:00Z"));
  assert.equal(beforeLocalMidnight, "2026-03-07");
  assert.equal(atLocalMidnight, "2026-03-08");
  const result = comparisons.periodComparison("thisweek", atLocalMidnight);
  assert.deepEqual(result.current, { start: "2026-03-02", end: "2026-03-08" });
  assert.equal(comparisons.dateInComparison("2026-03-08", result.current), true);
  assert.equal(comparisons.dateInComparison("2026-03-01", result.current), false);
});
