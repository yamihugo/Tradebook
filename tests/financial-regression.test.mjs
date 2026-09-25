import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    fees: new URL("../src/lib/fees.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
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
const [money, scope, fees, accountMetrics] = await Promise.all([loadBundle("money"), loadBundle("scope"), loadBundle("fees"), loadBundle("accountMetrics")]);

const trade = (overrides = {}) => ({
  id: "trade-a",
  date: "2026-09-24",
  entryTime: "09:00",
  exitTime: "09:05",
  symbol: "NQ",
  account: "Leader",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  pnl: 100,
  commission: 0,
  fees: 0,
  ...overrides,
});

const summary = (trades, selected = null) => {
  const keyOf = (item) => item.account.trim().toLowerCase();
  const includedAccountIds = new Set(trades.map(keyOf));
  return money.summarizeFinancials(trades, {
    scope: selected
      ? { kind: "selected-account", accountIdOf: keyOf, includedAccountIds, accountId: selected }
      : { kind: "all-included-accounts", accountIdOf: keyOf, includedAccountIds },
    dayKey: (item) => item.date,
  });
};

test("Gross and Net use trade P&L and recorded commission plus fees", () => {
  const item = trade({ pnl: 100, commission: 2.25, fees: 1.75 });
  const result = money.tradeMoney(item, "net");
  assert.deepEqual(result, {
    basis: "net",
    value: 96,
    gross: 100,
    net: 96,
    costCoverage: { commission: true, fees: true },
  });
  assert.equal(money.tradeMoney(item, "gross").value, 100);
});

test("unknown historical zero costs differ from explicitly recorded zero costs", () => {
  const legacyZero = trade({ costCoverage: undefined, commission: 0, fees: 0 });
  const explicitZero = trade({ id: "explicit", costCoverage: { commission: true, fees: true }, commission: 0, fees: 0 });
  const nonzeroLegacy = trade({ id: "known", commission: 2, fees: 1 });
  assert.deepEqual(money.tradeCostCoverage(legacyZero), { commission: false, fees: false });
  assert.deepEqual(money.tradeCostCoverage(explicitZero), { commission: true, fees: true });
  assert.deepEqual(money.tradeCostCoverage(nonzeroLegacy), { commission: true, fees: true });
  const combined = summary([legacyZero, explicitZero, nonzeroLegacy]);
  assert.equal(combined.costCoverage.completeLegs, 2);
  assert.equal(combined.costCoverage.missingCommission, 1);
  assert.equal(combined.costCoverage.missingFees, 1);
  assert.equal(combined.net.total, 297);
});

test("linked copy legs add account money but count as one logical decision", () => {
  const leader = trade({ id: "base-id", pnl: 100, account: "Leader", copyBaseKey: undefined });
  const copier = trade({ id: "copy-id", pnl: 60, account: "Copier", isCopiedTrade: true, copyBaseKey: "base-id", commission: 2, fees: 3 });
  const result = summary([leader, copier]);
  assert.equal(result.eligibleLegCount, 2);
  assert.equal(result.decisionCount, 1);
  assert.equal(result.gross.total, 160);
  assert.equal(result.net.total, 155);
  assert.equal(result.decisions[0].legCount, 2);
  assert.equal(result.net.averagePerDecision, 155);
  assert.equal(result.net.averagePerAccountLeg, 77.5);
  assert.equal(summary([leader, copier], "copier").decisionCount, 1);
  assert.equal(summary([leader, copier], "copier").net.total, 55);
  assert.equal(scope.analyticsTrades([leader, copier]).money.length, 2);
  assert.equal(scope.analyticsTrades([leader, copier]).unique.length, 1);
  assert.equal(scope.analyticsTrades([leader, copier]).counts.length, 1);
  assert.equal(scope.analyticsTrades([leader, copier], true).counts.length, 2);
});

test("duplicate rows for one account leg do not duplicate financial aggregation", () => {
  const canonical = trade({ id: "base", pnl: 100, account: "Leader", copyBaseKey: "decision-key" });
  const duplicate = trade({ id: "base-duplicate", pnl: 100, account: "Leader", copyBaseKey: "decision-key" });
  const copier = trade({ id: "copier", pnl: 50, account: "Copier", isCopiedTrade: true, copyBaseKey: "decision-key" });
  const result = summary([canonical, duplicate, copier]);
  assert.equal(result.eligibleLegCount, 2);
  assert.equal(result.duplicateLegCount, 1);
  assert.equal(result.decisionCount, 1);
  assert.equal(result.gross.total, 150);
});

test("unidentified copies and same-time symbol matches are never guessed together", () => {
  const leader = trade({ id: "leader", account: "A", pnl: 80 });
  const orphan = trade({ id: "orphan", account: "B", pnl: 40, isCopiedTrade: true, copyBaseKey: undefined });
  const unrelated = trade({ id: "unrelated", account: "C", pnl: -10 });
  const result = summary([leader, orphan, unrelated]);
  assert.equal(result.eligibleLegCount, 3);
  assert.equal(result.decisionCount, 3);
  assert.equal(result.unidentifiedLegCount, 1);
  assert.equal(result.decisions.find((decision) => decision.key === "leader").legCount, 1);
  assert.equal(result.net.total, 110);
});

test("decision results classify positive, negative, and flat outcomes on each basis", () => {
  const result = summary([
    trade({ id: "positive", pnl: 10, commission: 1, fees: 0 }),
    trade({ id: "negative", pnl: -8, commission: 1, fees: 0 }),
    trade({ id: "flat", pnl: 0 }),
  ]);
  assert.equal(result.gross.positiveDecisionCount, 1);
  assert.equal(result.gross.negativeDecisionCount, 1);
  assert.equal(result.gross.breakevenDecisionCount, 1);
  assert.equal(result.net.positiveDecisionCount, 1);
  assert.equal(result.net.negativeDecisionCount, 1);
  assert.equal(result.net.breakevenDecisionCount, 1);
  assert.equal(result.net.profitFactor, 9 / 9);
  assert.equal(money.profitFactor([trade({ pnl: 3 })]), Infinity);
  assert.equal(money.profitFactor([trade({ pnl: -3 })]), 0);
  assert.equal(money.profitFactor([trade({ pnl: 0 })]), 0);
});

test("empty and partially populated inputs keep empty aggregates finite and exclude ineligible legs", () => {
  const empty = summary([]);
  assert.equal(empty.eligibleLegCount, 0);
  assert.equal(empty.decisionCount, 0);
  assert.equal(empty.gross.total, 0);
  assert.equal(empty.net.total, 0);
  assert.equal(empty.net.averagePerDecision, null);
  assert.equal(empty.net.profitFactor, 0);

  const partial = trade({ id: "partial", commission: NaN, fees: undefined, costCoverage: undefined });
  const invalid = trade({ id: "invalid", quantity: 0 });
  const result = summary([partial, invalid]);
  assert.equal(result.eligibleLegCount, 1);
  assert.equal(result.unidentifiedLegCount, 0);
  assert.equal(result.net.total, 100);
  assert.equal(result.costCoverage.missingCommission, 1);
  assert.equal(result.costCoverage.missingFees, 1);
});

test("payouts, deposits and balance adjustments are outside trade P&L; allocated model cost stays separate", () => {
  const item = trade({ id: "cashflow-test", pnl: 100, commission: 2, fees: 3 });
  const unrelatedCashFlows = [
    { id: "payout", accountId: "Leader", date: item.date, amount: 500, status: "paid" },
    { id: "deposit", accountId: "Leader", date: item.date, amount: 200 },
    { id: "adjustment", accountId: "Leader", date: item.date, amount: -25 },
  ];
  const allocation = [{
    id: "fee-adjustment",
    accountId: "Leader",
    date: item.date,
    amount: -25,
    allocations: [{ key: `k:${item.id}`, amount: 25 }],
  }];
  assert.equal(money.tradeMoney(item, "net").value, 95);
  assert.equal(summary([item]).net.total, 95);
  assert.equal(fees.feeForTrade(item, allocation).allocated, 25);
  assert.equal(fees.feeForTrade(item, allocation).total, 30);
  assert.equal(unrelatedCashFlows.reduce((sum, flow) => sum + flow.amount, 0), 675);
  assert.equal(summary([item]).net.total, 95);
});

test("account risk metrics respect static, trailing, cashflow and target rules", () => {
  const tradeRows = [
    trade({ id: "gain", date: "2026-09-23", pnl: 7000 }),
    trade({ id: "pullback", date: "2026-09-24", pnl: -1000 }),
  ];
  const compute = (rules = {}, rows = tradeRows) => accountMetrics.computeAccountMetrics({
    trades: rows,
    size: 50000,
    dayKey: (item) => item.date,
    ...rules,
  });
  const funded = compute({ maxLoss: 2000, ddLockOffset: 0 });
  assert.equal(funded.net, 6000);
  assert.equal(funded.ddToLimit, 1000);
  assert.equal(funded.ddRemaining, 6000);
  const beforeLock = compute({ maxLoss: 2000, ddLockOffset: 0 }, [
    trade({ id: "pre-lock-gain", date: "2026-09-23", pnl: 1000 }),
    trade({ id: "pre-lock-pullback", date: "2026-09-24", pnl: -500 }),
  ]);
  assert.equal(beforeLock.drawdownFloor, 49000);
  assert.equal(beforeLock.drawdownUsed, 500);
  assert.equal(beforeLock.drawdownRoom, 1500);
  const afterLock = compute({ maxLoss: 2000, ddLockOffset: 0 }, [
    trade({ id: "post-lock-gain", date: "2026-09-23", pnl: 3000 }),
    trade({ id: "post-lock-pullback", date: "2026-09-24", pnl: -1000 }),
    trade({ id: "post-lock-profit", date: "2026-09-25", pnl: 2000 }),
  ]);
  assert.equal(afterLock.drawdownFloor, 50000);
  assert.equal(afterLock.drawdownUsed, 0);
  assert.equal(afterLock.drawdownRoom, 4000);
  const offsetLock = compute({ maxLoss: 2000, ddLockOffset: 100 }, [
    trade({ id: "offset-lock-gain", date: "2026-09-23", pnl: 4000 }),
    trade({ id: "offset-lock-pullback", date: "2026-09-24", pnl: -1000 }),
  ]);
  assert.equal(offsetLock.drawdownFloor, 50100);
  assert.equal(offsetLock.drawdownUsed, 0);
  assert.equal(offsetLock.drawdownRoom, 2900);
  const evaluation = compute({ maxLoss: 2000, target: 3000, ddLockOffset: 0 });
  assert.equal(evaluation.targetPct, 100);
  assert.equal(evaluation.toTarget, 0);
  const personal = compute();
  assert.equal(personal.ddToLimit, 1000);
  assert.equal(personal.ddRemaining, 0);
  assert.equal(personal.drawdownFloor, null);
  assert.equal(personal.drawdownUsed, null);
  assert.equal(personal.drawdownRoom, null);
  const unknownFloor = compute({ maxLoss: 2000, ddRuleKnown: false });
  assert.equal(unknownFloor.drawdownFloor, null);
  assert.equal(unknownFloor.drawdownUsed, null);
  assert.equal(unknownFloor.drawdownRoom, null);
  const intradayFloor = compute({ maxLoss: 2000, ddIntraday: true });
  assert.equal(intradayFloor.drawdownFloor, null);
  assert.equal(intradayFloor.drawdownUsed, null);
  assert.equal(intradayFloor.drawdownRoom, null);
  const liveStatic = compute({ maxLoss: 2000, ddStatic: true });
  assert.equal(liveStatic.ddRemaining, 8000);
  assert.equal(liveStatic.drawdownFloor, 48000);
  assert.equal(liveStatic.drawdownUsed, 0);
  assert.equal(liveStatic.drawdownRoom, 8000);
  const trailingOpen = compute({ maxLoss: 2000, ddNoLock: true });
  assert.equal(trailingOpen.ddRemaining, 1000);
  const payout = compute({ maxLoss: 2000, ddLockOffset: 0, cashflows: [{ date: "2026-09-24", amount: -500 }] });
  assert.equal(payout.balance, 55500);
  assert.equal(payout.ddToLimit, 1500);
  assert.equal(payout.ddRemaining, 5500);
  const breached = compute({ maxLoss: 2000, ddLockOffset: 0 }, [
    trade({ id: "breach-high", date: "2026-09-23", pnl: 1000 }),
    trade({ id: "breach-low", date: "2026-09-24", pnl: -4000 }),
  ]);
  assert.equal(breached.drawdownFloor, 49000);
  assert.equal(breached.drawdownUsed, 2000);
  assert.equal(breached.drawdownRoom, 0);
});

test("recorded account movement matches configured capital plus Net trades and signed cashflows", () => {
  const rows = [
    trade({ id: "recorded-win", date: "2026-09-23", pnl: 100, commission: 2, fees: 3 }),
    trade({ id: "recorded-loss", date: "2026-09-24", pnl: -20, commission: 1, fees: 1 }),
  ];
  const movement = accountMetrics.computeRecordedAccountMovement({
    trades: rows,
    size: 50000,
    dayKey: (item) => item.date,
    cashflows: [
      { date: "2026-09-24", amount: -40 },
      { date: "2026-09-25", amount: 10 },
      { date: "2026-09-26", amount: -5 },
    ],
  });
  assert.equal(movement.change, 38);
  assert.equal(movement.balance, 50038);
  assert.equal(movement.days.at(-1)?.cumulative, 38);
  const metricBalance = accountMetrics.computeAccountMetrics({
    trades: rows,
    size: 50000,
    dayKey: (item) => item.date,
    cashflows: [
      { date: "2026-09-24", amount: -40 },
      { date: "2026-09-25", amount: 10 },
      { date: "2026-09-26", amount: -5 },
    ],
  }).balance;
  assert.equal(movement.balance, metricBalance);
});

test("recorded account windows retain historical opening value and filter accounts and dates", () => {
  const leader = accountMetrics.computeRecordedAccountMovement({
    trades: [trade({ id: "window-leader", date: "2026-09-01", pnl: 100, commission: 5, fees: 0 })],
    size: 50000,
    dayKey: (item) => item.date,
    cashflows: [
      { date: "2026-09-03", amount: -25 },
      { date: "2026-09-05", amount: -500 },
      { date: "2026-09-06", amount: 100 },
      { date: "2026-09-07", amount: 999 },
    ],
  });
  const copier = accountMetrics.computeRecordedAccountMovement({
    trades: [trade({ id: "window-copier", account: "Copier", date: "2026-09-02", pnl: 50 })],
    size: 25000,
    dayKey: (item) => item.date,
    cashflows: [
      { date: "2026-09-03", amount: 40 },
      { date: "2026-09-06", amount: -20 },
    ],
  });

  const allAccounts = accountMetrics.windowRecordedAccountMovement([
    { capital: 50000, days: leader.days },
    { capital: 25000, days: copier.days },
  ], "2026-09-04", "2026-09-06");
  assert.equal(allAccounts.openingBalance, 75160);
  assert.equal(allAccounts.points[0].date, "2026-09-04");
  assert.equal(allAccounts.closingBalance, 74740);
  assert.deepEqual(allAccounts.points.slice(1).map((point) => [point.date, point.change, point.balance]), [
    ["2026-09-05", -500, 74660],
    ["2026-09-06", 80, 74740],
  ]);

  const selectedAccount = accountMetrics.windowRecordedAccountMovement([
    { capital: 50000, days: leader.days },
  ], "2026-09-04", "2026-09-06");
  assert.equal(selectedAccount.openingBalance, 50070);
  assert.equal(selectedAccount.closingBalance, 49670);
});
