import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// The Import screen's default tick for a Trading Group. Preselecting a copier
// is a UI default derived from explicit configuration — it must not discover a
// relationship, write a note, or touch the account's copy configuration. These
// tests pin the reducer and the temporal authority it feeds.
const result = await build({
  entryPoints: {
    sel: new URL("../src/lib/importSelection.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
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
const [sel, copy] = await Promise.all([loadBundle("sel"), loadBundle("copy")]);
const { defaultCopierIds, effectiveSelection, newImportSelection, selectionSignature } = sel;

const account = (over = {}) => ({
  id: "a1",
  name: "Account",
  firmId: "topstep",
  programId: "x",
  size: 50000,
  type: "funded",
  createdAt: "2026-01-01",
  ...over,
});

const leader = (id, over = {}) => account({ id, name: `Leader ${id}`, copyRole: "base", ...over });
const copier = (id, baseId, ratio = 1, over = {}) =>
  account({ id, name: `Copier ${id}`, copyRole: "copier", copyBaseId: baseId, copyMultiplier: ratio, ...over });

const clone = (v) => JSON.parse(JSON.stringify(v));

// A · configured leader → all configured copiers initially selected
test("A configured leader preselects all of its configured copiers", () => {
  const accounts = [leader("L"), copier("c1", "L"), copier("c2", "L"), account({ id: "solo" })];
  const picked = effectiveSelection(accounts, ["L"], newImportSelection());
  assert.deepEqual([...picked].sort(), ["c1", "c2"]);
});

test("a configured copier of a different leader is not selected", () => {
  const accounts = [leader("L1"), leader("L2"), copier("c1", "L1"), copier("c2", "L2")];
  const picked = effectiveSelection(accounts, ["L1"], newImportSelection());
  assert.deepEqual([...picked], ["c1"]);
});

test("a copier is not an extra target of its own mapped destination", () => {
  const accounts = [leader("L"), copier("c1", "L")];
  // The mapped account itself is a destination, never a broadcast target.
  const picked = effectiveSelection(accounts, ["c1", "L"], newImportSelection());
  assert.deepEqual([...picked], []);
});

// B · ratios / configuration preserved
test("B · preselection does not modify account configuration", () => {
  const accounts = [leader("L"), copier("c1", "L", 0.5, { copyConfigHistory: [{ from: "2026-01-01", ratio: 0.5 }] }), copier("c2", "L", 2)];
  const before = clone(accounts);
  effectiveSelection(accounts, ["L"], newImportSelection());
  defaultCopierIds(accounts, ["L"]);
  assert.deepEqual(clone(accounts), before, "accounts and their ratios are untouched");
  assert.equal(copy.effectiveCopyConfig(accounts[1], "2026-06-01").ratio, 0.5);
  assert.equal(copy.effectiveCopyConfig(accounts[2], "2026-06-01").ratio, 2);
});

// C · manual opt-out survives repaints within one mapping
test("C · a manual untick survives later repaints", () => {
  const accounts = [leader("L"), copier("c1", "L"), copier("c2", "L")];
  const state = newImportSelection();
  assert.deepEqual([...effectiveSelection(accounts, ["L"], state)].sort(), ["c1", "c2"]);
  state.overrides.set("c1", false); // the trader unticked it
  const again = effectiveSelection(accounts, ["L"], state);
  assert.deepEqual([...again], ["c2"], "the unticked copier is not re-ticked");
  // A manual tick of a plain account also survives.
  state.overrides.set("solo", true);
  const withSolo = effectiveSelection([...accounts, account({ id: "solo" })], ["L"], state);
  assert.deepEqual([...withSolo].sort(), ["c2", "solo"]);
});

// D · a mapping change clears stale selections and shows the new defaults
test("D · changing the mapped leader recomputes the defaults", () => {
  const accounts = [leader("A"), leader("B"), copier("a1", "A"), copier("a2", "A"), copier("b1", "B"), copier("b2", "B")];
  const state = newImportSelection();
  assert.deepEqual([...effectiveSelection(accounts, ["A"], state)].sort(), ["a1", "a2"]);
  state.overrides.set("a1", false);
  assert.deepEqual([...effectiveSelection(accounts, ["A"], state)], ["a2"]);
  // Leader B: A's selections disappear, B's defaults appear, the a1 untick is gone.
  assert.deepEqual([...effectiveSelection(accounts, ["B"], state)].sort(), ["b1", "b2"]);
  // Non-leader / nothing mapped: no copier is selected.
  assert.deepEqual([...effectiveSelection(accounts, [], state)], []);
});

test("a destination that is not a configured leader preselects nothing", () => {
  const accounts = [leader("L"), copier("c1", "L"), account({ id: "solo" })];
  assert.deepEqual([...effectiveSelection(accounts, ["solo"], newImportSelection())], []);
});

// E/F · preselection is inert: no writes, no trade data, no model generated
test("E · effectiveSelection changes no account and no trade", () => {
  const accounts = [leader("L"), copier("c1", "L"), copier("c2", "L")];
  const trades = [
    { id: "t1", account: "Copier c1", date: "2026-01-05", symbol: "NQ", direction: "long", dataSource: "broker" },
    { id: "t2", account: "Leader L", date: "2026-01-05", symbol: "NQ", direction: "long", dataSource: "broker" },
  ];
  const accountsBefore = clone(accounts);
  const tradesBefore = clone(trades);
  const state = newImportSelection();
  const picked = effectiveSelection(accounts, ["L"], state);
  effectiveSelection(accounts, ["L"], state); // a repaint changes nothing either
  assert.deepEqual(clone(accounts), accountsBefore, "configuration is unchanged");
  assert.deepEqual(clone(trades), tradesBefore, "the trade collection is unchanged");
  // The reducer yields account ids only — it can never return a trade, so it
  // cannot have generated or reconstructed one.
  assert.ok([...picked].every((v) => typeof v === "string"), "only ids are returned");
  assert.ok([...picked].every((v) => !/^t\d$/.test(v)), "no trade id is ever produced by selection");
});

test("F · an existing actual follower is not touched by preselection", () => {
  // The follower's own real fill is broker evidence. Selecting the copier is a
  // default tick; it must leave the note untouched and add no reconstructed leg.
  const accounts = [leader("L"), copier("c1", "L")];
  const actual = {
    id: "f1",
    account: "Copier c1",
    isCopiedTrade: true,
    copyOrigin: "imported",
    dataSource: "broker",
    copyBaseKey: "base-key",
    pnl: 200,
  };
  const trades = [actual];
  const before = clone(trades);
  const picked = effectiveSelection(accounts, ["L"], newImportSelection());
  assert.ok(picked.has("c1"), "the configured copier is preselected");
  assert.deepEqual(clone(trades), before, "actual broker evidence is untouched");
  assert.equal(trades.length, 1, "no reconstructed sibling appears from selection alone");
  assert.equal(trades[0].copyOrigin, "imported");
});

test("selectionSignature is order-independent and stable", () => {
  assert.equal(selectionSignature(["B", "A"]), selectionSignature(["A", "B"]));
  assert.equal(selectionSignature(["A", "A"]), "A");
  assert.equal(selectionSignature([]), "");
});

// G · temporal config stays authoritative over the UI default
test("G · a selected copier still honours copyPeriods / copyConfigHistory", () => {
  const base = account({ id: "L", name: "Leader L", copyRole: "base" });
  const late = copier("c1", "L", 3, {
    createdAt: "2026-06-01",
    copyConfigHistory: [{ from: "2026-06-01", ratio: 3 }],
    copyPeriods: [{ start: "2026-06-01", baseId: "L", multiplier: 3 }],
  });
  const accounts = [base, late];
  // The UI offers the configured copier as a default tick…
  assert.ok(defaultCopierIds(accounts, ["L"]).has("c1"));
  // …but the engine decides per trade. Before the period opened, nothing copies.
  assert.equal(copy.isActiveCopier(late, "L", "2026-05-15"), false);
  assert.equal(copy.effectiveCopyConfig(late, "2026-05-15"), null);
  // From the period's start, the recorded ratio is the one used.
  assert.equal(copy.isActiveCopier(late, "L", "2026-06-15"), true);
  assert.equal(copy.effectiveCopyConfig(late, "2026-06-15").ratio, 3);
});
