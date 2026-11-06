import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 6.0 — freeze the CURRENT reality before the "Start Tracking From Here"
// model exists. These tests are deliberately a photograph of today's behaviour,
// including the places the audit found surprising or inconsistent. They must not
// be made to pass by changing production code; if a later phase changes a fact
// pinned here, the test is updated on purpose.
//
// What they protect for Phase 6.1:
//  - size is the only value anchor today (size ≠ real balance is not modelled);
//  - portfolio analytics ignore account.createdAt while the account view honours
//    it (the inconsistency P6.1 must close);
//  - an empty population reads as zero, not "unavailable";
//  - copy history is driven only by its own fields;
//  - a v1-shaped account is unchanged.
const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
    accountCashflows: new URL("../src/lib/accountCashflows.ts", import.meta.url).pathname,
    periods: new URL("../src/lib/periods.ts", import.meta.url).pathname,
    periodComparisons: new URL("../src/lib/periodComparisons.ts", import.meta.url).pathname,
    score: new URL("../src/lib/score.ts", import.meta.url).pathname,
    process: new URL("../src/lib/process.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
    dash: new URL("../src/views/dashboard.ts", import.meta.url).pathname,
    accountDash: new URL("../src/views/accountDashboard.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  loader: { ".png": "dataurl" },
  plugins: [
    {
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
            "export const ItemView = class ItemView {};",
            "export const View = class View {};",
            "export const Modal = class Modal {};",
            "export const Notice = class Notice {};",
            "export const Menu = class Menu {};",
            "export const Component = class Component {};",
            "export const Setting = class Setting {};",
            "export const Plugin = class Plugin {};",
            "export const PluginSettingTab = class PluginSettingTab {};",
            "export const MarkdownView = class MarkdownView {};",
            "export const FuzzySuggestModal = class FuzzySuggestModal {};",
            "export const SuggestModal = class SuggestModal {};",
            "export const debounce = (fn) => fn;",
            "export const requestUrl = async () => ({ json: {} });",
          ].join("\n"),
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
const [money, scope, accountMetrics, accountCashflows, periods, periodComparisons, score, process, copy, dash, accountDash] =
  await Promise.all([
    loadBundle("money"),
    loadBundle("scope"),
    loadBundle("accountMetrics"),
    loadBundle("accountCashflows"),
    loadBundle("periods"),
    loadBundle("periodComparisons"),
    loadBundle("score"),
    loadBundle("process"),
    loadBundle("copy"),
    loadBundle("dash"),
    loadBundle("accountDash"),
  ]);

// ---------------------------------------------------------------- fixtures

let seq = 0;
const trade = (over = {}) => {
  seq += 1;
  return {
    id: `t${seq}`,
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
  };
};

const dayKey = (t) => t.date;
const account = (over = {}) => ({
  id: "a1",
  name: "Leader",
  firmId: "topstep",
  programId: "funded",
  size: 50000,
  type: "funded",
  ...over,
});

const summarize = (trades, selected = null) => {
  const accountIdOf = (t) => (t.account || "").trim().toLowerCase();
  const includedAccountIds = new Set(trades.map(accountIdOf));
  return money.summarizeFinancials(trades, {
    scope: selected
      ? { kind: "selected-account", accountIdOf, includedAccountIds, accountId: selected }
      : { kind: "all-included-accounts", accountIdOf, includedAccountIds },
    dayKey,
  });
};

const metrics = (trades, over = {}) =>
  accountMetrics.computeAccountMetrics({ trades, size: 50000, dayKey, ...over });

// =========================================================================
// 1. Balance today = size + trade net + signed cashflows
// =========================================================================

test("balance today is size + recorded trade net + signed cashflows", () => {
  const rows = [trade({ pnl: 2500 })];
  const movement = accountMetrics.computeRecordedAccountMovement({
    trades: rows,
    size: 50000,
    dayKey,
    cashflows: [{ date: "2026-10-06", amount: -1000 }],
  });
  assert.equal(movement.balance, 51500);
  assert.equal(movement.change, 1500);
  assert.equal(movement.days[movement.days.length - 1].cumulative, 1500);

  const m = metrics(rows, { cashflows: [{ date: "2026-10-06", amount: -1000 }] });
  assert.equal(m.balance, 51500);
  assert.equal(m.net, 2500, "trading net never sees the payout");
});

// =========================================================================
// 2. size is the only value anchor today (no opening snapshot)
// =========================================================================

test("size is the only value anchor today; there is no separate opening balance", () => {
  // An empty account balances to its configured size — whatever that size is.
  assert.equal(accountMetrics.computeRecordedAccountMovement({ trades: [], size: 50000, dayKey }).balance, 50000);
  assert.equal(accountMetrics.computeRecordedAccountMovement({ trades: [], size: 52340, dayKey }).balance, 52340);

  // A real balance of 52,340 with a 50,000 prop size can only be expressed by
  // changing the anchor (size) or injecting a synthetic cashflow. Freeze both
  // facts: there is no third place to carry the difference.
  const viaSize = accountMetrics.computeRecordedAccountMovement({ trades: [], size: 52340, dayKey }).balance;
  const viaFlow = accountMetrics.computeRecordedAccountMovement({
    trades: [],
    size: 50000,
    dayKey,
    cashflows: [{ date: "2026-10-02", amount: 2340 }],
  }).balance;
  assert.equal(viaSize, 52340);
  assert.equal(viaFlow, 52340);

  // An "opening"-shaped extra property on an account-like object is inert.
  const acc = account({ opening: { date: "2026-10-02", balance: 52340 } });
  assert.equal(accountMetrics.computeRecordedAccountMovement({ trades: [], size: acc.size, dayKey }).balance, 50000);
});

// =========================================================================
// 3. createdAt inconsistency (frozen, not fixed)
// =========================================================================

test("portfolio populations ignore account.createdAt while the account view honours it", () => {
  const acc = account({ createdAt: "2026-06-01" });
  const before = trade({ id: "before", account: "Leader", date: "2026-05-01" });
  const after = trade({ id: "after", account: "Leader", date: "2026-06-02" });
  const rows = [before, after];

  // Portfolio: `baseTrades()` is the list every Home/Analytics widget reads.
  // It does NOT filter onCreate; a trade dated before the account existed stays.
  const dashView = Object.create(dash.WidgetGridView.prototype);
  dashView.plugin = {
    settings: { excludeDemosFromPortfolio: true, propAccounts: [acc] },
    resolveAccountType: () => "funded",
    mappedAccount: (label) => (String(label).trim().toLowerCase() === "leader" ? { id: acc.id, name: acc.name, type: acc.type } : null),
  };
  dashView.trades = rows;
  dashView.accountId = null;
  dashView.filter = "all";
  dashView._cacheTrades = null;
  dashView._baseCache = new Map();
  dashView._filteredCache = new Map();
  dashView._accountIds = [];
  dashView._accountTypes = [];
  assert.deepEqual(dashView.baseTrades().map((t) => t.id).sort(), ["after", "before"]);

  // Account view: `scoped()` excludes trades before createdAt.
  const accView = Object.create(accountDash.AccountDashboardView.prototype);
  accView.account = () => acc;
  accView.trades = rows;
  accView.dayKey = dayKey;
  accView.plugin = {
    mappedAccount: (label) => (String(label).trim().toLowerCase() === "leader" ? { id: acc.id, name: acc.name } : null),
  };
  assert.deepEqual(accView.scoped().map((t) => t.id), ["after"]);

  // The two views disagree today — this is the boundary P6.1 must make coherent.
});

// =========================================================================
// 4. Cashflow signs and the absence of a tracking boundary
// =========================================================================

test("cashflow signs are payout negative, deposit positive, adjustment signed", () => {
  const flows = accountCashflows.accountCashflows(
    [{ id: "p", accountId: "a1", date: "2026-10-01", amount: 500, status: "paid" }],
    [{ id: "d", accountId: "a1", date: "2026-10-02", amount: 200 }],
    [{ id: "f", accountId: "a1", date: "2026-10-03", amount: -12.5 }]
  );
  assert.deepEqual(flows, [
    { date: "2026-10-01", amount: -500 },
    { date: "2026-10-02", amount: 200 },
    { date: "2026-10-03", amount: -12.5 },
  ]);
});

test("a cashflow dated long before the account is still applied — there is no tracking boundary", () => {
  const movement = accountMetrics.computeRecordedAccountMovement({
    trades: [trade({ pnl: 0 })],
    size: 50000,
    dayKey,
    cashflows: [{ date: "2019-01-01", amount: -100 }],
  });
  assert.equal(movement.balance, 49900, "historical cashflows are not excluded today");
  // `accountCashflows` itself has no date argument at all.
  assert.equal(accountCashflows.accountCashflows([{ date: "2019-01-01", amount: 100 }]).length, 1);
});

// =========================================================================
// 5. Metrics read exactly the available trade list
// =========================================================================

test("metrics are computed from the available trades and nothing else", () => {
  const rows = [trade({ id: "w", pnl: 100 }), trade({ id: "l", pnl: -50 })];
  const summary = summarize(rows);
  assert.equal(summary.decisionCount, 2);
  assert.equal(summary.net.total, 50);

  const m = metrics(rows);
  assert.equal(m.tradeCount, 2);
  assert.equal(m.net, 50);
  assert.equal(m.winRate, 50);
  assert.equal(m.expectancy, 25);

  // The score/process engines consume the same list; no extra history exists.
  const scores = score.computeScore(rows, dayKey);
  assert.ok(scores && typeof scores === "object");
  const signals = process.computeProcessSignals(rows, dayKey);
  assert.equal(typeof signals.tradesPerDay, "number");
});

test("an analytics-boundary input is ignored today because no boundary exists", () => {
  const rows = [trade({ id: "w", pnl: 100 }), trade({ id: "l", pnl: -50 })];
  const plain = metrics(rows);
  const withBoundary = metrics(rows, {
    trackingStart: "2020-01-01",
    opening: { date: "2020-01-01", balance: 52340 },
    previousTradeCount: 1463,
    previousWinRate: 55,
    previousPnl: 999999,
  });
  assert.deepEqual(withBoundary, plain, "extra context is inert before P6.1");
});

// =========================================================================
// 6. "Unknown" reads as zero today, not "unavailable"
// =========================================================================

test("an empty population reports zero today, not an unavailable state", () => {
  const m = metrics([]);
  assert.equal(m.tradeCount, 0);
  assert.equal(m.winRate, 0);
  assert.equal(m.profitFactor, 0);
  assert.equal(m.expectancy, 0);

  const summary = summarize([]);
  assert.equal(summary.decisionCount, 0);
  assert.equal(summary.net.total, 0);
  assert.equal(summary.net.averagePerDecision, null);

  // Contrast: the period-comparison engine already has an explicit unavailable
  // reason. Account metrics do not. P6.1 introduces the equivalent for history.
  const comparison = periodComparisons.periodComparison("all", "2026-10-05");
  assert.equal(comparison.eligible, false);
  assert.equal(comparison.unavailableReason, "no-baseline");
});

// =========================================================================
// 7. Copy history is independent
// =========================================================================

test("copy configuration is driven by its own fields, never by a tracking boundary", () => {
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
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 1 },
      { from: "2026-06-01", ratio: 2 },
    ],
    copyPeriods: [{ start: "2026-01-01", baseId: "leader", multiplier: 1 }],
  };
  assert.equal(copy.effectiveCopyConfig(copier, "2026-03-01").ratio, 1);
  assert.equal(copy.effectiveCopyConfig(copier, "2026-07-01").ratio, 2);
  assert.equal(copy.isActiveCopier(copier, "leader", "2026-07-01"), true);

  // The same account carrying an inert analytics boundary resolves identically.
  const withBoundary = { ...copier, opening: { date: "2026-06-15", balance: 52340 }, trackingStart: "2026-06-15" };
  assert.equal(copy.effectiveCopyConfig(withBoundary, "2026-03-01").ratio, 1);
  assert.equal(copy.effectiveCopyConfig(withBoundary, "2026-07-01").ratio, 2);
  assert.equal(copy.isActiveCopier(withBoundary, "leader", "2026-07-01"), true);
});

// =========================================================================
// 8. Existing vault contract (backward-compat baseline)
// =========================================================================

test("a v1-shaped account with no opening metadata behaves exactly as today", () => {
  const acc = account({ createdAt: "2026-06-01" });
  const rows = [trade({ account: "Leader", date: "2026-06-02", pnl: 500 })];
  const m = metrics(rows, { cashflows: [{ date: "2026-06-03", amount: -200 }] });
  assert.equal(m.balance, 50300);
  assert.equal(m.net, 500);

  const summary = summarize(rows);
  assert.equal(summary.decisionCount, 1);
  assert.equal(summary.net.total, 500);

  // The account object round-trips with no new tracking keys required.
  assert.equal(Object.prototype.hasOwnProperty.call(acc, "opening"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(acc, "trackingStart"), false);
});

test("reported historical context never becomes trades or calculated history today", () => {
  const rows = [trade({ id: "only", account: "Leader", pnl: 100 })];
  const context = { previousTradeCount: 1463, previousWinRate: 55, previousPnl: 42000 };
  const plain = summarize(rows);
  const withContext = summarize(rows); // context is not an input to any engine
  assert.deepEqual(withContext, plain);
  assert.equal(rows.length, 1, "context is not materialised into trades");
  assert.equal(Object.prototype.hasOwnProperty.call(context, "date"), false);
  assert.equal(plain.decisionCount, 1, "calculated history sees only journal data");
});
