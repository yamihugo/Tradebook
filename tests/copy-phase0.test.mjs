import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 0 — freeze the CURRENT behaviour of the copy/import boundary before any
// provenance, dedupe or reconciliation work begins. These tests document what
// the code does today, including the gaps; they are deliberately not "desired
// behaviour" suites. Nothing here may be made to pass by changing production
// code — if a later phase changes a fact pinned below, that is a signal to
// update the test on purpose, not by accident.
//
// Bundles the real modules the app uses, with the same obsidian stub the other
// pure-module suites use (tests/copy.test.mjs, financial-regression.test.mjs).
const result = await build({
  entryPoints: {
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
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
            "export const Modal = class {};" +
            "export const Setting = class {};" +
            "export const ItemView = class {};" +
            "export const Plugin = class {};" +
            "export const PluginSettingTab = class {};" +
            "export const addIcon = () => {};" +
            "export const apiVersion = '1.0.0';" +
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
const [copy, money, scope, csv] = await Promise.all([
  loadBundle("copy"),
  loadBundle("money"),
  loadBundle("scope"),
  loadBundle("csv"),
]);

// ---------------------------------------------------------------- fixtures

const leaderTrade = (over = {}) => ({
  id: "base",
  date: "2026-04-15",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "Leader",
  accountType: "funded",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  pnl: 200,
  commission: 0,
  fees: 0,
  ...over,
});

const legTrade = (over = {}) => ({
  ...leaderTrade({
    id: "leg",
    account: "Copier",
    entryPrice: 20000.25,
    exitPrice: 20009.5,
    pnl: 185,
  }),
  isCopiedTrade: true,
  // The engine writes the base note's identity into the leg. For a base with no
  // copyBaseKey that is the base's own id ("base").
  copyBaseKey: "base",
  ...over,
});

const account = (over = {}) => ({
  id: "a1",
  name: "Copier",
  firmId: "topstep",
  programId: "x",
  size: 50000,
  type: "funded",
  copyRole: "copier",
  copyBaseId: "leader",
  createdAt: "2026-01-01",
  ...over,
});

const summarize = (trades) => {
  const accountIdOf = (t) => (t.account || "").trim().toLowerCase();
  const includedAccountIds = new Set(trades.map(accountIdOf));
  return money.summarizeFinancials(trades, {
    scope: { kind: "all-included-accounts", accountIdOf, includedAccountIds },
    dayKey: (t) => t.date,
  });
};

// =========================================================================
// 1. Generated copy leg + later actual follower import
// =========================================================================

test("a generated leg and a later actual import for one copier collapse to one decision, and the actual wins", () => {
  const leader = leaderTrade({ copyBaseKey: undefined });
  const generated = legTrade({ id: "leg-generated", copyOrigin: "generated", pnl: 200 });
  const actual = legTrade({ id: "leg-imported", copyOrigin: "imported", pnl: 185 });

  const result = summarize([leader, generated, actual]);

  // The broker's fill is the record; the generated leg is a model that loses.
  assert.equal(result.eligibleLegCount, 2, "one leader leg + one copier leg survive");
  assert.equal(result.duplicateLegCount, 1, "the generated sibling is the duplicate");
  assert.equal(result.decisionCount, 1, "both account legs are one logical decision");
  assert.equal(result.net.total, 385, "200 (leader) + 185 (actual), not 200 + 200");
  assert.equal(result.decisions[0].legCount, 2);
  assert.equal(result.decisions[0].representative.id, "base", "the non-leg leader represents the decision");
  assert.deepEqual(
    result.eligibleLegs.map((t) => t.id).sort(),
    ["base", "leg-imported"]
  );
});

test("before a real follower is linked, its note is a separate decision (the pre-reconcile gap)", () => {
  const leader = leaderTrade({ copyBaseKey: undefined });
  const generated = legTrade({ id: "leg-generated", copyOrigin: "generated", pnl: 200 });
  // A broker import of the same follower trade, not yet tagged as a copy:
  // no isCopiedTrade, no copyBaseKey.
  const realFollowerNote = leaderTrade({
    id: "follower-real",
    account: "Copier",
    pnl: 185,
    isCopiedTrade: false,
  });

  const result = summarize([leader, generated, realFollowerNote]);

  // GAP frozen: until the real fill is confirmed and linked, the real note and
  // the generated leg are two different logical decisions in the same account.
  assert.equal(result.decisionCount, 2);
  assert.equal(result.eligibleLegCount, 3);
  assert.equal(result.net.total, 585, "200 + 200 + 185 — the decision is counted twice");
});

test("a materialized real leg suppresses the virtual leg for that account; an empty account gets one", () => {
  const base = leaderTrade({ copyBaseKey: "K", id: "base" });
  const imported = legTrade({ id: "leg-imported", copyOrigin: "imported", copyBaseKey: "K" });
  const plugin = {
    settings: {
      propAccounts: [
        { id: "leader", name: "Leader", copyRole: "base" },
        account({ copyBaseId: "leader" }),
      ],
    },
    mappedAccount(name) {
      const key = (name || "").trim().toLowerCase();
      if (key === "leader") return this.settings.propAccounts[0];
      if (key === "copier") return this.settings.propAccounts[1];
      return null;
    },
  };

  const withMaterialized = copy.expandVirtualLegs(plugin, [base, imported]);
  assert.equal(withMaterialized.length, 2, "the real leg is the account's record; no virtual is synthesized");

  const withoutMaterialized = copy.expandVirtualLegs(plugin, [base]);
  assert.equal(withoutMaterialized.length, 2);
  const virtual = withoutMaterialized.find((t) => t.copyVirtual === true);
  assert.ok(virtual, "an account with no materialized leg gets a virtual one");
  assert.equal(virtual.id, "K::copy::a1");
  assert.equal(virtual.copyBaseKey, "K");
});

test("uniqueTrades folds the base and all its copies to one logical trade", () => {
  const leader = leaderTrade({ id: "base" });
  const generated = legTrade({ id: "leg-generated", copyOrigin: "generated" });
  const actual = legTrade({ id: "leg-imported", copyOrigin: "imported" });

  const unique = copy.uniqueTrades([leader, generated, actual]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].id, "base", "the non-leg is the representative");
  assert.equal(scope.analyticsTrades([leader, generated, actual]).unique.length, 1);
  assert.equal(scope.analyticsTrades([leader, generated, actual]).money.length, 3);
});

// =========================================================================
// 2. Reimport / import identity (current dedupe behaviour)
// =========================================================================

const ORDER_CSV = [
  "Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  "Filled,ORD-1,2026-01-05 10:00:00,DEMO1,NQ,buy,1,20000",
  "Filled,ORD-2,2026-01-05 10:05:00,DEMO1,NQ,sell,1,20010",
].join("\n");

const FILL_CSV = [
  "Fill ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  "FILL-1,2026-01-05 10:00:00,DEMO1,NQ,buy,1,20000",
  "FILL-2,2026-01-05 10:05:00,DEMO1,NQ,sell,1,20010",
].join("\n");

const parseTrades = (text) =>
  csv.parseTradeovateCsv(text, [], { sourceZone: "UTC", journalZone: "UTC" });

test("an Orders export carries the order id as the trade's fill id; two parses agree", () => {
  const first = parseTrades(ORDER_CSV);
  const second = parseTrades(ORDER_CSV);
  assert.equal(first.trades.length, 1);
  assert.equal(first.trades[0].fillId, "ORD-1");
  // The trade id is deterministic from account + symbol + open instant + price.
  assert.equal(first.trades[0].id, second.trades[0].id);
  assert.equal(first.trades[0].fillId, second.trades[0].fillId);

  // Current importUi.dedupeKey is exactly `fillId`, so the union of two parses
  // yields one surviving trade. This is the behaviour the report relies on.
  const merged = [...first.trades, ...second.trades];
  const uniqueFillIds = new Set(merged.map((t) => t.fillId).filter(Boolean));
  assert.equal(uniqueFillIds.size, 1);
});

test("a Fills export carries its fill id (Phase 2), so the same file does not double on reimport", () => {
  const parsed = parseTrades(FILL_CSV);
  assert.equal(parsed.trades.length, 1);
  // Phase 2 added the `Fill ID` column to the reader; the gap frozen in Phase 0
  // is closed. The test is updated on purpose, exactly as the suite header says.
  assert.equal(parsed.trades[0].fillId, "FILL-1");
  const merged = [...parsed.trades, ...parsed.trades];
  const uniqueFillIds = new Set(merged.map((t) => t.fillId).filter(Boolean));
  assert.equal(uniqueFillIds.size, 1, "the fill id is now a working dedupe key");
});

// =========================================================================
// 3. Historical copy configuration (current startCopying behaviour)
// =========================================================================

test("startCopying from a past date keeps only entries before it and rewrites the future", () => {
  const acc = account({
    copyMultiplier: 1,
    createdAt: "2026-01-01",
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 1 },
      { from: "2026-03-01", ratio: 2 },
      { from: "2026-06-01", ratio: 1 },
    ],
    copyPeriods: [],
  });

  copy.startCopying(acc, "leader", 3, "2026-03-15");

  // GAP frozen: the 1 June stretch is discarded, not preserved. A historical
  // 1x→2x→1x timeline cannot be edited at a midpoint without losing its tail.
  assert.deepEqual(
    acc.copyConfigHistory.map((h) => [h.from, h.ratio]),
    [
      ["2026-01-01", 1],
      ["2026-03-01", 2],
      ["2026-03-15", 3],
    ]
  );
  assert.equal(copy.effectiveCopyConfig(acc, "2026-02-01").ratio, 1);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-04-01").ratio, 3);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-07-01").ratio, 3, "the June 1x is gone");
});

test("choosing an even earlier date discards every later entry, so insertion is destructive", () => {
  const acc = account({
    copyMultiplier: 1,
    createdAt: "2026-01-01",
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 1 },
      { from: "2026-03-01", ratio: 2 },
      { from: "2026-06-01", ratio: 1 },
    ],
    copyPeriods: [],
  });

  copy.startCopying(acc, "leader", 4, "2026-02-01");

  assert.deepEqual(
    acc.copyConfigHistory.map((h) => [h.from, h.ratio]),
    [
      ["2026-01-01", 1],
      ["2026-02-01", 4],
    ]
  );
  assert.equal(copy.effectiveCopyConfig(acc, "2026-07-01").ratio, 4);
});

test("normalizeCopyPeriods leaves a startCopying timeline valid and idempotent", () => {
  const acc = account({
    copyMultiplier: 1,
    createdAt: "2026-01-01",
    copyConfigHistory: [],
    copyPeriods: [],
  });
  copy.startCopying(acc, "leader", 1, "2026-01-01");
  copy.startCopying(acc, "leader", 2, "2026-04-01");
  copy.startCopying(acc, "leader", 1, "2026-06-01");

  for (const p of acc.copyPeriods) {
    if (p.end) assert.ok(p.start <= p.end, `${p.start} > ${p.end}`);
  }
  assert.equal(acc.copyPeriods.filter((p) => !p.end).length, 1);
  const second = copy.normalizeCopyPeriods(acc);
  assert.equal(second.changed, false, "a healthy timeline is not touched");
});

// =========================================================================
// 4. Mixed copy scenario: one leader, two copiers, changing ratios
// =========================================================================

const buildLegFor = (base, acc, date) =>
  copy.buildLeg(base, acc, copy.effectiveCopyConfig(acc, date));

test("two copiers change ratio independently and each leg freezes its own contract", () => {
  const base = leaderTrade({ id: "base", copyBaseKey: undefined });
  const copierA = account({
    id: "A",
    name: "Copier A",
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 1 },
      { from: "2026-04-01", ratio: 2 },
    ],
  });
  const copierB = account({
    id: "B",
    name: "Copier B",
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 2 },
      // startCopying always records the engine's cross rule on the entry.
      { from: "2026-05-01", ratio: 0.5, crossOrder: true, crossMode: "exposure" },
    ],
  });

  const janA = buildLegFor(base, copierA, "2026-01-15");
  const aprA = buildLegFor(base, copierA, "2026-04-15");
  const mayB = buildLegFor(base, copierB, "2026-05-15");

  assert.deepEqual([janA.symbol, janA.quantity, janA.copyMultiplier], ["NQ", 1, 1]);
  assert.deepEqual([aprA.symbol, aprA.quantity, aprA.copyMultiplier], ["NQ", 2, 2]);
  // 0.5x of one mini crosses to the micro: 1 × 10 × 0.5 = 5 MNQ.
  assert.deepEqual([mayB.symbol, mayB.quantity, mayB.copyMultiplier], ["MNQ", 5, 0.5]);
  // Every leg is a model: no broker cost is invented.
  assert.deepEqual(janA.costCoverage, { commission: false, fees: false });
  assert.equal(janA.commission, 0);
  assert.equal(janA.fees, 0);
});

test("the leader plus its generated legs sum as money but fold into one logical decision", () => {
  const base = leaderTrade({ id: "base", copyBaseKey: undefined, pnl: 200 });
  const copierA = account({ id: "A", name: "Copier A", copyConfigHistory: [{ from: "2026-01-01", ratio: 1 }] });
  const copierB = account({ id: "B", name: "Copier B", copyConfigHistory: [{ from: "2026-01-01", ratio: 2 }] });

  const legA = buildLegFor(base, copierA, "2026-04-15");
  const legB = buildLegFor(base, copierB, "2026-04-15");
  assert.equal(legA.copyBaseKey, "base");
  assert.equal(legB.copyBaseKey, "base");
  assert.equal(copy.logicalDecisionKey(legA), "base");

  const result = summarize([base, legA, legB]);
  assert.equal(result.decisionCount, 1);
  assert.equal(result.eligibleLegCount, 3);
  // Points are priced at each leg's own contract, so the sum is the model's,
  // not base.pnl × accounts.
  assert.equal(result.net.total, 200 + legA.pnl + legB.pnl);
  assert.equal(result.decisions[0].representative.id, "base");
});

test("a ratio change after a leg is built leaves the built leg untouched", () => {
  const base = leaderTrade({ id: "base" });
  const acc = account({
    id: "A",
    name: "Copier A",
    copyConfigHistory: [{ from: "2026-01-01", ratio: 1 }],
  });

  const built = buildLegFor(base, acc, "2026-04-15");
  assert.equal(built.quantity, 1);

  // The trader re-links at a later ratio. The earlier leg is already written.
  copy.startCopying(acc, "leader", 3, "2026-06-01");
  assert.equal(copy.effectiveCopyConfig(acc, "2026-04-15").ratio, 1, "the new stretch does not reach back");
  assert.equal(copy.effectiveCopyConfig(acc, "2026-06-15").ratio, 3);
  assert.equal(built.quantity, 1, "frozen legs are never rewritten");
  assert.equal(built.copyMultiplier, 1);
});
