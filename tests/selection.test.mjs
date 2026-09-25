import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    periods: new URL("../src/lib/periods.ts", import.meta.url).pathname,
    metrics: new URL("../src/lib/metrics.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "browser",
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
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [money, scope, periods, metrics] = await Promise.all([
  loadBundle("money"),
  loadBundle("scope"),
  loadBundle("periods"),
  loadBundle("metrics"),
]);

const ACCOUNTS = [
  { id: "live-1", name: "Live One", type: "live" },
  { id: "live-2", name: "Live Two", type: "live" },
  { id: "demo-1", name: "Demo One", type: "demo" },
  { id: "arch-1", name: "Old Archive", type: "eval" },
];
const RESOLVE = scope.accountResolver({
  accounts: ACCOUNTS,
  mappedAccount: (label) => ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase()) ?? null,
});

const dayKey = (t) => t.date;

const scopeOf = (trades, options = {}) =>
  scope.accountScope(trades, {
    resolve: RESOLVE,
    excludeDemos: true,
    isArchived: (t) => t.account === "Old Archive",
    ...options,
  });

const summarize = (trades, options = {}) =>
  money.summarizeFinancials(trades, { scope: scopeOf(trades, options.scopeOptions), dayKey: options.dayKey ?? dayKey });

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
  pnl: 100,
  commission: 0,
  fees: 0,
  costCoverage: { commission: true, fees: true },
  ...overrides,
});

const metric = (id, rows, summary) => metrics.metricById(id).compute(rows, dayKey, summary).value;

test("the portfolio scope keeps archived accounts out and drops demos only when nothing was picked", () => {
  const rows = [
    trade({ id: "live", account: "Live One" }),
    trade({ id: "demo", account: "Demo One" }),
    trade({ id: "arch", account: "Old Archive" }),
  ];
  const portfolio = summarize(rows);
  assert.equal(portfolio.scope.kind, "all-included-accounts");
  assert.equal(portfolio.scope.includedAccountCount, 1);
  assert.equal(portfolio.eligibleLegCount, 1);
  assert.equal(portfolio.decisionCount, 1);
  assert.equal(portfolio.net.total, 100);

  const explicit = scopeOf(rows, { explicitAccountScope: true });
  assert.deepEqual([...explicit.includedAccountIds].sort(), ["demo-1", "live-1"]);
  assert.equal(explicit.includedAccountIds.has("arch-1"), false);

  const selectedDemo = summarize(rows, { scopeOptions: { selectedAccountId: "demo-1" } });
  assert.equal(selectedDemo.scope.kind, "selected-account");
  assert.equal(selectedDemo.scope.accountId, "demo-1");
  assert.equal(selectedDemo.decisionCount, 1);
  assert.equal(selectedDemo.net.total, 100);
});

test("Closed trades, Win Rate and the win/loss counts are one Net decision population", () => {
  const rows = [
    trade({ id: "w", date: "2026-09-01", pnl: 50 }),
    trade({ id: "l", date: "2026-09-02", pnl: -50 }),
    trade({ id: "b", date: "2026-09-03", pnl: 0 }),
  ];
  const summary = summarize(rows);
  assert.equal(summary.decisionCount, 3);
  assert.equal(summary.net.positiveDecisionCount, 1);
  assert.equal(summary.net.negativeDecisionCount, 1);
  assert.equal(summary.net.breakevenDecisionCount, 1);
  assert.equal(summary.net.winRate, 0.5);

  assert.equal(metric("m.trades", rows, summary), "3");
  assert.equal(metric("m.winrate", rows, summary), "50.0%");
  assert.equal(metric("m.wintrades", rows, summary), "1");
  assert.equal(metric("m.losstrades", rows, summary), "1");
  assert.equal(metric("m.netpnl", rows, summary), "+$0.00");
});

test("a positive Gross result that costs more than it earned is a Net loss", () => {
  const rows = [trade({ id: "fee-flip", pnl: 5, commission: 6, fees: 1 })];
  const summary = summarize(rows);
  assert.equal(summary.gross.positiveDecisionCount, 1);
  assert.equal(summary.net.positiveDecisionCount, 0);
  assert.equal(summary.net.negativeDecisionCount, 1);
  assert.equal(summary.net.winRate, 0);
  assert.equal(metric("m.winrate", rows, summary), "0.0%");
  assert.equal(metric("m.netpnl", rows, summary), "-$2.00");
});

test("nothing decided reports an em dash, never a misleading zero", () => {
  const flat = [trade({ id: "flat-only", pnl: 0 })];
  const flatSummary = summarize(flat);
  assert.equal(flatSummary.decisionCount, 1);
  assert.equal(flatSummary.net.winRate, null);
  assert.equal(metric("m.winrate", flat, flatSummary), "—");

  const empty = summarize([]);
  assert.equal(empty.decisionCount, 0);
  assert.equal(metric("m.winrate", [], empty), "—");
  assert.equal(metric("m.trades", [], empty), "0");
});

test("one copied decision can win in one account and lose across the portfolio", () => {
  const leader = trade({ id: "base-id", account: "Live One", pnl: 10, copyBaseKey: undefined });
  const copier = trade({ id: "copy-id", account: "Live Two", pnl: -12, isCopiedTrade: true, copyBaseKey: "base-id" });
  const rows = [leader, copier];

  const portfolio = summarize(rows);
  assert.equal(portfolio.decisionCount, 1);
  assert.equal(portfolio.net.total, -2);
  assert.equal(portfolio.net.positiveDecisionCount, 0);
  assert.equal(portfolio.net.negativeDecisionCount, 1);
  assert.equal(metric("m.trades", rows, portfolio), "1");

  const onlyLeader = summarize([leader], { scopeOptions: { selectedAccountId: "live-1" } });
  assert.equal(onlyLeader.net.positiveDecisionCount, 1);
  assert.equal(onlyLeader.net.winRate, 1);

  const onlyCopier = summarize([copier], { scopeOptions: { selectedAccountId: "live-2" } });
  assert.equal(onlyCopier.net.negativeDecisionCount, 1);
  assert.equal(onlyCopier.net.winRate, 0);
});

test("unknown historical costs are flagged instead of silently trusted", () => {
  const unknown = trade({ id: "unknown", pnl: 100, costCoverage: undefined });
  const known = trade({ id: "known", pnl: 100, costCoverage: { commission: true, fees: true } });
  const summary = summarize([unknown, known]);
  assert.equal(summary.eligibleLegCount, 2);
  assert.equal(summary.decisionCount, 2);
  assert.equal(summary.costCoverage.completeLegs, 1);
  assert.equal(summary.costCoverage.missingCommission, 1);
  assert.equal(summary.costCoverage.missingFees, 1);
  assert.equal(summary.costCoverage.completeDecisions, 1);
  // No fallback to Gross: the number is still the recorded Net, coverage noted.
  assert.equal(summary.net.total, 200);
});

test("rows that cannot be settled never enter the population", () => {
  const rows = [
    trade({ id: "good", pnl: 100 }),
    trade({ id: "nan", pnl: NaN }),
    trade({ id: "baddate", pnl: 10, date: "09/01/2026" }),
    trade({ id: "zeroqty", pnl: 10, quantity: 0 }),
    trade({ id: "baddir", pnl: 10, direction: "flat" }),
    trade({ id: "noexit", pnl: 10, exitPrice: 0, exitTime: "" }),
  ];
  const summary = summarize(rows);
  assert.equal(summary.eligibleLegCount, 1);
  assert.equal(summary.decisionCount, 1);
  assert.equal(summary.net.total, 100);
  assert.deepEqual(summary.eligibleLegs.map((t) => t.id), ["good"]);
  assert.equal(metric("m.trades", rows, summary), "1");
});

test("period membership and day bucketing share one journal day key", () => {
  const ny = scope.journalDayKey("America/New_York");
  const lisbon = scope.journalDayKey("Europe/Lisbon");

  // A note with no instant is its own record: the date it shows is the day it
  // belongs to, in any journal zone.
  assert.equal(ny(trade({ date: "2026-09-01", entryTime: "10:00" })), "2026-09-01");
  assert.equal(ny(trade({ date: "2026-09-01", entryTime: "23:30" })), "2026-09-01");
  assert.equal(lisbon(trade({ date: "2026-09-01", entryTime: "02:00" })), "2026-09-01");

  // With a canonical instant the day is that instant rendered in the journal
  // zone: 01:30Z on 2 September is still 1 September in New York, and the 2nd
  // in Lisbon. The instant decides; the zone only decides how it reads.
  const at = (iso) => trade({ entryInstant: iso });
  assert.equal(ny(at("2026-09-02T01:30:00.000Z")), "2026-09-01");
  assert.equal(lisbon(at("2026-09-02T01:30:00.000Z")), "2026-09-02");

  // Period bounds and day keys are the same domain now: the filter and the
  // bucket cannot disagree, whichever zone the trader chose.
  const bounds = { start: "2026-09-01", end: "2026-09-30" };
  assert.deepEqual(periods.periodDayBounds(bounds, "America/New_York"), bounds);
  assert.deepEqual(periods.periodDayBounds(bounds, "Europe/Lisbon"), bounds);
  assert.equal(periods.dateWithinPeriod("2026-08-31", periods.periodDayBounds(bounds, "Europe/Lisbon")), false);
  assert.equal(periods.dateWithinPeriod(ny(at("2026-09-02T01:30:00.000Z")), bounds), true);
  assert.equal(periods.dateWithinPeriod(lisbon(at("2026-09-02T01:30:00.000Z")), bounds), true);
  assert.equal(periods.dateWithinPeriod(ny(at("2026-09-30T23:30:00.000Z")), bounds), true, "the last day of the period is in");
  // 01:30Z on 1 October is still 30 September in New York — in the period.
  assert.equal(periods.dateWithinPeriod(ny(at("2026-10-01T01:30:00.000Z")), bounds), true, "a late instant still lands in September");
  // 13:30Z is 09:30 in New York on 1 October — the next day is out.
  assert.equal(periods.dateWithinPeriod(ny(at("2026-10-01T13:30:00.000Z")), bounds), false, "and the next day is out");
});

test("the day bucket classifies decisions by Net sign, same as the headline", () => {
  const rows = [
    trade({ id: "net-loss", date: "2026-09-01", pnl: 5, commission: 6, fees: 1 }),
    trade({ id: "net-win", date: "2026-09-01", pnl: 40 }),
    trade({ id: "net-flat", date: "2026-09-02", pnl: 0 }),
  ];
  const summary = summarize(rows);
  assert.deepEqual(summary.decisionsByDay.get("2026-09-01"), { count: 2, wins: 1, losses: 1, breakeven: 0 });
  assert.deepEqual(summary.decisionsByDay.get("2026-09-02"), { count: 1, wins: 0, losses: 0, breakeven: 1 });

  const byDay = summary.net.byDay;
  assert.equal(byDay.get("2026-09-01"), 38);
  assert.equal(byDay.get("2026-09-02"), 0);
  assert.equal(metric("m.netpnl", rows, summary), "+$38.00");
  assert.equal(metric("m.bestday", rows, summary), "+$38.00");
});
