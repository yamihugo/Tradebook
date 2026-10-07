import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Bundle the real copy engine the way the app does, with a stub for the one
// external package it touches. The stub covers every symbol `copy.ts` and its
// transitive imports (storage → tradeTable) pull from `obsidian`.
const result = await build({
  entryPoints: [new URL("../src/lib/copy.ts", import.meta.url).pathname],
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
const copy = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const account = (over = {}) => ({
  id: "a1",
  name: "Copier",
  firmId: "topstep",
  programId: "x",
  size: 50000,
  type: "funded",
  copyRole: "copier",
  copyBaseId: "base",
  createdAt: "2026-05-01",
  ...over,
});

const base = () => ({
  id: "b1",
  date: "2026-10-20",
  account: "Leader",
  accountType: "funded",
  symbol: "NQ",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  pnl: 200,
  pnlPoints: 10,
  entryTime: "10:00",
  tags: [],
  psychology_tags: [],
  mistake_tags: [],
});

test("a later history entry shadows an earlier ratio for trades from its date on", () => {
  const acc = account({
    copyMultiplier: 2,
    copyConfigHistory: [
      { from: "2026-10-01", ratio: 2 },
      { from: "2026-10-16", ratio: 1 },
    ],
  });
  assert.equal(copy.effectiveCopyConfig(acc, "2026-10-15").ratio, 2);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-10-20").ratio, 1);
  const leg = copy.buildLeg(base(), acc, copy.effectiveCopyConfig(acc, "2026-10-20"));
  assert.equal(leg.copyMultiplier, 1);
});

test("startCopying on the open period's start replaces the stale entry", () => {
  const acc = account({
    copyMultiplier: 2,
    copyConfigHistory: [{ from: "2026-10-16", ratio: 1 }],
    copyPeriods: [{ start: "2026-10-16", baseId: "base", multiplier: 1 }],
  });
  // Fix A anchors the edit to the open period's start instead of "today".
  copy.startCopying(acc, "base", 2, "2026-10-16");

  assert.equal(acc.copyConfigHistory.filter((h) => h.from === "2026-10-16").length, 1);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-10-20").ratio, 2);
  assert.equal(copy.isActiveCopier(acc, "base", "2026-10-20"), true);
  const leg = copy.buildLeg(base(), acc, copy.effectiveCopyConfig(acc, "2026-10-20"));
  assert.equal(leg.copyMultiplier, 2);
});

test("effectiveCopyConfig falls back to copyMultiplier when history is empty", () => {
  const acc = account({ copyMultiplier: 2, copyConfigHistory: [] });
  assert.equal(copy.effectiveCopyConfig(acc, "2026-10-20").ratio, 2);

  const later = account({ createdAt: "2026-11-01", copyMultiplier: 2, copyConfigHistory: [] });
  assert.equal(copy.effectiveCopyConfig(later, "2026-10-20"), null);
});

test("openCopyPeriod updates an open period with the same start in place", () => {
  const acc = account({ copyPeriods: [{ start: "2026-10-16", baseId: "base", multiplier: 1 }] });
  copy.openCopyPeriod(acc, "base", 2, "2026-10-16");
  assert.equal(acc.copyPeriods.length, 1);
  assert.equal(acc.copyPeriods[0].multiplier, 2);
  assert.equal(acc.copyPeriods[0].end, undefined);
});

test("openCopyPeriod closes the previous stretch the day before the new start", () => {
  const acc = account({ copyPeriods: [{ start: "2026-07-01", baseId: "base", multiplier: 1 }] });
  copy.openCopyPeriod(acc, "base", 2, "2026-10-16");

  const old = acc.copyPeriods.find((p) => p.start === "2026-07-01");
  assert.equal(old.end, "2026-10-15");
  const open = acc.copyPeriods.find((p) => p.start === "2026-10-16");
  assert.equal(open.end, undefined);
  for (const p of acc.copyPeriods) {
    if (p.end) assert.ok(p.start <= p.end, `${p.start} > ${p.end}`);
  }
});

test("buildLeg applies the config ratio to quantity and copyMultiplier", () => {
  const acc = account();
  const leg2 = copy.buildLeg(base(), acc, { from: "2026-10-01", ratio: 2 });
  assert.equal(leg2.copyMultiplier, 2);
  assert.equal(leg2.quantity, 2);

  const legHalf = copy.buildLeg(base(), acc, { from: "2026-10-01", ratio: 0.5, crossOrder: true, crossMode: "exposure" });
  assert.equal(legHalf.symbol, "MNQ");
  assert.equal(legHalf.quantity, 5);
});

test("buildLeg can yield a zero-quantity leg, which writers must skip", () => {
  // M2K is already a micro, so a sub-one ratio has nowhere to cross: the leg
  // rounds to zero contracts. Broadcast must not write it (generateLegs and
  // synthesizeLegs already refuse it), so this pins the shape those guards see.
  const acc = account();
  const leg = copy.buildLeg(
    { ...base(), symbol: "M2K", quantity: 1 },
    acc,
    { from: "2026-10-01", ratio: 0.5, crossOrder: true, crossMode: "exposure", round: "down" }
  );
  assert.equal(leg.symbol, "M2K");
  assert.equal(leg.quantity, 0);
  assert.equal(!leg.symbol || leg.quantity <= 0, true);
});

test("a group copier created at 2x writes ratio 2 into its config history", () => {
  const copier = account({ id: "c1", name: "Tradeify", createdAt: "2026-08-01" });
  copy.startCopying(copier, "base", 2, copier.createdAt);
  assert.equal(copier.copyConfigHistory.length, 1);
  assert.equal(copier.copyConfigHistory[0].ratio, 2);
  assert.equal(copier.copyConfigHistory[0].from, "2026-08-01");
  assert.equal(copy.effectiveCopyConfig(copier, "2026-09-01").ratio, 2);
});

test("two copiers in one group keep independent ratios", () => {
  const a = account({ id: "c1", name: "Tradeify", createdAt: "2026-08-01" });
  const b = account({ id: "c2", name: "Topstep", createdAt: "2026-08-01" });
  copy.startCopying(a, "base", 2, a.createdAt);
  copy.startCopying(b, "base", 1, b.createdAt);

  assert.equal(copy.effectiveCopyConfig(a, "2026-09-01").ratio, 2);
  assert.equal(copy.effectiveCopyConfig(b, "2026-09-01").ratio, 1);
  assert.equal(copy.buildLeg(base(), a, copy.effectiveCopyConfig(a, "2026-09-01")).quantity, 2);
  assert.equal(copy.buildLeg(base(), b, copy.effectiveCopyConfig(b, "2026-09-01")).quantity, 1);
});

test("copierPresentation resolves one ratio/start: open period wins", () => {
  const acc = account({
    copyMultiplier: 9,
    createdAt: "2026-01-01",
    copyConfigHistory: [{ from: "2026-03-01", ratio: 3 }],
    copyPeriods: [{ start: "2026-06-01", baseId: "base", multiplier: 2 }],
  });
  const cp = copy.copierPresentation(acc, (id) => (id === "base" ? "Apex" : id));
  assert.equal(cp.ratio, 2);
  assert.equal(cp.since, "2026-06-01");
  assert.equal(cp.baseName, "Apex");
});

test("copierPresentation falls back to history, then to the legacy scalar", () => {
  const withHistory = account({
    copyMultiplier: 9,
    copyConfigHistory: [
      { from: "2026-03-01", ratio: 3 },
      { from: "2026-05-01", ratio: 4 },
    ],
    copyPeriods: [{ start: "2026-01-01", end: "2026-02-28", baseId: "base", multiplier: 1 }],
  });
  const cp1 = copy.copierPresentation(withHistory);
  assert.equal(cp1.ratio, 4);
  assert.equal(cp1.since, "2026-05-01");

  const legacy = account({ copyMultiplier: 5, createdAt: "2026-02-01", copyConfigHistory: [], copyPeriods: [] });
  const cp2 = copy.copierPresentation(legacy);
  assert.equal(cp2.ratio, 5);
  assert.equal(cp2.since, "2026-02-01");
});

test("copierPresentation marks 'the beginning' for the whole-history floor", () => {
  const acc = account({
    copyMultiplier: 1,
    copyPeriods: [{ start: copy.COPY_ALL_START, baseId: "base", multiplier: 1 }],
  });
  const cp = copy.copierPresentation(acc);
  assert.equal(cp.sinceIsBeginning, true);
});

test("isActiveCopier ignores an impossible start > end period", () => {
  const acc = account({
    copyPeriods: [{ start: "2026-10-16", end: "2026-09-30", baseId: "base", multiplier: 2 }],
    copyConfigHistory: [{ from: "2026-10-16", ratio: 1 }],
  });
  assert.equal(copy.isActiveCopier(acc, "base", "2026-10-20"), false);
});

// ---------------------------------------------------------------- normalize

const shape = (periods) => periods.map((p) => ({ start: p.start, end: p.end, multiplier: p.multiplier }));

test("normalizeCopyPeriods folds a messy timeline into the documented shape", () => {
  const acc = account({
    copyPeriods: [
      { start: "2026-09-04", end: "2026-09-30", multiplier: 1 },
      { start: "2026-09-10", multiplier: 2 },
      { start: "2026-10-01", multiplier: 2 },
    ],
    copyConfigHistory: [],
  });
  const res = copy.normalizeCopyPeriods(acc);
  assert.equal(res.changed, true);
  assert.deepStrictEqual(shape(acc.copyPeriods), [
    { start: "2026-09-04", end: "2026-09-09", multiplier: 1 },
    { start: "2026-09-10", end: "2026-09-30", multiplier: 2 },
    { start: "2026-10-01", end: undefined, multiplier: 2 },
  ]);
  for (const p of acc.copyPeriods) {
    if (p.end) assert.ok(p.start <= p.end, `${p.start} > ${p.end}`);
  }
});

test("normalizeCopyPeriods keeps at most one open stretch", () => {
  const acc = account({
    copyPeriods: [
      { start: "2026-09-04", multiplier: 1 },
      { start: "2026-09-10", multiplier: 2 },
    ],
    copyConfigHistory: [],
  });
  copy.normalizeCopyPeriods(acc);
  assert.equal(acc.copyPeriods.filter((p) => !p.end).length, 1);
  assert.equal(acc.copyPeriods[acc.copyPeriods.length - 1].start, "2026-09-10");
});

test("normalizeCopyPeriods removes a start > end stretch", () => {
  const acc = account({
    copyPeriods: [{ start: "2026-10-16", end: "2026-09-30", multiplier: 1 }],
    copyConfigHistory: [],
  });
  const res = copy.normalizeCopyPeriods(acc);
  assert.equal(res.counts.removed, 1);
  assert.deepStrictEqual(acc.copyPeriods, []);
});

test("normalizeCopyPeriods corrects an overlap by truncating the earlier stretch", () => {
  const acc = account({
    copyPeriods: [
      { start: "2026-07-01", end: "2026-09-30", multiplier: 1 },
      { start: "2026-08-01", multiplier: 2 },
    ],
    copyConfigHistory: [],
  });
  const res = copy.normalizeCopyPeriods(acc);
  assert.equal(res.counts.truncated, 1);
  assert.deepStrictEqual(shape(acc.copyPeriods), [
    { start: "2026-07-01", end: "2026-07-31", multiplier: 1 },
    { start: "2026-08-01", end: undefined, multiplier: 2 },
  ]);
});

test("normalizeCopyPeriods dedupes an equal start, last one wins", () => {
  const acc = account({
    copyPeriods: [
      { start: "2026-09-04", multiplier: 1 },
      { start: "2026-09-04", multiplier: 2 },
    ],
    copyConfigHistory: [],
  });
  const res = copy.normalizeCopyPeriods(acc);
  assert.equal(res.counts.deduped, 1);
  assert.deepStrictEqual(shape(acc.copyPeriods), [{ start: "2026-09-04", end: undefined, multiplier: 2 }]);
});

test("changing the ratio repeatedly keeps a valid timeline", () => {
  const acc = account({ createdAt: "2026-09-01", copyConfigHistory: [], copyPeriods: [] });
  copy.startCopying(acc, "base", 1, "2026-09-01");
  copy.startCopying(acc, "base", 2, "2026-09-05");
  copy.startCopying(acc, "base", 3, "2026-09-05");

  assert.deepStrictEqual(shape(acc.copyPeriods), [
    { start: "2026-09-01", end: "2026-09-04", multiplier: 1 },
    { start: "2026-09-05", end: undefined, multiplier: 3 },
  ]);
  assert.equal(acc.copyPeriods.filter((p) => !p.end).length, 1);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-09-02").ratio, 1);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-09-06").ratio, 3);
});

test("two copiers with different createdAt stay independent on the timeline", () => {
  const a = account({ id: "c1", createdAt: "2026-09-04", copyConfigHistory: [], copyPeriods: [] });
  const b = account({ id: "c2", createdAt: "2026-09-07", copyConfigHistory: [], copyPeriods: [] });
  copy.startCopying(a, "base", 2, a.createdAt);
  copy.startCopying(b, "base", 1, b.createdAt);

  assert.equal(copy.isActiveCopier(a, "base", "2026-09-05"), true);
  assert.equal(copy.isActiveCopier(b, "base", "2026-09-05"), false);
  assert.equal(copy.isActiveCopier(b, "base", "2026-09-08"), true);
});

test("unlinkCopier closes the stretch and clears the live settings", () => {
  const acc = account({
    createdAt: "2000-01-01",
    copyRole: "copier",
    copyBaseId: "base",
    copyMultiplier: 2,
    copyPeriods: [{ start: "2000-01-01", baseId: "base", multiplier: 2 }],
    copyConfigHistory: [{ from: "2000-01-01", ratio: 2 }],
  });
  copy.unlinkCopier(acc, "");

  assert.equal(acc.copyRole, undefined);
  assert.equal(acc.copyBaseId, undefined);
  assert.equal(acc.copyMultiplier, undefined);
  assert.equal(acc.copyPeriods.filter((p) => !p.end).length, 0);
  assert.ok(acc.copyPeriods[0].end, "the stretch should be closed");
});

test("detachFollowers unlinks followers, leaves others, is idempotent", () => {
  const mk = (id, baseId) =>
    account({
      id,
      copyRole: "copier",
      copyBaseId: baseId,
      copyMultiplier: 2,
      copyPeriods: [{ start: "2000-01-01", baseId, multiplier: 2 }],
      copyConfigHistory: [{ from: "2000-01-01", ratio: 2 }],
    });
  const f1 = mk("f1", "L");
  const f2 = mk("f2", "L");
  const other = mk("f3", "X");

  assert.equal(copy.detachFollowers([f1, f2, other], "L", ""), 2);
  assert.equal(f1.copyBaseId, undefined);
  assert.equal(f1.copyRole, undefined);
  assert.equal(f2.copyBaseId, undefined);
  assert.equal(other.copyBaseId, "X");
  assert.equal(copy.detachFollowers([f1, f2, other], "L", ""), 0);
});

test("healDanglingCopiers unlinks only copiers with an unresolved leader", () => {
  const ok = account({ id: "ok", copyRole: "copier", copyBaseId: "leader", createdAt: "2000-01-01" });
  const gone = account({
    id: "gone",
    copyRole: "copier",
    copyBaseId: "archived-leader",
    createdAt: "2000-01-01",
    copyPeriods: [{ start: "2000-01-01", baseId: "archived-leader", multiplier: 1 }],
  });
  const standalone = account({ id: "solo", copyRole: undefined, copyBaseId: undefined, createdAt: "2000-01-01" });
  const active = new Set(["ok", "leader", "solo"]);

  assert.deepStrictEqual(copy.findDanglingCopiers([ok, gone, standalone], active).map((a) => a.id), ["gone"]);
  assert.equal(copy.healDanglingCopiers([ok, gone, standalone], active, ""), 1);
  assert.equal(gone.copyBaseId, undefined);
  assert.equal(gone.copyRole, undefined);
  assert.equal(ok.copyBaseId, "leader");
  assert.equal(copy.healDanglingCopiers([ok, gone, standalone], active, ""), 0);
});

test("findOrphanLegs finds copies whose base note is gone", () => {
  const leg = (baseKey) => ({ ...base(), id: "l-" + baseKey, isCopiedTrade: true, copyBaseKey: baseKey });
  const withBase = { ...base(), copyBaseKey: "K1" };
  const orphan = leg("K2");
  const linked = leg("K1");
  const isolated = base();

  const found = copy.findOrphanLegs([withBase, orphan, linked, isolated]);
  assert.deepStrictEqual(found.map((t) => t.id), ["l-K2"]);
});

test("normalizeCopyPeriods adds missing history but never overwrites it", () => {
  const a = account({
    copyPeriods: [{ start: "2026-09-04", multiplier: 2 }],
    copyConfigHistory: [{ from: "2026-09-04", ratio: 9 }],
  });
  const res = copy.normalizeCopyPeriods(a);
  assert.equal(res.counts.historyAdded, 0);
  assert.equal(a.copyConfigHistory.find((h) => h.from === "2026-09-04").ratio, 9);

  const b = account({
    copyPeriods: [{ start: "2026-09-04", multiplier: 2 }],
    copyConfigHistory: [],
  });
  const res2 = copy.normalizeCopyPeriods(b);
  assert.equal(res2.counts.historyAdded, 1);
  assert.equal(b.copyConfigHistory[0].ratio, 2);
  assert.equal(b.copyConfigHistory[0].from, "2026-09-04");
});

test("normalizeCopyPeriods preserves the configured ratio for a legacy stretch", () => {
  // The pre-normalization shape: a period with no multiplier of its own and a
  // single `copyMultiplier` on the account. The backfill must not turn 0.5× into 1×.
  const acc = account({
    copyMultiplier: 0.5,
    copyPeriods: [{ start: "2026-09-04", baseId: "base" }],
    copyConfigHistory: [],
  });
  copy.normalizeCopyPeriods(acc);
  assert.equal(acc.copyConfigHistory[0].ratio, 0.5);
  assert.equal(copy.effectiveCopyConfig(acc, "2026-09-05").ratio, 0.5);
  assert.equal(copy.copierPresentation(acc).ratio, 0.5);
});

test("re-linking from an earlier date drops superseded future history", () => {
  const acc = account({
    createdAt: "2026-01-01",
    copyConfigHistory: [
      { from: "2026-01-01", ratio: 1 },
      { from: "2026-03-01", ratio: 3 },
    ],
    copyPeriods: [
      { start: "2026-01-01", end: "2026-02-28", baseId: "base", multiplier: 1 },
      { start: "2026-03-01", end: "2026-06-30", baseId: "base", multiplier: 3 },
    ],
  });
  copy.startCopying(acc, "base", 2, "2026-01-01");

  // The old March 3x entry must not shadow the freshly chosen 2x.
  assert.equal(copy.effectiveCopyConfig(acc, "2026-08-01").ratio, 2);
  assert.ok(acc.copyConfigHistory.every((h) => h.from <= "2026-01-01"));
  assert.equal(acc.copyPeriods.filter((p) => !p.end).length, 1);
});

test("opening an earlier stretch drops a later planned one", () => {
  const acc = account({
    copyPeriods: [{ start: "2026-10-16", baseId: "base", multiplier: 1 }],
    copyConfigHistory: [{ from: "2026-10-16", ratio: 1 }],
  });
  copy.startCopying(acc, "base", 2, "2026-10-01");

  assert.equal(copy.effectiveCopyConfig(acc, "2026-10-20").ratio, 2);
  assert.ok(acc.copyPeriods.every((p) => p.start <= "2026-10-01"));
});

test("normalizeCopyPeriods is idempotent", () => {
  const acc = account({
    copyPeriods: [
      { start: "2026-09-04", end: "2026-09-30", multiplier: 1 },
      { start: "2026-09-10", multiplier: 2 },
    ],
    copyConfigHistory: [],
  });
  copy.normalizeCopyPeriods(acc);
  const second = copy.normalizeCopyPeriods(acc);
  assert.equal(second.changed, false);
  assert.deepStrictEqual(second.counts, { removed: 0, truncated: 0, closed: 0, deduped: 0, historyAdded: 0 });
});
