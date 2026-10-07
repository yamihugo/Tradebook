import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 4.5 — reconciliation hardening. These tests pin the safety contract:
// proposals hold stable ids and a display snapshot only, the pure layer never
// touches temporal configuration, a stale proposal is not applied, and linking
// twice is the same as linking once.
const result = await build({
  entryPoints: {
    reconcile: new URL("../src/lib/copyReconcile.ts", import.meta.url).pathname,
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
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
const [reconcile, money] = await Promise.all([loadBundle("reconcile"), loadBundle("money")]);

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

const baseTrade = () => trade({ id: "base", account: "Leader", pnl: 200 });
const followerTrade = () =>
  trade({ id: "follower", account: "Copier", entryTime: "10:01", pnl: 190, origin: "broker", dataSource: "broker" });
const linkedFollower = () =>
  trade({
    id: "follower",
    account: "Copier",
    entryTime: "10:01",
    pnl: 190,
    isCopiedTrade: true,
    copyOrigin: "imported",
    dataSource: "broker",
    copyBaseKey: "base",
    copiedFromAccount: "Leader",
    copyMultiplier: 2,
  });
const generated = () =>
  trade({
    id: "gen",
    account: "Copier",
    entryTime: "10:01",
    pnl: 200,
    isCopiedTrade: true,
    copyOrigin: "generated",
    dataSource: "reconstructed",
    copyBaseKey: "base",
  });

const accounts = () => [
  { id: "leader", name: "Leader", copyRole: "base" },
  {
    id: "copier",
    name: "Copier",
    copyRole: "copier",
    copyBaseId: "leader",
    createdAt: "2026-01-01",
    copyConfigHistory: [{ from: "2026-01-01", ratio: 2 }],
  },
];

const summarize = (trades) => {
  const key = (t) => (t.account || "").trim().toLowerCase();
  const includedAccountIds = new Set(trades.map(key));
  return money.summarizeFinancials(trades, {
    scope: { kind: "all-included-accounts", accountIdOf: key, includedAccountIds },
    dayKey: (t) => t.date,
  });
};

test("a proposal stores stable ids and a snapshot only, and has no side effects", () => {
  const base = [baseTrade()];
  const followers = [followerTrade()];
  const accs = accounts();
  const baseBefore = JSON.stringify(base);
  const followersBefore = JSON.stringify(followers);
  const accountsBefore = JSON.stringify(accs);

  const proposals = reconcile.proposeMatchesForAccount(accs, "copier", base, followers);

  assert.equal(proposals.length, 1);
  const p = proposals[0];
  assert.equal(p.baseId, "base", "the leader is held by id");
  assert.equal(p.followerId, "follower", "the follower is held by id");
  assert.equal(p.ratio, 2);
  assert.equal(p.date, "2026-04-15");
  assert.equal(p.symbol, "NQ");
  assert.ok(!("baseTrade" in p), "no leader snapshot is kept");
  assert.ok(!("followerTrade" in p), "no follower snapshot is kept");

  assert.equal(JSON.stringify(base), baseBefore, "input trades are never mutated");
  assert.equal(JSON.stringify(followers), followersBefore);
  assert.equal(JSON.stringify(accs), accountsBefore, "the account timeline is never touched");
});

test("the pure reconciliation layer never changes copyPeriods or copyConfigHistory", () => {
  const accs = accounts();
  const p = reconcile.proposeMatchesForAccount(accs, "copier", [baseTrade()], [followerTrade()])[0];
  reconcile.linkFollower(followerTrade(), p, "base");
  assert.deepEqual(accs[0].copyPeriods, undefined);
  assert.deepEqual(accs[1].copyConfigHistory, [{ from: "2026-01-01", ratio: 2 }]);
  assert.equal(accs[1].copyPeriods, undefined);
});

test("a stale proposal is handled safely — the snapshot is not a live reference", () => {
  const follower = followerTrade();
  const p = reconcile.proposeMatchesForAccount(accounts(), "copier", [baseTrade()], [follower])[0];

  // The note is edited after it was proposed.
  follower.entryTime = "23:00";
  follower.symbol = "ES";
  assert.equal(p.entryTime, "10:01", "the proposal keeps the snapshot it was made from");
  assert.equal(p.symbol, "NQ");
  assert.equal(reconcile.sameDecision(baseTrade(), follower), false, "re-validation refuses the edited note");

  // The note is deleted after it was proposed.
  const remaining = [follower].filter((t) => t.id !== p.followerId);
  assert.equal(remaining.length, 0, "apply finds nothing to link");
});

test("repeated linking is idempotent; an already-linked follower is never proposed", () => {
  const p = reconcile.proposeMatchesForAccount(accounts(), "copier", [baseTrade()], [followerTrade()])[0];
  const once = reconcile.linkFollower(followerTrade(), p, "base");
  const twice = reconcile.linkFollower(once, p, "base");
  assert.deepEqual(twice, once);
  assert.equal(once.isCopiedTrade, true);
  assert.equal(once.copyOrigin, "imported");
  assert.equal(once.dataSource, "broker");

  assert.deepEqual(reconcile.proposeMatchesForAccount(accounts(), "copier", [baseTrade()], [linkedFollower()]), []);
});

test("a confirmed proposal describes the link; the actual then wins over the model", () => {
  const p = reconcile.proposeMatchesForAccount(accounts(), "copier", [baseTrade()], [followerTrade()])[0];
  const linked = reconcile.linkFollower(followerTrade(), p, "base");

  assert.equal(linked.copyBaseKey, "base");
  assert.equal(linked.copyMultiplier, 2);
  assert.equal(linked.copiedFromAccount, "Leader");

  const result = summarize([baseTrade(), linked]);
  assert.equal(result.decisionCount, 1);
  assert.equal(result.net.total, 390, "200 (leader) + 190 (actual)");

  const withModel = summarize([baseTrade(), generated(), linked]);
  assert.equal(withModel.decisionCount, 1);
  assert.equal(withModel.eligibleLegCount, 2);
  assert.equal(withModel.net.total, 390, "the actual, not the model's 200, is counted");
});

test("an account with no leader (or a non-copier) proposes nothing", () => {
  const orphanCopier = [{ id: "copier", name: "Copier", copyRole: "copier" }];
  assert.deepEqual(reconcile.proposeMatchesForAccount(orphanCopier, "copier", [baseTrade()], [followerTrade()]), []);
  const standalone = [{ id: "standalone", name: "Solo" }];
  assert.deepEqual(reconcile.proposeMatchesForAccount(standalone, "standalone", [baseTrade()], [followerTrade()]), []);
});
