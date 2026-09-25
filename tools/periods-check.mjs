import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const srcRoot = path.resolve("src");
const cache = new Map();
function loadTs(filename) {
  const full = path.resolve(filename);
  if (cache.has(full)) return cache.get(full).exports;
  const source = fs.readFileSync(full, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  cache.set(full, module);
  const requireLocal = (specifier) => loadTs(path.resolve(path.dirname(full), `${specifier}.ts`));
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, {
    Intl, Date, Math, Number, String, Object, Array, Map, Set, RegExp, JSON,
  })(requireLocal, module, module.exports);
  return module.exports;
}

const {
  dateInZone,
  dateWithinPeriod,
  periodAsOf,
  periodDataBounds,
  periodBounds,
  previousPeriodBounds,
} = loadTs(path.join(srcRoot, "lib/periods.ts"));

const bounds = (period, today, from = "", to = "") => periodDataBounds(period, today, from, to);
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

// The configured journal zone, not the computer's zone, decides the current day.
const beforeJournalMidnight = new Date("2024-03-10T04:59:59.000Z");
const atJournalMidnight = new Date("2024-03-10T05:00:00.000Z");
assert.equal(dateInZone("America/New_York", beforeJournalMidnight), "2024-03-09");
assert.equal(dateInZone("America/New_York", atJournalMidnight), "2024-03-10");
assert.equal(dateInZone("America/Los_Angeles", beforeJournalMidnight), "2024-03-09");
assert.equal(dateInZone("America/Los_Angeles", atJournalMidnight), "2024-03-09");

// Boundaries stay journal-calendar dates across DST; trade membership uses its
// recorded journal date, not an entry-time conversion into a trading-day key.
same(bounds("thisweek", "2024-03-10"), { start: "2024-03-04", end: "2024-03-10" });
same(bounds("today", "2024-03-10"), { start: "2024-03-10", end: "2024-03-10" });
assert.equal(dateWithinPeriod("2024-03-10", bounds("today", "2024-03-10")), true);
assert.equal(dateWithinPeriod("2024-03-09", bounds("today", "2024-03-10")), false);
assert.equal(dateWithinPeriod("2024-03-11", bounds("today", "2024-03-10")), false);

// Calendar presets across week/month/quarter/year rollover boundaries.
same(bounds("lastweek", "2025-01-01"), { start: "2024-12-23", end: "2024-12-29" });
same(bounds("lastmonth", "2025-01-01"), { start: "2024-12-01", end: "2024-12-31" });
same(bounds("lastquarter", "2025-01-01"), { start: "2024-10-01", end: "2024-12-31" });
same(bounds("lastyear", "2025-01-01"), { start: "2024-01-01", end: "2024-12-31" });
same(bounds("1m", "2024-03-10"), { start: "2024-03-01", end: "2024-03-10" });
same(bounds("thisquarter", "2024-03-10"), { start: "2024-01-01", end: "2024-03-10" });
same(bounds("thisyear", "2024-03-10"), { start: "2024-01-01", end: "2024-03-10" });

// Open-ended ranges and All Time are capped at the journal-zone as-of date.
same(bounds("all", "2024-03-10"), { start: null, end: "2024-03-10" });
same(bounds("thisweek", "2024-03-10"), { start: "2024-03-04", end: "2024-03-10" });
assert.equal(dateWithinPeriod("2024-03-11", bounds("all", "2024-03-10")), false);

// Historical Custom ends remain the as-of date; future ends are capped today.
same(bounds("custom", "2024-03-10", "2024-02-01", "2024-02-20"), {
  start: "2024-02-01", end: "2024-02-20",
});
assert.equal(periodAsOf("custom", "2024-03-10", "2024-02-01", "2024-02-20"), "2024-02-20");
same(bounds("custom", "2024-03-10", "2024-02-01", "2024-04-01"), {
  start: "2024-02-01", end: "2024-03-10",
});
assert.equal(bounds("custom", "2024-03-10", "2024-03-11", "2024-04-01").start, "2024-03-11");
assert.equal(dateWithinPeriod("2024-03-11", bounds("custom", "2024-03-10", "2024-03-11", "2024-04-01")), false);
assert.equal(bounds("custom", "2024-03-10", "2024-03-11", ""), null);
assert.equal(dateWithinPeriod("2024-03-10", null), false);

// Prior-period windows are calendar-defined, including elapsed-to-date weeks.
same(previousPeriodBounds("thisweek", "2024-03-10"), {
  start: "2024-02-26", end: "2024-03-03",
});
same(previousPeriodBounds("lastmonth", "2025-01-01"), {
  start: "2024-11-01", end: "2024-11-30",
});
assert.equal(previousPeriodBounds("all", "2024-03-10"), null);

// Existing raw period bounds remain available to callers that need the original
// calendar interval; data consumers should use the as-of-capped helper above.
same(periodBounds("all", "2024-03-10"), { start: null, end: null });

console.log("PERIODS CHECK OK");
