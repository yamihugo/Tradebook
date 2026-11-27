import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const entry = `
  export { journalDayKey } from ${JSON.stringify(path.join(root, "src/lib/scope.ts"))};
  export { sessionOf, sessionLabel } from ${JSON.stringify(path.join(root, "src/lib/sessions.ts"))};
  export { holdMinutesOf, tradeHourInZone } from ${JSON.stringify(path.join(root, "src/lib/instant.ts"))};
  export { netByDay, summarizeFinancials } from ${JSON.stringify(path.join(root, "src/lib/money.ts"))};
  export { computeProcessSignals, reentrySignals } from ${JSON.stringify(path.join(root, "src/lib/process.ts"))};
  export { computeAccountMetrics } from ${JSON.stringify(path.join(root, "src/lib/accountMetrics.ts"))};
  export { recentScoreWindow } from ${JSON.stringify(path.join(root, "src/lib/score.ts"))};
`;
const result = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "replay-unresolved-analytics.ts" },
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
const analytics = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const recordedDay = (trade) => trade.date;

const unresolved = {
  id: "synthetic-unresolved",
  date: "2026-01-04",
  entryTime: "09:30:00",
  exitTime: "09:35:00",
  timeUnresolved: true,
  sessionOverride: "newyork",
  symbol: "ES",
  direction: "long",
  quantity: 1,
  entryPrice: 100,
  exitPrice: 101,
  pnl: 25,
};

test("unresolved Replay trades do not create an empty net-by-day bucket", () => {
  const known = { ...unresolved, id: "synthetic-resolved", date: "2026-01-05", timeUnresolved: undefined, pnl: -5 };
  assert.deepEqual(
    [...analytics.netByDay([unresolved, known], recordedDay)],
    [["2026-01-05", -5]],
  );
});

test("financial totals include unresolved trades while financial day buckets exclude them", () => {
  const known = { ...unresolved, id: "summary-known", date: "2026-01-05", timeUnresolved: undefined, sessionOverride: undefined, pnl: -5 };
  const scope = {
    kind: "all-included-accounts",
    accountIdOf: () => "account-a",
    includedAccountIds: new Set(["account-a"]),
  };
  const summary = analytics.summarizeFinancials([unresolved, known], { scope, dayKey: recordedDay });
  assert.equal(summary.net.total, 20);
  assert.equal(summary.decisionCount, 2);
  assert.deepEqual([...summary.net.byDay], [["2026-01-05", -5]]);
});

test("day and hold process rates exclude unresolved trades but retain their overall count", () => {
  const unresolvedLoss = { ...unresolved, id: "unresolved-loss", symbol: "ES", entryTime: "09:30:00", exitTime: "09:30:20", pnl: -10 };
  const unresolvedNext = { ...unresolved, id: "unresolved-next", symbol: "ES", entryTime: "09:31:00", exitTime: "09:31:20", pnl: 10 };
  const knownFast = { ...unresolved, id: "known-fast", timeUnresolved: undefined, sessionOverride: undefined, entryTime: "10:00:00", exitTime: "10:00:30", pnl: 5 };
  const dayKey = recordedDay;
  const result = analytics.computeProcessSignals([unresolvedLoss, unresolvedNext, knownFast], dayKey);

  assert.equal(result.tradeCount, 3);
  assert.equal(result.tradesPerDay, 1);
  assert.equal(result.maxTradesInDay, 1);
  assert.equal(result.fastTradesPct, 100);
  assert.equal(analytics.reentrySignals([unresolvedLoss, unresolvedNext], dayKey).observed.size, 0);
});

test("account totals keep unresolved Replay P&L while dated metrics omit its empty day", () => {
  const known = { ...unresolved, id: "account-known", date: "2026-01-05", timeUnresolved: undefined, sessionOverride: undefined, pnl: -5 };
  const result = analytics.computeAccountMetrics({
    trades: [unresolved, known],
    size: 1_000,
    dayKey: recordedDay,
  });
  assert.equal(result.net, 20);
  assert.equal(result.tradeCount, 2);
  assert.equal(result.dayCount, 1);
  assert.equal(result.balance, 1_020);
});

test("date-bounded score windows omit unresolved Replay trades", () => {
  const result = analytics.recentScoreWindow([unresolved], {
    asOf: "2026-01-05",
    dayKey: recordedDay,
  });
  assert.deepEqual(result.trades, []);
});

test("unresolved Replay trades have no journal-day bucket", () => {
  assert.equal(analytics.journalDayKey("UTC")(unresolved), "");
});

test("unresolved Replay trades are not assigned a session, even with an override", () => {
  assert.equal(analytics.sessionOf(unresolved, "UTC"), "");
  assert.equal(analytics.sessionLabel(unresolved, "UTC"), "");
});

test("unresolved Replay wall clocks do not produce hold or hour analytics", () => {
  assert.equal(analytics.holdMinutesOf(unresolved), null);
  assert.equal(analytics.tradeHourInZone(unresolved, "UTC"), null);
});
