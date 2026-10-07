import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 6.1 — Start Tracking From Here. The boundary separates identity
// (createdAt), the prop-rule anchor (size) and the tracked performance
// population, while an account with no boundary behaves exactly as before.
const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
    tracking: new URL("../src/lib/tracking.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents:
            "export const App = class {};" +
            "export const TFile = class {};" +
            "export const TFolder = class {};" +
            "export const normalizePath = (p) => p;" +
            "export const setIcon = () => {};",
          loader: "js",
        }));
      },
    },
  ],
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [money, accountMetrics, tracking, copy] = await Promise.all([
  loadBundle("money"),
  loadBundle("accountMetrics"),
  loadBundle("tracking"),
  loadBundle("copy"),
]);

const dayKey = (t) => t.date;
const trade = (over = {}) => ({
  id: `t${over.date ?? ""}${over.pnl ?? 0}`,
  date: "2026-10-05",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "Leader",
  accountType: "funded",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  commission: 0,
  fees: 0,
  pnl: 100,
  ...over,
});

const account = (over = {}) => ({
  id: "a1",
  name: "Leader",
  firmId: "topstep",
  programId: "funded",
  size: 50000,
  type: "funded",
  ...over,
});

const metrics = (trades, over = {}) => accountMetrics.computeAccountMetrics({ trades, size: 50000, dayKey, ...over });

const summarize = (trades, extraScope = {}) => {
  const accountIdOf = (t) => (t.account || "").trim().toLowerCase();
  const includedAccountIds = new Set(trades.map(accountIdOf));
  return money.summarizeFinancials(trades, {
    scope: { kind: "all-included-accounts", accountIdOf, includedAccountIds, ...extraScope },
    dayKey,
  });
};

test("an account with no tracking boundary behaves exactly as before", () => {
  const acc = account();
  assert.equal(tracking.trackingStartOf(acc), "");
  assert.equal(tracking.hasTrackingStart(acc), false);
  assert.equal(tracking.openingCapital(acc), 50000, "no opening balance falls back to size");
  assert.equal(tracking.isTrackedTrade(trade({ date: "2019-01-01" }), tracking.trackingStartOf(acc)), true);
  assert.equal(tracking.historyAvailability(acc, 0), "tracked", "no boundary is never 'not-tracked'");
});

test("account size and opening balance are separate anchors", () => {
  const acc = account({ trackingStart: "2026-10-02", openingBalance: 52340 });
  assert.equal(acc.size, 50000, "the prop-rule anchor is untouched");
  assert.equal(tracking.openingCapital(acc), 52340, "the value anchor is the opening balance");

  // The metric engine keeps rules on `size` and value on `capital`.
  const m = metrics([], { capital: tracking.openingCapital(acc), trackingStart: tracking.trackingStartOf(acc) });
  assert.equal(m.balance, 52340);
});

test("historical trades before the boundary are out of tracked analytics but stay in the journal", () => {
  const acc = account({ trackingStart: "2026-10-01" });
  const before = trade({ id: "before", date: "2026-09-20", pnl: 900 });
  const after = trade({ id: "after", date: "2026-10-05", pnl: 100 });
  const rows = [before, after];

  const isTracked = (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc));
  const tracked = rows.filter(isTracked);
  const historical = rows.filter((t) => !isTracked(t));
  assert.deepEqual(tracked.map((t) => t.id), ["after"]);
  assert.deepEqual(historical.map((t) => t.id), ["before"], "history is kept, not deleted");
  assert.equal(rows.length, 2, "the source list is untouched");

  // Money population gated by the scope's isTracked predicate.
  const summary = summarize(rows, { isTracked });
  assert.equal(summary.decisionCount, 1, "only the tracked trade is counted");
  assert.equal(summary.net.total, 100);

  // Account metrics gate the same way even when handed the full list.
  const m = metrics(rows, { trackingStart: tracking.trackingStartOf(acc) });
  assert.equal(m.tradeCount, 1);
  assert.equal(m.net, 100);
});

test("balance from the opening state plus post-boundary movement is correct", () => {
  const acc = account({ trackingStart: "2026-10-02", openingBalance: 52340 });
  const rows = [trade({ date: "2026-10-05", pnl: 500 })];
  const m = metrics(rows, {
    capital: tracking.openingCapital(acc),
    trackingStart: tracking.trackingStartOf(acc),
    cashflows: [{ date: "2026-10-06", amount: -1000 }],
  });
  assert.equal(m.balance, 52340 + 500 - 1000);
  assert.equal(m.net, 500);
});

test("pre-boundary payouts are not double counted; post-boundary ones flow normally", () => {
  const acc = account({ trackingStart: "2026-10-02", openingBalance: 52340 });
  const movement = accountMetrics.computeRecordedAccountMovement({
    trades: [trade({ date: "2026-10-05", pnl: 500 })],
    size: tracking.openingCapital(acc),
    dayKey,
    trackingStart: tracking.trackingStartOf(acc),
    cashflows: [
      { date: "2026-01-01", amount: -3000 }, // already inside the opening balance
      { date: "2026-10-06", amount: -1000 }, // after the boundary
    ],
  });
  assert.equal(movement.balance, 52340 + 500 - 1000, "the pre-boundary payout is not counted again");
  assert.equal(movement.days.some((d) => d.date === "2026-01-01"), false);
});

test("deposits after the boundary behave normally", () => {
  const acc = account({ trackingStart: "2026-10-02", openingBalance: 10000 });
  const movement = accountMetrics.computeRecordedAccountMovement({
    trades: [],
    size: tracking.openingCapital(acc),
    dayKey,
    trackingStart: tracking.trackingStartOf(acc),
    cashflows: [{ date: "2026-10-10", amount: 2500 }],
  });
  assert.equal(movement.balance, 12500);
});

test("a boundary with no tracked trades is not-tracked, not a zero performance", () => {
  const tracked = account({ trackingStart: "2026-10-01" });
  assert.equal(tracking.historyAvailability(tracked, 0), "not-tracked");
  assert.equal(tracking.historyAvailability(tracked, 1), "tracked");
  // No boundary keeps today's behaviour — always available.
  assert.equal(tracking.historyAvailability(account(), 0), "tracked");
  // And the metrics themselves still gate to the (empty) tracked population.
  const m = metrics([trade({ date: "2026-09-01", pnl: 999 })], { trackingStart: tracking.trackingStartOf(tracked) });
  assert.equal(m.tradeCount, 0);
  assert.equal(m.net, 0);
});

test("reported historical context never becomes trades or calculated history", () => {
  const acc = account({
    trackingStart: "2026-10-01",
    openingBalance: 52340,
    historicalContext: { previousTradeCount: 1463, previousWinRate: 55, previousPnl: 42000 },
  });
  // The context lives on the account only; the engines never read it.
  assert.equal(tracking.openingCapital(acc), 52340, "context does not move the value anchor");
  const rows = [trade({ date: "2026-10-05", pnl: 100 })];
  const m = metrics(rows, { capital: tracking.openingCapital(acc), trackingStart: tracking.trackingStartOf(acc) });
  assert.equal(m.tradeCount, 1, "only journal data is counted");
  assert.equal(m.net, 100);
  assert.equal(summarize(rows).decisionCount, 1);
});

test("copy configuration is unaffected by a tracking boundary", () => {
  const copier = {
    id: "c1",
    name: "Copier",
    firmId: "topstep",
    programId: "funded",
    size: 50000,
    type: "funded",
    copyRole: "copier",
    copyBaseId: "leader",
    createdAt: "2026-01-01",
    trackingStart: "2026-10-01",
    openingBalance: 51000,
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 1 },
      { from: "2026-06-01", ratio: 2 },
    ],
    copyPeriods: [{ start: "2026-01-01", baseId: "leader", multiplier: 1 }],
  };
  assert.equal(copy.effectiveCopyConfig(copier, "2026-03-01").ratio, 1);
  assert.equal(copy.effectiveCopyConfig(copier, "2026-07-01").ratio, 2);
  assert.equal(copy.isActiveCopier(copier, "leader", "2026-07-01"), true);
});
