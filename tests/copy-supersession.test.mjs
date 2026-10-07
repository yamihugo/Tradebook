import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 3 — actual vs reconstructed. These tests pin the supersession contract:
// the actual wins, the model is kept as history, the trader's words survive, and
// the pass is idempotent.
const result = await build({
  entryPoints: {
    supersession: new URL("../src/lib/copySupersession.ts", import.meta.url).pathname,
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
    storage: new URL("../src/storage.ts", import.meta.url).pathname,
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
const [supersession, money, accountMetrics, storage] = await Promise.all([
  loadBundle("supersession"),
  loadBundle("money"),
  loadBundle("accountMetrics"),
  loadBundle("storage"),
]);

const trade = (over = {}) => ({
  id: "t1",
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
  commission: 0,
  fees: 0,
  pnl: 200,
  tags: [],
  psychology_tags: [],
  mistake_tags: [],
  ...over,
});

const leader = () => trade({ id: "base", account: "Leader", pnl: 200 });
const generated = (over = {}) =>
  trade({
    id: "leg-generated",
    account: "Copier",
    isCopiedTrade: true,
    copyOrigin: "generated",
    dataSource: "reconstructed",
    copyBaseKey: "base",
    pnl: 200,
    ...over,
  });
const actual = (over = {}) =>
  trade({
    id: "leg-actual",
    account: "Copier",
    isCopiedTrade: true,
    copyOrigin: "imported",
    dataSource: "broker",
    copyBaseKey: "base",
    pnl: 185,
    entryPrice: 20000.25,
    exitPrice: 20009.5,
    ...over,
  });

const accountKey = (name) => (name || "").trim().toLowerCase();

const summarize = (trades) => {
  const includedAccountIds = new Set(trades.map((t) => accountKey(t.account)));
  return money.summarizeFinancials(trades, {
    scope: { kind: "all-included-accounts", accountIdOf: (t) => accountKey(t.account), includedAccountIds },
    dayKey: (t) => t.date,
  });
};

test("a generated follower and its actual collapse into one decision, and the actual wins", () => {
  const model = generated();
  const real = actual();
  model.supersededBy = real.id;

  const result = summarize([leader(), model, real]);
  assert.equal(result.decisionCount, 1, "leader + copier are one logical decision");
  assert.equal(result.eligibleLegCount, 2, "the superseded model is not a separate leg");
  assert.equal(result.net.total, 385, "200 (leader) + 185 (actual), not the model's 200");
  assert.deepEqual(
    result.eligibleLegs.map((t) => t.id).sort(),
    ["base", "leg-actual"]
  );
});

test("money does not count a superseded model even when both are on disk", () => {
  const withModel = summarize([leader(), generated({ supersededBy: "leg-actual" }), actual()]);
  const withoutModel = summarize([leader(), actual()]);
  assert.equal(withModel.net.total, withoutModel.net.total);
  assert.equal(withModel.eligibleLegCount, withoutModel.eligibleLegCount);
  assert.equal(withModel.decisionCount, withoutModel.decisionCount);
});

// A1 — account-scoped money. The same copier account holds the reconstructed
// model (+100, superseded) and the real fill (+110). Portfolio already prefers
// the actual; the account population must too, through one shared rule.
test("account-scoped money excludes a superseded model and keeps it in the ledger", () => {
  const model = generated({ id: "leg-generated", pnl: 100, supersededBy: "leg-actual" });
  const real = actual({ id: "leg-actual", pnl: 110 });
  const ledger = [model, real];

  // Portfolio: the actual wins, the model contributes nothing.
  const portfolio = summarize(ledger);
  assert.equal(portfolio.net.total, 110, "portfolio stays +110, never +210");
  assert.equal(portfolio.eligibleLegCount, 1);

  // The one account-scoped population rule.
  const accountTrades = supersession.excludeSuperseded(ledger);
  assert.deepEqual(accountTrades.map((t) => t.id), ["leg-actual"], "the superseded model is out of account money");

  // Account-scoped summary and the balance/curve population both read it.
  const m = accountMetrics.computeAccountMetrics({
    trades: accountTrades,
    size: 50000,
    capital: 50000,
    dayKey: (t) => t.date,
  });
  assert.equal(m.net, 110, "account-scoped summary is +110");
  assert.equal(m.tradeCount, 1);
  const movement = accountMetrics.computeRecordedAccountMovement({
    trades: accountTrades,
    size: 50000,
    dayKey: (t) => t.date,
  });
  assert.equal(movement.balance, 50110, "the balance/curve population excludes the model");

  // The superseded note still exists in the input/list — never deleted.
  assert.equal(ledger.length, 2, "both notes remain in the ledger");
  assert.equal(ledger.filter((t) => t.id === "leg-generated").length, 1, "the model is kept as history");
  assert.equal(supersession.isSuperseded(model), true);
  assert.equal(model.supersededBy, "leg-actual");
});

test("the model is found by copy linkage, marked superseded, and the second run is idempotent", () => {
  const trades = [leader(), generated(), actual()];
  const real = actual();

  const first = supersession.generatedSiblings(trades, real, accountKey);
  assert.deepEqual(first.map((t) => t.id), ["leg-generated"]);

  // The caller marks the model; it is kept, not deleted.
  first[0].supersededBy = real.id;
  assert.equal(supersession.isSuperseded(first[0]), true);

  const second = supersession.generatedSiblings(trades, real, accountKey);
  assert.deepEqual(second, [], "a superseded model is never found twice");
});

test("review, notes, tags and prints survive the merge; the actual's own words win", () => {
  const model = generated({
    review: "Model review",
    notes: "Wrote this while modelling",
    tags: ["A", "B"],
    reviewed: true,
    rating: 4,
    screenshots: [{ file: "model.png", note: "model print" }],
  });
  const real = actual();

  const merged = supersession.mergeGeneratedIntoActual(real, model);
  assert.equal(merged.review, "Model review", "an empty actual takes the model's review");
  assert.equal(merged.notes, "Wrote this while modelling");
  assert.deepEqual(merged.tags, ["A", "B"]);
  assert.equal(merged.reviewed, true);
  assert.equal(merged.rating, 4);
  assert.deepEqual(merged.screenshots, [{ file: "model.png", note: "model print" }]);

  // Idempotent: merging again changes nothing.
  const again = supersession.mergeGeneratedIntoActual(merged, model);
  assert.deepEqual(again.tags, ["A", "B"]);
  assert.equal(again.review, "Model review");

  // The actual's own review is never overwritten; tags union.
  const authored = actual({ review: "My real review", tags: ["C"] });
  const kept = supersession.mergeGeneratedIntoActual(authored, model);
  assert.equal(kept.review, "My real review");
  assert.deepEqual(kept.tags, ["C", "A", "B"]);
});

test("regeneration may replace a live model but never an actual or a superseded one", () => {
  assert.equal(supersession.isReplaceableLeg(generated()), true);
  assert.equal(supersession.isReplaceableLeg(actual()), false, "the actual is never overwritten");
  assert.equal(supersession.isReplaceableLeg(generated({ supersededBy: "leg-actual" })), false, "history is frozen");
});

test("supersession round-trips through Markdown and legacy notes stay clean", () => {
  const model = generated({ supersededBy: "leg-actual", supersededAt: "2026-05-01" });
  const markdown = storage.tradeToMarkdown(model);
  assert.ok(markdown.includes("superseded_by:"));
  assert.ok(markdown.includes("superseded_at:"));
  const back = storage.parseTradeFromMarkdown(markdown);
  assert.equal(back.supersededBy, "leg-actual");
  assert.equal(back.supersededAt, "2026-05-01");

  const untouched = storage.tradeToMarkdown(generated());
  assert.ok(!untouched.includes("superseded_by:"), "a live leg carries no supersession key");
});
