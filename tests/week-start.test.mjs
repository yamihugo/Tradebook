import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * "Week starts on" is a user choice: the week periods and the calendar must
 * follow it. This pins the two offsets with a known date (2026-09-30, a
 * Wednesday): Monday start → the 28th, Sunday start → the 27th.
 */
const result = await build({
  entryPoints: { periods: new URL("../src/lib/periods.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: "bundle",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        b.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents: "export const normalizePath = (p) => p;",
          loader: "js",
        }));
      },
    },
  ],
});
const periods = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const TODAY = "2026-09-30"; // Wednesday

test("this week follows the chosen start (Monday vs Sunday)", () => {
  assert.equal(periods.periodBounds("thisweek", TODAY).start, "2026-09-28");
  assert.equal(periods.periodBounds("thisweek", TODAY, "", "", "monday").start, "2026-09-28");
  assert.equal(periods.periodBounds("thisweek", TODAY, "", "", "sunday").start, "2026-09-27");
  // Either way, the week ends today.
  assert.equal(periods.periodBounds("thisweek", TODAY, "", "", "sunday").end, TODAY);
});

test("last week shifts a whole week from the chosen start", () => {
  const mon = periods.periodBounds("lastweek", TODAY, "", "", "monday");
  assert.deepEqual(mon, { start: "2026-09-21", end: "2026-09-27" });
  const sun = periods.periodBounds("lastweek", TODAY, "", "", "sunday");
  assert.deepEqual(sun, { start: "2026-09-20", end: "2026-09-26" });
});

test("non-week periods are unaffected by the start day", () => {
  for (const period of ["today", "lastmonth", "thisyear"]) {
    assert.deepEqual(
      periods.periodBounds(period, TODAY, "", "", "monday"),
      periods.periodBounds(period, TODAY, "", "", "sunday"),
      period
    );
  }
});

test("periodDataBounds respects the start day for the current week", () => {
  const mon = periods.periodDataBounds("thisweek", TODAY, "", "", "monday");
  const sun = periods.periodDataBounds("thisweek", TODAY, "", "", "sunday");
  assert.equal(mon.start, "2026-09-28");
  assert.equal(sun.start, "2026-09-27");
});
