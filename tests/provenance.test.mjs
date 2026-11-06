import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 1 — explicit provenance (`dataSource`). These tests pin the two
// promises of the change: a note round-trips its provenance, and a note written
// before the key existed keeps its honest absence. They also pin the rule the
// whole phase exists for: a generated copy leg is never a broker fill.
const result = await build({
  entryPoints: {
    storage: new URL("../src/storage.ts", import.meta.url).pathname,
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
const [storage, copy] = await Promise.all([loadBundle("storage"), loadBundle("copy")]);

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
  stopLoss: 0,
  target: 0,
  commission: 0,
  fees: 0,
  pnl: 200,
  pnlPoints: 10,
  setup: "",
  mistake: "",
  thesis: "",
  review: "",
  screenshot: "",
  rating: 0,
  reviewed: false,
  tags: [],
  psychology_tags: [],
  mistake_tags: [],
  ...over,
});

const roundTrip = (t) => storage.parseTradeFromMarkdown(storage.tradeToMarkdown(t));

test("a legacy note without dataSource keeps its absence through a round trip", () => {
  const markdown = storage.tradeToMarkdown(trade());
  assert.ok(!markdown.includes("data_source:"), "nothing is invented on the way out");
  const back = storage.parseTradeFromMarkdown(markdown);
  assert.equal(back.dataSource, undefined, "absence stays absence");
});

test("a broker trade round-trips its provenance", () => {
  const markdown = storage.tradeToMarkdown(trade({ origin: "broker", dataSource: "broker" }));
  assert.ok(markdown.includes('data_source: "broker"'));
  const back = storage.parseTradeFromMarkdown(markdown);
  assert.equal(back.dataSource, "broker");
  assert.equal(back.origin, "broker");
});

test("a manual trade round-trips its provenance", () => {
  const back = roundTrip(trade({ origin: "manual", dataSource: "manual" }));
  assert.equal(back.dataSource, "manual");
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

test("a generated copy leg is reconstructed and never reads as a broker fill", () => {
  const leg = copy.buildLeg(trade(), account(), { from: "2026-01-01", ratio: 1 });
  assert.equal(leg.isCopiedTrade, true);
  assert.equal(leg.copyOrigin, "generated", "the existing marker is not renamed");
  assert.equal(leg.dataSource, "reconstructed");
  assert.notEqual(leg.dataSource, "broker");
  // `origin` is still deliberately left unset on a generated leg.
  assert.equal(leg.origin, undefined);

  const back = roundTrip(leg);
  assert.equal(back.dataSource, "reconstructed");
  assert.equal(back.copyOrigin, "generated");
  assert.equal(back.isCopiedTrade, true);
});

test("reloading a note keeps provenance stable", () => {
  const markdown = storage.tradeToMarkdown(trade({ dataSource: "broker" }));
  const first = storage.parseTradeFromMarkdown(markdown);
  const second = storage.parseTradeFromMarkdown(markdown);
  assert.equal(first.dataSource, second.dataSource);
  assert.equal(first.dataSource, "broker");
});

test("a reconstructed leg and a broker leg are distinguished by dataSource, not by costs alone", () => {
  const generated = copy.buildLeg(trade(), account(), { from: "2026-01-01", ratio: 1 });
  const broker = trade({ origin: "broker", dataSource: "broker" });
  assert.notEqual(generated.dataSource, broker.dataSource);
});
