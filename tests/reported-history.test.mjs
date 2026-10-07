import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// A2 — "Reported before tracking" reads back as display-only context.
// Only fields that genuinely carry a value are shown; a missing field is never
// flattened to zero, and the reported context never reaches a calculated figure.
const result = await build({
  entryPoints: {
    reportedHistory: new URL("../src/lib/reportedHistory.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  outdir: "bundle",
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
            "export const Notice = class {};" +
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
const [reportedHistory, accountMetrics] = await Promise.all([
  loadBundle("reportedHistory"),
  loadBundle("accountMetrics"),
]);

test("a fully reported history reads back as compact context", () => {
  const summary = reportedHistory.reportedHistorySummary({
    previousTradeCount: 12,
    previousWins: 7,
    previousLosses: 4,
    previousBreakevens: 1,
    previousWinRate: 58,
    previousPnl: 1240,
  });
  assert.equal(summary.hasAny, true);
  assert.deepEqual(summary.segments, [
    "12 trades",
    "7 wins",
    "4 losses",
    "1 breakeven",
    "58% win rate",
    "+$1,240.00",
  ]);
  assert.equal(summary.note, "");
});

test("absent fields are omitted, never shown as zero", () => {
  const summary = reportedHistory.reportedHistorySummary({ previousWins: 3 });
  assert.deepEqual(summary.segments, ["3 wins"], "no trades/losses/pnl fabricated as 0");
  assert.equal(summary.hasAny, true);

  // A reported win rate alone cannot reconstruct wins or losses.
  const rateOnly = reportedHistory.reportedHistorySummary({ previousWinRate: 61 });
  assert.deepEqual(rateOnly.segments, ["61% win rate"]);
});

test("singular and negative values read correctly", () => {
  const summary = reportedHistory.reportedHistorySummary({ previousTradeCount: 1, previousLosses: 1, previousPnl: -250 });
  assert.deepEqual(summary.segments, ["1 trade", "1 loss", "-$250.00"]);
});

test("no context means no fake historical summary", () => {
  for (const empty of [undefined, null, {}]) {
    const summary = reportedHistory.reportedHistorySummary(empty);
    assert.equal(summary.hasAny, false);
    assert.deepEqual(summary.segments, []);
    assert.equal(summary.note, "");
  }
  // A whitespace note is not a reported history either.
  assert.equal(reportedHistory.reportedHistorySummary({ note: "   " }).hasAny, false);
});

test("a reported note alone still reads back", () => {
  const summary = reportedHistory.reportedHistorySummary({ note: "Traded a $50k eval before this." });
  assert.equal(summary.hasAny, true);
  assert.deepEqual(summary.segments, []);
  assert.equal(summary.note, "Traded a $50k eval before this.");
});

// The context is display-only: it never reaches a calculated figure.
const trade = (over = {}) => ({
  id: `t-${over.pnl ?? 0}`,
  date: "2026-09-10",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "A",
  accountType: "funded",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  commission: 0,
  fees: 0,
  pnl: 0,
  ...over,
});

test("reported history never becomes tracked performance", () => {
  // A rich reported context, zero tracked trades: the metrics engine must not
  // promote any of it into Net, Closed trades or the balance.
  const account = {
    size: 50000,
    openingBalance: 50000,
    trackingStart: "2026-09-01",
    historicalContext: {
      previousTradeCount: 34,
      previousWins: 25,
      previousLosses: 9,
      previousWinRate: 73,
      previousPnl: 42000,
    },
  };
  const m = accountMetrics.computeAccountMetrics({
    trades: [],
    size: account.size,
    capital: account.openingBalance,
    trackingStart: account.trackingStart,
    dayKey: (t) => t.date,
  });
  assert.equal(m.net, 0, "reported P&L is not trading Net");
  assert.equal(m.tradeCount, 0, "reported trades are not Closed trades");
  assert.equal(m.balance, account.openingBalance, "reported history does not move the balance");
  assert.equal(m.winRate, 0);

  // And the presence of the context changes nothing when real trades exist.
  const trades = [trade({ id: "w", pnl: 300 }), trade({ id: "l", pnl: -100 })];
  const base = {
    trades,
    size: account.size,
    capital: account.openingBalance,
    trackingStart: account.trackingStart,
    maxLoss: 2000,
    target: 3000,
    dayKey: (t) => t.date,
  };
  const plain = accountMetrics.computeAccountMetrics(base);
  const reported = accountMetrics.computeAccountMetrics({ ...base });
  for (const key of ["net", "tradeCount", "winRate", "profitFactor", "expectancy", "balance", "maxDrawdown"]) {
    assert.equal(reported[key], plain[key], `${key} is unchanged by reported history`);
  }
  assert.equal(plain.net, 200);
  assert.equal(plain.tradeCount, 2);
});
