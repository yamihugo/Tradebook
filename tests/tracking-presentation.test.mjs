import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 6.2 — Tracking presentation integrity. The boundary already decides
// which trades count (6.1); this phase is about what the screens say when the
// counted population is empty. A missing figure must read "no tracked data",
// never a zero — and an account with no boundary must say exactly what it said
// before.
const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    fees: new URL("../src/lib/fees.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
    tracking: new URL("../src/lib/tracking.ts", import.meta.url).pathname,
    score: new URL("../src/lib/score.ts", import.meta.url).pathname,
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
const [money, scope, fees, accountMetrics, tracking, score] = await Promise.all([
  loadBundle("money"),
  loadBundle("scope"),
  loadBundle("fees"),
  loadBundle("accountMetrics"),
  loadBundle("tracking"),
  loadBundle("score"),
]);

const dayKey = (t) => t.date;

const trade = (over = {}) => ({
  id: `t${over.date ?? ""}${over.pnl ?? 0}${over.id ?? ""}`,
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
  reviewed: true,
  stopLoss: 19950,
  setup: "Breakout",
  rating: 4,
  ...over,
});

const legacy = () => ({
  id: "a1",
  name: "Leader",
  firmId: "topstep",
  programId: "funded",
  size: 50000,
  type: "funded",
  createdAt: "2026-01-05",
});

const tracked = (over = {}) => ({
  ...legacy(),
  trackingStart: "2026-10-01",
  openingBalance: 52340,
  ...over,
});

const metrics = (trades, over = {}) =>
  accountMetrics.computeAccountMetrics({ trades, size: 50000, dayKey, ...over });

const summarize = (trades, extraScope = {}) => {
  const accountIdOf = (t) => (t.account || "").trim().toLowerCase();
  return money.summarizeFinancials(trades, {
    scope: {
      kind: "all-included-accounts",
      accountIdOf,
      includedAccountIds: new Set(trades.map(accountIdOf)),
      ...extraScope,
    },
    dayKey,
  });
};

// The tracked population of an account, the way every view derives it.
const scopedTo = (acc, trades) => {
  const start = tracking.trackingStartOf(acc);
  return trades.filter((t) => tracking.isTrackedTrade(t, start));
};

test("CASE A — a legacy account without trackingStart reads exactly as before", () => {
  const acc = legacy();
  assert.equal(tracking.historyAvailability(acc, 0), "tracked", "no boundary is never not-tracked");

  // Every value passes through untouched, including the zeros and the dashes a
  // brand-new account has always shown.
  for (const value of ["$0.00", "+$0.00", "0.00", "0%", "0", "—"]) {
    assert.equal(tracking.trackedReading(acc, 0, value), value, `"${value}" is shown as calculated`);
  }
  assert.equal(tracking.trackedNote(acc, 0, "Own explanation."), "Own explanation.");
  assert.equal(tracking.trackedReading(acc, 3, "+$250.00"), "+$250.00");

  // And the engine behind it has not moved either.
  const empty = metrics([]);
  assert.equal(empty.tradeCount, 0);
  assert.equal(empty.net, 0);
  assert.equal(empty.expectancy, 0);
  const used = metrics([trade({ pnl: 250 })]);
  assert.equal(used.net, 250);
  assert.equal(used.tradeCount, 1);
});

test("CASE B — a tracking account with no tracked trades reports unavailable, not zero", () => {
  const acc = tracked();
  const history = [trade({ id: "before", date: "2026-09-20", pnl: 900 })];
  const scoped = scopedTo(acc, history);

  assert.equal(scoped.length, 0, "the pre-boundary trade is history, not tracked data");
  assert.equal(tracking.historyAvailability(acc, scoped.length), "not-tracked");

  // The four figures the phase names, and every other performance reading.
  for (const value of ["$0.00", "0.00", "$0", "0%", "0", "—"]) {
    assert.equal(tracking.trackedReading(acc, 0, value), "—", `"${value}" is not reported`);
  }
  assert.match(tracking.trackedNote(acc, 0, "Own explanation."), /No tracked trades yet/);
  assert.equal(
    tracking.trackedNote(acc, 0, "Own explanation."),
    tracking.NO_TRACKED_DATA_NOTE,
    "every surface says the same thing"
  );

  // Even handed the history by mistake, the engine counts nothing — so a view
  // that forgets the gate shows zeros of an empty population, and the gate is
  // what turns them into "—".
  const m = metrics(history, { trackingStart: tracking.trackingStartOf(acc) });
  assert.equal(m.tradeCount, 0);
  assert.equal(m.net, 0);
  assert.equal(tracking.trackedReading(acc, m.tradeCount, `$${m.net.toFixed(2)}`), "—");

  // The Trading Score has no axes to average, so it reads as not-enough-data
  // rather than as a zero.
  assert.equal(score.computeScore([], dayKey).score, null);
});

test("CASE C — a tracked trade that closed flat is a real zero and still reads", () => {
  const acc = tracked();
  const rows = [trade({ id: "flat", date: "2026-10-05", pnl: 0, exitPrice: 20000 })];
  const scoped = scopedTo(acc, rows);

  assert.equal(scoped.length, 1);
  assert.equal(tracking.historyAvailability(acc, scoped.length), "tracked");

  // The data exists, so the real zero survives — the phase's second rule.
  assert.equal(tracking.trackedReading(acc, scoped.length, "+$0.00"), "+$0.00");
  assert.equal(tracking.trackedReading(acc, scoped.length, "0.00"), "0.00");
  assert.equal(tracking.trackedNote(acc, scoped.length, "Net result per recorded trade."), "Net result per recorded trade.");

  const m = metrics(rows, { trackingStart: tracking.trackingStartOf(acc) });
  assert.equal(m.tradeCount, 1);
  assert.equal(m.net, 0, "a flat trade is zero profit, not a missing figure");
  assert.equal(m.expectancy, 0);
  // A breakeven decides nothing, so the rate reads zero — but it is the metric's
  // own reading of a real sample, not the tracking gate's silence, so it shows.
  assert.equal(m.winRate, 0);
  assert.equal(tracking.trackedReading(acc, scoped.length, "0%"), "0%");
  assert.equal(tracking.trackedReading(acc, scoped.length, "—"), "—");

  const summary = summarize(rows);
  assert.equal(summary.decisionCount, 1);
  assert.equal(summary.net.total, 0);
});

test("CASE B/C in the financial scope — the headline numbers read from one summary", () => {
  const acc = tracked();
  const history = [trade({ id: "before", date: "2026-09-20", pnl: 900 })];
  const flat = trade({ id: "flat", date: "2026-10-05", pnl: 0, exitPrice: 20000 });

  const empty = summarize(history, { isTracked: (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc)) });
  assert.equal(empty.decisionCount, 0);
  assert.equal(empty.net.total, 0);
  assert.equal(empty.net.winRate, null, "nothing decided, so no rate is invented");
  assert.equal(empty.net.averagePerDecision, null);

  const withTrade = summarize([...history, flat], {
    isTracked: (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc)),
  });
  assert.equal(withTrade.decisionCount, 1);
  assert.equal(withTrade.net.total, 0, "the real zero is data, and stays");
  assert.equal(withTrade.net.averagePerDecision, 0, "expectancy is zero because the trade existed");
});

test("history before the boundary stays in the journal and out of the analytics", () => {
  const acc = tracked();
  const before = trade({ id: "before", date: "2026-09-20", pnl: 900 });
  const after = trade({ id: "after", date: "2026-10-05", pnl: 100 });
  const rows = [before, after];

  // Raw trade history: every row is still there, in the log and in the reads
  // behind it. Nothing is deleted or hidden by the boundary.
  assert.equal(rows.length, 2);
  assert.equal(tracking.isTrackedTrade(before, tracking.trackingStartOf(acc)), false);
  assert.equal(tracking.isTrackedTrade(after, tracking.trackingStartOf(acc)), true);

  // Trade Log totals: the row list keeps both, the counted list keeps one.
  const counted = scope.analyticsTrades(scopedTo(acc, rows), false).counts;
  assert.equal(rows.length, 2, "the journal is untouched");
  assert.equal(counted.length, 1, "only the tracked trade is a decision for the totals");
  assert.deepEqual(counted.map((t) => t.id), ["after"]);

  // Tracked analytics never see the history.
  const summary = summarize(rows, { isTracked: (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc)) });
  assert.equal(summary.decisionCount, 1);
  assert.equal(summary.net.total, 100);
  assert.equal(metrics(rows, { trackingStart: tracking.trackingStartOf(acc) }).net, 100);
});

test("CASE D — reported historical context never enters a calculation", () => {
  const plain = tracked();
  const reported = tracked({
    historicalContext: { previousTradeCount: 1463, previousWinRate: 87.5, previousPnl: 42000 },
  });
  const rows = [
    trade({ id: "w1", date: "2026-10-02", pnl: 300 }),
    trade({ id: "l1", date: "2026-10-03", pnl: -100 }),
    trade({ id: "w2", date: "2026-10-04", pnl: 200 }),
  ];

  const read = (acc) => {
    const m = metrics(rows, {
      capital: tracking.openingCapital(acc),
      trackingStart: tracking.trackingStartOf(acc),
    });
    const s = summarize(rows, { isTracked: (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc)) });
    const sc = score.computeScore(rows, dayKey);
    return {
      net: m.net,
      winRate: m.winRate,
      expectancy: m.expectancy,
      profitFactor: m.profitFactor,
      dayWinRate: m.dayWinRate,
      decisions: s.decisionCount,
      total: s.net.total,
      rate: s.net.winRate,
      score: sc.score,
      availableAxes: sc.availableAxes,
      reading: tracking.trackedReading(acc, rows.length, "0.00"),
    };
  };

  assert.deepEqual(read(reported), read(plain), "context changes no number on any surface");
  const withContext = read(reported);
  assert.equal(withContext.decisions, 3, "only journal trades are counted");
  assert.equal(withContext.total, 400);
  assert.equal(withContext.score, null, "3 decisions is still too small a sample to grade");
  assert.equal(tracking.openingCapital(reported), 52340, "context does not move the value anchor");

  // And context cannot resurrect a population that does not exist.
  const contextOnly = tracked({ historicalContext: { previousTradeCount: 1463, previousWinRate: 87.5 } });
  assert.equal(tracking.historyAvailability(contextOnly, 0), "not-tracked");
  assert.equal(tracking.trackedReading(contextOnly, 0, "$0.00"), "—");
});