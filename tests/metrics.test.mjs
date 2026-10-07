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

// Notes whose recorded clock cannot tell them apart: the SAME date and entry
// time, three different entry instants. Every order-sensitive computation must
// walk the shared chronology (lib/instant.ts), not the note's clock.
const tied = (id, entryInstant, pnl) => ({
  id,
  date: "2026-01-05",
  entryTime: "09:30",
  pnl,
  entryInstant,
});

test("max drawdown walks the canonical chronology, whatever order the notes arrive in", () => {
  const lossEarly = tied("a", "2026-01-05T09:30:00Z", -50);
  const win = tied("b", "2026-01-05T10:30:00Z", 100);
  const lossLate = tied("c", "2026-01-05T11:30:00Z", -50);
  const maxdd = (rows) => metrics.metricById("m.maxdd").compute(rows).value;
  // loss → win → loss is a 50 deep walk; the recorded clock would have read
  // these as equal and kept whatever order the notes came in (100 deep).
  assert.equal(maxdd([lossEarly, win, lossLate]), "-$50.00");
  assert.equal(maxdd([win, lossEarly, lossLate]), "-$50.00");
  assert.equal(maxdd([lossLate, win, lossEarly]), "-$50.00");
});

test("streaks read the same chronology as the drawdown walk", () => {
  const rows = [
    tied("b", "2026-01-05T10:30:00Z", 100),
    tied("a", "2026-01-05T09:30:00Z", -50),
    tied("c", "2026-01-05T11:30:00Z", -50),
  ];
  // Chronologically these are loss → win → loss: no run longer than one.
  assert.equal(metrics.metricById("m.lossstreak").compute(rows).value, "1");
  assert.equal(metrics.metricById("m.winstreak").compute(rows).value, "1");
});

// A decision that wins before costs and loses once commission is recorded is a
// loss — everywhere. The hold split used to read the Gross sign of the row.
const eligible = (id, pnl, opts = {}) => ({
  id,
  date: "2026-01-05",
  entryTime: "09:00:00",
  exitTime: "10:00:00",
  symbol: "NQ",
  account: "A",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  commission: 0,
  fees: 0,
  costCoverage: { commission: true, fees: true },
  pnl,
  ...opts,
});

test("the win/loss hold split classifies decisions by Net, like every result metric", () => {
  const netWin = eligible("w", 10, { exitTime: "09:30:00" });
  const grossWinNetLoss = eligible("g", 1, { commission: 5 });
  const rows = [grossWinNetLoss, netWin];
  assert.equal(metrics.metricById("m.winhold").compute(rows).value, "30m");
  assert.equal(metrics.metricById("m.losshold").compute(rows).value, "1h");
  // The whole-sample average is a duration, not a classification: still both.
  assert.equal(metrics.metricById("m.holdtime").compute(rows).value, "45m");
});

// A copied decision that wins on the leader's row and loses once the copier's
// legs are summed is a loss — which is what the shared summary says.
test("streak metrics read the Net of the decision across accounts", () => {
  const leader = { ...eligible("base", 10), copyBaseKey: "d1" };
  const copier = { ...eligible("copier", -15), copyBaseKey: "d1", isCopiedTrade: true, account: "B" };
  const financials = metrics.summarizeMetricTrades([leader, copier]);
  // 10 − 15 = −5: the decision lost even though the leader's row was +10.
  assert.equal(metrics.metricById("m.lossstreak").compute([leader], undefined, financials).value, "1");
  assert.equal(metrics.metricById("m.winstreak").compute([leader], undefined, financials).value, "0");
  assert.equal(
    metrics.metricById("m.winstreak").compute([leader]).value,
    "1",
    "with no summary in hand the row stands on its own Net",
  );
});
